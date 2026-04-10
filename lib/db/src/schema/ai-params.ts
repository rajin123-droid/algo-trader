import { pgTable, serial, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiParamsTable = pgTable("ai_params", {
  id: serial("id").primaryKey(),
  minScore: real("min_score").notNull().default(0.65),
  riskPerTrade: real("risk_per_trade").notNull().default(0.01),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiParamsSchema = createInsertSchema(aiParamsTable).omit({ id: true, updatedAt: true });
export type InsertAiParams = z.infer<typeof insertAiParamsSchema>;
export type AiParams = typeof aiParamsTable.$inferSelect;
