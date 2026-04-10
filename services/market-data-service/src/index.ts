/**
 * Market Data Service
 *
 * Responsibilities:
 *   - Proxies Binance WebSocket price feeds (order book, ticker, trades)
 *   - Fetches historical OHLCV (klines) for charting
 *   - Publishes PRICE_UPDATE events to the event bus
 *   - Handles geo-restriction fallback with simulated data
 */

export { marketDataRouter } from "./market-data.router.js";
