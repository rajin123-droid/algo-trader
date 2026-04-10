import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { encrypt, safeDecrypt } from "../lib/encryption.js";
import { validate, saveBinanceKeysSchema } from "../validation/index.js";

const router: IRouter = Router();

router.get("/keys/binance", requireAuth, async (req, res): Promise<void> => {
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
      and(
        eq(apiKeysTable.userId, userId),
        eq(apiKeysTable.exchange, "binance")
      )
    )
    .limit(1);

  if (!row) {
    res.json({ connected: false });
    return;
  }

  // Decrypt only enough to show the user a safe prefix — never return the full key.
  const plainKey = safeDecrypt(row.apiKey);

  res.json({
    connected: true,
    testnet: row.testnet,
    apiKeyPrefix: plainKey.slice(0, 6) + "…",
    createdAt: row.createdAt,
  });
});

router.put("/keys/binance", requireAuth, validate(saveBinanceKeysSchema), async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { apiKey, apiSecret, testnet } = req.body;

  const encryptedKey = encrypt(apiKey);
  const encryptedSecret = encrypt(apiSecret);

  const [existing] = await db
    .select({ id: apiKeysTable.id })
    .from(apiKeysTable)
    .where(
      and(
        eq(apiKeysTable.userId, userId),
        eq(apiKeysTable.exchange, "binance")
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(apiKeysTable)
      .set({
        apiKey: encryptedKey,
        apiSecret: encryptedSecret,
        testnet: Boolean(testnet),
      })
      .where(eq(apiKeysTable.id, existing.id));
  } else {
    await db.insert(apiKeysTable).values({
      userId,
      exchange: "binance",
      apiKey: encryptedKey,
      apiSecret: encryptedSecret,
      testnet: Boolean(testnet),
    });
  }

  res.json({ msg: "Keys saved securely", testnet: Boolean(testnet) });
});

router.delete("/keys/binance", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  await db
    .delete(apiKeysTable)
    .where(
      and(
        eq(apiKeysTable.userId, userId),
        eq(apiKeysTable.exchange, "binance")
      )
    );

  res.json({ msg: "Keys removed" });
});

export default router;
