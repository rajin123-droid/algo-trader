import Redis from "ioredis";
import { logger } from "./logger.js";
import { broadcast, sendToUser } from "./ws-server.js";
import { getRedis } from "./redis-client.js";
import { getUserPortfolio } from "./portfolio.service.js";
import { dbConfig } from "../config/db.js";

const REDIS_URL = dbConfig.redisUrl;

let subClient: Redis | null = null;

/**
 * Start the Redis Pub/Sub subscriber that bridges the message bus to WS clients.
 *
 * Channels:
 *   "trades"    → market fill event → fan out to all symbol subscribers
 *   "orderbook" → book changed      → fetch snapshot, fan out to symbol subscribers
 *   "portfolio" → user balances changed → fetch portfolio, send to user connections
 *
 * The "portfolio" channel message shape:
 *   { userId: string, transactionId: string }
 *
 * Portfolio updates are debounced at 100 ms per user to batch rapid fills
 * (e.g. a market order matching multiple resting limit orders).
 *
 * Separate Redis connection:
 *   ioredis requires a DEDICATED connection after subscribe() is called —
 *   it cannot interleave regular commands. The shared `getRedis()` client
 *   is still used for orderbook ZRANGE reads.
 */
export function startWsSubscriber(): void {
  subClient = new Redis(REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 200, 10_000),
    lazyConnect: false,
  });

  subClient.on("connect", () => logger.info("WS subscriber Redis connected"));
  subClient.on("error", (err) => logger.warn({ err }, "WS subscriber Redis error"));

  subClient.subscribe("trades", "orderbook", "portfolio", "candles", (err) => {
    if (err) {
      logger.error({ err }, "Failed to subscribe to Redis channels");
      return;
    }
    logger.info("WS subscriber listening on: trades, orderbook, portfolio, candles");
  });

  subClient.on("message", async (channel: string, message: string) => {
    try {
      const data = JSON.parse(message) as Record<string, unknown>;

      if (channel === "trades") {
        const symbol = String(data["symbol"] ?? "").toUpperCase().replace(/[/-]/g, "");
        broadcast(symbol, { type: "TRADE", data }, false);
        logger.debug({ symbol }, "Trade broadcast sent");
      }

      if (channel === "orderbook") {
        const symbol = String(data["symbol"] ?? "").toUpperCase().replace(/[/-]/g, "");
        const snapshot = await getOrderBookSnapshot(symbol);
        broadcast(symbol, { type: "ORDERBOOK", data: snapshot }, true);
      }

      if (channel === "portfolio") {
        const userId = String(data["userId"] ?? "");
        if (userId) {
          schedulePortfolioUpdate(userId);
        }
      }

      if (channel === "candles") {
        const symbol   = String(data["symbol"]   ?? "").toUpperCase().replace(/[/-]/g, "");
        const interval = String(data["interval"] ?? "1m");
        const candle   = data["candle"] as Record<string, unknown>;
        if (symbol && candle) {
          broadcast(symbol, { type: "CANDLE_UPDATE", interval, data: candle }, false);
        }
      }
    } catch (err) {
      logger.warn({ err, channel, message }, "Failed to process WS subscriber message");
    }
  });
}

/* ── Portfolio debouncer ──────────────────────────────────────────────────── */

/** userId → pending timer handle */
const pendingPortfolioUpdates = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedule a portfolio snapshot for `userId` in 100 ms.
 *
 * If another update arrives within 100 ms for the same user, the timer is
 * reset — only one fetch + send per user per 100 ms window.
 * This coalesces rapid multi-leg fills into a single UI refresh.
 */
function schedulePortfolioUpdate(userId: string): void {
  const existing = pendingPortfolioUpdates.get(userId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingPortfolioUpdates.delete(userId);

    const portfolio = await getUserPortfolio(userId);

    sendToUser(userId, {
      type: "PORTFOLIO_UPDATE",
      data: portfolio,
    });

    logger.debug({ userId, assets: portfolio.length }, "Portfolio update sent to user");
  }, 100);

  pendingPortfolioUpdates.set(userId, timer);
}

/* ── Order-book snapshot ──────────────────────────────────────────────────── */

export interface OrderBookLevel {
  price: number;
  qty: number;
  total: number;
}

async function getOrderBookSnapshot(symbol: string): Promise<{
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}> {
  const redis = getRedis();
  const bidsKey = `orderbook:${symbol}:bids`;
  const asksKey = `orderbook:${symbol}:asks`;

  const [rawBids, rawAsks] = await Promise.all([
    redis.zrevrange(bidsKey, 0, 19, "WITHSCORES"),
    redis.zrange(asksKey, 0, 19, "WITHSCORES"),
  ]);

  /**
   * Redis ZRANGE/ZREVRANGE WITHSCORES returns [member, score, member, score, ...].
   * For the order book ZSETs: score = price, member = qty.
   * So flat[i] = qty, flat[i+1] = price — parse accordingly.
   * Cumulative total is computed from the best price outward (index 0 = best).
   */
  const parseLevels = (flat: string[]): OrderBookLevel[] => {
    const levels: OrderBookLevel[] = [];
    let cumulative = 0;
    for (let i = 0; i < flat.length; i += 2) {
      const qty   = Number(flat[i]);
      const price = Number(flat[i + 1]);
      if (qty < 1e-8) continue;
      cumulative += qty;
      levels.push({ price, qty, total: cumulative });
    }
    return levels;
  };

  return {
    symbol,
    bids: parseLevels(rawBids),
    asks: parseLevels(rawAsks),
  };
}

export function stopWsSubscriber(): void {
  subClient?.disconnect();
  subClient = null;
}
