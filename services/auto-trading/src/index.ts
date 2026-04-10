/**
 * @workspace/auto-trading
 *
 * Pure domain logic for live automated trading sessions.
 * No DB, no Redis, no HTTP — those live in the api-server adapter layer.
 *
 * Public surface:
 *
 *   LiveStrategyRunner  — tags strategy signals with session context
 *   SignalProcessor     — stateless structural validation
 *   RiskController      — validates against position/throttle/loss rules
 *   ExecutionAdapter    — routes to paper or live executor
 *   AutoTradingEngine   — orchestrates the full pipeline per-session
 *   PositionWatcher     — monitors SL/TP levels, forces exits in real-time
 *
 *   RiskManager         — pure position-sizing / SL-TP utilities
 *     calculatePositionSize, validateTrade, getSLTP, RiskConfig
 *
 * Types:
 *   AutoSession, LiveSignal, OpenPosition, RiskState, RiskResult,
 *   ExecutionResult, AutoTradeRecord, Candle, Signal
 */

export type {
  AutoSession,
  LiveSignal,
  OpenPosition,
  RiskState,
  RiskResult,
  ExecutionResult,
  AutoTradeRecord,
  Candle,
  Signal,
} from "./types.js";

export { LiveStrategyRunner }  from "./live-runner.js";
export { SignalProcessor, validateSignal } from "./signal-processor/signal.processor.js";
export { RiskController }      from "./risk-controller/risk.controller.js";
export { ExecutionAdapter }    from "./execution-adapter/execution-adapter.js";
export type { PaperExecutor, LiveExecutor } from "./execution-adapter/execution-adapter.js";
export { AutoTradingEngine }   from "./orchestrator.js";
export type { OrchestratorState, CandleOutcome } from "./orchestrator.js";

export { PositionWatcher }     from "./engine/position-watcher.js";
export type { SLTPCloseEvent, SLTPCloseReason } from "./engine/position-watcher.js";

export {
  calculatePositionSize,
  validateTrade,
  getSLTP,
} from "./engine/risk-manager.js";
export type { RiskConfig } from "./engine/risk-manager.js";
