/**
 * Integration tests — Public routes (no auth required)
 *
 * Tests that require a running Express app but no authentication.
 * These verify the server bootstraps correctly, middleware is wired,
 * and public endpoints respond as documented.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

describe("GET /api/market/status", () => {
  it("returns 200 with source field", async () => {
    const res = await request(app).get("/api/market/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("source");
  });

  it("includes RateLimit headers", async () => {
    const res = await request(app).get("/api/market/status");
    const hasRateLimit =
      "ratelimit" in res.headers ||
      "x-ratelimit-limit" in res.headers;
    expect(hasRateLimit).toBe(true);
  });

  it("responds with JSON content-type", async () => {
    const res = await request(app).get("/api/market/status");
    expect(res.headers["content-type"]).toMatch(/json/);
  });
});

describe("GET /api/health", () => {
  it("returns a non-error status", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBeLessThan(500);
  });
});

describe("404 handler", () => {
  it("returns structured JSON for unknown routes", async () => {
    const res = await request(app).get("/api/nonexistent-route-xyz");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("code", "ROUTE_NOT_FOUND");
  });

  it("includes route info in the 404 error message", async () => {
    const res = await request(app).get("/api/something-unknown");
    expect(res.body.error).toMatch(/something-unknown/);
  });
});

describe("Security headers (Helmet)", () => {
  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await request(app).get("/api/market/status");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("does not expose X-Powered-By header", async () => {
    const res = await request(app).get("/api/market/status");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
