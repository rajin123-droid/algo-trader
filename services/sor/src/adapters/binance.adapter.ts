/**
 * Binance Futures adapter.
 *
 * Uses the Binance FAPI REST endpoints for order book data.
 * Order placement is always paper-simulated (to avoid unintended live trades).
 * Swap `placeOrder` for a real signed FAPI call when live trading is needed.
 */

import type {
  ExchangeAdapter,
  OrderBook,
  OrderBookLevel,
  Order,
  ExecutionResult,
  ExchangeFill,
} from "./exchange.interface.js";

const FAPI_BASE = "https://fapi.binance.com";

export class BinanceAdapter implements ExchangeAdapter {
  readonly name    = "binance";
  readonly isPaper = true;

  /** Cache the last fetched order book for paper execution. */
  private lastBook: OrderBook | null = null;

  /* ── Order book ──────────────────────────────────────────────────────── */

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const url = `${FAPI_BASE}/fapi/v1/depth?symbol=${symbol.toUpperCase()}&limit=${depth}`;

    let raw: { bids: [string, string][]; asks: [string, string][] };

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`Binance depth ${res.status}`);
      raw = (await res.json()) as typeof raw;
    } catch {
      // Fallback: synthetic mid-price book so routing still works offline
      raw = this.syntheticBook(symbol);
    }

    const book: OrderBook = {
      exchange:  this.name,
      symbol:    symbol.toUpperCase(),
      bids: raw.bids.map(([p, s]) => ({
        price:    Number(p),
        size:     Number(s),
        exchange: this.name,
      })).sort((a, b) => b.price - a.price),
      asks: raw.asks.map(([p, s]) => ({
        price:    Number(p),
        size:     Number(s),
        exchange: this.name,
      })).sort((a, b) => a.price - b.price),
      timestamp: Date.now(),
    };

    this.lastBook = book;
    return book;
  }

  /* ── Order placement (paper) ─────────────────────────────────────────── */

  async placeOrder(order: Order): Promise<ExecutionResult> {
    const book = this.lastBook;
    if (!book) {
      return this.errorResult("No order book cached — call getOrderBook first");
    }

    const levels: OrderBookLevel[] = order.side === "BUY" ? book.asks : book.bids;
    const fills = this.simulateFill(order, levels);

    if (fills.length === 0) {
      return this.errorResult("Insufficient liquidity in Binance book");
    }

    const totalSize = fills.reduce((s, f) => s + f.size, 0);
    const totalCost = fills.reduce((s, f) => s + f.size * f.price, 0);
    const avgPrice  = totalCost / totalSize;

    const exchangeFills: ExchangeFill[] = fills.map((f) => ({
      exchange:    this.name,
      price:       f.price,
      size:        f.size,
      fee:         f.size * f.price * 0.0004,   // 0.04% taker fee
      feeCurrency: order.symbol.slice(-4),       // e.g. "USDT"
      timestamp:   Date.now(),
    }));

    return {
      exchange:   this.name,
      orderId:    `BIN-PAPER-${crypto.randomUUID().slice(0, 8)}`,
      status:     totalSize >= order.size ? "FILLED" : "PARTIAL",
      fills:      exchangeFills,
      avgPrice,
      filledSize: totalSize,
    };
  }

  /* ── Balance (paper) ─────────────────────────────────────────────────── */

  async getBalance(_asset: string): Promise<number> {
    // Paper mode: return a large simulated balance
    return 1_000_000;
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */

  private simulateFill(
    order: Order,
    levels: OrderBookLevel[]
  ): Array<{ price: number; size: number }> {
    const fills: Array<{ price: number; size: number }> = [];
    let remaining = order.size;

    for (const level of levels) {
      if (remaining <= 0) break;
      if (order.type === "LIMIT" && order.price != null) {
        if (order.side === "BUY"  && level.price > order.price) break;
        if (order.side === "SELL" && level.price < order.price) break;
      }
      const take = Math.min(level.size, remaining);
      fills.push({ price: level.price, size: take });
      remaining -= take;
    }

    return fills;
  }

  private errorResult(error: string): ExecutionResult {
    return {
      exchange:   this.name,
      orderId:    "",
      status:     "ERROR",
      fills:      [],
      avgPrice:   0,
      filledSize: 0,
      error,
    };
  }

  private syntheticBook(symbol: string): { bids: [string, string][]; asks: [string, string][] } {
    // Generate a plausible synthetic book around a baseline price
    const basePrices: Record<string, number> = {
      BTCUSDT: 43000, ETHUSDT: 2500, BNBUSDT: 300, SOLUSDT: 100,
    };
    const mid = basePrices[symbol.toUpperCase()] ?? 1000;
    const spread = mid * 0.0002;

    const bids: [string, string][] = Array.from({ length: 10 }, (_, i) => [
      String((mid - spread / 2 - i * spread).toFixed(2)),
      String((10 + Math.random() * 5).toFixed(4)),
    ]);
    const asks: [string, string][] = Array.from({ length: 10 }, (_, i) => [
      String((mid + spread / 2 + i * spread).toFixed(2)),
      String((10 + Math.random() * 5).toFixed(4)),
    ]);
    return { bids, asks };
  }
}

export const binanceAdapter = new BinanceAdapter();
