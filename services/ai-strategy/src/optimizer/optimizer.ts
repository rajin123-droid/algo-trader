import type { StrategyConfig, IndicatorConfig } from "../models/strategy-config.js";
import { sanitiseConfig } from "../models/strategy-config.js";
import { compileStrategy } from "../compiler/strategy-compiler.js";
import { Backtester }     from "../../../strategy-engine/src/backtester/backtester.js";
import { evaluateResult, type EvaluationResult } from "../evaluator/evaluator.js";
import type { Candle }    from "../../../strategy-engine/src/strategies/strategy.interface.js";
import type { BacktestResult } from "../../../strategy-engine/src/backtester/backtester.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface OptimizationRun {
  iteration:   number;
  config:      StrategyConfig;
  result:      BacktestResult;
  evaluation:  EvaluationResult;
}

export interface OptimizationResult {
  bestConfig:      StrategyConfig;
  bestResult:      BacktestResult;
  bestEvaluation:  EvaluationResult;
  iterations:      number;
  allRuns:         OptimizationRun[];
}

/* ── Parameter mutation helpers ───────────────────────────────────────────── */

/**
 * Mutate one random indicator parameter by ±[10%, 30%].
 * Also optionally adjusts risk parameters.
 *
 * Uses a "random walk" mutation strategy — not genetic algorithms.
 * Sufficient for simple strategy parameter spaces (usually < 5 params).
 */
function mutateConfig(config: StrategyConfig): StrategyConfig {
  const clone: StrategyConfig = JSON.parse(JSON.stringify(config)) as StrategyConfig;

  // Pick a random target: indicator params or risk
  const target = Math.random() < 0.7 ? "indicator" : "risk";

  if (target === "indicator" && clone.indicators.length > 0) {
    const idx = Math.floor(Math.random() * clone.indicators.length);
    const ind: IndicatorConfig = clone.indicators[idx]!;

    const mutationFactor = 1 + (Math.random() - 0.5) * 0.4; // ±20%

    if (ind.type === "EMA" || ind.type === "SMA" || ind.type === "RSI") {
      const p = ind.params.period ?? 14;
      ind.params.period = Math.max(2, Math.round(p * mutationFactor));
    } else if (ind.type === "MACD") {
      const subParam = Math.random() < 0.5 ? "fast" : "slow";
      const p = ind.params[subParam] ?? (subParam === "fast" ? 12 : 26);
      ind.params[subParam] = Math.max(2, Math.round(p * mutationFactor));
      // Ensure fast < slow
      if ((ind.params.fast ?? 12) >= (ind.params.slow ?? 26)) {
        ind.params.slow = (ind.params.fast ?? 12) + 2;
      }
    }
  } else {
    // Mutate one risk parameter
    const riskParam = ["stopLoss", "takeProfit", "riskPerTrade"][
      Math.floor(Math.random() * 3)
    ] as keyof typeof clone.risk;

    const mutationFactor = 1 + (Math.random() - 0.5) * 0.4;
    (clone.risk as Record<string, number>)[riskParam] *= mutationFactor;
  }

  return sanitiseConfig(clone);
}

/* ── Optimizer ────────────────────────────────────────────────────────────── */

/**
 * Optimizer — runs `iterations` backtest variants by mutating the base config.
 *
 * Algorithm (random walk hill-climbing):
 *   1. Backtest the initial config → set as current best.
 *   2. For each iteration:
 *      a. Mutate the current best config.
 *      b. Backtest the mutated config.
 *      c. If score improves, adopt the mutated config as new best.
 *   3. Return the best config + result across all iterations.
 *
 * This is intentionally simple — suitable for the small parameter spaces
 * produced by the strategy generator (2–4 parameters).  For larger spaces,
 * replace with Bayesian optimisation or genetic algorithms.
 *
 * Python equivalent:
 *   def optimize(config, candles, n=20):
 *     best = (config, backtest(config, candles))
 *     for i in range(n):
 *       candidate = mutate(best[0])
 *       result = backtest(candidate, candles)
 *       if score(result) > score(best[1]):
 *         best = (candidate, result)
 *     return best
 */
export class Optimizer {
  constructor(
    private readonly candles:         Candle[],
    private readonly initialBalance?: number,
  ) {}

  optimize(
    baseConfig:  StrategyConfig,
    iterations = 20,
  ): OptimizationResult {
    const allRuns: OptimizationRun[] = [];

    // Evaluate the base config first
    const baseResult     = this.backtest(baseConfig);
    const baseEvaluation = evaluateResult(baseResult);

    let bestConfig     = baseConfig;
    let bestResult     = baseResult;
    let bestEvaluation = baseEvaluation;

    allRuns.push({ iteration: 0, config: baseConfig, result: baseResult, evaluation: baseEvaluation });

    for (let i = 1; i <= iterations; i++) {
      const candidate   = mutateConfig(bestConfig);
      const result      = this.backtest(candidate);
      const evaluation  = evaluateResult(result);

      allRuns.push({ iteration: i, config: candidate, result, evaluation });

      if (evaluation.score > bestEvaluation.score) {
        bestConfig     = candidate;
        bestResult     = result;
        bestEvaluation = evaluation;
      }
    }

    return { bestConfig, bestResult, bestEvaluation, iterations, allRuns };
  }

  private backtest(config: StrategyConfig): BacktestResult {
    const strategy = compileStrategy(config);
    const bt = new Backtester({
      strategy,
      candles:        this.candles,
      initialBalance: this.initialBalance,
    });
    return bt.run();
  }
}
