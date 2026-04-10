/**
 * MarketplaceManager
 *
 * Single adapter that owns all DB operations for:
 *   • Strategy listings (publish / list / update)
 *   • Subscriptions (subscribe / cancel)
 *   • Copy trading (fan-out leader trades to followers)
 *   • Revenue distribution (performance fee events)
 */

import { db } from "@workspace/db";
import {
  strategyListingsTable,
  strategySubscriptionsTable,
  copyTradesTable,
  revenueEventsTable,
  type NewStrategyListing,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "./logger.js";
import { LedgerService } from "./ledger-service.js";
import { getOrCreateAccount } from "./risk-check.js";

import {
  type PublishParams,
  type SubscribeParams,
} from "../../../../services/marketplace/src/index.js";
import {
  computeAllocations,
  type LeaderTrade,
} from "../../../../services/copy-trading/src/index.js";
import { calculateFee, qualifiesForFee } from "../../../../services/revenue/src/index.js";

/* ═══════════════════════════════════════════════════════════════════════════
   MARKETPLACE
═══════════════════════════════════════════════════════════════════════════ */

export class MarketplaceManager {
  /* ── Listings ─────────────────────────────────────────────────────────── */

  async listStrategies(filters?: { creatorId?: string; symbol?: string }) {
    let rows = await db
      .select()
      .from(strategyListingsTable)
      .where(and(eq(strategyListingsTable.isPublic, true), eq(strategyListingsTable.isActive, true)))
      .orderBy(desc(strategyListingsTable.subscriberCount));

    if (filters?.creatorId) rows = rows.filter((r) => r.creatorId === filters.creatorId);
    if (filters?.symbol)    rows = rows.filter((r) => r.symbol === filters.symbol!.toUpperCase());
    return rows;
  }

  async getListing(id: string) {
    const [row] = await db
      .select()
      .from(strategyListingsTable)
      .where(eq(strategyListingsTable.id, id));
    return row ?? null;
  }

  async publishStrategy(params: PublishParams) {
    const id = crypto.randomUUID();
    const values: NewStrategyListing = {
      id,
      creatorId:      params.creatorId,
      strategyId:     params.strategyId,
      strategyParams: JSON.stringify(params.strategyParams),
      name:           params.name,
      description:    params.description,
      symbol:         (params.symbol  ?? "BTCUSDT").toUpperCase(),
      interval:       params.interval ?? "1h",
      pricePerMonth:  params.pricePerMonth  ?? 0,
      performanceFee: params.performanceFee ?? 0.20,
      isPublic:       true,
      isActive:       true,
    };

    const [row] = await db.insert(strategyListingsTable).values(values).returning();
    logger.info({ listingId: id, name: params.name }, "Strategy published");
    return row;
  }

  async updateListing(
    id:        string,
    creatorId: string,
    patch:     Partial<Pick<NewStrategyListing, "name" | "description" | "pricePerMonth" | "isPublic" | "isActive">>
  ) {
    const [row] = await db
      .update(strategyListingsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(strategyListingsTable.id, id), eq(strategyListingsTable.creatorId, creatorId)))
      .returning();
    return row ?? null;
  }

  async findListingByCreatorAndStrategy(creatorId: string, strategyId: string) {
    const [row] = await db
      .select()
      .from(strategyListingsTable)
      .where(
        and(
          eq(strategyListingsTable.creatorId, creatorId),
          eq(strategyListingsTable.strategyId, strategyId),
          eq(strategyListingsTable.isActive, true)
        )
      );
    return row ?? null;
  }

  private async updatePerformance(listingId: string, pnl: number, isWin: boolean) {
    const listing = await this.getListing(listingId);
    if (!listing) return;
    const total    = listing.totalTrades + 1;
    const newPnl   = listing.performancePnl + pnl;
    const winRate  = isWin
      ? (listing.performanceWinRate * (total - 1) + 1) / total
      : (listing.performanceWinRate * (total - 1))     / total;
    await db
      .update(strategyListingsTable)
      .set({ performancePnl: newPnl, performanceWinRate: winRate, totalTrades: total, updatedAt: new Date() })
      .where(eq(strategyListingsTable.id, listingId));
  }

  /* ── Subscriptions ────────────────────────────────────────────────────── */

  async subscribe(params: SubscribeParams) {
    const listing = await this.getListing(params.listingId);
    if (!listing) throw new Error(`Listing ${params.listingId} not found`);
    if (!listing.isActive) throw new Error("This strategy is no longer active");

    // ── Billing: deduct subscription fee & capture real follower balance ──────
    let followerBalance = params.followerBalanceSnapshot ?? 10_000;

    // Resolve follower's real USDT balance whenever possible
    const userAccount = await getOrCreateAccount(params.userId, "USDT");
    const userBalance = await LedgerService.getAccountBalance(userAccount).catch(() => 0);
    if (userBalance > 0) followerBalance = userBalance;

    if (listing.pricePerMonth > 0) {
      if (userBalance < listing.pricePerMonth) {
        throw new Error(
          `Insufficient USDT balance: need ${listing.pricePerMonth.toFixed(2)}, have ${userBalance.toFixed(2)}`
        );
      }

      const creatorAccount = await getOrCreateAccount(listing.creatorId, "USDT");
      const amtStr         = listing.pricePerMonth.toFixed(8);

      await LedgerService.postTransaction({
        type: "ADJUSTMENT",
        note: `Subscription payment for "${listing.name}" (id=${listing.id})`,
        entries: [
          { accountId: userAccount,    side: "CREDIT", amount: amtStr }, // user pays
          { accountId: creatorAccount, side: "DEBIT",  amount: amtStr }, // creator receives
        ],
      });

      // Adjust snapshot to post-payment balance for accurate copy sizing
      followerBalance = Math.max(0, userBalance - listing.pricePerMonth);

      logger.info(
        { userId: params.userId, listingId: params.listingId, amount: listing.pricePerMonth },
        "Subscription payment deducted"
      );
    }

    const [sub] = await db
      .insert(strategySubscriptionsTable)
      .values({
        userId:                  params.userId,
        listingId:               params.listingId,
        copyRatio:               params.copyRatio ?? 1.0,
        followerBalanceSnapshot: followerBalance,
        maxLossLimit:            params.maxLossLimit ?? 0,
        status:                  "ACTIVE",
      })
      .returning();

    await db
      .update(strategyListingsTable)
      .set({ subscriberCount: listing.subscriberCount + 1, updatedAt: new Date() })
      .where(eq(strategyListingsTable.id, params.listingId));

    logger.info({ userId: params.userId, listingId: params.listingId }, "Subscribed to strategy");
    return sub;
  }

  async cancel(subscriptionId: number, userId: string) {
    const [row] = await db
      .update(strategySubscriptionsTable)
      .set({ status: "CANCELLED", cancelledAt: new Date() })
      .where(
        and(
          eq(strategySubscriptionsTable.id, subscriptionId),
          eq(strategySubscriptionsTable.userId, userId)
        )
      )
      .returning();

    if (row) {
      const listing = await this.getListing(row.listingId);
      if (listing && listing.subscriberCount > 0) {
        await db
          .update(strategyListingsTable)
          .set({ subscriberCount: listing.subscriberCount - 1, updatedAt: new Date() })
          .where(eq(strategyListingsTable.id, row.listingId));
      }
    }
    return row ?? null;
  }

  async getUserSubscriptions(userId: string) {
    return db
      .select()
      .from(strategySubscriptionsTable)
      .where(eq(strategySubscriptionsTable.userId, userId))
      .orderBy(desc(strategySubscriptionsTable.createdAt));
  }

  private async getActiveSubscribers(listingId: string) {
    return db
      .select()
      .from(strategySubscriptionsTable)
      .where(
        and(
          eq(strategySubscriptionsTable.listingId, listingId),
          eq(strategySubscriptionsTable.status, "ACTIVE")
        )
      );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COPY TRADING
  ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Called after every successfully executed auto-trade.
   * Fans out to all active subscribers of the matching listing.
   */
  async onLeaderTrade(trade: LeaderTrade): Promise<void> {
    const subscribers = await this.getActiveSubscribers(trade.listingId);
    if (subscribers.length === 0) return;

    logger.info(
      { listingId: trade.listingId, signal: trade.signal, followers: subscribers.length },
      "Fanning out leader trade to followers"
    );

    const allocations = computeAllocations(trade, subscribers);

    for (const alloc of allocations) {
      const copyTradeId = crypto.randomUUID();

      if (alloc.isSuspended) {
        // Suspend the subscription
        await db
          .update(strategySubscriptionsTable)
          .set({ status: "SUSPENDED" })
          .where(eq(strategySubscriptionsTable.id, alloc.subscriptionId));

        await db.insert(copyTradesTable).values({
          id:             copyTradeId,
          subscriptionId: alloc.subscriptionId,
          listingId:      trade.listingId,
          leaderId:       trade.leaderId,
          followerId:     alloc.followerId,
          signal:         trade.signal,
          leaderSize:     trade.leaderSize,
          followerSize:   0,
          executionPrice: trade.executionPrice,
          pnl:            null,
          status:         "SUSPENDED",
          failureReason:  alloc.suspendReason ?? "Max loss limit reached",
        });
        logger.warn({ subscriptionId: alloc.subscriptionId, followerId: alloc.followerId }, "Subscription suspended — max loss");
        continue;
      }

      // Persist copy trade
      await db.insert(copyTradesTable).values({
        id:             copyTradeId,
        subscriptionId: alloc.subscriptionId,
        listingId:      trade.listingId,
        leaderId:       trade.leaderId,
        followerId:     alloc.followerId,
        signal:         trade.signal,
        leaderSize:     trade.leaderSize,
        followerSize:   alloc.followerSize,
        executionPrice: trade.executionPrice,
        pnl:            alloc.followerPnl,
        status:         "EXECUTED",
      });

      // Update subscription cumulative P&L
      if (alloc.followerPnl != null) {
        const sub = subscribers.find((s) => s.id === alloc.subscriptionId)!;
        await db
          .update(strategySubscriptionsTable)
          .set({ cumulativePnl: sub.cumulativePnl + alloc.followerPnl })
          .where(eq(strategySubscriptionsTable.id, alloc.subscriptionId));
      }

      // Revenue distribution on profitable SELL
      if (qualifiesForFee(trade.signal, alloc.followerPnl)) {
        const listingRow = await this.getListing(trade.listingId);
        const feeRate    = listingRow?.performanceFee ?? 0.20;
        const breakdown  = calculateFee(alloc.followerPnl!, feeRate);

        await db.insert(revenueEventsTable).values({
          id:            crypto.randomUUID(),
          copyTradeId,
          listingId:     trade.listingId,
          creatorId:     trade.leaderId,
          followerId:    alloc.followerId,
          grossProfit:   breakdown.grossProfit,
          feeRate:       breakdown.feeRate,
          feeAmount:     breakdown.feeAmount,
          creatorShare:  breakdown.creatorShare,
          platformShare: breakdown.platformShare,
        });

        await this.updatePerformance(trade.listingId, alloc.followerPnl!, alloc.followerPnl! > 0);

        logger.info(
          { copyTradeId, feeAmount: breakdown.feeAmount, creatorShare: breakdown.creatorShare },
          "Revenue distributed"
        );
      }

      logger.info(
        { copyTradeId, followerId: alloc.followerId, signal: trade.signal, followerSize: alloc.followerSize },
        "Copy trade executed"
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     REVENUE QUERIES
  ═══════════════════════════════════════════════════════════════════════ */

  async revenueEvents(listingId: string) {
    return db
      .select()
      .from(revenueEventsTable)
      .where(eq(revenueEventsTable.listingId, listingId));
  }

  async creatorEarnings(creatorId: string, listingId?: string) {
    const rows = await db
      .select()
      .from(revenueEventsTable)
      .where(
        listingId
          ? and(eq(revenueEventsTable.creatorId, creatorId), eq(revenueEventsTable.listingId, listingId))
          : eq(revenueEventsTable.creatorId, creatorId)
      );
    return rows.reduce((sum, r) => sum + (r.creatorShare ?? 0), 0);
  }

  async platformRevenue(listingId?: string) {
    const rows = await db
      .select()
      .from(revenueEventsTable)
      .where(listingId ? eq(revenueEventsTable.listingId, listingId) : undefined);
    return rows.reduce((sum, r) => sum + (r.platformShare ?? 0), 0);
  }

  async revenueSummary(creatorId: string, listingId?: string) {
    const [creatorEarnings, platformRevenue] = await Promise.all([
      this.creatorEarnings(creatorId, listingId),
      this.platformRevenue(listingId),
    ]);
    return { creatorEarnings, platformRevenue, total: creatorEarnings + platformRevenue };
  }

  /* ── Copy trade queries ───────────────────────────────────────────────── */

  async getCopyTradesForFollower(followerId: string) {
    return db
      .select()
      .from(copyTradesTable)
      .where(eq(copyTradesTable.followerId, followerId));
  }

  async getCopyTradesForListing(listingId: string) {
    return db
      .select()
      .from(copyTradesTable)
      .where(eq(copyTradesTable.listingId, listingId));
  }
}

export const marketplaceManager = new MarketplaceManager();
