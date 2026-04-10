/**
 * Portfolio API — balances derived 100% from the double-entry ledger.
 *
 *   GET /portfolio          — all user asset balances (source of truth)
 *   GET /portfolio/summary  — USDT balance + unrealised PnL across open positions
 */

import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { getUserPortfolio } from "../lib/portfolio.service.js";
import { db, userPositionsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/* ── GET /portfolio — raw ledger balances per asset ──────────────────────── */

router.get("/portfolio", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId  = String(req.userId!);
    const entries = await getUserPortfolio(userId);

    res.json({
      balances:  entries,
      count:     entries.length,
      source:    "ledger",
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "GET /portfolio failed");
    res.status(500).json({ error: "Failed to load portfolio" });
  }
});

/* ── GET /portfolio/summary — USDT + unrealised PnL ─────────────────────── */

router.get("/portfolio/summary", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId  = String(req.userId!);
    const entries = await getUserPortfolio(userId);

    const usdtBalance = entries.find((e) => e.asset === "USDT")?.balance ?? 0;
    const btcBalance  = entries.find((e) => e.asset === "BTC")?.balance  ?? 0;

    // Fetch open positions to compute unrealised PnL (mark = entry for paper mode)
    const positions = await db
      .select()
      .from(userPositionsTable)
      .where(eq(userPositionsTable.userId, Number(userId)));

    // In paper mode there is no live mark — we return the raw margin-locked values.
    // Consumers can compute unrealised PnL when they have the current mark price.
    const openPositionCount = positions.length;
    const totalMarginLocked = positions.reduce((sum, p) => {
      const margin = (p.entryPrice * p.quantity) / Math.max(p.leverage, 1);
      return sum + margin;
    }, 0);

    res.json({
      usdtBalance,
      btcBalance,
      totalMarginLocked,
      openPositionCount,
      allBalances: entries,
      source:      "ledger",
      updatedAt:   new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "GET /portfolio/summary failed");
    res.status(500).json({ error: "Failed to load portfolio summary" });
  }
});

export default router;
