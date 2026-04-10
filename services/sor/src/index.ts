/**
 * @workspace/sor — Smart Order Router
 *
 * Pure domain logic for multi-venue order routing.
 * No DB, no HTTP — those live in the api-server adapter layer.
 *
 * Usage:
 *   1. Call aggregateOrderBooks(symbol, adapters) to get a consolidated book.
 *   2. Call runPreTradeChecks(params) — abort if not passed.
 *   3. Call routeOrder(order, aggregated) to get a routing plan.
 *   4. Execute each fill slice on the appropriate adapter (in api-server).
 *   5. Call aggregateFills(results, requestedSize) for the final summary.
 *   6. Record to ledger (in api-server).
 */

export type {
  ExchangeAdapter,
  OrderBook,
  OrderBookLevel,
  Order,
  OrderSide,
  OrderType,
  ExecutionResult,
  ExchangeFill,
} from "./adapters/exchange.interface.js";

export { BinanceAdapter, binanceAdapter } from "./adapters/binance.adapter.js";
export { BybitAdapter,   bybitAdapter   } from "./adapters/bybit.adapter.js";

export {
  mergeBooks,
  aggregateOrderBooks,
  bookSideFor,
  availableLiquidity,
} from "./router/orderbook-aggregator.js";
export type { AggregatedOrderBook } from "./router/orderbook-aggregator.js";

export {
  routeOrder,
  singleVenueVWAP,
} from "./router/smart-router.js";
export type { RoutedFill, RoutingResult } from "./router/smart-router.js";

export {
  aggregateFills,
  computeSavings,
  computeSlippageBps,
} from "./aggregator/fill-aggregator.js";
export type { AggregatedFill } from "./aggregator/fill-aggregator.js";

export {
  runPreTradeChecks,
  checkMinSize,
  checkMaxSize,
  checkBalance,
  checkSlippage,
  checkMarketImpact,
} from "./risk/pre-trade-checks.js";
export type { PreTradeCheckResult, PreTradeParams } from "./risk/pre-trade-checks.js";
