import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { runUserBot, runAllBots } from "../lib/bot-runner.js";

const router: IRouter = Router();

/**
 * POST /api/bot/run
 * Run the SMA-crossover bot for the authenticated user.
 * Equivalent to Python: @app.post("/bot/run")
 */
router.post("/bot/run", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  try {
    const result = await runUserBot(userId);
    res.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bot run failed";
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/bot/run-all
 * Run bots for every active user (admin / internal use).
 * Requires authentication. Runs all users' bots in parallel.
 * Equivalent to Python: @app.post("/bot/run-all")
 */
router.post("/bot/run-all", requireAuth, async (_req, res): Promise<void> => {
  try {
    const results = await runAllBots();
    res.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bot run-all failed";
    res.status(500).json({ error: message });
  }
});

export default router;
