/**
 * Binance REST client singleton.
 *
 * Uses @binance/connector (Binance's official Node.js SDK).
 * Reads credentials from environment — never hardcoded.
 *
 * Testnet:  BINANCE_BASE_URL=https://testnet.binance.vision
 * Mainnet:  BINANCE_BASE_URL=https://api.binance.com  (default)
 *
 * If BINANCE_API_KEY / BINANCE_SECRET_KEY are absent the client is still
 * instantiated but all authenticated calls will fail; unauthenticated calls
 * (ping, serverTime, exchangeInfo) still work.
 */

import { Spot } from "@binance/connector";
import { logger } from "../../lib/logger.js";
import { exchangeConfig } from "../../config/exchange.js";

const { apiKey, secretKey, baseURL, hasLiveCredentials: _hasLive } = exchangeConfig;

if (!_hasLive) {
  logger.warn(
    { baseURL },
    "Binance API key / secret not set — live order placement will fail. Set BINANCE_API_KEY and BINANCE_SECRET_KEY."
  );
}

export const binanceClient = new Spot(apiKey, secretKey, { baseURL });

export const BINANCE_BASE_URL = baseURL;

/** True when real credentials are configured. */
export function hasLiveCredentials(): boolean {
  return _hasLive;
}
