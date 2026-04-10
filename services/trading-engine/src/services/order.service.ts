import { logger } from "@workspace/logger";
import { Errors } from "@workspace/errors";
import { publish } from "@workspace/event-bus";
import type { Order } from "../models/order.model.js";
import type { CreateOrderDto, CancelOrderDto } from "../types/dto.js";
import type { OrderRepository } from "../repositories/order.repository.js";
import type { EventBus } from "../utils/event-bus.js";
import { ORDER_EVENTS } from "../events/order.events.js";

/**
 * OrderService — business logic for order lifecycle.
 *
 * Validates input, creates the DB record, emits ORDER_CREATED
 * on the internal EventBus (triggers ExecutionService), then
 * forwards the event to Redis Streams for cross-service consumers.
 *
 * Python equivalent:
 *   class OrderService:
 *     def create_order(self, input): validate → insert → emit
 */
export class OrderService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly eventBus: EventBus
  ) {}

  async createOrder(input: CreateOrderDto): Promise<Order> {
    if (!input.userId) throw Errors.validation("userId is required");
    if (!input.symbol) throw Errors.validation("symbol is required");
    if (!["BUY", "SELL"].includes(input.side)) throw Errors.validation("side must be BUY or SELL");
    if (!["MARKET", "LIMIT"].includes(input.type)) throw Errors.validation("type must be MARKET or LIMIT");
    if (input.quantity <= 0) throw Errors.validation("quantity must be > 0");
    if (input.type === "LIMIT" && !input.price) throw Errors.validation("price is required for LIMIT orders");

    const order: Order = {
      id: crypto.randomUUID(),
      userId: input.userId,
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      price: input.price,
      quantity: input.quantity,
      filledQuantity: 0,
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.orderRepo.create({
      id: order.id,
      userId: order.userId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      price: order.price !== undefined ? String(order.price) : null,
      quantity: String(order.quantity),
      filledQuantity: "0",
      status: order.status,
    });

    logger.info({ orderId: order.id, userId: order.userId, symbol: order.symbol, side: order.side, type: order.type }, "Order created");

    await this.eventBus.publish(ORDER_EVENTS.ORDER_CREATED, { order });

    await publish("ORDER_CREATED", {
      orderId: order.id,
      userId: order.userId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
    });

    return order;
  }

  async cancelOrder(input: CancelOrderDto): Promise<Order> {
    const existing = await this.orderRepo.findById(input.orderId);

    if (!existing) throw Errors.notFound("Order not found");
    if (existing.userId !== input.userId) throw Errors.forbidden("Not your order");
    if (["FILLED", "CANCELLED"].includes(existing.status)) {
      throw Errors.validation(`Cannot cancel an order with status ${existing.status}`);
    }

    const updated = await this.orderRepo.cancel(input.orderId, input.userId);
    if (!updated) throw Errors.internal("Cancel failed");

    logger.info({ orderId: input.orderId }, "Order cancelled");

    await this.eventBus.publish(ORDER_EVENTS.ORDER_CANCELLED, { orderId: input.orderId, userId: input.userId });
    await publish("ORDER_CANCELLED", { orderId: input.orderId, userId: input.userId });

    return updated;
  }

  async getUserOrders(userId: string, limit = 50): Promise<Order[]> {
    return this.orderRepo.findByUserId(userId, limit);
  }

  async getOrder(id: string, userId: string): Promise<Order> {
    const order = await this.orderRepo.findById(id);
    if (!order) throw Errors.notFound("Order not found");
    if (order.userId !== userId) throw Errors.forbidden("Not your order");
    return order;
  }
}
