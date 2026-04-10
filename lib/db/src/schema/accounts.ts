import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * accounts — double-entry ledger accounts.
 *
 * Each user has one account per asset (BTC, USDT, ETH …).
 * System accounts (type = 'SYSTEM') represent the exchange side
 * of every trade — they always balance with user accounts.
 *
 * ID generated via crypto.randomUUID() in application code.
 */
export const accountsTable = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  asset: text("asset").notNull(),
  type: text("type").notNull().default("USER"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type NewAccount = typeof accountsTable.$inferInsert;
export type AccountRow = typeof accountsTable.$inferSelect;
