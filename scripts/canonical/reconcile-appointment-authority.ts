import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface AppointmentAuthorityReconciliationPreparedStatement {
  bind(...values: unknown[]): AppointmentAuthorityReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface AppointmentAuthorityReconciliationDatabase {
  prepare(sql: string): AppointmentAuthorityReconciliationPreparedStatement;
  batch(statements: AppointmentAuthorityReconciliationPreparedStatement[]): Promise<unknown[]>;
}

export interface ReconcileAppointmentAuthorityInput {
  tenantId: string;
  runPublicId: string;
  migrationRunPublicId?: string | null;
  nowUtc: string;
}

export interface AppointmentAuthorityReconciliationChecks {
  appointmentMappingMismatchCount: number;
  consultationMappingMismatchCount: number;
  patientLinkReferenceMismatchCount: number;
  practitionerReferenceMismatchCount: number;
  headerLatestEventMismatchCount: number;
  eventSequenceMismatchCount: number;
  invalidTransitionHistoryCount: number;
  rescheduleLineageMismatchCount: number;
  activeTokenDuplicateCount: number;
  appointmentActiveLinkCardinalityMismatchCount: number;
  encounterOriginCardinalityMismatchCount: number;
  appointmentEncounterPatientMismatchCount: number;
  forbiddenTerminalFulfilmentLinkCount: number;
  crossTenantReferenceMismatchCount: number;
  unresolvedAppointmentIssueCount: number;
}

export interface AppointmentAuthorityReconciliationResult {
  status: 'passed' | 'failed';
  scannedChecks: 15;
  matchedChecks: number;
  mismatchChecks: number;
  checks: AppointmentAuthorityReconciliationChecks;
  evidenceSha256: string;
}

interface CountRow { count: number }
interface MigrationRunRow { id: number }
interface EventRow {
  appointment_public_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string;
  sequence: number;
}

type AppointmentStatus =
  | 'requested'
  | 'scheduled'
  | 'confirmed'
  | 'arrived'
  | 'checked_in'
  | 'fulfilled'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled'
  | 'entered_in_error';

const TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  requested: ['scheduled', 'confirmed', 'cancelled', 'entered_in_error'],
  scheduled: ['confirmed', 'arrived', 'checked_in', 'cancelled', 'no_show', 'rescheduled', 'entered_in_error'],
  confirmed: ['arrived', 'checked_in', 'cancelled', 'no_show', 'rescheduled', 'entered_in_error'],
  arrived: ['checked_in', 'cancelled', 'no_show', 'entered_in_error'],
  checked_in: ['fulfilled', 'entered_in_error'],
  fulfilled: ['entered_in_error'],
  cancelled: [],
  no_show: [],
  rescheduled: [],
  entered_in_error: [],
};

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

async function count(
  db: AppointmentAuthorityReconciliationDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function allRows<T>(
  statement: AppointmentAuthorityReconciliationPreparedStatement,
): Promise<T[]> {
  return (await statement.all<T>()).results;
}

function invalidTransitionHistory(events: EventRow[]): number {
  const grouped = new Map<string, EventRow[]>();
  for (const event of events) {
    const list = grouped.get(event.appointment_public_id) ?? [];
    list.push(event);
    grouped.set(event.appointment_public_id, list);
  }
  let invalid = 0;
  for (const list of grouped.values()) {
    list.sort((a, b) => Number(a.sequence) - Number(b.sequence));
    const first = list[0];
    if (!first || Number(first.sequence) !== 1 || first.event_type !== 'created' || first.from_status !== null) {
      invalid += 1;
      continue;
    }
    let previous = first.to_status as AppointmentStatus;
    let expectedSequence = 2;
    let historyInvalid = false;
    for (const event of list.slice(1)) {
      const next = event.to_status as AppointmentStatus;
      if (
        Number(event.sequence) !== expectedSequence
        || event.from_status !== previous
        || !TRANSITIONS[previous]?.includes(next)
      ) {
        historyInvalid = true;
        break;
      }
      previous = next;
      expectedSequence += 1;
    }
    if (historyInvalid) invalid += 1;
  }
  return invalid;
}

export async function reconcileAppointmentAuthority(
  db: AppointmentAuthorityReconciliationDatabase,
  raw: ReconcileAppointmentAuthorityInput,
): Promise<AppointmentAuthorityReconciliationResult> {
  const input = {
    tenantId: exact(raw.tenantId, 'tenantId'),
    runPublicId: exact(raw.runPublicId, 'runPublicId'),
    migrationRunPublicId: raw.migrationRunPublicId == null
      ? null
      : exact(raw.migrationRunPublicId, 'migrationRunPublicId'),
    nowUtc: toUtcIso(raw.nowUtc),
  };

  const migrationRun = input.migrationRunPublicId == null
    ? null
    : await db.prepare(`
        SELECT id FROM canonical_migration_runs
        WHERE tenant_id=? AND run_public_id=? LIMIT 1
      `).bind(input.tenantId, input.migrationRunPublicId).first<MigrationRunRow>();
  if (input.migrationRunPublicId && !migrationRun) {
    throw new Error('Referenced appointment migration run was not found for the tenant');
  }

  const appointmentMappingMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM appointments a
    LEFT JOIN canonical_source_mappings m
      ON m.tenant_id=CAST(a.tenant_id AS TEXT)
     AND m.entity_type='appointment'
     AND m.source_type='legacy_appointment'
     AND m.source_public_id=CAST(a.id AS TEXT)
    WHERE CAST(a.tenant_id AS TEXT)=? AND m.id IS NULL
  `, [input.tenantId]);

  const consultationMappingMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM consultations c
    LEFT JOIN canonical_source_mappings m
      ON m.tenant_id=CAST(c.tenant_id AS TEXT)
     AND m.entity_type='appointment'
     AND m.source_type='legacy_consultation'
     AND m.source_public_id=CAST(c.id AS TEXT)
    WHERE CAST(c.tenant_id AS TEXT)=? AND m.id IS NULL
  `, [input.tenantId]);

  const patientLinkReferenceMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_appointments a
    LEFT JOIN canonical_tenant_patient_links p
      ON p.tenant_id=a.tenant_id AND p.patient_link_public_id=a.patient_link_public_id
    WHERE a.tenant_id=?
      AND (
        p.id IS NULL OR p.link_status IN ('rejected','retired') OR p.effective_to_utc IS NOT NULL
      )
  `, [input.tenantId]);

  const practitionerReferenceMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_appointments a
    LEFT JOIN canonical_practitioners p
      ON p.tenant_id=a.tenant_id
     AND p.practitioner_public_id=a.requested_practitioner_public_id
    WHERE a.tenant_id=? AND a.requested_practitioner_public_id IS NOT NULL
      AND (p.id IS NULL OR p.status!='active')
  `, [input.tenantId]);

  const headerLatestEventMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_appointments a
    LEFT JOIN canonical_appointment_status_events e
      ON e.tenant_id=a.tenant_id
     AND e.appointment_public_id=a.appointment_public_id
     AND e.sequence=(
       SELECT MAX(e2.sequence)
       FROM canonical_appointment_status_events e2
       WHERE e2.tenant_id=a.tenant_id
         AND e2.appointment_public_id=a.appointment_public_id
     )
    WHERE a.tenant_id=?
      AND (
        e.id IS NULL OR e.to_status!=a.current_status OR e.sequence!=a.status_version
      )
  `, [input.tenantId]);

  const eventSequenceMismatchCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT a.appointment_public_id
      FROM canonical_appointments a
      LEFT JOIN canonical_appointment_status_events e
        ON e.tenant_id=a.tenant_id AND e.appointment_public_id=a.appointment_public_id
      WHERE a.tenant_id=?
      GROUP BY a.appointment_public_id,a.status_version
      HAVING COUNT(e.id)=0
        OR MIN(e.sequence)!=1
        OR COUNT(e.id)!=MAX(e.sequence)
        OR MAX(e.sequence)!=a.status_version
    )
  `, [input.tenantId]);

  const events = await allRows<EventRow>(db.prepare(`
    SELECT appointment_public_id,event_type,from_status,to_status,sequence
    FROM canonical_appointment_status_events
    WHERE tenant_id=? ORDER BY appointment_public_id,sequence
  `).bind(input.tenantId));
  const invalidTransitionHistoryCount = invalidTransitionHistory(events);

  const rescheduleLineageMismatchCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT child.id
      FROM canonical_appointments child
      LEFT JOIN canonical_appointments parent
        ON parent.tenant_id=child.tenant_id
       AND parent.appointment_public_id=child.rescheduled_from_appointment_public_id
      WHERE child.tenant_id=?
        AND child.rescheduled_from_appointment_public_id IS NOT NULL
        AND (
          parent.id IS NULL
          OR parent.current_status!='rescheduled'
          OR parent.patient_link_public_id!=child.patient_link_public_id
        )
      UNION ALL
      SELECT parent.id
      FROM canonical_appointments parent
      WHERE parent.tenant_id=? AND parent.current_status='rescheduled'
        AND NOT EXISTS (
          SELECT 1 FROM canonical_appointments child
          WHERE child.tenant_id=parent.tenant_id
            AND child.rescheduled_from_appointment_public_id=parent.appointment_public_id
        )
    )
  `, [input.tenantId, input.tenantId]);

  const activeTokenDuplicateCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT requested_practitioner_public_id,business_date,token_number
      FROM canonical_appointments
      WHERE tenant_id=? AND requested_practitioner_public_id IS NOT NULL
        AND token_number IS NOT NULL AND token_assignment_type!='manual'
        AND current_status NOT IN ('cancelled','no_show','rescheduled','entered_in_error')
      GROUP BY requested_practitioner_public_id,business_date,token_number
      HAVING COUNT(*)>1
    )
  `, [input.tenantId]);

  const appointmentActiveLinkCardinalityMismatchCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT appointment_public_id
      FROM canonical_appointment_encounter_links
      WHERE tenant_id=? AND link_status='active'
      GROUP BY appointment_public_id HAVING COUNT(*)>1
      UNION ALL
      SELECT l.link_public_id
      FROM canonical_appointment_encounter_links l
      LEFT JOIN canonical_appointments a
        ON a.tenant_id=l.tenant_id AND a.appointment_public_id=l.appointment_public_id
      LEFT JOIN canonical_encounters e
        ON e.tenant_id=l.tenant_id AND e.encounter_public_id=l.encounter_public_id
      WHERE l.tenant_id=? AND l.link_status='active' AND (a.id IS NULL OR e.id IS NULL)
    )
  `, [input.tenantId, input.tenantId]);

  const encounterOriginCardinalityMismatchCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT encounter_public_id
      FROM canonical_appointment_encounter_links
      WHERE tenant_id=? AND link_status='active'
      GROUP BY encounter_public_id HAVING COUNT(*)>1
    )
  `, [input.tenantId]);

  const appointmentEncounterPatientMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_appointment_encounter_links l
    JOIN canonical_appointments a
      ON a.tenant_id=l.tenant_id AND a.appointment_public_id=l.appointment_public_id
    JOIN canonical_tenant_patient_links p
      ON p.tenant_id=a.tenant_id AND p.patient_link_public_id=a.patient_link_public_id
    JOIN canonical_encounters e
      ON e.tenant_id=l.tenant_id AND e.encounter_public_id=l.encounter_public_id
    WHERE l.tenant_id=? AND l.link_status='active'
      AND p.legacy_patient_id!=e.legacy_patient_id
  `, [input.tenantId]);

  const forbiddenTerminalFulfilmentLinkCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_appointment_encounter_links l
    JOIN canonical_appointments a
      ON a.tenant_id=l.tenant_id AND a.appointment_public_id=l.appointment_public_id
    WHERE l.tenant_id=? AND l.link_status='active' AND a.current_status!='fulfilled'
  `, [input.tenantId]);

  const crossTenantReferenceMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_source_mappings m
    LEFT JOIN canonical_appointments a
      ON a.tenant_id=m.tenant_id AND a.appointment_public_id=m.canonical_public_id
    WHERE m.tenant_id=? AND m.entity_type='appointment' AND m.mapping_status='mapped'
      AND (m.canonical_public_id IS NULL OR a.id IS NULL)
  `, [input.tenantId]);

  const unresolvedOpenAppointmentIssueCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_processing_issues i
    WHERE i.tenant_id=? AND i.entity_type='appointment'
      AND i.status IN ('open','acknowledged')
      AND NOT (
        i.issue_code='APPOINTMENT_FULFILMENT_ENCOUNTER_MISSING'
        AND EXISTS (
          SELECT 1
          FROM canonical_source_mappings m
          JOIN canonical_appointments a
            ON a.tenant_id=m.tenant_id AND a.appointment_public_id=m.canonical_public_id
          WHERE m.tenant_id=i.tenant_id
            AND m.entity_type='appointment'
            AND m.mapping_status='mapped'
            AND m.source_type=i.source_type
            AND m.source_public_id=i.source_public_id
            AND a.current_status='checked_in'
            AND NOT EXISTS (
              SELECT 1 FROM canonical_appointment_encounter_links l
              WHERE l.tenant_id=a.tenant_id
                AND l.appointment_public_id=a.appointment_public_id
                AND l.link_status='active'
            )
            AND (
              (i.source_type='legacy_appointment' AND EXISTS (
                SELECT 1 FROM appointments source
                WHERE CAST(source.tenant_id AS TEXT)=m.tenant_id
                  AND CAST(source.id AS TEXT)=m.source_public_id
                  AND lower(trim(source.status)) IN ('completed','concluded','fulfilled')
              ))
              OR
              (i.source_type='legacy_consultation' AND EXISTS (
                SELECT 1 FROM consultations source
                WHERE CAST(source.tenant_id AS TEXT)=m.tenant_id
                  AND CAST(source.id AS TEXT)=m.source_public_id
                  AND lower(trim(source.status)) IN ('completed','concluded','fulfilled')
              ))
            )
        )
      )
  `, [input.tenantId]);

  const missingFulfilmentDispositionCount = await count(db, `
    WITH completed_sources AS (
      SELECT m.tenant_id,m.source_type,m.source_public_id,m.canonical_public_id
      FROM canonical_source_mappings m
      JOIN appointments source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND CAST(source.id AS TEXT)=m.source_public_id
      WHERE m.tenant_id=? AND m.entity_type='appointment'
        AND m.source_type='legacy_appointment' AND m.mapping_status='mapped'
        AND lower(trim(source.status)) IN ('completed','concluded','fulfilled')
      UNION ALL
      SELECT m.tenant_id,m.source_type,m.source_public_id,m.canonical_public_id
      FROM canonical_source_mappings m
      JOIN consultations source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND CAST(source.id AS TEXT)=m.source_public_id
      WHERE m.tenant_id=? AND m.entity_type='appointment'
        AND m.source_type='legacy_consultation' AND m.mapping_status='mapped'
        AND lower(trim(source.status)) IN ('completed','concluded','fulfilled')
    )
    SELECT COUNT(*) AS count
    FROM completed_sources source
    JOIN canonical_appointments a
      ON a.tenant_id=source.tenant_id
     AND a.appointment_public_id=source.canonical_public_id
    WHERE NOT (
      (
        a.current_status='fulfilled'
        AND (
          SELECT COUNT(*) FROM canonical_appointment_encounter_links l
          WHERE l.tenant_id=a.tenant_id
            AND l.appointment_public_id=a.appointment_public_id
            AND l.link_status='active'
        )=1
      )
      OR
      (
        a.current_status='checked_in'
        AND NOT EXISTS (
          SELECT 1 FROM canonical_appointment_encounter_links l
          WHERE l.tenant_id=a.tenant_id
            AND l.appointment_public_id=a.appointment_public_id
            AND l.link_status='active'
        )
        AND EXISTS (
          SELECT 1 FROM canonical_processing_issues i
          WHERE i.tenant_id=source.tenant_id
            AND i.entity_type='appointment'
            AND i.issue_code='APPOINTMENT_FULFILMENT_ENCOUNTER_MISSING'
            AND i.source_type=source.source_type
            AND i.source_public_id=source.source_public_id
            AND i.status IN ('open','acknowledged','waived')
        )
      )
    )
  `, [input.tenantId, input.tenantId]);
  const unresolvedAppointmentIssueCount =
    unresolvedOpenAppointmentIssueCount + missingFulfilmentDispositionCount;

  const checks: AppointmentAuthorityReconciliationChecks = {
    appointmentMappingMismatchCount,
    consultationMappingMismatchCount,
    patientLinkReferenceMismatchCount,
    practitionerReferenceMismatchCount,
    headerLatestEventMismatchCount,
    eventSequenceMismatchCount,
    invalidTransitionHistoryCount,
    rescheduleLineageMismatchCount,
    activeTokenDuplicateCount,
    appointmentActiveLinkCardinalityMismatchCount,
    encounterOriginCardinalityMismatchCount,
    appointmentEncounterPatientMismatchCount,
    forbiddenTerminalFulfilmentLinkCount,
    crossTenantReferenceMismatchCount,
    unresolvedAppointmentIssueCount,
  };
  const mismatchChecks = Object.values(checks).filter((value) => value > 0).length;
  const status = mismatchChecks === 0 ? 'passed' : 'failed';
  const evidenceSha256 = await createSourceEvidenceSha256({
    tenantId: input.tenantId,
    reconciliationType: 'appointment_authority',
    checks,
  });
  const result: AppointmentAuthorityReconciliationResult = {
    status,
    scannedChecks: 15,
    matchedChecks: 15 - mismatchChecks,
    mismatchChecks,
    checks,
    evidenceSha256,
  };

  await db.batch([
    db.prepare(`
      INSERT INTO canonical_reconciliation_runs (
        tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
        scanned_count,matched_count,mismatch_count,exception_count,evidence_sha256,
        result_summary_json,started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      input.tenantId,
      input.runPublicId,
      migrationRun?.id ?? null,
      'scheduling',
      'backfill',
      status,
      result.scannedChecks,
      result.matchedChecks,
      result.mismatchChecks,
      result.mismatchChecks,
      evidenceSha256,
      stableCanonicalJson({ reconciliationType: 'appointment_authority', checks }),
      input.nowUtc,
      input.nowUtc,
      input.nowUtc,
      input.nowUtc,
    ),
  ]);

  return result;
}
