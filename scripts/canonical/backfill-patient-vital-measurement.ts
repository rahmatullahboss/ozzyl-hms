import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  recordCanonicalVitalObservationSet,
  type CanonicalVitalComponentInput,
  type CanonicalVitalSourceKind,
} from '../../src/lib/canonical/commands/manage-vital-observations';
import { createRequestFingerprint, stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface PatientVitalMeasurementBackfillPreparedStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): PatientVitalMeasurementBackfillPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PatientVitalMeasurementBackfillDatabase extends CanonicalBatchDatabase {
  prepare(sql: string): PatientVitalMeasurementBackfillPreparedStatement;
  batch(statements: PatientVitalMeasurementBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface PatientVitalMeasurementBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc: string;
  maxSourceRecords?: number;
}

export interface PatientVitalMeasurementBackfillCounts {
  scanned: number;
  observationSetsCreated: number;
  componentsCreated: number;
  statusEventsCreated: number;
  mappingsCreated: number;
  skipped: number;
  issues: number;
}

export interface PatientVitalMeasurementBackfillResult {
  completed: boolean;
  counts: PatientVitalMeasurementBackfillCounts;
}

interface MigrationRunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface PractitionerRow { practitioner_public_id: string; status: string }

interface StartingCounts {
  sets: number;
  components: number;
  events: number;
  mappings: number;
  issues: number;
}

interface Context {
  db: PatientVitalMeasurementBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  nowUtc: string;
  remaining: number;
  scanned: number;
  skipped: number;
}

interface Partition {
  sourceType: string;
  partitionKey: string;
  process(context: Context, checkpoint: CheckpointRow): Promise<boolean>;
}

interface ProcessOutcome {
  created?: boolean;
  mapped?: boolean;
  skipped?: boolean;
  issue?: boolean;
}

interface PatientVitalsRow {
  id: number;
  patient_id: number;
  admission_id: number | null;
  systolic: number | null;
  diastolic: number | null;
  temperature: number | null;
  heart_rate: number | null;
  spo2: number | null;
  respiratory_rate: number | null;
  weight: number | null;
  recorded_by: string | null;
  recorded_at: string | null;
}

interface ClinicalVitalsRow {
  id: number;
  patient_id: number;
  visit_id: number | null;
  temperature: number | null;
  pulse: number | null;
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
  respiratory_rate: number | null;
  spo2: number | null;
  weight: number | null;
  height: number | null;
  bmi: number | null;
  pain_scale: number | null;
  blood_sugar: number | null;
  taken_by: number | null;
  taken_at: string | null;
}

interface GlobalVitalRow {
  id: number;
  uhid?: string | null;
  logged_on?: string | null;
  patient_id?: number | null;
  logged_at?: string | null;
  systolic?: number | null;
  diastolic?: number | null;
  heart_rate?: number | null;
  blood_sugar?: number | null;
  blood_sugar_context?: string | null;
  weight_kg?: number | null;
  temperature_f?: number | null;
  spo2?: number | null;
  created_at?: string | null;
}

interface NursingMonitoringRow {
  id: number;
  patient_id: number;
  visit_id: number;
  temperature: number | null;
  temperature_unit: string | null;
  pulse: number | null;
  respiration: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  spo2: number | null;
  pain_scale: number | null;
  recorded_on: string | null;
  created_by: number | null;
}

interface VitalAlertRow { id: number; vital_id: number }
interface WearableRow { id: number; patient_id: number; sample_type: string }
interface BmiRow { id: number; weight: number | null; height: number | null; bmi: number | null }
interface DuplicateCandidateRow { id: number }

const MIGRATION_NAME = 'CDB-123D patient vital measurement backfill';
const ENTITY_TYPE = 'patient_vital_measurement';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function sourceLimit(value: number | undefined): number {
  if (value === undefined) return 1_000_000;
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive safe integer');
  return value;
}

function normalizedUtc(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  if (raw.endsWith('Z')) return toUtcIso(raw);
  return toUtcIso(`${raw.includes('T') ? raw : raw.replace(' ', 'T')}+06:00`);
}

function businessDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

async function rows<T>(statement: PatientVitalMeasurementBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function count(db: PatientVitalMeasurementBackfillDatabase, sql: string, values: readonly unknown[] = []): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}

async function tableExists(db: PatientVitalMeasurementBackfillDatabase, table: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=? LIMIT 1`).bind(table).first()) != null;
}

async function tableColumns(db: PatientVitalMeasurementBackfillDatabase, table: string): Promise<Set<string>> {
  if (!(await tableExists(db, table))) return new Set();
  const result = await rows<{ name: string }>(db.prepare(`PRAGMA table_info(${table})`));
  return new Set(result.map((row) => row.name));
}

async function captureCounts(db: PatientVitalMeasurementBackfillDatabase, tenantId: string): Promise<StartingCounts> {
  return {
    sets: await count(db, `SELECT COUNT(*) AS count FROM canonical_vital_observation_sets WHERE tenant_id=?`, [tenantId]),
    components: await count(db, `SELECT COUNT(*) AS count FROM canonical_vital_observation_components WHERE tenant_id=?`, [tenantId]),
    events: await count(db, `SELECT COUNT(*) AS count FROM canonical_vital_observation_status_events WHERE tenant_id=?`, [tenantId]),
    mappings: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type='vital_observation_set'
    `, [tenantId]),
    issues: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_processing_issues
      WHERE tenant_id=? AND entity_type='patient_vital_measurement'
    `, [tenantId]),
  };
}

async function resultFromDelta(
  db: PatientVitalMeasurementBackfillDatabase,
  context: Context,
  starting: StartingCounts,
  completed: boolean,
): Promise<PatientVitalMeasurementBackfillResult> {
  const ending = await captureCounts(db, context.tenantId);
  return {
    completed,
    counts: {
      scanned: context.scanned,
      observationSetsCreated: ending.sets - starting.sets,
      componentsCreated: ending.components - starting.components,
      statusEventsCreated: ending.events - starting.events,
      mappingsCreated: ending.mappings - starting.mappings,
      skipped: context.skipped,
      issues: ending.issues - starting.issues,
    },
  };
}

async function ensureRun(
  db: PatientVitalMeasurementBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<MigrationRunRow> {
  let run = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (run) return run;
  await db.prepare(`
    INSERT INTO canonical_migration_runs (
      tenant_id,run_public_id,migration_name,migration_kind,status,started_at_utc,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'backfill','running',?,?,?)
  `).bind(tenantId, runPublicId, MIGRATION_NAME, nowUtc, nowUtc, nowUtc).run();
  run = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!run) throw new Error('failed to create patient vital backfill run');
  return run;
}

async function ensureCheckpoint(context: Context, partition: Partition): Promise<CheckpointRow> {
  let checkpoint = await context.db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type=? AND source_type=? AND partition_key=?
    LIMIT 1
  `).bind(
    context.tenantId, context.runId, ENTITY_TYPE, partition.sourceType, partition.partitionKey,
  ).first<CheckpointRow>();
  if (checkpoint) return checkpoint;
  const checkpointPublicId = await createDeterministicSourceId(
    'vitalcp', context.tenantId, partition.sourceType, `${context.runPublicId}:${partition.partitionKey}`,
  );
  await context.db.prepare(`
    INSERT INTO canonical_backfill_checkpoints (
      tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
      partition_key,status,started_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,'pending',?,?,?)
  `).bind(
    context.tenantId, checkpointPublicId, context.runId, ENTITY_TYPE,
    partition.sourceType, partition.partitionKey, context.nowUtc, context.nowUtc, context.nowUtc,
  ).run();
  checkpoint = await context.db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND checkpoint_public_id=? LIMIT 1
  `).bind(context.tenantId, checkpointPublicId).first<CheckpointRow>();
  if (!checkpoint) throw new Error('failed to create patient vital backfill checkpoint');
  return checkpoint;
}

async function markCheckpointRunning(context: Context, checkpoint: CheckpointRow): Promise<void> {
  if (checkpoint.status === 'completed') return;
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status='running',completed_at_utc=NULL,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(context.nowUtc, context.tenantId, checkpoint.id).run();
}

async function recordCheckpointOutcome(
  context: Context,
  checkpoint: CheckpointRow,
  cursor: string,
  outcome: ProcessOutcome,
): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET cursor_value=?,scanned_count=scanned_count+1,
        created_count=created_count+?,mapped_count=mapped_count+?,
        skipped_count=skipped_count+?,exception_count=exception_count+?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    cursor,
    outcome.created ? 1 : 0,
    outcome.mapped ? 1 : 0,
    outcome.skipped ? 1 : 0,
    outcome.issue ? 1 : 0,
    context.nowUtc,
    context.tenantId,
    checkpoint.id,
  ).run();
  context.scanned += 1;
  context.remaining -= 1;
  if (outcome.skipped) context.skipped += 1;
}

async function completeCheckpoint(context: Context, checkpoint: CheckpointRow): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status='completed',completed_at_utc=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(context.nowUtc, context.nowUtc, context.tenantId, checkpoint.id).run();
}

async function pauseCheckpoint(context: Context, checkpoint: CheckpointRow): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status='paused',completed_at_utc=NULL,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(context.nowUtc, context.tenantId, checkpoint.id).run();
}

async function recordIssue(
  context: Context,
  input: {
    code: string;
    sourceType: string;
    sourcePublicId: string;
    severity?: 'info' | 'warning' | 'error' | 'critical';
    reasonCode: string;
  },
): Promise<void> {
  const fingerprint = await createRequestFingerprint({
    schemaVersion: 1,
    issueCode: input.code,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
  });
  const issuePublicId = await createDeterministicSourceId(
    'vitissue', context.tenantId, input.sourceType, `${input.code}:${input.sourcePublicId}`,
  );
  const details = stableCanonicalJson({ schemaVersion: 1, reasonCode: input.reasonCode });
  await context.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,reconciliation_run_id,issue_type,
      issue_code,entity_type,entity_public_id,source_type,source_public_id,fingerprint,
      severity,status,occurrence_count,summary,details_json,first_seen_at_utc,
      last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,NULL,'migration_mapping',?,'patient_vital_measurement',NULL,?,?,?,
              ?,'open',1,?,?,?, ?,?,?)
    ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    context.tenantId,
    issuePublicId,
    context.runId,
    input.code,
    input.sourceType,
    input.sourcePublicId,
    fingerprint,
    input.severity ?? 'warning',
    input.code,
    details,
    context.nowUtc,
    context.nowUtc,
    context.nowUtc,
    context.nowUtc,
  ).run();
}

async function resolvePatientLinkByLegacy(
  db: PatientVitalMeasurementBackfillDatabase,
  tenantId: string,
  patientId: number,
): Promise<string | null> {
  const direct = await db.prepare(`
    SELECT patient_link_public_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=? LIMIT 1
  `).bind(tenantId, patientId).first<PatientLinkRow>();
  if (direct && !['rejected', 'retired'].includes(direct.link_status) && direct.effective_to_utc == null) {
    return direct.patient_link_public_id;
  }
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='patient_link' AND source_type='legacy_patient'
      AND source_public_id=? LIMIT 1
  `).bind(tenantId, String(patientId)).first<MappingRow>();
  return mapping?.mapping_status === 'mapped' ? mapping.canonical_public_id : null;
}

async function resolvePatientLinkByUhid(
  db: PatientVitalMeasurementBackfillDatabase,
  tenantId: string,
  uhid: string,
): Promise<string | null> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='patient_link' AND source_type='global_patient_uhid'
      AND source_public_id=? LIMIT 1
  `).bind(tenantId, uhid).first<MappingRow>();
  return mapping?.mapping_status === 'mapped' ? mapping.canonical_public_id : null;
}

async function resolveEncounter(
  db: PatientVitalMeasurementBackfillDatabase,
  tenantId: string,
  sourceType: 'legacy_visit' | 'legacy_admission',
  sourceId: number | null,
): Promise<string | null> {
  if (sourceId == null) return null;
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter' AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(tenantId, sourceType, String(sourceId)).first<MappingRow>();
  return mapping?.mapping_status === 'mapped' ? mapping.canonical_public_id : null;
}

async function resolvePractitioner(
  db: PatientVitalMeasurementBackfillDatabase,
  tenantId: string,
  legacyUserId: string | number | null,
): Promise<string | null> {
  if (legacyUserId == null || String(legacyUserId).trim() === '') return null;
  const numeric = Number(legacyUserId);
  if (!Number.isSafeInteger(numeric)) return null;
  const row = await db.prepare(`
    SELECT l.practitioner_public_id,p.status
    FROM canonical_practitioner_user_links l
    JOIN canonical_practitioners p
      ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
    WHERE l.tenant_id=? AND l.legacy_user_id=? AND l.link_status='active' LIMIT 1
  `).bind(tenantId, numeric).first<PractitionerRow>();
  return row?.status === 'active' ? row.practitioner_public_id : null;
}

function addComponent(
  components: CanonicalVitalComponentInput[],
  code: CanonicalVitalComponentInput['measurementCode'],
  value: number | null | undefined,
  unitCode: string,
  evidence: string,
  extra: Partial<CanonicalVitalComponentInput> = {},
): void {
  if (value == null) return;
  components.push({
    measurementCode: code,
    numericValue: Number(value),
    unitCode,
    sourceEvidenceSha256: evidence,
    ...extra,
  });
}

async function migrateVitalRow(
  context: Context,
  input: {
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    patientLinkPublicId: string;
    encounterPublicId: string | null;
    practitionerPublicId: string | null;
    sourceKind: CanonicalVitalSourceKind;
    effectiveAtUtc: string;
    recordedAtUtc: string;
    components: CanonicalVitalComponentInput[];
    sourceEvidenceSha256: string;
  },
): Promise<ProcessOutcome> {
  if (input.components.length === 0) {
    await recordIssue(context, {
      code: 'VITAL_SOURCE_HAS_NO_MEASUREMENTS',
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
      reasonCode: 'no_supported_measurement_columns',
    });
    return { issue: true };
  }
  try {
    const applied = await recordCanonicalVitalObservationSet(context.db, {
      tenantId: context.tenantId,
      patientLinkPublicId: input.patientLinkPublicId,
      encounterPublicId: input.encounterPublicId,
      practitionerPublicId: input.practitionerPublicId,
      sourceKind: input.sourceKind,
      effectiveAtUtc: input.effectiveAtUtc,
      recordedAtUtc: input.recordedAtUtc,
      components: input.components,
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
      sourceTable: input.sourceTable,
      sourceEvidenceSha256: input.sourceEvidenceSha256,
      actorSystemKey: 'canonical.vital.backfill',
      idempotencyKey: `cdb123d:${input.sourceType}:${input.sourcePublicId}`,
      occurredAtUtc: context.nowUtc,
      businessDate: businessDate(input.effectiveAtUtc),
    });
    return applied.status === 'applied'
      ? { created: true, mapped: true }
      : { skipped: true, mapped: true };
  } catch (error) {
    await recordIssue(context, {
      code: 'VITAL_SOURCE_VALUE_INVALID',
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
      severity: 'error',
      reasonCode: error instanceof Error ? error.name : 'unknown_validation_error',
    });
    return { issue: true };
  }
}

async function processRows<T>(
  context: Context,
  checkpoint: CheckpointRow,
  rowsToProcess: T[],
  cursorOf: (row: T) => string,
  handler: (row: T) => Promise<ProcessOutcome>,
  hasMore: (cursor: string) => Promise<boolean>,
): Promise<boolean> {
  await markCheckpointRunning(context, checkpoint);
  let cursor = checkpoint.cursor_value ?? '0';
  for (const row of rowsToProcess) {
    const outcome = await handler(row);
    cursor = cursorOf(row);
    await recordCheckpointOutcome(context, checkpoint, cursor, outcome);
  }
  if (await hasMore(cursor)) {
    await pauseCheckpoint(context, checkpoint);
    return false;
  }
  await completeCheckpoint(context, checkpoint);
  return true;
}

async function processPatientVitals(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'patient_vitals'))) {
    await completeCheckpoint(context, checkpoint);
    return true;
  }
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const sourceRows = await rows<PatientVitalsRow>(context.db.prepare(`
    SELECT id,patient_id,admission_id,systolic,diastolic,temperature,heart_rate,
           spo2,respiratory_rate,weight,recorded_by,recorded_at
    FROM patient_vitals WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  return processRows(
    context,
    checkpoint,
    sourceRows,
    (row) => String(row.id),
    async (row) => {
      const sourceType = 'legacy_patient_vitals';
      const sourcePublicId = String(row.id);
      const patientLinkPublicId = await resolvePatientLinkByLegacy(context.db, context.tenantId, row.patient_id);
      if (!patientLinkPublicId) {
        await recordIssue(context, { code: 'VITAL_PATIENT_LINK_MISSING', sourceType, sourcePublicId, severity: 'error', reasonCode: 'legacy_patient_unmapped' });
        return { issue: true };
      }
      const encounterPublicId = await resolveEncounter(context.db, context.tenantId, 'legacy_admission', row.admission_id);
      if (row.admission_id != null && !encounterPublicId) {
        await recordIssue(context, { code: 'VITAL_ENCOUNTER_MAPPING_MISSING', sourceType, sourcePublicId, severity: 'error', reasonCode: 'legacy_admission_unmapped' });
        return { issue: true };
      }
      const evidence = await createSourceEvidenceSha256({
        sourceType, sourcePublicId, patientId: row.patient_id, admissionId: row.admission_id,
        recordedAt: row.recorded_at, values: [row.systolic, row.diastolic, row.temperature, row.heart_rate, row.spo2, row.respiratory_rate, row.weight],
      });
      const components: CanonicalVitalComponentInput[] = [];
      addComponent(components, 'blood_pressure_systolic', row.systolic, 'mm[Hg]', evidence);
      addComponent(components, 'blood_pressure_diastolic', row.diastolic, 'mm[Hg]', evidence);
      addComponent(components, 'body_temperature', row.temperature, 'Cel', evidence);
      addComponent(components, 'heart_rate', row.heart_rate, '/min', evidence);
      addComponent(components, 'oxygen_saturation', row.spo2, '%', evidence);
      addComponent(components, 'respiratory_rate', row.respiratory_rate, '/min', evidence);
      addComponent(components, 'body_weight', row.weight, 'kg', evidence);
      const effectiveAtUtc = normalizedUtc(row.recorded_at, context.nowUtc);
      return migrateVitalRow(context, {
        sourceType,
        sourcePublicId,
        sourceTable: 'patient_vitals',
        patientLinkPublicId,
        encounterPublicId,
        practitionerPublicId: await resolvePractitioner(context.db, context.tenantId, row.recorded_by),
        sourceKind: 'legacy_backfill',
        effectiveAtUtc,
        recordedAtUtc: effectiveAtUtc,
        components,
        sourceEvidenceSha256: evidence,
      });
    },
    async (lastCursor) => (await context.db.prepare(`
      SELECT 1 AS present FROM patient_vitals WHERE tenant_id=? AND id>? LIMIT 1
    `).bind(context.tenantId, Number(lastCursor)).first()) != null,
  );
}

async function processPatientVitalAlerts(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'vital_alerts'))) {
    await completeCheckpoint(context, checkpoint);
    return true;
  }
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const sourceRows = await rows<VitalAlertRow>(context.db.prepare(`
    SELECT id,vital_id FROM vital_alerts WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  return processRows(
    context, checkpoint, sourceRows, (row) => String(row.id),
    async (row) => {
      await recordIssue(context, {
        code: 'VITAL_ALERT_PROJECTION_RELINK_REQUIRED',
        sourceType: 'legacy_vital_alert',
        sourcePublicId: String(row.id),
        severity: 'warning',
        reasonCode: 'alert_is_projection_and_requires_canonical_component_link',
      });
      return { issue: true };
    },
    async (lastCursor) => (await context.db.prepare(`
      SELECT 1 AS present FROM vital_alerts WHERE tenant_id=? AND id>? LIMIT 1
    `).bind(context.tenantId, Number(lastCursor)).first()) != null,
  );
}

async function processClinicalVitals(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'clinical_vitals'))) {
    await completeCheckpoint(context, checkpoint);
    return true;
  }
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const sourceRows = await rows<ClinicalVitalsRow>(context.db.prepare(`
    SELECT id,patient_id,visit_id,temperature,pulse,blood_pressure_systolic,
           blood_pressure_diastolic,respiratory_rate,spo2,weight,height,bmi,
           pain_scale,blood_sugar,taken_by,taken_at
    FROM clinical_vitals WHERE tenant_id=? AND id>? AND COALESCE(is_active,1)=1
    ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  return processRows(
    context, checkpoint, sourceRows, (row) => String(row.id),
    async (row) => {
      const sourceType = 'legacy_clinical_vitals';
      const sourcePublicId = String(row.id);
      const patientLinkPublicId = await resolvePatientLinkByLegacy(context.db, context.tenantId, row.patient_id);
      if (!patientLinkPublicId) {
        await recordIssue(context, { code: 'VITAL_PATIENT_LINK_MISSING', sourceType, sourcePublicId, severity: 'error', reasonCode: 'legacy_patient_unmapped' });
        return { issue: true };
      }
      const encounterPublicId = await resolveEncounter(context.db, context.tenantId, 'legacy_visit', row.visit_id);
      if (row.visit_id != null && !encounterPublicId) {
        await recordIssue(context, { code: 'VITAL_ENCOUNTER_MAPPING_MISSING', sourceType, sourcePublicId, severity: 'error', reasonCode: 'legacy_visit_unmapped' });
        return { issue: true };
      }
      const evidence = await createSourceEvidenceSha256({
        sourceType, sourcePublicId, patientId: row.patient_id, visitId: row.visit_id,
        takenAt: row.taken_at, values: [row.temperature, row.pulse, row.blood_pressure_systolic, row.blood_pressure_diastolic, row.respiratory_rate, row.spo2, row.weight, row.height, row.pain_scale, row.blood_sugar],
      });
      const components: CanonicalVitalComponentInput[] = [];
      addComponent(components, 'body_temperature', row.temperature, '[degF]', evidence);
      addComponent(components, 'heart_rate', row.pulse, '/min', evidence);
      addComponent(components, 'blood_pressure_systolic', row.blood_pressure_systolic, 'mm[Hg]', evidence);
      addComponent(components, 'blood_pressure_diastolic', row.blood_pressure_diastolic, 'mm[Hg]', evidence);
      addComponent(components, 'respiratory_rate', row.respiratory_rate, '/min', evidence);
      addComponent(components, 'oxygen_saturation', row.spo2, '%', evidence);
      addComponent(components, 'body_weight', row.weight, 'kg', evidence);
      addComponent(components, 'body_height', row.height, 'cm', evidence);
      addComponent(components, 'pain_score', row.pain_scale, '{score}', evidence);
      addComponent(components, 'blood_glucose', row.blood_sugar, 'mg/dL', evidence);
      const effectiveAtUtc = normalizedUtc(row.taken_at, context.nowUtc);
      return migrateVitalRow(context, {
        sourceType,
        sourcePublicId,
        sourceTable: 'clinical_vitals',
        patientLinkPublicId,
        encounterPublicId,
        practitionerPublicId: await resolvePractitioner(context.db, context.tenantId, row.taken_by),
        sourceKind: 'legacy_backfill',
        effectiveAtUtc,
        recordedAtUtc: effectiveAtUtc,
        components,
        sourceEvidenceSha256: evidence,
      });
    },
    async (lastCursor) => (await context.db.prepare(`
      SELECT 1 AS present FROM clinical_vitals WHERE tenant_id=? AND id>? AND COALESCE(is_active,1)=1 LIMIT 1
    `).bind(context.tenantId, Number(lastCursor)).first()) != null,
  );
}

async function processGlobalUhidVitals(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const columns = await tableColumns(context.db, 'global_patient_vitals');
  if (!columns.has('uhid') || !columns.has('logged_on')) {
    await completeCheckpoint(context, checkpoint);
    return true;
  }
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const selectColumns = [
    'id','uhid','logged_on','systolic','diastolic','heart_rate','blood_sugar','blood_sugar_context','created_at',
  ].filter((column) => columns.has(column));
  const sourceRows = await rows<GlobalVitalRow>(context.db.prepare(`
    SELECT ${selectColumns.join(',')} FROM global_patient_vitals
    WHERE id>? AND uhid IS NOT NULL AND logged_on IS NOT NULL ORDER BY id LIMIT ?
  `).bind(cursor, context.remaining));
  return processRows(
    context, checkpoint, sourceRows, (row) => String(row.id),
    async (row) => {
      const sourceType = 'legacy_global_vitals_uhid';
      const sourcePublicId = String(row.id);
      const patientLinkPublicId = row.uhid ? await resolvePatientLinkByUhid(context.db, context.tenantId, row.uhid) : null;
      if (!patientLinkPublicId) {
        await recordIssue(context, { code: 'VITAL_PATIENT_LINK_MISSING', sourceType, sourcePublicId, severity: 'error', reasonCode: 'global_uhid_unmapped' });
        return { issue: true };
      }
      const evidence = await createSourceEvidenceSha256({
        sourceType, sourcePublicId, uhid: row.uhid, loggedOn: row.logged_on,
        values: [row.systolic, row.diastolic, row.heart_rate, row.blood_sugar],
      });
      const components: CanonicalVitalComponentInput[] = [];
      addComponent(components, 'blood_pressure_systolic', row.systolic, 'mm[Hg]', evidence);
      addComponent(components, 'blood_pressure_diastolic', row.diastolic, 'mm[Hg]', evidence);
      addComponent(components, 'heart_rate', row.heart_rate, '/min', evidence);
      addComponent(components, 'blood_glucose', row.blood_sugar, 'mg/dL', evidence, { fastingContextCode: row.blood_sugar_context ?? null });
      const effectiveAtUtc = normalizedUtc(row.logged_on, normalizedUtc(row.created_at, context.nowUtc));
      return migrateVitalRow(context, {
        sourceType,
        sourcePublicId,
        sourceTable: 'global_patient_vitals',
        patientLinkPublicId,
        encounterPublicId: null,
        practitionerPublicId: null,
        sourceKind: 'patient_reported',
        effectiveAtUtc,
        recordedAtUtc: normalizedUtc(row.created_at, effectiveAtUtc),
        components,
        sourceEvidenceSha256: evidence,
      });
    },
    async (lastCursor) => (await context.db.prepare(`
      SELECT 1 AS present FROM global_patient_vitals
      WHERE id>? AND uhid IS NOT NULL AND logged_on IS NOT NULL LIMIT 1
    `).bind(Number(lastCursor)).first()) != null,
  );
}

async function processGlobalPatientVitals(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const columns = await tableColumns(context.db, 'global_patient_vitals');
  if (!columns.has('patient_id') || !columns.has('logged_at')) {
    await completeCheckpoint(context, checkpoint);
    return true;
  }
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const selectColumns = [
    'id','patient_id','logged_at','systolic','diastolic','heart_rate','blood_sugar','blood_sugar_context',
    'weight_kg','temperature_f','spo2','created_at',
  ].filter((column) => columns.has(column));
  const sourceRows = await rows<GlobalVitalRow>(context.db.prepare(`
    SELECT ${selectColumns.join(',')} FROM global_patient_vitals
    WHERE id>? AND patient_id IS NOT NULL AND logged_at IS NOT NULL ORDER BY id LIMIT ?
  `).bind(cursor, context.remaining));
  return processRows(
    context, checkpoint, sourceRows, (row) => String(row.id),
    async (row) => {
      const sourceType = 'legacy_global_vitals_patient';
      const sourcePublicId = String(row.id);
      const patientLinkPublicId = row.patient_id == null
        ? null
        : await resolvePatientLinkByLegacy(context.db, context.tenantId, row.patient_id);
      if (!patientLinkPublicId) {
        await recordIssue(context, { code: 'VITAL_PATIENT_LINK_MISSING', sourceType, sourcePublicId, severity: 'error', reasonCode: 'global_patient_id_unmapped' });
        return { issue: true };
      }
      const evidence = await createSourceEvidenceSha256({
        sourceType, sourcePublicId, patientId: row.patient_id, loggedAt: row.logged_at,
        values: [row.systolic, row.diastolic, row.heart_rate, row.blood_sugar, row.weight_kg, row.temperature_f, row.spo2],
      });
      const components: CanonicalVitalComponentInput[] = [];
      addComponent(components, 'blood_pressure_systolic', row.systolic, 'mm[Hg]', evidence);
      addComponent(components, 'blood_pressure_diastolic', row.diastolic, 'mm[Hg]', evidence);
      addComponent(components, 'heart_rate', row.heart_rate, '/min', evidence);
      addComponent(components, 'blood_glucose', row.blood_sugar, 'mg/dL', evidence, { fastingContextCode: row.blood_sugar_context ?? null });
      addComponent(components, 'body_weight', row.weight_kg, 'kg', evidence);
      addComponent(components, 'body_temperature', row.temperature_f, '[degF]', evidence);
      addComponent(components, 'oxygen_saturation', row.spo2, '%', evidence);
      const effectiveAtUtc = normalizedUtc(row.logged_at, context.nowUtc);
      return migrateVitalRow(context, {
        sourceType,
        sourcePublicId,
        sourceTable: 'global_patient_vitals',
        patientLinkPublicId,
        encounterPublicId: null,
        practitionerPublicId: null,
        sourceKind: 'patient_reported',
        effectiveAtUtc,
        recordedAtUtc: normalizedUtc(row.created_at, effectiveAtUtc),
        components,
        sourceEvidenceSha256: evidence,
      });
    },
    async (lastCursor) => (await context.db.prepare(`
      SELECT 1 AS present FROM global_patient_vitals
      WHERE id>? AND patient_id IS NOT NULL AND logged_at IS NOT NULL LIMIT 1
    `).bind(Number(lastCursor)).first()) != null,
  );
}

async function processNursingMonitoring(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'nur_patient_monitoring'))) {
    await completeCheckpoint(context, checkpoint);
    return true;
  }
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const sourceRows = await rows<NursingMonitoringRow>(context.db.prepare(`
    SELECT id,patient_id,visit_id,temperature,temperature_unit,pulse,respiration,
           bp_systolic,bp_diastolic,spo2,pain_scale,recorded_on,created_by
    FROM nur_patient_monitoring
    WHERE tenant_id=? AND id>? AND COALESCE(is_active,1)=1 ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  return processRows(
    context, checkpoint, sourceRows, (row) => String(row.id),
    async (row) => {
      const sourceType = 'legacy_nursing_monitoring';
      const sourcePublicId = String(row.id);
      const patientLinkPublicId = await resolvePatientLinkByLegacy(context.db, context.tenantId, row.patient_id);
      const encounterPublicId = await resolveEncounter(context.db, context.tenantId, 'legacy_visit', row.visit_id);
      const practitionerPublicId = await resolvePractitioner(context.db, context.tenantId, row.created_by);
      if (!patientLinkPublicId) {
        await recordIssue(context, { code: 'VITAL_PATIENT_LINK_MISSING', sourceType, sourcePublicId, severity: 'error', reasonCode: 'nursing_patient_unmapped' });
        return { issue: true };
      }
      if (!encounterPublicId) {
        await recordIssue(context, { code: 'VITAL_ENCOUNTER_MAPPING_MISSING', sourceType, sourcePublicId, severity: 'error', reasonCode: 'nursing_visit_unmapped' });
        return { issue: true };
      }
      if (!practitionerPublicId) {
        await recordIssue(context, { code: 'VITAL_PRACTITIONER_MAPPING_MISSING', sourceType, sourcePublicId, severity: 'error', reasonCode: 'nursing_recorder_unmapped' });
        return { issue: true };
      }
      const evidence = await createSourceEvidenceSha256({
        sourceType, sourcePublicId, patientId: row.patient_id, visitId: row.visit_id,
        recordedOn: row.recorded_on, values: [row.temperature, row.pulse, row.respiration, row.bp_systolic, row.bp_diastolic, row.spo2, row.pain_scale],
      });
      const components: CanonicalVitalComponentInput[] = [];
      const temperatureUnit = row.temperature_unit?.trim().toUpperCase() === 'F' ? '[degF]' : 'Cel';
      addComponent(components, 'body_temperature', row.temperature, temperatureUnit, evidence);
      addComponent(components, 'heart_rate', row.pulse, '/min', evidence);
      addComponent(components, 'respiratory_rate', row.respiration, '/min', evidence);
      addComponent(components, 'blood_pressure_systolic', row.bp_systolic, 'mm[Hg]', evidence);
      addComponent(components, 'blood_pressure_diastolic', row.bp_diastolic, 'mm[Hg]', evidence);
      addComponent(components, 'oxygen_saturation', row.spo2, '%', evidence);
      addComponent(components, 'pain_score', row.pain_scale, '{score}', evidence);
      const effectiveAtUtc = normalizedUtc(row.recorded_on, context.nowUtc);
      return migrateVitalRow(context, {
        sourceType,
        sourcePublicId,
        sourceTable: 'nur_patient_monitoring',
        patientLinkPublicId,
        encounterPublicId,
        practitionerPublicId,
        sourceKind: 'nurse_entered',
        effectiveAtUtc,
        recordedAtUtc: effectiveAtUtc,
        components,
        sourceEvidenceSha256: evidence,
      });
    },
    async (lastCursor) => (await context.db.prepare(`
      SELECT 1 AS present FROM nur_patient_monitoring
      WHERE tenant_id=? AND id>? AND COALESCE(is_active,1)=1 LIMIT 1
    `).bind(context.tenantId, Number(lastCursor)).first()) != null,
  );
}

async function processDeviceProvenance(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'wearable_samples'))) {
    await completeCheckpoint(context, checkpoint);
    return true;
  }
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const sourceRows = await rows<WearableRow>(context.db.prepare(`
    SELECT id,patient_id,sample_type FROM wearable_samples WHERE id>? ORDER BY id LIMIT ?
  `).bind(cursor, context.remaining));
  return processRows(
    context, checkpoint, sourceRows, (row) => String(row.id),
    async (row) => {
      await recordIssue(context, {
        code: 'VITAL_DEVICE_IDENTITY_UNRESOLVED',
        sourceType: 'legacy_wearable_sample',
        sourcePublicId: String(row.id),
        severity: 'warning',
        reasonCode: 'device_name_and_platform_are_not_exact_device_identity',
      });
      return { issue: true };
    },
    async (lastCursor) => (await context.db.prepare(`
      SELECT 1 AS present FROM wearable_samples WHERE id>? LIMIT 1
    `).bind(Number(lastCursor)).first()) != null,
  );
}

async function processDerivedBmi(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'clinical_vitals'))) {
    await completeCheckpoint(context, checkpoint);
    return true;
  }
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const sourceRows = await rows<BmiRow>(context.db.prepare(`
    SELECT id,weight,height,bmi FROM clinical_vitals
    WHERE tenant_id=? AND id>? AND bmi IS NOT NULL ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  return processRows(
    context, checkpoint, sourceRows, (row) => String(row.id),
    async (row) => {
      if (row.weight != null && row.height != null && row.height > 0 && row.bmi != null) {
        const derived = row.weight / ((row.height / 100) ** 2);
        if (Math.abs(derived - row.bmi) > 0.1) {
          await recordIssue(context, {
            code: 'VITAL_DERIVED_BMI_MISMATCH',
            sourceType: 'legacy_clinical_vitals_bmi',
            sourcePublicId: String(row.id),
            severity: 'warning',
            reasonCode: 'source_bmi_differs_from_canonical_formula',
          });
          return { issue: true };
        }
      }
      return { skipped: true };
    },
    async (lastCursor) => (await context.db.prepare(`
      SELECT 1 AS present FROM clinical_vitals
      WHERE tenant_id=? AND id>? AND bmi IS NOT NULL LIMIT 1
    `).bind(context.tenantId, Number(lastCursor)).first()) != null,
  );
}

async function processDuplicateProjectionDisposition(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'clinical_vitals')) || !(await tableExists(context.db, 'patient_vitals'))) {
    await completeCheckpoint(context, checkpoint);
    return true;
  }
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const sourceRows = await rows<DuplicateCandidateRow>(context.db.prepare(`
    SELECT c.id
    FROM clinical_vitals c
    WHERE c.tenant_id=? AND c.id>? AND EXISTS (
      SELECT 1 FROM patient_vitals p
      WHERE p.tenant_id=c.tenant_id AND p.patient_id=c.patient_id
        AND p.recorded_at=c.taken_at
    )
    ORDER BY c.id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  return processRows(
    context, checkpoint, sourceRows, (row) => String(row.id),
    async (row) => {
      await recordIssue(context, {
        code: 'VITAL_DUPLICATE_CANDIDATE_NOT_MERGED',
        sourceType: 'legacy_vital_duplicate_candidate',
        sourcePublicId: String(row.id),
        severity: 'info',
        reasonCode: 'same_patient_time_is_not_source_identity',
      });
      return { issue: true };
    },
    async (lastCursor) => (await context.db.prepare(`
      SELECT 1 AS present
      FROM clinical_vitals c
      WHERE c.tenant_id=? AND c.id>? AND EXISTS (
        SELECT 1 FROM patient_vitals p
        WHERE p.tenant_id=c.tenant_id AND p.patient_id=c.patient_id
          AND p.recorded_at=c.taken_at
      ) LIMIT 1
    `).bind(context.tenantId, Number(lastCursor)).first()) != null,
  );
}

const PARTITIONS: Partition[] = [
  { sourceType: 'legacy_patient_vitals', partitionKey: '01-patient-vitals', process: processPatientVitals },
  { sourceType: 'legacy_patient_vital_alerts', partitionKey: '02-patient-vital-alerts', process: processPatientVitalAlerts },
  { sourceType: 'legacy_clinical_vitals', partitionKey: '03-clinical-vitals', process: processClinicalVitals },
  { sourceType: 'legacy_global_vitals_uhid', partitionKey: '04-global-uhid-logged-on', process: processGlobalUhidVitals },
  { sourceType: 'legacy_global_vitals_patient', partitionKey: '05-global-patient-logged-at', process: processGlobalPatientVitals },
  { sourceType: 'legacy_nursing_monitoring', partitionKey: '06-nursing-monitoring', process: processNursingMonitoring },
  { sourceType: 'legacy_vital_device', partitionKey: '07-device-provenance', process: processDeviceProvenance },
  { sourceType: 'legacy_vital_derived', partitionKey: '08-bmi-classification-derived', process: processDerivedBmi },
  { sourceType: 'legacy_vital_projection', partitionKey: '09-duplicate-projection-disposition', process: processDuplicateProjectionDisposition },
];

export async function backfillPatientVitalMeasurement(
  db: PatientVitalMeasurementBackfillDatabase,
  options: PatientVitalMeasurementBackfillOptions,
): Promise<PatientVitalMeasurementBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const nowUtc = normalizedUtc(options.nowUtc, options.nowUtc);
  const starting = await captureCounts(db, tenantId);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  if (run.status === 'succeeded') {
    return {
      completed: true,
      counts: {
        scanned: 0,
        observationSetsCreated: 0,
        componentsCreated: 0,
        statusEventsCreated: 0,
        mappingsCreated: 0,
        skipped: 0,
        issues: 0,
      },
    };
  }
  const context: Context = {
    db,
    tenantId,
    runId: Number(run.id),
    runPublicId,
    nowUtc,
    remaining: sourceLimit(options.maxSourceRecords),
    scanned: 0,
    skipped: 0,
  };

  for (const partition of PARTITIONS) {
    const checkpoint = await ensureCheckpoint(context, partition);
    if (checkpoint.status === 'completed') continue;
    if (context.remaining <= 0) return resultFromDelta(db, context, starting, false);
    const completed = await partition.process(context, checkpoint);
    if (!completed) return resultFromDelta(db, context, starting, false);
  }

  const result = await resultFromDelta(db, context, starting, true);
  await db.prepare(`
    UPDATE canonical_migration_runs
    SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    nowUtc,
    stableCanonicalJson({ schemaVersion: 1, counts: result.counts, partitionCount: PARTITIONS.length }),
    nowUtc,
    tenantId,
    run.id,
  ).run();
  return result;
}
