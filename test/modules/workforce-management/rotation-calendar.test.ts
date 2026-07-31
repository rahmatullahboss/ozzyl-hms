import { describe, expect, it } from 'vitest';
import {
  WorkforceError,
  createD1RotationRepository,
  createD1WorkCalendarRepository,
  mapRotationPattern,
  type RosterAssignment,
  type RotationPattern,
  type ShiftDefinition,
  type WorkforceMemberRef,
  type WorkforceTransaction,
} from '../../../src/modules/workforce-management';
import { createWorkCalendarService } from '../../../src/modules/workforce-management/application/work-calendar-service';
import type { WorkCalendarRepository } from '../../../src/modules/workforce-management/application/ports';
import {
  createRotationService,
  type RotationAssignmentRecord,
  type RotationMutationRepository,
  type RotationRosterRepository,
} from '../../../src/modules/workforce-management/application/rotation-service';
import type {
  WorkforceIdempotencyClaim,
  WorkforceIdempotencyCoordinator,
  WorkforceMutationIdentity,
} from '../../../src/modules/workforce-management/infrastructure/d1-workforce-idempotency-repository';
import type {
  PreparedRosterEvent,
  PreparedRosterInsert,
  PreparedRosterUpdate,
} from '../../../src/modules/workforce-management/application/roster-service';

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
      return { kind: 'reserved' };
    }
    throw new WorkforceError('IDEMPOTENCY_CONFLICT', 'Already processing', 409, true);
  }

  prepareComplete<TResult>(input: WorkforceMutationIdentity & { requestHash: string; result: TResult }): TestStatement {
    return () => {
      const existing = this.records.get(this.key(input));
      if (!existing || existing.requestHash !== input.requestHash) throw new Error('Missing reservation');
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

const shifts: ShiftDefinition[] = [
  {
    tenantId: '100', shiftId: 3, name: 'Morning', shortCode: 'M', startTime: '08:00',
    endTime: '16:00', gracePeriodMinutes: 10, breakDurationMinutes: 30,
    isNightShift: false, color: '#3B82F6', isActive: true,
  },
  {
    tenantId: '100', shiftId: 4, name: 'Night', shortCode: 'N', startTime: '22:00',
    endTime: '06:00', gracePeriodMinutes: 10, breakDurationMinutes: 30,
    isNightShift: true, color: '#6366F1', isActive: true,
  },
];

const members: WorkforceMemberRef[] = Array.from({ length: 12 }, (_, index) => ({
  tenantId: '100',
  staffId: index + 1,
  displayName: `Staff ${index + 1}`,
  position: 'Nurse',
  department: 'ICU',
  status: 'active' as const,
  userId: null,
  practitionerPublicId: null,
}));

function rosterAssignment(input: {
  rosterId: number;
  staffId: number;
  shiftId: number;
  rosterDate: string;
  status?: RosterAssignment['status'];
  version?: number;
}): RosterAssignment {
  const shift = shifts.find((item) => item.shiftId === input.shiftId) ?? shifts[0];
  return {
    rosterId: input.rosterId,
    tenantId: '100',
    staffId: input.staffId,
    staffName: `Staff ${input.staffId}`,
    position: 'Nurse',
    department: 'ICU',
    shiftId: input.shiftId,
    shiftName: shift.name,
    shiftShortCode: shift.shortCode,
    shiftStartTime: shift.startTime,
    shiftEndTime: shift.endTime,
    shiftColor: shift.color,
    rosterDate: input.rosterDate,
    status: input.status ?? 'scheduled',
    swappedWithStaffId: null,
    remarks: null,
    version: input.version ?? 1,
  };
}

function rotationPattern(
  pattern: Record<string, unknown>,
  days: Array<Record<string, unknown>>,
): RotationPattern {
  return { tenantId: '100', ...mapRotationPattern(pattern, days) };
}

function createCalendarRepository(): WorkCalendarRepository {
  return {
    async listWeekendPolicies(tenantId, year) {
      if (tenantId !== '100' || year !== 2026) return [];
      return [{ weekday: 'saturday', weekPattern: 'every', isActive: true }];
    },
    async getHoliday(tenantId, date) {
      if (tenantId === '100' && date === '2026-12-16') {
        return { holidayId: 9, name: 'Victory Day', type: 'public' };
      }
      return null;
    },
  };
}

function createHarness(input?: {
  initialRoster?: RosterAssignment[];
  rotationAssignments?: RotationAssignmentRecord[];
}) {
  let nextRosterId = 500;
  let nextPatternId = 20;
  let nextAssignmentId = 30;
  const rosterState = new Map<string, RosterAssignment>();
  const events: PreparedRosterEvent[] = [];
  const patterns = new Map<number, RotationPattern>();
  const assignments: RotationAssignmentRecord[] = [...(input?.rotationAssignments ?? [])];

  for (const row of input?.initialRoster ?? []) {
    rosterState.set(`${row.staffId}:${row.rosterDate}`, structuredClone(row));
    nextRosterId = Math.max(nextRosterId, row.rosterId + 1);
  }

  patterns.set(5, rotationPattern(
    { id: 5, pattern_name: 'Three day ICU', cycle_days: 3, is_active: 1 },
    [
      { day_number: 1, shift_id: 3, shift_name: 'Morning', is_off: 0 },
      { day_number: 3, shift_id: 4, shift_name: 'Night', is_off: 0 },
    ],
  ));
  patterns.set(6, rotationPattern(
    { id: 6, pattern_name: 'Inactive', cycle_days: 1, is_active: 0 },
    [{ day_number: 1, shift_id: 3, shift_name: 'Morning', is_off: 0 }],
  ));
  patterns.set(7, rotationPattern(
    { id: 7, pattern_name: 'Daily morning', cycle_days: 1, is_active: 1 },
    [{ day_number: 1, shift_id: 3, shift_name: 'Morning', is_off: 0 }],
  ));

  const rosterRepository: RotationRosterRepository<TestStatement> = {
    async findById(_tenantId, rosterId) {
      return [...rosterState.values()].find((item) => item.rosterId === rosterId) ?? null;
    },
    async findByStaffDate(tenantId, staffId, rosterDate) {
      const row = rosterState.get(`${staffId}:${rosterDate}`);
      return row?.tenantId === tenantId ? structuredClone(row) : null;
    },
    async list(criteria) {
      return [...rosterState.values()].filter((row) =>
        row.tenantId === criteria.tenantId
        && row.rosterDate >= criteria.from
        && row.rosterDate <= criteria.to,
      ).map((item) => structuredClone(item));
    },
    async listForStaffRange(tenantId, staffIds, from, to) {
      return [...rosterState.values()].filter((row) =>
        row.tenantId === tenantId
        && staffIds.includes(row.staffId)
        && row.rosterDate >= from
        && row.rosterDate <= to,
      ).map((item) => structuredClone(item));
    },
    prepareInsertAssignment(prepared: PreparedRosterInsert) {
      return () => {
        const key = `${prepared.staffId}:${prepared.rosterDate}`;
        if (rosterState.has(key)) throw new Error('UNIQUE constraint failed: hr_duty_roster');
        rosterState.set(key, rosterAssignment({
          rosterId: nextRosterId++,
          staffId: prepared.staffId,
          shiftId: prepared.shiftId,
          rosterDate: prepared.rosterDate,
        }));
      };
    },
    prepareUpdateAssignment(prepared: PreparedRosterUpdate) {
      return () => {
        const key = `${prepared.staffId}:${prepared.rosterDate}`;
        const current = rosterState.get(key);
        if (!current || current.version !== prepared.expectedVersion) {
          throw new WorkforceError('ROSTER_CONFLICT', 'Roster changed', 409);
        }
        rosterState.set(key, {
          ...current,
          shiftId: prepared.shiftId,
          shiftName: shifts.find((shift) => shift.shiftId === prepared.shiftId)?.name ?? current.shiftName,
          status: prepared.status,
          swappedWithStaffId: prepared.swappedWithStaffId,
          remarks: prepared.remarks,
          version: current.version + 1,
        });
      };
    },
    prepareInsertEvent(prepared: PreparedRosterEvent) {
      return () => events.push(structuredClone(prepared));
    },
  };

  const rotationRepository: RotationMutationRepository = {
    async listPatterns(tenantId, activeOnly = false) {
      return [...patterns.values()].filter((pattern) =>
        pattern.tenantId === tenantId && (!activeOnly || pattern.isActive),
      ).map((item) => structuredClone(item));
    },
    async getPattern(tenantId, patternId) {
      const pattern = patterns.get(patternId);
      return pattern?.tenantId === tenantId ? structuredClone(pattern) : null;
    },
    async createPattern(data) {
      const id = nextPatternId++;
      patterns.set(id, {
        patternId: id,
        tenantId: data.tenantId,
        patternName: data.patternName,
        cycleDays: data.cycleDays,
        isActive: true,
        days: Array.from({ length: data.cycleDays }, (_, index) => {
          const day = data.workingDays.find((candidate) => candidate.dayNumber === index + 1);
          return day
            ? { dayNumber: index + 1, shiftId: day.shiftId, shiftName: shifts.find((shift) => shift.shiftId === day.shiftId)?.name ?? null, isOff: false }
            : { dayNumber: index + 1, shiftId: null, shiftName: null, isOff: true };
        }),
      });
      return id;
    },
    async assignPattern(data) {
      assignments.push({
        assignmentId: nextAssignmentId++,
        tenantId: data.tenantId,
        staffId: data.staffId,
        patternId: data.patternId,
        startDate: data.startDate,
        endDate: data.endDate,
        cycleOffset: data.cycleOffset,
        isActive: true,
        patternIsActive: true,
        cycleDays: patterns.get(data.patternId)?.cycleDays ?? 1,
        days: patterns.get(data.patternId)?.days ?? [],
      });
      return nextAssignmentId - 1;
    },
    async listRotationAssignments(tenantId, from, to) {
      return assignments.filter((row) =>
        row.tenantId === tenantId
        && row.startDate <= to
        && (row.endDate === null || row.endDate >= from),
      ).map((item) => structuredClone(item));
    },
  };

  const transaction: WorkforceTransaction<TestStatement> = {
    async commit(statements) {
      const rosterSnapshot = new Map([...rosterState.entries()].map(([key, value]) => [key, structuredClone(value)]));
      const eventSnapshot = events.map((item) => structuredClone(item));
      try {
        statements.forEach((statement) => statement());
      } catch (error) {
        rosterState.clear();
        rosterSnapshot.forEach((value, key) => rosterState.set(key, value));
        events.splice(0, events.length, ...eventSnapshot);
        throw error;
      }
    },
  };

  const workforceMembers = {
    async getMember(tenantId: string, staffId: number) {
      return members.find((member) => member.tenantId === tenantId && member.staffId === staffId) ?? null;
    },
    async getActiveMember(tenantId: string, staffId: number) {
      return members.find((member) => member.tenantId === tenantId && member.staffId === staffId && member.status === 'active') ?? null;
    },
    async listActiveMembers(tenantId: string) {
      return members.filter((member) => member.tenantId === tenantId && member.status === 'active');
    },
  };

  const shiftRepository = {
    async getShift(tenantId: string, shiftId: number) {
      return shifts.find((shift) => shift.tenantId === tenantId && shift.shiftId === shiftId) ?? null;
    },
    async listActiveShifts(tenantId: string) {
      return shifts.filter((shift) => shift.tenantId === tenantId && shift.isActive);
    },
  };

  const calendar = createWorkCalendarService({ calendar: createCalendarRepository() });
  const service = createRotationService<TestStatement>({
    workforceMembers,
    shifts: shiftRepository,
    rotations: rotationRepository,
    rosters: rosterRepository,
    calendar,
    idempotency: new MemoryIdempotency(),
    transaction,
    clock: { nowUtc: () => '2026-07-26T14:00:00.000Z' },
    publicIds: { next: (prefix) => `${prefix}_${events.length + 1}` },
  });

  return { service, calendar, rosterState, events, assignments, patterns };
}

describe('tenant work calendar', () => {
  it('does not hardcode Sunday as a weekend', async () => {
    const { calendar } = createHarness();
    await expect(calendar.evaluateDay('100', '2026-08-02')).resolves.toMatchObject({
      dayOfWeek: 'sunday',
      isConfiguredWeekend: false,
      isWorkingDay: true,
    });
  });

  it('applies only the configured Saturday policy', async () => {
    const { calendar } = createHarness();
    await expect(calendar.evaluateDay('100', '2026-08-01')).resolves.toMatchObject({
      dayOfWeek: 'saturday',
      isConfiguredWeekend: true,
      isWorkingDay: false,
    });
  });

  it('reports an active holiday as a non-working day', async () => {
    const { calendar } = createHarness();
    await expect(calendar.evaluateDay('100', '2026-12-16')).resolves.toMatchObject({
      holiday: { holidayId: 9, name: 'Victory Day', type: 'public' },
      isWorkingDay: false,
    });
  });
});

describe('rotation and roster planning', () => {
  it('reconstructs a missing legacy rotation day as an off-day', () => {
    const pattern = mapRotationPattern(
      { id: 5, pattern_name: 'Three day ICU', cycle_days: 3, is_active: 1 },
      [
        { day_number: 1, shift_id: 3, shift_name: 'Morning', is_off: 0 },
        { day_number: 3, shift_id: 4, shift_name: 'Night', is_off: 0 },
      ],
    );
    expect(pattern.days[1]).toEqual({ dayNumber: 2, shiftId: null, shiftName: null, isOff: true });
  });

  it('rejects assignment to an inactive rotation pattern', async () => {
    const { service } = createHarness();
    await expect(service.assignPattern({
      tenantId: '100', actorUserId: '44', staffId: 1, patternId: 6,
      startDate: '2026-07-27', endDate: null, cycleOffset: 0,
      idempotencyKey: 'rotation:assign:1:6:2026-07-27',
    })).rejects.toMatchObject({ code: 'ROTATION_INACTIVE', httpStatus: 409 });
  });

  it('requires an active tenant-owned staff member for rotation assignment', async () => {
    const { service } = createHarness();
    await expect(service.assignPattern({
      tenantId: '200', actorUserId: '44', staffId: 1, patternId: 5,
      startDate: '2026-07-27', endDate: null, cycleOffset: 0,
      idempotencyKey: 'rotation:assign:1:5:2026-07-27',
    })).rejects.toMatchObject({ code: 'WORKFORCE_MEMBER_NOT_FOUND', httpStatus: 404 });
  });

  it('all_dates mode includes configured weekends and ordinary Sundays', async () => {
    const { service } = createHarness();
    const result = await service.bulkAssign({
      tenantId: '100', actorUserId: '44',
      assignments: [{ staffId: 1, shiftId: 3 }],
      startDate: '2026-08-01', endDate: '2026-08-02', dateMode: 'all_dates',
      idempotencyKey: 'roster:bulk:all-dates-weekend',
    });
    expect(result).toEqual({ created: 2, updated: 0, skipped: 0 });
  });

  it('configured_working_days skips only policy-matched dates', async () => {
    const { service } = createHarness();
    const result = await service.bulkAssign({
      tenantId: '100', actorUserId: '44',
      assignments: [{ staffId: 1, shiftId: 3 }],
      startDate: '2026-08-01', endDate: '2026-08-02', dateMode: 'configured_working_days',
      idempotencyKey: 'roster:bulk:configured-weekend',
    });
    expect(result).toEqual({ created: 1, updated: 0, skipped: 1 });
  });

  it('ignores inactive staff-rotation and inactive pattern records during generation', async () => {
    const { service } = createHarness({
      rotationAssignments: [
        {
          assignmentId: 1, tenantId: '100', staffId: 1, patternId: 7,
          startDate: '2026-07-27', endDate: null, cycleOffset: 0,
          isActive: true, patternIsActive: true, cycleDays: 1,
          days: [{ dayNumber: 1, shiftId: 3, shiftName: 'Morning', isOff: false }],
        },
        {
          assignmentId: 2, tenantId: '100', staffId: 2, patternId: 7,
          startDate: '2026-07-27', endDate: null, cycleOffset: 0,
          isActive: false, patternIsActive: true, cycleDays: 1,
          days: [{ dayNumber: 1, shiftId: 3, shiftName: 'Morning', isOff: false }],
        },
        {
          assignmentId: 3, tenantId: '100', staffId: 3, patternId: 6,
          startDate: '2026-07-27', endDate: null, cycleOffset: 0,
          isActive: true, patternIsActive: false, cycleDays: 1,
          days: [{ dayNumber: 1, shiftId: 3, shiftName: 'Morning', isOff: false }],
        },
      ],
    });

    await expect(service.generate({
      tenantId: '100', actorUserId: '44', startDate: '2026-07-27', endDate: '2026-07-27',
      replaceExisting: false, idempotencyKey: 'roster:generate:active-only:1',
    })).resolves.toEqual({ created: 1, unchanged: 0, skipped: 0 });
  });

  it('is rerunnable and the second execution creates zero rows', async () => {
    const { service } = createHarness({
      rotationAssignments: [{
        assignmentId: 1, tenantId: '100', staffId: 1, patternId: 7,
        startDate: '2026-07-27', endDate: null, cycleOffset: 0,
        isActive: true, patternIsActive: true, cycleDays: 1,
        days: [{ dayNumber: 1, shiftId: 3, shiftName: 'Morning', isOff: false }],
      }],
    });

    await expect(service.generate({
      tenantId: '100', actorUserId: '44', startDate: '2026-07-27', endDate: '2026-07-28',
      replaceExisting: false, idempotencyKey: 'roster:generate:first-pass',
    })).resolves.toEqual({ created: 2, unchanged: 0, skipped: 0 });

    await expect(service.generate({
      tenantId: '100', actorUserId: '44', startDate: '2026-07-27', endDate: '2026-07-28',
      replaceExisting: false, idempotencyKey: 'roster:generate:second-pass',
    })).resolves.toEqual({ created: 0, unchanged: 2, skipped: 0 });
  });

  it('never overwrites a manual roster assignment', async () => {
    const manual = rosterAssignment({ rosterId: 10, staffId: 1, shiftId: 4, rosterDate: '2026-07-27' });
    const { service, rosterState } = createHarness({
      initialRoster: [manual],
      rotationAssignments: [{
        assignmentId: 1, tenantId: '100', staffId: 1, patternId: 7,
        startDate: '2026-07-27', endDate: null, cycleOffset: 0,
        isActive: true, patternIsActive: true, cycleDays: 1,
        days: [{ dayNumber: 1, shiftId: 3, shiftName: 'Morning', isOff: false }],
      }],
    });

    await expect(service.generate({
      tenantId: '100', actorUserId: '44', startDate: '2026-07-27', endDate: '2026-07-27',
      replaceExisting: false, idempotencyKey: 'roster:generate:manual-safe',
    })).resolves.toEqual({ created: 0, unchanged: 1, skipped: 0 });
    expect(rosterState.get('1:2026-07-27')).toMatchObject({ shiftId: 4, version: 1 });
  });

  it('rejects a range longer than 62 days', async () => {
    const { service } = createHarness();
    await expect(service.bulkAssign({
      tenantId: '100', actorUserId: '44', assignments: [{ staffId: 1, shiftId: 3 }],
      startDate: '2026-07-01', endDate: '2026-09-01', dateMode: 'all_dates',
      idempotencyKey: 'roster:bulk:too-long',
    })).rejects.toMatchObject({ code: 'REQUEST_LIMIT_EXCEEDED', httpStatus: 422 });
  });

  it('rejects more than 500 planned mutations', async () => {
    const { service } = createHarness();
    await expect(service.bulkAssign({
      tenantId: '100', actorUserId: '44',
      assignments: Array.from({ length: 9 }, (_, index) => ({ staffId: index + 1, shiftId: 3 })),
      startDate: '2026-07-01', endDate: '2026-08-31', dateMode: 'all_dates',
      idempotencyKey: 'roster:bulk:too-many',
    })).rejects.toMatchObject({ code: 'REQUEST_LIMIT_EXCEEDED', httpStatus: 422 });
  });
});

type RecordedD1Query = {
  sql: string;
  params: unknown[];
  method: 'all' | 'first' | 'run';
};

type RecordingResolver = (
  sql: string,
  params: unknown[],
  method: RecordedD1Query['method'],
) => {
  rows?: Array<Record<string, unknown>>;
  first?: Record<string, unknown> | null;
  changes?: number;
  lastRowId?: number;
} | null;

function createRecordingDb(resolver: RecordingResolver) {
  const queries: RecordedD1Query[] = [];
  const batchCalls: Array<Array<{ sql: string; params: unknown[] }>> = [];

  const db = {
    prepare(sql: string) {
      let params: unknown[] = [];
      const statement = {
        __sql: sql,
        get __params() { return params; },
        bind(...values: unknown[]) {
          params = values;
          return statement;
        },
        async all() {
          queries.push({ sql, params, method: 'all' });
          const result = resolver(sql, params, 'all');
          return { results: result?.rows ?? [], meta: { changes: result?.changes ?? 0 } };
        },
        async first() {
          queries.push({ sql, params, method: 'first' });
          const result = resolver(sql, params, 'first');
          return result?.first ?? result?.rows?.[0] ?? null;
        },
        async run() {
          queries.push({ sql, params, method: 'run' });
          const result = resolver(sql, params, 'run');
          return {
            meta: {
              changes: result?.changes ?? 1,
              last_row_id: result?.lastRowId ?? 1,
            },
          };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ __sql: string; __params: unknown[]; run(): Promise<unknown> }>) {
      batchCalls.push(statements.map((statement) => ({
        sql: statement.__sql,
        params: [...statement.__params],
      })));
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;

  return { db, queries, batchCalls };
}

describe('D1 rotation and calendar adapters', () => {
  it('maps legacy weekend patterns into canonical calendar rules', async () => {
    const { db } = createRecordingDb((sql) => {
      if (sql.includes('FROM hr_weekend_policies')) {
        return {
          rows: [{
            day_of_week: 'friday',
            week_pattern: 'first_and_third',
            is_active: 1,
          }],
        };
      }
      return { first: null };
    });

    await expect(createD1WorkCalendarRepository(db).listWeekendPolicies('100', 2026))
      .resolves.toEqual([{ weekday: 'friday', weekPattern: '1st_3rd', isActive: true }]);
  });

  it('queries only active tenant-owned rotation assignments and patterns', async () => {
    const { db, queries } = createRecordingDb((sql) => {
      if (sql.includes('FROM hr_staff_rotations sr')) {
        return {
          rows: [{
            assignment_id: 11,
            tenant_id: '100',
            staff_id: 1,
            pattern_id: 7,
            start_date: '2026-07-27',
            end_date: null,
            cycle_offset: 0,
            assignment_active: 1,
            pattern_active: 1,
            pattern_name: 'Daily morning',
            cycle_days: 1,
          }],
        };
      }
      if (sql.includes('FROM hr_rotation_pattern_days d')) {
        return {
          rows: [{ day_number: 1, shift_id: 3, is_off: 0, shift_name: 'Morning' }],
        };
      }
      return null;
    });

    const rows = await createD1RotationRepository(db)
      .listRotationAssignments('100', '2026-07-27', '2026-07-31');

    expect(rows).toHaveLength(1);
    const assignmentSql = queries.find((query) => query.sql.includes('FROM hr_staff_rotations sr'))?.sql ?? '';
    expect(assignmentSql).toContain('sr.is_active = 1');
    expect(assignmentSql).toContain('rp.is_active = 1');
    expect(assignmentSql).toContain("s.status = 'active'");
  });

  it('persists only working rotation days and omits off-day rows', async () => {
    const { db, batchCalls } = createRecordingDb((sql) => {
      if (sql.includes('INSERT INTO hr_rotation_patterns')) {
        return { changes: 1, lastRowId: 77 };
      }
      return { changes: 1 };
    });

    const patternId = await createD1RotationRepository(db).createPattern({
      tenantId: '100',
      patternName: 'Three day ICU',
      cycleDays: 3,
      workingDays: [
        { dayNumber: 1, shiftId: 3 },
        { dayNumber: 3, shiftId: 4 },
      ],
    });

    expect(patternId).toBe(77);
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toHaveLength(2);
    expect(batchCalls[0].map((statement) => statement.params.slice(1)))
      .toEqual([[1, 3], [3, 4]]);
  });
});
