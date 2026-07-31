import type { WorkforceModuleDependencies } from './application/ports';

export * from './application/attendance-punch-service';
export * from './application/attendance-query-service';
export * from './application/leave-service';
export * from './application/overtime-service';
export * from './application/ports';
export * from './application/roster-service';
export * from './application/rotation-service';
export * from './application/work-calendar-service';
export * from './application/workforce-payroll-input-query';
export * from './application/workforce-directory';
export * from './domain/attendance';
export * from './domain/errors';
export * from './domain/leave';
export * from './domain/overtime';
export * from './domain/roster';
export * from './domain/work-calendar';
export * from './domain/workforce-member';
export type * from './transport/dto';
export { createD1AttendanceApplication } from './infrastructure/attendance-composition';
export { createD1LeaveRepository } from './infrastructure/d1-leave-repository';
export { createD1OvertimeRepository } from './infrastructure/d1-overtime-repository';
export {
  createD1AttendanceLeaveRepository,
  createD1AttendanceRepository,
} from './infrastructure/d1-attendance-repository';
export {
  createD1RosterRepository,
  createD1RotationRepository,
} from './infrastructure/d1-roster-repository';
export { createD1WorkCalendarRepository } from './infrastructure/d1-work-calendar-repository';
export { createD1WorkforceDirectoryRepository } from './infrastructure/d1-workforce-member-repository';
export {
  createD1WorkforceIdempotencyRepository,
  hashWorkforceRequest,
  runIdempotentWorkforceMutation,
} from './infrastructure/d1-workforce-idempotency-repository';
export type {
  WorkforceIdempotencyClaim,
  WorkforceIdempotencyCoordinator,
  WorkforceIdempotencyRecord,
  WorkforceMutationIdentity,
  WorkforceMutationPlan,
} from './infrastructure/d1-workforce-idempotency-repository';
export { createWorkforceTransaction } from './infrastructure/workforce-transaction-adapter';
export {
  mapHolidayRow,
  mapOvertimeRuleRow,
  mapRosterRow,
  mapRotationPattern,
  mapShiftRow,
} from './transport/mappers';

export type WorkforceModule = Readonly<WorkforceModuleDependencies>;

export function createWorkforceModule(dependencies: WorkforceModuleDependencies): WorkforceModule {
  return Object.freeze({ ...dependencies });
}
