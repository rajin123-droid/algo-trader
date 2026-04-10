/**
 * Unit tests — Password policy (src/lib/password-policy.ts)
 *
 * Pure function, no side effects. Tests all NIST/OWASP rules enforced.
 */

import { describe, it, expect } from "vitest";
import { validatePassword } from "../../src/lib/password-policy.js";

describe("validatePassword", () => {
  /* ── Passing cases ──────────────────────────────────────────────────────── */

  it("accepts a valid password with all requirements met", () => {
    const { ok, errors } = validatePassword("Secure1!");
    expect(ok).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("accepts a long complex password", () => {
    const pw = "A".repeat(5) + "b".repeat(5) + "1".repeat(5);
    const { ok } = validatePassword(pw);
    expect(ok).toBe(true);
  });

  it("accepts exactly 8 characters with all rules satisfied", () => {
    const { ok } = validatePassword("Abcdef1!");
    expect(ok).toBe(true);
  });

  it("accepts up to 128 characters", () => {
    const pw = "A1" + "a".repeat(126);
    const { ok } = validatePassword(pw);
    expect(ok).toBe(true);
  });

  /* ── Failing cases ──────────────────────────────────────────────────────── */

  it("rejects empty string", () => {
    const { ok, errors } = validatePassword("");
    expect(ok).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects password shorter than 8 characters", () => {
    const { ok, errors } = validatePassword("Abc1");
    expect(ok).toBe(false);
    expect(errors.some(e => e.includes("8 characters"))).toBe(true);
  });

  it("rejects password exceeding 128 characters", () => {
    const pw = "A1" + "a".repeat(127);
    const { ok, errors } = validatePassword(pw);
    expect(ok).toBe(false);
    expect(errors.some(e => e.includes("128"))).toBe(true);
  });

  it("rejects password with no uppercase letter", () => {
    const { ok, errors } = validatePassword("nouppercase1!");
    expect(ok).toBe(false);
    expect(errors.some(e => e.includes("uppercase"))).toBe(true);
  });

  it("rejects password with no digit", () => {
    const { ok, errors } = validatePassword("NoDigitsHere!");
    expect(ok).toBe(false);
    expect(errors.some(e => e.includes("number"))).toBe(true);
  });

  it("rejects password with leading whitespace", () => {
    const { ok, errors } = validatePassword(" Secure1!");
    expect(ok).toBe(false);
    expect(errors.some(e => e.includes("whitespace"))).toBe(true);
  });

  it("rejects password with trailing whitespace", () => {
    const { ok, errors } = validatePassword("Secure1! ");
    expect(ok).toBe(false);
    expect(errors.some(e => e.includes("whitespace"))).toBe(true);
  });

  it("returns multiple errors when multiple rules fail", () => {
    const { ok, errors } = validatePassword("abc");
    expect(ok).toBe(false);
    expect(errors.length).toBeGreaterThan(1);
  });

  it("handles non-string input gracefully", () => {
    // @ts-expect-error — deliberate type violation to test runtime safety
    const { ok, errors } = validatePassword(null);
    expect(ok).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });
});
