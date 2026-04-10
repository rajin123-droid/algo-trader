import { Router } from "express";
import { db } from "@workspace/db";
import {
  autoTradingSessionsTable,
  autoTradesTable,
  type AutoTradingSession,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { autoTradingManager } from "../lib/auto-trading-manager.js";
import { requireTradeEnabled } from "../middlewares/kill-switch-guard.js";
import { STRATEGY_REGISTRY } from "../../../../services/strategy-engine/src/index.js";
import {
  validate,
  startSessionSchema,
  stopSessionSchema,
} from "../validation/index.js";
import { tradingLimiter } from "../middlewares/rate-limiter.js";
import { logger, requestLogger } from "../lib/logger.js";

const router = Router();

/* ── Field normaliser ─────────────────────────────────────────────────────── */
/**
 * The DB schema uses signal/size/entryPrice/exitPrice to keep the column
 * names accurate for the audit log. The frontend AutoTrade type uses the
 * more conventional side/quantity/price. We map here so the API contract
 * is stable regardless of internal DB column names.
 */
function normaliseTrade(
  t: typeof autoTradesTable.$inferSelect & { sessionSymbol?: string | null }
) {
  return {
    id:           t.id,
    sessionId:    t.sessionId,
    userId:       t.userId,
    symbol:       t.sessionSymbol ?? "BTCUSDT",
    side:         t.signal as "BUY" | "SELL",
    price:        t.entryPrice ?? t.exitPrice ?? 0,
    entryPrice:   t.entryPrice ?? 0,
    exitPrice:    t.exitPrice  ?? 0,
    quantity:     t.size,
    pnl:          t.pnl  ?? 0,
    stopLoss:     t.stopLoss   ?? null,
    takeProfit:   t.takeProfit ?? null,
    closeReason:  t.closeReason ?? null,
    status:       t.status,
    blockedReason: t.blockedReason ?? null,
    executedAt:   t.executedAt,
  };
}

/** Map DB session row to API shape expected by the frontend. */
function normaliseSession(row: AutoTradingSession) {
  return {
    ...row,
    isActive: row.enabled,
  };
}

/* ── POST /api/auto-trading/start ─────────────────────────────────────────── */
router.post("/auto-trading/start", requireTradeEnabled, tradingLimiter, validate(startSessionSchema), async (req, res) => {
  const {
    userId,
    strategy:          strategyId,
    params,
    symbol,
    interval,
    mode,
    riskPercent,
    maxPositionSize,
    maxTradesPerMinute,
    maxDailyLoss,
    stopLossPercent,
    takeProfitPercent,
  } = req.body;

  if (!STRATEGY_REGISTRY[strategyId]) {
    res.status(400).json({
      error:    `Unknown strategy "${strategyId}"`,
      available: Object.keys(STRATEGY_REGISTRY),
    });
    return;
  }

  const log = requestLogger(req.reqId ?? "");
  log.info({ userId, strategyId, symbol, interval, mode, riskPercent }, "Auto-trading session start requested");

  try {
    const { createStrategy } = await import(
      "../../../../services/strategy-engine/src/index.js"
    );
    createStrategy(strategyId, params);

    const session = await autoTradingManager.createAndStart({
      userId,
      strategyId,
      strategyParams:     params,
      symbol,
      interval,
      mode,
      riskPercent,
      maxPositionSize,
      maxTradesPerMinute,
      maxDailyLoss,
      stopLossPercent,
      takeProfitPercent,
    });

    log.info({
      event:      "session_started",
      sessionId:  session.id,
      userId,
      strategyId,
      symbol,
      mode,
    }, "Auto-trading session started");

    res.status(201).json({
      sessionId: session.id,
      status:    "started",
      session:   normaliseSession(session),
    });
  } catch (err) {
    log.error({ err, userId, strategyId, symbol }, "Auto-trading session start failed");
    res.status(500).json({ error: "Failed to start session" });
  }
});

/* ── POST /api/auto-trading/stop ──────────────────────────────────────────── */
router.post("/auto-trading/stop", validate(stopSessionSchema), async (req, res) => {
  const { sessionId, userId } = req.body;
  const log = requestLogger(req.reqId ?? "");

  try {
    await autoTradingManager.stopAndDisable(sessionId, userId);
    log.info({ event: "session_stopped", sessionId, userId }, "Auto-trading session stopped");
    res.json({ sessionId, status: "stopped" });
  } catch (err) {
    log.warn({ err, sessionId, userId }, "Auto-trading session stop failed");
    res.status(404).json({ error: (err as Error).message });
  }
});

/* ── GET /api/auto-trading/status ─────────────────────────────────────────── */
router.get("/auto-trading/status", async (req, res) => {
  const userId = req.query["userId"] as string | undefined;

  const liveEngines = autoTradingManager.getStatus();

  const dbSessions = userId
    ? await db
        .select()
        .from(autoTradingSessionsTable)
        .where(eq(autoTradingSessionsTable.userId, userId))
        .orderBy(desc(autoTradingSessionsTable.createdAt))
    : await db
        .select()
        .from(autoTradingSessionsTable)
        .orderBy(desc(autoTradingSessionsTable.createdAt));

  res.json({
    activeEngines: liveEngines.length,
    engines:       liveEngines,
    sessions:      dbSessions.map(normaliseSession),
  });
});

/* ── GET /api/auto-trading/trades ─────────────────────────────────────────── */
router.get("/auto-trading/trades", async (req, res) => {
  const sessionId = req.query["sessionId"] as string | undefined;
  const userId    = req.query["userId"]    as string | undefined;
  const limit     = Math.min(Number(req.query["limit"]) || 100, 1_000);

  const conditions = [];
  if (sessionId) conditions.push(eq(autoTradesTable.sessionId, sessionId));
  if (userId)    conditions.push(eq(autoTradesTable.userId, userId));

  const rawTrades = await db
    .select()
    .from(autoTradesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(autoTradesTable.executedAt))
    .limit(limit);

  if (rawTrades.length === 0) {
    res.json({ count: 0, trades: [] });
    return;
  }

  const sessionIds = [...new Set(rawTrades.map((t) => t.sessionId))];
  const sessions = await db
    .select({ id: autoTradingSessionsTable.id, symbol: autoTradingSessionsTable.symbol })
    .from(autoTradingSessionsTable)
    .where(inArray(autoTradingSessionsTable.id, sessionIds));

  const symbolById = new Map(sessions.map((s) => [s.id, s.symbol]));

  const trades = rawTrades.map((t) =>
    normaliseTrade({ ...t, sessionSymbol: symbolById.get(t.sessionId) ?? "BTCUSDT" })
  );

  res.json({ count: trades.length, trades });
});

/* ── GET /api/auto-trading/sessions ──────────────────────────────────────── */
router.get("/auto-trading/sessions", async (req, res) => {
  const userId = req.query["userId"] as string | undefined;

  const sessions = userId
    ? await db
        .select()
        .from(autoTradingSessionsTable)
        .where(eq(autoTradingSessionsTable.userId, userId))
        .orderBy(desc(autoTradingSessionsTable.createdAt))
    : await db
        .select()
        .from(autoTradingSessionsTable)
        .orderBy(desc(autoTradingSessionsTable.createdAt));

  res.json({ count: sessions.length, sessions: sessions.map(normaliseSession) });
});

export default router;
