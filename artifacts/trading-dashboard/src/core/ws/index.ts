/**
 * WebSocket helpers — two connection modes:
 *
 * 1. Binance streams (connectPriceStream, connectKlineStream)
 *    Direct connection to Binance's public WebSocket API.
 *    Used for live market data (price ticks, candlestick bars).
 *
 * 2. Internal WS gateway (connectGateway)
 *    Connects to the trading platform's own WebSocket server (/ws).
 *    Receives TRADE and ORDERBOOK events emitted by the matching engine.
 *    Subscribe to a symbol → receive all fills and book snapshots for that pair.
 *
 * Message types from the gateway:
 *   { type: "CONNECTED" }                     — server handshake
 *   { type: "SUBSCRIBED",  symbol }            — subscription confirmed
 *   { type: "TRADE",   data: TradeFill }       — fill event
 *   { type: "ORDERBOOK", data: OrderBookSnap } — book snapshot (throttled 100ms)
 *   { type: "PONG" }                           — heartbeat response
 *   { type: "ERROR", message }                 — protocol error
 */

/* ── Binance streams ─────────────────────────────────────────────────────── */

const BINANCE_WS = "wss://stream.binance.com:9443/ws";

export function connectPriceStream(
  symbol: string,
  onMessage: (price: number) => void
): WebSocket {
  const ws = new WebSocket(`${BINANCE_WS}/${symbol.toLowerCase()}@trade`);

  ws.onmessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data as string) as { p: string };
    onMessage(parseFloat(data.p));
  };

  return ws;
}

export interface KlineBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export function connectKlineStream(
  symbol: string,
  interval: string,
  onCandle: (bar: KlineBar) => void
): WebSocket {
  const ws = new WebSocket(`${BINANCE_WS}/${symbol.toLowerCase()}@kline_${interval}`);

  ws.onmessage = (event: MessageEvent) => {
    const msg = JSON.parse(event.data as string) as {
      k: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean };
    };
    const k = msg.k;
    onCandle({
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      isClosed: k.x,
    });
  };

  return ws;
}

export async function fetchHistoricalKlines(
  symbol: string,
  interval: string,
  limit = 200
): Promise<KlineBar[]> {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown[][];
    return data.map((k) => ({
      time: Math.floor((k[0] as number) / 1000),
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
      isClosed: true,
    }));
  } catch {
    return [];
  }
}

/* ── Internal WS gateway ─────────────────────────────────────────────────── */

export interface TradeFill {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  orderId: string;
  userId: string;
  executedAt: string;
}

export interface OrderBookLevel {
  price: number;
  qty:   number;
  total: number;
}

export interface OrderBookSnap {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface PortfolioEntry {
  asset: string;
  balance: number;
}

export interface Candle {
  /** Unix timestamp in seconds — lightweight-charts format. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PositionUpdate {
  symbol: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  liquidationPrice: number;
  side?: "BUY" | "SELL";
  leverage?: number;
  margin?: number;
}

export interface OrderFilledEvent {
  action: "OPEN" | "CLOSE";
  position?: Record<string, unknown>;
  positionId?: number;
  pnl?: number;
  mode: "live" | "paper";
}

export interface AutoTradeWsEvent {
  sessionId:  string;
  strategyId: string;
  symbol:     string;
  signal:     "BUY" | "SELL";
  price:      number;
  size:       number;
  pnl:        number;
  balance:    number;
  executedAt: string;
}

export type GatewayMessage =
  | { type: "CONNECTED"; authenticated: boolean }
  | { type: "SUBSCRIBED"; symbol: string }
  | { type: "TRADE"; data: TradeFill }
  | { type: "ORDERBOOK"; data: OrderBookSnap }
  | { type: "PORTFOLIO_UPDATE"; data: PortfolioEntry[] }
  | { type: "POSITION_UPDATE"; data: PositionUpdate[] }
  | { type: "PRICE_UPDATE"; data: number }
  | { type: "CANDLE_UPDATE"; interval: string; data: Candle }
  | { type: "ORDER_BOOK_UPDATE"; data: OrderBookSnap }
  | { type: "TRADE_EXECUTED"; data: TradeFill }
  | { type: "ORDER_FILLED";    data: { order: Record<string, unknown>; execution?: Record<string, unknown> } }
  | { type: "ORDER_PENDING";   data: { order: Record<string, unknown> } }
  | { type: "ORDER_CANCELLED"; data: { order: Record<string, unknown> } }
  | { type: "AUTO_TRADE"; data: AutoTradeWsEvent }
  | { type: "PONG" }
  | { type: "ERROR"; message: string };

/**
 * Connect to the platform's internal WebSocket gateway.
 *
 * Automatically subscribes to `symbol` for market data once connected.
 * If a JWT `token` is provided it is sent as a query parameter so the server
 * can authenticate the connection and deliver user-specific events like
 * PORTFOLIO_UPDATE.
 *
 * Starts a 25-second ping interval to keep the connection alive through proxies.
 *
 * @param symbol            Trading pair, e.g. "BTCUSDT"
 * @param onTrade           Called for each matched trade fill
 * @param onBook            Called for each throttled order-book snapshot
 * @param options.token     Optional JWT — enables user-specific events
 * @param options.onPortfolio  Called when the server pushes a portfolio update
 * @param options.onOpen    Called when the WS connection is ready
 * @returns                 The raw WebSocket — call ws.close() to disconnect
 *
 * Usage:
 *   const ws = connectGateway("BTCUSDT", onTrade, onBook, {
 *     token: authToken,
 *     onPortfolio: (entries) => setPortfolio(entries),
 *   });
 *   return () => ws.close();
 */
export interface ConnectGatewayOptions {
  token?: string;
  onPortfolio?: (entries: PortfolioEntry[]) => void;
  onPosition?: (positions: PositionUpdate[]) => void;
  /** Called for every live candle bar update (in-progress bar). */
  onCandle?: (candle: Candle, interval: string) => void;
  /** Called when an order fill event arrives for the authenticated user. */
  onOrderFilled?: (event: OrderFilledEvent) => void;
  /** Called when a new order is placed (PENDING status). */
  onOrderPending?: (order: Record<string, unknown>) => void;
  /** Called when an order is cancelled. */
  onOrderCancelled?: (order: Record<string, unknown>) => void;
  /** Called when an auto-trading engine executes a trade. */
  onAutoTrade?: (event: AutoTradeWsEvent) => void;
  /** Called when the backend pushes a real-time price update from Binance market-data WS. */
  onPrice?: (price: number) => void;
  onOpen?: () => void;
}

export function connectGateway(
  symbol: string,
  onTrade: (fill: TradeFill) => void,
  onBook: (snap: OrderBookSnap) => void,
  options: ConnectGatewayOptions = {}
): WebSocket {
  const { token, onPortfolio, onPosition, onCandle, onOrderFilled, onOrderPending, onOrderCancelled, onAutoTrade, onPrice, onOpen } = options;

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  const wsUrl = `${proto}//${window.location.host}/ws${query}`;

  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "SUBSCRIBE", symbol }));
    onOpen?.();
  };

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as GatewayMessage;

      // null-guard: skip any message that carries a missing/null payload
      if ("data" in msg && msg.data == null) return;

      switch (msg.type) {
        case "TRADE":
        case "TRADE_EXECUTED":
          onTrade(msg.data as TradeFill);
          break;
        case "ORDERBOOK":
        case "ORDER_BOOK_UPDATE":
          onBook(msg.data as OrderBookSnap);
          break;
        case "PRICE_UPDATE":
          // Real Binance price pushed by the backend market-data service.
          onPrice?.(msg.data as number);
          break;
        case "PORTFOLIO_UPDATE":
          onPortfolio?.(msg.data as PortfolioEntry[]);
          break;
        case "POSITION_UPDATE":
          onPosition?.(msg.data as PositionUpdate[]);
          break;
        case "CANDLE_UPDATE":
          onCandle?.(msg.data as Candle, msg.interval);
          break;
        case "ORDER_FILLED":
          onOrderFilled?.(msg.data as OrderFilledEvent);
          onOrderCancelled?.((msg.data as { order: Record<string, unknown> }).order);
          break;
        case "ORDER_PENDING":
          onOrderPending?.((msg.data as { order: Record<string, unknown> }).order);
          break;
        case "ORDER_CANCELLED":
          onOrderCancelled?.((msg.data as { order: Record<string, unknown> }).order);
          break;
        case "AUTO_TRADE":
          onAutoTrade?.(msg.data as AutoTradeWsEvent);
          break;
        default:
          break;
      }
    } catch {
      // malformed message — ignore
    }
  };

  ws.onerror = () => {
    // Connection errors are expected in geo-restricted environments.
    // Callers can listen for ws.onclose to detect disconnection.
  };

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "PING" }));
    } else {
      clearInterval(pingInterval);
    }
  }, 25_000);

  ws.onclose = () => clearInterval(pingInterval);

  return ws;
}

/* ── Store-connected market streams ──────────────────────────────────────── */

/**
 * Connect all Binance market streams for a symbol and feed the Zustand store.
 * Returns a cleanup function that closes all sockets.
 *
 * Streams opened:
 *   - @depth@100ms  → order book (bids / asks)
 *   - @ticker       → 24h stats (price, change, volume, high, low)
 *   - @trade        → recent trades + live price
 */
export function connectMarketStreams(
  symbol: string,
  store: {
    setOrderBook: (bids: { price: number; qty: number }[], asks: { price: number; qty: number }[]) => void;
    setMarket: (partial: {
      price?: number;
      priceChange?: number;
      priceChangePercent?: number;
      volume?: number;
      high24h?: number;
      low24h?: number;
    }) => void;
    addTrade: (trade: { price: number; qty: number; side: "BUY" | "SELL"; time: number }) => void;
    setBinanceConnected: (v: boolean) => void;
  }
): () => void {
  const sym = symbol.toLowerCase();
  const BASE = "wss://stream.binance.com:9443/ws";

  let depth: WebSocket | null = null;
  let ticker: WebSocket | null = null;
  let trade: WebSocket | null = null;
  let closed = false;
  let depthThrottle = 0;

  function openDepth() {
    if (closed) return;
    depth = new WebSocket(`${BASE}/${sym}@depth@100ms`);
    depth.onopen = () => store.setBinanceConnected(true);
    depth.onclose = () => {
      store.setBinanceConnected(false);
      depth = null;
      if (!closed) setTimeout(openDepth, 3000);
    };
    depth.onmessage = (e: MessageEvent) => {
      const now = Date.now();
      if (now - depthThrottle < 120) return;
      depthThrottle = now;
      const d = JSON.parse(e.data as string) as { bids: [string, string][]; asks: [string, string][] };
      const bids = (d.bids ?? []).slice(0, 15).map(([p, q]: [string, string]) => ({ price: parseFloat(p), qty: parseFloat(q) }));
      const asks = (d.asks ?? []).slice(0, 15).map(([p, q]: [string, string]) => ({ price: parseFloat(p), qty: parseFloat(q) }));
      store.setOrderBook(bids, asks);
    };
  }

  function openTicker() {
    if (closed) return;
    ticker = new WebSocket(`${BASE}/${sym}@ticker`);
    ticker.onclose = () => {
      ticker = null;
      if (!closed) setTimeout(openTicker, 3000);
    };
    ticker.onmessage = (e: MessageEvent) => {
      const d = JSON.parse(e.data as string) as {
        c: string; p: string; P: string; v: string; h: string; l: string;
      };
      store.setMarket({
        price: parseFloat(d.c),
        priceChange: parseFloat(d.p),
        priceChangePercent: parseFloat(d.P),
        volume: parseFloat(d.v),
        high24h: parseFloat(d.h),
        low24h: parseFloat(d.l),
      });
    };
  }

  function openTrade() {
    if (closed) return;
    trade = new WebSocket(`${BASE}/${sym}@trade`);
    trade.onclose = () => {
      trade = null;
      if (!closed) setTimeout(openTrade, 3000);
    };
    trade.onmessage = (e: MessageEvent) => {
      const t = JSON.parse(e.data as string) as { p: string; q: string; m: boolean; T: number };
      store.addTrade({
        price: parseFloat(t.p),
        qty: parseFloat(t.q),
        side: t.m ? "SELL" : "BUY",
        time: t.T,
      });
      store.setMarket({ price: parseFloat(t.p) });
    };
  }

  openDepth();
  openTicker();
  openTrade();

  return () => {
    closed = true;
    depth?.close();
    ticker?.close();
    trade?.close();
    store.setBinanceConnected(false);
  };
}
