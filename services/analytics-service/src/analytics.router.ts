import { Router, type IRouter } from "express";
import { getDashboardSummary, getPerformanceMetrics, getEquityCurve, getParams, updateParams } from "../../trading-engine/src/engine.js";

export const analyticsRouter: IRouter = Router();

analyticsRouter.get("/dashboard", async (_req, res): Promise<void> => {
  const summary = await getDashboardSummary();
  res.json(summary);
});

analyticsRouter.get("/performance", async (_req, res): Promise<void> => {
  const metrics = await getPerformanceMetrics();
  res.json(metrics);
});

analyticsRouter.get("/performance/equity-curve", async (_req, res): Promise<void> => {
  const curve = await getEquityCurve();
  res.json(curve);
});

analyticsRouter.get("/params", async (_req, res): Promise<void> => {
  const params = await getParams();
  if (!params) {
    res.status(404).json({ error: "Params not initialized" });
    return;
  }
  res.json(params);
});

analyticsRouter.patch("/params", async (req, res): Promise<void> => {
  const { minScore, riskPerTrade } = req.body ?? {};
  const updated = await updateParams({ minScore, riskPerTrade });
  if (!updated) {
    res.status(404).json({ error: "Params not found" });
    return;
  }
  res.json(updated);
});
