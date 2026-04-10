import { Router, type IRouter } from "express";
import { getDashboardSummary } from "../lib/trading-engine";

const router: IRouter = Router();

router.get("/dashboard", async (req, res): Promise<void> => {
  const summary = await getDashboardSummary();
  res.json(summary);
});

export default router;
