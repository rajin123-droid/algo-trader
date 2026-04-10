/**
 * SORManager — api-server orchestrator for the Smart Order Router.
 *
 * Owns all side-effecting work:
 *   • Coordinate the adapters, router, aggregator, and risk checks
 *   • Execute fills across exchanges in parallel
 *   • Persist execution records to the ledger (sor_executions)
 *   • Publish COPY_TRADE_EXECUTED events for downstream consumers
 */

import { db } from "@workspace/db";
import { sorExecutionsTable } from "@workspace/db";
import { logger } from "./logger.js";

import {
  binanceAdapter,
  bybitAdapter,
  aggregateOrderBooks,
  routeOrder,
  singleVenueVWAP,
  aggregateFills,
  computeSavings,
  computeSlippageBps,
  runPreTradeChecks,
  type AggregatedOrderBook,
  type RoutedFill,
  type AggregatedFill,
} from "../../../../services/sor/src/index.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface SORQuoteRequest {
  symbol:           string;
  side:             "BUY" | "SELL";
  size:             number;
  /** Maximum slippage tolerated in bps (default: 50). */
  maxSlippageBps?:  number;
  /** Maximum fraction of book depth this order can consume (default: 0.30). */
  maxMarketImpact?: number;
}

export interface SORQuote {
  symbol:           string;
  side:             "BUY" | "SELL";
  requestedSize:    number;
  fills:            RoutedFill[];
  avgPrice:         number;
  unfilled:         number;
  referencePrice:   number;
  estimatedSlippageBps: number;
  priceImprovement: number;
  venueAllocation:  Record<string, number>;
  /** Quote expires after this many ms */
  validForMs:       number;
}

export interface SORExecuteRequest extends SORQuoteRequest {
  userId: string;
  /** Allow partial fills (default: false). */
  allowPartial?: boolean;
}

export interface SORExecuteResult {
  executionId:    string;
  status:         "EXECUTED" | "PARTIAL" | "REJECTED";
  rejectionReason?: string;
  aggregated?:    AggregatedFill;
  estimatedSavings?: number;
  slippageBps?:   number;
  referencePrice?: number;
}

/* ── Active adapters ──────────────────────────────────────────────────────── */

const ADAPTERS = [binanceAdapter, bybitAdapter];

/* ── SORManager ───────────────────────────────────────────────────────────── */

export class SORManager {
  /**
   * Get a routing quote WITHOUT executing any trades.
   * Returns the routing plan, estimated avg price, slippage, and venue split.
   */
  async quote(req: SORQuoteRequest): Promise<SORQuote> {
    const orderBook = await aggregateOrderBooks(req.symbol, ADAPTERS);

    const routing = routeOrder(
      { size: req.size, side: req.side },
      orderBook,
      req.maxSlippageBps ?? 50
    );

    const slipBps = computeSlippageBps(routing.avgPrice, orderBook.midPrice);

    return {
      symbol:               req.symbol,
      side:                 req.side,
      requestedSize:        req.size,
      fills:                routing.fills,
      avgPrice:             routing.avgPrice,
      unfilled:             routing.unfilled,
      referencePrice:       orderBook.midPrice,
      estimatedSlippageBps: slipBps,
      priceImprovement:     routing.priceImprovement,
      venueAllocation:      routing.venueAllocation,
      validForMs:           3_000,   // quote valid for 3 seconds
    };
  }

  /**
   * Execute an order via the SOR pipeline:
   *   1. Pre-trade risk checks
   *   2. Get aggregated order book
   *   3. Route across venues
   *   4. Execute fills in parallel
   *   5. Aggregate results
   *   6. Record to ledger
   */
  async execute(req: SORExecuteRequest): Promise<SORExecuteResult> {
    const executionId = crypto.randomUUID();

    /* ── Step 1: fetch consolidated order book ─────────────────────────── */
    let orderBook: AggregatedOrderBook;
    try {
      orderBook = await aggregateOrderBooks(req.symbol, ADAPTERS);
    } catch (err) {
      const reason = `Failed to fetch order books: ${err instanceof Error ? err.message : String(err)}`;
      await this.recordRejection(executionId, req, reason);
      return { executionId, status: "REJECTED", rejectionReason: reason };
    }

    /* ── Step 2: pre-trade risk checks ────────────────────────────────── */
    const riskCheck = runPreTradeChecks({
      symbol:          req.symbol,
      side:            req.side,
      size:            req.size,
      quoteBalance:    1_000_000,    // paper mode: large simulated balance
      orderBook,
      maxSlippageBps:  req.maxSlippageBps  ?? 50,
      maxMarketImpact: req.maxMarketImpact ?? 0.30,
    });

    if (!riskCheck.passed) {
      logger.warn({ executionId, reason: riskCheck.reason }, "SOR pre-trade check failed");
      await this.recordRejection(executionId, req, riskCheck.reason!);
      return { executionId, status: "REJECTED", rejectionReason: riskCheck.reason };
    }

    /* ── Step 3: route order across venues ────────────────────────────── */
    const routing = routeOrder(
      { size: req.size, side: req.side },
      orderBook,
      req.maxSlippageBps ?? 50
    );

    if (routing.fills.length === 0) {
      const reason = "No executable fills — insufficient liquidity within slippage limit";
      await this.recordRejection(executionId, req, reason);
      return { executionId, status: "REJECTED", rejectionReason: reason };
    }

    if (!req.allowPartial && routing.unfilled > 0) {
      const reason = `Cannot fully fill order: unfilled ${routing.unfilled.toFixed(6)} of ${req.size}`;
      await this.recordRejection(executionId, req, reason);
      return { executionId, status: "REJECTED", rejectionReason: reason };
    }

    /* ── Step 4: execute fills in parallel ────────────────────────────── */
    const adapterMap = Object.fromEntries(ADAPTERS.map((a) => [a.name, a]));

    const execResults = await Promise.all(
      routing.fills.map((fill) => {
        const adapter = adapterMap[fill.exchange];
        if (!adapter) return Promise.resolve(null);
        return adapter
          .placeOrder({ symbol: req.symbol, side: req.side, type: "MARKET", size: fill.size })
          .catch((err) => {
            logger.error({ err, exchange: fill.exchange }, "Exchange execution error");
            return null;
          });
      })
    );

    const validResults = execResults.filter((r) => r !== null);

    /* ── Step 5: aggregate fills ──────────────────────────────────────── */
    const aggregated = aggregateFills(validResults, req.size);

    /* ── Step 6: compute metrics ──────────────────────────────────────── */
    const referencePrice = orderBook.midPrice;
    const slippageBps    = computeSlippageBps(aggregated.avgPrice, referencePrice);

    // Single-venue baseline: what would it cost to fill on the best single exchange?
    const sideBook      = req.side === "BUY" ? orderBook.asks : orderBook.bids;
    const singleVWAP    = singleVenueVWAP(req.size, sideBook);
    const estimatedSavings = computeSavings(aggregated.avgPrice, singleVWAP, aggregated.filledSize, req.side);

    /* ── Step 7: record to ledger ─────────────────────────────────────── */
    const finalStatus = aggregated.status === "FAILED" ? "REJECTED" :
                        aggregated.status === "PARTIAL" ? "PARTIAL"  : "EXECUTED";

    await db.insert(sorExecutionsTable).values({
      id:               executionId,
      userId:           req.userId,
      symbol:           req.symbol,
      side:             req.side,
      requestedSize:    req.size,
      filledSize:       aggregated.filledSize,
      avgPrice:         aggregated.avgPrice || null,
      referencePrice:   referencePrice || null,
      slippageBps:      slippageBps || null,
      estimatedSavings: estimatedSavings,
      fills:            JSON.stringify(aggregated.fills),
      status:           finalStatus,
      rejectionReason:  aggregated.errors.length > 0 ? aggregated.errors.join("; ") : null,
    });

    logger.info(
      {
        executionId,
        symbol:    req.symbol,
        side:      req.side,
        size:      req.size,
        filled:    aggregated.filledSize,
        avgPrice:  aggregated.avgPrice,
        slippageBps,
        estimatedSavings,
        venues:    Object.keys(aggregated.byExchange),
      },
      "SOR execution complete"
    );

    return {
      executionId,
      status: finalStatus,
      aggregated,
      estimatedSavings,
      slippageBps,
      referencePrice,
    };
  }

  /** Fetch execution history for a user. */
  async history(userId: string, limit = 50) {
    const rows = await db
      .select()
      .from(sorExecutionsTable);
    return rows
      .filter((r) => r.userId === userId)
      .sort((a, b) => +new Date(b.executedAt) - +new Date(a.executedAt))
      .slice(0, limit)
      .map((r) => ({
        ...r,
        fills: JSON.parse(r.fills || "[]"),
      }));
  }

  /* ── Private helpers ──────────────────────────────────────────────────── */

  private async recordRejection(
    id:     string,
    req:    SORExecuteRequest,
    reason: string
  ): Promise<void> {
    await db.insert(sorExecutionsTable).values({
      id,
      userId:          req.userId,
      symbol:          req.symbol,
      side:            req.side,
      requestedSize:   req.size,
      filledSize:      0,
      fills:           "[]",
      status:          "REJECTED",
      rejectionReason: reason,
    }).catch((err) => logger.error({ err }, "Failed to record SOR rejection"));
  }
}

export const sorManager = new SORManager();
