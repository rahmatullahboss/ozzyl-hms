import type { AttendanceDay, AttendancePunch } from '../domain/attendance';
import type { ApprovedLeaveRange, LeaveRequest } from '../domain/leave';
import type { ApprovedOvertime, OvertimeRule, WorkforcePayrollInput } from '../domain/overtime';
import type { RosterAssignment, RotationPattern } from '../domain/roster';
import type { WorkCalendarDay, WeekendWeekPattern, WeekdayName } from '../domain/work-calendar';
import type { ShiftDefinition, WorkforceMemberRef } from '../domain/workforce-member';

export interface WorkforceMemberRepository {
  getMember(tenantId: string, staffId: number): Promise<WorkforceMemberRef | null>;
  getActiveMember(tenantId: string, staffId: number): Promise<WorkforceMemberRef | null>;
  listActiveMembers(tenantId: string): Promise<WorkforceMemberRef[]>;
}

export interface ShiftRepository {
  getShift(tenantId: string, shiftId: number): Promise<ShiftDefinition | null>;
  listActiveShifts(tenantId: string): Promise<ShiftDefinition[]>;
}

export interface RosterRepository {
  findById(tenantId: string, rosterId: number): Promise<RosterAssignment | null>;
  findByStaffDate(tenantId: string, staffId: number, rosterDate: string): Promise<RosterAssignment | null>;
  list(input: {
    tenantId: string;
    from: string;
    to: string;
    staffId?: number;
    shiftId?: number;
    department?: string;
  }): Promise<RosterAssignment[]>;
}

export interface RotationRepository {
  getPattern(tenantId: string, patternId: number): Promise<RotationPattern | null>;
  listPatterns(tenantId: string): Promise<RotationPattern[]>;
}

export type WeekendPolicyRecord = {
  weekday: WeekdayName;
  weekPattern: WeekendWeekPattern;
  isActive: boolean;
};

export interface WorkCalendarRepository {
  listWeekendPolicies(tenantId: string, year: number): Promise<WeekendPolicyRecord[]>;
  getHoliday(tenantId: string, date: string): Promise<WorkCalendarDay['holiday']>;
}

export interface AttendanceRepository {
  findDay(tenantId: string, staffId: number, businessDate: string): Promise<AttendanceDay | null>;
  listPunches(tenantId: string, staffId: number, businessDate: string): Promise<AttendancePunch[]>;
}

export interface LeaveRepository {
  findRequest(tenantId: string, leaveRequestId: number): Promise<LeaveRequest | null>;
  findApprovedLeave(tenantId: string, staffId: number, date: string): Promise<ApprovedLeaveRange | null>;
}

export interface OvertimeRepository {
  getRule(tenantId: string, ruleId: number): Promise<OvertimeRule | null>;
  listApproved(tenantId: string, staffId: number, from: string, to: string): Promise<ApprovedOvertime[]>;
  getMonthlyPayrollInputs(tenantId: string, runMonth: string): Promise<WorkforcePayrollInput[]>;
}

export type WorkforceIdempotencyStatus = 'processing' | 'completed' | 'failed';

export type WorkforceIdempotencyRecord<TResult = unknown> = {
  tenantId: string;
  mutationType: string;
  idempotencyKey: string;
  requestHash: string;
  status: WorkforceIdempotencyStatus;
  result: TResult | null;
};

export interface WorkforceIdempotencyRepository {
  find<TResult>(tenantId: string, mutationType: string, idempotencyKey: string): Promise<WorkforceIdempotencyRecord<TResult> | null>;
}

export interface WorkforceClock {
  nowUtc(): string;
}

export interface WorkforcePublicIdGenerator {
  next(prefix: string): string;
}

export type WorkforceAuditEvent = {
  tenantId: string;
  actorUserId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  occurredAtUtc: string;
  reason?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export interface WorkforceAuditPort {
  record(event: WorkforceAuditEvent): Promise<void>;
}

export interface WorkforceMutationStatement {
  readonly statementKind: string;
}

export interface WorkforceTransaction<TStatement = WorkforceMutationStatement> {
  commit(statements: readonly TStatement[]): Promise<void>;
}

export type WorkforceModuleDependencies = {
  workforceMembers: WorkforceMemberRepository;
  shifts: ShiftRepository;
  rosters: RosterRepository;
  rotations: RotationRepository;
  calendar: WorkCalendarRepository;
  attendance: AttendanceRepository;
  leave: LeaveRepository;
  overtime: OvertimeRepository;
  idempotency: WorkforceIdempotencyRepository;
  clock: WorkforceClock;
  publicIds: WorkforcePublicIdGenerator;
  audit: WorkforceAuditPort;
};
