import type { Strategy } from "../../strategy-engine/src/strategies/strategy.interface.js";
import type { AutoSession, LiveSignal, Candle } from "./types.js";

/**
 * LiveStrategyRunner
 *
 * Wraps a Strategy instance and converts raw Signals into LiveSignals by
 * attaching execution context (symbol, price, session metadata).
 *
 * The runner has no side effects — it only reads the candle and asks the
 * strategy whether to act.  All filtering, risk checking, and DB writes
 * happen in downstream layers.
 *
 * Only processes candles matching the session's configured symbol + interval.
 *
 * Python equivalent:
 *   class LiveStrategyRunner:
 *     def on_candle(self, candle):
 *       if not self._matches(candle): return None
 *       signal = self.strategy.on_candle(candle)
 *       if signal: return {**signal, 'timestamp': now(), 'price': candle.close}
 *       return None
 */
export class LiveStrategyRunner {
  constructor(
    private readonly strategy: Strategy,
    private readonly session: AutoSession,
  ) {}

  /**
   * Process one candle.
   *
   * @returns LiveSignal if the strategy fired, null otherwise.
   */
  onCandle(candle: Candle & { symbol: string; interval: string }): LiveSignal | null {
    // Only act on the symbol + interval this session is configured for
    if (!this.matches(candle)) return null;

    const signal = this.strategy.onCandle(candle);
    if (!signal) return null;

    return {
      ...signal,
      timestamp: Date.now(),
      symbol:    this.session.symbol,
      interval:  this.session.interval,
      price:     candle.close,
      sessionId: this.session.id,
      userId:    this.session.userId,
    };
  }

  private matches(candle: { symbol: string; interval: string }): boolean {
    const symbol = candle.symbol.toUpperCase().replace(/[/-]/g, "");
    return symbol === this.session.symbol && candle.interval === this.session.interval;
  }
}
