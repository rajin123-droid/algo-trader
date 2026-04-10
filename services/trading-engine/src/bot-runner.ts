/**
 * Per-user algorithmic bot runner with full risk management.
 *
 * Python equivalents:
 *   get_daily_stats          → getDailyStats()
 *   update_daily_after_trade → updateDailyAfterTrade()
 *   can_trade                → canTrade()
 *   run_user_bot             → runUserBot()
 *   run_all_bots             → runAllBots()
 *   bot_loop / threading.Thread → startBotLoop() / setInterval
 */

import { eq, and, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  apiKeysTable,
  userPositionsTable,
  dailyStatsTable,
} from "@workspace/db";
import {
  placeBracketOrders,
  placeConditionalOrder,
  getAccountBalance,
  fillPrice,
  type BinanceFuturesClientOptions,
} from "./binance-futures.js";
import { safeDecrypt } from "../../auth-service/src/encryption.js";
import { getClosePrices, getCurrentPrice, getSignal, type Signal } from "./signal.js";
import {
  calculatePositionSize,
  calculateSlTp,
  calculateTrailingStop,
  PAPER_BALANCE,
  DEFAULT_RISK_PERCENT,
} from "./risk.js";
import { logger } from "@workspace/logger";

const SYMBOL = "BTCUSDT";

/** Maximum daily loss as a fraction of account balance before trading is halted. */
const MAX_DAILY_LOSS_PERCENT = 0.05;

/** Maximum number of bot-executed trades per calendar day per user. */
const MAX_TRADES_PER_DAY = 10;

/* ── UTC date string helper ─────────────────────────────────────────────── */
// Python: datetime.utcnow().strftime("%Y-%m-%d")

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/* ── daily_stats helpers ────────────────────────────────────────────────── */

/**
 * Return today's stats row, creating it if it doesn't exist yet.
 * Python: get_daily_stats(user_id, db)
 */
async function getDailyStats(userId: number) {
  const date = todayUtc();

  const [existing] = await db
    .select()
    .from(dailyStatsTable)
    .where(and(eq(dailyStatsTable.userId, userId), eq(dailyStatsTable.date, date)))
    .limit(1);

  if (existing) return existing;

  // Row doesn't exist yet — insert; ignore conflict in case of race condition.
  await db
    .insert(dailyStatsTable)
    .values({ userId, date, totalPnl: 0, tradesCount: 0 })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(dailyStatsTable)
    .where(and(eq(dailyStatsTable.userId, userId), eq(dailyStatsTable.date, date)))
    .limit(1);

  return row!;
}

/**
 * Increment today's trade count and add the trade PnL.
 * Python: update_daily_after_trade(user_id, pnl, db)
 *
 * Called after every successful trade (live or paper).
 * PnL for open positions is 0 — it will be settled when the position closes.
 */
async function updateDailyAfterTrade(userId: number, pnl: number): Promise<void> {
  const date = todayUtc();

  await db
    .update(dailyStatsTable)
    .set({
      totalPnl: sql`${dailyStatsTable.totalPnl} + ${pnl}`,
      tradesCount: sql`${dailyStatsTable.tradesCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(dailyStatsTable.userId, userId), eq(dailyStatsTable.date, date)));
}

/* ── circuit breaker ────────────────────────────────────────────────────── */

/**
 * Check both loss limit and trade count before allowing a new order.
 * Python: can_trade(user, client, db)
 *
 * Returns allowed=false with a human-readable reason when blocked.
 */
async function canTrade(
  userId: number,
  balance: number
): Promise<{ allowed: boolean; reason: string; stats: Awaited<ReturnType<typeof getDailyStats>> }> {
  const stats = await getDailyStats(userId);
  const maxLoss = balance * MAX_DAILY_LOSS_PERCENT;

  if (stats.totalPnl < -maxLoss) {
    return {
      allowed: false,
      reason: `Daily loss limit reached: $${stats.totalPnl.toFixed(2)} (limit −$${maxLoss.toFixed(2)})`,
      stats,
    };
  }

  if (stats.tradesCount >= MAX_TRADES_PER_DAY) {
    return {
      allowed: false,
      reason: `Max trades reached: ${stats.tradesCount}/${MAX_TRADES_PER_DAY}`,
      stats,
    };
  }

  return { allowed: true, reason: "OK", stats };
}

/* ── per-user key loader ────────────────────────────────────────────────── */

async function getUserKeys(
  userId: number
): Promise<BinanceFuturesClientOptions | null> {
  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(
      and(
        eq(apiKeysTable.userId, userId),
        eq(apiKeysTable.exchange, "binance")
      )
    )
    .limit(1);

  return row
    ? {
        apiKey: safeDecrypt(row.apiKey),
        apiSecret: safeDecrypt(row.apiSecret),
        testnet: row.testnet,
      }
    : null;
}

/* ── single-user bot run ────────────────────────────────────────────────── */

export interface BotRunResult {
  userId: number;
  email: string;
  signal: Signal;
  mode: "live" | "paper" | "skip" | "blocked";
  qty?: number;
  entryPrice?: number;
  sl?: number;
  tp?: number;
  balance?: number;
  todayPnl?: number;
  tradesCount?: number;
  error?: string;
}

export async function runUserBot(userId: number): Promise<BotRunResult> {
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) throw new Error(`User ${userId} not found`);

  // 1 — price data & signal
  const prices = await getClosePrices(SYMBOL);
  const signal = getSignal(prices);
  const lastPrice = prices[prices.length - 1]!;

  if (signal === "HOLD") {
    return { userId, email: user.email, signal, mode: "skip" };
  }

  const keys = await getUserKeys(userId);
  let mode: "live" | "paper" = keys ? "live" : "paper";
  let entryPrice = lastPrice;

  try {
    // 2 — fetch balance (live) or use paper balance
    let balance = PAPER_BALANCE;
    if (keys) {
      try {
        balance = await getAccountBalance(keys);
      } catch {
        balance = PAPER_BALANCE;
      }
    }

    // 3 — daily loss + trade count circuit breaker (Python: can_trade)
    const { allowed, reason, stats } = await canTrade(userId, balance);
    if (!allowed) {
      logger.warn({ userId, email: user.email, stats, reason }, "Bot blocked by daily limit");
      return {
        userId,
        email: user.email,
        signal,
        mode: "blocked",
        balance,
        todayPnl: stats.totalPnl,
        tradesCount: stats.tradesCount,
        error: reason,
      };
    }

    // 4 — risk calculations: SL/TP + dynamic position size
    const { sl, tp } = calculateSlTp(lastPrice, signal);
    const qty = calculatePositionSize(balance, DEFAULT_RISK_PERCENT, lastPrice, sl);

    if (qty <= 0) {
      return { userId, email: user.email, signal, mode, error: "Invalid position size" };
    }

    // 5 — execute order (live bracket or paper simulation)
    if (keys) {
      const { marketOrder } = await placeBracketOrders(keys, {
        symbol: SYMBOL,
        side: signal,
        quantity: qty,
        sl,
        tp,
      });
      entryPrice = fillPrice(marketOrder, lastPrice);
    } else {
      entryPrice = lastPrice;
      mode = "paper";
    }

    // 6 — persist open position
    await db.insert(userPositionsTable).values({
      userId,
      symbol: SYMBOL,
      entryPrice,
      quantity: qty,
      side: signal,
      leverage: 1,
    });

    // 7 — update daily stats (Python: update_daily_after_trade)
    // PnL for a freshly opened position is 0; will settle on close.
    await updateDailyAfterTrade(userId, 0);

    logger.info(
      { userId, email: user.email, signal, entryPrice, qty, sl, tp, balance, mode },
      "Bot trade executed"
    );

    return {
      userId,
      email: user.email,
      signal,
      mode,
      qty,
      entryPrice,
      sl,
      tp,
      balance,
      todayPnl: stats.totalPnl,
      tradesCount: stats.tradesCount + 1,
    };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ userId, email: user.email, error }, "Bot trade failed");
    return { userId, email: user.email, signal, mode, error };
  }
}

/* ── trailing stop updater ──────────────────────────────────────────────── */

/**
 * Update the trailing stop-loss for every open position of a user.
 * Python: update_trailing_stops(user, db)
 *
 * For each position:
 *   1. Fetch current price
 *   2. Calculate new trailing SL (locks 50% of profit)
 *   3. Place a new STOP_MARKET order on the exchange (live users)
 *   4. Persist the new trailing_sl value on the position row
 *
 * Note: cancelling the prior SL order would require storing orderId on the
 * position row — left as a future improvement (same as the Python TODO comment).
 */
export async function updateTrailingStops(userId: number): Promise<void> {
  const positions = await db
    .select()
    .from(userPositionsTable)
    .where(eq(userPositionsTable.userId, userId));

  if (positions.length === 0) return;

  const keys = await getUserKeys(userId);

  await Promise.allSettled(
    positions.map(async (pos) => {
      try {
        const currentPrice = await getCurrentPrice(pos.symbol);
        const newSl = calculateTrailingStop(
          pos.entryPrice,
          currentPrice,
          pos.side as "BUY" | "SELL"
        );

        // Only update SL if it moved in the right direction (never widen it)
        const existingSl = pos.trailingSl ?? 0;
        const slImproved =
          pos.side === "BUY"
            ? newSl > existingSl          // BUY: SL should only move up
            : existingSl === 0 || newSl < existingSl; // SELL: SL should only move down

        if (!slImproved) return;

        // Place updated STOP_MARKET order on the exchange (live only)
        if (keys) {
          const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
          await placeConditionalOrder(keys, {
            symbol: pos.symbol,
            side: closeSide as "BUY" | "SELL",
            type: "STOP_MARKET",
            stopPrice: newSl,
          });
        }

        // Persist the new trailing SL (Python: pos.trailing_sl = new_sl; db.commit())
        await db
          .update(userPositionsTable)
          .set({ trailingSl: newSl })
          .where(eq(userPositionsTable.id, pos.id));

        logger.info(
          { posId: pos.id, symbol: pos.symbol, side: pos.side, currentPrice, newSl },
          "Trailing stop updated"
        );
      } catch (err) {
        // Python: print("Trailing stop error:", e) — log and continue
        logger.warn({ posId: pos.id, err }, "Trailing stop error");
      }
    })
  );
}

/* ── all-users sweep (Python: run_all_bots) ─────────────────────────────── */

export async function runAllBots(): Promise<BotRunResult[]> {
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isActive, true));

  // Python: update_trailing_stops FIRST, then run_user_bot
  const results = await Promise.allSettled(
    users.map(async (u) => {
      await updateTrailingStops(u.id);
      return runUserBot(u.id);
    })
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          userId: 0,
          email: "unknown",
          signal: "HOLD" as Signal,
          mode: "skip" as const,
          error: String(r.reason),
        }
  );
}

/* ── background loop (Python: threading.Thread + time.sleep(60)) ────────── */

let loopTimer: ReturnType<typeof setInterval> | null = null;

export function startBotLoop(intervalMs = 60_000): void {
  if (loopTimer) return;

  loopTimer = setInterval(async () => {
    logger.info("Bot loop tick — running all user bots");
    try {
      const results = await runAllBots();
      const traded = results.filter((r) => r.mode !== "skip" && r.mode !== "blocked");
      const blocked = results.filter((r) => r.mode === "blocked");
      logger.info(
        { total: results.length, traded: traded.length, blocked: blocked.length },
        "Bot loop complete"
      );
    } catch (err) {
      logger.error({ err }, "Bot loop error");
    }
  }, intervalMs);

  logger.info({ intervalMs }, "Bot loop started");
}

export function stopBotLoop(): void {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
    logger.info("Bot loop stopped");
  }
}
