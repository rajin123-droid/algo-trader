import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/db";
import { requireAuth } from "./middleware.js";
import { encrypt, safeDecrypt } from "./encryption.js";

export const keysRouter: IRouter = Router();

keysRouter.get("/keys/binance", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  const [row] = await db
    .select({
      id: apiKeysTable.id,
      testnet: apiKeysTable.testnet,
      apiKey: apiKeysTable.apiKey,
      createdAt: apiKeysTable.createdAt,
    })
    .from(apiKeysTable)
    .where(
      and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.exchange, "binance"))
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "No Binance keys configured" });
    return;
  }

  const raw = safeDecrypt(row.apiKey);
  const prefix = raw.slice(0, 8) + "…";

  res.json({ id: row.id, testnet: row.testnet, apiKeyPrefix: prefix, createdAt: row.createdAt });
});

keysRouter.post("/keys/binance", requireAuth, async (req, res): Promise<void> => {
  const { apiKey, apiSecret, testnet = true } = req.body ?? {};
  const userId = req.userId!;

  if (!apiKey || !apiSecret) {
    res.status(400).json({ error: "apiKey and apiSecret are required" });
    return;
  }

  const encKey = encrypt(apiKey);
  const encSecret = encrypt(apiSecret);

  await db
    .delete(apiKeysTable)
    .where(
      and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.exchange, "binance"))
    );

  const [row] = await db
    .insert(apiKeysTable)
    .values({ userId, exchange: "binance", apiKey: encKey, apiSecret: encSecret, testnet })
    .returning({ id: apiKeysTable.id, testnet: apiKeysTable.testnet, createdAt: apiKeysTable.createdAt });

  res.status(201).json({ msg: "Keys saved", id: row.id, testnet: row.testnet });
});

keysRouter.delete("/keys/binance", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  await db
    .delete(apiKeysTable)
    .where(
      and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.exchange, "binance"))
    );

  res.json({ msg: "Keys deleted" });
});
