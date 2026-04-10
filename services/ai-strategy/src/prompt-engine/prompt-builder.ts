/**
 * PromptBuilder — constructs structured system + user prompts that guide the
 * LLM to produce a valid StrategyConfig JSON object.
 *
 * The system prompt hard-constraints the output format so the parser can
 * reliably extract the JSON without brittle regex heuristics.
 */

export interface StrategyIdeaInput {
  /** Free-text idea from the user, e.g. "momentum strategy using EMA and RSI" */
  idea:        string;
  symbol?:     string;
  interval?:   string;
  /** Hint: approximate number of recent trades to analyse. */
  marketBias?: "trending" | "ranging" | "volatile" | "unknown";
}

/* ── System prompt ────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `
You are an expert algorithmic trading strategy designer.

Your task: convert a user's trading idea into a precise, valid JSON strategy configuration.

Output ONLY a single JSON object — no markdown, no explanation, no code block fences.
The JSON must conform exactly to this TypeScript interface:

{
  "name": string,                  // short human-readable name (≤ 40 chars)
  "description": string,           // one sentence describing the logic
  "indicators": [
    {
      "type": "EMA" | "SMA" | "RSI" | "MACD",
      "params": {
        "period": number,           // for EMA, SMA, RSI
        "fast":   number,           // for MACD (optional, default 12)
        "slow":   number,           // for MACD (optional, default 26)
        "signal": number            // for MACD (optional, default 9)
      }
    }
  ],
  "rules": {
    "entry": string,               // boolean expression (see below)
    "exit":  string                // boolean expression (see below)
  },
  "risk": {
    "stopLoss":     number,        // fraction of entry price (0.02 = 2%)
    "takeProfit":   number,        // fraction of entry price (0.05 = 5%)
    "riskPerTrade": number         // fraction of balance per trade (0.01 = 1%)
  }
}

EXPRESSION SYNTAX RULES (very important):
- Available variable names follow from your indicator list:
    EMA<period>       e.g. EMA12, EMA26
    SMA<period>       e.g. SMA20, SMA50
    RSI               (uses the RSI period you specified)
    RSI<period>       e.g. RSI14
    MACDLine          (the MACD line: fast EMA - slow EMA)
    MACDSignal        (the signal line)
    MACDHistogram     (the histogram)
- Logical operators: AND, OR, NOT
- Comparison: >, <, >=, <=, ==, !=
- Numeric literals only (no strings, no function calls)

COMMON STRATEGY PATTERNS:
- EMA crossover: entry "EMA12 > EMA26", exit "EMA12 < EMA26"
- EMA + RSI filter: entry "EMA12 > EMA26 AND RSI < 70", exit "EMA12 < EMA26 OR RSI > 70"
- MACD signal cross: entry "MACDHistogram > 0", exit "MACDHistogram < 0"
- Oversold bounce: entry "RSI < 30", exit "RSI > 70 OR EMA9 < EMA21"

RISK GUIDELINES:
- stopLoss:     0.01–0.05   (1%–5%)
- takeProfit:   0.02–0.15   (2%–15%)
- riskPerTrade: 0.01–0.03   (1%–3%)

Do not include any text outside the JSON object.
`.trim();

/* ── User prompt ──────────────────────────────────────────────────────────── */

export function buildUserPrompt(input: StrategyIdeaInput): string {
  const parts = [`Trading idea: "${input.idea}"`];

  if (input.symbol)   parts.push(`Symbol: ${input.symbol}`);
  if (input.interval) parts.push(`Timeframe: ${input.interval}`);
  if (input.marketBias && input.marketBias !== "unknown") {
    parts.push(`Market condition hint: ${input.marketBias}`);
  }

  parts.push("Generate the strategy configuration JSON now.");
  return parts.join("\n");
}

export function buildMessages(input: StrategyIdeaInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: buildUserPrompt(input) },
  ];
}
