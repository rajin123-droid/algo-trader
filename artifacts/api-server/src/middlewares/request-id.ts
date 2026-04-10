/**
 * Request ID middleware — correlation ID for the full request lifecycle.
 *
 * Flow:
 *  1. Honour an incoming `x-request-id` header (set by load balancer / API gateway).
 *  2. Otherwise generate a new UUID.
 *  3. Echo the ID back on `x-request-id` response header.
 *  4. Attach `req.reqId` for use in logs and traces.
 *
 * This ID threads through: HTTP log → OpenTelemetry span attribute → audit log.
 */

import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      reqId?: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();

  req.reqId = id;
  res.setHeader("x-request-id", id);

  // Attach to active OTel span (if tracing is initialised)
  try {
    const { trace } = require("@opentelemetry/api") as typeof import("@opentelemetry/api");
    const span = trace.getActiveSpan();
    if (span) span.setAttribute("http.request_id", id);
  } catch { /* tracing not available */ }

  next();
}
