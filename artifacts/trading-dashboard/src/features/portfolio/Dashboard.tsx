import {
  useGetDashboard,
  getGetDashboardQueryKey,
  useGetPerformance,
  getGetPerformanceQueryKey,
  useGetTradeStats,
  getGetTradeStatsQueryKey,
  useGetParams,
  getGetParamsQueryKey,
  useListTrades,
  getListTradesQueryKey,
  useGetEquityCurve,
  getGetEquityCurveQueryKey,
  useSimulateTrade,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardStats } from "./DashboardStats";
import { EquityChart } from "./EquityChart";
import { TradeHistory } from "./TradeHistory";
import { AiParamsPanel } from "@/features/strategies/AiParamsPanel";
import { PerformancePanel } from "./PerformancePanel";
import { LedgerBalancesPanel } from "./LedgerBalancesPanel";

export default function Dashboard() {
  const queryClient = useQueryClient();

  const { data: dashboard, isLoading: isLoadingDashboard } = useGetDashboard({
    query: { refetchInterval: 5000, queryKey: getGetDashboardQueryKey() },
  });
  const { data: performance, isLoading: isLoadingPerformance } = useGetPerformance({
    query: { refetchInterval: 5000, queryKey: getGetPerformanceQueryKey() },
  });
  const { data: tradeStats, isLoading: isLoadingTradeStats } = useGetTradeStats({
    query: { refetchInterval: 5000, queryKey: getGetTradeStatsQueryKey() },
  });
  const { data: params, isLoading: isLoadingParams } = useGetParams({
    query: { queryKey: getGetParamsQueryKey() },
  });
  const { data: trades, isLoading: isLoadingTrades } = useListTrades(
    { limit: 50 },
    { query: { refetchInterval: 5000, queryKey: getListTradesQueryKey({ limit: 50 }) } }
  );
  const { data: equityCurve, isLoading: isLoadingEquityCurve } = useGetEquityCurve({
    query: { refetchInterval: 5000, queryKey: getGetEquityCurveQueryKey() },
  });

  const simulateTrade = useSimulateTrade();

  const handleSimulateTrade = () => {
    simulateTrade.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPerformanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTradeStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTradesQueryKey({ limit: 50 }) });
        queryClient.invalidateQueries({ queryKey: getGetEquityCurveQueryKey() });
      },
    });
  };

  const isLoading =
    isLoadingDashboard ||
    isLoadingPerformance ||
    isLoadingTradeStats ||
    isLoadingParams ||
    isLoadingTrades ||
    isLoadingEquityCurve;

  void isLoading;

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground font-sans">
      <div className="sticky top-0 z-10 border-b border-border/50 bg-card/80 backdrop-blur-sm px-4 flex items-center justify-between h-11">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-yellow-400" />
          <span>Portfolio Overview</span>
          <span className="text-border ml-2">
            {format(new Date(), "HH:mm:ss 'UTC'")}
          </span>
        </div>
        <Button
          size="sm"
          className="h-7 font-mono text-xs gap-2"
          onClick={handleSimulateTrade}
          disabled={simulateTrade.isPending}
        >
          {simulateTrade.isPending ? (
            <Activity className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {simulateTrade.isPending ? "SIMULATING…" : "SIMULATE TRADE"}
        </Button>
      </div>

      <div className="p-4 grid grid-cols-12 gap-4 auto-rows-min">
        <div className="col-span-12">
          <DashboardStats dashboard={dashboard} isLoading={isLoadingDashboard} />
        </div>

        <div className="col-span-12 lg:col-span-9 flex flex-col gap-4">
          <Card className="flex-1 min-h-[400px] border-border/50 bg-card/30">
            <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Equity Curve
              </CardTitle>
              {dashboard && (
                <div className="font-mono text-sm text-foreground">
                  $
                  {dashboard.balance.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0 h-[calc(100%-49px)]">
              <EquityChart data={equityCurve} isLoading={isLoadingEquityCurve} />
            </CardContent>
          </Card>
        </div>

        <div className="col-span-12 lg:col-span-3 flex flex-col gap-4">
          <LedgerBalancesPanel />
          <AiParamsPanel params={params} isLoading={isLoadingParams} />
          <PerformancePanel
            performance={performance}
            stats={tradeStats}
            isLoading={isLoadingPerformance || isLoadingTradeStats}
          />
        </div>

        <div className="col-span-12">
          <TradeHistory trades={trades} isLoading={isLoadingTrades} />
        </div>
      </div>
    </div>
  );
}
