/**
 * Pre-trade risk checks for the Smart Order Router.
 *
 * All checks are pure functions — they receive data and return pass/fail.
 * No side effects, no external dependencies.
 */

import type { OrderSide } from "../adapters/exchange.interface.js";
import type { AggregatedOrderBook } from "../router/orderbook-aggregator.js";
import { availableLiquidity, bookSideFor } from "../router/orderbook-aggregator.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface PreTradeCheckResult {
  passed:   boolean;
  reason?:  string;
  details?: Record<string, number | string>;
}

export interface PreTradeParams {
  symbol:         string;
  side:           OrderSide;
  size:           number;
  /** User's available balance in quote currency (e.g. USDT). */
  quoteBalance:   number;
  /** Consolidated order book for the symbol. */
  orderBook:      AggregatedOrderBook;
  /** Reject if estimated slippage exceeds this (bps). Default: 50bps. */
  maxSlippageBps?: number;
  /** Reject if order size is a larger fraction of available book depth. Default: 0.30 (30%). */
  maxMarketImpact?: number;
  /** Minimum order size in base asset. Default: 0.001. */
  minSize?:        number;
  /** Maximum order size in base asset. Default: unlimited. */
  maxSize?:        number;
}

/* ── Individual checks ────────────────────────────────────────────────────── */

/** Reject if the order size is below the minimum. */
export function checkMinSize(size: number, minSize = 0.001): PreTradeCheckResult {
  if (size < minSize) {
    return { passed: false, reason: `Order size ${size} is below minimum ${minSize}`, details: { size, minSize } };
  }
  return { passed: true };
}

/** Reject if the order size exceeds the maximum. */
export function checkMaxSize(size: number, maxSize: number): PreTradeCheckResult {
  if (size > maxSize) {
    return { passed: false, reason: `Order size ${size} exceeds maximum ${maxSize}`, details: { size, maxSize } };
  }
  return { passed: true };
}

/** Reject if the user doesn't have enough balance to cover the order. */
export function checkBalance(
  size:         number,
  side:         OrderSide,
  quoteBalance: number,
  bestPrice:    number
): PreTradeCheckResult {
  if (side === "BUY") {
    const required = size * bestPrice * 1.001;   // 0.1% buffer for fees
    if (quoteBalance < required) {
      return {
        passed:  false,
        reason:  `Insufficient balance: need ${required.toFixed(2)} USDT, have ${quoteBalance.toFixed(2)}`,
        details: { required, available: quoteBalance, bestPrice, size },
      };
    }
  }
  return { passed: true };
}

/** Reject if estimated slippage exceeds the threshold. */
export function checkSlippage(
  estimatedAvgPrice: number,
  midPrice:          number,
  maxSlippageBps = 50
): PreTradeCheckResult {
  if (midPrice === 0) return { passed: true };

  const slippageBps = Math.abs(estimatedAvgPrice - midPrice) / midPrice * 10_000;
  if (slippageBps > maxSlippageBps) {
    return {
      passed:  false,
      reason:  `Estimated slippage ${slippageBps.toFixed(1)}bps exceeds limit ${maxSlippageBps}bps`,
      details: { slippageBps, maxSlippageBps, estimatedAvgPrice, midPrice },
    };
  }
  return { passed: true, details: { slippageBps } };
}

/**
 * Reject if the order would consume more than `maxMarketImpact` fraction
 * of the total available liquidity in the book (market impact guard).
 */
export function checkMarketImpact(
  size:             number,
  side:             OrderSide,
  orderBook:        AggregatedOrderBook,
  maxMarketImpact = 0.30
): PreTradeCheckResult {
  const levels   = bookSideFor(orderBook, side);
  const liquidity = availableLiquidity(levels, side);

  if (liquidity === 0) {
    return { passed: false, reason: `No liquidity on ${side} side`, details: { liquidity } };
  }

  const impact = size / liquidity;
  if (impact > maxMarketImpact) {
    return {
      passed:  false,
      reason:  `Order size is ${(impact * 100).toFixed(1)}% of available liquidity (limit ${(maxMarketImpact * 100).toFixed(0)}%)`,
      details: { impact, maxMarketImpact, size, liquidity },
    };
  }
  return { passed: true, details: { impact, liquidity } };
}

/**
 * Run all pre-trade checks and return the first failure, or pass.
 */
export function runPreTradeChecks(params: PreTradeParams): PreTradeCheckResult {
  const levels   = bookSideFor(params.orderBook, params.side);
  const bestPrice = levels[0]?.price ?? 0;

  const checks: PreTradeCheckResult[] = [
    checkMinSize(params.size, params.minSize),
    ...(params.maxSize != null ? [checkMaxSize(params.size, params.maxSize)] : []),
    checkBalance(params.size, params.side, params.quoteBalance, bestPrice),
    checkMarketImpact(params.size, params.side, params.orderBook, params.maxMarketImpact),
  ];

  for (const check of checks) {
    if (!check.passed) return check;
  }

  // Estimate avg price for slippage check
  let remaining = params.size;
  let cost = 0;
  for (const lvl of levels) {
    if (remaining <= 0) break;
    const take = Math.min(lvl.size, remaining);
    cost      += take * lvl.price;
    remaining -= take;
  }
  const filledSize     = params.size - remaining;
  const estimatedAvg   = filledSize > 0 ? cost / filledSize : bestPrice;
  const slippageCheck  = checkSlippage(estimatedAvg, params.orderBook.midPrice, params.maxSlippageBps);
  if (!slippageCheck.passed) return slippageCheck;

  return { passed: true, details: { estimatedAvgPrice: estimatedAvg, bestPrice } };
}
