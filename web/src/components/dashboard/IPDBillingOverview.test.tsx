import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import IPDBillingOverview from './IPDBillingOverview';
import { useApiQuery } from '../../hooks/useApiQuery';
import { IPD_BN_COPY } from '../../pages/admin/widgets/ipdBillingCopy';

vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('../../lib/i18n', () => ({ default: { language: 'en' } }));

const period = { startDate: '2026-07-01', endDate: '2026-07-17', label: '2026-07-01 – 2026-07-17' };

function renderPanel(onInvoiceOpen?: (billId: number) => void) {
  return render(
    <MemoryRouter initialEntries={['/h/demo/md']}>
      <IPDBillingOverview period={period} queryKeyScope="md" pageSize={2} onInvoiceOpen={onInvoiceOpen} />
    </MemoryRouter>,
  );
}

describe('shared IPDBillingOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests the selected inclusive period and never computes today internally', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: {}, isLoading: false, isError: false, refetch: vi.fn() } as never);
    renderPanel();

    expect(vi.mocked(useApiQuery)).toHaveBeenCalledWith(
      ['md', 'ipd-billing-overview', '2026-07-01', '2026-07-17', 1, 2],
      '/api/ip-billing/stats?page=1&pageSize=2&from=2026-07-01&to=2026-07-17',
      expect.objectContaining({ refetchInterval: 30_000 }),
    );
    expect(screen.getByText(/2026-07-01 – 2026-07-17/)).toBeInTheDocument();
  });

  it('normalizes partial legacy responses and missing activity arrays without crashing', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { total_inpatients: 2, total_charges_today: 500 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);

    renderPanel();
    expect(screen.getByText('No IPD financial activity found for selected period.')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getAllByText('৳500.00').length).toBeGreaterThan(0);
  });

  it('keeps Bangla copy period-aware instead of saying today for historical ranges', () => {
    expect(IPD_BN_COPY['adminDashboard.ipdBilling.chargesAddedToday']).toContain('নির্বাচিত সময়ে');
    expect(IPD_BN_COPY['adminDashboard.ipdBilling.admissionsToday']).toContain('নির্বাচিত সময়ে');
    expect(IPD_BN_COPY['adminDashboard.ipdBilling.activityTitle']).toContain('নির্বাচিত সময়ের');
    expect(IPD_BN_COPY['adminDashboard.ipdBilling.paidToday']).not.toContain('আজ');
  });

  it('uses the activity alias and pages details without changing the selected period', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => ({
      data: {
        totalActivityRows: 3,
        page: path.includes('page=2') ? 2 : 1,
        pageSize: 2,
        hasNextPage: !path.includes('page=2'),
        activity: path.includes('page=2')
          ? [{ billId: 3, invoiceNo: 'IPD-3', admissionId: 3, admissionNo: 'ADM-3', patientName: 'Patient 3', patientCode: 'P-3', grossAmount: 100, discountAmount: 0, netAmount: 100, paymentAmount: 100, cashAmount: 100, nonCashAmount: 0, depositReceivedToday: 0, totalReceivedToday: 100, depositApplied: 0, dueAmount: 0, status: 'paid', paymentMethod: 'cash', serviceNames: 'Cabin', itemCount: 1, occurredAt: '2026-07-17' }]
          : [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })) as never);

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Next IPD activity page' }));

    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('page=2&pageSize=2&from=2026-07-01&to=2026-07-17'))).toBe(true);
    expect(screen.getByText('IPD-3')).toBeInTheDocument();
  });

  it('opens invoice activity only when a stable bill ID exists', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        activity: [
          { billId: 3, invoiceNo: 'IPD-3', admissionId: 3, admissionNo: 'ADM-3', patientName: 'Patient 3', patientCode: 'P-3', grossAmount: 100, discountAmount: 0, netAmount: 100, paymentAmount: 100, cashAmount: 100, nonCashAmount: 0, depositReceivedToday: 0, totalReceivedToday: 100, depositApplied: 0, dueAmount: 0, status: 'paid', paymentMethod: 'cash', serviceNames: 'Cabin', itemCount: 1, occurredAt: '2026-07-17' },
          { billId: 0, invoiceNo: null, admissionId: 4, admissionNo: 'ADM-4', patientName: 'Patient 4', patientCode: 'P-4', grossAmount: 0, discountAmount: 0, netAmount: 0, paymentAmount: 0, cashAmount: 0, nonCashAmount: 0, depositReceivedToday: 200, totalReceivedToday: 200, depositApplied: 0, dueAmount: 0, status: 'deposit_received', paymentMethod: 'cash', serviceNames: null, itemCount: 0, occurredAt: '2026-07-17' },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    const onInvoiceOpen = vi.fn();
    renderPanel(onInvoiceOpen);
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice IPD-3' }));
    expect(onInvoiceOpen).toHaveBeenCalledWith(3);
    expect(screen.getByText('Invoice not created yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ADM-4/ })).not.toBeInTheDocument();
  });
});
