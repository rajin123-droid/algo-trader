/**
 * Risk management helpers.
 *
 * Python equivalents:
 *   calculate_position_size(balance, risk_percent, entry_price, stop_loss_price)
 *   calculate_sl_tp(entry_price, side)
 */

export interface SlTp {
  sl: number;
  tp: number;
}

/**
 * Dynamic position sizing — risk a fixed % of account balance per trade.
 *
 * Python:
 *   risk_amount   = balance * risk_percent
 *   risk_per_unit = abs(entry_price - stop_loss_price)
 *   qty           = risk_amount / risk_per_unit
 */
export function calculatePositionSize(
  balance: number,
  riskPercent: number,
  entryPrice: number,
  stopLossPrice: number
): number {
  const riskAmount = balance * riskPercent;
  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);

  if (riskPerUnit === 0) return 0;

  const qty = riskAmount / riskPerUnit;
  return Math.round(qty * 1000) / 1000; // 3 d.p., same as Python round(qty, 3)
}

/**
 * Calculate stop-loss and take-profit prices.
 *   BUY  → SL = entry × 0.98 (−2%), TP = entry × 1.04 (+4%)
 *   SELL → SL = entry × 1.02 (+2%), TP = entry × 0.96 (−4%)
 */
export function calculateSlTp(entryPrice: number, side: "BUY" | "SELL"): SlTp {
  if (side === "BUY") {
    return {
      sl: Math.round(entryPrice * 0.98 * 100) / 100,
      tp: Math.round(entryPrice * 1.04 * 100) / 100,
    };
  }
  return {
    sl: Math.round(entryPrice * 1.02 * 100) / 100,
    tp: Math.round(entryPrice * 0.96 * 100) / 100,
  };
}

/**
 * Trailing stop — locks in 50% of open profit as the new stop-loss.
 * If position is in loss, falls back to the initial fixed SL (2% from entry).
 *
 * Python: calculate_trailing_stop(entry_price, current_price, side)
 *
 * BUY example:  entry=44000, current=46000 → profit=2000
 *   new_sl = 44000 + (2000 × 0.5) = 45000  (locks in $1000 of the $2000 gain)
 *
 * SELL example: entry=44000, current=42000 → profit=2000
 *   new_sl = 44000 − (2000 × 0.5) = 43000
 */
export function calculateTrailingStop(
  entryPrice: number,
  currentPrice: number,
  side: "BUY" | "SELL"
): number {
  if (side === "BUY") {
    const profit = currentPrice - entryPrice;
    if (profit <= 0) return Math.round(entryPrice * 0.98 * 100) / 100;
    return Math.round((entryPrice + profit * 0.5) * 100) / 100;
  } else {
    const profit = entryPrice - currentPrice;
    if (profit <= 0) return Math.round(entryPrice * 1.02 * 100) / 100;
    return Math.round((entryPrice - profit * 0.5) * 100) / 100;
  }
}

/** Paper-account balance used when the user has no live API keys. */
export const PAPER_BALANCE = 10_000;

/** Risk 2% of account per trade (matches Python: risk_percent = 0.02). */
export const DEFAULT_RISK_PERCENT = 0.02;
