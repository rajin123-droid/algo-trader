/**
 * Smart Order Router — core routing algorithm.
 *
 * Given an aggregated multi-venue order book and an order to fill, this module
 * greedily walks the best-price levels across all exchanges to produce a list
 * of per-venue fills that minimises the average execution price.
 *
 * Pure functions — no side effects.
 */

import type { OrderBookLevel, OrderSide } from "../adapters/exchange.interface.js";
import type { AggregatedOrderBook } from "./orderbook-aggregator.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface RoutedFill {
  exchange: string;
  price:    number;
  size:     number;
}

export interface RoutingResult {
  fills:        RoutedFill[];
  totalSize:    number;
  totalCost:    number;
  avgPrice:     number;
  unfilled:     number;
  /** Bps improvement over filling at the worst level used. */
  priceImprovement: number;
  /** Per-exchange breakdown of allocated size. */
  venueAllocation: Record<string, number>;
}

/* ── Smart router ─────────────────────────────────────────────────────────── */

/**
 * Route an order across venues by greedily consuming the best-priced levels.
 *
 * Algorithm:
 *   1. Take the merged order book (all asks for BUY, all bids for SELL).
 *   2. Sorted by best price — the aggregator already handles this.
 *   3. Walk levels: take as much as possible from each, cheapest first.
 *   4. Consolidate per-exchange fills (sum sizes at same exchange+price).
 *   5. Return routing plan (no execution yet — this is pure routing logic).
 *
 * @param order        - What we want to fill.
 * @param aggregated   - Merged order book from all adapters.
 * @param maxSlippageBps - Reject levels beyond this many bps from mid (0 = unlimited).
 */
export function routeOrder(
  order: { size: number; side: OrderSide; limitPrice?: number },
  aggregated: AggregatedOrderBook,
  maxSlippageBps = 0
): RoutingResult {
  const levels: OrderBookLevel[] = order.side === "BUY"
    ? aggregated.asks   // sorted asc — cheapest first
    : aggregated.bids;  // sorted desc — highest first

  const midPrice = aggregated.midPrice;

  const fills: RoutedFill[] = [];
  let remaining = order.size;
  let worstPrice = 0;

  for (const level of levels) {
    if (remaining <= 0) break;

    // Honour limit price
    if (order.limitPrice != null) {
      if (order.side === "BUY"  && level.price > order.limitPrice) break;
      if (order.side === "SELL" && level.price < order.limitPrice) break;
    }

    // Reject levels that exceed the slippage budget
    if (maxSlippageBps > 0 && midPrice > 0) {
      const slipBps = Math.abs(level.price - midPrice) / midPrice * 10_000;
      if (slipBps > maxSlippageBps) break;
    }

    const take = Math.min(level.size, remaining);
    fills.push({ exchange: level.exchange, price: level.price, size: take });
    worstPrice = level.price;
    remaining -= take;
  }

  // Consolidate fills from the same exchange
  const consolidated: RoutedFill[] = Object.values(
    fills.reduce<Record<string, RoutedFill>>((acc, f) => {
      const key = f.exchange;
      if (!acc[key]) acc[key] = { exchange: f.exchange, price: f.price, size: 0 };
      // VWAP price for consolidated entry
      const prev = acc[key]!;
      const newSize = prev.size + f.size;
      prev.price = (prev.price * prev.size + f.price * f.size) / newSize;
      prev.size  = newSize;
      return acc;
    }, {})
  );

  const totalSize = consolidated.reduce((s, f) => s + f.size, 0);
  const totalCost = consolidated.reduce((s, f) => s + f.size * f.price, 0);
  const avgPrice  = totalSize > 0 ? totalCost / totalSize : 0;

  const priceImprovement =
    midPrice > 0 && worstPrice > 0 && avgPrice > 0
      ? Math.abs(worstPrice - avgPrice) / midPrice * 10_000   // in bps
      : 0;

  const venueAllocation: Record<string, number> = {};
  for (const f of consolidated) {
    venueAllocation[f.exchange] = (venueAllocation[f.exchange] ?? 0) + f.size;
  }

  return {
    fills: consolidated,
    totalSize,
    totalCost,
    avgPrice,
    unfilled: remaining,
    priceImprovement,
    venueAllocation,
  };
}

/**
 * Compute the VWAP that would result from filling the entire order on a single
 * venue (the one with the most liquidity).  Used to measure SOR savings.
 */
export function singleVenueVWAP(
  size:   number,
  levels: OrderBookLevel[],
): number {
  let remaining = size;
  let cost = 0;

  for (const level of levels) {
    if (remaining <= 0) break;
    const take = Math.min(level.size, remaining);
    cost      += take * level.price;
    remaining -= take;
  }

  const filled = size - remaining;
  return filled > 0 ? cost / filled : 0;
}
