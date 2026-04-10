/**
 * BinanceService
 *
 * Thin, stateless wrapper around the Binance SDK that:
 *   • Places MARKET orders (BUY / SELL)
 *   • Fetches account balances
 *   • Queries order status
 *   • Tests connectivity (ping + server time)
 *
 * All numeric fields are normalised to JavaScript numbers.
 * All errors are logged then re-thrown so callers can handle them.
 */

import { binanceClient, hasLiveCredentials } from "./binance.client.js";
import type { ExchangeBalance, ExchangeOrderResult, PingResult } from "./binance.types.js";
import { logger } from "../../lib/logger.js";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function avgPrice(fills: Array<{ price: string; qty: string }>): number {
  let totalQty   = 0;
  let totalValue = 0;
  for (const f of fills) {
    const q = Number(f.qty);
    totalQty   += q;
    totalValue += Number(f.price) * q;
  }
  return totalQty > 0 ? totalValue / totalQty : 0;
}

/**
 * Round a quantity to 8 decimal places to prevent float precision artifacts
 * (e.g. 0.10000000000000001) that cause Binance LOT_SIZE filter rejections
 * (-1111: Precision is over the maximum defined for this asset).
 *
 * 8dp is the maximum Binance allows for any asset; trailing zeros are stripped
 * automatically by parseFloat so the string sent to the API is always clean.
 */
function sanitiseQty(quantity: number): string {
  return parseFloat(quantity.toFixed(8)).toString();
}

/* ── Connectivity ────────────────────────────────────────────────────────── */

/**
 * Ping Binance and return server time + round-trip latency.
 * Does NOT require API credentials.
 */
export async function pingExchange(): Promise<PingResult> {
  const t0 = Date.now();
  try {
    const res = await binanceClient.time() as { data: { serverTime: number } };
    const latencyMs = Date.now() - t0;
    logger.debug({ latencyMs, serverTime: res.data.serverTime }, "Binance ping OK");
    return { ok: true, serverTime: res.data.serverTime, latencyMs };
  } catch (err) {
    logger.error({ err }, "Binance ping failed");
    throw err;
  }
}

/* ── Account balance ─────────────────────────────────────────────────────── */

/**
 * Fetch all non-zero asset balances from the exchange account.
 * Requires valid API credentials.
 */
export async function getExchangeBalances(): Promise<ExchangeBalance[]> {
  if (!hasLiveCredentials()) {
    throw new Error("Binance credentials not configured. Set BINANCE_API_KEY and BINANCE_SECRET_KEY.");
  }

  try {
    const res = await binanceClient.account() as {
      data: { balances: Array<{ asset: string; free: string; locked: string }> }
    };

    const balances: ExchangeBalance[] = res.data.balances
      .map((b) => ({
        asset:  b.asset,
        free:   Number(b.free),
        locked: Number(b.locked),
      }))
      .filter((b) => b.free > 0 || b.locked > 0);

    logger.info({ count: balances.length }, "Fetched Binance account balances");
    return balances;
  } catch (err) {
    logger.error({ err }, "Failed to fetch Binance account balances");
    throw err;
  }
}

/* ── Order placement ─────────────────────────────────────────────────────── */

export interface PlaceOrderParams {
  symbol:   string;
  side:     "BUY" | "SELL";
  quantity: number;
  /** Optional unique ID for idempotency (max 36 chars). */
  clientOrderId?: string;
}

/**
 * Place a MARKET order on Binance.
 *
 * ⚠️  THIS SENDS A REAL ORDER. Only call when session.mode === "live".
 *
 * The caller is responsible for:
 *   - Pre-flight risk checks (size limits, kill switch)
 *   - Persisting the result to auto_trades with exchange_order_id
 */
export async function placeMarketOrder(params: PlaceOrderParams): Promise<ExchangeOrderResult> {
  if (!hasLiveCredentials()) {
    throw new Error("Binance credentials not configured. Set BINANCE_API_KEY and BINANCE_SECRET_KEY.");
  }

  const { symbol, side, quantity, clientOrderId } = params;

  logger.info({ symbol, side, quantity, clientOrderId }, "Placing Binance MARKET order");

  try {
    const options: Record<string, unknown> = {
      newOrderRespType: "FULL",
      // Binance default recvWindow is 5000ms. Any clock skew between our server
      // and Binance causes silent -1021 rejections. 10000ms gives a safe buffer.
      recvWindow: 10_000,
    };
    if (clientOrderId) options.newClientOrderId = clientOrderId;

    const res = await binanceClient.newOrder(symbol, side, "MARKET", {
      // sanitiseQty prevents float artifacts like 0.10000000000000001
      // which Binance rejects with -1111 (precision over LOT_SIZE maximum).
      quantity: sanitiseQty(quantity),
      ...options,
    }) as { data: {
      orderId:              number;
      clientOrderId:        string;
      symbol:               string;
      side:                 string;
      status:               string;
      executedQty:          string;
      cummulativeQuoteQty:  string;
      transactTime:         number;
      fills:                Array<{ price: string; qty: string; commission: string; commissionAsset: string }>;
    }};

    const d = res.data;
    const fills = d.fills.map((f) => ({
      price:           Number(f.price),
      qty:             Number(f.qty),
      commission:      Number(f.commission),
      commissionAsset: f.commissionAsset,
    }));

    const result: ExchangeOrderResult = {
      orderId:             String(d.orderId),
      clientOrderId:       d.clientOrderId,
      symbol:              d.symbol,
      side:                d.side as "BUY" | "SELL",
      status:              d.status,
      executedQty:         Number(d.executedQty),
      cumulativeQuoteQty:  Number(d.cummulativeQuoteQty),
      fills,
      avgFillPrice:        avgPrice(d.fills),
      transactTime:        d.transactTime,
    };

    logger.info(
      { orderId: result.orderId, status: result.status, avgPrice: result.avgFillPrice, filledQty: result.executedQty },
      "Binance MARKET order filled"
    );

    return result;
  } catch (err) {
    logger.error({ err, symbol, side, quantity }, "Binance order placement failed");
    throw err;
  }
}

/* ── Order status ────────────────────────────────────────────────────────── */

/**
 * Query the current status of an order by its Binance orderId.
 */
export async function getOrderStatus(symbol: string, orderId: string): Promise<{
  orderId: string;
  status:  string;
  executedQty: number;
  avgPrice: number;
}> {
  if (!hasLiveCredentials()) {
    throw new Error("Binance credentials not configured.");
  }

  try {
    const res = await binanceClient.getOrder(symbol, { orderId: Number(orderId) }) as {
      data: { orderId: number; status: string; executedQty: string; price: string; cummulativeQuoteQty: string }
    };
    const d = res.data;

    const executedQty         = Number(d.executedQty);
    const cumulativeQuoteQty  = Number(d.cummulativeQuoteQty);

    // d.price is the order's LIMIT trigger price, which Binance sets to "0" for
    // MARKET orders. The true average fill price is quoteQty ÷ baseQty.
    const avgPrice = executedQty > 0 ? cumulativeQuoteQty / executedQty : 0;

    return {
      orderId: String(d.orderId),
      status:  d.status,
      executedQty,
      avgPrice,
    };
  } catch (err) {
    logger.error({ err, symbol, orderId }, "Failed to query order status");
    throw err;
  }
}
