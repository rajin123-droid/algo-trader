import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, userPositionsTable, userTradeHistoryTable, apiKeysTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { tradingLimiter } from "../middlewares/rate-limiter.js";
import {
  placeFuturesOrder,
  fillPrice,
  type BinanceFuturesClientOptions,
} from "../lib/binance-futures.js";
import { safeDecrypt } from "../lib/encryption.js";
import { publishTrade, publishPortfolioUpdate } from "../lib/ws-publisher.js";
import { sendToUser } from "../lib/ws-server.js";
import { logger, requestLogger } from "../lib/logger.js";
import {
  ensureStartingBalance,
  recordPositionOpen,
  recordPositionClose,
} from "../lib/trade-ledger.js";
import { validate, openPositionSchema, closePositionSchema } from "../validation/index.js";
import { createAndFill } from "../lib/order-lifecycle.js";

const router: IRouter = Router();

async function getUserKeys(
  userId: number
): Promise<BinanceFuturesClientOptions | null> {
  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(
      and(
        eq(apiKeysTable.userId, userId),
        eq(apiKeysTable.exchange, "binance")
      )
    )
    .limit(1);

  return row
    ? {
        apiKey: safeDecrypt(row.apiKey),
        apiSecret: safeDecrypt(row.apiSecret),
        testnet: row.testnet,
      }
    : null;
}

router.post("/positions/open", requireAuth, tradingLimiter, validate(openPositionSchema), async (req, res): Promise<void> => {
  const { symbol, price, qty, side, leverage } = req.body;
  const userId = req.userId!;
  const log = requestLogger(req.reqId ?? "");

  let entryPrice = price;
  let binanceOrder: Record<string, unknown> | null = null;
  let mode: "live" | "paper" = "paper";

  const keys = await getUserKeys(userId);
  if (keys) {
    log.info({ userId, symbol, side, qty, leverage }, "Placing Binance futures order");
    try {
      const order = await placeFuturesOrder(keys, {
        symbol,
        side,
        type: "MARKET",
        quantity: qty,
      });
      entryPrice = fillPrice(order, entryPrice);
      binanceOrder = order as unknown as Record<string, unknown>;
      mode = "live";
      log.info({ userId, symbol, fillPrice: entryPrice, orderId: (order as {orderId?: unknown}).orderId }, "Binance order filled");
    } catch (err: unknown) {
      log.warn({ err, userId, symbol, side, qty }, "Binance order failed — rejecting position open");
      const msg = err instanceof Error ? err.message : "Binance error";
      res.status(400).json({ error: msg });
      return;
    }
  }

  // ── Provision starting balance for new paper-trading users ───────────────
  await ensureStartingBalance(String(userId));

  const [pos] = await db
    .insert(userPositionsTable)
    .values({
      userId,
      symbol,
      entryPrice,
      quantity: qty,
      side,
      leverage,
    })
    .returning();

  const notional = pos.quantity * pos.entryPrice;
  const margin = notional / pos.leverage;
  const liqPrice =
    pos.side === "BUY"
      ? pos.entryPrice * (1 - 1 / pos.leverage)
      : pos.entryPrice * (1 + 1 / pos.leverage);

  const positionPayload = { ...pos, notional, margin, liqPrice };

  // ── Record in double-entry ledger (margin deducted from USDT) ────────────
  await recordPositionOpen(
    String(userId),
    pos.id,
    pos.entryPrice,
    pos.quantity,
    pos.leverage
  );

  // ── Create order record (lifecycle tracking) ─────────────────────────────
  createAndFill(
    {
      userId:          String(userId),
      symbol:          pos.symbol,
      side:            pos.side as "BUY" | "SELL",
      type:            "MARKET",
      quantity:        pos.quantity,
      price:           pos.entryPrice,
      mode,
      exchangeOrderId: binanceOrder ? String((binanceOrder as Record<string,unknown>)["orderId"] ?? "") : undefined,
    },
    pos.entryPrice
  ).catch((err) => logger.warn({ err }, "createAndFill failed after position open — non-critical"));

  // ── Broadcast to all symbol subscribers (recent trades feed) ─────────────
  publishTrade({
    symbol: pos.symbol,
    side: pos.side,
    price: pos.entryPrice,
    quantity: pos.quantity,
    orderId: String(pos.id),
    userId: String(userId),
    executedAt: pos.createdAt,
  }).catch((err) => logger.warn({ err }, "publishTrade failed after position open"));

  // ── Notify this specific user — triggers PositionsPage live refresh ───────
  sendToUser(String(userId), {
    type: "ORDER_FILLED",
    data: { action: "OPEN", position: positionPayload, mode },
  });

  // ── Push updated portfolio balances to user ───────────────────────────────
  publishPortfolioUpdate(String(userId)).catch((err) =>
    logger.warn({ err }, "publishPortfolioUpdate failed after position open")
  );

  log.info({
    event:      "position_opened",
    positionId:  pos.id,
    userId,
    symbol:      pos.symbol,
    side:        pos.side,
    entryPrice:  pos.entryPrice,
    qty:         pos.quantity,
    leverage:    pos.leverage,
    notional,
    margin,
    mode,
  }, "Position opened");

  res.status(201).json({
    msg: "Position opened",
    mode,
    position: positionPayload,
    ...(binanceOrder && { binanceOrder }),
  });
});

router.post("/positions/close", requireAuth, tradingLimiter, validate(closePositionSchema), async (req, res): Promise<void> => {
  const { positionId, price } = req.body;
  const userId = req.userId!;
  const log = requestLogger(req.reqId ?? "");

  const [pos] = await db
    .select()
    .from(userPositionsTable)
    .where(eq(userPositionsTable.id, positionId))
    .limit(1);

  if (!pos) {
    res.status(404).json({ error: "Position not found" });
    return;
  }

  if (pos.userId !== userId) {
    res.status(403).json({ error: "Not your position" });
    return;
  }

  let exitPrice = price;
  let binanceOrder: Record<string, unknown> | null = null;
  let mode: "live" | "paper" = "paper";

  const keys = await getUserKeys(userId);
  if (keys) {
    const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
    log.info({ userId, symbol: pos.symbol, side: closeSide, qty: pos.quantity }, "Placing Binance close order");
    try {
      const order = await placeFuturesOrder(keys, {
        symbol: pos.symbol,
        side: closeSide,
        type: "MARKET",
        quantity: pos.quantity,
      });
      exitPrice = fillPrice(order, exitPrice);
      binanceOrder = order as unknown as Record<string, unknown>;
      mode = "live";
      log.info({ userId, symbol: pos.symbol, fillPrice: exitPrice }, "Binance close order filled");
    } catch (err: unknown) {
      log.warn({ err, userId, positionId, symbol: pos.symbol }, "Binance close order failed");
      const msg = err instanceof Error ? err.message : "Binance error";
      res.status(400).json({ error: msg });
      return;
    }
  }

  const pnl =
    pos.side === "BUY"
      ? (exitPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - exitPrice) * pos.quantity;

  const [trade] = await db
    .insert(userTradeHistoryTable)
    .values({
      userId,
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice,
      quantity: pos.quantity,
      pnl,
      leverage: pos.leverage,
    })
    .returning();

  await db
    .delete(userPositionsTable)
    .where(eq(userPositionsTable.id, pos.id));

  // ── Record close in double-entry ledger (payout returned to USDT) ─────────
  const openMargin = (pos.entryPrice * pos.quantity) / Math.max(pos.leverage, 1);
  await recordPositionClose(String(userId), pos.id, openMargin, pnl);

  // ── Create order record for the close (lifecycle tracking) ──────────────
  const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
  createAndFill(
    {
      userId:          String(userId),
      symbol:          pos.symbol,
      side:            closeSide as "BUY" | "SELL",
      type:            "MARKET",
      quantity:        pos.quantity,
      price:           exitPrice,
      mode,
      exchangeOrderId: binanceOrder ? String((binanceOrder as Record<string,unknown>)["orderId"] ?? "") : undefined,
    },
    exitPrice
  ).catch((err) => logger.warn({ err }, "createAndFill failed after position close — non-critical"));

  // ── Broadcast close fill to all symbol subscribers ────────────────────────
  publishTrade({
    symbol: pos.symbol,
    side: closeSide,
    price: exitPrice,
    quantity: pos.quantity,
    orderId: String(trade.id),
    userId: String(userId),
    executedAt: trade.createdAt,
  }).catch((err) => logger.warn({ err }, "publishTrade failed after position close"));

  // ── Notify user — ORDER_FILLED on close triggers positions list refresh ────
  sendToUser(String(userId), {
    type: "ORDER_FILLED",
    data: { action: "CLOSE", positionId: pos.id, pnl, trade, mode },
  });

  // ── Push updated portfolio balances ───────────────────────────────────────
  publishPortfolioUpdate(String(userId)).catch((err) =>
    logger.warn({ err }, "publishPortfolioUpdate failed after position close")
  );

  log.info({
    event:       "position_closed",
    positionId:  pos.id,
    userId,
    symbol:      pos.symbol,
    side:        pos.side,
    entryPrice:  pos.entryPrice,
    exitPrice,
    qty:         pos.quantity,
    pnl:         Number(pnl.toFixed(4)),
    mode,
  }, "Position closed");

  res.json({
    msg: "Position closed",
    mode,
    pnl,
    trade,
    ...(binanceOrder && { binanceOrder }),
  });
});

router.get("/positions", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  const positions = await db
    .select()
    .from(userPositionsTable)
    .where(eq(userPositionsTable.userId, userId))
    .orderBy(desc(userPositionsTable.createdAt));

  res.json(positions);
});

router.get("/user-trades", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  const history = await db
    .select()
    .from(userTradeHistoryTable)
    .where(eq(userTradeHistoryTable.userId, userId))
    .orderBy(desc(userTradeHistoryTable.createdAt))
    .limit(100);

  res.json(history);
});

export default router;
