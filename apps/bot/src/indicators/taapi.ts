import type { Config } from "../../config/config.ts";
import { indicatorLogger } from "../utils/logger.ts";

const TAAPI_BULK_URL = "https://api.taapi.io/bulk";

interface TaapiBulkEntry {
  id: string;
  result?: Record<string, unknown>;
  errors?: string[];
}

interface TaapiBulkResponse {
  data?: TaapiBulkEntry[];
}

export interface TaapiSnapshot {
  provider: "taapi";
  exchange: string;
  symbol: string;
  interval: string;
  fetchedAt: number;
  isReady: boolean;
  error: string | null;
  price: number | null;
  rsi: number | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbPct: number | null;
  mfi: number | null;
}

export class TaapiClient {
  private readonly secret = process.env["TAAPI_SECRET"]?.trim() ?? "";
  private readonly exchange = process.env["TAAPI_EXCHANGE"]?.trim() || "binance";
  private readonly symbol = process.env["TAAPI_SYMBOL"]?.trim() || "BTC/USDT";
  private readonly interval: string;
  private readonly refreshSec = parsePositiveInt(process.env["TAAPI_REFRESH_SEC"], 60);
  private timer: ReturnType<typeof setInterval> | null = null;
  private cached: TaapiSnapshot | null = null;
  private hasLoggedDisabled = false;

  constructor(private readonly config: Config) {
    this.interval = process.env["TAAPI_INTERVAL"]?.trim() || toTaapiInterval(config.trading.timeframeSec);
  }

  start(): void {
    if (!this.secret) {
      if (!this.hasLoggedDisabled) {
        indicatorLogger.info("TAAPI disabled — set TAAPI_SECRET to enable provider indicators");
        this.hasLoggedDisabled = true;
      }
      return;
    }

    void this.fetchSnapshot();
    this.timer = setInterval(() => void this.fetchSnapshot(), this.refreshSec * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get snapshot(): TaapiSnapshot | null {
    return this.cached;
  }

  private async fetchSnapshot(): Promise<void> {
    const body = {
      secret: this.secret,
      construct: {
        exchange: this.exchange,
        symbol: this.symbol,
        interval: this.interval,
        indicators: [
          { id: "price", indicator: "price", backtrack: 1, gaps: false },
          { id: "rsi", indicator: "rsi", period: this.config.strategy.rsiPeriod, backtrack: 1, gaps: false },
          { id: "ema9", indicator: "ema", period: this.config.strategy.emaFast, backtrack: 1, gaps: false },
          { id: "ema21", indicator: "ema", period: this.config.strategy.emaSlow, backtrack: 1, gaps: false },
          { id: "ema50", indicator: "ema", period: this.config.strategy.emaTrend, backtrack: 1, gaps: false },
          {
            id: "macd",
            indicator: "macd",
            backtrack: 1,
            gaps: false,
            optInFastPeriod: this.config.indicators.macdFast,
            optInSlowPeriod: this.config.indicators.macdSlow,
            optInSignalPeriod: this.config.indicators.macdSignal,
          },
          {
            id: "bbands",
            indicator: "bbands",
            backtrack: 1,
            gaps: false,
            period: this.config.indicators.bollingerPeriod,
            stddev: this.config.indicators.bollingerStdDev,
          },
          { id: "mfi", indicator: "mfi", backtrack: 1, gaps: false, period: this.config.indicators.mfiPeriod },
        ],
      },
    };

    try {
      const response = await fetch(TAAPI_BULK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as TaapiBulkResponse;
      const results = new Map((payload.data ?? []).map((entry) => [entry.id, entry]));
      const fetchedAt = Date.now();

      const snapshot: TaapiSnapshot = {
        provider: "taapi",
        exchange: this.exchange,
        symbol: this.symbol,
        interval: this.interval,
        fetchedAt,
        isReady: true,
        error: null,
        price: numeric(results.get("price")?.result?.["value"]),
        rsi: numeric(results.get("rsi")?.result?.["value"]),
        ema9: numeric(results.get("ema9")?.result?.["value"]),
        ema21: numeric(results.get("ema21")?.result?.["value"]),
        ema50: numeric(results.get("ema50")?.result?.["value"]),
        macd: numeric(results.get("macd")?.result?.["valueMACD"]),
        macdSignal: numeric(results.get("macd")?.result?.["valueMACDSignal"]),
        macdHistogram: numeric(results.get("macd")?.result?.["valueMACDHist"]),
        bbUpper: numeric(results.get("bbands")?.result?.["valueUpperBand"]),
        bbMiddle: numeric(results.get("bbands")?.result?.["valueMiddleBand"]),
        bbLower: numeric(results.get("bbands")?.result?.["valueLowerBand"]),
        bbPct: null,
        mfi: numeric(results.get("mfi")?.result?.["value"]),
      };

      snapshot.bbPct = computeBollingerPct(snapshot.price, snapshot.bbLower, snapshot.bbUpper);

      const errors = Array.from(results.values())
        .flatMap((entry) => entry.errors ?? [])
        .filter(Boolean);

      if (errors.length > 0) {
        snapshot.isReady = false;
        snapshot.error = errors.join("; ");
      }

      this.cached = snapshot;

      indicatorLogger.info(
        {
          provider: snapshot.provider,
          exchange: snapshot.exchange,
          symbol: snapshot.symbol,
          interval: snapshot.interval,
          price: snapshot.price,
          rsi: snapshot.rsi,
          macdHistogram: snapshot.macdHistogram,
        },
        "TAAPI snapshot updated",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.cached = {
        provider: "taapi",
        exchange: this.exchange,
        symbol: this.symbol,
        interval: this.interval,
        fetchedAt: Date.now(),
        isReady: false,
        error: message,
        price: null,
        rsi: null,
        ema9: null,
        ema21: null,
        ema50: null,
        macd: null,
        macdSignal: null,
        macdHistogram: null,
        bbUpper: null,
        bbMiddle: null,
        bbLower: null,
        bbPct: null,
        mfi: null,
      };

      indicatorLogger.warn({ err, exchange: this.exchange, symbol: this.symbol, interval: this.interval }, "TAAPI fetch failed");
    }
  }
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function computeBollingerPct(price: number | null, lower: number | null, upper: number | null): number | null {
  if (price === null || lower === null || upper === null) {
    return null;
  }

  const range = upper - lower;
  if (range <= 0) {
    return null;
  }

  return (price - lower) / range;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toTaapiInterval(timeframeSec: number): string {
  switch (timeframeSec) {
    case 60:
      return "1m";
    case 300:
      return "5m";
    case 900:
      return "15m";
    case 1800:
      return "30m";
    case 3600:
      return "1h";
    case 7200:
      return "2h";
    case 14_400:
      return "4h";
    case 43_200:
      return "12h";
    case 86_400:
      return "1d";
    case 604_800:
      return "1w";
    default:
      indicatorLogger.warn({ timeframeSec }, "Unsupported TAAPI interval mapping — defaulting to 1m");
      return "1m";
  }
}
