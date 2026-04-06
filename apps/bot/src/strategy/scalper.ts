import type { Config } from "../../config/config.ts";
import type { Candle } from "../exchange/types.ts";
import type { IndicatorRegistry } from "../indicators/registry.ts";
import type { TaapiClient } from "../indicators/taapi.ts";
import type { OrderBook } from "../data/orderbook.ts";
import type { FearGreedPoller } from "../sentiment/fearGreed.ts";
import type { PolymarketPoller } from "../sentiment/polymarket.ts";
import type { ClaudeAgent } from "../ai/claudeAgent.ts";
import type { PositionTracker } from "./position.ts";
import type { RiskManager } from "../risk/riskManager.ts";
import type { CircuitBreaker } from "../risk/circuitBreaker.ts";
import type { TradeJournal } from "../monitoring/tradeJournal.ts";
import type { Database } from "bun:sqlite";
import type { PaperExecutor } from "../execution/paperExecutor.ts";
import type { LiveExecutor } from "../execution/executor.ts";
import type { BracketReconciler } from "../execution/bracketReconciler.ts";
import type { TacticalOverrideStore } from "./tacticalOverrides.ts";
import { evaluateRules } from "../signals/ruleEngine.ts";
import { aggregateSignals } from "../signals/aggregator.ts";
import { computeNextLegSizeBtc } from "./sizing.ts";
import {
  getRecentTrades,
  getLatestStrategicPlan,
  getLegBracketByTradeId,
  deleteLegBracket,
} from "../data/db/repository.ts";
import { strategyLogger } from "../utils/logger.ts";
import type { FinalSignal, MarketSnapshot } from "../signals/snapshot.ts";

type AnyExecutor = PaperExecutor | LiveExecutor;

export class Scalper {
  private candleCount = 0;
  private currentEquity = 0;
  private readonly exitInFlight = new Set<number>();
  private lastSuccessfulEntryAtMs: { long: number | null; short: number | null } = {
    long: null,
    short: null,
  };

  constructor(
    private readonly config: Config,
    private readonly registry: IndicatorRegistry,
    private readonly taapi: TaapiClient,
    private readonly orderBook: OrderBook,
    private readonly fearGreed: FearGreedPoller,
    private readonly polymarket: PolymarketPoller,
    private readonly claude: ClaudeAgent,
    private readonly position: PositionTracker,
    private readonly riskManager: RiskManager,
    private readonly circuitBreaker: CircuitBreaker,
    private readonly journal: TradeJournal,
    private readonly executor: AnyExecutor,
    private readonly db: Database,
    private readonly bracketReconciler: BracketReconciler,
    private readonly tacticalOverrides: TacticalOverrideStore,
    private readonly tradingMode: "live" | "paper",
  ) {}

  setEquity(equity: number): void {
    this.currentEquity = equity;
    this.riskManager.setStartingEquity(equity);
  }

  async onPriceUpdate(currentPrice: number): Promise<void> {
    if (this.tradingMode === "live") {
      await this.bracketReconciler.syncFilledBrackets(
        this.position,
        this.executor,
        this.circuitBreaker,
        Date.now(),
      );
    }
    await this.checkExitTriggers(currentPrice);
  }

  async onCandleClose(candle: Candle): Promise<void> {
    this.candleCount++;

    // Update indicators
    const indicators = this.registry.update(candle);
    const obSnapshot = this.orderBook.snapshot(10);
    const currentPrice = candle.close;
    const fgSnap = this.fearGreed.snapshot;
    const pmSnap = this.polymarket.snapshot;
    const taapiSnap = this.taapi.snapshot;

    if (!indicators.isReady) {
      const warmupSnapshot: MarketSnapshot = {
        pair: this.config.trading.pair,
        timestamp: candle.openTime,
        price: currentPrice,
        indicators,
        taapi: taapiSnap,
        sentiment: {
          fearGreedIndex: fgSnap.fearGreedIndex,
          fearGreedLabel: fgSnap.fearGreedLabel,
          polymarketBullishProb: pmSnap.polymarketBullishProb,
          polymarketMarkets: pmSnap.polymarketMarkets,
          timestamp: Date.now(),
        },
      };

      this.journal.recordSignal({
        candleTime: candle.openTime,
        ruleAction: "HOLD",
        ruleStrength: 0,
        aiAction: null,
        aiConfidence: null,
        aiReasoning: null,
        finalAction: "HOLD",
        snapshotJson: JSON.stringify(warmupSnapshot),
      });

      if (this.candleCount === 1 || this.candleCount % 10 === 0) {
        strategyLogger.info(
          {
            candleTime: new Date(candle.openTime).toISOString(),
            candleCount: this.candleCount,
            warmupRemaining: Math.max(0, this.config.indicators.warmupCandles - this.candleCount),
            price: roundNumber(currentPrice, 2),
            marketData: {
              bestBid: roundNullable(obSnapshot.bestBid, 2),
              bestAsk: roundNullable(obSnapshot.bestAsk, 2),
              spreadBps: roundNullable(obSnapshot.spreadBps, 2),
              imbalance: roundNullable(obSnapshot.imbalance, 3),
              orderbookAgeSec: ageInSeconds(obSnapshot.timestamp),
            },
            sentiment: {
              fearGreedIndex: fgSnap.fearGreedIndex,
              fearGreedLabel: fgSnap.fearGreedLabel,
              fearGreedAgeSec: ageInSeconds(this.fearGreed.lastUpdate),
              polymarketBullishProb: roundNullable(pmSnap.polymarketBullishProb, 3),
              polymarketMarkets: pmSnap.polymarketMarkets.length,
              polymarketAgeSec: ageInSeconds(this.polymarket.lastUpdate),
            },
            taapi: taapiSummary(taapiSnap),
          },
          "Warmup data summary",
        );
      }

      strategyLogger.debug({ candleCount: this.candleCount, warmup: this.config.indicators.warmupCandles }, "Warming up");
      return;
    }

    // ── Exit check (runs every candle while in position) ──────────────────
    if (await this.checkExitTriggers(currentPrice)) {
      return;
    }

    // ── Build market snapshot ────────────────────────────────────────────
    const snapshot: MarketSnapshot = {
      pair: this.config.trading.pair,
      timestamp: candle.openTime,
      price: currentPrice,
      indicators,
      taapi: taapiSnap,
      sentiment: {
        fearGreedIndex: fgSnap.fearGreedIndex,
        fearGreedLabel: fgSnap.fearGreedLabel,
        polymarketBullishProb: pmSnap.polymarketBullishProb,
        polymarketMarkets: pmSnap.polymarketMarkets,
        timestamp: Date.now(),
      },
    };

    // ── Rule engine ──────────────────────────────────────────────────────
    const ruleSignal = evaluateRules(snapshot, this.config);

    // ── AI layer (gated) ─────────────────────────────────────────────────
    const shouldCallAI =
      (this.config.strategy.aiCallOnSignal && ruleSignal.action !== "HOLD") ||
      (this.candleCount % this.config.strategy.aiCallEveryNCandles === 0);

    strategyLogger.info(
      {
        candleTime: new Date(candle.openTime).toISOString(),
        candleCount: this.candleCount,
        price: roundNumber(currentPrice, 2),
        equity: roundNumber(this.currentEquity, 2),
        position: formatPositionSummary(this.position),
        marketData: {
          bestBid: roundNullable(obSnapshot.bestBid, 2),
          bestAsk: roundNullable(obSnapshot.bestAsk, 2),
          weightedMid: roundNullable(obSnapshot.weightedMid, 2),
          spreadBps: roundNullable(obSnapshot.spreadBps, 2),
          imbalance: roundNullable(obSnapshot.imbalance, 3),
          orderbookAgeSec: ageInSeconds(obSnapshot.timestamp),
        },
        indicators: {
          ema9: roundNullable(indicators.ema9, 2),
          ema21: roundNullable(indicators.ema21, 2),
          ema50: roundNullable(indicators.ema50, 2),
          rsi: roundNullable(indicators.rsi, 1),
          macdHistogram: roundNullable(indicators.macdHistogram, 3),
          bbPct: roundNullable(indicators.bbPct, 3),
          vwapDeviation: roundNullable(indicators.vwapDeviation, 4),
        },
        sentiment: {
          fearGreedIndex: fgSnap.fearGreedIndex,
          fearGreedLabel: fgSnap.fearGreedLabel,
          fearGreedAgeSec: ageInSeconds(this.fearGreed.lastUpdate),
          polymarketBullishProb: roundNullable(pmSnap.polymarketBullishProb, 3),
          polymarketMarkets: pmSnap.polymarketMarkets.length,
          polymarketAgeSec: ageInSeconds(this.polymarket.lastUpdate),
        },
        taapi: taapiSummary(taapiSnap),
        ruleSignal: {
          action: ruleSignal.action,
          strength: roundNumber(ruleSignal.strength, 3),
          reasons: ruleSignal.reasons,
        },
        ai: {
          willCall: shouldCallAI,
          cadence: this.config.strategy.aiCallEveryNCandles,
        },
      },
      "Decision data summary",
    );

    let aiDecision = null;
    if (shouldCallAI) {
      const recentTrades = getRecentTrades(this.db, 5);
      const strategicPlan = getLatestStrategicPlan(this.db, Date.now());
      aiDecision = await this.claude.analyze(snapshot, {
        registry: this.registry,
        taapi: this.taapi,
        orderBook: this.orderBook,
        fearGreed: this.fearGreed,
        polymarket: this.polymarket,
        position: this.position,
        recentTrades,
        db: this.db,
        config: this.config,
        bracketReconciler: this.bracketReconciler,
        tacticalOverrides: this.tacticalOverrides,
        strategicPlan,
      });
    }

    // ── Aggregate signals ────────────────────────────────────────────────
    const finalSignal = aggregateSignals(ruleSignal, aiDecision, snapshot, this.config);

    // ── Record signal ────────────────────────────────────────────────────
    const signalId = this.journal.recordSignal({
      candleTime: candle.openTime,
      ruleAction: ruleSignal.action,
      ruleStrength: ruleSignal.strength,
      aiAction: aiDecision?.action ?? null,
      aiConfidence: aiDecision?.confidence ?? null,
      aiReasoning: aiDecision?.reasoning ?? null,
      finalAction: finalSignal.action,
      snapshotJson: JSON.stringify(snapshot),
    });

    if (aiDecision) {
      this.journal.recordAIDecision({
        signalId,
        action: aiDecision.action,
        confidence: aiDecision.confidence,
        reasoning: aiDecision.reasoning,
        riskNotes: aiDecision.riskNotes,
        promptTokens: aiDecision.promptTokens ?? null,
        responseTokens: aiDecision.responseTokens ?? null,
        latencyMs: aiDecision.latencyMs ?? null,
        rawResponse: aiDecision.rawResponse ?? null,
      });
    }

    // ── Execute ──────────────────────────────────────────────────────────
    if (finalSignal.action === "BUY") {
      await this.tryEnterDirection("long", obSnapshot, currentPrice, candle, signalId, finalSignal);
    } else if (finalSignal.action === "SELL") {
      await this.tryEnterDirection("short", obSnapshot, currentPrice, candle, signalId, finalSignal);
    }
  }

  private async tryEnterDirection(
    direction: "long" | "short",
    obSnapshot: ReturnType<OrderBook["snapshot"]>,
    currentPrice: number,
    candle: Candle,
    signalId: number,
    finalSignal: FinalSignal,
  ): Promise<void> {
    if (!this.strategicAllowsEntry(direction)) {
      strategyLogger.warn({ direction }, "Entry blocked — strategic bias");
      return;
    }

    const mark = obSnapshot.weightedMid ?? currentPrice;
    const openExposureUsd = this.position.openNotionalUsd(mark);

    const lastEntry = this.lastSuccessfulEntryAtMs[direction];
    if (lastEntry !== null && this.config.risk.minHoursBetweenNewPositions > 0) {
      const hoursSince = (Date.now() - lastEntry) / 3_600_000;
      if (hoursSince < this.config.risk.minHoursBetweenNewPositions) {
        strategyLogger.warn(
          {
            direction,
            hoursSince: hoursSince.toFixed(2),
            minHours: this.config.risk.minHoursBetweenNewPositions,
          },
          "New entry blocked — min hours between positions not elapsed",
        );
        return;
      }
    }

    const sizeBtc = computeNextLegSizeBtc(
      this.currentEquity,
      mark,
      this.config,
      openExposureUsd,
      this.config.risk.maxOpenExposurePct,
    );

    if (sizeBtc <= 0) {
      strategyLogger.warn(
        { openExposureUsd, maxPct: this.config.risk.maxOpenExposurePct },
        "No room for another leg under max open exposure (or below min size)",
      );
      return;
    }

    const newLegNotional = sizeBtc * mark;
    const exposureCheck = this.riskManager.checkOpenExposureCap(
      this.currentEquity,
      openExposureUsd,
      newLegNotional,
    );
    if (!exposureCheck.allowed) {
      strategyLogger.warn({ reason: exposureCheck.reason }, "Trade blocked by exposure cap");
      return;
    }

    const unrealized = this.position.totalUnrealizedPnl(mark);
    const riskCheck = this.riskManager.checkPreTrade(
      this.currentEquity,
      unrealized,
      sizeBtc,
      mark,
      openExposureUsd,
    );

    if (!riskCheck.allowed) {
      strategyLogger.warn({ reason: riskCheck.reason }, "Trade blocked by risk manager");
      return;
    }

    const tradeSignalJson = JSON.stringify({
      signalId,
      candleTime: candle.openTime,
      finalSignal,
    });

    const entryLimit = this.resolveEntryLimitPrice(mark, direction);

    let opened = false;
    if (direction === "long") {
      opened = await this.executor.enterLong(sizeBtc, mark, tradeSignalJson, entryLimit);
    } else {
      opened = await this.executor.enterShort(sizeBtc, mark, tradeSignalJson, entryLimit);
    }

    if (opened) {
      this.lastSuccessfulEntryAtMs[direction] = Date.now();
      this.tacticalOverrides.clearEntryLimit();
    }
  }

  private strategicAllowsEntry(direction: "long" | "short"): boolean {
    const plan = getLatestStrategicPlan(this.db, Date.now());
    if (!plan) return true;
    if (plan.bias === "neutral") return false;
    if (plan.bias === "long" && direction === "short") return false;
    if (plan.bias === "short" && direction === "long") return false;
    return true;
  }

  private resolveEntryLimitPrice(mark: number, _direction: "long" | "short"): number | undefined {
    const ov = this.tacticalOverrides.getEntryLimit();
    if (ov !== null && ov > 0) return ov;
    const plan = getLatestStrategicPlan(this.db, Date.now());
    const p = plan?.entryLimitPrice;
    if (p === null || p === undefined || !Number.isFinite(p) || p <= 0) return undefined;
    const maxDev = mark * 0.03;
    if (Math.abs(p - mark) <= maxDev) return p;
    return undefined;
  }

  private async checkExitTriggers(currentPrice: number): Promise<boolean> {
    if (this.position.isFlat) {
      return false;
    }

    const obSnapshot = this.orderBook.snapshot(10);
    const exitPrice = obSnapshot.weightedMid ?? currentPrice;
    let anyExit = false;

    for (const leg of this.position.openLegs) {
      const tradeId = leg.tradeId;
      if (this.exitInFlight.has(tradeId)) {
        continue;
      }

      const bracket = getLegBracketByTradeId(this.db, tradeId);

      if (bracket?.useExchangeBrackets) {
        continue;
      }

      if (bracket && !bracket.useExchangeBrackets) {
        type Hit = "tp" | "sl" | null;
        let hit: Hit = null;
        if (leg.direction === "long") {
          if (exitPrice >= bracket.tpPrice) hit = "tp";
          else if (exitPrice <= bracket.slPrice) hit = "sl";
        } else {
          if (exitPrice <= bracket.tpPrice) hit = "tp";
          else if (exitPrice >= bracket.slPrice) hit = "sl";
        }
        if (!hit) {
          continue;
        }

        this.exitInFlight.add(tradeId);
        try {
          deleteLegBracket(this.db, tradeId);
          if (leg.direction === "long") {
            if (hit === "tp") {
              strategyLogger.info({ tradeId, exitPrice, level: bracket.tpPrice }, "Simulated take-profit (bracket)");
              await this.executor.exitLong(tradeId, exitPrice, "take_profit");
              this.circuitBreaker.recordResult(true);
            } else {
              strategyLogger.info({ tradeId, exitPrice, level: bracket.slPrice }, "Simulated stop-loss (bracket)");
              await this.executor.exitLong(tradeId, exitPrice, "stop_loss");
              this.circuitBreaker.recordResult(false);
            }
          } else if (hit === "tp") {
            strategyLogger.info({ tradeId, exitPrice, level: bracket.tpPrice }, "Simulated take-profit (bracket short)");
            await this.executor.exitShort(tradeId, exitPrice, "take_profit");
            this.circuitBreaker.recordResult(true);
          } else {
            strategyLogger.info({ tradeId, exitPrice, level: bracket.slPrice }, "Simulated stop-loss (bracket short)");
            await this.executor.exitShort(tradeId, exitPrice, "stop_loss");
            this.circuitBreaker.recordResult(false);
          }
          anyExit = true;
        } finally {
          this.exitInFlight.delete(tradeId);
        }
        continue;
      }

      const unrealizedPct = this.position.unrealizedPnlPctForTrade(tradeId, exitPrice);

      if (unrealizedPct >= this.config.strategy.takeProfitPct) {
        this.exitInFlight.add(tradeId);
        try {
          strategyLogger.info(
            {
              tradeId,
              direction: leg.direction,
              unrealizedPct: (unrealizedPct * 100).toFixed(3),
              currentPrice: roundNumber(currentPrice, 2),
              exitPrice: roundNumber(exitPrice, 2),
              source: "realtime",
            },
            "Take-profit reached",
          );
          if (leg.direction === "long") {
            await this.executor.exitLong(tradeId, exitPrice, "take_profit");
          } else {
            await this.executor.exitShort(tradeId, exitPrice, "take_profit");
          }
          this.circuitBreaker.recordResult(true);
          anyExit = true;
        } finally {
          this.exitInFlight.delete(tradeId);
        }
        continue;
      }

      if (unrealizedPct <= -this.config.strategy.stopLossPct) {
        this.exitInFlight.add(tradeId);
        try {
          strategyLogger.info(
            {
              tradeId,
              direction: leg.direction,
              unrealizedPct: (unrealizedPct * 100).toFixed(3),
              currentPrice: roundNumber(currentPrice, 2),
              exitPrice: roundNumber(exitPrice, 2),
              source: "realtime",
            },
            "Stop-loss triggered",
          );
          if (leg.direction === "long") {
            await this.executor.exitLong(tradeId, exitPrice, "stop_loss");
          } else {
            await this.executor.exitShort(tradeId, exitPrice, "stop_loss");
          }
          this.circuitBreaker.recordResult(false);
          anyExit = true;
        } finally {
          this.exitInFlight.delete(tradeId);
        }
      }
    }

    return anyExit;
  }
}

function formatPositionSummary(position: PositionTracker): string {
  if (position.isFlat) return "flat";
  const parts: string[] = [];
  if (position.longLegs.length > 0) parts.push(`L×${position.longLegs.length}`);
  if (position.shortLegs.length > 0) parts.push(`S×${position.shortLegs.length}`);
  return parts.join(" ");
}

function roundNullable(value: number | null, digits: number): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return roundNumber(value, digits);
}

function roundNumber(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function ageInSeconds(timestamp: number): number | null {
  if (!timestamp) {
    return null;
  }

  return Math.max(0, roundNumber((Date.now() - timestamp) / 1000, 1));
}

function taapiSummary(snapshot: TaapiClient["snapshot"]) {
  if (!snapshot) {
    return null;
  }

  return {
    isReady: snapshot.isReady,
    exchange: snapshot.exchange,
    symbol: snapshot.symbol,
    interval: snapshot.interval,
    fetchedAgeSec: ageInSeconds(snapshot.fetchedAt),
    price: roundNullable(snapshot.price, 2),
    rsi: roundNullable(snapshot.rsi, 1),
    ema9: roundNullable(snapshot.ema9, 2),
    ema21: roundNullable(snapshot.ema21, 2),
    ema50: roundNullable(snapshot.ema50, 2),
    macdHistogram: roundNullable(snapshot.macdHistogram, 3),
    bbPct: roundNullable(snapshot.bbPct, 3),
    mfi: roundNullable(snapshot.mfi, 1),
    error: snapshot.error,
  };
}
