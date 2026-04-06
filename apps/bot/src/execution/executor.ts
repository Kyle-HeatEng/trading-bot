import type { KrakenClient } from "../exchange/krakenClient.ts";
import type { PositionTracker } from "../strategy/position.ts";
import type { TradeJournal } from "../monitoring/tradeJournal.ts";
import type { Config } from "../../config/config.ts";
import { withRetry } from "./backoff.ts";
import { strategyLogger } from "../utils/logger.ts";
import type { BracketReconciler } from "./bracketReconciler.ts";

const MAKER_FEE = 0.0016; // 0.16% Kraken maker fee

function liveShortsEnabled(): boolean {
  return process.env["KRAKEN_ENABLE_MARGIN_SHORT"] === "true";
}

/**
 * Live executor — places real orders on Kraken.
 * Prefers limit orders; falls back to market if not filled within timeout.
 */
export class LiveExecutor {
  constructor(
    private readonly kraken: KrakenClient,
    private readonly position: PositionTracker,
    private readonly journal: TradeJournal,
    private readonly config: Config,
    private readonly brackets: BracketReconciler | null = null,
  ) {}

  /** @returns true if a new long leg was opened */
  async enterLong(
    sizeBtc: number,
    currentPrice: number,
    signalJson?: string,
    entryLimitPrice?: number | null,
  ): Promise<boolean> {
    const limitPrice =
      entryLimitPrice !== undefined && entryLimitPrice !== null && entryLimitPrice > 0
        ? entryLimitPrice
        : currentPrice * 1.0001;

    let txid: string;
    try {
      txid = await withRetry(
        () => this.kraken.placeLimitOrder("buy", sizeBtc, limitPrice),
        this.config.execution.maxRetries,
      );
    } catch (err) {
      strategyLogger.error({ err }, "Failed to place entry order");
      return false;
    }

    const tradeId = this.journal.openTrade({
      krakenOrderId: txid,
      side: "buy",
      status: "open",
      sizeBtc,
      entryTime: Date.now(),
      signalJson: signalJson ?? null,
    });

    const filled = await this.waitForFill(txid, this.config.execution.limitOrderTimeoutSec);

    if (filled) {
      const orderInfo = await this.kraken.getOrderStatus(txid);
      const fillPrice = orderInfo.avgPrice || currentPrice;
      this.journal.setEntryPrice(tradeId, fillPrice);
      this.position.open(fillPrice, sizeBtc, tradeId, "long");
      await this.brackets?.onEntryFilled(tradeId, "long", fillPrice, sizeBtc);
      strategyLogger.info({ txid, fillPrice, sizeBtc }, "Long entered");
      return true;
    }

    try {
      await this.kraken.cancelOrder(txid);
      const marketTxid = await this.kraken.placeMarketOrder("buy", sizeBtc);
      const orderInfo = await this.kraken.getOrderStatus(marketTxid);
      const fillPrice = orderInfo.avgPrice || currentPrice;
      this.journal.setEntryPrice(tradeId, fillPrice);
      this.position.open(fillPrice, sizeBtc, tradeId, "long");
      await this.brackets?.onEntryFilled(tradeId, "long", fillPrice, sizeBtc);
      strategyLogger.info({ txid: marketTxid, fillPrice, sizeBtc }, "Long entered (market fallback)");
      return true;
    } catch (err) {
      strategyLogger.error({ err }, "Market order fallback failed");
      this.journal.cancelTrade(tradeId, "order_fill_timeout");
      return false;
    }
  }

  /** Open a short only when KRAKEN_ENABLE_MARGIN_SHORT=true (margin / borrow on Kraken). */
  async enterShort(
    sizeBtc: number,
    currentPrice: number,
    signalJson?: string,
    entryLimitPrice?: number | null,
  ): Promise<boolean> {
    if (!liveShortsEnabled()) {
      strategyLogger.warn(
        {},
        "Live short blocked — set KRAKEN_ENABLE_MARGIN_SHORT=true when margin shorting is configured on Kraken",
      );
      return false;
    }

    const limitPrice =
      entryLimitPrice !== undefined && entryLimitPrice !== null && entryLimitPrice > 0
        ? entryLimitPrice
        : currentPrice * 0.9999;

    let txid: string;
    try {
      txid = await withRetry(
        () => this.kraken.placeLimitOrder("sell", sizeBtc, limitPrice),
        this.config.execution.maxRetries,
      );
    } catch (err) {
      strategyLogger.error({ err }, "Failed to place short entry order");
      return false;
    }

    const tradeId = this.journal.openTrade({
      krakenOrderId: txid,
      side: "sell",
      status: "open",
      sizeBtc,
      entryTime: Date.now(),
      signalJson: signalJson ?? null,
    });

    const filled = await this.waitForFill(txid, this.config.execution.limitOrderTimeoutSec);

    if (filled) {
      const orderInfo = await this.kraken.getOrderStatus(txid);
      const fillPrice = orderInfo.avgPrice || currentPrice;
      this.journal.setEntryPrice(tradeId, fillPrice);
      this.position.open(fillPrice, sizeBtc, tradeId, "short");
      await this.brackets?.onEntryFilled(tradeId, "short", fillPrice, sizeBtc);
      strategyLogger.info({ txid, fillPrice, sizeBtc }, "Short entered");
      return true;
    }

    try {
      await this.kraken.cancelOrder(txid);
      const marketTxid = await this.kraken.placeMarketOrder("sell", sizeBtc);
      const orderInfo = await this.kraken.getOrderStatus(marketTxid);
      const fillPrice = orderInfo.avgPrice || currentPrice;
      this.journal.setEntryPrice(tradeId, fillPrice);
      this.position.open(fillPrice, sizeBtc, tradeId, "short");
      await this.brackets?.onEntryFilled(tradeId, "short", fillPrice, sizeBtc);
      strategyLogger.info({ txid: marketTxid, fillPrice, sizeBtc }, "Short entered (market fallback)");
      return true;
    } catch (err) {
      strategyLogger.error({ err }, "Market short entry fallback failed");
      this.journal.cancelTrade(tradeId, "order_fill_timeout");
      return false;
    }
  }

  async exitLong(tradeId: number, currentPrice: number, reason: string): Promise<void> {
    const leg = this.position.openLegs.find((l) => l.tradeId === tradeId && l.direction === "long");
    if (!leg) return;

    const { entryPrice, sizeBtc, tradeId: tid } = this.position.closeByTradeId(tradeId);
    const limitPrice = currentPrice * 0.9999;

    let txid: string;
    try {
      txid = await withRetry(
        () => this.kraken.placeLimitOrder("sell", sizeBtc, limitPrice),
        this.config.execution.maxRetries,
      );
    } catch (err) {
      strategyLogger.error({ err }, "Limit exit failed — placing market sell");
      try {
        txid = await this.kraken.placeMarketOrder("sell", sizeBtc);
      } catch (err2) {
        strategyLogger.error({ err2 }, "CRITICAL: Market exit also failed");
        this.position.open(entryPrice, sizeBtc, tid, "long");
        return;
      }
    }

    const filled = await this.waitForFill(txid, this.config.execution.limitOrderTimeoutSec);
    let fillPrice = currentPrice;

    if (filled) {
      const orderInfo = await this.kraken.getOrderStatus(txid);
      fillPrice = orderInfo.avgPrice || currentPrice;
    } else {
      await this.kraken.cancelOrder(txid).catch(() => {});
      const marketTxid = await this.kraken.placeMarketOrder("sell", sizeBtc);
      const orderInfo = await this.kraken.getOrderStatus(marketTxid);
      fillPrice = orderInfo.avgPrice || currentPrice;
    }

    const grossPnl = (fillPrice - entryPrice) * sizeBtc;
    const feeCost = fillPrice * sizeBtc * MAKER_FEE * 2;
    const netPnl = grossPnl - feeCost;
    const netPnlPct = (fillPrice - entryPrice) / entryPrice - MAKER_FEE * 2;

    this.journal.closeTrade(tid, fillPrice, reason, netPnl, netPnlPct, feeCost);
    strategyLogger.info(
      {
        fillPrice,
        entryPrice,
        netPnl,
        pct: `${(netPnlPct * 100).toFixed(3)}%`,
        reason,
        tradeId: tid,
      },
      "Long exited",
    );
  }

  async exitShort(tradeId: number, currentPrice: number, reason: string): Promise<void> {
    const leg = this.position.openLegs.find((l) => l.tradeId === tradeId && l.direction === "short");
    if (!leg) return;

    const { entryPrice, sizeBtc, tradeId: tid, direction } = this.position.closeByTradeId(tradeId);
    const limitPrice = currentPrice * 1.0001;

    let txid: string;
    try {
      txid = await withRetry(
        () => this.kraken.placeLimitOrder("buy", sizeBtc, limitPrice),
        this.config.execution.maxRetries,
      );
    } catch (err) {
      strategyLogger.error({ err }, "Limit short cover failed — placing market buy");
      try {
        txid = await this.kraken.placeMarketOrder("buy", sizeBtc);
      } catch (err2) {
        strategyLogger.error({ err2 }, "CRITICAL: Market short cover also failed");
        this.position.open(entryPrice, sizeBtc, tid, direction);
        return;
      }
    }

    const filled = await this.waitForFill(txid, this.config.execution.limitOrderTimeoutSec);
    let fillPrice = currentPrice;

    if (filled) {
      const orderInfo = await this.kraken.getOrderStatus(txid);
      fillPrice = orderInfo.avgPrice || currentPrice;
    } else {
      await this.kraken.cancelOrder(txid).catch(() => {});
      const marketTxid = await this.kraken.placeMarketOrder("buy", sizeBtc);
      const orderInfo = await this.kraken.getOrderStatus(marketTxid);
      fillPrice = orderInfo.avgPrice || currentPrice;
    }

    const grossPnl = (entryPrice - fillPrice) * sizeBtc;
    const feeCost = fillPrice * sizeBtc * MAKER_FEE * 2;
    const netPnl = grossPnl - feeCost;
    const netPnlPct = (entryPrice - fillPrice) / entryPrice - MAKER_FEE * 2;

    this.journal.closeTrade(tid, fillPrice, reason, netPnl, netPnlPct, feeCost);
    strategyLogger.info(
      {
        fillPrice,
        entryPrice,
        netPnl,
        pct: `${(netPnlPct * 100).toFixed(3)}%`,
        reason,
        tradeId: tid,
      },
      "Short exited",
    );
  }

  /**
   * Position was closed on Kraken by a native TP/SL bracket — update journal and tracker only.
   */
  async finalizeExitFromExchangeBracket(
    tradeId: number,
    fillPrice: number,
    reason: "take_profit" | "stop_loss",
  ): Promise<void> {
    const leg = this.position.openLegs.find((l) => l.tradeId === tradeId);
    if (!leg) return;

    if (leg.direction === "long") {
      const { entryPrice, sizeBtc, tradeId: tid } = this.position.closeByTradeId(tradeId);
      const grossPnl = (fillPrice - entryPrice) * sizeBtc;
      const feeCost = fillPrice * sizeBtc * MAKER_FEE * 2;
      const netPnl = grossPnl - feeCost;
      const netPnlPct = (fillPrice - entryPrice) / entryPrice - MAKER_FEE * 2;
      this.journal.closeTrade(tid, fillPrice, reason, netPnl, netPnlPct, feeCost);
      strategyLogger.info(
        { fillPrice, entryPrice, netPnl, reason, tradeId: tid },
        "Long closed via exchange bracket",
      );
      return;
    }

    const { entryPrice, sizeBtc, tradeId: tid } = this.position.closeByTradeId(tradeId);
    const grossPnl = (entryPrice - fillPrice) * sizeBtc;
    const feeCost = fillPrice * sizeBtc * MAKER_FEE * 2;
    const netPnl = grossPnl - feeCost;
    const netPnlPct = (entryPrice - fillPrice) / entryPrice - MAKER_FEE * 2;
    this.journal.closeTrade(tid, fillPrice, reason, netPnl, netPnlPct, feeCost);
    strategyLogger.info(
      { fillPrice, entryPrice, netPnl, reason, tradeId: tid },
      "Short closed via exchange bracket",
    );
  }

  private async waitForFill(txid: string, timeoutSec: number): Promise<boolean> {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const info = await this.kraken.getOrderStatus(txid);
      if (info.status === "closed") return true;
      if (info.status === "canceled") return false;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }
}
