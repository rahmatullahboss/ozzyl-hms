import { describe, expect, it } from 'vitest';
import {
  calculateCanonicalOvertimeV1,
  calculateDailyEligibleMinutes,
  type CanonicalOvertimeInputV1,
  type OvertimeDayFact,
} from '../../../src/modules/workforce-management/domain/canonical-overtime-calculation';

const policy = {
  tenantId: '102', policyId: 'p1', version: 3, effectiveFrom: '2026-01-01', effectiveTo: null,
  dailyThresholdMinutes: 480, weeklyThresholdMinutes: null, minimumEligibleMinutes: 30,
  maximumMinutesPerDay: 360,
  multiplierBasisPoints: { regular: 15000, weekly_holiday: 20000, public_holiday: 25000 },
};
const salary = {
  tenantId: '102', salaryRecordId: 's1', version: 2,
  effectiveFrom: '2026-01-01', effectiveTo: null,
  baseMonthlyMinor: 3_000_000, standardMonthlyMinutes: 11_520,
};
function span(id: string, start: string, end: string) {
  return { sourceId: id, startUtc: start, endUtc: end };
}
function day(overrides: Partial<OvertimeDayFact> = {}): OvertimeDayFact {
  return {
    businessDate: '2026-11-16', dayType: 'regular', policyId: 'p1', policyVersion: 3,
    attendanceProjectionVersion: 7,
    workIntervals: [span('in-out-1', '2026-11-16T03:00:00Z', '2026-11-16T13:00:00Z')],
    breakIntervals: [],
    decision: { status: 'approved', decisionId: 'd1', version: 2, approvedMinutes: 120 },
    ...overrides,
  };
}
function input(overrides: Partial<CanonicalOvertimeInputV1> = {}): CanonicalOvertimeInputV1 {
  return { tenantId: '102', memberPublicId: 'staff-1', periodStart: '2026-11-01',
    periodEnd: '2026-11-30', days: [day()], policies: [policy], salaries: [salary], ...overrides };
}
describe('HR-02 canonical overtime v1', () => {
  it('separates worked, eligible, approved and payable minutes with BDT exact minor units', () => {
    const result = calculateCanonicalOvertimeV1(input());
    expect(result).toMatchObject({
      contractVersion: 'hr-02/v1', workedMinutes: 600, eligibleMinutes: 120,
      approvedMinutes: 120, payableMinutes: 120, amountMinor: 46_875,
    });
    expect(result.lines[0]).toMatchObject({ policyVersion: 3, salaryVersion: 2, attendanceProjectionVersion: 7 });
  });
  it('derives policy-specific BDT 2,500 for 8 approved hours at 2x and 192 monthly hours', () => {
    const result = calculateCanonicalOvertimeV1(input({
      policies: [{ ...policy, dailyThresholdMinutes: 0, maximumMinutesPerDay: 480 }],
      days: [day({
        dayType: 'weekly_holiday',
        workIntervals: [span('holiday', '2026-11-16T02:00:00Z', '2026-11-16T10:00:00Z')],
        decision: { status: 'approved', decisionId: 'd-holiday', version: 1, approvedMinutes: 480 },
      })],
    }));
    expect(result.amountMinor).toBe(250_000);
    expect(result.amountMinor).not.toBe(2_000_000); // competing 20,000 amount is not this policy's output
  });
  it('has zero payable money for a pending or rejected approval', () => {
    for (const status of ['pending', 'rejected'] as const) {
      const result = calculateCanonicalOvertimeV1(input({
        days: [day({ decision: { status, decisionId: null, version: null, approvedMinutes: 0 } })],
      }));
      expect(result.workedMinutes).toBe(600);
      expect(result.eligibleMinutes).toBe(120);
      expect(result.payableMinutes).toBe(0);
      expect(result.amountMinor).toBe(0);
    }
  });
  it('recomputes when an approved decision version changes and never repeats one decision ID', () => {
    const changed = calculateCanonicalOvertimeV1(input({
      days: [day({ decision: { status: 'approved', decisionId: 'd2', version: 3, approvedMinutes: 60 } })],
    }));
    expect(changed.amountMinor).toBe(23_438);
    expect(changed.lines[0].decisionVersion).toBe(3);
    expect(() => calculateCanonicalOvertimeV1(input({ days: [
      day({ businessDate: '2026-11-16', decision: { status: 'approved', decisionId: 'dup', version: 1, approvedMinutes: 120 } }),
      day({ businessDate: '2026-11-17', workIntervals: [span('day2', '2026-11-17T03:00:00Z', '2026-11-17T13:00:00Z')],
        decision: { status: 'approved', decisionId: 'dup', version: 1, approvedMinutes: 120 } }),
    ] }))).toThrow(/Duplicate OT decision/);
  });
  it('rejects an approval exceeding the eligible amount', () => {
    expect(() => calculateCanonicalOvertimeV1(input({
      days: [day({ decision: { status: 'approved', decisionId: 'd1', version: 1, approvedMinutes: 121 } })],
    }))).toThrow(/exceed eligible/);
  });
  it('supports unpaid breaks and overnight shifts without splitting one shift into two payable dates', () => {
    const result = calculateCanonicalOvertimeV1(input({
      days: [day({
        workIntervals: [span('night', '2026-11-16T16:00:00Z', '2026-11-17T03:00:00Z')],
        breakIntervals: [span('night-break', '2026-11-16T20:00:00Z', '2026-11-16T21:00:00Z')],
      })],
    }));
    expect(result.workedMinutes).toBe(600);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].businessDate).toBe('2026-11-16');
  });
  it('rejects repeated punches, overlapping shifts, out-of-work breaks and missing OUT', () => {
    const interval = span('duplicate', '2026-11-16T03:00:00Z', '2026-11-16T08:00:00Z');
    expect(() => calculateCanonicalOvertimeV1(input({ days: [day({workIntervals: [interval, interval]})] })))
      .toThrow(/Duplicate/);
    expect(() => calculateCanonicalOvertimeV1(input({ days: [day({
      workIntervals: [span('a', '2026-11-16T03:00:00Z', '2026-11-16T09:00:00Z'),
        span('b', '2026-11-16T08:00:00Z', '2026-11-16T13:00:00Z')],
    })] }))).toThrow(/Overlapping/);
    expect(() => calculateCanonicalOvertimeV1(input({days: [day({
      breakIntervals: [span('outside', '2026-11-16T01:00:00Z', '2026-11-16T02:00:00Z')],
    })]}))).toThrow(/Break/);
    expect(() => calculateCanonicalOvertimeV1(input({days: [day({
      workIntervals: [span('missingOut', '2026-11-16T03:00:00Z', '')],
    })]}))).toThrow(/UTC ISO/);
  });
  it('enforces policy version and effective-dated salaries including mid-month changes', () => {
    const result = calculateCanonicalOvertimeV1(input({
      salaries: [
        { ...salary, effectiveTo: '2026-11-16' },
        { ...salary, salaryRecordId: 's2', version: 3, baseMonthlyMinor: 4_000_000, effectiveFrom: '2026-11-17' },
      ],
      days: [
        day(),
        day({ businessDate: '2026-11-17', workIntervals: [span('new-day', '2026-11-17T03:00:00Z','2026-11-17T13:00:00Z')],
          decision: {status: 'approved', decisionId: 'd-new', version: 1, approvedMinutes: 120} }),
      ],
    }));
    expect(result.lines.map(l => l.salaryRecordId)).toEqual(['s1','s2']);
    expect(result.amountMinor).toBe(46_875 + 62_500);
    expect(() => calculateCanonicalOvertimeV1(input({days:[day({policyVersion:99})]}))).toThrow(/policy version/);
  });
  it('fails closed on two hospitals, overlapping salaries and duplicate dates', () => {
    expect(() => calculateCanonicalOvertimeV1(input({ policies: [{ ...policy, tenantId: '105' }] })))
      .toThrow(/tenant mismatch/);
    expect(() => calculateCanonicalOvertimeV1(input({ salaries: [{ ...salary, tenantId: '105' }] })))
      .toThrow(/tenant mismatch/);
    expect(() => calculateCanonicalOvertimeV1(input({ salaries: [salary, { ...salary, salaryRecordId:'s2' }] })))
      .toThrow(/Exactly one effective salary/);
    expect(() => calculateCanonicalOvertimeV1(input({ days: [day(),day()] }))).toThrow(/Duplicate business date/);
  });
  it('supports weekly threshold on complete Monday-Sunday input and refuses partial evidence', () => {
    const days = Array.from({length:7}, (_, offset) => {
      const date = `2026-11-${String(16 + offset).padStart(2,'0')}`;
      const workIntervals = offset < 5
        ? [span(`wk-${offset}`, `${date}T03:00:00Z`, `${date}T12:00:00Z`)]
        : [];
      return day({ businessDate:date, workIntervals,
        decision: {status:'pending', decisionId:null, version:null, approvedMinutes:0} });
    });
    const i = input({ days, policies:[{...policy,dailyThresholdMinutes:600,weeklyThresholdMinutes:2400}] });
    const result = calculateCanonicalOvertimeV1(i);
    expect(result.workedMinutes).toBe(2700);
    expect(result.eligibleMinutes).toBe(300);
    expect(result.lines[4].weeklyExtraMinutes).toBe(300);
    expect(() => calculateCanonicalOvertimeV1({...i,days:days.slice(0,5)})).toThrow(/all seven days/);
  });
  it('checks minimum qualifying time, caps and integer precision', () => {
    expect(calculateDailyEligibleMinutes({workedMinutes: 500,scheduledMinutes:480,thresholdMinutes:420,
      minimumEligibleMinutes:30,maximumMinutesPerDay:100})).toBe(0);
    expect(calculateDailyEligibleMinutes({workedMinutes:900,scheduledMinutes:480,thresholdMinutes:420,
      minimumEligibleMinutes:30,maximumMinutesPerDay:120})).toBe(120);
    expect(() => calculateDailyEligibleMinutes({workedMinutes:1.5,scheduledMinutes:0,thresholdMinutes:0,
      minimumEligibleMinutes:0,maximumMinutesPerDay:null})).toThrow(/safe integer/);
  });
});
