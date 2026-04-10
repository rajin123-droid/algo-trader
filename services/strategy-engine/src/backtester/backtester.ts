import type { Strategy, Candle } from "../strategies/strategy.interface.js";
import { Simulator } from "../simulator/simulator.js";
import { calculateMetrics, type BacktestMetrics } from "../metrics/metrics.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface BacktestConfig {
  strategy:        Strategy;
  candles:         Candle[];
  initialBalance?: number;
}

export interface BacktestResult {
  strategyId:    string;
  strategyName:  string;
  candleCount:   number;
  signalCount:   number;
  metrics:       BacktestMetrics;
  trades: {
    entryTime:  number;
    exitTime:   number;
    entryPrice: number;
    exitPrice:  number;
    size:       number;
    pnl:        number;
    returnPct:  number;
  }[];
  equityCurve:   { time: number; balance: number }[];
  openPosition: {
    entryTime:  number;
    entryPrice: number;
    size:       number;
  } | null;
}

/* ── Backtester ───────────────────────────────────────────────────────────── */

/**
 * Backtester — wires a Strategy to a Simulator and runs it over historical data.
 *
 * The backtester is intentionally thin:
 *   1. Reset strategy state (allows reuse across multiple runs).
 *   2. For each candle, ask the strategy for a signal.
 *   3. If a signal is returned, execute it in the simulator.
 *   4. After all candles, compute performance metrics.
 *
 * Execution model:
 *   • Signals are executed at the CLOSE price of the candle that triggered them.
 *   • This is slightly optimistic (real fills happen at the next open) but
 *     standard for a first-pass backtester.  A stricter "next-open" model can
 *     be added by buffering signals one bar.
 *
 * Python equivalent:
 *   class Backtester:
 *     def run(self, candles):
 *       self.strategy.reset()
 *       signals = 0
 *       for candle in candles:
 *         signal = self.strategy.on_candle(candle)
 *         if signal:
 *           signals += 1
 *           self.simulator.execute(signal, candle)
 *       return self.simulator.get_results()
 */
export class Backtester {
  private readonly simulator: Simulator;

  constructor(private readonly config: BacktestConfig) {
    this.simulator = new Simulator(config.initialBalance ?? 10_000);
  }

  /**
   * Run the full backtest over the configured candle series.
   *
   * @returns  A complete BacktestResult including metrics, trades, and equity curve.
   */
  run(): BacktestResult {
    const { strategy, candles } = this.config;

    strategy.reset();
    this.simulator.reset(this.config.initialBalance);

    let signalCount = 0;

    for (const candle of candles) {
      const signal = strategy.onCandle(candle);

      if (signal) {
        signalCount++;
        this.simulator.execute(signal, candle);
      }
    }

    const simResults = this.simulator.getResults();
    const metrics    = calculateMetrics(simResults);

    return {
      strategyId:   strategy.id,
      strategyName: strategy.name,
      candleCount:  candles.length,
      signalCount,
      metrics,
      trades:       simResults.trades,
      equityCurve:  simResults.equityCurve,
      openPosition: simResults.openPosition,
    };
  }
}
