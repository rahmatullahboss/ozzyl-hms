import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import ExecutiveDuePanel from './ExecutiveDuePanel';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('../../lib/i18n', () => ({ default: { language: 'en' } }));

const pageOne = {
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
        daysOutstanding: 9,
      },
      {
        sourceKey: 'legacy-bill:102',
        source: { sourceType: 'invoice', legacyBillId: 102 },
        invoiceNumber: 'INV-102',
        patientId: 2,
        patientName: 'Karim Uddin',
        patientMobile: null,
        currencyCode: 'BDT',
        totalMinor: 15_000,
        paidMinor: 5_000,
        creditedMinor: 0,
        dueMinor: 10_000,
        issuedAtUtc: '2026-05-01T06:00:00.000Z',
        financialStatus: 'open',
        caseId: 22,
        collectionStatus: 'promised',
        assignedTo: 7,
        nextFollowupAtUtc: '2026-07-24T04:00:00.000Z',
        promiseDate: '2026-07-26',
        promiseAmountMinor: 5_000,
        latestNote: 'Patient promised payment.',
        lastContactedAtUtc: '2026-07-22T06:00:00.000Z',
        updatedAtUtc: '2026-07-22T06:00:00.000Z',
        daysOutstanding: 83,
      },
    ],
    summary: {
      totalDueMinor: 180_000,
      totalInvoices: 24,
      currentMinor: 40_000,
      days30Minor: 50_000,
      days60Minor: 30_000,
      days90PlusMinor: 60_000,
      followupDue: 4,
      promisedAmountMinor: 25_000,
      disputedAmountMinor: 15_000,
      currencyCode: 'BDT',
      amountsByCurrency: [{
        currencyCode: 'BDT',
        totalDueMinor: 180_000,
        totalInvoices: 24,
        currentMinor: 40_000,
        days30Minor: 50_000,
        days60Minor: 30_000,
        days90PlusMinor: 60_000,
        promisedAmountMinor: 25_000,
        disputedAmountMinor: 15_000,
      }],
      supportedSourceTypes: ['invoice'],
      authorityMode: 'legacy',
      shadowMismatchCount: 0,
      agingCounts: { '0-7': 4, '8-30': 7, '31-60': 5, '60+': 8 },
    },
    pagination: { page: 1, limit: 8, total: 24, totalPages: 3 },
  },
};

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/h/city-hospital/md']}>
      <ExecutiveDuePanel role="md" basePath="/h/city-hospital" queryKeyScope="md" />
    </MemoryRouter>,
  );
}

describe('ExecutiveDuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => ({
      data: path.includes('page=2')
        ? {
            ...pageOne,
            data: {
              ...pageOne.data,
              items: [{ ...pageOne.data.items[0], sourceKey: 'legacy-bill:201', invoiceNumber: 'INV-201', patientName: 'Page Two Patient' }],
              pagination: { page: 2, limit: 8, total: 24, totalPages: 3 },
            },
          }
        : pageOne,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })) as never);
  });

  it('loads all active dues by exposure with server pagination', () => {
    renderPanel();

    expect(vi.mocked(useApiQuery)).toHaveBeenCalledWith(
      expect.arrayContaining(['action-center', 'collections', 'list']),
      '/api/action-center/collections?status=active&sort=exposure&page=1&limit=8',
      expect.objectContaining({ placeholderData: expect.any(Function) }),
    );
    expect(screen.getByText('Live outstanding dues')).toBeInTheDocument();
  });

  it('renders full-dataset summary separately from visible rows', () => {
    renderPanel();

    const summary = screen.getByRole('region', { name: 'Outstanding due summary' });
    expect(within(summary).getByText('24 open invoices')).toBeInTheDocument();
    expect(within(summary).getByText('Follow-up due')).toBeInTheDocument();
    expect(within(summary).getByText('Promised')).toBeInTheDocument();
    expect(within(summary).getByText('Disputed')).toBeInTheDocument();
    expect(within(summary).getByText('0–7 days')).toBeInTheDocument();
    expect(within(summary).getByText('60+ days')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Outstanding due preview' });
    expect(within(table).getByText('Rahim Uddin')).toBeInTheDocument();
    expect(within(table).getByText('01700000001')).toBeInTheDocument();
    expect(within(table).getByText('INV-102')).toBeInTheDocument();
    expect(within(table).getByText('Issued 14-07-2026')).toBeInTheDocument();
    expect(within(table).getByText('9d')).toBeInTheDocument();
    expect(within(table).getByText('Promised')).toBeInTheDocument();
    expect(within(table).getByText('Promise: 26-07-2026')).toBeInTheDocument();
    expect(within(table).getAllByText(/BDT/).length).toBeGreaterThan(0);
    expect(table.parentElement).toHaveClass('overflow-x-auto');
    expect(within(table).getByRole('link', { name: 'Open INV-101' })).toHaveClass('min-h-11');
  });

  it('requests the next server page without changing summary totals', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Next due page' }));

    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('page=2&limit=8'))).toBe(true);
    expect(screen.getByText('Page Two Patient')).toBeInTheDocument();
    expect(screen.getByText('24 open invoices')).toBeInTheDocument();
  });

  it('links to the canonical full collection queue and never offers direct write-off execution', () => {
    renderPanel();

    expect(screen.getByRole('link', { name: 'View all dues' })).toHaveAttribute(
      'href',
      '/h/city-hospital/action/collections?status=active&sort=exposure',
    );
    expect(screen.queryByRole('button', { name: /write off now/i })).not.toBeInTheDocument();
  });

  it('does not combine multiple currencies into a false total', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        ...pageOne,
        data: {
          ...pageOne.data,
          summary: {
            ...pageOne.data.summary,
            totalDueMinor: null,
            currencyCode: null,
            amountsByCurrency: [
              pageOne.data.summary.amountsByCurrency[0],
              { ...pageOne.data.summary.amountsByCurrency[0], currencyCode: 'USD', totalDueMinor: 1_000, totalInvoices: 1 },
            ],
          },
        },
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as never);

    renderPanel();
    expect(screen.getByText('Multiple currencies')).toBeInTheDocument();
    expect(screen.getAllByText(/BDT/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/USD/).length).toBeGreaterThan(0);
  });

  it('shows an explicit unavailable state and retry instead of a false zero', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: Object.assign(new Error('Canonical schema missing'), { status: 503 }),
      refetch,
    } as never);

    renderPanel();
    expect(screen.getByRole('alert')).toHaveTextContent('Receivable authority is unavailable');
    expect(screen.queryByText('৳0')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry due panel' }));
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
