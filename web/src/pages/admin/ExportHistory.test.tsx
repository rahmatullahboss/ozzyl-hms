import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExportHistory from './ExportHistory';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}))
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/export-history', search: params.toString(), hash: '', state: null, key: 'default' }),
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
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { exportHistory: () => ['admin', 'export-history'] },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('ExportHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<ExportHistory />);
    expect(screen.getByText('exportHistory.title')).toBeInTheDocument();
  });

  it('renders loading skeleton when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<ExportHistory />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalExports: 156, todayExports: 12, uniqueUsers: 5, csvExports: 98, pdfExports: 58 },
        exports: [],
      },
      isLoading: false,
    } as never);
    render(<ExportHistory />);
    expect(screen.getByText('156')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders export history table with data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalExports: 2, todayExports: 2, uniqueUsers: 1, csvExports: 1, pdfExports: 1 },
        exports: [
          {
            id: 'E1',
            timestamp: '2026-06-11T09:30:00Z',
            userName: 'admin',
            reportName: 'Daily Revenue Report',
            format: 'CSV',
            filtersUsed: 'Date: 2026-06-11, Department: All',
            rowsExported: 245,
            device: 'Chrome/Windows',
            ipAddress: '192.168.1.100',
          },
          {
            id: 'E2',
            timestamp: '2026-06-11T10:15:00Z',
            userName: 'manager',
            reportName: 'Patient List',
            format: 'PDF',
            filtersUsed: 'Date: 2026-06-01 to 2026-06-11',
            rowsExported: 1024,
            device: 'Safari/Mac',
            ipAddress: '192.168.1.101',
          },
        ],
      },
      isLoading: false,
    } as never);
    render(<ExportHistory />);
    expect(screen.getByText('Daily Revenue Report')).toBeInTheDocument();
    expect(screen.getByText('Patient List')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('245')).toBeInTheDocument();
    expect(screen.getByText('1,024')).toBeInTheDocument();
  });

  it('shows empty state when no exports', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalExports: 0, todayExports: 0, uniqueUsers: 0, csvExports: 0, pdfExports: 0 },
        exports: [],
      },
      isLoading: false,
    } as never);
    render(<ExportHistory />);
    expect(screen.getByText('exportHistory.noData')).toBeInTheDocument();
  });

  it('filters exports by format', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalExports: 2, todayExports: 2, uniqueUsers: 1, csvExports: 1, pdfExports: 1 },
        exports: [
          { id: 'E1', timestamp: '2026-06-11T09:30:00Z', userName: 'admin', reportName: 'Report A', format: 'CSV', filtersUsed: '', rowsExported: 100, device: 'Chrome', ipAddress: '10.0.0.1' },
          { id: 'E2', timestamp: '2026-06-11T10:15:00Z', userName: 'admin', reportName: 'Report B', format: 'PDF', filtersUsed: '', rowsExported: 200, device: 'Chrome', ipAddress: '10.0.0.1' },
        ],
      },
      isLoading: false,
    } as never);
    render(<ExportHistory />);
    const csvTab = screen.getAllByText('exportHistory.csv').find(el => el.tagName === 'BUTTON');
    fireEvent.click(csvTab!);
    expect(screen.getByText('Report A')).toBeInTheDocument();
    expect(screen.queryByText('Report B')).not.toBeInTheDocument();
  });
});
