import type { Candle, Signal } from "../../strategy-engine/src/strategies/strategy.interface.js";
export type { Candle, Signal };

/* ── Session ──────────────────────────────────────────────────────────────── */

/**
 * An AutoSession is the user's configuration for one running strategy.
 * Loaded from `auto_trading_sessions` DB row.
 * The manager holds one SessionState per active session.
 */
export interface AutoSession {
  id:             string;
  userId:         string;
  strategyId:     string;
  strategyParams: Record<string, unknown>;
  symbol:         string;
  interval:       string;
  /** "paper" → simulate locally; "live" → call Binance API */
  mode:           "paper" | "live";
  /** Fraction of balance to risk per trade (e.g. 0.02 = 2%). */
  riskPercent:    number;
  /** Maximum position size in base asset units (hard cap). */
  maxPositionSize: number;
  /** Max executions per 60-second window. */
  maxTradesPerMinute: number;
  /** Auto-disable the session when net daily loss exceeds this in dollars. */
  maxDailyLoss:   number;
  /** Stop-loss distance from entry as a fraction (e.g. 0.01 = 1%). */
  stopLossPercent:   number;
  /** Take-profit distance from entry as a fraction (e.g. 0.02 = 2%). */
  takeProfitPercent: number;
  enabled:        boolean;
}

/* ── Signal (enriched) ────────────────────────────────────────────────────── */

/**
 * A LiveSignal is a raw strategy Signal enriched with context from the candle
 * that triggered it.  Passed through the risk gate before execution.
 */
export interface LiveSignal extends Signal {
  timestamp:  number;
  symbol:     string;
  interval:   string;
  /** Close price of the candle that produced this signal. */
  price:      number;
  sessionId:  string;
  userId:     string;
}

/* ── Open position ────────────────────────────────────────────────────────── */

/**
 * Tracks a BUY that hasn't been closed by a SELL yet.
 * Kept in-memory per session; rehydrated from DB on restart.
 *
 * stopLoss and takeProfit are absolute price levels derived from the
 * session's stopLossPercent / takeProfitPercent at the moment of entry.
 * PositionWatcher reads these to auto-close the position.
 */
export interface OpenPosition {
  entryTime:  number;
  entryPrice: number;
  size:       number;
  /** Absolute stop-loss price level (close position if price drops to here). */
  stopLoss?:   number;
  /** Absolute take-profit price level (close position if price rises to here). */
  takeProfit?: number;
}

/* ── Risk ─────────────────────────────────────────────────────────────────── */

export interface RiskState {
  balance:           number;
  openPosition:      OpenPosition | null;
  /** Number of trades executed in the current 60-second window. */
  recentTradeCount:  number;
  /** Net loss so far today (always ≥ 0; increases on losing trades). */
  dailyLoss:         number;
}

export interface RiskResult {
  allowed:   boolean;
  reason?:   string;
  /** Approved position size in base asset units. */
  size?:     number;
  /** Absolute stop-loss price level (set on BUY approvals). */
  stopLoss?:   number;
  /** Absolute take-profit price level (set on BUY approvals). */
  takeProfit?: number;
}

/* ── Execution ────────────────────────────────────────────────────────────── */

export interface ExecutionResult {
  status:    "EXECUTED" | "FAILED";
  tradeId?:  string;
  pnl?:      number;
  price:     number;
  size:      number;
  error?:    string;
}

/* ── Auto trade log ───────────────────────────────────────────────────────── */

export interface AutoTradeRecord {
  sessionId:     string;
  userId:        string;
  signal:        "BUY" | "SELL";
  size:          number;
  entryPrice?:   number;
  exitPrice?:    number;
  pnl?:          number;
  stopLoss?:     number;
  takeProfit?:   number;
  closeReason?:  string;
  status:        "EXECUTED" | "BLOCKED" | "FAILED";
  blockedReason?: string;
}
