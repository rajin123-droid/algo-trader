import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KeyRound, Trash2, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { getBinanceKeyStatus, saveBinanceKeys, deleteBinanceKeys, KeyStatus } from "@/core/api";

interface ApiKeysPanelProps {
  onClose: () => void;
}

export function ApiKeysPanel({ onClose }: ApiKeysPanelProps) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [testnet, setTestnet] = useState(true);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getBinanceKeyStatus().then(setStatus).catch(() => {});
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey || !apiSecret) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await saveBinanceKeys(apiKey, apiSecret, testnet);
      if (res.error) { setMsg(res.error); return; }
      setMsg("Keys saved — orders will now execute on Binance" + (testnet ? " Testnet" : ""));
      setApiKey("");
      setApiSecret("");
      const updated = await getBinanceKeyStatus();
      setStatus(updated);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    try {
      await deleteBinanceKeys();
      setStatus({ connected: false });
      setMsg("Keys removed — switched back to paper trading");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-3 p-4 font-mono text-sm"
      style={{ borderTop: "1px solid #2B3139" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 text-yellow-400" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-yellow-400">
            Binance API Keys
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {status?.connected ? (
        <div
          className="flex items-center justify-between rounded px-3 py-2"
          style={{ background: "rgba(14,203,129,0.08)", border: "1px solid rgba(14,203,129,0.2)" }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "#0ECB81" }} />
            <div>
              <div className="text-[11px]" style={{ color: "#0ECB81" }}>
                {status.testnet ? "Testnet" : "Live"} — {status.apiKeyPrefix}
              </div>
              <div className="text-[10px] text-muted-foreground">Real orders active</div>
            </div>
          </div>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="text-muted-foreground hover:text-destructive transition-colors"
            title="Remove keys"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 rounded px-3 py-2"
          style={{ background: "rgba(246,70,93,0.06)", border: "1px solid rgba(246,70,93,0.15)" }}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" style={{ color: "#F6465D" }} />
          <span className="text-[10px] text-muted-foreground">
            No keys — running as paper trader
          </span>
        </div>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            API Key
          </label>
          <Input
            placeholder="Paste API key…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="h-8 text-xs font-mono bg-background/40 border-border/60"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Secret Key
          </label>
          <Input
            type="password"
            placeholder="Paste secret…"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            className="h-8 text-xs font-mono bg-background/40 border-border/60"
            autoComplete="off"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div
            onClick={() => setTestnet(!testnet)}
            className="relative w-8 h-4 rounded-full transition-colors"
            style={{ background: testnet ? "#FCD535" : "#2B3139" }}
          >
            <div
              className="absolute top-[2px] w-3 h-3 rounded-full transition-all"
              style={{
                background: testnet ? "#0B0E11" : "#848E9C",
                left: testnet ? "18px" : "2px",
              }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">
            {testnet ? "Testnet (safe)" : "Live trading ⚠️"}
          </span>
        </label>

        {msg && (
          <p
            className="text-[10px] text-center"
            style={{ color: msg.includes("saved") || msg.includes("removed") ? "#0ECB81" : "#F6465D" }}
          >
            {msg}
          </p>
        )}

        <Button
          type="submit"
          disabled={loading || !apiKey || !apiSecret}
          className="h-8 text-[11px] font-mono font-bold border-0"
          style={{ background: "#FCD535", color: "#0B0E11" }}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save & Connect"}
        </Button>
      </form>

      <p className="text-[9px] text-muted-foreground/50 text-center leading-relaxed">
        Keys are stored server-side and never sent to the browser after saving.
        Use Testnet keys until you are ready for real trading.
      </p>
    </div>
  );
}
