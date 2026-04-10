import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * transactions — one row per double-entry accounting event.
 *
 * A transaction groups 2+ entries that must balance:
 *   Σ DEBIT amounts = Σ CREDIT amounts
 *
 * Each trade fill creates one transaction with four entries:
 *   user USDT account   CREDIT (loses USDT)
 *   system USDT account DEBIT  (gains USDT)
 *   user BTC account    DEBIT  (gains BTC)
 *   system BTC account  CREDIT (loses BTC)
 *
 * type = 'TRADE' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE'
 */
export const transactionsTable = pgTable("transactions", {
  id: text("id").primaryKey(),
  type: text("type").notNull().default("TRADE"),
  orderId: text("order_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type NewTransaction = typeof transactionsTable.$inferInsert;
export type TransactionRow = typeof transactionsTable.$inferSelect;
