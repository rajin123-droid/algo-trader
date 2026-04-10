/**
 * Canonical types for the Binance exchange adapter.
 *
 * These are the shaped subsets of the raw Binance REST responses
 * that the rest of the system consumes. Do not expose raw Binance
 * structures outside this package.
 */

/** A single asset balance line from Binance /account */
export interface ExchangeBalance {
  asset:  string;
  free:   number;
  locked: number;
}

/** A filled MARKET order — what we persist + return to callers */
export interface ExchangeOrderFill {
  price:  number;
  qty:    number;
  commission: number;
  commissionAsset: string;
}

/**
 * Normalised result of a placed MARKET order.
 * All numeric fields are JavaScript numbers (Binance sends strings).
 */
export interface ExchangeOrderResult {
  orderId:        string;
  clientOrderId:  string;
  symbol:         string;
  side:           "BUY" | "SELL";
  status:         string;
  executedQty:    number;
  cumulativeQuoteQty: number;
  fills:          ExchangeOrderFill[];
  /** Weighted-average fill price across all fills. */
  avgFillPrice:   number;
  transactTime:   number;
}

/** Connectivity test response. */
export interface PingResult {
  ok:         boolean;
  serverTime: number;
  latencyMs:  number;
}

/** Execution mode for a session. */
export type ExecutionMode = "paper" | "live";
