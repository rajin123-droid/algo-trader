import { cn } from "@/lib/utils";
import { Minus, TrendingUp, X } from "lucide-react";
import { useDrawingStore } from "../drawing/drawing.store";

export interface IndicatorConfig {
  ema9: boolean;
  ema21: boolean;
  ema55: boolean;
  volume: boolean;
  rsi: boolean;
  macd: boolean;
}

interface IndicatorPanelProps {
  indicators: IndicatorConfig;
  onToggle: (key: keyof IndicatorConfig) => void;
}

const BORDER = "1px solid #2B3139";

interface ChipProps {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}

function Chip({ label, active, color, onClick }: ChipProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-[3px] text-[10px] font-mono rounded transition-all"
      style={{
        background: active ? "#1E2329" : "transparent",
        color: active ? (color ?? "#E8E8E8") : "#555C6A",
        border: active
          ? `1px solid ${color ?? "#444"}`
          : "1px solid transparent",
        fontWeight: active ? 600 : 400,
      }}
    >
      {color && (
        <span
          className="inline-block w-2 h-[2px] rounded-full"
          style={{ background: active ? color : "#555C6A" }}
        />
      )}
      {label}
    </button>
  );
}

export function IndicatorPanel({ indicators, onToggle }: IndicatorPanelProps) {
  const { mode, setMode, clearAll, pending } = useDrawingStore();

  return (
    <div
      className="flex items-center gap-1 px-3 py-1 shrink-0 flex-wrap"
      style={{ borderBottom: BORDER, background: "#0D1117", minHeight: 32 }}
    >
      <span className="text-[10px] text-muted-foreground/60 mr-1">
        INDICATORS
      </span>

      <Chip
        label="EMA9"
        active={indicators.ema9}
        color="#E91E63"
        onClick={() => onToggle("ema9")}
      />
      <Chip
        label="EMA21"
        active={indicators.ema21}
        color="#2196F3"
        onClick={() => onToggle("ema21")}
      />
      <Chip
        label="EMA55"
        active={indicators.ema55}
        color="#FF9800"
        onClick={() => onToggle("ema55")}
      />
      <Chip
        label="VOL"
        active={indicators.volume}
        color="#848E9C"
        onClick={() => onToggle("volume")}
      />

      <div
        className="h-4 w-px mx-1"
        style={{ background: "#2B3139" }}
      />

      <Chip
        label="RSI"
        active={indicators.rsi}
        color="#9C27B0"
        onClick={() => onToggle("rsi")}
      />
      <Chip
        label="MACD"
        active={indicators.macd}
        color="#00BCD4"
        onClick={() => onToggle("macd")}
      />

      <div
        className="h-4 w-px mx-1"
        style={{ background: "#2B3139" }}
      />

      <span className="text-[10px] text-muted-foreground/60 mr-1">DRAW</span>

      <button
        onClick={() => setMode(mode === "trendline" ? "none" : "trendline")}
        className={cn(
          "flex items-center gap-1 px-2 py-[3px] text-[10px] font-mono rounded border transition-all",
          mode === "trendline"
            ? "bg-[#F0B90B]/20 text-[#F0B90B] border-[#F0B90B]/40"
            : "bg-transparent text-[#555C6A] border-transparent hover:text-muted-foreground"
        )}
      >
        <TrendingUp className="h-3 w-3" />
        Trend
      </button>

      <button
        onClick={() => setMode(mode === "hline" ? "none" : "hline")}
        className={cn(
          "flex items-center gap-1 px-2 py-[3px] text-[10px] font-mono rounded border transition-all",
          mode === "hline"
            ? "bg-[#F0B90B]/20 text-[#F0B90B] border-[#F0B90B]/40"
            : "bg-transparent text-[#555C6A] border-transparent hover:text-muted-foreground"
        )}
      >
        <Minus className="h-3 w-3" />
        H-Line
      </button>

      <button
        onClick={clearAll}
        className="flex items-center gap-1 px-2 py-[3px] text-[10px] font-mono rounded border border-transparent text-[#555C6A] hover:text-muted-foreground transition-colors"
      >
        <X className="h-3 w-3" />
        Clear
      </button>

      {mode !== "none" && (
        <span className="ml-2 text-[10px] text-[#F0B90B] animate-pulse">
          {mode === "trendline"
            ? pending
              ? "Click end point →"
              : "Click start point →"
            : "Click to place line →"}
          <kbd className="ml-1 px-1 bg-[#2B3139] rounded text-[9px]">Esc</kbd>{" "}
          to cancel
        </span>
      )}
    </div>
  );
}
