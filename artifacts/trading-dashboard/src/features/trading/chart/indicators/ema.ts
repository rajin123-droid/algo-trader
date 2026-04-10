export interface EMAPoint {
  time: number;
  value: number;
}

export function calculateEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const sma = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: number[] = [sma];
  for (let i = period; i < closes.length; i++) {
    result.push(closes[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

export function emaPoints(
  times: number[],
  closes: number[],
  period: number
): EMAPoint[] {
  const values = calculateEMA(closes, period);
  const offset = closes.length - values.length;
  return values.map((value, i) => ({ time: times[i + offset], value }));
}
