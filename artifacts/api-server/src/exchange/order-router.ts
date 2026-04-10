/**
 * OrderRouter
 *
 * Central routing layer that decides how a trade signal is executed.
 *
 * Routing table:
 *   session.mode === "paper" → internal paper engine (no exchange call)
 *   session.mode === "live"  → BinanceLiveExecutor → Binance API
 *
 * The OrderRouter is also the single place where:
 *   • The kill switch is enforced before any live order
 *   • Hard risk limits are checked (max order value)
 *   • Every live order attempt is audit-logged
 *
 * USAGE (auto-trading-manager.ts):
 *   const liveExec = orderRouter.makeLiveExecutor(session.userId);
 *   new ExecutionAdapter(session, paperExecutor, liveExec);
 */

import { placeMarketOrder, pingExchange, getExchangeBalances } from "./binance/binance.service.js";
import { hasLiveCredentials } from "./binance/binance.client.js";
import { killSwitchState } from "../lib/kill-switch.js";
import { logger } from "../lib/logger.js";
import type { LiveExecutor } from "../../../../services/auto-trading/src/index.js";
import type { ExchangeBalance } from "./binance/binance.types.js";

import { exchangeConfig } from "../config/exchange.js";

/** Maximum single-order notional value in USD. Hard risk cap. */
const MAX_ORDER_NOTIONAL_USD = exchangeConfig.maxOrderNotionalUsd;

/* ── BinanceLiveExecutor ─────────────────────────────────────────────────── */

/**
 * Implements the LiveExecutor interface from the auto-trading service.
 * Wraps binance.service.ts with pre-flight safety checks.
 */
class BinanceLiveExecutor implements LiveExecutor {
  constructor(private readonly userId: string) {}

  async placeMarketOrder(params: {
    userId:   string;
    symbol:   string;
    side:     "BUY" | "SELL";
    quantity: number;
  }): Promise<{ orderId: string; price: number; filledQty: number }> {
    const { userId, symbol, side, quantity } = params;

    // ── Guard 1: Kill switch ──────────────────────────────────────────────
    const ks = killSwitchState();
    if (ks.active) {
      const msg = `Kill switch active — live order blocked (reason: ${ks.reason ?? "admin halt"})`;
      logger.warn({ userId, symbol, side }, msg);
      throw new Error(msg);
    }

    // ── Guard 2: Credentials present ─────────────────────────────────────
    if (!hasLiveCredentials()) {
      throw new Error(
        "Binance API credentials not configured. " +
        "Set BINANCE_API_KEY and BINANCE_SECRET_KEY environment variables, " +
        "then use BINANCE_BASE_URL=https://testnet.binance.vision for testnet."
      );
    }

    // ── Guard 3: Notional size cap ────────────────────────────────────────
    // We don't know the exact price here; caller's risk engine already sized it.
    // We re-check as a hard backstop using a reasonable BTC price estimate.
    // For non-BTC symbols this is a rough guard; refine if adding more pairs.
    const estimatedNotional = quantity * 100_000; // very conservative BTC estimate
    if (estimatedNotional > MAX_ORDER_NOTIONAL_USD) {
      throw new Error(
        `Order notional ~$${estimatedNotional.toFixed(0)} exceeds hard cap $${MAX_ORDER_NOTIONAL_USD}. ` +
        `Reduce position size or raise MAX_ORDER_NOTIONAL_USD.`
      );
    }

    logger.info(
      { userId, symbol, side, quantity },
      "[OrderRouter] Forwarding live order to Binance"
    );

    const result = await placeMarketOrder({ symbol, side, quantity });

    return {
      orderId:   result.orderId,
      price:     result.avgFillPrice,
      filledQty: result.executedQty,
    };
  }
}

/* ── OrderRouter singleton ───────────────────────────────────────────────── */

class OrderRouter {
  /**
   * Create a LiveExecutor instance bound to a specific user.
   * Inject this into ExecutionAdapter when session.mode === "live".
   */
  makeLiveExecutor(userId: string): LiveExecutor {
    return new BinanceLiveExecutor(userId);
  }

  /** Connectivity check — doesn't require credentials. */
  ping(): ReturnType<typeof pingExchange> {
    return pingExchange();
  }

  /** Fetch real exchange balances — requires credentials. */
  getBalances(): Promise<ExchangeBalance[]> {
    return getExchangeBalances();
  }

  /** True when live execution can be attempted. */
  get canGoLive(): boolean {
    return hasLiveCredentials() && !killSwitchState().active;
  }
}

export const orderRouter = new OrderRouter();
