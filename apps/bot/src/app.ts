import { config } from "../config/config.ts";
import { getDb, closeDb } from "./data/db/database.ts";
import { getRecentCandles, insertCandle, getOpenTrades } from "./data/db/repository.ts";
import { TickBuffer } from "./data/tickBuffer.ts";
import { CandleBuilder } from "./data/candleBuilder.ts";
import { OrderBook } from "./data/orderbook.ts";
import { IndicatorRegistry } from "./indicators/registry.ts";
import { TaapiClient } from "./indicators/taapi.ts";
import { KrakenWs } from "./exchange/krakenWs.ts";
import { KrakenClient } from "./exchange/krakenClient.ts";
import { FearGreedPoller } from "./sentiment/fearGreed.ts";
import { PolymarketPoller } from "./sentiment/polymarket.ts";
import { ClaudeAgent } from "./ai/claudeAgent.ts";
import { PositionTracker, type LegDirection } from "./strategy/position.ts";
import { Scalper } from "./strategy/scalper.ts";
import { RiskManager } from "./risk/riskManager.ts";
import { CircuitBreaker } from "./risk/circuitBreaker.ts";
import { TradeJournal } from "./monitoring/tradeJournal.ts";
import { Dashboard } from "./monitoring/dashboard.ts";
import { PaperExecutor } from "./execution/paperExecutor.ts";
import { LiveExecutor } from "./execution/executor.ts";
import { BracketReconciler } from "./execution/bracketReconciler.ts";
import { TacticalOverrideStore } from "./strategy/tacticalOverrides.ts";
import { StrategicAgent } from "./ai/strategicAgent.ts";
import { logger } from "./utils/logger.ts";

const SQLITE_STALE_GAP_MINUTES = parsePositiveInt(process.env["SQLITE_STALE_GAP_MINUTES"], 60);

export async function startBot(): Promise<void> {
  const mode = process.env["TRADING_MODE"] ?? config.trading.mode;
  logger.info(
    { mode, pair: config.trading.pair, sqliteStaleGapMinutes: SQLITE_STALE_GAP_MINUTES },
    "Starting trading bot",
  );

  // ── Infrastructure ────────────────────────────────────────────────────
  const db = getDb();

  // ── Market data ───────────────────────────────────────────────────────
  const tickBuffer = new TickBuffer(10_000);
  const candleBuilder = new CandleBuilder(config.trading.pair, config.trading.timeframeSec);
  const orderBook = new OrderBook(config.trading.pair);

  // ── Indicators ────────────────────────────────────────────────────────
  const registry = new IndicatorRegistry(config, orderBook);
  const taapi = new TaapiClient(config);

  // ── Sentiment ─────────────────────────────────────────────────────────
  const fearGreed = new FearGreedPoller(config.sentiment.fearGreedRefreshMin);
  const polymarket = new PolymarketPoller(
    config.sentiment.polymarketRefreshSec,
    config.sentiment.polymarketDiscoverMin,
    config.sentiment.polymarketMinLiquidity,
  );

  // ── AI ────────────────────────────────────────────────────────────────
  const claude = new ClaudeAgent();

  // ── Strategy + Risk ───────────────────────────────────────────────────
  const position = new PositionTracker();
  const circuitBreaker = new CircuitBreaker(
    config.risk.circuitBreakerLosses,
    config.risk.circuitBreakerPauseMin,
  );
  const riskManager = new RiskManager(config, circuitBreaker);
  const journal = new TradeJournal(db);

  // ── Brackets + tactical overrides (dual-tier AI) ──────────────────────
  const tacticalOverrides = new TacticalOverrideStore();
  const krakenClient = new KrakenClient();
  const bracketReconciler = new BracketReconciler(db, config, mode === "live" ? krakenClient : null);

  // ── Execution ─────────────────────────────────────────────────────────
  const executor =
    mode === "paper"
      ? new PaperExecutor(position, journal, bracketReconciler)
      : new LiveExecutor(krakenClient, position, journal, config, bracketReconciler);

  // ── Recover open positions from DB ────────────────────────────────────
  const openTrades = getOpenTrades(db);
  if (openTrades.length > 0) {
    const directionFromSide = (side: "buy" | "sell"): LegDirection =>
      side === "buy" ? "long" : "short";

    position.restore(
      openTrades.map((t) => ({
        direction: directionFromSide(t.side),
        entryPrice: t.entryPrice!,
        sizeBtc: t.sizeBtc,
        tradeId: t.id!,
        entryTime: t.entryTime ?? Date.now(),
      })),
    );
    logger.info(
      { count: openTrades.length, tradeIds: openTrades.map((t) => t.id) },
      "Recovered open positions from database",
    );
  }

  await bracketReconciler.backfillMissingBrackets(position);

  const historyCount = await bootstrapHistoricalContext(db, registry, krakenClient);

  // ── Scalper ───────────────────────────────────────────────────────────
  const scalper = new Scalper(
    config, registry, taapi, orderBook, fearGreed, polymarket,
    claude, position, riskManager, circuitBreaker, journal, executor, db,
    bracketReconciler, tacticalOverrides, mode === "live" ? "live" : "paper",
  );

  // ── Hourly strategic agent ────────────────────────────────────────────
  const strategicAgent = new StrategicAgent();
  const strategicIntervalMs = parsePositiveInt(process.env["STRATEGIC_INTERVAL_MS"], 3_600_000);
  const runStrategic = (): void => {
    void strategicAgent
      .runHourly(db, krakenClient, config, position, bracketReconciler)
      .catch((err) => logger.error({ err }, "Strategic agent run failed"));
  };
  runStrategic();
  const strategicTimer = setInterval(runStrategic, strategicIntervalMs);
  const tr = strategicTimer as ReturnType<typeof setInterval> & { unref?: () => void };
  tr.unref?.();

  // ── Dashboard ─────────────────────────────────────────────────────────
  const dashboard = new Dashboard(position, circuitBreaker, riskManager, config.monitoring.dashboardRefreshSec);
  dashboard.update({ mode });

  // Paper mode: use a simulated starting equity if no API keys are configured
  const PAPER_DEFAULT_EQUITY = 1000;
  let paperEquity = PAPER_DEFAULT_EQUITY;
  const seededCandles = getRecentCandles(db, config.trading.pair, config.trading.timeframeSec, 1);
  if (seededCandles.length > 0) {
    dashboard.update({ lastPrice: seededCandles[0]?.close ?? 0 });
  }
  logger.info({ historyCount }, "Historical BTC context ready");

  // ── Wire candle closes to scalper ─────────────────────────────────────
  candleBuilder.onCandleClose(async (candle) => {
    try {
      insertCandle(db, candle);

      if (mode === "live") {
        // Live mode: always fetch real balance — hard fail if unavailable
        const balance = await krakenClient.getBalance();
        scalper.setEquity(balance.totalEquityUsd);
        dashboard.update({ equity: balance.totalEquityUsd, lastPrice: candle.close });
      } else {
        // Paper mode: use simulated equity (no API keys required)
        scalper.setEquity(paperEquity);
        dashboard.update({ equity: paperEquity, lastPrice: candle.close });
      }

      await scalper.onCandleClose(candle);
    } catch (err) {
      logger.error({ err }, "Error in candle handler");
    }
  });

  // ── Start all services ────────────────────────────────────────────────
  fearGreed.start();
  polymarket.start();
  taapi.start();
  dashboard.start();

  const ws = new KrakenWs(config.trading.pair, candleBuilder, orderBook, tickBuffer);
  ws.onPrice(async (price) => {
    try {
      await scalper.onPriceUpdate(price);
    } catch (err) {
      logger.error({ err, price }, "Error in realtime price handler");
    }
  });
  ws.start();

  logger.info("Bot started — waiting for market data");

  // ── Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");
    clearInterval(strategicTimer);
    ws.stop();
    fearGreed.stop();
    polymarket.stop();
    taapi.stop();
    dashboard.stop();
    candleBuilder.flush();
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Keep the process alive
  await new Promise<void>(() => {});
}

async function bootstrapHistoricalContext(
  db: ReturnType<typeof getDb>,
  registry: IndicatorRegistry,
  krakenClient: KrakenClient,
): Promise<number> {
  const targetCount = Math.min(
    200,
    Math.max(
      config.indicators.warmupCandles + 50,
      config.strategy.emaTrend + 25,
      config.indicators.macdSlow + config.indicators.macdSignal + 25,
    ),
  );

  let candles = getRecentCandles(db, config.trading.pair, config.trading.timeframeSec, targetCount);
  const frameMs = config.trading.timeframeSec * 1000;
  const currentFrameOpen = Math.floor(Date.now() / frameMs) * frameMs;
  const latestExpectedClosedOpen = currentFrameOpen - frameMs;
  const newestOpenTime = candles.at(-1)?.openTime ?? 0;
  const staleGapMs = newestOpenTime > 0 ? Math.max(0, latestExpectedClosedOpen - newestOpenTime) : Number.POSITIVE_INFINITY;
  const isStale = staleGapMs > SQLITE_STALE_GAP_MINUTES * 60_000;

  if (candles.length < targetCount || isStale) {
    try {
      const krakenCandles = await krakenClient.getRecentCandles(
        config.trading.restPair,
        config.trading.timeframeSec,
        targetCount,
      );
      for (const candle of krakenCandles) {
        insertCandle(db, candle);
      }
      candles = getRecentCandles(db, config.trading.pair, config.trading.timeframeSec, targetCount);
      logger.info(
        {
          candles: krakenCandles.length,
          newestOpenTime: krakenCandles.at(-1)?.openTime ?? null,
          staleGapMinutes: Number.isFinite(staleGapMs) ? Number((staleGapMs / 60_000).toFixed(1)) : null,
        },
        "Backfilled recent Kraken candles",
      );
    } catch (err) {
      logger.warn(
        {
          err,
          staleGapMinutes: Number.isFinite(staleGapMs) ? Number((staleGapMs / 60_000).toFixed(1)) : null,
          sqliteStaleGapMinutes: SQLITE_STALE_GAP_MINUTES,
        },
        "Failed to backfill recent Kraken candles",
      );
    }
  }

  registry.hydrate(deduplicateCandles(candles));
  return candles.length;
}

function deduplicateCandles(candles: ReturnType<typeof getRecentCandles>) {
  const byOpenTime = new Map<number, (typeof candles)[number]>();
  for (const candle of candles) {
    byOpenTime.set(candle.openTime, candle);
  }

  return Array.from(byOpenTime.values()).sort((a, b) => a.openTime - b.openTime);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
