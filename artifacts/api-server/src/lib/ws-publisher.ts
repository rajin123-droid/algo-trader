import { getRedis, isRedisAvailable } from "./redis-client.js";
import { broadcast, sendToUser } from "./ws-server.js";
import { getUserPortfolio } from "./portfolio.service.js";
import { logger } from "./logger.js";
import type { Candle } from "./candle.service.js";
import { inProcessBus } from "./in-process-bus.js";

/* ── Trade fills ──────────────────────────────────────────────────────────── */

/**
 * Publish a trade fill to all clients subscribed to that symbol.
 *
 * Redis available → publish to "trades" Pub/Sub channel → subscriber fans out.
 * Redis offline  → broadcast directly within the same process.
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
  if (isRedisAvailable()) {
    try {
      await getRedis().publish("trades", JSON.stringify(trade));
      return;
    } catch (err) {
      logger.warn({ err }, "Redis trade publish failed — falling back to direct broadcast");
    }
  }

  const symbol = trade.symbol.toUpperCase().replace(/[/-]/g, "");
  broadcast(symbol, { type: "TRADE", data: trade }, false);
}

/* ── Order-book snapshots ─────────────────────────────────────────────────── */

/**
 * Signal that an order-book has changed.
 * No-ops when Redis is unavailable (book snapshots live in Redis ZSETs).
 */
export async function publishOrderBook(symbol: string): Promise<void> {
  if (!isRedisAvailable()) return;

  try {
    await getRedis().publish("orderbook", JSON.stringify({ symbol }));
  } catch (err) {
    logger.warn({ err, symbol }, "Redis orderbook publish failed");
  }
}

/* ── Candle updates ───────────────────────────────────────────────────────── */

/**
 * Broadcast a live candle update to all clients subscribed to `symbol`.
 *
 * Clients receive: { type: "CANDLE_UPDATE", interval: "1m", data: Candle }
 *
 * Redis available → publish to "candles" Pub/Sub channel → subscriber fans out.
 * Redis offline  → broadcast directly within the same process.
 *
 * No throttle is applied — candle updates carry aggregated data and are
 * already naturally rate-limited (one per trade fill per interval).
 */
export async function publishCandleUpdate(
  symbol: string,
  interval: string,
  candle: Candle
): Promise<void> {
  const normalized = symbol.toUpperCase().replace(/[/-]/g, "");
  const payload = { type: "CANDLE_UPDATE", interval, data: candle };

  if (isRedisAvailable()) {
    try {
      await getRedis().publish(
        "candles",
        JSON.stringify({ symbol: normalized, interval, candle })
      );
    } catch (err) {
      logger.warn({ err }, "Redis candle publish failed — falling back to direct broadcast");
      broadcast(normalized, payload, false);
    }
  } else {
    broadcast(normalized, payload, false);
  }

  // ── In-process fan-out → auto-trading engines ──────────────────────────
  // Fires synchronously so the auto-trading manager receives the candle on
  // the same tick regardless of Redis availability.
  inProcessBus.emitCandle({ symbol: normalized, interval, candle });
}

/* ── Portfolio updates ────────────────────────────────────────────────────── */

/**
 * Publish a portfolio update for a specific user.
 *
 * Redis available → "portfolio" channel → subscriber debounces 100 ms → sendToUser.
 * Redis offline  → in-process debounce → sendToUser directly.
 */
export async function publishPortfolioUpdate(userId: string): Promise<void> {
  if (isRedisAvailable()) {
    try {
      await getRedis().publish(
        "portfolio",
        JSON.stringify({ userId, transactionId: crypto.randomUUID() })
      );
      return;
    } catch (err) {
      logger.warn({ err, userId }, "Redis portfolio publish failed — falling back to direct send");
    }
  }

  scheduleDirectPortfolioUpdate(userId);
}

/** userId → pending timer (in-process fallback) */
const pendingDirectUpdates = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDirectPortfolioUpdate(userId: string): void {
  const existing = pendingDirectUpdates.get(userId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingDirectUpdates.delete(userId);
    const portfolio = await getUserPortfolio(userId);
    sendToUser(userId, { type: "PORTFOLIO_UPDATE", data: portfolio });
    logger.debug({ userId, assets: portfolio.length }, "Portfolio update sent (in-process)");
  }, 100);

  pendingDirectUpdates.set(userId, timer);
}
