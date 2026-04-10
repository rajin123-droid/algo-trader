import { Router, type IRouter } from "express";

export const marketDataRouter: IRouter = Router();

/**
 * GET /api/market/klines?symbol=BTCUSDT&interval=1m&limit=200
 * Proxy to Binance REST klines — falls back to empty array on geo-restriction.
 */
marketDataRouter.get("/market/klines", async (req, res): Promise<void> => {
  const { symbol = "BTCUSDT", interval = "1m", limit = "200" } = req.query as Record<string, string>;

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!resp.ok) {
      res.status(resp.status).json({ error: `Binance returned ${resp.status}` });
      return;
    }

    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: "Market data unavailable", details: (err as Error).message });
  }
});

/**
 * GET /api/market/ticker?symbol=BTCUSDT
 * Proxy to Binance ticker price.
 */
marketDataRouter.get("/market/ticker", async (req, res): Promise<void> => {
  const { symbol = "BTCUSDT" } = req.query as Record<string, string>;

  try {
    const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });

    if (!resp.ok) {
      res.status(resp.status).json({ error: `Binance returned ${resp.status}` });
      return;
    }

    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: "Market data unavailable", details: (err as Error).message });
  }
});
