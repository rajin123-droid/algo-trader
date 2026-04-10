import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, tradesTable } from "@workspace/db";
import { simulateTrade, getTradeStats } from "../lib/trading-engine";
import {
  ListTradesQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trades", async (req, res): Promise<void> => {
  const parsed = ListTradesQueryParams.safeParse(req.query);
  const limit = parsed.success ? parsed.data.limit ?? 50 : 50;
  const offset = parsed.success ? parsed.data.offset ?? 0 : 0;

  const trades = await db
    .select()
    .from(tradesTable)
    .orderBy(desc(tradesTable.closeTime))
    .limit(limit)
    .offset(offset);

  res.json(trades);
});

router.post("/trades/simulate", async (req, res): Promise<void> => {
  const trade = await simulateTrade();
  res.status(201).json(trade);
});

router.get("/trades/stats", async (req, res): Promise<void> => {
  const stats = await getTradeStats();
  res.json(stats);
});

export default router;
