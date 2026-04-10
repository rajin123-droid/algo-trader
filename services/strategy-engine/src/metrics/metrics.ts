import type { SimulatedTrade, SimulatorResults } from "../simulator/simulator.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface BacktestMetrics {
  finalBalance:   number;
  initialBalance: number;
  pnl:            number;
  /** Total return as a percentage of initial balance. */
  pnlPct:         number;
  totalTrades:    number;
  wins:           number;
  losses:         number;
  /** Wins / totalTrades (0 if no trades). */
  winRate:        number;
  /** Average P&L per trade. */
  avgTradeReturn: number;
  /** Worst peak-to-trough equity decline as a negative percentage. */
  maxDrawdown:    number;
  /**
   * Simplified Sharpe Ratio (annualised, assumes 252 trading days).
   *   SR = (avg trade return / std trade return) × √(trades per year)
   *
   * Returns NaN when fewer than 2 trades exist.
   */
  sharpeRatio:    number;
  /** Largest single winning trade P&L. */
  bestTrade:      number;
  /** Largest single losing trade P&L (negative). */
  worstTrade:     number;
  /** Average bars (candles) held per trade (requires trades with timestamps). */
  avgHoldingPeriodSec: number;
}

/* ── Main calculator ──────────────────────────────────────────────────────── */

/**
 * Derive all performance metrics from the raw simulator results.
 *
 * All calculations are pure functions of the trade list and equity curve —
 * no DB, no I/O.
 *
 * Python equivalent:
 *   def calculate_metrics(results):
 *     trades = results['trades']
 *     wins = [t for t in trades if t['pnl'] > 0]
 *     losses = [t for t in trades if t['pnl'] <= 0]
 *     win_rate = len(wins) / len(trades) if trades else 0
 *     ...
 */
export function calculateMetrics(results: SimulatorResults): BacktestMetrics {
  const { trades, equityCurve, finalBalance, initialBalance, pnl, pnlPct } = results;

  const totalTrades = trades.length;
  const wins        = trades.filter((t) => t.pnl > 0).length;
  const losses      = totalTrades - wins;
  const winRate     = totalTrades > 0 ? wins / totalTrades : 0;

  const avgTradeReturn = totalTrades > 0
    ? trades.reduce((s, t) => s + t.pnl, 0) / totalTrades
    : 0;

  const bestTrade  = totalTrades > 0 ? Math.max(...trades.map((t) => t.pnl)) : 0;
  const worstTrade = totalTrades > 0 ? Math.min(...trades.map((t) => t.pnl)) : 0;

  const maxDrawdown = calculateMaxDrawdown(equityCurve, initialBalance);

  const sharpeRatio = calculateSharpe(trades);

  const avgHoldingPeriodSec = totalTrades > 0
    ? trades.reduce((s, t) => s + (t.exitTime - t.entryTime), 0) / totalTrades
    : 0;

  return {
    finalBalance,
    initialBalance,
    pnl,
    pnlPct,
    totalTrades,
    wins,
    losses,
    winRate,
    avgTradeReturn,
    maxDrawdown,
    sharpeRatio,
    bestTrade,
    worstTrade,
    avgHoldingPeriodSec,
  };
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Maximum drawdown as a percentage of the running peak equity.
 *
 * Iterates over the equity curve and tracks the worst peak → trough drop.
 * Returns a negative percentage (e.g. -12.5 = drawdown of 12.5%).
 */
function calculateMaxDrawdown(
  equityCurve: { time: number; balance: number }[],
  initialBalance: number
): number {
  let peak = initialBalance;
  let maxDD = 0;

  for (const { balance } of equityCurve) {
    if (balance > peak) peak = balance;
    const dd = ((balance - peak) / peak) * 100;
    if (dd < maxDD) maxDD = dd;
  }

  return maxDD;
}

/**
 * Simplified Sharpe Ratio from per-trade returns.
 *
 *   SR = mean(returns) / std(returns)
 *
 * NaN when fewer than 2 trades (no meaningful std dev).
 */
function calculateSharpe(trades: SimulatedTrade[]): number {
  if (trades.length < 2) return NaN;

  const returns = trades.map((t) => t.returnPct);
  const mean    = returns.reduce((a, b) => a + b, 0) / returns.length;

  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);

  const std = Math.sqrt(variance);
  return std === 0 ? NaN : mean / std;
}
