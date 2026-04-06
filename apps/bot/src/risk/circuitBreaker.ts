import { riskLogger } from "../utils/logger.ts";

/**
 * Trips after N consecutive losing trades.
 * Pauses trading for a configurable cooldown period.
 */
export class CircuitBreaker {
  private consecutiveLosses = 0;
  private trippedAt: number | null = null;

  constructor(
    private readonly maxLosses: number,
    private readonly pauseMinutes: number,
  ) {}

  /** Call after each trade closes */
  recordResult(wasWin: boolean): void {
    if (wasWin) {
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;
      riskLogger.warn(
        { consecutiveLosses: this.consecutiveLosses, maxLosses: this.maxLosses },
        "Consecutive loss recorded",
      );
      if (this.consecutiveLosses >= this.maxLosses && this.trippedAt === null) {
        this.trippedAt = Date.now();
        riskLogger.error(
          { pauseMinutes: this.pauseMinutes },
          "Circuit breaker TRIPPED — trading paused",
        );
      }
    }
  }

  /** Returns true if trading is allowed */
  get isOpen(): boolean {
    if (this.trippedAt === null) return true;
    const elapsed = (Date.now() - this.trippedAt) / 60_000;
    if (elapsed >= this.pauseMinutes) {
      riskLogger.info("Circuit breaker reset — trading resumed");
      this.trippedAt = null;
      this.consecutiveLosses = 0;
      return true;
    }
    return false;
  }

  get isTripped(): boolean {
    return !this.isOpen;
  }

  get pauseRemainingMin(): number {
    if (this.trippedAt === null) return 0;
    const elapsed = (Date.now() - this.trippedAt) / 60_000;
    return Math.max(0, this.pauseMinutes - elapsed);
  }
}
