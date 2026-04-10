/**
 * Login Attempt Tracker — brute-force protection per email address.
 *
 * Rules:
 *   • 5 failed logins within 15 minutes  →  account locked for 30 minutes
 *   • Successful login clears the counter immediately
 *   • Lock is keyed on email (IP-level protection is handled by authLimiter)
 *
 * Redis keys:
 *   `login_attempts:{email}` → integer count, TTL 15 minutes
 *   `login_locked:{email}`   → "1",           TTL 30 minutes
 *
 * Falls back to an in-memory Map when Redis is unavailable.
 */

import { getRedis, isRedisAvailable } from "./redis-client.js";
import { logger } from "./logger.js";

const MAX_ATTEMPTS  = 5;
const WINDOW_SECS   = 15 * 60;   // 15 min
const LOCKOUT_SECS  = 30 * 60;   // 30 min

const attKey  = (email: string) => `login_attempts:${email}`;
const lockKey = (email: string) => `login_locked:${email}`;

/* ── In-memory fallback ───────────────────────────────────────────────────── */

const memAttempts = new Map<string, { count: number; expiresAt: number }>();
const memLocked   = new Map<string, number>();  // email → unlockAtMs

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memAttempts) { if (v.expiresAt < now) memAttempts.delete(k); }
  for (const [k, v] of memLocked)   { if (v < now) memLocked.delete(k); }
}, 5 * 60_000).unref();

/* ── Public API ───────────────────────────────────────────────────────────── */

/** Returns true if the account is currently locked out. */
export async function isLockedOut(email: string): Promise<boolean> {
  if (isRedisAvailable()) {
    try {
      return (await getRedis().get(lockKey(email))) !== null;
    } catch { /* fall through */ }
  }

  const unlockAt = memLocked.get(email);
  if (!unlockAt) return false;
  if (unlockAt < Date.now()) { memLocked.delete(email); return false; }
  return true;
}

/**
 * Record a failed login attempt.
 * Returns { locked, remaining } — remaining attempts before lockout.
 */
export async function recordFailedAttempt(
  email: string
): Promise<{ locked: boolean; remaining: number }> {
  if (isRedisAvailable()) {
    try {
      const redis = getRedis();
      const ak    = attKey(email);
      const count = await redis.incr(ak);
      if (count === 1) await redis.expire(ak, WINDOW_SECS);

      if (count >= MAX_ATTEMPTS) {
        await redis.set(lockKey(email), "1", "EX", LOCKOUT_SECS);
        await redis.del(ak);
        logger.warn({ email }, "Account locked — too many failed login attempts");
        return { locked: true, remaining: 0 };
      }

      return { locked: false, remaining: MAX_ATTEMPTS - count };
    } catch (err) {
      logger.warn({ err }, "Redis login tracker write failed — in-memory fallback");
    }
  }

  // In-memory fallback
  const now  = Date.now();
  const curr = memAttempts.get(email);
  const next = curr && curr.expiresAt > now
    ? { count: curr.count + 1, expiresAt: curr.expiresAt }
    : { count: 1,              expiresAt: now + WINDOW_SECS * 1000 };

  memAttempts.set(email, next);

  if (next.count >= MAX_ATTEMPTS) {
    memLocked.set(email, now + LOCKOUT_SECS * 1000);
    memAttempts.delete(email);
    return { locked: true, remaining: 0 };
  }

  return { locked: false, remaining: MAX_ATTEMPTS - next.count };
}

/** Clear the counter on successful login. */
export async function clearAttempts(email: string): Promise<void> {
  if (isRedisAvailable()) {
    try {
      await getRedis().del(attKey(email), lockKey(email));
      return;
    } catch { /* fall through */ }
  }
  memAttempts.delete(email);
  memLocked.delete(email);
}

/** Seconds until lockout expires (0 = not locked). */
export async function lockoutRemainingSeconds(email: string): Promise<number> {
  if (isRedisAvailable()) {
    try {
      const ttl = await getRedis().ttl(lockKey(email));
      return ttl > 0 ? ttl : 0;
    } catch { /* fall through */ }
  }
  const unlockAt = memLocked.get(email);
  return unlockAt ? Math.max(0, Math.ceil((unlockAt - Date.now()) / 1000)) : 0;
}
