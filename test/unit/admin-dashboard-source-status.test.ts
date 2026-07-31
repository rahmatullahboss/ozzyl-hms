import { describe, expect, it } from 'vitest';
import {
  metricValueForSource,
  resolveDashboardSourceStatus,
} from '../../src/lib/dashboard/source-status';

describe('admin dashboard source status', () => {
  const generatedAt = '2026-07-27T12:00:00.000Z';
  const now = '2026-07-27T12:00:30.000Z';

  it('returns complete when all required sources loaded', () => {
    expect(resolveDashboardSourceStatus({
      requiredSources: ['bills', 'payments'],
      loadedSources: ['payments', 'bills'],
      unavailableSources: [],
      generatedAt,
      staleAfterSeconds: 60,
      now,
    })).toMatchObject({ state: 'complete', loadedSources: ['bills', 'payments'] });
  });

  it('returns partial when only some required sources loaded', () => {
    const status = resolveDashboardSourceStatus({
      requiredSources: ['bills', 'payments'],
      loadedSources: ['bills'],
      unavailableSources: [{ source: 'payments', reasonCode: 'QUERY_FAILED', message: 'Payments unavailable' }],
      generatedAt,
      staleAfterSeconds: 60,
      now,
    });

    expect(status.state).toBe('partial');
    expect(status.unavailableSources).toHaveLength(1);
  });

  it('returns unavailable when no required source loaded', () => {
    const status = resolveDashboardSourceStatus({
      requiredSources: ['bills'],
      loadedSources: [],
      unavailableSources: [{ source: 'bills', reasonCode: 'QUERY_FAILED', message: 'Bills unavailable' }],
      generatedAt,
      staleAfterSeconds: 60,
      now,
    });

    expect(status.state).toBe('unavailable');
  });

  it('returns stale when complete data is older than its threshold', () => {
    const status = resolveDashboardSourceStatus({
      requiredSources: ['bills'],
      loadedSources: ['bills'],
      unavailableSources: [],
      generatedAt,
      staleAfterSeconds: 60,
      now: '2026-07-27T12:02:00.000Z',
    });

    expect(status.state).toBe('stale');
  });

  it('does not convert a failed or partial source into a verified zero', () => {
    const unavailable = resolveDashboardSourceStatus({
      requiredSources: ['payments'],
      loadedSources: [],
      unavailableSources: [{ source: 'payments', reasonCode: 'QUERY_FAILED', message: 'Payments unavailable' }],
      generatedAt,
      staleAfterSeconds: 60,
      now,
    });
    const partial = resolveDashboardSourceStatus({
      requiredSources: ['bills', 'payments'],
      loadedSources: ['bills'],
      unavailableSources: [{ source: 'payments', reasonCode: 'QUERY_FAILED', message: 'Payments unavailable' }],
      generatedAt,
      staleAfterSeconds: 60,
      now,
    });

    expect(metricValueForSource(0, unavailable)).toBeNull();
    expect(metricValueForSource(0, partial)).toBeNull();
  });

  it('preserves valid complete and stale values', () => {
    const complete = resolveDashboardSourceStatus({
      requiredSources: ['payments'], loadedSources: ['payments'], unavailableSources: [], generatedAt, staleAfterSeconds: 60, now,
    });
    const stale = { ...complete, state: 'stale' as const };

    expect(metricValueForSource(0, complete)).toBe(0);
    expect(metricValueForSource(125, stale)).toBe(125);
  });
});
