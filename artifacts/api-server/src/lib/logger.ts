/**
 * Production-grade Pino logger.
 *
 * Every log line includes:
 *   service, version, env, pid  → service identity
 *   timestamp (ISO 8601)        → precise timing
 *   reqId                       → request correlation (via child logger)
 *   traceId / spanId            → OpenTelemetry correlation (injected by pino-opentelemetry or manually)
 *
 * Log aggregators (Loki, CloudWatch, Datadog) can JOIN logs to traces via traceId.
 */

import pino, { type Logger } from "pino";

const isProduction = process.env["NODE_ENV"] === "production";

export const logger: Logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",

  timestamp: pino.stdTimeFunctions.isoTime,

  // Service context on every line — makes log search instant in Grafana Loki / Datadog
  base: {
    service: "algo-trading-api",
    version: "1.0.0",
    env:     process.env["NODE_ENV"] ?? "development",
    pid:     process.pid,
  },

  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.apiKey",
      "*.apiSecret",
      "*.tokenHash",
    ],
    censor: "[REDACTED]",
  },

  ...(isProduction
    ? {}
    : {
        transport: {
          target:  "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }),
});

/* ── Request-scoped child logger ──────────────────────────────────────────── */

/**
 * Create a child logger carrying the request ID and optional OTel trace context.
 * Use this inside route handlers instead of the root logger.
 *
 *   const log = requestLogger(req.reqId!, traceContext);
 *   log.info({ userId }, 'Trade executed');
 */
export function requestLogger(
  reqId:    string,
  traceCtx: { traceId?: string; spanId?: string } = {}
): Logger {
  return logger.child({
    reqId,
    ...(traceCtx.traceId ? { traceId: traceCtx.traceId, spanId: traceCtx.spanId } : {}),
  });
}
