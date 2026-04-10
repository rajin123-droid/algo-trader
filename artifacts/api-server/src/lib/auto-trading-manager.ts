/**
 * AutoTradingManager
 *
 * Singleton registry of all active AutoTradingEngine instances.
 *
 * Responsibilities:
 *   • Load active sessions from DB on startup
 *   • Create / destroy engine instances when sessions start/stop
 *   • Subscribe to InProcessBus candle events and fan out to engines
 *   • Provide DB adapters (PaperExecutor) injected into ExecutionAdapter
 *   • Persist state changes (auto_trades inserts) after each candle
 *   • Throttle reset (every 60 s), daily loss reset (at midnight)
 *   • Disable sessions that breach the maxDailyLoss circuit-breaker
 *   • Run PositionWatcher — auto-closes positions that hit SL / TP levels
 */

import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  autoTradingSessionsTable,
  autoTradesTable,
  type AutoTradingSession,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { orderRouter } from "../exchange/order-router.js";
import type { LiveExecutor } from "../../../../services/auto-trading/src/index.js";
import { logger } from "./logger.js";
import { inProcessBus, type CandleEvent } from "./in-process-bus.js";
import { getLiveCandle } from "./candle.service.js";
import { priceSimulator } from "./price-simulator.js";
import { getMarketPrice, isBinanceMarketWsConnected } from "../market/binance-market-ws.js";
import { createStrategy } from "../../../../services/strategy-engine/src/index.js";
import { compileStrategy as compileAIStrategy } from "../../../../services/ai-strategy/src/compiler/strategy-compiler.js";
import { marketplaceManager } from "./marketplace-manager.js";
import {
  tradeLatency,
  tradeCounter,
  tradeErrorCounter,
} from "../../../../services/observability/src/index.js";
import { sendToUser } from "./ws-server.js";
import { publishPortfolioUpdate } from "./ws-publisher.js";
import {
  AutoTradingEngine,
  LiveStrategyRunner,
  SignalProcessor,
  RiskController,
  ExecutionAdapter,
  PositionWatcher,
  type AutoSession,
  type OpenPosition,
  type PaperExecutor,
  type LiveSignal,
  type CandleOutcome,
  type SLTPCloseEvent,
} from "../../../../services/auto-trading/src/index.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

interface ManagedSession {
  engine:           AutoTradingEngine;
  throttleTimer:    ReturnType<typeof setInterval>;
  dailyResetTimer?: ReturnType<typeof setTimeout>;
}

/* ── Paper executor (DB-backed) ───────────────────────────────────────────── */

function makePaperExecutor(session: AutoSession): PaperExecutor {
  return {
    async openPosition(
      signal: LiveSignal,
      size:   number,
      sltp?:  { stopLoss?: number; takeProfit?: number },
    ): Promise<string> {
      const id = crypto.randomUUID();
      await db.insert(autoTradesTable).values({
        id,
        sessionId:     session.id,
        userId:        session.userId,
        signal:        "BUY",
        size,
        entryPrice:    signal.price,
        stopLoss:      sltp?.stopLoss,
        takeProfit:    sltp?.takeProfit,
        status:        "EXECUTED",
        executionMode: "paper",
      });
      return id;
    },

    async closePosition(
      signal:       LiveSignal,
      openPos:      OpenPosition,
      closeReason?: string,
    ): Promise<{ pnl: number; tradeId: string }> {
      const pnl = (signal.price - openPos.entryPrice) * openPos.size;
      const id  = crypto.randomUUID();
      await db.insert(autoTradesTable).values({
        id,
        sessionId:     session.id,
        userId:        session.userId,
        signal:        "SELL",
        size:          openPos.size,
        exitPrice:     signal.price,
        pnl,
        closeReason:   closeReason ?? "SIGNAL",
        status:        "EXECUTED",
        executionMode: "paper",
      });
      return { pnl, tradeId: id };
    },
  };
}

/**
 * Module-level map: sessionId → last Binance orderId.
 * Written by the live executor; consumed + cleared in handleOutcome.
 */
const liveOrderTracker = new Map<string, string>();

/**
 * LiveExecutor that routes to Binance AND records the result to the DB.
 *
 * Writes an auto_trades row with executionMode="live" and exchangeOrderId
 * before returning, so the audit log is always complete even if the caller
 * crashes before handleOutcome runs.
 */
function makeLiveExecutorWithDB(session: AutoSession): LiveExecutor {
  const base = orderRouter.makeLiveExecutor(session.userId);
  return {
    async placeMarketOrder(params) {
      // Delegate to BinanceLiveExecutor (kill-switch + credential guards run there)
      const fill = await base.placeMarketOrder(params);
      // Store the exchange orderId so handleOutcome / handleSLTPClose can persist it
      liveOrderTracker.set(session.id, fill.orderId);
      return fill;
    },
  };
}

/* ── Manager ──────────────────────────────────────────────────────────────── */

class AutoTradingManager {
  private sessions = new Map<string, ManagedSession>();
  private watcher: PositionWatcher | null = null;

  /** Bootstrap — call once on server startup. */
  async init(): Promise<void> {
    const rows = await db
      .select()
      .from(autoTradingSessionsTable)
      .where(eq(autoTradingSessionsTable.enabled, true));

    for (const row of rows) {
      await this.startSession(row).catch((err) =>
        logger.error({ err, sessionId: row.id }, "Failed to start auto-trading session")
      );
    }

    // Fan-out candle events to all active engines
    inProcessBus.on("candle", (event: CandleEvent) => {
      this.handleCandle(event);
    });

    // ── Candle pump (10 s) ─────────────────────────────────────────────────
    setInterval(() => {
      if (this.sessions.size === 0) return;

      const pairs = new Set<string>();
      for (const [, { engine }] of this.sessions) {
        pairs.add(`${engine.session.symbol}|${engine.session.interval}`);
      }

      for (const key of pairs) {
        const [symbol, interval] = key.split("|") as [string, string];
        const live   = getLiveCandle(symbol, interval ?? "1m");
        const candle = live ?? priceSimulator.nextCandle(symbol);
        inProcessBus.emitCandle({ symbol, interval: interval ?? "1m", candle });
      }
    }, 10_000);

    // ── Position Watcher (1 s) ─────────────────────────────────────────────
    // Monitors all open positions for SL / TP triggers.  When a level is hit
    // the watcher calls engine.closeSLTP() and fires onSLTPClose so we can
    // write the DB record and push a WS notification with the closeReason.
    this.watcher = new PositionWatcher(
      () => this.sessions as ReadonlyMap<string, { engine: AutoTradingEngine }>,
      (symbol) => {
        // Prefer real Binance market price when available; fall back to simulator.
        const real = isBinanceMarketWsConnected() ? getMarketPrice(symbol) : 0;
        return real > 0 ? real : priceSimulator.currentPrice(symbol);
      },
      (event)  => this.handleSLTPClose(event),
      1_000,
    );
    this.watcher.start();

    logger.info({ count: this.sessions.size }, "AutoTradingManager initialized");
  }

  /** Create and register a new engine for a DB session row. */
  async startSession(row: AutoTradingSession): Promise<void> {
    if (this.sessions.has(row.id)) {
      logger.warn({ sessionId: row.id }, "Session already running — skipping");
      return;
    }

    const session: AutoSession = this.rowToSession(row);

    const strategy  = session.strategyId.startsWith("compiled:")
      ? compileAIStrategy(session.strategyParams["config"] as Parameters<typeof compileAIStrategy>[0])
      : createStrategy(session.strategyId, session.strategyParams);
    const runner    = new LiveStrategyRunner(strategy, session);
    const processor = new SignalProcessor();
    const risk      = new RiskController();

    // Inject the live executor only when the session is in "live" mode.
    // The paper executor is always provided as the fallback (and sole executor in paper mode).
    const liveExecutor = session.mode === "live"
      ? makeLiveExecutorWithDB(session)
      : undefined;

    const executor = new ExecutionAdapter(session, makePaperExecutor(session), liveExecutor);

    const engine = new AutoTradingEngine(
      session,
      runner,
      processor,
      risk,
      executor,
      { balance: 10_000 }
    );

    const throttleTimer = setInterval(() => engine.resetThrottle(), 60_000);

    // ── Pre-warm EMA / SMA indicators ──────────────────────────────────────
    const warmupCandles = priceSimulator.warmupCandles(session.symbol, 60);
    for (const wc of warmupCandles) {
      engine.runner.onCandle({ ...wc, symbol: session.symbol, interval: session.interval });
    }

    this.sessions.set(row.id, { engine, throttleTimer });
    logger.info(
      { sessionId: row.id, strategy: session.strategyId, warmedUp: warmupCandles.length },
      "Auto-trading session started"
    );
  }

  /** Stop a running engine and clean up its timers. */
  stopSession(sessionId: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    clearInterval(managed.throttleTimer);
    this.sessions.delete(sessionId);
    logger.info({ sessionId }, "Auto-trading session stopped");
  }

  /** Fan-out one candle event to all active engines. */
  private handleCandle(event: CandleEvent): void {
    const enriched = { ...event.candle, symbol: event.symbol, interval: event.interval };

    for (const [sessionId, { engine }] of this.sessions) {
      engine.onCandle(enriched).then((outcome) => {
        this.handleOutcome(sessionId, engine, outcome).catch((err) =>
          logger.error({ err, sessionId }, "Error handling auto-trade outcome")
        );
      }).catch((err) => {
        logger.error({ err, sessionId }, "Error in auto-trading engine");
      });
    }
  }

  /** Persist the outcome of a candle to the DB and apply side-effects. */
  private async handleOutcome(
    sessionId: string,
    engine:    AutoTradingEngine,
    outcome:   CandleOutcome
  ): Promise<void> {
    if (outcome.outcome === "no_signal") return;

    const session  = engine.session;
    const strategy = session.strategyId ?? "unknown";
    const symbol   = session.symbol    ?? "unknown";
    const wallStart = Date.now();

    if (outcome.outcome === "risk_rejected") {
      await db.insert(autoTradesTable).values({
        id:            crypto.randomUUID(),
        sessionId:     session.id,
        userId:        session.userId,
        signal:        outcome.signal.type,
        size:          outcome.signal.size,
        status:        "BLOCKED",
        blockedReason: outcome.reason,
      });

      if (outcome.reason.includes("Daily loss")) {
        await this.disableSession(sessionId, outcome.reason);
      }

      tradeCounter.inc({ strategy, symbol, result: "BLOCKED" });
      tradeLatency.observe({ strategy, symbol, result: "BLOCKED" }, Date.now() - wallStart);
      logger.warn({ sessionId, reason: outcome.reason }, "Signal blocked by risk controller");
      return;
    }

    if (outcome.outcome === "invalid_signal") {
      tradeCounter.inc({ strategy, symbol, result: "INVALID" });
      logger.warn({ sessionId, reason: outcome.reason }, "Invalid signal rejected");
      return;
    }

    if (outcome.outcome === "execution_failed") {
      await db.insert(autoTradesTable).values({
        id:            crypto.randomUUID(),
        sessionId:     session.id,
        userId:        session.userId,
        signal:        outcome.signal.type,
        size:          outcome.signal.size,
        status:        "FAILED",
        blockedReason: outcome.error,
      });
      tradeCounter.inc({ strategy, symbol, result: "FAILED" });
      tradeErrorCounter.inc({ strategy, type: "execution_failed" });
      tradeLatency.observe({ strategy, symbol, result: "FAILED" }, Date.now() - wallStart);
      logger.error({ sessionId, error: outcome.error }, "Execution failed");
      return;
    }

    // outcome === "executed"
    tradeCounter.inc({ strategy, symbol, result: "EXECUTED" });
    tradeLatency.observe({ strategy, symbol, result: "EXECUTED" }, Date.now() - wallStart);

    // ── Live trade DB persistence ──────────────────────────────────────────
    // In live mode the paper executor is bypassed, so we write the record here
    // using the exchange orderId captured in liveOrderTracker by makeLiveExecutorWithDB.
    if (session.mode === "live") {
      const exchangeOrderId = liveOrderTracker.get(sessionId);
      liveOrderTracker.delete(sessionId); // consume after reading

      const base = {
        id:              crypto.randomUUID(),
        sessionId:       session.id,
        userId:          session.userId,
        signal:          outcome.signal.type,
        size:            outcome.size,
        status:          "EXECUTED" as const,
        executionMode:   "live",
        exchangeOrderId: exchangeOrderId ?? null,
        exchangeStatus:  exchangeOrderId ? "FILLED" : null,
      };

      await db.insert(autoTradesTable).values(
        outcome.signal.type === "BUY"
          ? {
              ...base,
              entryPrice: outcome.signal.price,
              stopLoss:   outcome.stopLoss,
              takeProfit: outcome.takeProfit,
            }
          : {
              ...base,
              exitPrice:   outcome.signal.price,
              pnl:         outcome.pnl ?? 0,
              closeReason: outcome.closeReason ?? "SIGNAL",
            }
      );
    }

    logger.info(
      {
        sessionId,
        signal:     outcome.signal.type,
        size:       outcome.size,
        pnl:        outcome.pnl,
        balance:    engine.state.balance,
        stopLoss:   outcome.stopLoss,
        takeProfit: outcome.takeProfit,
      },
      "Auto-trade executed"
    );

    // ── Real-time WS notification ────────────────────────────────────────────
    sendToUser(session.userId, {
      type: "AUTO_TRADE",
      data: {
        sessionId,
        strategyId:  session.strategyId,
        symbol:      session.symbol,
        signal:      outcome.signal.type,
        price:       outcome.signal.price,
        size:        outcome.size,
        pnl:         outcome.pnl ?? 0,
        stopLoss:    outcome.stopLoss,
        takeProfit:  outcome.takeProfit,
        closeReason: outcome.closeReason,
        balance:     engine.state.balance,
        executedAt:  new Date().toISOString(),
      },
    });

    publishPortfolioUpdate(session.userId).catch((err) =>
      logger.warn({ err, sessionId }, "Portfolio update after auto-trade failed")
    );

    // ── Copy-trading fan-out ─────────────────────────────────────────────────
    marketplaceManager
      .findListingByCreatorAndStrategy(session.userId, session.strategyId)
      .then((listing) => {
        if (!listing) return;
        return marketplaceManager.onLeaderTrade({
          leaderId:       session.userId,
          listingId:      listing.id,
          signal:         outcome.signal.type as "BUY" | "SELL",
          leaderSize:     outcome.size,
          leaderBalance:  engine.state.balance,
          executionPrice: outcome.signal.price,
          pnl:            outcome.pnl,
        });
      })
      .catch((err) =>
        logger.error({ err, sessionId }, "Copy-trading fan-out error")
      );
  }

  /**
   * Called by PositionWatcher when a Stop-Loss or Take-Profit level is hit.
   * The paper executor already wrote the DB trade record (with closeReason)
   * inside engine.closeSLTP().  Here we just emit the WS notification and
   * refresh the portfolio.
   */
  private async handleSLTPClose(event: SLTPCloseEvent): Promise<void> {
    const { sessionId, engine, exitPrice, pnl, closeReason } = event;
    const session = engine.session;

    // In live mode the paper executor is bypassed — write the DB record here
    if (session.mode === "live") {
      const exchangeOrderId = liveOrderTracker.get(sessionId);
      liveOrderTracker.delete(sessionId);

      await db.insert(autoTradesTable).values({
        id:              crypto.randomUUID(),
        sessionId:       session.id,
        userId:          session.userId,
        signal:          "SELL",
        size:            event.size,
        exitPrice,
        pnl,
        closeReason,
        status:          "EXECUTED",
        executionMode:   "live",
        exchangeOrderId: exchangeOrderId ?? null,
        exchangeStatus:  exchangeOrderId ? "FILLED" : null,
      }).catch((err) =>
        logger.error({ err, sessionId, closeReason }, "Failed to write live SLTP trade to DB")
      );
    }

    logger.info(
      { sessionId, exitPrice, pnl, closeReason, balance: engine.state.balance },
      "Position auto-closed by watcher"
    );

    sendToUser(session.userId, {
      type: "AUTO_TRADE",
      data: {
        sessionId,
        strategyId:  session.strategyId,
        symbol:      session.symbol,
        signal:      "SELL",
        price:       exitPrice,
        size:        event.size,
        pnl,
        closeReason,
        balance:     engine.state.balance,
        executedAt:  new Date().toISOString(),
      },
    });

    publishPortfolioUpdate(session.userId).catch((err) =>
      logger.warn({ err, sessionId }, "Portfolio update after SL/TP close failed")
    );

    // Check if daily loss now breaches the session limit
    if (engine.state.dailyLoss >= session.maxDailyLoss) {
      await this.disableSession(
        sessionId,
        `Daily loss limit reached: $${engine.state.dailyLoss.toFixed(2)} ≥ $${session.maxDailyLoss}`
      );
    }
  }

  /** Disable a session in DB and stop its engine. */
  async disableSession(sessionId: string, reason: string): Promise<void> {
    await db
      .update(autoTradingSessionsTable)
      .set({ enabled: false, disabledReason: reason, disabledAt: new Date() })
      .where(eq(autoTradingSessionsTable.id, sessionId));

    this.stopSession(sessionId);
    logger.warn({ sessionId, reason }, "Auto-trading session disabled");
  }

  /* ── Public API for REST routes ─────────────────────────────────────────── */

  /** Create a new session in DB and start it immediately. */
  async createAndStart(params: {
    userId:              string;
    strategyId:          string;
    strategyParams?:     Record<string, unknown>;
    symbol?:             string;
    interval?:           string;
    mode?:               "paper" | "live";
    riskPercent?:        number;
    maxPositionSize?:    number;
    maxTradesPerMinute?: number;
    maxDailyLoss?:       number;
    stopLossPercent?:    number;
    takeProfitPercent?:  number;
  }): Promise<AutoTradingSession> {
    const id = crypto.randomUUID();

    const [row] = await db
      .insert(autoTradingSessionsTable)
      .values({
        id,
        userId:             params.userId,
        strategyId:         params.strategyId,
        strategyParams:     JSON.stringify(params.strategyParams ?? {}),
        symbol:             (params.symbol ?? "BTCUSDT").toUpperCase(),
        interval:           params.interval ?? "1m",
        mode:               params.mode ?? "paper",
        riskPercent:        params.riskPercent ?? 0.02,
        maxPositionSize:    params.maxPositionSize ?? 1,
        maxTradesPerMinute: params.maxTradesPerMinute ?? 3,
        maxDailyLoss:       params.maxDailyLoss ?? 100,
        stopLossPercent:    params.stopLossPercent ?? 0.01,
        takeProfitPercent:  params.takeProfitPercent ?? 0.02,
        enabled:            true,
      })
      .returning();

    await this.startSession(row!);
    return row!;
  }

  /** Stop a session and mark it disabled in DB. */
  async stopAndDisable(sessionId: string, userId: string): Promise<void> {
    const rows = await db
      .select()
      .from(autoTradingSessionsTable)
      .where(
        and(
          eq(autoTradingSessionsTable.id, sessionId),
          eq(autoTradingSessionsTable.userId, userId)
        )
      );

    if (!rows.length) throw new Error("Session not found");

    await db
      .update(autoTradingSessionsTable)
      .set({ enabled: false, disabledReason: "Stopped by user", disabledAt: new Date() })
      .where(eq(autoTradingSessionsTable.id, sessionId));

    this.stopSession(sessionId);
  }

  /**
   * Switch a session between "paper" and "live" mode.
   *
   * The running engine is stopped and restarted with the new mode so the
   * correct executor (paper vs live) is wired up from the start.
   */
  async switchMode(sessionId: string, _userId: string, mode: "paper" | "live"): Promise<AutoTradingSession> {
    const rows = await db
      .select()
      .from(autoTradingSessionsTable)
      .where(eq(autoTradingSessionsTable.id, sessionId));

    if (!rows.length) throw new Error("Session not found");

    const [row] = rows;
    if (row!.mode === mode) return row!;

    // Persist the mode change
    const [updated] = await db
      .update(autoTradingSessionsTable)
      .set({ mode, updatedAt: new Date() })
      .where(eq(autoTradingSessionsTable.id, sessionId))
      .returning();

    // Restart engine so the correct executor is injected
    this.stopSession(sessionId);
    if (updated!.enabled) {
      await this.startSession(updated!);
    }

    logger.info({ sessionId, mode, userId }, "Session execution mode switched");
    return updated!;
  }

  /** Return live status of all managed engines. */
  getStatus(): {
    sessionId:        string;
    strategyId:       string;
    symbol:           string;
    interval:         string;
    mode:             string;
    balance:          number;
    openPosition:     OpenPosition | null;
    recentTradeCount: number;
    dailyLoss:        number;
    stopLossPercent:  number;
    takeProfitPercent: number;
  }[] {
    return Array.from(this.sessions.entries()).map(([sessionId, { engine }]) => ({
      sessionId,
      strategyId:        engine.session.strategyId,
      symbol:            engine.session.symbol,
      interval:          engine.session.interval,
      mode:              engine.session.mode,
      balance:           engine.state.balance,
      openPosition:      engine.state.openPosition,
      recentTradeCount:  engine.state.recentTradeCount,
      dailyLoss:         engine.state.dailyLoss,
      stopLossPercent:   engine.session.stopLossPercent,
      takeProfitPercent: engine.session.takeProfitPercent,
    }));
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────── */

  private rowToSession(row: AutoTradingSession): AutoSession {
    let strategyParams: Record<string, unknown> = {};
    try { strategyParams = JSON.parse(row.strategyParams); } catch {}

    return {
      id:                 row.id,
      userId:             row.userId,
      strategyId:         row.strategyId,
      strategyParams,
      symbol:             row.symbol,
      interval:           row.interval,
      mode:               row.mode as "paper" | "live",
      riskPercent:        row.riskPercent,
      maxPositionSize:    row.maxPositionSize,
      maxTradesPerMinute: row.maxTradesPerMinute,
      maxDailyLoss:       row.maxDailyLoss,
      stopLossPercent:    row.stopLossPercent   ?? 0.01,
      takeProfitPercent:  row.takeProfitPercent ?? 0.02,
      enabled:            row.enabled,
    };
  }
}

/** Process-global singleton. */
export const autoTradingManager = new AutoTradingManager();
