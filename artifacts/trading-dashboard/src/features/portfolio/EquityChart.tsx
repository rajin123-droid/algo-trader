import { EquityPoint } from "@workspace/api-client-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, TooltipProps } from "recharts";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

interface EquityChartProps {
  data?: EquityPoint[];
  isLoading: boolean;
}

export function EquityChart({ data, isLoading }: EquityChartProps) {
  if (isLoading || !data) {
    return <Skeleton className="w-full h-full rounded-none" />;
  }

  if (data.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground font-mono text-sm">
        NO EQUITY DATA AVAILABLE
      </div>
    );
  }

  // Add min/max for better chart scaling
  const minBalance = Math.min(...data.map(d => d.balance));
  const maxBalance = Math.max(...data.map(d => d.balance));
  const domainPadding = (maxBalance - minBalance) * 0.1;

  const CustomTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload as EquityPoint;
      const isPositivePnl = point.pnl >= 0;
      return (
        <div className="bg-card border border-border p-3 rounded-sm shadow-xl font-mono text-xs flex flex-col gap-1">
          <div className="text-muted-foreground mb-1">
            {format(new Date(point.timestamp), "MMM dd, HH:mm:ss")}
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">BALANCE:</span>
            <span className="font-medium">${point.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">PNL:</span>
            <span className={`font-medium ${isPositivePnl ? "text-success" : "text-destructive"}`}>
              {isPositivePnl ? "+" : ""}${point.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-full pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
          <XAxis 
            dataKey="timestamp" 
            tickFormatter={(tick) => format(new Date(tick), "HH:mm")}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            dy={10}
            minTickGap={50}
          />
          <YAxis 
            domain={[minBalance - domainPadding, maxBalance + domainPadding]} 
            tickFormatter={(tick) => `$${tick.toLocaleString()}`}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            dx={-10}
            width={70}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area 
            type="step" 
            dataKey="balance" 
            stroke="hsl(var(--primary))" 
            strokeWidth={2}
            fillOpacity={1} 
            fill="url(#colorBalance)" 
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
