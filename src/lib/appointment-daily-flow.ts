export const APPOINTMENT_TYPES = [
  'new_patient',
  'old_patient',
  'follow_up',
  'report_show',
  'free_visit',
  'discounted_visit',
  'emergency',
] as const;

export type AppointmentType = typeof APPOINTMENT_TYPES[number];

export type AppointmentBillingStatus = 'unpaid' | 'no_charge';

export type AppointmentChargeInput = {
  baseFee: number;
  configuredFee?: number | null;
  appointmentType?: string | null;
  discountAmount?: number | null;
};

export type AppointmentCharge = {
  appointmentType: AppointmentType;
  originalFee: number;
  discountAmount: number;
  finalFee: number;
  billingStatus: AppointmentBillingStatus;
};

export function normalizeAppointmentType(value: unknown): AppointmentType {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'old' || raw === 'old_patient' || raw === 'returning_patient') return 'old_patient';
  if (raw === 'followup' || raw === 'follow_up') return 'follow_up';
  if (raw === 'report' || raw === 'report_show') return 'report_show';
  if (raw === 'free' || raw === 'free_visit') return 'free_visit';
  if (raw === 'discount' || raw === 'discounted' || raw === 'discounted_visit') return 'discounted_visit';
  if (raw === 'emergency' || raw === 'er') return 'emergency';
  return 'new_patient';
}

function normalizeMoney(value: unknown): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount);
}

export function calculateAppointmentCharge(input: AppointmentChargeInput): AppointmentCharge {
  const appointmentType = normalizeAppointmentType(input.appointmentType);
  const baseFee = normalizeMoney(input.baseFee);
  const configuredFee = input.configuredFee === null || input.configuredFee === undefined
    ? null
    : normalizeMoney(input.configuredFee);

  let originalFee = configuredFee ?? baseFee;
  if (appointmentType === 'report_show' && configuredFee === null) {
    originalFee = 0;
  }

  let discountAmount = normalizeMoney(input.discountAmount);
  if (appointmentType === 'free_visit') {
    discountAmount = originalFee;
  } else if (appointmentType !== 'discounted_visit') {
    discountAmount = Math.min(discountAmount, originalFee);
  }

  const finalFee = appointmentType === 'free_visit'
    ? 0
    : Math.max(0, originalFee - Math.min(discountAmount, originalFee));

  return {
    appointmentType,
    originalFee,
    discountAmount: Math.min(discountAmount, originalFee),
    finalFee,
    billingStatus: finalFee > 0 ? 'unpaid' : 'no_charge',
  };
}

export function appointmentTypeToVisitType(appointmentType: AppointmentType): 'opd' | 'followup' | 'emergency' {
  if (appointmentType === 'emergency') return 'emergency';
  return appointmentType === 'old_patient' || appointmentType === 'follow_up' || appointmentType === 'report_show'
    ? 'followup'
    : 'opd';
}
