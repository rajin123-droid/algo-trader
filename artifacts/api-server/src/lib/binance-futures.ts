import { createHmac } from "node:crypto";

const TESTNET_BASE = "https://testnet.binancefuture.com";
const LIVE_BASE = "https://fapi.binance.com";

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";

export interface BinanceOrderResult {
  orderId: number;
  symbol: string;
  status: string;
  side: OrderSide;
  type: OrderType;
  origQty: string;
  executedQty: string;
  avgPrice: string;
  price: string;
  [key: string]: unknown;
}

export interface BinanceFuturesClientOptions {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
}

function sign(secret: string, queryString: string): string {
  return createHmac("sha256", secret).update(queryString).digest("hex");
}

function base(opts: BinanceFuturesClientOptions): string {
  return opts.testnet !== false ? TESTNET_BASE : LIVE_BASE;
}

async function signedPost(
  opts: BinanceFuturesClientOptions,
  raw: Record<string, string | number | boolean>
): Promise<BinanceOrderResult> {
  const qs = Object.entries(raw)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const signature = sign(opts.apiSecret, qs);
  const url = `${base(opts)}/fapi/v1/order?${qs}&signature=${signature}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-MBX-APIKEY": opts.apiKey, "Content-Type": "application/json" },
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const msg = typeof data.msg === "string" ? data.msg : JSON.stringify(data);
    throw new Error(`Binance error ${data.code ?? res.status}: ${msg}`);
  }

  return data as BinanceOrderResult;
}

/* ── Market / Limit order ───────────────────────────────────────────────── */

export async function placeFuturesOrder(
  opts: BinanceFuturesClientOptions,
  params: {
    symbol: string;
    side: OrderSide;
    type?: "MARKET" | "LIMIT";
    quantity: number;
    price?: number;
  }
): Promise<BinanceOrderResult> {
  const orderType = params.type ?? "MARKET";

  const raw: Record<string, string | number> = {
    symbol: params.symbol,
    side: params.side,
    type: orderType,
    quantity: params.quantity,
    timestamp: Date.now(),
  };

  if (orderType === "LIMIT" && params.price) {
    raw.price = params.price;
    raw.timeInForce = "GTC";
  }

  return signedPost(opts, raw);
}

/* ── Conditional order (STOP_MARKET / TAKE_PROFIT_MARKET) ──────────────── */
// Python: client.futures_create_order(type="STOP_MARKET", stopPrice=sl, closePosition=True)

export async function placeConditionalOrder(
  opts: BinanceFuturesClientOptions,
  params: {
    symbol: string;
    side: OrderSide;
    type: "STOP_MARKET" | "TAKE_PROFIT_MARKET";
    stopPrice: number;
  }
): Promise<BinanceOrderResult> {
  return signedPost(opts, {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
    stopPrice: params.stopPrice,
    closePosition: "true",
    timestamp: Date.now(),
  });
}

/* ── Bracket order helper ───────────────────────────────────────────────── */
// Combines: MARKET entry + STOP_MARKET SL + TAKE_PROFIT_MARKET TP
// Python equivalent of execute_trade(client, symbol, side, qty, sl, tp)

export interface BracketOrderResult {
  marketOrder: BinanceOrderResult;
  stopOrder: BinanceOrderResult;
  tpOrder: BinanceOrderResult;
}

export async function placeBracketOrders(
  opts: BinanceFuturesClientOptions,
  params: {
    symbol: string;
    side: OrderSide;
    quantity: number;
    sl: number;
    tp: number;
  }
): Promise<BracketOrderResult> {
  const closeSide: OrderSide = params.side === "BUY" ? "SELL" : "BUY";

  // Step 1 — entry MARKET order
  const marketOrder = await placeFuturesOrder(opts, {
    symbol: params.symbol,
    side: params.side,
    type: "MARKET",
    quantity: params.quantity,
  });

  // Steps 2 & 3 — SL and TP in parallel once entry is confirmed
  const [stopOrder, tpOrder] = await Promise.all([
    placeConditionalOrder(opts, {
      symbol: params.symbol,
      side: closeSide,
      type: "STOP_MARKET",
      stopPrice: params.sl,
    }),
    placeConditionalOrder(opts, {
      symbol: params.symbol,
      side: closeSide,
      type: "TAKE_PROFIT_MARKET",
      stopPrice: params.tp,
    }),
  ]);

  return { marketOrder, stopOrder, tpOrder };
}

/* ── Account balance ────────────────────────────────────────────────────── */
// Python: get_balance(client) → client.futures_account_balance() → USDT balance

export async function getAccountBalance(
  opts: BinanceFuturesClientOptions
): Promise<number> {
  const timestamp = Date.now();
  const qs = `timestamp=${timestamp}`;
  const signature = sign(opts.apiSecret, qs);
  const url = `${base(opts)}/fapi/v2/balance?${qs}&signature=${signature}`;

  const res = await fetch(url, {
    headers: { "X-MBX-APIKEY": opts.apiKey },
  });

  if (!res.ok) {
    throw new Error(`Binance balance fetch error ${res.status}`);
  }

  const data = (await res.json()) as Array<{ asset: string; balance: string }>;
  const usdt = data.find((b) => b.asset === "USDT");
  return usdt ? parseFloat(usdt.balance) : 0;
}

/* ── Utility ────────────────────────────────────────────────────────────── */

export function fillPrice(order: BinanceOrderResult, fallback: number): number {
  const avg = parseFloat(order.avgPrice ?? "0");
  const last = parseFloat(order.price ?? "0");
  return avg > 0 ? avg : last > 0 ? last : fallback;
}
