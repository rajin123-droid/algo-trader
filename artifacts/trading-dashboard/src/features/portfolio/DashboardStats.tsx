import { DashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Target, Activity } from "lucide-react";

interface DashboardStatsProps {
  dashboard?: DashboardSummary;
  isLoading: boolean;
}

export function DashboardStats({ dashboard, isLoading }: DashboardStatsProps) {
  if (isLoading || !dashboard) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-sm" />
        ))}
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      signDisplay: "always",
    }).format(val);
  };

  const formatPercent = (val: number) => {
    return `${val.toFixed(1)}%`;
  };

  const isPnlPositive = dashboard.totalPnl >= 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 md:gap-4">
      <StatCard
        title="TOTAL BALANCE"
        value={dashboard.balance.toLocaleString("en-US", { style: "currency", currency: "USD" })}
        icon={<Activity className="h-4 w-4 text-primary" />}
      />
      <StatCard
        title="NET PNL"
        value={formatCurrency(dashboard.totalPnl)}
        valueClass={isPnlPositive ? "text-success" : "text-destructive"}
        icon={isPnlPositive ? <ArrowUpRight className="h-4 w-4 text-success" /> : <ArrowDownRight className="h-4 w-4 text-destructive" />}
      />
      <StatCard
        title="WIN RATE"
        value={formatPercent(dashboard.winRate)}
        icon={<Target className="h-4 w-4 text-muted-foreground" />}
        subtitle={`${dashboard.winCount}W / ${dashboard.lossCount}L`}
      />
      <StatCard
        title="TOTAL TRADES"
        value={dashboard.totalTrades.toString()}
        icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
      />
      <StatCard
        title="AVG PNL / TRADE"
        value={formatCurrency(dashboard.avgPnl)}
        valueClass={dashboard.avgPnl >= 0 ? "text-success" : "text-destructive"}
      />
      <StatCard
        title="CURRENT STREAK"
        value={`${dashboard.currentStreak} ${dashboard.streakType === "NONE" ? "-" : dashboard.streakType}`}
        valueClass={
          dashboard.streakType === "WIN"
            ? "text-success"
            : dashboard.streakType === "LOSS"
            ? "text-destructive"
            : "text-muted-foreground"
        }
      />
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon, 
  valueClass = "text-foreground" 
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string; 
  icon?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <Card className="border-border/50 bg-card/30 overflow-hidden">
      <CardContent className="p-4 flex flex-col justify-center h-full">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{title}</span>
          {icon && <span>{icon}</span>}
        </div>
        <div className="flex items-baseline gap-2">
          <span className={`text-xl md:text-2xl font-mono font-medium tracking-tight ${valueClass}`}>
            {value}
          </span>
          {subtitle && (
            <span className="text-xs font-mono text-muted-foreground ml-auto">{subtitle}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
