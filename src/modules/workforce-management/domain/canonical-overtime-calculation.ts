/**
 * HR-02 / v1: pure, auditable OT eligibility and money quote.
 * No attendance, payroll, approval or database writes occur here.
 * Work intervals must be HR-05 reconciled and approval evidence authoritative.
 */
export type OvertimeDayType = 'regular' | 'weekly_holiday' | 'public_holiday';
export type OvertimeDecisionStatus = 'pending' | 'approved' | 'rejected';

export interface OvertimeInterval {
  sourceId: string;
  startUtc: string;
  endUtc: string;
}
export interface OvertimePolicySnapshot {
  tenantId: string;
  policyId: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  dailyThresholdMinutes: number;
  weeklyThresholdMinutes: number | null;
  minimumEligibleMinutes: number;
  maximumMinutesPerDay: number | null;
  multiplierBasisPoints: Record<OvertimeDayType, number>;
}
export interface OvertimeSalarySnapshot {
  tenantId: string;
  salaryRecordId: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  baseMonthlyMinor: number;
  standardMonthlyMinutes: number;
}
export interface OvertimeDayFact {
  businessDate: string;
  dayType: OvertimeDayType;
  policyId: string;
  policyVersion: number;
  attendanceProjectionVersion: number;
  /** Reconciled, non-overlapping IN/OUT intervals; a complete night shift stays on its starting business date. */
  workIntervals: readonly OvertimeInterval[];
  /** Reconciled unpaid breaks, fully contained in a single work interval. */
  breakIntervals: readonly OvertimeInterval[];
  decision: {
    status: OvertimeDecisionStatus;
    decisionId: string | null;
    version: number | null;
    approvedMinutes: number;
  };
}
export interface CanonicalOvertimeInputV1 {
  tenantId: string;
  memberPublicId: string;
  periodStart: string;
  periodEnd: string;
  /** Include all seven business dates for each week when weekly thresholds are configured. */
  days: readonly OvertimeDayFact[];
  policies: readonly OvertimePolicySnapshot[];
  salaries: readonly OvertimeSalarySnapshot[];
}
export interface CanonicalOvertimeDayResultV1 {
  businessDate: string;
  dayType: OvertimeDayType;
  workedMinutes: number;
  scheduledThresholdMinutes: number;
  dailyEligibleMinutes: number;
  weeklyExtraMinutes: number;
  eligibleMinutes: number;
  approvedMinutes: number;
  payableMinutes: number;
  amountMinor: number;
  attendanceProjectionVersion: number;
  policyId: string;
  policyVersion: number;
  multiplierBasisPoints: number;
  salaryRecordId: string | null;
  salaryVersion: number | null;
  standardMonthlyMinutes: number | null;
  decisionId: string | null;
  decisionVersion: number | null;
  decisionStatus: OvertimeDecisionStatus;
}
export interface CanonicalOvertimeResultV1 {
  contractVersion: 'hr-02/v1';
  tenantId: string;
  memberPublicId: string;
  periodStart: string;
  periodEnd: string;
  workedMinutes: number;
  eligibleMinutes: number;
  approvedMinutes: number;
  payableMinutes: number;
  amountMinor: number;
  lines: CanonicalOvertimeDayResultV1[];
}

function safeInteger(value: number, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
  return value;
}
function dateValue(value: string, label: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must be YYYY-MM-DD`);
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${label} is not a valid calendar date`);
  }
  return millis;
}
function timestamp(value: string, label: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new RangeError(`${label} must be an explicit UTC ISO timestamp`);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new RangeError(`${label} is not a valid timestamp`);
  return millis;
}
function assertScope(tenantId: string, actual: string, label: string) {
  if (actual !== tenantId) throw new RangeError(`${label} tenant mismatch`);
}
function applicable(date: string, from: string, to: string | null): boolean {
  return from <= date && (to == null || date <= to);
}
function overlap(a: {start: number; end: number}, b: {start: number; end: number}) {
  return a.start < b.end && b.start < a.end;
}
function intervals(
  values: readonly OvertimeInterval[],
  label: string,
  seen: Set<string>,
): Array<{start: number; end: number; sourceId: string}> {
  return values.map((value, index) => {
    if (!value.sourceId || seen.has(value.sourceId)) throw new RangeError(`Duplicate or empty ${label} source ID`);
    seen.add(value.sourceId);
    const start = timestamp(value.startUtc, `${label}[${index}].startUtc`);
    const end = timestamp(value.endUtc, `${label}[${index}].endUtc`);
    if (end <= start || end - start > 24 * 60 * 60_000 || (end - start) % 60_000 !== 0) {
      throw new RangeError(`${label} interval must have positive exact whole minutes, at most 24 hours`);
    }
    return { start, end, sourceId: value.sourceId };
  }).sort((a, b) => a.start - b.start);
}
function checkedMinutes(work: readonly OvertimeInterval[], breaks: readonly OvertimeInterval[], seen: Set<string>, globalWork: Array<{start: number; end: number}>) {
  const worked = intervals(work, 'work', seen);
  const rested = intervals(breaks, 'break', seen);
  for (let i = 0; i < worked.length; i++) {
    if (i && overlap(worked[i-1], worked[i])) throw new RangeError('Overlapping work intervals');
    for (const other of globalWork) if (overlap(other, worked[i])) throw new RangeError('Work interval counted on multiple business dates');
    globalWork.push(worked[i]);
  }
  for (let i = 0; i < rested.length; i++) {
    if (i && overlap(rested[i-1], rested[i])) throw new RangeError('Overlapping break intervals');
    if (!worked.some(w => w.start <= rested[i].start && w.end >= rested[i].end)) {
      throw new RangeError('Break must be fully inside one work interval');
    }
  }
  return worked.reduce((sum, w) => sum + (w.end - w.start) / 60_000, 0)
    - rested.reduce((sum, b) => sum + (b.end - b.start) / 60_000, 0);
}
/** Central daily eligibility primitive. The legacy approval API also uses this calculation. */
export function calculateDailyEligibleMinutes(input: {
  workedMinutes: number;
  scheduledMinutes: number;
  thresholdMinutes: number;
  minimumEligibleMinutes: number;
  maximumMinutesPerDay: number | null;
}): number {
  const worked = safeInteger(input.workedMinutes, 'workedMinutes');
  const scheduled = safeInteger(input.scheduledMinutes, 'scheduledMinutes');
  const threshold = safeInteger(input.thresholdMinutes, 'thresholdMinutes');
  const minimum = safeInteger(input.minimumEligibleMinutes, 'minimumEligibleMinutes');
  const maximum = input.maximumMinutesPerDay == null ? null : safeInteger(input.maximumMinutesPerDay, 'maximumMinutesPerDay');
  let eligible = Math.max(0, worked - Math.max(scheduled, threshold));
  if (eligible < minimum) eligible = 0;
  return maximum == null ? eligible : Math.min(maximum, eligible);
}
function roundedMoney(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n || numerator < 0n) throw new RangeError('Invalid OT monetary ratio');
  const result = (numerator * 2n + denominator) / (2n * denominator);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('OT money exceeds safe integer');
  return Number(result);
}
function mondayKey(date: string): string {
  const millis = dateValue(date, 'businessDate');
  const daysBack = (new Date(millis).getUTCDay() + 6) % 7;
  return new Date(millis - daysBack * 86_400_000).toISOString().slice(0, 10);
}
function matchSalary(date: string, tenantId: string, salaries: readonly OvertimeSalarySnapshot[]): OvertimeSalarySnapshot {
  const matches = salaries.filter(s => applicable(date, s.effectiveFrom, s.effectiveTo));
  if (matches.length !== 1) throw new RangeError('Exactly one effective salary record is required for payable OT');
  assertScope(tenantId, matches[0].tenantId, 'salary');
  return matches[0];
}

export function calculateCanonicalOvertimeV1(input: CanonicalOvertimeInputV1): CanonicalOvertimeResultV1 {
  if (!input.tenantId || !input.memberPublicId) throw new RangeError('Tenant and member identity are required');
  const start = dateValue(input.periodStart, 'periodStart');
  const end = dateValue(input.periodEnd, 'periodEnd');
  if (start > end) throw new RangeError('Invalid payroll period');
  for (const policy of input.policies) {
    assertScope(input.tenantId, policy.tenantId, 'policy');
    dateValue(policy.effectiveFrom, 'policy.effectiveFrom');
    if (policy.effectiveTo) dateValue(policy.effectiveTo, 'policy.effectiveTo');
    safeInteger(policy.version, 'policy.version', 1);
    safeInteger(policy.dailyThresholdMinutes, 'dailyThresholdMinutes');
    if (policy.weeklyThresholdMinutes != null) safeInteger(policy.weeklyThresholdMinutes, 'weeklyThresholdMinutes');
    safeInteger(policy.minimumEligibleMinutes, 'minimumEligibleMinutes');
    if (policy.maximumMinutesPerDay != null) safeInteger(policy.maximumMinutesPerDay, 'maximumMinutesPerDay');
    for (const type of ['regular','weekly_holiday','public_holiday'] as const) {
      safeInteger(policy.multiplierBasisPoints[type], `multiplierBasisPoints.${type}`, 1);
    }
  }
  for (const salary of input.salaries) {
    assertScope(input.tenantId, salary.tenantId, 'salary');
    dateValue(salary.effectiveFrom, 'salary.effectiveFrom');
    if (salary.effectiveTo) dateValue(salary.effectiveTo, 'salary.effectiveTo');
    safeInteger(salary.version, 'salary.version', 1);
    safeInteger(salary.baseMonthlyMinor, 'baseMonthlyMinor');
    safeInteger(salary.standardMonthlyMinutes, 'standardMonthlyMinutes', 1);
  }
  const ordered = [...input.days].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const seenDates = new Set<string>();
  const seenSources = new Set<string>();
  const seenDecisions = new Set<string>();
  const globalWork: Array<{start: number; end: number}> = [];
  const weeks = new Map<string, { dates: Set<string>; worked: number; threshold: number | null }>();
  const lines: CanonicalOvertimeDayResultV1[] = [];
  for (const day of ordered) {
    dateValue(day.businessDate, 'businessDate');
    if (seenDates.has(day.businessDate)) throw new RangeError('Duplicate business date in OT input');
    seenDates.add(day.businessDate);
    if (!(['regular','weekly_holiday','public_holiday'] as const).includes(day.dayType)) throw new RangeError('Invalid OT day type');
    safeInteger(day.attendanceProjectionVersion, 'attendanceProjectionVersion', 1);
    const matching = input.policies.filter(p => p.policyId === day.policyId && p.version === day.policyVersion
      && applicable(day.businessDate, p.effectiveFrom, p.effectiveTo));
    if (matching.length !== 1) throw new RangeError('Exactly one matching, effective OT policy version required');
    const policy = matching[0];
    const workedMinutes = checkedMinutes(day.workIntervals, day.breakIntervals, seenSources, globalWork);
    safeInteger(workedMinutes, 'workedMinutes');
    const key = mondayKey(day.businessDate);
    const week = weeks.get(key) ?? { dates: new Set<string>(), worked: 0, threshold: policy.weeklyThresholdMinutes };
    if (week.threshold !== policy.weeklyThresholdMinutes) throw new RangeError('Weekly threshold must remain constant within a workweek');
    week.dates.add(day.businessDate);
    const before = week.worked;
    week.worked += workedMinutes;
    safeInteger(week.worked, 'weekly worked minutes');
    const weeklyExtraMinutes = week.threshold == null ? 0
      : Math.max(0, week.worked - week.threshold) - Math.max(0, before - week.threshold);
    weeks.set(key, week);
    const dailyEligibleMinutes = calculateDailyEligibleMinutes({
      workedMinutes,
      scheduledMinutes: 0,
      thresholdMinutes: policy.dailyThresholdMinutes,
      minimumEligibleMinutes: 0,
      maximumMinutesPerDay: null,
    });
    let eligibleMinutes = Math.max(dailyEligibleMinutes, weeklyExtraMinutes);
    if (eligibleMinutes < policy.minimumEligibleMinutes) eligibleMinutes = 0;
    if (policy.maximumMinutesPerDay != null) eligibleMinutes = Math.min(eligibleMinutes, policy.maximumMinutesPerDay);
    const decision = day.decision;
    if (!decision || !(['pending','approved','rejected'] as const).includes(decision.status)) throw new RangeError('OT decision status required');
    safeInteger(decision.approvedMinutes, 'approvedMinutes');
    if (decision.status === 'approved') {
      if (!decision.decisionId || decision.version == null) throw new RangeError('Approved OT needs decision evidence');
      safeInteger(decision.version, 'decision.version', 1);
      if (seenDecisions.has(decision.decisionId)) throw new RangeError('Duplicate OT decision ID');
      seenDecisions.add(decision.decisionId);
      if (decision.approvedMinutes > eligibleMinutes) throw new RangeError('Approved minutes exceed eligible minutes');
    } else if (decision.approvedMinutes !== 0 || decision.decisionId != null || decision.version != null) {
      throw new RangeError('Non-approved OT cannot carry payable decision evidence');
    }
    const payableMinutes = decision.status === 'approved' ? decision.approvedMinutes : 0;
    const multiplierBasisPoints = policy.multiplierBasisPoints[day.dayType];
    const inPeriod = day.businessDate >= input.periodStart && day.businessDate <= input.periodEnd;
    const salary = payableMinutes > 0 && inPeriod ? matchSalary(day.businessDate, input.tenantId, input.salaries) : null;
    const amountMinor = salary == null ? 0 : roundedMoney(
      BigInt(salary.baseMonthlyMinor) * BigInt(payableMinutes) * BigInt(multiplierBasisPoints),
      BigInt(salary.standardMonthlyMinutes) * 10_000n,
    );
    if (inPeriod) lines.push({
      businessDate: day.businessDate, dayType: day.dayType, workedMinutes,
      scheduledThresholdMinutes: policy.dailyThresholdMinutes,
      dailyEligibleMinutes, weeklyExtraMinutes, eligibleMinutes,
      approvedMinutes: decision.status === 'approved' ? decision.approvedMinutes : 0,
      payableMinutes, amountMinor, attendanceProjectionVersion: day.attendanceProjectionVersion,
      policyId: policy.policyId, policyVersion: policy.version, multiplierBasisPoints,
      salaryRecordId: salary?.salaryRecordId ?? null, salaryVersion: salary?.version ?? null,
      standardMonthlyMinutes: salary?.standardMonthlyMinutes ?? null,
      decisionId: decision.decisionId, decisionVersion: decision.version, decisionStatus: decision.status,
    });
  }
  for (const [weekKey, week] of weeks) {
    if (week.threshold == null) continue;
    for (let i = 0; i < 7; i++) {
      const date = new Date(dateValue(weekKey, 'weekKey') + i * 86_400_000).toISOString().slice(0, 10);
      if (!week.dates.has(date)) throw new RangeError('Weekly OT requires all seven days including zero-work and cross-period context');
    }
  }
  const sum = (selector: (line: CanonicalOvertimeDayResultV1) => number) => {
    const value = lines.reduce((total, line) => total + selector(line), 0);
    return safeInteger(value, 'OT aggregate');
  };
  return {
    contractVersion: 'hr-02/v1', tenantId: input.tenantId, memberPublicId: input.memberPublicId,
    periodStart: input.periodStart, periodEnd: input.periodEnd,
    workedMinutes: sum(l => l.workedMinutes),
    eligibleMinutes: sum(l => l.eligibleMinutes),
    approvedMinutes: sum(l => l.approvedMinutes),
    payableMinutes: sum(l => l.payableMinutes),
    amountMinor: sum(l => l.amountMinor), lines,
  };
}
