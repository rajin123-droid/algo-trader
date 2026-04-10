import { Router, type IRouter } from "express";
import { requireAuth } from "../../auth-service/src/middleware.js";
import { runUserBot, runAllBots } from "./bot-runner.js";

export const botRouter: IRouter = Router();

botRouter.post("/bot/run", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;
  try {
    const result = await runUserBot(userId);
    res.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bot run failed";
    res.status(500).json({ error: message });
  }
});

botRouter.post("/bot/run-all", requireAuth, async (_req, res): Promise<void> => {
  try {
    const results = await runAllBots();
    res.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bot run-all failed";
    res.status(500).json({ error: message });
  }
});
