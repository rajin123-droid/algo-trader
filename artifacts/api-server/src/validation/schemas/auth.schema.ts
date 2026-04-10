/**
 * auth.schema.ts — Zod schemas for authentication request bodies.
 *
 * These validate the raw request before the business-logic layer runs.
 * The password-policy.ts module performs deeper semantic checks (complexity
 * rules) on registration; this schema ensures the types are safe first.
 */

import { z } from "zod";
import { emailSchema, passwordSchema } from "./common.js";

/* ── POST /auth/login ─────────────────────────────────────────────────────── */

export const loginSchema = z
  .object({
    email:    emailSchema,
    password: passwordSchema,
  })
  .strict();

/* ── POST /auth/register ──────────────────────────────────────────────────── */

export const registerSchema = z
  .object({
    email:    emailSchema,
    /** Min 8 chars enforced here; full complexity rules are in password-policy.ts. */
    password: z
      .string({ required_error: "password is required" })
      .min(8, "password must be at least 8 characters"),
  })
  .strict();

/* ── POST /auth/refresh ───────────────────────────────────────────────────── */

export const refreshSchema = z
  .object({
    refreshToken: z
      .string({ required_error: "refreshToken is required" })
      .min(1, "refreshToken must not be empty"),
  })
  .strict();

/* ── Exported types ───────────────────────────────────────────────────────── */

export type LoginBody    = z.infer<typeof loginSchema>;
export type RegisterBody = z.infer<typeof registerSchema>;
export type RefreshBody  = z.infer<typeof refreshSchema>;
