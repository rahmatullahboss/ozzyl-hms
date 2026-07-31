export type DoctorCommissionWaiverPolicy = 'full_earned' | 'protected_floor' | 'no_doctor_waiver';
export type DoctorCommissionRateType = 'percent' | 'flat';

const WAIVER_POLICIES: readonly DoctorCommissionWaiverPolicy[] = [
  'full_earned',
  'protected_floor',
  'no_doctor_waiver',
];

function roundMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function nonNegativeMoney(value: unknown): number {
  return Math.max(0, roundMoney(value));
}

function normalizeBasisPoints(value: unknown): number {
  const parsed = Math.max(0, Number(value ?? 0));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed <= 100 ? parsed * 100 : parsed);
}

export function normalizeDoctorCommissionWaiverPolicy(value: unknown): DoctorCommissionWaiverPolicy {
  return WAIVER_POLICIES.includes(value as DoctorCommissionWaiverPolicy)
    ? value as DoctorCommissionWaiverPolicy
    : 'full_earned';
}

export function normalizeDoctorCommissionWaiverConfiguration(input: {
  rateType: DoctorCommissionRateType;
  commissionRateValue: number;
  waiverPolicy?: DoctorCommissionWaiverPolicy | string | null;
  protectedRate?: number | null;
  protectedRateBps?: number | null;
  protectedFlatAmount?: number | null;
}): {
  waiverPolicy: DoctorCommissionWaiverPolicy;
  protectedRateBps: number;
  protectedFlatAmount: number;
} {
  const waiverPolicy = normalizeDoctorCommissionWaiverPolicy(input.waiverPolicy);
  if (waiverPolicy !== 'protected_floor') {
    return { waiverPolicy, protectedRateBps: 0, protectedFlatAmount: 0 };
  }

  if (input.rateType === 'percent') {
    const commissionRateBps = normalizeBasisPoints(input.commissionRateValue);
    const protectedRateBps = input.protectedRateBps == null
      ? normalizeBasisPoints(input.protectedRate)
      : Math.max(0, Math.round(Number(input.protectedRateBps) || 0));
    if (protectedRateBps > commissionRateBps) {
      throw new RangeError('Protected commission rate cannot exceed the commission rate');
    }
    return { waiverPolicy, protectedRateBps, protectedFlatAmount: 0 };
  }

  const commissionFlatAmount = nonNegativeMoney(input.commissionRateValue);
  const protectedFlatAmount = nonNegativeMoney(input.protectedFlatAmount);
  if (protectedFlatAmount > commissionFlatAmount) {
    throw new RangeError('Protected commission amount cannot exceed the flat commission');
  }
  return { waiverPolicy, protectedRateBps: 0, protectedFlatAmount };
}

export function calculateDoctorCommissionWaiver(input: {
  commissionBaseAmount: number;
  earnedCommissionAmount: number;
  rateType: DoctorCommissionRateType;
  commissionRateValue: number;
  waiverPolicy?: DoctorCommissionWaiverPolicy | string | null;
  protectedRateBps?: number | null;
  protectedFlatAmount?: number | null;
  requestedWaiverAmount?: number | null;
}): {
  earnedCommissionAmount: number;
  protectedCommissionAmount: number;
  maximumWaiverAmount: number;
  requestedWaiverAmount: number;
  doctorWaiverAmount: number;
  payableCommissionAmount: number;
  overflowWaiverAmount: number;
} {
  const earnedCommissionAmount = nonNegativeMoney(input.earnedCommissionAmount);
  const commissionBaseAmount = nonNegativeMoney(input.commissionBaseAmount);
  const requestedWaiverAmount = nonNegativeMoney(input.requestedWaiverAmount);
  const waiverPolicy = normalizeDoctorCommissionWaiverPolicy(input.waiverPolicy);

  let protectedCommissionAmount = 0;
  if (waiverPolicy === 'no_doctor_waiver') {
    protectedCommissionAmount = earnedCommissionAmount;
  } else if (waiverPolicy === 'protected_floor') {
    if (input.rateType === 'percent') {
      const protectedRateBps = Math.max(0, Math.round(Number(input.protectedRateBps ?? 0) || 0));
      protectedCommissionAmount = roundMoney((commissionBaseAmount * protectedRateBps) / 10_000);
    } else {
      protectedCommissionAmount = nonNegativeMoney(input.protectedFlatAmount);
    }
    protectedCommissionAmount = Math.min(earnedCommissionAmount, protectedCommissionAmount);
  }

  const maximumWaiverAmount = roundMoney(Math.max(0, earnedCommissionAmount - protectedCommissionAmount));
  const doctorWaiverAmount = roundMoney(Math.min(requestedWaiverAmount, maximumWaiverAmount));
  const payableCommissionAmount = roundMoney(earnedCommissionAmount - doctorWaiverAmount);
  const overflowWaiverAmount = roundMoney(Math.max(0, requestedWaiverAmount - doctorWaiverAmount));

  return {
    earnedCommissionAmount,
    protectedCommissionAmount: roundMoney(protectedCommissionAmount),
    maximumWaiverAmount,
    requestedWaiverAmount,
    doctorWaiverAmount,
    payableCommissionAmount,
    overflowWaiverAmount,
  };
}
