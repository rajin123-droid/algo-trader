/**
 * Portfolio Service
 *
 * Responsibilities:
 *   - Position lifecycle (open / close / list)
 *   - PnL calculation (unrealized + realized)
 *   - Balance tracking
 *   - Subscribes to ORDER_FILLED events to update balances
 *
 * Exports an Express Router that the api-gateway mounts at /api.
 */

export { positionsRouter } from "./positions.router.js";
