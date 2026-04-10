import { pgTable, serial, real, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  entry: real("entry").notNull(),
  exit: real("exit").notNull(),
  stopLoss: real("stop_loss").notNull(),
  takeProfit: real("take_profit").notNull(),
  size: real("size").notNull(),
  pnl: real("pnl").notNull(),
  result: text("result").notNull(),
  direction: text("direction").notNull(),
  score: real("score").notNull(),
  openTime: timestamp("open_time", { withTimezone: true }).notNull().defaultNow(),
  closeTime: timestamp("close_time", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, createdAt: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
