import type { LiveSignal } from "../types.js";

/**
 * SignalProcessor
 *
 * Stateless structural validation of a LiveSignal before it reaches the
 * risk gate.  Catches obviously malformed signals early (missing fields,
 * non-positive size, unknown direction) so the risk controller can assume
 * its input is structurally valid.
 *
 * This is a pure synchronous function — no DB, no I/O.
 *
 * Validation rules:
 *   1. signal.type must be "BUY" or "SELL"
 *   2. signal.size must be a finite positive number
 *   3. signal.price must be a finite positive number
 *   4. signal.symbol must be non-empty
 *   5. signal.sessionId + userId must be present
 *
 * Python equivalent:
 *   def validate_signal(signal) -> bool:
 *     return (signal.type in ('BUY', 'SELL')
 *             and signal.size > 0
 *             and signal.price > 0
 *             and bool(signal.symbol))
 */
export interface ValidationResult {
  valid:    boolean;
  reason?:  string;
}

export function validateSignal(signal: LiveSignal): ValidationResult {
  if (signal.type !== "BUY" && signal.type !== "SELL") {
    return { valid: false, reason: `Unknown signal type "${signal.type}"` };
  }

  if (!Number.isFinite(signal.size) || signal.size <= 0) {
    return { valid: false, reason: `Invalid size ${signal.size}` };
  }

  if (!Number.isFinite(signal.price) || signal.price <= 0) {
    return { valid: false, reason: `Invalid price ${signal.price}` };
  }

  if (!signal.symbol) {
    return { valid: false, reason: "Missing symbol" };
  }

  if (!signal.sessionId || !signal.userId) {
    return { valid: false, reason: "Missing session/user context" };
  }

  return { valid: true };
}

/**
 * SignalProcessor class — wraps `validateSignal` with logging and hooks.
 * Stateless: can be shared across sessions.
 */
export class SignalProcessor {
  process(signal: LiveSignal): ValidationResult {
    return validateSignal(signal);
  }
}
