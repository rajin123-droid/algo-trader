import { eq, desc } from "drizzle-orm";
import { db, tradeExecutionsTable } from "@workspace/db";
import type { TradeExecution } from "../models/trade-execution.model.js";
import type { NewTradeExecution } from "@workspace/db";

/**
 * TradeExecutionRepository — DB access for trade_executions.
 *
 * Each row is an individual fill event (price + qty at execution time).
 * One order can produce multiple executions for partial fills.
 */
export class TradeExecutionRepository {
  async create(execution: NewTradeExecution): Promise<TradeExecution> {
    const [row] = await db.insert(tradeExecutionsTable).values(execution).returning();
    return this.mapRow(row!);
  }

  async findByOrderId(orderId: string): Promise<TradeExecution[]> {
    const rows = await db
      .select()
      .from(tradeExecutionsTable)
      .where(eq(tradeExecutionsTable.orderId, orderId))
      .orderBy(desc(tradeExecutionsTable.executedAt));
    return rows.map(this.mapRow);
  }

  async findByUserId(userId: string, limit = 100): Promise<TradeExecution[]> {
    const rows = await db
      .select()
      .from(tradeExecutionsTable)
      .where(eq(tradeExecutionsTable.userId, userId))
      .orderBy(desc(tradeExecutionsTable.executedAt))
      .limit(limit);
    return rows.map(this.mapRow);
  }

  private mapRow(row: typeof tradeExecutionsTable.$inferSelect): TradeExecution {
    return {
      id: row.id,
      orderId: row.orderId,
      userId: row.userId,
      price: Number(row.price),
      quantity: Number(row.quantity),
      executedAt: row.executedAt!,
    };
  }
}
