import { describe, test, expect } from "bun:test";
import { computeMomentum } from "../src/indicators/momentum.ts";
import { computeTrend } from "../src/indicators/trend.ts";
import { computeVolume } from "../src/indicators/volume.ts";
import { config } from "../config/config.ts";

// Generate synthetic price series with known properties
function sineWave(n: number, amplitude = 100, period = 20, base = 50000): number[] {
  return Array.from({ length: n }, (_, i) => base + amplitude * Math.sin((2 * Math.PI * i) / period));
}

function uptrend(n: number, start = 50000, step = 10): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

describe("Momentum indicators", () => {
  test("RSI is null when insufficient data", () => {
    const closes = uptrend(5);
    const result = computeMomentum(closes, closes, closes, closes.map(() => 1), config);
    expect(result.rsi).toBeNull();
  });

  test("RSI is in [0, 100] range for valid data", () => {
    const closes = sineWave(60);
    const result = computeMomentum(closes, closes, closes, closes.map(() => 1), config);
    expect(result.rsi).not.toBeNull();
    expect(result.rsi!).toBeGreaterThanOrEqual(0);
    expect(result.rsi!).toBeLessThanOrEqual(100);
  });

  test("RSI approaches 100 for strong uptrend", () => {
    const closes = uptrend(60);
    const result = computeMomentum(closes, closes, closes, closes.map(() => 1), config);
    expect(result.rsi).not.toBeNull();
    expect(result.rsi!).toBeGreaterThan(70);
  });

  test("MACD histogram is non-null for sufficient data", () => {
    // MACD needs fastPeriod + signalPeriod candles minimum (12 + 9 = 21 after slow)
    const closes = sineWave(60, 500, 15, 50000);
    const result = computeMomentum(closes, closes, closes, closes.map(() => 1), config);
    expect(result.macdHistogram).not.toBeNull();
    // Histogram is non-zero for an oscillating price series
    expect(typeof result.macdHistogram).toBe("number");
  });
});

describe("Trend indicators", () => {
  test("EMA9 is null when fewer than 9 candles", () => {
    const closes = uptrend(8);
    const result = computeTrend(closes, closes.map(() => 1), closes.map((_, i) => i), config);
    expect(result.ema9).toBeNull();
  });

  test("EMA9 < EMA21 in downtrend (short-term follows price faster)", () => {
    // Create downtrend: start high, go low
    const closes = uptrend(60, 60000, -10);
    const result = computeTrend(closes, closes.map(() => 1), closes.map((_, i) => i), config);
    expect(result.ema9).not.toBeNull();
    expect(result.ema21).not.toBeNull();
    expect(result.ema9!).toBeLessThan(result.ema21!);
  });

  test("EMA9 > EMA21 in uptrend", () => {
    const closes = uptrend(60);
    const result = computeTrend(closes, closes.map(() => 1), closes.map((_, i) => i), config);
    expect(result.ema9).not.toBeNull();
    expect(result.ema21).not.toBeNull();
    expect(result.ema9!).toBeGreaterThan(result.ema21!);
  });

  test("Bollinger bands: price is within bands for normal volatility", () => {
    const closes = sineWave(60, 50, 10, 50000);
    const result = computeTrend(closes, closes.map(() => 1), closes.map((_, i) => i), config);
    expect(result.bbLower).not.toBeNull();
    expect(result.bbUpper).not.toBeNull();
    expect(result.bbPct).not.toBeNull();
    expect(result.bbPct!).toBeGreaterThanOrEqual(0);
    expect(result.bbPct!).toBeLessThanOrEqual(1);
  });
});

describe("Volume indicators", () => {
  test("OBV increases in uptrend with positive volume", () => {
    const closes = uptrend(30);
    const volumes = closes.map(() => 1);
    const r1 = computeVolume(closes.slice(0, 20), volumes.slice(0, 20), null);
    const r2 = computeVolume(closes, volumes, null);
    expect(r1.obv).not.toBeNull();
    expect(r2.obv).not.toBeNull();
    expect(r2.obv!).toBeGreaterThan(r1.obv!);
  });

  test("VWAP deviation is 0 when price equals VWAP", () => {
    const closes = [50000, 50000, 50000, 50000, 50000];
    const volumes = [1, 1, 1, 1, 1];
    const result = computeVolume(closes, volumes, 50000);
    expect(result.vwapDeviation).toBeCloseTo(0, 5);
  });
});
