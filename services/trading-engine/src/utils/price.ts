/**
 * Market price utilities.
 *
 * getMarketPrice() fetches the current Binance Futures price,
 * falling back to simulated data when geo-restricted.
 */

export async function getMarketPrice(symbol: string): Promise<number> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol.toUpperCase()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`ticker ${res.status}`);
    const data = (await res.json()) as { price: string };
    return parseFloat(data.price);
  } catch {
    return simulatePrice(symbol);
  }
}

function simulatePrice(symbol: string): number {
  const base =
    symbol.startsWith("ETH") ? 3200 :
    symbol.startsWith("SOL") ? 160 :
    symbol.startsWith("BNB") ? 620 :
    44000;
  const jitter = (Math.random() - 0.5) * base * 0.001;
  return Math.round((base + jitter) * 100) / 100;
}
