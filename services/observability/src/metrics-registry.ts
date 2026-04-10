/**
 * Metrics registry — prom-client metrics for the full observability stack.
 *
 * Covers the four Golden Signals:
 *   1. Latency    — how long things take
 *   2. Traffic    — how much demand the system receives
 *   3. Errors     — the rate of failing requests
 *   4. Saturation — how "full" the service is
 *
 * Plus domain-specific metrics:
 *   trading.*      — execution latency, trade counts, PnL
 *   sor.*          — routing latency, slippage, venue fills
 *   auth.*         — login/register/token events, failed auth rate
 *   ws.*           — WebSocket connections, message throughput
 *   db.*           — PostgreSQL query duration, slow queries
 *   redis.*        — Redis command latency
 *   ledger.*       — Reconciliation results, imbalances (CRITICAL)
 *   compliance.*   — KYC status counts, AML flag rate
 */

import {
  Registry,
  Histogram,
  Counter,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

export const registry = new Registry();

// Collect Node.js process metrics (CPU, memory, GC, event-loop lag)
collectDefaultMetrics({ register: registry, prefix: "app_" });

/* ═══════════════════════════════════════════════════════════════════════════
   GOLDEN SIGNAL 1 — LATENCY
═══════════════════════════════════════════════════════════════════════════ */

/** All HTTP request durations. Labels let you filter by method/route/status. */
export const httpRequestDuration = new Histogram({
  name:       "http_request_duration_ms",
  help:       "HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status"] as const,
  buckets:    [5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000],
  registers:  [registry],
});

/** Trade execution pipeline latency — from signal to fill confirmation. */
export const tradeLatency = new Histogram({
  name:       "trading_execution_latency_ms",
  help:       "End-to-end trade execution latency in milliseconds",
  labelNames: ["strategy", "symbol", "result"] as const,
  buckets:    [5, 10, 25, 50, 100, 200, 500, 1000, 2000],
  registers:  [registry],
});

/** SOR full pipeline latency (book fetch + routing + fill + ledger). */
export const sorLatency = new Histogram({
  name:       "sor_execution_latency_ms",
  help:       "Smart Order Router end-to-end latency in milliseconds",
  labelNames: ["symbol", "side", "status"] as const,
  buckets:    [10, 25, 50, 100, 250, 500, 1000, 2000],
  registers:  [registry],
});

/** SOR slippage distribution — key financial quality metric. */
export const sorSlippage = new Histogram({
  name:       "sor_slippage_bps",
  help:       "SOR execution slippage in basis points relative to mid-price",
  labelNames: ["symbol", "side"] as const,
  buckets:    [0, 0.5, 1, 2, 5, 10, 20, 50, 100],
  registers:  [registry],
});

/** PostgreSQL query duration by operation. */
export const dbQueryDuration = new Histogram({
  name:       "db_query_duration_ms",
  help:       "PostgreSQL query duration in milliseconds",
  labelNames: ["operation", "table"] as const,
  buckets:    [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers:  [registry],
});

/** Redis command latency. */
export const redisCommandDuration = new Histogram({
  name:       "redis_command_duration_ms",
  help:       "Redis command execution latency in milliseconds",
  labelNames: ["command"] as const,
  buckets:    [0.5, 1, 2, 5, 10, 25, 50, 100],
  registers:  [registry],
});

/* ═══════════════════════════════════════════════════════════════════════════
   GOLDEN SIGNAL 2 — TRAFFIC
═══════════════════════════════════════════════════════════════════════════ */

export const httpRequestCounter = new Counter({
  name:       "http_requests_total",
  help:       "Total HTTP requests by method, route, and status",
  labelNames: ["method", "route", "status"] as const,
  registers:  [registry],
});

export const tradeCounter = new Counter({
  name:       "trading_trades_total",
  help:       "Total trade signals processed by outcome",
  labelNames: ["strategy", "symbol", "result"] as const,
  registers:  [registry],
});

export const sorFillCounter = new Counter({
  name:       "sor_fills_total",
  help:       "SOR fills routed to each exchange",
  labelNames: ["exchange", "symbol", "side"] as const,
  registers:  [registry],
});

/** WebSocket messages sent to clients. */
export const wsMessageCounter = new Counter({
  name:       "ws_messages_total",
  help:       "Total WebSocket messages broadcast",
  labelNames: ["type"] as const,   // market_data | portfolio_update | alert
  registers:  [registry],
});

export const authEventCounter = new Counter({
  name:       "auth_events_total",
  help:       "Authentication events",
  labelNames: ["event"] as const,  // login_success | login_fail | register | token_refresh | logout
  registers:  [registry],
});

/* ═══════════════════════════════════════════════════════════════════════════
   GOLDEN SIGNAL 3 — ERRORS
═══════════════════════════════════════════════════════════════════════════ */

export const httpErrorCounter = new Counter({
  name:       "http_errors_total",
  help:       "HTTP 4xx/5xx errors by route",
  labelNames: ["method", "route", "status"] as const,
  registers:  [registry],
});

export const tradeErrorCounter = new Counter({
  name:       "trading_errors_total",
  help:       "Trade execution errors by type",
  labelNames: ["strategy", "type"] as const,
  registers:  [registry],
});

export const dbErrorCounter = new Counter({
  name:       "db_errors_total",
  help:       "Database query errors",
  labelNames: ["operation"] as const,
  registers:  [registry],
});

export const amlFlagCounter = new Counter({
  name:       "compliance_aml_flags_total",
  help:       "AML checks by decision",
  labelNames: ["decision"] as const,   // PASS | FLAG | BLOCK
  registers:  [registry],
});

/* ═══════════════════════════════════════════════════════════════════════════
   GOLDEN SIGNAL 4 — SATURATION
═══════════════════════════════════════════════════════════════════════════ */

/** Live WebSocket connections — saturation signal for the WS gateway. */
export const wsConnectionsGauge = new Gauge({
  name:       "ws_connections_active",
  help:       "Number of active WebSocket connections",
  registers:  [registry],
});

/** Open DB positions per symbol — trading saturation. */
export const openPositionsGauge = new Gauge({
  name:       "trading_open_positions",
  help:       "Current open trading positions by symbol",
  labelNames: ["symbol"] as const,
  registers:  [registry],
});

/** Order queue backlog depth. */
export const orderQueueDepth = new Gauge({
  name:       "order_queue_depth",
  help:       "Number of orders waiting in the execution queue",
  registers:  [registry],
});

/* ═══════════════════════════════════════════════════════════════════════════
   FINANCIAL SAFETY — CRITICAL METRICS
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ledger imbalance — MUST always be 0.
 * Any non-zero value triggers a CRITICAL alert (debits ≠ credits).
 */
export const ledgerImbalanceGauge = new Gauge({
  name:    "ledger_imbalance_total",
  help:    "CRITICAL: Sum of |debit - credit| across all unbalanced transactions. Must be 0.",
  registers: [registry],
});

export const reconcileCounter = new Counter({
  name:       "ledger_reconcile_runs_total",
  help:       "Ledger reconciliation runs by result",
  labelNames: ["result"] as const,   // pass | fail
  registers:  [registry],
});

/**
 * Negative balance gauge — MUST always be 0.
 * Any account with negative balance indicates a ledger bug or fraud.
 */
export const negativeBalanceGauge = new Gauge({
  name:    "ledger_negative_balance_accounts",
  help:    "CRITICAL: Number of accounts with a negative computed balance. Must be 0.",
  registers: [registry],
});

/**
 * Hash chain integrity breaks — MUST always be 0.
 * Any non-zero value indicates ledger data has been tampered with.
 */
export const ledgerChainBreaksTotal = new Counter({
  name:       "ledger_hash_chain_breaks_total",
  help:       "CRITICAL: Ledger hash chain integrity failures. Must be 0.",
  labelNames: ["severity"] as const,
  registers:  [registry],
});

/**
 * Trade volume histogram — used for statistical spike detection.
 * Alert when p99 or sudden total exceeds 3× the rolling average.
 */
export const tradeVolumeHist = new Histogram({
  name:       "trade_volume_usd",
  help:       "Distribution of individual trade volume in USD",
  labelNames: ["symbol", "side"] as const,
  buckets:    [10, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000],
  registers:  [registry],
});

/* ═══════════════════════════════════════════════════════════════════════════
   COMPLIANCE
═══════════════════════════════════════════════════════════════════════════ */

export const kycStatusGauge = new Gauge({
  name:       "compliance_kyc_users_total",
  help:       "User count by KYC status",
  labelNames: ["status"] as const,   // NONE | PENDING | APPROVED | REJECTED
  registers:  [registry],
});

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Wrap an async function and record its duration to a Histogram.
 *
 *   const result = await timed(tradeLatency, { strategy, symbol, result: 'EXECUTED' }, fn);
 */
export async function timed<T>(
  histogram: Histogram<string>,
  labels:    Record<string, string>,
  fn:        () => Promise<T>
): Promise<T> {
  const end = histogram.startTimer(labels);
  try {
    return await fn();
  } finally {
    end();
  }
}

/**
 * Normalise a URL path for use as a Prometheus label — replaces IDs and symbols
 * with placeholders so high-cardinality paths don't explode the label set.
 */
export function normalisePath(url: string): string {
  return url
    .replace(/\?.*$/, "")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/\d{5,}/g, "/:id")
    .replace(/\/[A-Z]{2,}USDT(PERP)?/g, "/:symbol")
    .toLowerCase();
}
