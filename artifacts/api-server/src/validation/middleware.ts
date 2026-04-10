/**
 * validate() — Zod validation middleware factory.
 *
 * Usage:
 *   router.post("/positions/open", validate(openPositionSchema), handler);
 *   router.get("/trades",          validate(querySchema, "query"), handler);
 *
 * On failure: responds 400 with a structured, field-level error body.
 * On success: the parsed (and stripped/coerced) value is written back to
 *             req.body / req.query / req.params so downstream handlers
 *             receive clean, typed data.
 */

import type { Request, Response, NextFunction } from "express";
import type { ZodTypeAny, ZodError } from "zod";

type Target = "body" | "query" | "params";

/**
 * Format a ZodError into a flat array of `{ field, message }` objects.
 * Path segments are joined with "." so nested fields read naturally.
 */
function formatZodErrors(err: ZodError): { field: string; message: string }[] {
  return err.errors.map((e) => ({
    field:   e.path.length > 0 ? e.path.join(".") : "_root",
    message: e.message,
  }));
}

export function validate(schema: ZodTypeAny, target: Target = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      res.status(400).json({
        error:   "Validation failed",
        details: formatZodErrors(result.error),
      });
      return;
    }

    // Write parsed (coerced + stripped) data back so handlers see clean types.
    // Use Object.defineProperty to safely shadow accessor properties (e.g.
    // req.query is a getter in Express 5 and cannot be assigned directly).
    Object.defineProperty(req, target, {
      value:        result.data,
      writable:     true,
      enumerable:   true,
      configurable: true,
    });
    next();
  };
}
