import { PerformanceMetrics, TradeStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface PerformancePanelProps {
  performance?: PerformanceMetrics;
  stats?: TradeStats;
  isLoading: boolean;
}

export function PerformancePanel({ performance, stats, isLoading }: PerformancePanelProps) {
  const formatPercent = (val: number) => {
    return `${val.toFixed(1)}%`;
  };

  const formatDecimal = (val: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  return (
    <Card className="border-border/50 bg-card/30 flex-1">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Metrics</CardTitle>
      </CardHeader>
      <CardContent className="p-4 grid grid-cols-2 gap-4">
        {isLoading || !performance || !stats ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))
        ) : (
          <>
            <MetricItem 
              label="SHARPE RATIO" 
              value={formatDecimal(performance.sharpeRatio)} 
              valueClass={performance.sharpeRatio >= 1.5 ? "text-success" : performance.sharpeRatio < 1 ? "text-destructive" : "text-primary"}
            />
            <MetricItem 
              label="MAX DRAWDOWN" 
              value={formatPercent(performance.maxDrawdown)} 
              valueClass="text-destructive"
            />
            <MetricItem 
              label="PROFIT FACTOR" 
              value={formatDecimal(stats.profitFactor)} 
            />
            <MetricItem 
              label="AVG HOLD TIME" 
              value={`${formatDecimal(performance.avgHoldTime)}m`} 
            />
            <MetricItem 
              label="LONG WIN %" 
              value={formatPercent(stats.longWinRate)} 
              valueClass={stats.longWinRate >= 50 ? "text-success" : "text-muted-foreground"}
            />
            <MetricItem 
              label="SHORT WIN %" 
              value={formatPercent(stats.shortWinRate)} 
              valueClass={stats.shortWinRate >= 50 ? "text-success" : "text-muted-foreground"}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MetricItem({ label, value, valueClass = "text-foreground" }: { label: string; value: string | number; valueClass?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-mono text-muted-foreground mb-1">{label}</span>
      <span className={`text-sm font-mono font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
