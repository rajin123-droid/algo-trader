import { EventEmitter } from "node:events";
import type { Candle } from "./candle.service.js";

/**
 * InProcessBus
 *
 * A lightweight in-process EventEmitter used to decouple the candle
 * publisher from the auto-trading manager without introducing Redis.
 *
 * Lifecycle:
 *   publisher emits → bus fans out to all registered listeners → manager fires onCandle
 *
 * Why not Redis Pub/Sub?
 *   The auto-trading manager runs in the same Node.js process as the API server.
 *   An in-process emitter has zero latency and no serialization overhead.
 *   If the architecture later splits into separate processes, swap this for
 *   a Redis Streams consumer.
 *
 * Events:
 *   "candle"   → { symbol: string, interval: string, candle: Candle }
 *   "trade"    → { symbol: string, side: string, price: number, userId: string }
 */

export type CandleEvent = {
  symbol:   string;
  interval: string;
  candle:   Candle;
};

class InProcessBus extends EventEmitter {
  emitCandle(event: CandleEvent): void {
    this.emit("candle", event);
  }
}

/** Singleton — import this wherever candle events need to be produced/consumed. */
export const inProcessBus = new InProcessBus();
inProcessBus.setMaxListeners(50);
