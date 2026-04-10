/**
 * Relative Strength Index (RSI) — J. Welles Wilder, 1978.
 *
 * Formula:
 *   RS  = AvgGain / AvgLoss   (Wilder's smoothed moving averages)
 *   RSI = 100 - (100 / (1 + RS))
 *
 * First RS value uses a simple mean over the first `period` price changes.
 * Subsequent values use Wilder's EMA (α = 1/period).
 *
 * Returns values in [0, 100].
 * Values at indices < period are NaN.
 *
 * Interpretation:
 *   RSI > 70 → overbought (potential sell)
 *   RSI < 30 → oversold  (potential buy)
 *
 * Python equivalent:
 *   def rsi(prices, period=14):
 *     deltas = [prices[i] - prices[i-1] for i in range(1, len(prices))]
 *     gains  = [max(d, 0) for d in deltas]
 *     losses = [max(-d, 0) for d in deltas]
 *     # seed with simple avg
 *     avg_gain = mean(gains[:period])
 *     avg_loss = mean(losses[:period])
 *     ...
 */
export function calculateRSI(prices: number[], period = 14): number[] {
  if (prices.length < 2) return new Array(prices.length).fill(NaN);

  const result: number[] = new Array(prices.length).fill(NaN);
  if (prices.length <= period) return result;

  // Build price changes
  const changes = prices.slice(1).map((p, i) => p - prices[i]!);
  const gains   = changes.map((c) => Math.max(c, 0));
  const losses  = changes.map((c) => Math.max(-c, 0));

  // Seed: simple average over first `period` changes
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  result[period] = 100 - 100 / (1 + rs0);

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    result[i + 1] = 100 - 100 / (1 + rs);
  }

  return result;
}

/* ── Incremental RSI ──────────────────────────────────────────────────────── */

export interface RSIState {
  period:   number;
  prevPrice: number;
  count:    number;
  seedGainSum: number;
  seedLossSum: number;
  avgGain:  number;
  avgLoss:  number;
}

export function createRSIState(period = 14): RSIState {
  return {
    period,
    prevPrice:   NaN,
    count:       0,
    seedGainSum: 0,
    seedLossSum: 0,
    avgGain:     0,
    avgLoss:     0,
  };
}

/**
 * Incremental RSI — O(1) per price update using Wilder's smoothing.
 *
 * Usage:
 *   const state = createRSIState(14);
 *   for (const candle of candles) {
 *     const rsi = updateRSI(state, candle.close);
 *     if (!isNaN(rsi)) { ... }
 *   }
 */
export function updateRSI(state: RSIState, price: number): number {
  if (isNaN(state.prevPrice)) {
    state.prevPrice = price;
    return NaN;
  }

  const change = price - state.prevPrice;
  const gain   = Math.max(change, 0);
  const loss   = Math.max(-change, 0);
  state.prevPrice = price;
  state.count++;

  // Seed phase: accumulate first `period` changes for simple avg
  if (state.count <= state.period) {
    state.seedGainSum += gain;
    state.seedLossSum += loss;

    if (state.count === state.period) {
      state.avgGain = state.seedGainSum / state.period;
      state.avgLoss = state.seedLossSum / state.period;
      const rs  = state.avgLoss === 0 ? Infinity : state.avgGain / state.avgLoss;
      return 100 - 100 / (1 + rs);
    }

    return NaN;
  }

  // Wilder's smoothing
  state.avgGain = (state.avgGain * (state.period - 1) + gain) / state.period;
  state.avgLoss = (state.avgLoss * (state.period - 1) + loss) / state.period;
  const rs = state.avgLoss === 0 ? Infinity : state.avgGain / state.avgLoss;
  return 100 - 100 / (1 + rs);
}
