import { redis } from "./redis-client.js";

/**
 * RedisLock — distributed mutex using Redis SET NX PX.
 *
 * Guarantees ONLY ONE WORKER per SYMBOL at a time across any number
 * of Node.js processes, pods, or threads sharing the same Redis.
 *
 * Lock lifecycle:
 *   acquire  → SET lock:{symbol} <workerId> NX PX {ttl}
 *   renew    → Lua PEXPIRE (only if still owner)   ← used by watchdog
 *   release  → Lua DEL     (only if still owner)   ← prevents foreign release
 *
 * All mutation scripts are atomic Lua to prevent TOCTOU races:
 *
 *   Bad (two commands, not atomic):
 *     GET lock:BTC-USDT → "worker-A"
 *     DEL lock:BTC-USDT              ← another worker could slip in here
 *
 *   Good (single Lua script):
 *     if GET == owner: DEL           ← atomic, no gap
 *
 * Python equivalent (using redis-py):
 *   lock = redis.lock("lock:BTC-USDT", timeout=5)
 *   acquired = lock.acquire(blocking=False)
 *   if acquired:
 *     try: process()
 *     finally: lock.release()
 */
export class RedisLock {
  /**
   * Try to acquire the lock.
   *
   * @param key    Redis key, e.g. "lock:BTCUSDT"
   * @param value  Unique owner ID (use crypto.randomUUID())
   * @param ttl    Time-to-live in milliseconds (default 5 s)
   * @returns      true if acquired, false if another worker holds it
   *
   * Redis command: SET key value NX PX ttl
   *   NX  = only set if not exists
   *   PX  = expiry in milliseconds
   */
  async acquire(key: string, value: string, ttl = 5_000): Promise<boolean> {
    const result = await redis.set(key, value, "NX", "PX", ttl);
    return result === "OK";
  }

  /**
   * Extend the TTL of a lock we already hold.
   * Called periodically by the lock watchdog while long operations run.
   *
   * Lua (atomic CAS expire):
   *   if GET(key) == value → PEXPIRE(key, ttl) → 1
   *   else                 → 0 (we no longer own it)
   */
  async renew(key: string, value: string, ttl = 5_000): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1]
      then return redis.call("pexpire", KEYS[1], ARGV[2])
      else return 0
      end
    `;
    const result = await redis.eval(script, 1, key, value, String(ttl));
    return result === 1;
  }

  /**
   * Release the lock — only if we still own it.
   *
   * Lua (atomic CAS delete):
   *   if GET(key) == value → DEL(key) → 1
   *   else                 → 0 (already expired or taken by another worker)
   *
   * This prevents a slow worker from releasing a lock that has already
   * expired and been re-acquired by a different worker.
   */
  async release(key: string, value: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1]
      then return redis.call("del", KEYS[1])
      else return 0
      end
    `;
    const result = await redis.eval(script, 1, key, value);
    return result === 1;
  }

  /**
   * Acquire with blocking retry.
   * Polls every `pollMs` milliseconds until the lock is free or `timeoutMs` elapses.
   *
   * Use this when you MUST process the order on this worker (no delegation possible).
   * Prefer the non-blocking `acquire` + in-process queue for most cases.
   */
  async acquireBlocking(
    key: string,
    value: string,
    ttl = 5_000,
    timeoutMs = 10_000,
    pollMs = 50
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const acquired = await this.acquire(key, value, ttl);
      if (acquired) return true;
      await sleep(pollMs);
    }

    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Singleton lock instance shared across the trading engine. */
export const redisLock = new RedisLock();
