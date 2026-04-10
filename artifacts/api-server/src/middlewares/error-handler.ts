/**
 * Global error handler — last middleware in the Express chain.
 *
 * Handles:
 *   AppError          — operational errors thrown by route handlers
 *   ZodError          — schema validation errors (if rethrown instead of caught by validate())
 *   JsonWebTokenError — malformed/expired JWT
 *   Postgres errors   — unique constraint, FK violations, etc.
 *   Everything else   — generic 500, message hidden in production
 *
 * Safe by default:
 *   - 4xx  → operational, message exposed
 *   - 5xx  → unexpected, message hidden in production; full error in dev
 *   - Stack trace only sent in development
 */

import { type Request, type Response, type NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

const isDev = env.NODE_ENV === "development";

/* ── Postgres error codes we recognise ───────────────────────────────────── */
const PG_UNIQUE_VIOLATION   = "23505";
const PG_FK_VIOLATION       = "23503";
const PG_NOT_NULL_VIOLATION = "23502";

interface PgError extends Error {
  code?:   string;
  detail?: string;
}

/* ── Main handler ─────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err:  unknown,
  req:  Request,
  res:  Response,
  _next: NextFunction,
): void {
  /* 1. AppError — thrown intentionally by our code */
  if (err instanceof AppError) {
    if (!err.isOperational) {
      // isOperational=false → programming/unexpected error; treat as severity error.
      logger.error({ err, reqId: req.reqId, path: req.path, method: req.method }, "Non-operational application error");
    } else {
      // isOperational=true → expected operational error (auth, validation, not-found, etc.)
      logger.warn({ code: err.code, status: err.statusCode, path: req.path }, err.message);
    }

    const body: Record<string, unknown> = { error: err.message };
    if (err.code)    body["code"]    = err.code;
    if (err.details) body["details"] = err.details;
    if (isDev)       body["stack"]   = err.stack;

    res.status(err.statusCode).json(body);
    return;
  }

  /* 2. Zod validation error — if thrown rather than handled by validate() */
  if (err instanceof ZodError) {
    logger.warn({ path: req.path, issues: err.issues.length }, "Unhandled ZodError");
    res.status(400).json({
      error:   "Validation failed",
      details: err.issues.map((i) => ({
        field:   i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  /* 3. JWT errors */
  if (err instanceof Error) {
    if (err.name === "JsonWebTokenError") {
      logger.warn({ path: req.path }, "Invalid JWT");
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    if (err.name === "TokenExpiredError") {
      logger.warn({ path: req.path }, "Expired JWT");
      res.status(401).json({ error: "Token expired" });
      return;
    }
  }

  /* 4. Postgres / Drizzle errors */
  const pgErr = err as PgError;
  if (pgErr?.code === PG_UNIQUE_VIOLATION) {
    logger.warn({ detail: pgErr.detail, path: req.path }, "DB unique constraint violation");
    res.status(409).json({ error: "Resource already exists", code: "CONFLICT" });
    return;
  }
  if (pgErr?.code === PG_FK_VIOLATION) {
    logger.warn({ detail: pgErr.detail, path: req.path }, "DB foreign key violation");
    res.status(409).json({ error: "Referenced resource does not exist", code: "FK_VIOLATION" });
    return;
  }
  if (pgErr?.code === PG_NOT_NULL_VIOLATION) {
    logger.warn({ detail: pgErr.detail, path: req.path }, "DB not-null violation");
    res.status(400).json({ error: "Missing required field", code: "NOT_NULL_VIOLATION" });
    return;
  }

  /* 5. Everything else — unexpected error */
  logger.error(
    { err, reqId: req.reqId, path: req.path, method: req.method },
    "Unhandled server error",
  );

  if (isDev) {
    const e = err as Error;
    res.status(500).json({
      error:   e?.message ?? "Internal server error",
      stack:   e?.stack,
    });
  } else {
    res.status(500).json({ error: "Internal server error" });
  }
}

/* ── 404 handler — wire BEFORE errorHandler, AFTER all routes ─────────────── */

export function notFoundHandler(req: Request, res: Response): void {
  logger.warn({ path: req.path, method: req.method }, "Route not found");
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
    code:  "ROUTE_NOT_FOUND",
  });
}
