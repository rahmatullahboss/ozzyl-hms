import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RefundRequestDetail from './RefundRequestDetail';
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
    useLocation: () => ({ pathname: '/admin/refund-request-detail', search: params.toString(), hash: '', state: null, key: 'default' }),
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
  queryKeys: { admin: { refundDetail: (id: string) => ['admin', 'refund', id] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockRefund = {
  id: 'CR-001',
  creditNoteNo: 'CN-2026-001',
  invoiceId: '101',
  invoiceNo: 'INV-001',
  patientName: 'Rahim',
  patientMobile: '01710000000',
  originalAmount: 5000,
  refundAmount: 1500,
  reason: 'Patient discharged before procedure was done',
  requestedBy: 'Karim',
  requestedAt: '2026-06-11T10:00:00Z',
  counter: 'Counter A',
  status: 'pending',
  adminNote: 'Verified with patient',
  services: [
    { name: 'Consultation', amount: 1000, delivered: true },
    { name: 'Surgery', amount: 4000, delivered: false },
  ],
  previousPatientRefunds: [
    { id: 'CR-100', amount: 500, date: '2026-05-01', status: 'approved' },
  ],
  previousStaffRefunds: [],
};

describe('RefundRequestDetail', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<RefundRequestDetail />);
    expect(screen.getByText('refundRequestDetail.loading')).toBeInTheDocument();
  });

  it('shows not found when no data', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false } as never);
    render(<RefundRequestDetail />);
    expect(screen.getByText('refundRequestDetail.notFound')).toBeInTheDocument();
  });

  it('renders credit note and patient info', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockRefund, isLoading: false } as never);
    const { container } = render(<RefundRequestDetail />);
    expect(container.textContent).toContain('CN-2026-001');
    expect(container.textContent).toContain('Rahim');
    expect(container.textContent).toContain('01710000000');
    expect(container.textContent).toContain('refundRequestDetail.statusLabels.pending');
  });

  it('renders 4 summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockRefund, isLoading: false } as never);
    const { container } = render(<RefundRequestDetail />);
    expect(container.textContent).toContain('refundRequestDetail.originalAmount');
    expect(container.textContent).toContain('refundRequestDetail.refundAmount');
    expect(container.textContent).toContain('refundRequestDetail.requestedBy');
    expect(container.textContent).toContain('refundRequestDetail.counter');
    expect(container.textContent).toContain('৳5,000.00');
    expect(container.textContent).toContain('৳1,500.00');
  });

  it('renders reason section', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockRefund, isLoading: false } as never);
    render(<RefundRequestDetail />);
    expect(screen.getByText('Patient discharged before procedure was done')).toBeInTheDocument();
  });

  it('renders 4 detail tabs', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockRefund, isLoading: false } as never);
    render(<RefundRequestDetail />);
    expect(screen.getByText('refundRequestDetail.tabs.invoiceDetails')).toBeInTheDocument();
    expect(screen.getByText('refundRequestDetail.tabs.services')).toBeInTheDocument();
    expect(screen.getByText('refundRequestDetail.tabs.history')).toBeInTheDocument();
    expect(screen.getByText('refundRequestDetail.tabs.notes')).toBeInTheDocument();
  });

  it('shows services table in Services tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockRefund, isLoading: false } as never);
    render(<RefundRequestDetail />);
    fireEvent.click(screen.getByText('refundRequestDetail.tabs.services'));
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    expect(screen.getByText('Surgery')).toBeInTheDocument();
    expect(screen.getByText('refundRequestDetail.no')).toBeInTheDocument();
  });

  it('shows previous patient refunds in History tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockRefund, isLoading: false } as never);
    render(<RefundRequestDetail />);
    fireEvent.click(screen.getByText('refundRequestDetail.tabs.history'));
    expect(screen.getByText('refundRequestDetail.history.previousPatientRefunds')).toBeInTheDocument();
    expect(screen.getByText('CR-100')).toBeInTheDocument();
    expect(screen.getByText('refundRequestDetail.history.previousStaffRefunds')).toBeInTheDocument();
    expect(screen.getByText('refundRequestDetail.history.noPreviousStaffRefunds')).toBeInTheDocument();
  });

  it('shows admin note in Notes tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockRefund, isLoading: false } as never);
    render(<RefundRequestDetail />);
    fireEvent.click(screen.getByText('refundRequestDetail.tabs.notes'));
    expect(screen.getByText('refundRequestDetail.adminNote')).toBeInTheDocument();
    expect(screen.getByText('Verified with patient')).toBeInTheDocument();
  });

  it('shows action buttons for pending status', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockRefund, isLoading: false } as never);
    render(<RefundRequestDetail />);
    expect(screen.getByText('refundRequestDetail.actions.askClarification')).toBeInTheDocument();
    expect(screen.getByText('refundRequestDetail.actions.escalate')).toBeInTheDocument();
    expect(screen.getByText('refundRequestDetail.actions.approve')).toBeInTheDocument();
    expect(screen.getByText('refundRequestDetail.actions.reject')).toBeInTheDocument();
  });

  it('hides action buttons for non-pending status', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { ...mockRefund, status: 'approved' }, isLoading: false } as never);
    render(<RefundRequestDetail />);
    expect(screen.queryByText('refundRequestDetail.actions.askClarification')).not.toBeInTheDocument();
    expect(screen.queryByText('refundRequestDetail.actions.approve')).not.toBeInTheDocument();
  });
});
