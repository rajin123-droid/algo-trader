import { useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useOrderBookStore } from "./orderbook.store";

export function DepthChart() {
  const { bids, asks } = useOrderBookStore();

  const data = useMemo(() => {
    const bidPoints: { price: number; bidVolume: number; askVolume: number }[] = [];
    const askPoints: { price: number; bidVolume: number; askVolume: number }[] = [];

    let cumBid = 0;
    const sortedBids = [...bids].sort((a, b) => b.price - a.price);
    for (const b of sortedBids) {
      cumBid += b.qty;
      bidPoints.push({ price: b.price, bidVolume: cumBid, askVolume: 0 });
    }

    let cumAsk = 0;
    const sortedAsks = [...asks].sort((a, b) => a.price - b.price);
    for (const a of sortedAsks) {
      cumAsk += a.qty;
      askPoints.push({ price: a.price, bidVolume: 0, askVolume: cumAsk });
    }

    return [...bidPoints.reverse(), ...askPoints];
  }, [bids, asks]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs font-mono">
        Awaiting depth data...
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <XAxis
          dataKey="price"
          tick={{ fontSize: 9, fontFamily: "monospace", fill: "#666" }}
          tickFormatter={(v) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis hide />
        <Tooltip
          contentStyle={{ background: "#161A1E", border: "1px solid #2B3139", fontSize: 10, fontFamily: "monospace" }}
          labelFormatter={(v) => `$${parseFloat(v).toLocaleString()}`}
          formatter={(v: number, name: string) => [v.toFixed(4), name === "bidVolume" ? "Bid Depth" : "Ask Depth"]}
        />
        <Area
          type="stepAfter"
          dataKey="bidVolume"
          stroke="#0ECB81"
          fill="rgba(14,203,129,0.15)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Area
          type="stepAfter"
          dataKey="askVolume"
          stroke="#F6465D"
          fill="rgba(246,70,93,0.15)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
