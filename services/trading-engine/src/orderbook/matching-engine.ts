import type { Order } from "../models/order.model.js";
import { OrderBook } from "./order-book.js";

export interface MatchedTrade {
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  quantity: number;
  executedAt: Date;
}

/**
 * MatchingEngine — price-time priority (pro-rata optional) order matching.
 *
 * Algorithm:
 *   BUY  order → scan asks ascending  (lowest ask first) while ask ≤ limit price
 *   SELL order → scan bids descending (highest bid first) while bid ≥ limit price
 *
 * Within each price level, orders fill FIFO (time priority = insertion order).
 *
 * Python equivalent:
 *   def match(order):
 *     if order.side == "BUY":
 *       while order.remaining > 0 and best_ask <= order.price:
 *         fill(order, asks[best_ask][0])
 *     else:
 *       while order.remaining > 0 and best_bid >= order.price:
 *         fill(order, bids[best_bid][0])
 */
export class MatchingEngine {
  constructor(private readonly orderBook: OrderBook) {}

  /**
   * Try to match `order` against the opposite side of the book.
   * Returns an array of MatchedTrade records (may be empty for no-fill).
   * Mutates `order.filledQuantity` and the order book in place.
   */
  match(order: Order): MatchedTrade[] {
    if (order.side === "BUY") {
      return this.matchBuy(order);
    }
    return this.matchSell(order);
  }

  private matchBuy(order: Order): MatchedTrade[] {
    const trades: MatchedTrade[] = [];

    while (order.filledQuantity < order.quantity) {
      const bestAskPrice = this.orderBook.getBestAsk();

      if (bestAskPrice === null) break;
      if (order.price !== undefined && bestAskPrice > order.price) break;

      const sellOrders = this.orderBook.asks.get(bestAskPrice);
      if (!sellOrders || sellOrders.length === 0) {
        this.orderBook.asks.delete(bestAskPrice);
        break;
      }

      const topSell = sellOrders[0]!;
      const remaining = order.quantity - order.filledQuantity;
      const counterRemaining = topSell.quantity - topSell.filledQuantity;
      const fillQty = Math.min(remaining, counterRemaining);

      trades.push({
        buyOrderId: order.id,
        sellOrderId: topSell.id,
        price: bestAskPrice,
        quantity: fillQty,
        executedAt: new Date(),
      });

      order.filledQuantity += fillQty;
      topSell.filledQuantity += fillQty;

      if (topSell.filledQuantity >= topSell.quantity) {
        sellOrders.shift();
        if (sellOrders.length === 0) {
          this.orderBook.asks.delete(bestAskPrice);
        }
      }
    }

    return trades;
  }

  private matchSell(order: Order): MatchedTrade[] {
    const trades: MatchedTrade[] = [];

    while (order.filledQuantity < order.quantity) {
      const bestBidPrice = this.orderBook.getBestBid();

      if (bestBidPrice === null) break;
      if (order.price !== undefined && bestBidPrice < order.price) break;

      const buyOrders = this.orderBook.bids.get(bestBidPrice);
      if (!buyOrders || buyOrders.length === 0) {
        this.orderBook.bids.delete(bestBidPrice);
        break;
      }

      const topBuy = buyOrders[0]!;
      const remaining = order.quantity - order.filledQuantity;
      const counterRemaining = topBuy.quantity - topBuy.filledQuantity;
      const fillQty = Math.min(remaining, counterRemaining);

      trades.push({
        buyOrderId: topBuy.id,
        sellOrderId: order.id,
        price: bestBidPrice,
        quantity: fillQty,
        executedAt: new Date(),
      });

      order.filledQuantity += fillQty;
      topBuy.filledQuantity += fillQty;

      if (topBuy.filledQuantity >= topBuy.quantity) {
        buyOrders.shift();
        if (buyOrders.length === 0) {
          this.orderBook.bids.delete(bestBidPrice);
        }
      }
    }

    return trades;
  }
}
