/**
 * Unit tests — Order lifecycle engine (src/lib/order-lifecycle.ts)
 *
 * Tests all pure / DB-touching functions:
 *   • computeFee — pure math, no DB
 *   • roundQty / roundPrice — pure precision helpers, no DB
 *   • getSymbolPrecision — pure lookup, no DB
 *   • ORDER_STATUS constants — shape / value correctness
 *   • Full lifecycle via createOrder → recordFill → cancelOrder using real test DB
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  computeFee,
  roundQty,
  roundPrice,
  getSymbolPrecision,
  createOrder,
  recordFill,
  cancelOrder,
  countOpenOrders,
  totalFeesPaid,
  ORDER_STATUS,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  TAKER_FEE_RATE,
  MAKER_FEE_RATE,
} from "../../src/lib/order-lifecycle.js";
import { db, ordersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/* ── Test user ID (stable across all tests in this file) ─────────────────── */

const TEST_USER = `order_test_${Date.now()}`;

afterAll(async () => {
  await db.delete(ordersTable).where(eq(ordersTable.userId, TEST_USER)).catch(() => {});
});

/* ── ORDER_STATUS constants ───────────────────────────────────────────────── */

describe("ORDER_STATUS constants", () => {
  it("defines the 5 expected statuses", () => {
    const statuses = Object.values(ORDER_STATUS);
    expect(statuses).toContain("PENDING");
    expect(statuses).toContain("PARTIALLY_FILLED");
    expect(statuses).toContain("FILLED");
    expect(statuses).toContain("CANCELLED");
    expect(statuses).toContain("REJECTED");
    expect(statuses).toHaveLength(5);
  });

  it("ACTIVE_STATUSES includes PENDING and PARTIALLY_FILLED", () => {
    expect(ACTIVE_STATUSES).toContain("PENDING");
    expect(ACTIVE_STATUSES).toContain("PARTIALLY_FILLED");
    expect(ACTIVE_STATUSES).not.toContain("FILLED");
    expect(ACTIVE_STATUSES).not.toContain("CANCELLED");
  });

  it("TERMINAL_STATUSES includes FILLED, CANCELLED, REJECTED", () => {
    expect(TERMINAL_STATUSES).toContain("FILLED");
    expect(TERMINAL_STATUSES).toContain("CANCELLED");
    expect(TERMINAL_STATUSES).toContain("REJECTED");
    expect(TERMINAL_STATUSES).not.toContain("PENDING");
  });
});

/* ── computeFee ───────────────────────────────────────────────────────────── */

describe("computeFee", () => {
  it("computes 0.1% fee correctly", () => {
    // 0.001 × 50000 × 0.1 = 5
    const fee = computeFee(50_000, 0.1, 0.001);
    expect(fee).toBeCloseTo(5, 4);
  });

  it("uses TAKER_FEE_RATE by default", () => {
    const fee = computeFee(50_000, 0.1);
    expect(fee).toBeCloseTo(computeFee(50_000, 0.1, TAKER_FEE_RATE), 6);
  });

  it("returns 0 when quantity is 0", () => {
    expect(computeFee(50_000, 0)).toBe(0);
  });

  it("returns 0 when price is 0", () => {
    expect(computeFee(0, 0.1)).toBe(0);
  });

  it("rounds to 6 decimal places", () => {
    const fee = computeFee(33_333, 0.001);
    const decimals = fee.toString().split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(6);
  });

  it("TAKER_FEE_RATE and MAKER_FEE_RATE are both 0.001", () => {
    expect(TAKER_FEE_RATE).toBe(0.001);
    expect(MAKER_FEE_RATE).toBe(0.001);
  });
});

/* ── Symbol precision ─────────────────────────────────────────────────────── */

describe("getSymbolPrecision", () => {
  it("returns BTCUSDT precision: qty=3, price=2", () => {
    const p = getSymbolPrecision("BTCUSDT");
    expect(p.qty).toBe(3);
    expect(p.price).toBe(2);
  });

  it("is case-insensitive", () => {
    expect(getSymbolPrecision("btcusdt")).toEqual(getSymbolPrecision("BTCUSDT"));
  });

  it("returns default precision for unknown symbols", () => {
    const p = getSymbolPrecision("UNKNOWNUSDT");
    expect(p.qty).toBeGreaterThanOrEqual(0);
    expect(p.price).toBeGreaterThanOrEqual(0);
  });
});

/* ── roundQty / roundPrice ────────────────────────────────────────────────── */

describe("roundQty", () => {
  it("rounds BTC qty to 3 decimal places", () => {
    const rounded = roundQty(0.123456789, "BTCUSDT");
    expect(rounded.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it("does not increase precision", () => {
    expect(roundQty(1.0, "BTCUSDT")).toBe(1.0);
  });
});

describe("roundPrice", () => {
  it("rounds BTC price to 2 decimal places", () => {
    const rounded = roundPrice(65432.567, "BTCUSDT");
    expect(rounded.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
    expect(rounded).toBeCloseTo(65432.57, 0);
  });
});

/* ── Full lifecycle (integration with test DB) ────────────────────────────── */

describe("createOrder", () => {
  it("creates a PENDING order", async () => {
    const order = await createOrder({
      userId:   TEST_USER,
      symbol:   "BTCUSDT",
      side:     "BUY",
      type:     "MARKET",
      quantity: 0.1,
      price:    65000,
    });

    expect(order.status).toBe(ORDER_STATUS.PENDING);
    expect(order.userId).toBe(TEST_USER);
    expect(order.symbol).toBe("BTCUSDT");
    expect(order.side).toBe("BUY");
    expect(Number(order.filledQuantity)).toBe(0);
    expect(Number(order.fee)).toBe(0);
  });

  it("defaults mode to paper", async () => {
    const order = await createOrder({
      userId: TEST_USER, symbol: "ETHUSDT", side: "SELL",
      type: "LIMIT", quantity: 1, price: 3000,
    });
    expect(order.mode).toBe("paper");
  });

  it("stores LIMIT price correctly", async () => {
    const order = await createOrder({
      userId: TEST_USER, symbol: "BTCUSDT", side: "BUY",
      type: "LIMIT", quantity: 0.05, price: 60000,
    });
    expect(Number(order.price)).toBe(60000);
    expect(order.type).toBe("LIMIT");
  });
});

describe("recordFill", () => {
  it("transitions PENDING → FILLED on a full fill", async () => {
    const order = await createOrder({
      userId: TEST_USER, symbol: "BTCUSDT", side: "BUY",
      type: "MARKET", quantity: 0.1, price: 65000,
    });

    const { order: filled, execution } = await recordFill({
      orderId:  order.id,
      userId:   TEST_USER,
      price:    65000,
      quantity: 0.1,
    });

    expect(filled.status).toBe(ORDER_STATUS.FILLED);
    expect(Number(filled.filledQuantity)).toBeCloseTo(0.1, 3);
    expect(execution.fee).toBeGreaterThan(0);
  });

  it("transitions PENDING → PARTIALLY_FILLED on a partial fill", async () => {
    const order = await createOrder({
      userId: TEST_USER, symbol: "BTCUSDT", side: "BUY",
      type: "LIMIT", quantity: 1.0, price: 65000,
    });

    const { order: partial } = await recordFill({
      orderId:  order.id,
      userId:   TEST_USER,
      price:    65000,
      quantity: 0.4,
    });

    expect(partial.status).toBe(ORDER_STATUS.PARTIALLY_FILLED);
    expect(Number(partial.filledQuantity)).toBeCloseTo(0.4, 3);
  });

  it("transitions PARTIALLY_FILLED → FILLED on final fill", async () => {
    const order = await createOrder({
      userId: TEST_USER, symbol: "BTCUSDT", side: "BUY",
      type: "LIMIT", quantity: 1.0, price: 65000,
    });

    await recordFill({ orderId: order.id, userId: TEST_USER, price: 65000, quantity: 0.5 });
    const { order: filled } = await recordFill({
      orderId: order.id, userId: TEST_USER, price: 65000, quantity: 0.5,
    });

    expect(filled.status).toBe(ORDER_STATUS.FILLED);
    expect(Number(filled.filledQuantity)).toBeCloseTo(1.0, 3);
  });

  it("accumulates fees across partial fills", async () => {
    const order = await createOrder({
      userId: TEST_USER, symbol: "BTCUSDT", side: "BUY",
      type: "LIMIT", quantity: 1.0, price: 65000,
    });

    const fee1 = computeFee(65000, 0.5);
    const fee2 = computeFee(65000, 0.5);

    await recordFill({ orderId: order.id, userId: TEST_USER, price: 65000, quantity: 0.5 });
    const { order: filled } = await recordFill({
      orderId: order.id, userId: TEST_USER, price: 65000, quantity: 0.5,
    });

    expect(Number(filled.fee)).toBeCloseTo(fee1 + fee2, 4);
  });

  it("throws when trying to fill a FILLED order", async () => {
    const order = await createOrder({
      userId: TEST_USER, symbol: "ETHUSDT", side: "SELL",
      type: "MARKET", quantity: 0.5, price: 3000,
    });

    await recordFill({ orderId: order.id, userId: TEST_USER, price: 3000, quantity: 0.5 });

    await expect(
      recordFill({ orderId: order.id, userId: TEST_USER, price: 3000, quantity: 0.1 })
    ).rejects.toThrow();
  });
});

describe("cancelOrder", () => {
  it("cancels a PENDING order", async () => {
    const order = await createOrder({
      userId: TEST_USER, symbol: "BTCUSDT", side: "BUY",
      type: "LIMIT", quantity: 0.2, price: 60000,
    });

    const { order: cancelled, wasCancellable } = await cancelOrder(
      order.id, TEST_USER, "Test cancellation"
    );

    expect(wasCancellable).toBe(true);
    expect(cancelled.status).toBe(ORDER_STATUS.CANCELLED);
    expect(cancelled.cancelReason).toBe("Test cancellation");
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it("cancels a PARTIALLY_FILLED order", async () => {
    const order = await createOrder({
      userId: TEST_USER, symbol: "BTCUSDT", side: "BUY",
      type: "LIMIT", quantity: 1.0, price: 65000,
    });

    await recordFill({ orderId: order.id, userId: TEST_USER, price: 65000, quantity: 0.3 });

    const { order: cancelled, wasCancellable } = await cancelOrder(order.id, TEST_USER);
    expect(wasCancellable).toBe(true);
    expect(cancelled.status).toBe(ORDER_STATUS.CANCELLED);
  });

  it("returns wasCancellable=false for a FILLED order", async () => {
    const order = await createOrder({
      userId: TEST_USER, symbol: "ETHUSDT", side: "BUY",
      type: "MARKET", quantity: 0.1, price: 3000,
    });
    await recordFill({ orderId: order.id, userId: TEST_USER, price: 3000, quantity: 0.1 });

    const { wasCancellable } = await cancelOrder(order.id, TEST_USER);
    expect(wasCancellable).toBe(false);
  });
});

describe("countOpenOrders / totalFeesPaid", () => {
  it("countOpenOrders reflects PENDING + PARTIALLY_FILLED orders", async () => {
    const before = await countOpenOrders(TEST_USER);

    await createOrder({
      userId: TEST_USER, symbol: "SOLUSDT", side: "BUY",
      type: "LIMIT", quantity: 10, price: 150,
    });

    const after = await countOpenOrders(TEST_USER);
    expect(after).toBe(before + 1);
  });

  it("totalFeesPaid increases after a FILLED order", async () => {
    const before = await totalFeesPaid(TEST_USER);

    const order = await createOrder({
      userId: TEST_USER, symbol: "BTCUSDT", side: "BUY",
      type: "MARKET", quantity: 0.001, price: 65000,
    });
    await recordFill({ orderId: order.id, userId: TEST_USER, price: 65000, quantity: 0.001 });

    const after = await totalFeesPaid(TEST_USER);
    expect(after).toBeGreaterThan(before);
  });
});
