/**
 * Event Bus — Redis Streams transport.
 *
 * Provides a publish/subscribe interface over Redis Streams.
 * Each event type maps to a stream key: "events:<type>"
 *
 * Usage:
 *   // Publisher (e.g. trading-engine):
 *   await publish("ORDER_CREATED", { orderId: "123", userId: 1, ... })
 *
 *   // Subscriber (e.g. portfolio-service):
 *   await subscribe("ORDER_FILLED", async (data) => {
 *     await updateBalance(data.userId, data.pnl)
 *   })
 */

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const GROUP = "algo-terminal";

let _pub: Redis | null = null;
let _sub: Redis | null = null;

function getPub(): Redis {
  if (!_pub) {
    _pub = new Redis(REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
    _pub.on("error", (err) => {
      console.error("[event-bus] Redis pub error:", err.message);
    });
  }
  return _pub;
}

function getSub(): Redis {
  if (!_sub) {
    _sub = new Redis(REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
    _sub.on("error", (err) => {
      console.error("[event-bus] Redis sub error:", err.message);
    });
  }
  return _sub;
}

export type EventType =
  | "ORDER_CREATED"
  | "ORDER_FILLED"
  | "ORDER_CANCELLED"
  | "POSITION_OPENED"
  | "POSITION_CLOSED"
  | "BALANCE_UPDATED"
  | "STATS_UPDATED"
  | "BOT_SIGNAL"
  | "ALERT_TRIGGERED";

export interface EventEnvelope<T = unknown> {
  type: EventType;
  timestamp: string;
  data: T;
}

/**
 * Publish an event to Redis Streams.
 * Falls back gracefully if Redis is unavailable.
 */
export async function publish<T>(type: EventType, data: T): Promise<void> {
  const envelope: EventEnvelope<T> = {
    type,
    timestamp: new Date().toISOString(),
    data,
  };

  const streamKey = `events:${type}`;
  const payload = JSON.stringify(envelope);

  try {
    const client = getPub();
    await client.connect().catch(() => {});
    await client.xadd(streamKey, "*", "payload", payload);
  } catch (err) {
    console.warn(`[event-bus] Failed to publish ${type}:`, (err as Error).message);
  }
}

type Handler<T = unknown> = (data: T) => Promise<void>;

const _handlers = new Map<EventType, Handler[]>();

/**
 * Register a handler for an event type.
 * Call `startConsuming()` after registering all handlers.
 */
export function on<T>(type: EventType, handler: Handler<T>): void {
  const existing = _handlers.get(type) ?? [];
  _handlers.set(type, [...existing, handler as Handler]);
}

/**
 * Start consuming all registered event streams.
 * Creates consumer groups if they don't exist, then polls XREADGROUP.
 */
export async function startConsuming(
  consumerName = `consumer-${process.pid}`
): Promise<void> {
  if (_handlers.size === 0) return;

  const client = getSub();
  try {
    await client.connect().catch(() => {});
  } catch {
    console.warn("[event-bus] Redis not available — event bus disabled");
    return;
  }

  for (const type of _handlers.keys()) {
    const streamKey = `events:${type}`;
    await client
      .xgroup("CREATE", streamKey, GROUP, "$", "MKSTREAM")
      .catch(() => {});
  }

  const streamKeys = [..._handlers.keys()].map((t) => `events:${t}`);
  const ids = streamKeys.map(() => ">");

  const poll = async () => {
    try {
      const results = await client.xreadgroup(
        "GROUP",
        GROUP,
        consumerName,
        "COUNT",
        100,
        "BLOCK",
        1000,
        "STREAMS",
        ...streamKeys,
        ...ids
      );

      if (results) {
        for (const [stream, messages] of results as [string, [string, string[]][]][]) {
          const eventType = stream.replace("events:", "") as EventType;
          const handlers = _handlers.get(eventType) ?? [];

          for (const [id, fields] of messages) {
            const payloadIdx = fields.indexOf("payload");
            if (payloadIdx === -1) continue;

            const envelope = JSON.parse(fields[payloadIdx + 1]) as EventEnvelope;
            for (const handler of handlers) {
              await handler(envelope.data).catch((err: Error) => {
                console.error(`[event-bus] Handler error for ${eventType}:`, err.message);
              });
            }

            await client.xack(stream, GROUP, id);
          }
        }
      }
    } catch {
    }
    setTimeout(poll, 100);
  };

  poll();
  console.info("[event-bus] Redis Streams consumer started");
}

export async function shutdown(): Promise<void> {
  await _pub?.quit().catch(() => {});
  await _sub?.quit().catch(() => {});
}
