export const DISCOUNT_REASONS = [
  'normal_hospital_discount',
  'poor_patient_charity',
  'doctor_commission_waiver',
  'management_approved',
  'reference_discount',
  'staff_benefit_discount',
  'vip_benefit_discount',
  'owner_benefit_discount',
  'shareholder_benefit_discount',
  'corporate_contract_discount',
  'campaign_discount',
  'rounding_adjustment',
] as const;

export type DiscountReason = typeof DISCOUNT_REASONS[number];

export type DiscountAllocationType =
  | 'hospital_discount'
  | 'charity_discount'
  | 'doctor_commission_waiver'
  | 'management_discount'
  | 'reference_discount'
  | 'staff_benefit_discount'
  | 'vip_benefit_discount'
  | 'owner_benefit_discount'
  | 'shareholder_benefit_discount'
  | 'corporate_contract_discount'
  | 'campaign_discount'
  | 'rounding_adjustment';

export type DiscountAllocationDraft = {
  allocationType: DiscountAllocationType;
  discountReason: DiscountReason;
  amount: number;
  percent: number | null;
  doctorId: number | null;
  referenceName: string | null;
  note: string | null;
};

export function roundMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

export function normalizeDiscountReason(value?: string | null): DiscountReason {
  return DISCOUNT_REASONS.includes(value as DiscountReason)
    ? value as DiscountReason
    : 'normal_hospital_discount';
}

export function discountAllocationTypeForReason(reason: DiscountReason): DiscountAllocationType {
  if (reason === 'poor_patient_charity') return 'charity_discount';
  if (reason === 'doctor_commission_waiver') return 'doctor_commission_waiver';
  if (reason === 'management_approved') return 'management_discount';
  if (reason === 'reference_discount') return 'reference_discount';
  if (reason === 'staff_benefit_discount') return 'staff_benefit_discount';
  if (reason === 'vip_benefit_discount') return 'vip_benefit_discount';
  if (reason === 'owner_benefit_discount') return 'owner_benefit_discount';
  if (reason === 'shareholder_benefit_discount') return 'shareholder_benefit_discount';
  if (reason === 'corporate_contract_discount') return 'corporate_contract_discount';
  if (reason === 'campaign_discount') return 'campaign_discount';
  if (reason === 'rounding_adjustment') return 'rounding_adjustment';
  return 'hospital_discount';
}

function percentOf(amount: number, gross?: number | null): number | null {
  const base = Number(gross ?? 0);
  if (!Number.isFinite(base) || base <= 0 || amount <= 0) return null;
  return roundMoney((amount / base) * 100);
}

export function splitDiscountAllocation(input: {
  billGrossAmount?: number | null;
  totalDiscount: number;
  discountReason?: string | null;
  discountDoctorId?: number | null;
  eligibleDoctorCommission?: number | null;
  requestedDoctorWaiverAmount?: number | null;
  referenceName?: string | null;
  note?: string | null;
}): {
  discountReason: DiscountReason;
  totalDiscount: number;
  doctorWaiverAmount: number;
  hospitalFundedAmount: number;
  allocations: DiscountAllocationDraft[];
  warnings: string[];
} {
  const reason = normalizeDiscountReason(input.discountReason);
  const totalDiscount = Math.max(0, roundMoney(input.totalDiscount));
  const warnings: string[] = [];
  if (totalDiscount <= 0) {
    return { discountReason: reason, totalDiscount: 0, doctorWaiverAmount: 0, hospitalFundedAmount: 0, allocations: [], warnings };
  }

  const mk = (
    allocationType: DiscountAllocationType,
    amount: number,
    doctorId: number | null = null,
    note = input.note,
    discountReason: DiscountReason = reason,
  ): DiscountAllocationDraft | null => {
    const rounded = roundMoney(amount);
    if (rounded <= 0) return null;
    return {
      allocationType,
      discountReason,
      amount: rounded,
      percent: percentOf(rounded, input.billGrossAmount),
      doctorId,
      referenceName: input.referenceName?.trim() || null,
      note: note?.trim() || null,
    };
  };

  if (reason !== 'doctor_commission_waiver') {
    const row = mk(discountAllocationTypeForReason(reason), totalDiscount);
    return {
      discountReason: reason,
      totalDiscount,
      doctorWaiverAmount: 0,
      hospitalFundedAmount: totalDiscount,
      allocations: row ? [row] : [],
      warnings,
    };
  }

  const eligible = Math.max(0, roundMoney(input.eligibleDoctorCommission));
  const requested = Math.max(0, roundMoney(input.requestedDoctorWaiverAmount ?? totalDiscount));
  const doctorWaiverAmount = Math.min(totalDiscount, requested, eligible);
  const hospitalFundedAmount = roundMoney(totalDiscount - doctorWaiverAmount);
  const allocations = [
    mk('doctor_commission_waiver', doctorWaiverAmount, input.discountDoctorId ? Number(input.discountDoctorId) : null),
    mk('hospital_discount', hospitalFundedAmount, null, hospitalFundedAmount > 0
      ? [input.note?.trim(), 'Doctor waiver exceeded eligible commission; excess funded by hospital.'].filter(Boolean).join(' ')
      : input.note, 'normal_hospital_discount'),
  ].filter((row): row is DiscountAllocationDraft => Boolean(row));

  if (doctorWaiverAmount < Math.min(totalDiscount, requested)) {
    warnings.push('Doctor waiver was capped by eligible commission; remaining discount is hospital-funded.');
  }

  return { discountReason: reason, totalDiscount, doctorWaiverAmount, hospitalFundedAmount, allocations, warnings };
}

export function applyDoctorCommissionWaiver(input: {
  earnedCommissionAmount: number;
  requestedWaiverAmount?: number | null;
}) {
  const earnedCommissionAmount = Math.max(0, roundMoney(input.earnedCommissionAmount));
  const requestedWaiverAmount = Math.max(0, roundMoney(input.requestedWaiverAmount));
  const doctorWaiverAmount = Math.min(earnedCommissionAmount, requestedWaiverAmount);
  return {
    earnedCommissionAmount,
    doctorWaiverAmount,
    payableCommissionAmount: roundMoney(earnedCommissionAmount - doctorWaiverAmount),
    overflowWaiverAmount: roundMoney(Math.max(0, requestedWaiverAmount - doctorWaiverAmount)),
  };
}
