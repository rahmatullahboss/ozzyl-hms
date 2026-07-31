import type {
  MetricComparison,
  MetricDesirableDirection,
} from '../../../packages/shared/src/dashboard';

export interface BuildMetricComparisonInput {
  currentValue: number;
  comparisonValue: number | null;
  comparisonLabel: string;
  desirableDirection: MetricDesirableDirection;
  targetRange?: { minimum: number; maximum: number };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function distanceFromRange(value: number, range: { minimum: number; maximum: number }): number {
  if (value < range.minimum) return range.minimum - value;
  if (value > range.maximum) return value - range.maximum;
  return 0;
}

function interpretationFor(
  input: BuildMetricComparisonInput,
  absoluteChange: number,
): MetricComparison['interpretation'] {
  if (input.desirableDirection === 'neutral') return 'neutral';
  if (input.desirableDirection === 'higher') {
    if (absoluteChange > 0) return 'positive';
    if (absoluteChange < 0) return 'negative';
    return 'neutral';
  }
  if (input.desirableDirection === 'lower') {
    if (absoluteChange < 0) return 'positive';
    if (absoluteChange > 0) return 'negative';
    return 'neutral';
  }
  if (input.desirableDirection === 'zero') {
    if (input.currentValue === 0) return input.comparisonValue === 0 ? 'neutral' : 'positive';
    return 'negative';
  }

  const range = input.targetRange;
  if (!range || input.comparisonValue === null) return 'not_comparable';
  const currentDistance = distanceFromRange(input.currentValue, range);
  const comparisonDistance = distanceFromRange(input.comparisonValue, range);
  if (currentDistance < comparisonDistance) return 'positive';
  if (currentDistance > comparisonDistance) return 'negative';
  return currentDistance === 0 ? 'positive' : 'neutral';
}

export function buildMetricComparison(input: BuildMetricComparisonInput): MetricComparison {
  if (input.comparisonValue === null || !Number.isFinite(input.comparisonValue)) {
    return {
      currentValue: input.currentValue,
      comparisonValue: null,
      absoluteChange: null,
      percentageChange: null,
      comparisonLabel: input.comparisonLabel,
      desirableDirection: input.desirableDirection,
      interpretation: 'not_comparable',
      reasonCode: 'COMPARISON_UNAVAILABLE',
    };
  }

  const absoluteChange = round(input.currentValue - input.comparisonValue);
  if (input.comparisonValue === 0) {
    return {
      currentValue: input.currentValue,
      comparisonValue: input.comparisonValue,
      absoluteChange,
      percentageChange: null,
      comparisonLabel: input.comparisonLabel,
      desirableDirection: input.desirableDirection,
      interpretation: 'not_comparable',
      reasonCode: 'ZERO_COMPARISON_BASE',
    };
  }

  return {
    currentValue: input.currentValue,
    comparisonValue: input.comparisonValue,
    absoluteChange,
    percentageChange: round((absoluteChange / Math.abs(input.comparisonValue)) * 100),
    comparisonLabel: input.comparisonLabel,
    desirableDirection: input.desirableDirection,
    interpretation: interpretationFor(input, absoluteChange),
  };
}
