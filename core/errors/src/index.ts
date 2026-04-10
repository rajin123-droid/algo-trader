export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "RATE_LIMITED"
  | "CIRCUIT_BREAKER_OPEN"
  | "INSUFFICIENT_FUNDS"
  | "ORDER_REJECTED";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: ErrorCode = "INTERNAL_ERROR",
    statusCode = 500,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export const Errors = {
  unauthorized: (msg = "Unauthorized") => new AppError(msg, "UNAUTHORIZED", 401),
  forbidden: (msg = "Forbidden") => new AppError(msg, "FORBIDDEN", 403),
  notFound: (msg = "Not found") => new AppError(msg, "NOT_FOUND", 404),
  conflict: (msg = "Conflict") => new AppError(msg, "CONFLICT", 409),
  validation: (msg: string, details?: unknown) =>
    new AppError(msg, "VALIDATION_ERROR", 422, details),
  rateLimited: (msg = "Too many requests") => new AppError(msg, "RATE_LIMITED", 429),
  circuitOpen: (msg = "Circuit breaker open — daily limit reached") =>
    new AppError(msg, "CIRCUIT_BREAKER_OPEN", 503),
  internal: (msg = "Internal server error") => new AppError(msg, "INTERNAL_ERROR", 500),
  insufficientFunds: (msg = "Insufficient funds") =>
    new AppError(msg, "INSUFFICIENT_FUNDS", 422),
  orderRejected: (msg = "Order rejected") => new AppError(msg, "ORDER_REJECTED", 422),
};
