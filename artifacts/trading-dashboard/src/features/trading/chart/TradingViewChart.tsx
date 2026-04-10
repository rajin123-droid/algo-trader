import { useEffect, useRef } from "react";

declare global {
  interface Window {
    TradingView: {
      widget: new (config: Record<string, unknown>) => unknown;
    };
  }
}

interface TradingViewChartProps {
  symbol?: string;
  interval?: string;
}

export function TradingViewChart({ symbol = "BINANCE:BTCUSDT", interval = "5" }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<unknown>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    const containerId = "tv_chart_container";

    function initWidget() {
      if (!window.TradingView || widgetRef.current) return;
      widgetRef.current = new window.TradingView.widget({
        container_id: containerId,
        autosize: true,
        symbol,
        interval,
        theme: "dark",
        style: "1",
        locale: "en",
        toolbar_bg: "#0B0E11",
        enable_publishing: false,
        hide_side_toolbar: false,
        allow_symbol_change: true,
        studies: ["RSI@tv-basicstudies", "MACD@tv-basicstudies"],
      });
    }

    if (window.TradingView) {
      initWidget();
    } else {
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = initWidget;
      document.body.appendChild(script);
      scriptRef.current = script;
    }

    return () => {
      widgetRef.current = null;
    };
  }, [symbol, interval]);

  return (
    <div
      id="tv_chart_container"
      ref={containerRef}
      className="w-full h-full"
    />
  );
}
