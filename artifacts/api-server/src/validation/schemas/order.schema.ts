/**
 * order.schema.ts — Validation for the /orders endpoints.
 */

import { z } from "zod";
import { symbolSchema, sideSchema, priceSchema, quantitySchema, leverageSchema } from "./common.js";

const orderTypeSchema = z.enum(["MARKET", "LIMIT", "STOP_LIMIT"], {
  invalid_type_error: "type must be MARKET, LIMIT, or STOP_LIMIT",
  required_error:     "type is required",
});

const orderStatusSchema = z.enum(
  ["PENDING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED"],
  { invalid_type_error: "invalid order status" }
);

/* ── POST /orders ─────────────────────────────────────────────────────────── */

export const createOrderSchema = z
  .object({
    symbol:   symbolSchema,
    side:     sideSchema,
    type:     orderTypeSchema,
    quantity: quantitySchema,

    /** Required for LIMIT and STOP_LIMIT; ignored for MARKET. */
    price: priceSchema.optional(),

    /** "paper" | "live" — default paper */
    mode: z.enum(["paper", "live"]).optional().default("paper"),
  })
  .strict()
  .refine(
    (d) => d.type === "MARKET" || d.price != null,
    { message: "price is required for LIMIT and STOP_LIMIT orders", path: ["price"] }
  );

/* ── GET /orders (query params) ───────────────────────────────────────────── */

export const listOrdersQuerySchema = z.object({
  status: z
    .union([
      orderStatusSchema,
      z.literal("active"),     // shortcut: PENDING + PARTIALLY_FILLED
      z.literal("history"),    // shortcut: FILLED + CANCELLED + REJECTED
    ])
    .optional(),
  symbol:  symbolSchema.optional(),
  side:    sideSchema.optional(),
  limit:   z.coerce.number().int().min(1).max(200).optional().default(50),
  offset:  z.coerce.number().int().min(0).optional().default(0),
});

/* ── DELETE /orders/:id (cancel body) ────────────────────────────────────── */

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export type CreateOrderBody   = z.infer<typeof createOrderSchema>;
export type ListOrdersQuery   = z.infer<typeof listOrdersQuerySchema>;
export type CancelOrderBody   = z.infer<typeof cancelOrderSchema>;
