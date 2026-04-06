import { OBV } from "technicalindicators";

export interface VolumeValues {
  obv: number | null;
  volumeDelta: number | null;
  vwapDeviation: number | null;
}

export function computeVolume(
  closes: number[],
  volumes: number[],
  vwap: number | null,
): VolumeValues {
  const n = closes.length;
  if (n < 2) return { obv: null, volumeDelta: null, vwapDeviation: null };

  // OBV
  let obv: number | null = null;
  if (volumes.length === n) {
    const obvResult = OBV.calculate({ close: closes, volume: volumes });
    obv = obvResult.at(-1) ?? null;
  }

  // Volume delta: sum of signed volume over last candle
  // (positive = net buying, negative = net selling)
  // Without tick-level data we use price direction as proxy
  let volumeDelta: number | null = null;
  const lookback = Math.min(n, 5);
  if (volumes.length === n) {
    let delta = 0;
    for (let i = n - lookback; i < n; i++) {
      const prevClose = closes[i - 1] ?? 0;
      const currClose = closes[i] ?? 0;
      const vol = volumes[i] ?? 0;
      delta += currClose >= prevClose ? vol : -vol;
    }
    volumeDelta = delta;
  }

  // VWAP deviation: how far current price is from VWAP (%)
  let vwapDeviation: number | null = null;
  const lastClose = closes.at(-1);
  if (vwap !== null && lastClose !== undefined && vwap > 0) {
    vwapDeviation = (lastClose - vwap) / vwap;
  }

  return { obv, volumeDelta, vwapDeviation };
}
