import { db, transactionsTable, entriesTable } from "@workspace/db";
import { logger } from "@workspace/logger";
import type { EntryInput, Entry } from "../models/entry.model.js";
import type { Transaction, TransactionType } from "../models/transaction.model.js";
import type { AccountRepository } from "../repositories/account.repository.js";
import { publishPortfolioUpdate } from "../../../ws-gateway/src/publishers/ws-publisher.js";

/** Tolerance for floating-point balance check (8 decimal places). */
const EPSILON = 1e-8;

/**
 * LedgerService — double-entry bookkeeping for all monetary movements.
 *
 * Every financial event (trade fill, deposit, withdrawal, fee) creates
 * one Transaction row + N Entry rows that must satisfy:
 *
 *   Σ DEBIT amounts = Σ CREDIT amounts   (ledger invariant)
 *
 * If the invariant is violated, the entire operation is rejected before
 * any DB write occurs — no partial entries are ever saved.
 *
 * All inserts are wrapped in a single Drizzle `db.transaction()` so they
 * are atomic at the PostgreSQL level. If any insert fails (e.g. FK
 * violation, network error), the entire transaction rolls back.
 *
 * Trade fill entry pattern (BTC/USDT BUY, qty=0.01, price=70,000):
 *
 *   Account              Asset   Amount    Side
 *   ───────────────────  ──────  ────────  ──────
 *   user USDT account    USDT    700.00    CREDIT   (user pays)
 *   system USDT account  USDT    700.00    DEBIT    (exchange receives)
 *   user BTC account     BTC     0.01      DEBIT    (user receives)
 *   system BTC account   BTC     0.01      CREDIT   (exchange sends)
 *
 *   Σ USDT DEBIT (700) = Σ USDT CREDIT (700) ✓
 *   Σ BTC  DEBIT (0.01) = Σ BTC  CREDIT (0.01) ✓
 *
 * Python equivalent:
 *   class LedgerService:
 *     def record_trade(self, entries):
 *       assert sum(e.amount for e in entries if e.side == 'DEBIT')
 *           == sum(e.amount for e in entries if e.side == 'CREDIT')
 *       with db.transaction():
 *         txn = db.insert(transactions, {...})
 *         for e in entries:
 *           db.insert(entries, {transactionId: txn.id, ...e})
 */
export class LedgerService {
  constructor(private readonly accountRepo: AccountRepository) {}

  /* ── Public API ───────────────────────────────────────────────────────── */

  /**
   * Record a balanced set of entries as a single atomic transaction.
   *
   * @param entries  2+ entries that must balance (Σ DEBIT = Σ CREDIT)
   * @param type     Transaction type (default: 'TRADE')
   * @param orderId  The order that caused this transaction (optional)
   * @returns        The created Transaction record
   *
   * Throws LedgerImbalanceError if entries do not balance.
   */
  async createTransaction(
    entries: EntryInput[],
    type: TransactionType = "TRADE",
    orderId?: string
  ): Promise<Transaction> {
    this.validateBalance(entries);

    const txId = crypto.randomUUID();
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const [txRow] = await tx
        .insert(transactionsTable)
        .values({ id: txId, type, orderId: orderId ?? null, createdAt: now })
        .returning();

      const entryRows = await Promise.all(
        entries.map((e) =>
          tx
            .insert(entriesTable)
            .values({
              id: crypto.randomUUID(),
              transactionId: txId,
              accountId: e.accountId,
              amount: String(e.amount),
              side: e.side,
              createdAt: now,
            })
            .returning()
            .then(([row]) => row!)
        )
      );

      return { txRow: txRow!, entryRows };
    });

    logger.info(
      {
        txId,
        type,
        orderId,
        entries: entries.length,
        debit: entries.filter((e) => e.side === "DEBIT").reduce((s, e) => s + e.amount, 0),
      },
      "Ledger transaction recorded"
    );

    return this.mapTransaction(result.txRow);
  }

  /**
   * Record a completed trade fill — four-way balanced entry.
   *
   * BUY  (user spends quoteAsset, receives baseAsset):
   *   user QUOTE   CREDIT  (pays  USDT)   sys QUOTE  DEBIT   (receives USDT)
   *   user BASE    DEBIT   (gets  BTC)    sys BASE   CREDIT  (sends BTC)
   *
   * SELL (user spends baseAsset, receives quoteAsset):
   *   user BASE    CREDIT  (pays  BTC)    sys BASE   DEBIT   (receives BTC)
   *   user QUOTE   DEBIT   (gets  USDT)   sys QUOTE  CREDIT  (sends USDT)
   *
   * In both cases: Σ DEBIT = Σ CREDIT ✓
   */
  async recordTradeFill(params: {
    userId: string;
    side: "BUY" | "SELL";
    baseAsset: string;
    quoteAsset: string;
    quantity: number;
    price: number;
    orderId: string;
  }): Promise<Transaction> {
    const { userId, side, baseAsset, quoteAsset, quantity, price, orderId } = params;
    const cost = quantity * price;

    const [userBase, userQuote, sysBase, sysQuote] = await Promise.all([
      this.accountRepo.getOrCreateUserAccount(userId, baseAsset),
      this.accountRepo.getOrCreateUserAccount(userId, quoteAsset),
      this.accountRepo.getOrCreateSystemAccount(baseAsset),
      this.accountRepo.getOrCreateSystemAccount(quoteAsset),
    ]);

    const entries: EntryInput[] =
      side === "BUY"
        ? [
            { accountId: userQuote.id, amount: cost,     side: "CREDIT" },
            { accountId: sysQuote.id,  amount: cost,     side: "DEBIT"  },
            { accountId: userBase.id,  amount: quantity, side: "DEBIT"  },
            { accountId: sysBase.id,   amount: quantity, side: "CREDIT" },
          ]
        : [
            { accountId: userBase.id,  amount: quantity, side: "CREDIT" },
            { accountId: sysBase.id,   amount: quantity, side: "DEBIT"  },
            { accountId: userQuote.id, amount: cost,     side: "DEBIT"  },
            { accountId: sysQuote.id,  amount: cost,     side: "CREDIT" },
          ];

    const tx = await this.createTransaction(entries, "TRADE", orderId);
    publishPortfolioUpdate(userId).catch(() => {});
    return tx;
  }

  /**
   * Record a deposit (external → user account).
   * Creates a SYSTEM source entry so the ledger stays balanced.
   */
  async recordDeposit(params: {
    userId: string;
    asset: string;
    amount: number;
  }): Promise<Transaction> {
    const { userId, asset, amount } = params;

    const [userAcct, sysAcct] = await Promise.all([
      this.accountRepo.getOrCreateUserAccount(userId, asset),
      this.accountRepo.getOrCreateSystemAccount(asset),
    ]);

    const tx = await this.createTransaction(
      [
        { accountId: sysAcct.id,  amount, side: "CREDIT" },
        { accountId: userAcct.id, amount, side: "DEBIT"  },
      ],
      "DEPOSIT"
    );
    publishPortfolioUpdate(userId).catch(() => {});
    return tx;
  }

  /**
   * Record a withdrawal (user account → external).
   */
  async recordWithdrawal(params: {
    userId: string;
    asset: string;
    amount: number;
  }): Promise<Transaction> {
    const { userId, asset, amount } = params;

    const [userAcct, sysAcct] = await Promise.all([
      this.accountRepo.getOrCreateUserAccount(userId, asset),
      this.accountRepo.getOrCreateSystemAccount(asset),
    ]);

    const tx = await this.createTransaction(
      [
        { accountId: userAcct.id, amount, side: "CREDIT" },
        { accountId: sysAcct.id,  amount, side: "DEBIT"  },
      ],
      "WITHDRAWAL"
    );
    publishPortfolioUpdate(userId).catch(() => {});
    return tx;
  }

  /* ── Balance invariant ────────────────────────────────────────────────── */

  /**
   * Validate that Σ DEBIT = Σ CREDIT within EPSILON tolerance.
   * Called before any DB write — fails fast with a descriptive error.
   */
  private validateBalance(entries: EntryInput[]): void {
    if (entries.length < 2) {
      throw new LedgerError("A transaction requires at least 2 entries");
    }

    let debitSum = 0;
    let creditSum = 0;

    for (const e of entries) {
      if (e.amount <= 0) {
        throw new LedgerError(`Entry amount must be positive, got ${e.amount}`);
      }
      if (e.side === "DEBIT") debitSum += e.amount;
      else creditSum += e.amount;
    }

    if (Math.abs(debitSum - creditSum) > EPSILON) {
      throw new LedgerError(
        `Ledger imbalance: DEBIT ${debitSum.toFixed(8)} ≠ CREDIT ${creditSum.toFixed(8)} (diff: ${Math.abs(debitSum - creditSum).toFixed(8)})`
      );
    }
  }

  /* ── Serialisation ────────────────────────────────────────────────────── */

  private mapTransaction(row: typeof transactionsTable.$inferSelect): Transaction {
    return {
      id: row.id,
      type: row.type as Transaction["type"],
      orderId: row.orderId ?? null,
      createdAt: row.createdAt!,
    };
  }
}

/** Thrown when a transaction's entries do not balance. */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}
