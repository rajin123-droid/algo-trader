/**
 * Order Queue — Redis Streams-backed order queue with in-memory fallback.
 *
 * Uses Redis XADD to enqueue orders and XREADGROUP + XACK to consume them.
 * Falls back to an in-memory EventEmitter queue when Redis is unavailable
 * (development / environments without Redis).
 *
 * Stream key: "orders"
 * Consumer group: "api-server"
 * Consumer name: "worker-{pid}"
 */

import { EventEmitter } from "events";
import { logger } from "./logger.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface QueuedOrder {
  orderId:  string;
  userId:   string;
  symbol:   string;
  side:     "BUY" | "SELL";
  size:     number;
  strategy?: string;
  source:   "AUTO_TRADING" | "SOR" | "MANUAL";
  enqueuedAt: number;
}

export interface DequeueResult {
  messageId: string;
  order:     QueuedOrder;
  ack:       () => Promise<void>;
}

/* ── In-memory fallback queue ─────────────────────────────────────────────── */

class InMemoryQueue extends EventEmitter {
  private queue: Array<{ messageId: string; order: QueuedOrder }> = [];
  private seq = 0;

  async enqueue(order: QueuedOrder): Promise<string> {
    const messageId = `${Date.now()}-${++this.seq}`;
    this.queue.push({ messageId, order });
    this.emit("message", messageId);
    return messageId;
  }

  async dequeue(): Promise<DequeueResult | null> {
    const item = this.queue.shift();
    if (!item) return null;
    return {
      messageId: item.messageId,
      order:     item.order,
      ack:       async () => { /* in-memory: no-op */ },
    };
  }

  get length() { return this.queue.length; }
}

/* ── Redis-backed queue ───────────────────────────────────────────────────── */

const STREAM_KEY     = "orders";
const CONSUMER_GROUP = "api-server";
const CONSUMER_NAME  = `worker-${process.pid}`;

class RedisOrderQueue {
  private redis: import("ioredis").Redis | null = null;
  private fallback = new InMemoryQueue();
  private useRedis = false;

  async init(): Promise<void> {
    try {
      const { default: Redis } = await import("ioredis");
      this.redis = new Redis({
        host:            process.env["REDIS_HOST"] ?? "127.0.0.1",
        port:            Number(process.env["REDIS_PORT"] ?? 6379),
        lazyConnect:     true,
        enableOfflineQueue: false,
        connectTimeout:  2_000,
      });

      await this.redis.connect();

      // Create consumer group (idempotent)
      try {
        await this.redis.xgroup("CREATE", STREAM_KEY, CONSUMER_GROUP, "$", "MKSTREAM");
      } catch {
        // Group already exists — ignore
      }

      this.useRedis = true;
      logger.info("Order queue: Redis Streams connected");
    } catch {
      logger.warn("Order queue: Redis unavailable, using in-memory fallback");
      this.useRedis = false;
    }
  }

  /* ── Enqueue ────────────────────────────────────────────────────────── */

  async enqueue(order: QueuedOrder): Promise<string> {
    if (this.useRedis && this.redis) {
      try {
        const messageId = await this.redis.xadd(
          STREAM_KEY,
          "*",
          "data",
          JSON.stringify(order)
        );
        logger.debug({ messageId, orderId: order.orderId }, "Order enqueued to Redis stream");
        return messageId!;
      } catch (err) {
        logger.error({ err }, "Redis XADD failed, falling back to in-memory");
      }
    }
    return this.fallback.enqueue(order);
  }

  /* ── Dequeue ────────────────────────────────────────────────────────── */

  async dequeue(timeoutMs = 5_000): Promise<DequeueResult | null> {
    if (this.useRedis && this.redis) {
      try {
        const results = await this.redis.xreadgroup(
          "GROUP", CONSUMER_GROUP, CONSUMER_NAME,
          "COUNT", "1",
          "BLOCK", String(timeoutMs),
          "STREAMS", STREAM_KEY, ">"
        );

        if (!results || results.length === 0) return null;

        const [_stream, messages] = results[0] as [string, [string, string[]][]];
        if (!messages || messages.length === 0) return null;

        const [messageId, fields] = messages[0]!;
        const dataIdx = fields.indexOf("data");
        const raw     = dataIdx >= 0 ? fields[dataIdx + 1] : null;
        const order   = raw ? (JSON.parse(raw) as QueuedOrder) : null;
        if (!order) return null;

        const redis = this.redis;
        return {
          messageId,
          order,
          ack: async () => {
            await redis!.xack(STREAM_KEY, CONSUMER_GROUP, messageId);
          },
        };
      } catch (err) {
        logger.error({ err }, "Redis XREADGROUP failed");
        return null;
      }
    }
    return this.fallback.dequeue();
  }

  /* ── Queue depth ─────────────────────────────────────────────────────── */

  async depth(): Promise<number> {
    if (this.useRedis && this.redis) {
      try {
        const info = await this.redis.xlen(STREAM_KEY);
        return info;
      } catch { /* fall through */ }
    }
    return this.fallback.length;
  }

  get isRedis() { return this.useRedis; }
}

/* ── Singleton ────────────────────────────────────────────────────────────── */

export const orderQueue = new RedisOrderQueue();

/** Call once at server startup. */
export async function initOrderQueue(): Promise<void> {
  await orderQueue.init();
}
