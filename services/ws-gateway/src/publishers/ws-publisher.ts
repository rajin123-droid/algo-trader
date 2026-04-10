import { redis } from "../../../trading-engine/src/orderbook/redis-client.js";
import { logger } from "@workspace/logger";

/**
 * WsPublisher — Redis Pub/Sub publishers for the WebSocket gateway.
 *
 * Execution service calls these after every trade fill.
 * The Redis Pub/Sub subscriber in ws-gateway/subscriber.ts receives the messages
 * and fans them out to connected WebSocket clients.
 *
 * Two channels:
 *   "trades"    → individual fill events   { symbol, price, quantity, side, … }
 *   "orderbook" → trigger for book refresh { symbol }
 *
 * Using Redis Pub/Sub (not Streams) because:
 *   - fire-and-forget (no consumer group overhead)
 *   - message loss on disconnect is acceptable here (UI can refresh)
 *   - single-subscriber design (one WS gateway process per deployment)
 *
 * Python equivalent:
 *   def publish_trade(trade): redis.publish("trades", json.dumps(trade))
 *   def publish_orderbook(symbol): redis.publish("orderbook", json.dumps({"symbol": symbol}))
 */

export async function publishTrade(trade: {
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  orderId: string;
  userId: string;
  executedAt: Date;
}): Promise<void> {
  try {
    await redis.publish("trades", JSON.stringify(trade));
  } catch (err) {
    logger.warn({ err, trade }, "Failed to publish trade to Redis Pub/Sub");
  }
}

export async function publishOrderBook(symbol: string): Promise<void> {
  try {
    await redis.publish("orderbook", JSON.stringify({ symbol }));
  } catch (err) {
    logger.warn({ err, symbol }, "Failed to publish orderbook update to Redis Pub/Sub");
  }
}

/**
 * Emit a portfolio-changed signal for a user.
 *
 * The WS subscriber picks this up, debounces at 100 ms, fetches the
 * full portfolio snapshot, and calls sendToUser() on every open connection
 * for that user.
 *
 * Called after every ledger transaction that touches a user's accounts
 * (trade fills, deposits, withdrawals).
 */
export async function publishPortfolioUpdate(userId: string): Promise<void> {
  try {
    await redis.publish(
      "portfolio",
      JSON.stringify({ userId, transactionId: crypto.randomUUID() })
    );
  } catch (err) {
    logger.warn({ err, userId }, "Failed to publish portfolio update to Redis Pub/Sub");
  }
}
