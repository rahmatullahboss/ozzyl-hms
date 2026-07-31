import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface EncounterBackfillPreparedStatement {
  bind(...values: unknown[]): EncounterBackfillPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface EncounterBackfillDatabase {
  prepare(sql: string): EncounterBackfillPreparedStatement;
  batch(statements: EncounterBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface EncounterBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}

export interface EncounterBackfillCounts {
  scanned: number;
  encountersCreated: number;
  participantsCreated: number;
  admissionLinksCreated: number;
  bedStaysCreated: number;
  mappingsCreated: number;
  issuesCreated: number;
}

export interface EncounterBackfillResult {
  completed: boolean;
  counts: EncounterBackfillCounts;
}

interface RunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow { canonical_public_id: string | null; mapping_status: string; evidence_sha256: string | null }
interface PractitionerMappingRow { canonical_public_id: string }
interface AppointmentRow {
  id: number;
  patient_id: number;
  doctor_id: number | null;
  visit_type: string;
  status: string;
  appt_date: string | null;
  appt_time: string | null;
  checked_in_at: string | null;
  created_at: string | null;
}
interface VisitRow {
  id: number;
  patient_id: number;
  doctor_id: number | null;
  visit_type: string;
  admission_flag: number;
  admission_no: string | null;
  visit_date: string | null;
  status: string | null;
  appointment_id: number | null;
  created_at: string | null;
  updated_at: string | null;
}
interface ConsultationRow {
  id: number;
  patient_id: number;
  doctor_id: number;
  scheduled_at: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}
interface LegacyEncounterRow {
  id: number;
  patient_id: number;
  visit_id: number | null;
  appointment_id: number | null;
  encounter_type: string | null;
  status: string | null;
  start_time: string | null;
  end_time: string | null;
  provider_id: number | null;
  signed_snapshot: string | null;
  snapshot_hash: string | null;
  signed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}
interface AddendumRow {
  id: number;
  encounter_id: number;
  previous_snapshot_hash: string | null;
  addendum_hash: string | null;
  content: string | null;
  created_at: string | null;
}
interface AdmissionRow {
  id: number;
  admission_no: string;
  patient_id: number;
  doctor_id: number | null;
  admission_type: string | null;
  admission_date: string;
  discharge_date: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}
interface BedStayRow {
  id: number;
  patient_id: number;
  admission_id: number;
  bed_id: number;
  started_on: string;
  ended_on: string | null;
  created_at: string | null;
}
interface CandidateRow { id: number }
interface StartingCounts {
  encounters: number;
  participants: number;
  admissions: number;
  bedStays: number;
  mappings: number;
  issues: number;
}
interface Context {
  db: EncounterBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  nowUtc: string;
  remaining: number;
  scanned: number;
}

const SOURCE_LEGACY_ENCOUNTER = 'legacy_encounter';
const SOURCE_VISIT = 'legacy_visit';
const SOURCE_APPOINTMENT = 'legacy_appointment';
const SOURCE_ADDENDUM = 'legacy_encounter_addendum';
const SOURCE_CONSULTATION = 'legacy_consultation';
const SOURCE_ADMISSION = 'legacy_admission';
const SOURCE_BED_STAY = 'legacy_patient_bed_info';

function requireExactNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveLimit(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive integer');
  return value;
}

function legacyUtc(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return toUtcIso(`${raw}T00:00:00+06:00`);
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)) return toUtcIso(iso);
  return toUtcIso(`${iso}+06:00`);
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function normalizedHash(value: string | null | undefined, fallbackText?: string | null): Promise<string | null> {
  const trimmed = value?.trim();
  if (trimmed && /^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (fallbackText) return sha256Text(fallbackText);
  if (trimmed) return sha256Text(trimmed);
  return null;
}

async function allRows<T>(statement: EncounterBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function tableCount(db: EncounterBackfillDatabase, table: string, tenantId: string, tail = ''): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?${tail}`)
    .bind(tenantId).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function captureCounts(db: EncounterBackfillDatabase, tenantId: string): Promise<StartingCounts> {
  return {
    encounters: await tableCount(db, 'canonical_encounters', tenantId),
    participants: await tableCount(db, 'canonical_encounter_participants', tenantId),
    admissions: await tableCount(db, 'canonical_encounter_admission_links', tenantId),
    bedStays: await tableCount(db, 'canonical_bed_stays', tenantId),
    mappings: await tableCount(
      db,
      'canonical_source_mappings',
      tenantId,
      " AND entity_type IN ('encounter','encounter_addendum','bed_stay')",
    ),
    issues: await tableCount(db, 'canonical_processing_issues', tenantId, " AND issue_type = 'encounter_backfill'"),
  };
}

async function resultFromDelta(
  db: EncounterBackfillDatabase,
  tenantId: string,
  starting: StartingCounts,
  scanned: number,
  completed: boolean,
): Promise<EncounterBackfillResult> {
  const ending = await captureCounts(db, tenantId);
  return {
    completed,
    counts: {
      scanned,
      encountersCreated: ending.encounters - starting.encounters,
      participantsCreated: ending.participants - starting.participants,
      admissionLinksCreated: ending.admissions - starting.admissions,
      bedStaysCreated: ending.bedStays - starting.bedStays,
      mappingsCreated: ending.mappings - starting.mappings,
      issuesCreated: ending.issues - starting.issues,
    },
  };
}

async function ensureRun(
  db: EncounterBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<RunRow> {
  let run = await db.prepare(
    `SELECT id, status FROM canonical_migration_runs
     WHERE tenant_id = ? AND run_public_id = ? LIMIT 1`,
  ).bind(tenantId, runPublicId).first<RunRow>();
  if (!run) {
    await db.prepare(
      `INSERT INTO canonical_migration_runs (
         tenant_id, run_public_id, migration_name, migration_kind,
         status, started_at_utc, created_at_utc, updated_at_utc
       ) VALUES (?, ?, '0507_canonical_encounters.sql', 'backfill', 'running', ?, ?, ?)`,
    ).bind(tenantId, runPublicId, nowUtc, nowUtc, nowUtc).run();
    run = await db.prepare(
      `SELECT id, status FROM canonical_migration_runs
       WHERE tenant_id = ? AND run_public_id = ? LIMIT 1`,
    ).bind(tenantId, runPublicId).first<RunRow>();
  }
  if (!run) throw new Error('Failed to create canonical encounter migration run');
  if (run.status === 'failed' || run.status === 'cancelled') {
    throw new Error(`Encounter backfill run is terminal: ${run.status}`);
  }
  return run;
}

async function ensureCheckpoint(
  context: Context,
  sourceType: string,
): Promise<CheckpointRow> {
  let checkpoint = await context.db.prepare(
    `SELECT id, cursor_value, status FROM canonical_backfill_checkpoints
     WHERE tenant_id = ? AND migration_run_id = ?
       AND entity_type = 'encounter' AND source_type = ? AND partition_key = ''
     LIMIT 1`,
  ).bind(context.tenantId, context.runId, sourceType).first<CheckpointRow>();
  if (!checkpoint) {
    const publicId = await createDeterministicSourceId(
      'chk', context.tenantId, 'encounter_backfill', `${context.runPublicId}:${sourceType}`,
    );
    await context.db.prepare(
      `INSERT INTO canonical_backfill_checkpoints (
         tenant_id, checkpoint_public_id, migration_run_id, entity_type,
         source_type, partition_key, status, started_at_utc,
         created_at_utc, updated_at_utc
       ) VALUES (?, ?, ?, 'encounter', ?, '', 'running', ?, ?, ?)`,
    ).bind(
      context.tenantId,
      publicId,
      context.runId,
      sourceType,
      context.nowUtc,
      context.nowUtc,
      context.nowUtc,
    ).run();
    checkpoint = await context.db.prepare(
      `SELECT id, cursor_value, status FROM canonical_backfill_checkpoints
       WHERE tenant_id = ? AND migration_run_id = ?
         AND entity_type = 'encounter' AND source_type = ? AND partition_key = ''
       LIMIT 1`,
    ).bind(context.tenantId, context.runId, sourceType).first<CheckpointRow>();
  } else if (checkpoint.status === 'paused') {
    await context.db.prepare(
      `UPDATE canonical_backfill_checkpoints
       SET status = 'running', completed_at_utc = NULL, updated_at_utc = ?
       WHERE tenant_id = ? AND id = ?`,
    ).bind(context.nowUtc, context.tenantId, checkpoint.id).run();
    checkpoint.status = 'running';
  }
  if (!checkpoint) throw new Error(`Failed to create encounter checkpoint for ${sourceType}`);
  return checkpoint;
}

function progressStatement(
  context: Context,
  checkpointId: number,
  cursor: string,
  input: { created?: number; mapped?: number; skipped?: number; exceptions?: number },
): EncounterBackfillPreparedStatement {
  return context.db.prepare(
    `UPDATE canonical_backfill_checkpoints
     SET cursor_value = ?,
         scanned_count = scanned_count + 1,
         created_count = created_count + ?,
         mapped_count = mapped_count + ?,
         skipped_count = skipped_count + ?,
         exception_count = exception_count + ?,
         updated_at_utc = ?
     WHERE tenant_id = ? AND id = ?`,
  ).bind(
    cursor,
    input.created ?? 0,
    input.mapped ?? 0,
    input.skipped ?? 0,
    input.exceptions ?? 0,
    context.nowUtc,
    context.tenantId,
    checkpointId,
  );
}

async function mapping(
  db: EncounterBackfillDatabase,
  input: {
    tenantId: string;
    entityType: 'encounter' | 'encounter_addendum' | 'bed_stay';
    canonicalPublicId: string | null;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    status: 'mapped' | 'ambiguous' | 'rejected';
    runId: number;
    evidenceSha256: string;
    nowUtc: string;
  },
): Promise<EncounterBackfillPreparedStatement> {
  return db.prepare(
    `INSERT OR IGNORE INTO canonical_source_mappings (
       tenant_id, entity_type, canonical_public_id, source_type,
       source_public_id, source_table, mapping_status, mapping_version,
       migration_run_id, evidence_sha256, created_at_utc, updated_at_utc
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.status,
    input.runId,
    input.evidenceSha256,
    input.nowUtc,
    input.nowUtc,
  );
}

async function issue(
  context: Context,
  input: {
    code: string;
    sourceType: string;
    sourcePublicId: string | null;
    fingerprintKey: string;
    summary: string;
    details?: Record<string, number | string>;
  },
): Promise<EncounterBackfillPreparedStatement> {
  const fingerprint = await createDeterministicSourceId(
    'fp', context.tenantId, input.code, input.fingerprintKey,
  );
  const issuePublicId = await createDeterministicSourceId(
    'iss', context.tenantId, input.code, input.fingerprintKey,
  );
  return context.db.prepare(
    `INSERT INTO canonical_processing_issues (
       tenant_id, issue_public_id, migration_run_id, issue_type, issue_code,
       entity_type, source_type, source_public_id, fingerprint, severity,
       status, occurrence_count, summary, details_json,
       first_seen_at_utc, last_seen_at_utc, created_at_utc, updated_at_utc
     ) VALUES (?, ?, ?, 'encounter_backfill', ?, 'encounter', ?, ?, ?,
               'error', 'open', 1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, issue_type, fingerprint) DO UPDATE SET
       migration_run_id = excluded.migration_run_id,
       occurrence_count = canonical_processing_issues.occurrence_count + 1,
       last_seen_at_utc = excluded.last_seen_at_utc,
       details_json = excluded.details_json,
       updated_at_utc = excluded.updated_at_utc`,
  ).bind(
    context.tenantId,
    issuePublicId,
    context.runId,
    input.code,
    input.sourceType,
    input.sourcePublicId,
    fingerprint,
    input.summary,
    input.details ? JSON.stringify(input.details) : null,
    context.nowUtc,
    context.nowUtc,
    context.nowUtc,
    context.nowUtc,
  );
}

async function existingMapping(
  db: EncounterBackfillDatabase,
  tenantId: string,
  entityType: 'encounter' | 'encounter_addendum' | 'bed_stay',
  sourceType: string,
  sourcePublicId: string,
): Promise<MappingRow | null> {
  return db.prepare(
    `SELECT canonical_public_id, mapping_status, evidence_sha256
     FROM canonical_source_mappings
     WHERE tenant_id = ? AND entity_type = ?
       AND source_type = ? AND source_public_id = ? LIMIT 1`,
  ).bind(tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
}

async function practitionerMapping(
  db: EncounterBackfillDatabase,
  tenantId: string,
  doctorId: number | null,
): Promise<PractitionerMappingRow | null> {
  if (doctorId == null) return null;
  return db.prepare(
    `SELECT canonical_public_id FROM canonical_source_mappings
     WHERE tenant_id = ? AND entity_type = 'practitioner'
       AND source_type = 'legacy_doctor' AND source_public_id = ?
       AND mapping_status = 'mapped' LIMIT 1`,
  ).bind(tenantId, String(doctorId)).first<PractitionerMappingRow>();
}

function encounterType(value: string | null | undefined, inpatient = false): string {
  if (inpatient || value?.toLowerCase() === 'ipd' || value?.toLowerCase() === 'inpatient') return 'inpatient';
  if (value?.toLowerCase() === 'teleconsultation') return 'teleconsultation';
  if (value?.toLowerCase() === 'emergency') return 'emergency';
  return 'outpatient';
}

function encounterStatus(value: string | null | undefined): string {
  const status = value?.toLowerCase();
  if (status === 'completed' || status === 'concluded' || status === 'discharged') return 'completed';
  if (status === 'cancelled' || status === 'no_show') return 'cancelled';
  if (status === 'scheduled') return 'planned';
  if (status === 'checked_in' || status === 'engaged' || status === 'initiated' || status === 'in_progress' || status === 'admitted') {
    return 'in_progress';
  }
  return 'unknown';
}

function encounterInsert(
  context: Context,
  input: {
    publicId: string;
    patientId: number;
    type: string;
    status: string;
    startedAtUtc: string;
    endedAtUtc: string | null;
    signedSnapshotSha256: string | null;
    signedAtUtc: string | null;
    evidenceSha256: string;
  },
): EncounterBackfillPreparedStatement {
  return context.db.prepare(
    `INSERT OR IGNORE INTO canonical_encounters (
       tenant_id, encounter_public_id, legacy_patient_id, encounter_type,
       status, started_at_utc, ended_at_utc, signed_snapshot_sha256,
       signed_at_utc, source_evidence_sha256, created_at_utc, updated_at_utc
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    context.tenantId,
    input.publicId,
    input.patientId,
    input.type,
    input.status,
    input.startedAtUtc,
    input.endedAtUtc,
    input.signedSnapshotSha256,
    input.signedAtUtc,
    input.evidenceSha256,
    context.nowUtc,
    context.nowUtc,
  );
}

async function participantStatements(
  context: Context,
  input: {
    encounterPublicId: string;
    doctorId: number | null;
    role: 'treating' | 'consulting' | 'admitting';
    evidenceType: 'legacy_encounter_provider' | 'legacy_visit_doctor' | 'legacy_consultation_doctor' | 'legacy_admission_doctor';
    sourceType: string;
    sourcePublicId: string;
    activeFromUtc: string;
    activeToUtc: string | null;
  },
): Promise<{ statements: EncounterBackfillPreparedStatement[]; exceptions: number }> {
  if (input.doctorId == null) return { statements: [], exceptions: 0 };
  const practitioner = await practitionerMapping(context.db, context.tenantId, input.doctorId);
  if (!practitioner) {
    return {
      statements: [await issue(context, {
        code: 'ENCOUNTER_PRACTITIONER_MAPPING_MISSING',
        sourceType: input.sourceType,
        sourcePublicId: input.sourcePublicId,
        fingerprintKey: `${input.sourceType}:${input.sourcePublicId}:doctor:${input.doctorId}`,
        summary: 'Encounter source doctor has no mapped canonical practitioner.',
      })],
      exceptions: 1,
    };
  }
  return {
    statements: [context.db.prepare(
      `INSERT OR IGNORE INTO canonical_encounter_participants (
         tenant_id, encounter_public_id, practitioner_public_id,
         participant_role, evidence_type, active_from_utc, active_to_utc,
         created_at_utc, updated_at_utc
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      context.tenantId,
      input.encounterPublicId,
      practitioner.canonical_public_id,
      input.role,
      input.evidenceType,
      input.activeFromUtc,
      input.activeToUtc,
      context.nowUtc,
      context.nowUtc,
    )],
    exceptions: 0,
  };
}

async function processExistingMapping(
  context: Context,
  checkpoint: CheckpointRow,
  sourceType: string,
  sourcePublicId: string,
): Promise<void> {
  await context.db.batch([
    progressStatement(context, checkpoint.id, sourcePublicId, { skipped: 1 }),
  ]);
  context.scanned += 1;
  context.remaining -= 1;
}

async function processLegacyEncounter(
  context: Context,
  checkpoint: CheckpointRow,
  row: LegacyEncounterRow,
): Promise<void> {
  const sourcePublicId = String(row.id);
  if (await existingMapping(context.db, context.tenantId, 'encounter', SOURCE_LEGACY_ENCOUNTER, sourcePublicId)) {
    await processExistingMapping(context, checkpoint, SOURCE_LEGACY_ENCOUNTER, sourcePublicId);
    return;
  }
  const started = legacyUtc(row.start_time ?? row.created_at, context.nowUtc);
  const ended = row.end_time ? legacyUtc(row.end_time, context.nowUtc) : null;
  const signedAt = row.signed_at ? legacyUtc(row.signed_at, context.nowUtc) : null;
  const signedHash = await normalizedHash(row.snapshot_hash, row.signed_snapshot);
  const evidence = await createSourceEvidenceSha256({
    sourceType: SOURCE_LEGACY_ENCOUNTER,
    sourcePublicId,
    patientId: row.patient_id,
    visitId: row.visit_id,
    appointmentId: row.appointment_id,
    encounterType: row.encounter_type,
    status: row.status,
    startedAtUtc: started,
    endedAtUtc: ended,
    providerId: row.provider_id,
    signedSnapshotSha256: signedHash,
    signedAtUtc: signedAt,
  });
  const publicId = await createDeterministicSourceId('enc', context.tenantId, SOURCE_LEGACY_ENCOUNTER, sourcePublicId);
  const participant = await participantStatements(context, {
    encounterPublicId: publicId,
    doctorId: row.provider_id,
    role: 'treating',
    evidenceType: 'legacy_encounter_provider',
    sourceType: SOURCE_LEGACY_ENCOUNTER,
    sourcePublicId,
    activeFromUtc: started,
    activeToUtc: ended,
  });
  const statements: EncounterBackfillPreparedStatement[] = [
    encounterInsert(context, {
      publicId,
      patientId: row.patient_id,
      type: encounterType(row.encounter_type),
      status: encounterStatus(row.status),
      startedAtUtc: started,
      endedAtUtc: ended,
      signedSnapshotSha256: signedHash,
      signedAtUtc: signedAt,
      evidenceSha256: evidence,
    }),
    await mapping(context.db, {
      tenantId: context.tenantId,
      entityType: 'encounter',
      canonicalPublicId: publicId,
      sourceType: SOURCE_LEGACY_ENCOUNTER,
      sourcePublicId,
      sourceTable: 'encounters',
      status: 'mapped',
      runId: context.runId,
      evidenceSha256: evidence,
      nowUtc: context.nowUtc,
    }),
    ...participant.statements,
  ];
  if (row.visit_id != null) {
    statements.push(await mapping(context.db, {
      tenantId: context.tenantId,
      entityType: 'encounter',
      canonicalPublicId: publicId,
      sourceType: SOURCE_VISIT,
      sourcePublicId: String(row.visit_id),
      sourceTable: 'visits',
      status: 'mapped',
      runId: context.runId,
      evidenceSha256: evidence,
      nowUtc: context.nowUtc,
    }));
  }
  if (row.appointment_id != null) {
    statements.push(await mapping(context.db, {
      tenantId: context.tenantId,
      entityType: 'encounter',
      canonicalPublicId: publicId,
      sourceType: SOURCE_APPOINTMENT,
      sourcePublicId: String(row.appointment_id),
      sourceTable: 'appointments',
      status: 'mapped',
      runId: context.runId,
      evidenceSha256: evidence,
      nowUtc: context.nowUtc,
    }));
  }
  statements.push(progressStatement(context, checkpoint.id, sourcePublicId, {
    created: 1,
    mapped: 1 + (row.visit_id == null ? 0 : 1) + (row.appointment_id == null ? 0 : 1),
    exceptions: participant.exceptions,
  }));
  await context.db.batch(statements);
  context.scanned += 1;
  context.remaining -= 1;
}

async function processAddendum(context: Context, checkpoint: CheckpointRow, row: AddendumRow): Promise<void> {
  const sourcePublicId = String(row.id);
  if (await existingMapping(context.db, context.tenantId, 'encounter_addendum', SOURCE_ADDENDUM, sourcePublicId)) {
    await processExistingMapping(context, checkpoint, SOURCE_ADDENDUM, sourcePublicId);
    return;
  }
  const encounter = await existingMapping(
    context.db,
    context.tenantId,
    'encounter',
    SOURCE_LEGACY_ENCOUNTER,
    String(row.encounter_id),
  );
  const previousHash = await normalizedHash(row.previous_snapshot_hash);
  const addendumHash = await normalizedHash(row.addendum_hash, row.content);
  const evidence = await createSourceEvidenceSha256({
    sourceType: SOURCE_ADDENDUM,
    sourcePublicId,
    legacyEncounterId: row.encounter_id,
    previousSnapshotSha256: previousHash,
    addendumSha256: addendumHash,
    createdAt: row.created_at,
  });
  if (!encounter?.canonical_public_id || !addendumHash) {
    const issueCode = !encounter?.canonical_public_id
      ? 'ENCOUNTER_ADDENDUM_ENCOUNTER_UNRESOLVED'
      : 'ENCOUNTER_ADDENDUM_CONTENT_MISSING';
    await context.db.batch([
      await mapping(context.db, {
        tenantId: context.tenantId,
        entityType: 'encounter_addendum',
        canonicalPublicId: null,
        sourceType: SOURCE_ADDENDUM,
        sourcePublicId,
        sourceTable: 'encounter_addenda',
        status: 'ambiguous',
        runId: context.runId,
        evidenceSha256: evidence,
        nowUtc: context.nowUtc,
      }),
      await issue(context, {
        code: issueCode,
        sourceType: SOURCE_ADDENDUM,
        sourcePublicId,
        fingerprintKey: `addendum:${sourcePublicId}:${issueCode}`,
        summary: !encounter?.canonical_public_id
          ? 'Encounter addendum has no mapped canonical encounter.'
          : 'Encounter addendum has neither a valid hash nor hashable text.',
      }),
      progressStatement(context, checkpoint.id, sourcePublicId, { mapped: 1, exceptions: 1 }),
    ]);
    context.scanned += 1;
    context.remaining -= 1;
    return;
  }
  const publicId = await createDeterministicSourceId('add', context.tenantId, SOURCE_ADDENDUM, sourcePublicId);
  const createdAt = legacyUtc(row.created_at, context.nowUtc);
  await context.db.batch([
    context.db.prepare(
      `INSERT OR IGNORE INTO canonical_encounter_addenda (
         tenant_id, addendum_public_id, encounter_public_id, legacy_addendum_id,
         previous_snapshot_sha256, addendum_sha256, source_evidence_sha256,
         created_at_utc, updated_at_utc
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      context.tenantId,
      publicId,
      encounter.canonical_public_id,
      row.id,
      previousHash,
      addendumHash,
      evidence,
      createdAt,
      context.nowUtc,
    ),
    await mapping(context.db, {
      tenantId: context.tenantId,
      entityType: 'encounter_addendum',
      canonicalPublicId: publicId,
      sourceType: SOURCE_ADDENDUM,
      sourcePublicId,
      sourceTable: 'encounter_addenda',
      status: 'mapped',
      runId: context.runId,
      evidenceSha256: evidence,
      nowUtc: context.nowUtc,
    }),
    progressStatement(context, checkpoint.id, sourcePublicId, { created: 1, mapped: 1 }),
  ]);
  context.scanned += 1;
  context.remaining -= 1;
}

async function processVisit(context: Context, checkpoint: CheckpointRow, row: VisitRow): Promise<void> {
  const sourcePublicId = String(row.id);
  if (await existingMapping(context.db, context.tenantId, 'encounter', SOURCE_VISIT, sourcePublicId)) {
    await processExistingMapping(context, checkpoint, SOURCE_VISIT, sourcePublicId);
    return;
  }
  const started = legacyUtc(row.visit_date ?? row.created_at, context.nowUtc);
  const ended = row.status?.toLowerCase() === 'concluded'
    ? legacyUtc(row.updated_at ?? row.visit_date ?? row.created_at, started)
    : null;
  const evidence = await createSourceEvidenceSha256({
    sourceType: SOURCE_VISIT,
    sourcePublicId,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    visitType: row.visit_type,
    admissionFlag: row.admission_flag,
    admissionNo: row.admission_no,
    status: row.status,
    appointmentId: row.appointment_id,
    startedAtUtc: started,
  });
  const publicId = await createDeterministicSourceId('enc', context.tenantId, SOURCE_VISIT, sourcePublicId);
  const participant = await participantStatements(context, {
    encounterPublicId: publicId,
    doctorId: row.doctor_id,
    role: 'treating',
    evidenceType: 'legacy_visit_doctor',
    sourceType: SOURCE_VISIT,
    sourcePublicId,
    activeFromUtc: started,
    activeToUtc: ended,
  });
  const statements: EncounterBackfillPreparedStatement[] = [
    encounterInsert(context, {
      publicId,
      patientId: row.patient_id,
      type: encounterType(row.visit_type, row.admission_flag === 1),
      status: encounterStatus(row.status),
      startedAtUtc: started,
      endedAtUtc: ended,
      signedSnapshotSha256: null,
      signedAtUtc: null,
      evidenceSha256: evidence,
    }),
    await mapping(context.db, {
      tenantId: context.tenantId,
      entityType: 'encounter',
      canonicalPublicId: publicId,
      sourceType: SOURCE_VISIT,
      sourcePublicId,
      sourceTable: 'visits',
      status: 'mapped',
      runId: context.runId,
      evidenceSha256: evidence,
      nowUtc: context.nowUtc,
    }),
    ...participant.statements,
  ];
  let mapped = 1;
  let exceptions = participant.exceptions;
  if (row.appointment_id != null) {
    const appointment = await context.db.prepare(
      `SELECT id, patient_id, doctor_id, status FROM appointments
       WHERE id = ? AND CAST(tenant_id AS TEXT) = ? LIMIT 1`,
    ).bind(row.appointment_id, context.tenantId).first<{
      id: number; patient_id: number; doctor_id: number | null; status: string;
    }>();
    if (
      appointment
      && appointment.patient_id === row.patient_id
      && (appointment.doctor_id == null || row.doctor_id == null || appointment.doctor_id === row.doctor_id)
      && !['cancelled', 'no_show'].includes(appointment.status.toLowerCase())
    ) {
      statements.push(await mapping(context.db, {
        tenantId: context.tenantId,
        entityType: 'encounter',
        canonicalPublicId: publicId,
        sourceType: SOURCE_APPOINTMENT,
        sourcePublicId: String(row.appointment_id),
        sourceTable: 'appointments',
        status: 'mapped',
        runId: context.runId,
        evidenceSha256: evidence,
        nowUtc: context.nowUtc,
      }));
      mapped += 1;
    } else {
      statements.push(await issue(context, {
        code: 'ENCOUNTER_APPOINTMENT_VISIT_LINK_INVALID',
        sourceType: SOURCE_VISIT,
        sourcePublicId,
        fingerprintKey: `visit:${sourcePublicId}:appointment:${row.appointment_id}`,
        summary: 'Visit appointment link is missing, cross-tenant, cancelled, or clinically inconsistent.',
      }));
      exceptions += 1;
    }
  }
  statements.push(progressStatement(context, checkpoint.id, sourcePublicId, {
    created: 1,
    mapped,
    exceptions,
  }));
  await context.db.batch(statements);
  context.scanned += 1;
  context.remaining -= 1;
}

async function processAppointment(context: Context, checkpoint: CheckpointRow, row: AppointmentRow): Promise<void> {
  const sourcePublicId = String(row.id);
  if (await existingMapping(context.db, context.tenantId, 'encounter', SOURCE_APPOINTMENT, sourcePublicId)) {
    await processExistingMapping(context, checkpoint, SOURCE_APPOINTMENT, sourcePublicId);
    return;
  }
  const evidence = await createSourceEvidenceSha256({
    sourceType: SOURCE_APPOINTMENT,
    sourcePublicId,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    visitType: row.visit_type,
    status: row.status,
    appointmentDate: row.appt_date,
    checkedInAt: row.checked_in_at,
  });
  const status = row.status.toLowerCase();
  const statements: EncounterBackfillPreparedStatement[] = [await mapping(context.db, {
    tenantId: context.tenantId,
    entityType: 'encounter',
    canonicalPublicId: null,
    sourceType: SOURCE_APPOINTMENT,
    sourcePublicId,
    sourceTable: 'appointments',
    status: 'rejected',
    runId: context.runId,
    evidenceSha256: evidence,
    nowUtc: context.nowUtc,
  })];
  let exceptions = 0;
  if (status === 'checked_in' || status === 'completed') {
    statements.push(await issue(context, {
      code: 'ENCOUNTER_APPOINTMENT_WITHOUT_VISIT',
      sourceType: SOURCE_APPOINTMENT,
      sourcePublicId,
      fingerprintKey: `appointment:${sourcePublicId}:care-without-visit`,
      summary: 'Care-like appointment status has no deterministic visit or legacy encounter.',
    }));
    exceptions = 1;
  }
  statements.push(progressStatement(context, checkpoint.id, sourcePublicId, {
    mapped: 1,
    exceptions,
  }));
  await context.db.batch(statements);
  context.scanned += 1;
  context.remaining -= 1;
}

async function processConsultation(
  context: Context,
  checkpoint: CheckpointRow,
  row: ConsultationRow,
): Promise<void> {
  const sourcePublicId = String(row.id);
  if (await existingMapping(context.db, context.tenantId, 'encounter', SOURCE_CONSULTATION, sourcePublicId)) {
    await processExistingMapping(context, checkpoint, SOURCE_CONSULTATION, sourcePublicId);
    return;
  }
  const scheduledAt = legacyUtc(row.scheduled_at, context.nowUtc);
  const evidence = await createSourceEvidenceSha256({
    sourceType: SOURCE_CONSULTATION,
    sourcePublicId,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    status: row.status,
    scheduledAtUtc: scheduledAt,
  });
  const normalizedStatus = row.status.toLowerCase();
  if (normalizedStatus === 'scheduled' || normalizedStatus === 'cancelled') {
    await context.db.batch([
      await mapping(context.db, {
        tenantId: context.tenantId,
        entityType: 'encounter',
        canonicalPublicId: null,
        sourceType: SOURCE_CONSULTATION,
        sourcePublicId,
        sourceTable: 'consultations',
        status: 'rejected',
        runId: context.runId,
        evidenceSha256: evidence,
        nowUtc: context.nowUtc,
      }),
      progressStatement(context, checkpoint.id, sourcePublicId, { mapped: 1 }),
    ]);
    context.scanned += 1;
    context.remaining -= 1;
    return;
  }
  const candidates = await allRows<CandidateRow>(context.db.prepare(
    `SELECT id FROM visits
     WHERE CAST(tenant_id AS TEXT) = ? AND patient_id = ? AND doctor_id = ?
       AND ABS(strftime('%s', COALESCE(visit_date, created_at)) - strftime('%s', ?)) <= 7200
     ORDER BY id`,
  ).bind(context.tenantId, row.patient_id, row.doctor_id, row.scheduled_at));
  if (candidates.length > 1) {
    await context.db.batch([
      await mapping(context.db, {
        tenantId: context.tenantId,
        entityType: 'encounter',
        canonicalPublicId: null,
        sourceType: SOURCE_CONSULTATION,
        sourcePublicId,
        sourceTable: 'consultations',
        status: 'ambiguous',
        runId: context.runId,
        evidenceSha256: evidence,
        nowUtc: context.nowUtc,
      }),
      await issue(context, {
        code: 'ENCOUNTER_CONSULTATION_MULTIPLE_VISITS',
        sourceType: SOURCE_CONSULTATION,
        sourcePublicId,
        fingerprintKey: `consultation:${sourcePublicId}:multiple-visits`,
        summary: 'Consultation has multiple deterministic-window visit candidates.',
        details: { candidateCount: candidates.length },
      }),
      progressStatement(context, checkpoint.id, sourcePublicId, { mapped: 1, exceptions: 1 }),
    ]);
    context.scanned += 1;
    context.remaining -= 1;
    return;
  }
  if (candidates.length === 1) {
    const visitMapping = await existingMapping(
      context.db,
      context.tenantId,
      'encounter',
      SOURCE_VISIT,
      String(candidates[0].id),
    );
    if (visitMapping?.canonical_public_id) {
      await context.db.batch([
        await mapping(context.db, {
          tenantId: context.tenantId,
          entityType: 'encounter',
          canonicalPublicId: visitMapping.canonical_public_id,
          sourceType: SOURCE_CONSULTATION,
          sourcePublicId,
          sourceTable: 'consultations',
          status: 'mapped',
          runId: context.runId,
          evidenceSha256: evidence,
          nowUtc: context.nowUtc,
        }),
        progressStatement(context, checkpoint.id, sourcePublicId, { mapped: 1 }),
      ]);
      context.scanned += 1;
      context.remaining -= 1;
      return;
    }
  }
  const publicId = await createDeterministicSourceId('enc', context.tenantId, SOURCE_CONSULTATION, sourcePublicId);
  const participant = await participantStatements(context, {
    encounterPublicId: publicId,
    doctorId: row.doctor_id,
    role: 'consulting',
    evidenceType: 'legacy_consultation_doctor',
    sourceType: SOURCE_CONSULTATION,
    sourcePublicId,
    activeFromUtc: scheduledAt,
    activeToUtc: normalizedStatus === 'completed'
      ? legacyUtc(row.updated_at ?? row.scheduled_at, scheduledAt)
      : null,
  });
  await context.db.batch([
    encounterInsert(context, {
      publicId,
      patientId: row.patient_id,
      type: 'teleconsultation',
      status: encounterStatus(row.status),
      startedAtUtc: scheduledAt,
      endedAtUtc: normalizedStatus === 'completed'
        ? legacyUtc(row.updated_at ?? row.scheduled_at, scheduledAt)
        : null,
      signedSnapshotSha256: null,
      signedAtUtc: null,
      evidenceSha256: evidence,
    }),
    await mapping(context.db, {
      tenantId: context.tenantId,
      entityType: 'encounter',
      canonicalPublicId: publicId,
      sourceType: SOURCE_CONSULTATION,
      sourcePublicId,
      sourceTable: 'consultations',
      status: 'mapped',
      runId: context.runId,
      evidenceSha256: evidence,
      nowUtc: context.nowUtc,
    }),
    ...participant.statements,
    progressStatement(context, checkpoint.id, sourcePublicId, {
      created: 1,
      mapped: 1,
      exceptions: participant.exceptions,
    }),
  ]);
  context.scanned += 1;
  context.remaining -= 1;
}

async function processAdmission(context: Context, checkpoint: CheckpointRow, row: AdmissionRow): Promise<void> {
  const sourcePublicId = String(row.id);
  if (await existingMapping(context.db, context.tenantId, 'encounter', SOURCE_ADMISSION, sourcePublicId)) {
    await processExistingMapping(context, checkpoint, SOURCE_ADMISSION, sourcePublicId);
    return;
  }
  const started = legacyUtc(row.admission_date, context.nowUtc);
  const ended = row.discharge_date ? legacyUtc(row.discharge_date, context.nowUtc) : null;
  const evidence = await createSourceEvidenceSha256({
    sourceType: SOURCE_ADMISSION,
    sourcePublicId,
    admissionNo: row.admission_no,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    admissionType: row.admission_type,
    status: row.status,
    startedAtUtc: started,
    endedAtUtc: ended,
  });
  const exactVisits = await allRows<CandidateRow>(context.db.prepare(
    `SELECT id FROM visits
     WHERE CAST(tenant_id AS TEXT) = ? AND patient_id = ? AND admission_no = ?
     ORDER BY id`,
  ).bind(context.tenantId, row.patient_id, row.admission_no));
  let publicId: string;
  let create = false;
  let exceptions = 0;
  const statements: EncounterBackfillPreparedStatement[] = [];
  if (exactVisits.length === 1) {
    const visitMap = await existingMapping(
      context.db, context.tenantId, 'encounter', SOURCE_VISIT, String(exactVisits[0].id),
    );
    if (!visitMap?.canonical_public_id) throw new Error('Exact admission visit has no canonical encounter mapping');
    publicId = visitMap.canonical_public_id;
  } else if (exactVisits.length > 1) {
    statements.push(
      await mapping(context.db, {
        tenantId: context.tenantId,
        entityType: 'encounter',
        canonicalPublicId: null,
        sourceType: SOURCE_ADMISSION,
        sourcePublicId,
        sourceTable: 'admissions',
        status: 'ambiguous',
        runId: context.runId,
        evidenceSha256: evidence,
        nowUtc: context.nowUtc,
      }),
      await issue(context, {
        code: 'ENCOUNTER_ADMISSION_MULTIPLE_EXPLICIT_VISITS',
        sourceType: SOURCE_ADMISSION,
        sourcePublicId,
        fingerprintKey: `admission:${sourcePublicId}:multiple-explicit-visits`,
        summary: 'Admission number maps to multiple visit records.',
        details: { candidateCount: exactVisits.length },
      }),
      progressStatement(context, checkpoint.id, sourcePublicId, { mapped: 1, exceptions: 1 }),
    );
    await context.db.batch(statements);
    context.scanned += 1;
    context.remaining -= 1;
    return;
  } else {
    publicId = await createDeterministicSourceId('enc', context.tenantId, SOURCE_ADMISSION, sourcePublicId);
    create = true;
    const nearby = await allRows<CandidateRow>(context.db.prepare(
      `SELECT id FROM visits
       WHERE CAST(tenant_id AS TEXT) = ? AND patient_id = ?
         AND ABS(strftime('%s', COALESCE(visit_date, created_at)) - strftime('%s', ?)) <= 86400
       ORDER BY id`,
    ).bind(context.tenantId, row.patient_id, row.admission_date));
    if (nearby.length > 0) {
      statements.push(await issue(context, {
        code: 'ENCOUNTER_ADMISSION_NEARBY_VISIT_UNRESOLVED',
        sourceType: SOURCE_ADMISSION,
        sourcePublicId,
        fingerprintKey: `admission:${sourcePublicId}:nearby-visits`,
        summary: 'Admission has nearby visits but no explicit admission linkage; proximity is not used for merging.',
        details: { candidateCount: nearby.length },
      }));
      exceptions += 1;
    }
    statements.unshift(encounterInsert(context, {
      publicId,
      patientId: row.patient_id,
      type: row.admission_type?.toLowerCase() === 'emergency' ? 'emergency' : 'inpatient',
      status: encounterStatus(row.status),
      startedAtUtc: started,
      endedAtUtc: ended,
      signedSnapshotSha256: null,
      signedAtUtc: null,
      evidenceSha256: evidence,
    }));
  }
  const participant = await participantStatements(context, {
    encounterPublicId: publicId,
    doctorId: row.doctor_id,
    role: 'admitting',
    evidenceType: 'legacy_admission_doctor',
    sourceType: SOURCE_ADMISSION,
    sourcePublicId,
    activeFromUtc: started,
    activeToUtc: ended,
  });
  exceptions += participant.exceptions;
  statements.push(
    await mapping(context.db, {
      tenantId: context.tenantId,
      entityType: 'encounter',
      canonicalPublicId: publicId,
      sourceType: SOURCE_ADMISSION,
      sourcePublicId,
      sourceTable: 'admissions',
      status: 'mapped',
      runId: context.runId,
      evidenceSha256: evidence,
      nowUtc: context.nowUtc,
    }),
    context.db.prepare(
      `INSERT OR IGNORE INTO canonical_encounter_admission_links (
         tenant_id, encounter_public_id, legacy_admission_id, admission_no,
         link_status, source_evidence_sha256, created_at_utc, updated_at_utc
       ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(
      context.tenantId,
      publicId,
      row.id,
      row.admission_no,
      evidence,
      context.nowUtc,
      context.nowUtc,
    ),
    ...participant.statements,
    progressStatement(context, checkpoint.id, sourcePublicId, {
      created: create ? 1 : 0,
      mapped: 1,
      exceptions,
    }),
  );
  await context.db.batch(statements);
  context.scanned += 1;
  context.remaining -= 1;
}

async function processBedStay(context: Context, checkpoint: CheckpointRow, row: BedStayRow): Promise<void> {
  const sourcePublicId = String(row.id);
  if (await existingMapping(context.db, context.tenantId, 'bed_stay', SOURCE_BED_STAY, sourcePublicId)) {
    await processExistingMapping(context, checkpoint, SOURCE_BED_STAY, sourcePublicId);
    return;
  }
  const admission = await existingMapping(
    context.db, context.tenantId, 'encounter', SOURCE_ADMISSION, String(row.admission_id),
  );
  const evidence = await createSourceEvidenceSha256({
    sourceType: SOURCE_BED_STAY,
    sourcePublicId,
    patientId: row.patient_id,
    admissionId: row.admission_id,
    bedId: row.bed_id,
    startedOn: row.started_on,
    endedOn: row.ended_on,
  });
  if (!admission?.canonical_public_id) {
    await context.db.batch([
      await mapping(context.db, {
        tenantId: context.tenantId,
        entityType: 'bed_stay',
        canonicalPublicId: null,
        sourceType: SOURCE_BED_STAY,
        sourcePublicId,
        sourceTable: 'patient_bed_infos',
        status: 'ambiguous',
        runId: context.runId,
        evidenceSha256: evidence,
        nowUtc: context.nowUtc,
      }),
      await issue(context, {
        code: 'ENCOUNTER_BED_STAY_ADMISSION_UNRESOLVED',
        sourceType: SOURCE_BED_STAY,
        sourcePublicId,
        fingerprintKey: `bed-stay:${sourcePublicId}:admission:${row.admission_id}`,
        summary: 'Bed-stay source has no mapped admission encounter.',
      }),
      progressStatement(context, checkpoint.id, sourcePublicId, { mapped: 1, exceptions: 1 }),
    ]);
    context.scanned += 1;
    context.remaining -= 1;
    return;
  }
  const admissionPatient = await context.db.prepare(
    `SELECT legacy_patient_id FROM canonical_encounters
     WHERE tenant_id = ? AND encounter_public_id = ? LIMIT 1`,
  ).bind(context.tenantId, admission.canonical_public_id).first<{ legacy_patient_id: number }>();
  const started = legacyUtc(row.started_on, context.nowUtc);
  const ended = row.ended_on ? legacyUtc(row.ended_on, context.nowUtc) : null;
  const invalid = !admissionPatient
    || admissionPatient.legacy_patient_id !== row.patient_id
    || (ended != null && ended < started);
  if (invalid) {
    await context.db.batch([
      await mapping(context.db, {
        tenantId: context.tenantId,
        entityType: 'bed_stay',
        canonicalPublicId: null,
        sourceType: SOURCE_BED_STAY,
        sourcePublicId,
        sourceTable: 'patient_bed_infos',
        status: 'ambiguous',
        runId: context.runId,
        evidenceSha256: evidence,
        nowUtc: context.nowUtc,
      }),
      await issue(context, {
        code: 'ENCOUNTER_BED_STAY_INVALID',
        sourceType: SOURCE_BED_STAY,
        sourcePublicId,
        fingerprintKey: `bed-stay:${sourcePublicId}:invalid`,
        summary: 'Bed stay has invalid interval or patient/admission mismatch.',
      }),
      progressStatement(context, checkpoint.id, sourcePublicId, { mapped: 1, exceptions: 1 }),
    ]);
    context.scanned += 1;
    context.remaining -= 1;
    return;
  }
  const publicId = await createDeterministicSourceId('bed', context.tenantId, SOURCE_BED_STAY, sourcePublicId);
  const statements: EncounterBackfillPreparedStatement[] = [
    context.db.prepare(
      `INSERT OR IGNORE INTO canonical_bed_stays (
         tenant_id, bed_stay_public_id, encounter_public_id,
         legacy_patient_bed_info_id, legacy_admission_id, legacy_bed_id,
         started_at_utc, ended_at_utc, status, source_evidence_sha256,
         created_at_utc, updated_at_utc
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      context.tenantId,
      publicId,
      admission.canonical_public_id,
      row.id,
      row.admission_id,
      row.bed_id,
      started,
      ended,
      ended == null ? 'active' : 'completed',
      evidence,
      context.nowUtc,
      context.nowUtc,
    ),
    await mapping(context.db, {
      tenantId: context.tenantId,
      entityType: 'bed_stay',
      canonicalPublicId: publicId,
      sourceType: SOURCE_BED_STAY,
      sourcePublicId,
      sourceTable: 'patient_bed_infos',
      status: 'mapped',
      runId: context.runId,
      evidenceSha256: evidence,
      nowUtc: context.nowUtc,
    }),
  ];
  statements.push(progressStatement(context, checkpoint.id, sourcePublicId, {
    created: 1,
    mapped: 1,
  }));
  await context.db.batch(statements);
  context.scanned += 1;
  context.remaining -= 1;
}

async function completeCheckpoint(context: Context, checkpoint: CheckpointRow): Promise<void> {
  await context.db.prepare(
    `UPDATE canonical_backfill_checkpoints
     SET status = 'completed', completed_at_utc = ?, updated_at_utc = ?
     WHERE tenant_id = ? AND id = ?`,
  ).bind(context.nowUtc, context.nowUtc, context.tenantId, checkpoint.id).run();
}

async function pauseCheckpoint(context: Context, checkpoint: CheckpointRow): Promise<void> {
  await context.db.prepare(
    `UPDATE canonical_backfill_checkpoints
     SET status = 'paused', completed_at_utc = NULL, updated_at_utc = ?
     WHERE tenant_id = ? AND id = ?`,
  ).bind(context.nowUtc, context.tenantId, checkpoint.id).run();
}

async function runPhase<T extends { id: number }>(
  context: Context,
  sourceType: string,
  rows: T[],
  processor: (context: Context, checkpoint: CheckpointRow, row: T) => Promise<void>,
): Promise<boolean> {
  const checkpoint = await ensureCheckpoint(context, sourceType);
  if (checkpoint.status === 'completed') return true;
  const cursor = Number(checkpoint.cursor_value ?? 0);
  for (const row of rows.filter((candidate) => candidate.id > cursor)) {
    if (context.remaining <= 0) {
      await pauseCheckpoint(context, checkpoint);
      return false;
    }
    await processor(context, checkpoint, row);
  }
  await completeCheckpoint(context, checkpoint);
  return true;
}

async function completeRun(
  context: Context,
  result: EncounterBackfillResult,
): Promise<void> {
  await context.db.prepare(
    `UPDATE canonical_migration_runs
     SET status = 'succeeded', completed_at_utc = ?, result_summary_json = ?, updated_at_utc = ?
     WHERE tenant_id = ? AND id = ?`,
  ).bind(
    context.nowUtc,
    JSON.stringify(result.counts),
    context.nowUtc,
    context.tenantId,
    context.runId,
  ).run();
}

export async function backfillEncounters(
  db: EncounterBackfillDatabase,
  options: EncounterBackfillOptions,
): Promise<EncounterBackfillResult> {
  const tenantId = requireExactNonEmpty(options.tenantId, 'tenantId');
  const runPublicId = requireExactNonEmpty(options.runPublicId, 'runPublicId');
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
  const starting = await captureCounts(db, tenantId);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  if (run.status === 'succeeded') return resultFromDelta(db, tenantId, starting, 0, true);
  const context: Context = {
    db,
    tenantId,
    runId: run.id,
    runPublicId,
    nowUtc,
    remaining: positiveLimit(options.maxSourceRecords),
    scanned: 0,
  };

  const legacyEncounters = await allRows<LegacyEncounterRow>(db.prepare(
    `SELECT id, patient_id, visit_id, appointment_id, encounter_type, status,
            start_time, end_time, provider_id, signed_snapshot, snapshot_hash,
            signed_at, created_at, updated_at
     FROM encounters WHERE CAST(tenant_id AS TEXT) = ? ORDER BY id`,
  ).bind(tenantId));
  if (!await runPhase(context, SOURCE_LEGACY_ENCOUNTER, legacyEncounters, processLegacyEncounter)) {
    return resultFromDelta(db, tenantId, starting, context.scanned, false);
  }

  const addenda = await allRows<AddendumRow>(db.prepare(
    `SELECT id, encounter_id, previous_snapshot_hash, addendum_hash,
            content, created_at
     FROM encounter_addenda WHERE CAST(tenant_id AS TEXT) = ? ORDER BY id`,
  ).bind(tenantId));
  if (!await runPhase(context, SOURCE_ADDENDUM, addenda, processAddendum)) {
    return resultFromDelta(db, tenantId, starting, context.scanned, false);
  }

  const visits = await allRows<VisitRow>(db.prepare(
    `SELECT id, patient_id, doctor_id, visit_type, admission_flag, admission_no,
            visit_date, status, appointment_id, created_at, updated_at
     FROM visits WHERE CAST(tenant_id AS TEXT) = ? ORDER BY id`,
  ).bind(tenantId));
  if (!await runPhase(context, SOURCE_VISIT, visits, processVisit)) {
    return resultFromDelta(db, tenantId, starting, context.scanned, false);
  }

  const appointments = await allRows<AppointmentRow>(db.prepare(
    `SELECT id, patient_id, doctor_id, visit_type, status, appt_date, appt_time,
            checked_in_at, created_at
     FROM appointments WHERE CAST(tenant_id AS TEXT) = ? ORDER BY id`,
  ).bind(tenantId));
  if (!await runPhase(context, SOURCE_APPOINTMENT, appointments, processAppointment)) {
    return resultFromDelta(db, tenantId, starting, context.scanned, false);
  }

  const consultations = await allRows<ConsultationRow>(db.prepare(
    `SELECT id, patient_id, doctor_id, scheduled_at, status, created_at, updated_at
     FROM consultations WHERE CAST(tenant_id AS TEXT) = ? ORDER BY id`,
  ).bind(tenantId));
  if (!await runPhase(context, SOURCE_CONSULTATION, consultations, processConsultation)) {
    return resultFromDelta(db, tenantId, starting, context.scanned, false);
  }

  const admissions = await allRows<AdmissionRow>(db.prepare(
    `SELECT id, admission_no, patient_id, doctor_id, admission_type,
            admission_date, discharge_date, status, created_at, updated_at
     FROM admissions WHERE CAST(tenant_id AS TEXT) = ? ORDER BY id`,
  ).bind(tenantId));
  if (!await runPhase(context, SOURCE_ADMISSION, admissions, processAdmission)) {
    return resultFromDelta(db, tenantId, starting, context.scanned, false);
  }

  const bedStays = await allRows<BedStayRow>(db.prepare(
    `SELECT id, patient_id, admission_id, bed_id, started_on, ended_on, created_at
     FROM patient_bed_infos WHERE CAST(tenant_id AS TEXT) = ? ORDER BY id`,
  ).bind(tenantId));
  if (!await runPhase(context, SOURCE_BED_STAY, bedStays, processBedStay)) {
    return resultFromDelta(db, tenantId, starting, context.scanned, false);
  }

  const result = await resultFromDelta(db, tenantId, starting, context.scanned, true);
  await completeRun(context, result);
  return result;
}
