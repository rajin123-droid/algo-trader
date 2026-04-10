import type { AutoSession, LiveSignal, RiskState, OpenPosition, Candle } from "./types.js";
import { LiveStrategyRunner } from "./live-runner.js";
import { SignalProcessor } from "./signal-processor/signal.processor.js";
import { RiskController } from "./risk-controller/risk.controller.js";
import { ExecutionAdapter } from "./execution-adapter/execution-adapter.js";

/* ── Result of processing one candle ─────────────────────────────────────── */

export type CandleOutcome =
  | { outcome: "no_signal" }
  | { outcome: "invalid_signal";   reason: string }
  | { outcome: "risk_rejected";    reason: string; signal: LiveSignal }
  | { outcome: "executed";         signal: LiveSignal; size: number; pnl?: number;
      stopLoss?: number; takeProfit?: number; closeReason?: string }
  | { outcome: "execution_failed"; signal: LiveSignal; error: string };

/* ── State managed by the Orchestrator ───────────────────────────────────── */

export interface OrchestratorState {
  balance:          number;
  openPosition:     OpenPosition | null;
  recentTradeCount: number;
  dailyLoss:        number;
}

/* ── AutoTradingEngine (Orchestrator) ────────────────────────────────────── */

/**
 * AutoTradingEngine
 *
 * The single coordination point for one active session.
 * Wires together: LiveStrategyRunner → SignalProcessor → RiskController → ExecutionAdapter
 *
 * The engine itself holds session state (balance, open position, throttle,
 * daily loss).  The outer manager is responsible for persisting state changes
 * to the DB after each `onCandle()` call.
 *
 * Concurrency:
 *   `onCandle()` is guarded by `processing` flag — if a previous candle is
 *   still being executed (e.g. slow Binance API call), the next candle is
 *   skipped rather than queued.  This prevents stacking orders.
 */
export class AutoTradingEngine {
  private processing = false;

  readonly runner:    LiveStrategyRunner;
  readonly processor: SignalProcessor;
  readonly risk:      RiskController;
  readonly executor:  ExecutionAdapter;

  /** Mutable session state — updated after each execution. */
  state: OrchestratorState;

  constructor(
    readonly session: AutoSession,
    runner:    LiveStrategyRunner,
    processor: SignalProcessor,
    risk:      RiskController,
    executor:  ExecutionAdapter,
    initialState: Partial<OrchestratorState> = {},
  ) {
    this.runner    = runner;
    this.processor = processor;
    this.risk      = risk;
    this.executor  = executor;

    this.state = {
      balance:          initialState.balance          ?? 10_000,
      openPosition:     initialState.openPosition     ?? null,
      recentTradeCount: initialState.recentTradeCount ?? 0,
      dailyLoss:        initialState.dailyLoss        ?? 0,
    };
  }

  /**
   * Process one inbound candle.
   *
   * Returns a CandleOutcome describing exactly what happened (or why nothing did).
   * The manager uses this to decide which DB writes to perform.
   */
  async onCandle(
    candle: Candle & { symbol: string; interval: string }
  ): Promise<CandleOutcome> {
    if (this.processing) return { outcome: "no_signal" };
    this.processing = true;

    try {
      // ── 1. Strategy ──────────────────────────────────────────────────────
      const signal = this.runner.onCandle(candle);
      if (!signal) return { outcome: "no_signal" };

      // ── 2. Structural validation ──────────────────────────────────────────
      const validation = this.processor.process(signal);
      if (!validation.valid) {
        return { outcome: "invalid_signal", reason: validation.reason! };
      }

      // ── 3. Risk ───────────────────────────────────────────────────────────
      const riskState: RiskState = {
        balance:          this.state.balance,
        openPosition:     this.state.openPosition,
        recentTradeCount: this.state.recentTradeCount,
        dailyLoss:        this.state.dailyLoss,
      };

      const risk = this.risk.validate(signal, riskState, this.session);
      if (!risk.allowed) {
        return { outcome: "risk_rejected", reason: risk.reason!, signal };
      }

      const approvedSize = risk.size!;

      // ── 4. Execute ────────────────────────────────────────────────────────
      const sltp = signal.type === "BUY"
        ? { stopLoss: risk.stopLoss, takeProfit: risk.takeProfit }
        : undefined;

      const result = await this.executor.execute(
        signal,
        approvedSize,
        this.state.openPosition,
        sltp,
        "SIGNAL",
      );

      if (result.status === "FAILED") {
        return { outcome: "execution_failed", signal, error: result.error ?? "Unknown" };
      }

      // ── 5. Update state ───────────────────────────────────────────────────
      this.state.recentTradeCount++;

      if (signal.type === "BUY") {
        this.state.openPosition = {
          entryTime:  signal.timestamp,
          entryPrice: result.price,
          size:       result.size,
          stopLoss:   risk.stopLoss,
          takeProfit: risk.takeProfit,
        };
        this.state.balance -= result.price * result.size;
      } else {
        const pnl = result.pnl ?? 0;
        this.state.balance      += (result.price * this.state.openPosition!.size) + pnl;
        this.state.openPosition  = null;
        if (pnl < 0) this.state.dailyLoss += Math.abs(pnl);
      }

      return {
        outcome:    "executed",
        signal,
        size:       result.size,
        pnl:        result.pnl,
        stopLoss:   risk.stopLoss,
        takeProfit: risk.takeProfit,
        closeReason: "SIGNAL",
      };
    } finally {
      this.processing = false;
    }
  }

  /**
   * Force-close the current open position at the given price.
   *
   * Called by PositionWatcher when a Stop-Loss or Take-Profit level is hit.
   * Bypasses the strategy and risk layers — this is a mandatory exit.
   *
   * @returns Execution summary, or null if there is no open position or the
   *          engine is currently processing another candle.
   */
  async closeSLTP(
    exitPrice:   number,
    closeReason: "STOP_LOSS" | "TAKE_PROFIT",
  ): Promise<{ size: number; pnl: number } | null> {
    if (this.processing || !this.state.openPosition) return null;
    this.processing = true;

    try {
      const openPos = this.state.openPosition;

      // Synthesise a SELL signal at the current market price
      const syntheticSignal: LiveSignal = {
        type:      "SELL",
        size:      openPos.size,
        timestamp: Date.now(),
        symbol:    this.session.symbol,
        interval:  this.session.interval,
        price:     exitPrice,
        sessionId: this.session.id,
        userId:    this.session.userId,
      };

      const result = await this.executor.execute(
        syntheticSignal,
        openPos.size,
        openPos,
        undefined,
        closeReason,
      );

      if (result.status === "FAILED") return null;

      // Update state
      const pnl = result.pnl ?? 0;
      this.state.balance      += (exitPrice * openPos.size) + pnl;
      this.state.openPosition  = null;
      if (pnl < 0) this.state.dailyLoss += Math.abs(pnl);

      return { size: openPos.size, pnl };
    } finally {
      this.processing = false;
    }
  }

  /** Called by the manager every 60 s to reset the throttle counter. */
  resetThrottle(): void {
    this.state.recentTradeCount = 0;
  }

  /** Called at midnight to reset the daily loss counter. */
  resetDailyLoss(): void {
    this.state.dailyLoss = 0;
  }
}
