import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import DischargeModal from './DischargeModal';
import type { DischargeFinancialSummary } from '../../lib/ipdDischargeFinancial';

const mockMutate = vi.hoisted(() => vi.fn());
const mockApiPost = vi.hoisted(() => vi.fn());
const mockMutationOptions = vi.hoisted(() => ({ current: null as null | { onSuccess?: (data: any) => void } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: Record<string, unknown>) => opts?.defaultValue ?? _key,
  }),
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiMutation: (_method: string, _path: string, options: { onSuccess?: (data: any) => void }) => {
    mockMutationOptions.current = options;
    return { mutate: mockMutate, isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../../lib/apiClient', () => ({
  api: { post: mockApiPost },
  ApiClientError: class ApiClientError extends Error {},
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const admission = {
  admissionId: 100,
  admissionNo: 'ADM-001',
  patientName: 'Rahim Khan',
  patientId: 1,
};

const financial: DischargeFinancialSummary = {
  totalCharges: 1000,
  discountPercent: 0,
  afterDiscount: 1000,
  depositBalance: 1000,
  netPayable: 0,
  refundAmount: 0,
  otherOutstanding: 0,
  totalPayableBeforeClearance: 0,
  outstandingInvoices: [],
  inlineSettlementSupported: true,
  authorityMode: 'legacy',
  unresolvedServiceAmount: 0,
};

const externalDueFinancial = {
  otherOutstanding: 6200,
  totalPayableBeforeClearance: 6200,
  outstandingInvoices: [{
    invoiceNumber: 'LAB-0077',
    issuedAt: '2026-07-19T04:00:00.000Z',
    currencyCode: 'BDT',
    total: 6200,
    paid: 0,
    credited: 0,
    due: 6200,
    legacyBillId: 77,
    canonicalInvoicePublicId: null,
    admissionId: null,
    visitId: 50,
    sourceLabel: 'Laboratory / Test',
    categories: [{ code: 'laboratory', label: 'Laboratory / Test', amount: 6200 }],
  }],
};

function renderModal(financialOverrides: Partial<DischargeFinancialSummary> = {}) {
  return render(
    <DischargeModal
      admission={admission}
      financial={{ ...financial, ...financialOverrides }}
      onClose={vi.fn()}
    />,
  );
}

function completeCreditDischargeForm() {
  fireEvent.change(screen.getByLabelText(/Credit discharge reason/i), {
    target: { value: 'Guardian will pay after salary' },
  });
  fireEvent.change(screen.getByLabelText(/Expected payment date/i), {
    target: { value: '2026-07-25' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /higher authority approval/i }));
}

describe('DischargeModal', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockApiPost.mockReset();
    mockApiPost.mockResolvedValue({ success: true });
    mockMutationOptions.current = null;
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  it('requires a referral name before submitting fixed discounts above 20 percent', () => {
    renderModal();

    fireEvent.change(screen.getByLabelText(/ডিসকাউন্ট টাকা/i), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(/Refund reason/i), { target: { value: 'Returned to guardian' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Refund & Discharge/i }));

    expect(toast.error).toHaveBeenCalledWith('Discount referred by name is required when discount is above 20%.');
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('submits above-threshold fixed discounts when a referral name is provided', () => {
    renderModal();

    fireEvent.change(screen.getByLabelText(/ডিসকাউন্ট টাকা/i), { target: { value: '250' } });
    fireEvent.change(screen.getByPlaceholderText(/Required for discounts above 20%/i), {
      target: { value: 'Director Approval' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(/Refund reason/i), { target: { value: 'Returned to guardian' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Refund & Discharge/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      discount_amount: 250,
      discount_by_name: 'Director Approval',
    }));
    expect(mockMutate).toHaveBeenCalledWith(expect.not.objectContaining({
      admin_pin: expect.anything(),
    }));
  });

  it('does not render admin PIN for above-threshold discounts', () => {
    renderModal();

    fireEvent.change(screen.getByLabelText(/ডিসকাউন্ট টাকা/i), { target: { value: '250' } });

    expect(screen.queryByText(/Admin PIN/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Enter admin PIN/i)).not.toBeInTheDocument();
  });

  it('submits the default reason code', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /Complete Settlement & Discharge/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      reason_code: 'normal_hospital_discount',
    }));
  });

  it('reuses the same idempotency key when a settled discharge is retried from the same modal', () => {
    renderModal();

    const submit = screen.getByRole('button', { name: /Complete Settlement & Discharge/i });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(mockMutate).toHaveBeenCalledTimes(2);
    const firstKey = (mockMutate.mock.calls[0]?.[0] as { idempotencyKey?: string }).idempotencyKey;
    const secondKey = (mockMutate.mock.calls[1]?.[0] as { idempotencyKey?: string }).idempotencyKey;
    expect(firstKey).toMatch(/^ipd-discharge-settled-100-/);
    expect(secondKey).toBe(firstKey);
  });

  it('shows the doctor-source note panel only after choosing that reason', () => {
    renderModal();

    expect(screen.queryByPlaceholderText(/written on prescription/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Discount reason/i), { target: { value: 'doctor_commission_waiver' } });

    expect(screen.getByPlaceholderText(/written on prescription/i)).toBeInTheDocument();
  });

  it('keeps old amount fields while submitting source reason and note', () => {
    renderModal();

    fireEvent.change(screen.getByLabelText(/ডিসকাউন্ট টাকা/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Discount reason/i), { target: { value: 'doctor_commission_waiver' } });
    fireEvent.change(screen.getByPlaceholderText(/written on prescription/i), { target: { value: 'Doctor wrote it on prescription' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(/Refund reason/i), { target: { value: 'Returned to guardian' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Refund & Discharge/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      discount_amount: 100,
      reason_code: 'doctor_commission_waiver',
      remarks: expect.stringContaining('Doctor wrote it on prescription'),
    }));
  });

  it('blocks a deposit refund when the admission has no billable charge', () => {
    renderModal({ totalCharges: 0, afterDiscount: 0, depositBalance: 500 });

    expect(screen.getByText(/Add the missing charge before discharge/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirm Refund & Discharge/i }));

    expect(toast.error).toHaveBeenCalledWith('Deposit refund is blocked because bill charge is ৳0. Add the missing charge before discharge.');
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('allows a confirmed refund after a fully approved discount when gross charges exist', () => {
    renderModal({ totalCharges: 1000, afterDiscount: 1000, depositBalance: 1000 });

    fireEvent.change(screen.getByLabelText(/ডিসকাউন্ট টাকা/i), { target: { value: '1000' } });
    fireEvent.change(screen.getByPlaceholderText(/Required for discounts above 20%/i), {
      target: { value: 'Director Approval' },
    });

    expect(screen.queryByText(/Add the missing charge before discharge/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(/Refund reason/i), { target: { value: 'Returned to guardian' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Refund & Discharge/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      discount_amount: 1000,
      confirm_excess_deposit_refund: true,
      refund_note: 'Returned to guardian',
    }));
  });

  it('shows other invoice dues and never labels the patient ready', () => {
    renderModal(externalDueFinancial);

    expect(screen.getByText('LAB-0077')).toBeInTheDocument();
    expect(screen.getAllByText(/Laboratory \/ Test/).length).toBeGreaterThan(0);
    expect(screen.getByText(/৳6,200 Outstanding/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Ready$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Total payable before full clearance/i)).toBeInTheDocument();
  });

  it('requires explicit credit-discharge reason, date, and acknowledgement', () => {
    renderModal(externalDueFinancial);

    fireEvent.click(screen.getByRole('button', { name: /Discharge with Due/i }));
    expect(screen.getByLabelText(/Credit discharge reason/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Expected payment date/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Confirm Credit Discharge/i }));

    expect(toast.error).toHaveBeenCalledWith('Credit discharge reason is required.');
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('submits the executed-pending credit discharge acknowledgement', () => {
    renderModal(externalDueFinancial);

    fireEvent.click(screen.getByRole('button', { name: /Discharge with Due/i }));
    fireEvent.change(screen.getByLabelText(/Credit discharge reason/i), {
      target: { value: 'Guardian will pay after salary' },
    });
    fireEvent.change(screen.getByLabelText(/Expected payment date/i), {
      target: { value: '2026-07-25' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /higher authority approval/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm Credit Discharge/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      discharge_mode: 'credit_pending',
      credit_reason: 'Guardian will pay after salary',
      expected_payment_date: '2026-07-25',
      confirm_credit_discharge: true,
      idempotencyKey: expect.stringMatching(/^ipd-discharge-credit_pending-100-/),
    }));
  });

  it('announces credit approval pending instead of implying full settlement', () => {
    renderModal(externalDueFinancial);

    mockMutationOptions.current?.onSuccess?.({
      bill_id: 90,
      invoice_no: 'BL-000090',
      credit_approval_status: 'pending',
      approval_request_id: 501,
      total_outstanding: 6200,
    });

    expect(toast.success).toHaveBeenCalledWith('Patient discharged with ৳6,200 outstanding. Higher-authority approval is pending.');
  });

  it('collects the full mapped outstanding amount when the green CTA is clicked with a blank input', async () => {
    renderModal(externalDueFinancial);

    fireEvent.click(screen.getByRole('button', { name: /Collect ৳6,200 & Discharge/i }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/settlements', expect.objectContaining({
      patient_id: admission.patientId,
      bill_ids: [77],
      paid_amount: 6200,
      deposit_deducted: 0,
      discount_amount: 0,
    })));
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      discharge_mode: 'settled',
      paid_amount: 0,
    }));
  });

  it('does not reduce the green full-collection CTA when a smaller partial amount is entered', async () => {
    renderModal(externalDueFinancial);

    fireEvent.change(screen.getByLabelText(/Received Now/i), {
      target: { value: '2000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Collect ৳6,200 & Discharge/i }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/settlements', expect.objectContaining({
      paid_amount: 6200,
    })));
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      discharge_mode: 'settled',
      paid_amount: 0,
    }));
  });

  it('allocates partial credit collection to previous invoices before the current IPD bill', async () => {
    renderModal({
      totalCharges: 1500,
      afterDiscount: 1500,
      depositBalance: 1000,
      netPayable: 500,
      otherOutstanding: 1000,
      totalPayableBeforeClearance: 1500,
      outstandingInvoices: [{
        ...externalDueFinancial.outstandingInvoices[0],
        total: 1000,
        due: 1000,
      }],
    });

    fireEvent.change(screen.getByLabelText(/Received Now/i), {
      target: { value: '1200' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Discharge with Due/i }));
    completeCreditDischargeForm();
    fireEvent.click(screen.getByRole('button', { name: /Confirm Credit Discharge/i }));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/settlements', expect.objectContaining({
      bill_ids: [77],
      paid_amount: 1000,
    })));
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      discharge_mode: 'credit_pending',
      paid_amount: 200,
    }));
  });

  it('keeps the entire balance due when credit discharge has no partial collection', async () => {
    renderModal(externalDueFinancial);

    fireEvent.click(screen.getByRole('button', { name: /Discharge with Due/i }));
    completeCreditDischargeForm();
    fireEvent.click(screen.getByRole('button', { name: /Confirm Credit Discharge/i }));

    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      discharge_mode: 'credit_pending',
      paid_amount: 0,
    })));
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('rejects the credit path when the entered amount clears the full payable', () => {
    renderModal(externalDueFinancial);

    fireEvent.change(screen.getByLabelText(/Received Now/i), {
      target: { value: '6200' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Discharge with Due/i }));
    completeCreditDischargeForm();
    fireEvent.click(screen.getByRole('button', { name: /Confirm Credit Discharge/i }));

    expect(toast.error).toHaveBeenCalledWith('The entered amount clears the full payable. Use Collect & Discharge.');
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('keeps all footer actions in one non-wrapping row', () => {
    renderModal(externalDueFinancial);

    const footerActions = screen.getByTestId('discharge-footer-actions');
    expect(footerActions).toHaveClass('flex-nowrap');
    expect(within(footerActions).getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    expect(within(footerActions).getByRole('button', { name: /Discharge with Due/i })).toBeInTheDocument();
    expect(within(footerActions).getByRole('button', { name: /Collect ৳6,200 & Discharge/i })).toBeInTheDocument();
  });
});
