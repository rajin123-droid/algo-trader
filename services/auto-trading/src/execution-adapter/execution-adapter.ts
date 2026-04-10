import type { LiveSignal, AutoSession, OpenPosition, ExecutionResult } from "../types.js";

/* ── Adapter interfaces (injected by the api-server) ─────────────────────── */

/**
 * PaperExecutor — called by ExecutionAdapter in paper mode.
 *
 * The api-server supplies the concrete implementation so the execution
 * adapter itself stays free of DB imports.
 *
 * BUY  → open position, log to auto_trades (status: EXECUTED, no pnl yet)
 * SELL → close position, compute P&L, log to auto_trades with pnl
 */
export interface PaperExecutor {
  openPosition(
    signal:  LiveSignal,
    size:    number,
    sltp?:   { stopLoss?: number; takeProfit?: number },
  ): Promise<string>;

  closePosition(
    signal:       LiveSignal,
    openPos:      OpenPosition,
    closeReason?: string,
  ): Promise<{ pnl: number; tradeId: string }>;
}

/**
 * LiveExecutor — called in live mode.
 *
 * Sends a real MARKET order to Binance (or another exchange).
 * Implementation lives in the api-server (wraps the existing Binance adapter).
 */
export interface LiveExecutor {
  placeMarketOrder(params: {
    userId:  string;
    symbol:  string;
    side:    "BUY" | "SELL";
    quantity: number;
  }): Promise<{ orderId: string; price: number; filledQty: number }>;
}

/* ── ExecutionAdapter ─────────────────────────────────────────────────────── */

/**
 * ExecutionAdapter
 *
 * Bridges the approved signal → actual trade execution.
 *
 * Mode routing:
 *   paper → PaperExecutor (fully simulated, no exchange calls)
 *   live  → LiveExecutor  (real Binance MARKET order)
 *
 * The adapter is intentionally thin — it doesn't compute P&L or modify
 * state; those responsibilities belong to the manager that wraps it.
 */
export class ExecutionAdapter {
  constructor(
    private readonly session: AutoSession,
    readonly paperExecutor: PaperExecutor,
    private readonly liveExecutor?: LiveExecutor,
  ) {}

  async execute(
    signal:       LiveSignal,
    size:         number,
    openPosition: OpenPosition | null,
    sltp?:        { stopLoss?: number; takeProfit?: number },
    closeReason?: string,
  ): Promise<ExecutionResult> {
    if (this.session.mode === "live" && this.liveExecutor) {
      return this.executeLive(signal, size);
    }

    return this.executePaper(signal, size, openPosition, sltp, closeReason);
  }

  /* ── Paper ─────────────────────────────────────────────────────────────── */

  private async executePaper(
    signal:       LiveSignal,
    size:         number,
    openPosition: OpenPosition | null,
    sltp?:        { stopLoss?: number; takeProfit?: number },
    closeReason?: string,
  ): Promise<ExecutionResult> {
    try {
      if (signal.type === "BUY") {
        const tradeId = await this.paperExecutor.openPosition(signal, size, sltp);
        return { status: "EXECUTED", tradeId, price: signal.price, size };
      }

      if (!openPosition) {
        return { status: "FAILED", price: signal.price, size: 0, error: "No open position" };
      }

      const { pnl, tradeId } = await this.paperExecutor.closePosition(signal, openPosition, closeReason);
      return { status: "EXECUTED", tradeId, pnl, price: signal.price, size: openPosition.size };
    } catch (err) {
      return {
        status: "FAILED",
        price: signal.price,
        size,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /* ── Live ──────────────────────────────────────────────────────────────── */

  private async executeLive(signal: LiveSignal, size: number): Promise<ExecutionResult> {
    if (!this.liveExecutor) {
      return { status: "FAILED", price: signal.price, size, error: "No live executor configured" };
    }

    try {
      const fill = await this.liveExecutor.placeMarketOrder({
        userId:   this.session.userId,
        symbol:   this.session.symbol,
        side:     signal.type,
        quantity: size,
      });

      return {
        status:  "EXECUTED",
        tradeId: fill.orderId,
        price:   fill.price,
        size:    fill.filledQty,
      };
    } catch (err) {
      return {
        status: "FAILED",
        price:  signal.price,
        size,
        error:  err instanceof Error ? err.message : String(err),
      };
    }
  }
}
