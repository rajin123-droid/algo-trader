export interface MACDPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

function computeEMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const sma = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: number[] = [sma];
  for (let i = period; i < data.length; i++) {
    result.push(data[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

export function macdPoints(
  times: number[],
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDPoint[] {
  if (closes.length < slowPeriod + signalPeriod) return [];

  const fastEMA = computeEMA(closes, fastPeriod);
  const slowEMA = computeEMA(closes, slowPeriod);

  const offset = slowPeriod - fastPeriod;
  const macdLine = slowEMA.map((s, i) => fastEMA[i + offset] - s);

  const signalLine = computeEMA(macdLine, signalPeriod);
  const sigOffset = macdLine.length - signalLine.length;
  const startIndex = closes.length - signalLine.length;

  return signalLine.map((signal, i) => {
    const macd = macdLine[i + sigOffset];
    return {
      time: times[startIndex + i],
      macd,
      signal,
      histogram: macd - signal,
    };
  });
}
