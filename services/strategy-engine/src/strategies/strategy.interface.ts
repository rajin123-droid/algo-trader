/**
 * Core types for the strategy engine.
 *
 * A Strategy is a pure stateful object that receives candles one at a time
 * and emits trading signals.  No I/O, no side effects.
 *
 * Lifecycle:
 *   for candle in candles:
 *     signal = strategy.onCandle(candle)
 *     if signal: simulator.execute(signal, candle)
 */

export interface Candle {
  /** Unix timestamp in seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * A directional signal emitted by a strategy.
 *
 * `size` is the number of units to buy or sell.
 * The simulator decides how many units fit within the current balance.
 */
export type Signal =
  | { type: "BUY";  size: number }
  | { type: "SELL"; size: number };

/**
 * Strategy interface — implement this to define a new trading algorithm.
 *
 * Each call to `onCandle` receives the next bar in chronological order.
 * The strategy maintains its own state (EMA arrays, position flags, etc.).
 * Return `null` when no trade should be triggered.
 *
 * Python equivalent:
 *   class Strategy(ABC):
 *     @abstractmethod
 *     def on_candle(self, candle: Candle) -> Optional[Signal]: ...
 */
export interface Strategy {
  /** Unique identifier used by the API (`"ema-crossover"`, `"sma-crossover"`, …). */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Process one bar and return a signal, or null to do nothing. */
  onCandle(candle: Candle): Signal | null;
  /** Reset all internal state (allows strategy reuse across backtest runs). */
  reset(): void;
}

/** Parameters accepted by all strategies via the REST API. */
export interface StrategyParams {
  shortPeriod?: number;
  longPeriod?: number;
  initialBalance?: number;
  [key: string]: unknown;
}
