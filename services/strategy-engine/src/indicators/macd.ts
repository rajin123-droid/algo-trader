/**
 * MACD — Moving Average Convergence/Divergence (Gerald Appel, 1979).
 *
 * Components:
 *   MACD Line   = EMA(fast) - EMA(slow)
 *   Signal Line = EMA(signalPeriod) of MACD Line
 *   Histogram   = MACD Line - Signal Line
 *
 * Defaults: fast=12, slow=26, signal=9  (standard settings).
 *
 * Trading signals:
 *   Bullish: histogram crosses from negative to positive (momentum shift up)
 *   Bearish: histogram crosses from positive to negative (momentum shift down)
 *
 * Python equivalent:
 *   def macd(prices, fast=12, slow=26, signal=9):
 *     ema_fast   = ema(prices, fast)
 *     ema_slow   = ema(prices, slow)
 *     macd_line  = ema_fast - ema_slow
 *     signal_line = ema(macd_line[not-nan], signal)
 *     histogram  = macd_line - signal_line
 *     return macd_line, signal_line, histogram
 */

import { createEMAState, updateEMA, type EMAState } from "./ema.js";

export interface MACDValues {
  /** MACD line (fast EMA - slow EMA). */
  macd:      number;
  /** Signal line (EMA of MACD line). NaN until warm-up complete. */
  signal:    number;
  /** Histogram (MACD - Signal). NaN until warm-up complete. */
  histogram: number;
}

/* ── Incremental MACD ─────────────────────────────────────────────────────── */

export interface MACDState {
  fastState:   EMAState;
  slowState:   EMAState;
  signalState: EMAState;
}

export function createMACDState(
  fast   = 12,
  slow   = 26,
  signal = 9,
): MACDState {
  return {
    fastState:   createEMAState(fast),
    slowState:   createEMAState(slow),
    signalState: createEMAState(signal),
  };
}

/**
 * Incremental MACD — returns the three MACD components for the latest price.
 *
 * NaN rules:
 *   macd      — NaN until `slow` prices have been seen
 *   signal    — NaN until `slow + signal - 1` prices have been seen
 *   histogram — NaN when either macd or signal is NaN
 *
 * Usage:
 *   const state = createMACDState(12, 26, 9);
 *   for (const candle of candles) {
 *     const { macd, signal, histogram } = updateMACD(state, candle.close);
 *   }
 */
export function updateMACD(state: MACDState, price: number): MACDValues {
  const fast = updateEMA(state.fastState, price);
  const slow = updateEMA(state.slowState, price);

  if (isNaN(fast) || isNaN(slow)) {
    return { macd: NaN, signal: NaN, histogram: NaN };
  }

  const macdLine = fast - slow;
  const signalLine = updateEMA(state.signalState, macdLine);

  if (isNaN(signalLine)) {
    return { macd: macdLine, signal: NaN, histogram: NaN };
  }

  return {
    macd:      macdLine,
    signal:    signalLine,
    histogram: macdLine - signalLine,
  };
}
