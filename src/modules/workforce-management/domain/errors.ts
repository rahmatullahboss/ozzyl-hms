export type WorkforceErrorCode =
  | 'WORKFORCE_MEMBER_NOT_FOUND'
  | 'WORKFORCE_MEMBER_INACTIVE'
  | 'SHIFT_NOT_FOUND'
  | 'SHIFT_INACTIVE'
  | 'ROSTER_NOT_FOUND'
  | 'ROSTER_CONFLICT'
  | 'ROSTER_SWAP_SAME_STAFF'
  | 'ROSTER_SWAP_TARGET_MISSING'
  | 'ROTATION_NOT_FOUND'
  | 'ROTATION_INACTIVE'
  | 'INVALID_DATE_RANGE'
  | 'REQUEST_LIMIT_EXCEEDED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'LEAVE_BALANCE_INSUFFICIENT'
  | 'LEAVE_CATEGORY_NOT_FOUND'
  | 'LEAVE_REQUEST_NOT_FOUND'
  | 'LEAVE_REQUEST_CONFLICT'
  | 'LEAVE_CALENDAR_POLICY_CHANGED'
  | 'OVERTIME_LOG_NOT_FOUND'
  | 'OVERTIME_RULE_NOT_FOUND'
  | 'OVERTIME_REVIEW_CONFLICT'
  | 'ATTENDANCE_PUNCH_CONFLICT'
  | 'ATTENDANCE_CORRECTION_REASON_REQUIRED'
  | 'WORKFORCE_PERMISSION_DENIED';

export class WorkforceError extends Error {
  constructor(
    readonly code: WorkforceErrorCode,
    message: string,
    readonly httpStatus: 400 | 403 | 404 | 409 | 422,
    readonly retryable = false,
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = 'WorkforceError';
  }
}
