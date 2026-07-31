import { describe, expect, it } from 'vitest';
import {
  WorkforceError,
  type AttendanceDay,
  type AttendancePunch,
  type RosterAssignment,
  type ShiftDefinition,
  type WorkforceMemberRef,
  type WorkforceTransaction,
} from '../../../src/modules/workforce-management';
import {
  createAttendancePunchService,
  type AttendanceMutationRepository,
  type PreparedAttendanceProjection,
  type PreparedAttendanceProjectionEvent,
  type PreparedAttendancePunch,
} from '../../../src/modules/workforce-management/application/attendance-punch-service';
import { createAttendanceQueryService } from '../../../src/modules/workforce-management/application/attendance-query-service';
import type {
  WorkforceIdempotencyClaim,
  WorkforceIdempotencyCoordinator,
  WorkforceMutationIdentity,
} from '../../../src/modules/workforce-management/infrastructure/d1-workforce-idempotency-repository';

type TestStatement = () => void;

type StoredClaim = {
  requestHash: string;
  status: 'processing' | 'completed' | 'failed';
  result: unknown;
};

class MemoryIdempotency implements WorkforceIdempotencyCoordinator<TestStatement> {
  private readonly records = new Map<string, StoredClaim>();

  private key(identity: WorkforceMutationIdentity): string {
    return `${identity.tenantId}:${identity.mutationType}:${identity.idempotencyKey}`;
  }

  async claim<TResult>(input: WorkforceMutationIdentity & { requestHash: string }): Promise<WorkforceIdempotencyClaim<TResult>> {
    const key = this.key(input);
    const existing = this.records.get(key);
    if (!existing) {
      this.records.set(key, { requestHash: input.requestHash, status: 'processing', result: null });
      return { kind: 'reserved' };
    }
    if (existing.requestHash !== input.requestHash) {
      throw new WorkforceError('IDEMPOTENCY_CONFLICT', 'Different request', 409);
    }
    if (existing.status === 'completed') return { kind: 'replay', result: existing.result as TResult };
    if (existing.status === 'failed') {
      existing.status = 'processing';
      existing.result = null;
      return { kind: 'reserved' };
    }
    throw new WorkforceError('IDEMPOTENCY_CONFLICT', 'Already processing', 409, true);
  }

  prepareComplete<TResult>(input: WorkforceMutationIdentity & { requestHash: string; result: TResult }): TestStatement {
    return () => {
      const existing = this.records.get(this.key(input));
      if (!existing || existing.requestHash !== input.requestHash) throw new Error('Missing idempotency reservation');
      existing.status = 'completed';
      existing.result = input.result;
    };
  }

  async markFailed(input: WorkforceMutationIdentity & { requestHash: string }): Promise<void> {
    const existing = this.records.get(this.key(input));
    if (existing?.requestHash === input.requestHash && existing.status === 'processing') {
      existing.status = 'failed';
    }
  }

  async find<TResult>(identity: WorkforceMutationIdentity) {
    const existing = this.records.get(this.key(identity));
    return existing
      ? { ...identity, requestHash: existing.requestHash, status: existing.status, result: existing.result as TResult | null }
      : null;
  }
}

type StoredPunch = AttendancePunch & {
  businessDate: string;
  requestHash: string;
  reason: string | null;
};

const members: WorkforceMemberRef[] = [
  {
    tenantId: '100', staffId: 1, displayName: 'Nurse Fatima', position: 'Nurse',
    department: 'ICU', status: 'active', userId: 44, practitionerPublicId: null,
  },
  {
    tenantId: '100', staffId: 2, displayName: 'Nurse Rima', position: 'Nurse',
    department: 'ICU', status: 'active', userId: 45, practitionerPublicId: null,
  },
  {
    tenantId: '100', staffId: 3, displayName: 'Inactive Nurse', position: 'Nurse',
    department: 'ICU', status: 'inactive', userId: null, practitionerPublicId: null,
  },
];

const shifts: ShiftDefinition[] = [
  {
    tenantId: '100', shiftId: 1, name: 'Morning', shortCode: 'M', startTime: '08:00',
    endTime: '16:00', gracePeriodMinutes: 10, breakDurationMinutes: 30,
    isNightShift: false, color: '#3B82F6', isActive: true,
  },
  {
    tenantId: '100', shiftId: 2, name: 'Night', shortCode: 'N', startTime: '22:00',
    endTime: '06:00', gracePeriodMinutes: 10, breakDurationMinutes: 30,
    isNightShift: true, color: '#6366F1', isActive: true,
  },
];

function roster(input: {
  rosterId: number;
  staffId: number;
  shiftId: number;
  rosterDate: string;
}): RosterAssignment {
  const shift = shifts.find((item) => item.shiftId === input.shiftId) ?? shifts[0];
  return {
    rosterId: input.rosterId,
    tenantId: '100',
    staffId: input.staffId,
    staffName: members.find((item) => item.staffId === input.staffId)?.displayName ?? `Staff ${input.staffId}`,
    position: 'Nurse',
    department: 'ICU',
    shiftId: input.shiftId,
    shiftName: shift.name,
    shiftShortCode: shift.shortCode,
    shiftStartTime: shift.startTime,
    shiftEndTime: shift.endTime,
    shiftColor: shift.color,
    rosterDate: input.rosterDate,
    status: 'scheduled',
    swappedWithStaffId: null,
    remarks: null,
    version: 1,
  };
}

function createHarness(input?: {
  rosters?: RosterAssignment[];
  leave?: Array<{ staffId: number; startDate: string; endDate: string }>;
  failProjection?: boolean;
}) {
  let nextPunchId = 100;
  const punches: StoredPunch[] = [];
  const days = new Map<string, AttendanceDay>();
  const events: PreparedAttendanceProjectionEvent[] = [];
  const rosters = [...(input?.rosters ?? [])];
  const leave = [...(input?.leave ?? [])];

  const attendanceRepository: AttendanceMutationRepository<TestStatement> = {
    async findPunchBySourceEvent(tenantId, source, sourceEventKey) {
      return punches.find((item) =>
        item.tenantId === tenantId && item.source === source && item.sourceEventKey === sourceEventKey,
      ) ?? null;
    },
    async listPunches(tenantId, staffId, businessDate) {
      return punches
        .filter((item) => item.tenantId === tenantId && item.staffId === staffId && item.businessDate === businessDate)
        .map((item) => structuredClone(item));
    },
    async findDay(tenantId, staffId, businessDate) {
      return structuredClone(days.get(`${tenantId}:${staffId}:${businessDate}`) ?? null);
    },
    async listExpectedRosterWorkers(tenantId, businessDate, department) {
      return rosters
        .filter((item) =>
          item.tenantId === tenantId
          && item.rosterDate === businessDate
          && item.status !== 'cancelled'
          && (!department || item.department === department),
        )
        .map((item) => ({ staffId: item.staffId, rosterId: item.rosterId, shiftId: item.shiftId }));
    },
    prepareInsertPunch(prepared: PreparedAttendancePunch) {
      return () => {
        const duplicate = punches.some((item) =>
          item.tenantId === prepared.tenantId
          && item.source === prepared.source
          && item.sourceEventKey === prepared.sourceEventKey,
        );
        if (duplicate) throw new Error('UNIQUE constraint failed: hr_attendance_punches');
        punches.push({
          punchId: nextPunchId++,
          tenantId: prepared.tenantId,
          staffId: prepared.staffId,
          occurredAtUtc: prepared.occurredAtUtc,
          punchType: prepared.punchType,
          source: prepared.source,
          sourceEventKey: prepared.sourceEventKey,
          businessDate: prepared.businessDate,
          requestHash: prepared.requestHash,
          reason: prepared.reason,
        });
      };
    },
    prepareUpsertProjection(prepared: PreparedAttendanceProjection) {
      return () => {
        if (input?.failProjection) throw new Error('forced projection failure');
        const key = `${prepared.tenantId}:${prepared.staffId}:${prepared.businessDate}`;
        const current = days.get(key);
        if (current && current.projectionVersion !== prepared.expectedVersion) {
          throw new WorkforceError('ATTENDANCE_PUNCH_CONFLICT', 'Projection changed', 409);
        }
        days.set(key, {
          tenantId: prepared.tenantId,
          staffId: prepared.staffId,
          businessDate: prepared.businessDate,
          rosterId: prepared.rosterId,
          shiftId: prepared.shiftId,
          firstInTime: prepared.firstInTime,
          lastOutTime: prepared.lastOutTime,
          workedMinutes: prepared.workedMinutes,
          status: prepared.status,
          projectionVersion: prepared.expectedVersion + 1,
        });
      };
    },
    prepareInsertProjectionEvent(prepared: PreparedAttendanceProjectionEvent) {
      return () => {
        const day = days.get(`${prepared.tenantId}:${prepared.staffId}:${prepared.businessDate}`);
        if (!day || day.projectionVersion !== prepared.expectedResultVersion) {
          throw new Error('attendance projection event guard failed');
        }
        events.push(structuredClone(prepared));
      };
    },
  };

  const workforceMembers = {
    async getMember(tenantId: string, staffId: number) {
      return members.find((item) => item.tenantId === tenantId && item.staffId === staffId) ?? null;
    },
    async getActiveMember(tenantId: string, staffId: number) {
      return members.find((item) => item.tenantId === tenantId && item.staffId === staffId && item.status === 'active') ?? null;
    },
    async listActiveMembers(tenantId: string) {
      return members.filter((item) => item.tenantId === tenantId && item.status === 'active');
    },
  };

  const shiftRepository = {
    async getShift(tenantId: string, shiftId: number) {
      return shifts.find((item) => item.tenantId === tenantId && item.shiftId === shiftId) ?? null;
    },
    async listActiveShifts(tenantId: string) {
      return shifts.filter((item) => item.tenantId === tenantId && item.isActive);
    },
  };

  const rosterRepository = {
    async findById(tenantId: string, rosterId: number) {
      return rosters.find((item) => item.tenantId === tenantId && item.rosterId === rosterId) ?? null;
    },
    async findByStaffDate(tenantId: string, staffId: number, rosterDate: string) {
      return rosters.find((item) =>
        item.tenantId === tenantId && item.staffId === staffId && item.rosterDate === rosterDate,
      ) ?? null;
    },
    async list(criteria: { tenantId: string; from: string; to: string }) {
      return rosters.filter((item) =>
        item.tenantId === criteria.tenantId
        && item.rosterDate >= criteria.from
        && item.rosterDate <= criteria.to,
      );
    },
  };

  const leaveRepository = {
    async findRequest() { return null; },
    async findApprovedLeave(tenantId: string, staffId: number, date: string) {
      const found = leave.find((item) =>
        tenantId === '100'
        && item.staffId === staffId
        && item.startDate <= date
        && item.endDate >= date,
      );
      return found
        ? {
            leaveRequestId: 9,
            staffId,
            startDate: found.startDate,
            endDate: found.endDate,
            workingDays: 1,
            status: 'approved' as const,
          }
        : null;
    },
  };

  const calendar = {
    async evaluateDay(_tenantId: string, date: string) {
      const parsed = new Date(`${date}T00:00:00Z`);
      const isSaturday = parsed.getUTCDay() === 6;
      return {
        date,
        dayOfWeek: isSaturday ? 'saturday' as const : 'sunday' as const,
        isConfiguredWeekend: isSaturday,
        holiday: null,
        isWorkingDay: !isSaturday,
      };
    },
    async evaluateDays(tenantId: string, dates: readonly string[]) {
      return Promise.all(dates.map((date) => this.evaluateDay(tenantId, date)));
    },
  };

  const transaction: WorkforceTransaction<TestStatement> = {
    async commit(statements) {
      const punchSnapshot = punches.map((item) => structuredClone(item));
      const daySnapshot = new Map([...days.entries()].map(([key, value]) => [key, structuredClone(value)]));
      const eventSnapshot = events.map((item) => structuredClone(item));
      try {
        statements.forEach((statement) => statement());
      } catch (error) {
        punches.splice(0, punches.length, ...punchSnapshot);
        days.clear();
        daySnapshot.forEach((value, key) => days.set(key, value));
        events.splice(0, events.length, ...eventSnapshot);
        throw error;
      }
    },
  };

  const queryService = createAttendanceQueryService({
    attendance: attendanceRepository,
    rosters: rosterRepository,
    shifts: shiftRepository,
    leave: leaveRepository,
    calendar,
    timezoneOffsetMinutes: 360,
  });

  const punchService = createAttendancePunchService<TestStatement>({
    workforceMembers,
    attendance: attendanceRepository,
    query: queryService,
    idempotency: new MemoryIdempotency(),
    transaction,
    clock: { nowUtc: () => '2026-07-27T00:00:00.000Z' },
    publicIds: { next: (prefix) => `${prefix}_${events.length + 1}` },
  });

  return { punchService, queryService, punches, days, events };
}

const manualPunch = {
  tenantId: '100',
  actorUserId: '44',
  staffId: 1,
  occurredAtUtc: '2026-07-27T02:05:00.000Z',
  punchType: 'in' as const,
  source: 'manual' as const,
  sourceEventKey: 'manual:attendance:1:2026-07-27:in',
  reason: 'Front desk correction',
};

describe('attendance punch integrity', () => {
  it('replays the original result for the same source event and request hash', async () => {
    const { punchService, punches } = createHarness({
      rosters: [roster({ rosterId: 1, staffId: 1, shiftId: 1, rosterDate: '2026-07-27' })],
    });

    const first = await punchService.recordPunch(manualPunch);
    const replay = await punchService.recordPunch(manualPunch);

    expect(replay).toEqual(first);
    expect(punches).toHaveLength(1);
  });

  it('throws ATTENDANCE_PUNCH_CONFLICT when the source event key is reused for different input', async () => {
    const { punchService } = createHarness({
      rosters: [roster({ rosterId: 1, staffId: 1, shiftId: 1, rosterDate: '2026-07-27' })],
    });
    await punchService.recordPunch(manualPunch);

    await expect(punchService.recordPunch({ ...manualPunch, punchType: 'out' }))
      .rejects.toMatchObject({ code: 'ATTENDANCE_PUNCH_CONFLICT', httpStatus: 409 });
  });

  it('rejects a cross-tenant staff reference', async () => {
    const { punchService } = createHarness();
    await expect(punchService.recordPunch({ ...manualPunch, tenantId: '200' }))
      .rejects.toMatchObject({ code: 'WORKFORCE_MEMBER_NOT_FOUND', httpStatus: 404 });
  });

  it('rejects an inactive staff member', async () => {
    const { punchService } = createHarness();
    await expect(punchService.recordPunch({ ...manualPunch, staffId: 3 }))
      .rejects.toMatchObject({ code: 'WORKFORCE_MEMBER_INACTIVE', httpStatus: 409 });
  });

  it('maps an overnight 02:00 local punch to the previous roster business date', async () => {
    const { punchService } = createHarness({
      rosters: [roster({ rosterId: 2, staffId: 1, shiftId: 2, rosterDate: '2026-07-26' })],
    });

    const result = await punchService.recordPunch({
      ...manualPunch,
      occurredAtUtc: '2026-07-26T20:00:00.000Z',
      sourceEventKey: 'manual:night:1',
    });

    expect(result.businessDate).toBe('2026-07-26');
    expect(result.rosterId).toBe(2);
  });

  it('requires a reason for manual correction punches', async () => {
    const { punchService } = createHarness();
    await expect(punchService.recordPunch({ ...manualPunch, reason: ' ' }))
      .rejects.toMatchObject({ code: 'ATTENDANCE_CORRECTION_REASON_REQUIRED', httpStatus: 422 });
  });

  it('rolls back raw punch and projection together when projection fails', async () => {
    const { punchService, punches, days } = createHarness({
      rosters: [roster({ rosterId: 1, staffId: 1, shiftId: 1, rosterDate: '2026-07-27' })],
      failProjection: true,
    });

    await expect(punchService.recordPunch(manualPunch)).rejects.toThrow('forced projection failure');
    expect(punches).toHaveLength(0);
    expect(days).toHaveLength(0);
  });
});

describe('deterministic attendance projection', () => {
  it('projects approved leave before absence', async () => {
    const { queryService } = createHarness({
      rosters: [roster({ rosterId: 1, staffId: 1, shiftId: 1, rosterDate: '2026-07-27' })],
      leave: [{ staffId: 1, startDate: '2026-07-27', endDate: '2026-07-27' }],
    });

    await expect(queryService.projectDay({ tenantId: '100', staffId: 1, businessDate: '2026-07-27' }))
      .resolves.toMatchObject({ status: 'leave', workedMinutes: 0 });
  });

  it('projects configured off-day when no active roster exists', async () => {
    const { queryService } = createHarness();
    await expect(queryService.projectDay({ tenantId: '100', staffId: 1, businessDate: '2026-08-01' }))
      .resolves.toMatchObject({ status: 'off_day', rosterId: null });
  });

  it('lets an active roster override a configured weekend', async () => {
    const { queryService } = createHarness({
      rosters: [roster({ rosterId: 7, staffId: 1, shiftId: 1, rosterDate: '2026-08-01' })],
    });
    await expect(queryService.projectDay({ tenantId: '100', staffId: 1, businessDate: '2026-08-01' }))
      .resolves.toMatchObject({ status: 'absent', rosterId: 7 });
  });

  it('projects IN without OUT as incomplete with zero worked minutes', async () => {
    const { queryService } = createHarness({
      rosters: [roster({ rosterId: 1, staffId: 1, shiftId: 1, rosterDate: '2026-07-27' })],
    });
    await expect(queryService.projectDay({
      tenantId: '100',
      staffId: 1,
      businessDate: '2026-07-27',
      punches: [{
        punchId: 1,
        tenantId: '100',
        staffId: 1,
        occurredAtUtc: '2026-07-27T02:05:00.000Z',
        punchType: 'in',
        source: 'manual',
        sourceEventKey: 'in-1',
      }],
    })).resolves.toMatchObject({ status: 'incomplete', workedMinutes: 0 });
  });

  it('selects only expected roster workers without leave or an existing projection for absence', async () => {
    const { queryService, days } = createHarness({
      rosters: [
        roster({ rosterId: 1, staffId: 1, shiftId: 1, rosterDate: '2026-07-27' }),
        roster({ rosterId: 2, staffId: 2, shiftId: 1, rosterDate: '2026-07-27' }),
      ],
      leave: [{ staffId: 2, startDate: '2026-07-27', endDate: '2026-07-27' }],
    });
    days.set('100:99:2026-07-27', {
      tenantId: '100', staffId: 99, businessDate: '2026-07-27', rosterId: null,
      shiftId: null, firstInTime: null, lastOutTime: null, workedMinutes: 0,
      status: 'absent', projectionVersion: 1,
    });

    await expect(queryService.listExpectedAbsences({
      tenantId: '100', businessDate: '2026-07-27', department: 'ICU',
    })).resolves.toEqual([{ staffId: 1, rosterId: 1, shiftId: 1 }]);
  });
});
