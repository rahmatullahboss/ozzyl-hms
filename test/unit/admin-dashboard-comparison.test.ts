import { describe, expect, it } from 'vitest';
import { buildMetricComparison } from '../../src/lib/dashboard/comparison';

describe('admin dashboard metric comparison', () => {
  it('calculates absolute and percentage change', () => {
    expect(buildMetricComparison({
      currentValue: 120,
      comparisonValue: 100,
      comparisonLabel: 'Previous period',
      desirableDirection: 'higher',
    })).toMatchObject({
      absoluteChange: 20,
      percentageChange: 20,
      interpretation: 'positive',
    });
  });

  it('treats a zero comparison denominator as not comparable', () => {
    expect(buildMetricComparison({
      currentValue: 10,
      comparisonValue: 0,
      comparisonLabel: 'Previous period',
      desirableDirection: 'higher',
    })).toMatchObject({
      absoluteChange: 10,
      percentageChange: null,
      interpretation: 'not_comparable',
      reasonCode: 'ZERO_COMPARISON_BASE',
    });
  });

  it('interprets lower-is-better changes correctly', () => {
    expect(buildMetricComparison({
      currentValue: 80,
      comparisonValue: 100,
      comparisonLabel: 'Previous period',
      desirableDirection: 'lower',
    }).interpretation).toBe('positive');

    expect(buildMetricComparison({
      currentValue: 120,
      comparisonValue: 100,
      comparisonLabel: 'Previous period',
      desirableDirection: 'lower',
    }).interpretation).toBe('negative');
  });

  it('supports zero and target-range directions', () => {
    expect(buildMetricComparison({
      currentValue: 0,
      comparisonValue: 2,
      comparisonLabel: 'Previous period',
      desirableDirection: 'zero',
    }).interpretation).toBe('positive');

    expect(buildMetricComparison({
      currentValue: 5,
      comparisonValue: 2,
      comparisonLabel: 'Previous period',
      desirableDirection: 'zero',
    }).interpretation).toBe('negative');

    expect(buildMetricComparison({
      currentValue: 95,
      comparisonValue: 80,
      comparisonLabel: 'Previous period',
      desirableDirection: 'target_range',
      targetRange: { minimum: 90, maximum: 110 },
    }).interpretation).toBe('positive');
  });

  it('returns an explicit unavailable comparison reason', () => {
    expect(buildMetricComparison({
      currentValue: 100,
      comparisonValue: null,
      comparisonLabel: 'Previous period',
      desirableDirection: 'higher',
    })).toEqual({
      currentValue: 100,
      comparisonValue: null,
      absoluteChange: null,
      percentageChange: null,
      comparisonLabel: 'Previous period',
      desirableDirection: 'higher',
      interpretation: 'not_comparable',
      reasonCode: 'COMPARISON_UNAVAILABLE',
    });
  });

  it('preserves the server-resolved comparison label', () => {
    expect(buildMetricComparison({
      currentValue: 100,
      comparisonValue: 90,
      comparisonLabel: '2026-07-14 → 2026-07-20',
      desirableDirection: 'neutral',
    })).toMatchObject({
      comparisonLabel: '2026-07-14 → 2026-07-20',
      interpretation: 'neutral',
    });
  });
});
