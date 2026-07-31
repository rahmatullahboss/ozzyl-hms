import type {
  WorkforceClock,
  WorkforceMemberRepository,
  WorkforcePublicIdGenerator,
  WorkforceTransaction,
} from './ports';
import type { WorkCalendarService } from './work-calendar-service';
import { requireActiveMember } from './workforce-directory';
import type { AttendanceDay, AttendanceStatus } from '../domain/attendance';
import { WorkforceError } from '../domain/errors';
import type { LeaveApprovalResult, LeaveRequestStatus } from '../domain/leave';
import { enumerateInclusiveDates } from '../domain/roster';
import { hashWorkforceRequest } from '../infrastructure/d1-workforce-idempotency-repository';

export type OptionalHolidayLeavePolicy =
  | 'count_as_working_day'
  | 'count_as_non_working_day';

export type LeaveCategoryRecord = {
  tenantId: string;
  leaveCategoryId: number;
  leaveName: string;
  isActive: boolean;
};

export type LeaveBalanceRecord = {
  tenantId: string;
  staffId: number;
  leaveCategoryId: number;
  year: number;
  balance: number;
  used: number;
};

export type LeaveRequestRecord = {
  leaveRequestId: number;
  tenantId: string;
  staffId: number;
  leaveCategoryId: number;
  startDate: string;
  endDate: string;
  workingDays: number;
  reason: string | null;
  requestedTo: number | null;
  status: LeaveRequestStatus;
};

export type LeaveRosterConflict = {
  rosterId: number;
  rosterDate: string;
  shiftId: number;
};

export type PreparedLeaveBalanceAdjustment = {
  tenantId: string;
  staffId: number;
  leaveCategoryId: number;
  year: number;
  deductDays: number;
  expectedBalance: number;
  expectedUsed: number;
};

export type PreparedLeaveReview = {
  tenantId: string;
  leaveRequestId: number;
  expectedStatus: 'pending';
  status: Exclude<LeaveRequestStatus, 'pending'>;
  actorUserId: string;
  rejectionReason: string | null;
  reviewedAtUtc: string;
  approvedBalanceGuard: null | {
    staffId: number;
    leaveCategoryId: number;
    year: number;
    expectedBalanceAfterDeduction: number;
    expectedUsedAfterDeduction: number;
  };
};

export type PreparedLeaveAttendanceProjection = {
  tenantId: string;
  staffId: number;
  businessDate: string;
  status: Extract<AttendanceStatus, 'leave'>;
  expectedVersion: number;
  updatedAtUtc: string;
};

export type PreparedLeaveAttendanceEvent = {
  tenantId: string;
  eventPublicId: string;
  staffId: number;
  businessDate: string;
  projectionStatus: Extract<AttendanceStatus, 'leave'>;
  expectedResultVersion: number;
  source: 'leave_review';
  sourceEventKey: string;
  requestHash: string;
  reason: string | null;
  actorUserId: string;
  createdAtUtc: string;
};

export interface LeaveMutationRepository<TStatement> {
  getCategory(tenantId: string, categoryId: number): Promise<LeaveCategoryRecord | null>;
  getBalance(
    tenantId: string,
    staffId: number,
    categoryId: number,
    year: number,
  ): Promise<LeaveBalanceRecord | null>;
  getRequest(tenantId: string, requestId: number): Promise<LeaveRequestRecord | null>;
  createRequest(input: {
    tenantId: string;
    staffId: number;
    leaveCategoryId: number;
    startDate: string;
    endDate: string;
    workingDays: number;
    reason: string | null;
    requestedTo: number | null;
  }): Promise<number>;
  listRosterConflicts(
    tenantId: string,
    staffId: number,
    startDate: string,
    endDate: string,
  ): Promise<LeaveRosterConflict[]>;
  listExistingAttendanceDays(
    tenantId: string,
    staffId: number,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceDay[]>;
  prepareAdjustBalance(input: PreparedLeaveBalanceAdjustment): TStatement;
  prepareReviewRequest(input: PreparedLeaveReview): TStatement;
  prepareAttendanceProjection(input: PreparedLeaveAttendanceProjection): TStatement;
  prepareAttendanceEvent(input: PreparedLeaveAttendanceEvent): TStatement;
}

export type RequestLeaveInput = {
  tenantId: string;
  staffId: number;
  leaveCategoryId: number;
  startDate: string;
  endDate: string;
  reason: string | null;
  requestedTo: number | null;
};

export type ReviewLeaveInput = {
  tenantId: string;
  actorUserId: string;
  leaveRequestId: number;
  status: Exclude<LeaveRequestStatus, 'pending'>;
  rejectionReason: string | null;
};

export type LeaveService = {
  calculateWorkingDays(tenantId: string, startDate: string, endDate: string): Promise<number>;
  requestLeave(input: RequestLeaveInput): Promise<{
    leaveRequestId: number;
    workingDays: number;
  }>;
  reviewLeave(input: ReviewLeaveInput): Promise<LeaveApprovalResult>;
};

function leaveYear(startDate: string, endDate: string): number {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear !== endYear) {
    throw new WorkforceError(
      'INVALID_DATE_RANGE',
      'Leave requests must remain within one calendar year',
      422,
    );
  }
  return startYear;
}

function boundedLeaveDates(startDate: string, endDate: string): string[] {
  try {
    return enumerateInclusiveDates(startDate, endDate);
  } catch (error) {
    if (error instanceof RangeError && error.message.includes('exceeds 62 days')) {
      throw new WorkforceError(
        'REQUEST_LIMIT_EXCEEDED',
        'A leave request cannot exceed 62 calendar days',
        422,
      );
    }
    if (error instanceof RangeError) {
      throw new WorkforceError('INVALID_DATE_RANGE', error.message, 422);
    }
    throw error;
  }
}

function insufficientBalance(balance: LeaveBalanceRecord | null, required: number): WorkforceError {
  return new WorkforceError(
    'LEAVE_BALANCE_INSUFFICIENT',
    `Insufficient leave balance. Available: ${balance?.balance ?? 0}, Required: ${required}`,
    409,
    false,
    {
      available: balance?.balance ?? 0,
      required,
    },
  );
}

export function createLeaveService<TStatement>(dependencies: {
  workforceMembers: WorkforceMemberRepository;
  leave: LeaveMutationRepository<TStatement>;
  calendar: WorkCalendarService;
  transaction: WorkforceTransaction<TStatement>;
  clock: WorkforceClock;
  publicIds: WorkforcePublicIdGenerator;
  optionalHolidayPolicy: OptionalHolidayLeavePolicy;
}): LeaveService {
  const {
    workforceMembers,
    leave,
    calendar,
    transaction,
    clock,
    publicIds,
    optionalHolidayPolicy,
  } = dependencies;

  async function calculateWorkingDays(
    tenantId: string,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    leaveYear(startDate, endDate);
    const dates = boundedLeaveDates(startDate, endDate);
    const days = await calendar.evaluateDays(tenantId, dates);
    return days.filter((day) => {
      if (day.isWorkingDay) return true;
      return day.holiday?.type === 'optional'
        && !day.isConfiguredWeekend
        && optionalHolidayPolicy === 'count_as_working_day';
    }).length;
  }

  async function requireCategory(tenantId: string, categoryId: number): Promise<LeaveCategoryRecord> {
    const category = await leave.getCategory(tenantId, categoryId);
    if (!category || !category.isActive) {
      throw new WorkforceError(
        'LEAVE_CATEGORY_NOT_FOUND',
        'Leave category not found',
        404,
      );
    }
    return category;
  }

  return {
    calculateWorkingDays,

    async requestLeave(input) {
      await requireActiveMember(workforceMembers, input.tenantId, input.staffId);
      await requireCategory(input.tenantId, input.leaveCategoryId);
      const year = leaveYear(input.startDate, input.endDate);
      const workingDays = await calculateWorkingDays(
        input.tenantId,
        input.startDate,
        input.endDate,
      );
      if (workingDays < 1) {
        throw new WorkforceError(
          'INVALID_DATE_RANGE',
          'The selected leave period contains no chargeable working day',
          422,
        );
      }

      const balance = await leave.getBalance(
        input.tenantId,
        input.staffId,
        input.leaveCategoryId,
        year,
      );
      if (!balance || balance.balance < workingDays) {
        throw insufficientBalance(balance, workingDays);
      }

      const leaveRequestId = await leave.createRequest({
        tenantId: input.tenantId,
        staffId: input.staffId,
        leaveCategoryId: input.leaveCategoryId,
        startDate: input.startDate,
        endDate: input.endDate,
        workingDays,
        reason: input.reason,
        requestedTo: input.requestedTo,
      });
      return { leaveRequestId, workingDays };
    },

    async reviewLeave(input) {
      const request = await leave.getRequest(input.tenantId, input.leaveRequestId);
      if (!request) {
        throw new WorkforceError(
          'LEAVE_REQUEST_NOT_FOUND',
          'Leave request not found',
          404,
        );
      }
      if (request.status !== 'pending') {
        throw new WorkforceError(
          'LEAVE_REQUEST_CONFLICT',
          `Leave request is already ${request.status}`,
          409,
        );
      }

      const reviewedAtUtc = clock.nowUtc();
      const prepareReviewStatement = (
        approvedBalanceGuard: PreparedLeaveReview['approvedBalanceGuard'],
      ) => leave.prepareReviewRequest({
        tenantId: input.tenantId,
        leaveRequestId: request.leaveRequestId,
        expectedStatus: 'pending',
        status: input.status,
        actorUserId: input.actorUserId,
        rejectionReason: input.rejectionReason,
        reviewedAtUtc,
        approvedBalanceGuard,
      });

      if (input.status !== 'approved') {
        await transaction.commit([prepareReviewStatement(null)]);
        return {
          leaveRequestId: request.leaveRequestId,
          workingDays: request.workingDays,
          rosterConflicts: [],
          requiresRosterReview: false,
        };
      }

      await requireActiveMember(workforceMembers, input.tenantId, request.staffId);
      await requireCategory(input.tenantId, request.leaveCategoryId);
      const recalculatedWorkingDays = await calculateWorkingDays(
        input.tenantId,
        request.startDate,
        request.endDate,
      );
      if (recalculatedWorkingDays !== request.workingDays) {
        throw new WorkforceError(
          'LEAVE_CALENDAR_POLICY_CHANGED',
          'The work-calendar policy changed after this leave request was submitted',
          409,
          false,
          {
            storedWorkingDays: request.workingDays,
            reviewedWorkingDays: recalculatedWorkingDays,
          },
        );
      }

      const year = leaveYear(request.startDate, request.endDate);
      const balance = await leave.getBalance(
        input.tenantId,
        request.staffId,
        request.leaveCategoryId,
        year,
      );
      if (!balance || balance.balance < request.workingDays) {
        throw insufficientBalance(balance, request.workingDays);
      }

      const [rosterConflicts, attendanceDays] = await Promise.all([
        leave.listRosterConflicts(
          input.tenantId,
          request.staffId,
          request.startDate,
          request.endDate,
        ),
        leave.listExistingAttendanceDays(
          input.tenantId,
          request.staffId,
          request.startDate,
          request.endDate,
        ),
      ]);
      const requestHash = await hashWorkforceRequest({
        leaveRequestId: request.leaveRequestId,
        status: input.status,
        workingDays: request.workingDays,
        reviewedAtUtc,
      });

      const statements: TStatement[] = [
        leave.prepareAdjustBalance({
          tenantId: input.tenantId,
          staffId: request.staffId,
          leaveCategoryId: request.leaveCategoryId,
          year,
          deductDays: request.workingDays,
          expectedBalance: balance.balance,
          expectedUsed: balance.used,
        }),
        prepareReviewStatement({
          staffId: request.staffId,
          leaveCategoryId: request.leaveCategoryId,
          year,
          expectedBalanceAfterDeduction: balance.balance - request.workingDays,
          expectedUsedAfterDeduction: balance.used + request.workingDays,
        }),
      ];

      for (const attendanceDay of attendanceDays) {
        const resultVersion = attendanceDay.projectionVersion + 1;
        statements.push(
          leave.prepareAttendanceProjection({
            tenantId: input.tenantId,
            staffId: request.staffId,
            businessDate: attendanceDay.businessDate,
            status: 'leave',
            expectedVersion: attendanceDay.projectionVersion,
            updatedAtUtc: reviewedAtUtc,
          }),
          leave.prepareAttendanceEvent({
            tenantId: input.tenantId,
            eventPublicId: publicIds.next('attendance_projection_event'),
            staffId: request.staffId,
            businessDate: attendanceDay.businessDate,
            projectionStatus: 'leave',
            expectedResultVersion: resultVersion,
            source: 'leave_review',
            sourceEventKey: `leave-review:${request.leaveRequestId}:${attendanceDay.businessDate}:approved`,
            requestHash,
            reason: request.reason,
            actorUserId: input.actorUserId,
            createdAtUtc: reviewedAtUtc,
          }),
        );
      }

      await transaction.commit(statements);
      return {
        leaveRequestId: request.leaveRequestId,
        workingDays: request.workingDays,
        rosterConflicts,
        requiresRosterReview: rosterConflicts.length > 0,
      };
    },
  };
}
