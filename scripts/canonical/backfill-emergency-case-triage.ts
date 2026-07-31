import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  enterCanonicalEmergencyCaseInError,
  recordCanonicalEmergencyCaseClassification,
  recordCanonicalEmergencyDisposition,
  recordCanonicalEmergencyTriageAssessment,
  registerCanonicalEmergencyCase,
  transitionCanonicalEmergencyCase,
  type CanonicalEmergencyCaseStatus,
} from '../../src/lib/canonical/commands/manage-emergency-case-triage';
import { createRequestFingerprint, stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface EmergencyCaseTriageBackfillPreparedStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): EmergencyCaseTriageBackfillPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface EmergencyCaseTriageBackfillDatabase extends CanonicalBatchDatabase {
  prepare(sql: string): EmergencyCaseTriageBackfillPreparedStatement;
  batch(statements: EmergencyCaseTriageBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface EmergencyCaseTriageBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc: string;
  maxSourceRecords?: number;
}

export interface EmergencyCaseTriageBackfillCounts {
  scanned: number;
  casesCreated: number;
  arrivalAssessmentsCreated: number;
  statusEventsCreated: number;
  triageAssessmentsCreated: number;
  classificationsCreated: number;
  dispositionsCreated: number;
  mappingsCreated: number;
  issuesCreated: number;
  skipped: number;
}

export interface EmergencyCaseTriageBackfillResult {
  completed: boolean;
  counts: EmergencyCaseTriageBackfillCounts;
}

interface MigrationRunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface PractitionerRow { practitioner_public_id: string; status: string }
interface CaseStateRow {
  emergency_case_public_id: string;
  current_status: CanonicalEmergencyCaseStatus;
  status_version: number;
  current_triage_assessment_public_id: string | null;
  current_disposition_event_public_id: string | null;
}
interface TriageVersionRow { version_number: number }
interface DispositionVersionRow { disposition_version: number }
interface DocumentVersionRow {
  document_public_id: string;
  version_public_id: string;
  content_sha256: string;
  version_kind: string;
}
interface ErPatientRow {
  id: number;
  patient_id: number | null;
  visit_id: number | null;
  discharge_summary_id: number | null;
  visit_datetime: string | null;
  referred_by: string | null;
  referred_to: string | null;
  case_type: string | null;
  condition_on_arrival: string | null;
  brought_by: string | null;
  relation_with_patient: string | null;
  mode_of_arrival_id: number | null;
  er_status: string | null;
  triage_code: string | null;
  triaged_by: number | null;
  triaged_on: string | null;
  is_active: number | null;
  finalized_status: string | null;
  finalized_remarks: string | null;
  finalized_by: number | null;
  finalized_on: string | null;
  is_police_case: number | null;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}
interface ErCaseRow {
  id: number;
  er_patient_id: number;
  main_case: number | null;
  sub_case: number | null;
  other_case_details: string | null;
  biting_site: number | null;
  datetime_of_bite: string | null;
  biting_animal: number | null;
  first_aid: number | null;
  first_aid_others: string | null;
  biting_animal_others: string | null;
  biting_site_others: string | null;
  is_active: number | null;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}
interface ErSummaryRow { id: number; patient_id: number; visit_id: number; created_at: string | null; updated_at: string | null }
interface ErFileRow { id: number; er_patient_id: number; patient_id: number | null; file_type: string | null; file_url: string | null; created_at: string | null }
interface IdRow { id: number }
interface StartingCounts {
  cases: number;
  arrivals: number;
  statusEvents: number;
  triage: number;
  classifications: number;
  dispositions: number;
  mappings: number;
  issues: number;
}
interface ProcessOutcome { created?: boolean; mapped?: boolean; skipped?: boolean; issue?: boolean }
interface Context {
  db: EmergencyCaseTriageBackfillDatabase;
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

const MIGRATION_NAME = 'CDB-127D emergency case triage backfill';
const ENTITY_TYPE = 'emergency_case_triage';
const ACTOR_SYSTEM_KEY = 'canonical.emergency.backfill';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function normalizedUtc(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  if (raw.endsWith('Z')) return toUtcIso(raw);
  return toUtcIso(`${raw.includes('T') ? raw : raw.replace(' ', 'T')}+06:00`);
}

function businessDate(value: string): string { return value.slice(0, 10); }
function safeCode(value: string | null | undefined, fallback: string): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}
function cursorNumber(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value.split(':').at(-1));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
function sourceLimit(value: number | undefined): number {
  if (value === undefined) return 1_000_000;
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive safe integer');
  return value;
}
async function rows<T>(statement: EmergencyCaseTriageBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}
async function count(
  db: EmergencyCaseTriageBackfillDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}
async function tableExists(db: EmergencyCaseTriageBackfillDatabase, table: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=? LIMIT 1`)
    .bind(table).first()) != null;
}

async function captureCounts(db: EmergencyCaseTriageBackfillDatabase, tenantId: string): Promise<StartingCounts> {
  return {
    cases: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_cases WHERE tenant_id=?`, [tenantId]),
    arrivals: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_arrival_assessments WHERE tenant_id=?`, [tenantId]),
    statusEvents: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_case_status_events WHERE tenant_id=?`, [tenantId]),
    triage: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_triage_assessments WHERE tenant_id=?`, [tenantId]),
    classifications: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_case_classifications WHERE tenant_id=?`, [tenantId]),
    dispositions: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_disposition_events WHERE tenant_id=?`, [tenantId]),
    mappings: await count(db, `SELECT COUNT(*) AS count FROM canonical_source_mappings WHERE tenant_id=? AND entity_type IN (
      'emergency_case','emergency_arrival_assessment','emergency_triage_assessment',
      'emergency_case_classification','emergency_case_status_event','emergency_disposition_event'
    )`, [tenantId]),
    issues: await count(db, `SELECT COUNT(*) AS count FROM canonical_processing_issues WHERE tenant_id=? AND entity_type=?`, [tenantId, ENTITY_TYPE]),
  };
}

async function resultFromDelta(context: Context, starting: StartingCounts, completed: boolean): Promise<EmergencyCaseTriageBackfillResult> {
  const ending = await captureCounts(context.db, context.tenantId);
  return {
    completed,
    counts: {
      scanned: context.scanned,
      casesCreated: ending.cases - starting.cases,
      arrivalAssessmentsCreated: ending.arrivals - starting.arrivals,
      statusEventsCreated: ending.statusEvents - starting.statusEvents,
      triageAssessmentsCreated: ending.triage - starting.triage,
      classificationsCreated: ending.classifications - starting.classifications,
      dispositionsCreated: ending.dispositions - starting.dispositions,
      mappingsCreated: ending.mappings - starting.mappings,
      issuesCreated: ending.issues - starting.issues,
      skipped: context.skipped,
    },
  };
}

async function ensureRun(
  db: EmergencyCaseTriageBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<MigrationRunRow> {
  let run = await db.prepare(`SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1`)
    .bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (run) return run;
  await db.prepare(`INSERT INTO canonical_migration_runs (
    tenant_id,run_public_id,migration_name,migration_kind,status,started_at_utc,created_at_utc,updated_at_utc
  ) VALUES (?,?,?,'backfill','running',?,?,?)`).bind(
    tenantId, runPublicId, MIGRATION_NAME, nowUtc, nowUtc, nowUtc,
  ).run();
  run = await db.prepare(`SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1`)
    .bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!run) throw new Error('failed to create emergency case/triage backfill run');
  return run;
}

async function ensureCheckpoint(context: Context, partition: Partition): Promise<CheckpointRow> {
  let checkpoint = await context.db.prepare(`SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type=? AND source_type=? AND partition_key=? LIMIT 1`)
    .bind(context.tenantId, context.runId, ENTITY_TYPE, partition.sourceType, partition.partitionKey)
    .first<CheckpointRow>();
  if (checkpoint) return checkpoint;
  const checkpointPublicId = await createDeterministicSourceId(
    'ercp', context.tenantId, partition.sourceType, `${context.runPublicId}:${partition.partitionKey}`,
  );
  await context.db.prepare(`INSERT INTO canonical_backfill_checkpoints (
    tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,partition_key,status,
    started_at_utc,created_at_utc,updated_at_utc
  ) VALUES (?,?,?,?,?,?,'pending',?,?,?)`).bind(
    context.tenantId, checkpointPublicId, context.runId, ENTITY_TYPE, partition.sourceType,
    partition.partitionKey, context.nowUtc, context.nowUtc, context.nowUtc,
  ).run();
  checkpoint = await context.db.prepare(`SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND checkpoint_public_id=? LIMIT 1`)
    .bind(context.tenantId, checkpointPublicId).first<CheckpointRow>();
  if (!checkpoint) throw new Error('failed to create emergency case/triage checkpoint');
  return checkpoint;
}

async function markRunning(context: Context, checkpoint: CheckpointRow): Promise<void> {
  if (checkpoint.status === 'completed') return;
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints
    SET status='running',completed_at_utc=NULL,updated_at_utc=? WHERE tenant_id=? AND id=?`)
    .bind(context.nowUtc, context.tenantId, checkpoint.id).run();
}
async function recordOutcome(
  context: Context,
  checkpoint: CheckpointRow,
  cursor: string,
  outcome: ProcessOutcome,
): Promise<void> {
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints SET
    cursor_value=?,scanned_count=scanned_count+1,created_count=created_count+?,mapped_count=mapped_count+?,
    skipped_count=skipped_count+?,exception_count=exception_count+?,updated_at_utc=?
    WHERE tenant_id=? AND id=?`).bind(
    cursor,
    outcome.created ? 1 : 0,
    outcome.mapped ? 1 : 0,
    outcome.skipped ? 1 : 0,
    outcome.issue ? 1 : 0,
    context.nowUtc,
    context.tenantId,
    checkpoint.id,
  ).run();
  checkpoint.cursor_value = cursor;
  context.scanned += 1;
  context.remaining -= 1;
  if (outcome.skipped) context.skipped += 1;
}
async function setCursor(context: Context, checkpoint: CheckpointRow, cursor: string): Promise<void> {
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints SET cursor_value=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?`).bind(cursor, context.nowUtc, context.tenantId, checkpoint.id).run();
  checkpoint.cursor_value = cursor;
}
async function completeCheckpoint(context: Context, checkpoint: CheckpointRow): Promise<void> {
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints
    SET status='completed',completed_at_utc=?,updated_at_utc=? WHERE tenant_id=? AND id=?`)
    .bind(context.nowUtc, context.nowUtc, context.tenantId, checkpoint.id).run();
  checkpoint.status = 'completed';
}
async function pauseCheckpoint(context: Context, checkpoint: CheckpointRow): Promise<void> {
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints
    SET status='paused',completed_at_utc=NULL,updated_at_utc=? WHERE tenant_id=? AND id=?`)
    .bind(context.nowUtc, context.tenantId, checkpoint.id).run();
  checkpoint.status = 'paused';
}

async function recordIssue(context: Context, input: {
  code: string;
  sourceType: string;
  sourcePublicId: string;
  reasonCode: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
}): Promise<void> {
  const fingerprint = await createRequestFingerprint({
    schemaVersion: 1,
    issueCode: input.code,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
  });
  const issuePublicId = await createDeterministicSourceId(
    'erissue', context.tenantId, input.sourceType, `${input.code}:${input.sourcePublicId}`,
  );
  const details = stableCanonicalJson({ schemaVersion: 1, reasonCode: input.reasonCode });
  await context.db.prepare(`INSERT INTO canonical_processing_issues (
    tenant_id,issue_public_id,migration_run_id,reconciliation_run_id,issue_type,issue_code,
    entity_type,entity_public_id,source_type,source_public_id,fingerprint,severity,status,
    occurrence_count,summary,details_json,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
  ) VALUES (?,?,?,NULL,'migration_mapping',?,?,NULL,?,?,?,?,'open',1,?,?,?,?,?,?)
  ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
    occurrence_count=canonical_processing_issues.occurrence_count+1,
    last_seen_at_utc=excluded.last_seen_at_utc,updated_at_utc=excluded.updated_at_utc`).bind(
    context.tenantId,
    issuePublicId,
    context.runId,
    input.code,
    ENTITY_TYPE,
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

async function sourceMapping(
  db: EmergencyCaseTriageBackfillDatabase,
  tenantId: string,
  entityType: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<string | null> {
  const row = await db.prepare(`SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1`)
    .bind(tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
  return row?.mapping_status === 'mapped' ? row.canonical_public_id : null;
}
async function resolvePatientLink(
  db: EmergencyCaseTriageBackfillDatabase,
  tenantId: string,
  patientId: number | null,
): Promise<string | null> {
  if (patientId == null) return null;
  const direct = await db.prepare(`SELECT patient_link_public_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links WHERE tenant_id=? AND legacy_patient_id=? LIMIT 1`)
    .bind(tenantId, patientId).first<PatientLinkRow>();
  if (direct && !['rejected', 'retired'].includes(direct.link_status) && direct.effective_to_utc == null) {
    return direct.patient_link_public_id;
  }
  return sourceMapping(db, tenantId, 'patient_link', 'legacy_patient', String(patientId));
}
async function resolveEncounter(
  db: EmergencyCaseTriageBackfillDatabase,
  tenantId: string,
  visitId: number | null,
): Promise<string | null> {
  if (visitId == null) return null;
  return sourceMapping(db, tenantId, 'encounter', 'legacy_visit', String(visitId));
}
async function resolvePractitioner(
  db: EmergencyCaseTriageBackfillDatabase,
  tenantId: string,
  userId: number | null,
): Promise<string | null> {
  if (userId == null) return null;
  const practitioner = await sourceMapping(db, tenantId, 'practitioner', 'legacy_user', String(userId));
  if (!practitioner) return null;
  const row = await db.prepare(`SELECT practitioner_public_id,status FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=? LIMIT 1`).bind(tenantId, practitioner).first<PractitionerRow>();
  return row?.status === 'active' ? row.practitioner_public_id : null;
}
async function caseMapping(
  db: EmergencyCaseTriageBackfillDatabase,
  tenantId: string,
  erPatientId: number,
): Promise<string | null> {
  return sourceMapping(db, tenantId, 'emergency_case', 'legacy_er_patient', String(erPatientId));
}
async function caseState(
  db: EmergencyCaseTriageBackfillDatabase,
  tenantId: string,
  emergencyCasePublicId: string,
): Promise<CaseStateRow | null> {
  return db.prepare(`SELECT emergency_case_public_id,current_status,status_version,
    current_triage_assessment_public_id,current_disposition_event_public_id
    FROM canonical_emergency_cases WHERE tenant_id=? AND emergency_case_public_id=? LIMIT 1`)
    .bind(tenantId, emergencyCasePublicId).first<CaseStateRow>();
}
async function triageVersion(
  db: EmergencyCaseTriageBackfillDatabase,
  tenantId: string,
  emergencyCasePublicId: string,
): Promise<number> {
  return Number((await db.prepare(`SELECT MAX(version_number) AS version_number
    FROM canonical_emergency_triage_assessments WHERE tenant_id=? AND emergency_case_public_id=?`)
    .bind(tenantId, emergencyCasePublicId).first<TriageVersionRow>())?.version_number ?? 0);
}
async function dispositionVersion(
  db: EmergencyCaseTriageBackfillDatabase,
  tenantId: string,
  emergencyCasePublicId: string,
): Promise<number> {
  return Number((await db.prepare(`SELECT MAX(disposition_version) AS disposition_version
    FROM canonical_emergency_disposition_events WHERE tenant_id=? AND emergency_case_public_id=?`)
    .bind(tenantId, emergencyCasePublicId).first<DispositionVersionRow>())?.disposition_version ?? 0);
}

async function erRows(context: Context, checkpoint: CheckpointRow): Promise<ErPatientRow[]> {
  if (!(await tableExists(context.db, 'er_patients'))) return [];
  return rows<ErPatientRow>(context.db.prepare(`SELECT id,patient_id,visit_id,discharge_summary_id,
    visit_datetime,referred_by,referred_to,case_type,condition_on_arrival,brought_by,
    relation_with_patient,mode_of_arrival_id,er_status,triage_code,triaged_by,triaged_on,
    is_active,finalized_status,finalized_remarks,finalized_by,finalized_on,is_police_case,
    created_by,created_at,updated_at
    FROM er_patients WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
}

async function processScope(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const requested = context.remaining;
  const records = await erRows(context, checkpoint);
  for (const row of records) {
    const patientLink = await resolvePatientLink(context.db, context.tenantId, row.patient_id);
    const encounter = await resolveEncounter(context.db, context.tenantId, row.visit_id);
    let issue = false;
    if (!patientLink) {
      await recordIssue(context, {
        code: 'ER_PATIENT_SCOPE_UNRESOLVED', sourceType: 'legacy_er_patient',
        sourcePublicId: String(row.id), reasonCode: 'exact_active_patient_link_missing', severity: 'error',
      });
      issue = true;
    }
    if (!encounter) {
      await recordIssue(context, {
        code: 'ER_ENCOUNTER_SCOPE_UNRESOLVED', sourceType: 'legacy_er_patient',
        sourcePublicId: String(row.id), reasonCode: 'exact_legacy_visit_to_canonical_encounter_mapping_missing', severity: 'error',
      });
      issue = true;
    }
    await recordOutcome(context, checkpoint, String(row.id), { mapped: !issue, issue, skipped: issue });
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processCaseArrival(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const requested = context.remaining;
  const records = await erRows(context, checkpoint);
  for (const row of records) {
    let created = false;
    let issue = false;
    const existing = await caseMapping(context.db, context.tenantId, row.id);
    if (!existing) {
      const patientLink = await resolvePatientLink(context.db, context.tenantId, row.patient_id);
      const encounter = await resolveEncounter(context.db, context.tenantId, row.visit_id);
      if (!patientLink || !encounter) {
        issue = true;
      } else {
        const occurredAtUtc = normalizedUtc(row.visit_datetime ?? row.created_at, context.nowUtc);
        const evidence = await createSourceEvidenceSha256({
          table: 'er_patients', id: row.id, patientId: row.patient_id, visitId: row.visit_id,
          modeOfArrivalId: row.mode_of_arrival_id, conditionOnArrival: row.condition_on_arrival,
          policeCase: row.is_police_case, createdAt: row.created_at, updatedAt: row.updated_at,
        });
        const applied = await registerCanonicalEmergencyCase(context.db, {
          tenantId: context.tenantId,
          patientLinkPublicId: patientLink,
          encounterPublicId: encounter,
          emergencyNumberNamespace: 'legacy_er',
          emergencyNumberValue: `ER-${row.id}`,
          initialStatus: 'arrived',
          arrivalAtUtc: occurredAtUtc,
          modeOfArrivalCode: row.mode_of_arrival_id == null ? 'unknown' : `legacy_mode_${row.mode_of_arrival_id}`,
          modeSourceType: row.mode_of_arrival_id == null ? null : 'legacy_er_mode_of_arrival',
          modeSourcePublicId: row.mode_of_arrival_id == null ? null : String(row.mode_of_arrival_id),
          referralSnapshot: row.referred_by?.trim() || null,
          conditionOnArrivalCode: safeCode(row.condition_on_arrival, 'unknown'),
          conditionSnapshot: row.condition_on_arrival?.trim() || null,
          broughtByCategory: safeCode(row.brought_by, 'unknown'),
          broughtByRelationshipCategory: safeCode(row.relation_with_patient, 'unknown'),
          policeCaseIndicator: row.is_police_case === 1,
          observedAtUtc: occurredAtUtc,
          recordedAtUtc: normalizedUtc(row.created_at, occurredAtUtc),
          sourceType: 'legacy_er_patient',
          sourcePublicId: String(row.id),
          sourceTable: 'er_patients',
          sourceEvidenceSha256: evidence,
          actorSystemKey: ACTOR_SYSTEM_KEY,
          idempotencyKey: `cdb127:case:${row.id}`,
          businessDate: businessDate(occurredAtUtc),
        });
        created = applied.status === 'applied';
      }
    }
    await recordOutcome(context, checkpoint, String(row.id), { created, mapped: created, issue, skipped: !created });
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processLifecycle(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const requested = context.remaining;
  const records = await erRows(context, checkpoint);
  for (const row of records) {
    const status = safeCode(row.er_status, 'new');
    let issue = false;
    if (!['new', 'triaged', 'finalized'].includes(status)) {
      await recordIssue(context, {
        code: 'ER_LIFECYCLE_STATUS_UNRECOGNIZED', sourceType: 'legacy_er_lifecycle',
        sourcePublicId: String(row.id), reasonCode: `status_${status}`, severity: 'warning',
      });
      issue = true;
    }
    if (status === 'triaged' && (!row.triage_code || row.triaged_by == null || !row.triaged_on)) {
      await recordIssue(context, {
        code: 'ER_TRIAGE_HISTORY_INCOMPLETE', sourceType: 'legacy_er_lifecycle',
        sourcePublicId: String(row.id), reasonCode: 'mutable_current_triage_missing_code_actor_or_time', severity: 'warning',
      });
      issue = true;
    }
    await recordOutcome(context, checkpoint, String(row.id), { issue, skipped: true });
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processTriage(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const requested = context.remaining;
  const records = await erRows(context, checkpoint);
  for (const row of records) {
    let created = false;
    let issue = false;
    if (row.triage_code?.trim()) {
      const emergencyCasePublicId = await caseMapping(context.db, context.tenantId, row.id);
      const practitioner = await resolvePractitioner(context.db, context.tenantId, row.triaged_by);
      const state = emergencyCasePublicId ? await caseState(context.db, context.tenantId, emergencyCasePublicId) : null;
      if (!state || !practitioner || !row.triaged_on || !['red', 'yellow', 'green'].includes(row.triage_code.trim().toLowerCase())) {
        await recordIssue(context, {
          code: 'ER_TRIAGE_SCOPE_UNRESOLVED', sourceType: 'legacy_er_triage',
          sourcePublicId: String(row.id), reasonCode: 'case_practitioner_time_or_reviewed_acuity_missing', severity: 'error',
        });
        issue = true;
      } else if (!state.current_triage_assessment_public_id) {
        const occurredAtUtc = normalizedUtc(row.triaged_on, context.nowUtc);
        const evidence = await createSourceEvidenceSha256({
          table: 'er_patients', id: row.id, triageCode: row.triage_code,
          triagedBy: row.triaged_by, triagedOn: row.triaged_on, updatedAt: row.updated_at,
        });
        const applied = await recordCanonicalEmergencyTriageAssessment(context.db, {
          tenantId: context.tenantId,
          emergencyCasePublicId,
          expectedStatusVersion: Number(state.status_version),
          expectedTriageVersion: 0,
          acuityCode: row.triage_code.trim().toLowerCase() as 'red' | 'yellow' | 'green',
          legacyAcuityCode: row.triage_code.trim().toLowerCase(),
          triagePractitionerPublicId: practitioner,
          observedAtUtc: occurredAtUtc,
          recordedAtUtc: occurredAtUtc,
          sourceType: 'legacy_er_triage',
          sourcePublicId: String(row.id),
          sourceTable: 'er_patients',
          sourceEvidenceSha256: evidence,
          actorSystemKey: ACTOR_SYSTEM_KEY,
          idempotencyKey: `cdb127:triage:${row.id}`,
          businessDate: businessDate(occurredAtUtc),
        });
        created = applied.status === 'applied';
      }
    }
    await recordOutcome(context, checkpoint, String(row.id), { created, mapped: created, issue, skipped: !created });
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processClassifications(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'er_patient_cases'))) return true;
  const requested = context.remaining;
  const records = await rows<ErCaseRow>(context.db.prepare(`SELECT id,er_patient_id,main_case,sub_case,
    other_case_details,biting_site,datetime_of_bite,biting_animal,first_aid,first_aid_others,
    biting_animal_others,biting_site_others,is_active,created_by,created_at,updated_at
    FROM er_patient_cases WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), requested));
  for (const row of records) {
    let created = false;
    let issue = false;
    const emergencyCasePublicId = await caseMapping(context.db, context.tenantId, row.er_patient_id);
    const state = emergencyCasePublicId ? await caseState(context.db, context.tenantId, emergencyCasePublicId) : null;
    if (!state) {
      issue = true;
    } else {
      const hasBiteEvidence = row.biting_animal != null || row.biting_site != null || row.datetime_of_bite != null;
      if (hasBiteEvidence && (row.biting_animal == null || row.biting_site == null || !row.datetime_of_bite)) {
        await recordIssue(context, {
          code: 'ER_ANIMAL_BITE_EVIDENCE_INCOMPLETE', sourceType: 'legacy_er_case',
          sourcePublicId: String(row.id), reasonCode: 'animal_bite_requires_animal_site_and_time', severity: 'error',
        });
        issue = true;
      } else if (hasBiteEvidence) {
        const occurredAtUtc = normalizedUtc(row.datetime_of_bite, context.nowUtc);
        const recordedAtUtc = normalizedUtc(row.created_at, context.nowUtc);
        const evidence = await createSourceEvidenceSha256({
          table: 'er_patient_cases', id: row.id, erPatientId: row.er_patient_id,
          mainCase: row.main_case, subCase: row.sub_case, bitingSite: row.biting_site,
          bitingAnimal: row.biting_animal, biteTime: row.datetime_of_bite, firstAid: row.first_aid,
          updatedAt: row.updated_at,
        });
        const applied = await recordCanonicalEmergencyCaseClassification(context.db, {
          tenantId: context.tenantId,
          emergencyCasePublicId,
          expectedStatusVersion: Number(state.status_version),
          classificationFamilyPublicId: await createDeterministicSourceId(
            'erclassfam', context.tenantId, 'legacy_er_case', String(row.id),
          ),
          classificationNamespace: 'legacy_er_case',
          classificationCode: 'animal_bite',
          categoryCode: 'animal_bite',
          subcategoryCode: row.sub_case == null ? null : `legacy_subcase_${row.sub_case}`,
          animalCategoryCode: `legacy_animal_${row.biting_animal}`,
          biteSiteCode: `legacy_site_${row.biting_site}`,
          biteAtUtc: occurredAtUtc,
          firstAidCode: row.first_aid == null ? null : `legacy_first_aid_${row.first_aid}`,
          boundedSourceSnapshot: row.other_case_details?.trim() || null,
          occurredAtUtc,
          recordedAtUtc: recordedAtUtc < occurredAtUtc ? occurredAtUtc : recordedAtUtc,
          sourceType: 'legacy_er_case',
          sourcePublicId: String(row.id),
          sourceTable: 'er_patient_cases',
          sourceEvidenceSha256: evidence,
          actorSystemKey: ACTOR_SYSTEM_KEY,
          idempotencyKey: `cdb127:classification:${row.id}`,
          businessDate: businessDate(occurredAtUtc),
        });
        created = applied.status === 'applied';
      } else if (row.main_case != null || row.sub_case != null) {
        await recordIssue(context, {
          code: 'ER_CLASSIFICATION_CODE_UNREVIEWED', sourceType: 'legacy_er_case',
          sourcePublicId: String(row.id), reasonCode: 'numeric_main_or_sub_case_has_no_reviewed_code_contract', severity: 'warning',
        });
        issue = true;
      }
    }
    await recordOutcome(context, checkpoint, String(row.id), { created, mapped: created, issue, skipped: !created });
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function advanceToDispositionPending(
  context: Context,
  row: ErPatientRow,
  emergencyCasePublicId: string,
  practitioner: string,
): Promise<CaseStateRow> {
  let state = await caseState(context.db, context.tenantId, emergencyCasePublicId);
  if (!state) throw new Error('canonical emergency case not found during disposition backfill');
  const occurredAtUtc = normalizedUtc(row.finalized_on ?? row.updated_at, context.nowUtc);
  const evidence = await createSourceEvidenceSha256({ table: 'er_patients', id: row.id, phase: 'disposition_preparation' });
  if (['arrived', 'awaiting_triage', 'triaged', 'observation'].includes(state.current_status)) {
    const applied = await transitionCanonicalEmergencyCase(context.db, {
      tenantId: context.tenantId,
      emergencyCasePublicId,
      expectedStatusVersion: Number(state.status_version),
      toStatus: 'care_in_progress',
      actorPractitionerPublicId: practitioner,
      reasonCode: 'legacy_emergency_care_reconstructed',
      occurredAtUtc,
      recordedAtUtc: occurredAtUtc,
      sourceType: 'legacy_er_lifecycle',
      sourcePublicId: `${row.id}:care`,
      sourceTable: 'er_patients',
      sourceEvidenceSha256: evidence,
      actorSystemKey: ACTOR_SYSTEM_KEY,
      idempotencyKey: `cdb127:lifecycle:care:${row.id}`,
      businessDate: businessDate(occurredAtUtc),
    });
    if (applied.status === 'applied' || applied.status === 'replayed') {
      state = await caseState(context.db, context.tenantId, emergencyCasePublicId);
    }
  }
  if (state?.current_status === 'care_in_progress') {
    await transitionCanonicalEmergencyCase(context.db, {
      tenantId: context.tenantId,
      emergencyCasePublicId,
      expectedStatusVersion: Number(state.status_version),
      toStatus: 'disposition_pending',
      actorPractitionerPublicId: practitioner,
      reasonCode: 'legacy_finalization_pending',
      occurredAtUtc,
      recordedAtUtc: occurredAtUtc,
      sourceType: 'legacy_er_lifecycle',
      sourcePublicId: `${row.id}:disposition_pending`,
      sourceTable: 'er_patients',
      sourceEvidenceSha256: evidence,
      actorSystemKey: ACTOR_SYSTEM_KEY,
      idempotencyKey: `cdb127:lifecycle:pending:${row.id}`,
      businessDate: businessDate(occurredAtUtc),
    });
    state = await caseState(context.db, context.tenantId, emergencyCasePublicId);
  }
  if (!state) throw new Error('canonical emergency case disappeared during disposition backfill');
  return state;
}

async function processDispositions(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const requested = context.remaining;
  const records = await erRows(context, checkpoint);
  for (const row of records) {
    let created = false;
    let issue = false;
    const emergencyCasePublicId = await caseMapping(context.db, context.tenantId, row.id);
    let state = emergencyCasePublicId ? await caseState(context.db, context.tenantId, emergencyCasePublicId) : null;
    const practitioner = await resolvePractitioner(
      context.db, context.tenantId, row.finalized_by ?? row.triaged_by ?? row.created_by,
    );
    if (!state) {
      issue = true;
    } else if (row.is_active === 0 && state.current_status !== 'entered_in_error') {
      if (!practitioner) {
        await recordIssue(context, {
          code: 'ER_ERROR_ACTOR_UNRESOLVED', sourceType: 'legacy_er_disposition',
          sourcePublicId: String(row.id), reasonCode: 'entered_in_error_requires_exact_practitioner', severity: 'error',
        });
        issue = true;
      } else {
        const occurredAtUtc = normalizedUtc(row.updated_at ?? row.finalized_on, context.nowUtc);
        const evidence = await createSourceEvidenceSha256({ table: 'er_patients', id: row.id, isActive: row.is_active });
        const applied = await enterCanonicalEmergencyCaseInError(context.db, {
          tenantId: context.tenantId,
          emergencyCasePublicId,
          expectedStatusVersion: Number(state.status_version),
          expectedDispositionVersion: await dispositionVersion(context.db, context.tenantId, emergencyCasePublicId),
          actorPractitionerPublicId: practitioner,
          terminalEvidenceCode: 'legacy_er_inactive',
          reasonCode: 'legacy_record_inactive',
          occurredAtUtc,
          recordedAtUtc: occurredAtUtc,
          sourceType: 'legacy_er_disposition',
          sourcePublicId: `${row.id}:error`,
          sourceTable: 'er_patients',
          sourceEvidenceSha256: evidence,
          actorSystemKey: ACTOR_SYSTEM_KEY,
          idempotencyKey: `cdb127:disposition:error:${row.id}`,
          businessDate: businessDate(occurredAtUtc),
        });
        created = applied.status === 'applied';
      }
    } else if (safeCode(row.er_status, '') === 'finalized' && row.finalized_status?.trim()) {
      if (!practitioner) {
        await recordIssue(context, {
          code: 'ER_DISPOSITION_ACTOR_UNRESOLVED', sourceType: 'legacy_er_disposition',
          sourcePublicId: String(row.id), reasonCode: 'finalized_disposition_requires_exact_practitioner', severity: 'error',
        });
        issue = true;
      } else if (!['admitted', 'discharged', 'transferred', 'lama', 'dor', 'death'].includes(row.finalized_status.trim().toLowerCase())) {
        await recordIssue(context, {
          code: 'ER_DISPOSITION_CODE_UNREVIEWED', sourceType: 'legacy_er_disposition',
          sourcePublicId: String(row.id), reasonCode: `status_${safeCode(row.finalized_status, 'unknown')}`, severity: 'error',
        });
        issue = true;
      } else if (!['admitted', 'discharged', 'transferred', 'lama', 'dor', 'death', 'entered_in_error'].includes(state.current_status)) {
        state = await advanceToDispositionPending(context, row, emergencyCasePublicId!, practitioner);
        const dispositionCode = row.finalized_status.trim().toLowerCase() as
          'admitted' | 'discharged' | 'transferred' | 'lama' | 'dor' | 'death';
        const canonicalAdmissionPublicId = dispositionCode === 'admitted'
          ? await sourceMapping(context.db, context.tenantId, 'admission', 'legacy_er_patient_admission', String(row.id))
          : null;
        let document: DocumentVersionRow | null = null;
        if (dispositionCode === 'discharged' && row.discharge_summary_id != null) {
          const versionPublicId = await sourceMapping(
            context.db, context.tenantId, 'clinical_document_version',
            'legacy_er_discharge_summary', String(row.discharge_summary_id),
          );
          if (versionPublicId) {
            document = await context.db.prepare(`SELECT document_public_id,version_public_id,content_sha256,version_kind
              FROM canonical_clinical_document_versions WHERE tenant_id=? AND version_public_id=? LIMIT 1`)
              .bind(context.tenantId, versionPublicId).first<DocumentVersionRow>();
          }
        }
        const transferDestination = dispositionCode === 'transferred'
          ? await sourceMapping(context.db, context.tenantId, 'external_organization', 'legacy_er_transfer_destination', String(row.id))
          : null;
        if (dispositionCode === 'admitted' && !canonicalAdmissionPublicId) {
          await recordIssue(context, {
            code: 'ER_ADMISSION_LINK_UNRESOLVED', sourceType: 'legacy_er_disposition',
            sourcePublicId: String(row.id), reasonCode: 'exact_canonical_admission_mapping_missing', severity: 'error',
          });
          issue = true;
        } else if (dispositionCode === 'discharged' && row.discharge_summary_id != null && !document) {
          await recordIssue(context, {
            code: 'ER_DISCHARGE_DOCUMENT_UNRESOLVED', sourceType: 'legacy_er_disposition',
            sourcePublicId: String(row.id), reasonCode: 'exact_signed_discharge_document_version_missing', severity: 'error',
          });
          issue = true;
        } else if (dispositionCode === 'transferred' && !transferDestination) {
          await recordIssue(context, {
            code: 'ER_TRANSFER_DESTINATION_UNRESOLVED', sourceType: 'legacy_er_disposition',
            sourcePublicId: String(row.id), reasonCode: 'exact_receiving_organization_mapping_missing', severity: 'error',
          });
          issue = true;
        } else {
          const occurredAtUtc = normalizedUtc(row.finalized_on, context.nowUtc);
          const evidence = await createSourceEvidenceSha256({
            table: 'er_patients', id: row.id, finalizedStatus: dispositionCode,
            finalizedBy: row.finalized_by, finalizedOn: row.finalized_on,
            dischargeSummaryId: row.discharge_summary_id, updatedAt: row.updated_at,
          });
          const applied = await recordCanonicalEmergencyDisposition(context.db, {
            tenantId: context.tenantId,
            emergencyCasePublicId: emergencyCasePublicId!,
            expectedStatusVersion: Number(state.status_version),
            expectedDispositionVersion: await dispositionVersion(context.db, context.tenantId, emergencyCasePublicId!),
            dispositionCode,
            actorPractitionerPublicId: practitioner,
            canonicalAdmissionPublicId,
            dischargeDocumentPublicId: document?.document_public_id ?? null,
            dischargeDocumentVersionPublicId: document?.version_public_id ?? null,
            dischargeDocumentContentSha256: document?.content_sha256 ?? null,
            receivingOrganizationSourceType: transferDestination ? 'external_organization' : null,
            receivingOrganizationSourcePublicId: transferDestination,
            terminalEvidenceCode: ['lama', 'dor', 'death'].includes(dispositionCode)
              ? `legacy_${dispositionCode}` : null,
            reasonCode: `legacy_${dispositionCode}`,
            remarksSnapshot: row.finalized_remarks?.trim() || null,
            occurredAtUtc,
            recordedAtUtc: occurredAtUtc,
            sourceType: 'legacy_er_disposition',
            sourcePublicId: String(row.id),
            sourceTable: 'er_patients',
            sourceEvidenceSha256: evidence,
            actorSystemKey: ACTOR_SYSTEM_KEY,
            idempotencyKey: `cdb127:disposition:${row.id}`,
            businessDate: businessDate(occurredAtUtc),
          });
          created = applied.status === 'applied';
        }
      }
    }
    await recordOutcome(context, checkpoint, String(row.id), { created, mapped: created, issue, skipped: !created });
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processExternalLinks(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const sources = ['er_discharge_summaries', 'er_file_uploads'] as const;
  const rawCursor = checkpoint.cursor_value ?? '0:0';
  let [tableIndex, lastId] = rawCursor.split(':').map((value) => Number(value));
  if (!Number.isSafeInteger(tableIndex) || tableIndex < 0) tableIndex = 0;
  if (!Number.isSafeInteger(lastId) || lastId < 0) lastId = 0;
  for (; tableIndex < sources.length; tableIndex += 1) {
    const table = sources[tableIndex];
    if (!(await tableExists(context.db, table))) {
      lastId = 0;
      await setCursor(context, checkpoint, `${tableIndex + 1}:0`);
      continue;
    }
    const requested = context.remaining;
    if (table === 'er_discharge_summaries') {
      const records = await rows<ErSummaryRow>(context.db.prepare(`SELECT id,patient_id,visit_id,created_at,updated_at
        FROM er_discharge_summaries WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
        .bind(context.tenantId, lastId, requested));
      for (const row of records) {
        lastId = row.id;
        const mapped = await sourceMapping(
          context.db, context.tenantId, 'clinical_document_version',
          'legacy_er_discharge_summary', String(row.id),
        );
        if (!mapped) {
          await recordIssue(context, {
            code: 'ER_DISCHARGE_DOCUMENT_MAPPING_MISSING', sourceType: 'legacy_er_discharge_summary',
            sourcePublicId: String(row.id), reasonCode: 'map_into_existing_signed_clinical_document_authority', severity: 'warning',
          });
        }
        await recordOutcome(context, checkpoint, `${tableIndex}:${row.id}`, { mapped: Boolean(mapped), issue: !mapped, skipped: true });
        if (context.remaining === 0) return false;
      }
      if (records.length === requested) return false;
    } else {
      const records = await rows<ErFileRow>(context.db.prepare(`SELECT id,er_patient_id,patient_id,file_type,file_url,created_at
        FROM er_file_uploads WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
        .bind(context.tenantId, lastId, requested));
      for (const row of records) {
        lastId = row.id;
        const mapped = await sourceMapping(
          context.db, context.tenantId, 'clinical_document_attachment', 'legacy_er_file', String(row.id),
        );
        if (!mapped) {
          await recordIssue(context, {
            code: 'ER_ATTACHMENT_MAPPING_MISSING', sourceType: 'legacy_er_file',
            sourcePublicId: String(row.id), reasonCode: 'exact_patient_encounter_content_hash_attachment_mapping_missing', severity: 'warning',
          });
        }
        await recordOutcome(context, checkpoint, `${tableIndex}:${row.id}`, { mapped: Boolean(mapped), issue: !mapped, skipped: true });
        if (context.remaining === 0) return false;
      }
      if (records.length === requested) return false;
    }
    lastId = 0;
    await setCursor(context, checkpoint, `${tableIndex + 1}:0`);
  }
  return true;
}

async function processProjectionDisposition(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (checkpoint.cursor_value === 'completed') return true;
  if (context.remaining === 0) return false;
  const emergencyVisitsExists = await tableExists(context.db, 'emergency_visits');
  if (!emergencyVisitsExists) {
    await recordIssue(context, {
      code: 'ER_STALE_EMERGENCY_VISITS_PROJECTION', sourceType: 'legacy_emergency_projection',
      sourcePublicId: 'emergency_visits', reasonCode: 'quality_kpi_reader_references_missing_repository_table', severity: 'warning',
    });
  }
  const arrivalModeCount = await count(context.db, `SELECT COUNT(*) AS count FROM er_mode_of_arrival WHERE tenant_id=?`, [context.tenantId]);
  await recordOutcome(context, checkpoint, 'completed', {
    issue: !emergencyVisitsExists,
    skipped: true,
    mapped: arrivalModeCount >= 0,
  });
  return true;
}

export const EMERGENCY_BACKFILL_PARTITIONS: readonly Partition[] = [
  { sourceType: 'emergency_scope', partitionKey: '01', process: processScope },
  { sourceType: 'emergency_case_arrival', partitionKey: '02', process: processCaseArrival },
  { sourceType: 'emergency_lifecycle', partitionKey: '03', process: processLifecycle },
  { sourceType: 'emergency_triage', partitionKey: '04', process: processTriage },
  { sourceType: 'emergency_classification', partitionKey: '05', process: processClassifications },
  { sourceType: 'emergency_disposition', partitionKey: '06', process: processDispositions },
  { sourceType: 'emergency_external_authority_links', partitionKey: '07', process: processExternalLinks },
  { sourceType: 'emergency_projection_disposition', partitionKey: '08', process: processProjectionDisposition },
];

export async function backfillCanonicalEmergencyCaseTriage(
  db: EmergencyCaseTriageBackfillDatabase,
  options: EmergencyCaseTriageBackfillOptions,
): Promise<EmergencyCaseTriageBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const nowUtc = normalizedUtc(options.nowUtc, options.nowUtc);
  if (nowUtc !== options.nowUtc) throw new RangeError('nowUtc must be a normalized UTC ISO timestamp');
  const starting = await captureCounts(db, tenantId);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  const context: Context = {
    db,
    tenantId,
    runId: run.id,
    runPublicId,
    nowUtc,
    remaining: sourceLimit(options.maxSourceRecords),
    scanned: 0,
    skipped: 0,
  };

  for (const partition of EMERGENCY_BACKFILL_PARTITIONS) {
    const checkpoint = await ensureCheckpoint(context, partition);
    if (checkpoint.status === 'completed') continue;
    if (context.remaining === 0) {
      await pauseCheckpoint(context, checkpoint);
      return resultFromDelta(context, starting, false);
    }
    await markRunning(context, checkpoint);
    const completed = await partition.process(context, checkpoint);
    if (completed) await completeCheckpoint(context, checkpoint);
    else {
      await pauseCheckpoint(context, checkpoint);
      await db.prepare(`UPDATE canonical_migration_runs
        SET status='running',completed_at_utc=NULL,updated_at_utc=? WHERE tenant_id=? AND id=?`)
        .bind(nowUtc, tenantId, run.id).run();
      return resultFromDelta(context, starting, false);
    }
  }

  const incomplete = await count(db, `SELECT COUNT(*) AS count FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND status!='completed'`, [tenantId, run.id]);
  const completed = incomplete === 0;
  const result = await resultFromDelta(context, starting, completed);
  if (completed) {
    await db.prepare(`UPDATE canonical_migration_runs
      SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=?
      WHERE tenant_id=? AND id=?`).bind(
      nowUtc,
      stableCanonicalJson({ schemaVersion: 1, partitionCount: EMERGENCY_BACKFILL_PARTITIONS.length, counts: result.counts }),
      nowUtc,
      tenantId,
      run.id,
    ).run();
  }
  return result;
}
