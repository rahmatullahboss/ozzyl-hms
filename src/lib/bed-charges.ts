/**
 * Bed charge calculator for HMS.
 * Tracks bed assignment history and calculates charges per stay segment.
 */

export interface BedChargeSegment {
  id: number;
  bedId: number;
  wardName: string | null;
  bedNumber: string | null;
  bedType: string | null;
  ratePerDay: number;
  startedOn: string;
  endedOn: string | null;
  days: number;
  chargeAmount: number;
}

export type BedChargeDayCountMode = 'calendar_day_inclusive' | 'rolling_24h';
export type BedChargePartialDayMode = 'full_day' | 'half_day' | 'no_charge';

export interface BedChargePolicy {
  dayCountMode: BedChargeDayCountMode;
  graceHours: number;
  partialDayMode: BedChargePartialDayMode;
  halfDayAfterHours: number;
  halfDayRatio: number;
  checkInHour: number;
  earlyCheckInGraceHours: number;
}

export const DEFAULT_BED_CHARGE_POLICY: BedChargePolicy = {
  // Hotel-style default: admitted 11:00, discharged next day by 14:00 = 1 day.
  dayCountMode: 'rolling_24h',
  graceHours: 3,
  partialDayMode: 'full_day',
  halfDayAfterHours: 0,
  halfDayRatio: 0.5,
  checkInHour: 11,
  earlyCheckInGraceHours: 2,
};

export const BED_CHARGE_POLICY_SETTING_KEYS = {
  dayCountMode: 'ipd_bed_charge_day_count_mode',
  graceHours: 'ipd_bed_charge_grace_hours',
  partialDayMode: 'ipd_bed_charge_partial_day_mode',
  halfDayAfterHours: 'ipd_bed_charge_half_day_after_hours',
  halfDayRatio: 'ipd_bed_charge_half_day_ratio',
  checkInHour: 'ipd_bed_charge_check_in_hour',
  earlyCheckInGraceHours: 'ipd_bed_charge_early_check_in_grace_hours',
} as const;

export interface PackageBedChargeInput {
  ratePerDay: number;
  startedOn: string;
  endedOn?: string | null;
  includedBedDays: number;
  extraBedRate: number;
  bedChargePolicy?: Partial<BedChargePolicy> | null;
}

export interface PackageBedChargeResult {
  days: number;
  chargeableDays: number;
  chargeAmount: number;
  includedDaysUsed: number;
  extraDays: number;
}

export interface AdmissionPackageBillingInput {
  packageInfo?: {
    totalPrice?: number | null;
    packageType?: string | null;
    includedBedDays?: number | null;
    extraBedRate?: number | null;
  } | null;
  provisionalTotal: number;
  beds: Array<{
    id?: number | string | null;
    ratePerDay: number;
    startedOn: string;
    endedOn?: string | null;
    data?: Record<string, unknown>;
  }>;
  bedChargePolicy?: Partial<BedChargePolicy> | null;
}

export interface AdmissionPackageBillingResult {
  provisionalTotal: number;
  packageTotal: number;
  bedTotal: number;
  grandTotal: number;
  bedChargeSegments: Array<Record<string, unknown> & {
    days: number;
    chargeable_days: number;
    charge_amount: number;
    included_days_used: number;
    extra_days: number;
  }>;
}

export function bedChargePolicyFromSettings(settings: Record<string, unknown>): BedChargePolicy {
  return normalizeBedChargePolicy({
    dayCountMode: settings[BED_CHARGE_POLICY_SETTING_KEYS.dayCountMode] as BedChargeDayCountMode | undefined,
    graceHours: Number(settings[BED_CHARGE_POLICY_SETTING_KEYS.graceHours] ?? DEFAULT_BED_CHARGE_POLICY.graceHours),
    partialDayMode: settings[BED_CHARGE_POLICY_SETTING_KEYS.partialDayMode] as BedChargePartialDayMode | undefined,
    halfDayAfterHours: Number(settings[BED_CHARGE_POLICY_SETTING_KEYS.halfDayAfterHours] ?? DEFAULT_BED_CHARGE_POLICY.halfDayAfterHours),
    halfDayRatio: Number(settings[BED_CHARGE_POLICY_SETTING_KEYS.halfDayRatio] ?? DEFAULT_BED_CHARGE_POLICY.halfDayRatio),
    checkInHour: Number(settings[BED_CHARGE_POLICY_SETTING_KEYS.checkInHour] ?? DEFAULT_BED_CHARGE_POLICY.checkInHour),
    earlyCheckInGraceHours: Number(settings[BED_CHARGE_POLICY_SETTING_KEYS.earlyCheckInGraceHours] ?? DEFAULT_BED_CHARGE_POLICY.earlyCheckInGraceHours),
  });
}

export async function loadBedChargePolicy(db: Pick<D1Database, 'prepare'>, tenantId: string): Promise<BedChargePolicy> {
  const keys = Object.values(BED_CHARGE_POLICY_SETTING_KEYS);
  const placeholders = keys.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT key, value FROM settings WHERE tenant_id = ? AND key IN (${placeholders})`,
  ).bind(tenantId, ...keys).all<{ key: string; value: string }>();
  const settings: Record<string, string> = {};
  for (const row of results ?? []) settings[row.key] = row.value;
  return bedChargePolicyFromSettings(settings);
}

export function normalizeBedChargePolicy(policy?: Partial<BedChargePolicy> | null): BedChargePolicy {
  const requestedDayCountMode = policy?.dayCountMode ?? DEFAULT_BED_CHARGE_POLICY.dayCountMode;
  const dayCountMode = requestedDayCountMode === 'rolling_24h'
    ? 'rolling_24h'
    : 'calendar_day_inclusive';
  const requestedPartialDayMode = policy?.partialDayMode ?? DEFAULT_BED_CHARGE_POLICY.partialDayMode;
  const partialDayMode = requestedPartialDayMode === 'half_day' || requestedPartialDayMode === 'no_charge'
    ? requestedPartialDayMode
    : 'full_day';
  const graceHours = Math.max(0, Math.min(24, Number(policy?.graceHours ?? DEFAULT_BED_CHARGE_POLICY.graceHours) || 0));
  const halfDayAfterHours = Math.max(0, Math.min(24, Number(policy?.halfDayAfterHours ?? DEFAULT_BED_CHARGE_POLICY.halfDayAfterHours) || 0));
  const halfDayRatio = Math.max(0, Math.min(1, Number(policy?.halfDayRatio ?? DEFAULT_BED_CHARGE_POLICY.halfDayRatio) || 0.5));
  const checkInHour = Math.max(0, Math.min(23.99, Number(policy?.checkInHour ?? DEFAULT_BED_CHARGE_POLICY.checkInHour) || 0));
  const earlyCheckInGraceHours = Math.max(0, Math.min(24, Number(policy?.earlyCheckInGraceHours ?? DEFAULT_BED_CHARGE_POLICY.earlyCheckInGraceHours) || 0));
  return { dayCountMode, graceHours, partialDayMode, halfDayAfterHours, halfDayRatio, checkInHour, earlyCheckInGraceHours };
}

function roundBillingDays(value: number): number {
  return Math.round(value * 100) / 100;
}

function applyEarlyCheckInGrace(start: Date, policy: BedChargePolicy): Date {
  if (policy.earlyCheckInGraceHours <= 0) return start;
  const checkIn = new Date(start.getTime());
  const hour = Math.floor(policy.checkInHour);
  const minute = Math.round((policy.checkInHour - hour) * 60);
  checkIn.setHours(hour, minute, 0, 0);
  const earlyHours = (checkIn.getTime() - start.getTime()) / (1000 * 60 * 60);
  if (earlyHours > 0 && earlyHours <= policy.earlyCheckInGraceHours) return checkIn;
  return start;
}

function calculateRolling24hBedDays(start: Date, end: Date, policy: BedChargePolicy): number {
  const elapsedHours = Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60));
  if (elapsedHours <= 24 + policy.graceHours) return 1;

  const fullDays = Math.max(1, Math.floor(elapsedHours / 24));
  const remainderHours = elapsedHours - fullDays * 24;
  if (remainderHours <= policy.graceHours) return fullDays;

  if (policy.partialDayMode === 'no_charge') return fullDays;
  if (policy.partialDayMode === 'half_day' && remainderHours <= policy.graceHours + policy.halfDayAfterHours) {
    return roundBillingDays(fullDays + policy.halfDayRatio);
  }
  return fullDays + 1;
}

/**
 * Calculate billable bed days between two dates.
 * Default keeps the legacy calendar-day inclusive behavior.
 * rolling_24h mode supports hotel-style 24h billing with grace/half-day rules.
 */
export function calculateBedDays(
  startedOn: string,
  endedOn?: string | null,
  bedChargePolicy?: Partial<BedChargePolicy> | null,
): number {
  const start = new Date(startedOn);
  const end = endedOn ? new Date(endedOn) : new Date();
  const policy = normalizeBedChargePolicy(bedChargePolicy);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  if (policy.dayCountMode === 'rolling_24h') {
    return Math.max(1, calculateRolling24hBedDays(applyEarlyCheckInGrace(start, policy), end, policy));
  }

  // Reset to midnight for pure day counting (use UTC methods to avoid timezone issues)
  const startMidnight = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endMidnight = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

  const diffMs = endMidnight - startMidnight;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Minimum 1 day (even if admitted and discharged same day)
  return Math.max(1, diffDays + 1);
}

/**
 * Recalculate bed charges for a single patient_bed_infos row.
 * Returns { days, chargeAmount }
 */
export function recalculateBedCharge(
  ratePerDay: number,
  startedOn: string,
  endedOn?: string | null,
  bedChargePolicy?: Partial<BedChargePolicy> | null,
): { days: number; chargeAmount: number } {
  const days = calculateBedDays(startedOn, endedOn, bedChargePolicy);
  const chargeAmount = Math.round(days * ratePerDay * 100) / 100;
  return { days, chargeAmount };
}

/**
 * Build SQL to recalculate all unbilled bed charges for an admission.
 * This updates patient_bed_infos in-place.
 */
export function buildRecalculateBedChargesSQL(
  tenantId: string,
  admissionId: number,
): { sql: string; params: (string | number)[] } {
  return {
    sql: `
      UPDATE patient_bed_infos
      SET
        days = MAX(1, CAST((julianday(COALESCE(ended_on, datetime('now', '+6 hours'))) - julianday(started_on)) AS INTEGER) + 1),
        charge_amount = rate_per_day * MAX(1, CAST((julianday(COALESCE(ended_on, datetime('now', '+6 hours'))) - julianday(started_on)) AS INTEGER) + 1)
      WHERE tenant_id = ? AND admission_id = ? AND is_billed = 0
    `,
    params: [tenantId, admissionId],
  };
}

/**
 * Calculate bed charge with package-aware bed billing logic.
 *
 * Rules:
 * - If includedBedDays > 0, the package covers up to that many bed days
 * - Days beyond includedBedDays are charged at extraBedRate when configured
 * - If includedBedDays is 0, all days are charged at the selected bed/cabin rate
 */
export function calculatePackageBedCharge(input: PackageBedChargeInput): PackageBedChargeResult {
  const { ratePerDay, startedOn, endedOn, includedBedDays, extraBedRate, bedChargePolicy } = input;
  const days = calculateBedDays(startedOn, endedOn, bedChargePolicy);
  const normalizedIncludedDays = Math.max(0, Math.floor(Number(includedBedDays || 0)));
  const includedDaysUsed = Math.min(days, normalizedIncludedDays);
  const extraDays = Math.max(0, days - normalizedIncludedDays);
  const chargeRate = Number(extraBedRate || 0) > 0 ? Number(extraBedRate) : ratePerDay;

  if (normalizedIncludedDays <= 0) {
    return {
      days,
      chargeableDays: days,
      chargeAmount: days * ratePerDay,
      includedDaysUsed: 0,
      extraDays: days,
    };
  }

  return {
    days,
    chargeableDays: extraDays,
    chargeAmount: extraDays * chargeRate,
    includedDaysUsed,
    extraDays,
  };
}

export function calculateAdmissionPackageBilling(input: AdmissionPackageBillingInput): AdmissionPackageBillingResult {
  const packageInfo = input.packageInfo ?? null;
  const packageType = String(packageInfo?.packageType ?? 'regular');
  const packageTotal = packageInfo ? Number(packageInfo.totalPrice ?? 0) : 0;
  const includedBedDays = packageType === 'package_included_days'
    ? Number(packageInfo?.includedBedDays ?? 0)
    : 0;
  const extraBedRate = Number(packageInfo?.extraBedRate ?? 0);

  const bedChargeSegments: AdmissionPackageBillingResult['bedChargeSegments'] = [];
  let bedTotal = 0;

  for (const bed of input.beds) {
    const ratePerDay = Number(bed.ratePerDay || 0);
    let result: PackageBedChargeResult;

    if (packageType === 'package_included_days') {
      result = calculatePackageBedCharge({
        ratePerDay,
        startedOn: bed.startedOn,
        endedOn: bed.endedOn,
        includedBedDays,
        extraBedRate,
        bedChargePolicy: input.bedChargePolicy,
      });
    } else {
      const billingRate = packageType === 'package_plus_bed' && extraBedRate > 0
        ? extraBedRate
        : ratePerDay;
      const standard = recalculateBedCharge(billingRate, bed.startedOn, bed.endedOn, input.bedChargePolicy);
      result = {
        days: standard.days,
        chargeableDays: standard.days,
        chargeAmount: standard.chargeAmount,
        includedDaysUsed: 0,
        extraDays: standard.days,
      };
    }

    bedChargeSegments.push({
      ...(bed.data ?? {}),
      id: bed.id ?? bed.data?.id,
      days: result.days,
      chargeable_days: result.chargeableDays,
      charge_amount: result.chargeAmount,
      amount: result.chargeAmount,
      included_days_used: result.includedDaysUsed,
      extra_days: result.extraDays,
    });
    bedTotal += result.chargeAmount;
  }

  const provisionalTotal = Number(input.provisionalTotal || 0);
  return {
    provisionalTotal,
    packageTotal,
    bedTotal,
    grandTotal: provisionalTotal + packageTotal + bedTotal,
    bedChargeSegments,
  };
}
