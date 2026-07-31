import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import DoctorLabResults from './DoctorLabResults';

const docLabTMap: Record<string, string> = {
  'doctorLabResults.kicker': 'Doctor Lab Results',
  'doctorLabResults.title': 'Results Inbox',
  'doctorLabResults.subtitle': 'Review abnormal and critical reports, acknowledge results, and schedule follow-up without losing track of pending work.',
  'doctorLabResults.searchPlaceholder': 'Search by patient or test name',
  'doctorLabResults.tab.recent': 'Recent',
  'doctorLabResults.tab.pending': 'Pending',
  'doctorLabResults.tab.abnormal': 'Abnormal',
  'doctorLabResults.tab.critical': 'Critical',
  'doctorLabResults.tab.needsReview': 'Needs Review',
  'doctorLabResults.tab.trend': 'Trend',
  'doctorLabResults.stat.totalReports': 'Total Reports',
  'doctorLabResults.stat.pending': 'Pending',
  'doctorLabResults.stat.abnormal': 'Abnormal',
  'doctorLabResults.stat.critical': 'Critical',
  'doctorLabResults.stat.needsReview': 'Needs Review',
  'doctorLabResults.trendHeading': 'Lab Trends',
  'doctorLabResults.loadingTrends': 'Loading trends...',
  'doctorLabResults.heading.recent': 'Recent Lab Results',
  'doctorLabResults.heading.pending': 'Pending Lab Results',
  'doctorLabResults.heading.abnormal': 'Abnormal Lab Results',
  'doctorLabResults.heading.critical': 'Critical Lab Results',
  'doctorLabResults.heading.needsReview': 'Results Needing Review',
  'doctorLabResults.showingRecords': 'Showing {{count}} records',
  'doctorLabResults.loading': 'Loading...',
  'doctorLabResults.noRecords': 'No records found.',
  'doctorLabResults.status.pending': 'Pending',
  'doctorLabResults.status.acknowledged': 'Acknowledged',
  'doctorLabResults.column.patient': 'Patient',
  'doctorLabResults.column.test': 'Test',
  'doctorLabResults.column.date': 'Date',
  'doctorLabResults.column.keyResult': 'Key Result',
  'doctorLabResults.column.status': 'Status',
  'doctorLabResults.column.actions': 'Actions',
  'doctorLabResults.action.view': 'View',
  'doctorLabResults.action.acknowledge': 'Acknowledge',
  'doctorLabResults.action.chart': 'Chart',
  'doctorLabResults.action.followUp': 'Follow-up',
  'doctorLabResults.toast.acknowledged': 'Result acknowledged',
  'doctorLabResults.toast.acknowledgeFailed': 'Failed to acknowledge result',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.loading': 'Loading…',
  'common.back': 'Back',
  'common.next': 'Next',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: any) => {
      if (docLabTMap[k]) {
        let str = docLabTMap[k];
        if (opts?.count !== undefined) str = str.replace('{{count}}', String(opts.count));
        return str;
      }
      return opts?.defaultValue ?? k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useParams: () => ({ slug: 'demo-hospital' }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../components/DashboardLayout', () => ({
  default: ({ children, role }: any) => <div data-testid="layout">{children}</div>,
}));
vi.mock('../components/clinical/LabFlowsheet', () => ({
  default: ({ results }: any) => (
    <div data-testid="lab-flowsheet">
      {results?.length ?? 0} results
    </div>
  ),
}));

import { useApiQuery } from '../hooks/useApiQuery';

const mockUseApiQuery = useApiQuery as ReturnType<typeof vi.fn>;

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const mockRecentResults = [
  {
    id: 1,
    patient_name: 'Alice Smith',
    patient_id: 101,
    test_name: 'CBC',
    collected_at: '2026-05-30T10:00:00Z',
    result_value: '12.5',
    unit: 'g/dL',
    abnormal_flag: 'normal',
    status: 'completed',
    order_id: 501,
  },
  {
    id: 2,
    patient_name: 'Bob Jones',
    patient_id: 102,
    test_name: 'Blood Glucose',
    collected_at: '2026-05-30T11:00:00Z',
    result_value: '250',
    unit: 'mg/dL',
    abnormal_flag: 'critical_high',
    status: 'completed',
    order_id: 502,
  },
];

const mockPendingResults = [
  {
    id: 3,
    patient_name: 'Carol Lee',
    patient_id: 103,
    test_name: 'Lipid Profile',
    ordered_at: '2026-05-30T09:00:00Z',
    status: 'pending',
    order_id: 503,
  },
];

const mockAbnormalResults = [
  {
    id: 2,
    patient_name: 'Bob Jones',
    patient_id: 102,
    test_name: 'Blood Glucose',
    collected_at: '2026-05-30T11:00:00Z',
    result_value: '250',
    unit: 'mg/dL',
    abnormal_flag: 'critical_high',
    status: 'completed',
    order_id: 502,
  },
  {
    id: 4,
    patient_name: 'David Kim',
    patient_id: 104,
    test_name: 'TSH',
    collected_at: '2026-05-30T08:00:00Z',
    result_value: '0.1',
    unit: 'mIU/L',
    abnormal_flag: 'low',
    status: 'completed',
    order_id: 504,
  },
];

const mockCriticalResults = [
  {
    id: 2,
    patient_name: 'Bob Jones',
    patient_id: 102,
    test_name: 'Blood Glucose',
    collected_at: '2026-05-30T11:00:00Z',
    result_value: '250',
    unit: 'mg/dL',
    abnormal_flag: 'critical_high',
    status: 'completed',
    order_id: 502,
  },
];

const mockTrendResults = [
  {
    test_name: 'HbA1c',
    result_value: 7.2,
    unit: '%',
    normal_range: '< 6.5',
    abnormal_flag: 'high',
    collected_at: '2026-05-01T10:00:00Z',
  },
  {
    test_name: 'HbA1c',
    result_value: 6.8,
    unit: '%',
    normal_range: '< 6.5',
    abnormal_flag: 'high',
    collected_at: '2026-04-01T10:00:00Z',
  },
];

const mockSummary = {
  total_reports: 50,
  pending: 5,
  abnormal: 8,
  critical: 2,
};

describe('DoctorLabResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiQuery.mockImplementation((_key: string, path: string) => {
      if (path.includes('/api/lab/results') && path.includes('needs_review=1')) {
        return { data: { results: mockCriticalResults }, isLoading: false };
      }
      if (path.includes('/api/lab/results') && path.includes('abnormal_flag=critical')) {
        return { data: { results: mockCriticalResults }, isLoading: false };
      }
      if (path.includes('/api/lab/results') && path.includes('abnormal_flag=')) {
        return { data: { results: mockAbnormalResults }, isLoading: false };
      }
      if (path.includes('/api/lab/results') && path.includes('status=pending')) {
        return { data: { results: mockPendingResults }, isLoading: false };
      }
      if (path.includes('/api/lab/results')) {
        return { data: { results: mockRecentResults }, isLoading: false };
      }
      if (path.includes('/api/lab/doctor/summary')) {
        return { data: mockSummary, isLoading: false };
      }
      if (path.includes('/api/lab/trend')) {
        return { data: { results: mockTrendResults }, isLoading: false };
      }
      return { data: null, isLoading: false };
    });
  });

  it('renders all tabs', () => {
    render(<DoctorLabResults />, { wrapper: Wrapper });
    const tabSection = screen.getByRole('button', { name: 'Recent' }).closest('section')!;
    expect(within(tabSection).getByRole('button', { name: 'Recent' })).toBeDefined();
    expect(within(tabSection).getByRole('button', { name: 'Pending' })).toBeDefined();
    expect(within(tabSection).getByRole('button', { name: 'Abnormal' })).toBeDefined();
    expect(within(tabSection).getByRole('button', { name: 'Critical' })).toBeDefined();
    expect(within(tabSection).getByRole('button', { name: 'Needs Review' })).toBeDefined();
    expect(within(tabSection).getByRole('button', { name: 'Trend' })).toBeDefined();
  });

  it('renders stat cards for summary', () => {
    render(<DoctorLabResults />, { wrapper: Wrapper });
    expect(screen.getByText('Total Reports')).toBeDefined();
    expect(screen.getByText('50')).toBeDefined();
  });

  it('shows lab results table in Recent tab', () => {
    render(<DoctorLabResults />, { wrapper: Wrapper });
    expect(screen.getByText('Alice Smith')).toBeDefined();
    expect(screen.getByText('CBC')).toBeDefined();
    expect(screen.getByText('Bob Jones')).toBeDefined();
  });

  it('switches to Pending tab and shows pending results', async () => {
    render(<DoctorLabResults />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    await waitFor(() => {
      expect(screen.getByText('Carol Lee')).toBeDefined();
      expect(screen.getByText('Lipid Profile')).toBeDefined();
    });
  });

  it('switches to Abnormal tab and shows abnormal results', async () => {
    render(<DoctorLabResults />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Abnormal' }));
    await waitFor(() => {
      expect(screen.getByText('David Kim')).toBeDefined();
      expect(screen.getByText('TSH')).toBeDefined();
    });
  });

  it('switches to Critical tab and shows critical results', async () => {
    render(<DoctorLabResults />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Critical' }));
    await waitFor(() => {
      expect(screen.getByText('Blood Glucose')).toBeDefined();
    });
  });

  it('switches to Trend tab and renders LabFlowsheet', async () => {
    render(<DoctorLabResults />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Trend' }));
    await waitFor(() => {
      expect(screen.getByTestId('lab-flowsheet')).toBeDefined();
    });
  });

  it('renders search box for filtering', () => {
    render(<DoctorLabResults />, { wrapper: Wrapper });
    const searchInput = screen.getByPlaceholderText(/search/i);
    expect(searchInput).toBeDefined();
  });

  it('links recent results to report view', () => {
    render(<DoctorLabResults />, { wrapper: Wrapper });
    const viewButtons = screen.getAllByText('View');
    expect(viewButtons.length).toBeGreaterThan(0);
  });
});
