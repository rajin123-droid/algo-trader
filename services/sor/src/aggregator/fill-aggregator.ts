/**
 * Fill aggregation — collapses multiple exchange partial fills into a single
 * summary for reporting and ledger recording.
 *
 * Pure functions — no side effects.
 */

import type { ExecutionResult, ExchangeFill } from "../adapters/exchange.interface.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface AggregatedFill {
  /** VWAP across all venues. */
  avgPrice:    number;
  filledSize:  number;
  totalCost:   number;
  totalFees:   number;
  /** Individual fills from all exchanges, flat list. */
  fills:       ExchangeFill[];
  /** Per-exchange breakdown. */
  byExchange:  Record<string, { size: number; cost: number; avgPrice: number; fees: number }>;
  /** "FILLED" if fully filled, "PARTIAL" if not. */
  status:      "FILLED" | "PARTIAL" | "FAILED";
  /** All error messages if any execution failed. */
  errors:      string[];
}

/* ── Aggregator ───────────────────────────────────────────────────────────── */

/**
 * Aggregate fills from multiple exchange `ExecutionResult` objects into a
 * single unified summary with VWAP pricing.
 */
export function aggregateFills(
  results:       ExecutionResult[],
  requestedSize: number
): AggregatedFill {
  const allFills: ExchangeFill[] = [];
  const errors:   string[] = [];
  const byExchange: AggregatedFill["byExchange"] = {};

  for (const result of results) {
    if (result.error) errors.push(`[${result.exchange}] ${result.error}`);
    allFills.push(...result.fills);

    for (const fill of result.fills) {
      const ex = byExchange[fill.exchange] ??
        (byExchange[fill.exchange] = { size: 0, cost: 0, avgPrice: 0, fees: 0 });
      ex.size  += fill.size;
      ex.cost  += fill.size * fill.price;
      ex.fees  += fill.fee;
      ex.avgPrice = ex.size > 0 ? ex.cost / ex.size : 0;
    }
  }

  const filledSize = allFills.reduce((s, f) => s + f.size, 0);
  const totalCost  = allFills.reduce((s, f) => s + f.size * f.price, 0);
  const totalFees  = allFills.reduce((s, f) => s + f.fee, 0);
  const avgPrice   = filledSize > 0 ? totalCost / filledSize : 0;

  const status: AggregatedFill["status"] =
    filledSize === 0              ? "FAILED"  :
    filledSize < requestedSize    ? "PARTIAL" :
    "FILLED";

  return { avgPrice, filledSize, totalCost, totalFees, fills: allFills, byExchange, status, errors };
}

/**
 * Compute the estimated cost savings of the SOR vs filling at a single venue.
 *
 * savings = (singleVenueVWAP - sorVWAP) × filledSize
 * Positive savings = SOR was cheaper (for buys).
 */
export function computeSavings(
  sorAvgPrice:          number,
  singleVenueAvgPrice:  number,
  filledSize:           number,
  side:                 "BUY" | "SELL"
): number {
  if (filledSize === 0 || singleVenueAvgPrice === 0) return 0;
  const priceDiff = side === "BUY"
    ? singleVenueAvgPrice - sorAvgPrice
    : sorAvgPrice - singleVenueAvgPrice;
  return priceDiff * filledSize;
}

/**
 * Compute slippage in basis points relative to a reference price.
 *
 * slippageBps = |avgPrice - reference| / reference × 10,000
 */
export function computeSlippageBps(avgPrice: number, referencePrice: number): number {
  if (referencePrice === 0) return 0;
  return Math.abs(avgPrice - referencePrice) / referencePrice * 10_000;
}
