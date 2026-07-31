export type LisAbnormalInterpretation = 'normal' | 'abnormal' | 'high' | 'low' | 'critical' | 'pending';

export type LisReferenceInterval =
  | { kind: 'between'; low: number; high: number }
  | { kind: 'upper'; high: number; inclusive: boolean }
  | { kind: 'lower'; low: number; inclusive: boolean };

const NUMERIC_PATTERN = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const BETWEEN_PATTERN = new RegExp(`^\\s*(${NUMERIC_PATTERN})\\s*-\\s*(${NUMERIC_PATTERN})\\s*$`);
const INEQUALITY_PATTERN = new RegExp(`^\\s*(<=|>=|<|>)\\s*(${NUMERIC_PATTERN})\\s*$`);

function normalizeRangeText(rawRange: string): string {
  const firstApplicableRange = rawRange.includes('|') ? rawRange.split('|')[0] : rawRange;
  return firstApplicableRange.replace(/^[A-Za-z]+:\s*/, '').trim();
}

export function normalizeAnalyzerAbnormalFlag(flag?: string | null): LisAbnormalInterpretation {
  switch (String(flag ?? '').trim().toUpperCase()) {
    case 'N':
      return 'normal';
    case 'A':
      return 'abnormal';
    case 'H':
      return 'high';
    case 'L':
      return 'low';
    case 'HH':
    case 'LL':
    case 'AA':
      return 'critical';
    default:
      return 'pending';
  }
}

export function parseLisReferenceInterval(rawRange?: string | null): LisReferenceInterval | null {
  if (!rawRange) return null;
  const range = normalizeRangeText(rawRange);
  const inequality = range.match(INEQUALITY_PATTERN);
  if (inequality) {
    const value = Number(inequality[2]);
    if (!Number.isFinite(value)) return null;
    if (inequality[1] === '<' || inequality[1] === '<=') {
      return { kind: 'upper', high: value, inclusive: inequality[1] === '<=' };
    }
    return { kind: 'lower', low: value, inclusive: inequality[1] === '>=' };
  }

  const between = range.match(BETWEEN_PATTERN);
  if (!between) return null;
  const low = Number(between[1]);
  const high = Number(between[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return null;
  return { kind: 'between', low, high };
}

export function interpretNumericLisResult(
  numericValue: number,
  normalRange?: string | null,
  criticalLow?: number | null,
  criticalHigh?: number | null,
): LisAbnormalInterpretation {
  if (!Number.isFinite(numericValue)) return 'pending';

  if (criticalLow != null && Number.isFinite(criticalLow) && numericValue <= criticalLow) {
    return 'critical';
  }
  if (criticalHigh != null && Number.isFinite(criticalHigh) && numericValue >= criticalHigh) {
    return 'critical';
  }

  const interval = parseLisReferenceInterval(normalRange);
  if (!interval) return 'pending';

  if (interval.kind === 'between') {
    if (numericValue < interval.low) return 'low';
    if (numericValue > interval.high) return 'high';
    return 'normal';
  }

  if (interval.kind === 'upper') {
    const inside = interval.inclusive ? numericValue <= interval.high : numericValue < interval.high;
    return inside ? 'normal' : 'high';
  }

  const inside = interval.inclusive ? numericValue >= interval.low : numericValue > interval.low;
  return inside ? 'normal' : 'low';
}
