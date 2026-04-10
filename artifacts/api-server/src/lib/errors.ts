/**
 * AppError — the single error type all route handlers should throw.
 *
 * Properties:
 *   statusCode    — HTTP status to return (default 500)
 *   isOperational — true means we caused it intentionally (safe to expose message)
 *                   false means unexpected failure (hide message in production)
 *   code          — optional machine-readable slug, e.g. "POSITION_NOT_FOUND"
 *   details       — optional array of field-level validation errors
 *
 * Examples:
 *   throw new AppError("Position not found", 404, "POSITION_NOT_FOUND");
 *   throw new AppError("Validation failed", 400, "VALIDATION_FAILED", [{ field: "qty", message: "must be positive" }]);
 */

export interface ErrorDetail {
  field:   string;
  message: string;
}

export class AppError extends Error {
  readonly statusCode:    number;
  readonly isOperational: boolean;
  readonly code:          string | undefined;
  readonly details:       ErrorDetail[] | undefined;

  constructor(
    message:       string,
    statusCode:    number           = 500,
    code?:         string,
    details?:      ErrorDetail[],
  ) {
    super(message);
    this.name          = "AppError";
    this.statusCode    = statusCode;
    this.isOperational = statusCode < 500;   // 4xx = intentional, 5xx = unexpected
    this.code          = code;
    this.details       = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

/* ── Typed constructors for common cases ──────────────────────────────────── */

export const notFound    = (resource = "Resource") =>
  new AppError(`${resource} not found`,       404, "NOT_FOUND");

export const unauthorized = (msg = "Authentication required") =>
  new AppError(msg,                           401, "UNAUTHORIZED");

export const forbidden    = (msg = "Insufficient permissions") =>
  new AppError(msg,                           403, "FORBIDDEN");

export const badRequest   = (msg: string, details?: ErrorDetail[]) =>
  new AppError(msg,                           400, "BAD_REQUEST", details);

export const conflict     = (msg: string) =>
  new AppError(msg,                           409, "CONFLICT");

export const tooManyRequests = (msg = "Too many requests") =>
  new AppError(msg,                           429, "TOO_MANY_REQUESTS");

export const internal     = (msg = "Internal server error") =>
  new AppError(msg,                           500, "INTERNAL_SERVER_ERROR");
