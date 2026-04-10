/**
 * binance-market-ws.ts
 *
 * Connects to Binance's public combined WebSocket stream and feeds
 * real aggTrade ticks into the internal candle/price infrastructure.
 *
 * Data flow:
 *   Binance aggTrade stream
 *       ↓  processAggTrade()
 *   processTrade()            → builds live OHLCV candles in-memory
 *       ↓
 *   publishCandleUpdate()     → broadcasts CANDLE_UPDATE to WS clients
 *                               + fires inProcessBus → auto-trading engines
 *       ↓
 *   priceSimulator.setPrice() → keeps PositionWatcher SL/TP evaluation real
 *
 * Fallback behaviour:
 *   If Binance is geo-restricted or unreachable (Replit free tier), the
 *   connection silently fails and the auto-trading manager falls back to the
 *   GBM price-simulator for candle generation, which it already does today.
 *
 * Reconnect strategy: exponential backoff (1 s → 2 s → 4 s … capped at 30 s).
 */

import { WebSocket } from "ws";
import { INTERVALS, processTrade } from "../lib/candle.service.js";
import { publishCandleUpdate } from "../lib/ws-publisher.js";
import { priceSimulator } from "../lib/price-simulator.js";
import { broadcast } from "../lib/ws-server.js";
import { logger } from "../lib/logger.js";

/* ── Config ──────────────────────────────────────────────────────────────── */

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

const STREAMS = SYMBOLS.map((s) => `${s.toLowerCase()}@aggTrade`).join("/");
const BINANCE_WS_URL = `wss://stream.binance.com:9443/stream?streams=${STREAMS}`;

/** Throttle PRICE_UPDATE broadcasts to avoid flooding WS clients. */
const PRICE_BROADCAST_THROTTLE_MS = 500;

/* ── State ───────────────────────────────────────────────────────────────── */

/** Symbol → latest real price from Binance. */
const marketPrices = new Map<string, number>();

/** Per-symbol last broadcast timestamp, for throttling. */
const lastPriceBroadcast = new Map<string, number>();

let activeWs: WebSocket | null = null;
let wsConnected = false;
let stopped = false;
let reconnectDelay = 1_000;
const MAX_RECONNECT_DELAY = 30_000;

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Return the latest real Binance price for `symbol`, or 0 if not yet received.
 * Used by auto-trading-manager's PositionWatcher as the preferred price source.
 */
export function getMarketPrice(symbol: string): number {
  return marketPrices.get(symbol.toUpperCase()) ?? 0;
}

/** True if the Binance WS is currently connected and streaming. */
export function isBinanceMarketWsConnected(): boolean {
  return wsConnected;
}

/* ── Core processing ─────────────────────────────────────────────────────── */

interface AggTradeMsg {
  s: string;   // symbol, e.g. "BTCUSDT"
  p: string;   // price as string
  q: string;   // quantity as string
  T: number;   // trade time (ms)
  m: boolean;  // true = market maker (SELL side)
}

function processAggTrade(msg: AggTradeMsg): void {
  const symbol   = msg.s.toUpperCase();
  const price    = Number(msg.p) || 0;
  const quantity = Number(msg.q) || 0;

  if (!price) return;

  // 1. Update real-time price map
  marketPrices.set(symbol, price);

  // 2. Sync priceSimulator so PositionWatcher SL/TP uses real prices
  priceSimulator.setPrice(symbol, price);

  // 3. Feed into candle service for every supported interval.
  //    processTrade() returns the updated live candle; publishCandleUpdate()
  //    fans it out to WS clients AND the auto-trading engines (via inProcessBus).
  const trade = { symbol, price, quantity, timestamp: msg.T };

  for (const interval of Object.keys(INTERVALS)) {
    const candle = processTrade(trade, interval);
    publishCandleUpdate(symbol, interval, candle).catch((err: unknown) => {
      logger.debug({ err, symbol, interval }, "publishCandleUpdate error (ignored)");
    });
  }

  // 4. Throttled PRICE_UPDATE broadcast to all subscribed WS clients.
  //    Useful for connected browser tabs that listen to our gateway WS
  //    but can't reach Binance directly.
  const now = Date.now();
  const last = lastPriceBroadcast.get(symbol) ?? 0;
  if (now - last >= PRICE_BROADCAST_THROTTLE_MS) {
    lastPriceBroadcast.set(symbol, now);
    broadcast(symbol, { type: "PRICE_UPDATE", data: price }, false);
  }
}

/* ── Connection management ───────────────────────────────────────────────── */

function connect(): void {
  if (stopped) return;

  logger.info({ url: BINANCE_WS_URL }, "Connecting to Binance combined aggTrade stream");

  const ws = new WebSocket(BINANCE_WS_URL, {
    handshakeTimeout: 15_000,
  });
  activeWs = ws;

  ws.on("open", () => {
    wsConnected = true;
    reconnectDelay = 1_000; // reset backoff on successful connect
    logger.info(
      { symbols: SYMBOLS.join(", ") },
      "Binance market-data WS connected — real price feed ACTIVE"
    );
  });

  ws.on("message", (raw: Buffer) => {
    try {
      const envelope = JSON.parse(raw.toString()) as {
        stream: string;
        data: Record<string, unknown>;
      };

      const data = envelope.data;

      // Combined stream wraps each payload in { stream, data }.
      // Only process aggTrade events (e === "aggTrade").
      if (data && data["e"] === "aggTrade") {
        processAggTrade(data as unknown as AggTradeMsg);
      }
    } catch {
      // Silently drop malformed frames — never crash the feed
    }
  });

  ws.on("close", (code, reason) => {
    wsConnected = false;
    activeWs = null;
    if (stopped) return;

    const reasonStr = reason?.toString() ?? "";
    logger.warn(
      { code, reason: reasonStr, nextRetryMs: reconnectDelay },
      "Binance market-data WS closed — scheduling reconnect"
    );
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  });

  ws.on("error", (err: Error) => {
    // Log at debug level: connection errors are expected in geo-restricted envs.
    logger.debug(
      { message: err.message },
      "Binance market-data WS error — will reconnect on close"
    );
    // Don't call ws.close() — the 'close' event fires automatically after an error.
  });
}

/* ── Lifecycle ───────────────────────────────────────────────────────────── */

/**
 * Start the Binance market-data WebSocket.
 *
 * Called once at server boot. If the connection fails (geo-restricted or
 * network error), the auto-trading manager continues using the GBM simulator
 * as a fallback — no explicit error is propagated.
 */
export function startBinanceMarketWS(): void {
  stopped = false;
  connect();
}

/**
 * Gracefully stop the Binance market-data WebSocket.
 * Exported for clean shutdown in tests / process signals.
 */
export function stopBinanceMarketWS(): void {
  stopped = true;
  wsConnected = false;
  if (activeWs) {
    activeWs.terminate();
    activeWs = null;
  }
}
