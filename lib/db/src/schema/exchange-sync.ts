/**
 * Exchange Sync Schema
 *
 * balance_snapshots   — point-in-time Binance account balance captures
 * exchange_recon_logs — results of each Exchange ↔ Internal reconciliation run
 */

import { pgTable, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ── balance_snapshots ────────────────────────────────────────────────────── */

/**
 * One row per asset per snapshot run.
 * capturedAt ties all rows from a single run together.
 */
export const balanceSnapshotsTable = pgTable("balance_snapshots", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),

  /** "exchange" for Binance snapshots; a userId for internal ledger snapshots. */
  source:    text("source").notNull().default("exchange"),
  asset:     text("asset").notNull(),
  free:      real("free").notNull().default(0),
  locked:    real("locked").notNull().default(0),

  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BalanceSnapshot    = typeof balanceSnapshotsTable.$inferSelect;
export type NewBalanceSnapshot = typeof balanceSnapshotsTable.$inferInsert;

/* ── exchange_recon_logs ──────────────────────────────────────────────────── */

/**
 * One row per reconciliation run.
 * `mismatches` is a JSON array of ExchangeMismatch objects.
 */
export const exchangeReconLogsTable = pgTable("exchange_recon_logs", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),

  /** "PASS" | "FAIL" | "SKIP" | "ERROR" */
  status: text("status").notNull(),

  /** Number of active live sessions checked. */
  sessionCount: integer("session_count").notNull().default(0),

  /** JSON-serialised ExchangeMismatch[]. */
  mismatches: text("mismatches").notNull().default("[]"),

  /** "scheduler" | "admin" | "admin:<userId>" */
  triggeredBy: text("triggered_by"),

  durationMs: integer("duration_ms"),
  error:      text("error"),

  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExchangeReconLog    = typeof exchangeReconLogsTable.$inferSelect;
export type NewExchangeReconLog = typeof exchangeReconLogsTable.$inferInsert;

/* ── exchange_trade_sync_logs ─────────────────────────────────────────────── */

/**
 * Audit trail for every trade-sync run (per session).
 */
export const exchangeTradeSyncLogsTable = pgTable("exchange_trade_sync_logs", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),

  sessionId: text("session_id").notNull(),
  symbol:    text("symbol").notNull(),

  /** Binance fills examined during this sync. */
  fetchedCount: integer("fetched_count").notNull().default(0),

  /** Fills already in our DB (skipped). */
  alreadyKnownCount: integer("already_known_count").notNull().default(0),

  /** Fills found on exchange but NOT in our DB (orphans). */
  orphanCount: integer("orphan_count").notNull().default(0),

  /** Exchange status updates applied to auto_trades rows. */
  statusUpdates: integer("status_updates").notNull().default(0),

  /** JSON array of orphan exchange order IDs (max 50). */
  orphans: text("orphans").notNull().default("[]"),

  error: text("error"),

  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExchangeTradeSyncLog    = typeof exchangeTradeSyncLogsTable.$inferSelect;
export type NewExchangeTradeSyncLog = typeof exchangeTradeSyncLogsTable.$inferInsert;
