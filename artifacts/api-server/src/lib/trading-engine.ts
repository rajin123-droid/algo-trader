import { db, tradesTable, aiParamsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "./logger";
import { publishTrade, publishCandleUpdate } from "./ws-publisher.js";
import { processTrade } from "./candle.service.js";

let currentBalance = 10000;

export async function ensureParams() {
  const existing = await db.select().from(aiParamsTable).limit(1);
  if (existing.length === 0) {
    await db.insert(aiParamsTable).values({ minScore: 0.65, riskPerTrade: 0.01 });
  }
}

export async function getParams() {
  const [params] = await db.select().from(aiParamsTable).limit(1);
  return params;
}

export async function updateParams(updates: { minScore?: number; riskPerTrade?: number }) {
  const params = await getParams();
  if (!params) return null;
  const [updated] = await db
    .update(aiParamsTable)
    .set(updates)
    .where(eq(aiParamsTable.id, params.id))
    .returning();
  return updated;
}

export function analyzePerformance(trades: { result: string; pnl: number }[]) {
  if (trades.length === 0) {
    return { winRate: 0, avgPnl: 0 };
  }
  const wins = trades.filter((t) => t.result === "WIN").length;
  const winRate = wins / trades.length;
  const avgPnl = trades.reduce((a, t) => a + t.pnl, 0) / trades.length;
  return { winRate, avgPnl };
}

export async function tuneParams() {
  const trades = await db.select({ result: tradesTable.result, pnl: tradesTable.pnl }).from(tradesTable);
  if (trades.length < 3) return;

  const { winRate } = analyzePerformance(trades);
  const params = await getParams();
  if (!params) return;

  let newMinScore = params.minScore;
  if (winRate < 0.45) newMinScore += 0.05;
  if (winRate > 0.6) newMinScore -= 0.05;
  newMinScore = Math.max(0.6, Math.min(0.8, newMinScore));

  if (newMinScore !== params.minScore) {
    await updateParams({ minScore: newMinScore });
    logger.info({ oldMinScore: params.minScore, newMinScore }, "AI tuned minScore");
  }
}

export async function simulateTrade() {
  const params = await getParams();
  if (!params) {
    await ensureParams();
    return simulateTrade();
  }

  const direction = Math.random() > 0.5 ? "LONG" : "SHORT";
  const basePrice = 40000 + Math.random() * 5000;
  const volatility = basePrice * 0.02;
  const score = 0.5 + Math.random() * 0.5;

  const isWin = score >= params.minScore && Math.random() > 0.35;

  let entry: number, exit: number, stopLoss: number, takeProfit: number;

  if (direction === "LONG") {
    entry = basePrice;
    stopLoss = entry - volatility;
    takeProfit = entry + volatility * 2;
    exit = isWin ? entry + volatility * (0.5 + Math.random() * 1.5) : entry - volatility * (0.3 + Math.random() * 0.7);
  } else {
    entry = basePrice;
    stopLoss = entry + volatility;
    takeProfit = entry - volatility * 2;
    exit = isWin ? entry - volatility * (0.5 + Math.random() * 1.5) : entry + volatility * (0.3 + Math.random() * 0.7);
  }

  const size = currentBalance * params.riskPerTrade;
  const pnl = direction === "LONG" ? (exit - entry) * (size / entry) : (entry - exit) * (size / entry);
  const result = pnl > 0 ? "WIN" : "LOSS";

  currentBalance += pnl;

  const openTime = new Date(Date.now() - Math.random() * 3600000);
  const closeTime = new Date();

  const [trade] = await db
    .insert(tradesTable)
    .values({
      entry,
      exit,
      stopLoss,
      takeProfit,
      size,
      pnl,
      result,
      direction,
      score,
      openTime,
      closeTime,
    })
    .returning();

  await tuneParams();

  publishTrade({
    symbol: "BTCUSDT",
    side: direction === "LONG" ? "BUY" : "SELL",
    price: exit,
    quantity: size / exit,
    orderId: String(trade.id),
    userId: "bot",
    executedAt: closeTime,
  }).catch(() => {});

  for (const interval of ["1m", "5m", "15m", "1h"]) {
    const candle = processTrade(
      { symbol: "BTCUSDT", price: exit, quantity: size / exit, timestamp: closeTime.getTime() },
      interval
    );
    publishCandleUpdate("BTCUSDT", interval, candle).catch(() => {});
  }

  logger.info({ tradeId: trade.id, result, pnl: pnl.toFixed(2), direction }, "Trade simulated");
  return trade;
}

export async function getDashboardSummary() {
  const trades = await db.select().from(tradesTable).orderBy(desc(tradesTable.closeTime));

  const totalTrades = trades.length;
  const winCount = trades.filter((t) => t.result === "WIN").length;
  const lossCount = totalTrades - winCount;
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
  const pnls = trades.map((t) => t.pnl);
  const bestTrade = pnls.length > 0 ? Math.max(...pnls) : 0;
  const worstTrade = pnls.length > 0 ? Math.min(...pnls) : 0;

  let currentStreak = 0;
  let streakType: "WIN" | "LOSS" | "NONE" = "NONE";
  if (trades.length > 0) {
    streakType = trades[0].result as "WIN" | "LOSS";
    for (const t of trades) {
      if (t.result === streakType) currentStreak++;
      else break;
    }
  }

  const lastTrade = trades[0] || null;

  await recalcBalance();

  return {
    balance: currentBalance,
    totalPnl,
    winRate,
    totalTrades,
    winCount,
    lossCount,
    avgPnl,
    bestTrade,
    worstTrade,
    currentStreak,
    streakType,
    lastSignalDirection: lastTrade?.direction ?? null,
    lastSignalTime: lastTrade?.closeTime?.toISOString() ?? null,
  };
}

async function recalcBalance() {
  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${tradesTable.pnl}), 0)` })
    .from(tradesTable);
  currentBalance = 10000 + (result[0]?.total ?? 0);
}

export async function getTradeStats() {
  const trades = await db.select().from(tradesTable);

  const wins = trades.filter((t) => t.result === "WIN");
  const losses = trades.filter((t) => t.result === "LOSS");
  const longs = trades.filter((t) => t.direction === "LONG");
  const shorts = trades.filter((t) => t.direction === "SHORT");

  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;

  let peak = 10000;
  let maxDrawdown = 0;
  let bal = 10000;
  for (const t of trades) {
    bal += t.pnl;
    if (bal > peak) peak = bal;
    const dd = (peak - bal) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    avgWin,
    avgLoss,
    profitFactor,
    maxDrawdown: maxDrawdown * 100,
    longCount: longs.length,
    shortCount: shorts.length,
    longWinRate: longs.length > 0 ? (longs.filter((t) => t.result === "WIN").length / longs.length) * 100 : 0,
    shortWinRate: shorts.length > 0 ? (shorts.filter((t) => t.result === "WIN").length / shorts.length) * 100 : 0,
  };
}

export async function getPerformanceMetrics() {
  const trades = await db.select().from(tradesTable).orderBy(tradesTable.closeTime);
  const params = await getParams();

  const { winRate, avgPnl } = analyzePerformance(trades);

  const pnls = trades.map((t) => t.pnl);
  const mean = pnls.length > 0 ? pnls.reduce((s, p) => s + p, 0) / pnls.length : 0;
  const variance = pnls.length > 1 ? pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (pnls.length - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

  let peak = 10000;
  let maxDrawdown = 0;
  let bal = 10000;
  for (const t of trades) {
    bal += t.pnl;
    if (bal > peak) peak = bal;
    const dd = (peak - bal) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const totalReturn = trades.length > 0 ? ((bal - 10000) / 10000) * 100 : 0;

  let tradesPerDay = 0;
  if (trades.length > 1) {
    const first = trades[0].closeTime.getTime();
    const last = trades[trades.length - 1].closeTime.getTime();
    const days = Math.max((last - first) / 86400000, 1);
    tradesPerDay = trades.length / days;
  }

  let avgHoldTime = 0;
  if (trades.length > 0) {
    const totalHold = trades.reduce((s, t) => s + (t.closeTime.getTime() - t.openTime.getTime()), 0);
    avgHoldTime = totalHold / trades.length / 60000;
  }

  return {
    winRate: winRate * 100,
    avgPnl,
    sharpeRatio,
    maxDrawdown: maxDrawdown * 100,
    totalReturn,
    tradesPerDay,
    avgHoldTime,
    currentParams: {
      minScore: params?.minScore ?? 0.65,
      riskPerTrade: params?.riskPerTrade ?? 0.01,
      updatedAt: params?.updatedAt?.toISOString() ?? new Date().toISOString(),
    },
  };
}

export async function getEquityCurve() {
  const trades = await db.select().from(tradesTable).orderBy(tradesTable.closeTime);
  let balance = 10000;
  const points = [{ timestamp: new Date(Date.now() - 86400000).toISOString(), balance: 10000, pnl: 0 }];

  for (const t of trades) {
    balance += t.pnl;
    points.push({
      timestamp: t.closeTime.toISOString(),
      balance,
      pnl: t.pnl,
    });
  }

  return points;
}

export async function initEngine() {
  await ensureParams();
  await recalcBalance();
  logger.info({ balance: currentBalance }, "Trading engine initialized");
}
