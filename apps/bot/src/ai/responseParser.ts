import type { AIDecision } from "../signals/snapshot.ts";
import { aiLogger } from "../utils/logger.ts";

const JSON_REGEX = /\{[\s\S]*\}/;

interface RawDecision {
  action?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
  risk_notes?: unknown;
}

/**
 * Extracts and validates Claude's JSON decision from its text response.
 * Always returns a safe default (HOLD) on any parse failure — never crash on AI output.
 */
export function parseAIResponse(raw: string): AIDecision {
  try {
    const match = JSON_REGEX.exec(raw);
    if (!match) throw new Error("No JSON object found in response");

    const parsed = JSON.parse(match[0]) as RawDecision;

    const action = parsed.action;
    if (action !== "BUY" && action !== "SELL" && action !== "HOLD") {
      throw new Error(`Invalid action: ${String(action)}`);
    }

    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    return {
      action,
      confidence,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      riskNotes: typeof parsed.risk_notes === "string" ? parsed.risk_notes : "",
    };
  } catch (err) {
    aiLogger.warn({ err, raw: raw.slice(0, 200) }, "Failed to parse AI response — defaulting to HOLD");
    return {
      action: "HOLD",
      confidence: 0,
      reasoning: "Parse error",
      riskNotes: "Could not parse AI response",
    };
  }
}
