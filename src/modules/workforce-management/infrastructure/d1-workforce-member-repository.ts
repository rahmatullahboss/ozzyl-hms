import type {
  LegacyStaffCompatibilityDto,
  WorkforceDirectoryRepository,
} from '../application/workforce-directory';
import type { ShiftDefinition, WorkforceMemberRef } from '../domain/workforce-member';
import { withOptionalPractitionerEmployeeLink } from './practitioner-link-adapter';

type DatabaseRow = Record<string, unknown>;

const STAFF_MEMBER_COLUMNS = `
  s.id,
  s.tenant_id,
  s.name,
  s.position,
  s.department,
  s.status,
  s.user_id
`;

const STAFF_COMPATIBILITY_COLUMNS = `
  s.id,
  s.name,
  s.address,
  s.position,
  s.salary,
  s.bank_account,
  s.mobile,
  s.email,
  s.date_of_birth,
  s.gender,
  s.salutation,
  s.joining_date,
  s.department,
  s.status,
  s.tenant_id,
  s.created_at,
  s.updated_at,
  s.user_id,
  s.emergency_contact,
  s.blood_group,
  s.category,
  s.biometric_device_id,
  s.shift_type,
  inv.id AS pending_invitation_id,
  inv.expires_at AS pending_invitation_expires_at,
  inv.role AS pending_invitation_role,
  CASE
    WHEN inv.id IS NULL THEN NULL
    WHEN inv.accepted_at IS NOT NULL THEN 'accepted'
    WHEN inv.revoked_at IS NOT NULL THEN 'revoked'
    WHEN inv.expires_at <= datetime('now') THEN 'expired'
    ELSE 'pending'
  END AS pending_invitation_status
`;

const LATEST_INVITATION_JOIN = `
  LEFT JOIN (
    SELECT staff_id, id, expires_at, accepted_at, revoked_at, role
    FROM invitations
    WHERE CAST(tenant_id AS TEXT) = ?
      AND staff_id IS NOT NULL
      AND id = (
        SELECT MAX(i2.id)
        FROM invitations i2
        WHERE i2.tenant_id = invitations.tenant_id
          AND i2.staff_id = invitations.staff_id
      )
  ) inv ON inv.staff_id = s.id
`;

const PRACTITIONER_LINK_JOIN = `
  LEFT JOIN canonical_practitioner_employee_links pel
    ON pel.tenant_id = CAST(s.tenant_id AS TEXT)
   AND pel.legacy_staff_id = s.id
   AND pel.link_status = 'active'
`;

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

function activeStatus(value: unknown): 'active' | 'inactive' {
  return String(value).toLowerCase() === 'inactive' ? 'inactive' : 'active';
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value === '1' || value === 'true';
}

function mapWorkforceMember(row: DatabaseRow): WorkforceMemberRef {
  return {
    tenantId: stringValue(row.tenant_id),
    staffId: numberValue(row.id),
    displayName: stringValue(row.name),
    position: stringValue(row.position),
    department: stringOrNull(row.department),
    status: activeStatus(row.status),
    userId: numberOrNull(row.user_id),
    practitionerPublicId: stringOrNull(row.practitioner_public_id),
  };
}

function invitationStatus(value: unknown): LegacyStaffCompatibilityDto['pending_invitation_status'] {
  return value === 'accepted' || value === 'revoked' || value === 'expired' || value === 'pending'
    ? value
    : null;
}

function mapDirectoryEntry(row: DatabaseRow): LegacyStaffCompatibilityDto {
  const workforceMember = mapWorkforceMember(row);
  return {
    id: workforceMember.staffId,
    name: workforceMember.displayName,
    address: stringValue(row.address),
    position: workforceMember.position,
    salary: numberValue(row.salary),
    bank_account: stringValue(row.bank_account),
    mobile: stringValue(row.mobile),
    email: stringOrNull(row.email),
    date_of_birth: stringOrNull(row.date_of_birth),
    gender: stringOrNull(row.gender),
    salutation: stringOrNull(row.salutation),
    joining_date: stringOrNull(row.joining_date),
    department: workforceMember.department,
    status: workforceMember.status,
    tenant_id: row.tenant_id === null || row.tenant_id === undefined ? workforceMember.tenantId : row.tenant_id as number | string,
    created_at: stringOrNull(row.created_at),
    updated_at: stringOrNull(row.updated_at),
    user_id: workforceMember.userId,
    emergency_contact: stringOrNull(row.emergency_contact),
    blood_group: stringOrNull(row.blood_group),
    category: stringOrNull(row.category),
    biometric_device_id: stringOrNull(row.biometric_device_id),
    shift_type: stringOrNull(row.shift_type),
    pending_invitation_id: numberOrNull(row.pending_invitation_id),
    pending_invitation_expires_at: stringOrNull(row.pending_invitation_expires_at),
    pending_invitation_role: stringOrNull(row.pending_invitation_role),
    pending_invitation_status: invitationStatus(row.pending_invitation_status),
    practitioner_public_id: workforceMember.practitionerPublicId,
    workforce_member: workforceMember,
  };
}

function mapShift(row: DatabaseRow): ShiftDefinition {
  return {
    tenantId: stringValue(row.tenant_id),
    shiftId: numberValue(row.id),
    name: stringValue(row.shift_name),
    shortCode: stringOrNull(row.short_code),
    startTime: stringValue(row.start_time),
    endTime: stringValue(row.end_time),
    gracePeriodMinutes: numberValue(row.grace_period),
    breakDurationMinutes: numberValue(row.break_duration),
    isNightShift: booleanValue(row.is_night_shift),
    color: stringOrNull(row.color),
    isActive: booleanValue(row.is_active, true),
  };
}

async function firstRow(db: D1Database, sql: string, bindings: unknown[]): Promise<DatabaseRow | null> {
  return db.prepare(sql).bind(...bindings).first<DatabaseRow>();
}

async function allRows(db: D1Database, sql: string, bindings: unknown[]): Promise<DatabaseRow[]> {
  const { results } = await db.prepare(sql).bind(...bindings).all<DatabaseRow>();
  return results ?? [];
}

export function createD1WorkforceDirectoryRepository(db: D1Database): WorkforceDirectoryRepository {
  async function getMember(tenantId: string, staffId: number): Promise<WorkforceMemberRef | null> {
    const row = await withOptionalPractitionerEmployeeLink(
      () => firstRow(db, `
        SELECT ${STAFF_MEMBER_COLUMNS}, pel.practitioner_public_id
        FROM staff s
        ${PRACTITIONER_LINK_JOIN}
        WHERE CAST(s.tenant_id AS TEXT) = ? AND s.id = ?
        LIMIT 1
      `, [tenantId, staffId]),
      () => firstRow(db, `
        SELECT ${STAFF_MEMBER_COLUMNS}, NULL AS practitioner_public_id
        FROM staff s
        WHERE CAST(s.tenant_id AS TEXT) = ? AND s.id = ?
        LIMIT 1
      `, [tenantId, staffId]),
    );
    return row ? mapWorkforceMember(row) : null;
  }

  async function listActiveMembers(tenantId: string): Promise<WorkforceMemberRef[]> {
    const rows = await withOptionalPractitionerEmployeeLink(
      () => allRows(db, `
        SELECT ${STAFF_MEMBER_COLUMNS}, pel.practitioner_public_id
        FROM staff s
        ${PRACTITIONER_LINK_JOIN}
        WHERE CAST(s.tenant_id AS TEXT) = ? AND s.status = 'active'
        ORDER BY s.position, s.name
      `, [tenantId]),
      () => allRows(db, `
        SELECT ${STAFF_MEMBER_COLUMNS}, NULL AS practitioner_public_id
        FROM staff s
        WHERE CAST(s.tenant_id AS TEXT) = ? AND s.status = 'active'
        ORDER BY s.position, s.name
      `, [tenantId]),
    );
    return rows.map(mapWorkforceMember);
  }

  async function listActiveDirectoryEntries(tenantId: string): Promise<LegacyStaffCompatibilityDto[]> {
    const rows = await withOptionalPractitionerEmployeeLink(
      () => allRows(db, `
        SELECT ${STAFF_COMPATIBILITY_COLUMNS}, pel.practitioner_public_id
        FROM staff s
        ${LATEST_INVITATION_JOIN}
        ${PRACTITIONER_LINK_JOIN}
        WHERE CAST(s.tenant_id AS TEXT) = ? AND s.status = 'active'
        ORDER BY s.position, s.name
      `, [tenantId, tenantId]),
      () => allRows(db, `
        SELECT ${STAFF_COMPATIBILITY_COLUMNS}, NULL AS practitioner_public_id
        FROM staff s
        ${LATEST_INVITATION_JOIN}
        WHERE CAST(s.tenant_id AS TEXT) = ? AND s.status = 'active'
        ORDER BY s.position, s.name
      `, [tenantId, tenantId]),
    );
    return rows.map(mapDirectoryEntry);
  }

  async function getDirectoryEntry(tenantId: string, staffId: number): Promise<LegacyStaffCompatibilityDto | null> {
    const row = await withOptionalPractitionerEmployeeLink(
      () => firstRow(db, `
        SELECT ${STAFF_COMPATIBILITY_COLUMNS}, pel.practitioner_public_id
        FROM staff s
        ${LATEST_INVITATION_JOIN}
        ${PRACTITIONER_LINK_JOIN}
        WHERE CAST(s.tenant_id AS TEXT) = ? AND s.id = ?
        LIMIT 1
      `, [tenantId, tenantId, staffId]),
      () => firstRow(db, `
        SELECT ${STAFF_COMPATIBILITY_COLUMNS}, NULL AS practitioner_public_id
        FROM staff s
        ${LATEST_INVITATION_JOIN}
        WHERE CAST(s.tenant_id AS TEXT) = ? AND s.id = ?
        LIMIT 1
      `, [tenantId, tenantId, staffId]),
    );
    return row ? mapDirectoryEntry(row) : null;
  }

  async function getShift(tenantId: string, shiftId: number): Promise<ShiftDefinition | null> {
    const row = await firstRow(db, `
      SELECT id, tenant_id, shift_name, short_code, start_time, end_time,
             grace_period, break_duration, is_night_shift, color, is_active
      FROM hr_shifts
      WHERE CAST(tenant_id AS TEXT) = ? AND id = ?
      LIMIT 1
    `, [tenantId, shiftId]);
    return row ? mapShift(row) : null;
  }

  async function listActiveShifts(tenantId: string): Promise<ShiftDefinition[]> {
    const rows = await allRows(db, `
      SELECT id, tenant_id, shift_name, short_code, start_time, end_time,
             grace_period, break_duration, is_night_shift, color, is_active
      FROM hr_shifts
      WHERE CAST(tenant_id AS TEXT) = ? AND is_active = 1
      ORDER BY start_time, shift_name
    `, [tenantId]);
    return rows.map(mapShift);
  }

  return {
    getMember,
    async getActiveMember(tenantId, staffId) {
      const member = await getMember(tenantId, staffId);
      return member?.status === 'active' ? member : null;
    },
    listActiveMembers,
    getShift,
    listActiveShifts,
    listActiveDirectoryEntries,
    getDirectoryEntry,
  };
}
