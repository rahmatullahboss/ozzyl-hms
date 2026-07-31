export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type LeaveRequest = {
  leaveRequestId: number;
  tenantId: string;
  staffId: number;
  leaveCategoryId: number;
  startDate: string;
  endDate: string;
  workingDays: number;
  reason: string | null;
  status: LeaveRequestStatus;
};

export type ApprovedLeaveRange = {
  leaveRequestId: number;
  staffId: number;
  startDate: string;
  endDate: string;
  workingDays: number;
  status: 'approved';
};

export type LeaveApprovalResult = {
  leaveRequestId: number;
  workingDays: number;
  rosterConflicts: Array<{ rosterId: number; rosterDate: string; shiftId: number }>;
  requiresRosterReview: boolean;
};
