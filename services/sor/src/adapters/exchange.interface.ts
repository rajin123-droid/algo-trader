/**
 * Core types and interface for all exchange adapters.
 * Pure TypeScript — no external dependencies.
 */

/* ── Order book types ─────────────────────────────────────────────────────── */

export interface OrderBookLevel {
  price:    number;
  size:     number;
  exchange: string;
}

export interface OrderBook {
  exchange:  string;
  symbol:    string;
  /** Sorted descending by price (best bid first). */
  bids: OrderBookLevel[];
  /** Sorted ascending by price (best ask first). */
  asks: OrderBookLevel[];
  timestamp: number;
}

/* ── Order types ──────────────────────────────────────────────────────────── */

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";

export interface Order {
  symbol: string;
  side:   OrderSide;
  type:   OrderType;
  size:   number;
  /** Required for LIMIT orders. */
  price?: number;
  /** Client-assigned order ID for tracking. */
  clientOrderId?: string;
}

/* ── Execution result ─────────────────────────────────────────────────────── */

export interface ExchangeFill {
  exchange:   string;
  price:      number;
  size:       number;
  fee:        number;
  feeCurrency: string;
  timestamp:  number;
}

export interface ExecutionResult {
  exchange:  string;
  orderId:   string;
  status:    "FILLED" | "PARTIAL" | "REJECTED" | "ERROR";
  fills:     ExchangeFill[];
  avgPrice:  number;
  filledSize: number;
  error?:    string;
}

/* ── Exchange adapter interface ───────────────────────────────────────────── */

export interface ExchangeAdapter {
  readonly name: string;

  /**
   * Fetch the current order book for a symbol.
   * Levels are pre-tagged with the exchange name.
   */
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;

  /**
   * Place an order on this exchange.
   * In paper mode, simulates execution against the last fetched order book.
   */
  placeOrder(order: Order): Promise<ExecutionResult>;

  /**
   * Get available balance for an asset.
   * Returns 0 when not connected / in paper mode.
   */
  getBalance(asset: string): Promise<number>;

  /** Whether this adapter is operating in paper (simulated) mode. */
  readonly isPaper: boolean;
}
