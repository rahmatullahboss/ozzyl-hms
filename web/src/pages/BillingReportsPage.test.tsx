import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import BillingReportsPage from './BillingReportsPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => {
      const map: Record<string, string> = {
        'billingReportsPage.title': 'Billing Reports',
        'billingReportsPage.subtitle': 'Comprehensive financial reports and analytics',
        'billingReportsPage.exportCsv': 'CSV',
        'billingReportsPage.dateRangeTo': 'to',
        'billingReportsPage.tabs.daily-sales': 'Daily Sales',
        'billingReportsPage.tabs.daybook': 'Sales Daybook',
        'billingReportsPage.tabs.dept-daybook': 'Dept Sales',
        'billingReportsPage.tabs.doctor-income': 'Doctor Income',
        'billingReportsPage.tabs.item-summary': 'Item Summary',
        'billingReportsPage.tabs.user-cash': 'User Cash',
        'billingReportsPage.tabs.payment-mode': 'Payment Mode',
        'billingReportsPage.tabs.handover': 'Handover',
        'billingReportsPage.tabs.discount': 'Discount',
        'billingReportsPage.tabs.denomination': 'Denomination',
        'billingReportsPage.dailySales.cashSales': 'Cash Sales',
        'billingReportsPage.dailySales.salesReturn': 'Sales Return',
        'billingReportsPage.dailySales.collection': 'Collection',
        'billingReportsPage.dailySales.discountGiven': 'Discount Given',
        'billingReportsPage.dailySales.cashierWiseCollection': 'Cashier-wise Collection',
        'billingReportsPage.paymentMode.paymentDistribution': 'Payment Distribution',
        'billingReportsPage.handover.totalHandovers': 'Total Handovers',
        'billingReportsPage.handover.totalAmount': 'Total Amount',
        'billingReportsPage.discount.discountByReason': 'Discount by Reason',
      };
      return map[k] ?? k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { useApiQuery } from '../hooks/useApiQuery';

const mockDailySales = {
  date: '2026-06-05',
  invoices: {
    results: [
      { id: 1, invoice_no: 'INV-001', total_amount: 3500, discount: 200, paid_amount: 3300, due: 0, status: 'paid', patient_name: 'Rahim', patient_code: 'P001', created_by_name: 'Nusrat', created_at: '2026-06-05T10:00:00Z' },
      { id: 2, invoice_no: 'INV-002', total_amount: 5000, discount: 0, paid_amount: 3000, due: 2000, status: 'partial', patient_name: 'Karim', patient_code: 'P002', created_by_name: 'Nusrat', created_at: '2026-06-05T11:00:00Z' },
    ],
  },
  settlements: { total_settlement: 1000, total_refund: 200, total_adjustment: 0 },
  user_collections: [
    { employee_id: 1, employee_name: 'Nusrat', cash_in: 6300, cash_out: 0, net_cash: 6300 },
  ],
  summary: {
    total_cash_sales: 6300,
    total_sales_return: 0,
    total_deposit_deduct: 0,
    total_deposit_return: 0,
    total_collection_from_receivable: 0,
    total_cash_discount_given: 200,
    total_cash_discount_received: 0,
  },
};

const mockDaybook = {
  daybook: [
    { bill_date: '2026-06-05', total_bills: 15, total_amount: 50000, total_discount: 2000, total_paid: 45000, due: 3000 },
    { bill_date: '2026-06-04', total_bills: 12, total_amount: 40000, total_discount: 1500, total_paid: 38000, due: 500 },
  ],
};

const mockPaymentModes = {
  payment_modes: [
    { payment_mode: 'cash', transaction_count: 20, total_amount: 30000 },
    { payment_mode: 'bkash', transaction_count: 10, total_amount: 15000 },
    { payment_mode: 'card', transaction_count: 5, total_amount: 8000 },
  ],
};

const mockDoctorIncome = {
  doctors: [
    { doctor_id: 1, doctor_name: 'Dr. Hasan', specialization: 'Medicine', total_bills: 10, total_revenue: 25000, total_collected: 22000, total_due: 3000, total_commission: 5000 },
  ],
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BillingReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: mockDailySales, isLoading: false });
  });

  it('renders the page title', () => {
    renderWithProviders(<BillingReportsPage />);
    expect(screen.getByText('Billing Reports')).toBeTruthy();
  });

  it('renders the subtitle', () => {
    renderWithProviders(<BillingReportsPage />);
    expect(screen.getByText('Comprehensive financial reports and analytics')).toBeTruthy();
  });

  it('renders all 10 report tabs', () => {
    renderWithProviders(<BillingReportsPage />);
    const tabButtons = document.querySelectorAll('button');
    const tabLabels = Array.from(tabButtons).map(b => b.textContent?.trim());
    expect(tabLabels).toContain('Daily Sales');
    expect(tabLabels).toContain('Sales Daybook');
    expect(tabLabels).toContain('Dept Sales');
    expect(tabLabels).toContain('Doctor Income');
    expect(tabLabels).toContain('Item Summary');
    expect(tabLabels).toContain('User Cash');
    expect(tabLabels).toContain('Payment Mode');
    expect(tabLabels).toContain('Handover');
    expect(tabLabels).toContain('Discount');
    expect(tabLabels).toContain('Denomination');
  });

  it('defaults to Daily Sales tab active', () => {
    renderWithProviders(<BillingReportsPage />);
    const dailySalesTab = screen.getByText('Daily Sales').closest('button');
    expect(dailySalesTab?.className).toContain('border-[var(--color-primary)]');
  });

  it('displays summary cards for Daily Sales tab', () => {
    renderWithProviders(<BillingReportsPage />);
    expect(screen.getByText('Cash Sales')).toBeTruthy();
    expect(screen.getByText('Sales Return')).toBeTruthy();
    expect(screen.getByText('Collection')).toBeTruthy();
    expect(screen.getByText('Discount Given')).toBeTruthy();
  });

  it('displays cashier-wise collection table', () => {
    renderWithProviders(<BillingReportsPage />);
    expect(screen.getByText('Cashier-wise Collection')).toBeTruthy();
    expect(screen.getAllByText(/Nusrat/).length).toBeGreaterThanOrEqual(1);
  });

  it('displays invoice list', () => {
    renderWithProviders(<BillingReportsPage />);
    expect(screen.getByText('INV-001')).toBeTruthy();
    expect(screen.getByText('INV-002')).toBeTruthy();
    expect(screen.getByText('Rahim')).toBeTruthy();
    expect(screen.getByText('Karim')).toBeTruthy();
  });

  it('displays invoice amounts', () => {
    renderWithProviders(<BillingReportsPage />);
    expect(screen.getByText(/\u09F33,500/)).toBeTruthy();
    expect(screen.getByText(/\u09F35,000/)).toBeTruthy();
  });

  it('shows date picker', () => {
    renderWithProviders(<BillingReportsPage />);
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(1);
  });

  it('shows CSV export button', () => {
    renderWithProviders(<BillingReportsPage />);
    expect(screen.getByText('CSV')).toBeTruthy();
  });

  it('switches to Sales Daybook tab on click', () => {
    (useApiQuery as any).mockReturnValue({ data: mockDaybook, isLoading: false });
    renderWithProviders(<BillingReportsPage />);
    fireEvent.click(screen.getByText('Sales Daybook'));
    const daybookTab = screen.getByText('Sales Daybook').closest('button');
    expect(daybookTab?.className).toContain('border-[var(--color-primary)]');
  });

  it('switches to Payment Mode tab and shows distribution', () => {
    (useApiQuery as any).mockReturnValue({ data: mockPaymentModes, isLoading: false });
    renderWithProviders(<BillingReportsPage />);
    const tabButtons = document.querySelectorAll('button');
    const paymentTab = Array.from(tabButtons).find(b => b.textContent?.includes('Payment Mode'));
    expect(paymentTab).toBeTruthy();
    fireEvent.click(paymentTab!);
    expect(screen.getByText('Payment Distribution')).toBeTruthy();
  });

  it('switches to Doctor Income tab', () => {
    (useApiQuery as any).mockReturnValue({ data: mockDoctorIncome, isLoading: false });
    renderWithProviders(<BillingReportsPage />);
    fireEvent.click(screen.getByText('Doctor Income'));
    expect(screen.getByText('Dr. Hasan')).toBeTruthy();
    expect(screen.getByText('Medicine')).toBeTruthy();
  });

  it('shows loading skeleton when loading', () => {
    (useApiQuery as any).mockReturnValue({ data: undefined, isLoading: true });
    renderWithProviders(<BillingReportsPage />);
    const skeletons = document.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows date range picker for Daybook tab', () => {
    (useApiQuery as any).mockReturnValue({ data: mockDaybook, isLoading: false });
    renderWithProviders(<BillingReportsPage />);
    fireEvent.click(screen.getByText('Sales Daybook'));
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);
    expect(screen.getByText('to')).toBeTruthy();
  });

  it('displays user cash collection data', () => {
    (useApiQuery as any).mockReturnValue({
      data: { users: [{ employee_id: 1, employee_name: 'Nusrat', transaction_count: 25, cash_in: 50000, cash_out: 2000, net_cash: 48000 }] },
      isLoading: false,
    });
    renderWithProviders(<BillingReportsPage />);
    fireEvent.click(screen.getByText('User Cash'));
    expect(screen.getByText('Nusrat')).toBeTruthy();
    expect(screen.getByText('25')).toBeTruthy();
  });

  it('displays handover summary', () => {
    (useApiQuery as any).mockReturnValue({
      data: {
        handovers: [{ id: 1, handover_type: 'user', handover_amount: 10000, due_amount: 0, status: 'received', created_at: '2026-06-05', handover_by_name: 'Nusrat', handover_to_name: 'Manager', received_by_name: 'Admin' }],
        summary: { total_handovers: 1, total_amount: 10000, total_due: 0 },
      },
      isLoading: false,
    });
    renderWithProviders(<BillingReportsPage />);
    fireEvent.click(screen.getByText('Handover'));
    expect(screen.getByText('Total Handovers')).toBeTruthy();
    expect(screen.getByText('Total Amount')).toBeTruthy();
  });

  it('displays discount data with reason', () => {
    (useApiQuery as any).mockReturnValue({
      data: {
        discounts: [{ discount_reason: 'Doctor Reference', bill_count: 5, total_discount: 2000, total_amount: 30000, total_paid: 28000 }],
        summary: { total_bills: 5, total_discount: 2000 },
      },
      isLoading: false,
    });
    renderWithProviders(<BillingReportsPage />);
    const tabButtons = document.querySelectorAll('button');
    const discountTab = Array.from(tabButtons).find(b => b.textContent?.includes('Discount'));
    expect(discountTab).toBeTruthy();
    fireEvent.click(discountTab!);
    expect(screen.getByText('Discount by Reason')).toBeTruthy();
    expect(screen.getByText('Doctor Reference')).toBeTruthy();
  });
});
