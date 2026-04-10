import { pgTable, text, numeric, timestamp, bigserial } from "drizzle-orm/pg-core";

/**
 * entries — individual debit/credit lines within a transaction.
 *
 * Convention (standard asset account accounting):
 *   DEBIT  → balance INCREASES  (receiving funds)
 *   CREDIT → balance DECREASES  (sending funds)
 *
 * Balance formula:
 *   balance = Σ DEBIT amounts − Σ CREDIT amounts
 *
 * Invariant enforced in LedgerService before every insert:
 *   Σ entries[side=DEBIT].amount = Σ entries[side=CREDIT].amount
 *
 * amount is always a positive number — the side column determines direction.
 *
 * Hash Chain (Anti-Tampering):
 *   seq       — globally sequential auto-increment (used for ordering)
 *   prevHash  — SHA-256 of the previous entry's entryHash (or GENESIS for first)
 *   entryHash — SHA-256(id|transactionId|accountId|amount|side|prevHash)
 *
 *   Any modification to any entry field breaks all subsequent hashes,
 *   making tampering immediately detectable via verifyHashChain().
 *   Legacy entries (pre-chain) have null hashes.
 */
export const entriesTable = pgTable("entries", {
  id:            text("id").primaryKey(),
  transactionId: text("transaction_id").notNull(),
  accountId:     text("account_id").notNull(),
  amount:        numeric("amount", { precision: 20, scale: 8 }).notNull(),
  side:          text("side").notNull(),
  createdAt:     timestamp("created_at").defaultNow(),
  // Hash chain columns (nullable → existing rows are "pre-chain" legacy entries)
  seq:           bigserial("seq", { mode: "number" }),
  prevHash:      text("prev_hash"),
  entryHash:     text("entry_hash"),
});

export type NewEntry = typeof entriesTable.$inferInsert;
export type EntryRow = typeof entriesTable.$inferSelect;
