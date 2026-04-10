/**
 * Balance Snapshot Service
 *
 * Captures a point-in-time snapshot of Binance account balances and persists
 * them to `balance_snapshots` for historical trending and reconciliation.
 *
 * Each call inserts one row per non-zero asset.
 * All rows from one call share the same `capturedAt` timestamp.
 */

import { db } from "@workspace/db";
import { balanceSnapshotsTable } from "@workspace/db";
import { getExchangeBalances } from "./binance/binance.service.js";
import { hasLiveCredentials } from "./binance/binance.client.js";
import { logger } from "../lib/logger.js";
import { randomUUID } from "crypto";

export interface BalanceSnapshotResult {
  capturedAt:    Date;
  assetCount:    number;
  skipped:       boolean;
  skipReason?:   string;
  balances:      Array<{ asset: string; free: number; locked: number }>;
}

/**
 * Fetch current Binance balances and persist a snapshot.
 * Returns immediately (no throw) if credentials are not configured.
 */
export async function captureBalanceSnapshot(): Promise<BalanceSnapshotResult> {
  const capturedAt = new Date();

  if (!hasLiveCredentials()) {
    return {
      capturedAt, assetCount: 0, skipped: true,
      skipReason: "Binance credentials not configured",
      balances: [],
    };
  }

  let rawBalances: Array<{ asset: string; free: number; locked: number }>;
  try {
    rawBalances = await getExchangeBalances();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Balance snapshot: failed to fetch from Binance");
    return {
      capturedAt, assetCount: 0, skipped: true,
      skipReason: `Binance API error: ${msg}`,
      balances: [],
    };
  }

  if (rawBalances.length === 0) {
    return { capturedAt, assetCount: 0, skipped: false, balances: [] };
  }

  try {
    const rows = rawBalances.map((b) => ({
      id:         randomUUID(),
      source:     "exchange",
      asset:      b.asset,
      free:       b.free,
      locked:     b.locked,
      capturedAt,
    }));

    await db.insert(balanceSnapshotsTable).values(rows);

    logger.info({ assetCount: rows.length, capturedAt }, "Balance snapshot saved");
    return { capturedAt, assetCount: rows.length, skipped: false, balances: rawBalances };
  } catch (err) {
    logger.error({ err }, "Balance snapshot: failed to persist to DB");
    return {
      capturedAt, assetCount: 0, skipped: true,
      skipReason: "DB insert failed",
      balances: rawBalances,
    };
  }
}

/**
 * Return the most recent balance snapshot rows (last N assets snapshots).
 */
export async function getLatestSnapshot(limit = 50): Promise<{
  capturedAt: Date | null;
  balances: Array<{ asset: string; free: number; locked: number }>;
}> {
  const rows = await db
    .select()
    .from(balanceSnapshotsTable)
    .orderBy(balanceSnapshotsTable.capturedAt)
    .limit(limit);

  if (rows.length === 0) return { capturedAt: null, balances: [] };

  // Most recent capturedAt
  const latest = rows.reduce((a, b) =>
    new Date(a.capturedAt) > new Date(b.capturedAt) ? a : b
  );
  const latestTs = new Date(latest.capturedAt);

  // Filter rows to only those from the latest snapshot
  const latestRows = rows.filter(
    (r) => Math.abs(new Date(r.capturedAt).getTime() - latestTs.getTime()) < 5000
  );

  return {
    capturedAt: latestTs,
    balances: latestRows.map((r) => ({
      asset: r.asset,
      free:  r.free,
      locked: r.locked,
    })),
  };
}
