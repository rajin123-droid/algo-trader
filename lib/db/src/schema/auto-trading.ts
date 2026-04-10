import {
  pgTable,
  text,
  real,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

/* ── auto_trading_sessions ────────────────────────────────────────────────── */

/**
 * Stores each user's auto-trading session configuration.
 *
 * One user can have multiple sessions (different strategies, symbols, or
 * intervals) but only one should be `enabled = true` at a time.
 *
 * `strategyParams` is stored as a JSON string so the table doesn't need to
 * change when new strategy parameters are introduced.
 */
export const autoTradingSessionsTable = pgTable("auto_trading_sessions", {
  id: text("id").primaryKey(),

  userId:     text("user_id").notNull(),
  strategyId: text("strategy_id").notNull(),

  /** JSON-stringified strategy params: { shortPeriod, longPeriod, … } */
  strategyParams: text("strategy_params").notNull().default("{}"),

  symbol:   text("symbol").notNull().default("BTCUSDT"),
  interval: text("interval").notNull().default("1m"),

  /** "paper" (simulated) or "live" (real exchange). */
  mode: text("mode").notNull().default("paper"),

  /** Fraction of balance to risk per trade (0.02 = 2%). */
  riskPercent: real("risk_percent").notNull().default(0.02),

  /** Maximum position size in base asset units (hard cap). */
  maxPositionSize: real("max_position_size").notNull().default(1),

  /** Max trades allowed in a rolling 60-second window. */
  maxTradesPerMinute: integer("max_trades_per_minute").notNull().default(3),

  /**
   * Auto-disable the session when net daily loss exceeds this threshold (USD).
   * 0 = no circuit-breaker.
   */
  maxDailyLoss: real("max_daily_loss").notNull().default(100),

  /**
   * Stop-loss distance from entry price as a fraction (e.g. 0.01 = 1%).
   * Used by RiskController to compute absolute SL price level on BUY signals.
   */
  stopLossPercent: real("stop_loss_percent").notNull().default(0.01),

  /**
   * Take-profit distance from entry price as a fraction (e.g. 0.02 = 2%).
   * Used by RiskController to compute absolute TP price level on BUY signals.
   */
  takeProfitPercent: real("take_profit_percent").notNull().default(0.02),

  enabled:        boolean("enabled").notNull().default(true),
  disabledReason: text("disabled_reason"),
  disabledAt:     timestamp("disabled_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AutoTradingSession    = typeof autoTradingSessionsTable.$inferSelect;
export type NewAutoTradingSession = typeof autoTradingSessionsTable.$inferInsert;

/* ── auto_trades ──────────────────────────────────────────────────────────── */

/**
 * Audit log of every signal that reached the execution layer.
 *
 * Records both successful executions (status = "EXECUTED") and signals
 * blocked by risk checks (status = "BLOCKED") or execution errors ("FAILED").
 *
 * BUY records: entryPrice, stopLoss, takeProfit are set; exitPrice/pnl are null.
 * SELL records: exitPrice + pnl are set when closing a position.
 *               closeReason: "SIGNAL" | "STOP_LOSS" | "TAKE_PROFIT"
 */
export const autoTradesTable = pgTable("auto_trades", {
  id: text("id").primaryKey(),

  sessionId: text("session_id")
    .notNull()
    .references(() => autoTradingSessionsTable.id, { onDelete: "cascade" }),

  userId: text("user_id").notNull(),

  /** "BUY" or "SELL" */
  signal: text("signal").notNull(),

  /** Units of base asset transacted. */
  size: real("size").notNull(),

  /** Entry price (populated on BUY executions). */
  entryPrice: real("entry_price"),

  /** Exit price (populated on SELL executions). */
  exitPrice: real("exit_price"),

  /** P&L in quote currency (populated when a position is closed). */
  pnl: real("pnl"),

  /**
   * Absolute stop-loss price level set at entry (BUY records only).
   * e.g. if entry=$84,000 and stopLossPercent=1%, stopLoss=$83,160.
   */
  stopLoss: real("stop_loss"),

  /**
   * Absolute take-profit price level set at entry (BUY records only).
   * e.g. if entry=$84,000 and takeProfitPercent=2%, takeProfit=$85,680.
   */
  takeProfit: real("take_profit"),

  /**
   * Reason a SELL position was closed.
   * "SIGNAL"      → strategy crossover triggered the exit normally
   * "STOP_LOSS"   → PositionWatcher auto-closed at stop-loss level
   * "TAKE_PROFIT" → PositionWatcher auto-closed at take-profit level
   */
  closeReason: text("close_reason"),

  /** "EXECUTED" | "BLOCKED" | "FAILED" */
  status: text("status").notNull(),

  /** Set when status = "BLOCKED" or "FAILED". */
  blockedReason: text("blocked_reason"),

  /**
   * Execution mode at the time this trade was placed.
   * "paper" = simulated internal matching engine
   * "live"  = real order sent to external exchange (Binance)
   */
  executionMode: text("execution_mode").notNull().default("paper"),

  /**
   * Exchange-assigned order ID (Binance orderId as string).
   * Null for paper trades or blocked/failed signals.
   */
  exchangeOrderId: text("exchange_order_id"),

  /**
   * Last known status from the exchange ("NEW", "FILLED", "REJECTED", …).
   * Null for paper trades.
   */
  exchangeStatus: text("exchange_status"),

  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AutoTrade    = typeof autoTradesTable.$inferSelect;
export type NewAutoTrade = typeof autoTradesTable.$inferInsert;
