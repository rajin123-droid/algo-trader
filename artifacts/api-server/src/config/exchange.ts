/**
 * exchange.ts — Exchange adapter configuration derived from the validated env.
 *
 * `hasLiveCredentials` is the authoritative check used by the order router
 * and reconciliation scheduler to decide whether to attempt real order placement.
 */

import { env } from "./env.js";

export const exchangeConfig = {
  apiKey:              env.BINANCE_API_KEY,
  secretKey:           env.BINANCE_SECRET_KEY,
  baseURL:             env.BINANCE_BASE_URL,
  maxOrderNotionalUsd: Number(env.MAX_ORDER_NOTIONAL_USD),

  /** True only when both API key and secret are present and non-empty. */
  hasLiveCredentials:
    env.BINANCE_API_KEY.length > 0 && env.BINANCE_SECRET_KEY.length > 0,
} as const;
