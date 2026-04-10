export type OrderBookEntry = {
  price: number;
  qty: number;
};

export type RecentTrade = {
  price: number;
  qty: number;
  side: "BUY" | "SELL";
  time: number;
};

export type OrderBookState = {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  high: number;
  low: number;
  connected: boolean;
  trades: RecentTrade[];
};

type Subscriber = (state: OrderBookState) => void;

let state: OrderBookState = {
  bids: [],
  asks: [],
  lastPrice: 0,
  priceChange: 0,
  priceChangePercent: 0,
  volume: 0,
  high: 0,
  low: 0,
  connected: false,
  trades: [],
};

const subscribers = new Set<Subscriber>();
let depthWs: WebSocket | null = null;
let tickerWs: WebSocket | null = null;
let tradeWs: WebSocket | null = null;
let depthThrottle = 0;

function notify() {
  subscribers.forEach((fn) => fn({ ...state }));
}

function setState(partial: Partial<OrderBookState>) {
  state = { ...state, ...partial };
  notify();
}

function connectDepth() {
  if (depthWs) return;
  depthWs = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@depth@100ms");

  depthWs.onopen = () => setState({ connected: true });
  depthWs.onclose = () => {
    setState({ connected: false });
    depthWs = null;
    setTimeout(connectDepth, 3000);
  };

  depthWs.onmessage = (event) => {
    const now = Date.now();
    if (now - depthThrottle < 120) return;
    depthThrottle = now;

    const data = JSON.parse(event.data);
    const bids: OrderBookEntry[] = (data.bids || [])
      .slice(0, 15)
      .map(([p, q]: [string, string]) => ({ price: parseFloat(p), qty: parseFloat(q) }));
    const asks: OrderBookEntry[] = (data.asks || [])
      .slice(0, 15)
      .map(([p, q]: [string, string]) => ({ price: parseFloat(p), qty: parseFloat(q) }));

    setState({ bids, asks });
  };
}

function connectTicker() {
  if (tickerWs) return;
  tickerWs = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@ticker");

  tickerWs.onclose = () => {
    tickerWs = null;
    setTimeout(connectTicker, 3000);
  };

  tickerWs.onmessage = (event) => {
    const d = JSON.parse(event.data);
    setState({
      lastPrice: parseFloat(d.c),
      priceChange: parseFloat(d.p),
      priceChangePercent: parseFloat(d.P),
      volume: parseFloat(d.v),
      high: parseFloat(d.h),
      low: parseFloat(d.l),
    });
  };
}

function connectTradeStream() {
  if (tradeWs) return;
  tradeWs = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");

  tradeWs.onclose = () => {
    tradeWs = null;
    setTimeout(connectTradeStream, 3000);
  };

  tradeWs.onmessage = (event) => {
    const t = JSON.parse(event.data);
    const incoming: RecentTrade = {
      price: parseFloat(t.p),
      qty: parseFloat(t.q),
      side: t.m ? "SELL" : "BUY",
      time: t.T,
    };

    const updated = [incoming, ...state.trades].slice(0, 30);
    setState({
      trades: updated,
      lastPrice: incoming.price,
    });
  };
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  fn({ ...state });
  connectDepth();
  connectTicker();
  connectTradeStream();
  return () => subscribers.delete(fn);
}

export function disconnect() {
  depthWs?.close();
  tickerWs?.close();
  tradeWs?.close();
  depthWs = null;
  tickerWs = null;
  tradeWs = null;
}
