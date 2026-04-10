export type Position = {
  id: string;
  dbId?: number;
  side: "BUY" | "SELL";
  entry: number;
  qty: number;
  leverage: number;
  notional: number;
  margin: number;
  liqPrice: number;
  openTime: number;
};

type PositionSubscriber = (positions: Position[]) => void;

let positions: Position[] = [];
const subscribers = new Set<PositionSubscriber>();

function notify() {
  subscribers.forEach((fn) => fn([...positions]));
}

export function subscribePositions(fn: PositionSubscriber): () => void {
  subscribers.add(fn);
  fn([...positions]);
  return () => subscribers.delete(fn);
}

export function openPosition(
  side: "BUY" | "SELL",
  qty: number,
  price: number,
  leverage: number,
  dbId?: number
): Position {
  if (qty <= 0 || price <= 0) throw new Error("Invalid qty or price");

  const notional = qty * price;
  const margin = notional / leverage;
  const liqPrice =
    side === "BUY"
      ? price * (1 - 1 / leverage)
      : price * (1 + 1 / leverage);

  const pos: Position = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    dbId,
    side,
    entry: price,
    qty,
    leverage,
    notional,
    margin,
    liqPrice,
    openTime: Date.now(),
  };

  positions = [pos, ...positions];
  notify();
  return pos;
}

export function removePosition(id: string): void {
  positions = positions.filter((p) => p.id !== id);
  notify();
}

export function setPositions(incoming: Position[]): void {
  positions = incoming;
  notify();
}

export function calcPnl(pos: Position, currentPrice: number): number {
  if (pos.side === "BUY") {
    return (currentPrice - pos.entry) * pos.qty;
  }
  return (pos.entry - currentPrice) * pos.qty;
}
