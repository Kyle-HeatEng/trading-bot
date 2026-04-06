import type { IndicatorValues } from "../indicators/registry.ts";
import type { TaapiSnapshot } from "../indicators/taapi.ts";
import type { SentimentSnapshot } from "../sentiment/types.ts";

export type Action = "BUY" | "SELL" | "HOLD";

export interface MarketSnapshot {
  pair: string;
  timestamp: number; // Unix ms (candle close time)
  price: number;
  indicators: IndicatorValues;
  taapi: TaapiSnapshot | null;
  sentiment: SentimentSnapshot;
}

export interface RuleSignal {
  action: Action;
  strength: number; // 0.0 – 1.0
  reasons: string[];
}

export interface AIDecision {
  action: Action;
  confidence: number; // 0.0 – 1.0
  reasoning: string;
  riskNotes: string;
  promptTokens?: number;
  responseTokens?: number;
  latencyMs?: number;
  rawResponse?: string;
}

export interface FinalSignal {
  action: Action;
  confidence: number;
  ruleSignal: RuleSignal;
  aiDecision: AIDecision | null;
  snapshot: MarketSnapshot;
}
