import type { StrategicPlanPayload, StrategicBias } from "./strategicTypes.ts";
import { aiLogger } from "../utils/logger.ts";

const JSON_REGEX = /\{[\s\S]*\}/;

function isBias(v: unknown): v is StrategicBias {
  return v === "long" || v === "short" || v === "neutral";
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseStrategicPlanResponse(raw: string): StrategicPlanPayload {
  try {
    const match = JSON_REGEX.exec(raw);
    if (!match) throw new Error("No JSON object in strategic response");
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    const bias = parsed["bias"];
    if (!isBias(bias)) throw new Error(`Invalid bias: ${String(bias)}`);

    const confidence =
      typeof parsed["confidence"] === "number"
        ? Math.max(0, Math.min(1, parsed["confidence"]))
        : 0.5;

    return {
      bias,
      entry_limit_price: numOrNull(parsed["entry_limit_price"]),
      long_take_profit: numOrNull(parsed["long_take_profit"]),
      long_stop_loss: numOrNull(parsed["long_stop_loss"]),
      short_take_profit: numOrNull(parsed["short_take_profit"]),
      short_stop_loss: numOrNull(parsed["short_stop_loss"]),
      reasoning: typeof parsed["reasoning"] === "string" ? parsed["reasoning"] : "",
      confidence,
    };
  } catch (err) {
    aiLogger.warn({ err, raw: raw.slice(0, 300) }, "Strategic plan parse failed — using neutral fallback");
    return {
      bias: "neutral",
      entry_limit_price: null,
      long_take_profit: null,
      long_stop_loss: null,
      short_take_profit: null,
      short_stop_loss: null,
      reasoning: "Parse error — defaulting to neutral",
      confidence: 0,
    };
  }
}
