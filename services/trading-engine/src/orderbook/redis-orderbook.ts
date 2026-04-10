import { redis } from "./redis-client.js";
import type { Order } from "../models/order.model.js";

/**
 * RedisOrderBook — durable, restart-safe order book backed by Redis.
 *
 * Data structures per symbol (e.g. BTC-USDT):
 *
 *   orderbook:BTC-USDT:bids     ZSET  score = price (zrevrange → highest bid first)
 *   orderbook:BTC-USDT:asks     ZSET  score = price (zrange   → lowest  ask first)
 *   orderbook:BTC-USDT:bid:50000  LIST  → [orderId, orderId, …]  FIFO
 *   orderbook:BTC-USDT:ask:50000  LIST  → [orderId, orderId, …]  FIFO
 *   orders:{orderId}              HASH  → all order fields
 *
 * Price-time priority:
 *   - Best price wins (ZSET score)
 *   - Within a price level, earliest arrival wins (LIST head = oldest)
 *
 * Python redis-py equivalent:
 *   r.zadd("orderbook:BTC-USDT:bids", {str(price): price})
 *   r.rpush(f"orderbook:BTC-USDT:bid:{price}", order_id)
 *   r.hset(f"orders:{order_id}", mapping=order_dict)
 */
export class RedisOrderBook {
  readonly symbol: string;

  private readonly bidsKey: string;
  private readonly asksKey: string;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.bidsKey = `orderbook:${symbol}:bids`;
    this.asksKey = `orderbook:${symbol}:asks`;
  }

  private priceListKey(side: "BUY" | "SELL", price: number): string {
    return `orderbook:${this.symbol}:${side === "BUY" ? "bid" : "ask"}:${price}`;
  }

  private orderKey(orderId: string): string {
    return `orders:${orderId}`;
  }

  /* ── Write operations ─────────────────────────────────────────────────── */

  async addOrder(order: Order): Promise<void> {
    if (!order.price) throw new Error("Cannot add a MARKET order to Redis order book");

    const price = order.price;
    const zsetKey = order.side === "BUY" ? this.bidsKey : this.asksKey;

    const pipe = redis.pipeline();

    pipe.zadd(zsetKey, price, String(price));
    pipe.rpush(this.priceListKey(order.side, price), order.id);
    pipe.hset(this.orderKey(order.id), this.orderToHash(order));

    await pipe.exec();
  }

  async removeOrder(order: Order): Promise<void> {
    if (!order.price) return;

    const listKey = this.priceListKey(order.side, order.price);

    await redis.lrem(listKey, 1, order.id);

    const remaining = await redis.llen(listKey);
    if (remaining === 0) {
      const zsetKey = order.side === "BUY" ? this.bidsKey : this.asksKey;
      await redis.zrem(zsetKey, String(order.price));
    }
  }

  async removeTopOrder(side: "BUY" | "SELL", price: number): Promise<void> {
    const listKey = this.priceListKey(side, price);

    await redis.lpop(listKey);

    const remaining = await redis.llen(listKey);
    if (remaining === 0) {
      const zsetKey = side === "BUY" ? this.bidsKey : this.asksKey;
      await redis.zrem(zsetKey, String(price));
    }
  }

  async updateOrder(orderId: string, updates: Partial<Order>): Promise<void> {
    const flat: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) flat[k] = String(v);
    }
    if (Object.keys(flat).length > 0) {
      await redis.hset(this.orderKey(orderId), flat);
    }
  }

  /* ── Read operations ──────────────────────────────────────────────────── */

  async getBestBid(): Promise<number | null> {
    const result = await redis.zrevrange(this.bidsKey, 0, 0);
    return result.length ? Number(result[0]) : null;
  }

  async getBestAsk(): Promise<number | null> {
    const result = await redis.zrange(this.asksKey, 0, 0);
    return result.length ? Number(result[0]) : null;
  }

  async getTopOrderId(side: "BUY" | "SELL", price: number): Promise<string | null> {
    const listKey = this.priceListKey(side, price);
    return redis.lindex(listKey, 0);
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const hash = await redis.hgetall(this.orderKey(orderId));
    if (!hash || !hash["id"]) return null;
    return this.hashToOrder(hash);
  }

  async getTopOrder(side: "BUY" | "SELL", price: number): Promise<Order | null> {
    const orderId = await this.getTopOrderId(side, price);
    if (!orderId) return null;
    return this.getOrder(orderId);
  }

  async getMidPrice(): Promise<number | null> {
    const [bid, ask] = await Promise.all([this.getBestBid(), this.getBestAsk()]);
    if (bid === null || ask === null) return null;
    return (bid + ask) / 2;
  }

  async getSpread(): Promise<number | null> {
    const [bid, ask] = await Promise.all([this.getBestBid(), this.getBestAsk()]);
    if (bid === null || ask === null) return null;
    return ask - bid;
  }

  /**
   * Snapshot top-N levels per side — suitable for WebSocket broadcasting.
   */
  async snapshot(depth = 20): Promise<{
    symbol: string;
    bids: { price: number; count: number }[];
    asks: { price: number; count: number }[];
    bestBid: number | null;
    bestAsk: number | null;
    spread: number | null;
  }> {
    const [rawBids, rawAsks, bestBid, bestAsk] = await Promise.all([
      redis.zrevrange(this.bidsKey, 0, depth - 1),
      redis.zrange(this.asksKey, 0, depth - 1),
      this.getBestBid(),
      this.getBestAsk(),
    ]);

    const countLevels = async (
      prices: string[],
      side: "BUY" | "SELL"
    ) =>
      Promise.all(
        prices.map(async (p) => ({
          price: Number(p),
          count: await redis.llen(this.priceListKey(side, Number(p))),
        }))
      );

    const [bids, asks] = await Promise.all([
      countLevels(rawBids, "BUY"),
      countLevels(rawAsks, "SELL"),
    ]);

    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
    return { symbol: this.symbol, bids, asks, bestBid, bestAsk, spread };
  }

  /* ── Serialisation helpers ────────────────────────────────────────────── */

  private orderToHash(order: Order): Record<string, string> {
    return {
      id: order.id,
      userId: order.userId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      price: String(order.price ?? ""),
      quantity: String(order.quantity),
      filledQuantity: String(order.filledQuantity),
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private hashToOrder(h: Record<string, string>): Order {
    return {
      id: h["id"]!,
      userId: h["userId"]!,
      symbol: h["symbol"]!,
      side: h["side"] as Order["side"],
      type: h["type"] as Order["type"],
      price: h["price"] ? Number(h["price"]) : undefined,
      quantity: Number(h["quantity"]),
      filledQuantity: Number(h["filledQuantity"] ?? 0),
      status: h["status"] as Order["status"],
      createdAt: new Date(h["createdAt"]!),
      updatedAt: new Date(h["updatedAt"]!),
    };
  }
}
