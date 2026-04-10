import { logger } from "@workspace/logger";
import type { RedisLock } from "../orderbook/redis-lock.js";

/**
 * startLockWatchdog — periodically renews a Redis lock while a long
 * operation is running, preventing it from expiring mid-execution.
 *
 * Problem it solves:
 *   Lock TTL = 5 s, but matching 1000 orders takes 8 s.
 *   Without renewal → lock expires after 5 s → another worker
 *   sees the lock free and begins matching the same symbol → DUPLICATE FILLS.
 *
 * Solution:
 *   Every `intervalMs`, call lock.renew() to reset the TTL.
 *   On renewal failure (we somehow lost the lock) → log a critical warning.
 *   On operation complete → call stopWatchdog() to clear the interval.
 *
 *   Timeline:
 *     t=0    acquire lock (TTL = 5 s)
 *     t=2    watchdog renews (TTL reset to 5 s)
 *     t=4    watchdog renews (TTL reset to 5 s)
 *     t=6    watchdog renews (TTL reset to 5 s)
 *     t=8    operation done → stopWatchdog() → release lock
 *
 * @param lock       RedisLock instance
 * @param key        Lock key (e.g. "lock:BTCUSDT")
 * @param value      Owner ID (same value used to acquire)
 * @param intervalMs How often to renew (default 2 s — well before 5 s TTL)
 * @param ttl        New TTL on each renewal in ms (default 5 s)
 * @returns          stopWatchdog — call this in the finally block
 *
 * Usage:
 *   const stop = startLockWatchdog(lock, "lock:BTCUSDT", workerId);
 *   try {
 *     await longOperation();
 *   } finally {
 *     stop();
 *     await lock.release("lock:BTCUSDT", workerId);
 *   }
 */
export function startLockWatchdog(
  lock: RedisLock,
  key: string,
  value: string,
  intervalMs = 2_000,
  ttl = 5_000
): () => void {
  const timer = setInterval(async () => {
    try {
      const renewed = await lock.renew(key, value, ttl);
      if (!renewed) {
        logger.error(
          { key, value },
          "Lock watchdog: renewal failed — lock may have been taken by another worker. CRITICAL: possible duplicate fill risk."
        );
      } else {
        logger.debug({ key, ttlMs: ttl }, "Lock watchdog: TTL renewed");
      }
    } catch (err) {
      logger.warn({ err, key }, "Lock watchdog: renewal error");
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
