export type TransactionType = "TRADE" | "DEPOSIT" | "WITHDRAWAL" | "FEE";

/**
 * Transaction — one balanced accounting event.
 *
 * A transaction groups 2 or more Entry rows that must satisfy:
 *   Σ DEBIT amounts = Σ CREDIT amounts
 *
 * This invariant is enforced by LedgerService before every insert.
 * If it fails, the entire transaction is rejected (no partial writes).
 *
 * orderId links back to the order that triggered this transaction
 * (null for deposits / withdrawals).
 */
export interface Transaction {
  id: string;
  type: TransactionType;
  orderId: string | null;
  createdAt: Date;
}
