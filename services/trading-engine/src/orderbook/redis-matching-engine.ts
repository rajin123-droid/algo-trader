import { logger } from "@workspace/logger";
import type { RedisOrderBook } from "./redis-orderbook.js";
import type { Order } from "../models/order.model.js";

export interface MatchedTrade {
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  quantity: number;
  executedAt: Date;
}

/**
 * RedisMatchingEngine — async price-time priority order matching.
 *
 * IMPORTANT: This engine is intentionally lock-free.
 * Callers (ExecutionService) must hold the per-symbol distributed lock
 * before calling match(). This keeps the engine a pure matching function
 * with no side-effect responsibility:
 *
 *   ExecutionService         RedisMatchingEngine
 *   ────────────────         ──────────────────
 *   acquire lock     ──►
 *   start watchdog           match(order)
 *                              └─ getBestAsk/Bid
 *                              └─ fillQty = min(remaining, counter)
 *                              └─ HSET filledQty on counter
 *                              └─ LPOP/ZREM if fully filled
 *   persist trades   ◄──     return MatchedTrade[]
 *   stop watchdog
 *   release lock     ──►
 *
 * Matching algorithm (price-time priority / FIFO within price level):
 *   BUY  order → scan asks ascending  (lowest ask ≤ limit price)
 *   SELL order → scan bids descending (highest bid ≥ limit price)
 */
export class RedisMatchingEngine {
  constructor(private readonly orderBook: RedisOrderBook) {}

  /**
   * Match `order` against the opposite side of the Redis book.
   * Lock must be held by caller before invoking this method.
   *
   * @returns Array of MatchedTrade records (empty = no fill / goes to book)
   */
  async match(order: Order): Promise<MatchedTrade[]> {
    if (order.side === "BUY") {
      return this.matchBuy(order);
    }
    return this.matchSell(order);
  }

  /* ── BUY matching — scan asks ascending ─────────────────────────────── */

  private async matchBuy(order: Order): Promise<MatchedTrade[]> {
    const trades: MatchedTrade[] = [];

    while (order.filledQuantity < order.quantity) {
      const bestAsk = await this.orderBook.getBestAsk();
      if (bestAsk === null) break;
      if (order.price !== undefined && bestAsk > order.price) break;

      const topOrder = await this.orderBook.getTopOrder("SELL", bestAsk);
      if (!topOrder) {
        await this.orderBook.removeTopOrder("SELL", bestAsk);
        break;
      }

      const fillQty = this.fillQty(order, topOrder);
      trades.push(this.buildTrade(order.id, topOrder.id, bestAsk, fillQty));

      order.filledQuantity += fillQty;
      topOrder.filledQuantity += fillQty;

      await this.orderBook.updateOrder(topOrder.id, { filledQuantity: topOrder.filledQuantity });

      if (topOrder.filledQuantity >= topOrder.quantity) {
        await this.orderBook.removeTopOrder("SELL", bestAsk);
        logger.debug({ sellOrderId: topOrder.id, price: bestAsk }, "Counter order fully filled + removed from book");
      }

      logger.debug({ buyOrderId: order.id, price: bestAsk, qty: fillQty }, "BUY matched");
    }

    return trades;
  }

  /* ── SELL matching — scan bids descending ────────────────────────────── */

  private async matchSell(order: Order): Promise<MatchedTrade[]> {
    const trades: MatchedTrade[] = [];

    while (order.filledQuantity < order.quantity) {
      const bestBid = await this.orderBook.getBestBid();
      if (bestBid === null) break;
      if (order.price !== undefined && bestBid < order.price) break;

      const topOrder = await this.orderBook.getTopOrder("BUY", bestBid);
      if (!topOrder) {
        await this.orderBook.removeTopOrder("BUY", bestBid);
        break;
      }

      const fillQty = this.fillQty(order, topOrder);
      trades.push(this.buildTrade(topOrder.id, order.id, bestBid, fillQty));

      order.filledQuantity += fillQty;
      topOrder.filledQuantity += fillQty;

      await this.orderBook.updateOrder(topOrder.id, { filledQuantity: topOrder.filledQuantity });

      if (topOrder.filledQuantity >= topOrder.quantity) {
        await this.orderBook.removeTopOrder("BUY", bestBid);
        logger.debug({ buyOrderId: topOrder.id, price: bestBid }, "Counter order fully filled + removed from book");
      }

      logger.debug({ sellOrderId: order.id, price: bestBid, qty: fillQty }, "SELL matched");
    }

    return trades;
  }

  /* ── Helpers ──────────────────────────────────────────────────────────── */

  private fillQty(order: Order, counter: Order): number {
    const remaining = order.quantity - order.filledQuantity;
    const counterRemaining = counter.quantity - counter.filledQuantity;
    return Math.min(remaining, counterRemaining);
  }

  private buildTrade(
    buyOrderId: string,
    sellOrderId: string,
    price: number,
    quantity: number
  ): MatchedTrade {
    return { buyOrderId, sellOrderId, price, quantity, executedAt: new Date() };
  }
}
