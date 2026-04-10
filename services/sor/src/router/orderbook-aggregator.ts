/**
 * Order book aggregation — merges order books from multiple exchanges into a
 * single consolidated view, sorted by best execution price.
 *
 * Pure functions — no side effects, no external deps.
 */

import type { OrderBook, OrderBookLevel, OrderSide } from "../adapters/exchange.interface.js";

export interface AggregatedOrderBook {
  symbol:  string;
  /** Merged bids sorted descending (best first). */
  bids: OrderBookLevel[];
  /** Merged asks sorted ascending (best first). */
  asks: OrderBookLevel[];
  /** Mid-price of the consolidated book. */
  midPrice: number;
  exchanges: string[];
  timestamp: number;
}

/**
 * Merge multiple per-exchange order books into one consolidated book.
 * Each level retains its `exchange` tag so the router knows where to route.
 */
export function mergeBooks(books: OrderBook[]): AggregatedOrderBook {
  if (books.length === 0) {
    throw new Error("Cannot merge empty list of order books");
  }

  const symbol    = books[0]!.symbol;
  const exchanges = books.map((b) => b.exchange);

  const bids: OrderBookLevel[] = books
    .flatMap((b) => b.bids)
    .sort((a, b) => b.price - a.price);   // best bid first (desc)

  const asks: OrderBookLevel[] = books
    .flatMap((b) => b.asks)
    .sort((a, b) => a.price - b.price);   // best ask first (asc)

  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;

  return { symbol, bids, asks, midPrice, exchanges, timestamp: Date.now() };
}

/**
 * Fetch order books from all adapters in parallel and merge them.
 */
export async function aggregateOrderBooks(
  symbol:   string,
  adapters: Array<{ getOrderBook(s: string, d?: number): Promise<OrderBook> }>,
  depth = 20
): Promise<AggregatedOrderBook> {
  const books = await Promise.all(
    adapters.map((a) => a.getOrderBook(symbol, depth).catch(() => null))
  );

  const valid = books.filter((b): b is OrderBook => b !== null);
  if (valid.length === 0) {
    throw new Error(`Failed to fetch order books for ${symbol} from any exchange`);
  }

  return mergeBooks(valid);
}

/**
 * Get the relevant side of the book for a given order direction.
 * BUY orders walk asks (ascending price); SELL orders walk bids (descending).
 */
export function bookSideFor(book: AggregatedOrderBook, side: OrderSide): OrderBookLevel[] {
  return side === "BUY" ? book.asks : book.bids;
}

/**
 * Compute total available liquidity on a given side of the book
 * up to a maximum price (for BUY) or minimum price (for SELL).
 */
export function availableLiquidity(
  levels:   OrderBookLevel[],
  side:     OrderSide,
  limitPrice?: number
): number {
  return levels.reduce((total, lvl) => {
    if (limitPrice == null) return total + lvl.size;
    if (side === "BUY"  && lvl.price <= limitPrice) return total + lvl.size;
    if (side === "SELL" && lvl.price >= limitPrice) return total + lvl.size;
    return total;
  }, 0);
}
