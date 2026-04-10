# Workspace

## Overview

This project is an AI-powered algorithmic trading dashboard designed for real-time trade simulation and live trading on Binance Futures. It features an equity curve visualization, self-tuning AI parameters, and an algorithmic bot with robust risk management. The system is built with a microservice-oriented monorepo architecture, utilizing a Redis Streams event bus for inter-service communication. The business vision is to provide a comprehensive, high-performance platform for automated trading, offering users advanced tools for strategy development, backtesting, and execution.

## User Preferences

I prefer iterative development, with a focus on delivering small, functional increments. Please ask before making major architectural changes or introducing new dependencies. I value clear and concise communication, so explain technical concepts simply. I also prefer detailed explanations for complex logic. Do not make changes to the `artifacts/` folder, and do not make changes to the `lib/utils.ts` file.

## System Architecture

The project employs a microservice-oriented monorepo architecture managed with pnpm workspaces. The backend is built with Node.js 24 and TypeScript 5.9, using Express 5 for APIs, PostgreSQL with Drizzle ORM for data persistence, and Zod for validation. The frontend is a React application built with Vite, Tailwind CSS, Recharts, and lightweight-charts, utilizing `react-router-dom` and `shadcn/ui` for UI components.

**Core Architectural Decisions:**

*   **Monorepo Structure:** Services are organized into `apps/`, `services/`, `core/`, and `packages/` directories.
    *   `apps/`: Contains user-facing dashboards (`web-dashboard`, `admin-dashboard`).
    *   `services/`: Encapsulates distinct microservices (e.g., `api-gateway`, `auth-service`, `trading-engine`, `portfolio-service`, `analytics-service`, `market-data-service`, `notification-service`, `strategy-engine`, `auto-trading`, `marketplace`, `copy-trading`, `revenue`, `observability`, `compliance`).
    *   `core/`: Houses shared utilities like `event-bus`, `config`, `logger`, and `errors`.
    *   `packages/`: Contains re-exports and shared types.
*   **API Gateway:** A central `api-gateway` acts as a single entry point, mounting Express routers from all services. This "monolith-first" approach allows for easy transition to independent microservice deployments if needed.
*   **Event-Driven Communication:** Redis Streams serves as the primary event bus (`event-bus` core package) for asynchronous communication between services.
*   **Observability:** The system integrates OpenTelemetry for distributed tracing (exporting to Jaeger) and Prometheus for metrics (collected via `prom-client`), providing Golden Signals and domain-specific metrics. Grafana is used for visualization and alerting.
*   **Financial Integrity System:** A two-layer reconciliation architecture: (1) Internal double-entry ledger invariant check (debit=credit, hash-chain verified), runs every hour; (2) Exchange ↔ Internal reconciliation engine comparing Binance live fills/balances against our tracked positions, runs every 5 minutes for live sessions. Three new DB tables: `balance_snapshots`, `exchange_recon_logs`, `exchange_trade_sync_logs`. Admin Reconcile tab exposes both layers with mismatch tables and run history.
*   **Real-Time Market Data Service** (`src/market/binance-market-ws.ts`): Backend Binance combined WebSocket stream (aggTrade for BTC/ETH/SOL/BNB). On each tick: feeds `processTrade()` → `publishCandleUpdate()` → WS clients + strategy engines. Updates `priceSimulator.setPrice()` so PositionWatcher SL/TP uses real prices. Exponential backoff reconnect (1s → 30s cap). Falls back to GBM simulator when geo-restricted (Replit). Status exposed at `GET /api/market/status`. `PRICE_UPDATE` WS message broadcasts real prices to connected browser tabs as fallback when direct Binance WS unavailable.
*   **Security:** AES-256-GCM encryption for API keys; JWT-based auth with 15m access + 7d rotating refresh tokens (SHA-256 hashed in DB, never stored raw); JTI blacklist on logout (Redis + in-memory fallback); account lockout (5 bad attempts / 15min → 30min lock); password policy (8+ chars, uppercase, digit); Helmet headers; daily circuit breaker. Phase 1 hardening: centralised Zod config system (fail-fast on startup), frontend silent token refresh on 401 with request queuing, proper server-side logout revocation.
*   **Config System (Phase 1):** `src/config/env.ts` — single Zod-validated source for all env vars. `src/config/{app,db,exchange,auth}.ts` split configs. Zero direct `process.env` usages in source. Fail-fast with formatted error box on startup if any required var is missing. `dotenv/config` loaded first in `index.ts`.
*   **Logging (Phase 1):** `src/lib/logger.ts` — production-grade Pino setup with: JSON in prod / pino-pretty in dev, `service`/`version`/`env`/`pid` base context on every line, `LOG_LEVEL` env override, redaction of `authorization`, `cookie`, `password`, `apiKey`, `apiSecret`, `tokenHash` fields. `requestLogger(reqId, traceCtx?)` child factory for request-scoped logs with `reqId` + OTel trace correlation. pino-http wired in `app.ts` — every HTTP request automatically logged with method, URL, status, response time. Business event logs added: `position_opened` (userId, symbol, side, entryPrice, qty, leverage, notional, margin, mode), `position_closed` (userId, positionId, entryPrice, exitPrice, qty, pnl, mode), `session_started`/`session_stopped` (userId, strategyId, symbol, mode, sessionId), `login_success`/`login_fail_bad_password`/`login_fail_no_user` (userId, email, ip, locked). Bulk-replaced all `String(err)` in catch blocks: 500 responses → `logger.error({ err })` + `"Internal server error"`, 502 exchange errors → keep user-meaningful message + add logging. 0 direct `String(err)` patterns, 0 `err.message` leaks in 500 responses. 10 request-scoped `requestLogger()` calls across route files.
*   **Testing Foundation (Phase 1):** vitest v4 + @vitest/coverage-v8 + supertest. `pnpm test` (run) / `pnpm test:watch` / `pnpm test:coverage` / `pnpm test:unit` / `pnpm test:integration`. Pool: forks (each file isolated). Setup: `tests/setup.ts` loads dotenv + sets PORT=8099 + NODE_ENV=test before any import. 7 test files, 113 tests, 100% pass rate.
  * **Unit tests** (no DB, no network, instant): `tests/unit/risk.test.ts` — 25 tests covering `calculatePositionSize` (edge cases, linear scaling, 3dp rounding), `calculateSlTp` (BUY/SELL SL/TP correctness, price direction invariants), `calculateTrailingStop` (profit lock-in, fallback when at loss). `tests/unit/password-policy.test.ts` — 12 tests covering all NIST/OWASP rules (length, case, digit, whitespace, null input). `tests/unit/ledger-hash-chain.test.ts` — 19 tests covering GENESIS_HASH stability, canonical determinism, hash sensitivity (any field change → hash change), chain accept/reject, legacy entry skip, tampering detection (amount, side, entryHash substitution, prevHash break). `tests/unit/zod-schemas.test.ts` — 23 tests covering all Zod schemas: openPositionSchema (strict mode, coercion, bounds, unknown field rejection), closePositionSchema, loginSchema (email normalisation), registerSchema, refreshSchema, startSessionSchema (riskPercent bounds), stopSessionSchema.
  * **Integration tests** (real Express app + real DB via supertest): `tests/integration/public-routes.test.ts` — market status, health, 404 handler (structured error + code), Helmet security headers. `tests/integration/validation.test.ts` — auth validation rejection (missing/invalid email, empty password, missing refreshToken, field-level detail array), auth guard rejection (401 on all protected routes, no stack trace in response), auto-trading/stop validation. `tests/integration/auth-flow.test.ts` — register (201 + tokens), duplicate rejection (4xx), login (200 + tokens), wrong password (401), unknown email (401, not 404 — no enumeration), no passwordHash/tokenHash leak in response, authenticated GET /positions (200 + array), tampered token (401), refresh cycle (rotated tokens), logout + revocation.
*   **Error Handling (Phase 1):** `src/lib/errors.ts` — `AppError` class with `statusCode`, `isOperational`, `code`, optional `details[]`. Typed factory helpers: `notFound()`, `unauthorized()`, `forbidden()`, `badRequest()`, `conflict()`, `tooManyRequests()`, `internal()`. `src/middlewares/error-handler.ts` — 4-argument global Express error handler covering: AppError (structured `{error, code, details}`), ZodError (rethrown validation), JWT errors (JsonWebTokenError / TokenExpiredError → 401), Postgres constraint codes (23505 unique → 409, 23503 FK → 409, 23502 not-null → 400), unknown errors (message hidden in production, stack shown in dev). `notFoundHandler` as catch-all before error handler. Process-level `uncaughtException` + `unhandledRejection` handlers in `index.ts` (fatal log + process exit). All errors structured-logged via pino with `reqId`, path, and method.
*   **Rate Limiting (Phase 1):** `src/middlewares/rate-limiter.ts` — four tiers: `globalLimiter` (300 req/15 min, IP-keyed, applied globally to all `/api` routes), `authLimiter` (20 req/15 min, IP-keyed, on login/register/refresh), `tradingLimiter` (30 req/min, user-ID keyed with IP fallback, on position open/close + auto-trading start), `adminLimiter` (60 req/15 min, user-keyed, on all `/admin/*`). Redis store with graceful in-memory fallback. All 429 responses include `{error, retryAfter, limit}` JSON body. Every rate-limit hit is structured-logged via pino with IP, userId, path, method, and request-ID. RateLimit draft-8 headers exposed in CORS `allowedHeaders`.
*   **Validation Layer (Phase 1):** `src/validation/` — centralized Zod schema library. `middleware.ts` provides `validate(schema, target?)` middleware with structured `{error, details:[{field,message}]}` error responses. Schemas: `trade.schema.ts` (position open/close, strict mode), `auto-trading.schema.ts` (session start/stop with all risk param bounds), `keys.schema.ts` (API key format), `auth.schema.ts` (login/register/refresh). Applied to: `positions.ts`, `auto-trading.ts`, `keys.ts`, `auth.ts`. Features: symbol normalised to uppercase, email normalised to lowercase, numeric coercion from strings, strict mode blocks unknown fields.
*   **Bot Architecture:** Includes a signal generator, risk management module (position sizing, SL/TP, trailing stop), and a per-user bot runner with a daily circuit breaker.

**UI/UX Decisions:**

*   **Frontend Framework:** React with Vite for fast development.
*   **Styling:** Tailwind CSS for utility-first styling.
*   **Charting:** Recharts and lightweight-charts for data visualization.
*   **UI Components:** `shadcn/ui` for accessible and customizable UI primitives.
*   **Routing:** `react-router-dom` for client-side navigation.

**Order Execution Pipeline (fully wired):**

*   `TradePanel` → `POST /api/positions/open` → DB write → `sendToUser(ORDER_FILLED)` + `publishTrade()` + `publishPortfolioUpdate()` → WS client `onOrderFilled` → `bumpFill()` → `PositionsPage` re-fetches from API.
*   TradePanel shows a green/red inline feedback banner (with mode: paper/live) after each fill.
*   When the Binance live feed is unavailable (geo-restricted in dev), the Market tab shows a "Reference Price" input so paper trades can still be placed.
*   `PositionsPage` gracefully handles 401 (unauthenticated) with a soft "Sign in" prompt instead of an error.

**Admin Control System (Step 6 — COMPLETE):**

Full institutional admin control panel. All routes protected by `requireAuth + requireRole("ADMIN")`.

*   `GET  /admin/users`                    — list all users (id, email, role, plan, isActive, createdAt)
*   `PATCH /admin/users/:id/role`          — change user role (USER | TRADER | ADMIN), audit-logged
*   `GET  /admin/ledger/:userId`           — double-entry ledger accounts + last 20 entries per account
*   `POST /admin/adjust-balance`           — ADJUSTMENT transaction (user DEBIT + system CREDIT), audit-logged
*   `GET  /admin/subscriptions`            — all marketplace subscriptions (filterable by status, listingId)
*   `PATCH /admin/subscriptions/:id`       — override subscription status
*   `GET  /admin/strategies`               — all strategy listings (filterable by isActive, creatorId)
*   `PATCH /admin/strategies/:id`          — update listing visibility/active state
*   `GET  /admin/audit-logs`               — paginated system-wide audit log viewer
*   `POST /admin/reconcile`                — trigger manual ledger reconciliation
*   `GET  /admin/reconcile/last`           — last reconciliation result
*   `GET  /admin/queue/depth`              — order queue depth + backend type (redis/in-memory)
*   `GET  /admin/kill-switch`              — current kill-switch state
*   `POST /admin/kill-switch/activate`     — halt all trading system-wide (reason required), audit-logged
*   `POST /admin/kill-switch/deactivate`   — resume trading, audit-logged
*   `GET  /admin/system/health`            — uptime, heap/RSS memory, queue depth, kill-switch status, Node version

Frontend tabs: **Users | Ledger | Kill Switch | Queue | Audit Logs | Reconcile | System**
- Ledger tab: user ID lookup → per-asset balance cards + entry history table + adjust-balance form
- System tab: 9-card health grid + heap utilisation bar, auto-refreshes every 10 s

**Step 4 — Risk Management Engine (COMPLETE):**

*   `services/auto-trading/src/engine/risk-manager.ts` — pure functions: `calculatePositionSize()`, `validateTrade()`, `getSLTP()`. Stateless, unit-testable.
*   `services/auto-trading/src/engine/position-watcher.ts` — `PositionWatcher` class polls every 1 s, calls `engine.closeSLTP()` when price breaches SL or TP. Fires `onClose` callback with `closeReason: "STOP_LOSS" | "TAKE_PROFIT"`.
*   `RiskController` — calls `getSLTP()` on BUY signals and returns `{ stopLoss, takeProfit }` in `RiskResult`.
*   `AutoTradingEngine.closeSLTP()` — forced SELL path bypassing strategy/risk layers for mandatory exits.
*   DB schema additions: `auto_trading_sessions` gains `stop_loss_percent` (default 0.01), `take_profit_percent` (default 0.02). `auto_trades` gains `stop_loss`, `take_profit`, `close_reason` columns.
*   Default risk config per session: `riskPercent=2%`, `stopLossPercent=1%`, `takeProfitPercent=2%`.
*   Session SL/TP config is accepted by `POST /api/auto-trading/start` as `stopLossPercent` / `takeProfitPercent`.

**DB Field Mapping Rules (DO NOT change):**

*   `autoTradingSessionsTable`: uses `enabled` (not `isActive`), `strategyId` (not `strategy`). Has `stopLossPercent` and `takeProfitPercent` columns (added Step 4).
*   `autoTradesTable`: raw columns are `signal`, `size`, `entryPrice`, `exitPrice`, `stopLoss`, `takeProfit`, `closeReason`. `normaliseTrade()` maps `signal→side`, `size→quantity`, and passes through SL/TP/closeReason.
*   `strategySubscriptionsTable`: uses `status` text field (`"ACTIVE"`, `"CANCELLED"`, `"SUSPENDED"`). All API responses add computed `isActive: status === "ACTIVE"`.

**Frontend Safety Rules:**

*   Never call `.toFixed()` directly on API values — always wrap: `(Number(x) || 0).toFixed(n)`. Affects `RecentTrades.tsx`, `Positions.tsx`, and any component receiving WS/DB numeric data.

**Key Features:**

*   Real-time trade simulation and live Binance Futures trading.
*   Equity curve visualization and performance analytics.
*   Self-tuning AI parameters for algorithmic bots.
*   Advanced risk management features.
*   Strategy backtesting engine.
*   User authentication and authorization (JWT, RBAC).
*   Marketplace for strategy listings and subscriptions.
*   Copy trading functionality with performance fee calculation.
*   Comprehensive observability (metrics, tracing, logging, alerting).
*   Robust financial integrity with a double-entry ledger and audit trails.
*   Pre-trade risk checks and compliance features (KYC, AML).

## External Dependencies

*   **Binance Futures API:** For live trading, market data (klines, ticker).
*   **PostgreSQL:** Primary database for persistent storage.
*   **Redis:** Used for Redis Streams (event bus), caching, and session management.
*   **Jaeger:** For distributed tracing visualization (via OpenTelemetry OTLP exporter).
*   **Prometheus:** For metrics collection and monitoring.
*   **Grafana:** For dashboarding and alerting based on Prometheus metrics.
*   **Docker Compose:** For local development setup of observability stack.