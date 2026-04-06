export interface PolymarketMarket {
  conditionId: string;
  question: string;
  yesProbability: number; // 0.0 – 1.0
  liquidity: number;      // USDC
}

export interface SentimentSnapshot {
  fearGreedIndex: number | null;     // 0 (extreme fear) – 100 (extreme greed)
  fearGreedLabel: string | null;
  polymarketBullishProb: number | null; // weighted avg YES probability from BTC bull markets
  polymarketMarkets: PolymarketMarket[];
  timestamp: number; // Unix ms
}

export const NEUTRAL_SENTIMENT: SentimentSnapshot = {
  fearGreedIndex: null,
  fearGreedLabel: null,
  polymarketBullishProb: null,
  polymarketMarkets: [],
  timestamp: 0,
};
