import WebSocket from "ws";
import { exchangeLogger } from "../utils/logger.ts";
import type { CandleBuilder } from "../data/candleBuilder.ts";
import type { OrderBook } from "../data/orderbook.ts";
import type { TickBuffer } from "../data/tickBuffer.ts";

const WS_PUBLIC_URL = "wss://ws.kraken.com";
const HEARTBEAT_TIMEOUT_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface KrakenTickerMsg {
  a: [string, number, string]; // [ask_price, whole_lot_vol, lot_vol]
  b: [string, number, string]; // [bid_price, whole_lot_vol, lot_vol]
  c: [string, string]; // [last_trade_price, lot_vol]
  v: [string, string]; // [today_vol, 24h_vol]
}

type PriceCallback = (price: number, source: "ticker" | "trade") => void | Promise<void>;

export class KrakenWs {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private stopped = false;

  private lastTicker: KrakenTickerMsg | null = null;
  private readonly priceSubscribers: PriceCallback[] = [];

  constructor(
    private readonly pair: string, // e.g. "XBT/USD"
    private readonly candleBuilder: CandleBuilder,
    private readonly orderBook: OrderBook,
    private readonly tickBuffer: TickBuffer,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearHeartbeat();
    this.ws?.close();
  }

  get currentTicker(): KrakenTickerMsg | null {
    return this.lastTicker;
  }

  onPrice(cb: PriceCallback): void {
    this.priceSubscribers.push(cb);
  }

  private connect(): void {
    exchangeLogger.info({ pair: this.pair }, "Connecting to Kraken WebSocket");
    this.ws = new WebSocket(WS_PUBLIC_URL);

    this.ws.on("open", () => {
      exchangeLogger.info("Kraken WS connected");
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.resetHeartbeat();
      this.subscribe();
    });

    this.ws.on("message", (data: WebSocket.RawData) => {
      this.resetHeartbeat();
      try {
        this.handleMessage(JSON.parse(data.toString()) as unknown);
      } catch (err) {
        exchangeLogger.warn({ err }, "Failed to parse WS message");
      }
    });

    this.ws.on("error", (err) => {
      exchangeLogger.error({ err }, "Kraken WS error");
    });

    this.ws.on("close", (code, reason) => {
      this.clearHeartbeat();
      if (!this.stopped) {
        exchangeLogger.warn(
          { code, reason: reason.toString(), reconnectMs: this.reconnectDelay },
          "Kraken WS closed — reconnecting",
        );
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      }
    });
  }

  private subscribe(): void {
    if (!this.ws) return;

    // Subscribe to ticker
    this.ws.send(
      JSON.stringify({
        event: "subscribe",
        pair: [this.pair],
        subscription: { name: "ticker" },
      }),
    );

    // Subscribe to OHLCV (1-minute candles)
    this.ws.send(
      JSON.stringify({
        event: "subscribe",
        pair: [this.pair],
        subscription: { name: "ohlc", interval: 1 },
      }),
    );

    // Subscribe to L2 orderbook (depth 25)
    this.ws.send(
      JSON.stringify({
        event: "subscribe",
        pair: [this.pair],
        subscription: { name: "book", depth: 25 },
      }),
    );

    // Subscribe to trades
    this.ws.send(
      JSON.stringify({
        event: "subscribe",
        pair: [this.pair],
        subscription: { name: "trade" },
      }),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleMessage(msg: unknown): void {
    // System/status messages are objects
    if (typeof msg === "object" && msg !== null && !Array.isArray(msg)) {
      const obj = msg as Record<string, unknown>;
      if (obj["event"] === "heartbeat") return;
      if (obj["event"] === "systemStatus") {
        exchangeLogger.info({ status: obj["status"] }, "Kraken system status");
      }
      return;
    }

    // Data messages are arrays: [channelId, data, channelName, pair]
    if (!Array.isArray(msg) || msg.length < 4) return;

    const channelName = msg[2] as string;
    const pair = msg[3] as string;

    if (pair !== this.pair) return;

    if (channelName === "ticker") {
      this.lastTicker = msg[1] as KrakenTickerMsg;
      const tickerPrice = parseFloat(this.lastTicker.c[0] ?? "0");
      if (Number.isFinite(tickerPrice) && tickerPrice > 0) {
        this.publishPrice(tickerPrice, "ticker");
      }
    } else if (channelName.startsWith("ohlc")) {
      // Kraken OHLC: [time, etime, open, high, low, close, vwap, volume, count]
      const ohlc = msg[1] as string[];
      this.candleBuilder.feedKrakenOHLCV({
        time: parseFloat(ohlc[0] ?? "0"),
        open: ohlc[2] ?? "0",
        high: ohlc[3] ?? "0",
        low: ohlc[4] ?? "0",
        close: ohlc[5] ?? "0",
        volume: ohlc[7] ?? "0",
      });
    } else if (channelName === "book-25") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const book = msg[1] as any;
      if (book["as"] || book["bs"]) {
        // Snapshot
        this.orderBook.applySnapshot(book["bs"] ?? [], book["as"] ?? []);
      } else {
        // Incremental update
        this.orderBook.applyUpdate(book["b"], book["a"]);
      }
    } else if (channelName === "trade") {
      // Trades: array of [price, volume, time, side, orderType, misc]
      const trades = msg[1] as string[][];
      for (const trade of trades) {
        const price = parseFloat(trade[0] ?? "0");
        const volume = parseFloat(trade[1] ?? "0");
        const timestamp = parseFloat(trade[2] ?? "0") * 1000;
        const side = trade[3] === "b" ? "buy" : "sell";

        this.tickBuffer.push({ pair: this.pair, price, volume, side, timestamp });
        if (Number.isFinite(price) && price > 0) {
          this.publishPrice(price, "trade");
        }
      }
    }
  }

  private publishPrice(price: number, source: "ticker" | "trade"): void {
    for (const cb of this.priceSubscribers) {
      void cb(price, source);
    }
  }

  private resetHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      exchangeLogger.warn("Heartbeat timeout — reconnecting");
      this.ws?.terminate();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
