import fs from 'node:fs'
import { BOT_CONFIG_YAML } from '#/server/repo-paths'
import { parse as parseYaml } from 'yaml'
import {
  BollingerBands,
  EMA,
  MACD,
  MFI,
  OBV,
  RSI,
  Stochastic,
} from 'technicalindicators'
import type {
  DashboardCandle,
  DashboardIndicatorPoint,
  DashboardIndicatorSeries,
} from '#/lib/dashboard'

interface IndicatorConfig {
  emaFast: number
  emaSlow: number
  rsiPeriod: number
  bollingerPeriod: number
  bollingerStdDev: number
  macdFast: number
  macdSlow: number
  macdSignal: number
  stochasticK: number
  stochasticD: number
  mfiPeriod: number
}

let cachedIndicatorConfig: IndicatorConfig | null = null

export function buildIndicatorSeries(
  candles: DashboardCandle[],
  config = readIndicatorConfig(),
): DashboardIndicatorSeries {
  const times = candles.map((candle) => candle.time)
  const closes = candles.map((candle) => candle.close)
  const highs = candles.map((candle) => candle.high)
  const lows = candles.map((candle) => candle.low)
  const volumes = candles.map((candle) => candle.volume)

  const ema9 = alignNumericSeries(
    times,
    EMA.calculate({ values: closes, period: config.emaFast }),
  )
  const ema21 = alignNumericSeries(
    times,
    EMA.calculate({ values: closes, period: config.emaSlow }),
  )

  const bollinger = alignMappedSeries(
    times,
    BollingerBands.calculate({
      values: closes,
      period: config.bollingerPeriod,
      stdDev: config.bollingerStdDev,
    }),
  )

  const rsi = alignNumericSeries(
    times,
    RSI.calculate({ values: closes, period: config.rsiPeriod }),
  )

  const macd = alignMappedSeries(
    times,
    MACD.calculate({
      values: closes,
      fastPeriod: config.macdFast,
      slowPeriod: config.macdSlow,
      signalPeriod: config.macdSignal,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    }),
  )

  const stochastic = alignMappedSeries(
    times,
    Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: config.stochasticK,
      signalPeriod: config.stochasticD,
    }),
  )

  const mfi = alignNumericSeries(
    times,
    MFI.calculate({
      high: highs,
      low: lows,
      close: closes,
      volume: volumes,
      period: config.mfiPeriod,
    }),
  )

  const obv = alignNumericSeries(
    times,
    OBV.calculate({ close: closes, volume: volumes }),
  )

  return {
    ema9,
    ema21,
    bbUpper: extractSeries(times, bollinger, (point) => point?.upper ?? null),
    bbMiddle: extractSeries(times, bollinger, (point) => point?.middle ?? null),
    bbLower: extractSeries(times, bollinger, (point) => point?.lower ?? null),
    rsi,
    macdLine: extractSeries(times, macd, (point) => (point as { MACD?: number })?.MACD ?? null),
    macdSignal: extractSeries(times, macd, (point) => (point as { signal?: number })?.signal ?? null),
    macdHistogram: extractSeries(times, macd, (point) => point?.histogram ?? null),
    stochasticK: extractSeries(times, stochastic, (point) => point?.k ?? null),
    mfi,
    obv,
  }
}

export function readIndicatorConfig(): IndicatorConfig {
  if (cachedIndicatorConfig) {
    return cachedIndicatorConfig
  }

  const configPath = BOT_CONFIG_YAML
  const raw = fs.readFileSync(configPath, 'utf-8')
  const parsed = parseYaml(raw) as {
    strategy?: {
      emaFast?: number
      emaSlow?: number
      rsiPeriod?: number
    }
    indicators?: {
      bollingerPeriod?: number
      bollingerStdDev?: number
      macdFast?: number
      macdSlow?: number
      macdSignal?: number
      stochasticK?: number
      stochasticD?: number
      mfiPeriod?: number
    }
  }

  cachedIndicatorConfig = {
    emaFast: parsed.strategy?.emaFast ?? 9,
    emaSlow: parsed.strategy?.emaSlow ?? 21,
    rsiPeriod: parsed.strategy?.rsiPeriod ?? 14,
    bollingerPeriod: parsed.indicators?.bollingerPeriod ?? 20,
    bollingerStdDev: parsed.indicators?.bollingerStdDev ?? 2,
    macdFast: parsed.indicators?.macdFast ?? 12,
    macdSlow: parsed.indicators?.macdSlow ?? 26,
    macdSignal: parsed.indicators?.macdSignal ?? 9,
    stochasticK: parsed.indicators?.stochasticK ?? 14,
    stochasticD: parsed.indicators?.stochasticD ?? 3,
    mfiPeriod: parsed.indicators?.mfiPeriod ?? 14,
  }

  return cachedIndicatorConfig
}

function alignNumericSeries(
  times: number[],
  values: number[],
): DashboardIndicatorPoint[] {
  const startIndex = Math.max(0, times.length - values.length)
  return times.map((time, index) => ({
    time,
    value: index < startIndex ? null : values[index - startIndex] ?? null,
  }))
}

function alignMappedSeries<T>(
  times: number[],
  values: T[],
): (T | null)[] {
  const startIndex = Math.max(0, times.length - values.length)
  return times.map((_, index) => (index < startIndex ? null : values[index - startIndex] ?? null))
}

function extractSeries<T>(
  times: number[],
  values: (T | null)[],
  getValue: (value: T | null) => number | null,
): DashboardIndicatorPoint[] {
  return values.map((value, index) => ({
    time: times[index] ?? 0,
    value: getValue(value),
  }))
}
