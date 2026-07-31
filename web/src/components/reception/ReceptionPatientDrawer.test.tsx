import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceptionPatientDrawer, { resolveTodayVisitReferringDoctorId } from './ReceptionPatientDrawer';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockInvalidateQueries = vi.fn();
const mockMutate = vi.fn();
const mockWindowOpen = vi.fn();

const mockUseApiQuery = vi.hoisted(() => vi.fn());
const mockUseApiMutation = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: (...args: unknown[]) => mockUseApiMutation(...args),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// ─── Test Data ────────────────────────────────────────────────────────────────

const PATIENT_CONTEXT = {
  patient: {
    id: 1,
    patient_code: 'P001',
    name: 'Rahim Khan',
    mobile: '01712345678',
    age: 45,
    gender: 'Male',
    address: 'Dhaka',
  },
  visits: [{ id: 10, doctor_id: 5, visit_no: 'V001', visit_type: 'opd', visit_date: '2026-05-21', status: 'open', doctor_name: 'Dr. Ahmed' }],
  bills: [
    { id: 1, invoice_no: 'BL-000001', total_amount: 500, paid_amount: 300, due: 200, status: 'partial', created_at: '2026-05-21T10:00:00' },
  ],
  dueBills: [
    { id: 1, invoice_no: 'BL-000001', total_amount: 500, paid_amount: 300, due: 200, status: 'partial', created_at: '2026-05-21T10:00:00' },
  ],
  activeAdmission: {
    id: 100,
    admission_no: 'ADM-001',
    status: 'admitted',
    ward_name: 'Ward A',
    bed_number: '5',
    doctor_name: 'Dr. Ahmed',
  },
  deposits: { balance: 5000, total_deposits: 10000, total_refunds: 3000, total_adjustments: 2000 },
  payments: [{ id: 1, receipt_no: 'RCP-001', amount: 300, payment_method: 'cash', payment_type: 'payment', date: '2026-05-21', created_at: '2026-05-21T10:00:00', invoice_no: 'BL-000001' }],
  depositLedger: [{ id: 1, deposit_receipt_no: 'DEP-001', amount: 10000, transaction_type: 'deposit', payment_method: 'cash', remarks: 'Advance', created_at: '2026-05-20T09:00:00' }],
  ipdPending: { admissionId: 100, provisionalTotal: 800, bedTotal: 1000, total: 1800, due: 0 },
  ipdBillingSummary: {
    admission_id: 100,
    running_total: 1800,
    settled_total: 233050,
    settled_cash_paid: 0,
    settled_deposit_used: 233050,
    deposit_total: 10000,
    deposit_used: 5000,
    deposit_balance: 5000,
    net_payable: 0,
    refund_available: 3200,
  },
  reports: [{ id: 1, order_no: 'ORD-001', status: 'pending', item_count: 3, ready_count: 1 }],
};

const SERVICES_DATA = {
  data: [
    { id: 1, item_name: 'CBC Test', item_code: 'CBC', department_name: 'Lab', price: 500, allow_multiple_qty: 1, allow_discount: 1 },
    { id: 2, item_name: 'X-Ray Chest', item_code: 'XRC', department_name: 'Radiology', price: 300, allow_multiple_qty: 1, allow_discount: 1 },
    { id: 3, item_name: 'Dressing', item_code: 'DRS', department_name: 'Nursing', price: 200, allow_multiple_qty: 1, allow_discount: 0 },
  ],
};

const DOCTORS_DATA = {
  doctors: [{ id: 5, name: 'Dr. Ahmed', specialty: 'Medicine' }],
};

const ACTIVE_COUNTER = {
  active: true,
  session: {
    id: 1,
    counterName: 'Counter 1',
    expectedCash: 5000,
    heldRefundCash: 300,
    availableCash: 4700,
  },
};

const REFUND_INVOICE_DATA = {
  bill: { id: 1, patient_id: 1, invoice_no: 'BL-000001', status: 'paid', total: 500, paid: 500 },
  items: [
    {
      id: 101,
      description: 'CBC Test',
      item_category: 'test',
      quantity: 1,
      returned_qty: 0,
      pending_qty: 0,
      available_qty: 1,
      refundable_unit_amount: 300,
      clinical_status: 'pending',
      eligible: true,
      block_reason: null,
    },
    {
      id: 102,
      description: 'LFT Test',
      item_category: 'test',
      quantity: 1,
      returned_qty: 0,
      pending_qty: 0,
      available_qty: 1,
      refundable_unit_amount: 200,
      clinical_status: 'verified',
      eligible: false,
      block_reason: 'Completed or verified services cannot be refunded',
    },
  ],
};

const IPD_PENDING_DATA = {
  items: [
    { id: 101, item_name: 'CBC Test', item_category: 'lab', department: 'Lab', unit_price: 500, quantity: 1, discount_percent: 0, discount_amount: 0, total_amount: 500, created_at: '2026-05-20', bill_status: 'provisional' },
    { id: 102, item_name: 'IV Fluid', item_category: 'procedure', department: 'Nursing', unit_price: 150, quantity: 2, discount_percent: 0, discount_amount: 0, total_amount: 300, created_at: '2026-05-21', bill_status: 'provisional' },
  ],
  bed_charges: {
    segments: [{ id: 1, ward_name: 'Ward A', bed_number: '5', bed_type: 'General', rate_per_day: 500, started_on: '2026-05-19', days: 2, charge_amount: 1000 }],
    bed_total: 1000,
  },
  summary: {
    provisional_total: 800,
    bed_total: 1000,
    grand_total: 1800,
    running_total: 1800,
    settled_total: 233050,
    settled_cash_paid: 0,
    settled_deposit_used: 233050,
    deposit_total: 10000,
    deposit_used: 5000,
    deposit_balance: 5000,
    net_payable: 0,
    refund_available: 3200,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupMocks(options?: {
  deposit?: number;
  noAdmission?: boolean;
  refundInvoiceLoading?: boolean;
  refundInvoiceData?: typeof REFUND_INVOICE_DATA;
}) {
  const contextData = {
    ...PATIENT_CONTEXT,
    deposits: { ...PATIENT_CONTEXT.deposits, balance: options?.deposit ?? 5000 },
    activeAdmission: options?.noAdmission ? null : PATIENT_CONTEXT.activeAdmission,
  };

  mockUseApiQuery.mockImplementation((_key: string[], url: string) => {
    if (url.includes('/context')) return { data: contextData, isLoading: false };
    if (url.includes('/service-items')) return { data: SERVICES_DATA, isFetching: false };
    if (url.includes('/doctors')) return { data: DOCTORS_DATA };
    if (url.includes('/sessions/active')) return { data: ACTIVE_COUNTER };
    if (url.includes('/credit-notes/invoice/')) {
      return options?.refundInvoiceLoading
        ? { data: undefined, isLoading: true }
        : { data: options?.refundInvoiceData ?? REFUND_INVOICE_DATA, isLoading: false };
    }
    if (url.includes('/ip-billing/pending')) return { data: IPD_PENDING_DATA, isLoading: false };
    return { data: undefined, isLoading: false };
  });

  mockUseApiMutation.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
  });
}

function renderDrawer(
  patientId: number | null = 1,
  options?: { onManageIpdBilling?: (admission: { patientId: number; admissionId: number }) => void },
) {
  return render(
    <MemoryRouter>
      <ReceptionPatientDrawer
        patientId={patientId}
        basePath="/h/demo-hospital/reception"
        onClose={vi.fn()}
        onManageIpdBilling={options?.onManageIpdBilling}
      />
    </MemoryRouter>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveTodayVisitReferringDoctorId', () => {
  it('does not select a doctor from a historical visit', () => {
    expect(resolveTodayVisitReferringDoctorId([
      { id: 1, doctor_id: 5, visit_date: '2026-07-24', status: 'open' },
    ], '2026-07-25')).toBe('');
  });

  it('does not select a doctor from a cancelled visit today', () => {
    expect(resolveTodayVisitReferringDoctorId([
      { id: 1, doctor_id: 5, visit_date: '2026-07-25', status: 'cancelled' },
    ], '2026-07-25')).toBe('');
  });

  it('selects the first valid doctor visit for today', () => {
    expect(resolveTodayVisitReferringDoctorId([
      { id: 1, doctor_id: null, visit_date: '2026-07-25', status: 'open' },
      { id: 2, doctor_id: 7, visit_date: '2026-07-25T09:30:00', status: 'open' },
      { id: 3, doctor_id: 8, visit_date: '2026-07-25', status: 'open' },
    ], '2026-07-25')).toBe(7);
  });
});

describe('ReceptionPatientDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'open', {
      writable: true,
      value: mockWindowOpen,
    });
    setupMocks();
  });

  // ── i18n Translation ──────────────────────────────────────────────────────

  describe('i18n translation', () => {
    it('uses translation keys instead of hardcoded English strings', () => {
      renderDrawer();
      expect(screen.getByText(/patientDrawer\.title|Patient context/)).toBeInTheDocument();
    });

    it('translates "Add bill" button', () => {
      renderDrawer();
      expect(screen.getByText(/btn\.addBill|Add bill/)).toBeInTheDocument();
    });

    it('translates "Deposit" button', () => {
      renderDrawer();
      const depositButtons = screen.getAllByText(/btn\.deposit|Deposit/i);
      expect(depositButtons.length).toBeGreaterThan(0);
    });

    it('translates "Recent bills" section header', () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/Overview/i));
      expect(screen.getByText(/patientDrawer\.recentBills|Recent bills/)).toBeInTheDocument();
    });

    it('translates "Active admission" section header in IPD tab', () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      expect(screen.getByText(/patientDrawer\.activeAdmission|Active Admission/)).toBeInTheDocument();
    });
  });

  // ── Compact Bill Items ────────────────────────────────────────────────────

  describe('compact bill items display', () => {
    it('shows compact single-line items in cart instead of expanded layout', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/btn\.addBill|Add bill/));

      await waitFor(() => {
        expect(screen.getByText('CBC Test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByText('CBC Test')[0]);

      await waitFor(() => {
        const qtyLabels = screen.queryAllByText('Qty');
        expect(qtyLabels.length).toBe(0);
      });
    });

    it('shows item name, price, quantity and total in a compact row', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/btn\.addBill|Add bill/));

      await waitFor(() => {
        expect(screen.getByText('CBC Test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByText('CBC Test')[0]);

      await waitFor(() => {
        const priceElements = screen.getAllByText(/৳500/);
        expect(priceElements.length).toBeGreaterThan(0);
      });
    });
  });

  // ── Discount at Total Level ───────────────────────────────────────────────

  describe('discount at total level', () => {
    it('wires drawer quick bill scheme benefit preview into billing-counter invoices', () => {
      const source = readFileSync('src/components/reception/ReceptionPatientDrawer.tsx', 'utf8');

      expect(source).toContain('/api/billing-master/apply-scheme-preview');
      expect(source).toContain('submitSchemeCheck');
      expect(source).toContain('applySchemeDiscount');
      expect(source).toContain('cartLinesWithGlobalDiscount().map');
      expect(source).toContain('schemeApplication: schemePreview?.eligible');
      expect(source).toContain("serviceCategory: schemePreview.service_category ?? 'patient_drawer_quick_bill'");
    });

    it('sends an explicit doctor-waiver allocation with previewed eligibility instead of treating it as management discount', () => {
      const source = readFileSync('src/components/reception/ReceptionPatientDrawer.tsx', 'utf8');

      expect(source).toContain("from './DiscountAllocationEditor'");
      expect(source).toContain('/api/discounts/doctor-waiver-preview');
      expect(source).toContain('doctorAvailableWaiverAmount');
      expect(source).toMatch(/setDoctorAvailableWaiverAmount\(Number\(preview\.maximumDoctorWaiverAmount/);
      expect(source).toContain('getDiscountAllocationPayload');
      expect(source).toContain('hasBalancedDiscountAllocations');
      expect(source).toContain('discountAllocations: schemePreview?.eligible');
      expect(source).toContain('selectedDoctorId: referringDoctorId ? Number(referringDoctorId) : null');
      expect(source).toContain('doctorWaiverLoading: doctorWaiverPreviewPending');
      expect(source).toContain('doctorWaiverPreviewFailed');
      expect(source).toContain('verifiedPreviewKey: doctorWaiverVerifiedPreviewKey');
      expect(source).toContain('const doctorWaiverPaymentBlocked = doctorWaiverPreviewStatus.paymentBlocked;');
      expect(source).toContain('Doctor waiver verification is still in progress.');
      expect(source).toContain('Doctor waiver could not be verified. Select Doctor waiver again to retry.');
      expect(source).toMatch(/disabled=\{invoiceMutation\.isPending \|\| doctorWaiverPaymentBlocked \|\| cart\.length === 0 \|\| !activeSession\}/);
      expect(source).toContain('disabled:cursor-not-allowed disabled:opacity-50');
      expect(source).toContain('totalDiscount: 0');
      expect(source).not.toContain('if (!referringDoctorId || totalDiscount <= 0 || cart.length === 0');
      expect(source).toContain('discountSourceIntent: schemePreview?.eligible && totalDiscount > 0');
      expect(source).toContain(': discountSourceIntent ?? undefined');
      expect(source).toContain('performerReserveAmount: doctorWaiverQuote?.performerReserveAmount');
      expect(source).toContain('protectedCommissionAmount: doctorWaiverQuote?.protectedCommissionAmount');
    });

    it('captures non-cash references for drawer due and quick-bill payments', () => {
      const source = readFileSync('src/components/reception/ReceptionPatientDrawer.tsx', 'utf8');

      expect(source).toContain("from '../../lib/paymentReference'");
      expect(source).toContain('const [billPaymentReference, setBillPaymentReference]');
      expect(source).toContain('const [duePaymentReference, setDuePaymentReference]');
      expect(source).toContain('externalTransactionId: normalizeExternalTransactionId(paymentMethod, cashPaidNow, billPaymentReference)');
      expect(source).toContain('externalTransactionId: normalizeExternalTransactionId(duePaymentMethod, Number(duePaymentAmount), duePaymentReference)');
    });

    it('does not carry cash or deposit settlement into a credit quick bill', () => {
      const source = readFileSync('src/components/reception/ReceptionPatientDrawer.tsx', 'utf8');

      expect(source).toContain("const depositApplied = billMode === 'credit'");
      expect(source).toContain('const handleBillModeChange =');
      expect(source).toMatch(/if \(mode === 'credit'\)[\s\S]*setPaidAmount\(''\)[\s\S]*setDepositDeducted\(''\)/);
      expect(source).toContain("onChange={(event) => handleBillModeChange(event.target.value as 'paid' | 'credit')}");
      expect(source).toMatch(/value=\{depositDeducted\}[\s\S]*disabled=\{billMode === 'credit'\}/);
      expect(source).toContain('paidAmount: cashPaidNow');
      expect(source).toContain('depositDeducted: depositApplied');
    });

    it('uses a stable invoice idempotency key until success or a definitive client error', () => {
      const source = readFileSync('src/components/reception/ReceptionPatientDrawer.tsx', 'utf8');

      expect(source).toContain("import { shouldRotateInvoiceAttemptKey } from '../../lib/invoiceIdempotency'");
      expect(source).toContain('const [invoiceAttemptKey, setInvoiceAttemptKey]');
      expect(source).toContain('idempotencyKey: invoiceAttemptKey');
      expect(source).not.toContain('idempotencyKey: `drawer-bill-${patient.id}-${crypto.randomUUID()}`');
      expect(source).toMatch(/onError: \(invoiceError\) => \{[\s\S]*if \(shouldRotateInvoiceAttemptKey\(invoiceError\)\)[\s\S]*setInvoiceAttemptKey/);
      expect(source).toContain('resetBillForm(true)');
    });

    it('retries a timed-out refund request with the same idempotency payload instead of leaving Sending active forever', () => {
      const source = readFileSync('src/components/reception/ReceptionPatientDrawer.tsx', 'utf8');

      expect(source).toContain('const refundRequestMutation = useApiMutation');
      expect(source).toContain('timeoutMs: 15_000');
      expect(source).toMatch(/retry:\s*\(failureCount, error\)\s*=>\s*failureCount < 1[\s\S]*isRetryableApiTransportError\(error\)/);
      expect(source).toContain('refundRequestMutation.mutate({');
      expect(source).toContain("const reviewRequestPending = actionMode === 'refundRequest'");
      expect(source).toContain('refundRequestMutation.isPending');
    });

    it('shows submitted refund requests with financially executed pending and final statuses', () => {
      const source = readFileSync('src/components/reception/ReceptionPatientDrawer.tsx', 'utf8');

      expect(source).toContain('data-testid="refund-request-history"');
      expect(source).toContain('data?.refundRequests');
      expect(source).toContain("const financiallyExecuted = request.executionStatus === 'succeeded'");
      expect(source).toContain("defaultValue: 'Refunded — approval pending'");
      expect(source).toContain("defaultValue: 'Refunded'");
    });

    it('submits payment void idempotently and refreshes all reversed financial views', () => {
      const source = readFileSync('src/components/reception/ReceptionPatientDrawer.tsx', 'utf8');

      expect(source).toContain('idempotencyKey: `payment-void-${paymentReviewTarget.id}-${crypto.randomUUID()}`');
      expect(source).toContain('res.executed');
      expect(source).toContain('Payment reversed and sent for admin review');
      expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['billing'] })");
      expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] })");
      expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] })");
      expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['bills', 'due'] })");
    });

    it('requires and sends an approving name for discounts above twenty percent', () => {
      const source = readFileSync('src/components/reception/ReceptionPatientDrawer.tsx', 'utf8');

      expect(source).toContain('const [discountByName, setDiscountByName]');
      expect(source).toContain('const requiresDiscountByName =');
      expect(source).toContain("Discount referred by name is required when discount is above 20%.");
      expect(source).toContain('discountByName: discountByName.trim() || undefined');
      expect(source).toContain('quantity: line.quantity');
    });

    it('has discount input in the totals section, not per item', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/btn\.addBill|Add bill/));

      await waitFor(() => {
        expect(screen.getByText('CBC Test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByText('CBC Test')[0]);

      const discountLabel = screen.getByText(/discount/i);
      expect(discountLabel).toBeInTheDocument();

      const allNumberInputs = document.querySelectorAll('input[type="number"]');
      expect(allNumberInputs.length).toBeLessThanOrEqual(4);
    });
  });

  // ── Auto Deposit Use ──────────────────────────────────────────────────────

  describe('auto deposit use', () => {
    it('auto-fills deposit use when deposit balance is available and items are added', async () => {
      setupMocks({ deposit: 5000 });
      renderDrawer();
      fireEvent.click(screen.getByText(/btn\.addBill|Add bill/));

      await waitFor(() => {
        expect(screen.getByText('CBC Test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByText('CBC Test')[0]);

      await waitFor(() => {
        const depositInput = screen.getByPlaceholderText(/available/i) as HTMLInputElement;
        expect(Number(depositInput.value)).toBeGreaterThan(0);
      });
    });

    it('allows receptionist to edit or zero out deposit use', async () => {
      setupMocks({ deposit: 5000 });
      renderDrawer();
      fireEvent.click(screen.getByText(/btn\.addBill|Add bill/));

      await waitFor(() => {
        expect(screen.getByText('CBC Test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByText('CBC Test')[0]);

      await waitFor(() => {
        const depositInput = screen.getByPlaceholderText(/available/i) as HTMLInputElement;
        expect(Number(depositInput.value)).toBeGreaterThan(0);
      });

      const depositInput = screen.getByPlaceholderText(/available/i);
      fireEvent.change(depositInput, { target: { value: '0' } });
      expect((depositInput as HTMLInputElement).value).toBe('0');
    });
  });

  // ── Default Paid Amount ───────────────────────────────────────────────────

  describe('default paid amount', () => {
    it('defaults paid amount to total payable amount (not just first service)', async () => {
      setupMocks({ deposit: 0 });
      renderDrawer();
      fireEvent.click(screen.getByText(/btn\.addBill|Add bill/));

      await waitFor(() => {
        expect(screen.getByText('CBC Test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByText('CBC Test')[0]);

      await waitFor(() => {
        const paidInput = screen.getByPlaceholderText(/500|payable/i) as HTMLInputElement;
        expect(Number(paidInput.value)).toBe(500);
      });
    });
  });

  // ── IPD Admissions Billing Actions ────────────────────────────────────────

  describe('IPD admissions billing actions', () => {
    it('renders drawer tabs', () => {
      renderDrawer();
      expect(screen.getByText(/Overview/i)).toBeInTheDocument();
      expect(screen.getByText(/OPD History/i)).toBeInTheDocument();
      expect(screen.getByText(/IPD & Admissions/i)).toBeInTheDocument();
      expect(screen.getByText(/Total Financials/i)).toBeInTheDocument();
    });

    it('shows IPD admissions financial summary and manage running bill shortcut', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));

      expect(screen.getByText(/Active Admission/i)).toBeInTheDocument();
      expect(screen.getByText(/Deposit received/i)).toBeInTheDocument();
      expect(screen.getByText(/Deposit used/i)).toBeInTheDocument();
      expect(screen.getByText(/Deposit balance/i)).toBeInTheDocument();
      expect(screen.getByText(/Running charges/i)).toBeInTheDocument();
      expect(screen.getByText(/Refund available/i)).toBeInTheDocument();
      expect(screen.getByText(/Manage Provisional Bill/i)).toBeInTheDocument();
      expect(screen.getByText(/1,800|1800/)).toBeInTheDocument();
    });

    it('shows total received deposits in the top financial snapshot, not remaining deposit balance', () => {
      renderDrawer();

      const totalDepositLabel = screen.getByText('মোট জমা');
      const totalDepositCard = totalDepositLabel.closest('div.rounded-lg');

      expect(totalDepositCard).not.toBeNull();
      expect(within(totalDepositCard as HTMLElement).getByText(/10,000/)).toBeInTheDocument();
      expect(within(totalDepositCard as HTMLElement).queryByText(/5,000/)).not.toBeInTheDocument();
    });

    it('formats the header wallet badge without leaking template placeholders', () => {
      renderDrawer();

      expect(screen.queryByText(/\{money/)).not.toBeInTheDocument();
      expect(screen.getByText(/বাকি আছে ৳200/)).toBeInTheDocument();
    });

    it('shows the unified IPD wallet numbers in the admission summary', () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));

      const admissionCard = screen.getByText(/Active Admission/i).closest('.rounded-lg');
      expect(admissionCard).not.toBeNull();
      expect(within(admissionCard as HTMLElement).getByText(/Deposit received/i)).toBeInTheDocument();
      expect(within(admissionCard as HTMLElement).getByText(/Deposit used/i)).toBeInTheDocument();
      expect(within(admissionCard as HTMLElement).getByText(/Deposit balance/i)).toBeInTheDocument();
      expect(within(admissionCard as HTMLElement).getByText(/Running charges/i)).toBeInTheDocument();
      expect(within(admissionCard as HTMLElement).getByText(/Refund available/i)).toBeInTheDocument();
      expect(within(admissionCard as HTMLElement).getByText(/10,000/)).toBeInTheDocument();
      expect(within(admissionCard as HTMLElement).getAllByText(/5,000/).length).toBeGreaterThan(0);
      expect(within(admissionCard as HTMLElement).getByText(/1,800/)).toBeInTheDocument();
      expect(within(admissionCard as HTMLElement).getByText(/3,200/)).toBeInTheDocument();
    });

    it('keeps manage provisional bill and discharge actions on one two-column row', () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));

      const actions = screen.getByTestId('ipd-admission-actions');
      expect(actions).toHaveClass('grid');
      expect(actions).toHaveClass('grid-cols-2');
      expect(within(actions).getByText(/manageProvisionalBill|Manage Provisional Bill/i)).toBeInTheDocument();
      expect(within(actions).getByText(/discharge|Discharge/i)).toBeInTheDocument();
    });

    it('shows Manage Provisional Bill button in IPD tab when patient has active admission', () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      expect(screen.getByText(/manageProvisionalBill|Manage Provisional Bill/i)).toBeInTheDocument();
    });

    it('opens the shared provisional billing workflow when Manage Provisional Bill is clicked', () => {
      const onManageIpdBilling = vi.fn();
      renderDrawer(1, { onManageIpdBilling });
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      fireEvent.click(screen.getByText(/manageProvisionalBill|Manage Provisional Bill/i));

      expect(onManageIpdBilling).toHaveBeenCalledWith({ patientId: 1, admissionId: 100 });
      expect(screen.queryByText(/ipdQuickBill|IPD Quick Bill/i)).not.toBeInTheDocument();
    });

    it('falls back to the full IPD billing page when no shared workflow callback is provided', () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      fireEvent.click(screen.getByText(/manageProvisionalBill|Manage Provisional Bill/i));

      expect(mockWindowOpen).toHaveBeenCalledWith('/h/demo-hospital/reception/ip-billing?admissionId=100', '_blank');
      expect(screen.queryByText(/ipdQuickBill|IPD Quick Bill/i)).not.toBeInTheDocument();
    });

    it('displays pending charges from IPD billing context without opening an inline quick bill', () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));

      expect(screen.getByText(/1,800|1800/)).toBeInTheDocument();
      expect(screen.queryByText(/ipdQuickBill|IPD Quick Bill/i)).not.toBeInTheDocument();
    });

    it('keeps current cost and total deposit visible in the IPD admission summary', () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));

      const admissionCard = screen.getByText(/Active Admission/i).closest('.rounded-lg');
      expect(admissionCard).not.toBeNull();
      expect(within(admissionCard as HTMLElement).getByText(/Deposit received/i)).toBeInTheDocument();
      expect(within(admissionCard as HTMLElement).getByText(/Running charges/i)).toBeInTheDocument();
      expect(within(admissionCard as HTMLElement).getByText(/10,000/)).toBeInTheDocument();
      expect(within(admissionCard as HTMLElement).getByText(/1,800|1800/)).toBeInTheDocument();
    });
  });

  // ── Discharge Section ─────────────────────────────────────────────────────

  describe('discharge section', () => {
    it('shows Discharge button in IPD tab when patient has active admission', () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      expect(screen.getByText(/discharge|Discharge/i)).toBeInTheDocument();
    });

    it('opens discharge section when Discharge button is clicked', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      fireEvent.click(screen.getByText(/discharge|Discharge/i));
      await waitFor(() => {
        expect(screen.getByTestId('discharge-modal')).toBeInTheDocument();
        const totalChargesElements = within(screen.getByTestId('discharge-modal')).queryAllByText(/Final Charges|Total Charges|totalCharges/i);
        expect(totalChargesElements.length).toBeGreaterThan(0);
      });
    });

    it('displays discharge settlement with separate deposit balance, applied amount, and refund', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      fireEvent.click(screen.getByText(/discharge|Discharge/i));
      await waitFor(() => {
        const modal = screen.getByTestId('discharge-modal');
        const chargeTexts = within(modal).queryAllByText(/1,800|1800/i);
        expect(chargeTexts.length).toBeGreaterThan(0);
        expect(within(modal).queryByText(/Advance Deposit/i)).not.toBeInTheDocument();
        expect(within(modal).getByText(/Deposit Balance Available/i)).toBeInTheDocument();
        expect(within(modal).getByText(/Deposit Applied to Bill/i)).toBeInTheDocument();
        expect(within(modal).queryAllByText(/Refund to Patient/i).length).toBeGreaterThan(0);
        expect(within(modal).getByText(/5,000/)).toBeInTheDocument();
        expect(within(modal).getAllByText(/3,200/).length).toBeGreaterThan(0);
      });
    });

    it('shows refund amount when deposit exceeds charges', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      fireEvent.click(screen.getByText(/discharge|Discharge/i));
      await waitFor(() => {
        const modal = screen.getByTestId('discharge-modal');
        const refundElements = within(modal).queryAllByText(/refund|3,200|3200|Refund Amount/i);
        expect(refundElements.length).toBeGreaterThan(0);
      });
    });

    it('shows clear refund instructions instead of payment change controls when deposit exceeds charges', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      fireEvent.click(screen.getByText(/discharge|Discharge/i));
      await waitFor(() => {
        const modal = screen.getByTestId('discharge-modal');
        expect(within(modal).getAllByText(/Refund to Patient/i).length).toBeGreaterThan(0);
        expect(within(modal).getByText(/Refund requires confirmation before discharge/i)).toBeInTheDocument();
        expect(within(modal).queryByText(/Received Now/i)).not.toBeInTheDocument();
        expect(within(modal).queryByText(/^Change$/i)).not.toBeInTheDocument();
        expect(within(modal).getAllByText(/3,200/).length).toBeGreaterThan(0);
      });
    });

    it('has confirm discharge button', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      fireEvent.click(screen.getByText(/discharge|Discharge/i));
      await waitFor(() => {
        const modal = screen.getByTestId('discharge-modal');
        expect(within(modal).getByRole('button', { name: /Confirm Refund & Discharge/i })).toBeInTheDocument();
      });
    });

    it('requests full deposit balance on final settlement when a refund is available', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      fireEvent.click(screen.getByText(/discharge|Discharge/i));

      await waitFor(() => {
        expect(screen.getByTestId('discharge-modal')).toBeInTheDocument();
      });

      const modal = screen.getByTestId('discharge-modal');
      fireEvent.click(within(modal).getByRole('checkbox', { name: /I confirm this cash refund/i }));
      fireEvent.change(within(modal).getByPlaceholderText(/Refund reason/i), { target: { value: 'Refund approved and received' } });
      fireEvent.click(within(modal).getByRole('button', { name: /Confirm Refund & Discharge/i }));

      expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
        admission_id: 100,
        deposit_deducted: 5000,
        paid_amount: 0,
      }));
    });

    it('does not show admin PIN input for discounts above 20 percent', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      fireEvent.click(screen.getByText(/discharge|Discharge/i));
      await waitFor(() => {
        expect(screen.getByTestId('discharge-modal')).toBeInTheDocument();
      });

      const modal = screen.getByTestId('discharge-modal');
      const discountInput = within(modal).getAllByPlaceholderText('0')[0];
      fireEvent.change(discountInput, { target: { value: '25' } });

      expect(within(modal).queryByText(/Admin PIN/i)).not.toBeInTheDocument();
      expect(within(modal).queryByPlaceholderText(/Enter admin PIN/i)).not.toBeInTheDocument();
    });

    it('allows entering a fixed discount amount and sends it to discharge settlement', async () => {
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      fireEvent.click(screen.getByText(/discharge|Discharge/i));
      await waitFor(() => {
        expect(screen.getByTestId('discharge-modal')).toBeInTheDocument();
      });

      const modal = screen.getByTestId('discharge-modal');
      fireEvent.change(within(modal).getByLabelText(/ডিসকাউন্ট টাকা/i), { target: { value: '250' } });
      fireEvent.click(within(modal).getByRole('checkbox', { name: /I confirm this cash refund/i }));
      fireEvent.change(within(modal).getByPlaceholderText(/Refund reason/i), { target: { value: 'Discounted refund settlement approved' } });
      fireEvent.click(within(modal).getByRole('button', { name: /Confirm Refund & Discharge/i }));

      expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
        discount_amount: 250,
      }));
    });
  });

  // ── Item-based refund request ──────────────────────────────────────────────

  describe('item-based refund request', () => {
    it('selects eligible items, blocks verified tests, and submits a cash-hold request', async () => {
      renderDrawer();
      fireEvent.click(screen.getByRole('button', { name: /Overview/i }));
      fireEvent.click(screen.getByRole('button', { name: /রিফান্ড অনুরোধ|refund request/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Item-based refund/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /Item-based refund/i }));

      expect(screen.getByText('CBC Test')).toBeInTheDocument();
      expect(screen.getByText('LFT Test')).toBeInTheDocument();
      expect(screen.getByText(/Completed or verified services cannot be refunded/i)).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /Select LFT Test for refund/i })).toBeDisabled();
      expect(screen.getByText(/Available cash/i).parentElement).toHaveTextContent('4,700');

      fireEvent.click(screen.getByRole('checkbox', { name: /Select CBC Test for refund/i }));
      expect(screen.getByText(/Refund total/i).parentElement).toHaveTextContent('300');
      expect(screen.getByText(/Cash to hold/i).parentElement).toHaveTextContent('300');
      expect(screen.getByText(/Receivable reduction/i).parentElement).toHaveTextContent('0');
      fireEvent.change(screen.getByPlaceholderText(/service was not provided/i), {
        target: { value: 'CBC was not performed' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Send review request/i }));

      expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
        type: 'refund',
        entityId: 1,
        idempotencyKey: expect.stringMatching(/^refund-request-1-/),
        requestData: expect.objectContaining({
          refundKind: 'item_partial_refund',
          paymentMethod: 'cash',
          reason: 'CBC was not performed',
          items: [{ invoiceItemId: 101, returnQuantity: 1 }],
        }),
      }));
    });

    it('submits a manual amount-based partial refund with automatic adjustable item allocation', async () => {
      renderDrawer();
      fireEvent.click(screen.getByRole('button', { name: /Overview/i }));
      fireEvent.click(screen.getByRole('button', { name: /রিফান্ড অনুরোধ|refund request/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Amount-based refund/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /Amount-based refund/i }));

      const amountInput = screen.getByRole('spinbutton', { name: /Refund amount/i });
      fireEvent.change(amountInput, { target: { value: '125.50' } });
      expect(screen.getByText(/Refund total/i).parentElement).toHaveTextContent('125.5');
      expect(screen.getByText(/Cash to hold/i).parentElement).toHaveTextContent('125.5');
      expect(screen.getByText('Automatic item allocation')).toBeInTheDocument();
      expect(screen.getByText('CBC Test')).toBeInTheDocument();
      expect(screen.getByRole('spinbutton', { name: /Refund allocation for CBC Test/i })).toHaveValue(125.5);

      fireEvent.change(screen.getByPlaceholderText(/service was not provided/i), {
        target: { value: 'Management approved a partial cash refund' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Send review request/i }));

      const payload = mockMutate.mock.calls.at(-1)?.[0] as {
        requestData: Record<string, unknown>;
      };
      expect(payload).toMatchObject({
        type: 'refund',
        entityId: 1,
        idempotencyKey: expect.stringMatching(/^refund-request-1-/),
        requestData: {
          refundKind: 'amount_partial_refund',
          paymentMethod: 'cash',
          requestedRefundAmount: 125.5,
          allocationMode: 'auto_proportional_adjustable',
          allocationVersion: 1,
          reason: 'Management approved a partial cash refund',
          items: [{
            invoiceItemId: 101,
            allocatedRefundAmount: 125.5,
            allocationSource: 'auto',
          }],
        },
      });
    });

    it('lets the requester adjust automatic item allocations while preserving the refund total', async () => {
      setupMocks({
        refundInvoiceData: {
          ...REFUND_INVOICE_DATA,
          items: REFUND_INVOICE_DATA.items.map((item) => item.id === 102
            ? {
                ...item,
                clinical_status: 'pending',
                eligible: true,
                block_reason: null,
              }
            : item),
        },
      });
      renderDrawer();
      fireEvent.click(screen.getByRole('button', { name: /Overview/i }));
      fireEvent.click(screen.getByRole('button', { name: /রিফান্ড অনুরোধ|refund request/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /Amount-based refund/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Amount-based refund/i }));
      fireEvent.change(screen.getByRole('spinbutton', { name: /Refund amount/i }), {
        target: { value: '100' },
      });

      const cbcAllocation = screen.getByRole('spinbutton', { name: /Refund allocation for CBC Test/i });
      const lftAllocation = screen.getByRole('spinbutton', { name: /Refund allocation for LFT Test/i });
      expect(cbcAllocation).toHaveValue(60);
      expect(lftAllocation).toHaveValue(40);

      fireEvent.change(cbcAllocation, { target: { value: '50' } });
      fireEvent.change(lftAllocation, { target: { value: '50' } });
      expect(screen.getByText(/Allocated total/i).parentElement).toHaveTextContent('100');

      fireEvent.change(screen.getByPlaceholderText(/service was not provided/i), {
        target: { value: 'Split amount across two tests' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Send review request/i }));

      const payload = mockMutate.mock.calls.at(-1)?.[0] as {
        requestData: { items: Array<Record<string, unknown>> };
      };
      expect(payload.requestData.items).toEqual([
        { invoiceItemId: 101, allocatedRefundAmount: 50, allocationSource: 'requester_adjusted' },
        { invoiceItemId: 102, allocatedRefundAmount: 50, allocationSource: 'requester_adjusted' },
      ]);
    });

    it('waits for canonical invoice details before enabling an amount refund request', async () => {
      setupMocks({ refundInvoiceLoading: true });
      renderDrawer();
      fireEvent.click(screen.getByRole('button', { name: /Overview/i }));
      fireEvent.click(screen.getByRole('button', { name: /রিফান্ড অনুরোধ|refund request/i }));
      fireEvent.click(screen.getByRole('button', { name: /Amount-based refund/i }));
      fireEvent.change(screen.getByRole('spinbutton', { name: /Refund amount/i }), {
        target: { value: '125' },
      });
      fireEvent.change(screen.getByPlaceholderText(/service was not provided/i), {
        target: { value: 'Management approved a partial cash refund' },
      });

      expect(screen.getByRole('button', { name: /Send review request/i })).toBeDisabled();
      expect(mockMutate).not.toHaveBeenCalled();
    });

    it('requires the full-refund flow when the manual amount reaches the current bill total', async () => {
      renderDrawer();
      fireEvent.click(screen.getByRole('button', { name: /Overview/i }));
      fireEvent.click(screen.getByRole('button', { name: /রিফান্ড অনুরোধ|refund request/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Amount-based refund/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /Amount-based refund/i }));
      fireEvent.change(screen.getByRole('spinbutton', { name: /Refund amount/i }), {
        target: { value: '500' },
      });
      fireEvent.change(screen.getByPlaceholderText(/service was not provided/i), {
        target: { value: 'Management approved a partial cash refund' },
      });

      expect(screen.getByText(/must be less than.*500.*Full refund/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Send review request/i })).toBeDisabled();
    });
  });

  // ── No Active Admission ───────────────────────────────────────────────────

  describe('no active admission', () => {
    it('hides Manage Provisional Bill and Discharge buttons in IPD tab when no active admission', () => {
      setupMocks({ noAdmission: true });
      renderDrawer();
      fireEvent.click(screen.getByText(/IPD & Admissions/i));
      expect(screen.queryByText(/manageProvisionalBill|Manage Provisional Bill/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/discharge/i)).not.toBeInTheDocument();
    });
  });
});
