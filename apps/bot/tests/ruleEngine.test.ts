import { describe, test, expect } from "bun:test";
import { evaluateRules } from "../src/signals/ruleEngine.ts";
import type { MarketSnapshot } from "../src/signals/snapshot.ts";
import type { IndicatorValues } from "../src/indicators/registry.ts";
import { NEUTRAL_SENTIMENT } from "../src/sentiment/types.ts";
import { config } from "../config/config.ts";

function makeSnapshot(overrides: Partial<IndicatorValues> = {}): MarketSnapshot {
  const baseIndicators: IndicatorValues = {
    rsi: 52,
    macd: 10,
    macdSignal: 8,
    macdHistogram: 2,
    stochasticK: 60,
    stochasticD: 55,
    mfi: 55,
    ema9: 80100,
    ema21: 80000,
    ema50: 79500,
    bbUpper: 81000,
    bbMiddle: 80000,
    bbLower: 79000,
    bbPct: 0.55,
    vwap: 80000,
    obv: 1000,
    volumeDelta: 500,
    vwapDeviation: 0.001,
    obImbalance: 0.2,
    spreadBps: 1.5,
    weightedMid: 80050,
    isReady: true,
    candleCount: 100,
    ...overrides,
  };

  return {
    pair: "XBT/USD",
    timestamp: Date.now(),
    price: 80050,
    indicators: baseIndicators,
    taapi: null,
    sentiment: { ...NEUTRAL_SENTIMENT, timestamp: Date.now() },
  };
}

describe("Rule engine", () => {
  test("returns HOLD when indicators not ready", () => {
    const snap = makeSnapshot({ isReady: false });
    const signal = evaluateRules(snap, config);
    expect(signal.action).toBe("HOLD");
  });

  test("returns BUY on strong bullish setup", () => {
    const snap = makeSnapshot({
      ema9: 80200, // EMA9 > EMA21 (crossed up)
      ema21: 80000,
      rsi: 52,     // In ideal range
      obImbalance: 0.3, // Strong buy pressure
      macdHistogram: 5, // Positive
      bbPct: 0.45, // Middle of bands
    });
    const signal = evaluateRules(snap, config);
    expect(signal.action).toBe("BUY");
    expect(signal.strength).toBeGreaterThan(0.6);
  });

  test("returns HOLD when EMA9 barely above EMA21 but other signals mixed", () => {
    const snap = makeSnapshot({
      ema9: 80001, // Barely above
      ema21: 80000,
      rsi: 75,     // Overbought
      obImbalance: -0.1, // Slight sell pressure
      macdHistogram: -1, // Negative
    });
    const signal = evaluateRules(snap, config);
    // Mixed signals should result in HOLD (bull 3, bear 3)
    expect(signal.action).toBe("HOLD");
  });

  test("returns SELL on strong bearish setup", () => {
    const snap = makeSnapshot({
      ema9: 79800, // EMA9 < EMA21
      ema21: 80000,
      rsi: 72,     // Overbought
      obImbalance: -0.3, // Strong sell pressure
      macdHistogram: -5,
      bbPct: 0.92, // Near upper band
    });
    const signal = evaluateRules(snap, config);
    expect(signal.action).toBe("SELL");
  });

  test("includes reasons in output", () => {
    const snap = makeSnapshot();
    const signal = evaluateRules(snap, config);
    expect(signal.reasons.length).toBeGreaterThan(0);
  });
});
