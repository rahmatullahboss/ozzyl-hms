import type {
  WorkforceClock,
  WorkforceMemberRepository,
  WorkforcePublicIdGenerator,
  WorkforceTransaction,
} from './ports';
import { requireActiveMember } from './workforce-directory';
import type {
  AttendanceProjectionPlan,
  AttendancePunchRecord,
  AttendanceQueryService,
  AttendanceReadRepository,
} from './attendance-query-service';
import type {
  AttendancePunchSource,
  AttendancePunchType,
  AttendanceStatus,
} from '../domain/attendance';
import { WorkforceError } from '../domain/errors';
import {
  hashWorkforceRequest,
  runIdempotentWorkforceMutation,
  type WorkforceIdempotencyCoordinator,
  type WorkforceMutationIdentity,
} from '../infrastructure/d1-workforce-idempotency-repository';

export type RecordAttendancePunchInput = {
  tenantId: string;
  actorUserId: string | null;
  staffId: number;
  occurredAtUtc: string;
  punchType: AttendancePunchType;
  source: AttendancePunchSource;
  sourceEventKey: string;
  reason?: string | null;
  shiftIdOverride?: number;
  deviceId?: number | null;
  deviceSerial?: string | null;
  rawData?: string | null;
};

export type AttendancePunchResult = {
  staffId: number;
  businessDate: string;
  rosterId: number | null;
  shiftId: number | null;
  sourceEventKey: string;
  punchType: AttendancePunchType;
  status: AttendanceStatus;
  workedMinutes: number;
  projectionVersion: number;
};

export type PreparedAttendancePunch = {
  tenantId: string;
  staffId: number;
  occurredAtUtc: string;
  businessDate: string;
  punchType: AttendancePunchType;
  source: AttendancePunchSource;
  sourceEventKey: string;
  requestHash: string;
  reason: string | null;
  actorUserId: string | null;
  deviceId: number | null;
  deviceSerial: string | null;
  rawData: string | null;
};

export type PreparedAttendanceProjection = {
  tenantId: string;
  staffId: number;
  businessDate: string;
  rosterId: number | null;
  shiftId: number | null;
  firstInTime: string | null;
  lastOutTime: string | null;
  firstInLocalTime: string | null;
  lastOutLocalTime: string | null;
  workedMinutes: number;
  status: AttendanceStatus;
  expectedVersion: number;
  updatedAtUtc: string;
};

export type PreparedAttendanceProjectionEvent = {
  tenantId: string;
  eventPublicId: string;
  staffId: number;
  businessDate: string;
  projectionStatus: AttendanceStatus;
  expectedResultVersion: number;
  source: AttendancePunchSource | 'auto_absence';
  sourceEventKey: string;
  requestHash: string;
  punchType: AttendancePunchType | null;
  occurredAtUtc: string | null;
  reason: string | null;
  actorUserId: string | null;
  createdAtUtc: string;
};

export interface AttendanceMutationRepository<TStatement> extends AttendanceReadRepository {
  findPunchBySourceEvent(
    tenantId: string,
    source: AttendancePunchSource,
    sourceEventKey: string,
  ): Promise<AttendancePunchRecord | null>;
  prepareInsertPunch(input: PreparedAttendancePunch): TStatement;
  prepareUpsertProjection(input: PreparedAttendanceProjection): TStatement;
  prepareInsertProjectionEvent(input: PreparedAttendanceProjectionEvent): TStatement;
}

export type MarkExpectedAbsencesInput = {
  tenantId: string;
  actorUserId: string;
  businessDate: string;
  department?: string;
  sourceEventKey: string;
};

export type AttendancePunchService = {
  recordPunch(input: RecordAttendancePunchInput): Promise<AttendancePunchResult>;
  markExpectedAbsences(input: MarkExpectedAbsencesInput): Promise<{ count: number }>;
};

function mutationIdentity(input: RecordAttendancePunchInput): WorkforceMutationIdentity {
  return {
    tenantId: input.tenantId,
    mutationType: 'attendance.punch',
    idempotencyKey: `${input.source}:${input.sourceEventKey}`,
    actorUserId: input.actorUserId ?? '0',
  };
}

function resultFromProjection(
  input: RecordAttendancePunchInput,
  projection: AttendanceProjectionPlan,
): AttendancePunchResult {
  return {
    staffId: input.staffId,
    businessDate: projection.businessDate,
    rosterId: projection.rosterId,
    shiftId: projection.shiftId,
    sourceEventKey: input.sourceEventKey,
    punchType: input.punchType,
    status: projection.status,
    workedMinutes: projection.workedMinutes,
    projectionVersion: projection.resultVersion,
  };
}

function mapAttendanceMutationError(error: unknown): never {
  if (error instanceof WorkforceError) {
    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      throw new WorkforceError(
        'ATTENDANCE_PUNCH_CONFLICT',
        'This attendance source event was already used for a different punch',
        409,
        error.retryable,
      );
    }
    throw error;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('uq_hr_attendance_punch_source_event')
      || message.includes('unique constraint failed: hr_attendance_punches')
      || message.includes('attendance projection event guard failed')
    ) {
      throw new WorkforceError(
        'ATTENDANCE_PUNCH_CONFLICT',
        'Attendance punch or projection changed while processing the request',
        409,
        true,
      );
    }
  }
  throw error;
}

export function createAttendancePunchService<TStatement>(dependencies: {
  workforceMembers: WorkforceMemberRepository;
  attendance: AttendanceMutationRepository<TStatement>;
  query: AttendanceQueryService;
  idempotency: WorkforceIdempotencyCoordinator<TStatement>;
  transaction: WorkforceTransaction<TStatement>;
  clock: WorkforceClock;
  publicIds: WorkforcePublicIdGenerator;
}): AttendancePunchService {
  const {
    workforceMembers,
    attendance,
    query,
    idempotency,
    transaction,
    clock,
    publicIds,
  } = dependencies;

  return {
    async recordPunch(input) {
      if (input.source === 'manual' && (!input.reason || input.reason.trim().length < 3)) {
        throw new WorkforceError(
          'ATTENDANCE_CORRECTION_REASON_REQUIRED',
          'A reason is required for a manual attendance correction',
          422,
        );
      }
      await requireActiveMember(workforceMembers, input.tenantId, input.staffId);

      const requestPayload = {
        staffId: input.staffId,
        occurredAtUtc: input.occurredAtUtc,
        punchType: input.punchType,
        source: input.source,
        sourceEventKey: input.sourceEventKey,
        reason: input.reason?.trim() || null,
        shiftIdOverride: input.shiftIdOverride ?? null,
        deviceId: input.deviceId ?? null,
        deviceSerial: input.deviceSerial ?? null,
        rawData: input.rawData ?? null,
      };
      const requestHash = await hashWorkforceRequest(requestPayload);
      const existing = await attendance.findPunchBySourceEvent(
        input.tenantId,
        input.source,
        input.sourceEventKey,
      );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new WorkforceError(
            'ATTENDANCE_PUNCH_CONFLICT',
            'This attendance source event was already used for a different punch',
            409,
          );
        }
        const replayProjection = await query.projectDay({
          tenantId: input.tenantId,
          staffId: input.staffId,
          businessDate: existing.businessDate,
        });
        return resultFromProjection(input, {
          ...replayProjection,
          resultVersion: Math.max(
            replayProjection.expectedVersion,
            replayProjection.resultVersion - 1,
          ),
        });
      }

      try {
        return await runIdempotentWorkforceMutation(
          { idempotency, transaction },
          mutationIdentity(input),
          requestPayload,
          async ({ requestHash: claimedRequestHash }) => {
            const context = await query.resolveBusinessContext({
              tenantId: input.tenantId,
              staffId: input.staffId,
              occurredAtUtc: input.occurredAtUtc,
              shiftIdOverride: input.shiftIdOverride,
            });
            const currentPunches = await attendance.listPunches(
              input.tenantId,
              input.staffId,
              context.businessDate,
            );
            const projectedPunches = [
              ...currentPunches,
              {
                punchId: 0,
                tenantId: input.tenantId,
                staffId: input.staffId,
                occurredAtUtc: input.occurredAtUtc,
                punchType: input.punchType,
                source: input.source,
                sourceEventKey: input.sourceEventKey,
              },
            ];
            const projection = await query.projectDay({
              tenantId: input.tenantId,
              staffId: input.staffId,
              businessDate: context.businessDate,
              punches: projectedPunches,
              shiftIdOverride: input.shiftIdOverride,
            });
            const result = resultFromProjection(input, projection);
            const nowUtc = clock.nowUtc();
            const statements: TStatement[] = [
              attendance.prepareInsertPunch({
                tenantId: input.tenantId,
                staffId: input.staffId,
                occurredAtUtc: input.occurredAtUtc,
                businessDate: context.businessDate,
                punchType: input.punchType,
                source: input.source,
                sourceEventKey: input.sourceEventKey,
                requestHash: claimedRequestHash,
                reason: input.reason?.trim() || null,
                actorUserId: input.actorUserId,
                deviceId: input.deviceId ?? null,
                deviceSerial: input.deviceSerial ?? null,
                rawData: input.rawData ?? null,
              }),
              attendance.prepareUpsertProjection({
                tenantId: input.tenantId,
                staffId: input.staffId,
                businessDate: projection.businessDate,
                rosterId: projection.rosterId,
                shiftId: projection.shiftId,
                firstInTime: projection.firstInTime,
                lastOutTime: projection.lastOutTime,
                firstInLocalTime: projection.firstInLocalTime,
                lastOutLocalTime: projection.lastOutLocalTime,
                workedMinutes: projection.workedMinutes,
                status: projection.status,
                expectedVersion: projection.expectedVersion,
                updatedAtUtc: nowUtc,
              }),
              attendance.prepareInsertProjectionEvent({
                tenantId: input.tenantId,
                eventPublicId: publicIds.next('attendance_projection_event'),
                staffId: input.staffId,
                businessDate: projection.businessDate,
                projectionStatus: projection.status,
                expectedResultVersion: projection.resultVersion,
                source: input.source,
                sourceEventKey: input.sourceEventKey,
                requestHash: claimedRequestHash,
                punchType: input.punchType,
                occurredAtUtc: input.occurredAtUtc,
                reason: input.reason?.trim() || null,
                actorUserId: input.actorUserId,
                createdAtUtc: nowUtc,
              }),
            ];
            return { result, statements };
          },
        );
      } catch (error) {
        mapAttendanceMutationError(error);
      }
    },

    async markExpectedAbsences(input) {
      try {
        return await runIdempotentWorkforceMutation(
          { idempotency, transaction },
          {
            tenantId: input.tenantId,
            mutationType: 'attendance.auto_absence',
            idempotencyKey: input.sourceEventKey,
            actorUserId: input.actorUserId,
          },
          {
            businessDate: input.businessDate,
            department: input.department ?? null,
          },
          async ({ requestHash }) => {
            const workers = await query.listExpectedAbsences({
              tenantId: input.tenantId,
              businessDate: input.businessDate,
              department: input.department,
            });
            if (workers.length > 500) {
              throw new WorkforceError(
                'REQUEST_LIMIT_EXCEEDED',
                'Auto absence cannot project more than 500 workers in one operation',
                422,
              );
            }
            const nowUtc = clock.nowUtc();
            const statements: TStatement[] = [];
            for (const worker of workers) {
              const projection = await query.projectDay({
                tenantId: input.tenantId,
                staffId: worker.staffId,
                businessDate: input.businessDate,
                punches: [],
              });
              if (projection.status !== 'absent') continue;
              const workerSourceEventKey = `${input.sourceEventKey}:${worker.staffId}`;
              statements.push(
                attendance.prepareUpsertProjection({
                  tenantId: input.tenantId,
                  staffId: worker.staffId,
                  businessDate: projection.businessDate,
                  rosterId: projection.rosterId,
                  shiftId: projection.shiftId,
                  firstInTime: null,
                  lastOutTime: null,
                  firstInLocalTime: null,
                  lastOutLocalTime: null,
                  workedMinutes: 0,
                  status: 'absent',
                  expectedVersion: projection.expectedVersion,
                  updatedAtUtc: nowUtc,
                }),
                attendance.prepareInsertProjectionEvent({
                  tenantId: input.tenantId,
                  eventPublicId: publicIds.next('attendance_projection_event'),
                  staffId: worker.staffId,
                  businessDate: projection.businessDate,
                  projectionStatus: 'absent',
                  expectedResultVersion: projection.resultVersion,
                  source: 'auto_absence',
                  sourceEventKey: workerSourceEventKey,
                  requestHash,
                  punchType: null,
                  occurredAtUtc: null,
                  reason: 'Expected roster worker had no valid attendance punch',
                  actorUserId: input.actorUserId,
                  createdAtUtc: nowUtc,
                }),
              );
            }
            return { result: { count: workers.length }, statements };
          },
        );
      } catch (error) {
        mapAttendanceMutationError(error);
      }
    },
  };
}
