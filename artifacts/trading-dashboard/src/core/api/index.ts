import { getToken } from "@/core/auth";

const BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface UserPayload {
  id: number;
  email: string;
  plan: string;
}

export interface AuthResponse {
  msg?: string;
  token?: string;
  user?: UserPayload;
  error?: string;
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  return post("/auth/register", { email, password });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return post("/auth/login", { email, password });
}

// ── API Keys ──────────────────────────────────────────────────────────────────

export interface KeyStatus {
  connected: boolean;
  testnet?: boolean;
  apiKeyPrefix?: string;
  createdAt?: string;
  error?: string;
}

export interface SaveKeysResponse {
  msg?: string;
  testnet?: boolean;
  error?: string;
}

export async function getBinanceKeyStatus(): Promise<KeyStatus> {
  return get("/keys/binance");
}

export async function saveBinanceKeys(
  apiKey: string,
  apiSecret: string,
  testnet: boolean
): Promise<SaveKeysResponse> {
  return put("/keys/binance", { apiKey, apiSecret, testnet });
}

export async function deleteBinanceKeys(): Promise<{ msg?: string; error?: string }> {
  return del("/keys/binance");
}

// ── Positions ─────────────────────────────────────────────────────────────────

export interface ApiPosition {
  id: number;
  userId: number;
  symbol: string;
  entryPrice: number;
  quantity: number;
  side: "BUY" | "SELL";
  leverage: number;
  createdAt: string;
}

export interface ApiTradeHistory {
  id: number;
  userId: number;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  leverage: number;
  createdAt: string;
}

export interface OpenPositionResponse {
  msg?: string;
  mode?: "live" | "paper";
  position?: ApiPosition & { notional: number; margin: number; liqPrice: number };
  binanceOrder?: Record<string, unknown>;
  error?: string;
}

export interface ClosePositionResponse {
  msg?: string;
  mode?: "live" | "paper";
  pnl?: number;
  trade?: ApiTradeHistory;
  binanceOrder?: Record<string, unknown>;
  error?: string;
}

export async function openTrade(data: {
  symbol: string;
  price: number;
  qty: number;
  side: "BUY" | "SELL";
  leverage?: number;
}): Promise<OpenPositionResponse> {
  return post("/positions/open", data);
}

export async function closeTrade(data: {
  positionId: number;
  price: number;
}): Promise<ClosePositionResponse> {
  return post("/positions/close", data);
}

export async function getPositions(): Promise<ApiPosition[]> {
  return get("/positions");
}

export async function getTrades(): Promise<ApiTradeHistory[]> {
  return get("/user-trades");
}

// ── Portfolio (ledger-derived) ─────────────────────────────────────────────

export interface LedgerBalance {
  asset: string;
  balance: number;
}

export interface PortfolioSummary {
  usdtBalance: number;
  btcBalance: number;
  totalMarginLocked: number;
  openPositionCount: number;
  allBalances: LedgerBalance[];
  source: "ledger";
  updatedAt: string;
}

/** Full per-asset balance list — derived from double-entry ledger. */
export async function getPortfolio(): Promise<{ balances: LedgerBalance[]; updatedAt: string }> {
  return get("/portfolio");
}

/** Richer summary: USDT balance + margin locked + open count. */
export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  return get("/portfolio/summary");
}

// ── Auto-Trading ──────────────────────────────────────────────────────────────

export interface AutoTradingSession {
  id: string;
  userId: string;
  strategyId: string;
  symbol: string;
  interval: string;
  mode: "paper" | "live";
  isActive: boolean;
  riskPercent: number;
  maxPositionSize: number;
  maxTradesPerMinute: number;
  maxDailyLoss: number;
  createdAt: string;
  updatedAt?: string;
}

export interface AutoTradeEngine {
  sessionId: string;
  strategyId: string;
  symbol: string;
  isRunning: boolean;
}

export interface AutoTrade {
  id: string;
  sessionId: string;
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  pnl: number;
  /** Absolute stop-loss price level (set on BUY entries). */
  stopLoss?:    number | null;
  /** Absolute take-profit price level (set on BUY entries). */
  takeProfit?:  number | null;
  /** How the position was closed: "SIGNAL" | "STOP_LOSS" | "TAKE_PROFIT" */
  closeReason?: string | null;
  status?:      string;
  blockedReason?: string | null;
  executedAt: string;
}

export async function getAutoTradingStatus(userId?: string): Promise<{
  activeEngines: number;
  engines: AutoTradeEngine[];
  sessions: AutoTradingSession[];
}> {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return get(`/auto-trading/status${q}`);
}

export async function startAutoTrading(data: {
  userId: string;
  strategy: string;
  params?: Record<string, unknown>;
  symbol?: string;
  interval?: string;
  mode?: "paper" | "live";
  riskPercent?: number;
  maxPositionSize?: number;
  maxTradesPerMinute?: number;
  maxDailyLoss?: number;
}): Promise<{ sessionId: string; status: string; session: AutoTradingSession }> {
  return post("/auto-trading/start", data);
}

export async function stopAutoTrading(
  sessionId: string,
  userId: string
): Promise<{ sessionId: string; status: string }> {
  return post("/auto-trading/stop", { sessionId, userId });
}

export async function getAutoTradingTrades(params?: {
  sessionId?: string;
  userId?: string;
  limit?: number;
}): Promise<{ count: number; trades: AutoTrade[] }> {
  const q = new URLSearchParams();
  if (params?.sessionId) q.set("sessionId", params.sessionId);
  if (params?.userId) q.set("userId", params.userId);
  if (params?.limit) q.set("limit", String(params.limit));
  return get(`/auto-trading/trades${q.toString() ? `?${q}` : ""}`);
}

export async function getAutoTradingSessions(userId?: string): Promise<{
  count: number;
  sessions: AutoTradingSession[];
}> {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return get(`/auto-trading/sessions${q}`);
}

// ── Backtesting ───────────────────────────────────────────────────────────────

export interface BacktestResult {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  sharpeRatio: number;
  initialBalance: number;
  finalBalance: number;
  trades: Array<{
    entryTime: number;
    exitTime: number;
    side: string;
    entryPrice: number;
    exitPrice: number;
    qty: number;
    pnl: number;
  }>;
  symbol: string;
  interval: string;
}

export async function getBacktestStrategies(): Promise<{ strategies: string[] }> {
  return get("/backtest/strategies");
}

export async function runBacktest(data: {
  strategy: string;
  symbol?: string;
  interval?: string;
  limit?: number;
  initialBalance?: number;
  params?: Record<string, unknown>;
}): Promise<BacktestResult> {
  return post("/backtest", data);
}

// ── AI Strategy ───────────────────────────────────────────────────────────────

export interface AiStrategyResult {
  generated: {
    config: Record<string, unknown>;
    result: BacktestResult;
    evaluation: { score: number; grade: string; summary: string };
  };
  optimized?: {
    config: Record<string, unknown>;
    result: BacktestResult;
    evaluation: { score: number; grade: string; summary: string };
  };
  candleCount: number;
  symbol: string;
  interval: string;
}

export async function generateAiStrategy(data: {
  idea: string;
  symbol?: string;
  interval?: string;
  limit?: number;
  initialBalance?: number;
  optimize?: boolean;
  iterations?: number;
}): Promise<AiStrategyResult> {
  return post("/ai-strategy/generate", data);
}

export async function deployAiStrategy(data: {
  config: Record<string, unknown>;
  symbol: string;
  interval: string;
  mode?: "paper" | "live";
}): Promise<{ sessionId: string; status: string }> {
  return post("/ai-strategy/deploy", data);
}

// ── Marketplace ───────────────────────────────────────────────────────────────

export interface MarketplaceListing {
  id: string;
  creatorId: string;
  strategyId: string;
  name: string;
  description?: string;
  symbol?: string;
  interval?: string;
  pricePerMonth?: number;
  performanceFee?: number;
  isPublic: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface MarketplaceSubscription {
  id: number;
  userId: string;
  listingId: string;
  copyRatio?: number;
  maxLossLimit?: number;
  isActive: boolean;
  createdAt: string;
}

export interface CopyTrade {
  id: string;
  listingId: string;
  followerId: string;
  symbol: string;
  side: string;
  originPrice: number;
  copyPrice: number;
  quantity: number;
  pnl?: number;
  executedAt: string;
}

export interface RevenueSummary {
  totalRevenue: number;
  subscriptions: number;
  events?: Array<{ amount: number; createdAt: string; description?: string }>;
}

export async function getMarketplaceStrategies(params?: {
  creatorId?: string;
  symbol?: string;
}): Promise<{ listings: MarketplaceListing[] }> {
  const q = new URLSearchParams();
  if (params?.creatorId) q.set("creatorId", params.creatorId);
  if (params?.symbol) q.set("symbol", params.symbol);
  return get(`/marketplace/strategies${q.toString() ? `?${q}` : ""}`);
}

export async function getMarketplaceStrategy(id: string): Promise<{ listing: MarketplaceListing }> {
  return get(`/marketplace/strategies/${id}`);
}

export async function publishMarketplaceStrategy(data: {
  strategyId: string;
  name: string;
  description?: string;
  symbol?: string;
  interval?: string;
  pricePerMonth?: number;
}): Promise<{ listing: MarketplaceListing }> {
  return post("/marketplace/strategies", data);
}

export async function getMarketplaceSubscriptions(): Promise<{ subscriptions: MarketplaceSubscription[] }> {
  return get("/marketplace/subscriptions");
}

export async function subscribeToStrategy(data: {
  listingId: string;
  copyRatio?: number;
  maxLossLimit?: number;
}): Promise<{ subscription: MarketplaceSubscription }> {
  return post("/marketplace/subscriptions", data);
}

export async function cancelSubscription(id: number): Promise<{ subscription: MarketplaceSubscription }> {
  return del(`/marketplace/subscriptions/${id}`);
}

export async function getMarketplaceCopyTrades(): Promise<{ copyTrades: CopyTrade[] }> {
  return get("/marketplace/copy-trades");
}

export async function getMarketplaceRevenue(): Promise<{ revenue: RevenueSummary }> {
  return get("/marketplace/revenue");
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: number;
  email: string;
  role: "USER" | "TRADER" | "ADMIN";
  plan: string;
  isActive: boolean;
  tenantId?: string;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  userId?: string;
  action: string;
  resource?: string;
  resourceId?: number;
  payload?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface KillSwitchState {
  active: boolean;
  reason?: string;
  activatedAt?: string;
}

export interface ReconcileResult {
  status: "OK" | "FAIL";
  discrepancies?: Array<{ accountId: string; expected: number; actual: number }>;
  checkedAt: string;
}

export async function getAdminUsers(): Promise<{ users: AdminUser[]; count: number }> {
  return get("/admin/users");
}

export async function updateUserRole(
  id: number,
  role: "USER" | "TRADER" | "ADMIN"
): Promise<{ user: AdminUser }> {
  return patch(`/admin/users/${id}/role`, { role });
}

export async function getAdminAuditLogs(params?: {
  limit?: number;
  offset?: number;
  action?: string;
}): Promise<{ logs: AuditLog[]; count: number; limit: number; offset: number }> {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  if (params?.action) q.set("action", params.action);
  return get(`/admin/audit-logs${q.toString() ? `?${q}` : ""}`);
}

export async function getAdminQueueDepth(): Promise<{ depth: number; backend: string }> {
  return get("/admin/queue/depth");
}

export async function getKillSwitch(): Promise<KillSwitchState> {
  return get("/admin/kill-switch");
}

export async function activateKillSwitch(reason: string): Promise<KillSwitchState & { message: string }> {
  return post("/admin/kill-switch/activate", { reason });
}

export async function deactivateKillSwitch(): Promise<KillSwitchState & { message: string }> {
  return post("/admin/kill-switch/deactivate", {});
}

export async function triggerReconcile(): Promise<{ result: ReconcileResult }> {
  return post("/admin/reconcile", {});
}

export async function getLastReconcile(): Promise<{ result: ReconcileResult }> {
  return get("/admin/reconcile/last");
}

/* ── Admin ledger & balance adjustment ───────────────────────────────────── */

export interface AdminLedgerEntry {
  id:            string;
  transactionId: string;
  side:          "DEBIT" | "CREDIT";
  amount:        string;
  seq:           number | null;
  createdAt:     string | null;
}

export interface AdminLedgerAccount {
  accountId: string;
  userId:    string;
  asset:     string;
  debitSum:  number;
  creditSum: number;
  balance:   number;
  entries:   AdminLedgerEntry[];
}

export async function getAdminLedger(userId: string): Promise<{
  userId: string;
  accounts: AdminLedgerAccount[];
  count: number;
}> {
  return get(`/admin/ledger/${encodeURIComponent(userId)}`);
}

export async function adjustAdminBalance(data: {
  userId: string;
  asset:  string;
  amount: number;
  note?:  string;
}): Promise<{ success: boolean; transactionId: string; userId: string; asset: string; amount: number }> {
  return post("/admin/adjust-balance", data);
}

/* ── System health ───────────────────────────────────────────────────────── */

export interface SystemHealth {
  status:  "OK" | "HALTED";
  uptime:  number;
  memory: {
    heapUsed:  number;
    heapTotal: number;
    rss:       number;
    external:  number;
  };
  queue: {
    depth:   number;
    backend: string;
  };
  killSwitch:  KillSwitchState;
  nodeVersion: string;
  checkedAt:   string;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  return get("/admin/system/health");
}

export interface PlatformKpi {
  totalUsers:          number;
  activeStrategies:    number;
  activeSubscriptions: number;
  totalCopyTrades:     number;
  platformRevenue:     number;
  creatorEarnings:     number;
  revenueEvents:       number;
  checkedAt:           string;
}

export async function getAdminAnalyticsKpi(): Promise<PlatformKpi> {
  return get("/admin/analytics/kpi");
}

// ── Exchange / Binance adapter ─────────────────────────────────────────────────

export interface ExchangeStatus {
  connected:      boolean;
  serverTime?:    number;
  latencyMs?:     number;
  credentialsOk:  boolean;
  canGoLive:      boolean;
  baseURL:        string;
  network:        "TESTNET" | "MAINNET";
  error?:         string;
}

export interface ExchangeBalance {
  asset:  string;
  free:   number;
  locked: number;
}

export interface ExchangeBalanceResponse {
  balances:  ExchangeBalance[];
  fetchedAt: string;
}

export async function getExchangeStatus(): Promise<ExchangeStatus> {
  return get("/exchange/status");
}

export async function getExchangeBalance(): Promise<ExchangeBalanceResponse> {
  return get("/exchange/balance");
}

export async function switchSessionMode(
  sessionId: string,
  mode: "paper" | "live"
): Promise<{ sessionId: string; mode: string; updatedAt: string }> {
  return post(`/auto-trading/sessions/${sessionId}/mode`, { mode });
}

export interface MarketDataStatus {
  connected: boolean;
  source:    "binance_ws" | "simulator";
  symbols:   string[];
  prices:    Record<string, number>;
  timestamp: string;
}

export async function getMarketDataStatus(): Promise<MarketDataStatus> {
  return get("/market/status");
}

// ── Exchange Reconciliation ────────────────────────────────────────────────────

export interface ExchangeMismatch {
  asset:     string;
  internal:  number;
  exchange:  number;
  diff:      number;
  direction: "OVER" | "UNDER";
}

export interface ExchangeReconResult {
  status:       "PASS" | "FAIL" | "SKIP" | "ERROR";
  runAt:        string;
  durationMs:   number;
  sessionCount: number;
  mismatches:   ExchangeMismatch[];
  totalOrphans: number;
  summary:      string;
  error?:       string;
  snapshot: {
    capturedAt: string | null;
    assetCount: number;
  };
}

export interface ExchangeReconLog {
  id:           string;
  status:       string;
  sessionCount: number;
  mismatches:   ExchangeMismatch[];
  triggeredBy:  string | null;
  durationMs:   number | null;
  error:        string | null;
  runAt:        string;
}

export async function runExchangeRecon(): Promise<{ result: ExchangeReconResult }> {
  return post("/admin/exchange/recon/run", {});
}

export async function getExchangeReconHistory(limit = 20): Promise<{ history: ExchangeReconLog[]; count: number }> {
  return get(`/admin/exchange/recon/history?limit=${limit}`);
}

export async function captureExchangeBalanceSnapshot(): Promise<{ snapshot: { capturedAt: string; assetCount: number; skipped: boolean; skipReason?: string } }> {
  return post("/admin/exchange/balance/snapshot", {});
}

export async function getLatestExchangeSnapshot(): Promise<{ snapshot: { capturedAt: string | null; balances: ExchangeBalance[] } }> {
  return get("/admin/exchange/balance/latest");
}

// ── Orders ────────────────────────────────────────────────────────────────────

export type OrderStatus =
  | "PENDING"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED";

export interface ApiOrder {
  id:                string;
  userId:            string;
  symbol:            string;
  side:              "BUY" | "SELL";
  type:              "MARKET" | "LIMIT" | "STOP_LIMIT";
  status:            OrderStatus;
  quantity:          number;
  filledQuantity:    number;
  remainingQuantity: number;
  fillPercent:       number;
  price:             string | null;
  fee:               number;
  feeAsset:          string | null;
  mode:              "paper" | "live";
  cancelReason?:     string | null;
  rejectReason?:     string | null;
  createdAt:         string;
  updatedAt:         string;
}

export interface ApiOrderExecution {
  id:          string;
  orderId:     string;
  price:       string;
  quantity:    string;
  side:        string;
  fee:         string | null;
  feeAsset:    string | null;
  executedAt:  string;
}

export interface ApiOrderWithExecutions extends ApiOrder {
  executions: ApiOrderExecution[];
}

export interface OrderStats {
  openOrders:    number;
  totalFeesPaid: number;
}

export async function getOrders(params?: {
  status?: string;
  symbol?: string;
  side?:   string;
  limit?:  number;
  offset?: number;
}): Promise<ApiOrder[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.symbol) q.set("symbol", params.symbol);
  if (params?.side)   q.set("side",   params.side);
  if (params?.limit)  q.set("limit",  String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  return get(`/orders${q.toString() ? `?${q}` : ""}`);
}

export async function getActiveOrders(): Promise<ApiOrder[]> {
  return get("/orders/active");
}

export async function getOrderHistory(params?: {
  symbol?: string;
  limit?:  number;
  offset?: number;
}): Promise<ApiOrder[]> {
  const q = new URLSearchParams();
  if (params?.symbol) q.set("symbol", params.symbol);
  if (params?.limit)  q.set("limit",  String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  return get(`/orders/history${q.toString() ? `?${q}` : ""}`);
}

export async function getOrderStats(): Promise<OrderStats> {
  return get("/orders/stats");
}

export async function getOrderById(id: string): Promise<ApiOrderWithExecutions> {
  return get(`/orders/${id}`);
}

export interface CreateOrderPayload {
  symbol:   string;
  side:     "BUY" | "SELL";
  type:     "MARKET" | "LIMIT" | "STOP_LIMIT";
  quantity: number;
  price?:   number;
  mode?:    "paper" | "live";
}

export interface CreateOrderResponse {
  order:      ApiOrder;
  execution?: ApiOrderExecution;
}

export async function createOrder(data: CreateOrderPayload): Promise<CreateOrderResponse> {
  return post("/orders", data);
}

export async function cancelOrder(
  id:     string,
  reason?: string
): Promise<{ order: ApiOrder; cancelled: boolean }> {
  const res = await fetch(`${BASE}/orders/${id}`, {
    method:  "DELETE",
    headers: authHeaders(),
    body:    JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Ledger ────────────────────────────────────────────────────────────────────

export interface LedgerAccount {
  id: string;
  userId: string;
  asset: string;
  balance: number;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  accountId: string;
  type: "DEBIT" | "CREDIT";
  amount: number;
  description?: string;
  createdAt: string;
}

export async function getLedgerAccounts(): Promise<{ accounts: LedgerAccount[]; count: number }> {
  return get("/ledger/accounts");
}

export async function getLedgerEntries(
  accountId: string,
  params?: { limit?: number; offset?: number }
): Promise<{ entries: LedgerEntry[]; count: number }> {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  return get(`/ledger/accounts/${accountId}/entries${q.toString() ? `?${q}` : ""}`);
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export async function getAuditLogs(params?: {
  action?: string;
  userId?: string;
  resource?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: AuditLog[]; count: number }> {
  const q = new URLSearchParams();
  if (params?.action) q.set("action", params.action);
  if (params?.userId) q.set("userId", params.userId);
  if (params?.resource) q.set("resource", params.resource);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  return get(`/audit/logs${q.toString() ? `?${q}` : ""}`);
}

export async function getAuditStats(): Promise<{ stats: Record<string, number> }> {
  return get("/audit/stats");
}

export async function getMyAuditTimeline(): Promise<{ events: AuditLog[] }> {
  return get("/audit/me");
}
