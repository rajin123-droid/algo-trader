/**
 * /orders — Order lifecycle API
 *
 * Routes:
 *   GET    /orders           — list user orders (filter by status/symbol/side)
 *   GET    /orders/active    — shortcut: PENDING + PARTIALLY_FILLED
 *   GET    /orders/history   — shortcut: FILLED + CANCELLED + REJECTED
 *   GET    /orders/stats     — open order count + total fees paid
 *   GET    /orders/:id       — single order with fill executions
 *   POST   /orders           — create MARKET or LIMIT order
 *   DELETE /orders/:id       — cancel an open order
 *
 * All routes require authentication.
 */

import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { tradingLimiter } from "../middlewares/rate-limiter.js";
import { validate }       from "../validation/middleware.js";
import { logger, requestLogger } from "../lib/logger.js";
import { notFound, badRequest, forbidden } from "../lib/errors.js";
import {
  createOrder,
  recordFill,
  cancelOrder,
  getOrders,
  getOrderWithExecutions,
  countOpenOrders,
  totalFeesPaid,
  preTradeCheck,
  ACTIVE_STATUSES,
  TAKER_FEE_RATE,
  ORDER_STATUS,
  type OrderStatus,
} from "../lib/order-lifecycle.js";
import {
  createOrderSchema,
  listOrdersQuerySchema,
  cancelOrderSchema,
} from "../validation/schemas/order.schema.js";
import { sendToUser }           from "../lib/ws-server.js";
import { publishPortfolioUpdate } from "../lib/ws-publisher.js";

const router: IRouter = Router();

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function resolveStatusFilter(status?: string): OrderStatus[] | undefined {
  if (!status)          return undefined;
  if (status === "active")  return [...ACTIVE_STATUSES];
  if (status === "history") return [ORDER_STATUS.FILLED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED];
  return [status as OrderStatus];
}

/* ── GET /orders/active ───────────────────────────────────────────────────── */

router.get("/orders/active", requireAuth, async (req, res) => {
  const userId = String(req.userId!);
  const orders = await getOrders({ userId, statuses: [...ACTIVE_STATUSES], limit: 200 });
  res.json(orders.map(enrichOrder));
});

/* ── GET /orders/history ──────────────────────────────────────────────────── */

router.get("/orders/history", requireAuth, async (req, res) => {
  const userId = String(req.userId!);
  const limit  = Math.min(Number(req.query["limit"] ?? 50), 200);
  const offset = Number(req.query["offset"] ?? 0);
  const orders = await getOrders({
    userId,
    statuses: [ORDER_STATUS.FILLED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED],
    symbol: req.query["symbol"] ? String(req.query["symbol"]).toUpperCase() : undefined,
    limit,
    offset,
  });
  res.json(orders.map(enrichOrder));
});

/* ── GET /orders/stats ────────────────────────────────────────────────────── */

router.get("/orders/stats", requireAuth, async (req, res) => {
  const userId = String(req.userId!);
  const [open, fees] = await Promise.all([
    countOpenOrders(userId),
    totalFeesPaid(userId),
  ]);
  res.json({ openOrders: open, totalFeesPaid: fees });
});

/* ── GET /orders ──────────────────────────────────────────────────────────── */

router.get(
  "/orders",
  requireAuth,
  validate(listOrdersQuerySchema, "query"),
  async (req, res) => {
    const userId = String(req.userId!);
    const { status, symbol, side, limit, offset } = req.query as {
      status?: string; symbol?: string; side?: string; limit: number; offset: number;
    };

    const orders = await getOrders({
      userId,
      statuses: resolveStatusFilter(status),
      symbol,
      side,
      limit,
      offset,
    });

    res.json(orders.map(enrichOrder));
  }
);

/* ── GET /orders/:id ──────────────────────────────────────────────────────── */

router.get("/orders/:id", requireAuth, async (req, res) => {
  const userId  = String(req.userId!);
  const orderId = req.params["id"]!;

  const result = await getOrderWithExecutions(orderId, userId);
  if (!result) throw notFound("Order not found");

  res.json(enrichOrder(result));
});

/* ── POST /orders — create + execute ─────────────────────────────────────── */

router.post(
  "/orders",
  requireAuth,
  tradingLimiter,
  validate(createOrderSchema),
  async (req, res) => {
    const userId = String(req.userId!);
    const log    = requestLogger(req.reqId ?? "");
    const { symbol, side, type, quantity, price, mode } = req.body as {
      symbol: string; side: "BUY" | "SELL"; type: "MARKET" | "LIMIT" | "STOP_LIMIT";
      quantity: number; price?: number; mode: "paper" | "live";
    };

    // ── Pre-trade risk check ──────────────────────────────────────────────
    const riskCheck = await preTradeCheck({
      userId,
      symbol,
      side,
      quantity,
      price: price ?? 0,
    });

    if (!riskCheck.ok) {
      log.warn({ event: "order_rejected_pretrade", userId, symbol, side, reason: riskCheck.reason }, "Pre-trade check failed");
      throw badRequest(riskCheck.reason ?? "Pre-trade check failed");
    }

    // ── Create order ──────────────────────────────────────────────────────
    const order = await createOrder({ userId, symbol, side, type, quantity, price, mode });

    // ── MARKET orders fill immediately ────────────────────────────────────
    if (type === "MARKET") {
      // Use provided price as fill price (in paper mode this is the user's quoted price)
      const fillPx = price ?? 0;
      if (fillPx <= 0) {
        throw badRequest("price is required for MARKET orders in paper mode");
      }

      const { order: filled, execution } = await recordFill({
        orderId:  order.id,
        userId,
        price:    fillPx,
        quantity,
        feeRate:  TAKER_FEE_RATE,
      });

      log.info({ event: "market_order_filled", orderId: order.id, userId, symbol, side, fillPx, quantity, fee: execution.fee }, "Market order filled");

      // Notify user via WS
      sendToUser(userId, { type: "ORDER_FILLED", data: { order: enrichOrder(filled), execution } });
      publishPortfolioUpdate(userId).catch((err) => logger.warn({ err }, "portfolio update failed"));

      res.status(201).json({ order: enrichOrder(filled), execution });
      return;
    }

    // ── LIMIT orders stay PENDING ─────────────────────────────────────────
    log.info({ event: "limit_order_created", orderId: order.id, userId, symbol, side, price, quantity }, "Limit order created (pending)");
    sendToUser(userId, { type: "ORDER_PENDING", data: { order: enrichOrder(order) } });

    res.status(201).json({ order: enrichOrder(order) });
  }
);

/* ── DELETE /orders/:id — cancel ──────────────────────────────────────────── */

router.delete(
  "/orders/:id",
  requireAuth,
  tradingLimiter,
  validate(cancelOrderSchema),
  async (req, res) => {
    const userId  = String(req.userId!);
    const orderId = req.params["id"]!;
    const reason  = (req.body as { reason?: string }).reason;
    const log     = requestLogger(req.reqId ?? "");

    const result = await cancelOrder(orderId, userId, reason);

    if (!result.wasCancellable) {
      throw badRequest(`Order is already ${result.order.status} and cannot be cancelled`);
    }

    log.info({ event: "order_cancelled_api", orderId, userId, reason }, "Order cancelled via API");

    sendToUser(userId, { type: "ORDER_CANCELLED", data: { order: enrichOrder(result.order) } });

    res.json({ order: enrichOrder(result.order), cancelled: true });
  }
);

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function enrichOrder(o: Record<string, unknown>) {
  const qty    = Number(o["quantity"] ?? 0);
  const filled = Number(o["filledQuantity"] ?? 0);
  return {
    ...o,
    quantity:          qty,
    filledQuantity:    filled,
    remainingQuantity: Math.max(0, qty - filled),
    fillPercent:       qty > 0 ? Math.round((filled / qty) * 10000) / 100 : 0,
    fee:               Number(o["fee"] ?? 0),
  };
}

export default router;
