/**
 * PriceSimulator
 *
 * Generates realistic synthetic OHLCV candles for paper-trading engines
 * when live Binance WebSocket data is unavailable (e.g. geo-restricted
 * environments like Replit).
 *
 * Algorithm: Geometric Brownian Motion
 *   P(t+1) = P(t) * exp(σ * Z)    where Z ~ N(0,1)
 *
 * σ (vol per tick) = 0.003  → roughly ±0.3% per 10-second tick.
 * A slight mean-reversion term keeps prices from drifting to extremes.
 *
 * Each call to `nextCandle()` advances the price and returns a fresh
 * OHLCV candle with a unique `time` value (Unix seconds, current wall
 * clock) — so downstream deduplication filters never suppress it.
 */

export interface SimCandle {
  time:   number;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

/* ── Reference prices — updated to approximate current market levels ───────── */

const REFERENCE: Record<string, number> = {
  BTCUSDT:  84_000,
  ETHUSDT:   1_600,
  SOLUSDT:     130,
  BNBUSDT:     560,
  XRPUSDT:       2.1,
};

const DEFAULT_PRICE = 50_000;

/* ── GBM parameters ─────────────────────────────────────────────────────────── */

const SIGMA      = 0.003;   // ±0.3 % per tick (10 s cadence)
const REVERSION  = 0.0002;  // gentle pull toward reference price

/* ── Box-Muller normal variate ──────────────────────────────────────────────── */

function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/* ── Simulator class ────────────────────────────────────────────────────────── */

export class PriceSimulator {
  private prices = new Map<string, number>();

  private current(symbol: string): number {
    if (!this.prices.has(symbol)) {
      const ref = REFERENCE[symbol] ?? DEFAULT_PRICE;
      this.prices.set(symbol, ref);
    }
    return this.prices.get(symbol)!;
  }

  /**
   * Return the last known simulated price for a symbol without advancing it.
   * Used by PositionWatcher to evaluate SL/TP levels between candle ticks.
   */
  currentPrice(symbol: string): number {
    return this.current(symbol);
  }

  /**
   * Override the simulated price for a symbol with a real market price.
   * Called by the Binance market-data WS service so PositionWatcher always
   * evaluates SL/TP against real prices when live data is available.
   */
  setPrice(symbol: string, price: number): void {
    if (price > 0) this.prices.set(symbol.toUpperCase(), price);
  }

  /**
   * Advance the price one tick using GBM + mean-reversion.
   * Returns the new close price.
   */
  tick(symbol: string): number {
    const p   = this.current(symbol);
    const ref = REFERENCE[symbol] ?? p;

    // GBM drift
    const z = randn();
    let next = p * Math.exp(SIGMA * z);

    // Mean-reversion: nudge toward reference
    next += (ref - next) * REVERSION;

    this.prices.set(symbol, next);
    return next;
  }

  /**
   * Generate a synthetic OHLCV candle for `symbol`.
   * - `time` is the current Unix second (always unique per wall-clock second).
   * - OHLC uses intra-candle micro-noise around the close price.
   * - Volume is a random 50–500 BTC-equivalent units.
   */
  nextCandle(symbol: string): SimCandle {
    const close  = this.tick(symbol);
    const spread = close * 0.0005;          // 0.05% intra-candle noise

    const open   = close + (Math.random() - 0.5) * spread;
    const high   = Math.max(open, close) + Math.random() * spread * 0.5;
    const low    = Math.min(open, close) - Math.random() * spread * 0.5;
    const volume = 50 + Math.random() * 450;

    return {
      time: Math.floor(Date.now() / 1000),
      open:   parseFloat(open.toFixed(6)),
      high:   parseFloat(high.toFixed(6)),
      low:    parseFloat(low.toFixed(6)),
      close:  parseFloat(close.toFixed(6)),
      volume: parseFloat(volume.toFixed(4)),
    };
  }

  /**
   * Generate a sequence of `count` candles spaced `intervalMs` apart,
   * starting from `startTime` seconds ago.
   * Used to pre-warm EMA indicators before the live pump begins.
   */
  warmupCandles(symbol: string, count: number, intervalMs = 60_000): SimCandle[] {
    const nowSec  = Math.floor(Date.now() / 1000);
    const intervalSec = intervalMs / 1000;
    const startSec = nowSec - count * intervalSec;

    return Array.from({ length: count }, (_, i) => {
      const close  = this.tick(symbol);
      const spread = close * 0.0005;
      const open   = close + (Math.random() - 0.5) * spread;
      const high   = Math.max(open, close) + Math.random() * spread * 0.5;
      const low    = Math.min(open, close) - Math.random() * spread * 0.5;
      return {
        time:   startSec + i * intervalSec,
        open:   parseFloat(open.toFixed(6)),
        high:   parseFloat(high.toFixed(6)),
        low:    parseFloat(low.toFixed(6)),
        close:  parseFloat(close.toFixed(6)),
        volume: 50 + Math.random() * 450,
      };
    });
  }
}

/** Process-global singleton — one price state shared across all sessions. */
export const priceSimulator = new PriceSimulator();
