import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router, { metricsRouter } from "./routes";
import { logger } from "./lib/logger";
import { globalLimiter } from "./middlewares/rate-limiter";
import { httpMetrics } from "./middlewares/http-metrics";
import { requestId } from "./middlewares/request-id";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler";

const app: Express = express();

// Replit (and most cloud platforms) sit behind a reverse proxy that sets
// X-Forwarded-For.  Trust the first hop so express-rate-limit can key
// correctly on the real client IP instead of throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set("trust proxy", 1);

/* ── Security Headers (Helmet) ────────────────────────────────────────────── */
// Sets 15+ HTTP security headers in one call.
// In production: tighten CSP to only allow your specific domains.
const isProd = process.env["NODE_ENV"] === "production";

const cspDirectives: Record<string, string[] | string[][]> = {
  defaultSrc: ["'self'"],
  scriptSrc:  ["'self'"],
  styleSrc:   ["'self'", "'unsafe-inline'"],
  connectSrc: ["'self'", "wss:", "ws:"],
  imgSrc:     ["'self'", "data:", "https:"],
  fontSrc:    ["'self'"],
  frameSrc:   ["'none'"],
  objectSrc:  ["'none'"],
};

// Only enforce upgrade-insecure-requests in production (requires HTTPS)
if (isProd) {
  cspDirectives["upgradeInsecureRequests"] = [];
}

app.use(
  helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    hsts: {
      maxAge:            31_536_000,
      includeSubDomains: true,
      preload:           true,
    },
    frameguard: { action: "deny" },
    noSniff: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hidePoweredBy: true,
  })
);

/* ── CORS ─────────────────────────────────────────────────────────────────── */
// In production, replace with an explicit allowlist:
//   origin: ['https://yourdomain.com', 'https://app.yourdomain.com']
const allowedOrigins = process.env["CORS_ORIGIN"]
  ? process.env["CORS_ORIGIN"].split(",").map((o) => o.trim())
  : true;   // true = reflect any origin (development)

app.use(
  cors({
    origin:             allowedOrigins,
    methods:            ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders:     ["Content-Type", "Authorization", "x-request-id", "x-device-id"],
    exposedHeaders:     ["x-request-id", "RateLimit-Limit", "RateLimit-Remaining"],
    credentials:        true,
    maxAge:             86_400,   // preflight cache: 24 hours
  })
);

/* ── Correlation ID ───────────────────────────────────────────────────────── */
app.use(requestId);

/* ── Request logging ──────────────────────────────────────────────────────── */
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req as express.Request).reqId ?? String(Math.random()),
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

/* ── Body parsing ─────────────────────────────────────────────────────────── */
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

/* ── Prometheus instrumentation ───────────────────────────────────────────── */
app.use(httpMetrics);

/* ── Global rate limiting ─────────────────────────────────────────────────── */
app.use(globalLimiter);

/* ── Routes ───────────────────────────────────────────────────────────────── */
app.use(metricsRouter);    // GET /metrics — Prometheus scrape endpoint
app.use("/api", router);   // All API routes

/* ── 404 catch-all (after routes, before error handler) ───────────────────── */
app.use(notFoundHandler);

/* ── Global error handler (must be last, must have 4 args) ───────────────── */
app.use(errorHandler);

export default app;
