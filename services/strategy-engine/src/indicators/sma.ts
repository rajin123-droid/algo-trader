/**
 * Simple Moving Average (SMA) — arithmetic mean over a rolling window.
 *
 * Uses an O(n) sliding-window implementation (not O(n·period)).
 *
 * Returns an array the same length as `prices`.  Values at indices
 * < period − 1 are NaN.
 *
 * Python equivalent:
 *   def sma(prices, period):
 *     result = [float('nan')] * (period - 1)
 *     window_sum = sum(prices[:period])
 *     result.append(window_sum / period)
 *     for i in range(period, len(prices)):
 *       window_sum += prices[i] - prices[i - period]
 *       result.append(window_sum / period)
 *     return result
 */
export function calculateSMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  if (period <= 0) throw new RangeError(`SMA period must be > 0, got ${period}`);

  const result: number[] = new Array(prices.length).fill(NaN);

  if (prices.length < period) return result;

  let windowSum = prices.slice(0, period).reduce((a, b) => a + b, 0);
  result[period - 1] = windowSum / period;

  for (let i = period; i < prices.length; i++) {
    windowSum += prices[i]! - prices[i - period]!;
    result[i] = windowSum / period;
  }

  return result;
}

/**
 * Incremental SMA — maintains a fixed-size ring buffer.
 * O(1) per update, O(period) memory.
 */
export interface SMAState {
  period: number;
  window: number[];
  windowIndex: number;
  windowSum: number;
  count: number;
}

export function createSMAState(period: number): SMAState {
  if (period <= 0) throw new RangeError(`SMA period must be > 0, got ${period}`);
  return {
    period,
    window: new Array(period).fill(0) as number[],
    windowIndex: 0,
    windowSum: 0,
    count: 0,
  };
}

export function updateSMA(state: SMAState, price: number): number {
  state.windowSum -= state.window[state.windowIndex]!;
  state.window[state.windowIndex] = price;
  state.windowSum += price;
  state.windowIndex = (state.windowIndex + 1) % state.period;
  state.count++;
  return state.count >= state.period ? state.windowSum / state.period : NaN;
}
