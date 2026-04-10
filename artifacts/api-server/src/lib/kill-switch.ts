/**
 * Trading Kill Switch — system-wide emergency halt for all trade execution.
 *
 * When active:
 *   • All routes protected by `requireTradeEnabled` return 503
 *   • No new orders can be placed, SOR executions blocked, auto-trading paused
 *   • Existing open positions are NOT closed automatically
 *
 * State is stored in:
 *   1. In-memory boolean — O(1) check on every request, no async overhead
 *   2. Redis key `system:kill_switch` — persists across restarts
 *
 * Admin endpoints (ADMIN role only):
 *   POST /admin/kill-switch/activate   → enables the switch
 *   POST /admin/kill-switch/deactivate → disables the switch
 *   GET  /admin/kill-switch            → returns current state
 *
 * Usage in middleware:
 *   import { isKillSwitchActive } from './kill-switch.js';
 *   if (isKillSwitchActive()) return res.status(503).json({ error: 'Trading halted' });
 */

import { getRedis } from "./redis-client.js";
import { logger } from "./logger.js";

const REDIS_KEY = "system:kill_switch";

/* ── In-memory state (synchronous read on every request) ─────────────────── */

let _active      = false;
let _activatedAt: Date | null = null;
let _reason      = "";

/** Returns true if the kill switch is currently active. Synchronous + O(1). */
export function isKillSwitchActive(): boolean {
  return _active;
}

export function killSwitchState(): {
  active:      boolean;
  activatedAt: Date | null;
  reason:      string;
} {
  return { active: _active, activatedAt: _activatedAt, reason: _reason };
}

/* ── Persistence via Redis ────────────────────────────────────────────────── */

/**
 * Load kill-switch state from Redis on server startup.
 * Call from index.ts after the server starts listening.
 */
export async function initKillSwitch(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const val = await redis.get(REDIS_KEY);
    if (val) {
      const state = JSON.parse(val) as { reason?: string; activatedAt?: string };
      _active      = true;
      _reason      = state.reason ?? "";
      _activatedAt = state.activatedAt ? new Date(state.activatedAt) : new Date();
      logger.warn({ reason: _reason }, "Kill switch is ACTIVE (loaded from Redis)");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load kill switch state from Redis");
  }
}

/** Activate the kill switch. Persists to Redis. */
export async function activateKillSwitch(reason: string): Promise<void> {
  _active      = true;
  _activatedAt = new Date();
  _reason      = reason;

  logger.warn({ reason }, "KILL SWITCH ACTIVATED — all trading halted");

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(
        REDIS_KEY,
        JSON.stringify({ reason, activatedAt: _activatedAt.toISOString() })
      );
    } catch (err) {
      logger.error({ err }, "Failed to persist kill switch activation to Redis");
    }
  }
}

/** Deactivate the kill switch. Clears Redis. */
export async function deactivateKillSwitch(): Promise<void> {
  _active      = false;
  _activatedAt = null;
  _reason      = "";

  logger.info("Kill switch deactivated — trading resumed");

  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(REDIS_KEY);
    } catch (err) {
      logger.error({ err }, "Failed to clear kill switch state in Redis");
    }
  }
}
