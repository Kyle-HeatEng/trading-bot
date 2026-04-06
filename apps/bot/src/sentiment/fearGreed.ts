import type { SentimentSnapshot } from "./types.ts";
import { sentimentLogger } from "../utils/logger.ts";

const URL = "https://api.alternative.me/fng/?limit=1";

interface FngResponse {
  data: Array<{
    value: string;
    value_classification: string;
    timestamp: string;
  }>;
}

export class FearGreedPoller {
  private cached: Pick<SentimentSnapshot, "fearGreedIndex" | "fearGreedLabel"> = {
    fearGreedIndex: null,
    fearGreedLabel: null,
  };
  private lastUpdatedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly refreshMinutes: number) {}

  start(): void {
    void this.fetch();
    this.timer = setInterval(() => void this.fetch(), this.refreshMinutes * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get snapshot(): Pick<SentimentSnapshot, "fearGreedIndex" | "fearGreedLabel"> {
    return this.cached;
  }

  get lastUpdate(): number {
    return this.lastUpdatedAt;
  }

  private async fetch(): Promise<void> {
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as FngResponse;
      const entry = data.data[0];
      if (!entry) return;
      this.cached = {
        fearGreedIndex: parseInt(entry.value, 10),
        fearGreedLabel: entry.value_classification,
      };
      this.lastUpdatedAt = Date.now();
      sentimentLogger.debug(this.cached, "Fear & Greed updated");
    } catch (err) {
      sentimentLogger.warn({ err }, "Failed to fetch Fear & Greed index");
    }
  }
}
