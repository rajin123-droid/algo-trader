/**
 * trade.schema.ts — Validation schemas for manual position management.
 *
 * These guard the /positions/open and /positions/close endpoints.
 * Corrupt or adversarial input here would directly affect the double-entry
 * ledger — strict validation is non-negotiable.
 */

import { z } from "zod";
import {
  symbolSchema,
  sideSchema,
  priceSchema,
  quantitySchema,
  leverageSchema,
} from "./common.js";

/* ── POST /positions/open ─────────────────────────────────────────────────── */

export const openPositionSchema = z
  .object({
    symbol:   symbolSchema,
    side:     sideSchema,
    price:    priceSchema,
    qty:      quantitySchema,
    leverage: leverageSchema,
  })
  .strict();   // reject unknown fields — prevents injection of unexpected DB columns

/* ── POST /positions/close ────────────────────────────────────────────────── */

export const closePositionSchema = z
  .object({
    positionId: z.coerce
      .number({ invalid_type_error: "positionId must be a number" })
      .int("positionId must be an integer")
      .positive("positionId must be positive"),
    price: priceSchema,
  })
  .strict();

/* ── Exported types ───────────────────────────────────────────────────────── */

export type OpenPositionBody  = z.infer<typeof openPositionSchema>;
export type ClosePositionBody = z.infer<typeof closePositionSchema>;
