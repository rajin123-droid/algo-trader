export interface User {
  id: number;
  email: string;
  plan: string;
  isActive: boolean;
  createdAt: string;
}

export interface UserPosition {
  id: number;
  userId: number;
  symbol: string;
  entryPrice: number;
  quantity: number;
  side: "LONG" | "SHORT";
  leverage: number;
  trailingSl?: number;
  createdAt: string;
}

export interface Trade {
  id: number;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  side: "BUY" | "SELL";
  pnl: number;
  pnlPercent: number;
  openTime: string;
  closeTime: string;
  duration: number;
}

export interface ApiKey {
  id: number;
  userId: number;
  exchange: string;
  testnet: boolean;
  createdAt: string;
}

export interface DailyStats {
  id: number;
  userId: number;
  date: string;
  totalPnl: number;
  tradesCount: number;
  updatedAt: string;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  avgTrade: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  expectancy: number;
}

export interface OrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  leverage?: number;
  orderType?: "MARKET" | "LIMIT";
  price?: number;
}

export interface BotSignal {
  userId: number;
  symbol: string;
  signal: "LONG" | "SHORT" | "NONE";
  confidence: number;
  reason: string;
  timestamp: string;
}

export interface Notification {
  id: string;
  userId: number;
  type: "ALERT" | "TRADE_FILL" | "BOT_SIGNAL" | "SYSTEM";
  message: string;
  read: boolean;
  createdAt: string;
}
