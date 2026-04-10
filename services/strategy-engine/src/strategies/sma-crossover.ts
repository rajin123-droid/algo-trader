import type { Strategy, Candle, Signal } from "./strategy.interface.js";
import { createSMAState, updateSMA, type SMAState } from "../indicators/sma.js";

/**
 * SMA Crossover Strategy.
 *
 * Classic "golden cross / death cross" strategy:
 *   • Short SMA crosses ABOVE long SMA → BUY  (golden cross)
 *   • Short SMA crosses BELOW long SMA → SELL (death cross)
 *
 * Edge-triggered: emits on the crossover bar only.
 *
 * Default periods: short = 10, long = 50.
 * Commonly used: (5, 20), (10, 50), (20, 100), (50, 200).
 *
 * SMA vs EMA:
 *   SMA reacts more slowly and produces fewer false signals in range-bound
 *   markets. EMA is more responsive and better for trending markets.
 */
export class SMACrossover implements Strategy {
  readonly id   = "sma-crossover";
  readonly name = "SMA Crossover";

  private shortState: SMAState;
  private longState:  SMAState;

  private prevRelation = 0;

  constructor(
    private readonly shortPeriod = 10,
    private readonly longPeriod  = 50,
  ) {
    this.shortState = createSMAState(shortPeriod);
    this.longState  = createSMAState(longPeriod);
  }

  onCandle(candle: Candle): Signal | null {
    const shortSMA = updateSMA(this.shortState, candle.close);
    const longSMA  = updateSMA(this.longState,  candle.close);

    if (isNaN(shortSMA) || isNaN(longSMA)) return null;

    const relation = shortSMA > longSMA ? 1 : -1;

    if (this.prevRelation === 0) {
      this.prevRelation = relation;
      return null;
    }

    let signal: Signal | null = null;

    if (this.prevRelation === -1 && relation === 1) {
      signal = { type: "BUY", size: 1 };
    } else if (this.prevRelation === 1 && relation === -1) {
      signal = { type: "SELL", size: 1 };
    }

    this.prevRelation = relation;
    return signal;
  }

  reset(): void {
    this.shortState  = createSMAState(this.shortPeriod);
    this.longState   = createSMAState(this.longPeriod);
    this.prevRelation = 0;
  }
}
