/**
 * ws.client.ts — store-connected internal WebSocket client.
 *
 * Wraps `connectGateway` and routes every message type into the correct
 * Zustand store:
 *
 *   TRADE / TRADE_EXECUTED    → trading.addTrade
 *   ORDERBOOK / ORDER_BOOK_UPDATE → orderbook.setOrderBook
 *   PRICE_UPDATE              → trading.setPrice
 *   CANDLE_UPDATE             → trading.upsertLiveCandle
 *   PORTFOLIO_UPDATE          → portfolio.setPortfolio  (balances from PortfolioEntry[])
 *   POSITION_UPDATE           → position.setPositions
 *
 * Usage:
 *   import { connectWS } from '@/core/ws/ws.client';
 *
 *   useEffect(() => {
 *     const cleanup = connectWS("BTCUSDT");
 *     return cleanup;
 *   }, [symbol]);
 */

import { connectGateway, type TradeFill, type PortfolioEntry, type OrderFilledEvent, type AutoTradeWsEvent } from "@/core/ws";
import { useAutoTradingStore } from "@/state/auto-trading.store";
import { getToken } from "@/core/auth";
import { useTradingStore } from "@/state/trading.store";
import { usePortfolioStore } from "@/state/portfolio.store";
import { usePositionStore } from "@/state/position.store";
import { useOrderBookStore } from "@/features/orderbook/orderbook.store";

let activeWs: WebSocket | null = null;

/** Map a PortfolioEntry (asset + balance) to the richer Balance shape. */
function entryToBalance(e: PortfolioEntry) {
  return { asset: e.asset, free: e.balance, locked: 0 };
}

/** Map a TradeFill to the RecentTrade shape used by the trading store. */
function fillToTrade(fill: TradeFill) {
  return {
    price: fill.price,
    qty: fill.quantity,
    side: fill.side,
    time: new Date(fill.executedAt).getTime(),
  };
}

/**
 * Connect the internal gateway WebSocket for `symbol` and wire every
 * message type into the appropriate global store.
 *
 * Closes any previously opened connection before opening a new one.
 *
 * @returns A cleanup function — call it to close the connection.
 */
export function connectWS(symbol: string): () => void {
  if (activeWs) {
    activeWs.close();
    activeWs = null;
  }

  const trading   = useTradingStore.getState();
  const portfolio = usePortfolioStore.getState();
  const positions = usePositionStore.getState();
  const token     = getToken() ?? undefined;

  activeWs = connectGateway(
    symbol,

    // TRADE / TRADE_EXECUTED
    (fill) => {
      if (!fill) return;
      trading.addTrade(fillToTrade(fill));
    },

    // ORDERBOOK / ORDER_BOOK_UPDATE
    // snap.bids / snap.asks are now { price, qty, total } objects (not tuples).
    (snap) => {
      if (!snap) return;
      const bids = snap.bids.map((l) => ({
        price: l.price,
        qty:   l.qty,
        total: l.total ?? 0,
      }));
      const asks = snap.asks.map((l) => ({
        price: l.price,
        qty:   l.qty,
        total: l.total ?? 0,
      }));
      useOrderBookStore.getState().setOrderBook(bids, asks);
    },

    {
      token,

      // PORTFOLIO_UPDATE — update balances store AND bump version to trigger
      // LedgerBalancesPanel to re-fetch the full summary from the API
      onPortfolio: (entries) => {
        if (!entries) return;
        const balances = entries.map(entryToBalance);
        portfolio.setPortfolio({ balances });
        portfolio.bumpVersion();
        // Keep trading store's legacy portfolio field in sync
        trading.setPortfolio(entries);
      },

      // POSITION_UPDATE
      onPosition: (updates) => {
        if (!updates) return;
        positions.setPositions(updates);
      },

      // CANDLE_UPDATE
      onCandle: (candle) => {
        if (!candle) return;
        trading.upsertLiveCandle(candle);
      },

      // PRICE_UPDATE — real Binance price pushed from backend market-data service.
      // Acts as a fallback price source when the browser can't reach Binance directly.
      onPrice: (price) => {
        if (price && price > 0) trading.setPrice(price);
      },

      // ORDER_FILLED — bump counter so PositionsPage re-fetches from API
      onOrderFilled: (_event: OrderFilledEvent) => {
        usePositionStore.getState().bumpFill();
      },

      // AUTO_TRADE — prepend to store so AutoTradingTab updates instantly
      onAutoTrade: (ev: AutoTradeWsEvent) => {
        if (!ev) return;
        useAutoTradingStore.getState().prependTrade(ev);
      },

      onOpen: () => trading.setGatewayConnected(true),
    }
  );

  activeWs.onclose = () => {
    trading.setGatewayConnected(false);
    activeWs = null;
  };

  const captured = activeWs;
  return () => {
    captured.close();
    if (activeWs === captured) activeWs = null;
  };
}
