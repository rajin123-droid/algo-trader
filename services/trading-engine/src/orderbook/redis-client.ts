import Redis from "ioredis";
import { logger } from "@workspace/logger";

/**
 * Singleton ioredis client shared across the trading engine.
 *
 * Connection string resolved in priority order:
 *   1. REDIS_URL env var      (e.g. redis://user:pass@host:6379)
 *   2. localhost:6379          (dev default)
 *
 * The client is configured for maximum reliability:
 *   - retryStrategy: exponential back-off, max 30 s
 *   - enableOfflineQueue: true → commands queued while reconnecting
 *   - lazyConnect: false       → connect immediately on import
 *
 * Gracefully degrades: if Redis is unavailable the order book falls
 * back to the in-memory OrderBook (handled in EngineRegistry).
 */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  retryStrategy(times) {
    const delay = Math.min(times * 200, 30_000);
    logger.warn({ attempt: times, delayMs: delay }, "Redis reconnect attempt");
    return delay;
  },
  enableOfflineQueue: true,
  maxRetriesPerRequest: 3,
  lazyConnect: false,
  connectTimeout: 5_000,
});

redis.on("connect", () => logger.info("Redis connected"));
redis.on("error", (err) => logger.warn({ err }, "Redis error — order book running in degraded mode"));
redis.on("close", () => logger.warn("Redis connection closed"));

/** True once we have received at least one successful connection. */
export let redisAvailable = false;
redis.on("ready", () => {
  redisAvailable = true;
  logger.info("Redis ready");
});
