import { Router, type IRouter } from "express";
import { getParams, updateParams } from "../lib/trading-engine";
import { UpdateParamsBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/params", async (req, res): Promise<void> => {
  const params = await getParams();
  if (!params) {
    res.status(404).json({ error: "Params not initialized" });
    return;
  }
  res.json(params);
});

router.patch("/params", async (req, res): Promise<void> => {
  const parsed = UpdateParamsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updated = await updateParams(parsed.data);
  if (!updated) {
    res.status(404).json({ error: "Params not found" });
    return;
  }
  res.json(updated);
});

export default router;
