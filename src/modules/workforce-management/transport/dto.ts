export type RosterAssignmentDto = {
  rosterId: number;
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
  status: 'scheduled' | 'swapped' | 'cancelled';
  swappedWithStaffId: number | null;
  remarks: string | null;
  version: number;
};

export type ShiftDefinitionDto = {
  shiftId: number;
  name: string;
  shortCode: string | null;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  breakDurationMinutes: number;
  isNightShift: boolean;
  color: string | null;
  isActive: boolean;
};

export type RotationPatternDto = {
  patternId: number;
  patternName: string;
  cycleDays: number;
  isActive: boolean;
  days: Array<{
    dayNumber: number;
    shiftId: number | null;
    shiftName: string | null;
    isOff: boolean;
  }>;
};

export type HolidayDto = {
  holidayId: number;
  name: string;
  date: string;
  type: 'public' | 'optional' | 'restricted';
  isActive: boolean;
};

export type OvertimeRuleDto = {
  ruleId: number;
  ruleName: string;
  multiplier: number;
  minHoursBeforeOvertime: number;
  maxOvertimeHoursPerDay: number;
  appliesOn: 'weekday' | 'weekend' | 'holiday' | 'all';
  isActive: boolean;
};
