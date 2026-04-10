import type { Order } from "../models/order.model.js";

/**
 * OrderBook — in-memory price-level book for a single symbol.
 *
 * bids = BUY orders  → sorted highest price first (best bid = max key)
 * asks = SELL orders → sorted lowest price first  (best ask = min key)
 *
 * Within each price level, orders are stored FIFO (time priority).
 * This implements the standard price-time priority matching algorithm.
 *
 * Python equivalent:
 *   bids = SortedDict(lambda x: -x)  # descending
 *   asks = SortedDict()               # ascending
 */
export class OrderBook {
  readonly symbol: string;
  bids: Map<number, Order[]> = new Map();
  asks: Map<number, Order[]> = new Map();

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  addOrder(order: Order): void {
    if (!order.price) {
      throw new Error("Cannot add a MARKET order to the order book — it has no price");
    }
    const book = order.side === "BUY" ? this.bids : this.asks;
    const price = order.price;

    if (!book.has(price)) {
      book.set(price, []);
    }
    book.get(price)!.push(order);
  }

  removeOrder(order: Order): void {
    if (!order.price) return;
    const book = order.side === "BUY" ? this.bids : this.asks;
    const list = book.get(order.price);
    if (!list) return;

    const filtered = list.filter((o) => o.id !== order.id);
    if (filtered.length === 0) {
      book.delete(order.price);
    } else {
      book.set(order.price, filtered);
    }
  }

  /**
   * Best bid = highest BUY price in the book.
   * Returns null when the book is empty.
   */
  getBestBid(): number | null {
    if (this.bids.size === 0) return null;
    return Math.max(...this.bids.keys());
  }

  /**
   * Best ask = lowest SELL price in the book.
   * Returns null when the book is empty.
   */
  getBestAsk(): number | null {
    if (this.asks.size === 0) return null;
    return Math.min(...this.asks.keys());
  }

  /** Mid-price (arithmetic mean of best bid and ask). */
  getMidPrice(): number | null {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid === null || ask === null) return null;
    return (bid + ask) / 2;
  }

  /** Bid-ask spread in price units. */
  getSpread(): number | null {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid === null || ask === null) return null;
    return ask - bid;
  }

  /**
   * Snapshot of the book for REST/WS streaming.
   * Returns top N levels for each side sorted by price priority.
   */
  snapshot(depth = 20): {
    symbol: string;
    bids: { price: number; quantity: number; orders: number }[];
    asks: { price: number; quantity: number; orders: number }[];
    bestBid: number | null;
    bestAsk: number | null;
    spread: number | null;
  } {
    const toLevel = (map: Map<number, Order[]>, descending: boolean) =>
      [...map.entries()]
        .sort(([a], [b]) => (descending ? b - a : a - b))
        .slice(0, depth)
        .map(([price, orders]) => ({
          price,
          quantity: orders.reduce((s, o) => s + (o.quantity - o.filledQuantity), 0),
          orders: orders.length,
        }));

    return {
      symbol: this.symbol,
      bids: toLevel(this.bids, true),
      asks: toLevel(this.asks, false),
      bestBid: this.getBestBid(),
      bestAsk: this.getBestAsk(),
      spread: this.getSpread(),
    };
  }
}
