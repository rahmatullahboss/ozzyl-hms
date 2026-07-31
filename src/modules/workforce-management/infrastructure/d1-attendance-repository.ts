import type {
  AttendanceMutationRepository,
  PreparedAttendanceProjection,
  PreparedAttendanceProjectionEvent,
  PreparedAttendancePunch,
} from '../application/attendance-punch-service';
import type {
  AttendancePunchRecord,
  ExpectedRosterWorker,
} from '../application/attendance-query-service';
import type { LeaveRepository } from '../application/ports';
import type { AttendanceDay, AttendanceStatus } from '../domain/attendance';

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

function punchType(value: unknown): AttendancePunchRecord['punchType'] {
  return value === 'out' || value === 'break_start' || value === 'break_end' ? value : 'in';
}

function punchSource(value: unknown): AttendancePunchRecord['source'] {
  return value === 'biometric' || value === 'rfid' || value === 'web'
    || value === 'mobile' || value === 'device'
    ? value
    : 'manual';
}

function projectionStatus(value: unknown): AttendanceStatus {
  return value === 'absent' || value === 'late' || value === 'leave'
    || value === 'half_day' || value === 'off_day' || value === 'incomplete'
    ? value
    : 'present';
}

function compatibilityStatus(status: AttendanceStatus): 'present' | 'absent' | 'late' | 'leave' | 'half_day' {
  if (status === 'absent' || status === 'late' || status === 'leave' || status === 'half_day') {
    return status;
  }
  return 'present';
}

function mapPunch(row: DatabaseRow): AttendancePunchRecord {
  return {
    punchId: numberValue(row.id),
    tenantId: stringValue(row.tenant_id),
    staffId: numberValue(row.staff_id),
    occurredAtUtc: stringValue(row.punch_time),
    punchType: punchType(row.punch_type),
    source: punchSource(row.source),
    sourceEventKey: stringValue(row.source_event_key),
    businessDate: stringValue(row.business_date),
    requestHash: stringValue(row.request_hash),
    reason: stringOrNull(row.remarks),
  };
}

function mapDay(row: DatabaseRow): AttendanceDay {
  return {
    tenantId: stringValue(row.tenant_id),
    staffId: numberValue(row.staff_id),
    businessDate: stringValue(row.business_date ?? row.date),
    rosterId: numberOrNull(row.roster_id),
    shiftId: numberOrNull(row.shift_id),
    firstInTime: stringOrNull(row.first_in_at_utc),
    lastOutTime: stringOrNull(row.last_out_at_utc),
    workedMinutes: numberValue(row.worked_minutes),
    status: projectionStatus(row.projection_status ?? row.status),
    projectionVersion: numberValue(row.projection_version, 1),
  };
}

export function createD1AttendanceRepository(
  db: D1Database,
): AttendanceMutationRepository<D1PreparedStatement> {
  return {
    async findPunchBySourceEvent(tenantId, source, sourceEventKey) {
      const row = await db.prepare(`
        SELECT id, tenant_id, staff_id, punch_time, punch_type, source,
               source_event_key, business_date, request_hash, remarks
        FROM hr_attendance_punches
        WHERE CAST(tenant_id AS TEXT) = ?
          AND source = ?
          AND source_event_key = ?
        LIMIT 1
      `).bind(tenantId, source, sourceEventKey).first<DatabaseRow>();
      return row ? mapPunch(row) : null;
    },

    async listPunches(tenantId, staffId, businessDate) {
      const { results } = await db.prepare(`
        SELECT id, tenant_id, staff_id, punch_time, punch_type, source,
               source_event_key, business_date, request_hash, remarks
        FROM hr_attendance_punches
        WHERE CAST(tenant_id AS TEXT) = ?
          AND staff_id = ?
          AND business_date = ?
          AND is_valid = 1
        ORDER BY punch_time ASC, id ASC
      `).bind(tenantId, staffId, businessDate).all<DatabaseRow>();
      return (results ?? []).map(mapPunch);
    },

    async findDay(tenantId, staffId, businessDate) {
      const row = await db.prepare(`
        SELECT tenant_id, staff_id, date, business_date, roster_id, shift_id,
               first_in_at_utc, last_out_at_utc, worked_minutes,
               projection_status, status, projection_version
        FROM hr_attendance
        WHERE CAST(tenant_id AS TEXT) = ?
          AND staff_id = ?
          AND COALESCE(business_date, date) = ?
        LIMIT 1
      `).bind(tenantId, staffId, businessDate).first<DatabaseRow>();
      return row ? mapDay(row) : null;
    },

    async listExpectedRosterWorkers(tenantId, businessDate, department) {
      const conditions = [
        'CAST(r.tenant_id AS TEXT) = ?',
        'r.roster_date = ?',
        "r.status != 'cancelled'",
        "s.status = 'active'",
      ];
      const bindings: Array<string | number> = [tenantId, businessDate];
      if (department) {
        conditions.push('s.department = ?');
        bindings.push(department);
      }
      const { results } = await db.prepare(`
        SELECT r.staff_id, r.id AS roster_id, r.shift_id
        FROM hr_duty_roster r
        JOIN staff s
          ON s.id = r.staff_id
         AND CAST(s.tenant_id AS TEXT) = CAST(r.tenant_id AS TEXT)
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.staff_id
      `).bind(...bindings).all<DatabaseRow>();
      return (results ?? []).map((row): ExpectedRosterWorker => ({
        staffId: numberValue(row.staff_id),
        rosterId: numberValue(row.roster_id),
        shiftId: numberValue(row.shift_id),
      }));
    },

    prepareInsertPunch(input: PreparedAttendancePunch) {
      return db.prepare(`
        INSERT INTO hr_attendance_punches (
          tenant_id, staff_id, punch_time, punch_type, source,
          device_id, device_serial, raw_data, remarks, created_by,
          source_event_key, request_hash, business_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        input.tenantId,
        input.staffId,
        input.occurredAtUtc,
        input.punchType,
        input.source,
        input.deviceId,
        input.deviceSerial,
        input.rawData,
        input.reason,
        input.actorUserId,
        input.sourceEventKey,
        input.requestHash,
        input.businessDate,
      );
    },

    prepareUpsertProjection(input: PreparedAttendanceProjection) {
      const resultVersion = input.expectedVersion + 1;
      return db.prepare(`
        INSERT INTO hr_attendance (
          tenant_id, staff_id, date, business_date,
          check_in, check_out, shift_id, status, remarks,
          projection_status, worked_minutes,
          first_in_at_utc, last_out_at_utc,
          projection_version, roster_id, projection_updated_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, staff_id, date) DO UPDATE SET
          business_date = excluded.business_date,
          check_in = excluded.check_in,
          check_out = excluded.check_out,
          shift_id = excluded.shift_id,
          status = excluded.status,
          remarks = excluded.remarks,
          projection_status = excluded.projection_status,
          worked_minutes = excluded.worked_minutes,
          first_in_at_utc = excluded.first_in_at_utc,
          last_out_at_utc = excluded.last_out_at_utc,
          projection_version = excluded.projection_version,
          roster_id = excluded.roster_id,
          projection_updated_at_utc = excluded.projection_updated_at_utc
        WHERE hr_attendance.projection_version = ?
      `).bind(
        input.tenantId,
        input.staffId,
        input.businessDate,
        input.businessDate,
        input.firstInLocalTime,
        input.lastOutLocalTime,
        input.shiftId,
        compatibilityStatus(input.status),
        `Projection: ${input.status}`,
        input.status,
        input.workedMinutes,
        input.firstInTime,
        input.lastOutTime,
        resultVersion,
        input.rosterId,
        input.updatedAtUtc,
        input.expectedVersion,
      );
    },

    prepareInsertProjectionEvent(input: PreparedAttendanceProjectionEvent) {
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
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        input.punchType,
        input.occurredAtUtc,
        input.reason,
        input.actorUserId,
        input.createdAtUtc,
      );
    },
  };
}

export function createD1AttendanceLeaveRepository(db: D1Database): LeaveRepository {
  return {
    async findRequest(tenantId, leaveRequestId) {
      const row = await db.prepare(`
        SELECT id, tenant_id, staff_id, leave_category_id, start_date, end_date,
               total_days, reason, status
        FROM hr_leave_requests
        WHERE CAST(tenant_id AS TEXT) = ? AND id = ?
        LIMIT 1
      `).bind(tenantId, leaveRequestId).first<DatabaseRow>();
      if (!row) return null;
      const status = stringValue(row.status);
      return {
        leaveRequestId: numberValue(row.id),
        tenantId: stringValue(row.tenant_id),
        staffId: numberValue(row.staff_id),
        leaveCategoryId: numberValue(row.leave_category_id),
        startDate: stringValue(row.start_date),
        endDate: stringValue(row.end_date),
        workingDays: numberValue(row.total_days, 1),
        reason: stringOrNull(row.reason),
        status: status === 'approved' || status === 'rejected' || status === 'cancelled'
          ? status
          : 'pending',
      };
    },

    async findApprovedLeave(tenantId, staffId, date) {
      const row = await db.prepare(`
        SELECT id, staff_id, start_date, end_date, total_days
        FROM hr_leave_requests
        WHERE CAST(tenant_id AS TEXT) = ?
          AND staff_id = ?
          AND status = 'approved'
          AND start_date <= ?
          AND end_date >= ?
        ORDER BY start_date DESC, id DESC
        LIMIT 1
      `).bind(tenantId, staffId, date, date).first<DatabaseRow>();
      if (!row) return null;
      return {
        leaveRequestId: numberValue(row.id),
        staffId: numberValue(row.staff_id),
        startDate: stringValue(row.start_date),
        endDate: stringValue(row.end_date),
        workingDays: numberValue(row.total_days, 1),
        status: 'approved',
      };
    },
  };
}
