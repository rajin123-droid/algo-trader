import {
  pgTable,
  text,
  real,
  timestamp,
} from "drizzle-orm/pg-core";

/* ── sor_executions ───────────────────────────────────────────────────────── */

/**
 * Audit log of every Smart Order Router execution.
 *
 * Records both successful multi-venue fills (EXECUTED), partial fills (PARTIAL),
 * and orders rejected by pre-trade risk checks (REJECTED).
 *
 * `fills` is a JSON array of { exchange, price, size } objects — one entry per
 * venue slice that was actually executed.
 */
export const sorExecutionsTable = pgTable("sor_executions", {
  id: text("id").primaryKey(),

  userId: text("user_id").notNull(),

  symbol: text("symbol").notNull(),

  /** "BUY" | "SELL" */
  side: text("side").notNull(),

  requestedSize: real("requested_size").notNull(),
  filledSize:    real("filled_size").notNull().default(0),

  /** Volume-weighted average fill price across all venues. */
  avgPrice: real("avg_price"),

  /** Mid-price of the consolidated order book at time of routing (reference). */
  referencePrice: real("reference_price"),

  /**
   * Slippage in basis points relative to referencePrice.
   * slippage = abs(avgPrice - referencePrice) / referencePrice * 10_000
   */
  slippageBps: real("slippage_bps"),

  /**
   * Estimated cost saving vs executing everything on the single best-price venue
   * (in quote currency units).  Positive = SOR was cheaper.
   */
  estimatedSavings: real("estimated_savings").default(0),

  /** JSON-stringified array of RoutedFill objects. */
  fills: text("fills").notNull().default("[]"),

  /** "EXECUTED" | "PARTIAL" | "REJECTED" */
  status: text("status").notNull(),

  /** Set when status = "REJECTED". */
  rejectionReason: text("rejection_reason"),

  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SorExecution    = typeof sorExecutionsTable.$inferSelect;
export type NewSorExecution = typeof sorExecutionsTable.$inferInsert;
