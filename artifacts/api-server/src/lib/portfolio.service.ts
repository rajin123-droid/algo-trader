import { db, accountsTable, entriesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * PortfolioService — compute live asset balances for a user.
 *
 * Reads from the double-entry ledger:
 *   accounts → one row per (user, asset) pair
 *   entries  → all debits and credits against an account
 *
 * Balance formula:
 *   Σ (DEBIT entries) − Σ (CREDIT entries)
 *
 * A positive balance means the user holds that asset.
 *
 * Python equivalent:
 *   def get_portfolio(user_id):
 *     for acct in db.query("SELECT * FROM accounts WHERE user_id=?", user_id):
 *       bal = db.scalar("SELECT COALESCE(SUM(CASE WHEN side='DEBIT' THEN amount
 *                         ELSE -amount END), 0) FROM entries WHERE account_id=?",
 *                       acct.id)
 *       yield { asset: acct.asset, balance: bal }
 */

export interface PortfolioEntry {
  asset: string;
  balance: number;
}

/**
 * Return the current portfolio snapshot for a user.
 *
 * If the user has no accounts yet (no trades executed) an empty array is
 * returned — this is not an error.
 *
 * @param userId  The user's numeric id converted to string.
 */
export async function getUserPortfolio(userId: string): Promise<PortfolioEntry[]> {
  try {
    const accounts = await db
      .select({ id: accountsTable.id, asset: accountsTable.asset })
      .from(accountsTable)
      .where(
        and(
          eq(accountsTable.userId, userId),
          eq(accountsTable.type, "USER")
        )
      );

    if (accounts.length === 0) return [];

    const balances = await Promise.all(
      accounts.map(async (acct) => {
        const [row] = await db
          .select({
            balance: sql<string>`COALESCE(
              SUM(CASE
                WHEN ${entriesTable.side} = 'DEBIT'
                THEN ${entriesTable.amount}::numeric
                ELSE -(${entriesTable.amount}::numeric)
              END), 0)`,
          })
          .from(entriesTable)
          .where(eq(entriesTable.accountId, acct.id));

        return {
          asset: acct.asset,
          balance: Number(row?.balance ?? 0),
        };
      })
    );

    return balances.filter((b) => b.balance !== 0);
  } catch (err) {
    logger.warn({ err, userId }, "Failed to fetch user portfolio");
    return [];
  }
}
