/**
 * auto-trading.schema.ts — Validation schemas for the auto-trading engine.
 *
 * Validates strategy parameters before they enter the execution engine.
 * Bad parameters here can cause runaway losses — every field is bounded.
 */

import { z } from "zod";
import {
  symbolSchema,
  intervalSchema,
  riskFractionSchema,
} from "./common.js";

/* ── POST /auto-trading/start ─────────────────────────────────────────────── */

export const startSessionSchema = z
  .object({
    /** Optional — defaults to "bot" for anonymous sessions. */
    userId: z.string().trim().optional().default("bot"),

    /** Strategy ID from STRATEGY_REGISTRY. Validated against registry in handler. */
    strategy: z
      .string({ required_error: "strategy is required" })
      .trim()
      .min(1, "strategy must not be empty"),

    /** Arbitrary strategy-specific params (validated inside the strategy itself). */
    params: z.record(z.unknown()).optional().default({}),

    symbol:   symbolSchema.optional().default("BTCUSDT"),
    interval: intervalSchema.optional().default("1m"),

    mode: z.enum(["paper", "live"], {
      invalid_type_error: "mode must be 'paper' or 'live'",
    }).optional().default("paper"),

    /** Risk per trade as a fraction of account balance (0.02 = 2%). */
    riskPercent: riskFractionSchema.optional().default(0.02),

    /** Maximum single position size (contracts / coins). */
    maxPositionSize: z.coerce
      .number()
      .positive("maxPositionSize must be positive")
      .max(10_000, "maxPositionSize exceeds safe limit")
      .optional()
      .default(1),

    /** Maximum number of new trades opened per minute. */
    maxTradesPerMinute: z.coerce
      .number()
      .int("maxTradesPerMinute must be an integer")
      .min(1, "maxTradesPerMinute must be at least 1")
      .max(60, "maxTradesPerMinute cannot exceed 60")
      .optional()
      .default(3),

    /** Maximum total loss per calendar day in USD. Triggers circuit breaker. */
    maxDailyLoss: z.coerce
      .number()
      .positive("maxDailyLoss must be positive")
      .max(1_000_000, "maxDailyLoss exceeds safe limit")
      .optional()
      .default(100),

    /** Stop-loss distance as a fraction of entry price (0.01 = 1%). */
    stopLossPercent: riskFractionSchema.optional().default(0.01),

    /** Take-profit distance as a fraction of entry price (0.02 = 2%). */
    takeProfitPercent: riskFractionSchema.optional().default(0.02),
  });
  // Note: NOT strict() — strategy params field is a free-form object,
  // and downstream handlers may add valid computed fields.

/* ── POST /auto-trading/stop ──────────────────────────────────────────────── */

export const stopSessionSchema = z
  .object({
    sessionId: z
      .string({ required_error: "sessionId is required" })
      .trim()
      .min(1, "sessionId must not be empty"),

    userId: z.string().trim().optional().default("bot"),
  })
  .strict();

/* ── POST /auto-trading/sessions/:id/mode ─────────────────────────────────── */

export const switchModeSchema = z
  .object({
    mode: z.enum(["paper", "live"], {
      required_error: "mode is required",
      invalid_type_error: "mode must be 'paper' or 'live'",
    }),
  })
  .strict();

/* ── Exported types ───────────────────────────────────────────────────────── */

export type StartSessionBody  = z.infer<typeof startSessionSchema>;
export type StopSessionBody   = z.infer<typeof stopSessionSchema>;
export type SwitchModeBody    = z.infer<typeof switchModeSchema>;
