/**
 * Exchange routes — Binance adapter management
 *
 * GET  /exchange/status            — ping + credentials check
 * GET  /exchange/balance           — real exchange account balances
 * GET  /exchange/order/:sym/:id    — query order status by Binance orderId
 * POST /auto-trading/sessions/:id/mode  — switch paper ↔ live
 *
 * All authenticated routes require a valid JWT.
 * Live order queries additionally check credentials are configured.
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth.js";
import { orderRouter } from "../exchange/order-router.js";
import { hasLiveCredentials } from "../exchange/binance/binance.client.js";
import { getOrderStatus } from "../exchange/binance/binance.service.js";
import { autoTradingManager } from "../lib/auto-trading-manager.js";
import { BINANCE_BASE_URL } from "../exchange/binance/binance.client.js";
import { logger } from "../lib/logger.js";
import {
  isBinanceMarketWsConnected,
  getMarketPrice,
} from "../market/binance-market-ws.js";

const router = Router();

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * GET /exchange/status
 * Connectivity + credentials health check. Does NOT require live credentials.
 */
router.get("/exchange/status", requireAuth, async (_req, res) => {
  const credentialsOk = hasLiveCredentials();
  const canGoLive     = orderRouter.canGoLive;

  try {
    const ping = await orderRouter.ping();
    res.json({
      connected:      true,
      serverTime:     ping.serverTime,
      latencyMs:      ping.latencyMs,
      credentialsOk,
      canGoLive,
      baseURL:        BINANCE_BASE_URL,
      network:        BINANCE_BASE_URL.includes("testnet") ? "TESTNET" : "MAINNET",
    });
  } catch (err) {
    res.json({
      connected:    false,
      credentialsOk,
      canGoLive:    false,
      baseURL:      BINANCE_BASE_URL,
      network:      BINANCE_BASE_URL.includes("testnet") ? "TESTNET" : "MAINNET",
      error:        err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /exchange/balance
 * Fetch real asset balances from Binance. Requires live credentials.
 */
router.get("/exchange/balance", requireAuth, async (_req, res) => {
  if (!hasLiveCredentials()) {
    res.status(503).json({
      error: "Binance credentials not configured. Set BINANCE_API_KEY and BINANCE_SECRET_KEY.",
    });
    return;
  }

  try {
    const balances = await orderRouter.getBalances();
    res.json({ balances, fetchedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "Failed to fetch exchange balances");
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /exchange/order/:symbol/:orderId
 * Query the status of a previously-placed order.
 */
router.get("/exchange/order/:symbol/:orderId", requireAuth, async (req, res) => {
  if (!hasLiveCredentials()) {
    res.status(503).json({ error: "Binance credentials not configured." });
    return;
  }

  const { symbol, orderId } = req.params as { symbol: string; orderId: string };

  try {
    const status = await getOrderStatus(symbol.toUpperCase(), orderId);
    res.json(status);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /auto-trading/sessions/:id/mode
 * Switch a session between paper (simulated) and live (real exchange).
 *
 * Body: { mode: "paper" | "live" }
 *
 * Switching to "live" without credentials configured returns 409.
 */
router.post("/auto-trading/sessions/:id/mode", requireAuth, async (req, res) => {
  const sessionId = req.params["id"]!;
  const userId    = String((req as any).userId ?? "");

  const { mode } = z.object({
    mode: z.enum(["paper", "live"]),
  }).parse(req.body);

  // Guard: refuse live mode without credentials
  if (mode === "live" && !hasLiveCredentials()) {
    res.status(409).json({
      error: "Cannot switch to live mode — Binance credentials not configured.",
      hint:  "Set BINANCE_API_KEY and BINANCE_SECRET_KEY (and optionally BINANCE_BASE_URL for testnet).",
    });
    return;
  }

  try {
    const updated = await autoTradingManager.switchMode(sessionId, userId, mode);
    res.json({
      sessionId,
      mode:      updated.mode,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Session not found") {
      res.status(404).json({ error: "Session not found" });
    } else {
      logger.error({ err, sessionId, userId }, "Mode switch failed");
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/* ── GET /market/status ───────────────────────────────────────────────────── */
/**
 * Returns real-time market data connection status and latest prices.
 * Public endpoint — no authentication required.
 */
router.get("/market/status", (_req, res) => {
  const connected = isBinanceMarketWsConnected();
  const symbols   = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

  const prices = Object.fromEntries(
    symbols.map((s) => [s, getMarketPrice(s)])
  );

  res.json({
    connected,
    source: connected ? "binance_ws" : "simulator",
    symbols,
    prices,
    timestamp: new Date().toISOString(),
  });
});

export default router;
