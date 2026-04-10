/**
 * Unit tests — Ledger hash chain (src/lib/ledger-hash-chain.ts)
 *
 * Critical financial integrity primitive.  These tests verify that:
 *   1. The canonical representation is deterministic
 *   2. Hashes are computed correctly
 *   3. Chain verification correctly accepts valid chains
 *   4. Chain verification correctly detects any form of tampering
 */

import { describe, it, expect } from "vitest";
import {
  GENESIS_HASH,
  canonicalEntry,
  computeEntryHash,
  verifyChain,
  type ChainableEntry,
} from "../../src/lib/ledger-hash-chain.js";

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const entry1: ChainableEntry = {
  id:            "entry-1",
  transactionId: "txn-1",
  accountId:     "acc-1",
  amount:        "100.00",
  side:          "DEBIT",
};

const entry2: ChainableEntry = {
  id:            "entry-2",
  transactionId: "txn-2",
  accountId:     "acc-1",
  amount:        "100.00",
  side:          "CREDIT",
};

function buildChainEntry(
  entry: ChainableEntry,
  prevHash: string,
  seq: number
) {
  const hash = computeEntryHash(entry, prevHash);
  return { ...entry, seq, prevHash, entryHash: hash };
}

/* ── GENESIS_HASH ─────────────────────────────────────────────────────────── */

describe("GENESIS_HASH", () => {
  it("is a 64-character hex string (SHA-256)", () => {
    expect(GENESIS_HASH).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable across calls (deterministic)", async () => {
    const { GENESIS_HASH: gh2 } = await import("../../src/lib/ledger-hash-chain.js");
    expect(GENESIS_HASH).toBe(gh2);
  });
});

/* ── canonicalEntry ───────────────────────────────────────────────────────── */

describe("canonicalEntry", () => {
  it("joins all fields with pipe separators", () => {
    const result = canonicalEntry(entry1);
    expect(result).toBe("entry-1|txn-1|acc-1|100.00|DEBIT");
  });

  it("is deterministic for the same input", () => {
    expect(canonicalEntry(entry1)).toBe(canonicalEntry(entry1));
  });

  it("produces different output when any field changes", () => {
    const modified = { ...entry1, amount: "200.00" };
    expect(canonicalEntry(entry1)).not.toBe(canonicalEntry(modified));
  });
});

/* ── computeEntryHash ─────────────────────────────────────────────────────── */

describe("computeEntryHash", () => {
  it("returns a 64-character hex SHA-256 hash", () => {
    const hash = computeEntryHash(entry1, GENESIS_HASH);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic (same inputs → same hash)", () => {
    const h1 = computeEntryHash(entry1, GENESIS_HASH);
    const h2 = computeEntryHash(entry1, GENESIS_HASH);
    expect(h1).toBe(h2);
  });

  it("changes when the entry data changes", () => {
    const h1 = computeEntryHash(entry1, GENESIS_HASH);
    const h2 = computeEntryHash({ ...entry1, amount: "999.99" }, GENESIS_HASH);
    expect(h1).not.toBe(h2);
  });

  it("changes when the prevHash changes", () => {
    const h1 = computeEntryHash(entry1, GENESIS_HASH);
    const h2 = computeEntryHash(entry1, "a".repeat(64));
    expect(h1).not.toBe(h2);
  });
});

/* ── verifyChain ──────────────────────────────────────────────────────────── */

describe("verifyChain", () => {
  it("returns valid=true and entriesChecked=0 for an empty chain", () => {
    const result = verifyChain([]);
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(0);
  });

  it("accepts a correctly-built 1-entry chain", () => {
    const e = buildChainEntry(entry1, GENESIS_HASH, 1);
    const result = verifyChain([e]);
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(1);
    expect(result.skippedLegacy).toBe(0);
  });

  it("accepts a correctly-built 2-entry chain", () => {
    const e1 = buildChainEntry(entry1, GENESIS_HASH, 1);
    const e2 = buildChainEntry(entry2, e1.entryHash, 2);
    const result = verifyChain([e1, e2]);
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(2);
  });

  it("detects a tampered amount field", () => {
    const e1 = buildChainEntry(entry1, GENESIS_HASH, 1);
    const e2 = buildChainEntry(entry2, e1.entryHash, 2);

    // Tamper: change the amount on entry 1 AFTER the chain is built
    const tampered = { ...e1, amount: "999999.00" };

    const result = verifyChain([tampered, e2]);
    expect(result.valid).toBe(false);
    expect(result.firstBreak).toBeDefined();
    expect(result.firstBreak!.seq).toBe(1);
  });

  it("detects a tampered side field", () => {
    const e1 = buildChainEntry(entry1, GENESIS_HASH, 1);
    const tampered = { ...e1, side: "CREDIT" };   // DEBIT → CREDIT

    const result = verifyChain([tampered]);
    expect(result.valid).toBe(false);
  });

  it("detects a tampered entryHash (hash substitution attack)", () => {
    const e1 = buildChainEntry(entry1, GENESIS_HASH, 1);
    const tampered = { ...e1, entryHash: "a".repeat(64) };

    const result = verifyChain([tampered]);
    expect(result.valid).toBe(false);
  });

  it("skips legacy entries (null hashes) and counts them", () => {
    const legacy = {
      ...entry1,
      seq: 1,
      prevHash: null,
      entryHash: null,
    };
    const e2 = buildChainEntry(entry2, GENESIS_HASH, 2);

    const result = verifyChain([legacy, e2]);
    expect(result.valid).toBe(true);
    expect(result.skippedLegacy).toBe(1);
    expect(result.entriesChecked).toBe(1);
  });

  it("detects chain break when prevHash doesn't link correctly", () => {
    const e1 = buildChainEntry(entry1, GENESIS_HASH, 1);
    const e2 = buildChainEntry(entry2, e1.entryHash, 2);

    // Break the chain: entry2 now claims a wrong prevHash
    const broken = { ...e2, prevHash: "b".repeat(64) };

    const result = verifyChain([e1, broken]);
    expect(result.valid).toBe(false);
    expect(result.firstBreak!.seq).toBe(2);
  });
});
