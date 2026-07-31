import type {
  LeaveBalanceRecord,
  LeaveCategoryRecord,
  LeaveMutationRepository,
  LeaveRequestRecord,
  LeaveRosterConflict,
  PreparedLeaveAttendanceEvent,
  PreparedLeaveAttendanceProjection,
  PreparedLeaveBalanceAdjustment,
  PreparedLeaveReview,
} from '../application/leave-service';
import type { AttendanceDay, AttendanceStatus } from '../domain/attendance';
import type { LeaveRequestStatus } from '../domain/leave';

type DatabaseRow = Record<string, unknown>;

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value);
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value === '1' || value === 'true';
}

function leaveStatus(value: unknown): LeaveRequestStatus {
  return value === 'approved' || value === 'rejected' || value === 'cancelled'
    ? value
    : 'pending';
}

function attendanceStatus(value: unknown): AttendanceStatus {
  return value === 'absent' || value === 'late' || value === 'leave'
    || value === 'half_day' || value === 'off_day' || value === 'incomplete'
    ? value
    : 'present';
}

function mapCategory(row: DatabaseRow): LeaveCategoryRecord {
  return {
    tenantId: stringValue(row.tenant_id),
    leaveCategoryId: numberValue(row.id),
    leaveName: stringValue(row.leave_name),
    isActive: booleanValue(row.is_active, true),
  };
}

function mapBalance(row: DatabaseRow): LeaveBalanceRecord {
  return {
    tenantId: stringValue(row.tenant_id),
    staffId: numberValue(row.staff_id),
    leaveCategoryId: numberValue(row.leave_category_id),
    year: numberValue(row.year),
    balance: numberValue(row.balance),
    used: numberValue(row.used),
  };
}

function mapRequest(row: DatabaseRow): LeaveRequestRecord {
  return {
    leaveRequestId: numberValue(row.id),
    tenantId: stringValue(row.tenant_id),
    staffId: numberValue(row.staff_id),
    leaveCategoryId: numberValue(row.leave_category_id),
    startDate: stringValue(row.start_date),
    endDate: stringValue(row.end_date),
    workingDays: numberValue(row.total_days),
    reason: stringOrNull(row.reason),
    requestedTo: numberOrNull(row.requested_to),
    status: leaveStatus(row.status),
  };
}

function mapAttendanceDay(row: DatabaseRow): AttendanceDay {
  return {
    tenantId: stringValue(row.tenant_id),
    staffId: numberValue(row.staff_id),
    businessDate: stringValue(row.business_date ?? row.date),
    rosterId: numberOrNull(row.roster_id),
    shiftId: numberOrNull(row.shift_id),
    firstInTime: stringOrNull(row.first_in_at_utc),
    lastOutTime: stringOrNull(row.last_out_at_utc),
    workedMinutes: numberValue(row.worked_minutes),
    status: attendanceStatus(row.projection_status ?? row.status),
    projectionVersion: numberValue(row.projection_version, 1),
  };
}

export function createD1LeaveRepository(
  db: D1Database,
): LeaveMutationRepository<D1PreparedStatement> {
  return {
    async getCategory(tenantId, categoryId) {
      const row = await db.prepare(`
        SELECT id, tenant_id, leave_name, is_active
        FROM hr_leave_categories
        WHERE CAST(tenant_id AS TEXT) = ? AND id = ?
        LIMIT 1
      `).bind(tenantId, categoryId).first<DatabaseRow>();
      return row ? mapCategory(row) : null;
    },

    async getBalance(tenantId, staffId, categoryId, year) {
      const row = await db.prepare(`
        SELECT tenant_id, staff_id, leave_category_id, year, balance, used
        FROM hr_employee_leave_balances
        WHERE CAST(tenant_id AS TEXT) = ?
          AND staff_id = ?
          AND leave_category_id = ?
          AND year = ?
        LIMIT 1
      `).bind(tenantId, staffId, categoryId, year).first<DatabaseRow>();
      return row ? mapBalance(row) : null;
    },

    async getRequest(tenantId, requestId) {
      const row = await db.prepare(`
        SELECT id, tenant_id, staff_id, leave_category_id, start_date, end_date,
               total_days, reason, requested_to, status
        FROM hr_leave_requests
        WHERE CAST(tenant_id AS TEXT) = ? AND id = ?
        LIMIT 1
      `).bind(tenantId, requestId).first<DatabaseRow>();
      return row ? mapRequest(row) : null;
    },

    async createRequest(input) {
      const result = await db.prepare(`
        INSERT INTO hr_leave_requests (
          tenant_id, staff_id, leave_category_id, start_date, end_date,
          total_days, reason, requested_to, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).bind(
        input.tenantId,
        input.staffId,
        input.leaveCategoryId,
        input.startDate,
        input.endDate,
        input.workingDays,
        input.reason,
        input.requestedTo,
      ).run();
      return Number(result.meta.last_row_id);
    },

    async listRosterConflicts(tenantId, staffId, startDate, endDate) {
      const { results } = await db.prepare(`
        SELECT id, roster_date, shift_id
        FROM hr_duty_roster
        WHERE CAST(tenant_id AS TEXT) = ?
          AND staff_id = ?
          AND roster_date >= ?
          AND roster_date <= ?
          AND status != 'cancelled'
        ORDER BY roster_date, id
      `).bind(tenantId, staffId, startDate, endDate).all<DatabaseRow>();
      return (results ?? []).map((row): LeaveRosterConflict => ({
        rosterId: numberValue(row.id),
        rosterDate: stringValue(row.roster_date),
        shiftId: numberValue(row.shift_id),
      }));
    },

    async listExistingAttendanceDays(tenantId, staffId, startDate, endDate) {
      const { results } = await db.prepare(`
        SELECT tenant_id, staff_id, date, business_date, roster_id, shift_id,
               first_in_at_utc, last_out_at_utc, worked_minutes,
               projection_status, status, projection_version
        FROM hr_attendance
        WHERE CAST(tenant_id AS TEXT) = ?
          AND staff_id = ?
          AND COALESCE(business_date, date) >= ?
          AND COALESCE(business_date, date) <= ?
        ORDER BY COALESCE(business_date, date)
      `).bind(tenantId, staffId, startDate, endDate).all<DatabaseRow>();
      return (results ?? []).map(mapAttendanceDay);
    },

    prepareAdjustBalance(input: PreparedLeaveBalanceAdjustment) {
      return db.prepare(`
        UPDATE hr_employee_leave_balances
        SET balance = balance - ?, used = used + ?
        WHERE CAST(tenant_id AS TEXT) = ?
          AND staff_id = ?
          AND leave_category_id = ?
          AND year = ?
          AND balance = ?
          AND used = ?
          AND balance >= ?
      `).bind(
        input.deductDays,
        input.deductDays,
        input.tenantId,
        input.staffId,
        input.leaveCategoryId,
        input.year,
        input.expectedBalance,
        input.expectedUsed,
        input.deductDays,
      );
    },

    prepareReviewRequest(input: PreparedLeaveReview) {
      if (input.approvedBalanceGuard) {
        const guard = input.approvedBalanceGuard;
        return db.prepare(`
          UPDATE hr_leave_requests
          SET status = CASE
                WHEN status = ?
                 AND changes() = 1
                 AND EXISTS (
                   SELECT 1
                   FROM hr_employee_leave_balances lb
                   WHERE CAST(lb.tenant_id AS TEXT) = ?
                     AND lb.staff_id = ?
                     AND lb.leave_category_id = ?
                     AND lb.year = ?
                     AND lb.balance = ?
                     AND lb.used = ?
                 )
                THEN ?
                ELSE NULL
              END,
              approved_by = ?,
              approved_on = ?,
              rejection_reason = ?
          WHERE CAST(tenant_id AS TEXT) = ? AND id = ?
        `).bind(
          input.expectedStatus,
          input.tenantId,
          guard.staffId,
          guard.leaveCategoryId,
          guard.year,
          guard.expectedBalanceAfterDeduction,
          guard.expectedUsedAfterDeduction,
          input.status,
          input.actorUserId,
          input.reviewedAtUtc,
          input.rejectionReason,
          input.tenantId,
          input.leaveRequestId,
        );
      }

      return db.prepare(`
        UPDATE hr_leave_requests
        SET status = CASE WHEN status = ? THEN ? ELSE NULL END,
            approved_by = ?,
            approved_on = ?,
            rejection_reason = ?
        WHERE CAST(tenant_id AS TEXT) = ? AND id = ?
      `).bind(
        input.expectedStatus,
        input.status,
        input.actorUserId,
        input.reviewedAtUtc,
        input.rejectionReason,
        input.tenantId,
        input.leaveRequestId,
      );
    },

    prepareAttendanceProjection(input: PreparedLeaveAttendanceProjection) {
      return db.prepare(`
        UPDATE hr_attendance
        SET status = 'leave',
            projection_status = ?,
            worked_minutes = 0,
            projection_version = projection_version + 1,
            projection_updated_at_utc = ?,
            remarks = 'Approved leave reconciliation'
        WHERE CAST(tenant_id AS TEXT) = ?
          AND staff_id = ?
          AND COALESCE(business_date, date) = ?
          AND projection_version = ?
      `).bind(
        input.status,
        input.updatedAtUtc,
        input.tenantId,
        input.staffId,
        input.businessDate,
        input.expectedVersion,
      );
    },

    prepareAttendanceEvent(input: PreparedLeaveAttendanceEvent) {
      return db.prepare(`
        INSERT INTO hr_attendance_projection_events (
          tenant_id, event_public_id, attendance_id, staff_id, business_date,
          projection_status, projection_version, source, source_event_key,
          request_hash, punch_type, occurred_at_utc, reason, actor_user_id,
          created_at_utc
        ) VALUES (
          ?, ?,
          (
            SELECT id
            FROM hr_attendance
            WHERE CAST(tenant_id AS TEXT) = ?
              AND staff_id = ?
              AND COALESCE(business_date, date) = ?
              AND projection_version = ?
            LIMIT 1
          ),
          ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?
        )
      `).bind(
        input.tenantId,
        input.eventPublicId,
        input.tenantId,
        input.staffId,
        input.businessDate,
        input.expectedResultVersion,
        input.staffId,
        input.businessDate,
        input.projectionStatus,
        input.expectedResultVersion,
        input.source,
        input.sourceEventKey,
        input.requestHash,
        input.reason,
        input.actorUserId,
        input.createdAtUtc,
      );
    },
  };
}
