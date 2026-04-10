import {
  LineChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
  Tooltip,
  ReferenceArea,
} from "recharts";
import { rsiPoints } from "./indicators/rsi";

interface RSIPanelProps {
  closes: number[];
  times: number[];
}

export function RSIPanel({ closes, times }: RSIPanelProps) {
  if (closes.length < 15) return null;

  const points = rsiPoints(times, closes, 14);
  const data = points.slice(-200).map((p) => ({ rsi: parseFloat(p.value.toFixed(2)) }));
  const current = data[data.length - 1]?.rsi ?? 50;
  const color =
    current >= 70 ? "#ef5350" : current <= 30 ? "#26a69a" : "#9C27B0";

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ height: 88, borderTop: "1px solid #2B3139" }}
    >
      <div className="flex items-center gap-2 px-3 py-[3px] shrink-0">
        <span className="text-[10px] font-mono text-muted-foreground/60">
          RSI(14)
        </span>
        <span
          className="text-[11px] font-mono font-bold"
          style={{ color }}
        >
          {current.toFixed(2)}
        </span>
        {current >= 70 && (
          <span className="text-[9px] text-[#ef5350] font-mono">OVERBOUGHT</span>
        )}
        {current <= 30 && (
          <span className="text-[9px] text-[#26a69a] font-mono">OVERSOLD</span>
        )}
      </div>
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 2, right: 8, left: -10, bottom: 2 }}
          >
            <YAxis
              domain={[0, 100]}
              tickCount={3}
              tick={{ fontSize: 9, fill: "#555C6A", fontFamily: "monospace" }}
              width={30}
            />
            <Tooltip
              content={() => null}
            />
            <ReferenceArea y1={70} y2={100} fill="rgba(239,83,80,0.06)" />
            <ReferenceArea y1={0} y2={30} fill="rgba(38,166,154,0.06)" />
            <ReferenceLine y={70} stroke="#ef5350" strokeDasharray="2 4" strokeWidth={0.8} />
            <ReferenceLine y={50} stroke="#2B3139" strokeWidth={0.8} />
            <ReferenceLine y={30} stroke="#26a69a" strokeDasharray="2 4" strokeWidth={0.8} />
            <Line
              type="monotone"
              dataKey="rsi"
              stroke={color}
              dot={false}
              strokeWidth={1.2}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
