import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CollectionFollowup from './CollectionFollowup';
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
    useLocation: () => ({ pathname: '/admin/collection-followup', search: params.toString(), hash: '', state: null, key: 'default' }),
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
  queryKeys: { admin: { dueReceivables: () => ['admin', 'due-receivables'] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockFollowups = [
  { id: 'F1', patientName: 'Rahim', patientPhone: '01710000000', invoiceId: 'INV-001', dueAmount: 5000, daysOverdue: 35, lastFollowupDate: null, lastFollowupNote: null, nextFollowupDate: '2026-06-15', assignedTo: 'Karim Uddin', status: 'pending' as const, followupCount: 0 },
  { id: 'F2', patientName: 'Salma', patientPhone: '01710000001', invoiceId: 'INV-002', dueAmount: 2000, daysOverdue: 10, lastFollowupDate: null, lastFollowupNote: null, nextFollowupDate: '2026-06-20', assignedTo: 'Rina Akter', status: 'contacted' as const, followupCount: 2 },
];

const mockSummary = {
  totalPending: 25,
  contacted: 12,
  promisedPayment: 8,
  escalated: 5,
  totalDue: 125000,
};

describe('CollectionFollowup', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders page title and subtitle', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { followups: [], summary: undefined }, isLoading: false } as never);
    render(<CollectionFollowup />);
    expect(screen.getByText('collectionFollowup.title')).toBeInTheDocument();
    expect(screen.getByText('collectionFollowup.subtitle')).toBeInTheDocument();
  });

  it('renders 5 summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { followups: [], summary: mockSummary }, isLoading: false } as never);
    const { container } = render(<CollectionFollowup />);
    expect(container.textContent).toContain('collectionFollowup.totalPending');
    expect(container.textContent).toContain('collectionFollowup.contacted');
    expect(container.textContent).toContain('collectionFollowup.promised');
    expect(container.textContent).toContain('collectionFollowup.escalated');
    expect(container.textContent).toContain('collectionFollowup.totalDue');
    expect(container.textContent).toContain('25');
    expect(container.textContent).toContain('৳125,000.00');
  });

  it('renders 5 status tabs', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { followups: [] }, isLoading: false } as never);
    const { container } = render(<CollectionFollowup />);
    expect(container.textContent).toContain('collectionFollowup.all');
    expect(container.textContent).toContain('collectionFollowup.pending');
    expect(container.textContent).toContain('collectionFollowup.contacted');
    expect(container.textContent).toContain('collectionFollowup.promised');
    expect(container.textContent).toContain('collectionFollowup.escalated');
  });

  it('renders all followups by default (All tab)', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { followups: mockFollowups, summary: mockSummary }, isLoading: false } as never);
    const { container } = render(<CollectionFollowup />);
    expect(container.textContent).toContain('Rahim');
    expect(container.textContent).toContain('Salma');
  });

  it('filters by Pending tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { followups: mockFollowups, summary: mockSummary }, isLoading: false } as never);
    const { container } = render(<CollectionFollowup />);
    const pendingBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'collectionFollowup.pending');
    fireEvent.click(pendingBtn!);
    const tbody = container.querySelector('tbody');
    expect(tbody?.textContent).toContain('Rahim');
    expect(tbody?.textContent).not.toContain('Salma');
  });

  it('filters by Contacted tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { followups: mockFollowups, summary: mockSummary }, isLoading: false } as never);
    const { container } = render(<CollectionFollowup />);
    const contactedBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'collectionFollowup.contacted');
    fireEvent.click(contactedBtn!);
    const tbody = container.querySelector('tbody');
    expect(tbody?.textContent).toContain('Salma');
    expect(tbody?.textContent).not.toContain('Rahim');
  });

  it('shows overdue days in red for >30 days', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { followups: [mockFollowups[0]], summary: mockSummary }, isLoading: false } as never);
    const { container } = render(<CollectionFollowup />);
    // Look for the span with the 35d value
    const spans = container.querySelectorAll('span');
    const overdueEl = Array.from(spans).find(el => el.textContent === '35d');
    expect(overdueEl).toBeTruthy();
    expect(overdueEl?.className).toContain('text-red-600');
  });

  it('shows overdue days in amber for 14-30 days', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { followups: [{ ...mockFollowups[0], daysOverdue: 20 }], summary: mockSummary },
      isLoading: false,
    } as never);
    const { container } = render(<CollectionFollowup />);
    const spans = container.querySelectorAll('span');
    const overdueEl = Array.from(spans).find(el => el.textContent === '20d');
    expect(overdueEl).toBeTruthy();
    expect(overdueEl?.className).toContain('text-amber-600');
  });

  it('shows empty state when no followups', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { followups: [] }, isLoading: false } as never);
    render(<CollectionFollowup />);
    expect(screen.getByText('collectionFollowup.noData')).toBeInTheDocument();
  });
});
