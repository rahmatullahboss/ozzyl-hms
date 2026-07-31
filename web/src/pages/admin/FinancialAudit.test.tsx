import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialAudit from './FinancialAudit';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/financial-audit', search: params.toString(), hash: '', state: null, key: 'default' }),
    useSearchParams: () => {
      const setParams = (next: Record<string, string> | ((p: URLSearchParams) => URLSearchParams)) => {
        if (typeof next === 'function') {
          params = next(params);
        } else {
          params = new URLSearchParams(next);
        }
      };
      return [params, setParams] as ReturnType<typeof actual.useSearchParams>;
    },
  };
});
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({ queryKeys: { admin: { financialAudit: () => ['admin', 'financial-audit'] } } }));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

describe('FinancialAudit', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('wraps in DashboardLayout', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<FinancialAudit />);
    expect(screen.getByTestId('layout')).toBeTruthy();
  });

  it('shows loading when loading', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: true });
    render(<FinancialAudit />);
    expect(screen.getByText('financialAudit.loading')).toBeTruthy();
  });

  it('renders page title', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<FinancialAudit />);
    expect(screen.getByText('financialAudit.title')).toBeTruthy();
  });

  it('renders severity tabs: All, High, Medium, Low', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<FinancialAudit />);
    expect(screen.getByText('financialAudit.tabs.all')).toBeTruthy();
    expect(screen.getAllByText('financialAudit.tabs.high').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('financialAudit.tabs.medium')).toBeTruthy();
    expect(screen.getByText('financialAudit.tabs.low')).toBeTruthy();
  });

  it('shows empty state when no entries', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: { entries: [] }, isLoading: false });
    render(<FinancialAudit />);
    expect(screen.getByText('financialAudit.empty')).toBeTruthy();
  });

  it('shows entries table', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { entries: [
        { id: '1', timestamp: '2026-06-11T10:30:00', user: 'Karim', event: 'Discount Applied', module: 'Billing', recordId: 'INV-001', before: '0%', after: '20%', ip: '192.168.1.1', severity: 'high' },
        { id: '2', timestamp: '2026-06-11T09:00:00', user: 'Admin', event: 'User Created', module: 'Settings', recordId: 'USR-005', before: '', after: 'Active', ip: '192.168.1.2', severity: 'low' },
      ] },
      isLoading: false,
    });
    render(<FinancialAudit />);
    expect(screen.getByText('Discount Applied')).toBeTruthy();
    expect(screen.getByText('User Created')).toBeTruthy();
  });

  it('shows summary cards', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { entries: [], summary: { totalEvents: 150, highSeverity: 5, usersActive: 12, modulesAffected: 8 } },
      isLoading: false,
    });
    render(<FinancialAudit />);
    expect(screen.getByText('financialAudit.summary.totalEvents')).toBeTruthy();
    expect(screen.getAllByText('financialAudit.summary.highSeverity').length).toBeGreaterThanOrEqual(1);
  });
});
