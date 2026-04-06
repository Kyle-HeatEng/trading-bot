import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { Database } from "bun:sqlite";
import type { IndicatorRegistry } from "../indicators/registry.ts";
import type { TaapiClient } from "../indicators/taapi.ts";
import type { OrderBook } from "../data/orderbook.ts";
import type { FearGreedPoller } from "../sentiment/fearGreed.ts";
import type { PolymarketPoller } from "../sentiment/polymarket.ts";
import type { PositionTracker } from "../strategy/position.ts";
import type { TradeRow, StrategicPlanRow } from "../data/db/repository.ts";
import { getLegBracketByTradeId } from "../data/db/repository.ts";
import type { Config } from "../../config/config.ts";
import type { BracketReconciler } from "../execution/bracketReconciler.ts";
import type { TacticalOverrideStore } from "../strategy/tacticalOverrides.ts";

export type ToolDeps = {
  registry: IndicatorRegistry;
  taapi: TaapiClient;
  orderBook: OrderBook;
  fearGreed: FearGreedPoller;
  polymarket: PolymarketPoller;
  position: PositionTracker;
  recentTrades: TradeRow[];
  db: Database;
  config: Config;
  bracketReconciler: BracketReconciler;
  tacticalOverrides: TacticalOverrideStore;
  /** Latest strategic plan row if any (injected each tactical call). */
  strategicPlan: StrategicPlanRow | null;
};

// Tool definitions in OpenAI function-calling format
export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_technical_snapshot",
      description: "Get all current technical indicator values for BTC/USD (RSI, MACD, EMA, Bollinger Bands, OBV, volume delta)",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_taapi_snapshot",
      description: "Get provider-calculated BTC technical indicators from TAAPI.IO for the last closed candle, if configured",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_orderbook_state",
      description: "Get the current L2 orderbook state: best bid/ask, spread, orderbook imbalance, and weighted mid price",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_polymarket_sentiment",
      description: "Get Polymarket prediction market BTC sentiment: implied probability of bullish outcome from active prediction markets",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fear_greed_index",
      description: "Get the current Crypto Fear & Greed Index score (0=extreme fear, 100=extreme greed) and label",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_position",
      description:
        "Get open BTC legs: FLAT or OPEN with per-leg direction (long/short), entry size, and trade id. Total concurrent gross exposure is capped by config with spacing between new entries per direction.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
    {
      type: "function",
      function: {
        name: "get_recent_performance",
        description: "Get the last N closed trades with their P&L to understand recent strategy performance",
        parameters: {
          type: "object",
          properties: {
            n: { type: "number", description: "Number of recent trades to return (default 5)" },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_bracket_state",
        description:
          "Get active TP/SL bracket levels per open trade id (simulated or exchange). Includes current hourly strategic bias summary.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "adjust_bracket",
        description:
          "Update take-profit and/or stop-loss for an open leg (cancel/replace on Kraken when applicable). Must stay on the correct side of entry (long: TP above entry, SL below).",
        parameters: {
          type: "object",
          properties: {
            trade_id: { type: "number", description: "Open trade id from get_current_position" },
            new_tp_price: { type: "number", description: "New take-profit trigger price (USD)" },
            new_sl_price: { type: "number", description: "New stop-loss trigger price (USD)" },
          },
          required: ["trade_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_entry_limit",
        description:
          "Set tactical preferred entry limit price for the next entry attempt (cleared after a successful open). Pass null to clear.",
        parameters: {
          type: "object",
          properties: {
            price: { type: "number", description: "USD limit price, or omit with clear: true" },
            clear: { type: "boolean", description: "If true, clear override" },
          },
          required: [],
        },
      },
    },
  ];

// Tool execution — maps function names to data retrieval (async for exchange bracket updates)
export async function executeTool(name: string, args: Record<string, unknown>, deps: ToolDeps): Promise<unknown> {
  switch (name) {
    case "get_technical_snapshot":
      return deps.registry.lastValues ?? { error: "Indicators not ready yet (warming up)" };

    case "get_taapi_snapshot":
      return deps.taapi.snapshot ?? { error: "TAAPI snapshot not configured or not ready yet" };

    case "get_orderbook_state":
      return deps.orderBook.snapshot(10);

    case "get_polymarket_sentiment":
      return deps.polymarket.snapshot;

    case "get_fear_greed_index":
      return deps.fearGreed.snapshot;

    case "get_current_position":
      return deps.position.toJSON();

    case "get_recent_performance": {
      const n = typeof args["n"] === "number" ? args["n"] : 5;
      return deps.recentTrades.slice(0, n).map((t) => ({
        side: t.side,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnlPct: t.realizedPnlPct ? `${(t.realizedPnlPct * 100).toFixed(3)}%` : null,
        exitReason: t.exitReason,
      }));
    }

    case "get_bracket_state": {
      const legs = deps.position.openLegs.map((leg) => {
        const b = getLegBracketByTradeId(deps.db, leg.tradeId);
        return {
          tradeId: leg.tradeId,
          direction: leg.direction,
          entryPrice: leg.entryPrice,
          tpPrice: b?.tpPrice ?? null,
          slPrice: b?.slPrice ?? null,
          useExchangeBrackets: b?.useExchangeBrackets ?? false,
        };
      });
      const sp = deps.strategicPlan;
      return {
        strategicBias: sp?.bias ?? null,
        strategicEntryLimit: sp?.entryLimitPrice ?? null,
        legs,
      };
    }

    case "adjust_bracket": {
      const tradeId = args["trade_id"];
      if (typeof tradeId !== "number" || !Number.isFinite(tradeId)) {
        return { error: "trade_id must be a number" };
      }
      const leg = deps.position.openLegs.find((l) => l.tradeId === tradeId);
      if (!leg) return { error: "No open leg for trade_id" };
      const row = getLegBracketByTradeId(deps.db, tradeId);
      if (!row) return { error: "No bracket row for trade — position may pre-date brackets" };
      const newTp = typeof args["new_tp_price"] === "number" ? args["new_tp_price"] : row.tpPrice;
      const newSl = typeof args["new_sl_price"] === "number" ? args["new_sl_price"] : row.slPrice;
      if (
        typeof args["new_tp_price"] !== "number" &&
        typeof args["new_sl_price"] !== "number"
      ) {
        return { error: "Provide new_tp_price and/or new_sl_price" };
      }
      const result = await deps.bracketReconciler.replaceBrackets(
        tradeId,
        leg.direction,
        leg.entryPrice,
        leg.sizeBtc,
        newTp,
        newSl,
      );
      return result.ok ? { ok: true, tpPrice: newTp, slPrice: newSl } : { ok: false, error: result.error };
    }

    case "set_entry_limit": {
      if (args["clear"] === true) {
        deps.tacticalOverrides.clearEntryLimit();
        return { ok: true, cleared: true };
      }
      const price = args["price"];
      if (price === null || price === undefined) {
        deps.tacticalOverrides.clearEntryLimit();
        return { ok: true, cleared: true };
      }
      if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
        return { error: "price must be a positive number" };
      }
      deps.tacticalOverrides.setEntryLimit(price);
      return { ok: true, entryLimitPrice: price };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
