import { Router } from "express";
import { getHistoricalCandles, getLiveCandle, INTERVALS } from "../lib/candle.service.js";

const router = Router();

/**
 * GET /api/candles
 *
 * Returns historical OHLCV candles aggregated from the trades table,
 * optionally merged with the current live (in-progress) candle.
 *
 * Query parameters:
 *   symbol    string   Trading pair, e.g. "BTCUSDT" (default "BTCUSDT")
 *   interval  string   One of: 1m 5m 15m 1h 4h 1d (default "1m")
 *   limit     number   Max candles to return, 1–1000 (default 500)
 *
 * Response: { symbol, interval, candles: Candle[] }
 *   Candle: { time: number, open, high, low, close, volume }
 *   `time` is a Unix timestamp in SECONDS (lightweight-charts format).
 *
 * The live candle (if any) is appended/merged as the last entry so the
 * chart always shows the in-progress bar without a round-trip.
 *
 * Example:
 *   GET /api/candles?symbol=BTCUSDT&interval=5m&limit=200
 */
router.get("/candles", async (req, res) => {
  const symbol   = String(req.query["symbol"]   ?? "BTCUSDT").toUpperCase().replace(/[/-]/g, "");
  const interval = String(req.query["interval"] ?? "1m");
  const limit    = Math.min(Math.max(Number(req.query["limit"] ?? 500), 1), 1000);

  if (!INTERVALS[interval]) {
    res.status(400).json({
      error: `Unsupported interval "${interval}". Supported: ${Object.keys(INTERVALS).join(", ")}`,
    });
    return;
  }

  const candles = await getHistoricalCandles(symbol, interval, limit);

  // Merge the live (in-progress) candle into the result
  const live = getLiveCandle(symbol, interval);
  if (live) {
    const lastHistorical = candles[candles.length - 1];
    if (lastHistorical && lastHistorical.time === live.time) {
      candles[candles.length - 1] = live;
    } else {
      candles.push(live);
    }
  }

  res.json({ symbol, interval, candles });
});

export default router;
