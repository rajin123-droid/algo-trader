import type { Strategy, Candle, Signal } from "./strategy.interface.js";
import { createEMAState, updateEMA, type EMAState } from "../indicators/ema.js";

/**
 * EMA Crossover Strategy.
 *
 * Generates signals based on the crossover of two Exponential Moving Averages:
 *   • When short EMA crosses ABOVE long EMA → BUY  (bullish momentum)
 *   • When short EMA crosses BELOW long EMA → SELL (bearish momentum)
 *
 * Uses CROSSOVER detection (edge-triggered), not level comparison.
 * This means signals fire only on the bar where the lines cross — not on
 * every bar where short > long (which would spam signals).
 *
 * Default periods: short = 12, long = 26 (same as MACD fast/slow).
 *
 * Warm-up:
 *   No signal is emitted until `longPeriod` candles have been seen.
 *   After warm-up, the strategy emits at most one signal per bar.
 *
 * Example:
 *   const strategy = new EMACrossover(12, 26);
 *   for (const candle of candles) {
 *     const signal = strategy.onCandle(candle);
 *     if (signal) console.log(signal);
 *   }
 */
export class EMACrossover implements Strategy {
  readonly id   = "ema-crossover";
  readonly name = "EMA Crossover";

  private shortState: EMAState;
  private longState:  EMAState;

  /** Last known relationship: 1 = short above long, -1 = short below, 0 = unknown */
  private prevRelation = 0;

  constructor(
    private readonly shortPeriod = 12,
    private readonly longPeriod  = 26,
  ) {
    this.shortState = createEMAState(shortPeriod);
    this.longState  = createEMAState(longPeriod);
  }

  onCandle(candle: Candle): Signal | null {
    const shortEMA = updateEMA(this.shortState, candle.close);
    const longEMA  = updateEMA(this.longState,  candle.close);

    // Still in warm-up — not enough data yet
    if (isNaN(shortEMA) || isNaN(longEMA)) return null;

    const relation = shortEMA > longEMA ? 1 : -1;

    // No crossover yet (first bar after warm-up)
    if (this.prevRelation === 0) {
      this.prevRelation = relation;
      return null;
    }

    let signal: Signal | null = null;

    if (this.prevRelation === -1 && relation === 1) {
      // Crossed upward — bullish signal
      signal = { type: "BUY", size: 1 };
    } else if (this.prevRelation === 1 && relation === -1) {
      // Crossed downward — bearish signal
      signal = { type: "SELL", size: 1 };
    }

    this.prevRelation = relation;
    return signal;
  }

  reset(): void {
    this.shortState  = createEMAState(this.shortPeriod);
    this.longState   = createEMAState(this.longPeriod);
    this.prevRelation = 0;
  }
}
