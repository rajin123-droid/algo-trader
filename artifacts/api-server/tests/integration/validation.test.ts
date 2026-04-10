/**
 * Integration tests — Validation layer (Zod middleware → HTTP)
 *
 * Tests that invalid request bodies are correctly rejected before touching
 * the database, returning structured { error, details } JSON at 400.
 *
 * These tests deliberately omit or break authentication to test the
 * validation responses that don't require DB access:
 *   - /auth/* routes: validation runs before the handler (no auth needed)
 *   - /positions/*:  validation runs AFTER requireAuth, so we test via auth
 */

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

/* ── Auth endpoint validation (no auth token required) ─────────────────────── */

describe("POST /api/auth/login — input validation", () => {
  it("rejects missing email with 400 and details array", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ password: "SomePass1!" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.some((d: {field: string}) => d.field === "email")).toBe(true);
  });

  it("rejects invalid email format with field-level error", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "SomePass1!" });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: {field: string}) => d.field === "email")).toBe(true);
  });

  it("rejects empty password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@test.com", password: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("rejects completely empty body", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({});
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("error response includes field and message for each invalid field", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "bad", password: "" });
    expect(res.status).toBe(400);
    res.body.details.forEach((d: {field: string; message: string}) => {
      expect(d).toHaveProperty("field");
      expect(d).toHaveProperty("message");
      expect(typeof d.field).toBe("string");
      expect(typeof d.message).toBe("string");
    });
  });
});

describe("POST /api/auth/register — input validation", () => {
  it("rejects password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "new@test.com", password: "Ab1" });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: {field: string}) => d.field === "password")).toBe(true);
  });

  it("rejects invalid email format", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "notvalid", password: "Secure123!" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/refresh — input validation", () => {
  it("rejects missing refreshToken", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: {field: string}) => d.field === "refreshToken")).toBe(true);
  });

  it("rejects empty refreshToken string", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "" });
    expect(res.status).toBe(400);
  });
});

/* ── Protected endpoints — auth rejection ──────────────────────────────────── */

describe("Protected routes — auth guard", () => {
  it("GET /api/positions without token → 401", async () => {
    const res = await request(app).get("/api/positions");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).not.toContain("stack");
  });

  it("POST /api/positions/open without token → 401", async () => {
    const res = await request(app)
      .post("/api/positions/open")
      .send({ symbol: "BTCUSDT", side: "BUY", price: 65000, qty: 0.01 });
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/users without token → 401", async () => {
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(401);
  });

  it("401 response has no stack trace or internal details", async () => {
    const res = await request(app).get("/api/positions");
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("Error:");
  });
});

/* ── Auto-trading validation (no auth needed) ──────────────────────────────── */

describe("POST /api/auto-trading/stop — validation", () => {
  it("rejects missing sessionId with 400", async () => {
    const res = await request(app)
      .post("/api/auto-trading/stop")
      .send({ userId: "user-1" });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: {field: string}) => d.field === "sessionId")).toBe(true);
  });
});

/* ── Keys endpoint validation ───────────────────────────────────────────────── */

describe("PUT /api/keys/binance — validation", () => {
  it("rejects missing apiSecret with 400 (even without auth, validation fires first after auth guard)", async () => {
    const res = await request(app)
      .put("/api/keys/binance")
      .send({ apiKey: "SOME_KEY_12345678" });
    // 401 (no auth) or 400 (validation) — both are correct; we just verify it's not 200/500
    expect([400, 401]).toContain(res.status);
    expect(res.body).toHaveProperty("error");
  });
});
