/**
 * Bybit (linear perpetual) adapter.
 *
 * Uses Bybit v5 REST for order book data.
 * Order placement is always paper-simulated.
 */

import type {
  ExchangeAdapter,
  OrderBook,
  OrderBookLevel,
  Order,
  ExecutionResult,
  ExchangeFill,
} from "./exchange.interface.js";

const BYBIT_BASE = "https://api.bybit.com";

interface BybitDepthResponse {
  result: {
    b: [string, string][];  // bids [price, size]
    a: [string, string][];  // asks [price, size]
    ts: number;
  };
}

export class BybitAdapter implements ExchangeAdapter {
  readonly name    = "bybit";
  readonly isPaper = true;

  private lastBook: OrderBook | null = null;

  /* ── Order book ──────────────────────────────────────────────────────── */

  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const url = `${BYBIT_BASE}/v5/market/orderbook?category=linear&symbol=${symbol.toUpperCase()}&limit=${depth}`;

    let raw: BybitDepthResponse["result"];

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`Bybit depth ${res.status}`);
      const json = (await res.json()) as BybitDepthResponse;
      raw = json.result;
    } catch {
      raw = this.syntheticBook(symbol);
    }

    const book: OrderBook = {
      exchange:  this.name,
      symbol:    symbol.toUpperCase(),
      bids: raw.b.map(([p, s]) => ({
        price:    Number(p),
        size:     Number(s),
        exchange: this.name,
      })).sort((a, b) => b.price - a.price),
      asks: raw.a.map(([p, s]) => ({
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
      return this.errorResult("Insufficient liquidity in Bybit book");
    }

    const totalSize = fills.reduce((s, f) => s + f.size, 0);
    const totalCost = fills.reduce((s, f) => s + f.size * f.price, 0);
    const avgPrice  = totalCost / totalSize;

    const exchangeFills: ExchangeFill[] = fills.map((f) => ({
      exchange:    this.name,
      price:       f.price,
      size:        f.size,
      fee:         f.size * f.price * 0.00055,   // 0.055% taker fee
      feeCurrency: order.symbol.slice(-4),
      timestamp:   Date.now(),
    }));

    return {
      exchange:   this.name,
      orderId:    `BYB-PAPER-${crypto.randomUUID().slice(0, 8)}`,
      status:     totalSize >= order.size ? "FILLED" : "PARTIAL",
      fills:      exchangeFills,
      avgPrice,
      filledSize: totalSize,
    };
  }

  /* ── Balance (paper) ─────────────────────────────────────────────────── */

  async getBalance(_asset: string): Promise<number> {
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

  private syntheticBook(symbol: string): { b: [string, string][]; a: [string, string][]; ts: number } {
    const basePrices: Record<string, number> = {
      BTCUSDT: 43000, ETHUSDT: 2500, BNBUSDT: 300, SOLUSDT: 100,
    };
    const mid = basePrices[symbol.toUpperCase()] ?? 1000;
    // Bybit typically has a slightly different spread than Binance
    const spread = mid * 0.00022;

    const b: [string, string][] = Array.from({ length: 10 }, (_, i) => [
      String((mid - spread / 2 - i * spread).toFixed(2)),
      String((8 + Math.random() * 6).toFixed(4)),
    ]);
    const a: [string, string][] = Array.from({ length: 10 }, (_, i) => [
      String((mid + spread / 2 + i * spread).toFixed(2)),
      String((8 + Math.random() * 6).toFixed(4)),
    ]);
    return { b, a, ts: Date.now() };
  }
}

export const bybitAdapter = new BybitAdapter();
