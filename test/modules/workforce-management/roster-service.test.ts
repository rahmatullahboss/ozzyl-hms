import { describe, expect, it, vi } from 'vitest';
import {
  WorkforceError,
  type RosterAssignment,
  type ShiftDefinition,
  type WorkforceMemberRef,
  type WorkforceTransaction,
} from '../../../src/modules/workforce-management';
import {
  createRosterService,
  type PreparedRosterEvent,
  type PreparedRosterInsert,
  type PreparedRosterUpdate,
  type RosterMutationRepository,
} from '../../../src/modules/workforce-management/application/roster-service';
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
    const record = this.records.get(key);
    if (!record) {
      this.records.set(key, { requestHash: input.requestHash, status: 'processing', result: null });
      return { kind: 'reserved' };
    }
    if (record.requestHash !== input.requestHash) {
      throw new WorkforceError('IDEMPOTENCY_CONFLICT', 'Different request', 409);
    }
    if (record.status === 'completed') return { kind: 'replay', result: record.result as TResult };
    if (record.status === 'failed') {
      record.status = 'processing';
      return { kind: 'reserved' };
    }
    throw new WorkforceError('IDEMPOTENCY_CONFLICT', 'Already processing', 409, true);
  }

  prepareComplete<TResult>(input: WorkforceMutationIdentity & { requestHash: string; result: TResult }): TestStatement {
    return () => {
      const record = this.records.get(this.key(input));
      if (!record || record.requestHash !== input.requestHash) throw new Error('Missing reservation');
      record.status = 'completed';
      record.result = input.result;
    };
  }

  async markFailed(input: WorkforceMutationIdentity & { requestHash: string }): Promise<void> {
    const record = this.records.get(this.key(input));
    if (record?.requestHash === input.requestHash && record.status === 'processing') record.status = 'failed';
  }

  async find<TResult>(identity: WorkforceMutationIdentity) {
    const record = this.records.get(this.key(identity));
    return record
      ? { ...identity, requestHash: record.requestHash, status: record.status, result: record.result as TResult | null }
      : null;
  }
}

const members: WorkforceMemberRef[] = [
  {
    tenantId: '100', staffId: 21, displayName: 'Nurse Fatima', position: 'Nurse',
    department: 'ICU', status: 'active', userId: 44, practitionerPublicId: null,
  },
  {
    tenantId: '100', staffId: 22, displayName: 'Nurse Rima', position: 'Nurse',
    department: 'ICU', status: 'active', userId: 45, practitionerPublicId: null,
  },
  {
    tenantId: '100', staffId: 23, displayName: 'Nurse Inactive', position: 'Nurse',
    department: 'ICU', status: 'inactive', userId: null, practitionerPublicId: null,
  },
];

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
  {
    tenantId: '100', shiftId: 8, name: 'Retired', shortCode: 'R', startTime: '09:00',
    endTime: '17:00', gracePeriodMinutes: 0, breakDurationMinutes: 0,
    isNightShift: false, color: null, isActive: false,
  },
];

function assignment(input: Partial<RosterAssignment> & Pick<RosterAssignment, 'rosterId' | 'staffId' | 'shiftId'>): RosterAssignment {
  const member = members.find((item) => item.staffId === input.staffId) ?? members[0];
  const shift = shifts.find((item) => item.shiftId === input.shiftId) ?? shifts[0];
  return {
    rosterId: input.rosterId,
    tenantId: input.tenantId ?? '100',
    staffId: input.staffId,
    staffName: input.staffName ?? member.displayName,
    position: input.position ?? member.position,
    department: input.department ?? member.department,
    shiftId: input.shiftId,
    shiftName: input.shiftName ?? shift.name,
    shiftShortCode: input.shiftShortCode ?? shift.shortCode,
    shiftStartTime: input.shiftStartTime ?? shift.startTime,
    shiftEndTime: input.shiftEndTime ?? shift.endTime,
    shiftColor: input.shiftColor ?? shift.color,
    rosterDate: input.rosterDate ?? '2026-07-27',
    status: input.status ?? 'scheduled',
    swappedWithStaffId: input.swappedWithStaffId ?? null,
    remarks: input.remarks ?? null,
    version: input.version ?? 1,
  };
}

function createHarness(initial: RosterAssignment[] = []) {
  let nextId = Math.max(500, ...initial.map((item) => item.rosterId)) + 1;
  const state = new Map(initial.map((item) => [item.rosterId, structuredClone(item)]));
  const events: PreparedRosterEvent[] = [];
  let failUpdateRosterId: number | null = null;

  const repository: RosterMutationRepository<TestStatement> = {
    async findById(tenantId, rosterId) {
      const row = state.get(rosterId);
      return row?.tenantId === tenantId ? structuredClone(row) : null;
    },
    async findByStaffDate(tenantId, staffId, rosterDate) {
      const row = [...state.values()].find((item) =>
        item.tenantId === tenantId && item.staffId === staffId && item.rosterDate === rosterDate,
      );
      return row ? structuredClone(row) : null;
    },
    async list(input) {
      return [...state.values()].filter((item) =>
        item.tenantId === input.tenantId
        && item.rosterDate >= input.from
        && item.rosterDate <= input.to,
      ).map(structuredClone);
    },
    prepareInsertAssignment(input: PreparedRosterInsert) {
      return () => {
        const duplicate = [...state.values()].some((item) =>
          item.tenantId === input.tenantId
          && item.staffId === input.staffId
          && item.rosterDate === input.rosterDate,
        );
        if (duplicate) throw new Error('UNIQUE constraint failed: hr_duty_roster');
        state.set(nextId, assignment({
          rosterId: nextId++,
          tenantId: input.tenantId,
          staffId: input.staffId,
          shiftId: input.shiftId,
          rosterDate: input.rosterDate,
          remarks: input.remarks,
          status: 'scheduled',
          version: 1,
        }));
      };
    },
    prepareUpdateAssignment(input: PreparedRosterUpdate) {
      return () => {
        if (failUpdateRosterId === input.rosterId) throw new Error('forced second update failure');
        const row = state.get(input.rosterId);
        if (!row || row.tenantId !== input.tenantId || row.version !== input.expectedVersion) {
          throw new WorkforceError('ROSTER_CONFLICT', 'Roster changed', 409);
        }
        const shift = shifts.find((item) => item.shiftId === input.shiftId) ?? shifts[0];
        state.set(input.rosterId, {
          ...row,
          shiftId: input.shiftId,
          shiftName: shift.name,
          shiftShortCode: shift.shortCode,
          shiftStartTime: shift.startTime,
          shiftEndTime: shift.endTime,
          shiftColor: shift.color,
          status: input.status,
          swappedWithStaffId: input.swappedWithStaffId,
          remarks: input.remarks,
          version: row.version + 1,
        });
      };
    },
    prepareInsertEvent(input: PreparedRosterEvent) {
      return () => {
        const row = [...state.values()].find((item) =>
          item.tenantId === input.tenantId
          && item.staffId === input.staffId
          && item.rosterDate === input.rosterDate
          && item.version === input.expectedResultVersion,
        );
        if (!row) throw new WorkforceError('ROSTER_CONFLICT', 'Roster event guard failed', 409);
        events.push(structuredClone(input));
      };
    },
  };

  const transaction: WorkforceTransaction<TestStatement> = {
    async commit(statements) {
      const stateSnapshot = new Map([...state.entries()].map(([id, row]) => [id, structuredClone(row)]));
      const eventSnapshot = events.map(structuredClone);
      try {
        statements.forEach((statement) => statement());
      } catch (error) {
        state.clear();
        stateSnapshot.forEach((row, id) => state.set(id, row));
        events.splice(0, events.length, ...eventSnapshot);
        throw error;
      }
    },
  };

  const workforceMembers = {
    async getMember(tenantId: string, staffId: number) {
      return members.find((item) => item.tenantId === tenantId && item.staffId === staffId) ?? null;
    },
    async getActiveMember(tenantId: string, staffId: number) {
      const member = members.find((item) => item.tenantId === tenantId && item.staffId === staffId) ?? null;
      return member?.status === 'active' ? member : null;
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

  const service = createRosterService<TestStatement>({
    workforceMembers,
    shifts: shiftRepository,
    rosters: repository,
    idempotency: new MemoryIdempotency(),
    transaction,
    clock: { nowUtc: () => '2026-07-26T14:00:00.000Z' },
    publicIds: { next: (prefix) => `${prefix}_${events.length + 1}` },
  });

  return {
    service,
    state,
    events,
    failSecondUpdate(rosterId: number) { failUpdateRosterId = rosterId; },
  };
}

const assignInput = {
  tenantId: '100',
  actorUserId: '44',
  staffId: 21,
  shiftId: 3,
  rosterDate: '2026-07-27',
  remarks: 'ICU coverage',
  idempotencyKey: 'roster:assign:21:2026-07-27:3',
};

describe('roster service', () => {
  it('rejects a cross-tenant staff reference', async () => {
    const { service } = createHarness();
    await expect(service.assign({ ...assignInput, tenantId: '200' }))
      .rejects.toMatchObject({ code: 'WORKFORCE_MEMBER_NOT_FOUND', httpStatus: 404 });
  });

  it('rejects an inactive staff member', async () => {
    const { service } = createHarness();
    await expect(service.assign({ ...assignInput, staffId: 23 }))
      .rejects.toMatchObject({ code: 'WORKFORCE_MEMBER_INACTIVE', httpStatus: 409 });
  });

  it('rejects a cross-tenant shift reference', async () => {
    const { service } = createHarness();
    await expect(service.assign({ ...assignInput, shiftId: 99 }))
      .rejects.toMatchObject({ code: 'SHIFT_NOT_FOUND', httpStatus: 404 });
  });

  it('rejects an inactive shift', async () => {
    const { service } = createHarness();
    await expect(service.assign({ ...assignInput, shiftId: 8 }))
      .rejects.toMatchObject({ code: 'SHIFT_INACTIVE', httpStatus: 409 });
  });

  it('creates a new assignment and immutable assigned event', async () => {
    const { service, events } = createHarness();
    const result = await service.assign(assignInput);
    expect(result).toMatchObject({ staffId: 21, shiftId: 3, status: 'scheduled', version: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'assigned', toShiftId: 3, expectedResultVersion: 1 });
  });

  it('replays the same assignment without a second event', async () => {
    const { service, events } = createHarness();
    const first = await service.assign(assignInput);
    const replay = await service.assign(assignInput);
    expect(replay).toEqual(first);
    expect(events).toHaveLength(1);
  });

  it('reassigns an existing day to a different shift', async () => {
    const { service, events } = createHarness([assignment({ rosterId: 501, staffId: 21, shiftId: 3 })]);
    const result = await service.assign({
      ...assignInput,
      shiftId: 4,
      idempotencyKey: 'roster:assign:21:2026-07-27:4',
    });
    expect(result).toMatchObject({ rosterId: 501, shiftId: 4, version: 2 });
    expect(events[0]).toMatchObject({ eventType: 'reassigned', fromShiftId: 3, toShiftId: 4 });
  });

  it('reactivates a cancelled row instead of inserting a duplicate', async () => {
    const { service, state, events } = createHarness([
      assignment({ rosterId: 501, staffId: 21, shiftId: 3, status: 'cancelled', version: 2 }),
    ]);
    const result = await service.assign(assignInput);
    expect(result).toMatchObject({ rosterId: 501, status: 'scheduled', version: 3 });
    expect(state).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'reactivated', expectedResultVersion: 3 });
  });

  it('cancels with actor, reason, version increment, and event evidence', async () => {
    const { service, events } = createHarness([assignment({ rosterId: 501, staffId: 21, shiftId: 3 })]);
    const result = await service.cancel({
      tenantId: '100', actorUserId: '44', rosterId: 501,
      reason: 'Approved leave', idempotencyKey: 'roster:cancel:501:1',
    });
    expect(result).toMatchObject({ status: 'cancelled', version: 2 });
    expect(events[0]).toMatchObject({ eventType: 'cancelled', reason: 'Approved leave' });
  });

  it('rejects swapping with the same staff member', async () => {
    const { service } = createHarness([assignment({ rosterId: 501, staffId: 21, shiftId: 3 })]);
    await expect(service.swap({
      tenantId: '100', actorUserId: '44', rosterId: 501, swapWithStaffId: 21,
      reason: 'No-op', idempotencyKey: 'roster:swap:501:21',
    })).rejects.toMatchObject({ code: 'ROSTER_SWAP_SAME_STAFF', httpStatus: 409 });
  });

  it('rejects a target without an active same-date roster', async () => {
    const { service } = createHarness([assignment({ rosterId: 501, staffId: 21, shiftId: 3 })]);
    await expect(service.swap({
      tenantId: '100', actorUserId: '44', rosterId: 501, swapWithStaffId: 22,
      reason: 'Approved exchange', idempotencyKey: 'roster:swap:501:22',
    })).rejects.toMatchObject({ code: 'ROSTER_SWAP_TARGET_MISSING', httpStatus: 409 });
  });

  it('atomically exchanges both shifts and records reciprocal events', async () => {
    const { service, events } = createHarness([
      assignment({ rosterId: 501, staffId: 21, shiftId: 3 }),
      assignment({ rosterId: 502, staffId: 22, shiftId: 4 }),
    ]);
    const result = await service.swap({
      tenantId: '100', actorUserId: '44', rosterId: 501, swapWithStaffId: 22,
      reason: 'Approved exchange', idempotencyKey: 'roster:swap:501:22',
    });
    expect(result.first).toMatchObject({ staffId: 21, shiftId: 4, swappedWithStaffId: 22, version: 2 });
    expect(result.second).toMatchObject({ staffId: 22, shiftId: 3, swappedWithStaffId: 21, version: 2 });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.relatedStaffId)).toEqual([22, 21]);
  });

  it('rolls back both assignments when the second swap update fails', async () => {
    const first = assignment({ rosterId: 501, staffId: 21, shiftId: 3 });
    const second = assignment({ rosterId: 502, staffId: 22, shiftId: 4 });
    const { service, state, events, failSecondUpdate } = createHarness([first, second]);
    failSecondUpdate(502);

    await expect(service.swap({
      tenantId: '100', actorUserId: '44', rosterId: 501, swapWithStaffId: 22,
      reason: 'Approved exchange', idempotencyKey: 'roster:swap:501:22',
    })).rejects.toThrow('forced second update failure');

    expect(state.get(501)).toMatchObject({ shiftId: 3, version: 1 });
    expect(state.get(502)).toMatchObject({ shiftId: 4, version: 1 });
    expect(events).toHaveLength(0);
  });
});
