/**
 * Analytics Service
 *
 * Responsibilities:
 *   - Performance metrics (win rate, Sharpe, max drawdown, etc.)
 *   - Equity curve generation
 *   - Dashboard summary
 *   - AI parameter auto-tuning
 *   - Stats reports
 *
 * Exports an Express Router that the api-gateway mounts at /api.
 */

export { analyticsRouter } from "./analytics.router.js";
