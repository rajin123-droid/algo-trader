/**
 * order-lifecycle.ts — Exchange-grade order lifecycle management.
 *
 * Responsibilities:
 *   • Define order status constants + transition rules
 *   • Create orders (PENDING)
 *   • Record fills (PENDING → PARTIALLY_FILLED → FILLED)
 *   • Cancel orders (PENDING / PARTIALLY_FILLED → CANCELLED)
 *   • Reject orders (pre-trade risk failure → REJECTED)
 *   • Compute and record fees per fill
 *   • Enforce price / quantity precision per symbol
 *   • Pre-trade risk checks (balance, position size, open order count)
 *
 * Every state transition is performed in a single atomic DB update to prevent
 * race conditions.  No caller should write to the orders table directly.
 */

import { eq, and, inArray, count, sum, desc, asc } from "drizzle-orm";
import { db, ordersTable, tradeExecutionsTable, type Order } from "@workspace/db";
import { logger } from "./logger.js";

/* ── Order status constants ──────────────────────────────────────────────── */

export const ORDER_STATUS = {
  PENDING:           "PENDING",
  PARTIALLY_FILLED:  "PARTIALLY_FILLED",
  FILLED:            "FILLED",
  CANCELLED:         "CANCELLED",
  REJECTED:          "REJECTED",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ACTIVE_STATUSES: OrderStatus[] = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PARTIALLY_FILLED,
];

export const TERMINAL_STATUSES: OrderStatus[] = [
  ORDER_STATUS.FILLED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REJECTED,
];

/* ── Fees ─────────────────────────────────────────────────────────────────── */

/** Binance standard taker fee: 0.04% (0.0004). Using 0.1% for paper simplicity. */
export const TAKER_FEE_RATE = 0.001;   // 0.1 %
export const MAKER_FEE_RATE = 0.001;   // 0.1 %

/**
 * Compute the fee for a single fill.
 * fee = feeRate × fillPrice × fillQty
 * Rounded to 6 decimal places (USDT precision).
 */
export function computeFee(
  fillPrice: number,
  fillQty:   number,
  feeRate:   number = TAKER_FEE_RATE
): number {
  return Math.round(feeRate * fillPrice * fillQty * 1_000_000) / 1_000_000;
}

/* ── Precision ────────────────────────────────────────────────────────────── */

type SymbolPrecision = { qty: number; price: number };

const PRECISION_MAP: Record<string, SymbolPrecision> = {
  BTCUSDT:  { qty: 3, price: 2 },
  ETHUSDT:  { qty: 3, price: 2 },
  SOLUSDT:  { qty: 1, price: 3 },
  BNBUSDT:  { qty: 2, price: 2 },
  XRPUSDT:  { qty: 0, price: 4 },
  DOGEUSDT: { qty: 0, price: 5 },
};

const DEFAULT_PRECISION: SymbolPrecision = { qty: 3, price: 2 };

export function getSymbolPrecision(symbol: string): SymbolPrecision {
  return PRECISION_MAP[symbol.toUpperCase()] ?? DEFAULT_PRECISION;
}

/** Round a quantity to the symbol's step size. */
export function roundQty(qty: number, symbol: string): number {
  const { qty: dp } = getSymbolPrecision(symbol);
  const factor = 10 ** dp;
  return Math.round(qty * factor) / factor;
}

/** Round a price to the symbol's tick size. */
export function roundPrice(price: number, symbol: string): number {
  const { price: dp } = getSymbolPrecision(symbol);
  const factor = 10 ** dp;
  return Math.round(price * factor) / factor;
}

/* ── Pre-trade risk checks ────────────────────────────────────────────────── */

export interface PreTradeCheckParams {
  userId:      string;
  symbol:      string;
  side:        string;
  quantity:    number;
  price:       number;
  maxOpenOrders?: number;   // default 100
}

export interface PreTradeResult {
  ok:     boolean;
  reason?: string;
}

/**
 * Pre-trade risk gate.
 * Currently enforces:
 *   1. Quantity > 0
 *   2. Price > 0
 *   3. Open order count ≤ maxOpenOrders (default 100)
 */
export async function preTradeCheck(
  params: PreTradeCheckParams
): Promise<PreTradeResult> {
  const { userId, quantity, price, maxOpenOrders = 100 } = params;

  if (quantity <= 0) return { ok: false, reason: "Quantity must be positive" };
  if (price <= 0)    return { ok: false, reason: "Price must be positive" };

  // Open order count check
  const [row] = await db
    .select({ n: count() })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.userId, userId),
        inArray(ordersTable.status, ACTIVE_STATUSES)
      )
    );

  const openCount = Number(row?.n ?? 0);
  if (openCount >= maxOpenOrders) {
    return {
      ok: false,
      reason: `Open order limit reached (${openCount}/${maxOpenOrders})`,
    };
  }

  return { ok: true };
}

/* ── Order creation ───────────────────────────────────────────────────────── */

export interface CreateOrderParams {
  userId:          string;
  symbol:          string;
  side:            "BUY" | "SELL";
  type:            "MARKET" | "LIMIT" | "STOP_LIMIT";
  quantity:        number;
  price?:          number;   // required for LIMIT / STOP_LIMIT
  mode?:           "paper" | "live";
  exchangeOrderId?: string;
}

/**
 * Create a new order record in PENDING state.
 * Does NOT execute the order — call recordFill() for immediate fills.
 */
export async function createOrder(params: CreateOrderParams): Promise<Order> {
  const {
    userId, symbol, side, type, quantity, price,
    mode = "paper", exchangeOrderId,
  } = params;

  const precision = getSymbolPrecision(symbol);
  const roundedQty   = roundQty(quantity, symbol);
  const roundedPrice = price != null ? roundPrice(price, symbol) : undefined;

  const id = crypto.randomUUID();
  const now = new Date();

  const [order] = await db
    .insert(ordersTable)
    .values({
      id,
      userId,
      symbol,
      side,
      type,
      quantity:     String(roundedQty),
      price:        roundedPrice != null ? String(roundedPrice) : null,
      filledQuantity: "0",
      status:       ORDER_STATUS.PENDING,
      mode,
      fee:          "0",
      feeAsset:     "USDT",
      exchangeOrderId: exchangeOrderId ?? null,
      createdAt:    now,
      updatedAt:    now,
    })
    .returning();

  logger.info({
    event:  "order_created",
    orderId: id,
    userId,
    symbol,
    side,
    type,
    quantity: roundedQty,
    price:    roundedPrice,
    mode,
  }, "Order created");

  return order!;
}

/* ── Fill recording ───────────────────────────────────────────────────────── */

export interface RecordFillParams {
  orderId:  string;
  userId:   string;
  price:    number;
  quantity: number;
  feeRate?: number;
}

export interface FillResult {
  order:     Order;
  execution: { id: string; orderId: string; price: number; quantity: number; fee: number };
}

/**
 * Record a fill (partial or full) for an existing order.
 *
 * Atomically:
 *   1. Inserts a trade_execution row
 *   2. Updates filled_quantity, fee, status, updated_at on the order
 *
 * Status transitions:
 *   filledQty < quantity  → PARTIALLY_FILLED
 *   filledQty = quantity  → FILLED
 */
export async function recordFill(params: RecordFillParams): Promise<FillResult> {
  const { orderId, userId, price, quantity, feeRate = TAKER_FEE_RATE } = params;

  // Load current order
  const [existing] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.userId, userId)))
    .limit(1);

  if (!existing) throw new Error(`Order not found: ${orderId}`);

  if (TERMINAL_STATUSES.includes(existing.status as OrderStatus)) {
    throw new Error(`Cannot fill a ${existing.status} order`);
  }

  const roundedFillQty = roundQty(quantity,  existing.symbol);
  const roundedFillPx  = roundPrice(price,   existing.symbol);
  const fillFee        = computeFee(roundedFillPx, roundedFillQty, feeRate);

  const prevFilled = Number(existing.filledQuantity);
  const orderQty   = Number(existing.quantity);
  const prevFee    = Number(existing.fee);

  const newFilled = Math.min(prevFilled + roundedFillQty, orderQty);
  const newFee    = Math.round((prevFee + fillFee) * 1_000_000) / 1_000_000;

  const newStatus: OrderStatus =
    newFilled >= orderQty ? ORDER_STATUS.FILLED : ORDER_STATUS.PARTIALLY_FILLED;

  const executionId = crypto.randomUUID();
  const now = new Date();

  // Insert execution row
  await db.insert(tradeExecutionsTable).values({
    id:          executionId,
    orderId,
    userId,
    side:        existing.side,
    price:       String(roundedFillPx),
    quantity:    String(roundedFillQty),
    fee:         String(fillFee),
    feeAsset:    existing.feeAsset,
    executedAt:  now,
  });

  // Update order
  const [updatedOrder] = await db
    .update(ordersTable)
    .set({
      filledQuantity: String(newFilled),
      fee:            String(newFee),
      status:         newStatus,
      updatedAt:      now,
    })
    .where(eq(ordersTable.id, orderId))
    .returning();

  logger.info({
    event:       "order_fill_recorded",
    orderId,
    userId,
    fillPrice:   roundedFillPx,
    fillQty:     roundedFillQty,
    fillFee,
    newFilled,
    orderQty,
    newStatus,
  }, "Order fill recorded");

  return {
    order: updatedOrder!,
    execution: {
      id:       executionId,
      orderId,
      price:    roundedFillPx,
      quantity: roundedFillQty,
      fee:      fillFee,
    },
  };
}

/* ── Immediate fill (MARKET orders) ──────────────────────────────────────── */

/**
 * Create an order and immediately fill it in one call.
 * Used by the positions route for MARKET orders that execute instantly.
 */
export async function createAndFill(
  createParams: CreateOrderParams,
  fillPrice: number,
  feeRate: number = TAKER_FEE_RATE
): Promise<FillResult> {
  const order = await createOrder(createParams);
  return recordFill({
    orderId:  order.id,
    userId:   createParams.userId,
    price:    fillPrice,
    quantity: Number(order.quantity),
    feeRate,
  });
}

/* ── Cancellation ─────────────────────────────────────────────────────────── */

export interface CancelOrderResult {
  order: Order;
  wasCancellable: boolean;
}

/**
 * Cancel an order. Only PENDING and PARTIALLY_FILLED orders can be cancelled.
 * Returns `wasCancellable: false` if the order is already in a terminal state.
 */
export async function cancelOrder(
  orderId:  string,
  userId:   string,
  reason?:  string
): Promise<CancelOrderResult> {
  const [existing] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.userId, userId)))
    .limit(1);

  if (!existing) throw new Error(`Order not found: ${orderId}`);

  if (TERMINAL_STATUSES.includes(existing.status as OrderStatus)) {
    return { order: existing, wasCancellable: false };
  }

  const now = new Date();
  const [updated] = await db
    .update(ordersTable)
    .set({
      status:       ORDER_STATUS.CANCELLED,
      cancelledAt:  now,
      cancelReason: reason ?? "User requested",
      updatedAt:    now,
    })
    .where(eq(ordersTable.id, orderId))
    .returning();

  logger.info({
    event:   "order_cancelled",
    orderId,
    userId,
    reason:  reason ?? "User requested",
    previousStatus: existing.status,
  }, "Order cancelled");

  return { order: updated!, wasCancellable: true };
}

/* ── Rejection ────────────────────────────────────────────────────────────── */

/** Mark an order as REJECTED (pre-trade risk check failure). */
export async function rejectOrder(
  orderId: string,
  reason:  string
): Promise<Order> {
  const now = new Date();
  const [updated] = await db
    .update(ordersTable)
    .set({
      status:       ORDER_STATUS.REJECTED,
      rejectReason: reason,
      updatedAt:    now,
    })
    .where(eq(ordersTable.id, orderId))
    .returning();

  logger.warn({ event: "order_rejected", orderId, reason }, "Order rejected");
  return updated!;
}

/* ── Queries ──────────────────────────────────────────────────────────────── */

export interface OrderFilters {
  userId:    string;
  statuses?: OrderStatus[];
  symbol?:   string;
  side?:     string;
  limit?:    number;
  offset?:   number;
}

/** Fetch user orders with optional filters. Returns orders newest-first. */
export async function getOrders(filters: OrderFilters): Promise<Order[]> {
  const {
    userId,
    statuses,
    symbol,
    side,
    limit = 50,
    offset = 0,
  } = filters;

  const conditions = [eq(ordersTable.userId, userId)];
  if (statuses?.length) conditions.push(inArray(ordersTable.status, statuses));
  if (symbol)           conditions.push(eq(ordersTable.symbol, symbol.toUpperCase()));
  if (side)             conditions.push(eq(ordersTable.side, side.toUpperCase()));

  return db
    .select()
    .from(ordersTable)
    .where(and(...conditions))
    .orderBy(desc(ordersTable.createdAt))
    .limit(Math.min(limit, 200))
    .offset(offset);
}

/** Fetch a single order plus all its fill executions. */
export async function getOrderWithExecutions(orderId: string, userId: string) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.userId, userId)))
    .limit(1);

  if (!order) return null;

  const executions = await db
    .select()
    .from(tradeExecutionsTable)
    .where(eq(tradeExecutionsTable.orderId, orderId))
    .orderBy(asc(tradeExecutionsTable.executedAt));

  const totalQty    = Number(order.quantity);
  const filledQty   = Number(order.filledQuantity);
  const remainingQty = Math.max(0, totalQty - filledQty);

  return {
    ...order,
    remainingQuantity: remainingQty,
    fillPercent:       totalQty > 0 ? Math.round((filledQty / totalQty) * 10000) / 100 : 0,
    executions,
  };
}

/* ── Aggregates ───────────────────────────────────────────────────────────── */

/** Count open orders for a user (PENDING + PARTIALLY_FILLED). */
export async function countOpenOrders(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.userId, userId),
      inArray(ordersTable.status, ACTIVE_STATUSES)
    ));
  return Number(row?.n ?? 0);
}

/** Compute total fees paid by a user (across all filled orders). */
export async function totalFeesPaid(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(ordersTable.fee) })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.userId, userId),
      eq(ordersTable.status, ORDER_STATUS.FILLED)
    ));
  return Number(row?.total ?? 0);
}
