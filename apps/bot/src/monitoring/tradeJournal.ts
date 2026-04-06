import type { Database } from "bun:sqlite";
import { insertTrade, updateTrade, insertSignal, insertAIDecision } from "../data/db/repository.ts";
import type { TradeRow, SignalRow, AIDecisionRow } from "../data/db/repository.ts";
import { logger } from "../utils/logger.ts";

/**
 * Centralizes all structured trade logging.
 * Every trade attempt, signal, and AI decision is recorded here.
 */
export class TradeJournal {
  constructor(private readonly db: Database) {}

  openTrade(trade: Omit<TradeRow, "id">): number {
    const id = insertTrade(this.db, trade);
    logger.info(
      {
        tradeId: id,
        side: trade.side,
        sizeBtc: trade.sizeBtc,
        entryPrice: trade.entryPrice,
      },
      "Trade opened",
    );
    return id;
  }

  closeTrade(
    id: number,
    exitPrice: number,
    exitReason: string,
    realizedPnl: number,
    realizedPnlPct: number,
    feeTotal: number,
  ): void {
    updateTrade(this.db, id, {
      status: "closed",
      exitPrice,
      exitReason,
      realizedPnl,
      realizedPnlPct,
      feeTotal,
      exitTime: Date.now(),
    });
    const pnlSign = realizedPnl >= 0 ? "+" : "";
    logger.info(
      {
        tradeId: id,
        exitPrice,
        exitReason,
        pnl: `${pnlSign}${(realizedPnlPct * 100).toFixed(3)}%`,
      },
      "Trade closed",
    );
  }

  cancelTrade(id: number, reason: string): void {
    updateTrade(this.db, id, { status: "cancelled", exitReason: reason, exitTime: Date.now() });
    logger.warn({ tradeId: id, reason }, "Trade cancelled");
  }

  setEntryPrice(id: number, entryPrice: number): void {
    updateTrade(this.db, id, { entryPrice });
  }

  recordSignal(signal: SignalRow): number {
    const id = insertSignal(this.db, signal);
    logger.debug(
      { signalId: id, rule: signal.ruleAction, ai: signal.aiAction, final: signal.finalAction },
      "Signal recorded",
    );
    return id;
  }

  recordAIDecision(decision: AIDecisionRow): void {
    insertAIDecision(this.db, decision);
    logger.debug(
      {
        action: decision.action,
        confidence: decision.confidence,
        latencyMs: decision.latencyMs,
      },
      "AI decision recorded",
    );
  }
}
