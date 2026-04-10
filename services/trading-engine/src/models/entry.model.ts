export type EntrySide = "DEBIT" | "CREDIT";

/**
 * Entry — one line in a double-entry accounting transaction.
 *
 * Convention (asset account):
 *   DEBIT  → balance INCREASES  (receiving/buying)
 *   CREDIT → balance DECREASES  (sending/selling)
 *
 * amount is always positive. Direction is determined by `side`.
 *
 * Example: BTC/USDT buy of 0.01 BTC at $70,000 creates 4 entries:
 *
 *   accountId          asset  amount    side
 *   ─────────────────  ─────  ────────  ──────
 *   user-usdt-acct     USDT   700.00    CREDIT   (user loses $700)
 *   system-usdt-acct   USDT   700.00    DEBIT    (exchange gains $700)
 *   user-btc-acct      BTC    0.01      DEBIT    (user gains 0.01 BTC)
 *   system-btc-acct    BTC    0.01      CREDIT   (exchange loses 0.01 BTC)
 *
 *   Σ DEBIT  = 700 + 0.01  (different assets — checked per asset in LedgerService)
 *   Σ CREDIT = 700 + 0.01  ✓
 */
export interface Entry {
  id: string;
  transactionId: string;
  accountId: string;
  amount: number;
  side: EntrySide;
  createdAt: Date;
}

/** Input shape — no id/transactionId yet (those are assigned by LedgerService). */
export interface EntryInput {
  accountId: string;
  amount: number;
  side: EntrySide;
}
