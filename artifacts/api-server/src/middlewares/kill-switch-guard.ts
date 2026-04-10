/**
 * Kill Switch Guard middleware — blocks trading operations system-wide.
 *
 * Apply to any route where trade execution must be halted:
 *   router.post('/sor/execute',     requireAuth, requireTradeEnabled, handler);
 *   router.post('/auto-trading/...',requireAuth, requireTradeEnabled, handler);
 *
 * Returns 503 Service Unavailable with reason when the switch is active.
 */

import type { Request, Response, NextFunction } from "express";
import { isKillSwitchActive, killSwitchState } from "../lib/kill-switch.js";

export function requireTradeEnabled(
  _req:  Request,
  res:   Response,
  next:  NextFunction
): void {
  if (!isKillSwitchActive()) {
    next();
    return;
  }

  const { reason, activatedAt } = killSwitchState();
  res.status(503).json({
    error:       "Trading is currently halted by the system kill switch",
    reason:      reason || "Administrative action",
    activatedAt: activatedAt?.toISOString() ?? null,
    retryAfter:  "Contact system administrator",
  });
}
