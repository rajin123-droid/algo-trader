/**
 * common.ts — Reusable Zod primitives shared across all schemas.
 *
 * Conventions:
 *   • Strings are always trimmed before validation.
 *   • Numbers from HTTP bodies/queries arrive as strings — use z.coerce.number().
 *   • UUIDs are validated with z.string().uuid() — never a raw string.
 */

import { z } from "zod";

/* ── Trading primitives ───────────────────────────────────────────────────── */

/**
 * Trading symbol: BTCUSDT, ETHUSDT, etc.
 * Normalised to uppercase so "btcusdt" is accepted and stored as "BTCUSDT".
 */
export const symbolSchema = z
  .string({ required_error: "symbol is required" })
  .trim()
  .min(3, "symbol must be at least 3 characters")
  .max(20, "symbol must be at most 20 characters")
  .transform((s) => s.toUpperCase());

export const sideSchema = z.enum(["BUY", "SELL"], {
  required_error: "side is required",
  invalid_type_error: "side must be 'BUY' or 'SELL'",
});

export const orderTypeSchema = z.enum(["MARKET", "LIMIT"], {
  invalid_type_error: "type must be 'MARKET' or 'LIMIT'",
});

export const intervalSchema = z.enum(
  ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"],
  { invalid_type_error: "Invalid interval" }
);

/** Positive price — coerces string to number (query-param-safe). */
export const priceSchema = z.coerce
  .number({ invalid_type_error: "price must be a number" })
  .positive("price must be positive");

/** Positive quantity — coerces string to number. */
export const quantitySchema = z.coerce
  .number({ invalid_type_error: "quantity must be a number" })
  .positive("quantity must be positive")
  .max(1_000_000, "quantity exceeds maximum allowed value");

/** Leverage 1–125 (Binance max). Coerces string to integer. */
export const leverageSchema = z.coerce
  .number()
  .int("leverage must be an integer")
  .min(1, "leverage must be at least 1")
  .max(125, "leverage cannot exceed 125")
  .default(1);

/** Risk fraction 0–1 (e.g. 0.02 = 2%). */
export const riskFractionSchema = z.coerce
  .number()
  .min(0, "must be ≥ 0")
  .max(1, "must be ≤ 1 (100%)");

/** Pagination limit — defaults to 50, max 500. */
export const pageLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(500)
  .default(50);

export const pageOffsetSchema = z.coerce.number().int().min(0).default(0);

/* ── Identity primitives ──────────────────────────────────────────────────── */

export const uuidSchema = z.string().uuid("must be a valid UUID");

export const emailSchema = z
  .string({ required_error: "email is required" })
  .trim()
  .toLowerCase()
  .email("must be a valid email address");

export const passwordSchema = z
  .string({ required_error: "password is required" })
  .min(1, "password is required");
