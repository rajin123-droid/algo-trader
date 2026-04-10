/**
 * Ledger Reconciliation — verifies the double-entry bookkeeping invariant.
 *
 * Invariant: for every transaction,
 *   Σ entries WHERE side = 'DEBIT'  = Σ entries WHERE side = 'CREDIT'
 *
 * Reports discrepancies and pushes the imbalance total to the
 * ledger_imbalance_total Prometheus gauge (CRITICAL: must always be 0).
 */

import { db } from "@workspace/db";
import { entriesTable, transactionsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  ledgerImbalanceGauge,
  reconcileCounter,
} from "../../../../services/observability/src/index.js";
import { tracedSpan } from "../../../../services/observability/src/index.js";
import { auditLog, AuditAction } from "./audit-log.js";
import { logger } from "./logger.js";

export interface ReconciliationDiscrepancy {
  transactionId: string;
  totalDebit:    number;
  totalCredit:   number;
  delta:         number;
}

export interface ReconciliationResult {
  status:          "PASS" | "FAIL";
  checkedAt:       Date;
  durationMs:      number;
  totalTxChecked:  number;
  discrepancies:   ReconciliationDiscrepancy[];
  largestDelta:    number;
  totalImbalance:  number;
  summary:         string;
}

export async function reconcileLedger(
  triggeredBy?: string,
  epsilon = 0.000001
): Promise<ReconciliationResult> {
  return tracedSpan("ledger", "reconcile-ledger", async (span) => {
    const start = Date.now();
    logger.info({ triggeredBy }, "Ledger reconciliation started");

    const allTx = await db.select({ id: transactionsTable.id }).from(transactionsTable);
    const totalTxChecked = allTx.length;
    span.setAttribute("ledger.tx_count", totalTxChecked);

    const aggregated = await db
      .select({
        transactionId: entriesTable.transactionId,
        totalDebit:    sql<number>`SUM(CASE WHEN ${entriesTable.side} = 'DEBIT'  THEN ${entriesTable.amount}::numeric ELSE 0 END)`,
        totalCredit:   sql<number>`SUM(CASE WHEN ${entriesTable.side} = 'CREDIT' THEN ${entriesTable.amount}::numeric ELSE 0 END)`,
      })
      .from(entriesTable)
      .groupBy(entriesTable.transactionId);

    const discrepancies: ReconciliationDiscrepancy[] = [];

    for (const row of aggregated) {
      const delta = Math.abs(Number(row.totalDebit) - Number(row.totalCredit));
      if (delta > epsilon) {
        discrepancies.push({
          transactionId: row.transactionId,
          totalDebit:    Number(row.totalDebit),
          totalCredit:   Number(row.totalCredit),
          delta,
        });
      }
    }

    const largestDelta    = discrepancies.reduce((m, d) => Math.max(m, d.delta), 0);
    const totalImbalance  = discrepancies.reduce((s, d) => s + d.delta, 0);
    const status: "PASS" | "FAIL" = discrepancies.length === 0 ? "PASS" : "FAIL";
    const durationMs = Date.now() - start;

    // ── Push to Prometheus ────────────────────────────────────────────────
    // CRITICAL gauge: any non-zero value fires an alert
    ledgerImbalanceGauge.set(totalImbalance);
    reconcileCounter.inc({ result: status.toLowerCase() });

    span.setAttribute("ledger.status",        status);
    span.setAttribute("ledger.discrepancies",  discrepancies.length);
    span.setAttribute("ledger.total_imbalance", totalImbalance);

    const summary = status === "PASS"
      ? `All ${totalTxChecked} transactions balanced`
      : `${discrepancies.length} unbalanced transactions (imbalance: ${totalImbalance.toFixed(8)})`;

    logger.info({ status, totalTxChecked, discrepancies: discrepancies.length, durationMs }, "Ledger reconciliation complete");

    await auditLog({
      userId:   triggeredBy,
      action:   status === "PASS" ? AuditAction.RECONCILE_PASS : AuditAction.RECONCILE_FAIL,
      resource: "ledger",
      payload:  { totalTxChecked, discrepancyCount: discrepancies.length, totalImbalance, durationMs },
    });

    return { status, checkedAt: new Date(), durationMs, totalTxChecked, discrepancies, largestDelta, totalImbalance, summary };
  });
}
