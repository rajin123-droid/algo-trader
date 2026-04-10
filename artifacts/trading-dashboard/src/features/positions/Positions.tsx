import { Position, calcPnl, removePosition } from "@/features/positions/positions.lib";
import { closeTrade } from "@/core/api";
import { getUser } from "@/core/auth";
import { X } from "lucide-react";

interface PositionsProps {
  positions: Position[];
  currentPrice: number;
}

export function Positions({ positions, currentPrice }: PositionsProps) {
  const totalPnl = positions.reduce(
    (sum, p) => sum + calcPnl(p, currentPrice),
    0
  );

  async function handleClose(pos: Position) {
    const user = getUser();

    if (user && pos.dbId) {
      try {
        await closeTrade({ positionId: pos.dbId, price: currentPrice });
      } catch {
        // still remove locally even if API fails
      }
    }

    removePosition(pos.id);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-1 shrink-0"
        style={{ borderBottom: "1px solid #2B3139" }}
      >
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Positions ({positions.length})
        </span>
        {positions.length > 0 && (
          <span
            className="text-xs font-mono font-bold tabular-nums"
            style={{ color: totalPnl >= 0 ? "#0ECB81" : "#F6465D" }}
          >
            Total PnL: {totalPnl >= 0 ? "+" : ""}${(Number(totalPnl) || 0).toFixed(2)}
          </span>
        )}
      </div>

      {positions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[11px] font-mono text-muted-foreground/50">
          No open positions
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr
                className="text-[10px] text-muted-foreground"
                style={{ borderBottom: "1px solid #2B3139" }}
              >
                <th className="text-left px-3 py-1 font-normal">Side</th>
                <th className="text-right px-2 py-1 font-normal">Entry</th>
                <th className="text-right px-2 py-1 font-normal">Qty</th>
                <th className="text-right px-2 py-1 font-normal">Lev</th>
                <th className="text-right px-2 py-1 font-normal">Liq.</th>
                <th className="text-right px-2 py-1 font-normal">PnL</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const pnl = calcPnl(pos, currentPrice);
                const isPnlPos = pnl >= 0;
                return (
                  <tr
                    key={pos.id}
                    className="hover:bg-white/[0.02] transition-colors"
                    style={{ borderBottom: "1px solid #1e2329" }}
                    data-testid={`position-row-${pos.id}`}
                  >
                    <td className="px-3 py-[3px]">
                      <span
                        className="text-[10px] font-bold px-1 rounded"
                        style={{
                          color: pos.side === "BUY" ? "#0ECB81" : "#F6465D",
                          background:
                            pos.side === "BUY"
                              ? "rgba(14,203,129,0.12)"
                              : "rgba(246,70,93,0.12)",
                        }}
                      >
                        {pos.side === "BUY" ? "LONG" : "SHORT"}
                      </span>
                    </td>
                    <td className="text-right px-2 py-[3px] tabular-nums">
                      {pos.entry.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="text-right px-2 py-[3px] tabular-nums text-muted-foreground">
                      {(Number(pos.qty) || 0).toFixed(4)}
                    </td>
                    <td className="text-right px-2 py-[3px] tabular-nums text-yellow-400">
                      {pos.leverage}x
                    </td>
                    <td
                      className="text-right px-2 py-[3px] tabular-nums"
                      style={{ color: "#F6465D" }}
                    >
                      {pos.liqPrice.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td
                      className="text-right px-2 py-[3px] tabular-nums font-bold"
                      style={{ color: isPnlPos ? "#0ECB81" : "#F6465D" }}
                    >
                      {isPnlPos ? "+" : ""}${(Number(pnl) || 0).toFixed(2)}
                    </td>
                    <td className="px-2 py-[3px]">
                      <button
                        onClick={() => handleClose(pos)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        data-testid={`button-close-position-${pos.id}`}
                        title="Close position"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
