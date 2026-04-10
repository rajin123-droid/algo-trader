import { OrderBook } from "./order-book.js";
import { MatchingEngine } from "./matching-engine.js";
import { RedisOrderBook } from "./redis-orderbook.js";
import { RedisMatchingEngine } from "./redis-matching-engine.js";
import { redisAvailable } from "./redis-client.js";
import { logger } from "@workspace/logger";

export type SyncEngine = { kind: "memory"; orderBook: OrderBook; matchingEngine: MatchingEngine };
export type AsyncEngine = { kind: "redis"; orderBook: RedisOrderBook; matchingEngine: RedisMatchingEngine };
export type SymbolEngine = SyncEngine | AsyncEngine;

/**
 * EngineRegistry — per-symbol order book + matching engine factory.
 *
 * Automatically selects the best available backend:
 *
 *   Redis available  → RedisOrderBook + RedisMatchingEngine
 *     Durable across restarts, shared across worker processes,
 *     distributed lock (SET NX EX) prevents duplicate fills.
 *
 *   Redis unavailable → in-memory OrderBook + MatchingEngine
 *     Falls back gracefully, resets on restart, single-process only.
 *
 * Per-symbol isolation:
 *   BTC-USDT → engine-1  { RedisOrderBook("BTCUSDT"), RedisMatchingEngine }
 *   ETH-USDT → engine-2  { RedisOrderBook("ETHUSDT"), RedisMatchingEngine }
 *   SOL-USDT → engine-3  (created lazily on first order)
 *
 * The returned engine type tag (`kind`) lets callers branch on sync vs async:
 *   const engine = registry.get("BTCUSDT");
 *   if (engine.kind === "redis") {
 *     trades = await engine.matchingEngine.match(order);
 *   } else {
 *     trades = engine.matchingEngine.match(order);  // sync
 *   }
 */
export class EngineRegistry {
  private readonly engines: Map<string, SymbolEngine> = new Map();

  get(symbol: string): SymbolEngine {
    const normalized = symbol.toUpperCase().replace("/", "").replace("-", "");

    if (!this.engines.has(normalized)) {
      const engine = this.createEngine(normalized);
      this.engines.set(normalized, engine);
      logger.info({ symbol: normalized, backend: engine.kind }, "Engine created for symbol");
    }

    return this.engines.get(normalized)!;
  }

  private createEngine(symbol: string): SymbolEngine {
    if (redisAvailable) {
      const orderBook = new RedisOrderBook(symbol);
      const matchingEngine = new RedisMatchingEngine(orderBook);
      return { kind: "redis", orderBook, matchingEngine };
    }

    logger.warn({ symbol }, "Redis not ready — using in-memory order book");
    const orderBook = new OrderBook(symbol);
    const matchingEngine = new MatchingEngine(orderBook);
    return { kind: "memory", orderBook, matchingEngine };
  }

  activeSymbols(): string[] {
    return [...this.engines.keys()];
  }

  /**
   * Snapshot all active order books (async — Redis or sync in-memory).
   * Used for REST /orderbook and WebSocket broadcasting.
   */
  async snapshots(depth = 20) {
    return Promise.all(
      [...this.engines.entries()].map(async ([symbol, engine]) => {
        if (engine.kind === "redis") {
          return engine.orderBook.snapshot(depth);
        }
        return engine.orderBook.snapshot(depth);
      })
    );
  }
}

export const engineRegistry = new EngineRegistry();
