import { useState, useEffect, useRef, useCallback } from "react";
import { AiParams, useUpdateParams, getGetParamsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";

interface AiParamsPanelProps {
  params?: AiParams;
  isLoading: boolean;
}

export function AiParamsPanel({ params, isLoading }: AiParamsPanelProps) {
  const queryClient = useQueryClient();
  const updateParams = useUpdateParams();
  
  const [localScore, setLocalScore] = useState<number>(0.8);
  const [localRisk, setLocalRisk] = useState<number>(0.02);

  const initRef = useRef<string | null>(null);
  const mutateFnRef = useRef(updateParams.mutate);
  mutateFnRef.current = updateParams.mutate;

  useEffect(() => {
    if (params && initRef.current !== params.updatedAt) {
      initRef.current = params.updatedAt;
      setLocalScore(params.minScore);
      setLocalRisk(params.riskPerTrade);
    }
  }, [params]);

  const saveParams = useCallback((newParams: { minScore?: number, riskPerTrade?: number }) => {
    mutateFnRef.current(
      { data: newParams },
      {
        onSuccess: (data: AiParams) => {
          queryClient.setQueryData(getGetParamsQueryKey(), data);
          initRef.current = data.updatedAt;
        }
      }
    );
  }, [queryClient]);

  const handleScoreChange = (val: number[]) => {
    setLocalScore(val[0]);
  };

  const handleScoreCommit = (val: number[]) => {
    saveParams({ minScore: val[0] });
  };

  const handleRiskChange = (val: number[]) => {
    setLocalRisk(val[0]);
  };

  const handleRiskCommit = (val: number[]) => {
    saveParams({ riskPerTrade: val[0] });
  };

  return (
    <Card className="border-border/50 bg-card/30 relative overflow-hidden">
      {updateParams.isPending && (
        <div className="absolute inset-0 z-10 bg-background/50 backdrop-blur-[1px] flex items-center justify-center">
          <span className="font-mono text-xs text-primary animate-pulse">UPDATING...</span>
        </div>
      )}
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center justify-between">
          <span>AI Parameters</span>
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse"></span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 flex flex-col gap-6">
        {isLoading || !params ? (
          <>
            <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-8 w-full" /></div>
            <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-8 w-full" /></div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-mono text-muted-foreground">MIN CONFIDENCE SCORE</Label>
                <span className="font-mono text-sm font-medium text-primary">{(localScore * 100).toFixed(0)}%</span>
              </div>
              <Slider 
                value={[localScore]} 
                min={0.5} 
                max={0.99} 
                step={0.01} 
                onValueChange={handleScoreChange}
                onValueCommit={handleScoreCommit}
                className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-2 [&_[role=slider]]:rounded-none [&_[role=slider]]:border-primary [&_[role=slider]]:bg-primary"
              />
              <p className="text-[10px] font-mono text-muted-foreground leading-tight">
                Threshold for AI to execute a trade. Higher values = fewer, more accurate trades.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-mono text-muted-foreground">RISK PER TRADE</Label>
                <span className="font-mono text-sm font-medium text-chart-4">{(localRisk * 100).toFixed(1)}%</span>
              </div>
              <Slider 
                value={[localRisk]} 
                min={0.005} 
                max={0.05} 
                step={0.005} 
                onValueChange={handleRiskChange}
                onValueCommit={handleRiskCommit}
                className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-2 [&_[role=slider]]:rounded-none [&_[role=slider]]:border-chart-4 [&_[role=slider]]:bg-chart-4"
              />
              <p className="text-[10px] font-mono text-muted-foreground leading-tight">
                Percentage of account balance risked per trade via stop loss sizing.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
