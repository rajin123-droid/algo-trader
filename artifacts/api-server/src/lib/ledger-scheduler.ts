/**
 * Ledger Scheduler — Automated Financial Integrity Monitoring
 *
 * Runs on a configurable schedule:
 *   - Every 60 minutes: full ledger reconciliation (debit/credit balance per tx)
 *   - Every 60 minutes: global sum invariant check (SUM debits = SUM credits)
 *   - Every 60 minutes: negative balance scan (no account should be < 0)
 *   - Every 6 hours:    hash chain verification (anti-tampering check)
 *
 * All results pushed to Prometheus metrics for alerting.
 * Critical failures are also written to the audit log.
 */

import { logger } from "./logger.js";
import { reconcileLedger } from "./reconciliation.js";
import { LedgerService } from "./ledger-service.js";
import {
  negativeBalanceGauge,
  ledgerChainBreaksTotal,
} from "../../../../services/observability/src/index.js";

let reconcileTimer:     ReturnType<typeof setInterval> | null = null;
let chainVerifyTimer:   ReturnType<typeof setInterval> | null = null;
let negBalanceTimer:    ReturnType<typeof setInterval> | null = null;

const RECONCILE_INTERVAL_MS    = 60 * 60_000;      // 1 hour
const CHAIN_VERIFY_INTERVAL_MS = 6 * 60 * 60_000;  // 6 hours
const NEG_BALANCE_INTERVAL_MS  = 60 * 60_000;      // 1 hour

/* ── Per-job overlap guards ───────────────────────────────────────────────── */

/**
 * Each flag prevents the same job from running concurrently with itself.
 * If a run is still in progress when the next interval fires, the new
 * invocation is skipped and a warning is logged.
 */
let reconcileRunning   = false;
let integrityRunning   = false;
let negBalanceRunning  = false;
let chainVerifyRunning = false;

/* ── Individual jobs ──────────────────────────────────────────────────────── */

async function runReconciliation(): Promise<void> {
  if (reconcileRunning) {
    logger.warn("Reconciliation still in progress — skipping overlapping run");
    return;
  }
  reconcileRunning = true;
  try {
    const result = await reconcileLedger("scheduler");
    logger.info(
      { status: result.status, txChecked: result.totalTxChecked, durationMs: result.durationMs },
      "Scheduled reconciliation complete"
    );
  } catch (err) {
    logger.error({ err }, "Scheduled reconciliation failed");
  } finally {
    reconcileRunning = false;
  }
}

async function runGlobalIntegrityCheck(): Promise<void> {
  if (integrityRunning) {
    logger.warn("Global integrity check still in progress — skipping overlapping run");
    return;
  }
  integrityRunning = true;
  try {
    const result = await LedgerService.verifyGlobalIntegrity();
    if (!result.pass) {
      logger.error(
        { debit: result.totalDebit, credit: result.totalCredit, imbalance: result.imbalance },
        "CRITICAL: Scheduled global integrity check FAILED"
      );
    } else {
      logger.info({ debit: result.totalDebit }, "Global ledger integrity OK");
    }
  } catch (err) {
    logger.error({ err }, "Scheduled global integrity check failed");
  } finally {
    integrityRunning = false;
  }
}

async function runNegativeBalanceScan(): Promise<void> {
  if (negBalanceRunning) {
    logger.warn("Negative balance scan still in progress — skipping overlapping run");
    return;
  }
  negBalanceRunning = true;
  try {
    const negative = await LedgerService.findNegativeBalances();
    negativeBalanceGauge.set(negative.length);

    if (negative.length > 0) {
      logger.error(
        { count: negative.length, accounts: negative.map((a) => ({ id: a.accountId, asset: a.asset })) },
        "CRITICAL: Negative balance accounts found in scheduled scan"
      );
    } else {
      logger.info("Negative balance scan: all accounts OK");
    }
  } catch (err) {
    logger.error({ err }, "Scheduled negative balance scan failed");
  } finally {
    negBalanceRunning = false;
  }
}

async function runChainVerification(): Promise<void> {
  if (chainVerifyRunning) {
    logger.warn("Hash chain verification still in progress — skipping overlapping run");
    return;
  }
  chainVerifyRunning = true;
  try {
    const result = await LedgerService.verifyHashChain();
    if (!result.valid) {
      ledgerChainBreaksTotal.inc({ severity: "critical" });
      logger.error(
        { firstBreak: result.firstBreak, checked: result.entriesChecked },
        "CRITICAL: Hash chain verification FAILED — possible ledger tampering"
      );
    } else {
      logger.info(
        { checked: result.entriesChecked, legacy: result.skippedLegacy },
        "Hash chain verification: PASS"
      );
    }
  } catch (err) {
    logger.error({ err }, "Scheduled chain verification failed");
  } finally {
    chainVerifyRunning = false;
  }
}

/* ── Scheduler lifecycle ──────────────────────────────────────────────────── */

export function startLedgerScheduler(): void {
  if (reconcileTimer) {
    logger.warn("Ledger scheduler already running — ignoring duplicate start");
    return;
  }

  logger.info(
    {
      reconcileIntervalMin:  RECONCILE_INTERVAL_MS / 60_000,
      chainVerifyIntervalHr: CHAIN_VERIFY_INTERVAL_MS / 3_600_000,
    },
    "Ledger scheduler started"
  );

  // Run immediately at startup (staggered by 30s to avoid startup congestion)
  setTimeout(runReconciliation,     30_000).unref();
  setTimeout(runGlobalIntegrityCheck, 45_000).unref();
  setTimeout(runNegativeBalanceScan,  60_000).unref();
  setTimeout(runChainVerification,   120_000).unref();

  // Then on schedule
  reconcileTimer   = setInterval(() => {
    void runReconciliation();
    void runGlobalIntegrityCheck();
  }, RECONCILE_INTERVAL_MS);

  negBalanceTimer  = setInterval(runNegativeBalanceScan, NEG_BALANCE_INTERVAL_MS);
  chainVerifyTimer = setInterval(runChainVerification,   CHAIN_VERIFY_INTERVAL_MS);

  reconcileTimer.unref();
  negBalanceTimer.unref();
  chainVerifyTimer.unref();
}

export function stopLedgerScheduler(): void {
  if (reconcileTimer)   { clearInterval(reconcileTimer);   reconcileTimer   = null; }
  if (negBalanceTimer)  { clearInterval(negBalanceTimer);  negBalanceTimer  = null; }
  if (chainVerifyTimer) { clearInterval(chainVerifyTimer); chainVerifyTimer = null; }
  logger.info("Ledger scheduler stopped");
}
