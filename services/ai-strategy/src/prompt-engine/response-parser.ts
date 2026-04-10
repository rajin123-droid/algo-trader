import { sanitiseConfig, type StrategyConfig } from "../models/strategy-config.js";

/**
 * ResponseParser — extracts and validates the StrategyConfig JSON from the
 * raw LLM output string.
 *
 * The LLM may wrap the JSON in markdown code fences (```json ... ```) even
 * when instructed not to.  This parser handles both raw JSON and fenced JSON.
 *
 * Validation:
 *   1. Must parse as valid JSON.
 *   2. Must have a non-empty `indicators` array.
 *   3. Must have non-empty `rules.entry` and `rules.exit` strings.
 *   4. All numeric risk values are clamped to safe ranges via sanitiseConfig().
 *
 * On parse failure, throws a ParseError with the raw content attached so the
 * caller can log or retry.
 */

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

/**
 * Parse the LLM's response text into a sanitised StrategyConfig.
 *
 * @throws ParseError if the text cannot be parsed or is structurally invalid.
 */
export function parseStrategyResponse(raw: string): StrategyConfig {
  const text = extractJSON(raw.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ParseError(`Invalid JSON from LLM: ${(err as Error).message}`, raw);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ParseError("LLM returned a non-object JSON value", raw);
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj["indicators"]) || obj["indicators"].length === 0) {
    throw new ParseError('Missing or empty "indicators" array', raw);
  }

  const rules = obj["rules"] as Record<string, unknown> | undefined;
  if (!rules || !rules["entry"] || !rules["exit"]) {
    throw new ParseError('Missing "rules.entry" or "rules.exit"', raw);
  }

  return sanitiseConfig(obj as Parameters<typeof sanitiseConfig>[0]);
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Strip markdown code fences (```json ... ``` or ``` ... ```) and extract
 * the first JSON object found in the string.
 */
function extractJSON(text: string): string {
  // Remove code fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  // Find the first { ... } block
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new ParseError("No JSON object found in LLM response", text);
  }

  return text.slice(start, end + 1);
}
