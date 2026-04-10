/**
 * Rate limiting middleware — express-rate-limit v8 + rate-limit-redis.
 *
 * Four tiers:
 *   globalLimiter   — 300 req / 15 min per IP  (all /api routes)
 *   authLimiter     — 20  req / 15 min per IP  (login, register, refresh)
 *   tradingLimiter  — 30  req / min  per user  (open/close positions, start bot)
 *   adminLimiter    — 60  req / 15 min per IP  (admin-only endpoints)
 *
 * Store strategy:
 *   1. Try Redis (ioredis) for cluster-safe, persistent counters.
 *   2. Falls back to in-memory if Redis is unavailable (Replit dev environment).
 *
 * Key strategy:
 *   - Public endpoints (auth, global): keyed on client IP.
 *   - Authenticated endpoints (trading): keyed on req.user.userId if present,
 *     otherwise IP — ensures per-user fairness regardless of IP sharing.
 */

import rateLimit, { type Options } from "express-rate-limit";
import { type Request, type Response } from "express";
import { logger } from "../lib/logger.js";

/* ── Redis store (optional) ───────────────────────────────────────────────── */

async function buildStore(): Promise<Options["store"] | undefined> {
  try {
    const { default: Redis }    = await import("ioredis");
    const { RedisStore }        = await import("rate-limit-redis");

    const client = new Redis({
      host:              process.env["REDIS_HOST"] ?? "127.0.0.1",
      port:              Number(process.env["REDIS_PORT"] ?? 6379),
      password:          process.env["REDIS_PASSWORD"],
      lazyConnect:       true,
      enableOfflineQueue: false,
      connectTimeout:    2_000,
    });

    await client.connect();
    logger.info("Rate-limiter: Redis store connected");

    return new RedisStore({
      // rate-limit-redis v4 requires sendCommand to call ioredis
      sendCommand: (...args: [string, ...string[]]) =>
        client.call(...args) as Promise<number>,
      prefix: "rl:",
    });
  } catch {
    logger.warn("Rate-limiter: Redis unavailable — using in-memory store (single-process only)");
    return undefined;   // express-rate-limit uses MemoryStore when store is undefined
  }
}

/* ── Shared abuse-log handler ─────────────────────────────────────────────── */

function onRateLimitHit(req: Request, _res: Response): void {
  logger.warn({
    ip:       req.ip,
    userId:   (req as Request & { user?: { userId?: string } }).user?.userId ?? "anon",
    path:     req.path,
    method:   req.method,
    reqId:    (req as Request & { reqId?: string }).reqId,
  }, "Rate limit exceeded");
}

/* ── User-based key generator ─────────────────────────────────────────────── */

function userOrIpKey(req: Request): string {
  const userId = (req as Request & { user?: { userId?: string } }).user?.userId;
  return userId ?? req.ip ?? "unknown";
}

/* ── Store singleton (resolved once at startup) ───────────────────────────── */

let resolvedStore: Options["store"] | undefined;
let storeResolved = false;

async function getStore(): Promise<Options["store"] | undefined> {
  if (!storeResolved) {
    resolvedStore  = await buildStore();
    storeResolved  = true;
  }
  return resolvedStore;
}

/* ── Factory: build a limiter with optional store injection ───────────────── */

function makeLimiter(opts: Omit<Options, "store">): ReturnType<typeof rateLimit> {
  const limiter = rateLimit({ ...opts, store: undefined });

  // Inject store as soon as it resolves (non-blocking startup)
  getStore().then((store) => {
    if (store) {
      (limiter as unknown as { store: Options["store"] }).store = store;
    }
  });

  return limiter;
}

/* ── Global limiter ───────────────────────────────────────────────────────── */

export const globalLimiter = makeLimiter({
  windowMs:        15 * 60 * 1_000,   // 15 minutes
  max:             300,
  standardHeaders: "draft-8",
  legacyHeaders:   false,
  message:         { error: "Too many requests, please slow down" },
  handler(req, res, _next, opts) {
    onRateLimitHit(req, res);
    res.status(429).json({
      error:      "Too many requests",
      retryAfter: "15 minutes",
      limit:      opts.max,
    });
  },
});

/* ── Auth limiter — brute-force protection ────────────────────────────────── */

export const authLimiter = makeLimiter({
  windowMs:        15 * 60 * 1_000,   // 15 minutes
  max:             20,
  standardHeaders: "draft-8",
  legacyHeaders:   false,
  handler(req, res, _next, opts) {
    onRateLimitHit(req, res);
    res.status(429).json({
      error:      "Too many authentication attempts",
      retryAfter: "15 minutes",
      limit:      opts.max,
    });
  },
});

/* ── Trading limiter — per-user order rate control ────────────────────────── */

export const tradingLimiter = makeLimiter({
  windowMs:        60 * 1_000,         // 1 minute
  max:             30,
  standardHeaders: "draft-8",
  legacyHeaders:   false,
  keyGenerator:    userOrIpKey,        // per-user fairness
  handler(req, res, _next, opts) {
    onRateLimitHit(req, res);
    res.status(429).json({
      error:      "Trading rate limit exceeded",
      retryAfter: "1 minute",
      limit:      opts.max,
    });
  },
});

/* ── Admin limiter ────────────────────────────────────────────────────────── */

export const adminLimiter = makeLimiter({
  windowMs:        15 * 60 * 1_000,   // 15 minutes
  max:             60,
  standardHeaders: "draft-8",
  legacyHeaders:   false,
  keyGenerator:    userOrIpKey,
  handler(req, res, _next, opts) {
    onRateLimitHit(req, res);
    res.status(429).json({
      error:      "Too many requests",
      retryAfter: "15 minutes",
      limit:      opts.max,
    });
  },
});
