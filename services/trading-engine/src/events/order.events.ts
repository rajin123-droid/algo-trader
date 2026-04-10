import type { Order } from "../models/order.model.js";
import type { TradeExecution } from "../models/trade-execution.model.js";

/**
 * Internal event types for the trading engine.
 *
 * These are emitted on the in-process EventBus (fast, synchronous).
 * Cross-service events (ORDER_FILLED → portfolio-service) are published
 * separately via the Redis Streams @workspace/event-bus.
 */
export const ORDER_EVENTS = {
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_FILLED: "ORDER_FILLED",
  ORDER_PARTIALLY_FILLED: "ORDER_PARTIALLY_FILLED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  ORDER_OPENED: "ORDER_OPENED",
} as const;

export type OrderEventType = (typeof ORDER_EVENTS)[keyof typeof ORDER_EVENTS];

export interface OrderCreatedPayload {
  order: Order;
}

export interface OrderFilledPayload {
  order: Order;
  execution: TradeExecution;
}

export interface OrderCancelledPayload {
  orderId: string;
  userId: string;
}
