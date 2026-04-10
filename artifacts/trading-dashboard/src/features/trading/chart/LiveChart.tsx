import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickSeriesOptions,
  type Time,
} from "lightweight-charts";
import { connectKlineStream, fetchHistoricalKlines } from "@/core/ws";

interface LiveChartProps {
  symbol?: string;
  interval?: string;
}

/**
 * Candlestick chart powered by lightweight-charts v5, fed by:
 *   - REST: historical klines (last 200 bars)
 *   - WebSocket: Binance @kline_1m stream for real-time bar updates
 *
 * v5 API uses chart.addSeries(CandlestickSeries, options)
 * instead of the v4 chart.addCandlestickSeries() shorthand.
 */
export function LiveChart({ symbol = "BTCUSDT", interval = "1m" }: LiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // ── Create chart ──────────────────────────────────────────────────────
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0B0E11" },
        textColor: "#848E9C",
      },
      grid: {
        vertLines: { color: "#1E2329" },
        horzLines: { color: "#1E2329" },
      },
      crosshair: {
        vertLine: { color: "#848E9C", labelBackgroundColor: "#1E2329" },
        horzLine: { color: "#848E9C", labelBackgroundColor: "#1E2329" },
      },
      rightPriceScale: { borderColor: "#2B3139" },
      timeScale: {
        borderColor: "#2B3139",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // ── Candlestick series (v5 API) ───────────────────────────────────────
    // v4: chart.addCandlestickSeries({ ... })
    // v5: chart.addSeries(CandlestickSeries, { ... })
    const seriesOptions: Partial<CandlestickSeriesOptions> = {
      upColor: "#0ECB81",
      downColor: "#F6465D",
      borderUpColor: "#0ECB81",
      borderDownColor: "#F6465D",
      wickUpColor: "#0ECB81",
      wickDownColor: "#F6465D",
    };

    const series = chart.addSeries(CandlestickSeries, seriesOptions);
    seriesRef.current = series;

    // ── Load historical candles ───────────────────────────────────────────
    fetchHistoricalKlines(symbol, interval, 200).then((bars) => {
      if (bars.length > 0 && seriesRef.current) {
        seriesRef.current.setData(
          bars.map((b) => ({
            time: b.time as Time,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          }))
        );
        chart.timeScale().fitContent();
      }
    });

    // ── Live WebSocket feed ───────────────────────────────────────────────
    wsRef.current = connectKlineStream(symbol, interval, (bar) => {
      if (!seriesRef.current) return;
      seriesRef.current.update({
        time: bar.time as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
    });

    return () => {
      wsRef.current?.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [symbol, interval]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: "#0B0E11" }}
    />
  );
}
