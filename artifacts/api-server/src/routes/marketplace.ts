import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import { marketplaceManager } from "../lib/marketplace-manager.js";
import { db, copyTradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

/* ── Validation schemas ───────────────────────────────────────────────────── */

const publishSchema = z.object({
  strategyId:     z.string().min(1),
  strategyParams: z.record(z.string(), z.unknown()).optional().default({}),
  name:           z.string().min(2).max(120),
  description:    z.string().max(1000).optional().default(""),
  symbol:         z.string().optional(),
  interval:       z.string().optional(),
  pricePerMonth:  z.number().nonnegative().optional(),
  performanceFee: z.number().min(0).max(1).optional(),
});

const subscribeSchema = z.object({
  listingId:               z.string().min(1),
  copyRatio:               z.number().positive().max(5).optional(),
  followerBalanceSnapshot: z.number().positive().optional(),
  maxLossLimit:            z.number().nonnegative().optional(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   STRATEGY LISTINGS
═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/marketplace/strategies
 * List all public, active strategy listings.
 */
router.get("/marketplace/strategies", requireAuth, async (req, res) => {
  try {
    const { creatorId, symbol } = req.query as Record<string, string | undefined>;
    const listings = await marketplaceManager.listStrategies({ creatorId, symbol });
    res.json({ listings });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/marketplace/strategies/:id
 * Get a single listing.
 */
router.get("/marketplace/strategies/:id", requireAuth, async (req, res) => {
  try {
    const listing = await marketplaceManager.getListing(req.params.id);
    if (!listing) return void res.status(404).json({ error: "Listing not found" });
    res.json({ listing });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/marketplace/strategies
 * Publish a strategy to the marketplace.
 */
router.post("/marketplace/strategies", requireAuth, async (req, res) => {
  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: parsed.error.issues[0]?.message });
  }

  try {
    const listing = await marketplaceManager.publishStrategy({
      ...parsed.data,
      creatorId: String(req.userId!),
    });
    res.status(201).json({ listing });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/marketplace/strategies/:id
 * Update listing metadata (creator only).
 */
router.patch("/marketplace/strategies/:id", requireAuth, async (req, res) => {
  const creatorId = String(req.userId!);
  const { name, description, pricePerMonth, isPublic, isActive } = req.body;

  try {
    const listing = await marketplaceManager.updateListing(req.params.id, creatorId, {
      name,
      description,
      pricePerMonth,
      isPublic,
      isActive,
    });
    if (!listing) return void res.status(404).json({ error: "Listing not found or not yours" });
    res.json({ listing });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   SUBSCRIPTIONS
═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/marketplace/subscriptions
 * All subscriptions for the authenticated user.
 * Adds computed `isActive` boolean so the frontend doesn't need to know
 * the internal status string values.
 */
router.get("/marketplace/subscriptions", requireAuth, async (req, res) => {
  try {
    const subs = await marketplaceManager.getUserSubscriptions(String(req.userId!));
    res.json({
      subscriptions: subs.map((s) => ({
        ...s,
        isActive: s.status === "ACTIVE",
      })),
    });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/marketplace/subscriptions
 * Subscribe to a strategy.
 */
router.post("/marketplace/subscriptions", requireAuth, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: parsed.error.issues[0]?.message });
  }

  try {
    const sub = await marketplaceManager.subscribe({
      userId: String(req.userId!),
      ...parsed.data,
    });
    res.status(201).json({ subscription: { ...sub, isActive: sub.status === "ACTIVE" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

/**
 * DELETE /api/marketplace/subscriptions/:id
 * Cancel a subscription.
 */
router.delete("/marketplace/subscriptions/:id", requireAuth, async (req, res) => {
  const subscriptionId = Number(req.params.id);
  if (!Number.isInteger(subscriptionId)) {
    return void res.status(400).json({ error: "Invalid subscription ID" });
  }

  try {
    const sub = await marketplaceManager.cancel(subscriptionId, String(req.userId!));
    if (!sub) return void res.status(404).json({ error: "Subscription not found or not yours" });
    res.json({ subscription: sub });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   COPY TRADES
═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/marketplace/copy-trades
 * Copy trades where the caller is the follower.
 */
router.get("/marketplace/copy-trades", requireAuth, async (req, res) => {
  try {
    const trades = await marketplaceManager.getCopyTradesForFollower(
      String(req.userId!)
    );
    res.json({ copyTrades: trades });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/marketplace/strategies/:id/copy-trades
 * All copy trades for a listing (creator only).
 */
router.get("/marketplace/strategies/:id/copy-trades", requireAuth, async (req, res) => {
  try {
    const listing = await marketplaceManager.getListing(req.params.id);
    if (!listing) return void res.status(404).json({ error: "Listing not found" });

    if (listing.creatorId !== String(req.userId!)) {
      return void res.status(403).json({ error: "Only the creator can view all copy trades" });
    }

    const trades = await marketplaceManager.getCopyTradesForListing(req.params.id);
    res.json({ copyTrades: trades });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   REVENUE
═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/marketplace/revenue
 * Revenue summary for the authenticated creator.
 * Optional ?listingId= to scope to a single listing.
 */
router.get("/marketplace/revenue", requireAuth, async (req, res) => {
  try {
    const creatorId = String(req.userId!);
    const listingId = req.query.listingId as string | undefined;
    const summary   = await marketplaceManager.revenueSummary(creatorId, listingId);
    res.json({ revenue: summary });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/marketplace/strategies/:id/revenue
 * Detailed revenue events for a listing (creator only).
 */
router.get("/marketplace/strategies/:id/revenue", requireAuth, async (req, res) => {
  try {
    const listing = await marketplaceManager.getListing(req.params.id);
    if (!listing) return void res.status(404).json({ error: "Listing not found" });

    if (listing.creatorId !== String(req.userId!)) {
      return void res.status(403).json({ error: "Only the creator can view revenue" });
    }

    const events = await marketplaceManager.revenueEvents(req.params.id);
    res.json({ revenueEvents: events });
  } catch (err: unknown) {
    logger.error({ err, path: req.path }, "Unhandled route error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
