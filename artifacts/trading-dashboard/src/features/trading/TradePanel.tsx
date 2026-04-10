import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { openPosition } from "@/features/positions/positions.lib";
import { openTrade } from "@/core/api";
import { getUser } from "@/core/auth";
import { ApiKeysPanel } from "@/features/auth/ApiKeysPanel";
import { KeyRound } from "lucide-react";

interface TradePanelProps {
  lastPrice: number;
  onLoginRequired: () => void;
}

interface OrderResult {
  ok: true;
  mode: "live" | "paper";
  side: "BUY" | "SELL";
  qty: number;
  price: number;
}

interface OrderError {
  ok: false;
  message: string;
}

type Feedback = OrderResult | OrderError | null;

function FeedbackBanner({ fb, onDismiss }: { fb: Feedback; onDismiss: () => void }) {
  if (!fb) return null;

  if (!fb.ok) {
    return (
      <div
        className="rounded px-3 py-2 text-[11px] font-mono flex items-center justify-between gap-2"
        style={{ background: "#F6465D18", border: "1px solid #F6465D44", color: "#F6465D" }}
      >
        <span>⚠ {fb.message}</span>
        <button onClick={onDismiss} className="opacity-60 hover:opacity-100 text-xs">✕</button>
      </div>
    );
  }

  return (
    <div
      className="rounded px-3 py-2 text-[11px] font-mono flex items-center justify-between gap-2"
      style={{
        background: fb.side === "BUY" ? "#0ECB8118" : "#F6465D18",
        border: `1px solid ${fb.side === "BUY" ? "#0ECB8144" : "#F6465D44"}`,
        color: fb.side === "BUY" ? "#0ECB81" : "#F6465D",
      }}
    >
      <span>
        ✓ {fb.side === "BUY" ? "Long" : "Short"} {fb.qty} @{" "}
        {fb.price.toLocaleString("en-US", { minimumFractionDigits: 2 })} ·{" "}
        <span className="opacity-70">{fb.mode}</span>
      </span>
      <button onClick={onDismiss} className="opacity-60 hover:opacity-100 text-xs">✕</button>
    </div>
  );
}

export function TradePanel({ lastPrice, onLoginRequired }: TradePanelProps) {
  const [qty, setQty] = useState("");
  const [leverage, setLeverage] = useState(10);
  const [orderType, setOrderType] = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  // Manual price override — shown when live price is unavailable (paper mode)
  const [manualPrice, setManualPrice] = useState("");
  const [flash, setFlash] = useState<"buy" | "sell" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const qtyNum = parseFloat(qty) || 0;
  const livePrice = lastPrice > 0 ? lastPrice : parseFloat(manualPrice) || 0;
  const priceToUse =
    orderType === "limit" && limitPrice ? parseFloat(limitPrice) : livePrice;
  const notional = qtyNum * priceToUse;
  const margin = notional / leverage;
  const liqEst =
    priceToUse > 0 ? priceToUse * (1 - 1 / leverage) : 0;

  // Show manual price input whenever the live feed returns 0
  const showManualPrice = lastPrice <= 0 && orderType === "market";

  async function handleAction(side: "BUY" | "SELL") {
    if (!qty || qtyNum <= 0 || priceToUse <= 0 || submitting) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const user = getUser();
      let dbId: number | undefined;
      let mode: "live" | "paper" = "paper";

      if (user) {
        try {
          const res = await openTrade({
            symbol: "BTCUSDT",
            price: priceToUse,
            qty: qtyNum,
            side,
            leverage,
          });
          dbId = res.position?.id;
          mode = (res.mode as "live" | "paper") ?? "paper";
        } catch (err) {
          // Show the server error but still fall through to paper trade
          const msg = err instanceof Error ? err.message : "Order rejected";
          setFeedback({ ok: false, message: msg });
          setSubmitting(false);
          return;
        }
      }

      openPosition(side, qtyNum, priceToUse, leverage, dbId);

      setFeedback({ ok: true, mode, side, qty: qtyNum, price: priceToUse });
      setFlash(side === "BUY" ? "buy" : "sell");
      setQty("");
      setTimeout(() => setFlash(null), 600);
      // Auto-dismiss success after 4 s
      setTimeout(() => setFeedback(null), 4000);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="flex flex-col h-full p-3 gap-3 text-sm transition-colors duration-300"
      style={{
        background:
          flash === "buy"
            ? "rgba(14,203,129,0.06)"
            : flash === "sell"
            ? "rgba(246,70,93,0.06)"
            : undefined,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Futures
        </span>
        <div className="flex items-center gap-2">
          {getUser() && (
            <button
              onClick={() => setShowKeys((v) => !v)}
              title="Binance API Keys"
              className="transition-colors"
              style={{ color: showKeys ? "#FCD535" : "#848E9C" }}
            >
              <KeyRound className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="text-[10px] font-mono px-2 py-[1px] rounded border border-yellow-500/50 text-yellow-400">
            Cross {leverage}x
          </span>
        </div>
      </div>

      {showKeys && getUser() && (
        <ApiKeysPanel onClose={() => setShowKeys(false)} />
      )}

      <Tabs value={orderType} onValueChange={setOrderType}>
        <TabsList className="w-full h-7 bg-muted/30 text-[11px]">
          <TabsTrigger value="market" className="flex-1 text-[11px]">
            Market
          </TabsTrigger>
          <TabsTrigger value="limit" className="flex-1 text-[11px]">
            Limit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="market" className="mt-2 space-y-2">
          {showManualPrice ? (
            <div className="space-y-1">
              <label className="text-[10px] font-mono text-muted-foreground">
                REFERENCE PRICE (USDT){" "}
                <span className="text-yellow-500/70">— live feed offline</span>
              </label>
              <Input
                placeholder="e.g. 84000"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                className="h-8 text-sm font-mono bg-background/50 border-yellow-500/30"
                data-testid="input-manual-price"
              />
            </div>
          ) : (
            <div className="text-[10px] font-mono text-muted-foreground">
              Mkt Price:{" "}
              <span className="text-foreground">
                {lastPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-muted-foreground">
              QUANTITY (BTC)
            </label>
            <Input
              placeholder="0.000"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-8 text-sm font-mono bg-background/50 border-border/60"
              data-testid="input-quantity"
            />
          </div>
        </TabsContent>

        <TabsContent value="limit" className="mt-2 space-y-2">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-muted-foreground">
              LIMIT PRICE (USDT)
            </label>
            <Input
              placeholder={lastPrice > 0 ? lastPrice.toFixed(2) : "0.00"}
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="h-8 text-sm font-mono bg-background/50 border-border/60"
              data-testid="input-limit-price"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-muted-foreground">
              QUANTITY (BTC)
            </label>
            <Input
              placeholder="0.000"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-8 text-sm font-mono bg-background/50 border-border/60"
              data-testid="input-quantity-limit"
            />
          </div>
        </TabsContent>
      </Tabs>

      <div className="space-y-1">
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
          <span>LEVERAGE</span>
          <span className="text-primary font-bold">{leverage}x</span>
        </div>
        <Slider
          min={1}
          max={125}
          step={1}
          value={[leverage]}
          onValueChange={([v]) => setLeverage(v)}
          className="py-1"
          data-testid="slider-leverage"
        />
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60">
          <span>1x</span>
          <span>25x</span>
          <span>50x</span>
          <span>100x</span>
          <span>125x</span>
        </div>
      </div>

      {qtyNum > 0 && priceToUse > 0 && (
        <div className="rounded border border-border/30 bg-muted/10 p-2 space-y-1">
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-muted-foreground">Notional</span>
            <span>
              $
              {notional.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-muted-foreground">Req. Margin</span>
            <span>
              $
              {margin.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-muted-foreground">Liq. Est.</span>
            <span style={{ color: "#F6465D" }}>
              {liqEst.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>
      )}

      {feedback && (
        <FeedbackBanner fb={feedback} onDismiss={() => setFeedback(null)} />
      )}

      <div className="mt-auto space-y-2">
        {!getUser() && (
          <button
            onClick={onLoginRequired}
            className="w-full text-[10px] font-mono text-muted-foreground hover:text-yellow-400 transition-colors underline underline-offset-2"
          >
            Sign in to persist positions
          </button>
        )}
        <div className="flex gap-2">
          <Button
            className="flex-1 h-9 text-xs font-mono font-bold border-0"
            style={{ background: "#0ECB81", color: "#0B0E11" }}
            onClick={() => handleAction("BUY")}
            disabled={qtyNum <= 0 || priceToUse <= 0 || submitting}
            data-testid="button-buy-long"
          >
            {submitting ? "…" : "BUY / LONG"}
          </Button>
          <Button
            className="flex-1 h-9 text-xs font-mono font-bold border-0"
            style={{ background: "#F6465D", color: "#fff" }}
            onClick={() => handleAction("SELL")}
            disabled={qtyNum <= 0 || priceToUse <= 0 || submitting}
            data-testid="button-sell-short"
          >
            {submitting ? "…" : "SELL / SHORT"}
          </Button>
        </div>
      </div>
    </div>
  );
}
