import type { MarketSnapshot, RuleSignal, Action } from "./snapshot.ts";
import type { Config } from "../../config/config.ts";

/**
 * Pure rule-based signal engine.
 * No side effects — snapshot in, signal out.
 * Easy to unit-test and backtest independently of the AI layer.
 */
export function evaluateRules(snapshot: MarketSnapshot, config: Config): RuleSignal {
  const { indicators } = snapshot;
  const reasons: string[] = [];
  let bullScore = 0;
  let bearScore = 0;

  // ── Require warm-up ──────────────────────────────────────────────────────
  if (!indicators.isReady) {
    return { action: "HOLD", strength: 0, reasons: ["Indicators warming up"] };
  }

  const { ema9, ema21, rsi, obImbalance } = indicators;

  if (ema9 === null || ema21 === null) {
    return { action: "HOLD", strength: 0, reasons: ["EMA not ready"] };
  }

  // ── EMA Crossover signal ─────────────────────────────────────────────────
  const emaDiff = ema9 - ema21;
  const emaDiffPct = Math.abs(emaDiff) / ema21;

  if (emaDiff > 0) {
    bullScore += 2;
    reasons.push(`EMA9 (${ema9.toFixed(2)}) > EMA21 (${ema21.toFixed(2)})`);
  } else {
    bearScore += 2;
    reasons.push(`EMA9 (${ema9.toFixed(2)}) < EMA21 (${ema21.toFixed(2)})`);
  }

  // Stronger signal if EMAs are diverging (not just barely crossed)
  if (emaDiffPct > 0.001) {
    if (emaDiff > 0) bullScore += 1;
    else bearScore += 1;
  }

  // ── RSI filter ───────────────────────────────────────────────────────────
  if (rsi !== null) {
    if (rsi >= config.strategy.rsiMin && rsi <= config.strategy.rsiMax) {
      bullScore += 1;
      reasons.push(`RSI ${rsi.toFixed(1)} in range [${config.strategy.rsiMin}–${config.strategy.rsiMax}]`);
    } else if (rsi > 70) {
      bearScore += 2;
      reasons.push(`RSI overbought (${rsi.toFixed(1)})`);
    } else if (rsi < 30) {
      // Potential reversal buy (oversold)
      bullScore += 1;
      reasons.push(`RSI oversold (${rsi.toFixed(1)})`);
    }
  }

  // ── Orderbook imbalance ──────────────────────────────────────────────────
  if (obImbalance !== null) {
    if (obImbalance >= config.strategy.obImbalanceMin) {
      bullScore += 1;
      reasons.push(`OB imbalance +${obImbalance.toFixed(3)} (buy pressure)`);
    } else if (obImbalance <= -config.strategy.obImbalanceMin) {
      bearScore += 1;
      reasons.push(`OB imbalance ${obImbalance.toFixed(3)} (sell pressure)`);
    }
  }

  // ── Bollinger Bands ──────────────────────────────────────────────────────
  const { bbPct } = indicators;
  if (bbPct !== null) {
    if (bbPct < 0.2) {
      bullScore += 1;
      reasons.push(`Price near BB lower (${(bbPct * 100).toFixed(0)}%B)`);
    } else if (bbPct > 0.8) {
      bearScore += 1;
      reasons.push(`Price near BB upper (${(bbPct * 100).toFixed(0)}%B)`);
    }
  }

  // ── MACD confirmation ────────────────────────────────────────────────────
  const { macdHistogram } = indicators;
  if (macdHistogram !== null) {
    if (macdHistogram > 0) {
      bullScore += 1;
      reasons.push(`MACD histogram positive (${macdHistogram.toFixed(2)})`);
    } else {
      bearScore += 1;
      reasons.push(`MACD histogram negative (${macdHistogram.toFixed(2)})`);
    }
  }

  // ── Determine action ─────────────────────────────────────────────────────
  const total = bullScore + bearScore;
  let action: Action = "HOLD";
  let strength = 0;

  if (total > 0) {
    const bullRatio = bullScore / total;
    if (bullRatio >= 0.7 && bullScore >= 4) {
      action = "BUY";
      strength = bullRatio;
    } else if (bullRatio <= 0.3 && bearScore >= 3) {
      action = "SELL";
      strength = 1 - bullRatio;
    } else {
      strength = Math.abs(bullRatio - 0.5) * 2; // 0 at 50/50, 1 at extreme
    }
  }

  return { action, strength, reasons };
}
