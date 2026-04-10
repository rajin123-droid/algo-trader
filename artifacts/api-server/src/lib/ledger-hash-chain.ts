/**
 * Ledger Hash Chain — cryptographic anti-tampering for ledger entries.
 *
 * Design:
 *   Each entry commits to all previous entries via a SHA-256 chain:
 *
 *     hash_0 = SHA256("GENESIS")
 *     hash_N = SHA256(canonical(entry_N) + hash_{N-1})
 *
 *   canonical(entry) = "{id}|{transactionId}|{accountId}|{amount}|{side}"
 *
 *   This means ANY modification to ANY field of ANY past entry breaks
 *   all subsequent hashes — making tampering immediately detectable.
 *
 * Null hashes = legacy entries written before the chain was introduced.
 * The chain restarts at the first entry that has a non-null entryHash.
 */

import { createHash } from "crypto";

/* ── Constants ────────────────────────────────────────────────────────────── */

export const GENESIS_HASH = createHash("sha256").update("GENESIS").digest("hex");

/* ── Canonical entry representation ──────────────────────────────────────── */

export interface ChainableEntry {
  id:            string;
  transactionId: string;
  accountId:     string;
  amount:        string;   // numeric string from DB
  side:          string;
}

export function canonicalEntry(e: ChainableEntry): string {
  return `${e.id}|${e.transactionId}|${e.accountId}|${e.amount}|${e.side}`;
}

/* ── Hash computation ─────────────────────────────────────────────────────── */

export function computeEntryHash(entry: ChainableEntry, prevHash: string): string {
  return createHash("sha256")
    .update(canonicalEntry(entry) + prevHash)
    .digest("hex");
}

/* ── Chain verification ───────────────────────────────────────────────────── */

export interface ChainVerifyResult {
  valid:          boolean;
  entriesChecked: number;
  firstBreak?:    { seq: number; id: string; expected: string; got: string };
  skippedLegacy:  number;
}

/**
 * Verify a sequence of entries (ordered by seq ASC) forms an intact chain.
 * Entries with null entryHash are treated as legacy and skipped.
 * The chain is re-anchored at the first non-null entry.
 */
export function verifyChain(
  entries: Array<{
    seq:       number | null;
    id:        string;
    transactionId: string;
    accountId: string;
    amount:    string;
    side:      string;
    prevHash:  string | null;
    entryHash: string | null;
  }>
): ChainVerifyResult {
  let prevHash      = GENESIS_HASH;
  let entriesChecked = 0;
  let skippedLegacy  = 0;
  let firstChainEntry = true;

  for (const e of entries) {
    // Skip legacy entries (pre-chain)
    if (!e.entryHash || !e.prevHash) {
      skippedLegacy++;
      continue;
    }

    // First entry in the chain is anchored to GENESIS
    const expectedPrev = firstChainEntry ? GENESIS_HASH : prevHash;
    firstChainEntry    = false;

    if (e.prevHash !== expectedPrev) {
      return {
        valid:          false,
        entriesChecked,
        skippedLegacy,
        firstBreak: {
          seq:      e.seq ?? -1,
          id:       e.id,
          expected: expectedPrev,
          got:      e.prevHash,
        },
      };
    }

    const expectedHash = computeEntryHash(
      { id: e.id, transactionId: e.transactionId, accountId: e.accountId, amount: e.amount, side: e.side },
      e.prevHash
    );

    if (e.entryHash !== expectedHash) {
      return {
        valid:          false,
        entriesChecked,
        skippedLegacy,
        firstBreak: {
          seq:      e.seq ?? -1,
          id:       e.id,
          expected: expectedHash,
          got:      e.entryHash,
        },
      };
    }

    prevHash = e.entryHash;
    entriesChecked++;
  }

  return { valid: true, entriesChecked, skippedLegacy };
}
