import OpenAI from "openai";
import type { StrategyIdeaInput } from "../prompt-engine/prompt-builder.js";
import { buildMessages } from "../prompt-engine/prompt-builder.js";
import { parseStrategyResponse, ParseError } from "../prompt-engine/response-parser.js";
import type { StrategyConfig } from "../models/strategy-config.js";

/**
 * StrategyGenerator
 *
 * Calls the OpenAI API (via Replit AI Integrations proxy) with a structured
 * prompt and returns a parsed, sanitised StrategyConfig.
 *
 * Retry logic:
 *   Up to `maxRetries` attempts.  On ParseError, appends the failed JSON to
 *   a follow-up message asking the model to correct it.  On rate limit errors,
 *   waits with exponential back-off.
 *
 * Model: gpt-5.2 (general reasoning, best for strategy design)
 */

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1_000;

export class StrategyGenerator {
  private readonly openai: OpenAI;

  constructor() {
    const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
    const apiKey  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

    if (!baseURL || !apiKey) {
      throw new Error(
        "AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY must be set. " +
        "Run the AI integrations setup."
      );
    }

    this.openai = new OpenAI({ baseURL, apiKey });
  }

  /**
   * Generate a StrategyConfig from a natural-language idea.
   *
   * @throws Error if all retries fail.
   */
  async generate(input: StrategyIdeaInput): Promise<StrategyConfig> {
    const messages = buildMessages(input);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model:                "gpt-5.2",
          max_completion_tokens: 2048,
          messages,
        });

        const raw = response.choices[0]?.message?.content ?? "";

        try {
          return parseStrategyResponse(raw);
        } catch (err) {
          if (err instanceof ParseError) {
            lastError = err;
            // Ask the model to self-correct on next iteration
            messages.push({ role: "assistant", content: raw });
            messages.push({
              role:    "user",
              content: `Your previous response was not valid JSON. Error: ${err.message}\n\nPlease output ONLY the corrected JSON object, no other text.`,
            });
            continue;
          }
          throw err;
        }
      } catch (err) {
        const isRateLimit =
          err instanceof Error && (err.message.includes("429") || err.message.includes("rate_limit"));

        if (isRateLimit && attempt < MAX_RETRIES - 1) {
          const wait = BACKOFF_BASE_MS * Math.pow(2, attempt);
          await sleep(wait);
          continue;
        }

        throw err;
      }
    }

    throw lastError ?? new Error("Strategy generation failed after all retries");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
