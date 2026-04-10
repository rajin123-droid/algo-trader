/**
 * Metrics route — exposes Prometheus metrics at GET /metrics.
 *
 * In production, this endpoint should be protected by network policy
 * (only accessible from the Prometheus scraper, not the public internet).
 * For simplicity, it is left unauthenticated here but can be protected with
 * requireRole('ADMIN') or IP allowlisting.
 */

import { Router } from "express";
import { registry } from "../../../../services/observability/src/index.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/metrics", async (_req, res) => {
  try {
    const metrics = await registry.metrics();
    res.set("Content-Type", registry.contentType);
    res.send(metrics);
  } catch (err) {
    // _req is intentionally unused on the happy path; path is fixed for this route.
    logger.error({ err, path: "/metrics" }, "Failed to serialize Prometheus metrics");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
