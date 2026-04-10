/**
 * TradeLedger — double-entry bookkeeping bridge for futures paper/live trades.
 *
 * Futures model:
 *   OPEN:  user CREDITs margin (USDT leaves their account)
 *          system DEBITs  margin (system holds it as collateral)
 *
 *   CLOSE: system CREDITs payout = max(0, margin + pnl)
 *          user   DEBITs  payout (USDT returned ± PnL)
 *
 * Starting balance:
 *   New paper-trading users get 10,000 USDT provisioned once via a DEPOSIT
 *   transaction.  No-op if the account already has a positive balance.
 *
 * Every call is safe (non-throwing) — failures are logged but never surface
 * as HTTP 500s; the position write has already succeeded by the time we are
 * called.
 */

import { LedgerService } from "./ledger-service.js";
import { getOrCreateAccount } from "./risk-check.js";
import { logger } from "./logger.js";

export const PAPER_STARTING_BALANCE_USDT = 10_000;

/* ── Starting balance ─────────────────────────────────────────────────────── */

/**
 * Provision 10,000 USDT for a new paper-trading user.
 * Safe to call on every trade — it's a no-op if they already have funds.
 */
export async function ensureStartingBalance(userId: string): Promise<void> {
  try {
    const userUSDT = await getOrCreateAccount(userId, "USDT");
    const sysUSDT  = await getOrCreateAccount("system", "USDT");

    const balance = await LedgerService.getAccountBalance(userUSDT);
    if (balance > 0) return;

    const amount = PAPER_STARTING_BALANCE_USDT.toFixed(8);

    await LedgerService.postTransaction({
      type: "DEPOSIT",
      note: "Paper trading starting balance",
      entries: [
        { accountId: userUSDT, side: "DEBIT",  amount },
        { accountId: sysUSDT,  side: "CREDIT", amount },
      ],
    });

    logger.info({ userId, amount }, "Paper trading starting balance provisioned");
  } catch (err) {
    logger.error({ err, userId }, "ensureStartingBalance failed");
  }
}

/* ── Position open ────────────────────────────────────────────────────────── */

/**
 * Deduct margin from the user's USDT ledger account when a position is opened.
 *
 *   userUSDT CREDIT margin   — user posts collateral
 *   sysUSDT  DEBIT  margin   — system holds collateral
 *
 * Returns the ledger transactionId or null on failure.
 */
export async function recordPositionOpen(
  userId:     string,
  positionId: number,
  entryPrice: number,
  qty:        number,
  leverage:   number
): Promise<string | null> {
  try {
    const margin = (entryPrice * qty) / Math.max(leverage, 1);
    if (margin <= 0) return null;

    const userUSDT = await getOrCreateAccount(userId, "USDT");
    const sysUSDT  = await getOrCreateAccount("system", "USDT");

    const tx = await LedgerService.postTransaction({
      type:    "TRADE",
      orderId: String(positionId),
      entries: [
        { accountId: userUSDT, side: "CREDIT", amount: margin.toFixed(8) },
        { accountId: sysUSDT,  side: "DEBIT",  amount: margin.toFixed(8) },
      ],
    });

    logger.info(
      { userId, positionId, margin: margin.toFixed(2) },
      "Position open recorded in ledger"
    );
    return tx.transactionId;
  } catch (err) {
    logger.error({ err, userId, positionId }, "recordPositionOpen failed");
    return null;
  }
}

/* ── Position close ───────────────────────────────────────────────────────── */

/**
 * Return payout (margin ± PnL) to the user when a position is closed.
 *
 *   payout = max(0, margin + pnl)
 *
 *   userUSDT DEBIT  payout   — user receives collateral back ± profit/loss
 *   sysUSDT  CREDIT payout   — system releases collateral
 *
 * If payout ≤ 0 (full liquidation), no entries are posted — the margin was
 * already credited away when the position was opened.
 *
 * Returns the ledger transactionId or null on failure / full liquidation.
 */
export async function recordPositionClose(
  userId:     string,
  positionId: number,
  margin:     number,
  pnl:        number
): Promise<string | null> {
  try {
    const payout = Math.max(0, margin + pnl);
    if (payout <= 1e-8) {
      logger.warn({ userId, positionId, margin, pnl }, "Full liquidation — no ledger payout");
      return null;
    }

    const userUSDT = await getOrCreateAccount(userId, "USDT");
    const sysUSDT  = await getOrCreateAccount("system", "USDT");

    const tx = await LedgerService.postTransaction({
      type:    "TRADE",
      orderId: String(positionId),
      entries: [
        { accountId: userUSDT, side: "DEBIT",  amount: payout.toFixed(8) },
        { accountId: sysUSDT,  side: "CREDIT", amount: payout.toFixed(8) },
      ],
    });

    logger.info(
      { userId, positionId, payout: payout.toFixed(2), pnl: pnl.toFixed(2) },
      "Position close recorded in ledger"
    );
    return tx.transactionId;
  } catch (err) {
    logger.error({ err, userId, positionId }, "recordPositionClose failed");
    return null;
  }
}
