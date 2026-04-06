/**
 * Models Kraken's decay-based rate limit system.
 *
 * Kraken Starter tier: counter ceiling = 15, decay = 0.33/sec
 * Counter increments by call cost on each request.
 * If counter >= ceiling, requests are throttled.
 */
export class KrakenRateLimiter {
  private counter = 0;
  private lastDecay = Date.now();

  constructor(
    private readonly ceiling: number = 15,
    private readonly decayPerSec: number = 0.33,
  ) {}

  /** Wait until we have capacity for a call of given cost (default 1) */
  async waitForCapacity(cost = 1): Promise<void> {
    this.applyDecay();
    while (this.counter + cost > this.ceiling) {
      const neededDecay = this.counter + cost - this.ceiling;
      const waitMs = Math.ceil((neededDecay / this.decayPerSec) * 1000) + 100;
      await sleep(waitMs);
      this.applyDecay();
    }
    this.counter += cost;
  }

  private applyDecay(): void {
    const now = Date.now();
    const elapsed = (now - this.lastDecay) / 1000;
    this.counter = Math.max(0, this.counter - elapsed * this.decayPerSec);
    this.lastDecay = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
