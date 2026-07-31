import type {
  HolidayDto,
  OvertimeRuleDto,
  RosterAssignmentDto,
  RotationPatternDto,
  ShiftDefinitionDto,
} from './dto';

type DatabaseRow = Record<string, unknown>;

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value === '1' || value === 'true';
}

export function mapRosterRow(row: DatabaseRow): RosterAssignmentDto {
  const status = stringValue(row.status, 'scheduled');
  return {
    rosterId: numberValue(row.id),
    staffId: numberValue(row.staff_id),
    staffName: stringValue(row.staff_name),
    position: stringValue(row.position),
    department: nullableString(row.department),
    shiftId: numberValue(row.shift_id),
    shiftName: stringValue(row.shift_name),
    shiftShortCode: nullableString(row.shift_short_code ?? row.short_code),
    shiftStartTime: stringValue(row.shift_start ?? row.start_time),
    shiftEndTime: stringValue(row.shift_end ?? row.end_time),
    shiftColor: nullableString(row.shift_color ?? row.color),
    rosterDate: stringValue(row.roster_date),
    status: status === 'swapped' || status === 'cancelled' ? status : 'scheduled',
    swappedWithStaffId: row.swapped_with_staff_id === null || row.swapped_with_staff_id === undefined
      ? null
      : numberValue(row.swapped_with_staff_id),
    remarks: nullableString(row.remarks),
    version: numberValue(row.version, 1),
  };
}

export function mapShiftRow(row: DatabaseRow): ShiftDefinitionDto {
  return {
    shiftId: numberValue(row.id),
    name: stringValue(row.shift_name ?? row.name),
    shortCode: nullableString(row.short_code),
    startTime: stringValue(row.start_time),
    endTime: stringValue(row.end_time),
    gracePeriodMinutes: numberValue(row.grace_period ?? row.grace_period_minutes),
    breakDurationMinutes: numberValue(row.break_duration ?? row.break_duration_minutes),
    isNightShift: booleanValue(row.is_night_shift),
    color: nullableString(row.color),
    isActive: booleanValue(row.is_active, true),
  };
}

export function mapRotationPattern(
  pattern: DatabaseRow,
  rows: DatabaseRow[],
): RotationPatternDto {
  const cycleDays = numberValue(pattern.cycle_days);
  return {
    patternId: numberValue(pattern.id),
    patternName: stringValue(pattern.pattern_name),
    cycleDays,
    isActive: booleanValue(pattern.is_active, true),
    days: Array.from({ length: cycleDays }, (_, index) => {
      const dayNumber = index + 1;
      const row = rows.find((candidate) => numberValue(candidate.day_number) === dayNumber);
      if (!row || booleanValue(row.is_off)) {
        return { dayNumber, shiftId: null, shiftName: null, isOff: true };
      }
      return {
        dayNumber,
        shiftId: numberValue(row.shift_id),
        shiftName: nullableString(row.shift_name),
        isOff: false,
      };
    }),
  };
}

export function mapHolidayRow(row: DatabaseRow): HolidayDto {
  const type = stringValue(row.holiday_type, 'public');
  return {
    holidayId: numberValue(row.id),
    name: stringValue(row.holiday_name),
    date: stringValue(row.holiday_date),
    type: type === 'optional' || type === 'restricted' ? type : 'public',
    isActive: booleanValue(row.is_active, true),
  };
}

export function mapOvertimeRuleRow(row: DatabaseRow): OvertimeRuleDto {
  const appliesOn = stringValue(row.applies_on, 'weekday');
  return {
    ruleId: numberValue(row.id),
    ruleName: stringValue(row.rule_name),
    multiplier: numberValue(row.multiplier, 1.5),
    minHoursBeforeOvertime: numberValue(row.min_hours_before_ot),
    maxOvertimeHoursPerDay: numberValue(row.max_ot_hours_per_day, 4),
    appliesOn: appliesOn === 'weekend' || appliesOn === 'holiday' || appliesOn === 'all'
      ? appliesOn
      : 'weekday',
    isActive: booleanValue(row.is_active, true),
  };
}
