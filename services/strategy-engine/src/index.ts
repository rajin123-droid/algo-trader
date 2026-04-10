/**
 * @workspace/strategy-engine
 *
 * Pure TypeScript backtesting engine — no I/O, no DB, no Redis.
 * Import this from any server that wants to run backtests.
 *
 * Public API:
 *
 *   createStrategy(id, params)  → Strategy
 *   Backtester                  → orchestrator class
 *   calculateMetrics            → derive metrics from SimulatorResults
 *
 *   Indicators: calculateEMA, calculateSMA (batch)
 *               createEMAState/updateEMA, createSMAState/updateSMA (incremental)
 *
 * Example:
 *   import { createStrategy, Backtester } from '@workspace/strategy-engine';
 *
 *   const strategy = createStrategy('ema-crossover', { shortPeriod: 9, longPeriod: 21 });
 *   const bt = new Backtester({ strategy, candles, initialBalance: 10_000 });
 *   const result = bt.run();
 *   console.log(result.metrics);
 */

export type { Candle, Signal, Strategy, StrategyParams } from "./strategies/strategy.interface.js";

export { EMACrossover }  from "./strategies/ema-crossover.js";
export { SMACrossover }  from "./strategies/sma-crossover.js";

export { calculateEMA, createEMAState, updateEMA } from "./indicators/ema.js";
export type { EMAState }  from "./indicators/ema.js";

export { calculateSMA, createSMAState, updateSMA } from "./indicators/sma.js";
export type { SMAState }  from "./indicators/sma.js";

export { Simulator }     from "./simulator/simulator.js";
export type { SimulatedTrade, SimulatorResults } from "./simulator/simulator.js";

export { Backtester }    from "./backtester/backtester.js";
export type { BacktestConfig, BacktestResult } from "./backtester/backtester.js";

export { calculateMetrics } from "./metrics/metrics.js";
export type { BacktestMetrics } from "./metrics/metrics.js";

/* ── Strategy registry ────────────────────────────────────────────────────── */

import type { Strategy, StrategyParams } from "./strategies/strategy.interface.js";
import { EMACrossover }  from "./strategies/ema-crossover.js";
import { SMACrossover }  from "./strategies/sma-crossover.js";

/**
 * All registered strategies, keyed by their `id`.
 *
 * Add new strategies here — the registry is used by the backtest API route
 * to resolve the `strategy` field in the request body.
 */
export const STRATEGY_REGISTRY: Record<string, (params: StrategyParams) => Strategy> = {
  "ema-crossover": (p) => new EMACrossover(
    Number(p.shortPeriod ?? 12),
    Number(p.longPeriod  ?? 26)
  ),
  "sma-crossover": (p) => new SMACrossover(
    Number(p.shortPeriod ?? 10),
    Number(p.longPeriod  ?? 50)
  ),
};

/**
 * Instantiate a strategy by its registry id.
 * Throws if the id is unknown.
 */
export function createStrategy(id: string, params: StrategyParams = {}): Strategy {
  const factory = STRATEGY_REGISTRY[id];
  if (!factory) {
    throw new Error(
      `Unknown strategy "${id}". Available: ${Object.keys(STRATEGY_REGISTRY).join(", ")}`
    );
  }
  return factory(params);
}
