/**
 * Exchange Sync Scheduler
 *
 * Background loops that keep our internal state in sync with Binance:
 *
 *   • Trade sync     — every 30 s: for each live session, sync fills
 *   • Balance snap   — every 60 s: capture Binance balance snapshot
 *   • Exchange recon — every 5 min: full Exchange ↔ Internal reconciliation
 *
 * All intervals are soft (setInterval). A single run failing does NOT kill
 * subsequent runs. Each loop catches and logs its own errors.
 *
 * Only runs when at least one Binance credential is configured.
 */

import { reconcileExchange } from "./exchange-reconciliation.js";
import { captureBalanceSnapshot } from "./balance-snapshot.js";
import { hasLiveCredentials } from "./binance/binance.client.js";
import { startUserDataStream, stopUserDataStream } from "./binance/user-data-stream.js";
import { logger } from "../lib/logger.js";

const TRADE_SYNC_INTERVAL_MS   = 30_000;   //  30 s
const BALANCE_SNAP_INTERVAL_MS = 60_000;   //  60 s
const RECON_INTERVAL_MS        = 5 * 60_000; //   5 min

let tradeSyncTimer:   ReturnType<typeof setInterval> | null = null;
let balanceSnapTimer: ReturnType<typeof setInterval> | null = null;
let reconTimer:       ReturnType<typeof setInterval> | null = null;

/* ── Per-job overlap guards ──────────────────────────────────────────────── */

let balanceSnapRunning = false;
let reconRunning       = false;

/* ── Loop runners ────────────────────────────────────────────────────────── */

async function runBalanceSnapshot(): Promise<void> {
  if (!hasLiveCredentials()) return;
  if (balanceSnapRunning) {
    logger.warn("Balance snapshot still in progress — skipping overlapping run");
    return;
  }
  balanceSnapRunning = true;
  try {
    const result = await captureBalanceSnapshot();
    if (!result.skipped) {
      logger.debug({ assetCount: result.assetCount }, "Scheduled balance snapshot saved");
    }
  } catch (err) {
    logger.error({ err }, "Scheduled balance snapshot failed");
  } finally {
    balanceSnapRunning = false;
  }
}

async function runExchangeRecon(): Promise<void> {
  if (!hasLiveCredentials()) return;
  if (reconRunning) {
    logger.warn("Exchange reconciliation still in progress — skipping overlapping run");
    return;
  }
  reconRunning = true;
  try {
    const result = await reconcileExchange("scheduler");
    if (result.status === "FAIL") {
      logger.error(
        { mismatches: result.mismatches.length, orphans: result.totalOrphans, summary: result.summary },
        "SCHEDULED EXCHANGE RECON FAILURE"
      );
    } else {
      logger.info({ status: result.status, summary: result.summary }, "Scheduled exchange recon complete");
    }
  } catch (err) {
    logger.error({ err }, "Scheduled exchange recon failed");
  } finally {
    reconRunning = false;
  }
}

/* ── Public API ─────────────────────────────────────────────────────────── */

export function startExchangeSyncScheduler(): void {
  if (tradeSyncTimer || balanceSnapTimer || reconTimer) {
    logger.warn("Exchange sync scheduler already running — skipping duplicate start");
    return;
  }

  logger.info(
    { tradeSyncIntervalMs: TRADE_SYNC_INTERVAL_MS, balanceSnapIntervalMs: BALANCE_SNAP_INTERVAL_MS, reconIntervalMs: RECON_INTERVAL_MS },
    "Exchange sync scheduler started"
  );

  // Real-time execution updates via Binance user data stream.
  // The stream pushes fill events instantly; trade-sync.ts poll is the safety net.
  startUserDataStream();

  // Balance snapshot loop
  balanceSnapTimer = setInterval(runBalanceSnapshot, BALANCE_SNAP_INTERVAL_MS);

  // Full reconciliation loop
  reconTimer = setInterval(runExchangeRecon, RECON_INTERVAL_MS);

  // Run an initial balance snapshot after 10 s (server warm-up)
  setTimeout(runBalanceSnapshot, 10_000);
}

export function stopExchangeSyncScheduler(): void {
  stopUserDataStream();
  if (tradeSyncTimer)   { clearInterval(tradeSyncTimer);   tradeSyncTimer   = null; }
  if (balanceSnapTimer) { clearInterval(balanceSnapTimer); balanceSnapTimer = null; }
  if (reconTimer)       { clearInterval(reconTimer);       reconTimer       = null; }
  logger.info("Exchange sync scheduler stopped");
}
