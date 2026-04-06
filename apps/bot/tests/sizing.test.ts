import { describe, test, expect } from "bun:test";
import { computePositionSize, computeNextLegSizeBtc, notionalUsd } from "../src/strategy/sizing.ts";
import { config } from "../config/config.ts";

describe("computePositionSize", () => {
  test("uses fixed fractional of equity", () => {
    // 1% of $1000 at $80K/BTC = $10 / $80000 = 0.000125 BTC
    const size = computePositionSize(1000, 80000, config);
    const expectedRaw = (1000 * 0.01) / 80000;
    expect(size).toBeCloseTo(expectedRaw, 6);
  });

  test("enforces minimum BTC size", () => {
    // 1.5% of $10 at $80K = $0.15 / $80000 = 0.0000018 BTC — below minimum
    const size = computePositionSize(10, 80000, config);
    expect(size).toBe(config.sizing.minBtc);
  });

  test("enforces maximum BTC size", () => {
    // 1.5% of $1,000,000 at $80K = $15000 / $80000 = 0.1875 BTC — above maximum
    const size = computePositionSize(1_000_000, 80000, config);
    expect(size).toBe(config.sizing.maxBtc);
  });

  test("rounds to 8 decimal places", () => {
    const size = computePositionSize(777, 83456, config);
    const decimals = (size.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(8);
  });
});

describe("notionalUsd", () => {
  test("computes correct notional", () => {
    expect(notionalUsd(0.001, 80000)).toBe(80);
    expect(notionalUsd(0.0001, 50000)).toBe(5);
  });
});

describe("computeNextLegSizeBtc", () => {
  test("returns 0 when no room left under exposure cap", () => {
    const equity = 1000;
    const price = 80_000;
    const openUsd = equity * config.risk.maxOpenExposurePct;
    const size = computeNextLegSizeBtc(equity, price, config, openUsd, config.risk.maxOpenExposurePct);
    expect(size).toBe(0);
  });

  test("sizes second leg to remaining room under cap", () => {
    const equity = 1000;
    const price = 80_000;
    const firstLegUsd = equity * config.sizing.fixedFractional;
    const size = computeNextLegSizeBtc(
      equity,
      price,
      config,
      firstLegUsd,
      config.risk.maxOpenExposurePct,
    );
    expect(size).toBeGreaterThan(0);
    expect(notionalUsd(size, price) + firstLegUsd).toBeLessThanOrEqual(equity * config.risk.maxOpenExposurePct + 1);
  });
});
