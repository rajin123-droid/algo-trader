import { eq, and, desc } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import type { Order, OrderStatus } from "../models/order.model.js";
import type { NewOrder } from "@workspace/db";

/**
 * OrderRepository — all DB access for the orders table.
 *
 * Python equivalent:
 *   class OrderRepository:
 *     def create(self, order): db.insert(...)
 *     def find_by_id(self, id): db.select(...)
 *     def update_status(self, id, status): db.update(...)
 */
export class OrderRepository {
  async create(order: NewOrder): Promise<Order> {
    const [row] = await db.insert(ordersTable).values(order).returning();
    return this.mapRow(row!);
  }

  async findById(id: string): Promise<Order | null> {
    const [row] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, id))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findByUserId(userId: string, limit = 50): Promise<Order[]> {
    const rows = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.userId, userId))
      .orderBy(desc(ordersTable.createdAt))
      .limit(limit);
    return rows.map(this.mapRow);
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order | null> {
    const [row] = await db
      .update(ordersTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(ordersTable.id, id))
      .returning();
    return row ? this.mapRow(row) : null;
  }

  async updateFill(id: string, filledQuantity: number, status: OrderStatus): Promise<Order | null> {
    const [row] = await db
      .update(ordersTable)
      .set({ filledQuantity: String(filledQuantity), status, updatedAt: new Date() })
      .where(eq(ordersTable.id, id))
      .returning();
    return row ? this.mapRow(row) : null;
  }

  async cancel(id: string, userId: string): Promise<Order | null> {
    const [row] = await db
      .update(ordersTable)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(and(eq(ordersTable.id, id), eq(ordersTable.userId, userId)))
      .returning();
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: typeof ordersTable.$inferSelect): Order {
    return {
      id: row.id,
      userId: row.userId,
      symbol: row.symbol,
      side: row.side as Order["side"],
      type: row.type as Order["type"],
      price: row.price !== null ? Number(row.price) : undefined,
      quantity: Number(row.quantity),
      filledQuantity: Number(row.filledQuantity ?? 0),
      status: row.status as Order["status"],
      createdAt: row.createdAt!,
      updatedAt: row.updatedAt!,
    };
  }
}
