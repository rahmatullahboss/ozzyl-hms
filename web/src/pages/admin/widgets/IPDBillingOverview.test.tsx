import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import IPDBillingOverview from './IPDBillingOverview';
import { useApiQuery } from '../../../hooks/useApiQuery';

vi.mock('../../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('../../../lib/i18n', () => ({
  default: { language: 'en' },
}));

const stats = {
  total_inpatients: 3,
  pending_billing: 1,
  charges_added_today: 24545,
  total_charges_today: 24545,
  gross_billed_today: 35445,
  final_billed_today: 34200,
  final_bill_count_today: 1,
  payment_collected_today: 33900,
  payment_receipt_count_today: 1,
  cash_collected_today: 33900,
  non_cash_collected_today: 0,
  deposit_received_today: 600,
  deposit_receipt_count_today: 2,
  deposit_cash_received_today: 600,
  deposit_non_cash_received_today: 0,
  total_money_received_today: 34500,
  total_cash_received_today: 34500,
  total_non_cash_received_today: 0,
  deposit_applied_today: 600,
  discount_today: 1245,
  settled_gross_today: 35445,
  settled_discount_today: 1245,
  settled_payment_applied_today: 33900,
  settled_deposit_applied_today: 300,
  settled_today: 34200,
  settled_bill_count_today: 1,
  current_provisional_due: 300,
  high_due_patients: 0,
  package_patients: 0,
  today_admissions: 2,
  today_discharges: 2,
  today_activity: [
    {
      billId: 6548,
      invoiceNo: 'BL-000025',
      admissionId: 13073,
      admissionNo: 'ADM-000014',
      patientName: 'Test Patient',
      patientCode: 'PT-001',
      grossAmount: 35445,
      discountAmount: 1245,
      netAmount: 34200,
      paymentAmount: 33900,
      cashAmount: 33900,
      nonCashAmount: 0,
      depositReceivedToday: 0,
      totalReceivedToday: 33900,
      depositApplied: 300,
      dueAmount: 0,
      status: 'paid',
      paymentMethod: 'cash',
      serviceNames: 'Admission Fee, OT Charge, Medicine, Cabin',
      itemCount: 7,
      occurredAt: '2026-07-16 15:50:49',
    },
    {
      billId: 6544,
      invoiceNo: 'BL-000024',
      admissionId: 13082,
      admissionNo: 'ADM-000023',
      patientName: 'Parvin',
      patientCode: 'P-000850',
      grossAmount: 300,
      discountAmount: 0,
      netAmount: 300,
      paymentAmount: 0,
      cashAmount: 0,
      nonCashAmount: 0,
      depositReceivedToday: 300,
      totalReceivedToday: 300,
      depositApplied: 300,
      dueAmount: 0,
      status: 'paid',
      paymentMethod: null,
      serviceNames: 'Admission Fee',
      itemCount: 1,
      occurredAt: '2026-07-16 12:44:23',
    },
    {
      billId: 0,
      invoiceNo: null,
      admissionId: 13081,
      admissionNo: 'ADM-000022',
      patientName: 'Marufa',
      patientCode: 'P-000847',
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      paymentAmount: 0,
      cashAmount: 0,
      nonCashAmount: 0,
      depositReceivedToday: 300,
      totalReceivedToday: 300,
      depositApplied: 0,
      dueAmount: 0,
      status: 'deposit_received',
      paymentMethod: 'cash',
      serviceNames: null,
      itemCount: 0,
      occurredAt: '2026-07-16 10:28:32',
    },
  ],
};

function renderWidget() {
  return render(
    <MemoryRouter initialEntries={['/h/patient-care-hospital/admin']}>
      <IPDBillingOverview
        period={{ startDate: '2026-07-16', endDate: '2026-07-16', label: '2026-07-16' }}
        queryKeyScope="admin"
      />
    </MemoryRouter>,
  );
}

describe('IPDBillingOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue({
      data: stats,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
  });

  it('separates charges, final bills, total money received, and provisional due', () => {
    renderWidget();

    expect(screen.getByText('Charges added in selected period')).toBeInTheDocument();
    expect(screen.getByText('Final IPD bills in selected period')).toBeInTheDocument();
    expect(screen.getByText('Total IPD money received in selected period')).toBeInTheDocument();
    expect(screen.getByText('Provisional due as of period end')).toBeInTheDocument();

    expect(screen.getAllByText('৳24,545.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('৳34,200.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('৳34,500.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/Bill payments.*৳33,900.00.*new deposits.*৳600.00/i)).toBeInTheDocument();
    expect(screen.getAllByText('৳300.00').length).toBeGreaterThan(0);
  });

  it('shows the settlement reconciliation and invoice activity row', () => {
    renderWidget();

    expect(screen.getByText('Selected-period IPD settlement reconciliation')).toBeInTheDocument();
    expect(screen.getByText('Gross bill')).toBeInTheDocument();
    expect(screen.getAllByText('Discount').length).toBeGreaterThan(0);
    expect(screen.getByText('Net bill')).toBeInTheDocument();
    expect(screen.getByText('Payments applied')).toBeInTheDocument();
    expect(screen.getAllByText('Deposit applied').length).toBeGreaterThan(0);
    expect(screen.getByText('Settled amount')).toBeInTheDocument();
    expect(screen.getByText('BL-000025')).toBeInTheDocument();
    expect(screen.getByText('ADM-000014')).toBeInTheDocument();
    expect(screen.getByText(/OT Charge/)).toBeInTheDocument();
  });

  it('shows a deposit-only admission as money received instead of an ambiguous zero', () => {
    renderWidget();

    expect(screen.getByText('BL-000024')).toBeInTheDocument();
    const parvinCell = screen.getByText('Parvin');
    const parvinRow = parvinCell.closest('tr');
    expect(parvinRow).not.toBeNull();

    const row = within(parvinRow as HTMLElement);
    expect(row.getByText(/Total received.*৳300.00/i)).toBeInTheDocument();
    expect(row.getByText(/Bill payment.*৳0.00/i)).toBeInTheDocument();
    expect(row.getByText(/New deposit.*৳300.00/i)).toBeInTheDocument();
  });

  it('shows a new deposit even when the admission has no invoice yet', () => {
    renderWidget();

    const marufaCell = screen.getByText('Marufa');
    const marufaRow = marufaCell.closest('tr');
    expect(marufaRow).not.toBeNull();

    const row = within(marufaRow as HTMLElement);
    expect(row.getAllByText('Deposit received').length).toBeGreaterThan(0);
    expect(row.getByText('Invoice not created yet')).toBeInTheDocument();
    expect(row.getByText('ADM-000022')).toBeInTheDocument();
    expect(row.getByText(/Total received.*৳300.00/i)).toBeInTheDocument();
    expect(row.getByText(/Bill payment.*৳0.00/i)).toBeInTheDocument();
    expect(row.getByText(/New deposit.*৳300.00/i)).toBeInTheDocument();
  });

  it('never renders raw IPD translation keys', () => {
    renderWidget();
    expect(document.body.textContent).not.toMatch(/adminDashboard\.ipdBilling/i);
  });
});
