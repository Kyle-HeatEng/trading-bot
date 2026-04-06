// Core exchange data types

export interface Tick {
  pair: string;
  price: number;
  volume: number;
  side: "buy" | "sell";
  timestamp: number; // Unix ms
}

export interface Candle {
  pair: string;
  timeframeSec: number;
  openTime: number; // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookSnapshot {
  pair: string;
  bids: OrderBookLevel[]; // sorted descending by price
  asks: OrderBookLevel[]; // sorted ascending by price
  timestamp: number;
}

export type OrderSide = "buy" | "sell";
export type OrderType = "limit" | "market" | "stop-limit";
export type OrderStatus = "pending" | "open" | "partially_filled" | "filled" | "cancelled" | "rejected";

export interface Order {
  id: string; // Kraken txid
  clientOrderId?: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  price?: number; // for limit/stop-limit
  stopPrice?: number; // for stop-limit
  size: number; // BTC quantity
  filledSize: number;
  avgFillPrice?: number;
  fee?: number;
  status: OrderStatus;
  createdAt: number; // Unix ms
  updatedAt: number; // Unix ms
}

export interface Fill {
  orderId: string;
  price: number;
  size: number;
  fee: number;
  timestamp: number;
}
