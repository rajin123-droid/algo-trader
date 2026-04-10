import {
  ComposedChart,
  Line,
  Bar,
  ResponsiveContainer,
  YAxis,
  ReferenceLine,
  Cell,
} from "recharts";
import { macdPoints } from "./indicators/macd";

interface MACDPanelProps {
  closes: number[];
  times: number[];
}

export function MACDPanel({ closes, times }: MACDPanelProps) {
  if (closes.length < 35) return null;

  const points = macdPoints(times, closes).slice(-200);
  const data = points.map((p) => ({
    macd: parseFloat(p.macd.toFixed(4)),
    signal: parseFloat(p.signal.toFixed(4)),
    histogram: parseFloat(p.histogram.toFixed(4)),
  }));

  const latest = data[data.length - 1];
  const macdColor = latest?.macd >= 0 ? "#26a69a" : "#ef5350";

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ height: 88, borderTop: "1px solid #2B3139" }}
    >
      <div className="flex items-center gap-3 px-3 py-[3px] shrink-0">
        <span className="text-[10px] font-mono text-muted-foreground/60">
          MACD(12,26,9)
        </span>
        {latest && (
          <>
            <span
              className="text-[10px] font-mono"
              style={{ color: "#2196F3" }}
            >
              MACD {latest.macd.toFixed(2)}
            </span>
            <span
              className="text-[10px] font-mono"
              style={{ color: "#E91E63" }}
            >
              SIG {latest.signal.toFixed(2)}
            </span>
            <span
              className="text-[10px] font-mono"
              style={{ color: macdColor }}
            >
              HIST {latest.histogram.toFixed(2)}
            </span>
          </>
        )}
      </div>
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 2, right: 8, left: -10, bottom: 2 }}
          >
            <YAxis
              tickCount={3}
              tick={{ fontSize: 9, fill: "#555C6A", fontFamily: "monospace" }}
              width={30}
            />
            <ReferenceLine y={0} stroke="#2B3139" strokeWidth={0.8} />
            <Bar dataKey="histogram" isAnimationActive={false} barSize={2}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.histogram >= 0 ? "rgba(38,166,154,0.7)" : "rgba(239,83,80,0.7)"}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="macd"
              stroke="#2196F3"
              dot={false}
              strokeWidth={1}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="signal"
              stroke="#E91E63"
              dot={false}
              strokeWidth={1}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
