/**
 * Exchange Reconciliation Engine
 *
 * Compares our internal system state vs the live Binance account for all
 * sessions running in "live" mode.
 *
 * Reconciliation steps:
 *   1. Find all distinct symbols used by active live sessions.
 *   2. For each symbol: run a trade sync (fills vs auto_trades).
 *   3. Capture a Binance balance snapshot.
 *   4. Compare Binance balances against our last-known internal positions
 *      (tracked in auto_trades cumulative BUY/SELL quantities).
 *   5. Report any asset whose absolute difference exceeds TOLERANCE.
 *   6. Persist result to exchange_recon_logs.
 *
 * PRINCIPLE: Exchange is source of truth. Any mismatch is a CRITICAL anomaly.
 */

import { db } from "@workspace/db";
import {
  autoTradingSessionsTable,
  autoTradesTable,
  exchangeReconLogsTable,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { hasLiveCredentials } from "./binance/binance.client.js";
import { getExchangeBalances } from "./binance/binance.service.js";
import { captureBalanceSnapshot } from "./balance-snapshot.js";
import { syncSessionTrades, type TradeSyncResult } from "./trade-sync.js";
import { logger } from "../lib/logger.js";
import { randomUUID } from "crypto";

/* ── Tolerance ───────────────────────────────────────────────────────────── */

/** Minimum absolute difference (in asset units) to trigger a mismatch alert. */
const TOLERANCE = 0.0001;

/* ── Types ──────────────────────────────────────────────────────────────── */

export interface ExchangeMismatch {
  asset:          string;
  internal:       number;   // what our system thinks the balance is
  exchange:       number;   // what Binance reports
  diff:           number;   // Math.abs(internal - exchange)
  direction:      "OVER" | "UNDER";  // are we over or under-reporting?
}

export interface ExchangeReconResult {
  status:        "PASS" | "FAIL" | "SKIP" | "ERROR";
  runAt:         Date;
  durationMs:    number;
  sessionCount:  number;
  tradeSync:     TradeSyncResult[];
  snapshot:      { capturedAt: Date | null; assetCount: number };
  mismatches:    ExchangeMismatch[];
  totalOrphans:  number;
  summary:       string;
  error?:        string;
}

/* ── Internal position computation ──────────────────────────────────────── */

/**
 * Compute our internally-tracked net position for each asset from auto_trades.
 *
 * BUY  signals → we acquired `size` base-asset units (e.g. BTC)
 * SELL signals → we disposed of `size` base-asset units
 *
 * This gives a rough "what we expect to hold" figure.
 * It does NOT account for fees or partial fills.
 */
async function computeInternalPositions(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      signal: autoTradesTable.signal,
      symbol: sql<string>`split_part(${autoTradesTable.signal}, '-', 1)`,  // fallback
      size:   autoTradesTable.size,
      sessionSymbol: autoTradingSessionsTable.symbol,
    })
    .from(autoTradesTable)
    .leftJoin(autoTradingSessionsTable, eq(autoTradesTable.sessionId, autoTradingSessionsTable.id))
    .where(
      and(
        eq(autoTradesTable.executionMode, "live"),
        eq(autoTradesTable.status, "EXECUTED")
      )
    );

  const positions = new Map<string, number>();

  for (const row of rows) {
    const symbol = row.sessionSymbol ?? "";
    if (!symbol || symbol.length < 5) continue;

    // Derive base asset from symbol (e.g. "BTCUSDT" → "BTC", "ETHUSDT" → "ETH")
    const base = symbol.replace(/USDT$|BUSD$|BTC$|ETH$|BNB$/, "");
    if (!base) continue;

    const current = positions.get(base) ?? 0;
    const delta   = (Number(row.size) || 0);
    positions.set(base, current + (row.signal === "BUY" ? delta : -delta));
  }

  return positions;
}

/* ── Main reconciliation ─────────────────────────────────────────────────── */

export async function reconcileExchange(
  triggeredBy = "scheduler"
): Promise<ExchangeReconResult> {
  const start = Date.now();
  const runAt = new Date();

  logger.info({ triggeredBy }, "Exchange reconciliation started");

  try {
    // 1. Find active live sessions
    const liveSessions = await db
      .select({ id: autoTradingSessionsTable.id, symbol: autoTradingSessionsTable.symbol })
      .from(autoTradingSessionsTable)
      .where(
        and(
          eq(autoTradingSessionsTable.mode, "live"),
          eq(autoTradingSessionsTable.enabled, true)
        )
      );

    if (liveSessions.length === 0) {
      const result: ExchangeReconResult = {
        status: "SKIP",
        runAt,
        durationMs:   Date.now() - start,
        sessionCount: 0,
        tradeSync:    [],
        snapshot:     { capturedAt: null, assetCount: 0 },
        mismatches:   [],
        totalOrphans: 0,
        summary:      "No active live sessions — skipped",
      };
      await persistReconLog(result, triggeredBy);
      return result;
    }

    if (!hasLiveCredentials()) {
      const result: ExchangeReconResult = {
        status: "SKIP",
        runAt,
        durationMs:   Date.now() - start,
        sessionCount: liveSessions.length,
        tradeSync:    [],
        snapshot:     { capturedAt: null, assetCount: 0 },
        mismatches:   [],
        totalOrphans: 0,
        summary:      "Binance credentials not configured — skipped",
      };
      await persistReconLog(result, triggeredBy);
      return result;
    }

    // 2. Trade sync for each distinct session × symbol
    const tradeSyncResults: TradeSyncResult[] = [];
    for (const session of liveSessions) {
      const syncResult = await syncSessionTrades(session.id, session.symbol);
      tradeSyncResults.push(syncResult);
    }

    // 3. Balance snapshot
    const snapshotResult = await captureBalanceSnapshot();

    // 4. Compare internal positions vs exchange balances
    const exchangeBalances = snapshotResult.balances;
    const internalPositions = await computeInternalPositions();

    const mismatches: ExchangeMismatch[] = [];

    // Check each exchange asset against our internal position
    for (const eb of exchangeBalances) {
      const internal = internalPositions.get(eb.asset) ?? 0;
      const exchange = eb.free + eb.locked;
      const diff     = Math.abs(internal - exchange);

      if (diff > TOLERANCE && (internal > 0 || exchange > 0)) {
        mismatches.push({
          asset:     eb.asset,
          internal,
          exchange,
          diff,
          direction: internal > exchange ? "OVER" : "UNDER",
        });
      }
    }

    // Also check internal positions for assets not on exchange
    for (const [asset, internal] of internalPositions.entries()) {
      const exchangeBalance = exchangeBalances.find((b) => b.asset === asset);
      if (!exchangeBalance && Math.abs(internal) > TOLERANCE) {
        mismatches.push({
          asset,
          internal,
          exchange:  0,
          diff:      Math.abs(internal),
          direction: internal > 0 ? "OVER" : "UNDER",
        });
      }
    }

    const totalOrphans = tradeSyncResults.reduce((s, r) => s + r.orphanCount, 0);
    const status: ExchangeReconResult["status"] = (mismatches.length > 0 || totalOrphans > 0)
      ? "FAIL" : "PASS";

    const summary = status === "PASS"
      ? `All ${liveSessions.length} live session(s) reconciled — no mismatches`
      : `${mismatches.length} balance mismatch(es), ${totalOrphans} orphan fill(s) detected`;

    logger.info({ status, sessionCount: liveSessions.length, mismatches: mismatches.length, totalOrphans },
      "Exchange reconciliation complete");

    if (status === "FAIL") {
      logger.error({ mismatches, totalOrphans }, "EXCHANGE RECONCILIATION FAILURE — INVESTIGATE IMMEDIATELY");
    }

    const result: ExchangeReconResult = {
      status,
      runAt,
      durationMs:   Date.now() - start,
      sessionCount: liveSessions.length,
      tradeSync:    tradeSyncResults,
      snapshot:     { capturedAt: snapshotResult.capturedAt, assetCount: snapshotResult.assetCount },
      mismatches,
      totalOrphans,
      summary,
    };

    await persistReconLog(result, triggeredBy);
    return result;

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Exchange reconciliation error");

    const result: ExchangeReconResult = {
      status:       "ERROR",
      runAt,
      durationMs:   Date.now() - start,
      sessionCount: 0,
      tradeSync:    [],
      snapshot:     { capturedAt: null, assetCount: 0 },
      mismatches:   [],
      totalOrphans: 0,
      summary:      `Reconciliation error: ${error}`,
      error,
    };

    await persistReconLog(result, triggeredBy);
    return result;
  }
}

/* ── Persistence ─────────────────────────────────────────────────────────── */

async function persistReconLog(
  result: ExchangeReconResult,
  triggeredBy: string
): Promise<void> {
  try {
    await db.insert(exchangeReconLogsTable).values({
      id:           randomUUID(),
      status:       result.status,
      sessionCount: result.sessionCount,
      mismatches:   JSON.stringify(result.mismatches),
      triggeredBy,
      durationMs:   result.durationMs,
      error:        result.error ?? null,
      runAt:        result.runAt,
    });
  } catch (err) {
    logger.error({ err }, "Failed to persist exchange recon log");
  }
}

/* ── History query ───────────────────────────────────────────────────────── */

export async function getReconHistory(limit = 20) {
  const rows = await db
    .select()
    .from(exchangeReconLogsTable)
    .orderBy(desc(exchangeReconLogsTable.runAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    mismatches: (() => { try { return JSON.parse(r.mismatches); } catch { return []; } })(),
  }));
}
