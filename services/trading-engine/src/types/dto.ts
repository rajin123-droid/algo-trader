import type { OrderSide, OrderType } from "../models/order.model.js";

/** Payload accepted by POST /orders */
export interface CreateOrderDto {
  userId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
}

/** Payload accepted by PATCH /orders/:id/cancel */
export interface CancelOrderDto {
  orderId: string;
  userId: string;
}

/** Payload for updating order fill state */
export interface FillOrderDto {
  orderId: string;
  filledQuantity: number;
  price: number;
}
