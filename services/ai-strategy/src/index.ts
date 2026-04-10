/**
 * @workspace/ai-strategy
 *
 * AI-powered trading strategy generation pipeline.
 *
 * Pipeline:
 *   1. User natural-language idea
 *         ↓
 *   2. StrategyGenerator (calls gpt-5.2 via Replit AI proxy)
 *         ↓  StrategyConfig JSON
 *   3. compileStrategy(config)
 *         ↓  Strategy instance (implements Strategy interface)
 *   4. Backtester.run(candles)
 *         ↓  BacktestResult
 *   5. Optimizer.optimize(config, iterations)
 *         ↓  best StrategyConfig + BacktestResult
 *   6. autoTradingManager.createAndStart(session)
 *         ↓  live auto-trading with the optimized strategy
 *
 * Usage:
 *   import { StrategyGenerator, compileStrategy, Optimizer } from '@workspace/ai-strategy';
 *
 *   const gen = new StrategyGenerator();
 *   const config = await gen.generate({ idea: 'EMA momentum + RSI filter', symbol: 'BTCUSDT' });
 *   const strategy = compileStrategy(config);
 *   // backtesting + optimization omitted …
 */

export type { StrategyConfig, IndicatorConfig, RulesConfig, RiskConfig } from "./models/strategy-config.js";
export { sanitiseConfig, DEFAULT_RISK } from "./models/strategy-config.js";

export type { StrategyIdeaInput }  from "./prompt-engine/prompt-builder.js";
export { buildMessages }           from "./prompt-engine/prompt-builder.js";
export { parseStrategyResponse, ParseError } from "./prompt-engine/response-parser.js";

export { StrategyGenerator }       from "./generator/strategy-generator.js";
export { compileStrategy }         from "./compiler/strategy-compiler.js";
export { evaluateResult }          from "./evaluator/evaluator.js";
export type { EvaluationResult }   from "./evaluator/evaluator.js";
export { Optimizer }               from "./optimizer/optimizer.js";
export type { OptimizationResult, OptimizationRun } from "./optimizer/optimizer.js";
