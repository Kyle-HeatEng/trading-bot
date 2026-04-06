import { describe, test, expect, beforeEach } from "bun:test";
import { RiskManager } from "../src/risk/riskManager.ts";
import { CircuitBreaker } from "../src/risk/circuitBreaker.ts";
import { config } from "../config/config.ts";

function makeRiskManager(): { rm: RiskManager; cb: CircuitBreaker } {
  const cb = new CircuitBreaker(config.risk.circuitBreakerLosses, config.risk.circuitBreakerPauseMin);
  const rm = new RiskManager(config, cb);
  rm.setStartingEquity(1000);
  return { rm, cb };
}

describe("RiskManager.checkPreTrade", () => {
  test("allows normal trade", () => {
    const { rm } = makeRiskManager();
    const result = rm.checkPreTrade(1000, 0, 0.0001, 80000);
    expect(result.allowed).toBe(true);
  });

  test("blocks trade below minimum BTC size", () => {
    const { rm } = makeRiskManager();
    const result = rm.checkPreTrade(1000, 0, 0.00009, 80000);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toContain("minimum");
  });

  test("blocks trade exceeding maximum BTC size", () => {
    const { rm } = makeRiskManager();
    const result = rm.checkPreTrade(1000, 0, 0.02, 80000);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toContain("maximum");
  });

  test("blocks when notional exceeds equity", () => {
    const { rm } = makeRiskManager();
    // 0.002 BTC at $80K = $160, but equity is only $100
    const result = rm.checkPreTrade(100, 0, 0.002, 80000);
    expect(result.allowed).toBe(false);
  });

  test("blocks when existing open notional plus new order exceeds equity", () => {
    const cb = new CircuitBreaker(config.risk.circuitBreakerLosses, config.risk.circuitBreakerPauseMin);
    const rm = new RiskManager(config, cb);
    rm.setStartingEquity(100);
    // Already $95 open, adding $10 at $100k/BTC with 0.0001 BTC = $10 → total $105 > $100
    const result = rm.checkPreTrade(100, 0, 0.0001, 100_000, 95);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toContain("Total open notional");
  });

  test("checkOpenExposureCap allows within limit", () => {
    const { rm } = makeRiskManager();
    const result = rm.checkOpenExposureCap(1000, 20, 9);
    expect(result.allowed).toBe(true);
  });

  test("checkOpenExposureCap blocks over limit", () => {
    const { rm } = makeRiskManager();
    // Cap = equity * maxOpenExposurePct (e.g. 1000 * 3.3% = 33)
    const result = rm.checkOpenExposureCap(1000, 31, 3);
    expect(result.allowed).toBe(false);
  });

  test("blocks when circuit breaker is tripped", () => {
    const { rm, cb } = makeRiskManager();
    // Trip the circuit breaker
    for (let i = 0; i < config.risk.circuitBreakerLosses; i++) {
      cb.recordResult(false);
    }
    const result = rm.checkPreTrade(1000, 0, 0.0001, 80000);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toContain("Circuit breaker");
  });
});

describe("CircuitBreaker", () => {
  test("is open initially", () => {
    const cb = new CircuitBreaker(3, 30);
    expect(cb.isOpen).toBe(true);
    expect(cb.isTripped).toBe(false);
  });

  test("trips after N consecutive losses", () => {
    const cb = new CircuitBreaker(3, 30);
    cb.recordResult(false);
    cb.recordResult(false);
    expect(cb.isTripped).toBe(false);
    cb.recordResult(false);
    expect(cb.isTripped).toBe(true);
  });

  test("resets consecutive count on win", () => {
    const cb = new CircuitBreaker(3, 30);
    cb.recordResult(false);
    cb.recordResult(false);
    cb.recordResult(true); // win resets count
    cb.recordResult(false);
    cb.recordResult(false);
    expect(cb.isTripped).toBe(false); // only 2 consecutive now
  });

  test("stays open after a win", () => {
    const cb = new CircuitBreaker(3, 30);
    cb.recordResult(false);
    cb.recordResult(true);
    cb.recordResult(false);
    expect(cb.isOpen).toBe(true);
  });
});
