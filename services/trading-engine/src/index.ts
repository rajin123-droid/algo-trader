/**
 * Trading Engine Service — DI container and exports.
 *
 * Full correctness stack for LIMIT order execution:
 *
 *   handleOrderCreated(order)
 *     │
 *     ├─ claimEvent(order.id)          Idempotency — SET NX, drops duplicates
 *     │
 *     ├─ enqueueForSymbol(symbol)      In-process queue — FIFO per symbol
 *     │       │                        queue:BTC-USDT, queue:ETH-USDT …
 *     │       │
 *     │       ├─ acquire lock:BTCUSDT  Distributed lock — SET NX PX 5000
 *     │       │     └─ retry × 5      50 ms back-off if busy
 *     │       │
 *     │       ├─ start watchdog        Renew TTL every 2 s
 *     │       │
 *     │       ├─ match(order)          RedisMatchingEngine (lock-free)
 *     │       │     └─ Redis ZSET/LIST reads/writes
 *     │       │
 *     │       ├─ persist → DB          TradeExecution rows
 *     │       │
 *     │       ├─ update status         FILLED / PARTIALLY_FILLED / OPEN
 *     │       │
 *     │       ├─ stop watchdog
 *     │       └─ release lock:BTCUSDT  Lua CAS DEL
 *     │
 *     └─ emit ORDER_FILLED → Redis Streams → portfolio-service
 *
 * Per-symbol routing:
 *   BTC-USDT → RedisOrderBook("BTCUSDT") + RedisMatchingEngine
 *   ETH-USDT → RedisOrderBook("ETHUSDT") + RedisMatchingEngine
 *   (in-memory fallback when Redis is unavailable)
 */

import { engineEventBus } from "./utils/event-bus.js";
import { ORDER_EVENTS } from "./events/order.events.js";
import { OrderRepository } from "./repositories/order.repository.js";
import { TradeExecutionRepository } from "./repositories/trade-execution.repository.js";
import { OrderService } from "./services/order.service.js";
import { ExecutionService } from "./services/execution.service.js";
import { createOrderController } from "./controllers/order.controller.js";
import { engineRegistry } from "./orderbook/engine-registry.js";
import { redisLock } from "./orderbook/redis-lock.js";
import { AccountRepository } from "./repositories/account.repository.js";
import { LedgerService } from "./services/ledger.service.js";
import type { Order } from "./models/order.model.js";

const orderRepo = new OrderRepository();
const tradeRepo = new TradeExecutionRepository();
const accountRepo = new AccountRepository();
const ledgerService = new LedgerService(accountRepo);

const executionService = new ExecutionService(
  orderRepo,
  tradeRepo,
  engineEventBus,
  engineRegistry,
  redisLock,
  ledgerService
);

const orderService = new OrderService(orderRepo, engineEventBus);

engineEventBus.subscribe(ORDER_EVENTS.ORDER_CREATED, (payload) =>
  executionService.handleOrderCreated(payload as { order: Order })
);

export const orderRouter = createOrderController(orderService, executionService);

export { tradesRouter } from "./trades.router.js";
export { botRouter } from "./bot.router.js";
export {
  initEngine,
  getDashboardSummary,
  getPerformanceMetrics,
  getEquityCurve,
  getParams,
  updateParams,
  simulateTrade,
} from "./engine.js";
export { startBotLoop, stopBotLoop, runAllBots, runUserBot } from "./bot-runner.js";
export { getSignal, getClosePrices, getCurrentPrice } from "./signal.js";
export { calculatePositionSize, calculateSlTp, calculateTrailingStop } from "./risk.js";
export {
  OrderRepository,
  TradeExecutionRepository,
  AccountRepository,
  OrderService,
  ExecutionService,
  LedgerService,
  engineRegistry,
  redisLock,
};
