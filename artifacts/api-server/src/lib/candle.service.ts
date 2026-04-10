import { db, tradesTable } from "@workspace/db";
import { asc, sql } from "drizzle-orm";
import { logger } from "./logger.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface Candle {
  /** Unix timestamp in seconds (lightweight-charts format). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Supported chart intervals and their duration in milliseconds. */
export const INTERVALS: Record<string, number> = {
  "1m":  60_000,
  "5m":  300_000,
  "15m": 900_000,
  "1h":  3_600_000,
  "4h":  14_400_000,
  "1d":  86_400_000,
};

/* ── In-memory live candle store ──────────────────────────────────────────── */

/**
 * Stores the CURRENT (in-progress) candle per (symbol, interval) pair.
 * Keyed as "BTCUSDT:1m" → Candle.
 *
 * When a new trade arrives for a different bucket, the old candle is
 * "closed" (retained only for the WS broadcast) and a new one starts.
 */
const liveCandleMap = new Map<string, Candle>();

/**
 * Process one trade fill and return the updated live candle.
 *
 * Algorithm:
 *   1. Compute the bucket start time for this trade's interval.
 *   2. If no candle exists OR the existing candle is for a different bucket,
 *      start a fresh candle with open=high=low=close=price.
 *   3. Otherwise update high/low/close/volume in-place.
 *
 * @param trade   Fill data from the matching engine or bot runner.
 * @param interval  e.g. "1m"
 * @returns  The updated candle (may be a new candle or an updated one).
 */
export function processTrade(
  trade: { symbol: string; price: number; quantity: number; timestamp: number },
  interval = "1m"
): Candle {
  const ms = INTERVALS[interval] ?? INTERVALS["1m"];
  const bucketMs = Math.floor(trade.timestamp / ms) * ms;
  const bucketSec = bucketMs / 1000;

  const key = `${trade.symbol.toUpperCase()}:${interval}`;
  const existing = liveCandleMap.get(key);

  if (!existing || existing.time !== bucketSec) {
    const candle: Candle = {
      time:   bucketSec,
      open:   trade.price,
      high:   trade.price,
      low:    trade.price,
      close:  trade.price,
      volume: trade.quantity,
    };
    liveCandleMap.set(key, candle);
    logger.debug({ key, bucketSec }, "New candle started");
    return candle;
  }

  existing.high   = Math.max(existing.high, trade.price);
  existing.low    = Math.min(existing.low,  trade.price);
  existing.close  = trade.price;
  existing.volume += trade.quantity;

  return existing;
}

/** Return the current live candle, or null if no trade has arrived yet. */
export function getLiveCandle(symbol: string, interval = "1m"): Candle | null {
  return liveCandleMap.get(`${symbol.toUpperCase()}:${interval}`) ?? null;
}

/* ── Historical candle aggregation (Postgres) ─────────────────────────────── */

/**
 * Aggregate historical OHLCV candles from the trades table.
 *
 * Uses epoch-based bucketing so every interval (1m, 5m, 15m, 1h, 4h, 1d)
 * can be expressed uniformly without database-specific date_trunc variants.
 *
 * SQL pattern (per bucket):
 *   bucket = floor(epoch(close_time) / interval_s) * interval_s
 *   open   = (array_agg(exit ORDER BY close_time ASC))[1]
 *   high   = MAX(exit)
 *   low    = MIN(exit)
 *   close  = (array_agg(exit ORDER BY close_time DESC))[1]
 *   volume = SUM(size)
 *
 * The `exit` column is the fill price used by the legacy bot runner.
 *
 * @param symbol    Normalised symbol, e.g. "BTCUSDT" (used only as a label
 *                  in the response — the legacy trades table has no symbol column).
 * @param interval  One of the keys in INTERVALS, default "1m".
 * @param limit     Maximum number of candles to return (newest N), default 500.
 */
export async function getHistoricalCandles(
  _symbol: string,
  interval = "1m",
  limit = 500
): Promise<Candle[]> {
  const ms = INTERVALS[interval] ?? INTERVALS["1m"];
  const intervalSec = ms / 1000;

  try {
    // Use raw SQL with quoted identifiers to avoid Drizzle parameterising
    // the ORDER BY inside array_agg (which confuses PostgreSQL's GROUP BY
    // validation). intervalSec is a JS number — safe to inline directly.
    const bucket = sql.raw(
      `floor(extract(epoch from "close_time") / ${intervalSec}) * ${intervalSec}`
    );

    const rows = await db
      .select({
        time:   sql<number>`${bucket}`,
        open:   sql<number>`(array_agg("exit" ORDER BY "close_time" ASC))[1]`,
        high:   sql<number>`max("exit")`,
        low:    sql<number>`min("exit")`,
        close:  sql<number>`(array_agg("exit" ORDER BY "close_time" DESC))[1]`,
        volume: sql<number>`sum("size")`,
      })
      .from(tradesTable)
      .groupBy(sql`${bucket}`)
      .orderBy(asc(sql`${bucket}`))
      .limit(limit);

    return rows.map((r) => ({
      time:   Number(r.time),
      open:   Number(r.open),
      high:   Number(r.high),
      low:    Number(r.low),
      close:  Number(r.close),
      volume: Number(r.volume),
    }));
  } catch (err) {
    logger.warn({ err, interval, limit }, "Failed to fetch historical candles");
    return [];
  }
}
