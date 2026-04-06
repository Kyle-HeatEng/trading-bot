import {
  RSI,
  MACD,
  Stochastic,
  MFI,
} from "technicalindicators";
import type { Config } from "../../config/config.ts";

export interface MomentumValues {
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  stochasticK: number | null;
  stochasticD: number | null;
  mfi: number | null;
}

export function computeMomentum(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
  config: Config,
): MomentumValues {
  const n = closes.length;
  if (n < 2) {
    return { rsi: null, macd: null, macdSignal: null, macdHistogram: null, stochasticK: null, stochasticD: null, mfi: null };
  }

  // RSI
  let rsi: number | null = null;
  if (n >= config.strategy.rsiPeriod + 1) {
    const rsiResult = RSI.calculate({ values: closes, period: config.strategy.rsiPeriod });
    rsi = rsiResult.at(-1) ?? null;
  }

  // MACD
  let macd: number | null = null;
  let macdSignal: number | null = null;
  let macdHistogram: number | null = null;
  const macdMinBars = config.indicators.macdSlow + config.indicators.macdSignal;
  if (n >= macdMinBars) {
    const macdResult = MACD.calculate({
      values: closes,
      fastPeriod: config.indicators.macdFast,
      slowPeriod: config.indicators.macdSlow,
      signalPeriod: config.indicators.macdSignal,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const last = macdResult.at(-1);
    if (last) {
      macd = last.MACD ?? null;
      macdSignal = last.signal ?? null;
      macdHistogram = last.histogram ?? null;
    }
  }

  // Stochastic
  let stochasticK: number | null = null;
  let stochasticD: number | null = null;
  const stochMinBars = config.indicators.stochasticK + config.indicators.stochasticD;
  if (n >= stochMinBars && highs.length === n && lows.length === n) {
    const stochResult = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: config.indicators.stochasticK,
      signalPeriod: config.indicators.stochasticD,
    });
    const last = stochResult.at(-1);
    if (last) {
      stochasticK = last.k ?? null;
      stochasticD = last.d ?? null;
    }
  }

  // MFI (Money Flow Index) — requires high, low, close, volume
  let mfi: number | null = null;
  if (n >= config.indicators.mfiPeriod + 1 && volumes.length === n) {
    const mfiResult = MFI.calculate({
      high: highs,
      low: lows,
      close: closes,
      volume: volumes,
      period: config.indicators.mfiPeriod,
    });
    mfi = mfiResult.at(-1) ?? null;
  }

  return { rsi, macd, macdSignal, macdHistogram, stochasticK, stochasticD, mfi };
}
