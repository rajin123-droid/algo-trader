import { Router } from "express";
import { StrategyGenerator } from "../../../../services/ai-strategy/src/generator/strategy-generator.js";
import { compileStrategy }   from "../../../../services/ai-strategy/src/compiler/strategy-compiler.js";
import { Optimizer }         from "../../../../services/ai-strategy/src/optimizer/optimizer.js";
import { evaluateResult }    from "../../../../services/ai-strategy/src/evaluator/evaluator.js";
import { Backtester }        from "../../../../services/strategy-engine/src/backtester/backtester.js";
import { getHistoricalCandles } from "../lib/candle.service.js";
import { autoTradingManager }   from "../lib/auto-trading-manager.js";
import { logger } from "../lib/logger.js";

const router = Router();

/* ── POST /api/ai-strategy/generate ──────────────────────────────────────── */
/**
 * Full AI strategy generation pipeline:
 *   1. LLM generates StrategyConfig from user's idea
 *   2. Compile → Backtest on historical candles
 *   3. Optionally optimize parameters (N random-walk iterations)
 *   4. Return config, backtest result, and optional optimization results
 *
 * Request body:
 *   idea          string   Natural-language strategy description (required)
 *   symbol        string   default "BTCUSDT"
 *   interval      string   default "1m"
 *   limit         number   candles to load for backtest, default 300
 *   initialBalance number  starting balance, default 10000
 *   optimize      boolean  run parameter optimizer, default true
 *   iterations    number   optimization iterations, default 20
 *
 * Response:
 *   {
 *     generated: { config, result, evaluation }     ← raw AI output
 *     optimized: { config, result, evaluation }     ← after optimization (if requested)
 *     candleCount, symbol, interval
 *   }
 *
 * This is the ONLY endpoint you need to call.  The full pipeline runs in one
 * HTTP request (typically 5–15 s depending on LLM latency + iterations).
 *
 * Uses Replit AI Integrations (gpt-5.2) — no API key needed.
 */
router.post("/ai-strategy/generate", async (req, res) => {
  const {
    idea          = "",
    symbol        = "BTCUSDT",
    interval      = "1m",
    limit         = 300,
    initialBalance = 10_000,
    optimize      = true,
    iterations    = 20,
  } = req.body ?? {};

  if (!idea || typeof idea !== "string" || idea.trim().length < 5) {
    res.status(400).json({ error: "Provide a strategy idea (at least 5 characters)." });
    return;
  }

  const normalSymbol = String(symbol).toUpperCase().replace(/[/-]/g, "");
  const candleLimit  = Math.min(Math.max(Number(limit) || 300, 10), 2_000);
  const balance      = Math.max(Number(initialBalance) || 10_000, 1);
  const optIterations = Math.min(Math.max(Number(iterations) || 20, 1), 100);

  logger.info({ idea, symbol: normalSymbol, interval }, "AI strategy generation started");

  // ── 1. Generate StrategyCon fig via LLM ──────────────────────────────────
  let generatedConfig;
  try {
    const generator = new StrategyGenerator();
    generatedConfig = await generator.generate({
      idea: idea.trim(),
      symbol: normalSymbol,
      interval: String(interval),
    });
    logger.info({ name: generatedConfig.name }, "Strategy config generated");
  } catch (err) {
    logger.error({ err }, "Strategy generation failed");
    res.status(502).json({
      error:   "LLM strategy generation failed",
      details: (err as Error).message,
    });
    return;
  }

  // ── 2. Load historical candles ────────────────────────────────────────────
  const candles = await getHistoricalCandles(normalSymbol, String(interval), candleLimit);

  if (candles.length < 10) {
    res.status(422).json({
      error:          "Not enough historical candles to run a backtest.",
      candleCount:    candles.length,
      hint:           "Trigger the bot to generate more trades first, or try a different interval.",
      generatedConfig,
    });
    return;
  }

  // ── 3. Backtest generated config ──────────────────────────────────────────
  const generatedStrategy = compileStrategy(generatedConfig);
  const generatedResult   = new Backtester({
    strategy:       generatedStrategy,
    candles,
    initialBalance: balance,
  }).run();
  const generatedEvaluation = evaluateResult(generatedResult);

  logger.info(
    {
      trades:     generatedResult.metrics.totalTrades,
      pnl:        generatedResult.metrics.pnl.toFixed(2),
      score:      generatedEvaluation.score.toFixed(3),
    },
    "Generated strategy backtested"
  );

  // ── 4. Optimize parameters ────────────────────────────────────────────────
  let optimizedConfig    = generatedConfig;
  let optimizedResult    = generatedResult;
  let optimizedEvaluation = generatedEvaluation;

  if (optimize && candles.length >= 20) {
    const optimizer = new Optimizer(candles, balance);
    const optResult = optimizer.optimize(generatedConfig, optIterations);

    optimizedConfig    = optResult.bestConfig;
    optimizedResult    = optResult.bestResult;
    optimizedEvaluation = optResult.bestEvaluation;

    logger.info(
      {
        iterations:  optResult.iterations,
        bestScore:   optResult.bestEvaluation.score.toFixed(3),
        bestPnl:     optResult.bestResult.metrics.pnl.toFixed(2),
      },
      "Strategy optimization complete"
    );
  }

  res.json({
    symbol:      normalSymbol,
    interval,
    candleCount: candles.length,
    generated: {
      config:     generatedConfig,
      result:     stripTrades(generatedResult),
      evaluation: generatedEvaluation,
    },
    optimized: optimize ? {
      config:     optimizedConfig,
      result:     stripTrades(optimizedResult),
      evaluation: optimizedEvaluation,
      improved:   optimizedEvaluation.score > generatedEvaluation.score,
    } : null,
  });
});

/* ── POST /api/ai-strategy/deploy ─────────────────────────────────────────── */
/**
 * Deploy an AI-generated (or optimized) strategy to the auto-trading engine.
 *
 * Body:
 *   config         StrategyConfig   (from /generate response)
 *   userId         string           default "bot"
 *   symbol         string
 *   interval       string
 *   mode           "paper" | "live" default "paper"
 *   riskPercent    number           override risk.riskPerTrade from config
 *   maxDailyLoss   number           default 200
 *
 * Response: { sessionId, status: "started", session }
 */
router.post("/ai-strategy/deploy", async (req, res) => {
  const {
    config,
    userId      = "bot",
    symbol      = "BTCUSDT",
    interval    = "1m",
    mode        = "paper",
    riskPercent,
    maxDailyLoss = 200,
  } = req.body ?? {};

  if (!config || !config.indicators || !config.rules) {
    res.status(400).json({ error: "Missing or invalid strategy config" });
    return;
  }

  // Validate the config compiles without error
  try {
    compileStrategy(config);
  } catch (err) {
    res.status(400).json({ error: `Config compilation failed: ${(err as Error).message}` });
    return;
  }

  // Register as a compiled strategy in the session registry
  // We store the full config in strategyParams so the manager can rebuild it
  try {
    const session = await autoTradingManager.createAndStart({
      userId,
      strategyId:      "compiled:ai-strategy",
      strategyParams:  { config },   // manager will pick this up
      symbol:          String(symbol).toUpperCase(),
      interval:        String(interval),
      mode:            mode === "live" ? "live" : "paper",
      riskPercent:     Number(riskPercent ?? config.risk?.riskPerTrade ?? 0.02),
      maxPositionSize: 1,
      maxTradesPerMinute: 3,
      maxDailyLoss:    Number(maxDailyLoss),
    });

    res.status(201).json({ sessionId: session.id, status: "started", session });
  } catch (err) {
    logger.error({ err }, "AI strategy session start failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/ai-strategy/indicators ─────────────────────────────────────── */
/**
 * List all supported indicator types and their configurable parameters.
 */
router.get("/ai-strategy/indicators", (_req, res) => {
  res.json({
    indicators: [
      {
        type:   "EMA",
        label:  "Exponential Moving Average",
        params: [{ name: "period", type: "integer", min: 2, max: 500, default: 14 }],
        expressionVariables: ["EMA<period>  e.g. EMA12, EMA26"],
      },
      {
        type:   "SMA",
        label:  "Simple Moving Average",
        params: [{ name: "period", type: "integer", min: 2, max: 500, default: 20 }],
        expressionVariables: ["SMA<period>  e.g. SMA20, SMA50"],
      },
      {
        type:   "RSI",
        label:  "Relative Strength Index",
        params: [{ name: "period", type: "integer", min: 2, max: 100, default: 14 }],
        expressionVariables: ["RSI (period 14)", "RSI<period>  e.g. RSI7, RSI21"],
      },
      {
        type:   "MACD",
        label:  "Moving Average Convergence/Divergence",
        params: [
          { name: "fast",   type: "integer", min: 2,  max: 100, default: 12 },
          { name: "slow",   type: "integer", min: 2,  max: 500, default: 26 },
          { name: "signal", type: "integer", min: 2,  max: 100, default: 9  },
        ],
        expressionVariables: ["MACDLine", "MACDSignal", "MACDHistogram"],
      },
    ],
    expressionSyntax: {
      logical:    ["AND", "OR", "NOT"],
      comparison: [">", "<", ">=", "<=", "==", "!="],
      example:    "EMA12 > EMA26 AND RSI < 70",
    },
  });
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

type BacktestResultShape = {
  trades:      unknown[];
  equityCurve: unknown[];
  [key: string]: unknown;
};

/** Return result without the full trades array (too verbose for API response). */
function stripTrades(result: BacktestResultShape) {
  const { trades, equityCurve, ...rest } = result;
  return {
    ...rest,
    recentTrades:     trades.slice(-10),
    equityCurve:      equityCurve.slice(-50),
    totalTradesCount: trades.length,
  };
}

export default router;
