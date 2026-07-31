import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DueReceivables from './DueReceivables';
import { useApiQuery } from '../../hooks/useApiQuery';

let queryState: Record<string, unknown>;

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: { defaultValue?: string; invoice?: string }) => (
      options?.defaultValue?.replace('{{invoice}}', options.invoice ?? '') ?? key
    ),
  }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    actionCenter: {
      collections: {
        list: (filters: Record<string, unknown>) => ['action-center', 'collections', 'list', filters],
      },
    },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock('../../components/action-center/ActionCenterShell', () => ({
  default: ({ children, activeSection, title }: { children: React.ReactNode; activeSection: string; title: string }) => (
    <section data-testid="action-center-shell" data-section={activeSection} aria-label={title}>{children}</section>
  ),
}));
vi.mock('../../components/action-center/CollectionDetailDrawer', () => ({
  default: ({ open, sourceKey }: { open: boolean; sourceKey: string | null }) => (
    open ? <div data-testid="collection-drawer">{sourceKey}</div> : null
  ),
}));

const listResponse = {
  data: {
    items: [
      {
        sourceKey: 'legacy-bill:101',
        source: { sourceType: 'invoice', legacyBillId: 101 },
        invoiceNumber: 'INV-101',
        patientId: 1,
        patientName: 'Rahim Uddin',
        patientMobile: '01700000001',
        currencyCode: 'BDT',
        totalMinor: 10_000,
        paidMinor: 2_000,
        creditedMinor: 0,
        dueMinor: 8_000,
        issuedAtUtc: '2026-07-14T06:00:00.000Z',
        financialStatus: 'open',
        caseId: null,
        collectionStatus: 'new',
        assignedTo: null,
        nextFollowupAtUtc: null,
        promiseDate: null,
        promiseAmountMinor: null,
        latestNote: null,
        lastContactedAtUtc: null,
        updatedAtUtc: null,
        daysOutstanding: 1,
      },
      {
        sourceKey: 'legacy-bill:102',
        source: { sourceType: 'invoice', legacyBillId: 102 },
        invoiceNumber: 'INV-102',
        patientId: 2,
        patientName: 'Karim Uddin',
        patientMobile: null,
        currencyCode: 'BDT',
        totalMinor: 10_000,
        paidMinor: 2_000,
        creditedMinor: 0,
        dueMinor: 8_000,
        issuedAtUtc: '2026-06-01T06:00:00.000Z',
        financialStatus: 'open',
        caseId: 22,
        collectionStatus: 'promised',
        assignedTo: 7,
        nextFollowupAtUtc: '2026-07-15T04:00:00.000Z',
        promiseDate: '2026-07-20',
        promiseAmountMinor: 5_000,
        latestNote: 'Patient promised payment.',
        lastContactedAtUtc: '2026-07-14T06:00:00.000Z',
        updatedAtUtc: '2026-07-14T06:00:00.000Z',
        daysOutstanding: 44,
      },
    ],
    summary: {
      totalDueMinor: 16_000,
      totalInvoices: 2,
      currentMinor: 8_000,
      days30Minor: 0,
      days60Minor: 8_000,
      days90PlusMinor: 0,
      followupDue: 1,
      promisedAmountMinor: 5_000,
      disputedAmountMinor: 0,
      currencyCode: 'BDT',
      amountsByCurrency: [{
        currencyCode: 'BDT',
        totalDueMinor: 16_000,
        totalInvoices: 2,
        currentMinor: 8_000,
        days30Minor: 0,
        days60Minor: 8_000,
        days90PlusMinor: 0,
        promisedAmountMinor: 5_000,
        disputedAmountMinor: 0,
      }],
      supportedSourceTypes: ['invoice'],
      authorityMode: 'legacy',
      shadowMismatchCount: 0,
      agingCounts: { '0-7': 1, '8-30': 0, '31-60': 1, '60+': 0 },
    },
    pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
  },
};

function renderPage(initialEntry = '/h/city-hospital/action/collections') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/h/:slug/action/collections" element={<DueReceivables />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DueReceivables canonical collections workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState = {
      data: listResponse,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    vi.mocked(useApiQuery).mockImplementation(() => queryState as never);
  });

  it('loads the canonical API with URL-backed server filters', () => {
    renderPage('/h/city-hospital/action/collections?status=promised&followup=due&ageBucket=31-60&sort=oldest&page=2');

    expect(screen.getByTestId('layout')).toBeInTheDocument();
    expect(screen.getByTestId('action-center-shell')).toHaveAttribute('data-section', 'collections');
    expect(useApiQuery).toHaveBeenCalledWith(
      expect.arrayContaining(['action-center', 'collections', 'list']),
      expect.stringContaining('/api/action-center/collections?'),
      expect.objectContaining({ placeholderData: expect.any(Function) }),
    );
    const path = String(vi.mocked(useApiQuery).mock.calls[0][1]);
    expect(path).toContain('status=promised');
    expect(path).toContain('followup=due');
    expect(path).toContain('ageBucket=31-60');
    expect(path).toContain('sort=oldest');
    expect(path).toContain('page=2');
    expect(path).toContain('limit=50');
  });

  it('renders authority-aware minor-unit summary and full-dataset counts', () => {
    renderPage();

    expect(screen.getByText('dueReceivables.authority.legacy')).toBeInTheDocument();
    expect(screen.getByText('dueReceivables.summary.totalDue')).toBeInTheDocument();
    expect(screen.getByText('dueReceivables.summary.current')).toBeInTheDocument();
    expect(screen.getByText('dueReceivables.summary.days60')).toBeInTheDocument();
    expect(screen.getByText('dueReceivables.summary.followupDue')).toBeInTheDocument();
    expect(screen.getAllByText(/BDT/).length).toBeGreaterThan(0);
    expect(screen.getByText(/dueReceivables\.summary\.invoices/)).toHaveTextContent('2');
  });

  it('renders semantic desktop rows and mobile cards and opens the selected source drawer', () => {
    renderPage();

    const table = screen.getByRole('table', { name: 'dueReceivables.table.label' });
    expect(within(table).getByText('Rahim Uddin')).toBeInTheDocument();
    expect(within(table).getByText('INV-101')).toBeInTheDocument();
    expect(screen.getByTestId('collection-mobile-list')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Open INV-101' })[0]);
    expect(screen.getByTestId('collection-drawer')).toHaveTextContent('legacy-bill:101');
  });

  it('updates server filters without browser prompts', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => null);
    renderPage();

    fireEvent.change(screen.getByLabelText('dueReceivables.filters.status'), {
      target: { value: 'disputed' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.filters.followup'), {
      target: { value: 'due' },
    });
    fireEvent.change(screen.getByLabelText('dueReceivables.filters.search'), {
      target: { value: 'INV-101' },
    });

    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText('dueReceivables.filters.status')).toHaveValue('disputed');
    expect(screen.getByLabelText('dueReceivables.filters.followup')).toHaveValue('due');
    expect(screen.getByLabelText('dueReceivables.filters.search')).toHaveValue('INV-101');
    promptSpy.mockRestore();
  });

  it('shows an explicit authority-configuration state for a 503', () => {
    queryState = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('Canonical schema missing'), { status: 503 }),
      refetch: vi.fn(),
    };

    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('dueReceivables.authority.unavailable');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
