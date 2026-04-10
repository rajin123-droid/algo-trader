import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, userPositionsTable, userTradeHistoryTable, apiKeysTable } from "@workspace/db";
import { requireAuth } from "../../auth-service/src/middleware.js";
import {
  placeFuturesOrder,
  fillPrice,
  type BinanceFuturesClientOptions,
} from "../../trading-engine/src/binance-futures.js";
import { safeDecrypt } from "../../auth-service/src/encryption.js";
import { publish } from "@workspace/event-bus";

export const positionsRouter: IRouter = Router();

async function getUserKeys(userId: number): Promise<BinanceFuturesClientOptions | null> {
  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.exchange, "binance")))
    .limit(1);

  return row
    ? { apiKey: safeDecrypt(row.apiKey), apiSecret: safeDecrypt(row.apiSecret), testnet: row.testnet }
    : null;
}

positionsRouter.post("/positions/open", requireAuth, async (req, res): Promise<void> => {
  const { symbol, price, qty, side, leverage = 1 } = req.body ?? {};
  const userId = req.userId!;

  if (!symbol || !price || !qty || !side) {
    res.status(400).json({ error: "Missing required fields: symbol, price, qty, side" });
    return;
  }

  if (!["BUY", "SELL"].includes(side)) {
    res.status(400).json({ error: "side must be BUY or SELL" });
    return;
  }

  let entryPrice = Number(price);
  let binanceOrder: Record<string, unknown> | null = null;
  let mode: "live" | "paper" = "paper";

  const keys = await getUserKeys(userId);
  if (keys) {
    try {
      const order = await placeFuturesOrder(keys, { symbol, side, type: "MARKET", quantity: Number(qty) });
      entryPrice = fillPrice(order, entryPrice);
      binanceOrder = order as unknown as Record<string, unknown>;
      mode = "live";
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Binance error" });
      return;
    }
  }

  const [pos] = await db
    .insert(userPositionsTable)
    .values({ userId, symbol, entryPrice, quantity: Number(qty), side, leverage: Number(leverage) })
    .returning();

  const notional = pos.quantity * pos.entryPrice;
  const margin = notional / pos.leverage;
  const liqPrice =
    pos.side === "BUY"
      ? pos.entryPrice * (1 - 1 / pos.leverage)
      : pos.entryPrice * (1 + 1 / pos.leverage);

  await publish("POSITION_OPENED", { userId, positionId: pos.id, symbol, side, entryPrice, mode });

  res.status(201).json({
    msg: "Position opened",
    mode,
    position: { ...pos, notional, margin, liqPrice },
    ...(binanceOrder && { binanceOrder }),
  });
});

positionsRouter.post("/positions/close", requireAuth, async (req, res): Promise<void> => {
  const { positionId, price } = req.body ?? {};
  const userId = req.userId!;

  if (!positionId || !price) {
    res.status(400).json({ error: "Missing required fields: positionId, price" });
    return;
  }

  const [pos] = await db
    .select()
    .from(userPositionsTable)
    .where(eq(userPositionsTable.id, Number(positionId)))
    .limit(1);

  if (!pos) { res.status(404).json({ error: "Position not found" }); return; }
  if (pos.userId !== userId) { res.status(403).json({ error: "Not your position" }); return; }

  let exitPrice = Number(price);
  let binanceOrder: Record<string, unknown> | null = null;
  let mode: "live" | "paper" = "paper";

  const keys = await getUserKeys(userId);
  if (keys) {
    const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
    try {
      const order = await placeFuturesOrder(keys, { symbol: pos.symbol, side: closeSide, type: "MARKET", quantity: pos.quantity });
      exitPrice = fillPrice(order, exitPrice);
      binanceOrder = order as unknown as Record<string, unknown>;
      mode = "live";
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Binance error" });
      return;
    }
  }

  const multiplier = pos.side === "BUY" ? 1 : -1;
  const pnl = (exitPrice - pos.entryPrice) * pos.quantity * multiplier * pos.leverage;

  const [trade] = await db
    .insert(userTradeHistoryTable)
    .values({ userId, symbol: pos.symbol, side: pos.side, entryPrice: pos.entryPrice, exitPrice, quantity: pos.quantity, pnl, leverage: pos.leverage })
    .returning();

  await db.delete(userPositionsTable).where(eq(userPositionsTable.id, pos.id));

  await publish("POSITION_CLOSED", { userId, symbol: pos.symbol, pnl, mode });
  await publish("ORDER_FILLED", { userId, tradeId: trade.id, symbol: pos.symbol, pnl });

  res.json({ msg: "Position closed", mode, pnl, trade, ...(binanceOrder && { binanceOrder }) });
});

positionsRouter.get("/positions", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;
  const positions = await db
    .select()
    .from(userPositionsTable)
    .where(eq(userPositionsTable.userId, userId))
    .orderBy(desc(userPositionsTable.createdAt));
  res.json(positions);
});

positionsRouter.get("/user-trades", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;
  const history = await db
    .select()
    .from(userTradeHistoryTable)
    .where(eq(userTradeHistoryTable.userId, userId))
    .orderBy(desc(userTradeHistoryTable.createdAt))
    .limit(100);
  res.json(history);
});
