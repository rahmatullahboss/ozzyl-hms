export type WorkforceMemberStatus = 'active' | 'inactive';

export type WorkforceMemberRef = {
  tenantId: string;
  staffId: number;
  displayName: string;
  position: string;
  department: string | null;
  status: WorkforceMemberStatus;
  userId: number | null;
  practitionerPublicId: string | null;
};

export type ShiftDefinition = {
  tenantId: string;
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
