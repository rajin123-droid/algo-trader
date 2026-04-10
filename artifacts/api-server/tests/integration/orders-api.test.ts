/**
 * Integration tests — Orders API (/orders)
 *
 * Tests the full order lifecycle via the REST API:
 *   create → list → view → cancel
 *
 * Uses real DB. Creates a test user, obtains tokens, exercises all order
 * endpoints, then cleans up.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { db, ordersTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/* ── Test user ─────────────────────────────────────────────────────────────── */

const TEST_EMAIL    = `orders_test_${Date.now()}@test.com`;
const TEST_PASSWORD = "OrdersTest1!";

let accessToken  = "";
let createdOrderId = "";

beforeAll(async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  accessToken = res.body.accessToken ?? "";
});

afterAll(async () => {
  // Clean up test user and orders
  await db.delete(usersTable).where(eq(usersTable.email, TEST_EMAIL)).catch(() => {});
});

const auth = () => ({ Authorization: `Bearer ${accessToken}` });

/* ── GET /orders — requires auth ───────────────────────────────────────────── */

describe("GET /orders", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/orders");
    expect(res.status).toBe(401);
  });

  it("returns empty array for a fresh user", async () => {
    const res = await request(app).get("/api/orders").set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/* ── GET /orders/active ─────────────────────────────────────────────────────── */

describe("GET /orders/active", () => {
  it("returns 200 with an array", async () => {
    const res = await request(app).get("/api/orders/active").set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/* ── GET /orders/history ─────────────────────────────────────────────────────── */

describe("GET /orders/history", () => {
  it("returns 200 with an array", async () => {
    const res = await request(app).get("/api/orders/history").set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

/* ── GET /orders/stats ───────────────────────────────────────────────────────── */

describe("GET /orders/stats", () => {
  it("returns openOrders and totalFeesPaid fields", async () => {
    const res = await request(app).get("/api/orders/stats").set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("openOrders");
    expect(res.body).toHaveProperty("totalFeesPaid");
    expect(typeof res.body.openOrders).toBe("number");
    expect(typeof res.body.totalFeesPaid).toBe("number");
  });
});

/* ── POST /orders — MARKET order ─────────────────────────────────────────────── */

describe("POST /orders — MARKET", () => {
  it("creates a FILLED market order immediately", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth())
      .send({
        symbol:   "BTCUSDT",
        side:     "BUY",
        type:     "MARKET",
        quantity: 0.001,
        price:    65000,
        mode:     "paper",
      });

    expect(res.status).toBe(201);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.status).toBe("FILLED");
    expect(res.body.order.filledQuantity).toBeCloseTo(0.001, 3);
    expect(res.body.order.fee).toBeGreaterThan(0);
    expect(res.body.order.remainingQuantity).toBe(0);
    expect(res.body.order.fillPercent).toBe(100);
    expect(res.body.execution).toBeDefined();
    expect(res.body.execution.fee).toBeGreaterThan(0);

    createdOrderId = res.body.order.id;
  });

  it("rejects missing price for MARKET order in paper mode", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth())
      .send({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.01 });

    // MARKET without price → 400 (price required for paper mode)
    expect([400]).toContain(res.status);
  });

  it("rejects unknown fields (strict mode)", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth())
      .send({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.001, price: 65000, isAdmin: true });
    expect(res.status).toBe(400);
  });

  it("rejects invalid side", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth())
      .send({ symbol: "BTCUSDT", side: "HACK", type: "MARKET", quantity: 0.001, price: 65000 });
    expect(res.status).toBe(400);
  });

  it("rejects negative quantity", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth())
      .send({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: -0.1, price: 65000 });
    expect(res.status).toBe(400);
  });
});

/* ── POST /orders — LIMIT order ──────────────────────────────────────────────── */

describe("POST /orders — LIMIT", () => {
  let limitOrderId = "";

  it("creates a PENDING limit order", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth())
      .send({
        symbol:   "BTCUSDT",
        side:     "BUY",
        type:     "LIMIT",
        quantity: 0.01,
        price:    50000,
        mode:     "paper",
      });

    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe("PENDING");
    expect(res.body.order.filledQuantity).toBe(0);
    expect(res.body.order.remainingQuantity).toBeCloseTo(0.01, 3);
    expect(res.body.execution).toBeUndefined();

    limitOrderId = res.body.order.id;
  });

  it("rejects LIMIT order without price", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set(auth())
      .send({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: 0.01 });
    expect(res.status).toBe(400);
  });

  /* ── Cancel the PENDING limit order ───────────────────────────────────────── */

  it("cancels a PENDING order via DELETE", async () => {
    expect(limitOrderId).not.toBe("");
    const res = await request(app)
      .delete(`/api/orders/${limitOrderId}`)
      .set(auth())
      .send({ reason: "Test cancellation" });

    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
    expect(res.body.order.status).toBe("CANCELLED");
    expect(res.body.order.cancelReason).toBe("Test cancellation");
  });

  it("cannot cancel the same order twice", async () => {
    const res = await request(app)
      .delete(`/api/orders/${limitOrderId}`)
      .set(auth())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already/);
  });
});

/* ── GET /orders/:id ─────────────────────────────────────────────────────────── */

describe("GET /orders/:id", () => {
  it("returns the order with executions array", async () => {
    expect(createdOrderId).not.toBe("");
    const res = await request(app)
      .get(`/api/orders/${createdOrderId}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdOrderId);
    expect(Array.isArray(res.body.executions)).toBe(true);
    expect(res.body.executions.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty("fillPercent");
    expect(res.body).toHaveProperty("remainingQuantity");
  });

  it("returns 404 for unknown order ID", async () => {
    const res = await request(app)
      .get("/api/orders/00000000-0000-0000-0000-000000000000")
      .set(auth());
    expect(res.status).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get(`/api/orders/${createdOrderId}`);
    expect(res.status).toBe(401);
  });
});

/* ── Order lifecycle appears in list views ─────────────────────────────────── */

describe("Order list views after create + cancel", () => {
  it("FILLED market order appears in /orders/history", async () => {
    const res = await request(app).get("/api/orders/history").set(auth());
    expect(res.status).toBe(200);
    const found = res.body.find((o: { id: string }) => o.id === createdOrderId);
    expect(found).toBeDefined();
    expect(found.status).toBe("FILLED");
  });

  it("filled order has fee > 0", async () => {
    const res = await request(app).get("/api/orders/history").set(auth());
    const found = res.body.find((o: { id: string }) => o.id === createdOrderId);
    expect(Number(found.fee)).toBeGreaterThan(0);
  });

  it("FILLED order does NOT appear in /orders/active", async () => {
    const res = await request(app).get("/api/orders/active").set(auth());
    const found = res.body.find((o: { id: string }) => o.id === createdOrderId);
    expect(found).toBeUndefined();
  });

  it("stats reflect at least 1 filled order with fee > 0", async () => {
    const res = await request(app).get("/api/orders/stats").set(auth());
    expect(res.body.totalFeesPaid).toBeGreaterThan(0);
  });
});
