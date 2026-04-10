/**
 * Unit tests — Risk engine (src/lib/risk.ts)
 *
 * Pure functions, no DB, no network. These run in milliseconds and
 * protect the core financial calculation logic.
 */

import { describe, it, expect } from "vitest";
import {
  calculatePositionSize,
  calculateSlTp,
  calculateTrailingStop,
  PAPER_BALANCE,
  DEFAULT_RISK_PERCENT,
} from "../../src/lib/risk.js";

/* ── calculatePositionSize ────────────────────────────────────────────────── */

describe("calculatePositionSize", () => {
  it("returns correct qty using risk-based sizing", () => {
    // balance=10000, risk=2%, entry=50000, SL=49000 → risk_amount=200, risk_per_unit=1000 → qty=0.2
    const qty = calculatePositionSize(10_000, 0.02, 50_000, 49_000);
    expect(qty).toBe(0.2);
  });

  it("returns 0 when entry price equals stop-loss (no risk distance)", () => {
    const qty = calculatePositionSize(10_000, 0.02, 50_000, 50_000);
    expect(qty).toBe(0);
  });

  it("scales linearly with balance", () => {
    const half = calculatePositionSize(5_000, 0.02, 50_000, 49_000);
    const full = calculatePositionSize(10_000, 0.02, 50_000, 49_000);
    expect(full).toBeCloseTo(half * 2, 5);
  });

  it("rounds to 3 decimal places", () => {
    // 10000 * 0.02 / 3333 = 0.06000600... → should round to 3dp
    const qty = calculatePositionSize(10_000, 0.02, 50_000, 46_667);
    const decimals = qty.toString().split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(3);
  });

  it("handles SELL side (stop above entry) correctly", () => {
    // SELL: entry=50000, SL=51000 (above entry, risk=1000)
    // risk_amount = 10000*0.02 = 200, qty = 200/1000 = 0.2
    const qty = calculatePositionSize(10_000, 0.02, 50_000, 51_000);
    expect(qty).toBe(0.2);
  });

  it("uses DEFAULT_RISK_PERCENT constant (2%)", () => {
    expect(DEFAULT_RISK_PERCENT).toBe(0.02);
  });

  it("uses PAPER_BALANCE constant ($10 000)", () => {
    expect(PAPER_BALANCE).toBe(10_000);
  });
});

/* ── calculateSlTp ────────────────────────────────────────────────────────── */

describe("calculateSlTp", () => {
  describe("BUY side", () => {
    it("sets SL 2% below entry and TP 4% above entry", () => {
      const { sl, tp } = calculateSlTp(50_000, "BUY");
      expect(sl).toBeCloseTo(49_000, 0);   // 50000 × 0.98
      expect(tp).toBeCloseTo(52_000, 0);   // 50000 × 1.04
    });

    it("SL is strictly below entry price", () => {
      const { sl } = calculateSlTp(65_432.10, "BUY");
      expect(sl).toBeLessThan(65_432.10);
    });

    it("TP is strictly above entry price", () => {
      const { tp } = calculateSlTp(65_432.10, "BUY");
      expect(tp).toBeGreaterThan(65_432.10);
    });
  });

  describe("SELL side", () => {
    it("sets SL 2% above entry and TP 4% below entry", () => {
      const { sl, tp } = calculateSlTp(50_000, "SELL");
      expect(sl).toBeCloseTo(51_000, 0);   // 50000 × 1.02
      expect(tp).toBeCloseTo(48_000, 0);   // 50000 × 0.96
    });

    it("SL is strictly above entry price", () => {
      const { sl } = calculateSlTp(65_432.10, "SELL");
      expect(sl).toBeGreaterThan(65_432.10);
    });

    it("TP is strictly below entry price", () => {
      const { tp } = calculateSlTp(65_432.10, "SELL");
      expect(tp).toBeLessThan(65_432.10);
    });
  });

  it("results are rounded to 2 decimal places", () => {
    const { sl, tp } = calculateSlTp(33_333.33, "BUY");
    const slDecimals = sl.toString().split(".")[1]?.length ?? 0;
    const tpDecimals = tp.toString().split(".")[1]?.length ?? 0;
    expect(slDecimals).toBeLessThanOrEqual(2);
    expect(tpDecimals).toBeLessThanOrEqual(2);
  });
});

/* ── calculateTrailingStop ────────────────────────────────────────────────── */

describe("calculateTrailingStop", () => {
  describe("BUY side", () => {
    it("locks in 50% of profit when in profit", () => {
      // entry=44000, current=46000 → profit=2000 → new_sl = 44000 + 1000 = 45000
      const sl = calculateTrailingStop(44_000, 46_000, "BUY");
      expect(sl).toBe(45_000);
    });

    it("falls back to -2% fixed SL when at a loss", () => {
      // entry=44000, current=43000 → loss → fixed SL = 44000 × 0.98 = 43120
      const sl = calculateTrailingStop(44_000, 43_000, "BUY");
      expect(sl).toBeCloseTo(43_120, 0);
    });

    it("trailing SL is always above original fixed SL when profitable", () => {
      const fixedSl = 44_000 * 0.98;
      const trailingSl = calculateTrailingStop(44_000, 48_000, "BUY");
      expect(trailingSl).toBeGreaterThan(fixedSl);
    });
  });

  describe("SELL side", () => {
    it("locks in 50% of profit when in profit", () => {
      // entry=44000, current=42000 → profit=2000 → new_sl = 44000 - 1000 = 43000
      const sl = calculateTrailingStop(44_000, 42_000, "SELL");
      expect(sl).toBe(43_000);
    });

    it("falls back to +2% fixed SL when at a loss", () => {
      // entry=44000, current=45000 → loss → fixed SL = 44000 × 1.02 = 44880
      const sl = calculateTrailingStop(44_000, 45_000, "SELL");
      expect(sl).toBeCloseTo(44_880, 0);
    });
  });
});
