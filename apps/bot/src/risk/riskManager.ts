import type { Config } from "../../config/config.ts";
import type { CircuitBreaker } from "./circuitBreaker.ts";
import { riskLogger } from "../utils/logger.ts";

export type RiskCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export class RiskManager {
  private tradingHalted = false;
  private startingEquity: number | null = null;
  private dayStartEquity: number | null = null;
  private currentDayUtc = "";

  constructor(
    private readonly config: Config,
    private readonly circuitBreaker: CircuitBreaker,
  ) {}

  setStartingEquity(equity: number): void {
    this.startingEquity = equity;
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDayUtc) {
      this.currentDayUtc = today;
      this.dayStartEquity = equity;
      riskLogger.info({ dayStartEquity: equity, date: today }, "New trading day — equity reset");
    }
  }

  /**
   * Pre-trade check — runs synchronously (no I/O).
   * Must pass before any order is placed.
   */
  checkPreTrade(
    currentEquity: number,
    unrealizedPnl: number,
    sizeBtc: number,
    price: number,
    existingOpenNotionalUsd = 0,
  ): RiskCheckResult {
    // 1. Hard halt check
    if (this.tradingHalted) {
      return { allowed: false, reason: "Trading halted — daily loss limit exceeded" };
    }

    // 2. Circuit breaker
    if (this.circuitBreaker.isTripped) {
      const remaining = this.circuitBreaker.pauseRemainingMin.toFixed(1);
      return { allowed: false, reason: `Circuit breaker active — ${remaining} min remaining` };
    }

    // 3. Daily loss check
    if (this.dayStartEquity !== null) {
      const totalPnl = currentEquity + unrealizedPnl - this.dayStartEquity;
      const pnlPct = totalPnl / this.dayStartEquity;
      if (pnlPct <= -this.config.risk.maxDailyLossPct) {
        this.tradingHalted = true;
        riskLogger.error(
          { pnlPct: (pnlPct * 100).toFixed(2), limit: this.config.risk.maxDailyLossPct * 100 },
          "DAILY LOSS LIMIT HIT — halting all trading",
        );
        return { allowed: false, reason: `Daily loss limit exceeded (${(pnlPct * 100).toFixed(2)}%)` };
      }
    }

    // 4. Size sanity check
    const notional = sizeBtc * price;
    if (sizeBtc < this.config.sizing.minBtc) {
      return { allowed: false, reason: `Order size ${sizeBtc} BTC below minimum ${this.config.sizing.minBtc}` };
    }
    if (sizeBtc > this.config.sizing.maxBtc) {
      return { allowed: false, reason: `Order size ${sizeBtc} BTC exceeds maximum ${this.config.sizing.maxBtc}` };
    }
    const totalOpen = existingOpenNotionalUsd + notional;
    if (totalOpen > currentEquity) {
      return {
        allowed: false,
        reason: `Total open notional $${totalOpen.toFixed(2)} exceeds equity $${currentEquity.toFixed(2)}`,
      };
    }

    return { allowed: true };
  }

  /** Concurrent position notional cap (fraction of equity, gross across longs and shorts). */
  checkOpenExposureCap(equityUsd: number, openExposureUsd: number, newLegNotionalUsd: number): RiskCheckResult {
    const capUsd = equityUsd * this.config.risk.maxOpenExposurePct;
    if (openExposureUsd + newLegNotionalUsd > capUsd + 1e-8) {
      const pct = (this.config.risk.maxOpenExposurePct * 100).toFixed(2);
      return {
        allowed: false,
        reason: `Would exceed max open exposure (${pct}% of equity): open $${openExposureUsd.toFixed(2)} + new $${newLegNotionalUsd.toFixed(2)} > cap $${capUsd.toFixed(2)}`,
      };
    }
    return { allowed: true };
  }

  /** Reset daily halt at midnight UTC */
  resetDailyHalt(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDayUtc) {
      this.tradingHalted = false;
      this.currentDayUtc = today;
      riskLogger.info("Daily halt reset for new trading day");
    }
  }

  get isHalted(): boolean {
    return this.tradingHalted;
  }
}
