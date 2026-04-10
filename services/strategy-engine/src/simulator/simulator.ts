import type { Signal, Candle } from "../strategies/strategy.interface.js";

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface SimulatedTrade {
  entryTime: number;
  exitTime:  number;
  entryPrice: number;
  exitPrice:  number;
  /** Units bought/sold. */
  size: number;
  /** Gross P&L (exit − entry) × size. */
  pnl: number;
  /** Percentage return on the position's cost. */
  returnPct: number;
}

export interface SimulatorResults {
  finalBalance:  number;
  initialBalance: number;
  pnl:           number;
  pnlPct:        number;
  /** Number of completed (entry + exit) round-trips. */
  totalTrades:   number;
  openPosition: {
    entryTime:  number;
    entryPrice: number;
    size:       number;
  } | null;
  trades:        SimulatedTrade[];
  /** Balance after each closed trade, for plotting. */
  equityCurve:   { time: number; balance: number }[];
}

/* ── Simulator ────────────────────────────────────────────────────────────── */

/**
 * Simulator — pure in-memory trade execution against a sequence of candles.
 *
 * Rules:
 *   • One position at a time (no pyramiding).
 *   • BUY signal  → open long if no position.
 *   • SELL signal → close long if position is open.
 *   • Size is capped by available balance at the entry price.
 *   • No fees, no slippage (extend `execute()` to add these).
 *
 * Python equivalent:
 *   class Simulator:
 *     def execute(self, signal, candle):
 *       if signal == 'BUY' and not self.position:
 *         self.position = self.balance / candle.close
 *         self.entry = candle.close
 *       elif signal == 'SELL' and self.position:
 *         pnl = (candle.close - self.entry) * self.position
 *         self.balance += pnl
 *         self.position = 0
 */
export class Simulator {
  private balance: number;
  private readonly initialBalance: number;

  /** Number of units currently held (0 = flat). */
  private position = 0;
  private entryPrice = 0;
  private entryTime  = 0;

  private trades: SimulatedTrade[] = [];
  private equityCurve: { time: number; balance: number }[] = [];

  constructor(initialBalance = 10_000) {
    this.balance        = initialBalance;
    this.initialBalance = initialBalance;
  }

  /**
   * Process one signal at the close price of the given candle.
   *
   * BUY  → open long: spend `signal.size` worth of balance (or all of it).
   * SELL → close long: realise P&L = (exit − entry) × units.
   */
  execute(signal: Signal, candle: Candle): void {
    const price = candle.close;

    if (signal.type === "BUY" && this.position === 0 && this.balance > 0) {
      // Buy as many units as possible (up to signal.size × price, or full balance)
      const maxAffordable = this.balance / price;
      this.position   = Math.min(signal.size, maxAffordable);
      this.entryPrice = price;
      this.entryTime  = candle.time;
      return;
    }

    if (signal.type === "SELL" && this.position > 0) {
      const pnl       = (price - this.entryPrice) * this.position;
      const cost      = this.entryPrice * this.position;
      const returnPct = (pnl / cost) * 100;

      this.balance += pnl;

      this.trades.push({
        entryTime:  this.entryTime,
        exitTime:   candle.time,
        entryPrice: this.entryPrice,
        exitPrice:  price,
        size:       this.position,
        pnl,
        returnPct,
      });

      this.equityCurve.push({ time: candle.time, balance: this.balance });

      this.position   = 0;
      this.entryPrice = 0;
      this.entryTime  = 0;
    }
  }

  getResults(): SimulatorResults {
    const pnl    = this.balance - this.initialBalance;
    const pnlPct = (pnl / this.initialBalance) * 100;

    const openPosition = this.position > 0
      ? { entryTime: this.entryTime, entryPrice: this.entryPrice, size: this.position }
      : null;

    return {
      finalBalance:   this.balance,
      initialBalance: this.initialBalance,
      pnl,
      pnlPct,
      totalTrades:    this.trades.length,
      openPosition,
      trades:         this.trades,
      equityCurve:    this.equityCurve,
    };
  }

  reset(initialBalance?: number): void {
    this.balance    = initialBalance ?? this.initialBalance;
    this.position   = 0;
    this.entryPrice = 0;
    this.entryTime  = 0;
    this.trades     = [];
    this.equityCurve = [];
  }
}
