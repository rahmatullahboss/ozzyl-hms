import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { deriveBusinessDate, toUtcIso } from '../../src/lib/canonical/time';

export interface AppointmentBackfillPreparedStatement {
  bind(...values: unknown[]): AppointmentBackfillPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface AppointmentBackfillDatabase {
  prepare(sql: string): AppointmentBackfillPreparedStatement;
  batch(statements: AppointmentBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface AppointmentBackfillOptions {
  tenantId: string;
  runPublicId: string;
  timezone: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}

export interface AppointmentBackfillCounts {
  scanned: number;
  created: number;
  mapped: number;
  linked: number;
  skipped: number;
  issues: number;
}

export interface AppointmentBackfillResult {
  completed: boolean;
  counts: AppointmentBackfillCounts;
}

interface MigrationRunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface SourceMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}
interface PatientLinkRow {
  patient_link_public_id: string;
  legacy_patient_id: number;
}
interface PractitionerMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  practitioner_status: string | null;
}
interface EncounterMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  legacy_patient_id: number | null;
}
interface VisitRow { id: number }

interface LegacyAppointmentRow {
  id: number;
  patient_id: number;
  doctor_id: number | null;
  appt_date: string;
  appt_time: string | null;
  appointment_type: string | null;
  visit_type: string | null;
  source: string | null;
  \u0074oken_no: number | null;
  \u0074oken_assignment_type: string | null;
  status: string;
}

interface LegacyConsultationRow {
  id: number;
  patient_id: number;
  doctor_id: number;
  scheduled_at: string;
  duration_min: number;
  status: string;
}

type AppointmentKind =
  | 'new_patient'
  | 'follow_up'
  | 'report_review'
  | 'free_visit'
  | 'emergency_request'
  | 'telemedicine'
  | 'other';
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
type TokenAssignment = 'none' | 'auto' | 'reserved' | 'manual';

interface NormalizedSource {
  sourceType: 'legacy_appointment' | 'legacy_consultation';
  sourceTable: 'appointments' | 'consultations';
  sourceId: number;
  patientId: number;
  doctorId: number | null;
  appointmentKind: AppointmentKind;
  modality: 'in_person' | 'telemedicine';
  schedulingChannel: 'reception' | 'patient_portal' | 'marketplace' | 'doctor_follow_up' | 'import' | 'other';
  requestedStartUtc: string;
  requestedEndUtc: string;
  businessDate: string;
  timezone: string;
  \u0074okenNumber: number | null;
  \u0074okenAssignmentType: TokenAssignment;
  sourceStatus: string;
  evidenceSha256: string;
}

interface StartingCounts {
  appointments: number;
  mapped: number;
  links: number;
  issues: number;
}

interface Context {
  db: AppointmentBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  timezone: string;
  nowUtc: string;
  remaining: number;
  scanned: number;
  skipped: number;
}

interface RowOutcome {
  created: number;
  mapped: number;
  skipped: number;
  exceptions: number;
}

const SOURCE_APPOINTMENT = 'legacy_appointment';
const SOURCE_CONSULTATION = 'legacy_consultation';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function positiveLimit(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive integer');
  return value;
}

async function allRows<T>(statement: AppointmentBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function count(
  db: AppointmentBackfillDatabase,
  sql: string,
  values: readonly unknown[],
): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function captureCounts(db: AppointmentBackfillDatabase, tenantId: string): Promise<StartingCounts> {
  return {
    appointments: await count(db, `SELECT COUNT(*) AS count FROM canonical_appointments WHERE tenant_id=?`, [tenantId]),
    mapped: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type='appointment' AND mapping_status='mapped'
    `, [tenantId]),
    links: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_appointment_encounter_links WHERE tenant_id=?
    `, [tenantId]),
    issues: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_processing_issues
      WHERE tenant_id=? AND entity_type='appointment'
    `, [tenantId]),
  };
}

async function resultFromDelta(
  db: AppointmentBackfillDatabase,
  context: Context,
  starting: StartingCounts,
  completed: boolean,
): Promise<AppointmentBackfillResult> {
  const ending = await captureCounts(db, context.tenantId);
  return {
    completed,
    counts: {
      scanned: context.scanned,
      created: ending.appointments - starting.appointments,
      mapped: ending.mapped - starting.mapped,
      linked: ending.links - starting.links,
      skipped: context.skipped,
      issues: ending.issues - starting.issues,
    },
  };
}

function localDateTimeToUtc(date: string, time: string | null, timeZone: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(exact(date, 'appointment date'));
  if (!dateMatch) throw new RangeError('appointment date must use YYYY-MM-DD');
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time == null ? '00:00' : exact(time, 'appointment time'));
  if (!timeMatch) throw new RangeError('appointment time must use HH:MM or HH:MM:SS');
  const desired = {
    year: Number(dateMatch[1]), month: Number(dateMatch[2]), day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]), minute: Number(timeMatch[2]), second: Number(timeMatch[3] ?? '0'),
  };
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const desiredAsUtc = Date.UTC(
    desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, desired.second,
  );
  let candidate = desiredAsUtc;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const observedAsUtc = Date.UTC(
      value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'),
    );
    const correction = desiredAsUtc - observedAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }
  const result = new Date(candidate).toISOString();
  if (deriveBusinessDate(result, timeZone) !== date) {
    throw new RangeError('appointment local date/time could not be resolved in timezone');
  }
  return result;
}

function addMinutes(value: string, minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new RangeError('duration must be positive');
  return new Date(Date.parse(value) + minutes * 60_000).toISOString();
}

function mapKind(value: string | null): AppointmentKind {
  if (value === 'new_patient') return 'new_patient';
  if (value === 'old_patient' || value === 'follow_up') return 'follow_up';
  if (value === 'report_show' || value === 'report_review') return 'report_review';
  if (value === 'free_visit') return 'free_visit';
  if (value === 'emergency') return 'emergency_request';
  if (value === 'telemedicine') return 'telemedicine';
  return 'other';
}

function mapChannel(value: string | null): NormalizedSource['schedulingChannel'] {
  if (value === 'marketplace') return 'marketplace';
  if (value === 'patient_portal') return 'patient_portal';
  if (value === 'doctor_follow_up') return 'doctor_follow_up';
  if (value === 'import') return 'import';
  if (value == null || value === 'scheduled' || value === 'reception') return 'reception';
  return 'other';
}

function mapToken(value: string | null, number: number | null): TokenAssignment {
  if (number == null) return 'none';
  if (value === 'reserved') return 'reserved';
  if (value === 'manual') return 'manual';
  return 'auto';
}

function mapNonCompletedStatus(value: string): AppointmentStatus {
  if (value === 'requested') return 'requested';
  if (value === 'confirmed') return 'confirmed';
  if (value === 'arrived') return 'arrived';
  if (value === 'checked_in') return 'checked_in';
  if (value === 'cancelled') return 'cancelled';
  if (value === 'no_show') return 'no_show';
  if (value === 'rescheduled') return 'rescheduled';
  if (value === 'entered_in_error') return 'entered_in_error';
  return 'scheduled';
}

async function normalizeAppointment(row: LegacyAppointmentRow, timezone: string): Promise<NormalizedSource> {
  const start = localDateTimeToUtc(String(row.appt_date), row.appt_time, timezone);
  const kind = mapKind(row.appointment_type ?? row.visit_type);
  const tokenNumber = row.\u0074oken_no == null ? null : Number(row.\u0074oken_no);
  const sourceId = Number(row.id);
  return {
    sourceType: SOURCE_APPOINTMENT,
    sourceTable: 'appointments',
    sourceId,
    patientId: Number(row.patient_id),
    doctorId: row.doctor_id == null ? null : Number(row.doctor_id),
    appointmentKind: kind,
    modality: kind === 'telemedicine' ? 'telemedicine' : 'in_person',
    schedulingChannel: mapChannel(row.source),
    requestedStartUtc: start,
    requestedEndUtc: addMinutes(start, 30),
    businessDate: String(row.appt_date),
    timezone,
    \u0074okenNumber: tokenNumber,
    \u0074okenAssignmentType: mapToken(row.\u0074oken_assignment_type, tokenNumber),
    sourceStatus: String(row.status),
    evidenceSha256: await createSourceEvidenceSha256({
      sourceType: SOURCE_APPOINTMENT,
      sourcePublicId: String(sourceId),
      patientId: Number(row.patient_id),
      doctorId: row.doctor_id == null ? null : Number(row.doctor_id),
      appointmentKind: kind,
      requestedStartUtc: start,
      requestedEndUtc: addMinutes(start, 30),
      businessDate: String(row.appt_date),
      timezone,
      tokenNumber,
      tokenAssignmentType: mapToken(row.\u0074oken_assignment_type, tokenNumber),
      status: String(row.status),
      channel: mapChannel(row.source),
    }),
  };
}

function normalizeConsultationStart(value: string, timezone: string): string {
  const exactValue = exact(value, 'consultation scheduled_at');
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(exactValue)) return toUtcIso(exactValue);
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)$/.exec(exactValue);
  if (!local) {
    throw new RangeError(
      'consultation scheduled_at must be an explicit ISO timestamp or local YYYY-MM-DDTHH:MM[:SS]',
    );
  }
  return localDateTimeToUtc(local[1], local[2], timezone);
}

async function normalizeConsultation(row: LegacyConsultationRow, timezone: string): Promise<NormalizedSource> {
  const start = normalizeConsultationStart(String(row.scheduled_at), timezone);
  const duration = Number(row.duration_min);
  const sourceId = Number(row.id);
  return {
    sourceType: SOURCE_CONSULTATION,
    sourceTable: 'consultations',
    sourceId,
    patientId: Number(row.patient_id),
    doctorId: Number(row.doctor_id),
    appointmentKind: 'telemedicine',
    modality: 'telemedicine',
    schedulingChannel: 'marketplace',
    requestedStartUtc: start,
    requestedEndUtc: addMinutes(start, duration),
    businessDate: deriveBusinessDate(start, timezone),
    timezone,
    \u0074okenNumber: null,
    \u0074okenAssignmentType: 'none',
    sourceStatus: String(row.status),
    evidenceSha256: await createSourceEvidenceSha256({
      sourceType: SOURCE_CONSULTATION,
      sourcePublicId: String(sourceId),
      patientId: Number(row.patient_id),
      doctorId: Number(row.doctor_id),
      requestedStartUtc: start,
      requestedEndUtc: addMinutes(start, duration),
      businessDate: deriveBusinessDate(start, timezone),
      timezone,
      status: String(row.status),
    }),
  };
}

async function ensureRun(
  db: AppointmentBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<MigrationRunRow> {
  let run = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!run) {
    await db.prepare(`
      INSERT INTO canonical_migration_runs (
        tenant_id,run_public_id,migration_name,migration_kind,status,
        started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,'0546_canonical_appointment_authority.sql','backfill','running',?,?,?)
    `).bind(tenantId, runPublicId, nowUtc, nowUtc, nowUtc).run();
    run = await db.prepare(`
      SELECT id,status FROM canonical_migration_runs
      WHERE tenant_id=? AND run_public_id=? LIMIT 1
    `).bind(tenantId, runPublicId).first<MigrationRunRow>();
  }
  if (!run) throw new Error('Failed to create canonical appointment migration run');
  if (run.status === 'failed' || run.status === 'cancelled') {
    throw new Error(`Appointment backfill run is terminal: ${run.status}`);
  }
  return run;
}

async function ensureCheckpoint(
  context: Context,
  sourceType: string,
): Promise<CheckpointRow> {
  let checkpoint = await context.db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type='appointment'
      AND source_type=? AND partition_key='' LIMIT 1
  `).bind(context.tenantId, context.runId, sourceType).first<CheckpointRow>();
  if (!checkpoint) {
    const publicId = await createDeterministicSourceId(
      'chk', context.tenantId, 'appointment_backfill', `${context.runPublicId}:${sourceType}`,
    );
    await context.db.prepare(`
      INSERT INTO canonical_backfill_checkpoints (
        tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
        partition_key,status,started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'appointment',?,'','running',?,?,?)
    `).bind(
      context.tenantId, publicId, context.runId, sourceType,
      context.nowUtc, context.nowUtc, context.nowUtc,
    ).run();
    checkpoint = await context.db.prepare(`
      SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
      WHERE tenant_id=? AND migration_run_id=? AND entity_type='appointment'
        AND source_type=? AND partition_key='' LIMIT 1
    `).bind(context.tenantId, context.runId, sourceType).first<CheckpointRow>();
  } else if (checkpoint.status === 'paused') {
    await context.db.prepare(`
      UPDATE canonical_backfill_checkpoints
      SET status='running',completed_at_utc=NULL,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(context.nowUtc, context.tenantId, checkpoint.id).run();
    checkpoint.status = 'running';
  }
  if (!checkpoint) throw new Error(`Failed to create appointment checkpoint for ${sourceType}`);
  return checkpoint;
}

function progressStatement(
  context: Context,
  checkpointId: number,
  cursor: string,
  outcome: RowOutcome,
): AppointmentBackfillPreparedStatement {
  return context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET cursor_value=?,scanned_count=scanned_count+1,
        created_count=created_count+?,mapped_count=mapped_count+?,
        skipped_count=skipped_count+?,exception_count=exception_count+?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    cursor,outcome.created,outcome.mapped,outcome.skipped,outcome.exceptions,
    context.nowUtc,context.tenantId,checkpointId,
  );
}

async function issueStatement(
  context: Context,
  source: NormalizedSource,
  code: string,
  summary: string,
): Promise<AppointmentBackfillPreparedStatement> {
  const key = `${source.sourceType}:${source.sourceId}:${code}`;
  const fingerprint = await createDeterministicSourceId('fp', context.tenantId, code, key);
  const issuePublicId = await createDeterministicSourceId('iss', context.tenantId, code, key);
  return context.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,
      entity_type,source_type,source_public_id,fingerprint,severity,status,
      occurrence_count,summary,details_json,first_seen_at_utc,last_seen_at_utc,
      created_at_utc,updated_at_utc
    ) VALUES (?, ?, ?, 'appointment_backfill', ?, 'appointment', ?, ?, ?,
              'error','open',1,?,NULL,?,?,?,?)
    ON CONFLICT (tenant_id,issue_type,fingerprint) DO UPDATE SET
      migration_run_id=excluded.migration_run_id,
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    context.tenantId,issuePublicId,context.runId,code,source.sourceType,String(source.sourceId),
    fingerprint,summary,context.nowUtc,context.nowUtc,context.nowUtc,context.nowUtc,
  );
}

function mappingStatement(
  context: Context,
  source: NormalizedSource,
  appointmentPublicId: string | null,
  status: 'mapped' | 'ambiguous',
): AppointmentBackfillPreparedStatement {
  return context.db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,'appointment',?,?,?,?,?,1,?,?,?,?)
  `).bind(
    context.tenantId,appointmentPublicId,source.sourceType,String(source.sourceId),source.sourceTable,
    status,context.runId,source.evidenceSha256,context.nowUtc,context.nowUtc,
  );
}

async function existingMapping(
  context: Context,
  source: NormalizedSource,
): Promise<SourceMappingRow | null> {
  return context.db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='appointment' AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(context.tenantId, source.sourceType, String(source.sourceId)).first<SourceMappingRow>();
}

async function patientLink(
  context: Context,
  source: NormalizedSource,
): Promise<PatientLinkRow | null> {
  const rows = await allRows<PatientLinkRow>(context.db.prepare(`
    SELECT patient_link_public_id,legacy_patient_id
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=?
      AND link_status NOT IN ('rejected','retired') AND effective_to_utc IS NULL
    ORDER BY version DESC,patient_link_public_id
  `).bind(context.tenantId, source.patientId));
  return rows.length === 1 ? rows[0] : null;
}

async function practitionerMapping(
  context: Context,
  source: NormalizedSource,
): Promise<string | null | undefined> {
  if (source.doctorId == null) return null;
  const row = await context.db.prepare(`
    SELECT m.canonical_public_id,m.mapping_status,p.status AS practitioner_status
    FROM canonical_source_mappings m
    LEFT JOIN canonical_practitioners p
      ON p.tenant_id=m.tenant_id AND p.practitioner_public_id=m.canonical_public_id
    WHERE m.tenant_id=? AND m.entity_type='practitioner'
      AND m.source_type='legacy_doctor' AND m.source_public_id=? LIMIT 1
  `).bind(context.tenantId, String(source.doctorId)).first<PractitionerMappingRow>();
  if (!row || row.mapping_status !== 'mapped' || !row.canonical_public_id || row.practitioner_status !== 'active') {
    return undefined;
  }
  return String(row.canonical_public_id);
}

async function exactEncounter(
  context: Context,
  source: NormalizedSource,
  patientId: number,
): Promise<string | null> {
  let mapping: EncounterMappingRow | null = null;
  if (source.sourceType === SOURCE_CONSULTATION) {
    mapping = await context.db.prepare(`
      SELECT m.canonical_public_id,m.mapping_status,e.legacy_patient_id
      FROM canonical_source_mappings m
      LEFT JOIN canonical_encounters e
        ON e.tenant_id=m.tenant_id AND e.encounter_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='encounter'
        AND m.source_type='legacy_consultation' AND m.source_public_id=? LIMIT 1
    `).bind(context.tenantId, String(source.sourceId)).first<EncounterMappingRow>();
  } else {
    const visits = await allRows<VisitRow>(context.db.prepare(`
      SELECT id FROM visits WHERE tenant_id=? AND appointment_id=? ORDER BY id
    `).bind(context.tenantId, source.sourceId));
    if (visits.length !== 1) return null;
    mapping = await context.db.prepare(`
      SELECT m.canonical_public_id,m.mapping_status,e.legacy_patient_id
      FROM canonical_source_mappings m
      LEFT JOIN canonical_encounters e
        ON e.tenant_id=m.tenant_id AND e.encounter_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='encounter'
        AND m.source_type='legacy_visit' AND m.source_public_id=? LIMIT 1
    `).bind(context.tenantId, String(visits[0].id)).first<EncounterMappingRow>();
  }
  if (
    !mapping
    || mapping.mapping_status !== 'mapped'
    || !mapping.canonical_public_id
    || Number(mapping.legacy_patient_id) !== patientId
  ) return null;
  return String(mapping.canonical_public_id);
}

async function activeTokenConflict(
  context: Context,
  source: NormalizedSource,
  practitionerPublicId: string | null,
): Promise<boolean> {
  if (
    source.\u0074okenNumber == null
    || source.\u0074okenAssignmentType === 'manual'
    || practitionerPublicId == null
  ) return false;
  const row = await context.db.prepare(`
    SELECT 1 AS found FROM canonical_appointments
    WHERE tenant_id=? AND requested_practitioner_public_id=? AND business_date=?
      AND token_number=? AND token_assignment_type!='manual'
      AND current_status NOT IN ('cancelled','no_show','rescheduled','entered_in_error')
    LIMIT 1
  `).bind(
    context.tenantId,practitionerPublicId,source.businessDate,source.\u0074okenNumber,
  ).first<{ found: number }>();
  return row != null;
}

async function processSource(
  context: Context,
  checkpoint: CheckpointRow,
  source: NormalizedSource,
): Promise<void> {
  const sourcePublicId = String(source.sourceId);
  const existing = await existingMapping(context, source);
  if (existing) {
    const statements: AppointmentBackfillPreparedStatement[] = [];
    let exceptions = 0;
    if (existing.evidence_sha256 !== source.evidenceSha256) {
      statements.push(await issueStatement(
        context,source,'APPOINTMENT_SOURCE_EVIDENCE_CHANGED',
        'Mapped appointment source evidence changed and requires explicit review.',
      ));
      exceptions = 1;
    }
    statements.push(progressStatement(context, checkpoint.id, sourcePublicId, {
      created: 0,mapped: 0,skipped: 1,exceptions,
    }));
    await context.db.batch(statements);
    context.scanned += 1;
    context.skipped += 1;
    context.remaining -= 1;
    return;
  }

  const patient = await patientLink(context, source);
  if (!patient) {
    await context.db.batch([
      mappingStatement(context, source, null, 'ambiguous'),
      await issueStatement(
        context,source,'APPOINTMENT_PATIENT_LINK_MISSING',
        'Appointment source lacks one exact active tenant patient link.',
      ),
      progressStatement(context, checkpoint.id, sourcePublicId, {
        created: 0,mapped: 0,skipped: 0,exceptions: 1,
      }),
    ]);
    context.scanned += 1;
    context.remaining -= 1;
    return;
  }

  const practitioner = await practitionerMapping(context, source);
  if (practitioner === undefined) {
    await context.db.batch([
      mappingStatement(context, source, null, 'ambiguous'),
      await issueStatement(
        context,source,'APPOINTMENT_PRACTITIONER_MAPPING_MISSING',
        'Appointment source lacks one exact active practitioner mapping.',
      ),
      progressStatement(context, checkpoint.id, sourcePublicId, {
        created: 0,mapped: 0,skipped: 0,exceptions: 1,
      }),
    ]);
    context.scanned += 1;
    context.remaining -= 1;
    return;
  }

  if (await activeTokenConflict(context, source, practitioner)) {
    await context.db.batch([
      mappingStatement(context, source, null, 'ambiguous'),
      await issueStatement(
        context,source,'APPOINTMENT_ACTIVE_TOKEN_CONFLICT',
        'Appointment source conflicts with an active canonical queue token.',
      ),
      progressStatement(context, checkpoint.id, sourcePublicId, {
        created: 0,mapped: 0,skipped: 0,exceptions: 1,
      }),
    ]);
    context.scanned += 1;
    context.remaining -= 1;
    return;
  }

  const completed = ['completed','concluded','fulfilled'].includes(source.sourceStatus);
  const encounterPublicId = completed
    ? await exactEncounter(context, source, Number(patient.legacy_patient_id))
    : null;
  const currentStatus: AppointmentStatus = completed
    ? (encounterPublicId ? 'fulfilled' : 'checked_in')
    : mapNonCompletedStatus(source.sourceStatus);
  const appointmentPublicId = await createDeterministicSourceId(
    'appt', context.tenantId, source.sourceType, sourcePublicId,
  );
  const statusEventPublicId = await createDeterministicSourceId(
    'apptstevt', context.tenantId, source.sourceType, sourcePublicId,
  );
  const statements: AppointmentBackfillPreparedStatement[] = [
    context.db.prepare(`
      INSERT INTO canonical_appointments (
        tenant_id,appointment_public_id,patient_link_public_id,
        requested_practitioner_public_id,appointment_kind,modality,scheduling_channel,
        requested_start_utc,requested_end_utc,business_date,timezone,token_number,
        token_assignment_type,current_status,status_version,source_evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)
    `).bind(
      context.tenantId,appointmentPublicId,patient.patient_link_public_id,practitioner,
      source.appointmentKind,source.modality,source.schedulingChannel,
      source.requestedStartUtc,source.requestedEndUtc,source.businessDate,source.timezone,
      source.\u0074okenNumber,source.\u0074okenAssignmentType,currentStatus,
      source.evidenceSha256,context.nowUtc,context.nowUtc,
    ),
    context.db.prepare(`
      INSERT INTO canonical_appointment_status_events (
        tenant_id,event_public_id,appointment_public_id,event_type,from_status,to_status,
        sequence,reason_code,actor_system_key,idempotency_key,source_evidence_sha256,
        occurred_at_utc,created_at_utc
      ) VALUES (?,?,?,'created',NULL,?,1,'legacy_backfill','canonical.appointment.backfill',?,?,?,?)
    `).bind(
      context.tenantId,statusEventPublicId,appointmentPublicId,currentStatus,
      `appointment-backfill:${source.sourceType}:${sourcePublicId}`,
      source.evidenceSha256,context.nowUtc,context.nowUtc,
    ),
    mappingStatement(context, source, appointmentPublicId, 'mapped'),
  ];

  let issueCount = 0;
  if (encounterPublicId) {
    const linkPublicId = await createDeterministicSourceId(
      'apptlink', context.tenantId, appointmentPublicId, encounterPublicId,
    );
    statements.push(context.db.prepare(`
      INSERT INTO canonical_appointment_encounter_links (
        tenant_id,link_public_id,appointment_public_id,encounter_public_id,
        link_type,link_status,source_evidence_sha256,created_at_utc
      ) VALUES (?,?,?,?,'fulfilled_by','active',?,?)
    `).bind(
      context.tenantId,linkPublicId,appointmentPublicId,encounterPublicId,
      source.evidenceSha256,context.nowUtc,
    ));
  } else if (completed) {
    statements.push(await issueStatement(
      context,source,'APPOINTMENT_FULFILMENT_ENCOUNTER_MISSING',
      'Completed appointment source lacks one exact canonical encounter mapping.',
    ));
    issueCount = 1;
  }
  statements.push(progressStatement(context, checkpoint.id, sourcePublicId, {
    created: 1,mapped: 1,skipped: 0,exceptions: issueCount,
  }));
  await context.db.batch(statements);
  context.scanned += 1;
  context.remaining -= 1;
}

async function completeCheckpoint(context: Context, checkpointId: number): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status='completed',completed_at_utc=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(context.nowUtc,context.nowUtc,context.tenantId,checkpointId).run();
}

async function pauseCheckpoint(context: Context, checkpointId: number): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status='paused',completed_at_utc=NULL,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(context.nowUtc,context.tenantId,checkpointId).run();
}

async function completeRun(
  context: Context,
  result: AppointmentBackfillResult,
): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_migration_runs
    SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    context.nowUtc,JSON.stringify(result.counts),context.nowUtc,context.tenantId,context.runId,
  ).run();
}

export async function backfillAppointments(
  db: AppointmentBackfillDatabase,
  options: AppointmentBackfillOptions,
): Promise<AppointmentBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const timezone = exact(options.timezone, 'timezone');
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
  const starting = await captureCounts(db, tenantId);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  const context: Context = {
    db,tenantId,runId: run.id,runPublicId,timezone,nowUtc,
    remaining: positiveLimit(options.maxSourceRecords),scanned: 0,skipped: 0,
  };
  if (run.status === 'succeeded') return resultFromDelta(db, context, starting, true);

  const appointmentRows = await allRows<LegacyAppointmentRow>(db.prepare(`
    SELECT id,patient_id,doctor_id,appt_date,appt_time,appointment_type,visit_type,
           source,token_no,token_assignment_type,status
    FROM appointments WHERE tenant_id=? ORDER BY id
  `).bind(tenantId));
  const consultationRows = await allRows<LegacyConsultationRow>(db.prepare(`
    SELECT id,patient_id,doctor_id,scheduled_at,duration_min,status
    FROM consultations WHERE tenant_id=? ORDER BY id
  `).bind(tenantId));

  const appointmentCheckpoint = await ensureCheckpoint(context, SOURCE_APPOINTMENT);
  if (appointmentCheckpoint.status !== 'completed') {
    const cursor = Number(appointmentCheckpoint.cursor_value ?? 0);
    for (const row of appointmentRows.filter((item) => item.id > cursor)) {
      if (context.remaining <= 0) {
        await pauseCheckpoint(context, appointmentCheckpoint.id);
        return resultFromDelta(db, context, starting, false);
      }
      await processSource(context, appointmentCheckpoint, await normalizeAppointment(row, timezone));
    }
    await completeCheckpoint(context, appointmentCheckpoint.id);
  }

  if (context.remaining <= 0 && consultationRows.length > 0) {
    return resultFromDelta(db, context, starting, false);
  }

  const consultationCheckpoint = await ensureCheckpoint(context, SOURCE_CONSULTATION);
  if (consultationCheckpoint.status !== 'completed') {
    const cursor = Number(consultationCheckpoint.cursor_value ?? 0);
    for (const row of consultationRows.filter((item) => item.id > cursor)) {
      if (context.remaining <= 0) {
        await pauseCheckpoint(context, consultationCheckpoint.id);
        return resultFromDelta(db, context, starting, false);
      }
      await processSource(context, consultationCheckpoint, await normalizeConsultation(row, timezone));
    }
    await completeCheckpoint(context, consultationCheckpoint.id);
  }

  const result = await resultFromDelta(db, context, starting, true);
  await completeRun(context, result);
  return result;
}
