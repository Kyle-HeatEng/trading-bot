import { Kraken } from "node-kraken-api";
import { KrakenRateLimiter } from "./rateLimiter.ts";
import { exchangeLogger } from "../utils/logger.ts";
import type { Candle } from "./types.ts";

// Kraken uses XBT internally, not BTC
export const KRAKEN_PAIR_REST = "XBTUSD";
export const KRAKEN_PAIR_WS = "XBT/USD";

export interface KrakenBalance {
  usd: number;
  btc: number;
  totalEquityUsd: number; // USD + BTC * price
}

export class KrakenClient {
  private readonly kraken: Kraken;
  private readonly limiter: KrakenRateLimiter;

  constructor() {
    const key = process.env["KRAKEN_API_KEY"] ?? "";
    const secret = process.env["KRAKEN_API_SECRET"] ?? "";
    this.kraken = new Kraken({ key, secret });
    this.limiter = new KrakenRateLimiter();
  }

  async getBalance(): Promise<KrakenBalance> {
    await this.limiter.waitForCapacity(1);
    const result = await this.kraken.balance();
    const usd = parseFloat(result["ZUSD"] ?? "0");
    const btc = parseFloat(result["XXBT"] ?? "0");

    let btcPrice = 0;
    try {
      btcPrice = await this.getTicker();
    } catch {
      // Non-fatal — BTC price component will be 0
    }

    return { usd, btc, totalEquityUsd: usd + btc * btcPrice };
  }

  async getTicker(): Promise<number> {
    await this.limiter.waitForCapacity(1);
    const result = await this.kraken.ticker({ pair: KRAKEN_PAIR_REST });
    const pairData = result["XXBTZUSD"] ?? result[KRAKEN_PAIR_REST];
    if (!pairData?.c?.[0]) throw new Error("Could not parse ticker");
    return parseFloat(pairData.c[0]);
  }

  async getRecentCandles(pair: string, timeframeSec: number, limit = 200): Promise<Candle[]> {
    const intervalMinutes = toKrakenIntervalMinutes(timeframeSec);
    const url = new URL("https://api.kraken.com/0/public/OHLC");
    url.searchParams.set("pair", pair);
    url.searchParams.set("interval", String(intervalMinutes));

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      throw new Error(`Kraken OHLC HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      error?: string[];
      result?: Record<string, unknown>;
    };

    if (payload.error?.length) {
      throw new Error(payload.error.join(", "));
    }

    const result = payload.result ?? {};
    const seriesKey = Object.keys(result).find((key) => key !== "last");
    const rows = seriesKey ? (result[seriesKey] as unknown[] | undefined) : undefined;
    if (!rows || !Array.isArray(rows)) {
      throw new Error("Kraken OHLC payload missing candle rows");
    }

    const frameMs = timeframeSec * 1000;
    const currentFrameOpen = Math.floor(Date.now() / frameMs) * frameMs;

    return rows
      .map((row) => parseOhlcRow(row, timeframeSec))
      .filter((candle): candle is Candle => candle !== null && candle.openTime < currentFrameOpen)
      .slice(-limit);
  }

  /** Place a limit order. Returns the transaction ID. */
  async placeLimitOrder(side: "buy" | "sell", sizeBtc: number, price: number): Promise<string> {
    await this.limiter.waitForCapacity(1);
    exchangeLogger.info({ side, sizeBtc, price }, "Placing limit order");

    const result = await this.kraken.addOrder({
      pair: KRAKEN_PAIR_REST,
      type: side,
      ordertype: "limit",
      price: price.toFixed(1),
      volume: sizeBtc.toFixed(8),
    });

    const txid = result.txid?.[0];
    if (!txid) throw new Error("No txid returned from order placement");
    exchangeLogger.info({ txid }, "Limit order placed");
    return txid;
  }

  /** Place a market order. Returns the transaction ID. */
  async placeMarketOrder(side: "buy" | "sell", sizeBtc: number): Promise<string> {
    await this.limiter.waitForCapacity(1);
    exchangeLogger.info({ side, sizeBtc }, "Placing market order");

    const result = await this.kraken.addOrder({
      pair: KRAKEN_PAIR_REST,
      type: side,
      ordertype: "market",
      volume: sizeBtc.toFixed(8),
    });

    const txid = result.txid?.[0];
    if (!txid) throw new Error("No txid returned");
    return txid;
  }

  /** Place a stop-loss sell (close long / protect spot long). */
  async placeStopLoss(sizeBtc: number, stopPrice: number): Promise<string> {
    return this.placeConditionalOrder({
      side: "sell",
      ordertype: "stop-loss",
      sizeBtc,
      triggerPrice: stopPrice,
    });
  }

  /** Take-profit sell when price reaches trigger (close long). */
  async placeTakeProfitSell(sizeBtc: number, triggerPrice: number): Promise<string> {
    return this.placeConditionalOrder({
      side: "sell",
      ordertype: "take-profit",
      sizeBtc,
      triggerPrice,
    });
  }

  /** Stop-loss buy when price reaches trigger (close short / margin). */
  async placeStopLossBuy(sizeBtc: number, triggerPrice: number): Promise<string> {
    return this.placeConditionalOrder({
      side: "buy",
      ordertype: "stop-loss",
      sizeBtc,
      triggerPrice,
    });
  }

  /** Take-profit buy when price reaches trigger (close short). */
  async placeTakeProfitBuy(sizeBtc: number, triggerPrice: number): Promise<string> {
    return this.placeConditionalOrder({
      side: "buy",
      ordertype: "take-profit",
      sizeBtc,
      triggerPrice,
    });
  }

  private async placeConditionalOrder(opts: {
    side: "buy" | "sell";
    ordertype: "stop-loss" | "take-profit";
    sizeBtc: number;
    triggerPrice: number;
  }): Promise<string> {
    await this.limiter.waitForCapacity(1);
    const oflags = process.env["KRAKEN_BRACKET_OFLAGS"] ?? "";
    const payload: {
      pair: string;
      type: string;
      ordertype: string;
      price: string;
      volume: string;
      oflags?: string;
    } = {
      pair: KRAKEN_PAIR_REST,
      type: opts.side,
      ordertype: opts.ordertype,
      price: opts.triggerPrice.toFixed(1),
      volume: opts.sizeBtc.toFixed(8),
    };
    if (oflags) {
      payload.oflags = oflags;
    }
    exchangeLogger.info(
      { side: opts.side, ordertype: opts.ordertype, volume: opts.sizeBtc, price: opts.triggerPrice },
      "Placing conditional bracket order",
    );
    const result = await this.kraken.addOrder(payload);
    const txid = result.txid?.[0];
    if (!txid) throw new Error("No txid returned from conditional order");
    exchangeLogger.info({ txid, ordertype: opts.ordertype }, "Conditional order placed");
    return txid;
  }

  /** Long position: TP (sell) + SL (sell). */
  async placeLongBrackets(sizeBtc: number, takeProfitPrice: number, stopLossPrice: number): Promise<{ tpTxid: string; slTxid: string }> {
    const tpTxid = await this.placeTakeProfitSell(sizeBtc, takeProfitPrice);
    const slTxid = await this.placeStopLoss(sizeBtc, stopLossPrice);
    return { tpTxid, slTxid };
  }

  /** Short position: TP (buy) + SL (buy). */
  async placeShortBrackets(sizeBtc: number, takeProfitPrice: number, stopLossPrice: number): Promise<{ tpTxid: string; slTxid: string }> {
    const tpTxid = await this.placeTakeProfitBuy(sizeBtc, takeProfitPrice);
    const slTxid = await this.placeStopLossBuy(sizeBtc, stopLossPrice);
    return { tpTxid, slTxid };
  }

  async cancelOrders(txids: string[]): Promise<void> {
    for (const txid of txids) {
      if (!txid) continue;
      try {
        await this.cancelOrder(txid);
      } catch (err) {
        exchangeLogger.warn({ err, txid }, "Cancel order failed (may already be filled)");
      }
    }
  }

  async cancelOrder(txid: string): Promise<void> {
    await this.limiter.waitForCapacity(1);
    await this.kraken.cancelOrder({ txid });
    exchangeLogger.info({ txid }, "Order cancelled");
  }

  async getOrderStatus(txid: string): Promise<{
    status: string;
    filledSize: number;
    avgPrice: number;
    fee: number;
  }> {
    await this.limiter.waitForCapacity(1);
    const result = await this.kraken.queryOrders({ txid, trades: true });
    const order = result[txid];
    if (!order) throw new Error(`Order ${txid} not found`);

    return {
      status: order.status ?? "unknown",
      filledSize: parseFloat(order.vol_exec ?? "0"),
      avgPrice: parseFloat(order.price ?? "0"),
      fee: parseFloat(order.fee ?? "0"),
    };
  }
}

function parseOhlcRow(row: unknown, timeframeSec: number): Candle | null {
  if (!Array.isArray(row) || row.length < 7) {
    return null;
  }

  const time = numeric(row[0]);
  const open = numeric(row[1]);
  const high = numeric(row[2]);
  const low = numeric(row[3]);
  const close = numeric(row[4]);
  const volume = numeric(row[6]);

  if (
    time === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null
  ) {
    return null;
  }

  return {
    pair: KRAKEN_PAIR_WS,
    timeframeSec,
    openTime: time * 1000,
    open,
    high,
    low,
    close,
    volume,
  };
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toKrakenIntervalMinutes(timeframeSec: number): number {
  switch (timeframeSec) {
    case 60:
      return 1;
    case 300:
      return 5;
    case 900:
      return 15;
    case 1800:
      return 30;
    case 3600:
      return 60;
    case 14_400:
      return 240;
    case 86_400:
      return 1440;
    case 604_800:
      return 10080;
    default:
      throw new Error(`Unsupported Kraken OHLC timeframe: ${timeframeSec}s`);
  }
}
