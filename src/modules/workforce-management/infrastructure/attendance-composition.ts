import { createAttendancePunchService } from '../application/attendance-punch-service';
import { createAttendanceQueryService } from '../application/attendance-query-service';
import { createWorkCalendarService } from '../application/work-calendar-service';
import {
  createD1AttendanceLeaveRepository,
  createD1AttendanceRepository,
} from './d1-attendance-repository';
import { createD1RosterRepository } from './d1-roster-repository';
import { createD1WorkCalendarRepository } from './d1-work-calendar-repository';
import { createD1WorkforceDirectoryRepository } from './d1-workforce-member-repository';
import { createD1WorkforceIdempotencyRepository } from './d1-workforce-idempotency-repository';
import { createWorkforceTransaction } from './workforce-transaction-adapter';

export function createD1AttendanceApplication(input: {
  db: D1Database;
  timezoneOffsetMinutes: number;
  nowUtc?: () => string;
  publicId?: (prefix: string) => string;
}) {
  const attendance = createD1AttendanceRepository(input.db);
  const directory = createD1WorkforceDirectoryRepository(input.db);
  const query = createAttendanceQueryService({
    attendance,
    rosters: createD1RosterRepository(input.db),
    shifts: directory,
    leave: createD1AttendanceLeaveRepository(input.db),
    calendar: createWorkCalendarService({
      calendar: createD1WorkCalendarRepository(input.db),
    }),
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
  });
  const punches = createAttendancePunchService({
    workforceMembers: directory,
    attendance,
    query,
    idempotency: createD1WorkforceIdempotencyRepository(input.db),
    transaction: createWorkforceTransaction(input.db),
    clock: { nowUtc: input.nowUtc ?? (() => new Date().toISOString()) },
    publicIds: {
      next: input.publicId ?? ((prefix) => `${prefix}_${crypto.randomUUID()}`),
    },
  });

  return { attendance, query, punches };
}
