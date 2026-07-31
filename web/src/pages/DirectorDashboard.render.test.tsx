import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DirectorDashboard from './DirectorDashboard';
import { useApiQuery } from '../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('../lib/i18n', () => ({ default: { language: 'en' } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { permissions: [] } }) }));
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock('../components/dashboard/ExecutiveControlKpis', () => ({
  default: ({ querySuffix }: { querySuffix: string }) => <div data-testid="executive-control-kpis" data-query-suffix={querySuffix} />,
}));
vi.mock('../components/dashboard/ExecutiveDashboardRangeFilter', () => ({
  default: ({ onChange }: { onChange: (filters: { preset: 'custom'; startDate: string; endDate: string }) => void }) => (
    <button type="button" onClick={() => onChange({ preset: 'custom', startDate: '2026-07-10', endDate: '2026-07-10' })}>
      Set director date
    </button>
  ),
  resolveExecutiveDashboardFilters: () => ({ preset: 'today', startDate: '2026-07-18', endDate: '2026-07-18' }),
}));
vi.mock('../components/dashboard/IPDBillingOverview', () => ({
  default: () => <div data-testid="ipd-billing-overview" />,
}));
vi.mock('../components/dashboard/PendingRequestsSection', () => ({
  default: ({ role, window }: { role: string; window: { from: string; to: string } }) => (
    <div data-testid="pending-requests" data-role={role} data-from={window.from} data-to={window.to} />
  ),
}));

describe('DirectorDashboard render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => {
      if (path === '/api/shareholders') return { data: { shareholders: [] }, isLoading: false };
      if (path.includes('/api/shareholders/calculate')) return { data: undefined, isLoading: false };
      return { data: undefined, isLoading: false };
    }) as never);
  });

  it('shares the selected range with reports, executive KPIs, and pending requests', () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/director/dashboard']}>
        <Routes>
          <Route path="/h/:slug/director/dashboard" element={<DirectorDashboard />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set director date' }));

    expect(screen.getByRole('link', { name: 'PDF Center' })).toHaveAttribute(
      'href',
      '/h/city-hospital/director/reports/pdf?from=2026-07-10&to=2026-07-10',
    );
    expect(screen.getByTestId('executive-control-kpis')).toHaveAttribute(
      'data-query-suffix',
      '?preset=custom&startDate=2026-07-10&endDate=2026-07-10',
    );
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-role', 'director');
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-from', '2026-07-10');
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-to', '2026-07-10');
  });
});
