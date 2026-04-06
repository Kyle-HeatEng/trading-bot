import type { Database } from "bun:sqlite";
import type { Config } from "../../config/config.ts";
import type { KrakenClient } from "../exchange/krakenClient.ts";
import type { PositionTracker, LegDirection } from "../strategy/position.ts";
import type { CircuitBreaker } from "../risk/circuitBreaker.ts";
import {
  getLatestStrategicPlan,
  getLegBracketByTradeId,
  upsertLegBracket,
  deleteLegBracket,
  getOpenLegBrackets,
  type StrategicPlanRow,
} from "../data/db/repository.ts";
import type { LiveExecutor } from "./executor.ts";
import type { PaperExecutor } from "./paperExecutor.ts";
import { strategyLogger } from "../utils/logger.ts";

type AnyExecutor = LiveExecutor | PaperExecutor;

export function defaultBracketsFromConfig(
  direction: LegDirection,
  entryPrice: number,
  config: Config,
): { tp: number; sl: number } {
  if (direction === "long") {
    return {
      tp: entryPrice * (1 + config.strategy.takeProfitPct),
      sl: entryPrice * (1 - config.strategy.stopLossPct),
    };
  }
  return {
    tp: entryPrice * (1 - config.strategy.takeProfitPct),
    sl: entryPrice * (1 + config.strategy.stopLossPct),
  };
}

export function validateBracketGeometry(direction: LegDirection, entry: number, tp: number, sl: number): boolean {
  if (direction === "long") return tp > entry && sl < entry && sl > 0;
  return tp < entry && sl > entry;
}

export function resolveBracketsFromPlanRow(
  direction: LegDirection,
  entryPrice: number,
  plan: StrategicPlanRow | null,
  config: Config,
): { tp: number; sl: number } {
  const fallback = defaultBracketsFromConfig(direction, entryPrice, config);
  if (!plan) return fallback;

  if (direction === "long") {
    const tp = plan.longTp ?? fallback.tp;
    const sl = plan.longSl ?? fallback.sl;
    if (validateBracketGeometry("long", entryPrice, tp, sl)) return { tp, sl };
  } else {
    const tp = plan.shortTp ?? fallback.tp;
    const sl = plan.shortSl ?? fallback.sl;
    if (validateBracketGeometry("short", entryPrice, tp, sl)) return { tp, sl };
  }
  return fallback;
}

export class BracketReconciler {
  private lastSyncMs = 0;
  private readonly syncIntervalMs: number;

  constructor(
    private readonly db: Database,
    private readonly config: Config,
    private readonly kraken: KrakenClient | null,
    syncIntervalMs = 12_000,
  ) {
    this.syncIntervalMs = syncIntervalMs;
  }

  async onEntryFilled(tradeId: number, direction: LegDirection, entryPrice: number, sizeBtc: number): Promise<void> {
    const plan = getLatestStrategicPlan(this.db, Date.now());
    const { tp, sl } = resolveBracketsFromPlanRow(direction, entryPrice, plan, this.config);

    if (!this.kraken) {
      upsertLegBracket(this.db, {
        tradeId,
        tpOrderId: null,
        slOrderId: null,
        tpPrice: tp,
        slPrice: sl,
        useExchangeBrackets: false,
        updatedAt: Date.now(),
      });
      strategyLogger.info({ tradeId, tp, sl, mode: "paper-brackets" }, "Stored simulated TP/SL levels");
      return;
    }

    try {
      const { tpTxid, slTxid } =
        direction === "long"
          ? await this.kraken.placeLongBrackets(sizeBtc, tp, sl)
          : await this.kraken.placeShortBrackets(sizeBtc, tp, sl);

      upsertLegBracket(this.db, {
        tradeId,
        tpOrderId: tpTxid,
        slOrderId: slTxid,
        tpPrice: tp,
        slPrice: sl,
        useExchangeBrackets: true,
        updatedAt: Date.now(),
      });
      strategyLogger.info({ tradeId, tpTxid, slTxid, tp, sl }, "Exchange TP/SL brackets placed");
    } catch (err) {
      strategyLogger.error({ err, tradeId }, "Failed to place exchange brackets — using simulated levels only");
      upsertLegBracket(this.db, {
        tradeId,
        tpOrderId: null,
        slOrderId: null,
        tpPrice: tp,
        slPrice: sl,
        useExchangeBrackets: false,
        updatedAt: Date.now(),
      });
    }
  }

  async replaceBrackets(
    tradeId: number,
    direction: LegDirection,
    entryPrice: number,
    sizeBtc: number,
    newTp: number,
    newSl: number,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!validateBracketGeometry(direction, entryPrice, newTp, newSl)) {
      return { ok: false, error: "Invalid TP/SL geometry vs entry price" };
    }

    const row = getLegBracketByTradeId(this.db, tradeId);
    const useEx = Boolean(row?.useExchangeBrackets) && this.kraken !== null;
    const prevTp = row?.tpOrderId ?? null;
    const prevSl = row?.slOrderId ?? null;

    if (!useEx) {
      upsertLegBracket(this.db, {
        tradeId,
        tpOrderId: prevTp,
        slOrderId: prevSl,
        tpPrice: newTp,
        slPrice: newSl,
        useExchangeBrackets: false,
        updatedAt: Date.now(),
      });
      return { ok: true };
    }

    await this.kraken!.cancelOrders([prevTp, prevSl].filter(Boolean) as string[]);

    try {
      const { tpTxid, slTxid } =
        direction === "long"
          ? await this.kraken!.placeLongBrackets(sizeBtc, newTp, newSl)
          : await this.kraken!.placeShortBrackets(sizeBtc, newTp, newSl);

      upsertLegBracket(this.db, {
        tradeId,
        tpOrderId: tpTxid,
        slOrderId: slTxid,
        tpPrice: newTp,
        slPrice: newSl,
        useExchangeBrackets: true,
        updatedAt: Date.now(),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async refreshOpenLegsFromPlan(position: PositionTracker, plan: StrategicPlanRow | null): Promise<void> {
    for (const leg of position.openLegs) {
      const row = getLegBracketByTradeId(this.db, leg.tradeId);
      if (!row) continue;
      const { tp, sl } = resolveBracketsFromPlanRow(leg.direction, leg.entryPrice, plan, this.config);
      const same =
        Math.abs(tp - row.tpPrice) < entryPriceEpsilon(leg.entryPrice) &&
        Math.abs(sl - row.slPrice) < entryPriceEpsilon(leg.entryPrice);
      if (same) continue;
      const result = await this.replaceBrackets(leg.tradeId, leg.direction, leg.entryPrice, leg.sizeBtc, tp, sl);
      if (!result.ok) {
        strategyLogger.warn({ tradeId: leg.tradeId, error: result.error }, "Failed to refresh brackets from plan");
      }
    }
  }

  async backfillMissingBrackets(position: PositionTracker): Promise<void> {
    for (const leg of position.openLegs) {
      if (getLegBracketByTradeId(this.db, leg.tradeId)) continue;
      await this.onEntryFilled(leg.tradeId, leg.direction, leg.entryPrice, leg.sizeBtc);
    }
  }

  /**
   * Poll Kraken for closed bracket orders and finalize local state (no duplicate exit orders).
   */
  async syncFilledBrackets(
    position: PositionTracker,
    executor: AnyExecutor,
    circuitBreaker: CircuitBreaker,
    nowMs: number,
  ): Promise<void> {
    if (!this.kraken) return;
    if (nowMs - this.lastSyncMs < this.syncIntervalMs) return;
    this.lastSyncMs = nowMs;

    const openBrackets = getOpenLegBrackets(this.db).filter((b) => b.useExchangeBrackets);
    for (const b of openBrackets) {
      const leg = position.openLegs.find((l) => l.tradeId === b.tradeId);
      if (!leg) continue;

      const tpId = b.tpOrderId;
      const slId = b.slOrderId;

      let tpClosed = false;
      let slClosed = false;
      let fillPrice = leg.entryPrice;

      if (tpId) {
        const st = await this.kraken.getOrderStatus(tpId);
        if (isKrakenClosed(st.status)) {
          tpClosed = true;
          fillPrice = st.avgPrice || fillPrice;
        }
      }
      if (slId) {
        const st = await this.kraken.getOrderStatus(slId);
        if (isKrakenClosed(st.status)) {
          slClosed = true;
          fillPrice = st.avgPrice || fillPrice;
        }
      }

      if (!tpClosed && !slClosed) continue;

      const reason: "take_profit" | "stop_loss" = tpClosed ? "take_profit" : "stop_loss";
      const cancelIds = tpClosed ? (slId ? [slId] : []) : tpId ? [tpId] : [];
      await this.kraken.cancelOrders(cancelIds);

      deleteLegBracket(this.db, b.tradeId);
      await executor.finalizeExitFromExchangeBracket(b.tradeId, fillPrice, reason);

      if (reason === "take_profit") circuitBreaker.recordResult(true);
      else circuitBreaker.recordResult(false);
    }
  }
}

function isKrakenClosed(status: string): boolean {
  const s = status.toLowerCase();
  return s === "closed" || s === "filled";
}

function entryPriceEpsilon(entry: number): number {
  return Math.max(1e-6, entry * 1e-8);
}
