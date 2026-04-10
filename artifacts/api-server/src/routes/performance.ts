import { Router, type IRouter } from "express";
import { getPerformanceMetrics, getEquityCurve } from "../lib/trading-engine";

const router: IRouter = Router();

router.get("/performance", async (req, res): Promise<void> => {
  const metrics = await getPerformanceMetrics();
  res.json(metrics);
});

router.get("/performance/equity-curve", async (req, res): Promise<void> => {
  const curve = await getEquityCurve();
  res.json(curve);
});

export default router;
