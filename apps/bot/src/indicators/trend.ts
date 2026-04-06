import { EMA, BollingerBands, VWAP } from "technicalindicators";
import type { Config } from "../../config/config.ts";

export interface TrendValues {
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbPct: number | null;
  vwap: number | null;
}

export function computeTrend(
  closes: number[],
  volumes: number[],
  openTimes: number[],
  config: Config,
): TrendValues {
  const n = closes.length;
  if (n < 2) {
    return { ema9: null, ema21: null, ema50: null, bbUpper: null, bbMiddle: null, bbLower: null, bbPct: null, vwap: null };
  }

  const ema9 = n >= config.strategy.emaFast
    ? (EMA.calculate({ values: closes, period: config.strategy.emaFast }).at(-1) ?? null)
    : null;

  const ema21 = n >= config.strategy.emaSlow
    ? (EMA.calculate({ values: closes, period: config.strategy.emaSlow }).at(-1) ?? null)
    : null;

  const ema50 = n >= config.strategy.emaTrend
    ? (EMA.calculate({ values: closes, period: config.strategy.emaTrend }).at(-1) ?? null)
    : null;

  // Bollinger Bands
  let bbUpper: number | null = null;
  let bbMiddle: number | null = null;
  let bbLower: number | null = null;
  let bbPct: number | null = null;

  if (n >= config.indicators.bollingerPeriod) {
    const bbResult = BollingerBands.calculate({
      values: closes,
      period: config.indicators.bollingerPeriod,
      stdDev: config.indicators.bollingerStdDev,
    });
    const last = bbResult.at(-1);
    if (last) {
      bbUpper = last.upper;
      bbMiddle = last.middle;
      bbLower = last.lower;
      const lastClose = closes.at(-1) ?? 0;
      const range = last.upper - last.lower;
      bbPct = range > 0 ? (lastClose - last.lower) / range : null;
    }
  }

  // VWAP (uses high, low, close, volume — approximated from closes + volumes here)
  // technicalindicators VWAP needs high/low/close/volume — we'll use close as proxy for high/low
  let vwap: number | null = null;
  if (n >= 2 && volumes.length === n) {
    // Use last 60 candles for intraday VWAP (reset daily in production via resetVwapDaily)
    const lookback = Math.min(n, 60);
    const closesSlice = closes.slice(-lookback);
    const volumesSlice = volumes.slice(-lookback);

    // Simple VWAP calculation: sum(close * volume) / sum(volume)
    let sumCV = 0;
    let sumV = 0;
    for (let i = 0; i < closesSlice.length; i++) {
      const c = closesSlice[i] ?? 0;
      const v = volumesSlice[i] ?? 0;
      sumCV += c * v;
      sumV += v;
    }
    vwap = sumV > 0 ? sumCV / sumV : null;
  }

  return { ema9, ema21, ema50, bbUpper, bbMiddle, bbLower, bbPct, vwap };
}
