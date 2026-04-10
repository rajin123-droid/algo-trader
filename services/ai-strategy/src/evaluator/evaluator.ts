import type { BacktestResult } from "../../../strategy-engine/src/backtester/backtester.js";

/**
 * Evaluator — assigns a single scalar score to a BacktestResult.
 *
 * The score is used by the Optimizer to compare parameter variants and pick
 * the best configuration.
 *
 * Scoring formula (weighted composite):
 *
 *   score = w1 × sharpe
 *         + w2 × pnlPctNorm          (normalised to [0, 1])
 *         + w3 × winRateBonus
 *         - w4 × drawdownPenalty
 *         + w5 × tradeCountBonus     (penalise 0 trades heavily)
 *
 * The weights are calibrated to prefer:
 *   1. Risk-adjusted return (Sharpe ratio)
 *   2. Absolute return
 *   3. Win rate over 50%
 *   4. Small maximum drawdown
 *   5. At least a few trades (avoids degenerate "always hold" strategies)
 *
 * Returns -Infinity when the strategy produced no trades (useless result).
 *
 * Python equivalent:
 *   def score(result):
 *     if result.metrics.total_trades == 0: return float('-inf')
 *     return (0.4 * sharpe + 0.3 * pnl_norm + 0.2 * win_bonus - 0.2 * dd_penalty)
 */

export interface EvaluationResult {
  score:         number;
  breakdown: {
    sharpe:        number;
    pnlPct:        number;
    winRate:       number;
    maxDrawdown:   number;
    totalTrades:   number;
    tradeBonus:    number;
  };
}

const WEIGHTS = {
  sharpe:    0.35,
  pnlPct:    0.30,
  winRate:   0.20,
  drawdown:  0.20,
  trades:    0.10,
} as const;

/**
 * Score a single BacktestResult.
 * Higher is better.  Returns -Infinity for zero-trade results.
 */
export function evaluateResult(result: BacktestResult): EvaluationResult {
  const { metrics } = result;

  if (metrics.totalTrades === 0) {
    return {
      score: -Infinity,
      breakdown: {
        sharpe: 0, pnlPct: 0, winRate: 0,
        maxDrawdown: 0, totalTrades: 0, tradeBonus: -10,
      },
    };
  }

  // Sharpe contribution (already dimensionless, cap at ±5 for stability)
  const sharpeRaw    = isNaN(metrics.sharpeRatio) ? 0 : metrics.sharpeRatio;
  const sharpeCapped = Math.max(-5, Math.min(5, sharpeRaw));
  const sharpeScore  = sharpeCapped / 5; // normalise to [-1, 1]

  // PnL contribution (normalise: +100% → 1.0, -100% → -1.0)
  const pnlScore = Math.max(-1, Math.min(1, metrics.pnlPct / 100));

  // Win rate contribution: bonus above 50%, penalty below
  const winRateScore = (metrics.winRate - 0.5) * 2; // [-1, 1]

  // Drawdown penalty: maxDrawdown is negative (e.g. -15.5 → -0.155)
  const drawdownPenalty = Math.abs(metrics.maxDrawdown) / 100; // [0, 1]

  // Trade count bonus: reward at least 3 trades, cap at 50
  const tradeBonus = Math.min(1, Math.log(Math.max(metrics.totalTrades, 1)) / Math.log(50));

  const score =
    WEIGHTS.sharpe  * sharpeScore  +
    WEIGHTS.pnlPct  * pnlScore     +
    WEIGHTS.winRate * winRateScore  -
    WEIGHTS.drawdown * drawdownPenalty +
    WEIGHTS.trades  * tradeBonus;

  return {
    score,
    breakdown: {
      sharpe:      sharpeRaw,
      pnlPct:      metrics.pnlPct,
      winRate:     metrics.winRate,
      maxDrawdown: metrics.maxDrawdown,
      totalTrades: metrics.totalTrades,
      tradeBonus,
    },
  };
}
