// Tracing
export {
  startTracing,
  getTracer,
  tracedSpan,
  currentTraceContext,
  SpanStatusCode,
} from "./tracing.js";

// Also re-export `tracedSpan` as a convenience alias
export type { Span, Tracer } from "@opentelemetry/api";

// Metrics
export {
  registry,
  // Latency
  httpRequestDuration,
  tradeLatency,
  sorLatency,
  sorSlippage,
  dbQueryDuration,
  redisCommandDuration,
  // Traffic
  httpRequestCounter,
  tradeCounter,
  sorFillCounter,
  wsMessageCounter,
  authEventCounter,
  // Errors
  httpErrorCounter,
  tradeErrorCounter,
  dbErrorCounter,
  amlFlagCounter,
  // Saturation
  wsConnectionsGauge,
  openPositionsGauge,
  orderQueueDepth,
  // Financial safety
  ledgerImbalanceGauge,
  negativeBalanceGauge,
  ledgerChainBreaksTotal,
  tradeVolumeHist,
  reconcileCounter,
  // Compliance
  kycStatusGauge,
  // Helpers
  timed,
  normalisePath,
} from "./metrics-registry.js";
