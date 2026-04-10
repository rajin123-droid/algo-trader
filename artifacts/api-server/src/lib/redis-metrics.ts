/**
 * Redis instrumentation — wraps Redis calls with:
 *   • Prometheus histogram (redis_command_duration_ms)
 *   • OpenTelemetry span (redis.<command>)
 *
 * Usage:
 *   const value = await tracedRedis('get', () => redis.get(key));
 *   await tracedRedis('xadd', () => redis.xadd(stream, '*', 'data', json));
 */

import { redisCommandDuration } from "../../../../services/observability/src/index.js";
import { tracedSpan } from "../../../../services/observability/src/index.js";

export async function tracedRedis<T>(
  command: string,
  fn:      () => Promise<T>
): Promise<T> {
  const end = redisCommandDuration.startTimer({ command });

  return tracedSpan(
    "redis",
    `redis.${command}`,
    async () => {
      try {
        return await fn();
      } finally {
        end();
      }
    },
    { "db.system": "redis", "db.operation": command }
  );
}
