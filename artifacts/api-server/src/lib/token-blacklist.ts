/**
 * Access Token Blacklist — revokes issued access tokens before their expiry.
 *
 * Problem: access tokens are stateless JWTs valid for 15 minutes.
 *          After logout, the user can still use the token until it expires.
 *
 * Solution: store the token's `jti` (JWT ID) in a short-lived Redis key
 *           (TTL = remaining token lifetime). Every requireAuth check queries
 *           this store — O(1) Redis GET per request.
 *
 * Redis key: `atbl:{jti}` → "1"  (TTL = seconds until token expires)
 * Fallback:  in-memory Map<jti, expiresAtMs> (lazy-purged every 5 minutes)
 */

import { getRedis, isRedisAvailable } from "./redis-client.js";
import { logger } from "./logger.js";

const PREFIX = "atbl:";

/* ── In-memory fallback ───────────────────────────────────────────────────── */

const memStore = new Map<string, number>();   // jti → expiresAtMs

function memPurge(): void {
  const now = Date.now();
  for (const [jti, exp] of memStore) {
    if (exp < now) memStore.delete(jti);
  }
}
setInterval(memPurge, 5 * 60_000).unref();

/* ── Public API ───────────────────────────────────────────────────────────── */

/**
 * Blacklist an access token for its remaining lifetime.
 *
 * @param jti        - The `jti` claim from the decoded JWT payload
 * @param ttlSeconds - Remaining valid seconds (use `tokenTtlSeconds(rawToken)`)
 */
export async function blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;

  if (isRedisAvailable()) {
    try {
      await getRedis().set(`${PREFIX}${jti}`, "1", "EX", Math.ceil(ttlSeconds));
      return;
    } catch (err) {
      logger.warn({ err }, "Redis blacklist write failed — falling back to memory");
    }
  }

  memStore.set(jti, Date.now() + ttlSeconds * 1000);
}

/**
 * Returns true if the jti has been blacklisted (token revoked).
 */
export async function isTokenBlacklisted(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;

  if (isRedisAvailable()) {
    try {
      return (await getRedis().get(`${PREFIX}${jti}`)) !== null;
    } catch { /* fall through to in-memory */ }
  }

  const exp = memStore.get(jti);
  if (exp === undefined) return false;
  if (exp < Date.now()) { memStore.delete(jti); return false; }
  return true;
}
