import { Router, type IRouter } from "express";
import { on } from "@workspace/event-bus";
import { requireAuth } from "../../auth-service/src/middleware.js";
import type { EventType } from "@workspace/event-bus";

export const notificationRouter: IRouter = Router();

interface StoredNotification {
  id: string;
  userId: number;
  type: EventType;
  message: string;
  read: boolean;
  createdAt: string;
}

const store = new Map<number, StoredNotification[]>();

function addNotification(userId: number, type: EventType, message: string) {
  const list = store.get(userId) ?? [];
  list.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId,
    type,
    message,
    read: false,
    createdAt: new Date().toISOString(),
  });
  store.set(userId, list.slice(0, 100));
}

on<{ userId: number; symbol: string; pnl: number }>("ORDER_FILLED", async (data) => {
  addNotification(data.userId, "ORDER_FILLED", `Trade closed on ${data.symbol}: PnL $${data.pnl.toFixed(2)}`);
});

on<{ userId: number; symbol: string; signal: string }>("BOT_SIGNAL", async (data) => {
  addNotification(data.userId, "BOT_SIGNAL", `Bot signal: ${data.signal} on ${data.symbol}`);
});

notificationRouter.get("/notifications", requireAuth, (req, res) => {
  const userId = req.userId!;
  const notifications = store.get(userId) ?? [];
  res.json(notifications);
});

notificationRouter.patch("/notifications/:id/read", requireAuth, (req, res) => {
  const userId = req.userId!;
  const list = store.get(userId) ?? [];
  const n = list.find((x) => x.id === req.params.id);
  if (n) n.read = true;
  res.json({ ok: true });
});

notificationRouter.delete("/notifications", requireAuth, (req, res) => {
  store.delete(req.userId!);
  res.json({ ok: true });
});
