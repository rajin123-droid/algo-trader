/**
 * auth.ts — Authentication and encryption configuration.
 *
 * SESSION_SECRET is the single secret used for:
 *   1. JWT signing (access + refresh tokens)
 *   2. AES-256-GCM key derivation for API key storage
 */

import { env } from "./env.js";

export const authConfig = {
  sessionSecret:  env.SESSION_SECRET,
  accessExpiry:   "15m",
  refreshExpiry:  "7d",
} as const;
