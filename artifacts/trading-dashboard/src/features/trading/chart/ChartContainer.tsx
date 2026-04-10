import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { connectKlineStream, fetchHistoricalKlines } from "@/core/ws";
import { calculateEMA } from "./indicators/ema";
import { useDrawingStore } from "../drawing/drawing.store";
import type { IndicatorConfig } from "./IndicatorPanel";

interface CrosshairData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartContainerProps {
  symbol: string;
  interval: string;
  indicators: IndicatorConfig;
  onCandlesChange?: (closes: number[], times: number[]) => void;
}

function fmtVol(n: number) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(2);
}

export function ChartContainer({
  symbol,
  interval,
  indicators,
  onCandlesChange,
}: ChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema9Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema55Ref = useRef<ISeriesApi<"Line"> | null>(null);

  const lastEma9 = useRef(0);
  const lastEma21 = useRef(0);
  const lastEma55 = useRef(0);
  const candleDataRef = useRef<{ time: number; close: number }[]>([]);

  const lineSeriesMap = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  const [tooltip, setTooltip] = useState<CrosshairData | null>(null);

  const onCandlesChangeRef = useRef(onCandlesChange);
  onCandlesChangeRef.current = onCandlesChange;

  const { mode, pending, setPending, addLine, lines } = useDrawingStore();
  const drawingModeRef = useRef(mode);
  drawingModeRef.current = mode;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0B0E11" },
        textColor: "#848E9C",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1A1D24" },
        horzLines: { color: "#1A1D24" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#555", labelBackgroundColor: "#1E2329" },
        horzLine: { color: "#555", labelBackgroundColor: "#1E2329" },
      },
      rightPriceScale: { borderColor: "#2B3139" },
      timeScale: {
        borderColor: "#2B3139",
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 8,
      },
    });
    chartRef.current = chart;

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
    candleRef.current = candle;

    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    volRef.current = vol;

    const ema9 = chart.addSeries(LineSeries, {
      color: "#E91E63",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    ema9Ref.current = ema9;

    const ema21 = chart.addSeries(LineSeries, {
      color: "#2196F3",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    ema21Ref.current = ema21;

    const ema55 = chart.addSeries(LineSeries, {
      color: "#FF9800",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    ema55Ref.current = ema55;

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setTooltip(null);
        return;
      }
      const bar = param.seriesData.get(candle) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      const volBar = param.seriesData.get(vol) as
        | { value: number }
        | undefined;
      if (bar) {
        setTooltip({
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: volBar?.value ?? 0,
        });
      }
    });

    chart.subscribeClick((param) => {
      const dm = drawingModeRef.current;
      if (dm === "none" || !param.time || !param.point) return;
      const price = candle.coordinateToPrice(param.point.y);
      if (price === null) return;
      const time = param.time as number;

      if (dm === "hline") {
        candle.createPriceLine({
          price,
          color: "#F0B90B",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: price.toFixed(2),
        });
        return;
      }

      if (dm === "trendline") {
        const pend = pendingRef.current;
        if (!pend) {
          setPending({ time, price });
        } else {
          const sorted =
            pend.time <= time
              ? { t1: pend.time, p1: pend.price, t2: time, p2: price }
              : { t1: time, p1: price, t2: pend.time, p2: pend.price };
          addLine({
            id: crypto.randomUUID(),
            time1: sorted.t1,
            price1: sorted.p1,
            time2: sorted.t2,
            price2: sorted.p2,
            color: "#F0B90B",
          });
          setPending(null);
        }
      }
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      ema9Ref.current = null;
      ema21Ref.current = null;
      ema55Ref.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current) return;
    const wsRef = { current: null as WebSocket | null };

    candleDataRef.current = [];
    candleRef.current.setData([]);
    volRef.current?.setData([]);
    ema9Ref.current?.setData([]);
    ema21Ref.current?.setData([]);
    ema55Ref.current?.setData([]);

    fetchHistoricalKlines(symbol, interval, 500).then((bars) => {
      if (!candleRef.current || bars.length === 0) return;

      candleRef.current.setData(
        bars.map((b) => ({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );

      volRef.current?.setData(
        bars.map((b) => ({
          time: b.time as Time,
          value: b.volume,
          color:
            b.close >= b.open
              ? "rgba(38,166,154,0.35)"
              : "rgba(239,83,80,0.35)",
        }))
      );

      const closes = bars.map((b) => b.close);
      const times = bars.map((b) => b.time);
      candleDataRef.current = bars.map((b) => ({
        time: b.time,
        close: b.close,
      }));

      const e9 = calculateEMA(closes, 9);
      const e21 = calculateEMA(closes, 21);
      const e55 = calculateEMA(closes, 55);

      lastEma9.current = e9[e9.length - 1] ?? 0;
      lastEma21.current = e21[e21.length - 1] ?? 0;
      lastEma55.current = e55[e55.length - 1] ?? 0;

      const toPoints = (vals: number[], offset: number) =>
        vals.map((v, i) => ({
          time: times[i + offset] as Time,
          value: v,
        }));

      ema9Ref.current?.setData(toPoints(e9, closes.length - e9.length));
      ema21Ref.current?.setData(toPoints(e21, closes.length - e21.length));
      ema55Ref.current?.setData(toPoints(e55, closes.length - e55.length));

      onCandlesChangeRef.current?.(closes, times);

      chartRef.current?.timeScale().fitContent();
    });

    const ws = connectKlineStream(symbol, interval, (bar) => {
      if (!candleRef.current) return;

      candleRef.current.update({
        time: bar.time as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });

      volRef.current?.update({
        time: bar.time as Time,
        value: bar.volume,
        color:
          bar.close >= bar.open
            ? "rgba(38,166,154,0.35)"
            : "rgba(239,83,80,0.35)",
      });

      if (bar.isClosed) {
        const k9 = 2 / 10;
        const k21 = 2 / 22;
        const k55 = 2 / 56;
        const t = bar.time as Time;

        lastEma9.current = bar.close * k9 + lastEma9.current * (1 - k9);
        lastEma21.current = bar.close * k21 + lastEma21.current * (1 - k21);
        lastEma55.current = bar.close * k55 + lastEma55.current * (1 - k55);

        ema9Ref.current?.update({ time: t, value: lastEma9.current });
        ema21Ref.current?.update({ time: t, value: lastEma21.current });
        ema55Ref.current?.update({ time: t, value: lastEma55.current });

        candleDataRef.current.push({ time: bar.time, close: bar.close });
        if (candleDataRef.current.length > 500)
          candleDataRef.current.shift();

        const closes = candleDataRef.current.map((c) => c.close);
        const times = candleDataRef.current.map((c) => c.time);
        onCandlesChangeRef.current?.(closes, times);
      }
    });
    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, [symbol, interval]);

  useEffect(() => {
    ema9Ref.current?.applyOptions({ visible: indicators.ema9 });
  }, [indicators.ema9]);
  useEffect(() => {
    ema21Ref.current?.applyOptions({ visible: indicators.ema21 });
  }, [indicators.ema21]);
  useEffect(() => {
    ema55Ref.current?.applyOptions({ visible: indicators.ema55 });
  }, [indicators.ema55]);
  useEffect(() => {
    volRef.current?.applyOptions({ visible: indicators.volume });
  }, [indicators.volume]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const existingIds = new Set(lineSeriesMap.current.keys());
    const newIds = new Set(lines.map((l) => l.id));

    for (const line of lines) {
      if (!existingIds.has(line.id)) {
        const s = chart.addSeries(LineSeries, {
          color: line.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData([
          { time: line.time1 as Time, value: line.price1 },
          { time: line.time2 as Time, value: line.price2 },
        ]);
        lineSeriesMap.current.set(line.id, s);
      }
    }

    for (const [id, s] of lineSeriesMap.current) {
      if (!newIds.has(id)) {
        chart.removeSeries(s);
        lineSeriesMap.current.delete(id);
      }
    }
  }, [lines]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {tooltip && (
        <div className="absolute top-2 left-2 z-10 flex items-center gap-3 text-[11px] font-mono px-3 py-1.5 rounded pointer-events-none select-none"
          style={{ background: "rgba(11,14,17,0.85)", border: "1px solid #2B3139" }}
        >
          <span className="text-muted-foreground">O</span>
          <span style={{ color: tooltip.close >= tooltip.open ? "#26a69a" : "#ef5350" }}>
            {tooltip.open.toFixed(2)}
          </span>
          <span className="text-muted-foreground">H</span>
          <span className="text-[#26a69a]">{tooltip.high.toFixed(2)}</span>
          <span className="text-muted-foreground">L</span>
          <span className="text-[#ef5350]">{tooltip.low.toFixed(2)}</span>
          <span className="text-muted-foreground">C</span>
          <span style={{ color: tooltip.close >= tooltip.open ? "#26a69a" : "#ef5350", fontWeight: 600 }}>
            {tooltip.close.toFixed(2)}
          </span>
          <span className="text-muted-foreground text-[10px]">
            V {fmtVol(tooltip.volume)}
          </span>
        </div>
      )}

      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ cursor: mode !== "none" ? "crosshair" : "default" }}
      />
    </div>
  );
}
