/**
 * OpenTelemetry distributed tracing initialiser.
 *
 * MUST be imported before any other module in the process entrypoint (index.ts)
 * so auto-instrumentations can monkey-patch pg, express, ioredis, ws, etc.
 *
 * Only imports from packages installed in the api-server:
 *   @opentelemetry/sdk-node   — SDK + re-exports of resources namespace
 *   @opentelemetry/api        — Tracer/Span/context primitives
 *   @opentelemetry/exporter-trace-otlp-http  — OTLP exporter for Jaeger/Tempo
 *   @opentelemetry/auto-instrumentations-node — Auto-patches pg, express, etc
 *
 * Usage in app code:
 *   const tracer = getTracer('matching-engine');
 *   const span   = tracer.startSpan('match-order');
 *   // ... do work ...
 *   span.end();
 *
 *   // Or with automatic error capture:
 *   await tracedSpan('sor', 'route-order', () => sorManager.execute(req));
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
// resourceFromAttributes is the new API (replaces `new Resource()` from the separate package)
import { resources } from "@opentelemetry/sdk-node";
import {
  trace,
  SpanStatusCode,
  type Tracer,
  type Span,
} from "@opentelemetry/api";

/* ── SDK bootstrap ────────────────────────────────────────────────────────── */

const OTLP_ENDPOINT =
  process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4318";

let _sdk: NodeSDK | null = null;
let _started = false;

/**
 * Start the OpenTelemetry SDK.
 * Idempotent — safe to call multiple times.
 * No-op when OTEL_SDK_DISABLED=true (useful in dev/test).
 */
export function startTracing(): void {
  if (_started || process.env["OTEL_SDK_DISABLED"] === "true") return;

  try {
    // resourceFromAttributes is in the sdk-node re-exported namespace
    const serviceResource = resources.resourceFromAttributes({
      "service.name":        "algo-trading-api",
      "service.version":     "1.0.0",
      "deployment.environment": process.env["NODE_ENV"] ?? "development",
    });

    _sdk = new NodeSDK({
      resource: serviceResource,

      traceExporter: new OTLPTraceExporter({
        url: `${OTLP_ENDPOINT}/v1/traces`,
        headers: {},
      }),

      instrumentations: [
        getNodeAutoInstrumentations({
          // Suppress noisy or irrelevant instrumentations
          "@opentelemetry/instrumentation-fs":  { enabled: false },
          "@opentelemetry/instrumentation-dns": { enabled: false },
        }),
      ],
    });

    _sdk.start();
    _started = true;

    // Flush + shut down cleanly on exit
    const shutdown = (): void => {
      _sdk?.shutdown().catch(() => {}).finally(() => process.exit(0));
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT",  shutdown);
  } catch (err) {
    // Tracing init must NEVER crash the app — just log and continue
    // eslint-disable-next-line no-console
    console.error("[otel] tracing init failed:", err);
  }
}

/* ── Manual tracing helpers ───────────────────────────────────────────────── */

/** Get a named tracer for a subsystem. */
export function getTracer(name: string): Tracer {
  return trace.getTracer(name, "1.0.0");
}

/**
 * Execute `fn` inside a named OTel span.
 * Automatically captures errors and marks the span as failed.
 *
 * @param subsystem  - Tracer name (e.g. 'sor', 'ledger', 'database')
 * @param spanName   - Human-readable operation name
 * @param fn         - Async work to execute within the span
 * @param attributes - Optional span attributes to attach
 */
export async function tracedSpan<T>(
  subsystem:  string,
  spanName:   string,
  fn:         (span: Span) => Promise<T>,
  attributes: Record<string, string | number | boolean> = {}
): Promise<T> {
  const tracer = getTracer(subsystem);
  return tracer.startActiveSpan(spanName, async (span) => {
    for (const [k, v] of Object.entries(attributes)) {
      span.setAttribute(k, v);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code:    SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Get the current trace ID and span ID for log/trace correlation.
 * Returns empty strings when no active span exists.
 */
export function currentTraceContext(): { traceId: string; spanId: string } {
  const span = trace.getActiveSpan();
  if (!span) return { traceId: "", spanId: "" };
  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

export { SpanStatusCode };
