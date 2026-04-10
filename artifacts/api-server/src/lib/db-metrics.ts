/**
 * Database instrumentation — wraps Drizzle query calls with:
 *   • Prometheus histogram (db_query_duration_ms)
 *   • OpenTelemetry span (db.<operation>)
 *   • Error counter on failure
 *   • Slow query warning (> 200ms)
 *
 * Usage:
 *   const rows = await tracedDbQuery('select', 'users', () =>
 *     db.select().from(usersTable).where(eq(usersTable.id, id))
 *   );
 */

import { dbQueryDuration, dbErrorCounter } from "../../../../services/observability/src/index.js";
import { tracedSpan } from "../../../../services/observability/src/index.js";
import { logger } from "./logger.js";

const SLOW_QUERY_THRESHOLD_MS = 200;

/**
 * Wrap any async DB operation with metrics + tracing.
 *
 * @param operation  - Semantic verb: 'select', 'insert', 'update', 'delete'
 * @param table      - Primary table being queried (for label cardinality control)
 * @param fn         - The actual query
 */
export async function tracedDbQuery<T>(
  operation: string,
  table:     string,
  fn:        () => Promise<T>
): Promise<T> {
  const labels = { operation, table };
  const endHistogram = dbQueryDuration.startTimer(labels);
  const wallStart    = Date.now();

  return tracedSpan(
    "database",
    `db.${operation}`,
    async () => {
      try {
        const result = await fn();
        return result;
      } catch (err) {
        dbErrorCounter.inc({ operation });
        throw err;
      } finally {
        endHistogram();
        const ms = Date.now() - wallStart;
        if (ms > SLOW_QUERY_THRESHOLD_MS) {
          logger.warn({ operation, table, durationMs: ms }, "Slow database query");
        }
      }
    },
    { "db.operation": operation, "db.table": table }
  );
}
