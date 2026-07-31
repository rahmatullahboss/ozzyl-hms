export type CommissionServiceType = 'lab_test' | 'consultation_fee' | 'referral' | 'procedure' | 'ipd_round';
export type CommissionIncentiveType = 'performer' | 'prescriber' | 'referrer';
export type CommissionWaiverPolicy = 'full_earned' | 'protected_floor' | 'no_doctor_waiver';

export interface DoctorCommissionRuleFormState {
  doctorId: string;
  serviceType: CommissionServiceType;
  labTestId: string;
  category: string;
  rateType: 'percent' | 'flat';
  rateValue: string;
  waiverPolicy: CommissionWaiverPolicy;
  protectedRate: string;
  protectedFlatAmount: string;
  incentiveType: CommissionIncentiveType;
  effectiveFrom: string;
  notes: string;
}

export interface EditableDoctorCommissionRule {
  doctor_id: number;
  service_type: CommissionServiceType;
  lab_test_id?: number | null;
  category?: string | null;
  rate_type: 'percent' | 'flat';
  rate_value: number;
  waiver_policy?: CommissionWaiverPolicy | null;
  protected_rate_bps?: number | null;
  protected_flat_amount?: number | null;
  incentive_type: CommissionIncentiveType;
  effective_from?: string | null;
  notes?: string | null;
}

export interface DoctorCommissionRulePayload {
  doctorId: number;
  serviceType: CommissionServiceType;
  labTestId?: number | null;
  category?: string | null;
  rateType: DoctorCommissionRuleFormState['rateType'];
  rateValue: number;
  waiverPolicy: CommissionWaiverPolicy;
  protectedRate?: number;
  protectedFlatAmount?: number;
  incentiveType: CommissionIncentiveType;
  effectiveFrom?: string | null;
  notes?: string | null;
}

export const DEFAULT_DOCTOR_COMMISSION_RULE_PRESET = 'lab_test:prescriber';

export function getInitialDoctorCommissionRuleForm(
  effectiveFrom = new Date().toISOString().split('T')[0],
): DoctorCommissionRuleFormState {
  return {
    doctorId: '',
    serviceType: 'lab_test',
    labTestId: '',
    category: '',
    rateType: 'percent',
    rateValue: '',
    waiverPolicy: 'full_earned',
    protectedRate: '',
    protectedFlatAmount: '',
    incentiveType: 'prescriber',
    effectiveFrom,
    notes: '',
  };
}

export function doctorCommissionRuleToForm(
  rule: EditableDoctorCommissionRule,
): DoctorCommissionRuleFormState {
  const waiverPolicy = rule.waiver_policy ?? 'full_earned';
  const normalizedRate = rule.rate_type === 'percent'
    ? Number(rule.rate_value ?? 0) / 100
    : Number(rule.rate_value ?? 0);

  return {
    doctorId: String(rule.doctor_id),
    serviceType: rule.service_type,
    labTestId: rule.lab_test_id == null ? '' : String(rule.lab_test_id),
    category: rule.category ?? '',
    rateType: rule.rate_type,
    rateValue: String(normalizedRate),
    waiverPolicy,
    protectedRate: waiverPolicy === 'protected_floor' && rule.rate_type === 'percent'
      ? String(Number(rule.protected_rate_bps ?? 0) / 100)
      : '',
    protectedFlatAmount: waiverPolicy === 'protected_floor' && rule.rate_type === 'flat'
      ? String(Number(rule.protected_flat_amount ?? 0))
      : '',
    incentiveType: rule.incentive_type,
    effectiveFrom: rule.effective_from ?? '',
    notes: rule.notes ?? '',
  };
}

export function buildDoctorCommissionRulePayload(
  form: DoctorCommissionRuleFormState,
  options: { forUpdate?: boolean } = {},
): DoctorCommissionRulePayload {
  const rawRate = Number(form.rateValue) || 0;
  const protectedValue = form.rateType === 'percent'
    ? Number(form.protectedRate) || 0
    : Number(form.protectedFlatAmount) || 0;
  const emptyValue = options.forUpdate ? null : undefined;

  return {
    doctorId: Number(form.doctorId),
    serviceType: form.serviceType,
    labTestId: form.serviceType === 'lab_test' && form.labTestId
      ? Number(form.labTestId)
      : emptyValue,
    category: form.category || emptyValue,
    rateType: form.rateType,
    rateValue: form.rateType === 'percent' ? Math.round(rawRate * 100) : Math.round(rawRate),
    waiverPolicy: form.waiverPolicy,
    protectedRate: form.rateType === 'percent' && form.waiverPolicy === 'protected_floor'
      ? protectedValue
      : undefined,
    protectedFlatAmount: form.rateType === 'flat' && form.waiverPolicy === 'protected_floor'
      ? protectedValue
      : undefined,
    incentiveType: form.incentiveType,
    effectiveFrom: form.effectiveFrom || emptyValue,
    notes: form.notes || emptyValue,
  };
}

export function applyDoctorCommissionRulePreset(
  form: DoctorCommissionRuleFormState,
  preset: string,
): DoctorCommissionRuleFormState {
  const [serviceType, incentiveType] = preset.split(':') as [CommissionServiceType, CommissionIncentiveType];

  return {
    ...form,
    serviceType,
    incentiveType,
    labTestId: serviceType === 'lab_test' ? form.labTestId : '',
    category: serviceType === 'lab_test' ? form.category : '',
  };
}

export function setDoctorCommissionRuleRateType(
  form: DoctorCommissionRuleFormState,
  rateType: DoctorCommissionRuleFormState['rateType'],
): DoctorCommissionRuleFormState {
  return {
    ...form,
    rateType,
    protectedRate: rateType === 'percent' ? form.protectedRate : '',
    protectedFlatAmount: rateType === 'flat' ? form.protectedFlatAmount : '',
  };
}

export function getMaximumDoctorWaiverValue(form: DoctorCommissionRuleFormState): number {
  const commissionValue = Math.max(0, Number(form.rateValue) || 0);
  if (form.waiverPolicy === 'no_doctor_waiver') return 0;
  if (form.waiverPolicy === 'full_earned') return commissionValue;
  const protectedValue = form.rateType === 'percent'
    ? Math.max(0, Number(form.protectedRate) || 0)
    : Math.max(0, Number(form.protectedFlatAmount) || 0);
  return Math.max(0, commissionValue - protectedValue);
}
