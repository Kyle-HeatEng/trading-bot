import type { PositionTracker } from "../strategy/position.ts";
import type { TradeJournal } from "../monitoring/tradeJournal.ts";
import { strategyLogger } from "../utils/logger.ts";
import type { BracketReconciler } from "./bracketReconciler.ts";

/**
 * Paper trading executor — simulates fills using live mid price + slippage.
 * All other components (indicators, AI, risk) run identically to live mode.
 */
export class PaperExecutor {
  private readonly MAKER_FEE = 0.0016; // 0.16% Kraken maker fee
  private readonly SIMULATED_SLIPPAGE = 0.0001; // 0.01% simulated slippage

  constructor(
    private readonly position: PositionTracker,
    private readonly journal: TradeJournal,
    private readonly brackets: BracketReconciler | null = null,
  ) {}

  /** @returns true if a new long leg was opened */
  async enterLong(
    sizeBtc: number,
    midPrice: number,
    signalJson?: string,
    entryLimitPrice?: number | null,
  ): Promise<boolean> {
    const fillPrice =
      entryLimitPrice !== undefined && entryLimitPrice !== null && entryLimitPrice > 0
        ? entryLimitPrice * (1 + this.SIMULATED_SLIPPAGE)
        : midPrice * (1 + this.SIMULATED_SLIPPAGE);
    const fee = fillPrice * sizeBtc * this.MAKER_FEE;

    const tradeId = this.journal.openTrade({
      side: "buy",
      status: "open",
      entryPrice: fillPrice,
      sizeBtc,
      feeTotal: fee,
      entryTime: Date.now(),
      signalJson: signalJson ?? null,
    });

    this.position.open(fillPrice, sizeBtc, tradeId, "long");
    await this.brackets?.onEntryFilled(tradeId, "long", fillPrice, sizeBtc);

    strategyLogger.info(
      { fillPrice, sizeBtc, fee: fee.toFixed(4), mode: "paper" },
      "PAPER: Entered long",
    );
    return true;
  }

  /** @returns true if a new short leg was opened */
  async enterShort(
    sizeBtc: number,
    midPrice: number,
    signalJson?: string,
    entryLimitPrice?: number | null,
  ): Promise<boolean> {
    const fillPrice =
      entryLimitPrice !== undefined && entryLimitPrice !== null && entryLimitPrice > 0
        ? entryLimitPrice * (1 - this.SIMULATED_SLIPPAGE)
        : midPrice * (1 - this.SIMULATED_SLIPPAGE);
    const fee = fillPrice * sizeBtc * this.MAKER_FEE;

    const tradeId = this.journal.openTrade({
      side: "sell",
      status: "open",
      entryPrice: fillPrice,
      sizeBtc,
      feeTotal: fee,
      entryTime: Date.now(),
      signalJson: signalJson ?? null,
    });

    this.position.open(fillPrice, sizeBtc, tradeId, "short");
    await this.brackets?.onEntryFilled(tradeId, "short", fillPrice, sizeBtc);

    strategyLogger.info(
      { fillPrice, sizeBtc, fee: fee.toFixed(4), mode: "paper" },
      "PAPER: Entered short",
    );
    return true;
  }

  async exitLong(tradeId: number, midPrice: number, reason: string): Promise<void> {
    const leg = this.position.openLegs.find((l) => l.tradeId === tradeId && l.direction === "long");
    if (!leg) return;

    const { entryPrice, sizeBtc, tradeId: tid } = this.position.closeByTradeId(tradeId);
    const fillPrice = midPrice * (1 - this.SIMULATED_SLIPPAGE);
    const fee = fillPrice * sizeBtc * this.MAKER_FEE;

    const grossPnl = (fillPrice - entryPrice) * sizeBtc;
    const netPnl = grossPnl - fee * 2; // both legs
    const netPnlPct = (fillPrice - entryPrice) / entryPrice - this.MAKER_FEE * 2;

    this.journal.closeTrade(tid, fillPrice, reason, netPnl, netPnlPct, fee * 2);

    strategyLogger.info(
      {
        fillPrice,
        entryPrice,
        netPnl: netPnl.toFixed(4),
        pct: (netPnlPct * 100).toFixed(3) + "%",
        reason,
        tradeId: tid,
        mode: "paper",
      },
      "PAPER: Exited long",
    );
  }

  async exitShort(tradeId: number, midPrice: number, reason: string): Promise<void> {
    const leg = this.position.openLegs.find((l) => l.tradeId === tradeId && l.direction === "short");
    if (!leg) return;

    const { entryPrice, sizeBtc, tradeId: tid } = this.position.closeByTradeId(tradeId);
    const fillPrice = midPrice * (1 + this.SIMULATED_SLIPPAGE);
    const fee = fillPrice * sizeBtc * this.MAKER_FEE;

    const grossPnl = (entryPrice - fillPrice) * sizeBtc;
    const netPnl = grossPnl - fee * 2;
    const netPnlPct = (entryPrice - fillPrice) / entryPrice - this.MAKER_FEE * 2;

    this.journal.closeTrade(tid, fillPrice, reason, netPnl, netPnlPct, fee * 2);

    strategyLogger.info(
      {
        fillPrice,
        entryPrice,
        netPnl: netPnl.toFixed(4),
        pct: (netPnlPct * 100).toFixed(3) + "%",
        reason,
        tradeId: tid,
        mode: "paper",
      },
      "PAPER: Exited short",
    );
  }

  /** Simulated bracket hit — same PnL path as exit without placing orders. */
  async finalizeExitFromExchangeBracket(
    tradeId: number,
    fillPrice: number,
    reason: "take_profit" | "stop_loss",
  ): Promise<void> {
    const leg = this.position.openLegs.find((l) => l.tradeId === tradeId);
    if (!leg) return;

    if (leg.direction === "long") {
      const { entryPrice, sizeBtc, tradeId: tid } = this.position.closeByTradeId(tradeId);
      const fee = fillPrice * sizeBtc * this.MAKER_FEE;
      const grossPnl = (fillPrice - entryPrice) * sizeBtc;
      const netPnl = grossPnl - fee * 2;
      const netPnlPct = (fillPrice - entryPrice) / entryPrice - this.MAKER_FEE * 2;
      this.journal.closeTrade(tid, fillPrice, reason, netPnl, netPnlPct, fee * 2);
      strategyLogger.info({ fillPrice, reason, tradeId: tid, mode: "paper" }, "PAPER: Bracket exit long");
      return;
    }

    const { entryPrice, sizeBtc, tradeId: tid } = this.position.closeByTradeId(tradeId);
    const fee = fillPrice * sizeBtc * this.MAKER_FEE;
    const grossPnl = (entryPrice - fillPrice) * sizeBtc;
    const netPnl = grossPnl - fee * 2;
    const netPnlPct = (entryPrice - fillPrice) / entryPrice - this.MAKER_FEE * 2;
    this.journal.closeTrade(tid, fillPrice, reason, netPnl, netPnlPct, fee * 2);
    strategyLogger.info({ fillPrice, reason, tradeId: tid, mode: "paper" }, "PAPER: Bracket exit short");
  }
}
