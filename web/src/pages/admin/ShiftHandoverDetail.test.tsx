import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShiftHandoverDetail from './ShiftHandoverDetail';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', () => ({ useParams: () => ({ handoverId: 'H-001' }) }));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { admin: { shiftHandoverDetail: (id: string) => ['admin', 'handover', id] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockHandover = {
  id: 'H-001',
  counter: 'Counter A',
  sessionNo: 'S-100',
  outgoingStaff: 'Karim',
  incomingStaff: 'Rina',
  shiftOpenAmount: 5000,
  totalCashReceived: 25000,
  totalCashPaidOut: 1000,
  declaredCash: 29000,
  incomingCount: 145,
  receivedCash: 29000,
  variance: 0,
  status: 'verified',
  notes: 'Smooth handover',
  handoverTime: '2026-06-11T18:00:00Z',
  denominations: [
    { note: 1000, count: 20, total: 20000 },
    { note: 500, count: 10, total: 5000 },
    { note: 100, count: 40, total: 4000 },
  ],
};

describe('ShiftHandoverDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
    vi.mocked(useQueryClient).mockReturnValue({ invalidateQueries: vi.fn() } as never);
  });

  it('shows loading state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<ShiftHandoverDetail />);
    expect(screen.getByText('shiftHandoverDetail.loading')).toBeInTheDocument();
  });

  it('shows not found when no data', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false } as never);
    render(<ShiftHandoverDetail />);
    expect(screen.getByText('shiftHandoverDetail.notFound')).toBeInTheDocument();
  });

  it('renders handover header with status', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockHandover, isLoading: false } as never);
    render(<ShiftHandoverDetail />);
    expect(screen.getByText(/H-001/)).toBeInTheDocument();
    expect(screen.getByText(/Counter A/)).toBeInTheDocument();
    expect(screen.getByText('shiftHandoverDetail.statusLabels.verified')).toBeInTheDocument();
  });

  it('renders 3 staff info cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockHandover, isLoading: false } as never);
    render(<ShiftHandoverDetail />);
    expect(screen.getByText('shiftHandoverDetail.outgoingStaff')).toBeInTheDocument();
    expect(screen.getByText('shiftHandoverDetail.incomingStaff')).toBeInTheDocument();
    expect(screen.getByText('shiftHandoverDetail.handoverTime')).toBeInTheDocument();
    expect(screen.getByText('Karim')).toBeInTheDocument();
    expect(screen.getByText('Rina')).toBeInTheDocument();
  });

  it('renders cash summary with amounts', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockHandover, isLoading: false } as never);
    const { container } = render(<ShiftHandoverDetail />);
    expect(container.textContent).toContain('shiftHandoverDetail.cashSummary');
    expect(container.textContent).toContain('৳5,000.00');
    expect(container.textContent).toContain('৳25,000.00');
    expect(container.textContent).toContain('৳1,000.00');
    expect(container.textContent).toContain('৳29,000.00');
  });

  it('renders denomination breakdown table', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockHandover, isLoading: false } as never);
    render(<ShiftHandoverDetail />);
    expect(screen.getByText('shiftHandoverDetail.denominationBreakdown')).toBeInTheDocument();
    expect(screen.getByText('৳1,000.00')).toBeInTheDocument(); // note 1000
    expect(screen.getByText('20')).toBeInTheDocument(); // count
    expect(screen.getByText('70')).toBeInTheDocument(); // total count
  });

  it('shows no variance when variance is zero', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockHandover, isLoading: false } as never);
    render(<ShiftHandoverDetail />);
    expect(screen.getByText('shiftHandoverDetail.variance.noVariance')).toBeInTheDocument();
  });

  it('shows variance amount and direction when non-zero', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { ...mockHandover, variance: -500, status: 'disputed' },
      isLoading: false,
    } as never);
    const { container } = render(<ShiftHandoverDetail />);
    expect(container.textContent).toMatch(/shiftHandoverDetail\.variance\.variance[\s\S]*৳500[\s\S]*shiftHandoverDetail\.variance\.under/);
    expect(screen.getByText('shiftHandoverDetail.statusLabels.disputed')).toBeInTheDocument();
  });

  it('renders notes section when present', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockHandover, isLoading: false } as never);
    render(<ShiftHandoverDetail />);
    expect(screen.getByText('shiftHandoverDetail.notes')).toBeInTheDocument();
    expect(screen.getByText('Smooth handover')).toBeInTheDocument();
  });

  it('hides notes section when empty', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { ...mockHandover, notes: '' }, isLoading: false } as never);
    render(<ShiftHandoverDetail />);
    expect(screen.queryByText('Smooth handover')).not.toBeInTheDocument();
  });

  it('shows empty state for missing denominations', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { ...mockHandover, denominations: [] }, isLoading: false } as never);
    render(<ShiftHandoverDetail />);
    expect(screen.getByText('shiftHandoverDetail.noDenominationData')).toBeInTheDocument();
  });
});
