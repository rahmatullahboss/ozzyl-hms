import type { WorkforceClock } from './ports';
import { calculateDailyEligibleMinutes } from '../domain/canonical-overtime-calculation';
import type { WorkCalendarService } from './work-calendar-service';
import { WorkforceError } from '../domain/errors';
import type {
  OvertimeAppliesOn,
  OvertimeReviewResult,
  OvertimeRule,
  OvertimeStatus,
} from '../domain/overtime';

export type OvertimeLogRecord = {
  overtimeLogId: number;
  tenantId: string;
  staffId: number;
  businessDate: string;
  scheduledHours: number;
  actualHours: number;
  overtimeHours: number;
  ruleId: number | null;
  multiplierSnapshot: number;
  status: OvertimeStatus;
  approvedBy: string | null;
  approvedAtUtc: string | null;
};

export type OvertimeReviewMutation = {
  tenantId: string;
  overtimeLogId: number;
  expectedStatus: 'pending';
  status: Exclude<OvertimeStatus, 'pending'>;
  actorUserId: string;
  reviewedAtUtc: string;
  ruleId: number | null;
  approvedHours: number | null;
  multiplierSnapshot: number | null;
};

export interface OvertimeMutationRepository {
  getLog(tenantId: string, overtimeLogId: number): Promise<OvertimeLogRecord | null>;
  listActiveRules(tenantId: string): Promise<OvertimeRule[]>;
  review(mutation: OvertimeReviewMutation): Promise<boolean>;
}

export type ReviewOvertimeInput = {
  tenantId: string;
  actorUserId: string;
  overtimeLogId: number;
  status: Exclude<OvertimeStatus, 'pending'>;
};

export function calculateApprovedOvertimeHours(input: {
  scheduledMinutes: number;
  actualMinutes: number;
  minMinutesBeforeOvertime: number;
  maxOvertimeMinutes: number;
}): number {
  // Compatibility interface: canonical eligibility is minute-based; legacy review persists hours.
  const eligibleMinutes = calculateDailyEligibleMinutes({
    scheduledMinutes: input.scheduledMinutes,
    workedMinutes: input.actualMinutes,
    thresholdMinutes: input.minMinutesBeforeOvertime,
    minimumEligibleMinutes: 0,
    maximumMinutesPerDay: input.maxOvertimeMinutes,
  });
  return Math.round((eligibleMinutes / 60) * 10_000) / 10_000;
}

function resolveDayType(day: Awaited<ReturnType<WorkCalendarService['evaluateDay']>>): Exclude<OvertimeAppliesOn, 'all'> {
  if (day.holiday) return 'holiday';
  if (day.isConfiguredWeekend) return 'weekend';
  return 'weekday';
}

function selectApplicableRule(
  rules: readonly OvertimeRule[],
  preferredRuleId: number | null,
  dayType: Exclude<OvertimeAppliesOn, 'all'>,
): OvertimeRule | null {
  const preferred = preferredRuleId === null
    ? null
    : rules.find((rule) => rule.ruleId === preferredRuleId && (rule.appliesOn === dayType || rule.appliesOn === 'all')) ?? null;
  if (preferred) return preferred;
  return rules.find((rule) => rule.appliesOn === dayType)
    ?? rules.find((rule) => rule.appliesOn === 'all')
    ?? null;
}

export function createOvertimeService(dependencies: {
  overtime: OvertimeMutationRepository;
  calendar: WorkCalendarService;
  clock: WorkforceClock;
}) {
  const { overtime, calendar, clock } = dependencies;

  return {
    async review(input: ReviewOvertimeInput): Promise<OvertimeReviewResult> {
      const log = await overtime.getLog(input.tenantId, input.overtimeLogId);
      if (!log) {
        throw new WorkforceError('OVERTIME_LOG_NOT_FOUND', 'Overtime entry not found', 404);
      }
      if (log.status !== 'pending') {
        throw new WorkforceError(
          'OVERTIME_REVIEW_CONFLICT',
          `Overtime entry is already ${log.status}`,
          409,
        );
      }

      const reviewedAtUtc = clock.nowUtc();
      if (input.status === 'rejected') {
        const updated = await overtime.review({
          tenantId: input.tenantId,
          overtimeLogId: log.overtimeLogId,
          expectedStatus: 'pending',
          status: 'rejected',
          actorUserId: input.actorUserId,
          reviewedAtUtc,
          ruleId: null,
          approvedHours: null,
          multiplierSnapshot: null,
        });
        if (!updated) {
          throw new WorkforceError('OVERTIME_REVIEW_CONFLICT', 'Overtime entry changed during review', 409);
        }
        return {
          overtimeLogId: log.overtimeLogId,
          staffId: log.staffId,
          businessDate: log.businessDate,
          status: 'rejected',
        };
      }

      const [day, rules] = await Promise.all([
        calendar.evaluateDay(input.tenantId, log.businessDate),
        overtime.listActiveRules(input.tenantId),
      ]);
      const dayType = resolveDayType(day);
      const rule = selectApplicableRule(rules, log.ruleId, dayType);
      if (!rule) {
        throw new WorkforceError(
          'OVERTIME_RULE_NOT_FOUND',
          `No active overtime rule applies to this ${dayType}`,
          404,
        );
      }

      const approvedHours = calculateApprovedOvertimeHours({
        scheduledMinutes: log.scheduledHours * 60,
        actualMinutes: log.actualHours * 60,
        minMinutesBeforeOvertime: rule.minHoursBeforeOvertime * 60,
        maxOvertimeMinutes: rule.maxOvertimeHoursPerDay * 60,
      });
      const updated = await overtime.review({
        tenantId: input.tenantId,
        overtimeLogId: log.overtimeLogId,
        expectedStatus: 'pending',
        status: 'approved',
        actorUserId: input.actorUserId,
        reviewedAtUtc,
        ruleId: rule.ruleId,
        approvedHours,
        multiplierSnapshot: rule.multiplier,
      });
      if (!updated) {
        throw new WorkforceError('OVERTIME_REVIEW_CONFLICT', 'Overtime entry changed during review', 409);
      }

      return {
        overtimeLogId: log.overtimeLogId,
        staffId: log.staffId,
        businessDate: log.businessDate,
        approvedHours,
        multiplierSnapshot: rule.multiplier,
        status: 'approved',
      };
    },
  };
}
