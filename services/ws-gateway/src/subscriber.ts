import Redis from "ioredis";
import { logger } from "@workspace/logger";
import { broadcast } from "./server.js";
import { redis as sharedRedis } from "../../trading-engine/src/orderbook/redis-client.js";

/**
 * WsSubscriber — Redis Pub/Sub subscriber that fans out events to WS clients.
 *
 * Channels:
 *   "trades"    → individual fill event → broadcast type: TRADE to symbol subscribers
 *   "orderbook" → book-changed signal  → fetch latest book snapshot → broadcast type: ORDERBOOK
 *
 * Separate Redis connection for Pub/Sub:
 *   ioredis requires a DEDICATED connection once subscribe() is called.
 *   The shared `redis` client is used for regular commands (ZRANGE etc.).
 *   This subscriber uses its own connection so it never blocks other commands.
 *
 * Python equivalent:
 *   def subscriber():
 *     r = redis.Redis()
 *     p = r.pubsub()
 *     p.subscribe("trades", "orderbook")
 *     for msg in p.listen():
 *       if msg["channel"] == "trades":
 *         broadcast(msg["data"]["symbol"], {"type": "TRADE", "data": ...})
 *       elif msg["channel"] == "orderbook":
 *         ob = get_orderbook(msg["data"]["symbol"])
 *         broadcast(msg["data"]["symbol"], {"type": "ORDERBOOK", "data": ob})
 */

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let subClient: Redis | null = null;

export function startWsSubscriber(): void {
  subClient = new Redis(REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 200, 10_000),
    lazyConnect: false,
  });

  subClient.on("connect", () => logger.info("WS subscriber Redis connected"));
  subClient.on("error", (err) => logger.warn({ err }, "WS subscriber Redis error"));

  subClient.subscribe("trades", "orderbook", (err) => {
    if (err) {
      logger.error({ err }, "Failed to subscribe to Redis channels");
      return;
    }
    logger.info("WS subscriber listening on channels: trades, orderbook");
  });

  subClient.on("message", async (channel: string, message: string) => {
    try {
      const data = JSON.parse(message) as Record<string, unknown>;

      if (channel === "trades") {
        const symbol = String(data["symbol"] ?? "").toUpperCase().replace(/[/-]/g, "");
        broadcast(symbol, { type: "TRADE", data }, false);
        logger.debug({ symbol, channel }, "Trade broadcast sent");
      }

      if (channel === "orderbook") {
        const symbol = String(data["symbol"] ?? "").toUpperCase().replace(/[/-]/g, "");
        const orderbook = await getOrderBookSnapshot(symbol);
        broadcast(symbol, { type: "ORDERBOOK", data: orderbook }, true);
      }
    } catch (err) {
      logger.warn({ err, channel, message }, "Failed to process WS subscriber message");
    }
  });
}

/* ── Order book snapshot ──────────────────────────────────────────────── */

/**
 * Read the top 20 levels from Redis ZSETs and return a structured snapshot.
 *
 * Redis commands:
 *   ZREVRANGE orderbook:{symbol}:bids 0 19 WITHSCORES
 *   ZRANGE    orderbook:{symbol}:asks 0 19 WITHSCORES
 *
 * Returns:
 *   { bids: [[price, count], …], asks: [[price, count], …] }
 */
async function getOrderBookSnapshot(symbol: string): Promise<{
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
}> {
  const bidsKey = `orderbook:${symbol}:bids`;
  const asksKey = `orderbook:${symbol}:asks`;

  const [rawBids, rawAsks] = await Promise.all([
    sharedRedis.zrevrange(bidsKey, 0, 19, "WITHSCORES"),
    sharedRedis.zrange(asksKey, 0, 19, "WITHSCORES"),
  ]);

  const parsePairs = (flat: string[]): [number, number][] => {
    const pairs: [number, number][] = [];
    for (let i = 0; i < flat.length; i += 2) {
      pairs.push([Number(flat[i]), Number(flat[i + 1])]);
    }
    return pairs;
  };

  return {
    symbol,
    bids: parsePairs(rawBids),
    asks: parsePairs(rawAsks),
  };
}

export function stopWsSubscriber(): void {
  subClient?.disconnect();
  subClient = null;
}
