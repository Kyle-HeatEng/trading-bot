import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Database } from "bun:sqlite";
import type { Config } from "../../config/config.ts";
import type { KrakenClient } from "../exchange/krakenClient.ts";
import type { PositionTracker } from "../strategy/position.ts";
import type { BracketReconciler } from "../execution/bracketReconciler.ts";
import { getRecentTrades, insertStrategicPlan, type StrategicPlanRow } from "../data/db/repository.ts";
import { parseStrategicPlanResponse } from "./strategicParser.ts";
import type { StrategicPlanPayload } from "./strategicTypes.ts";
import { aiLogger } from "../utils/logger.ts";

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_VALID_MS = 3_600_000;
const MAX_TOKENS = 2048;

const SYSTEM_PROMPT = `You are a strategic BTC/USD trader. You receive multi-timeframe OHLC summaries and open position context.
Output a BINDING plan for the next hour (risk limits are enforced elsewhere).

Respond with ONLY a JSON object (no markdown):
{
  "bias": "long" | "short" | "neutral",
  "entry_limit_price": <number or null> — optional limit price for new entries this hour,
  "long_take_profit": <number or null> — USD price to take profit on longs,
  "long_stop_loss": <number or null> — USD stop for longs,
  "short_take_profit": <number or null> — USD price to take profit on shorts,
  "short_stop_loss": <number or null> — USD stop for shorts,
  "reasoning": "<= 400 chars>",
  "confidence": 0.0-1.0
}

Geometry (must hold when prices are set):
- Long: long_take_profit > spot > long_stop_loss
- Short: short_take_profit < spot < short_stop_loss
Use null for prices you are not confident about; use neutral bias when unsure.
When bias is neutral, still may set prices for managing existing legs or use nulls.`;

function compactCandles(rows: { openTime: number; open: number; high: number; low: number; close: number }[], max = 24) {
  const slice = rows.slice(-max);
  return slice.map((c) => ({
    t: c.openTime,
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
  }));
}

function payloadToRow(
  payload: StrategicPlanPayload,
  validFrom: number,
  validUntil: number,
  raw: string,
  promptTokens: number,
  responseTokens: number,
  latencyMs: number,
): Omit<StrategicPlanRow, "id"> {
  return {
    validFrom,
    validUntil,
    bias: payload.bias,
    planJson: JSON.stringify(payload),
    entryLimitPrice: payload.entry_limit_price,
    longTp: payload.long_take_profit,
    longSl: payload.long_stop_loss,
    shortTp: payload.short_take_profit,
    shortSl: payload.short_stop_loss,
    promptTokens,
    responseTokens,
    latencyMs,
    rawResponse: raw,
  };
}

export class StrategicAgent {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("OPENAI_API_KEY environment variable not set");
    this.client = new OpenAI({ apiKey });
    this.model = process.env["STRATEGIC_OPENAI_MODEL"]?.trim() || DEFAULT_MODEL;
  }

  /**
   * Fetch multi-TF context, run strategic model, persist plan, refresh exchange brackets for open legs.
   */
  async runHourly(
    db: Database,
    kraken: KrakenClient,
    config: Config,
    position: PositionTracker,
    reconciler: BracketReconciler,
  ): Promise<void> {
    const start = Date.now();
    const restPair = config.trading.restPair;

    const [h1, h4, d1] = await Promise.all([
      kraken.getRecentCandles(restPair, 3600, 48),
      kraken.getRecentCandles(restPair, 14_400, 36),
      kraken.getRecentCandles(restPair, 86_400, 30),
    ]);

    const spot = h1.length > 0 ? (h1[h1.length - 1]?.close ?? 0) : 0;

    const recent = getRecentTrades(db, 5);
    const userPayload = {
      spot,
      openLegs: position.toJSON(),
      recentClosedTrades: recent.map((t) => ({
        side: t.side,
        pnlPct: t.realizedPnlPct,
        exitReason: t.exitReason,
      })),
      ohlc_1h: compactCandles(h1),
      ohlc_4h: compactCandles(h4, 18),
      ohlc_1d: compactCandles(d1, 14),
    };

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPayload) },
    ];

    let rawText = "";
    let promptTokens = 0;
    let responseTokens = 0;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        messages,
      });
      rawText = response.choices[0]?.message?.content ?? "";
      promptTokens = response.usage?.prompt_tokens ?? 0;
      responseTokens = response.usage?.completion_tokens ?? 0;
    } catch (err) {
      aiLogger.error({ err }, "Strategic OpenAI call failed");
      return;
    }

    const latencyMs = Date.now() - start;
    const parsed = parseStrategicPlanResponse(rawText);
    const validFrom = Date.now();
    const validUntil = validFrom + DEFAULT_VALID_MS;

    insertStrategicPlan(
      db,
      payloadToRow(parsed, validFrom, validUntil, rawText, promptTokens, responseTokens, latencyMs),
    );

    aiLogger.info(
      { bias: parsed.bias, latencyMs, model: this.model, promptTokens, responseTokens },
      "Strategic plan stored",
    );

    const planRow = {
      validFrom,
      validUntil,
      bias: parsed.bias,
      planJson: JSON.stringify(parsed),
      entryLimitPrice: parsed.entry_limit_price,
      longTp: parsed.long_take_profit,
      longSl: parsed.long_stop_loss,
      shortTp: parsed.short_take_profit,
      shortSl: parsed.short_stop_loss,
      promptTokens,
      responseTokens,
      latencyMs,
      rawResponse: rawText,
    } satisfies StrategicPlanRow;

    await reconciler.refreshOpenLegsFromPlan(position, planRow);
  }
}
