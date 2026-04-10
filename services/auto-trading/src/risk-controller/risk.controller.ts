import type { LiveSignal, AutoSession, RiskState, RiskResult, OpenPosition } from "../types.js";
import { getSLTP } from "../engine/risk-manager.js";

/**
 * RiskController
 *
 * Validates a LiveSignal against the session's risk rules.
 * All state (balance, position, throttle, daily loss) is passed in as
 * `RiskState` — the controller itself is stateless so it can be unit-tested
 * without DB mocks.
 *
 * Risk checks (in order — first failure short-circuits):
 *
 *   1. POSITION CONFLICT
 *      BUY  when already long  → reject (no pyramiding)
 *      SELL when already flat  → reject (nothing to close)
 *
 *   2. THROTTLE
 *      More than maxTradesPerMinute executions in the last 60 s → reject.
 *
 *   3. DAILY LOSS
 *      Cumulative net daily loss ≥ maxDailyLoss → reject + signal caller to disable.
 *
 *   4. BALANCE (BUY only)
 *      Available balance < minimum order value → reject.
 *
 *   5. POSITION SIZE — cap to maxPositionSize.
 *
 *   6. SL / TP — compute absolute price levels via RiskManager.getSLTP().
 *      Attached to RiskResult so the orchestrator can store them on
 *      the open position for the PositionWatcher to monitor.
 */
export class RiskController {

  validate(signal: LiveSignal, state: RiskState, session: AutoSession): RiskResult {

    // ── 1. Position conflict ───────────────────────────────────────────────
    if (signal.type === "BUY" && state.openPosition !== null) {
      return { allowed: false, reason: "Already in a long position — no pyramiding" };
    }

    if (signal.type === "SELL" && state.openPosition === null) {
      return { allowed: false, reason: "No open position to sell" };
    }

    // ── 2. Throttle ────────────────────────────────────────────────────────
    if (state.recentTradeCount >= session.maxTradesPerMinute) {
      return {
        allowed: false,
        reason: `Throttle: ${state.recentTradeCount}/${session.maxTradesPerMinute} trades in last 60 s`,
      };
    }

    // ── 3. Daily loss circuit-breaker ──────────────────────────────────────
    if (state.dailyLoss >= session.maxDailyLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit reached: $${state.dailyLoss.toFixed(2)} ≥ $${session.maxDailyLoss}`,
      };
    }

    // ── 4 & 5. Balance + position sizing (BUY only) ────────────────────────
    if (signal.type === "BUY") {
      if (state.balance <= 0) {
        return { allowed: false, reason: "Insufficient balance" };
      }

      // Compute risk-adjusted size
      const rawSize = (state.balance * session.riskPercent) / signal.price;
      const size    = Math.min(rawSize, session.maxPositionSize);

      if (size <= 0) {
        return { allowed: false, reason: "Computed size is zero" };
      }

      // ── 6. SL / TP levels ───────────────────────────────────────────────
      const { stopLoss, takeProfit } = getSLTP(signal.price, "BUY", {
        stopLossPercent:   session.stopLossPercent,
        takeProfitPercent: session.takeProfitPercent,
      });

      return { allowed: true, size, stopLoss, takeProfit };
    }

    // ── SELL — use the open position size (no SL/TP needed on exit) ────────
    const pos = state.openPosition as OpenPosition;
    return { allowed: true, size: pos.size };
  }
}
