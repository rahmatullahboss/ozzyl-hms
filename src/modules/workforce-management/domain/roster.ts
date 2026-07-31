export type RosterStatus = 'scheduled' | 'swapped' | 'cancelled';

export type RosterAssignment = {
  rosterId: number;
  tenantId: string;
  staffId: number;
  staffName: string;
  position: string;
  department: string | null;
  shiftId: number;
  shiftName: string;
  shiftShortCode: string | null;
  shiftStartTime: string;
  shiftEndTime: string;
  shiftColor: string | null;
  rosterDate: string;
  status: RosterStatus;
  swappedWithStaffId: number | null;
  remarks: string | null;
  version: number;
};

export type RotationDay = {
  dayNumber: number;
  shiftId: number | null;
  shiftName: string | null;
  isOff: boolean;
};

export type RotationPattern = {
  patternId: number;
  tenantId: string;
  patternName: string;
  cycleDays: number;
  isActive: boolean;
  days: RotationDay[];
};

function parseBusinessDate(value: string, field: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${field} must be YYYY-MM-DD`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) throw new RangeError(`${field} is invalid`);
  return parsed;
}

export function calculateCycleDay(input: {
  startDate: string;
  targetDate: string;
  cycleDays: number;
  cycleOffset: number;
}): number {
  if (!Number.isInteger(input.cycleDays) || input.cycleDays < 1) {
    throw new RangeError('cycleDays must be positive');
  }
  if (!Number.isInteger(input.cycleOffset) || input.cycleOffset < 0) {
    throw new RangeError('cycleOffset must be a non-negative integer');
  }

  const start = parseBusinessDate(input.startDate, 'startDate');
  const target = parseBusinessDate(input.targetDate, 'targetDate');
  const elapsed = Math.floor((target - start) / 86_400_000);
  if (elapsed < 0) throw new RangeError('targetDate is before startDate');
  return ((elapsed + input.cycleOffset) % input.cycleDays) + 1;
}

export function enumerateInclusiveDates(startDate: string, endDate: string): string[] {
  const start = parseBusinessDate(startDate, 'startDate');
  const end = parseBusinessDate(endDate, 'endDate');
  if (end < start) throw new RangeError('endDate is before startDate');

  const count = Math.floor((end - start) / 86_400_000) + 1;
  if (count > 62) throw new RangeError('date range exceeds 62 days');

  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}
