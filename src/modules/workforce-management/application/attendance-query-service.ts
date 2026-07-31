import type {
  LeaveRepository,
  RosterRepository,
  ShiftRepository,
} from './ports';
import type { WorkCalendarService } from './work-calendar-service';
import type {
  AttendanceDay,
  AttendancePunch,
  AttendanceStatus,
} from '../domain/attendance';
import { resolveAttendanceBusinessDate } from '../domain/attendance';
import type { RosterAssignment } from '../domain/roster';
import type { ShiftDefinition } from '../domain/workforce-member';

export type AttendancePunchRecord = AttendancePunch & {
  businessDate: string;
  requestHash: string;
  reason: string | null;
};

export type ExpectedRosterWorker = {
  staffId: number;
  rosterId: number;
  shiftId: number;
};

export interface AttendanceReadRepository {
  listPunches(tenantId: string, staffId: number, businessDate: string): Promise<AttendancePunchRecord[]>;
  findDay(tenantId: string, staffId: number, businessDate: string): Promise<AttendanceDay | null>;
  listExpectedRosterWorkers(
    tenantId: string,
    businessDate: string,
    department?: string,
  ): Promise<ExpectedRosterWorker[]>;
}

export type AttendanceProjectionPlan = AttendanceDay & {
  expectedVersion: number;
  resultVersion: number;
  firstInLocalTime: string | null;
  lastOutLocalTime: string | null;
};

export type AttendanceBusinessContext = {
  businessDate: string;
  localDate: string;
  localTime: string;
  roster: RosterAssignment | null;
  shift: ShiftDefinition | null;
};

export type AttendanceQueryService = {
  resolveBusinessContext(input: {
    tenantId: string;
    staffId: number;
    occurredAtUtc: string;
    shiftIdOverride?: number;
  }): Promise<AttendanceBusinessContext>;
  projectDay(input: {
    tenantId: string;
    staffId: number;
    businessDate: string;
    punches?: AttendancePunch[];
    shiftIdOverride?: number;
  }): Promise<AttendanceProjectionPlan>;
  listExpectedAbsences(input: {
    tenantId: string;
    businessDate: string;
    department?: string;
  }): Promise<ExpectedRosterWorker[]>;
};

function parseUtc(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError('occurredAtUtc is invalid');
  return parsed;
}

function localParts(occurredAtUtc: string, offsetMinutes: number): { date: string; time: string } {
  const local = new Date(parseUtc(occurredAtUtc) + offsetMinutes * 60_000);
  return {
    date: local.toISOString().slice(0, 10),
    time: local.toISOString().slice(11, 16),
  };
}

function previousDate(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) throw new RangeError('date is invalid');
  return new Date(parsed - 86_400_000).toISOString().slice(0, 10);
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return 0;
  return hours * 60 + minutes;
}

function validRoster(roster: RosterAssignment | null): RosterAssignment | null {
  return roster && roster.status !== 'cancelled' ? roster : null;
}

function compatibilityStatus(status: AttendanceStatus): AttendanceStatus {
  return status;
}

export function createAttendanceQueryService(dependencies: {
  attendance: AttendanceReadRepository;
  rosters: RosterRepository;
  shifts: ShiftRepository;
  leave: LeaveRepository;
  calendar: WorkCalendarService;
  timezoneOffsetMinutes: number;
}): AttendanceQueryService {
  const {
    attendance,
    rosters,
    shifts,
    leave,
    calendar,
    timezoneOffsetMinutes,
  } = dependencies;

  async function loadShift(tenantId: string, roster: RosterAssignment | null): Promise<ShiftDefinition | null> {
    if (!roster) return null;
    return shifts.getShift(tenantId, roster.shiftId);
  }

  async function loadShiftOverride(tenantId: string, shiftId?: number): Promise<ShiftDefinition | null> {
    if (shiftId === undefined) return null;
    return shifts.getShift(tenantId, shiftId);
  }

  async function resolveBusinessContext(input: {
    tenantId: string;
    staffId: number;
    occurredAtUtc: string;
    shiftIdOverride?: number;
  }): Promise<AttendanceBusinessContext> {
    const local = localParts(input.occurredAtUtc, timezoneOffsetMinutes);
    const priorDate = previousDate(local.date);
    const [currentRosterRaw, priorRosterRaw] = await Promise.all([
      rosters.findByStaffDate(input.tenantId, input.staffId, local.date),
      rosters.findByStaffDate(input.tenantId, input.staffId, priorDate),
    ]);
    const currentRoster = validRoster(currentRosterRaw);
    const priorRoster = validRoster(priorRosterRaw);
    const [currentShift, priorShift, overrideShift] = await Promise.all([
      loadShift(input.tenantId, currentRoster),
      loadShift(input.tenantId, priorRoster),
      loadShiftOverride(input.tenantId, input.shiftIdOverride),
    ]);

    if (priorRoster && priorShift) {
      const resolved = resolveAttendanceBusinessDate({
        localDate: local.date,
        localTime: local.time,
        shiftStartTime: priorShift.startTime,
        shiftEndTime: priorShift.endTime,
        isNightShift: priorShift.isNightShift,
      });
      if (resolved === priorDate) {
        return {
          businessDate: priorDate,
          localDate: local.date,
          localTime: local.time,
          roster: priorRoster,
          shift: priorShift,
        };
      }
    }

    const effectiveShift = currentShift ?? overrideShift;
    if (!currentRoster && effectiveShift?.isNightShift) {
      const resolved = resolveAttendanceBusinessDate({
        localDate: local.date,
        localTime: local.time,
        shiftStartTime: effectiveShift.startTime,
        shiftEndTime: effectiveShift.endTime,
        isNightShift: true,
      });
      return {
        businessDate: resolved,
        localDate: local.date,
        localTime: local.time,
        roster: null,
        shift: effectiveShift,
      };
    }

    return {
      businessDate: local.date,
      localDate: local.date,
      localTime: local.time,
      roster: currentRoster,
      shift: effectiveShift,
    };
  }

  async function projectDay(input: {
    tenantId: string;
    staffId: number;
    businessDate: string;
    punches?: AttendancePunch[];
    shiftIdOverride?: number;
  }): Promise<AttendanceProjectionPlan> {
    const [rosterRaw, approvedLeave, calendarDay, storedPunches, currentDay] = await Promise.all([
      rosters.findByStaffDate(input.tenantId, input.staffId, input.businessDate),
      leave.findApprovedLeave(input.tenantId, input.staffId, input.businessDate),
      calendar.evaluateDay(input.tenantId, input.businessDate),
      input.punches ? Promise.resolve(input.punches) : attendance.listPunches(input.tenantId, input.staffId, input.businessDate),
      attendance.findDay(input.tenantId, input.staffId, input.businessDate),
    ]);
    const roster = validRoster(rosterRaw);
    const shift = (await loadShift(input.tenantId, roster))
      ?? (await loadShiftOverride(input.tenantId, input.shiftIdOverride));
    const punches = [...storedPunches]
      .filter((punch) => punch.tenantId === input.tenantId && punch.staffId === input.staffId)
      .sort((a, b) => parseUtc(a.occurredAtUtc) - parseUtc(b.occurredAtUtc));

    const firstIn = punches.find((punch) => punch.punchType === 'in') ?? null;
    const lastOut = [...punches]
      .reverse()
      .find((punch) => punch.punchType === 'out' && (!firstIn || parseUtc(punch.occurredAtUtc) >= parseUtc(firstIn.occurredAtUtc))) ?? null;
    const firstInLocalTime = firstIn ? localParts(firstIn.occurredAtUtc, timezoneOffsetMinutes).time : null;
    const lastOutLocalTime = lastOut ? localParts(lastOut.occurredAtUtc, timezoneOffsetMinutes).time : null;

    const expectedToWork = roster !== null || shift !== null;
    let status: AttendanceStatus;
    if (approvedLeave) {
      status = 'leave';
    } else if (!expectedToWork && punches.length === 0) {
      status = 'off_day';
    } else if (punches.length === 0) {
      status = 'absent';
    } else if (!firstIn || !lastOut) {
      status = 'incomplete';
    } else if (
      shift
      && firstInLocalTime !== null
      && minutesOfDay(firstInLocalTime) > minutesOfDay(shift.startTime) + shift.gracePeriodMinutes
    ) {
      status = 'late';
    } else {
      status = 'present';
    }

    const workedMinutes = firstIn && lastOut
      ? Math.max(0, Math.floor((parseUtc(lastOut.occurredAtUtc) - parseUtc(firstIn.occurredAtUtc)) / 60_000))
      : 0;
    const expectedVersion = currentDay?.projectionVersion ?? 0;

    return {
      tenantId: input.tenantId,
      staffId: input.staffId,
      businessDate: input.businessDate,
      rosterId: roster?.rosterId ?? null,
      shiftId: roster?.shiftId ?? shift?.shiftId ?? null,
      firstInTime: firstIn?.occurredAtUtc ?? null,
      lastOutTime: lastOut?.occurredAtUtc ?? null,
      firstInLocalTime,
      lastOutLocalTime,
      workedMinutes,
      status: compatibilityStatus(status),
      projectionVersion: expectedVersion + 1,
      expectedVersion,
      resultVersion: expectedVersion + 1,
    };
  }

  async function listExpectedAbsences(input: {
    tenantId: string;
    businessDate: string;
    department?: string;
  }): Promise<ExpectedRosterWorker[]> {
    const workers = await attendance.listExpectedRosterWorkers(
      input.tenantId,
      input.businessDate,
      input.department,
    );
    const results = await Promise.all(workers.map(async (worker) => {
      const [approvedLeave, day, punches] = await Promise.all([
        leave.findApprovedLeave(input.tenantId, worker.staffId, input.businessDate),
        attendance.findDay(input.tenantId, worker.staffId, input.businessDate),
        attendance.listPunches(input.tenantId, worker.staffId, input.businessDate),
      ]);
      return approvedLeave || day || punches.length > 0 ? null : worker;
    }));
    return results.filter((worker): worker is ExpectedRosterWorker => worker !== null);
  }

  return { resolveBusinessContext, projectDay, listExpectedAbsences };
}
