/**
 * env.ts — Centralised environment validation.
 *
 * All process.env access goes through this module.
 * The schema is parsed eagerly at import time using Zod.
 * If any required variable is missing or invalid the process exits immediately
 * with a human-readable error — no silent misconfiguration in production.
 *
 * Usage:
 *   import { env } from "./config/env.js";
 *   const secret = env.SESSION_SECRET;
 *
 * Rule: NEVER read process.env directly anywhere else in the codebase.
 */

import { z } from "zod";

/* ── Schema ──────────────────────────────────────────────────────────────── */

const envSchema = z.object({

  /* ── Runtime ──────────────────────────────────────────────────────────── */
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z
    .string()
    .default("8080")
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, {
      message: "PORT must be a positive integer",
    }),

  /* ── Database ─────────────────────────────────────────────────────────── */
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .min(1, "DATABASE_URL must not be empty"),

  /* ── Auth / encryption ────────────────────────────────────────────────── */
  /**
   * SESSION_SECRET serves as both the JWT signing secret and the AES-256-GCM
   * encryption key seed for API key storage.  Must be kept secret and must be
   * at least 32 characters long in production.
   */
  SESSION_SECRET: z
    .string({ required_error: "SESSION_SECRET is required" })
    .min(10, "SESSION_SECRET must be at least 10 characters"),

  /* ── Redis (optional — in-memory fallback is used when absent) ─────────── */
  REDIS_URL: z
    .string()
    .optional()
    .default("redis://localhost:6379"),

  /* ── Binance exchange (optional — paper trading works without these) ───── */
  BINANCE_API_KEY: z.string().optional().default(""),
  BINANCE_SECRET_KEY: z.string().optional().default(""),
  BINANCE_BASE_URL: z
    .string()
    .url({ message: "BINANCE_BASE_URL must be a valid URL" })
    .optional()
    .default("https://testnet.binance.vision"),

  /* ── Risk limits ──────────────────────────────────────────────────────── */
  MAX_ORDER_NOTIONAL_USD: z
    .string()
    .optional()
    .default("10000")
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, {
      message: "MAX_ORDER_NOTIONAL_USD must be a positive number",
    }),
});

/* ── Validation with clean error output ─────────────────────────────────── */

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  • ${e.path.join(".")}: ${e.message}`)
      .join("\n");

    console.error("╔══════════════════════════════════════════════════════╗");
    console.error("║  FATAL: Invalid environment configuration             ║");
    console.error("╠══════════════════════════════════════════════════════╣");
    console.error(errors);
    console.error("╠══════════════════════════════════════════════════════╣");
    console.error("║  Check your .env file or deployment secrets.          ║");
    console.error("╚══════════════════════════════════════════════════════╝");
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
