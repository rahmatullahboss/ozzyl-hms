import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DiscountAllocationEditor, {
  appendDiscountAllocationWithRemaining,
  createAllocationsForSource,
  createDefaultDiscountAllocation,
  createDefaultDiscountAllocations,
  getDiscountAllocationPayload,
  getRemainingDiscountAmount,
  resolveDoctorWaiverPreviewStatus,
  suggestDiscountSource,
  type DiscountAllocationRow,
} from './DiscountAllocationEditor';

describe('DiscountAllocationEditor helpers', () => {
  it('uses the Bangladesh taka symbol in billing copy', () => {
    const source = readFileSync('src/components/reception/DiscountAllocationEditor.tsx', 'utf8');
    expect(source).toContain('৳');
    expect(source).not.toContain('₱');
    expect(source).not.toContain('✱');
  });

  it('suggests a benefit source when the patient has an eligible scheme', () => {
    expect(suggestDiscountSource({
      patientBenefitEligibility: {
        eligible: true,
        allocationReason: 'staff_benefit_discount',
      },
    })).toBe('staff_benefit_discount');
  });

  it('does not suggest doctor waiver until the user explicitly selects it', () => {
    expect(suggestDiscountSource({ selectedDoctorId: 10, doctorAvailableWaiverAmount: 800 })).toBe('normal_hospital_discount');
    expect(suggestDiscountSource({ selectedDoctorId: 10, doctorAvailableWaiverAmount: 0 })).toBe('normal_hospital_discount');
  });

  it('creates one default allocation row with the full benefit discount', () => {
    const row = createDefaultDiscountAllocation(500, {
      patientBenefitEligibility: {
        eligible: true,
        allocationReason: 'vip_benefit_discount',
      },
    });
    expect(row.amount).toBe('500');
    expect(row.reason).toBe('vip_benefit_discount');
  });

  it('uses only the entered discount from doctor commission when eligible commission is higher', () => {
    const result = createAllocationsForSource(200, 'doctor_commission_waiver', {
      selectedDoctorId: 7,
      doctorAvailableWaiverAmount: 250,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ reason: 'doctor_commission_waiver', amount: '200', doctorId: 7 });
  });

  it('splits doctor waiver at the eligible doctor amount and keeps the remainder as hospital discount', () => {
    const result = createAllocationsForSource(500, 'doctor_commission_waiver', {
      selectedDoctorId: 7,
      doctorAvailableWaiverAmount: 200,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ reason: 'doctor_commission_waiver', amount: '200', doctorId: 7 });
    expect(result[1]).toMatchObject({ reason: 'normal_hospital_discount', amount: '300' });
  });

  it('does not auto-select doctor waiver as the default allocation source', () => {
    const result = createDefaultDiscountAllocations(500, {
      selectedDoctorId: 7,
      doctorAvailableWaiverAmount: 200,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ reason: 'normal_hospital_discount', amount: '500' });
  });

  it('keeps doctor waiver selected when no eligible capacity is available', () => {
    const result = createAllocationsForSource(500, 'doctor_commission_waiver', {
      selectedDoctorId: 7,
      doctorAvailableWaiverAmount: 0,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ reason: 'doctor_commission_waiver', amount: '', doctorId: 7 });
    expect(result[1]).toMatchObject({ reason: 'normal_hospital_discount', amount: '500' });
  });

  it('does not temporarily classify the discount as hospital-funded while preview is loading', () => {
    const result = createAllocationsForSource(500, 'doctor_commission_waiver', {
      selectedDoctorId: 7,
      doctorAvailableWaiverAmount: 0,
      doctorWaiverLoading: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ reason: 'doctor_commission_waiver', amount: '', doctorId: 7 });
  });

  it('does not classify the discount as hospital-funded when doctor waiver verification fails', () => {
    const result = createAllocationsForSource(500, 'doctor_commission_waiver', {
      selectedDoctorId: 7,
      doctorAvailableWaiverAmount: 0,
      doctorWaiverPreviewFailed: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ reason: 'doctor_commission_waiver', amount: '', doctorId: 7 });
  });

  it('prioritizes eligible scheme source over normal default allocation', () => {
    const result = createDefaultDiscountAllocations(500, {
      selectedDoctorId: 7,
      doctorAvailableWaiverAmount: 200,
      patientBenefitEligibility: { eligible: true, allocationReason: 'vip_benefit_discount' },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ reason: 'vip_benefit_discount', amount: '500' });
  });

  it('auto-fills a newly appended row with the remaining amount', () => {
    const rows: DiscountAllocationRow[] = [
      { id: 'one', reason: 'normal_hospital_discount', amount: '200' },
    ];
    const result = appendDiscountAllocationWithRemaining(rows, 500, {
      patientBenefitEligibility: { eligible: true, allocationReason: 'staff_benefit_discount' },
    });
    expect(result).toHaveLength(2);
    expect(result[1].amount).toBe('300');
    expect(result[1].reason).toBe('staff_benefit_discount');
  });

  it('calculates remaining amount while excluding a row for Use remaining', () => {
    const rows: DiscountAllocationRow[] = [
      { id: 'one', reason: 'normal_hospital_discount', amount: '200' },
      { id: 'two', reason: 'management_approved', amount: '50' },
    ];
    expect(getRemainingDiscountAmount(rows, 500, 'two')).toBe(300);
  });

  it('keeps simple mode backward-compatible as a hospital discount', () => {
    expect(getDiscountAllocationPayload(125, false, [])).toEqual([
      { reason: 'normal_hospital_discount', amount: 125 },
    ]);
  });

  it('treats a selected but not-yet-requested doctor waiver preview as pending', () => {
    expect(resolveDoctorWaiverPreviewStatus({
      hasDoctorWaiverAllocation: true,
      previewKey: 'doctor-7-bill-a',
      verifiedPreviewKey: null,
      mutationPending: false,
      mutationFailed: false,
    })).toEqual({ pending: true, failed: false, verified: false, paymentBlocked: true });
  });

  it('accepts only the preview verified for the current bill signature', () => {
    expect(resolveDoctorWaiverPreviewStatus({
      hasDoctorWaiverAllocation: true,
      previewKey: 'doctor-7-bill-b',
      verifiedPreviewKey: 'doctor-7-bill-a',
      mutationPending: false,
      mutationFailed: false,
    })).toEqual({ pending: true, failed: false, verified: false, paymentBlocked: true });

    expect(resolveDoctorWaiverPreviewStatus({
      hasDoctorWaiverAllocation: true,
      previewKey: 'doctor-7-bill-b',
      verifiedPreviewKey: 'doctor-7-bill-b',
      mutationPending: false,
      mutationFailed: false,
    })).toEqual({ pending: false, failed: false, verified: true, paymentBlocked: false });
  });

  it('blocks payment when doctor waiver verification is missing or failed', () => {
    expect(resolveDoctorWaiverPreviewStatus({
      hasDoctorWaiverAllocation: true,
      previewKey: null,
      verifiedPreviewKey: null,
      mutationPending: false,
      mutationFailed: false,
    })).toEqual({ pending: false, failed: false, verified: false, paymentBlocked: true });

    expect(resolveDoctorWaiverPreviewStatus({
      hasDoctorWaiverAllocation: true,
      previewKey: 'doctor-7-bill-c',
      verifiedPreviewKey: null,
      mutationPending: false,
      mutationFailed: true,
    })).toEqual({ pending: false, failed: true, verified: false, paymentBlocked: true });
  });
});

describe('DiscountAllocationEditor quick sources', () => {
  it('shows a loading state instead of a false no-commission warning', () => {
    render(
      <DiscountAllocationEditor
        totalDiscount={200}
        enabled
        rows={[{ id: 'waiver', reason: 'doctor_commission_waiver', amount: '', doctorId: 7 }]}
        onEnabledChange={vi.fn()}
        onRowsChange={vi.fn()}
        context={{ selectedDoctorId: 7, doctorAvailableWaiverAmount: 0, doctorWaiverLoading: true }}
      />,
    );

    expect(screen.getByText(/Checking the selected doctor’s eligible commission/)).toBeInTheDocument();
    expect(screen.queryByText(/No eligible doctor commission was found/)).not.toBeInTheDocument();
  });

  it('shows a verification error instead of silently treating a failed preview as hospital-funded', () => {
    render(
      <DiscountAllocationEditor
        totalDiscount={200}
        enabled
        rows={[{ id: 'waiver', reason: 'doctor_commission_waiver', amount: '', doctorId: 7 }]}
        onEnabledChange={vi.fn()}
        onRowsChange={vi.fn()}
        context={{ selectedDoctorId: 7, doctorAvailableWaiverAmount: 0, doctorWaiverPreviewFailed: true }}
      />,
    );

    expect(screen.getByText(/Could not verify the selected doctor’s eligible commission/)).toBeInTheDocument();
    expect(screen.queryByText(/No eligible doctor commission was found/)).not.toBeInTheDocument();
  });

  it('moves a selected doctor waiver back to Hospital when the eligible commission drops to zero', () => {
    const onRowsChange = vi.fn();
    const rows = createAllocationsForSource(200, 'doctor_commission_waiver', {
      selectedDoctorId: 7,
      doctorAvailableWaiverAmount: 200,
    });
    const { rerender } = render(
      <DiscountAllocationEditor
        totalDiscount={200}
        enabled
        rows={rows}
        onEnabledChange={vi.fn()}
        onRowsChange={onRowsChange}
        context={{ selectedDoctorId: 7, doctorAvailableWaiverAmount: 200 }}
      />,
    );

    expect(onRowsChange).not.toHaveBeenCalled();

    rerender(
      <DiscountAllocationEditor
        totalDiscount={200}
        enabled
        rows={rows}
        onEnabledChange={vi.fn()}
        onRowsChange={onRowsChange}
        context={{ selectedDoctorId: 7, doctorAvailableWaiverAmount: 0 }}
      />,
    );

    expect(onRowsChange).toHaveBeenCalledWith([
      expect.objectContaining({ reason: 'doctor_commission_waiver', amount: '', doctorId: 7 }),
      expect.objectContaining({ reason: 'normal_hospital_discount', amount: '200' }),
    ]);
  });

  it('keeps Hospital and Doctor waiver visible and applies doctor waiver in one click', async () => {
    const user = userEvent.setup();
    const onEnabledChange = vi.fn();
    const onRowsChange = vi.fn();
    const onQuickSourceSelected = vi.fn();

    render(
      <DiscountAllocationEditor
        totalDiscount={200}
        enabled={false}
        rows={[]}
        onEnabledChange={onEnabledChange}
        onRowsChange={onRowsChange}
        onQuickSourceSelected={onQuickSourceSelected}
        context={{ selectedDoctorId: 7, doctorAvailableWaiverAmount: 250 }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Hospital' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Doctor waiver' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advanced / Split' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Doctor waiver' }));

    expect(onEnabledChange).toHaveBeenCalledWith(true);
    expect(onRowsChange).toHaveBeenCalledTimes(1);
    expect(onRowsChange.mock.calls[0][0]).toEqual([
      expect.objectContaining({ reason: 'doctor_commission_waiver', amount: '200', doctorId: 7 }),
    ]);
    expect(onQuickSourceSelected).toHaveBeenCalledWith('doctor_commission_waiver');
  });

  it('replaces the full doctor-waiver split when Management is selected', async () => {
    const user = userEvent.setup();
    const onRowsChange = vi.fn();
    const rows = createAllocationsForSource(150, 'doctor_commission_waiver', {
      selectedDoctorId: 7,
      doctorAvailableWaiverAmount: 87.5,
    });

    render(
      <DiscountAllocationEditor
        totalDiscount={150}
        enabled
        rows={rows}
        onEnabledChange={vi.fn()}
        onRowsChange={onRowsChange}
        context={{ selectedDoctorId: 7, doctorAvailableWaiverAmount: 87.5 }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Management' }));

    expect(onRowsChange).toHaveBeenCalledTimes(1);
    expect(onRowsChange.mock.calls[0][0]).toEqual([
      expect.objectContaining({ reason: 'management_approved', amount: '150', doctorId: null }),
    ]);
  });
});
