/**
 * @workspace/revenue
 *
 * Pure domain logic for performance fee calculation and revenue distribution.
 * No DB, no HTTP — those live in the api-server adapter layer.
 */

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface FeeBreakdown {
  grossProfit:   number;
  feeRate:       number;
  feeAmount:     number;
  creatorShare:  number;
  platformShare: number;
  /** Net profit retained by the follower after the fee is deducted. */
  followerNet:   number;
}

/* ── Constants ───────────────────────────────────────────────────────────── */

export const CREATOR_SPLIT   = 0.70; // 70% of performance fee goes to strategy creator
export const PLATFORM_SPLIT  = 0.30; // 30% goes to the platform

/* ── Pure fee calculator ─────────────────────────────────────────────────── */

/**
 * Calculate how a performance fee is split between creator and platform.
 *
 * @param grossProfit  - Follower's gross profit on the closed trade.
 * @param feeRate      - Fraction charged as performance fee (e.g. 0.20 for 20%).
 */
export function calculateFee(grossProfit: number, feeRate: number): FeeBreakdown {
  const feeAmount     = grossProfit * feeRate;
  const creatorShare  = feeAmount * CREATOR_SPLIT;
  const platformShare = feeAmount * PLATFORM_SPLIT;
  const followerNet   = grossProfit - feeAmount;

  return { grossProfit, feeRate, feeAmount, creatorShare, platformShare, followerNet };
}

/**
 * Whether a copy trade qualifies for a revenue event.
 * Only profitable SELL trades generate fees.
 */
export function qualifiesForFee(signal: string, followerPnl: number | null): boolean {
  return signal === "SELL" && followerPnl != null && followerPnl > 0;
}
