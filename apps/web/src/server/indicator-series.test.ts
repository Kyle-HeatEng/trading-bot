import { describe, expect, it } from 'vitest'
import {
  BollingerBands,
  EMA,
  MACD,
  MFI,
  OBV,
  RSI,
  Stochastic,
} from 'technicalindicators'
import type { DashboardCandle } from '#/lib/dashboard'
import { buildIndicatorSeries } from '#/server/indicator-series'

const testConfig = {
  emaFast: 9,
  emaSlow: 21,
  rsiPeriod: 14,
  bollingerPeriod: 20,
  bollingerStdDev: 2,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  stochasticK: 14,
  stochasticD: 3,
  mfiPeriod: 14,
}

function buildCandles(count: number): DashboardCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const base = 66_000 + index * 8 + Math.sin(index / 4) * 30
    return {
      time: 1_700_000_000_000 + index * 60_000,
      open: base - 4,
      high: base + 11,
      low: base - 13,
      close: base + Math.cos(index / 5) * 5,
      volume: 1.2 + index * 0.07,
    }
  })
}

describe('buildIndicatorSeries', () => {
  it('aligns warmup periods and matches the latest technical values', () => {
    const candles = buildCandles(80)
    const series = buildIndicatorSeries(candles, testConfig)
    const closes = candles.map((candle) => candle.close)
    const highs = candles.map((candle) => candle.high)
    const lows = candles.map((candle) => candle.low)
    const volumes = candles.map((candle) => candle.volume)

    expect(series.ema9).toHaveLength(candles.length)
    expect(series.ema21).toHaveLength(candles.length)
    expect(series.bbUpper).toHaveLength(candles.length)
    expect(series.rsi).toHaveLength(candles.length)
    expect(series.macdLine).toHaveLength(candles.length)
    expect(series.macdSignal).toHaveLength(candles.length)
    expect(series.macdHistogram).toHaveLength(candles.length)
    expect(series.stochasticK).toHaveLength(candles.length)
    expect(series.mfi).toHaveLength(candles.length)
    expect(series.obv).toHaveLength(candles.length)

    expect(series.ema9[7]?.value).toBeNull()
    expect(series.ema9[8]?.value).not.toBeNull()
    expect(series.ema21[19]?.value).toBeNull()
    expect(series.ema21[20]?.value).not.toBeNull()
    expect(series.rsi[13]?.value).toBeNull()
    expect(series.rsi[14]?.value).not.toBeNull()
    expect(series.bbUpper[18]?.value).toBeNull()
    expect(series.bbUpper[19]?.value).not.toBeNull()

    const expectedEma9 = EMA.calculate({ values: closes, period: testConfig.emaFast }).at(-1)
    const expectedEma21 = EMA.calculate({ values: closes, period: testConfig.emaSlow }).at(-1)
    const expectedRsi = RSI.calculate({ values: closes, period: testConfig.rsiPeriod }).at(-1)
    const expectedBb = BollingerBands.calculate({
      values: closes,
      period: testConfig.bollingerPeriod,
      stdDev: testConfig.bollingerStdDev,
    }).at(-1)
    const expectedMacd = MACD.calculate({
      values: closes,
      fastPeriod: testConfig.macdFast,
      slowPeriod: testConfig.macdSlow,
      signalPeriod: testConfig.macdSignal,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    }).at(-1)
    const expectedStochastic = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: testConfig.stochasticK,
      signalPeriod: testConfig.stochasticD,
    }).at(-1)
    const expectedMfi = MFI.calculate({
      high: highs,
      low: lows,
      close: closes,
      volume: volumes,
      period: testConfig.mfiPeriod,
    }).at(-1)
    const expectedObv = OBV.calculate({ close: closes, volume: volumes }).at(-1)

    expect(series.ema9.at(-1)?.value).toBeCloseTo(expectedEma9 ?? 0, 8)
    expect(series.ema21.at(-1)?.value).toBeCloseTo(expectedEma21 ?? 0, 8)
    expect(series.rsi.at(-1)?.value).toBeCloseTo(expectedRsi ?? 0, 8)
    expect(series.bbUpper.at(-1)?.value).toBeCloseTo(expectedBb?.upper ?? 0, 8)
    expect(series.bbMiddle.at(-1)?.value).toBeCloseTo(expectedBb?.middle ?? 0, 8)
    expect(series.bbLower.at(-1)?.value).toBeCloseTo(expectedBb?.lower ?? 0, 8)
    expect(series.macdLine.at(-1)?.value).toBeCloseTo(expectedMacd?.MACD ?? 0, 8)
    expect(series.macdSignal.at(-1)?.value).toBeCloseTo(expectedMacd?.signal ?? 0, 8)
    expect(series.macdHistogram.at(-1)?.value).toBeCloseTo(expectedMacd?.histogram ?? 0, 8)
    expect(series.stochasticK.at(-1)?.value).toBeCloseTo(expectedStochastic?.k ?? 0, 8)
    expect(series.mfi.at(-1)?.value).toBeCloseTo(expectedMfi ?? 0, 8)
    expect(series.obv.at(-1)?.value).toBeCloseTo(expectedObv ?? 0, 8)
    expect(series.ema9.at(-1)?.time).toBe(candles.at(-1)?.time)
    expect(series.macdHistogram.at(-1)?.time).toBe(candles.at(-1)?.time)
  })
})
