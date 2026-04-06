import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { MarketSnapshot, AIDecision } from "../signals/snapshot.ts";
import { TOOL_DEFINITIONS, executeTool, type ToolDeps } from "./tools.ts";
import { parseAIResponse } from "./responseParser.ts";
import { aiLogger } from "../utils/logger.ts";

// gpt-4o-mini: fast, cheap (~$0.001/call), good reasoning for structured decisions
const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT = `You are a quantitative trading analyst for a BTC/USD scalping bot.
Your job is to analyze market conditions using the available tools and recommend a trading action.

Rules:
- Scalping strategy: short-term trades targeting ~0.6% gains, ~0.3% stops — bracket levels may be set by the hourly strategic plan or exchange orders; use get_bracket_state before adjusting TP/SL.
- LONG and SHORT are both allowed: BUY = open a long, SELL = open a short, HOLD = no new entry. Multiple concurrent legs are allowed; total open notional is capped as a fraction of equity and entries can be spaced per direction.
- You may adjust open-leg TP/SL via adjust_bracket or set a preferred entry limit via set_entry_limit; stay consistent with strategic bias from get_bracket_state.
- Capital < $1,000 — fees matter significantly
- Be conservative: when uncertain, choose HOLD
- Call the tools you need, then output your decision as JSON

IMPORTANT: After calling tools, respond with ONLY the JSON decision object — no markdown, no bullet points, no analysis before it. Keep reasoning and risk_notes concise (1-2 sentences each).

{"action": "BUY"|"SELL"|"HOLD", "confidence": 0.0-1.0, "reasoning": "...", "risk_notes": "..."}`;

export class ClaudeAgent {
  private readonly client: OpenAI;

  constructor() {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("OPENAI_API_KEY environment variable not set");
    this.client = new OpenAI({ apiKey });
  }

  async analyze(snapshot: MarketSnapshot, deps: ToolDeps): Promise<AIDecision> {
    const startTime = Date.now();

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(snapshot) },
    ];

    let promptTokens = 0;
    let responseTokens = 0;
    let rawText = "";

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await this.client.chat.completions.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          tools: TOOL_DEFINITIONS,
          messages,
        });

        promptTokens += response.usage?.prompt_tokens ?? 0;
        responseTokens += response.usage?.completion_tokens ?? 0;

        const message = response.choices[0]?.message;
        if (!message) break;

        messages.push(message);

        if (response.choices[0]?.finish_reason === "stop") {
          rawText = message.content ?? "";
          break;
        }

        if (response.choices[0]?.finish_reason === "tool_calls" && message.tool_calls?.length) {
          for (const toolCall of message.tool_calls) {
            if (toolCall.type !== "function") continue;
            const args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
            const result = await executeTool(toolCall.function.name, args, deps);
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
          }
          continue;
        }

        // Any other finish reason — grab text and stop
        rawText = message.content ?? "";
        break;
      }

      const latencyMs = Date.now() - startTime;
      const decision = parseAIResponse(rawText);

      aiLogger.info(
        { action: decision.action, confidence: decision.confidence, latencyMs, promptTokens, responseTokens },
        "OpenAI decision",
      );

      return {
        ...decision,
        promptTokens,
        responseTokens,
        latencyMs,
        rawResponse: rawText,
      };
    } catch (err) {
      aiLogger.error({ err }, "OpenAI API call failed — defaulting to HOLD");
      return {
        action: "HOLD",
        confidence: 0,
        reasoning: "API error",
        riskNotes: String(err),
        latencyMs: Date.now() - startTime,
        rawResponse: rawText || String(err),
      };
    }
  }
}

function buildUserMessage(snapshot: MarketSnapshot): string {
  return `Analyze the current BTC/USD market conditions and recommend a trading action.

Time: ${new Date(snapshot.timestamp).toISOString()}
Current Price: $${snapshot.price.toFixed(2)}

Use the available tools to gather data, then provide your recommendation as JSON.`;
}
