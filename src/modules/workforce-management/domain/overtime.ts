export type OvertimeAppliesOn = 'weekday' | 'weekend' | 'holiday' | 'all';
export type OvertimeStatus = 'pending' | 'approved' | 'rejected';

export type OvertimeRule = {
  ruleId: number;
  tenantId: string;
  ruleName: string;
  multiplier: number;
  minHoursBeforeOvertime: number;
  maxOvertimeHoursPerDay: number;
  appliesOn: OvertimeAppliesOn;
  isActive: boolean;
};

export type ApprovedOvertime = {
  overtimeLogId: number;
  staffId: number;
  businessDate: string;
  approvedHours: number;
  multiplierSnapshot: number;
  status: 'approved';
};

export type WorkforcePayrollInput = {
  staffId: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  halfDays: number;
  approvedOvertimeHours: number;
  overtimeMultiplierSnapshots: number[];
};

export type RejectedOvertime = {
  overtimeLogId: number;
  staffId: number;
  businessDate: string;
  status: 'rejected';
};

export type OvertimeReviewResult = ApprovedOvertime | RejectedOvertime;
