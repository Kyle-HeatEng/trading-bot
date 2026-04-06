import type { RuleSignal, AIDecision, FinalSignal, Action, MarketSnapshot } from "./snapshot.ts";
import type { Config } from "../../config/config.ts";

/**
 * Combines rule-based signal + AI decision into a final trading signal.
 *
 * Logic:
 * - Rule engine is the primary gate — if it says HOLD, we hold
 *   (unless AI has very high confidence in a contrary view)
 * - AI decision provides a confidence multiplier and secondary filter
 * - Polymarket sentiment acts as a directional tilt weight
 */
export function aggregateSignals(
  ruleSignal: RuleSignal,
  aiDecision: AIDecision | null,
  snapshot: MarketSnapshot,
  config: Config,
): FinalSignal {
  let action: Action = ruleSignal.action;
  let confidence = ruleSignal.strength;

  if (aiDecision) {
    if (aiDecision.action === ruleSignal.action && ruleSignal.action !== "HOLD") {
      // Both agree — boost confidence
      confidence = Math.min(1.0, (confidence + aiDecision.confidence) / 2 + 0.1);
    } else if (aiDecision.action !== ruleSignal.action && ruleSignal.action !== "HOLD") {
      // Disagreement — reduce confidence
      confidence = confidence * 0.6;
      if (confidence < config.strategy.aiConfidenceMin) {
        action = "HOLD";
      }
    } else if (ruleSignal.action === "HOLD" && aiDecision.action !== "HOLD") {
      // AI overrides HOLD only with high confidence
      if (aiDecision.confidence >= 0.85) {
        action = aiDecision.action;
        confidence = aiDecision.confidence;
      }
    }

    // If AI's confidence is below threshold and would act, downgrade to HOLD
    if (action !== "HOLD" && aiDecision.action !== "HOLD" && aiDecision.confidence < config.strategy.aiConfidenceMin) {
      action = "HOLD";
    }
  }

  // Apply Polymarket sentiment tilt
  const { polymarketBullishProb } = snapshot.sentiment;
  if (polymarketBullishProb !== null && action === "BUY") {
    if (polymarketBullishProb < config.strategy.polymarketBullishMin) {
      // Sentiment is bearish — don't go long
      action = "HOLD";
    }
  }
  if (polymarketBullishProb !== null && action === "SELL") {
    const bearishMax = 1 - config.strategy.polymarketBullishMin;
    if (polymarketBullishProb > bearishMax) {
      // Sentiment is bullish — don't open short
      action = "HOLD";
    }
  }

  return {
    action,
    confidence,
    ruleSignal,
    aiDecision,
    snapshot,
  };
}
