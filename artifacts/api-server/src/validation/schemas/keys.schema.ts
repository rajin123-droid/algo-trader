/**
 * keys.schema.ts — Validation schemas for exchange API key management.
 *
 * API keys are stored AES-256-GCM encrypted. Validation here ensures only
 * well-formed key material enters the encryption + storage pipeline.
 *
 * Binance API key format: 64-character alphanumeric string.
 * Binance secret format:  64-character alphanumeric string.
 * (We allow slightly looser bounds to accommodate future key format changes.)
 */

import { z } from "zod";

export const saveBinanceKeysSchema = z
  .object({
    apiKey: z
      .string({ required_error: "apiKey is required" })
      .trim()
      .min(8,   "apiKey is too short")
      .max(256, "apiKey is too long"),

    apiSecret: z
      .string({ required_error: "apiSecret is required" })
      .trim()
      .min(8,   "apiSecret is too short")
      .max(256, "apiSecret is too long"),

    testnet: z.boolean().optional().default(true),
  })
  .strict();

export type SaveBinanceKeysBody = z.infer<typeof saveBinanceKeysSchema>;
