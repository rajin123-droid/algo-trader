import { redis } from "../orderbook/redis-client.js";
import { logger } from "@workspace/logger";

/**
 * Idempotency guard for trade events.
 *
 * Prevents duplicate processing when:
 *   - An ORDER_CREATED event is delivered twice (Redis Streams retry)
 *   - A worker crashes mid-fill and the event is redelivered
 *   - Two workers race to process the same order (lock acquisition edge case)
 *
 * Redis key: `processed:{eventId}`  → "1"  (TTL 1 hour)
 *
 * Pattern:
 *   1. if (await isProcessed(event.id)) return;   ← early exit
 *   2. await processTrade(event);                  ← actual work
 *   3. await markProcessed(event.id);              ← mark done
 *
 * TTL strategy:
 *   1 hour covers any realistic retry window.
 *   After 1 hour the key expires → safe (no event system retries that old).
 *
 * Python equivalent:
 *   def is_processed(event_id):
 *     return redis.get(f"processed:{event_id}") is not None
 *
 *   def mark_processed(event_id):
 *     redis.set(f"processed:{event_id}", "1", ex=3600)
 *
 * Note: this is a best-effort guard, not a transaction.
 * For full exactly-once semantics, wrap DB writes in a transaction
 * and set the idempotency key atomically inside the same transaction.
 */

const PROCESSED_PREFIX = "processed:";
const PROCESSED_TTL_SEC = 3_600;

/**
 * Check whether this event ID has already been fully processed.
 * Returns true if it should be skipped (duplicate), false if it's new.
 */
export async function isProcessed(eventId: string): Promise<boolean> {
  try {
    const val = await redis.get(`${PROCESSED_PREFIX}${eventId}`);
    return val !== null;
  } catch (err) {
    logger.warn({ err, eventId }, "Idempotency check failed — assuming not processed");
    return false;
  }
}

/**
 * Mark this event ID as processed so future duplicates are dropped.
 * Idempotent — safe to call multiple times for the same event.
 */
export async function markProcessed(eventId: string): Promise<void> {
  try {
    await redis.set(`${PROCESSED_PREFIX}${eventId}`, "1", "EX", PROCESSED_TTL_SEC);
  } catch (err) {
    logger.warn({ err, eventId }, "Idempotency mark failed — duplicate delivery possible");
  }
}

/**
 * Atomic check-and-set using SET NX.
 * Returns true if we successfully claimed this event (i.e. we are first).
 * Returns false if another worker already processed it.
 *
 * Prefer this over the separate isProcessed + markProcessed calls when
 * you want strict exactly-once semantics (no TOCTOU window).
 *
 * Redis command: SET processed:{eventId} "1" NX EX 3600
 */
export async function claimEvent(eventId: string): Promise<boolean> {
  try {
    const result = await redis.set(
      `${PROCESSED_PREFIX}${eventId}`,
      "1",
      "NX",
      "EX",
      PROCESSED_TTL_SEC
    );
    return result === "OK";
  } catch (err) {
    logger.warn({ err, eventId }, "Idempotency claim failed — assuming not claimed");
    return true;
  }
}
