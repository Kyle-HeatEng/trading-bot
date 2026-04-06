import type { Config } from "../../config/config.ts";

/**
 * Fixed-fractional position sizing.
 * Sizes a trade as a fixed percentage of current equity.
 *
 * At < $1,000 capital with 1.5% fractional:
 *   $800 * 0.015 = $12 → 0.00015 BTC at $80K/BTC
 * Enforces Kraken's minimum order size of 0.0001 BTC.
 */
export function computePositionSize(
  equityUsd: number,
  currentPrice: number,
  config: Config,
): number {
  const notional = equityUsd * config.sizing.fixedFractional;
  const sizeBtc = notional / currentPrice;

  // Enforce min/max bounds
  const clamped = Math.max(config.sizing.minBtc, Math.min(config.sizing.maxBtc, sizeBtc));

  // Round to 8 decimal places (Bitcoin precision)
  return Math.round(clamped * 1e8) / 1e8;
}

/** Returns the notional USD value of a position */
export function notionalUsd(sizeBtc: number, price: number): number {
  return sizeBtc * price;
}

/**
 * Size for the next long leg: usual fixed-fractional slice, but not above remaining room
 * under maxOpenExposurePct (concurrent cap). Returns 0 if room cannot fit min order size.
 */
export function computeNextLegSizeBtc(
  equityUsd: number,
  markPrice: number,
  config: Config,
  openExposureUsd: number,
  maxOpenExposurePct: number,
): number {
  const capUsd = equityUsd * maxOpenExposurePct;
  const roomUsd = Math.max(0, capUsd - openExposureUsd);
  const minNotional = config.sizing.minBtc * markPrice;
  if (roomUsd + 1e-8 < minNotional) {
    return 0;
  }

  const targetUsd = equityUsd * config.sizing.fixedFractional;
  const legUsd = Math.min(targetUsd, roomUsd);
  let sizeBtc = legUsd / markPrice;
  sizeBtc = Math.max(config.sizing.minBtc, Math.min(config.sizing.maxBtc, sizeBtc));

  let notional = sizeBtc * markPrice;
  if (notional > roomUsd + 1e-6) {
    sizeBtc = Math.floor((roomUsd / markPrice) * 1e8) / 1e8;
    if (sizeBtc < config.sizing.minBtc) {
      return 0;
    }
    notional = sizeBtc * markPrice;
    if (notional > roomUsd + 1e-6) {
      return 0;
    }
  }

  return Math.round(sizeBtc * 1e8) / 1e8;
}
