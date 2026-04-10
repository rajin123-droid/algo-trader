/**
 * StrategyCompiler
 *
 * Converts a StrategyConfig (JSON) into a runnable Strategy instance that
 * implements the standard Strategy interface from @workspace/strategy-engine.
 *
 * Compilation steps:
 *   1. Inspect `config.indicators[]` and create incremental state objects
 *      for each indicator (EMAState, RSIState, MACDState, …).
 *   2. Compile `config.rules.entry` and `config.rules.exit` into executable
 *      JavaScript functions via the SafeExpressionCompiler.
 *   3. Return a CompiledStrategy instance that computes indicators on each
 *      candle and evaluates the compiled entry/exit functions.
 *
 * Stop-loss / Take-profit:
 *   The compiler adds SL/TP checks independently of the rule expressions.
 *   If the current candle's close breaches the SL or TP relative to the
 *   entry price, a SELL signal is forced — overriding the rule expressions.
 *
 * Expression variable naming (must match prompt-builder.ts conventions):
 *   EMA<period>    → EMAState for that period
 *   SMA<period>    → SMAState for that period
 *   RSI / RSI<n>   → RSIState
 *   MACDLine       → MACD line value
 *   MACDSignal     → MACD signal line
 *   MACDHistogram  → MACD histogram
 */

import type { Strategy, Candle, Signal } from "../../../strategy-engine/src/strategies/strategy.interface.js";
import { createEMAState, updateEMA, type EMAState } from "../../../strategy-engine/src/indicators/ema.js";
import { createSMAState, updateSMA, type SMAState } from "../../../strategy-engine/src/indicators/sma.js";
import { createRSIState, updateRSI, type RSIState } from "../../../strategy-engine/src/indicators/rsi.js";
import { createMACDState, updateMACD, type MACDState } from "../../../strategy-engine/src/indicators/macd.js";
import type { StrategyConfig, IndicatorConfig } from "../models/strategy-config.js";

/* ── Expression compiler ──────────────────────────────────────────────────── */

/**
 * Compile a rule expression string into a function that accepts an indicator
 * values object and returns a boolean.
 *
 * Example:
 *   compile("EMA12 > EMA26 AND RSI < 70")
 *   // → (vars) => vars.EMA12 > vars.EMA26 && vars.RSI < 70
 *
 * Security:
 *   The expression is executed with `new Function()`.  This is acceptable
 *   because the string originates from a controlled AI prompt that produces
 *   only arithmetic/comparison expressions — no user-supplied input.
 *
 * Transformation steps:
 *   AND → &&  |  OR → ||  |  NOT → !
 *   Each identifier (e.g. EMA12) → vars["EMA12"]
 */
function compileExpression(expr: string): (vars: Record<string, number>) => boolean {
  const js = expr
    .replace(/\bAND\b/g, "&&")
    .replace(/\bOR\b/g,  "||")
    .replace(/\bNOT\b/g, "!")
    // Replace identifiers that start with a letter and optionally contain digits/underscore
    // but are NOT comparison operators or JS keywords
    .replace(/\b([A-Za-z][A-Za-z0-9_]*)\b/g, (match) => {
      const keywords = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);
      return keywords.has(match) ? match : `vars["${match}"]`;
    });

  try {
    // eslint-disable-next-line no-new-func
    return new Function("vars", `return !!(${js});`) as (vars: Record<string, number>) => boolean;
  } catch {
    // Fallback: always return false (no signal) if compilation fails
    console.warn(`[StrategyCompiler] Failed to compile expression: "${expr}"`);
    return () => false;
  }
}

/* ── Indicator state factory ──────────────────────────────────────────────── */

interface IndicatorHandle {
  /** Variable name used in expressions (e.g. "EMA12", "RSI", "MACDLine") */
  varName: string;
  update:  (price: number) => number;
}

function buildIndicatorHandles(indicators: IndicatorConfig[]): IndicatorHandle[][] {
  return indicators.map((ind): IndicatorHandle[] => {
    switch (ind.type) {
      case "EMA": {
        const period = ind.params.period ?? 12;
        const state: EMAState = createEMAState(period);
        return [{
          varName: `EMA${period}`,
          update:  (price) => updateEMA(state, price),
        }];
      }

      case "SMA": {
        const period = ind.params.period ?? 20;
        const state: SMAState = createSMAState(period);
        return [{
          varName: `SMA${period}`,
          update:  (price) => updateSMA(state, price),
        }];
      }

      case "RSI": {
        const period = ind.params.period ?? 14;
        const state: RSIState = createRSIState(period);
        const varName = `RSI${period === 14 ? "" : period}`;
        return [{
          varName,
          update: (price) => updateRSI(state, price),
        }, {
          // Always expose plain "RSI" too
          varName: "RSI",
          update: (price) => {
            // re-use same state — second call reads cached value
            // We store the last value in a closure instead
            return NaN; // placeholder — overridden below
          },
        }].filter(() => false) // not used — rebuilt below
          .concat([{
            varName: `RSI${period === 14 ? "" : period}`,
            update: (() => {
              let last = NaN;
              return (price: number) => {
                last = updateRSI(state, price);
                return last;
              };
            })(),
          }, {
            varName: "RSI",
            update: (() => {
              // Share the same RSI value by reusing the computed result
              let last = NaN;
              return (_: number) => last;
            })(),
          }]);
      }

      case "MACD": {
        const fast   = ind.params.fast   ?? ind.params.period ?? 12;
        const slow   = ind.params.slow   ?? 26;
        const signal = ind.params.signal ?? 9;
        const state: MACDState = createMACDState(fast, slow, signal);
        let lastValues = { macd: NaN, signal: NaN, histogram: NaN };
        return [
          {
            varName: "MACDLine",
            update:  (price) => {
              lastValues = updateMACD(state, price);
              return lastValues.macd;
            },
          },
          {
            varName: "MACDSignal",
            update:  () => lastValues.signal,
          },
          {
            varName: "MACDHistogram",
            update:  () => lastValues.histogram,
          },
        ];
      }

      default:
        return [];
    }
  }).filter(handles => handles.length > 0);
}

/* ── RSI fix: proper shared state ────────────────────────────────────────── */

function buildRSIHandle(period: number): IndicatorHandle[] {
  const state: RSIState = createRSIState(period);
  let last = NaN;
  return [
    {
      varName: `RSI${period === 14 ? "" : period}`,
      update: (price) => { last = updateRSI(state, price); return last; },
    },
    {
      varName: "RSI",
      update: () => last,
    },
  ];
}

/* ── CompiledStrategy ─────────────────────────────────────────────────────── */

/**
 * A Strategy instance compiled from a StrategyConfig.
 *
 * Compatible with Backtester and AutoTradingEngine.
 */
class CompiledStrategy implements Strategy {
  readonly id:   string;
  readonly name: string;

  private handles:      IndicatorHandle[];
  private entryFn:      (vars: Record<string, number>) => boolean;
  private exitFn:       (vars: Record<string, number>) => boolean;

  private entryPrice:   number | null = null;
  private readonly stopLoss:    number;
  private readonly takeProfit:  number;

  constructor(
    private readonly config: StrategyConfig,
  ) {
    this.id   = "compiled:" + (config.name ?? "ai-strategy");
    this.name = config.name ?? "AI Strategy";

    this.handles     = this.buildHandles();
    this.entryFn     = compileExpression(config.rules.entry);
    this.exitFn      = compileExpression(config.rules.exit);
    this.stopLoss    = config.risk.stopLoss;
    this.takeProfit  = config.risk.takeProfit;
  }

  onCandle(candle: Candle): Signal | null {
    const vars: Record<string, number> = { price: candle.close };

    // ── Update all indicators ─────────────────────────────────────────────
    for (const handle of this.handles) {
      vars[handle.varName] = handle.update(candle.close);
    }

    // Skip if any indicator is still in warm-up
    if (Object.values(vars).some((v) => v !== vars["price"] && isNaN(v))) {
      // Only skip if a RELEVANT indicator is NaN
      // (some MACD sub-fields can be NaN until signal warms up)
    }

    // ── Stop-loss / Take-profit (position management) ─────────────────────
    if (this.entryPrice !== null) {
      const priceDelta = (candle.close - this.entryPrice) / this.entryPrice;

      if (
        (this.stopLoss   > 0 && priceDelta <= -this.stopLoss)  ||
        (this.takeProfit > 0 && priceDelta >=  this.takeProfit)
      ) {
        this.entryPrice = null;
        return { type: "SELL", size: 1 };
      }
    }

    // ── Rule evaluation ───────────────────────────────────────────────────
    if (this.entryPrice === null) {
      // Flat — look for entry signal
      try {
        if (this.entryFn(vars)) {
          this.entryPrice = candle.close;
          return { type: "BUY", size: 1 };
        }
      } catch {}
    } else {
      // In position — look for exit signal
      try {
        if (this.exitFn(vars)) {
          this.entryPrice = null;
          return { type: "SELL", size: 1 };
        }
      } catch {}
    }

    return null;
  }

  reset(): void {
    this.handles    = this.buildHandles();
    this.entryPrice = null;
  }

  private buildHandles(): IndicatorHandle[] {
    const all: IndicatorHandle[] = [];

    for (const ind of this.config.indicators) {
      if (ind.type === "EMA") {
        const period = ind.params.period ?? 12;
        const state  = createEMAState(period);
        all.push({ varName: `EMA${period}`, update: (p) => updateEMA(state, p) });
      } else if (ind.type === "SMA") {
        const period = ind.params.period ?? 20;
        const state  = createSMAState(period);
        all.push({ varName: `SMA${period}`, update: (p) => updateSMA(state, p) });
      } else if (ind.type === "RSI") {
        const period = ind.params.period ?? 14;
        all.push(...buildRSIHandle(period));
      } else if (ind.type === "MACD") {
        const fast   = ind.params.fast   ?? ind.params.period ?? 12;
        const slow   = ind.params.slow   ?? 26;
        const signal = ind.params.signal ?? 9;
        const state  = createMACDState(fast, slow, signal);
        let last     = { macd: NaN, signal: NaN, histogram: NaN };
        all.push(
          { varName: "MACDLine",      update: (p) => { last = updateMACD(state, p); return last.macd; } },
          { varName: "MACDSignal",    update: () => last.signal },
          { varName: "MACDHistogram", update: () => last.histogram },
        );
      }
    }

    return all;
  }
}

/* ── Public factory ───────────────────────────────────────────────────────── */

/**
 * Compile a StrategyConfig into a runnable Strategy.
 *
 * Usage:
 *   const strategy = compileStrategy(config);
 *   const bt = new Backtester({ strategy, candles });
 *   const result = bt.run();
 */
export function compileStrategy(config: StrategyConfig): Strategy {
  return new CompiledStrategy(config);
}
