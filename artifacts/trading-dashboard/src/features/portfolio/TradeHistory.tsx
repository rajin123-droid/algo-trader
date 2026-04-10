import { Trade } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface TradeHistoryProps {
  trades?: Trade[];
  isLoading: boolean;
}

export function TradeHistory({ trades, isLoading }: TradeHistoryProps) {
  return (
    <Card className="border-border/50 bg-card/30">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Trade Ledger</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto max-h-[400px]">
          <Table>
            <TableHeader className="bg-card/50 sticky top-0 z-10">
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="font-mono text-[10px] text-muted-foreground h-8">ID</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground h-8">TIME</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground h-8">DIR</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground h-8 text-right">SIZE</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground h-8 text-right">ENTRY</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground h-8 text-right">EXIT</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground h-8 text-right">PNL</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground h-8 text-center">RESULT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12 mx-auto" /></TableCell>
                  </TableRow>
                ))
              ) : trades?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center font-mono text-sm text-muted-foreground">
                    NO TRADES RECORDED
                  </TableCell>
                </TableRow>
              ) : (
                trades?.map((trade) => {
                  const isWin = trade.result === "WIN";
                  const isLong = trade.direction === "LONG";

                  return (
                    <TableRow key={trade.id} className="border-border/50 hover:bg-card/50 transition-colors">
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        #{trade.id}
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {format(new Date(trade.closeTime), "MM/dd HH:mm:ss")}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">
                        <span className={isLong ? "text-primary" : "text-chart-4"}>
                          {trade.direction}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-right">
                        {trade.size.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-right text-muted-foreground">
                        {trade.entry.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-right text-muted-foreground">
                        {trade.exit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className={`font-mono text-xs font-medium text-right ${isWin ? "text-success" : "text-destructive"}`}>
                        {isWin ? "+" : ""}{trade.pnl.toLocaleString(undefined, { style: "currency", currency: "USD" })}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge 
                          variant="outline" 
                          className={`font-mono text-[10px] rounded-sm px-1.5 py-0 border-transparent ${
                            isWin 
                              ? "bg-success/10 text-success" 
                              : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {trade.result}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
