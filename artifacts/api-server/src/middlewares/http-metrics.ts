/**
 * HTTP Metrics + Error tracking middleware.
 *
 * Records for every response:
 *   - http_request_duration_ms (latency histogram)
 *   - http_requests_total (traffic counter)
 *   - http_errors_total (error counter, for 4xx/5xx)
 *
 * Route label is normalised to prevent high-cardinality label explosion.
 */

import type { Request, Response, NextFunction } from "express";
import {
  httpRequestDuration,
  httpRequestCounter,
  httpErrorCounter,
  normalisePath,
} from "../../../../services/observability/src/index.js";

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const startTimer = httpRequestDuration.startTimer();
  const route      = normalisePath(req.path);
  const method     = req.method;

  res.on("finish", () => {
    const status = String(res.statusCode);
    const labels = { method, route, status };

    startTimer(labels);
    httpRequestCounter.inc(labels);

    if (res.statusCode >= 400) {
      httpErrorCounter.inc(labels);
    }
  });

  next();
}
