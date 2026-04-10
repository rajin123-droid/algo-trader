/**
 * Trade Sync Service
 *
 * Fetches recent fills from Binance for a live session and reconciles them
 * against our internal `auto_trades` table.
 *
 * De-duplication key: `exchange_order_id` (Binance orderId as string).
 *
 * For every Binance fill:
 *   • Already tracked (exchangeOrderId in our DB) → update exchangeStatus if changed
 *   • Not tracked (orphan)                        → logged in sync audit row
 *
 * Orphans indicate trades placed outside our system — a critical anomaly.
 */

import { db } from "@workspace/db";
import {
  autoTradesTable,
  exchangeTradeSyncLogsTable,
} from "@workspace/db";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { binanceClient, hasLiveCredentials } from "./binance/binance.client.js";
import { logger } from "../lib/logger.js";
import { randomUUID } from "crypto";

/* ── Types ──────────────────────────────────────────────────────────────── */

export interface BinanceFill {
  id:          number;
  orderId:     number;
  symbol:      string;
  price:       string;
  qty:         string;
  commission:  string;
  commissionAsset: string;
  time:        number;
  isBuyer:     boolean;
  isMaker:     boolean;
}

export interface TradeSyncResult {
  sessionId:         string;
  symbol:            string;
  fetchedCount:      number;
  alreadyKnownCount: number;
  orphanCount:       number;
  statusUpdates:     number;
  orphans:           string[];
  error?:            string;
  syncedAt:          Date;
}

/* ── Fetch raw fills from Binance ────────────────────────────────────────── */

async function fetchBinanceFills(symbol: string, limit = 50): Promise<BinanceFill[]> {
  const res = await binanceClient.myTrades(symbol, { limit }) as {
    data: BinanceFill[];
  };
  return res.data;
}

/* ── Core sync ──────────────────────────────────────────────────────────── */

export async function syncSessionTrades(
  sessionId: string,
  symbol:    string
): Promise<TradeSyncResult> {
  const syncedAt = new Date();

  if (!hasLiveCredentials()) {
    const result: TradeSyncResult = {
      sessionId, symbol,
      fetchedCount: 0, alreadyKnownCount: 0, orphanCount: 0, statusUpdates: 0,
      orphans: [],
      error:   "Binance credentials not configured",
      syncedAt,
    };
    await persistSyncLog(result);
    return result;
  }

  let fills: BinanceFill[] = [];
  try {
    fills = await fetchBinanceFills(symbol);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, sessionId, symbol }, "Trade sync: failed to fetch fills from Binance");
    const result: TradeSyncResult = {
      sessionId, symbol,
      fetchedCount: 0, alreadyKnownCount: 0, orphanCount: 0, statusUpdates: 0,
      orphans: [], error, syncedAt,
    };
    await persistSyncLog(result);
    return result;
  }

  const fetchedCount = fills.length;
  if (fetchedCount === 0) {
    const result: TradeSyncResult = {
      sessionId, symbol, fetchedCount: 0,
      alreadyKnownCount: 0, orphanCount: 0, statusUpdates: 0,
      orphans: [], syncedAt,
    };
    await persistSyncLog(result);
    return result;
  }

  // Build set of Binance orderIds (as strings) from fills
  const binanceOrderIds = [...new Set(fills.map((f) => String(f.orderId)))];

  // Find which of those we already have in our DB for this session.
  // isNotNull guard is required: inArray against a nullable column can match
  // rows where exchangeOrderId IS NULL if the driver coerces NULL incorrectly.
  const existing = await db
    .select({ id: autoTradesTable.id, exchangeOrderId: autoTradesTable.exchangeOrderId, exchangeStatus: autoTradesTable.exchangeStatus })
    .from(autoTradesTable)
    .where(
      and(
        eq(autoTradesTable.sessionId, sessionId),
        isNotNull(autoTradesTable.exchangeOrderId),
        inArray(autoTradesTable.exchangeOrderId as any, binanceOrderIds)
      )
    );

  const knownOrderIds = new Set(existing.map((r) => r.exchangeOrderId).filter(Boolean));
  const orphanOrderIds = binanceOrderIds.filter((id) => !knownOrderIds.has(id));

  // Update exchange status to "FILLED" for known orders that we haven't updated yet
  let statusUpdates = 0;
  for (const row of existing) {
    if (row.exchangeStatus !== "FILLED" && row.exchangeOrderId) {
      await db
        .update(autoTradesTable)
        .set({ exchangeStatus: "FILLED" })
        .where(eq(autoTradesTable.id, row.id));
      statusUpdates++;
    }
  }

  const result: TradeSyncResult = {
    sessionId,
    symbol,
    fetchedCount,
    alreadyKnownCount: knownOrderIds.size,
    orphanCount:       orphanOrderIds.length,
    statusUpdates,
    orphans:           orphanOrderIds.slice(0, 50),
    syncedAt,
  };

  if (orphanOrderIds.length > 0) {
    logger.warn({ sessionId, symbol, orphanCount: orphanOrderIds.length, orphans: orphanOrderIds.slice(0, 5) },
      "Trade sync: orphan fills detected — trades on exchange not in our DB");
  } else {
    logger.info({ sessionId, symbol, fetchedCount, statusUpdates }, "Trade sync: complete");
  }

  await persistSyncLog(result);
  return result;
}

/* ── Persist sync audit log ─────────────────────────────────────────────── */

async function persistSyncLog(result: TradeSyncResult): Promise<void> {
  try {
    await db.insert(exchangeTradeSyncLogsTable).values({
      id:                randomUUID(),
      sessionId:         result.sessionId,
      symbol:            result.symbol,
      fetchedCount:      result.fetchedCount,
      alreadyKnownCount: result.alreadyKnownCount,
      orphanCount:       result.orphanCount,
      statusUpdates:     result.statusUpdates,
      orphans:           JSON.stringify(result.orphans),
      error:             result.error ?? null,
      syncedAt:          result.syncedAt,
    });
  } catch (err) {
    logger.error({ err }, "Trade sync: failed to persist sync log");
  }
}
