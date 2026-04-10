import { Router } from "express";
import { createStrategy, Backtester, STRATEGY_REGISTRY } from "../../../../services/strategy-engine/src/index.js";
import { getHistoricalCandles } from "../lib/candle.service.js";
import type { StrategyParams } from "../../../../services/strategy-engine/src/strategies/strategy.interface.js";

const router = Router();

/**
 * GET /api/backtest/strategies
 *
 * List all available strategy IDs.
 *
 * Response: { strategies: string[] }
 */
router.get("/backtest/strategies", (_req, res) => {
  res.json({ strategies: Object.keys(STRATEGY_REGISTRY) });
});

/**
 * POST /api/backtest
 *
 * Run a backtest against historical candle data from the database.
 *
 * Request body:
 *   strategy        string   Strategy ID, e.g. "ema-crossover" (required)
 *   symbol          string   Trading pair, default "BTCUSDT"
 *   interval        string   Candle interval: 1m 5m 15m 1h 4h 1d, default "1m"
 *   limit           number   Max candles to load, 1–2000, default 500
 *   initialBalance  number   Starting balance in quote currency, default 10000
 *   params          object   Strategy-specific params (shortPeriod, longPeriod, …)
 *
 * Response: BacktestResult & { symbol, interval }
 *
 * The backtest runs entirely in-process — no DB writes, pure computation.
 * Typical latency: < 50 ms for 500 candles.
 *
 * Example:
 *   POST /api/backtest
 *   { "strategy": "ema-crossover", "interval": "1h", "params": { "shortPeriod": 9, "longPeriod": 21 } }
 */
router.post("/backtest", async (req, res) => {
  const {
    strategy:       strategyId  = "",
    symbol:         rawSymbol   = "BTCUSDT",
    interval                    = "1m",
    limit:          rawLimit    = 500,
    initialBalance: rawBalance  = 10_000,
    params                      = {},
  } = req.body as {
    strategy?:        string;
    symbol?:          string;
    interval?:        string;
    limit?:           number;
    initialBalance?:  number;
    params?:          StrategyParams;
  };

  // ── Validate ──────────────────────────────────────────────────────────────

  if (!strategyId) {
    res.status(400).json({ error: "Missing required field: strategy" });
    return;
  }

  let strategy;
  try {
    strategy = createStrategy(strategyId, params);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const symbol         = rawSymbol.toUpperCase().replace(/[/-]/g, "");
  const limit          = Math.min(Math.max(Number(rawLimit) || 500, 1), 2_000);
  const initialBalance = Math.max(Number(rawBalance) || 10_000, 1);

  // ── Load candles ──────────────────────────────────────────────────────────

  const candles = await getHistoricalCandles(symbol, interval, limit);

  if (candles.length === 0) {
    res.status(422).json({
      error: "No historical candles found for the requested symbol/interval.",
      hint:  "Trigger the bot to generate trades, or try a different interval.",
    });
    return;
  }

  // ── Run backtest ──────────────────────────────────────────────────────────

  const bt     = new Backtester({ strategy, candles, initialBalance });
  const result = bt.run();

  res.json({ symbol, interval, ...result });
});

export default router;
