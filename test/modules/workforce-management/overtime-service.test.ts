import { describe, expect, it } from 'vitest';
import {
  calculateApprovedOvertimeHours,
  createOvertimeService,
  type OvertimeLogRecord,
  type OvertimeMutationRepository,
  type OvertimeReviewMutation,
} from '../../../src/modules/workforce-management/application/overtime-service';
import type { OvertimeRule } from '../../../src/modules/workforce-management/domain/overtime';
import type { WorkCalendarService } from '../../../src/modules/workforce-management/application/work-calendar-service';

function calendar(day: 'weekday' | 'weekend' | 'holiday'): WorkCalendarService {
  return {
    async evaluateDay(_tenantId, date) {
      return {
        date,
        dayOfWeek: 'monday',
        isConfiguredWeekend: day === 'weekend',
        holiday: day === 'holiday' ? { holidayId: 1, name: 'Holiday', type: 'public' } : null,
        isWorkingDay: day === 'weekday',
      };
    },
    async evaluateDays(tenantId, dates) {
      return Promise.all(dates.map((date) => this.evaluateDay(tenantId, date)));
    },
  };
}

const rules: OvertimeRule[] = [
  {
    ruleId: 1,
    tenantId: '100',
    ruleName: 'All days',
    multiplier: 1.25,
    minHoursBeforeOvertime: 8,
    maxOvertimeHoursPerDay: 4,
    appliesOn: 'all',
    isActive: true,
  },
  {
    ruleId: 2,
    tenantId: '100',
    ruleName: 'Weekday',
    multiplier: 1.5,
    minHoursBeforeOvertime: 8,
    maxOvertimeHoursPerDay: 3,
    appliesOn: 'weekday',
    isActive: true,
  },
  {
    ruleId: 3,
    tenantId: '100',
    ruleName: 'Weekend',
    multiplier: 2,
    minHoursBeforeOvertime: 6,
    maxOvertimeHoursPerDay: 5,
    appliesOn: 'weekend',
    isActive: true,
  },
  {
    ruleId: 4,
    tenantId: '100',
    ruleName: 'Holiday',
    multiplier: 2.5,
    minHoursBeforeOvertime: 0,
    maxOvertimeHoursPerDay: 6,
    appliesOn: 'holiday',
    isActive: true,
  },
];

function pendingLog(overrides: Partial<OvertimeLogRecord> = {}): OvertimeLogRecord {
  return {
    overtimeLogId: 10,
    tenantId: '100',
    staffId: 21,
    businessDate: '2026-07-27',
    scheduledHours: 8,
    actualHours: 11,
    overtimeHours: 0,
    ruleId: null,
    multiplierSnapshot: 1.5,
    status: 'pending',
    approvedBy: null,
    approvedAtUtc: null,
    ...overrides,
  };
}

function createHarness(input: {
  day?: 'weekday' | 'weekend' | 'holiday';
  log?: OvertimeLogRecord | null;
  activeRules?: OvertimeRule[];
} = {}) {
  let log = input.log === undefined ? pendingLog() : input.log;
  const mutations: OvertimeReviewMutation[] = [];

  const repository: OvertimeMutationRepository = {
    async getLog(tenantId, overtimeLogId) {
      return log?.tenantId === tenantId && log.overtimeLogId === overtimeLogId ? structuredClone(log) : null;
    },
    async listActiveRules(tenantId) {
      return (input.activeRules ?? rules).filter((rule) => rule.tenantId === tenantId && rule.isActive);
    },
    async review(mutation) {
      if (!log || log.tenantId !== mutation.tenantId || log.overtimeLogId !== mutation.overtimeLogId || log.status !== mutation.expectedStatus) {
        return false;
      }
      mutations.push(structuredClone(mutation));
      log = {
        ...log,
        status: mutation.status,
        overtimeHours: mutation.approvedHours ?? log.overtimeHours,
        multiplierSnapshot: mutation.multiplierSnapshot ?? log.multiplierSnapshot,
        ruleId: mutation.ruleId ?? log.ruleId,
        approvedBy: mutation.actorUserId,
        approvedAtUtc: mutation.reviewedAtUtc,
      };
      return true;
    },
  };

  const service = createOvertimeService({
    overtime: repository,
    calendar: calendar(input.day ?? 'weekday'),
    clock: { nowUtc: () => '2026-07-27T04:00:00.000Z' },
  });

  return { service, mutations, getLog: () => log };
}

describe('overtime hour policy', () => {
  it('calculates only hours above the greater of schedule and minimum threshold', () => {
    expect(calculateApprovedOvertimeHours({
      scheduledMinutes: 8 * 60,
      actualMinutes: 11 * 60,
      minMinutesBeforeOvertime: 7 * 60,
      maxOvertimeMinutes: 4 * 60,
    })).toBe(3);
  });

  it('caps approved overtime at the rule maximum', () => {
    expect(calculateApprovedOvertimeHours({
      scheduledMinutes: 8 * 60,
      actualMinutes: 16 * 60,
      minMinutesBeforeOvertime: 8 * 60,
      maxOvertimeMinutes: 4 * 60,
    })).toBe(4);
  });
});

describe('overtime review', () => {
  it('prefers the exact weekday rule and snapshots multiplier, actor, and time', async () => {
    const { service, mutations } = createHarness({ day: 'weekday' });

    const result = await service.review({
      tenantId: '100',
      actorUserId: '44',
      overtimeLogId: 10,
      status: 'approved',
    });

    expect(result).toMatchObject({
      overtimeLogId: 10,
      staffId: 21,
      businessDate: '2026-07-27',
      approvedHours: 3,
      multiplierSnapshot: 1.5,
      status: 'approved',
    });
    expect(mutations[0]).toMatchObject({
      ruleId: 2,
      approvedHours: 3,
      multiplierSnapshot: 1.5,
      actorUserId: '44',
      reviewedAtUtc: '2026-07-27T04:00:00.000Z',
    });
  });

  it.each([
    ['weekend', 3, 2, 2],
    ['holiday', 4, 2.5, 6],
  ] as const)('selects the %s rule before the all-days fallback', async (day, ruleId, multiplier, approvedHours) => {
    const { service, mutations } = createHarness({
      day,
      log: pendingLog({ scheduledHours: day === 'weekend' ? 6 : 0, actualHours: 8 }),
    });

    await service.review({ tenantId: '100', actorUserId: '44', overtimeLogId: 10, status: 'approved' });
    expect(mutations[0]).toMatchObject({ ruleId, multiplierSnapshot: multiplier, approvedHours });
  });

  it('uses an all-days rule when no exact rule exists', async () => {
    const { service, mutations } = createHarness({ day: 'weekday', activeRules: [rules[0]] });
    await service.review({ tenantId: '100', actorUserId: '44', overtimeLogId: 10, status: 'approved' });
    expect(mutations[0]).toMatchObject({ ruleId: 1, multiplierSnapshot: 1.25, approvedHours: 3 });
  });

  it('rejects a cross-tenant overtime lookup', async () => {
    const { service } = createHarness();
    await expect(service.review({ tenantId: '200', actorUserId: '44', overtimeLogId: 10, status: 'approved' }))
      .rejects.toMatchObject({ code: 'OVERTIME_LOG_NOT_FOUND', httpStatus: 404 });
  });

  it('rejects a second review of an already approved entry', async () => {
    const { service } = createHarness({ log: pendingLog({ status: 'approved' }) });
    await expect(service.review({ tenantId: '100', actorUserId: '44', overtimeLogId: 10, status: 'approved' }))
      .rejects.toMatchObject({ code: 'OVERTIME_REVIEW_CONFLICT', httpStatus: 409 });
  });

  it('records rejection without calculating money or changing approved hours', async () => {
    const { service, mutations } = createHarness();
    const result = await service.review({ tenantId: '100', actorUserId: '44', overtimeLogId: 10, status: 'rejected' });
    expect(result).toMatchObject({ overtimeLogId: 10, status: 'rejected' });
    expect(mutations[0]).toMatchObject({ status: 'rejected', approvedHours: null, multiplierSnapshot: null, ruleId: null });
  });
});
