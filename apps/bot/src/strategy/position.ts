/**
 * Tracks concurrent legs (long and short). Each leg maps to one journal trade id.
 */

export type LegDirection = "long" | "short";

export type OpenLeg = {
  direction: LegDirection;
  entryPrice: number;
  sizeBtc: number;
  tradeId: number;
  entryTime: number;
};

export class PositionTracker {
  private readonly legs: OpenLeg[] = [];

  get isFlat(): boolean {
    return this.legs.length === 0;
  }

  get hasLongs(): boolean {
    return this.legs.some((l) => l.direction === "long");
  }

  get hasShorts(): boolean {
    return this.legs.some((l) => l.direction === "short");
  }

  get longLegs(): readonly OpenLeg[] {
    return this.legs.filter((l) => l.direction === "long");
  }

  get shortLegs(): readonly OpenLeg[] {
    return this.legs.filter((l) => l.direction === "short");
  }

  /** Snapshot for iteration (safe if legs are closed during async work — copy ids first). */
  get openLegs(): readonly OpenLeg[] {
    return [...this.legs];
  }

  restore(legs: OpenLeg[]): void {
    for (const leg of legs) {
      this.legs.push({ ...leg });
    }
  }

  open(entryPrice: number, sizeBtc: number, tradeId: number, direction: LegDirection): void {
    this.legs.push({
      direction,
      entryPrice,
      sizeBtc,
      tradeId,
      entryTime: Date.now(),
    });
  }

  closeByTradeId(tradeId: number): {
    entryPrice: number;
    sizeBtc: number;
    tradeId: number;
    durationMs: number;
    direction: LegDirection;
  } {
    const idx = this.legs.findIndex((l) => l.tradeId === tradeId);
    if (idx < 0) throw new Error(`No open leg for trade id ${tradeId}`);
    const removed = this.legs.splice(idx, 1);
    const leg = removed[0];
    if (!leg) throw new Error(`No open leg for trade id ${tradeId}`);
    return {
      entryPrice: leg.entryPrice,
      sizeBtc: leg.sizeBtc,
      tradeId: leg.tradeId,
      durationMs: Date.now() - leg.entryTime,
      direction: leg.direction,
    };
  }

  /** Total mark-to-market notional (USD) across open legs (absolute exposure). */
  openNotionalUsd(markPrice: number): number {
    let sum = 0;
    for (const leg of this.legs) {
      sum += leg.sizeBtc * markPrice;
    }
    return sum;
  }

  /** Open notional as a fraction of equity (0–1+). */
  openExposureFraction(equityUsd: number, markPrice: number): number {
    if (equityUsd <= 0) return 0;
    return this.openNotionalUsd(markPrice) / equityUsd;
  }

  totalUnrealizedPnl(markPrice: number): number {
    let sum = 0;
    for (const leg of this.legs) {
      if (leg.direction === "long") {
        sum += (markPrice - leg.entryPrice) * leg.sizeBtc;
      } else {
        sum += (leg.entryPrice - markPrice) * leg.sizeBtc;
      }
    }
    return sum;
  }

  unrealizedPnlPctForTrade(tradeId: number, markPrice: number): number {
    const leg = this.legs.find((l) => l.tradeId === tradeId);
    if (!leg) return 0;
    if (leg.direction === "long") {
      return (markPrice - leg.entryPrice) / leg.entryPrice;
    }
    return (leg.entryPrice - markPrice) / leg.entryPrice;
  }

  toJSON() {
    if (this.isFlat) {
      return { status: "FLAT" as const, legs: [] as const };
    }
    const longCount = this.legs.filter((l) => l.direction === "long").length;
    const shortCount = this.legs.filter((l) => l.direction === "short").length;
    return {
      status: "OPEN" as const,
      openCount: this.legs.length,
      longCount,
      shortCount,
      legs: this.legs.map((leg) => ({
        direction: leg.direction,
        tradeId: leg.tradeId,
        entryPrice: leg.entryPrice,
        sizeBtc: leg.sizeBtc,
        entryTime: leg.entryTime,
      })),
    };
  }
}
