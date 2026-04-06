/**
 * Short-lived tactical adjustments (e.g. entry limit) from the fast AI tools.
 * Cleared when consumed or replaced.
 */
export class TacticalOverrideStore {
  private entryLimitPrice: number | null = null;

  setEntryLimit(price: number | null): void {
    this.entryLimitPrice = price;
  }

  /** Peek without clearing — used when deciding entry price. */
  getEntryLimit(): number | null {
    return this.entryLimitPrice;
  }

  clearEntryLimit(): void {
    this.entryLimitPrice = null;
  }
}
