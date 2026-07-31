import type {
  PreparedRosterEvent,
  PreparedRosterInsert,
  PreparedRosterUpdate,
  RosterListInput,
} from '../application/roster-service';
import type {
  RotationAssignmentRecord,
  RotationMutationRepository,
  RotationRosterRepository,
} from '../application/rotation-service';
import type { RosterAssignment, RotationPattern } from '../domain/roster';
import { mapRosterRow, mapRotationPattern } from '../transport/mappers';

type DatabaseRow = Record<string, unknown>;

const ROSTER_SELECT = `
  SELECT
    r.id,
    r.staff_id,
    s.name AS staff_name,
    s.position,
    s.department,
    r.shift_id,
    sh.shift_name,
    sh.short_code AS shift_short_code,
    sh.start_time AS shift_start,
    sh.end_time AS shift_end,
    sh.color AS shift_color,
    r.roster_date,
    r.status,
    r.swapped_with_staff_id,
    r.remarks,
    r.version
  FROM hr_duty_roster r
  JOIN staff s
    ON s.id = r.staff_id
   AND CAST(s.tenant_id AS TEXT) = CAST(r.tenant_id AS TEXT)
  JOIN hr_shifts sh
    ON sh.id = r.shift_id
   AND CAST(sh.tenant_id AS TEXT) = CAST(r.tenant_id AS TEXT)
`;

async function firstRoster(
  db: D1Database,
  sql: string,
  bindings: Array<string | number>,
): Promise<RosterAssignment | null> {
  const row = await db.prepare(sql).bind(...bindings).first<DatabaseRow>();
  return row ? mapRosterRow(row) as RosterAssignment : null;
}

export function createD1RosterRepository(
  db: D1Database,
): RotationRosterRepository<D1PreparedStatement> {
  return {
    findById(tenantId, rosterId) {
      return firstRoster(db, `
        ${ROSTER_SELECT}
        WHERE CAST(r.tenant_id AS TEXT) = ? AND r.id = ?
        LIMIT 1
      `, [tenantId, rosterId]);
    },

    findByStaffDate(tenantId, staffId, rosterDate) {
      return firstRoster(db, `
        ${ROSTER_SELECT}
        WHERE CAST(r.tenant_id AS TEXT) = ?
          AND r.staff_id = ?
          AND r.roster_date = ?
        LIMIT 1
      `, [tenantId, staffId, rosterDate]);
    },

    async list(input: RosterListInput): Promise<RosterAssignment[]> {
      const conditions = [
        'CAST(r.tenant_id AS TEXT) = ?',
        'r.roster_date >= ?',
        'r.roster_date <= ?',
      ];
      const bindings: Array<string | number> = [input.tenantId, input.from, input.to];

      if (input.staffId !== undefined) {
        conditions.push('r.staff_id = ?');
        bindings.push(input.staffId);
      }
      if (input.shiftId !== undefined) {
        conditions.push('r.shift_id = ?');
        bindings.push(input.shiftId);
      }
      if (input.department !== undefined) {
        conditions.push('s.department = ?');
        bindings.push(input.department);
      }

      const { results } = await db.prepare(`
        ${ROSTER_SELECT}
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.roster_date ASC, s.name ASC
      `).bind(...bindings).all<DatabaseRow>();

      return (results ?? []).map((row) => mapRosterRow(row) as RosterAssignment);
    },

    async listForStaffRange(tenantId, staffIds, from, to) {
      if (staffIds.length === 0) return [];
      const placeholders = staffIds.map(() => '?').join(', ');
      const { results } = await db.prepare(`
        ${ROSTER_SELECT}
        WHERE CAST(r.tenant_id AS TEXT) = ?
          AND r.staff_id IN (${placeholders})
          AND r.roster_date >= ?
          AND r.roster_date <= ?
        ORDER BY r.roster_date ASC, r.staff_id ASC
      `).bind(tenantId, ...staffIds, from, to).all<DatabaseRow>();

      return (results ?? []).map((row) => mapRosterRow(row) as RosterAssignment);
    },

    prepareInsertAssignment(input: PreparedRosterInsert): D1PreparedStatement {
      return db.prepare(`
        INSERT INTO hr_duty_roster (
          tenant_id, staff_id, shift_id, roster_date, status, remarks,
          created_by, updated_by, version
        ) VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, 1)
      `).bind(
        input.tenantId,
        input.staffId,
        input.shiftId,
        input.rosterDate,
        input.remarks,
        input.actorUserId,
        input.actorUserId,
      );
    },

    prepareUpdateAssignment(input: PreparedRosterUpdate): D1PreparedStatement {
      return db.prepare(`
        UPDATE hr_duty_roster
        SET shift_id = ?,
            status = ?,
            swapped_with_staff_id = ?,
            remarks = ?,
            version = version + 1,
            updated_by = ?,
            updated_at = datetime('now')
        WHERE CAST(tenant_id AS TEXT) = ?
          AND id = ?
          AND staff_id = ?
          AND roster_date = ?
          AND version = ?
      `).bind(
        input.shiftId,
        input.status,
        input.swappedWithStaffId,
        input.remarks,
        input.actorUserId,
        input.tenantId,
        input.rosterId,
        input.staffId,
        input.rosterDate,
        input.expectedVersion,
      );
    },

    prepareInsertEvent(input: PreparedRosterEvent): D1PreparedStatement {
      return db.prepare(`
        INSERT INTO hr_roster_events (
          tenant_id,
          event_public_id,
          roster_id,
          staff_id,
          roster_date,
          event_type,
          from_shift_id,
          to_shift_id,
          related_staff_id,
          reason,
          actor_user_id,
          idempotency_key,
          request_hash,
          occurred_at_utc
        ) VALUES (
          ?,
          ?,
          (
            SELECT id
            FROM hr_duty_roster
            WHERE CAST(tenant_id AS TEXT) = ?
              AND staff_id = ?
              AND roster_date = ?
              AND version = ?
            LIMIT 1
          ),
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).bind(
        input.tenantId,
        input.eventPublicId,
        input.tenantId,
        input.staffId,
        input.rosterDate,
        input.expectedResultVersion,
        input.staffId,
        input.rosterDate,
        input.eventType,
        input.fromShiftId,
        input.toShiftId,
        input.relatedStaffId,
        input.reason,
        input.actorUserId,
        input.idempotencyKey,
        input.requestHash,
        input.occurredAtUtc,
      );
    },
  };
}

function mapDomainRotationPattern(
  pattern: DatabaseRow,
  days: DatabaseRow[],
): RotationPattern {
  const mapped = mapRotationPattern(pattern, days);
  return {
    tenantId: String(pattern.tenant_id),
    patternId: mapped.patternId,
    patternName: mapped.patternName,
    cycleDays: mapped.cycleDays,
    isActive: mapped.isActive,
    days: mapped.days,
  };
}

async function loadPatternDays(
  db: D1Database,
  tenantId: string,
  patternId: number,
): Promise<DatabaseRow[]> {
  const { results } = await db.prepare(`
    SELECT d.day_number, d.shift_id, d.is_off, sh.shift_name
    FROM hr_rotation_pattern_days d
    LEFT JOIN hr_shifts sh
      ON sh.id = d.shift_id
     AND CAST(sh.tenant_id AS TEXT) = ?
    WHERE d.pattern_id = ?
    ORDER BY d.day_number
  `).bind(tenantId, patternId).all<DatabaseRow>();
  return results ?? [];
}

export function createD1RotationRepository(db: D1Database): RotationMutationRepository {
  return {
    async listPatterns(tenantId, activeOnly = false) {
      let sql = `
        SELECT id, tenant_id, pattern_name, cycle_days, is_active
        FROM hr_rotation_patterns
        WHERE CAST(tenant_id AS TEXT) = ?
      `;
      if (activeOnly) sql += ' AND is_active = 1';
      sql += ' ORDER BY pattern_name';

      const { results } = await db.prepare(sql).bind(tenantId).all<DatabaseRow>();
      return Promise.all((results ?? []).map(async (pattern) =>
        mapDomainRotationPattern(
          pattern,
          await loadPatternDays(db, tenantId, Number(pattern.id)),
        ),
      ));
    },

    async getPattern(tenantId, patternId) {
      const pattern = await db.prepare(`
        SELECT id, tenant_id, pattern_name, cycle_days, is_active
        FROM hr_rotation_patterns
        WHERE CAST(tenant_id AS TEXT) = ? AND id = ?
        LIMIT 1
      `).bind(tenantId, patternId).first<DatabaseRow>();
      if (!pattern) return null;
      return mapDomainRotationPattern(
        pattern,
        await loadPatternDays(db, tenantId, patternId),
      );
    },

    async createPattern(input) {
      const result = await db.prepare(`
        INSERT INTO hr_rotation_patterns (tenant_id, pattern_name, cycle_days, is_active)
        VALUES (?, ?, ?, 1)
      `).bind(input.tenantId, input.patternName, input.cycleDays).run();
      const patternId = Number(result.meta.last_row_id);

      if (input.workingDays.length > 0) {
        await db.batch(input.workingDays.map((day) => db.prepare(`
          INSERT INTO hr_rotation_pattern_days (pattern_id, day_number, shift_id, is_off)
          VALUES (?, ?, ?, 0)
        `).bind(patternId, day.dayNumber, day.shiftId)));
      }

      return patternId;
    },

    async assignPattern(input) {
      const result = await db.prepare(`
        INSERT INTO hr_staff_rotations (
          tenant_id, staff_id, pattern_id, start_date, end_date, cycle_offset, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
      `).bind(
        input.tenantId,
        input.staffId,
        input.patternId,
        input.startDate,
        input.endDate,
        input.cycleOffset,
      ).run();
      return Number(result.meta.last_row_id);
    },

    async listRotationAssignments(tenantId, from, to): Promise<RotationAssignmentRecord[]> {
      const { results } = await db.prepare(`
        SELECT
          sr.id AS assignment_id,
          sr.tenant_id,
          sr.staff_id,
          sr.pattern_id,
          sr.start_date,
          sr.end_date,
          sr.cycle_offset,
          sr.is_active AS assignment_active,
          rp.is_active AS pattern_active,
          rp.pattern_name,
          rp.cycle_days
        FROM hr_staff_rotations sr
        JOIN hr_rotation_patterns rp
          ON rp.id = sr.pattern_id
         AND CAST(rp.tenant_id AS TEXT) = CAST(sr.tenant_id AS TEXT)
        JOIN staff s
          ON s.id = sr.staff_id
         AND CAST(s.tenant_id AS TEXT) = CAST(sr.tenant_id AS TEXT)
         AND s.status = 'active'
        WHERE CAST(sr.tenant_id AS TEXT) = ?
          AND sr.is_active = 1
          AND CAST(rp.tenant_id AS TEXT) = ?
          AND rp.is_active = 1
          AND sr.start_date <= ?
          AND (sr.end_date IS NULL OR sr.end_date >= ?)
        ORDER BY sr.staff_id, sr.start_date, sr.id
      `).bind(tenantId, tenantId, to, from).all<DatabaseRow>();

      const daysByPattern = new Map<number, RotationPattern['days']>();
      return Promise.all((results ?? []).map(async (row) => {
        const patternId = Number(row.pattern_id);
        let days = daysByPattern.get(patternId);
        if (!days) {
          days = mapDomainRotationPattern(
            {
              id: patternId,
              tenant_id: row.tenant_id,
              pattern_name: row.pattern_name,
              cycle_days: row.cycle_days,
              is_active: row.pattern_active,
            },
            await loadPatternDays(db, tenantId, patternId),
          ).days;
          daysByPattern.set(patternId, days);
        }

        return {
          assignmentId: Number(row.assignment_id),
          tenantId: String(row.tenant_id),
          staffId: Number(row.staff_id),
          patternId,
          startDate: String(row.start_date),
          endDate: row.end_date === null || row.end_date === undefined ? null : String(row.end_date),
          cycleOffset: Number(row.cycle_offset ?? 0),
          isActive: Number(row.assignment_active) === 1,
          patternIsActive: Number(row.pattern_active) === 1,
          cycleDays: Number(row.cycle_days),
          days,
        };
      }));
    },
  };
}
