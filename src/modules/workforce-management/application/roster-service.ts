import type {
  ShiftRepository,
  WorkforceClock,
  WorkforceMemberRepository,
  WorkforcePublicIdGenerator,
  WorkforceTransaction,
} from './ports';
import { requireActiveMember, requireActiveShift } from './workforce-directory';
import { WorkforceError } from '../domain/errors';
import type { RosterAssignment, RosterStatus } from '../domain/roster';
import {
  runIdempotentWorkforceMutation,
  type WorkforceIdempotencyCoordinator,
  type WorkforceMutationIdentity,
} from '../infrastructure/d1-workforce-idempotency-repository';

export type AssignRosterInput = {
  tenantId: string;
  actorUserId: string;
  staffId: number;
  shiftId: number;
  rosterDate: string;
  remarks?: string;
  idempotencyKey: string;
};

export type CancelRosterInput = {
  tenantId: string;
  actorUserId: string;
  rosterId: number;
  reason: string;
  idempotencyKey: string;
};

export type SwapRosterInput = {
  tenantId: string;
  actorUserId: string;
  rosterId: number;
  swapWithStaffId: number;
  reason: string;
  idempotencyKey: string;
};

export type RosterListInput = {
  tenantId: string;
  from: string;
  to: string;
  staffId?: number;
  shiftId?: number;
  department?: string;
};

export type PreparedRosterInsert = {
  tenantId: string;
  staffId: number;
  shiftId: number;
  rosterDate: string;
  remarks: string | null;
  actorUserId: string;
};

export type PreparedRosterUpdate = {
  tenantId: string;
  rosterId: number;
  expectedVersion: number;
  staffId: number;
  rosterDate: string;
  shiftId: number;
  status: RosterStatus;
  swappedWithStaffId: number | null;
  remarks: string | null;
  actorUserId: string;
};

export type RosterEventType = 'assigned' | 'reassigned' | 'reactivated' | 'swapped' | 'cancelled' | 'generated';

export type PreparedRosterEvent = {
  tenantId: string;
  eventPublicId: string;
  staffId: number;
  rosterDate: string;
  eventType: RosterEventType;
  fromShiftId: number | null;
  toShiftId: number | null;
  relatedStaffId: number | null;
  reason: string | null;
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
  occurredAtUtc: string;
  expectedResultVersion: number;
};

export interface RosterMutationRepository<TStatement> {
  findById(tenantId: string, rosterId: number): Promise<RosterAssignment | null>;
  findByStaffDate(tenantId: string, staffId: number, rosterDate: string): Promise<RosterAssignment | null>;
  list(input: RosterListInput): Promise<RosterAssignment[]>;
  prepareInsertAssignment(input: PreparedRosterInsert): TStatement;
  prepareUpdateAssignment(input: PreparedRosterUpdate): TStatement;
  prepareInsertEvent(input: PreparedRosterEvent): TStatement;
}

export type RosterService = {
  list(input: RosterListInput): Promise<RosterAssignment[]>;
  assign(input: AssignRosterInput): Promise<RosterAssignment>;
  cancel(input: CancelRosterInput): Promise<RosterAssignment>;
  swap(input: SwapRosterInput): Promise<{ first: RosterAssignment; second: RosterAssignment }>;
};

type RosterMutationReceipt = {
  staffId: number;
  rosterDate: string;
};

type RosterSwapReceipt = {
  firstStaffId: number;
  secondStaffId: number;
  rosterDate: string;
};

function mutationIdentity(
  input: { tenantId: string; actorUserId: string; idempotencyKey: string },
  mutationType: string,
): WorkforceMutationIdentity {
  return {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    idempotencyKey: input.idempotencyKey,
    mutationType,
  };
}

function rosterNotFound(): WorkforceError {
  return new WorkforceError('ROSTER_NOT_FOUND', 'Roster assignment not found', 404);
}

function mapRosterMutationFailure(error: unknown): never {
  if (error instanceof WorkforceError) throw error;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('unique constraint failed: hr_duty_roster')
      || message.includes('hr_roster_events.roster_id')
      || message.includes('roster changed')
      || message.includes('roster event guard failed')
    ) {
      throw new WorkforceError('ROSTER_CONFLICT', 'Roster changed while the request was being processed', 409, true);
    }
  }
  throw error;
}

export function createRosterService<TStatement>(dependencies: {
  workforceMembers: WorkforceMemberRepository;
  shifts: ShiftRepository;
  rosters: RosterMutationRepository<TStatement>;
  idempotency: WorkforceIdempotencyCoordinator<TStatement>;
  transaction: WorkforceTransaction<TStatement>;
  clock: WorkforceClock;
  publicIds: WorkforcePublicIdGenerator;
}): RosterService {
  const { workforceMembers, shifts, rosters, idempotency, transaction, clock, publicIds } = dependencies;

  async function fetchCommitted(tenantId: string, staffId: number, rosterDate: string): Promise<RosterAssignment> {
    const committed = await rosters.findByStaffDate(tenantId, staffId, rosterDate);
    if (!committed) throw rosterNotFound();
    return committed;
  }

  return {
    list(input) {
      return rosters.list(input);
    },

    async assign(input) {
      await requireActiveMember(workforceMembers, input.tenantId, input.staffId);
      await requireActiveShift(shifts, input.tenantId, input.shiftId);

      let receipt: RosterMutationReceipt;
      try {
        receipt = await runIdempotentWorkforceMutation(
          { idempotency, transaction },
          mutationIdentity(input, 'roster.assign'),
          {
            staffId: input.staffId,
            shiftId: input.shiftId,
            rosterDate: input.rosterDate,
            remarks: input.remarks ?? null,
          },
          async ({ requestHash }) => {
            const existing = await rosters.findByStaffDate(input.tenantId, input.staffId, input.rosterDate);
            const statements: TStatement[] = [];
            let eventType: RosterEventType | null = null;
            let fromShiftId: number | null = null;
            let expectedResultVersion = 1;

            if (!existing) {
              statements.push(rosters.prepareInsertAssignment({
                tenantId: input.tenantId,
                staffId: input.staffId,
                shiftId: input.shiftId,
                rosterDate: input.rosterDate,
                remarks: input.remarks ?? null,
                actorUserId: input.actorUserId,
              }));
              eventType = 'assigned';
            } else if (existing.status === 'cancelled') {
              statements.push(rosters.prepareUpdateAssignment({
                tenantId: input.tenantId,
                rosterId: existing.rosterId,
                expectedVersion: existing.version,
                staffId: existing.staffId,
                rosterDate: existing.rosterDate,
                shiftId: input.shiftId,
                status: 'scheduled',
                swappedWithStaffId: null,
                remarks: input.remarks ?? existing.remarks,
                actorUserId: input.actorUserId,
              }));
              eventType = 'reactivated';
              fromShiftId = existing.shiftId;
              expectedResultVersion = existing.version + 1;
            } else if (existing.shiftId !== input.shiftId) {
              statements.push(rosters.prepareUpdateAssignment({
                tenantId: input.tenantId,
                rosterId: existing.rosterId,
                expectedVersion: existing.version,
                staffId: existing.staffId,
                rosterDate: existing.rosterDate,
                shiftId: input.shiftId,
                status: 'scheduled',
                swappedWithStaffId: null,
                remarks: input.remarks ?? existing.remarks,
                actorUserId: input.actorUserId,
              }));
              eventType = 'reassigned';
              fromShiftId = existing.shiftId;
              expectedResultVersion = existing.version + 1;
            }

            if (eventType) {
              statements.push(rosters.prepareInsertEvent({
                tenantId: input.tenantId,
                eventPublicId: publicIds.next('roster_event'),
                staffId: input.staffId,
                rosterDate: input.rosterDate,
                eventType,
                fromShiftId,
                toShiftId: input.shiftId,
                relatedStaffId: null,
                reason: input.remarks ?? null,
                actorUserId: input.actorUserId,
                idempotencyKey: input.idempotencyKey,
                requestHash,
                occurredAtUtc: clock.nowUtc(),
                expectedResultVersion,
              }));
            }

            return {
              result: { staffId: input.staffId, rosterDate: input.rosterDate },
              statements,
            };
          },
        );
      } catch (error) {
        mapRosterMutationFailure(error);
      }

      return fetchCommitted(input.tenantId, receipt.staffId, receipt.rosterDate);
    },

    async cancel(input) {
      let receipt: RosterMutationReceipt;
      try {
        receipt = await runIdempotentWorkforceMutation(
          { idempotency, transaction },
          mutationIdentity(input, 'roster.cancel'),
          { rosterId: input.rosterId, reason: input.reason },
          async ({ requestHash }) => {
            const existing = await rosters.findById(input.tenantId, input.rosterId);
            if (!existing) throw rosterNotFound();

            const statements: TStatement[] = [];
            if (existing.status !== 'cancelled') {
              statements.push(rosters.prepareUpdateAssignment({
                tenantId: input.tenantId,
                rosterId: existing.rosterId,
                expectedVersion: existing.version,
                staffId: existing.staffId,
                rosterDate: existing.rosterDate,
                shiftId: existing.shiftId,
                status: 'cancelled',
                swappedWithStaffId: null,
                remarks: existing.remarks,
                actorUserId: input.actorUserId,
              }));
              statements.push(rosters.prepareInsertEvent({
                tenantId: input.tenantId,
                eventPublicId: publicIds.next('roster_event'),
                staffId: existing.staffId,
                rosterDate: existing.rosterDate,
                eventType: 'cancelled',
                fromShiftId: existing.shiftId,
                toShiftId: null,
                relatedStaffId: null,
                reason: input.reason,
                actorUserId: input.actorUserId,
                idempotencyKey: input.idempotencyKey,
                requestHash,
                occurredAtUtc: clock.nowUtc(),
                expectedResultVersion: existing.version + 1,
              }));
            }

            return {
              result: { staffId: existing.staffId, rosterDate: existing.rosterDate },
              statements,
            };
          },
        );
      } catch (error) {
        mapRosterMutationFailure(error);
      }

      return fetchCommitted(input.tenantId, receipt.staffId, receipt.rosterDate);
    },

    async swap(input) {
      const sourceBeforeClaim = await rosters.findById(input.tenantId, input.rosterId);
      if (!sourceBeforeClaim || sourceBeforeClaim.status === 'cancelled') throw rosterNotFound();
      if (sourceBeforeClaim.staffId === input.swapWithStaffId) {
        throw new WorkforceError('ROSTER_SWAP_SAME_STAFF', 'A roster cannot be swapped with the same staff member', 409);
      }

      let receipt: RosterSwapReceipt;
      try {
        receipt = await runIdempotentWorkforceMutation(
          { idempotency, transaction },
          mutationIdentity(input, 'roster.swap'),
          {
            rosterId: input.rosterId,
            swapWithStaffId: input.swapWithStaffId,
            reason: input.reason,
          },
          async ({ requestHash }) => {
            const source = await rosters.findById(input.tenantId, input.rosterId);
            if (!source || source.status === 'cancelled') throw rosterNotFound();
            const target = await rosters.findByStaffDate(
              input.tenantId,
              input.swapWithStaffId,
              source.rosterDate,
            );
            if (!target || target.status === 'cancelled') {
              throw new WorkforceError(
                'ROSTER_SWAP_TARGET_MISSING',
                'The target staff member has no active roster on the same date',
                409,
              );
            }

            await requireActiveMember(workforceMembers, input.tenantId, source.staffId);
            await requireActiveMember(workforceMembers, input.tenantId, target.staffId);
            await requireActiveShift(shifts, input.tenantId, source.shiftId);
            await requireActiveShift(shifts, input.tenantId, target.shiftId);

            const firstResultVersion = source.version + 1;
            const secondResultVersion = target.version + 1;
            const statements: TStatement[] = [
              rosters.prepareUpdateAssignment({
                tenantId: input.tenantId,
                rosterId: source.rosterId,
                expectedVersion: source.version,
                staffId: source.staffId,
                rosterDate: source.rosterDate,
                shiftId: target.shiftId,
                status: 'swapped',
                swappedWithStaffId: target.staffId,
                remarks: source.remarks,
                actorUserId: input.actorUserId,
              }),
              rosters.prepareUpdateAssignment({
                tenantId: input.tenantId,
                rosterId: target.rosterId,
                expectedVersion: target.version,
                staffId: target.staffId,
                rosterDate: target.rosterDate,
                shiftId: source.shiftId,
                status: 'swapped',
                swappedWithStaffId: source.staffId,
                remarks: target.remarks,
                actorUserId: input.actorUserId,
              }),
              rosters.prepareInsertEvent({
                tenantId: input.tenantId,
                eventPublicId: publicIds.next('roster_event'),
                staffId: source.staffId,
                rosterDate: source.rosterDate,
                eventType: 'swapped',
                fromShiftId: source.shiftId,
                toShiftId: target.shiftId,
                relatedStaffId: target.staffId,
                reason: input.reason,
                actorUserId: input.actorUserId,
                idempotencyKey: input.idempotencyKey,
                requestHash,
                occurredAtUtc: clock.nowUtc(),
                expectedResultVersion: firstResultVersion,
              }),
              rosters.prepareInsertEvent({
                tenantId: input.tenantId,
                eventPublicId: publicIds.next('roster_event'),
                staffId: target.staffId,
                rosterDate: target.rosterDate,
                eventType: 'swapped',
                fromShiftId: target.shiftId,
                toShiftId: source.shiftId,
                relatedStaffId: source.staffId,
                reason: input.reason,
                actorUserId: input.actorUserId,
                idempotencyKey: input.idempotencyKey,
                requestHash,
                occurredAtUtc: clock.nowUtc(),
                expectedResultVersion: secondResultVersion,
              }),
            ];

            return {
              result: {
                firstStaffId: source.staffId,
                secondStaffId: target.staffId,
                rosterDate: source.rosterDate,
              },
              statements,
            };
          },
        );
      } catch (error) {
        mapRosterMutationFailure(error);
      }

      const [first, second] = await Promise.all([
        fetchCommitted(input.tenantId, receipt.firstStaffId, receipt.rosterDate),
        fetchCommitted(input.tenantId, receipt.secondStaffId, receipt.rosterDate),
      ]);
      return { first, second };
    },
  };
}
