import type {
  OvertimeLogRecord,
  OvertimeMutationRepository,
  OvertimeReviewMutation,
} from '../application/overtime-service';
import type {
  PayrollInputAttendanceFact,
  PayrollInputLeaveFact,
  PayrollInputOvertimeFact,
  WorkforcePayrollInputRepository,
} from '../application/workforce-payroll-input-query';
import type { AttendanceStatus } from '../domain/attendance';
import type { OvertimeAppliesOn, OvertimeRule, OvertimeStatus } from '../domain/overtime';

type Row = Record<string, unknown>;

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function overtimeStatus(value: unknown): OvertimeStatus {
  return value === 'approved' || value === 'rejected' ? value : 'pending';
}

function overtimeAppliesOn(value: unknown): OvertimeAppliesOn {
  return value === 'weekend' || value === 'holiday' || value === 'all' ? value : 'weekday';
}

function attendanceStatus(value: unknown): AttendanceStatus {
  return value === 'absent' || value === 'late' || value === 'leave'
    || value === 'half_day' || value === 'off_day' || value === 'incomplete'
    ? value
    : 'present';
}

function mapLog(row: Row): OvertimeLogRecord {
  return {
    overtimeLogId: numberValue(row.id),
    tenantId: String(row.tenant_id ?? ''),
    staffId: numberValue(row.staff_id),
    businessDate: String(row.date ?? ''),
    scheduledHours: numberValue(row.scheduled_hours),
    actualHours: numberValue(row.actual_hours),
    overtimeHours: numberValue(row.overtime_hours),
    ruleId: numberOrNull(row.rule_id),
    multiplierSnapshot: numberValue(row.multiplier, 1.5),
    status: overtimeStatus(row.status),
    approvedBy: stringOrNull(row.approved_by),
    approvedAtUtc: stringOrNull(row.approved_at),
  };
}

function mapRule(row: Row): OvertimeRule {
  return {
    ruleId: numberValue(row.id),
    tenantId: String(row.tenant_id ?? ''),
    ruleName: String(row.rule_name ?? ''),
    multiplier: numberValue(row.multiplier, 1.5),
    minHoursBeforeOvertime: numberValue(row.min_hours_before_ot),
    maxOvertimeHoursPerDay: numberValue(row.max_ot_hours_per_day, 4),
    appliesOn: overtimeAppliesOn(row.applies_on),
    isActive: Number(row.is_active ?? 1) !== 0,
  };
}

async function reviewOvertime(db: D1Database, mutation: OvertimeReviewMutation): Promise<boolean> {
  const update = mutation.status === 'approved'
    ? db.prepare(`
        UPDATE hr_overtime_log
        SET status = ?,
            overtime_hours = ?,
            rule_id = ?,
            multiplier = ?,
            approved_by = ?,
            approved_at = ?
        WHERE CAST(tenant_id AS TEXT) = ?
          AND id = ?
          AND status = ?
      `).bind(
        mutation.status,
        mutation.approvedHours,
        mutation.ruleId,
        mutation.multiplierSnapshot,
        mutation.actorUserId,
        mutation.reviewedAtUtc,
        mutation.tenantId,
        mutation.overtimeLogId,
        mutation.expectedStatus,
      )
    : db.prepare(`
        UPDATE hr_overtime_log
        SET status = ?,
            approved_by = ?,
            approved_at = ?
        WHERE CAST(tenant_id AS TEXT) = ?
          AND id = ?
          AND status = ?
      `).bind(
        mutation.status,
        mutation.actorUserId,
        mutation.reviewedAtUtc,
        mutation.tenantId,
        mutation.overtimeLogId,
        mutation.expectedStatus,
      );

  const auditPayload = JSON.stringify({
    status: mutation.status,
    approvedHours: mutation.approvedHours,
    multiplierSnapshot: mutation.multiplierSnapshot,
    ruleId: mutation.ruleId,
  });
  const audit = db.prepare(`
    INSERT INTO audit_logs (
      tenant_id, user_id, action, table_name, record_id, new_value, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE changes() = 1
  `).bind(
    mutation.tenantId,
    mutation.actorUserId,
    mutation.status === 'approved' ? 'APPROVE' : 'REJECT',
    'hr_overtime_log',
    mutation.overtimeLogId,
    auditPayload,
    mutation.reviewedAtUtc,
  );

  const results = await db.batch([update, audit]);
  return Number(results[0]?.meta.changes ?? 0) === 1
    && Number(results[1]?.meta.changes ?? 0) === 1;
}

export function createD1OvertimeRepository(
  db: D1Database,
): OvertimeMutationRepository & WorkforcePayrollInputRepository {
  return {
    async getLog(tenantId, overtimeLogId) {
      const row = await db.prepare(`
        SELECT id, tenant_id, staff_id, date, scheduled_hours, actual_hours,
               overtime_hours, rule_id, multiplier, status, approved_by, approved_at
        FROM hr_overtime_log
        WHERE CAST(tenant_id AS TEXT) = ? AND id = ?
        LIMIT 1
      `).bind(tenantId, overtimeLogId).first<Row>();
      return row ? mapLog(row) : null;
    },

    async listActiveRules(tenantId) {
      const { results } = await db.prepare(`
        SELECT id, tenant_id, rule_name, multiplier, min_hours_before_ot,
               max_ot_hours_per_day, applies_on, is_active
        FROM hr_overtime_rules
        WHERE CAST(tenant_id AS TEXT) = ? AND is_active = 1
        ORDER BY id
      `).bind(tenantId).all<Row>();
      return (results ?? []).map(mapRule);
    },

    review(mutation) {
      return reviewOvertime(db, mutation);
    },

    async listAttendanceFacts(tenantId, startDate, endDate) {
      const { results } = await db.prepare(`
        SELECT staff_id, COALESCE(projection_status, status) AS attendance_status
        FROM hr_attendance
        WHERE CAST(tenant_id AS TEXT) = ?
          AND COALESCE(business_date, date) >= ?
          AND COALESCE(business_date, date) <= ?
      `).bind(tenantId, startDate, endDate).all<Row>();
      return (results ?? []).map((row): PayrollInputAttendanceFact => ({
        staffId: numberValue(row.staff_id),
        status: attendanceStatus(row.attendance_status),
      }));
    },

    async listApprovedLeaveFacts(tenantId, startDate, endDate) {
      const { results } = await db.prepare(`
        SELECT lr.staff_id,
               lr.total_days AS working_days,
               COALESCE(rule.pay_percent, 100) AS pay_percent
        FROM hr_leave_requests lr
        LEFT JOIN hr_leave_rules rule
          ON CAST(rule.tenant_id AS TEXT) = CAST(lr.tenant_id AS TEXT)
         AND rule.leave_category_id = lr.leave_category_id
         AND rule.year = CAST(substr(lr.start_date, 1, 4) AS INTEGER)
         AND rule.is_active = 1
         AND rule.is_approved = 1
        WHERE CAST(lr.tenant_id AS TEXT) = ?
          AND lr.status = 'approved'
          AND lr.start_date >= ?
          AND lr.end_date <= ?
      `).bind(tenantId, startDate, endDate).all<Row>();
      return (results ?? []).map((row): PayrollInputLeaveFact => ({
        staffId: numberValue(row.staff_id),
        workingDays: numberValue(row.working_days),
        payPercent: numberValue(row.pay_percent, 100),
      }));
    },

    async listApprovedOvertimeFacts(tenantId, startDate, endDate) {
      const { results } = await db.prepare(`
        SELECT staff_id, overtime_hours, multiplier
        FROM hr_overtime_log
        WHERE CAST(tenant_id AS TEXT) = ?
          AND status = 'approved'
          AND date >= ?
          AND date <= ?
        ORDER BY staff_id, date, id
      `).bind(tenantId, startDate, endDate).all<Row>();
      return (results ?? []).map((row): PayrollInputOvertimeFact => ({
        staffId: numberValue(row.staff_id),
        approvedHours: numberValue(row.overtime_hours),
        multiplierSnapshot: numberValue(row.multiplier, 1.5),
      }));
    },
  };
}
