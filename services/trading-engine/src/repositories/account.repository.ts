import { eq, and, sql } from "drizzle-orm";
import { db, accountsTable, entriesTable } from "@workspace/db";
import type { Account } from "../models/account.model.js";
import type { NewAccount } from "@workspace/db";

/**
 * AccountRepository — DB access for the accounts and entries tables.
 *
 * Accounts are created lazily:
 *   - User accounts → created on first trade for that asset
 *   - System accounts → one per asset, shared across all users
 *
 * Balance is computed via SQL aggregation (no in-memory summation):
 *   SELECT SUM(CASE WHEN side='DEBIT' THEN amount ELSE -amount END)
 *   FROM entries WHERE account_id = ?
 *
 * Python equivalent:
 *   def get_balance(account_id):
 *     return db.query(
 *       "SELECT COALESCE(SUM(CASE WHEN side='DEBIT' THEN amount ELSE -amount END), 0)"
 *       " FROM entries WHERE account_id = %s", [account_id]
 *     ).scalar()
 */
export class AccountRepository {
  /* ── Account lookups ──────────────────────────────────────────────────── */

  async findById(id: string): Promise<Account | null> {
    const [row] = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, id))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findByUserAndAsset(userId: string, asset: string): Promise<Account | null> {
    const [row] = await db
      .select()
      .from(accountsTable)
      .where(
        and(
          eq(accountsTable.userId, userId),
          eq(accountsTable.asset, asset.toUpperCase()),
          eq(accountsTable.type, "USER")
        )
      )
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findSystemAccount(asset: string): Promise<Account | null> {
    const [row] = await db
      .select()
      .from(accountsTable)
      .where(
        and(
          eq(accountsTable.asset, asset.toUpperCase()),
          eq(accountsTable.type, "SYSTEM")
        )
      )
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findAllByUser(userId: string): Promise<Account[]> {
    const rows = await db
      .select()
      .from(accountsTable)
      .where(and(eq(accountsTable.userId, userId), eq(accountsTable.type, "USER")));
    return rows.map(this.mapRow);
  }

  /* ── Account creation ─────────────────────────────────────────────────── */

  async create(account: NewAccount): Promise<Account> {
    const [row] = await db.insert(accountsTable).values(account).returning();
    return this.mapRow(row!);
  }

  /**
   * Get-or-create a USER account for this user + asset combination.
   * Safe to call concurrently — uses INSERT … ON CONFLICT DO NOTHING.
   */
  async getOrCreateUserAccount(userId: string, asset: string): Promise<Account> {
    const existing = await this.findByUserAndAsset(userId, asset);
    if (existing) return existing;

    const id = crypto.randomUUID();
    await db
      .insert(accountsTable)
      .values({ id, userId, asset: asset.toUpperCase(), type: "USER" })
      .onConflictDoNothing();

    return (await this.findByUserAndAsset(userId, asset))!;
  }

  /**
   * Get-or-create the SYSTEM account for this asset.
   * There is exactly one system account per asset across all users.
   */
  async getOrCreateSystemAccount(asset: string): Promise<Account> {
    const existing = await this.findSystemAccount(asset);
    if (existing) return existing;

    const id = crypto.randomUUID();
    await db
      .insert(accountsTable)
      .values({ id, userId: "SYSTEM", asset: asset.toUpperCase(), type: "SYSTEM" })
      .onConflictDoNothing();

    return (await this.findSystemAccount(asset))!;
  }

  /* ── Balance computation ──────────────────────────────────────────────── */

  /**
   * Compute the balance of an account by aggregating all its entry rows.
   *
   * SQL:
   *   SELECT COALESCE(
   *     SUM(CASE WHEN side = 'DEBIT' THEN amount::numeric ELSE -(amount::numeric) END),
   *     0
   *   ) AS balance
   *   FROM entries WHERE account_id = $1
   *
   * Returns a number (positive = net credit to owner).
   */
  async getBalance(accountId: string): Promise<number> {
    const result = await db
      .select({
        balance: sql<string>`COALESCE(
          SUM(CASE WHEN ${entriesTable.side} = 'DEBIT'
              THEN ${entriesTable.amount}::numeric
              ELSE -(${entriesTable.amount}::numeric)
          END), 0
        )`,
      })
      .from(entriesTable)
      .where(eq(entriesTable.accountId, accountId));

    return Number(result[0]?.balance ?? 0);
  }

  /**
   * All balances for a user — one row per asset they have ever traded.
   */
  async getAllBalances(userId: string): Promise<{ asset: string; accountId: string; balance: number }[]> {
    const accounts = await this.findAllByUser(userId);

    return Promise.all(
      accounts.map(async (acct) => ({
        asset: acct.asset,
        accountId: acct.id,
        balance: await this.getBalance(acct.id),
      }))
    );
  }

  /* ── Serialisation ────────────────────────────────────────────────────── */

  private mapRow(row: typeof accountsTable.$inferSelect): Account {
    return {
      id: row.id,
      userId: row.userId!,
      asset: row.asset,
      type: row.type as Account["type"],
      createdAt: row.createdAt!,
    };
  }
}
