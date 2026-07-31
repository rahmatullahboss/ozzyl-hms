import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorPayoutDetail from './DoctorPayoutDetail';
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
    useLocation: () => ({ pathname: '/admin/doctor-payout-detail', search: params.toString(), hash: '', state: null, key: 'default' }),
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
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { admin: { doctorPayoutDetail: (id: string) => ['admin', 'doctor-payout', id] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockData = {
  doctorId: 'DOC-101',
  doctorName: 'Dr. Hasan',
  department: 'Cardiology',
  totalEarnings: 50000,
  totalPaid: 30000,
  balance: 20000,
  opdVisits: 45,
  opdIncome: 20000,
  procedureIncome: 25000,
  diagnosticShare: 5000,
  earnings: [
    { date: '2026-06-11', patient: 'Rahim', service: 'OPD Consult', amount: 500 },
    { date: '2026-06-10', patient: 'Karim', service: 'ECG', amount: 1500 },
  ],
  payouts: [
    { id: 'P-001', amount: 10000, date: '2026-06-05', method: 'Bank Transfer', reference: 'TXN-001', status: 'paid' },
  ],
  commissionRules: [
    { serviceType: 'OPD', rate: 30, minAmount: 200, maxAmount: 2000 },
    { serviceType: 'Procedure', rate: 25, minAmount: 500, maxAmount: 10000 },
  ],
};

describe('DoctorPayoutDetail', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<DoctorPayoutDetail />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows not found when no data', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false } as never);
    render(<DoctorPayoutDetail />);
    expect(screen.getByText('Doctor payout not found')).toBeInTheDocument();
  });

  it('renders doctor name and department', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
    const { container } = render(<DoctorPayoutDetail />);
    expect(container.textContent).toContain('Dr. Hasan');
    expect(container.textContent).toContain('Cardiology');
  });

  it('renders 6 summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
    render(<DoctorPayoutDetail />);
    expect(screen.getByText('OPD Visits')).toBeInTheDocument();
    expect(screen.getByText('OPD Income')).toBeInTheDocument();
    expect(screen.getByText('Procedure Income')).toBeInTheDocument();
    expect(screen.getByText('Diagnostic Share')).toBeInTheDocument();
    expect(screen.getByText('Total Earnings')).toBeInTheDocument();
    expect(screen.getByText('Balance')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('৳50,000.00')).toBeInTheDocument();
  });

  it('renders 3 detail tabs', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
    render(<DoctorPayoutDetail />);
    expect(screen.getByText('Earnings')).toBeInTheDocument();
    expect(screen.getByText('Payout History')).toBeInTheDocument();
    expect(screen.getByText('Commission Rules')).toBeInTheDocument();
  });

  it('renders earnings table by default', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
    render(<DoctorPayoutDetail />);
    expect(screen.getByText('Rahim')).toBeInTheDocument();
    expect(screen.getByText('Karim')).toBeInTheDocument();
    expect(screen.getByText('৳500.00')).toBeInTheDocument();
  });

  it('switches to payout history tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
    render(<DoctorPayoutDetail />);
    fireEvent.click(screen.getByText('Payout History'));
    expect(screen.getByText('P-001')).toBeInTheDocument();
    expect(screen.getByText('Bank Transfer')).toBeInTheDocument();
    expect(screen.getByText('paid')).toBeInTheDocument();
  });

  it('switches to commission rules tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
    render(<DoctorPayoutDetail />);
    fireEvent.click(screen.getByText('Commission Rules'));
    expect(screen.getByText('OPD')).toBeInTheDocument();
    expect(screen.getByText('Procedure')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('shows empty states', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { ...mockData, earnings: [], payouts: [], commissionRules: [] },
      isLoading: false,
    } as never);
    render(<DoctorPayoutDetail />);
    expect(screen.getByText('No earnings found')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Payout History'));
    expect(screen.getByText('No payouts found')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Commission Rules'));
    expect(screen.getByText('No commission rules found')).toBeInTheDocument();
  });
});
