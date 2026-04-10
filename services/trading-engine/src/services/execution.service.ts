import { logger } from "@workspace/logger";
import { publish } from "@workspace/event-bus";
import type { Order } from "../models/order.model.js";
import type { TradeExecution } from "../models/trade-execution.model.js";
import type { OrderRepository } from "../repositories/order.repository.js";
import type { TradeExecutionRepository } from "../repositories/trade-execution.repository.js";
import type { EventBus } from "../utils/event-bus.js";
import type { EngineRegistry } from "../orderbook/engine-registry.js";
import type { RedisLock } from "../orderbook/redis-lock.js";
import { startLockWatchdog } from "../utils/lock-watchdog.js";
import { claimEvent } from "../utils/idempotency.js";
import { ORDER_EVENTS } from "../events/order.events.js";
import { getMarketPrice } from "../utils/price.js";
import type { LedgerService } from "./ledger.service.js";
import { publishTrade, publishOrderBook } from "../../../ws-gateway/src/publishers/ws-publisher.js";

/** Extract base/quote from Binance-style symbol string.  BTCUSDT → {base:"BTC", quote:"USDT"} */
function parseSymbol(symbol: string): { base: string; quote: string } {
  const s = symbol.toUpperCase().replace(/[/-]/g, "");
  const quoteAssets = ["USDT", "BUSD", "BTC", "ETH", "BNB"];
  for (const q of quoteAssets) {
    if (s.endsWith(q) && s.length > q.length) {
      return { base: s.slice(0, s.length - q.length), quote: q };
    }
  }
  return { base: s.slice(0, -4), quote: s.slice(-4) };
}

/**
 * ExecutionService — top-level coordinator for order execution.
 *
 * Correctness guarantees (layered):
 *
 *   1. Idempotency guard   → claimEvent(order.id) via SET NX
 *      Prevents duplicate fills if ORDER_CREATED is delivered twice
 *      (Redis Streams retry, worker crash-and-replay, race on startup).
 *
 *   2. Per-symbol queue    → promise chain per symbol (in-process)
 *      Serialises all orders for the same symbol within ONE process.
 *      queue:BTC-USDT → [order-1, order-2, order-3, …]   (FIFO)
 *      queue:ETH-USDT → [order-A, order-B, …]
 *
 *   3. Distributed lock    → RedisLock SET NX PX 5000
 *      Prevents concurrent fills across MULTIPLE processes/pods.
 *      BTC-USDT → only worker-1 can match at a time
 *      ETH-USDT → only worker-2 can match at a time
 *
 *   4. Lock watchdog       → renews TTL every 2 s while matching runs
 *      Prevents lock expiry during a large matching batch.
 *
 *   5. Lock-free matching engine
 *      RedisMatchingEngine.match() is a pure async function — no
 *      internal locks. All locking is owned by this service.
 *
 * Full lifecycle for LIMIT order:
 *
 *   handleOrderCreated(order)
 *     │
 *     ├─ claimEvent(order.id) ──► already processed? → return (idempotency)
 *     │
 *     ├─ enqueueForSymbol(symbol)   ← in-process serial queue
 *     │       │
 *     │       ├─ acquire lock:BTCUSDT   (SET NX PX 5000)
 *     │       │     └─ not acquired? → retry after 50 ms (max 5×)
 *     │       │
 *     │       ├─ start watchdog  (renew every 2 s)
 *     │       │
 *     │       ├─ matchingEngine.match(order)   ← Redis reads/writes
 *     │       │
 *     │       ├─ persistMatchedTrades → DB
 *     │       │
 *     │       ├─ update order status (FILLED / PARTIALLY_FILLED / OPEN)
 *     │       │
 *     │       ├─ stop watchdog
 *     │       └─ release lock:BTCUSDT  (Lua CAS DEL)
 *     │
 *     └─ markProcessed(order.id)  ← written after full success
 */
export class ExecutionService {
  /** In-process serial queues — one promise chain per symbol. */
  private readonly symbolQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly tradeRepo: TradeExecutionRepository,
    private readonly eventBus: EventBus,
    private readonly engineRegistry: EngineRegistry,
    private readonly lock: RedisLock,
    private readonly ledger: LedgerService
  ) {}

  /* ── Public entry point ───────────────────────────────────────────────── */

  async handleOrderCreated({ order }: { order: Order }): Promise<void> {
    // 1. Idempotency — drop duplicates before touching the queue
    const claimed = await claimEvent(order.id);
    if (!claimed) {
      logger.warn({ orderId: order.id }, "Duplicate ORDER_CREATED — skipping (already processed)");
      return;
    }

    // 2. Route by type — MARKET skips the book entirely
    if (order.type === "MARKET") {
      await this.executeMarket(order);
      return;
    }

    // 3. LIMIT → enqueue for per-symbol serial processing
    this.enqueueForSymbol(order.symbol, () => this.executeWithLock(order));
  }

  /* ── Per-symbol in-process queue ─────────────────────────────────────── */

  /**
   * Chain the task onto the symbol's promise queue.
   * Within one process, orders for the same symbol always run sequentially.
   *
   * queue:BTC-USDT  →  [executeWithLock(A), executeWithLock(B), …]
   * queue:ETH-USDT  →  [executeWithLock(X), executeWithLock(Y), …]
   */
  private enqueueForSymbol(symbol: string, task: () => Promise<void>): void {
    const normalized = symbol.toUpperCase().replace(/[/-]/g, "");
    const prev = this.symbolQueues.get(normalized) ?? Promise.resolve();
    const next = prev.then(task).catch((err) =>
      logger.error({ err, symbol }, "Unhandled error in symbol queue")
    );
    this.symbolQueues.set(normalized, next);
  }

  /* ── Distributed lock wrapper ─────────────────────────────────────────── */

  private async executeWithLock(order: Order, attempt = 0): Promise<void> {
    const lockKey = `lock:${order.symbol.toUpperCase().replace(/[/-]/g, "")}`;
    const workerId = crypto.randomUUID();
    const MAX_RETRIES = 5;

    const acquired = await this.lock.acquire(lockKey, workerId, 5_000);

    if (!acquired) {
      if (attempt >= MAX_RETRIES) {
        logger.error({ orderId: order.id, lockKey, attempt }, "Failed to acquire lock after max retries — order dropped");
        return;
      }
      logger.warn({ orderId: order.id, lockKey, attempt }, "Lock busy — retrying in 50 ms");
      await sleep(50 * (attempt + 1));
      return this.executeWithLock(order, attempt + 1);
    }

    const stopWatchdog = startLockWatchdog(this.lock, lockKey, workerId);

    try {
      await this.executeLimit(order);
    } finally {
      stopWatchdog();
      await this.lock.release(lockKey, workerId);
    }
  }

  /* ── MARKET execution ────────────────────────────────────────────────── */

  private async executeMarket(order: Order): Promise<void> {
    const marketPrice = await getMarketPrice(order.symbol);

    const execution = await this.recordFillWithLedger(order, marketPrice, order.quantity);

    await this.orderRepo.updateFill(order.id, order.quantity, "FILLED");

    logger.info(
      { orderId: order.id, symbol: order.symbol, side: order.side, price: marketPrice, qty: order.quantity },
      "MARKET order filled"
    );

    await this.emitFilled(order, execution);
  }

  /* ── LIMIT execution (lock must be held by caller) ───────────────────── */

  private async executeLimit(order: Order): Promise<void> {
    const engine = this.engineRegistry.get(order.symbol);

    let matchedTrades: Awaited<ReturnType<typeof engine.matchingEngine.match>>;

    if (engine.kind === "redis") {
      matchedTrades = await engine.matchingEngine.match(order);
    } else {
      matchedTrades = engine.matchingEngine.match(order);
    }

    if (matchedTrades.length > 0) {
      for (const t of matchedTrades) {
        await this.recordFillWithLedger(order, t.price, t.quantity);
      }
    }

    const isFullyFilled = order.filledQuantity >= order.quantity;
    const isPartiallyFilled = order.filledQuantity > 0 && !isFullyFilled;

    if (isFullyFilled) {
      await this.orderRepo.updateFill(order.id, order.filledQuantity, "FILLED");
      logger.info({ orderId: order.id, symbol: order.symbol, fills: matchedTrades.length }, "LIMIT order fully filled");

      const executions = await this.tradeRepo.findByOrderId(order.id);
      if (executions[0]) await this.emitFilled(order, executions[0]);
    } else if (isPartiallyFilled) {
      await this.orderRepo.updateFill(order.id, order.filledQuantity, "PARTIALLY_FILLED");

      if (engine.kind === "redis") {
        await engine.orderBook.addOrder(order);
      } else {
        engine.orderBook.addOrder(order);
      }

      logger.info(
        { orderId: order.id, filled: order.filledQuantity, remaining: order.quantity - order.filledQuantity },
        "LIMIT order partially filled — rest queued"
      );

      await this.eventBus.publish(ORDER_EVENTS.ORDER_PARTIALLY_FILLED, { order });
    } else {
      await this.orderRepo.updateStatus(order.id, "OPEN");

      if (engine.kind === "redis") {
        await engine.orderBook.addOrder(order);
      } else {
        engine.orderBook.addOrder(order);
      }

      logger.info({ orderId: order.id, limitPrice: order.price }, "LIMIT order queued — no immediate match");
      await this.eventBus.publish(ORDER_EVENTS.ORDER_OPENED, { order });
    }
  }

  /* ── Helpers ──────────────────────────────────────────────────────────── */

  /**
   * Record one fill event:
   *   1. TradeExecution row → trade_executions table (engine audit trail)
   *   2. Ledger transaction → accounts/transactions/entries (double-entry accounting)
   *
   * Both writes happen for every fill — they serve different purposes:
   *   trade_executions  = "what the engine did" (price, qty, timestamp)
   *   ledger entries    = "how money moved"      (accounting balances)
   */
  private async recordFillWithLedger(
    order: Order,
    price: number,
    quantity: number
  ): Promise<TradeExecution> {
    const execution = await this.tradeRepo.create({
      id: crypto.randomUUID(),
      orderId: order.id,
      userId: order.userId,
      price: String(price),
      quantity: String(quantity),
    });

    const { base, quote } = parseSymbol(order.symbol);
    await this.ledger.recordTradeFill({
      userId: order.userId,
      side: order.side,
      baseAsset: base,
      quoteAsset: quote,
      quantity,
      price,
      orderId: order.id,
    });

    return execution;
  }

  private async emitFilled(order: Order, execution: TradeExecution): Promise<void> {
    await this.eventBus.publish(ORDER_EVENTS.ORDER_FILLED, { order, execution });
    await publish("ORDER_FILLED", {
      orderId: order.id,
      userId: order.userId,
      symbol: order.symbol,
      side: order.side,
      price: execution.price,
      quantity: execution.quantity,
      pnl: 0,
    });
    await publish("BALANCE_UPDATED", { userId: order.userId, symbol: order.symbol });

    await publishTrade({
      symbol: order.symbol,
      side: order.side,
      price: Number(execution.price),
      quantity: Number(execution.quantity),
      orderId: order.id,
      userId: order.userId,
      executedAt: new Date(),
    });
    await publishOrderBook(order.symbol);
  }

  getTradesByUser(userId: string): ReturnType<TradeExecutionRepository["findByUserId"]> {
    return this.tradeRepo.findByUserId(userId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
