/**
 * validation/index.ts — Barrel export for the validation layer.
 *
 * Import the middleware and schemas from here instead of individual files.
 *
 * Usage:
 *   import { validate, openPositionSchema } from "../validation/index.js";
 *
 *   router.post("/positions/open",
 *     requireAuth,
 *     validate(openPositionSchema),
 *     handler
 *   );
 */

export { validate }                        from "./middleware.js";
export * from "./schemas/common.js";
export * from "./schemas/trade.schema.js";
export * from "./schemas/auto-trading.schema.js";
export * from "./schemas/keys.schema.js";
export * from "./schemas/auth.schema.js";
