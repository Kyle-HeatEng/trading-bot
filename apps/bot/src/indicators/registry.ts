import type { Candle } from "../exchange/types.ts";
import type { Config } from "../../config/config.ts";
import { computeMomentum } from "./momentum.ts";
import { computeTrend } from "./trend.ts";
import { computeVolume } from "./volume.ts";
import type { OrderBook } from "../data/orderbook.ts";
import { indicatorLogger } from "../utils/logger.ts";

export interface IndicatorValues {
  // Momentum
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  stochasticK: number | null;
  stochasticD: number | null;
  mfi: number | null;

  // Trend
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbPct: number | null; // %B: position within the bands
  vwap: number | null;

  // Volume
  obv: number | null;
  volumeDelta: number | null; // buy vol - sell vol for the period
  vwapDeviation: number | null; // % deviation from VWAP

  // Microstructure (from orderbook)
  obImbalance: number | null;
  spreadBps: number | null;
  weightedMid: number | null;

  // Meta
  isReady: boolean; // all core indicators have warmed up
  candleCount: number;
}

/**
 * Maintains a rolling window of candles and computes all indicators
 * on each new candle close.
 */
export class IndicatorRegistry {
  private closes: number[] = [];
  private highs: number[] = [];
  private lows: number[] = [];
  private volumes: number[] = [];
  private openTimes: number[] = [];
  private candleCount = 0;
  private _lastValues: IndicatorValues | null = null;

  private readonly warmup: number;

  constructor(
    private readonly config: Config,
    private readonly orderBook: OrderBook,
  ) {
    this.warmup = config.indicators.warmupCandles;
  }

  /** Feed a new finalized candle and return computed indicators */
  update(candle: Candle): IndicatorValues {
    this.closes.push(candle.close);
    this.highs.push(candle.high);
    this.lows.push(candle.low);
    this.volumes.push(candle.volume);
    this.openTimes.push(candle.openTime);
    this.candleCount++;

    // Keep only as many candles as needed (200 is enough for all indicators)
    const maxHistory = 200;
    if (this.closes.length > maxHistory) {
      this.closes = this.closes.slice(-maxHistory);
      this.highs = this.highs.slice(-maxHistory);
      this.lows = this.lows.slice(-maxHistory);
      this.volumes = this.volumes.slice(-maxHistory);
      this.openTimes = this.openTimes.slice(-maxHistory);
    }

    const isReady = this.candleCount >= this.warmup;

    const momentum = computeMomentum(this.closes, this.highs, this.lows, this.volumes, this.config);
    const trend = computeTrend(this.closes, this.volumes, this.openTimes, this.config);
    const volume = computeVolume(this.closes, this.volumes, trend.vwap);
    const ob = this.orderBook.snapshot(10);

    const values: IndicatorValues = {
      ...momentum,
      ...trend,
      ...volume,
      obImbalance: ob.imbalance,
      spreadBps: ob.spreadBps,
      weightedMid: ob.weightedMid,
      isReady,
      candleCount: this.candleCount,
    };

    this._lastValues = values;

    if (isReady) {
      indicatorLogger.trace(
        { ema9: values.ema9?.toFixed(2), rsi: values.rsi?.toFixed(1), obImbalance: values.obImbalance?.toFixed(3) },
        "Indicators updated",
      );
    }

    return values;
  }

  hydrate(candles: Candle[]): IndicatorValues | null {
    let lastValues: IndicatorValues | null = null;
    for (const candle of candles) {
      lastValues = this.update(candle);
    }

    return lastValues;
  }

  get count(): number {
    return this.candleCount;
  }

  /** Last computed indicator values — used by Claude tools */
  get lastValues(): IndicatorValues | null {
    return this._lastValues;
  }
}
