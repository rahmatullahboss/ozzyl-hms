export type AttendancePunchSource = 'biometric' | 'rfid' | 'manual' | 'web' | 'mobile' | 'device';
export type AttendancePunchType = 'in' | 'out' | 'break_start' | 'break_end';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave' | 'half_day' | 'off_day' | 'incomplete';

export type AttendanceDay = {
  tenantId: string;
  staffId: number;
  businessDate: string;
  rosterId: number | null;
  shiftId: number | null;
  firstInTime: string | null;
  lastOutTime: string | null;
  workedMinutes: number;
  status: AttendanceStatus;
  projectionVersion: number;
};

export type AttendancePunch = {
  punchId: number;
  tenantId: string;
  staffId: number;
  occurredAtUtc: string;
  punchType: AttendancePunchType;
  source: AttendancePunchSource;
  sourceEventKey: string;
};

export function resolveAttendanceBusinessDate(input: {
  localDate: string;
  localTime: string;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  isNightShift: boolean;
}): string {
  if (!input.isNightShift || !input.shiftStartTime || !input.shiftEndTime) return input.localDate;
  if (input.localTime >= input.shiftStartTime) return input.localDate;
  if (input.localTime <= input.shiftEndTime) {
    const current = Date.parse(`${input.localDate}T00:00:00Z`);
    if (!Number.isFinite(current)) throw new RangeError('localDate is invalid');
    return new Date(current - 86_400_000).toISOString().slice(0, 10);
  }
  return input.localDate;
}
