/**
 * Unit tests — Zod validation schemas (src/validation/schemas/)
 *
 * Tests that schemas accept valid data and reject invalid data exactly
 * as documented. These are the first line of defense against malicious input.
 */

import { describe, it, expect } from "vitest";
import {
  openPositionSchema,
  closePositionSchema,
} from "../../src/validation/schemas/trade.schema.js";
import {
  loginSchema,
  registerSchema,
  refreshSchema,
} from "../../src/validation/schemas/auth.schema.js";
import {
  startSessionSchema,
  stopSessionSchema,
} from "../../src/validation/schemas/auto-trading.schema.js";

/* ── openPositionSchema ───────────────────────────────────────────────────── */

describe("openPositionSchema", () => {
  const valid = {
    symbol: "BTCUSDT",
    side:   "BUY",
    price:  65000,
    qty:    0.01,
    leverage: 1,
  };

  it("accepts a valid position-open payload", () => {
    expect(() => openPositionSchema.parse(valid)).not.toThrow();
  });

  it("normalises symbol to uppercase", () => {
    const result = openPositionSchema.parse({ ...valid, symbol: "btcusdt" });
    expect(result.symbol).toBe("BTCUSDT");
  });

  it("rejects negative qty", () => {
    expect(() => openPositionSchema.parse({ ...valid, qty: -0.1 })).toThrow();
  });

  it("rejects zero price", () => {
    expect(() => openPositionSchema.parse({ ...valid, price: 0 })).toThrow();
  });

  it("rejects negative price", () => {
    expect(() => openPositionSchema.parse({ ...valid, price: -100 })).toThrow();
  });

  it("rejects invalid side", () => {
    expect(() => openPositionSchema.parse({ ...valid, side: "HACK" })).toThrow();
  });

  it("rejects leverage above 125", () => {
    expect(() => openPositionSchema.parse({ ...valid, leverage: 200 })).toThrow();
  });

  it("rejects leverage below 1", () => {
    expect(() => openPositionSchema.parse({ ...valid, leverage: 0 })).toThrow();
  });

  it("rejects unknown fields (strict mode)", () => {
    expect(() =>
      openPositionSchema.parse({ ...valid, admin: true })
    ).toThrow();
  });

  it("coerces numeric string price to number", () => {
    const result = openPositionSchema.parse({ ...valid, price: "65000" });
    expect(typeof result.price).toBe("number");
    expect(result.price).toBe(65000);
  });
});

/* ── closePositionSchema ──────────────────────────────────────────────────── */

describe("closePositionSchema", () => {
  it("accepts valid close payload", () => {
    expect(() =>
      closePositionSchema.parse({ positionId: 42, price: 66000 })
    ).not.toThrow();
  });

  it("rejects missing positionId", () => {
    expect(() =>
      closePositionSchema.parse({ price: 66000 })
    ).toThrow();
  });

  it("rejects zero price", () => {
    expect(() =>
      closePositionSchema.parse({ positionId: 1, price: 0 })
    ).toThrow();
  });
});

/* ── loginSchema ──────────────────────────────────────────────────────────── */

describe("loginSchema", () => {
  it("accepts valid credentials", () => {
    expect(() =>
      loginSchema.parse({ email: "user@example.com", password: "Secure1!" })
    ).not.toThrow();
  });

  it("normalises email to lowercase", () => {
    const result = loginSchema.parse({ email: "USER@EXAMPLE.COM", password: "Pass1!" });
    expect(result.email).toBe("user@example.com");
  });

  it("rejects invalid email format", () => {
    expect(() =>
      loginSchema.parse({ email: "notanemail", password: "Pass1!" })
    ).toThrow();
  });

  it("rejects empty password", () => {
    expect(() =>
      loginSchema.parse({ email: "user@example.com", password: "" })
    ).toThrow();
  });

  it("rejects missing email", () => {
    expect(() => loginSchema.parse({ password: "Pass1!" })).toThrow();
  });
});

/* ── registerSchema ───────────────────────────────────────────────────────── */

describe("registerSchema", () => {
  it("accepts valid registration data", () => {
    expect(() =>
      registerSchema.parse({ email: "new@example.com", password: "Secure123!" })
    ).not.toThrow();
  });

  it("rejects password shorter than 8 characters", () => {
    expect(() =>
      registerSchema.parse({ email: "new@example.com", password: "Ab1" })
    ).toThrow();
  });

  it("rejects invalid email", () => {
    expect(() =>
      registerSchema.parse({ email: "bad-email", password: "Secure123!" })
    ).toThrow();
  });
});

/* ── refreshSchema ────────────────────────────────────────────────────────── */

describe("refreshSchema", () => {
  it("accepts a non-empty refreshToken string", () => {
    expect(() =>
      refreshSchema.parse({ refreshToken: "some-refresh-token-value" })
    ).not.toThrow();
  });

  it("rejects empty refreshToken", () => {
    expect(() => refreshSchema.parse({ refreshToken: "" })).toThrow();
  });

  it("rejects missing refreshToken", () => {
    expect(() => refreshSchema.parse({})).toThrow();
  });
});

/* ── startSessionSchema ───────────────────────────────────────────────────── */

describe("startSessionSchema", () => {
  const valid = {
    strategy: "ema-crossover",
    userId:   "user-1",
    symbol:   "BTCUSDT",
  };

  it("accepts valid session start payload", () => {
    expect(() => startSessionSchema.parse(valid)).not.toThrow();
  });

  it("rejects riskPercent greater than 1 (100%)", () => {
    expect(() =>
      startSessionSchema.parse({ ...valid, riskPercent: 5 })
    ).toThrow();
  });

  it("rejects riskPercent below 0", () => {
    expect(() =>
      startSessionSchema.parse({ ...valid, riskPercent: -0.01 })
    ).toThrow();
  });

  it("rejects missing strategy", () => {
    expect(() =>
      startSessionSchema.parse({ userId: "user-1", symbol: "BTCUSDT" })
    ).toThrow();
  });
});

/* ── stopSessionSchema ────────────────────────────────────────────────────── */

describe("stopSessionSchema", () => {
  it("accepts valid stop payload", () => {
    expect(() =>
      stopSessionSchema.parse({ sessionId: "sess-123", userId: "user-1" })
    ).not.toThrow();
  });

  it("rejects missing sessionId", () => {
    expect(() => stopSessionSchema.parse({ userId: "user-1" })).toThrow();
  });
});
