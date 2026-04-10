export type AccountType = "USER" | "SYSTEM";

/**
 * Account — a ledger account that holds one asset for one owner.
 *
 * USER accounts    → one per user per asset (BTC, USDT, ETH …)
 * SYSTEM accounts  → one per asset, owned by the exchange
 *                    they are the counter-party on every trade
 *
 * Balance is NOT stored here. It is derived on-demand by aggregating
 * all Entry rows for this account:
 *   balance = Σ DEBIT amounts − Σ CREDIT amounts
 */
export interface Account {
  id: string;
  userId: string;
  asset: string;
  type: AccountType;
  createdAt: Date;
}
