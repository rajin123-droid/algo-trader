/**
 * StrategyConfig — the JSON schema produced by the AI and compiled into a
 * runnable Strategy instance.
 *
 * Design goals:
 *   1. JSON-serialisable (storable in DB, passable over REST)
 *   2. Expressive enough to describe common technical strategies
 *   3. Compilable to an efficient incremental calculation
 *
 * Rule expressions are simple strings using indicator names as variables.
 * Supported syntax:
 *   Logical:     AND, OR, NOT
 *   Comparison:  >, <, >=, <=, ==, !=
 *   Literals:    numbers (integers and decimals)
 *
 * Indicator name conventions (used in expressions):
 *   EMA<period>       e.g. EMA12, EMA26
 *   SMA<period>       e.g. SMA20, SMA50
 *   RSI               (uses the period from the RSI indicator config)
 *   RSI<period>       e.g. RSI14
 *   MACDLine          MACD line (fast EMA - slow EMA)
 *   MACDSignal        MACD signal line
 *   MACDHistogram     MACD histogram
 *
 * Example:
 * {
 *   indicators: [
 *     { type: "EMA", params: { period: 12 } },
 *     { type: "EMA", params: { period: 26 } },
 *     { type: "RSI", params: { period: 14 } }
 *   ],
 *   rules: {
 *     entry: "EMA12 > EMA26 AND RSI < 70",
 *     exit:  "EMA12 < EMA26 OR RSI > 70"
 *   },
 *   risk: {
 *     stopLoss:     0.02,
 *     takeProfit:   0.05,
 *     riskPerTrade: 0.01
 *   }
 * }
 */

export type IndicatorType = "EMA" | "SMA" | "RSI" | "MACD";

export interface IndicatorConfig {
  type: IndicatorType;
  params: {
    period?: number;
    fast?:   number;
    slow?:   number;
    signal?: number;
    [key: string]: unknown;
  };
}

export interface RulesConfig {
  /** Boolean expression that triggers a BUY signal. */
  entry: string;
  /** Boolean expression that triggers a SELL signal. */
  exit:  string;
}

export interface RiskConfig {
  /** Stop-loss as fraction of entry price (0.02 = 2%). 0 = disabled. */
  stopLoss:     number;
  /** Take-profit as fraction of entry price (0.05 = 5%). 0 = disabled. */
  takeProfit:   number;
  /** Fraction of balance to risk per trade (0.01 = 1%). */
  riskPerTrade: number;
}

export interface StrategyConfig {
  /** Human-readable name assigned by the AI. */
  name?:       string;
  /** One-line description of what the strategy does. */
  description?: string;
  indicators:  IndicatorConfig[];
  rules:       RulesConfig;
  risk:        RiskConfig;
}

/* ── Default/fallback config ─────────────────────────────────────────────── */

export const DEFAULT_RISK: RiskConfig = {
  stopLoss:     0.02,
  takeProfit:   0.05,
  riskPerTrade: 0.01,
};

/**
 * Sanitise AI output: fill missing fields with defaults and clamp values
 * to safe ranges before passing to the compiler.
 */
export function sanitiseConfig(raw: Partial<StrategyConfig>): StrategyConfig {
  const risk: RiskConfig = {
    stopLoss:     clamp(Number(raw.risk?.stopLoss     ?? 0.02), 0, 0.5),
    takeProfit:   clamp(Number(raw.risk?.takeProfit   ?? 0.05), 0, 1),
    riskPerTrade: clamp(Number(raw.risk?.riskPerTrade ?? 0.01), 0.001, 0.1),
  };

  const indicators: IndicatorConfig[] = (raw.indicators ?? [
    { type: "EMA", params: { period: 12 } },
    { type: "EMA", params: { period: 26 } },
  ]).map((ind) => ({
    type:   ind.type as IndicatorType,
    params: {
      period: clamp(Number(ind.params?.period ?? 14), 2, 500),
      fast:   ind.params?.fast   != null ? clamp(Number(ind.params.fast),   2, 100) : undefined,
      slow:   ind.params?.slow   != null ? clamp(Number(ind.params.slow),   2, 500) : undefined,
      signal: ind.params?.signal != null ? clamp(Number(ind.params.signal), 2, 100) : undefined,
    },
  }));

  return {
    name:        raw.name        ?? "AI Strategy",
    description: raw.description ?? "",
    indicators,
    rules: {
      entry: String(raw.rules?.entry ?? "EMA12 > EMA26"),
      exit:  String(raw.rules?.exit  ?? "EMA12 < EMA26"),
    },
    risk,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, isNaN(v) ? min : v));
}
