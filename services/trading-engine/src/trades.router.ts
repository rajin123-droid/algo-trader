import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, tradesTable } from "@workspace/db";
import { simulateTrade } from "./engine.js";

export const tradesRouter: IRouter = Router();

tradesRouter.get("/trades", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const trades = await db
    .select()
    .from(tradesTable)
    .orderBy(desc(tradesTable.closeTime))
    .limit(limit)
    .offset(offset);

  res.json(trades);
});

tradesRouter.post("/trades/simulate", async (_req, res): Promise<void> => {
  const trade = await simulateTrade();
  res.status(201).json(trade);
});
