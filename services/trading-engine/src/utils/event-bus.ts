/**
 * In-process EventBus for the trading engine.
 *
 * Used for fast, synchronous event routing within the service
 * (e.g. ORDER_CREATED → ExecutionService.handleOrderCreated).
 *
 * Cross-service events are forwarded to the Redis Streams
 * @workspace/event-bus after processing.
 */

type Handler<T = unknown> = (payload: T) => Promise<void>;

export class EventBus {
  private handlers: Map<string, Handler[]> = new Map();

  subscribe<T>(event: string, handler: Handler<T>): void {
    const existing = this.handlers.get(event) ?? [];
    this.handlers.set(event, [...existing, handler as Handler]);
  }

  async publish<T>(event: string, payload: T): Promise<void> {
    const handlers = this.handlers.get(event) ?? [];
    for (const handler of handlers) {
      await handler(payload);
    }
  }
}

export const engineEventBus = new EventBus();
