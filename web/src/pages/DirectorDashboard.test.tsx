import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DirectorDashboard from './DirectorDashboard';
import { useApiQuery } from '../hooks/useApiQuery';

const { invalidateQueries } = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../lib/i18n', () => ({ default: { language: 'en' } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { permissions: [] } }) }));
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries }),
}));
vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock('../components/dashboard/ExecutiveControlKpis', () => ({
  default: ({ querySuffix }: { querySuffix: string }) => <div data-testid="director-executive-control-kpis">{querySuffix}</div>,
}));
vi.mock('../components/dashboard/ExecutiveDuePanel', () => ({
  default: ({ role, basePath, queryKeyScope }: { role: string; basePath: string; queryKeyScope: string }) => (
    <div
      data-testid="director-executive-due-panel"
      data-role={role}
      data-base-path={basePath}
      data-query-key-scope={queryKeyScope}
    />
  ),
}));

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/h/demo/director']}>
      <DirectorDashboard />
    </MemoryRouter>,
  );
}

describe('DirectorDashboard period-aware IPD controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/shareholders') return { data: { shareholders: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      if (url.startsWith('/api/shareholders/calculate')) return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
      if (url.startsWith('/api/ip-billing/stats')) return { data: {}, isLoading: false, isError: false, refetch: vi.fn() };
      return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    }) as never);
  });

  it('renders one executive control and the shared IPD panel', () => {
    renderDashboard();

    expect(screen.getAllByTestId('director-executive-control-kpis')).toHaveLength(1);
    expect(screen.getByTestId('ipd-billing-overview')).toBeInTheDocument();
    expect(screen.getByTestId('director-shareholder-accounting-kpis')).toBeInTheDocument();
  });

  it('places the live due panel after executive control and refreshes collection queries', async () => {
    renderDashboard();

    const executiveControl = screen.getByTestId('director-executive-control-kpis');
    const duePanel = screen.getByTestId('director-executive-due-panel');
    const ipdPanel = screen.getByTestId('ipd-billing-overview');
    const ownershipPanel = screen.getByTestId('director-shareholder-accounting-kpis');

    expect(duePanel).toHaveAttribute('data-role', 'director');
    expect(duePanel).toHaveAttribute('data-base-path', '/h/');
    expect(duePanel).toHaveAttribute('data-query-key-scope', 'director');
    expect(executiveControl.compareDocumentPosition(duePanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(duePanel.compareDocumentPosition(ipdPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(duePanel.compareDocumentPosition(ownershipPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['action-center', 'collections'] });
    });
  });

  it('keeps executive KPIs, IPD stats, and report links on the same custom period', async () => {
    renderDashboard();

    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom start date'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Custom end date'), { target: { value: '2026-07-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom range' }));

    await waitFor(() => {
      expect(screen.getByTestId('director-executive-control-kpis')).toHaveTextContent('startDate=2026-07-01');
      expect(screen.getByTestId('director-executive-control-kpis')).toHaveTextContent('endDate=2026-07-10');
      expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]) === '/api/ip-billing/stats?page=1&pageSize=20&from=2026-07-01&to=2026-07-10')).toBe(true);
    });

    expect(screen.getByRole('link', { name: 'PDF Center' })).toHaveAttribute('href', '/h/director/reports/pdf?from=2026-07-01&to=2026-07-10');
    expect(screen.getByRole('link', { name: 'Daily Pack' })).toHaveAttribute('href', '/h/director/reports/pdf?pack=daily-closing&from=2026-07-01&to=2026-07-10&autoprint=1');
    expect(screen.getByText('IPD finance — 2026-07-01 – 2026-07-10')).toBeInTheDocument();
  });
});
