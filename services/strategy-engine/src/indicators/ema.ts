/**
 * Exponential Moving Average (EMA).
 *
 * Formula:
 *   EMA_today = price_today × k + EMA_yesterday × (1 − k)
 *   where k = 2 / (period + 1)
 *
 * The first EMA value is seeded with the simple average of the first
 * `period` prices (standard seed method, same as TradingView).
 *
 * Returns an array the same length as `prices`. Values at indices
 * < period − 1 are NaN (not enough data to compute a reliable EMA).
 *
 * Python equivalent:
 *   def ema(prices, period):
 *     k = 2 / (period + 1)
 *     result = [float('nan')] * (period - 1)
 *     seed = sum(prices[:period]) / period
 *     result.append(seed)
 *     for p in prices[period:]:
 *       result.append(p * k + result[-1] * (1 - k))
 *     return result
 */
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  if (period <= 0) throw new RangeError(`EMA period must be > 0, got ${period}`);

  const k = 2 / (period + 1);
  const result: number[] = new Array(prices.length).fill(NaN);

  if (prices.length < period) return result;

  // Seed: SMA of first `period` values
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;

  for (let i = period; i < prices.length; i++) {
    ema = prices[i]! * k + ema * (1 - k);
    result[i] = ema;
  }

  return result;
}

/**
 * Incremental EMA — updates a running EMA without storing the full price array.
 *
 * Used inside strategies that process one candle at a time.
 * Returns the new EMA value, or NaN if fewer than `period` prices have been seen.
 *
 * Usage:
 *   let state = createEMAState(12);
 *   for (const candle of candles) {
 *     const ema = updateEMA(state, candle.close);
 *     if (!isNaN(ema)) { … }
 *   }
 */
export interface EMAState {
  period: number;
  count: number;
  sum: number;
  value: number;
  k: number;
}

export function createEMAState(period: number): EMAState {
  if (period <= 0) throw new RangeError(`EMA period must be > 0, got ${period}`);
  return { period, count: 0, sum: 0, value: NaN, k: 2 / (period + 1) };
}

export function updateEMA(state: EMAState, price: number): number {
  state.count++;

  if (state.count < state.period) {
    state.sum += price;
    return NaN;
  }

  if (state.count === state.period) {
    state.sum += price;
    state.value = state.sum / state.period;
    return state.value;
  }

  state.value = price * state.k + state.value * (1 - state.k);
  return state.value;
}
