/**
 * RiskManager
 *
 * Pure utility functions for position sizing, trade validation, and
 * Stop-Loss / Take-Profit price level calculation.
 *
 * All functions are stateless and side-effect free — they take numbers in,
 * return numbers out.  This makes them trivially unit-testable and reusable
 * across paper and live execution modes.
 *
 * Architecture note:
 *   RiskController calls these helpers and folds the results into RiskResult.
 *   AutoTradingEngine stores SL/TP on its openPosition state.
 *   PositionWatcher reads SL/TP from state and triggers auto-close.
 */

/* ── Config ────────────────────────────────────────────────────────────────── */

export interface RiskConfig {
  /** Fraction of balance to risk per trade.  e.g. 0.02 = 2%. */
  riskPerTrade:      number;
  /** Hard cap on concurrent open positions for this session. */
  maxPositions:      number;
  /** Stop-loss distance from entry as a fraction.  e.g. 0.01 = 1%. */
  stopLossPercent:   number;
  /** Take-profit distance from entry as a fraction.  e.g. 0.02 = 2%. */
  takeProfitPercent: number;
}

/* ── Position sizing ────────────────────────────────────────────────────────── */

/**
 * Fixed-fractional position sizing (risk-based).
 *
 * risk_amount = balance × riskPerTrade
 * qty         = risk_amount / price
 *
 * Example:
 *   balance=$10,000  riskPerTrade=0.02  price=$84,000
 *   → risk_amount=$200  qty≈0.002381 BTC
 *
 * @returns Base-asset quantity rounded to 6 decimal places.
 */
export function calculatePositionSize(
  balance: number,
  price:   number,
  config:  Pick<RiskConfig, "riskPerTrade">,
): number {
  if (price <= 0 || balance <= 0) return 0;
  const riskAmount = balance * config.riskPerTrade;
  return Number((riskAmount / price).toFixed(6));
}

/* ── Trade gate ─────────────────────────────────────────────────────────────── */

/**
 * Allow a new position only when below the open-position cap.
 *
 * @param openPositionCount  Number of positions already open.
 * @param config             Risk configuration.
 * @returns true = proceed, false = reject.
 */
export function validateTrade(
  openPositionCount: number,
  config:            Pick<RiskConfig, "maxPositions">,
): boolean {
  return openPositionCount < config.maxPositions;
}

/* ── SL / TP levels ─────────────────────────────────────────────────────────── */

/**
 * Convert percentage configs into absolute price levels.
 *
 * Long (BUY):
 *   stopLoss   = entry × (1 − stopLossPercent)
 *   takeProfit = entry × (1 + takeProfitPercent)
 *
 * Short (SELL):
 *   stopLoss   = entry × (1 + stopLossPercent)
 *   takeProfit = entry × (1 − takeProfitPercent)
 *
 * @returns { stopLoss, takeProfit } in quote currency (e.g. USD).
 */
export function getSLTP(
  price:  number,
  side:   "BUY" | "SELL",
  config: Pick<RiskConfig, "stopLossPercent" | "takeProfitPercent">,
): { stopLoss: number; takeProfit: number } {
  if (side === "BUY") {
    return {
      stopLoss:   price * (1 - config.stopLossPercent),
      takeProfit: price * (1 + config.takeProfitPercent),
    };
  }
  return {
    stopLoss:   price * (1 + config.stopLossPercent),
    takeProfit: price * (1 - config.takeProfitPercent),
  };
}
