import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApiQuery } from './useApiQuery';
import {
  executiveAnalyticsQuery,
  useExecutiveDashboardAnalytics,
} from './useExecutiveDashboardAnalytics';
import type { ExecutiveDashboardFilters } from '../types/executiveDashboard';
import type { ExecutiveDashboardMetric } from './useExecutiveDashboardKpis';

vi.mock('./useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

const refetch = vi.fn(async () => undefined);

function filters(overrides: Partial<ExecutiveDashboardFilters> = {}): ExecutiveDashboardFilters {
  return {
    preset: 'custom',
    startDate: '2026-07-01',
    endDate: '2026-07-10',
    doctorId: 7,
    testSearch: ' CBC & RBS ',
    ...overrides,
  };
}

function enabledPanels(...metrics: ExecutiveDashboardMetric[]): Set<ExecutiveDashboardMetric> {
  return new Set(metrics);
}

describe('useExecutiveDashboardAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation((() => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch,
    })) as never);
  });

  it('builds one encoded query contract for all analytics endpoints', () => {
    const query = executiveAnalyticsQuery(filters());
    expect(query).toBe('preset=custom&startDate=2026-07-01&endDate=2026-07-10&doctorId=7&search=CBC+%26+RBS');

    renderHook(() => useExecutiveDashboardAnalytics({
      queryKeyScope: 'admin',
      filters: filters(),
      enabledPanels: enabledPanels(
        'doctor_performance_table',
        'test_volume_table',
        'income_service_breakdown',
        'expense_source_breakdown',
        'reagent_reconciliation_table',
      ),
    }));

    expect(vi.mocked(useApiQuery)).toHaveBeenCalledTimes(6);
    const common = 'preset=custom&startDate=2026-07-01&endDate=2026-07-10';
    for (const call of vi.mocked(useApiQuery).mock.calls) {
      expect(String(call[1])).toContain(common);
    }
    expect(String(vi.mocked(useApiQuery).mock.calls[1]?.[1])).toContain('search=CBC+%26+RBS');
  });

  it('requests ten rows per page for every dashboard analysis list by default', () => {
    renderHook(() => useExecutiveDashboardAnalytics({
      queryKeyScope: 'admin',
      filters: filters({ doctorId: undefined, testSearch: undefined }),
      enabledPanels: enabledPanels(
        'doctor_performance_table',
        'test_volume_table',
        'income_service_breakdown',
        'expense_source_breakdown',
        'reagent_reconciliation_table',
      ),
    }));

    const urls = vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]));
    expect(urls).toHaveLength(6);
    for (const url of urls.slice(0, 5)) {
      expect(url).toContain('pageSize=10');
    }
    expect(urls[5]).toBe('/api/dashboard/patient-age-analytics?preset=custom&startDate=2026-07-01&endDate=2026-07-10');
  });

  it('disables queries for panels that are not enabled by tenant configuration', () => {
    renderHook(() => useExecutiveDashboardAnalytics({
      queryKeyScope: 'md',
      filters: filters({ doctorId: undefined, testSearch: undefined }),
      enabledPanels: enabledPanels('doctor_performance_table', 'reagent_reconciliation_table'),
    }));

    const calls = vi.mocked(useApiQuery).mock.calls;
    expect(calls[0]?.[2]).toMatchObject({ enabled: true });
    expect(calls[1]?.[2]).toMatchObject({ enabled: false });
    expect(calls[2]?.[2]).toMatchObject({ enabled: false });
    expect(calls[3]?.[2]).toMatchObject({ enabled: false });
    expect(calls[4]?.[2]).toMatchObject({ enabled: true });
    expect(calls[5]?.[2]).toMatchObject({ enabled: false });
  });

  it('enables patient age analytics only for the active Patients workspace', () => {
    renderHook(() => useExecutiveDashboardAnalytics({
      queryKeyScope: 'admin',
      filters: filters({ doctorId: undefined, testSearch: undefined }),
      enabledPanels: enabledPanels(),
      patientAgeEnabled: true,
    }));

    const calls = vi.mocked(useApiQuery).mock.calls;
    expect(calls).toHaveLength(6);
    for (const call of calls.slice(0, 5)) {
      expect(call[2]).toMatchObject({ enabled: false });
    }
    expect(calls[5]?.[0]).toEqual(['admin', 'patient-age-analytics', 'preset=custom&startDate=2026-07-01&endDate=2026-07-10']);
    expect(calls[5]?.[1]).toBe('/api/dashboard/patient-age-analytics?preset=custom&startDate=2026-07-01&endDate=2026-07-10');
    expect(calls[5]?.[2]).toMatchObject({ enabled: true });
  });

  it('changes query keys and paths when the executive range changes', () => {
    const { rerender } = renderHook(
      ({ currentFilters }) => useExecutiveDashboardAnalytics({
        queryKeyScope: 'director',
        filters: currentFilters,
        enabledPanels: enabledPanels('doctor_performance_table'),
      }),
      { initialProps: { currentFilters: filters() } },
    );

    const firstKey = vi.mocked(useApiQuery).mock.calls[0]?.[0];
    const firstPath = vi.mocked(useApiQuery).mock.calls[0]?.[1];

    rerender({
      currentFilters: filters({ preset: '7d', startDate: '2026-07-05', endDate: '2026-07-11' }),
    });

    const secondRenderCalls = vi.mocked(useApiQuery).mock.calls.slice(-6);
    expect(secondRenderCalls[0]?.[0]).not.toEqual(firstKey);
    expect(secondRenderCalls[0]?.[1]).not.toBe(firstPath);
    expect(String(secondRenderCalls[0]?.[1])).toContain('preset=7d&startDate=2026-07-05&endDate=2026-07-11');
  });
});
