/**
 * TradeExecution — a fill event created by the execution engine.
 *
 * One Order can produce multiple TradeExecutions (partial fills).
 * Stored in the `trade_executions` DB table.
 */
export interface TradeExecution {
  id: string;
  orderId: string;
  userId: string;
  price: number;
  quantity: number;
  executedAt: Date;
}
