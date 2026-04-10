/**
 * API Server entry point.
 *
 * Init order is critical:
 *   1. dotenv — loads .env file before anything reads process.env
 *   2. env validation — Zod schema; process.exit(1) on invalid config
 *   3. OTel tracing — MUST be before auto-instrumentation patches pg/express/ioredis
 *   4. Regular imports (all static imports hoisted here by ESM)
 *   4a. Process-level safety nets — uncaughtException / unhandledRejection
 *   5. HTTP server + WS gateway
 *   6. Kill switch state loaded from Redis
 *   7. Trading engines + order queue
 */

// ── Step 1: load .env file (no-op if file does not exist) ─────────────────────
import "dotenv/config";

// ── Step 2: validate environment — exits immediately with a clear message ──────
import { env } from "./config/env.js";

// ── Step 3: tracing init BEFORE everything else ───────────────────────────────
import { startTracing } from "../../../services/observability/src/index.js";
startTracing();

// ── Step 4: regular imports ───────────────────────────────────────────────────
import http from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initEngine } from "./lib/trading-engine.js";
import { startBotLoop } from "./lib/bot-runner.js";
import { attachWsGateway } from "./lib/ws-server.js";
import { startWsSubscriber } from "./lib/ws-subscriber.js";
import { autoTradingManager } from "./lib/auto-trading-manager.js";
import { initOrderQueue } from "./lib/order-queue.js";
import { initKillSwitch } from "./lib/kill-switch.js";
import { startLedgerScheduler } from "./lib/ledger-scheduler.js";
import { startExchangeSyncScheduler } from "./exchange/exchange-sync-scheduler.js";
import { startBinanceMarketWS } from "./market/binance-market-ws.js";

// ── Step 4a: process-level safety nets ───────────────────────────────────────
// These fire only if an error escapes all middleware (extremely rare with
// Express 5 + our global error handler). Log, then exit so the process
// manager (Replit workflow) can restart cleanly.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — exiting");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled promise rejection — exiting");
  process.exit(1);
});

// ── Step 5: HTTP server ───────────────────────────────────────────────────────
const port = Number(env.PORT);

const server = http.createServer(app);

// server.listen() callback never receives an error — listen errors (EADDRINUSE,
// EACCES, etc.) are emitted as 'error' events and must be caught here.
server.on("error", (err: NodeJS.ErrnoException) => {
  logger.fatal({ err, port, code: err.code }, "HTTP server failed to bind — exiting");
  process.exit(1);
});

attachWsGateway(server);
startWsSubscriber();

initEngine().then(() => {
  server.listen(port, () => {
    logger.info({ port }, "Server listening");
    logger.info({ port }, "WebSocket gateway ready at /ws");
    logger.info("OpenTelemetry tracing active");

    startBotLoop(60_000);

    // Load kill-switch state from Redis (async, non-blocking)
    initKillSwitch().catch((err: unknown) =>
      logger.error({ err }, "Kill switch init failed")
    );

    // Start automated financial integrity monitoring (reconciliation + chain verify + negative balance scan)
    startLedgerScheduler();

    // Start Exchange Sync + Reconciliation scheduler (balance snapshots + trade sync + exchange recon)
    startExchangeSyncScheduler();

    // Connect to Binance real-time market data (aggTrade streams for BTC/ETH/SOL/BNB).
    // Feeds real prices into candle service + strategy engines + PositionWatcher.
    // Falls back silently to GBM simulator if Binance is unreachable.
    startBinanceMarketWS();

    autoTradingManager.init().catch((err: unknown) =>
      logger.error({ err }, "AutoTradingManager init failed")
    );

    initOrderQueue().catch((err: unknown) =>
      logger.error({ err }, "OrderQueue init failed")
    );
  });
});
