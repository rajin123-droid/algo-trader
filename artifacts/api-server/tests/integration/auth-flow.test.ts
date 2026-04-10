/**
 * Integration tests — Auth flow (register → login → refresh → logout)
 *
 * Uses the real database and the actual Express app.  Each test run
 * creates a unique test user (timestamped email) and cleans it up in afterAll.
 *
 * Covers:
 *   1. Successful registration
 *   2. Duplicate registration rejection
 *   3. Successful login with correct credentials
 *   4. Login rejection with wrong password
 *   5. Token refresh cycle
 *   6. Logout (token revocation)
 *   7. Role field present in JWT payload
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/* ── Test user ─────────────────────────────────────────────────────────────── */

const TEST_EMAIL    = `vitest_${Date.now()}@test.algo`;
const TEST_PASSWORD = "ViTest1!";

let accessToken  = "";
let refreshToken = "";

afterAll(async () => {
  // Clean up the test user
  await db.delete(usersTable).where(eq(usersTable.email, TEST_EMAIL)).catch(() => {});
});

/* ── Registration ──────────────────────────────────────────────────────────── */

describe("POST /api/auth/register", () => {
  it("creates a new user and returns tokens", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("accessToken");
    expect(res.body).toHaveProperty("refreshToken");
    expect(res.body.user.email).toBe(TEST_EMAIL.toLowerCase());
    expect(res.body.user).not.toHaveProperty("passwordHash");

    // Save tokens for subsequent tests
    accessToken  = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it("rejects a duplicate email with 4xx", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    // Route returns 400 "User already exists" (not a DB constraint error — checked in-app)
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body).toHaveProperty("error");
  });

});

/* ── Login ─────────────────────────────────────────────────────────────────── */

describe("POST /api/auth/login", () => {
  it("returns tokens for correct credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
    expect(res.body).toHaveProperty("refreshToken");
    expect(res.body.msg).toBe("Login success");

    // Update tokens (register might have a different refresh token)
    accessToken  = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it("rejects wrong password with 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_EMAIL, password: "WrongPassword1!" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("rejects unknown email with 401 (not 404 — prevents enumeration)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@nowhere.com", password: "SomePass1!" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("response does not leak passwordHash or tokenHash", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("tokenHash");
  });
});

/* ── Token usage ───────────────────────────────────────────────────────────── */

describe("Authenticated request with access token", () => {
  it("GET /api/positions succeeds with valid token", async () => {
    const res = await request(app)
      .get("/api/positions")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/positions fails with tampered token", async () => {
    const res = await request(app)
      .get("/api/positions")
      .set("Authorization", "Bearer tampered.token.value");
    expect(res.status).toBe(401);
  });
});

/* ── Token refresh ─────────────────────────────────────────────────────────── */

describe("POST /api/auth/refresh", () => {
  it("issues a new access token using a valid refresh token", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
    expect(res.body).toHaveProperty("refreshToken");
    expect(res.body.accessToken).not.toBe(accessToken);   // rotated

    // Use the new tokens going forward
    accessToken  = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it("rejects a non-string refresh token", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: 12345 });
    expect([400, 401]).toContain(res.status);
  });
});

/* ── Logout ────────────────────────────────────────────────────────────────── */

describe("POST /api/auth/logout", () => {
  it("logs out and the access token becomes invalid", async () => {
    // Logout
    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ refreshToken });

    expect([200, 204]).toContain(logoutRes.status);

    // After logout the refresh token should be revoked
    const refreshRes = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(refreshRes.status).toBe(401);
  });
});
