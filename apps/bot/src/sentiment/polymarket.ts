import type { PolymarketMarket, SentimentSnapshot } from "./types.ts";
import { sentimentLogger } from "../utils/logger.ts";

const CLOB_BASE = "https://clob.polymarket.com";
const GAMMA_BASE = "https://gamma-api.polymarket.com";

// Search terms that indicate BTC bullish markets
const BTC_SEARCH_TERMS = ["bitcoin price", "btc price", "bitcoin above", "btc above", "bitcoin higher"];

interface GammaMarket {
  conditionId: string;
  question: string;
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  clobTokenIds?: string[];
}

interface ClobMidpoint {
  mid: string;
}

export class PolymarketPoller {
  private markets: PolymarketMarket[] = [];
  private bullishProb: number | null = null;
  private lastDiscover = 0;
  private lastPriceUpdate = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly refreshSec: number,
    private readonly discoverMinutes: number,
    private readonly minLiquidity: number,
  ) {}

  start(): void {
    void this.discover().then(() => this.fetchPrices());
    this.pollTimer = setInterval(async () => {
      const now = Date.now();
      if (now - this.lastDiscover > this.discoverMinutes * 60 * 1000) {
        await this.discover();
      }
      await this.fetchPrices();
    }, this.refreshSec * 1000);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  get snapshot(): Pick<SentimentSnapshot, "polymarketBullishProb" | "polymarketMarkets"> {
    return {
      polymarketBullishProb: this.bullishProb,
      polymarketMarkets: this.markets,
    };
  }

  get lastUpdate(): number {
    return this.lastPriceUpdate || this.lastDiscover;
  }

  private async discover(): Promise<void> {
    this.lastDiscover = Date.now();
    const found: PolymarketMarket[] = [];

    try {
      for (const term of BTC_SEARCH_TERMS.slice(0, 2)) {
        const url = `${GAMMA_BASE}/markets?search=${encodeURIComponent(term)}&active=true&closed=false&limit=20`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) continue;

        const data = (await res.json()) as GammaMarket[];
        for (const m of data) {
          if (!m.active || m.closed) continue;
          if (parseFloat(m.liquidity) < this.minLiquidity) continue;
          if (!m.clobTokenIds?.length) continue;

          found.push({
            conditionId: m.conditionId,
            question: m.question,
            yesProbability: 0.5, // will be filled in by fetchPrices
            liquidity: parseFloat(m.liquidity),
          });
        }
      }

      // Deduplicate by conditionId
      const seen = new Set<string>();
      this.markets = found.filter((m) => {
        if (seen.has(m.conditionId)) return false;
        seen.add(m.conditionId);
        return true;
      });

      sentimentLogger.info({ count: this.markets.length }, "Discovered Polymarket BTC markets");
    } catch (err) {
      sentimentLogger.warn({ err }, "Polymarket market discovery failed");
    }
  }

  private async fetchPrices(): Promise<void> {
    if (this.markets.length === 0) {
      this.bullishProb = null;
      return;
    }

    let totalLiquidity = 0;
    let weightedProb = 0;

    const updated: PolymarketMarket[] = [];

    for (const market of this.markets) {
      try {
        // Fetch the YES token midpoint price
        const url = `${CLOB_BASE}/midpoint?token_id=${market.conditionId}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) {
          updated.push(market);
          continue;
        }

        const data = (await res.json()) as ClobMidpoint;
        const prob = parseFloat(data.mid);
        // Normalize: Polymarket sometimes returns 0-100 instead of 0-1
        const normalizedProb = prob > 1 ? prob / 100 : prob;

        updated.push({ ...market, yesProbability: normalizedProb });
        weightedProb += normalizedProb * market.liquidity;
        totalLiquidity += market.liquidity;
      } catch {
        updated.push(market);
      }
    }

    this.markets = updated;
    this.bullishProb = totalLiquidity > 0 ? weightedProb / totalLiquidity : null;
    this.lastPriceUpdate = Date.now();

    sentimentLogger.debug(
      { bullishProb: this.bullishProb?.toFixed(3), markets: this.markets.length },
      "Polymarket prices updated",
    );
  }
}
