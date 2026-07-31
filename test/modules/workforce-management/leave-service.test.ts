import { describe, expect, it } from 'vitest';
import {
  WorkforceError,
  type AttendanceDay,
  type RosterAssignment,
  type WorkforceMemberRef,
  type WorkforceTransaction,
} from '../../../src/modules/workforce-management';
import {
  createLeaveService,
  type LeaveBalanceRecord,
  type LeaveCategoryRecord,
  type LeaveMutationRepository,
  type LeaveRequestRecord,
  type PreparedLeaveAttendanceEvent,
  type PreparedLeaveAttendanceProjection,
  type PreparedLeaveBalanceAdjustment,
  type PreparedLeaveReview,
} from '../../../src/modules/workforce-management/application/leave-service';
import type { WorkCalendarService } from '../../../src/modules/workforce-management/application/work-calendar-service';

type TestStatement = () => void;

const members: WorkforceMemberRef[] = [
  {
    tenantId: '100', staffId: 1, displayName: 'Nurse Fatima', position: 'Nurse',
    department: 'ICU', status: 'active', userId: 44, practitionerPublicId: null,
  },
  {
    tenantId: '100', staffId: 2, displayName: 'Inactive Nurse', position: 'Nurse',
    department: 'ICU', status: 'inactive', userId: null, practitionerPublicId: null,
  },
];

function roster(input: { rosterId: number; staffId: number; shiftId: number; rosterDate: string }): RosterAssignment {
  return {
    rosterId: input.rosterId,
    tenantId: '100',
    staffId: input.staffId,
    staffName: 'Nurse Fatima',
    position: 'Nurse',
    department: 'ICU',
    shiftId: input.shiftId,
    shiftName: 'Morning',
    shiftShortCode: 'M',
    shiftStartTime: '08:00',
    shiftEndTime: '16:00',
    shiftColor: '#3B82F6',
    rosterDate: input.rosterDate,
    status: 'scheduled',
    swappedWithStaffId: null,
    remarks: null,
    version: 1,
  };
}

function attendanceDay(date: string, status: AttendanceDay['status'] = 'present'): AttendanceDay {
  return {
    tenantId: '100',
    staffId: 1,
    businessDate: date,
    rosterId: 10,
    shiftId: 1,
    firstInTime: '2026-07-02T02:00:00.000Z',
    lastOutTime: '2026-07-02T10:00:00.000Z',
    workedMinutes: 480,
    status,
    projectionVersion: 1,
  };
}

function createCalendar(input?: {
  fridayWeekend?: boolean;
  holiday?: { date: string; type: 'public' | 'optional' | 'restricted' };
}): WorkCalendarService {
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  return {
    async evaluateDay(_tenantId, date) {
      const parsed = new Date(`${date}T00:00:00Z`);
      const dayOfWeek = weekdays[parsed.getUTCDay()];
      const isConfiguredWeekend = Boolean(input?.fridayWeekend && dayOfWeek === 'friday');
      const holiday = input?.holiday?.date === date
        ? { holidayId: 9, name: 'Tenant holiday', type: input.holiday.type }
        : null;
      return {
        date,
        dayOfWeek,
        isConfiguredWeekend,
        holiday,
        isWorkingDay: !isConfiguredWeekend && holiday === null,
      };
    },
    async evaluateDays(tenantId, dates) {
      return Promise.all(dates.map((date) => this.evaluateDay(tenantId, date)));
    },
  };
}

function createHarness(input?: {
  balance?: number;
  calendar?: WorkCalendarService;
  optionalHolidayPolicy?: 'count_as_working_day' | 'count_as_non_working_day';
  rosters?: RosterAssignment[];
  attendanceDays?: AttendanceDay[];
  request?: LeaveRequestRecord;
}) {
  let nextRequestId = 100;
  const categories = new Map<number, LeaveCategoryRecord>([[1, {
    tenantId: '100',
    leaveCategoryId: 1,
    leaveName: 'Casual',
    isActive: true,
  }]]);
  const balance: LeaveBalanceRecord = {
    tenantId: '100',
    staffId: 1,
    leaveCategoryId: 1,
    year: 2026,
    balance: input?.balance ?? 10,
    used: 0,
  };
  const requests = new Map<number, LeaveRequestRecord>();
  if (input?.request) requests.set(input.request.leaveRequestId, structuredClone(input.request));
  const rosterRows = [...(input?.rosters ?? [])];
  const attendance = new Map(
    (input?.attendanceDays ?? []).map((day) => [`${day.staffId}:${day.businessDate}`, structuredClone(day)]),
  );
  const reviewEvents: PreparedLeaveAttendanceEvent[] = [];
  const operationKinds: string[] = [];

  const repository: LeaveMutationRepository<TestStatement> = {
    async getCategory(tenantId, categoryId) {
      const category = categories.get(categoryId);
      return category?.tenantId === tenantId ? structuredClone(category) : null;
    },
    async getBalance(tenantId, staffId, categoryId, year) {
      return balance.tenantId === tenantId
        && balance.staffId === staffId
        && balance.leaveCategoryId === categoryId
        && balance.year === year
        ? structuredClone(balance)
        : null;
    },
    async getRequest(tenantId, requestId) {
      const request = requests.get(requestId);
      return request?.tenantId === tenantId ? structuredClone(request) : null;
    },
    async createRequest(data) {
      const id = nextRequestId++;
      requests.set(id, {
        leaveRequestId: id,
        tenantId: data.tenantId,
        staffId: data.staffId,
        leaveCategoryId: data.leaveCategoryId,
        startDate: data.startDate,
        endDate: data.endDate,
        workingDays: data.workingDays,
        reason: data.reason,
        requestedTo: data.requestedTo,
        status: 'pending',
      });
      return id;
    },
    async listRosterConflicts(tenantId, staffId, startDate, endDate) {
      return rosterRows.filter((row) =>
        row.tenantId === tenantId
        && row.staffId === staffId
        && row.rosterDate >= startDate
        && row.rosterDate <= endDate
        && row.status !== 'cancelled',
      ).map((row) => ({ rosterId: row.rosterId, rosterDate: row.rosterDate, shiftId: row.shiftId }));
    },
    async listExistingAttendanceDays(tenantId, staffId, startDate, endDate) {
      return [...attendance.values()].filter((day) =>
        day.tenantId === tenantId
        && day.staffId === staffId
        && day.businessDate >= startDate
        && day.businessDate <= endDate,
      ).map((day) => structuredClone(day));
    },
    prepareAdjustBalance(data: PreparedLeaveBalanceAdjustment) {
      return () => {
        operationKinds.push('balance');
        if (
          balance.tenantId !== data.tenantId
          || balance.staffId !== data.staffId
          || balance.leaveCategoryId !== data.leaveCategoryId
          || balance.year !== data.year
          || balance.balance < data.deductDays
        ) {
          throw new WorkforceError('LEAVE_BALANCE_INSUFFICIENT', 'Insufficient balance', 409);
        }
        balance.balance -= data.deductDays;
        balance.used += data.deductDays;
      };
    },
    prepareReviewRequest(data: PreparedLeaveReview) {
      return () => {
        operationKinds.push('review');
        const request = requests.get(data.leaveRequestId);
        if (!request || request.tenantId !== data.tenantId || request.status !== data.expectedStatus) {
          throw new WorkforceError('LEAVE_REQUEST_CONFLICT', 'Leave request changed', 409);
        }
        request.status = data.status;
      };
    },
    prepareAttendanceProjection(data: PreparedLeaveAttendanceProjection) {
      return () => {
        operationKinds.push('attendance');
        const key = `${data.staffId}:${data.businessDate}`;
        const day = attendance.get(key);
        if (!day || day.projectionVersion !== data.expectedVersion) {
          throw new WorkforceError('ATTENDANCE_PUNCH_CONFLICT', 'Attendance changed', 409);
        }
        attendance.set(key, {
          ...day,
          status: data.status,
          projectionVersion: data.expectedVersion + 1,
        });
      };
    },
    prepareAttendanceEvent(data: PreparedLeaveAttendanceEvent) {
      return () => {
        operationKinds.push('event');
        const day = attendance.get(`${data.staffId}:${data.businessDate}`);
        if (!day || day.projectionVersion !== data.expectedResultVersion) {
          throw new Error('leave attendance event guard failed');
        }
        reviewEvents.push(structuredClone(data));
      };
    },
  };

  const transaction: WorkforceTransaction<TestStatement> = {
    async commit(statements) {
      const balanceSnapshot = structuredClone(balance);
      const requestSnapshot = new Map([...requests.entries()].map(([id, request]) => [id, structuredClone(request)]));
      const attendanceSnapshot = new Map([...attendance.entries()].map(([key, day]) => [key, structuredClone(day)]));
      const eventSnapshot = reviewEvents.map((event) => structuredClone(event));
      const operationSnapshot = [...operationKinds];
      try {
        statements.forEach((statement) => statement());
      } catch (error) {
        Object.assign(balance, balanceSnapshot);
        requests.clear();
        requestSnapshot.forEach((request, id) => requests.set(id, request));
        attendance.clear();
        attendanceSnapshot.forEach((day, key) => attendance.set(key, day));
        reviewEvents.splice(0, reviewEvents.length, ...eventSnapshot);
        operationKinds.splice(0, operationKinds.length, ...operationSnapshot);
        throw error;
      }
    },
  };

  const workforceMembers = {
    async getMember(tenantId: string, staffId: number) {
      return members.find((member) => member.tenantId === tenantId && member.staffId === staffId) ?? null;
    },
    async getActiveMember(tenantId: string, staffId: number) {
      return members.find((member) =>
        member.tenantId === tenantId && member.staffId === staffId && member.status === 'active',
      ) ?? null;
    },
    async listActiveMembers(tenantId: string) {
      return members.filter((member) => member.tenantId === tenantId && member.status === 'active');
    },
  };

  const service = createLeaveService<TestStatement>({
    workforceMembers,
    leave: repository,
    calendar: input?.calendar ?? createCalendar(),
    transaction,
    clock: { nowUtc: () => '2026-07-01T00:00:00.000Z' },
    publicIds: { next: (prefix) => `${prefix}_${reviewEvents.length + 1}` },
    optionalHolidayPolicy: input?.optionalHolidayPolicy ?? 'count_as_working_day',
  });

  return {
    service,
    balance,
    requests,
    rosterRows,
    attendance,
    reviewEvents,
    operationKinds,
  };
}

function pendingRequest(overrides?: Partial<LeaveRequestRecord>): LeaveRequestRecord {
  return {
    leaveRequestId: 50,
    tenantId: '100',
    staffId: 1,
    leaveCategoryId: 1,
    startDate: '2026-07-02',
    endDate: '2026-07-04',
    workingDays: 2,
    reason: 'Family event',
    requestedTo: 44,
    status: 'pending',
    ...overrides,
  };
}

describe('leave working-day calculation', () => {
  it('excludes a configured Friday weekend instead of using raw calendar days', async () => {
    const { service, requests } = createHarness({
      calendar: createCalendar({ fridayWeekend: true }),
    });

    const result = await service.requestLeave({
      tenantId: '100',
      staffId: 1,
      leaveCategoryId: 1,
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      reason: 'Family event',
      requestedTo: 44,
    });

    expect(result.workingDays).toBe(2);
    expect(requests.get(result.leaveRequestId)?.workingDays).toBe(2);
  });

  it('counts an optional holiday according to the explicit tenant policy', async () => {
    const calendar = createCalendar({ holiday: { date: '2026-07-02', type: 'optional' } });
    const workingPolicy = createHarness({ calendar, optionalHolidayPolicy: 'count_as_working_day' });
    const nonWorkingPolicy = createHarness({ calendar, optionalHolidayPolicy: 'count_as_non_working_day' });

    await expect(workingPolicy.service.calculateWorkingDays('100', '2026-07-02', '2026-07-02'))
      .resolves.toBe(1);
    await expect(nonWorkingPolicy.service.calculateWorkingDays('100', '2026-07-02', '2026-07-02'))
      .resolves.toBe(0);
  });

  it('rejects a request when the reviewed working days exceed balance', async () => {
    const { service } = createHarness({
      balance: 1,
      calendar: createCalendar({ fridayWeekend: true }),
    });

    await expect(service.requestLeave({
      tenantId: '100',
      staffId: 1,
      leaveCategoryId: 1,
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      reason: 'Family event',
      requestedTo: null,
    })).rejects.toMatchObject({ code: 'LEAVE_BALANCE_INSUFFICIENT', httpStatus: 409 });
  });

  it('rejects cross-tenant staff and category references', async () => {
    const { service } = createHarness();
    await expect(service.requestLeave({
      tenantId: '200', staffId: 1, leaveCategoryId: 1,
      startDate: '2026-07-02', endDate: '2026-07-02', reason: null, requestedTo: null,
    })).rejects.toMatchObject({ code: 'WORKFORCE_MEMBER_NOT_FOUND', httpStatus: 404 });

    await expect(service.requestLeave({
      tenantId: '100', staffId: 1, leaveCategoryId: 99,
      startDate: '2026-07-02', endDate: '2026-07-02', reason: null, requestedTo: null,
    })).rejects.toMatchObject({ code: 'LEAVE_CATEGORY_NOT_FOUND', httpStatus: 404 });
  });
});

describe('leave approval reconciliation', () => {
  it('returns visible active-roster conflicts without deleting or cancelling roster rows', async () => {
    const conflictRoster = roster({ rosterId: 10, staffId: 1, shiftId: 1, rosterDate: '2026-07-02' });
    const { service, rosterRows } = createHarness({
      request: pendingRequest(),
      calendar: createCalendar({ fridayWeekend: true }),
      rosters: [conflictRoster],
    });

    const result = await service.reviewLeave({
      tenantId: '100', actorUserId: '44', leaveRequestId: 50,
      status: 'approved', rejectionReason: null,
    });

    expect(result).toEqual({
      leaveRequestId: 50,
      workingDays: 2,
      rosterConflicts: [{ rosterId: 10, rosterDate: '2026-07-02', shiftId: 1 }],
      requiresRosterReview: true,
    });
    expect(rosterRows).toEqual([conflictRoster]);
  });

  it('reprojects existing attendance to leave inside the approval transaction', async () => {
    const { service, attendance, reviewEvents, operationKinds } = createHarness({
      request: pendingRequest({ startDate: '2026-07-02', endDate: '2026-07-02', workingDays: 1 }),
      attendanceDays: [attendanceDay('2026-07-02')],
    });

    await service.reviewLeave({
      tenantId: '100', actorUserId: '44', leaveRequestId: 50,
      status: 'approved', rejectionReason: null,
    });

    expect(attendance.get('1:2026-07-02')).toMatchObject({ status: 'leave', projectionVersion: 2 });
    expect(reviewEvents).toHaveLength(1);
    expect(operationKinds).toEqual(['balance', 'review', 'attendance', 'event']);
  });

  it('rejects approval when current calendar policy no longer matches stored working days', async () => {
    const { service } = createHarness({
      request: pendingRequest({ workingDays: 3 }),
      calendar: createCalendar({ fridayWeekend: true }),
    });

    await expect(service.reviewLeave({
      tenantId: '100', actorUserId: '44', leaveRequestId: 50,
      status: 'approved', rejectionReason: null,
    })).rejects.toMatchObject({ code: 'LEAVE_CALENDAR_POLICY_CHANGED', httpStatus: 409 });
  });

  it('rejects a cross-tenant leave request lookup', async () => {
    const { service } = createHarness({ request: pendingRequest() });
    await expect(service.reviewLeave({
      tenantId: '200', actorUserId: '44', leaveRequestId: 50,
      status: 'approved', rejectionReason: null,
    })).rejects.toMatchObject({ code: 'LEAVE_REQUEST_NOT_FOUND', httpStatus: 404 });
  });

  it('does not alter attendance for rejected or cancelled pending leave', async () => {
    for (const status of ['rejected', 'cancelled'] as const) {
      const day = attendanceDay('2026-07-02');
      const { service, attendance, operationKinds } = createHarness({
        request: pendingRequest(),
        attendanceDays: [day],
      });

      await service.reviewLeave({
        tenantId: '100', actorUserId: '44', leaveRequestId: 50,
        status, rejectionReason: status === 'rejected' ? 'Not eligible' : null,
      });

      expect(attendance.get('1:2026-07-02')).toEqual(day);
      expect(operationKinds).toEqual(['review']);
    }
  });
});
