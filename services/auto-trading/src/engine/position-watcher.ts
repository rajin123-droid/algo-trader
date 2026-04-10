/**
 * PositionWatcher
 *
 * Monitors all active AutoTradingEngine instances for Stop-Loss (SL) and
 * Take-Profit (TP) triggers.  Runs on a 1-second polling interval — much
 * faster than the 10-second candle pump — so forced exits happen in near
 * real-time after the SL/TP price level is breached.
 *
 * Architecture:
 *   - Holds a live reference to the engines registry from AutoTradingManager.
 *   - On each tick reads the current price from the supplied `getPrice` fn
 *     (backed by PriceSimulator in paper mode, live feed in live mode).
 *   - When a level is hit, calls engine.closeSLTP() which executes the SELL
 *     through the paper/live executor and updates in-memory state.
 *   - Invokes the `onClose` callback so the manager can:
 *       • Write the DB trade record with closeReason ("STOP_LOSS"/"TAKE_PROFIT")
 *       • Push a WebSocket notification to the user
 *       • Update portfolio balance
 *
 * Long position trigger logic:
 *   stopLoss   → currentPrice ≤ pos.stopLoss
 *   takeProfit → currentPrice ≥ pos.takeProfit
 *
 * Short positions are not currently supported (paper engine is long-only).
 */

import type { AutoTradingEngine } from "../orchestrator.js";

export type SLTPCloseReason = "STOP_LOSS" | "TAKE_PROFIT";

export interface SLTPCloseEvent {
  sessionId:   string;
  engine:      AutoTradingEngine;
  size:        number;
  exitPrice:   number;
  pnl:         number;
  closeReason: SLTPCloseReason;
}

export class PositionWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    /** Live reference to the sessions registry (reads openPosition per engine). */
    private readonly getSessions: () => ReadonlyMap<string, { engine: AutoTradingEngine }>,
    /** Returns the current market price for the given symbol. */
    private readonly getPrice: (symbol: string) => number,
    /** Called immediately after a forced SL/TP close completes. */
    private readonly onClose: (event: SLTPCloseEvent) => Promise<void>,
    /** Polling interval in milliseconds (default: 1 000 ms). */
    private readonly intervalMs: number = 1_000,
  ) {}

  /** Start the watcher loop. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
  }

  /** Stop the watcher loop (e.g. on graceful shutdown). */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const sessions = this.getSessions();

    for (const [sessionId, { engine }] of sessions) {
      const pos = engine.state.openPosition;

      // Nothing to watch
      if (!pos || (pos.stopLoss === undefined && pos.takeProfit === undefined)) continue;

      const price = this.getPrice(engine.session.symbol);
      if (!price || price <= 0) continue;

      let reason: SLTPCloseReason | null = null;

      // Long position SL/TP — check stop-loss first (higher urgency)
      if (pos.stopLoss !== undefined && price <= pos.stopLoss) {
        reason = "STOP_LOSS";
      } else if (pos.takeProfit !== undefined && price >= pos.takeProfit) {
        reason = "TAKE_PROFIT";
      }

      if (!reason) continue;

      // Attempt forced close — engine guards against double-execution
      const result = await engine.closeSLTP(price, reason).catch(() => null);
      if (!result) continue;

      // Notify the manager (DB write + WS push)
      await this.onClose({
        sessionId,
        engine,
        size:        result.size,
        exitPrice:   price,
        pnl:         result.pnl,
        closeReason: reason,
      }).catch(() => {/* manager logs its own errors */});
    }
  }
}
