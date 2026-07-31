import type {
  ShiftRepository,
  WorkforceClock,
  WorkforceMemberRepository,
  WorkforcePublicIdGenerator,
  WorkforceTransaction,
} from './ports';
import type { WorkCalendarService } from './work-calendar-service';
import {
  requireActiveMember,
  requireActiveShift,
} from './workforce-directory';
import type {
  PreparedRosterEvent,
  PreparedRosterInsert,
  PreparedRosterUpdate,
  RosterMutationRepository,
} from './roster-service';
import { WorkforceError } from '../domain/errors';
import type { RosterAssignment, RotationDay, RotationPattern } from '../domain/roster';
import { calculateCycleDay, enumerateInclusiveDates } from '../domain/roster';
import {
  runIdempotentWorkforceMutation,
  type WorkforceIdempotencyCoordinator,
  type WorkforceMutationIdentity,
} from '../infrastructure/d1-workforce-idempotency-repository';

const MAX_DATE_RANGE_DAYS = 62;
const MAX_PLANNED_MUTATIONS = 500;

export type RotationAssignmentRecord = {
  assignmentId: number;
  tenantId: string;
  staffId: number;
  patternId: number;
  startDate: string;
  endDate: string | null;
  cycleOffset: number;
  isActive: boolean;
  patternIsActive: boolean;
  cycleDays: number;
  days: RotationDay[];
};

export type CreateRotationPatternInput = {
  tenantId: string;
  actorUserId: string;
  patternName: string;
  cycleDays: number;
  days: Array<{ dayNumber: number; shiftId: number | null; isOff: boolean }>;
  idempotencyKey: string;
};

export type AssignRotationPatternInput = {
  tenantId: string;
  actorUserId: string;
  staffId: number;
  patternId: number;
  startDate: string;
  endDate: string | null;
  cycleOffset: number;
  idempotencyKey: string;
};

export type BulkRosterAssignmentInput = {
  tenantId: string;
  actorUserId: string;
  assignments: Array<{ staffId: number; shiftId: number }>;
  startDate: string;
  endDate: string;
  dateMode: 'all_dates' | 'configured_working_days';
  idempotencyKey: string;
};

export type GenerateRosterInput = {
  tenantId: string;
  actorUserId: string;
  startDate: string;
  endDate: string;
  replaceExisting: false;
  idempotencyKey: string;
};

export type BulkRosterResult = {
  created: number;
  updated: number;
  skipped: number;
};

export type GenerateRosterResult = {
  created: number;
  unchanged: number;
  skipped: number;
};

export interface RotationMutationRepository {
  listPatterns(tenantId: string, activeOnly?: boolean): Promise<RotationPattern[]>;
  getPattern(tenantId: string, patternId: number): Promise<RotationPattern | null>;
  createPattern(input: {
    tenantId: string;
    patternName: string;
    cycleDays: number;
    workingDays: Array<{ dayNumber: number; shiftId: number }>;
  }): Promise<number>;
  assignPattern(input: {
    tenantId: string;
    staffId: number;
    patternId: number;
    startDate: string;
    endDate: string | null;
    cycleOffset: number;
  }): Promise<number>;
  listRotationAssignments(tenantId: string, from: string, to: string): Promise<RotationAssignmentRecord[]>;
}

export interface RotationRosterRepository<TStatement> extends RosterMutationRepository<TStatement> {
  listForStaffRange(
    tenantId: string,
    staffIds: readonly number[],
    from: string,
    to: string,
  ): Promise<RosterAssignment[]>;
}

export type RotationService = {
  listPatterns(tenantId: string): Promise<RotationPattern[]>;
  createPattern(input: CreateRotationPatternInput): Promise<{ patternId: number }>;
  assignPattern(input: AssignRotationPatternInput): Promise<{ assignmentId: number }>;
  bulkAssign(input: BulkRosterAssignmentInput): Promise<BulkRosterResult>;
  generate(input: GenerateRosterInput): Promise<GenerateRosterResult>;
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

function boundedDates(startDate: string, endDate: string): string[] {
  try {
    const dates = enumerateInclusiveDates(startDate, endDate);
    if (dates.length > MAX_DATE_RANGE_DAYS) {
      throw new WorkforceError(
        'REQUEST_LIMIT_EXCEEDED',
        `Roster date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
        422,
      );
    }
    return dates;
  } catch (error) {
    if (error instanceof WorkforceError) throw error;
    if (error instanceof RangeError && error.message.includes('exceeds 62 days')) {
      throw new WorkforceError(
        'REQUEST_LIMIT_EXCEEDED',
        `Roster date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
        422,
      );
    }
    if (error instanceof RangeError) {
      throw new WorkforceError('INVALID_DATE_RANGE', error.message, 422);
    }
    throw error;
  }
}

function enforceMutationLimit(count: number): void {
  if (count > MAX_PLANNED_MUTATIONS) {
    throw new WorkforceError(
      'REQUEST_LIMIT_EXCEEDED',
      `A roster operation cannot plan more than ${MAX_PLANNED_MUTATIONS} mutations`,
      422,
    );
  }
}

function existingRosterMap(rows: readonly RosterAssignment[]): Map<string, RosterAssignment> {
  return new Map(rows.map((row) => [`${row.staffId}:${row.rosterDate}`, row]));
}

async function validateReferences(
  workforceMembers: WorkforceMemberRepository,
  shifts: ShiftRepository,
  tenantId: string,
  assignments: readonly { staffId: number; shiftId: number }[],
): Promise<void> {
  const staffIds = [...new Set(assignments.map((assignment) => assignment.staffId))];
  const shiftIds = [...new Set(assignments.map((assignment) => assignment.shiftId))];
  await Promise.all([
    ...staffIds.map((staffId) => requireActiveMember(workforceMembers, tenantId, staffId)),
    ...shiftIds.map((shiftId) => requireActiveShift(shifts, tenantId, shiftId)),
  ]);
}

function validatePatternDays(input: CreateRotationPatternInput): Array<{ dayNumber: number; shiftId: number }> {
  const seen = new Set<number>();
  const workingDays: Array<{ dayNumber: number; shiftId: number }> = [];

  for (const day of input.days) {
    if (day.dayNumber < 1 || day.dayNumber > input.cycleDays) {
      throw new WorkforceError(
        'INVALID_DATE_RANGE',
        `Rotation day ${day.dayNumber} is outside the 1..${input.cycleDays} cycle`,
        422,
      );
    }
    if (seen.has(day.dayNumber)) {
      throw new WorkforceError('ROSTER_CONFLICT', `Rotation day ${day.dayNumber} is duplicated`, 409);
    }
    seen.add(day.dayNumber);

    if (!day.isOff) {
      if (day.shiftId === null) {
        throw new WorkforceError('SHIFT_NOT_FOUND', `Rotation day ${day.dayNumber} requires a shift`, 422);
      }
      workingDays.push({ dayNumber: day.dayNumber, shiftId: day.shiftId });
    }
  }

  return workingDays;
}

export function createRotationService<TStatement>(dependencies: {
  workforceMembers: WorkforceMemberRepository;
  shifts: ShiftRepository;
  rotations: RotationMutationRepository;
  rosters: RotationRosterRepository<TStatement>;
  calendar: WorkCalendarService;
  idempotency: WorkforceIdempotencyCoordinator<TStatement>;
  transaction: WorkforceTransaction<TStatement>;
  clock: WorkforceClock;
  publicIds: WorkforcePublicIdGenerator;
}): RotationService {
  const {
    workforceMembers,
    shifts,
    rotations,
    rosters,
    calendar,
    idempotency,
    transaction,
    clock,
    publicIds,
  } = dependencies;

  return {
    listPatterns(tenantId) {
      return rotations.listPatterns(tenantId, true);
    },

    async createPattern(input) {
      const workingDays = validatePatternDays(input);
      await Promise.all(
        [...new Set(workingDays.map((day) => day.shiftId))]
          .map((shiftId) => requireActiveShift(shifts, input.tenantId, shiftId)),
      );
      const patternId = await rotations.createPattern({
        tenantId: input.tenantId,
        patternName: input.patternName,
        cycleDays: input.cycleDays,
        workingDays,
      });
      return { patternId };
    },

    async assignPattern(input) {
      await requireActiveMember(workforceMembers, input.tenantId, input.staffId);
      const pattern = await rotations.getPattern(input.tenantId, input.patternId);
      if (!pattern) {
        throw new WorkforceError('ROTATION_NOT_FOUND', 'Rotation pattern not found', 404);
      }
      if (!pattern.isActive) {
        throw new WorkforceError('ROTATION_INACTIVE', 'Rotation pattern is inactive', 409);
      }
      if (input.cycleOffset >= pattern.cycleDays) {
        throw new WorkforceError(
          'INVALID_DATE_RANGE',
          'Rotation cycle offset must be smaller than the pattern cycle',
          422,
        );
      }
      const assignmentId = await rotations.assignPattern({
        tenantId: input.tenantId,
        staffId: input.staffId,
        patternId: input.patternId,
        startDate: input.startDate,
        endDate: input.endDate,
        cycleOffset: input.cycleOffset,
      });
      return { assignmentId };
    },

    async bulkAssign(input) {
      const dates = boundedDates(input.startDate, input.endDate);
      const calendarDays = input.dateMode === 'configured_working_days'
        ? await calendar.evaluateDays(input.tenantId, dates)
        : [];
      const eligibleDates = input.dateMode === 'all_dates'
        ? dates
        : calendarDays.filter((day) => day.isWorkingDay).map((day) => day.date);
      const nonWorkingCount = dates.length - eligibleDates.length;

      enforceMutationLimit(eligibleDates.length * input.assignments.length);
      await validateReferences(workforceMembers, shifts, input.tenantId, input.assignments);

      const staffIds = [...new Set(input.assignments.map((assignment) => assignment.staffId))];
      const currentRows = await rosters.listForStaffRange(
        input.tenantId,
        staffIds,
        input.startDate,
        input.endDate,
      );
      const current = existingRosterMap(currentRows);

      return runIdempotentWorkforceMutation(
        { idempotency, transaction },
        mutationIdentity(input, 'roster.bulk_assign'),
        {
          assignments: input.assignments,
          startDate: input.startDate,
          endDate: input.endDate,
          dateMode: input.dateMode,
        },
        async ({ requestHash }) => {
          const statements: TStatement[] = [];
          let created = 0;
          let updated = 0;
          let skipped = nonWorkingCount * input.assignments.length;

          for (const date of eligibleDates) {
            for (const assignment of input.assignments) {
              const key = `${assignment.staffId}:${date}`;
              const existing = current.get(key);
              let eventType: PreparedRosterEvent['eventType'];
              let fromShiftId: number | null;
              let expectedResultVersion: number;

              if (!existing) {
                statements.push(rosters.prepareInsertAssignment({
                  tenantId: input.tenantId,
                  staffId: assignment.staffId,
                  shiftId: assignment.shiftId,
                  rosterDate: date,
                  remarks: null,
                  actorUserId: input.actorUserId,
                }));
                created += 1;
                eventType = 'assigned';
                fromShiftId = null;
                expectedResultVersion = 1;
              } else if (existing.status === 'cancelled' || existing.shiftId !== assignment.shiftId) {
                statements.push(rosters.prepareUpdateAssignment({
                  tenantId: input.tenantId,
                  rosterId: existing.rosterId,
                  expectedVersion: existing.version,
                  staffId: existing.staffId,
                  rosterDate: existing.rosterDate,
                  shiftId: assignment.shiftId,
                  status: 'scheduled',
                  swappedWithStaffId: null,
                  remarks: existing.remarks,
                  actorUserId: input.actorUserId,
                }));
                updated += 1;
                eventType = existing.status === 'cancelled' ? 'reactivated' : 'reassigned';
                fromShiftId = existing.shiftId;
                expectedResultVersion = existing.version + 1;
              } else {
                skipped += 1;
                continue;
              }

              statements.push(rosters.prepareInsertEvent({
                tenantId: input.tenantId,
                eventPublicId: publicIds.next('roster_event'),
                staffId: assignment.staffId,
                rosterDate: date,
                eventType,
                fromShiftId,
                toShiftId: assignment.shiftId,
                relatedStaffId: null,
                reason: 'Bulk roster assignment',
                actorUserId: input.actorUserId,
                idempotencyKey: input.idempotencyKey,
                requestHash,
                occurredAtUtc: clock.nowUtc(),
                expectedResultVersion,
              }));
            }
          }

          return { result: { created, updated, skipped }, statements };
        },
      );
    },

    async generate(input) {
      const dates = boundedDates(input.startDate, input.endDate);
      const rotationAssignments = (await rotations.listRotationAssignments(
        input.tenantId,
        input.startDate,
        input.endDate,
      )).filter((assignment) => assignment.isActive && assignment.patternIsActive);

      const activeStaffIds = [...new Set(rotationAssignments.map((assignment) => assignment.staffId))];
      await Promise.all(
        activeStaffIds.map((staffId) => requireActiveMember(workforceMembers, input.tenantId, staffId)),
      );

      const requiredShiftIds = [...new Set(
        rotationAssignments.flatMap((assignment) =>
          assignment.days
            .filter((day) => !day.isOff && day.shiftId !== null)
            .map((day) => day.shiftId as number),
        ),
      )];
      await Promise.all(
        requiredShiftIds.map((shiftId) => requireActiveShift(shifts, input.tenantId, shiftId)),
      );

      const currentRows = activeStaffIds.length === 0
        ? []
        : await rosters.listForStaffRange(
          input.tenantId,
          activeStaffIds,
          input.startDate,
          input.endDate,
        );
      const current = existingRosterMap(currentRows);

      const planned: Array<{
        staffId: number;
        shiftId: number;
        rosterDate: string;
      }> = [];
      const plannedKeys = new Set<string>();
      let skipped = 0;
      let unchanged = 0;

      for (const rotation of rotationAssignments) {
        for (const date of dates) {
          if (date < rotation.startDate) continue;
          if (rotation.endDate !== null && date > rotation.endDate) continue;

          const cycleDay = calculateCycleDay({
            startDate: rotation.startDate,
            targetDate: date,
            cycleDays: rotation.cycleDays,
            cycleOffset: rotation.cycleOffset,
          });
          const day = rotation.days.find((candidate) => candidate.dayNumber === cycleDay);
          if (!day || day.isOff || day.shiftId === null) {
            skipped += 1;
            continue;
          }

          const key = `${rotation.staffId}:${date}`;
          if (current.has(key)) {
            unchanged += 1;
            continue;
          }
          if (plannedKeys.has(key)) {
            skipped += 1;
            continue;
          }
          plannedKeys.add(key);
          planned.push({ staffId: rotation.staffId, shiftId: day.shiftId, rosterDate: date });
        }
      }

      enforceMutationLimit(planned.length);

      return runIdempotentWorkforceMutation(
        { idempotency, transaction },
        mutationIdentity(input, 'roster.generate'),
        {
          startDate: input.startDate,
          endDate: input.endDate,
          replaceExisting: input.replaceExisting,
        },
        async ({ requestHash }) => {
          const statements: TStatement[] = [];
          for (const item of planned) {
            statements.push(rosters.prepareInsertAssignment({
              tenantId: input.tenantId,
              staffId: item.staffId,
              shiftId: item.shiftId,
              rosterDate: item.rosterDate,
              remarks: 'Generated from active rotation',
              actorUserId: input.actorUserId,
            }));
            statements.push(rosters.prepareInsertEvent({
              tenantId: input.tenantId,
              eventPublicId: publicIds.next('roster_event'),
              staffId: item.staffId,
              rosterDate: item.rosterDate,
              eventType: 'generated',
              fromShiftId: null,
              toShiftId: item.shiftId,
              relatedStaffId: null,
              reason: 'Generated from active rotation',
              actorUserId: input.actorUserId,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              occurredAtUtc: clock.nowUtc(),
              expectedResultVersion: 1,
            }));
          }
          return {
            result: { created: planned.length, unchanged, skipped },
            statements,
          };
        },
      );
    },
  };
}
