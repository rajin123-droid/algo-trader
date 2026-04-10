export interface RSIPoint {
  time: number;
  value: number;
}

export function calculateRSI(closes: number[], period = 14): number[] {
  if (closes.length <= period) return [];
  const result: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  let rs = avgGain / (avgLoss || 0.001);
  result.push(100 - 100 / (1 + rs));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rs = avgGain / (avgLoss || 0.001);
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

export function rsiPoints(
  times: number[],
  closes: number[],
  period = 14
): RSIPoint[] {
  const values = calculateRSI(closes, period);
  const offset = closes.length - values.length;
  return values.map((value, i) => ({ time: times[i + offset], value }));
}
