/**
 * Smart Order Router REST endpoints.
 *
 * POST /sor/quote    — Get a routing quote without executing
 * POST /sor/execute  — Execute order via SOR
 * GET  /sor/history  — Execution history for the authenticated user
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import { requireTradeEnabled } from "../middlewares/kill-switch-guard.js";
import { sorManager } from "../lib/sor-manager.js";

const router = Router();

/* ── Validation ───────────────────────────────────────────────────────────── */

const sorRequestSchema = z.object({
  symbol:           z.string().min(1).toUpperCase(),
  side:             z.enum(["BUY", "SELL"]),
  size:             z.number().positive(),
  maxSlippageBps:   z.number().nonnegative().max(500).optional(),
  maxMarketImpact:  z.number().positive().max(1).optional(),
});

const executeSchema = sorRequestSchema.extend({
  allowPartial: z.boolean().optional().default(false),
});

/* ═══════════════════════════════════════════════════════════════════════════
   QUOTE — routing plan without execution
═══════════════════════════════════════════════════════════════════════════ */

/**
 * POST /api/sor/quote
 *
 * Returns a routing quote: where fills will land, estimated avg price,
 * slippage, and venue allocation — WITHOUT placing any orders.
 */
router.post("/sor/quote", requireAuth, async (req, res) => {
  const parsed = sorRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: parsed.error.issues[0]?.message });
  }

  try {
    const quote = await sorManager.quote(parsed.data);
    res.json({ quote });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Order book unavailable: ${msg}` });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   EXECUTE — full SOR pipeline with ledger recording
═══════════════════════════════════════════════════════════════════════════ */

/**
 * POST /api/sor/execute
 *
 * Full pipeline:
 *   pre-trade checks → aggregate books → route → parallel fill → aggregate → ledger
 */
router.post("/sor/execute", requireAuth, requireTradeEnabled, async (req, res) => {
  const parsed = executeSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: parsed.error.issues[0]?.message });
  }

  try {
    const result = await sorManager.execute({
      ...parsed.data,
      userId: String(req.userId!),
    });

    const statusCode = result.status === "REJECTED" ? 422 : 200;
    res.status(statusCode).json({ result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/sor/history?limit=50
 * Execution history for the authenticated user (most recent first).
 */
router.get("/sor/history", requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const rows = await sorManager.history(String(req.userId!), limit);
    res.json({ executions: rows, count: rows.length });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "SOR error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   ORDER BOOK — consolidated view
═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/sor/orderbook/:symbol
 * Consolidated order book aggregated from all configured exchanges.
 */
router.get("/sor/orderbook/:symbol", requireAuth, async (req, res) => {
  try {
    const quote = await sorManager.quote({
      symbol: req.params.symbol!,
      side:   "BUY",
      size:   0.001,   // tiny size just to get the book
    });

    // Return just the book metadata from the quote
    res.json({
      symbol:         quote.symbol,
      referencePrice: quote.referencePrice,
      exchanges:      Object.keys(quote.venueAllocation).concat(
        // include exchange names from fills
        quote.fills.map((f) => f.exchange)
      ).filter((v, i, a) => a.indexOf(v) === i),
      bestAsk:        quote.fills[0]?.price,
      validForMs:     quote.validForMs,
    });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "SOR upstream error");
    res.status(502).json({ error: "Upstream routing error" });
  }
});

export default router;
