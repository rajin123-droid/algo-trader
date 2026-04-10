/**
 * AML (Anti-Money Laundering) rule engine — pure functions.
 *
 * Computes a composite risk score 0–100 based on multiple factors:
 *   • Trade size relative to user's historical average
 *   • Trade frequency (burst detection)
 *   • Round-number detection (a classic structuring signal)
 *   • Rapid direction reversal (wash-trade pattern)
 *   • Absolute notional size thresholds
 *
 * Thresholds:
 *   score ≥ 80 → AUTO_BLOCK
 *   score 60–79 → FLAG_FOR_REVIEW
 *   score < 60  → PASS
 */

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface AmlCheckInput {
  userId:         number;
  /** Notional trade value in USDT. */
  amountUsd:      number;
  symbol:         string;
  side:           "BUY" | "SELL";
  /** User's rolling 30-day average trade size (USDT). */
  avgTradeSize30d?: number;
  /** Number of trades in the last 1 hour. */
  tradesLastHour?:  number;
  /** Number of trades in the last 24 hours. */
  tradesLast24h?:   number;
  /** Last trade side for reversal detection. */
  lastTradeSide?:   "BUY" | "SELL";
  /** Seconds since the last trade (for burst detection). */
  secondsSinceLastTrade?: number;
}

export interface RiskFactor {
  name:   string;
  score:  number;   // 0–100 contribution
  weight: number;   // 0–1 weight in composite score
  detail: string;
}

export interface AmlResult {
  riskScore:  number;             // 0–100 composite
  decision:   "PASS" | "FLAG" | "BLOCK";
  flagged:    boolean;
  reason?:    string;
  factors:    RiskFactor[];
}

/* ── Thresholds ───────────────────────────────────────────────────────────── */

const BLOCK_THRESHOLD  = 80;
const FLAG_THRESHOLD   = 60;

/** Trades above this USD amount always trigger an AML check. */
export const AML_CHECK_THRESHOLD_USD = 5_000;

/* ── Individual risk factor evaluators ───────────────────────────────────── */

function sizeAnomalyScore(amount: number, avg30d?: number): RiskFactor {
  if (!avg30d || avg30d === 0) {
    return { name: "size_anomaly", score: 0, weight: 0.25, detail: "No historical baseline" };
  }
  const ratio = amount / avg30d;
  const score =
    ratio > 20 ? 90 :
    ratio > 10 ? 70 :
    ratio > 5  ? 40 :
    ratio > 3  ? 20 : 0;
  return { name: "size_anomaly", score, weight: 0.25, detail: `${ratio.toFixed(1)}× avg trade size` };
}

function largeNotionalScore(amount: number): RiskFactor {
  const score =
    amount >= 1_000_000 ? 95 :
    amount >=   500_000 ? 75 :
    amount >=   100_000 ? 45 :
    amount >=    50_000 ? 20 : 0;
  return { name: "large_notional", score, weight: 0.30, detail: `$${amount.toLocaleString()}` };
}

function burstFrequencyScore(tradesLastHour?: number, tradesLast24h?: number): RiskFactor {
  const hourly = tradesLastHour ?? 0;
  const daily  = tradesLast24h  ?? 0;
  const score  =
    hourly > 50 ? 90 :
    hourly > 20 ? 60 :
    hourly > 10 ? 30 :
    daily  > 100 ? 40 : 0;
  return { name: "burst_frequency", score, weight: 0.20, detail: `${hourly}/hr, ${daily}/24h` };
}

function roundNumberScore(amount: number): RiskFactor {
  // Structuring signal: amounts like 10000, 9999, 4999 are suspicious
  const isRound = amount % 1000 === 0 || amount % 999 === 0 || amount % 4999 === 0;
  const score = isRound && amount > 5_000 ? 40 : 0;
  return { name: "round_number", score, weight: 0.10, detail: isRound ? "Round/structured amount" : "Normal" };
}

function rapidReversalScore(side: "BUY" | "SELL", lastSide?: "BUY" | "SELL", secondsSince?: number): RiskFactor {
  if (!lastSide || !secondsSince) {
    return { name: "rapid_reversal", score: 0, weight: 0.15, detail: "No reversal data" };
  }
  const reversed = side !== lastSide;
  const rapid    = secondsSince < 60;
  const score    = reversed && rapid ? 70 : reversed && secondsSince < 300 ? 30 : 0;
  return { name: "rapid_reversal", score, weight: 0.15, detail: reversed ? `Reversed in ${secondsSince}s` : "No reversal" };
}

/* ── Main entry point ─────────────────────────────────────────────────────── */

/**
 * Run all AML rule factors and compute a weighted composite risk score.
 */
export function runAmlCheck(input: AmlCheckInput): AmlResult {
  const factors: RiskFactor[] = [
    sizeAnomalyScore(input.amountUsd, input.avgTradeSize30d),
    largeNotionalScore(input.amountUsd),
    burstFrequencyScore(input.tradesLastHour, input.tradesLast24h),
    roundNumberScore(input.amountUsd),
    rapidReversalScore(input.side, input.lastTradeSide, input.secondsSinceLastTrade),
  ];

  const composite = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const riskScore = Math.min(100, Math.round(composite));

  const decision: AmlResult["decision"] =
    riskScore >= BLOCK_THRESHOLD ? "BLOCK" :
    riskScore >= FLAG_THRESHOLD  ? "FLAG"  : "PASS";

  const topFactor = [...factors].sort((a, b) => b.score * b.weight - a.score * a.weight)[0];

  return {
    riskScore,
    decision,
    flagged: decision !== "PASS",
    reason:  decision !== "PASS" ? `Risk score ${riskScore}/100 — ${topFactor?.detail}` : undefined,
    factors,
  };
}

/**
 * Quick check: should this trade trigger a full AML assessment?
 */
export function requiresAmlCheck(amountUsd: number): boolean {
  return amountUsd >= AML_CHECK_THRESHOLD_USD;
}
