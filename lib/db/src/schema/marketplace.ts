import {
  pgTable,
  text,
  real,
  boolean,
  integer,
  serial,
  timestamp,
} from "drizzle-orm/pg-core";

/* ── strategy_listings ────────────────────────────────────────────────────── */

/**
 * A strategy published to the marketplace by a creator.
 * Followers can subscribe and have their trades auto-copied.
 */
export const strategyListingsTable = pgTable("strategy_listings", {
  id: text("id").primaryKey(),

  creatorId:      text("creator_id").notNull(),
  strategyId:     text("strategy_id").notNull(),
  strategyParams: text("strategy_params").notNull().default("{}"),

  name:        text("name").notNull(),
  description: text("description").notNull().default(""),

  symbol:   text("symbol").notNull().default("BTCUSDT"),
  interval: text("interval").notNull().default("1h"),

  /** Monthly subscription fee in USD (0 = free). */
  pricePerMonth: real("price_per_month").notNull().default(0),

  /** Performance fee: fraction of follower profit charged (e.g. 0.20 = 20%). */
  performanceFee: real("performance_fee").notNull().default(0.20),

  /** Rolling performance metrics (updated after each copy trade). */
  performancePnl:      real("performance_pnl").notNull().default(0),
  performanceWinRate:  real("performance_win_rate").notNull().default(0),
  performanceDrawdown: real("performance_drawdown").notNull().default(0),
  totalTrades:         integer("total_trades").notNull().default(0),

  subscriberCount: integer("subscriber_count").notNull().default(0),

  isPublic: boolean("is_public").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StrategyListing    = typeof strategyListingsTable.$inferSelect;
export type NewStrategyListing = typeof strategyListingsTable.$inferInsert;

/* ── strategy_subscriptions ───────────────────────────────────────────────── */

/**
 * A follower's subscription to a published strategy listing.
 * While ACTIVE, every leader trade is copied and scaled to the follower.
 */
export const strategySubscriptionsTable = pgTable("strategy_subscriptions", {
  id: serial("id").primaryKey(),

  userId:    text("user_id").notNull(),
  listingId: text("listing_id").notNull(),

  /** "ACTIVE" | "CANCELLED" | "SUSPENDED" */
  status: text("status").notNull().default("ACTIVE"),

  /**
   * Copy ratio applied to the scaled position size.
   * 1.0 = proportional to balance, 0.5 = half proportional.
   */
  copyRatio: real("copy_ratio").notNull().default(1.0),

  /** Balance used for proportional scaling at subscription time (USD). */
  followerBalanceSnapshot: real("follower_balance_snapshot").notNull().default(10000),

  /**
   * Cumulative P&L from copied trades for this subscription.
   * If it falls below -maxLossLimit the subscription is auto-suspended.
   */
  cumulativePnl: real("cumulative_pnl").notNull().default(0),

  /** Suspend copying if follower cumulative loss exceeds this (USD). 0 = no limit. */
  maxLossLimit: real("max_loss_limit").notNull().default(0),

  startedAt:   timestamp("started_at",   { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt:   timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
});

export type StrategySubscription    = typeof strategySubscriptionsTable.$inferSelect;
export type NewStrategySubscription = typeof strategySubscriptionsTable.$inferInsert;

/* ── copy_trades ──────────────────────────────────────────────────────────── */

/**
 * A trade that was copied from a leader to a follower.
 * Created whenever a leader trade is executed while a follower has an ACTIVE subscription.
 */
export const copyTradesTable = pgTable("copy_trades", {
  id: text("id").primaryKey(),

  subscriptionId: integer("subscription_id").notNull(),
  listingId:      text("listing_id").notNull(),

  leaderId:   text("leader_id").notNull(),
  followerId: text("follower_id").notNull(),

  /** "BUY" | "SELL" */
  signal: text("signal").notNull(),

  leaderSize:     real("leader_size").notNull(),
  followerSize:   real("follower_size").notNull(),
  executionPrice: real("execution_price"),

  /** P&L for the follower on this trade (SELL only). */
  pnl: real("pnl"),

  /** "EXECUTED" | "FAILED" | "SUSPENDED" */
  status: text("status").notNull().default("EXECUTED"),

  failureReason: text("failure_reason"),

  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CopyTrade    = typeof copyTradesTable.$inferSelect;
export type NewCopyTrade = typeof copyTradesTable.$inferInsert;

/* ── revenue_events ───────────────────────────────────────────────────────── */

/**
 * Revenue distribution record created whenever a follower realises profit
 * on a copied SELL trade. The platform takes a performance fee (default 20%)
 * split between creator (70%) and platform (30%).
 */
export const revenueEventsTable = pgTable("revenue_events", {
  id: text("id").primaryKey(),

  copyTradeId: text("copy_trade_id").notNull(),
  listingId:   text("listing_id").notNull(),
  creatorId:   text("creator_id").notNull(),
  followerId:  text("follower_id").notNull(),

  grossProfit:   real("gross_profit").notNull(),
  feeRate:       real("fee_rate").notNull(),
  feeAmount:     real("fee_amount").notNull(),
  creatorShare:  real("creator_share").notNull(),
  platformShare: real("platform_share").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RevenueEvent    = typeof revenueEventsTable.$inferSelect;
export type NewRevenueEvent = typeof revenueEventsTable.$inferInsert;
