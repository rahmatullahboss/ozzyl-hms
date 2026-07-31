import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  attachCanonicalLabAnalyzerEvidence,
  collectCanonicalLabSpecimen,
  createCanonicalLabResultDraft,
  receiveCanonicalLabSpecimen,
  registerCanonicalLabSpecimen,
  rejectCanonicalLabSpecimen,
  validateAndPublishCanonicalLabResultVersion,
  verifyCanonicalLabResultVersion,
  type CanonicalLabObservationInput,
} from '../../src/lib/canonical/commands/manage-lab-result-specimen';
import { createRequestFingerprint, stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface LabResultSpecimenBackfillPreparedStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): LabResultSpecimenBackfillPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface LabResultSpecimenBackfillDatabase extends CanonicalBatchDatabase {
  prepare(sql: string): LabResultSpecimenBackfillPreparedStatement;
  batch(statements: LabResultSpecimenBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface LabResultSpecimenBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc: string;
  maxSourceRecords?: number;
}

export interface LabResultSpecimenBackfillCounts {
  scanned: number;
  specimensCreated: number;
  specimenServiceLinksCreated: number;
  specimenEventsCreated: number;
  resultSetsCreated: number;
  resultVersionsCreated: number;
  observationsCreated: number;
  resultStatusEventsCreated: number;
  analyzerEvidenceCreated: number;
  mappingsCreated: number;
  skipped: number;
  issues: number;
}

export interface LabResultSpecimenBackfillResult {
  completed: boolean;
  counts: LabResultSpecimenBackfillCounts;
}

interface MigrationRunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface PractitionerRow { practitioner_public_id: string; status: string }
interface SpecimenStateRow { current_status: string; status_version: number }
interface ResultStateRow {
  current_version_public_id: string | null;
  current_status: 'draft' | 'verified' | 'validated' | 'published' | 'retracted' | 'entered_in_error';
  status_version: number;
}
interface VersionRow { version_public_id: string; content_sha256: string; version_status: string }

interface StartingCounts {
  specimens: number;
  specimenLinks: number;
  specimenEvents: number;
  resultSets: number;
  versions: number;
  observations: number;
  resultEvents: number;
  analyzerEvidence: number;
  mappings: number;
  issues: number;
}

interface Context {
  db: LabResultSpecimenBackfillDatabase;
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
interface ProcessOutcome { created?: boolean; mapped?: boolean; skipped?: boolean; issue?: boolean }

interface OrderItemRow {
  id: number;
  patient_id: number;
  visit_id: number;
  test_id: number;
  specimen_id: number | null;
  result: string | null;
  result_numeric: string | null;
  result_unit: string | null;
  result_status: string | null;
  is_active: number;
}
interface SpecimenRow {
  id: number;
  patient_id: number;
  accession_number: string;
  barcode: string;
  specimen_type: string;
  container_type: string | null;
  parent_specimen_id: number | null;
  collected_by: number | null;
  created_at: string | null;
  order_item_id: number | null;
  visit_id: number | null;
  test_id: number | null;
}
interface SpecimenItemRow { id: number; specimen_id: number; order_item_id: number; test_id: number }
interface SpecimenEventRow {
  id: number;
  specimen_id: number;
  event_type: string;
  from_status: string | null;
  to_status: string;
  performed_by: number | null;
  event_at: string | null;
  location_id: number | null;
  transport_condition: string | null;
  reason_code: string | null;
}
interface ResultRow {
  id: number;
  order_item_id: number;
  test_id: number;
  patient_id: number;
  visit_id: number;
  specimen_id: number;
  result_value: string | null;
  result_numeric: string | null;
  unit: string | null;
  reference_low: string | null;
  reference_high: string | null;
  reference_text: string | null;
  abnormal_flag: string | null;
  status: string;
  reported_by: number;
  reported_at: string | null;
  created_at: string | null;
}
interface AuditRow { id: number; result_id: number; order_item_id: number; version_no: number }
interface CorrectionRow { id: number; result_id: number; corrected_by: number; corrected_at: string }
interface ReportRow {
  id: number;
  order_item_id: number;
  report_status: string;
  reviewer_id: number | null;
  validator_id: number | null;
  verified_at: string | null;
  validated_at: string | null;
  published_at: string | null;
  delivered_at: string | null;
  retracted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}
interface AnalyzerRow {
  id: number;
  source_public_id: string;
  observation_index: number;
  machine_id: number | null;
  protocol: string | null;
  payload_sha256: string;
  qc_state: 'pending' | 'passed' | 'failed' | 'not_applicable';
  validation_state: 'pending' | 'passed' | 'failed' | 'overridden';
  match_state: 'unmatched' | 'candidate' | 'matched' | 'ambiguous' | 'rejected';
  disposition: 'staged' | 'accepted' | 'rejected' | 'superseded' | 'collision';
  accepted_result_id: number | null;
  conversion_factor: string | null;
  accepted_at: string | null;
  created_at: string | null;
  message_public_id: string | null;
  ingestion_payload_sha256: string | null;
  result_order_item_id: number | null;
}

const MIGRATION_NAME = 'CDB-125D lab result specimen backfill';
const ENTITY_TYPE = 'lab_result_specimen';

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
function businessDate(timestamp: string): string { return timestamp.slice(0, 10); }
function cursorNumber(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/^[A-Z]:/, ''));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
async function rows<T>(statement: LabResultSpecimenBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}
async function count(db: LabResultSpecimenBackfillDatabase, sql: string, values: readonly unknown[] = []): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}
async function tableExists(db: LabResultSpecimenBackfillDatabase, table: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=? LIMIT 1`).bind(table).first()) != null;
}

async function captureCounts(db: LabResultSpecimenBackfillDatabase, tenantId: string): Promise<StartingCounts> {
  return {
    specimens: await count(db, `SELECT COUNT(*) AS count FROM canonical_lab_specimens WHERE tenant_id=?`, [tenantId]),
    specimenLinks: await count(db, `SELECT COUNT(*) AS count FROM canonical_lab_specimen_service_items WHERE tenant_id=?`, [tenantId]),
    specimenEvents: await count(db, `SELECT COUNT(*) AS count FROM canonical_lab_specimen_status_events WHERE tenant_id=?`, [tenantId]),
    resultSets: await count(db, `SELECT COUNT(*) AS count FROM canonical_lab_result_sets WHERE tenant_id=?`, [tenantId]),
    versions: await count(db, `SELECT COUNT(*) AS count FROM canonical_lab_result_versions WHERE tenant_id=?`, [tenantId]),
    observations: await count(db, `SELECT COUNT(*) AS count FROM canonical_lab_result_observations WHERE tenant_id=?`, [tenantId]),
    resultEvents: await count(db, `SELECT COUNT(*) AS count FROM canonical_lab_result_status_events WHERE tenant_id=?`, [tenantId]),
    analyzerEvidence: await count(db, `SELECT COUNT(*) AS count FROM canonical_lab_analyzer_evidence WHERE tenant_id=?`, [tenantId]),
    mappings: await count(db, `SELECT COUNT(*) AS count FROM canonical_source_mappings WHERE tenant_id=? AND entity_type IN ('lab_specimen','lab_result_set','lab_result_observation','lab_analyzer_evidence')`, [tenantId]),
    issues: await count(db, `SELECT COUNT(*) AS count FROM canonical_processing_issues WHERE tenant_id=? AND entity_type=?`, [tenantId, ENTITY_TYPE]),
  };
}
async function resultFromDelta(context: Context, starting: StartingCounts, completed: boolean): Promise<LabResultSpecimenBackfillResult> {
  const ending = await captureCounts(context.db, context.tenantId);
  return {
    completed,
    counts: {
      scanned: context.scanned,
      specimensCreated: ending.specimens - starting.specimens,
      specimenServiceLinksCreated: ending.specimenLinks - starting.specimenLinks,
      specimenEventsCreated: ending.specimenEvents - starting.specimenEvents,
      resultSetsCreated: ending.resultSets - starting.resultSets,
      resultVersionsCreated: ending.versions - starting.versions,
      observationsCreated: ending.observations - starting.observations,
      resultStatusEventsCreated: ending.resultEvents - starting.resultEvents,
      analyzerEvidenceCreated: ending.analyzerEvidence - starting.analyzerEvidence,
      mappingsCreated: ending.mappings - starting.mappings,
      skipped: context.skipped,
      issues: ending.issues - starting.issues,
    },
  };
}

async function ensureRun(db: LabResultSpecimenBackfillDatabase, tenantId: string, runPublicId: string, nowUtc: string): Promise<MigrationRunRow> {
  let run = await db.prepare(`SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1`).bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (run) return run;
  await db.prepare(`INSERT INTO canonical_migration_runs (tenant_id,run_public_id,migration_name,migration_kind,status,started_at_utc,created_at_utc,updated_at_utc) VALUES (?,?,?,'backfill','running',?,?,?)`)
    .bind(tenantId, runPublicId, MIGRATION_NAME, nowUtc, nowUtc, nowUtc).run();
  run = await db.prepare(`SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1`).bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!run) throw new Error('failed to create lab result specimen backfill run');
  return run;
}
async function ensureCheckpoint(context: Context, partition: Partition): Promise<CheckpointRow> {
  let checkpoint = await context.db.prepare(`SELECT id,cursor_value,status FROM canonical_backfill_checkpoints WHERE tenant_id=? AND migration_run_id=? AND entity_type=? AND source_type=? AND partition_key=? LIMIT 1`)
    .bind(context.tenantId, context.runId, ENTITY_TYPE, partition.sourceType, partition.partitionKey).first<CheckpointRow>();
  if (checkpoint) return checkpoint;
  const checkpointPublicId = await createDeterministicSourceId('labcp', context.tenantId, partition.sourceType, `${context.runPublicId}:${partition.partitionKey}`);
  await context.db.prepare(`INSERT INTO canonical_backfill_checkpoints (tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,partition_key,status,started_at_utc,created_at_utc,updated_at_utc) VALUES (?,?,?,?,?,?,'pending',?,?,?)`)
    .bind(context.tenantId, checkpointPublicId, context.runId, ENTITY_TYPE, partition.sourceType, partition.partitionKey, context.nowUtc, context.nowUtc, context.nowUtc).run();
  checkpoint = await context.db.prepare(`SELECT id,cursor_value,status FROM canonical_backfill_checkpoints WHERE tenant_id=? AND checkpoint_public_id=? LIMIT 1`)
    .bind(context.tenantId, checkpointPublicId).first<CheckpointRow>();
  if (!checkpoint) throw new Error('failed to create lab result specimen checkpoint');
  return checkpoint;
}
async function markCheckpointRunning(context: Context, checkpoint: CheckpointRow): Promise<void> {
  if (checkpoint.status === 'completed') return;
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints SET status='running',completed_at_utc=NULL,updated_at_utc=? WHERE tenant_id=? AND id=?`)
    .bind(context.nowUtc, context.tenantId, checkpoint.id).run();
}
async function recordCheckpointOutcome(context: Context, checkpoint: CheckpointRow, cursor: string, outcome: ProcessOutcome): Promise<void> {
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints SET cursor_value=?,scanned_count=scanned_count+1,created_count=created_count+?,mapped_count=mapped_count+?,skipped_count=skipped_count+?,exception_count=exception_count+?,updated_at_utc=? WHERE tenant_id=? AND id=?`)
    .bind(cursor, outcome.created ? 1 : 0, outcome.mapped ? 1 : 0, outcome.skipped ? 1 : 0, outcome.issue ? 1 : 0, context.nowUtc, context.tenantId, checkpoint.id).run();
  checkpoint.cursor_value = cursor;
  context.scanned += 1;
  context.remaining -= 1;
  if (outcome.skipped) context.skipped += 1;
}
async function setCheckpointCursor(context: Context, checkpoint: CheckpointRow, cursor: string): Promise<void> {
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints SET cursor_value=?,updated_at_utc=? WHERE tenant_id=? AND id=?`)
    .bind(cursor, context.nowUtc, context.tenantId, checkpoint.id).run();
  checkpoint.cursor_value = cursor;
}
async function completeCheckpoint(context: Context, checkpoint: CheckpointRow): Promise<void> {
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints SET status='completed',completed_at_utc=?,updated_at_utc=? WHERE tenant_id=? AND id=?`)
    .bind(context.nowUtc, context.nowUtc, context.tenantId, checkpoint.id).run();
  checkpoint.status = 'completed';
}
async function pauseCheckpoint(context: Context, checkpoint: CheckpointRow): Promise<void> {
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints SET status='paused',completed_at_utc=NULL,updated_at_utc=? WHERE tenant_id=? AND id=?`)
    .bind(context.nowUtc, context.tenantId, checkpoint.id).run();
  checkpoint.status = 'paused';
}

async function recordIssue(context: Context, input: {
  code: string; sourceType: string; sourcePublicId: string; reasonCode: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
}): Promise<void> {
  const fingerprint = await createRequestFingerprint({ schemaVersion: 1, issueCode: input.code, sourceType: input.sourceType, sourcePublicId: input.sourcePublicId });
  const issuePublicId = await createDeterministicSourceId('labissue', context.tenantId, input.sourceType, `${input.code}:${input.sourcePublicId}`);
  const details = stableCanonicalJson({ schemaVersion: 1, reasonCode: input.reasonCode });
  await context.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,reconciliation_run_id,issue_type,
      issue_code,entity_type,entity_public_id,source_type,source_public_id,fingerprint,
      severity,status,occurrence_count,summary,details_json,first_seen_at_utc,
      last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,NULL,'migration_mapping',?,?,NULL,?,?,?,?,'open',1,?,?,?, ?,?,?)
    ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,updated_at_utc=excluded.updated_at_utc
  `).bind(
    context.tenantId, issuePublicId, context.runId, input.code, ENTITY_TYPE,
    input.sourceType, input.sourcePublicId, fingerprint, input.severity ?? 'warning',
    input.code, details, context.nowUtc, context.nowUtc, context.nowUtc, context.nowUtc,
  ).run();
}
async function sourceMapping(db: LabResultSpecimenBackfillDatabase, tenantId: string, entityType: string, sourceType: string, sourcePublicId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT canonical_public_id,mapping_status FROM canonical_source_mappings WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1`)
    .bind(tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
  return row?.mapping_status === 'mapped' ? row.canonical_public_id : null;
}
async function resolvePatientLink(db: LabResultSpecimenBackfillDatabase, tenantId: string, patientId: number): Promise<string | null> {
  const direct = await db.prepare(`SELECT patient_link_public_id,link_status,effective_to_utc FROM canonical_tenant_patient_links WHERE tenant_id=? AND legacy_patient_id=? LIMIT 1`)
    .bind(tenantId, patientId).first<PatientLinkRow>();
  if (direct && !['rejected', 'retired'].includes(direct.link_status) && direct.effective_to_utc == null) return direct.patient_link_public_id;
  return sourceMapping(db, tenantId, 'patient_link', 'legacy_patient', String(patientId));
}
async function resolveEncounter(db: LabResultSpecimenBackfillDatabase, tenantId: string, visitId: number): Promise<string | null> {
  return sourceMapping(db, tenantId, 'encounter', 'legacy_visit', String(visitId));
}
async function resolvePractitioner(db: LabResultSpecimenBackfillDatabase, tenantId: string, userId: number | null): Promise<string | null> {
  if (userId == null) return null;
  const row = await db.prepare(`SELECT p.practitioner_public_id,p.status FROM canonical_practitioner_user_links l JOIN canonical_practitioners p ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id WHERE l.tenant_id=? AND l.legacy_user_id=? AND l.link_status='active' LIMIT 1`)
    .bind(tenantId, userId).first<PractitionerRow>();
  return row?.status === 'active' ? row.practitioner_public_id : null;
}
function observationMappingStatement(db: LabResultSpecimenBackfillDatabase, input: {
  tenantId: string; observationPublicId: string; resultId: number; evidenceSha256: string; occurredAtUtc: string;
}): LabResultSpecimenBackfillPreparedStatement {
  return db.prepare(`INSERT INTO canonical_source_mappings (tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,created_at_utc,updated_at_utc) VALUES (?,'lab_result_observation',?,'legacy_lab_result',?,'lab_results','mapped',1,NULL,?,?,?)`)
    .bind(input.tenantId, input.observationPublicId, String(input.resultId), input.evidenceSha256, input.occurredAtUtc, input.occurredAtUtc);
}

async function processRequestMappings(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'lab_order_items'))) return true;
  const records = await rows<OrderItemRow>(context.db.prepare(`SELECT id,patient_id,visit_id,test_id,specimen_id,result,result_numeric,result_unit,result_status,is_active FROM lab_order_items WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
  for (const row of records) {
    const request = await sourceMapping(context.db, context.tenantId, 'service_request', 'legacy_lab_order_item', String(row.id));
    if (!request) {
      await recordIssue(context, { code: 'LAB_REQUEST_MAPPING_MISSING', sourceType: 'legacy_lab_order_item', sourcePublicId: String(row.id), reasonCode: 'exact_canonical_service_request_mapping_missing' });
      await recordCheckpointOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
    } else {
      await recordCheckpointOutcome(context, checkpoint, String(row.id), { skipped: true });
    }
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processSpecimenIdentity(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'lab_specimens'))) return true;
  const records = await rows<SpecimenRow>(context.db.prepare(`
    SELECT s.id,s.patient_id,s.accession_number,s.barcode,s.specimen_type,s.container_type,
           s.parent_specimen_id,s.collected_by,s.created_at,
           (SELECT si.order_item_id FROM lab_specimen_items si WHERE si.tenant_id=s.tenant_id AND si.specimen_id=s.id ORDER BY si.id LIMIT 1) AS order_item_id,
           (SELECT oi.visit_id FROM lab_specimen_items si JOIN lab_order_items oi ON oi.tenant_id=si.tenant_id AND oi.id=si.order_item_id WHERE si.tenant_id=s.tenant_id AND si.specimen_id=s.id ORDER BY si.id LIMIT 1) AS visit_id,
           (SELECT oi.test_id FROM lab_specimen_items si JOIN lab_order_items oi ON oi.tenant_id=si.tenant_id AND oi.id=si.order_item_id WHERE si.tenant_id=s.tenant_id AND si.specimen_id=s.id ORDER BY si.id LIMIT 1) AS test_id
    FROM lab_specimens s WHERE s.tenant_id=? AND s.id>? ORDER BY s.id LIMIT ?
  `).bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
  for (const row of records) {
    const sourcePublicId = String(row.id);
    if (await sourceMapping(context.db, context.tenantId, 'lab_specimen', 'legacy_lab_specimen', sourcePublicId)) {
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const patientLinkPublicId = await resolvePatientLink(context.db, context.tenantId, row.patient_id);
    const encounterPublicId = row.visit_id == null ? null : await resolveEncounter(context.db, context.tenantId, row.visit_id);
    const requestPublicId = row.order_item_id == null ? null : await sourceMapping(context.db, context.tenantId, 'service_request', 'legacy_lab_order_item', String(row.order_item_id));
    const eventPublicId = row.order_item_id == null ? null : await sourceMapping(context.db, context.tenantId, 'service_event', 'legacy_lab_order_item_event', String(row.order_item_id));
    const servicePublicId = requestPublicId == null ? null : (await context.db.prepare(`SELECT service_public_id FROM canonical_service_requests WHERE tenant_id=? AND request_public_id=? LIMIT 1`).bind(context.tenantId, requestPublicId).first<{ service_public_id: string }>())?.service_public_id ?? null;
    const parentSpecimenPublicId = row.parent_specimen_id == null ? null : await sourceMapping(context.db, context.tenantId, 'lab_specimen', 'legacy_lab_specimen', String(row.parent_specimen_id));
    if (!patientLinkPublicId || !encounterPublicId || !requestPublicId || !servicePublicId || (row.parent_specimen_id != null && !parentSpecimenPublicId)) {
      await recordIssue(context, { code: 'LAB_SPECIMEN_SCOPE_MAPPING_MISSING', sourceType: 'legacy_lab_specimen', sourcePublicId, reasonCode: 'patient_encounter_request_service_or_parent_mapping_missing' });
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const occurredAtUtc = normalizedUtc(row.created_at, context.nowUtc);
    const evidence = await createSourceEvidenceSha256({ sourcePublicId, orderItemId: row.order_item_id, patientId: row.patient_id, visitId: row.visit_id, testId: row.test_id, parentSpecimenId: row.parent_specimen_id });
    const practitionerPublicId = await resolvePractitioner(context.db, context.tenantId, row.collected_by);
    await registerCanonicalLabSpecimen(context.db, {
      tenantId: context.tenantId,
      patientLinkPublicId,
      encounterPublicId,
      requestPublicId,
      servicePublicId,
      eventPublicId,
      accessionNamespace: 'legacy_lab_accession',
      accessionValue: exact(row.accession_number, 'accession_number'),
      barcodeNamespace: 'legacy_lab_barcode',
      barcodeValue: exact(row.barcode, 'barcode'),
      specimenTypeCode: exact(row.specimen_type, 'specimen_type'),
      containerCode: row.container_type,
      parentSpecimenPublicId,
      practitionerPublicId,
      sourceType: 'legacy_lab_specimen',
      sourcePublicId,
      sourceTable: 'lab_specimens',
      sourceEvidenceSha256: evidence,
      actorSystemKey: 'canonical.backfill.lab-result-specimen',
      idempotencyKey: `cdb125d:specimen:${sourcePublicId}:register`,
      occurredAtUtc,
      businessDate: businessDate(occurredAtUtc),
    });
    await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { created: true, mapped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processSpecimenServiceLinks(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'lab_specimen_items'))) return true;
  const records = await rows<SpecimenItemRow>(context.db.prepare(`SELECT id,specimen_id,order_item_id,test_id FROM lab_specimen_items WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
  for (const row of records) {
    const specimen = await sourceMapping(context.db, context.tenantId, 'lab_specimen', 'legacy_lab_specimen', String(row.specimen_id));
    const request = await sourceMapping(context.db, context.tenantId, 'service_request', 'legacy_lab_order_item', String(row.order_item_id));
    const linked = specimen && request ? await count(context.db, `SELECT COUNT(*) AS count FROM canonical_lab_specimen_service_items WHERE tenant_id=? AND specimen_public_id=? AND request_public_id=?`, [context.tenantId, specimen, request]) : 0;
    if (!specimen || !request || linked === 0) {
      await recordIssue(context, { code: 'LAB_SPECIMEN_SERVICE_LINK_MISMATCH', sourceType: 'legacy_lab_specimen_item', sourcePublicId: String(row.id), reasonCode: 'exact_specimen_request_link_missing' });
      await recordCheckpointOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
    } else await recordCheckpointOutcome(context, checkpoint, String(row.id), { skipped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processSpecimenCustody(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'lab_specimen_events'))) return true;
  const records = await rows<SpecimenEventRow>(context.db.prepare(`SELECT id,specimen_id,event_type,from_status,to_status,performed_by,event_at,location_id,transport_condition,reason_code FROM lab_specimen_events WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
  for (const row of records) {
    const sourcePublicId = String(row.id);
    const specimenPublicId = await sourceMapping(context.db, context.tenantId, 'lab_specimen', 'legacy_lab_specimen', String(row.specimen_id));
    const practitionerPublicId = await resolvePractitioner(context.db, context.tenantId, row.performed_by);
    if (!specimenPublicId || !practitionerPublicId) {
      await recordIssue(context, { code: 'LAB_SPECIMEN_EVENT_SCOPE_MAPPING_MISSING', sourceType: 'legacy_lab_specimen_event', sourcePublicId, reasonCode: 'specimen_or_practitioner_mapping_missing' });
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const state = await context.db.prepare(`SELECT current_status,status_version FROM canonical_lab_specimens WHERE tenant_id=? AND specimen_public_id=? LIMIT 1`)
      .bind(context.tenantId, specimenPublicId).first<SpecimenStateRow>();
    if (!state) throw new Error('canonical specimen missing during custody backfill');
    if (state.current_status === row.to_status) {
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const occurredAtUtc = normalizedUtc(row.event_at, context.nowUtc);
    const evidence = await createSourceEvidenceSha256({ sourcePublicId, specimenId: row.specimen_id, eventType: row.event_type, fromStatus: row.from_status, toStatus: row.to_status, performer: row.performed_by, locationId: row.location_id });
    const common = {
      tenantId: context.tenantId,
      specimenPublicId,
      expectedStatusVersion: Number(state.status_version),
      practitionerPublicId,
      sourceEvidenceSha256: evidence,
      actorSystemKey: 'canonical.backfill.lab-result-specimen',
      occurredAtUtc,
      recordedAtUtc: occurredAtUtc,
      businessDate: businessDate(occurredAtUtc),
      locationSourceType: row.location_id == null ? null : 'legacy_lab_location',
      locationSourcePublicId: row.location_id == null ? null : String(row.location_id),
    };
    if (row.to_status === 'collected') {
      await collectCanonicalLabSpecimen(context.db, { ...common, idempotencyKey: `cdb125d:specimen-event:${sourcePublicId}:collect`, collectionMethodCode: 'legacy_collection' });
    } else if (row.to_status === 'received') {
      await receiveCanonicalLabSpecimen(context.db, { ...common, idempotencyKey: `cdb125d:specimen-event:${sourcePublicId}:receive`, transportConditionCode: row.transport_condition });
    } else if (row.to_status === 'rejected') {
      await rejectCanonicalLabSpecimen(context.db, { ...common, idempotencyKey: `cdb125d:specimen-event:${sourcePublicId}:reject`, reasonCode: row.reason_code?.trim() || 'legacy_rejected' });
    } else {
      await recordIssue(context, { code: 'LAB_SPECIMEN_EVENT_UNSUPPORTED', sourceType: 'legacy_lab_specimen_event', sourcePublicId, reasonCode: 'legacy_transition_requires_manual_review' });
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { created: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processCurrentResults(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'lab_results'))) return true;
  const records = await rows<ResultRow>(context.db.prepare(`SELECT id,order_item_id,test_id,patient_id,visit_id,specimen_id,result_value,result_numeric,unit,reference_low,reference_high,reference_text,abnormal_flag,status,reported_by,reported_at,created_at FROM lab_results WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
  for (const row of records) {
    const sourcePublicId = String(row.order_item_id);
    if (await sourceMapping(context.db, context.tenantId, 'lab_result_set', 'legacy_lab_result_set', sourcePublicId)) {
      await recordCheckpointOutcome(context, checkpoint, String(row.id), { skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const patientLinkPublicId = await resolvePatientLink(context.db, context.tenantId, row.patient_id);
    const encounterPublicId = await resolveEncounter(context.db, context.tenantId, row.visit_id);
    const requestPublicId = await sourceMapping(context.db, context.tenantId, 'service_request', 'legacy_lab_order_item', String(row.order_item_id));
    const eventPublicId = await sourceMapping(context.db, context.tenantId, 'service_event', 'legacy_lab_order_item_event', String(row.order_item_id));
    const specimenPublicId = await sourceMapping(context.db, context.tenantId, 'lab_specimen', 'legacy_lab_specimen', String(row.specimen_id));
    const practitionerPublicId = await resolvePractitioner(context.db, context.tenantId, row.reported_by);
    const servicePublicId = requestPublicId == null ? null : (await context.db.prepare(`SELECT service_public_id FROM canonical_service_requests WHERE tenant_id=? AND request_public_id=? LIMIT 1`).bind(context.tenantId, requestPublicId).first<{ service_public_id: string }>())?.service_public_id ?? null;
    if (!patientLinkPublicId || !encounterPublicId || !requestPublicId || !specimenPublicId || !practitionerPublicId || !servicePublicId) {
      await recordIssue(context, { code: 'LAB_RESULT_SCOPE_MAPPING_MISSING', sourceType: 'legacy_lab_result', sourcePublicId: String(row.id), reasonCode: 'patient_encounter_request_specimen_practitioner_or_service_mapping_missing' });
      await recordCheckpointOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const occurredAtUtc = normalizedUtc(row.reported_at ?? row.created_at, context.nowUtc);
    const observationPublicId = await createDeterministicSourceId('labobs', context.tenantId, 'legacy_lab_result', String(row.id));
    const evidence = await createSourceEvidenceSha256({ sourceResultId: row.id, orderItemId: row.order_item_id, testId: row.test_id, specimenId: row.specimen_id, status: row.status, reporterId: row.reported_by });
    const observation: CanonicalLabObservationInput = row.result_numeric != null
      ? {
          observationPublicId, servicePublicId,
          componentSourceType: 'legacy_lab_test', componentSourcePublicId: String(row.test_id),
          observationCode: `legacy-test-${row.test_id}`, codeSystem: 'legacy-lab-test', displaySnapshot: `Legacy lab component ${row.test_id}`,
          valueType: 'decimal', valueDecimal: row.result_numeric, unitCode: row.unit?.trim() || 'unknown',
          referenceLowDecimal: row.reference_low, referenceHighDecimal: row.reference_high,
          referenceText: row.reference_text, interpretationCode: row.abnormal_flag,
          observationStatus: row.status === 'final' ? 'final' : 'preliminary', sourceEvidenceSha256: evidence,
        }
      : {
          observationPublicId, servicePublicId,
          componentSourceType: 'legacy_lab_test', componentSourcePublicId: String(row.test_id),
          observationCode: `legacy-test-${row.test_id}`, codeSystem: 'legacy-lab-test', displaySnapshot: `Legacy lab component ${row.test_id}`,
          valueType: 'text', valueText: row.result_value?.trim() || 'not_recorded',
          referenceText: row.reference_text, interpretationCode: row.abnormal_flag,
          observationStatus: row.status === 'final' ? 'final' : 'preliminary', sourceEvidenceSha256: evidence,
        };
    await createCanonicalLabResultDraft(context.db, {
      tenantId: context.tenantId,
      patientLinkPublicId,
      encounterPublicId,
      requestPublicId,
      eventPublicId,
      specimenPublicId,
      servicePublicId,
      creatingPractitionerPublicId: practitionerPublicId,
      observations: [observation],
      sourceType: 'legacy_lab_result_set',
      sourcePublicId,
      sourceTable: 'lab_results',
      sourceEvidenceSha256: evidence,
      actorSystemKey: 'canonical.backfill.lab-result-specimen',
      idempotencyKey: `cdb125d:result:${sourcePublicId}:draft`,
      occurredAtUtc,
      businessDate: businessDate(occurredAtUtc),
    }, { authoritativeStatements: [observationMappingStatement(context.db, { tenantId: context.tenantId, observationPublicId, resultId: row.id, evidenceSha256: evidence, occurredAtUtc })] });
    await recordCheckpointOutcome(context, checkpoint, String(row.id), { created: true, mapped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processAuditCorrection(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const phase = checkpoint.cursor_value?.startsWith('C:') ? 'C' : 'A';
  if (phase === 'A' && await tableExists(context.db, 'lab_observation_audit')) {
    const records = await rows<AuditRow>(context.db.prepare(`SELECT id,result_id,order_item_id,version_no FROM lab_observation_audit WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
      .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
    for (const row of records) {
      const mapped = await sourceMapping(context.db, context.tenantId, 'lab_result_observation', 'legacy_lab_result', String(row.result_id));
      if (!mapped) {
        await recordIssue(context, { code: 'LAB_OBSERVATION_AUDIT_MAPPING_MISSING', sourceType: 'legacy_lab_observation_audit', sourcePublicId: String(row.id), reasonCode: 'audit_version_has_no_exact_result_observation_mapping' });
        await recordCheckpointOutcome(context, checkpoint, `A:${row.id}`, { issue: true, skipped: true });
      } else await recordCheckpointOutcome(context, checkpoint, `A:${row.id}`, { skipped: true });
      if (context.remaining === 0) return false;
    }
    await setCheckpointCursor(context, checkpoint, 'C:0');
  } else if (phase === 'A') await setCheckpointCursor(context, checkpoint, 'C:0');
  if (!(await tableExists(context.db, 'lab_result_corrections'))) return true;
  const records = await rows<CorrectionRow>(context.db.prepare(`SELECT id,result_id,corrected_by,corrected_at FROM lab_result_corrections WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
  for (const row of records) {
    await recordIssue(context, { code: 'LAB_RESULT_CORRECTION_REVIEW_REQUIRED', sourceType: 'legacy_lab_result_correction', sourcePublicId: String(row.id), reasonCode: 'legacy_correction_does_not_prove_complete_replacement_version' });
    await recordCheckpointOutcome(context, checkpoint, `C:${row.id}`, { issue: true, skipped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processResultLifecycle(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'lab_reports'))) return true;
  const records = await rows<ReportRow>(context.db.prepare(`SELECT id,order_item_id,report_status,reviewer_id,validator_id,verified_at,validated_at,published_at,delivered_at,retracted_at,created_at,updated_at FROM lab_reports WHERE tenant_id=? AND id>? AND is_active=1 ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
  for (const row of records) {
    const sourcePublicId = String(row.id);
    const resultSetPublicId = await sourceMapping(context.db, context.tenantId, 'lab_result_set', 'legacy_lab_result_set', String(row.order_item_id));
    if (!resultSetPublicId) {
      await recordIssue(context, { code: 'LAB_REPORT_RESULT_MAPPING_MISSING', sourceType: 'legacy_lab_report', sourcePublicId, reasonCode: 'report_has_no_exact_result_set_mapping' });
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    let state = await context.db.prepare(`SELECT current_version_public_id,current_status,status_version FROM canonical_lab_result_sets WHERE tenant_id=? AND result_set_public_id=? LIMIT 1`)
      .bind(context.tenantId, resultSetPublicId).first<ResultStateRow>();
    if (!state?.current_version_public_id) throw new Error('canonical result state missing during report lifecycle');
    let version = await context.db.prepare(`SELECT version_public_id,content_sha256,version_status FROM canonical_lab_result_versions WHERE tenant_id=? AND result_set_public_id=? AND version_public_id=? LIMIT 1`)
      .bind(context.tenantId, resultSetPublicId, state.current_version_public_id).first<VersionRow>();
    if (!version) throw new Error('canonical result version missing during report lifecycle');
    const evidence = await createSourceEvidenceSha256({ reportId: row.id, orderItemId: row.order_item_id, reportStatus: row.report_status, reviewerId: row.reviewer_id, validatorId: row.validator_id, verifiedAt: row.verified_at, validatedAt: row.validated_at, publishedAt: row.published_at, retractedAt: row.retracted_at });
    if (state.current_status === 'draft' && row.verified_at) {
      const verifier = await resolvePractitioner(context.db, context.tenantId, row.reviewer_id);
      if (!verifier) {
        await recordIssue(context, { code: 'LAB_REPORT_VERIFIER_MAPPING_MISSING', sourceType: 'legacy_lab_report', sourcePublicId, reasonCode: 'verified_report_has_no_exact_active_practitioner' });
        await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { issue: true, skipped: true });
        if (context.remaining === 0) return false;
        continue;
      }
      const verifiedAtUtc = normalizedUtc(row.verified_at, context.nowUtc);
      await verifyCanonicalLabResultVersion(context.db, {
        tenantId: context.tenantId, resultSetPublicId, versionPublicId: version.version_public_id,
        expectedStatusVersion: Number(state.status_version), verifyingPractitionerPublicId: verifier,
        signedContentSha256: version.content_sha256, reasonCode: 'legacy_report_verified',
        sourceEvidenceSha256: evidence, actorSystemKey: 'canonical.backfill.lab-result-specimen',
        idempotencyKey: `cdb125d:report:${sourcePublicId}:verify`, occurredAtUtc: verifiedAtUtc,
        businessDate: businessDate(verifiedAtUtc),
      });
      state = await context.db.prepare(`SELECT current_version_public_id,current_status,status_version FROM canonical_lab_result_sets WHERE tenant_id=? AND result_set_public_id=? LIMIT 1`)
        .bind(context.tenantId, resultSetPublicId).first<ResultStateRow>();
      version = await context.db.prepare(`SELECT version_public_id,content_sha256,version_status FROM canonical_lab_result_versions WHERE tenant_id=? AND result_set_public_id=? AND version_public_id=? LIMIT 1`)
        .bind(context.tenantId, resultSetPublicId, version.version_public_id).first<VersionRow>();
    }
    if (state?.current_status === 'verified' && row.report_status === 'published' && row.validated_at && row.published_at && version) {
      const validator = await resolvePractitioner(context.db, context.tenantId, row.validator_id);
      if (!validator) {
        await recordIssue(context, { code: 'LAB_REPORT_VALIDATOR_MAPPING_MISSING', sourceType: 'legacy_lab_report', sourcePublicId, reasonCode: 'published_report_has_no_exact_active_validator' });
        await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { issue: true, skipped: true });
        if (context.remaining === 0) return false;
        continue;
      }
      const validatedAtUtc = normalizedUtc(row.validated_at, context.nowUtc);
      const publishedAtUtc = normalizedUtc(row.published_at, context.nowUtc);
      await validateAndPublishCanonicalLabResultVersion(context.db, {
        tenantId: context.tenantId, resultSetPublicId, versionPublicId: version.version_public_id,
        expectedStatusVersion: Number(state.status_version), validatingPractitionerPublicId: validator,
        signedContentSha256: version.content_sha256, validationReasonCode: 'legacy_report_validated',
        publicationReasonCode: 'legacy_report_published', sourceEvidenceSha256: evidence,
        actorSystemKey: 'canonical.backfill.lab-result-specimen',
        idempotencyKey: `cdb125d:report:${sourcePublicId}:publish`,
        validatedAtUtc, publishedAtUtc, businessDate: businessDate(publishedAtUtc),
      });
    }
    await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { created: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processAnalyzerEvidence(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'lis_analyzer_inbox'))) return true;
  const records = await rows<AnalyzerRow>(context.db.prepare(`
    SELECT i.id,i.source_public_id,i.observation_index,i.machine_id,i.protocol,i.payload_sha256,
           i.qc_state,i.validation_state,i.match_state,i.disposition,i.accepted_result_id,
           i.conversion_factor,i.accepted_at,i.created_at,m.message_public_id,
           m.payload_sha256 AS ingestion_payload_sha256,r.order_item_id AS result_order_item_id
    FROM lis_analyzer_inbox i
    LEFT JOIN lis_ingestion_messages m ON m.tenant_id=i.tenant_id AND m.id=i.ingestion_message_id
    LEFT JOIN lab_results r ON r.tenant_id=i.tenant_id AND r.id=i.accepted_result_id
    WHERE i.tenant_id=? AND i.id>? AND i.disposition='accepted'
    ORDER BY i.id LIMIT ?
  `).bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
  for (const row of records) {
    const sourcePublicId = String(row.id);
    const resultSetPublicId = row.result_order_item_id == null ? null : await sourceMapping(context.db, context.tenantId, 'lab_result_set', 'legacy_lab_result_set', String(row.result_order_item_id));
    const observationPublicId = row.accepted_result_id == null ? null : await sourceMapping(context.db, context.tenantId, 'lab_result_observation', 'legacy_lab_result', String(row.accepted_result_id));
    const state = resultSetPublicId ? await context.db.prepare(`SELECT current_version_public_id FROM canonical_lab_result_sets WHERE tenant_id=? AND result_set_public_id=? LIMIT 1`).bind(context.tenantId, resultSetPublicId).first<{ current_version_public_id: string | null }>() : null;
    if (!resultSetPublicId || !observationPublicId || !state?.current_version_public_id || !row.message_public_id) {
      await recordIssue(context, { code: 'LAB_ANALYZER_ACCEPTED_MAPPING_MISSING', sourceType: 'legacy_lis_analyzer_inbox', sourcePublicId, reasonCode: 'accepted_analyzer_row_has_no_exact_result_observation_or_message_mapping' });
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const occurredAtUtc = normalizedUtc(row.accepted_at ?? row.created_at, context.nowUtc);
    const evidence = await createSourceEvidenceSha256({ inboxId: row.id, sourcePublicId: row.source_public_id, observationIndex: row.observation_index, machineId: row.machine_id, messagePublicId: row.message_public_id, payloadSha256: row.payload_sha256, qcState: row.qc_state, validationState: row.validation_state, matchState: row.match_state, disposition: row.disposition });
    await attachCanonicalLabAnalyzerEvidence(context.db, {
      tenantId: context.tenantId, resultSetPublicId, versionPublicId: state.current_version_public_id,
      observationPublicId, sourceType: 'lis_analyzer_inbox', sourcePublicId: row.source_public_id,
      ingestionMessagePublicId: row.message_public_id, observationIndex: row.observation_index,
      machineSourceType: row.machine_id == null ? null : 'legacy_lab_machine',
      machineSourcePublicId: row.machine_id == null ? null : String(row.machine_id),
      protocol: row.protocol, payloadSha256: row.payload_sha256 || row.ingestion_payload_sha256 || '',
      qcState: row.qc_state, validationState: row.validation_state, matchState: row.match_state,
      disposition: row.disposition, conversionFactorDecimal: row.conversion_factor,
      sourceEvidenceSha256: evidence, actorSystemKey: 'canonical.backfill.lab-result-specimen',
      idempotencyKey: `cdb125d:analyzer:${sourcePublicId}:attach`,
      occurredAtUtc, businessDate: businessDate(occurredAtUtc),
    });
    await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { created: true, mapped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processAnalyzerDisposition(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const phase = checkpoint.cursor_value?.startsWith('C:') ? 'C' : 'U';
  if (phase === 'U' && await tableExists(context.db, 'lis_unmatched_results')) {
    const records = await rows<{ id: number }>(context.db.prepare(`SELECT id FROM lis_unmatched_results WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
      .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
    for (const row of records) {
      await recordIssue(context, { code: 'LAB_UNMATCHED_ANALYZER_RESULT', sourceType: 'legacy_lis_unmatched_result', sourcePublicId: String(row.id), reasonCode: 'analyzer_result_has_no_exact_canonical_request_or_observation_mapping' });
      await recordCheckpointOutcome(context, checkpoint, `U:${row.id}`, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
    }
    await setCheckpointCursor(context, checkpoint, 'C:0');
  } else if (phase === 'U') await setCheckpointCursor(context, checkpoint, 'C:0');
  if (!(await tableExists(context.db, 'lis_ingestion_collisions'))) return true;
  const records = await rows<{ id: number }>(context.db.prepare(`SELECT id FROM lis_ingestion_collisions WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
  for (const row of records) {
    await recordIssue(context, { code: 'LAB_INGESTION_COLLISION', sourceType: 'legacy_lis_ingestion_collision', sourcePublicId: String(row.id), reasonCode: 'analyzer_payload_identity_collision_requires_review', severity: 'error' });
    await recordCheckpointOutcome(context, checkpoint, `C:${row.id}`, { issue: true, skipped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processProjectionDisposition(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const cursor = checkpoint.cursor_value ?? 'O:0';
  const phase = cursor.startsWith('R:') ? 'R' : cursor.startsWith('T:') ? 'T' : cursor.startsWith('V:') ? 'V' : 'O';
  if (phase === 'O' && await tableExists(context.db, 'lab_order_items')) {
    const records = await rows<{ id: number }>(context.db.prepare(`SELECT id FROM lab_order_items WHERE tenant_id=? AND id>? AND (result IS NOT NULL OR result_numeric IS NOT NULL) ORDER BY id LIMIT ?`)
      .bind(context.tenantId, cursorNumber(cursor), context.remaining));
    for (const row of records) {
      await recordIssue(context, { code: 'LAB_MUTABLE_RESULT_CACHE_DISPOSITION', sourceType: 'legacy_lab_order_item_result_cache', sourcePublicId: String(row.id), reasonCode: 'mutable_order_item_result_is_projection_not_version_authority', severity: 'info' });
      await recordCheckpointOutcome(context, checkpoint, `O:${row.id}`, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
    }
    await setCheckpointCursor(context, checkpoint, 'R:0');
  } else if (phase === 'O') await setCheckpointCursor(context, checkpoint, 'R:0');
  if ((checkpoint.cursor_value ?? '').startsWith('R:') && await tableExists(context.db, 'lab_reports')) {
    const records = await rows<{ id: number }>(context.db.prepare(`SELECT id FROM lab_reports WHERE tenant_id=? AND id>? AND delivered_at IS NOT NULL ORDER BY id LIMIT ?`)
      .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
    for (const row of records) {
      await recordIssue(context, { code: 'LAB_REPORT_DELIVERY_PROJECTION_ONLY', sourceType: 'legacy_lab_report_delivery', sourcePublicId: String(row.id), reasonCode: 'delivery_state_does_not_create_or_change_clinical_result_content', severity: 'info' });
      await recordCheckpointOutcome(context, checkpoint, `R:${row.id}`, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
    }
    await setCheckpointCursor(context, checkpoint, 'T:0');
  } else if ((checkpoint.cursor_value ?? '').startsWith('R:')) await setCheckpointCursor(context, checkpoint, 'T:0');
  if ((checkpoint.cursor_value ?? '').startsWith('T:') && await tableExists(context.db, 'tests')) {
    const records = await rows<{ id: number }>(context.db.prepare(`SELECT id FROM tests WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
      .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
    for (const row of records) {
      await recordIssue(context, { code: 'LAB_DUPLICATE_TEST_RESULT_DISPOSITION', sourceType: 'legacy_tests_projection', sourcePublicId: String(row.id), reasonCode: 'duplicate_test_result_surface_is_not_canonical_authority', severity: 'info' });
      await recordCheckpointOutcome(context, checkpoint, `T:${row.id}`, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
    }
    await setCheckpointCursor(context, checkpoint, 'V:0');
  } else if ((checkpoint.cursor_value ?? '').startsWith('T:')) await setCheckpointCursor(context, checkpoint, 'V:0');
  if (!(await tableExists(context.db, 'visit_services'))) return true;
  const records = await rows<{ id: number }>(context.db.prepare(`SELECT id FROM visit_services WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), context.remaining));
  for (const row of records) {
    await recordIssue(context, { code: 'LAB_VISIT_SERVICE_PROJECTION_DISPOSITION', sourceType: 'legacy_visit_service_projection', sourcePublicId: String(row.id), reasonCode: 'visit_service_status_is_projection_not_result_authority', severity: 'info' });
    await recordCheckpointOutcome(context, checkpoint, `V:${row.id}`, { issue: true, skipped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

const PARTITIONS: Partition[] = [
  { sourceType: 'legacy_lab_request_mapping', partitionKey: '01-service-request-event-mapping', process: processRequestMappings },
  { sourceType: 'legacy_lab_specimen_identity', partitionKey: '02-specimen-identity-current-state', process: processSpecimenIdentity },
  { sourceType: 'legacy_lab_specimen_service_link', partitionKey: '03-specimen-service-links', process: processSpecimenServiceLinks },
  { sourceType: 'legacy_lab_specimen_custody', partitionKey: '04-specimen-custody-events', process: processSpecimenCustody },
  { sourceType: 'legacy_lab_result_current', partitionKey: '05-current-result-version-reconstruction', process: processCurrentResults },
  { sourceType: 'legacy_lab_observation_correction', partitionKey: '06-observation-audit-correction-lineage', process: processAuditCorrection },
  { sourceType: 'legacy_lab_result_lifecycle', partitionKey: '07-verification-publication-retraction-lifecycle', process: processResultLifecycle },
  { sourceType: 'legacy_lis_analyzer_provenance', partitionKey: '08-analyzer-provenance', process: processAnalyzerEvidence },
  { sourceType: 'legacy_lis_disposition', partitionKey: '09-unmatched-collision-workflow-disposition', process: processAnalyzerDisposition },
  { sourceType: 'legacy_lab_projection_disposition', partitionKey: '10-duplicate-cache-projection-disposition', process: processProjectionDisposition },
];

export async function backfillLabResultSpecimen(
  db: LabResultSpecimenBackfillDatabase,
  options: LabResultSpecimenBackfillOptions,
): Promise<LabResultSpecimenBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const nowUtc = normalizedUtc(options.nowUtc, options.nowUtc);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  const starting = await captureCounts(db, tenantId);
  if (run.status === 'succeeded') {
    return {
      completed: true,
      counts: {
        scanned: 0, specimensCreated: 0, specimenServiceLinksCreated: 0,
        specimenEventsCreated: 0, resultSetsCreated: 0, resultVersionsCreated: 0,
        observationsCreated: 0, resultStatusEventsCreated: 0, analyzerEvidenceCreated: 0,
        mappingsCreated: 0, skipped: 0, issues: 0,
      },
    };
  }
  const context: Context = {
    db, tenantId, runId: Number(run.id), runPublicId, nowUtc,
    remaining: sourceLimit(options.maxSourceRecords), scanned: 0, skipped: 0,
  };
  let allCompleted = true;
  for (const partition of PARTITIONS) {
    const checkpoint = await ensureCheckpoint(context, partition);
    if (checkpoint.status === 'completed') continue;
    if (context.remaining === 0) { allCompleted = false; break; }
    await markCheckpointRunning(context, checkpoint);
    const completed = await partition.process(context, checkpoint);
    if (completed) await completeCheckpoint(context, checkpoint);
    else {
      await pauseCheckpoint(context, checkpoint);
      allCompleted = false;
      if (context.remaining === 0) break;
    }
  }
  const incompleteCount = await count(db, `SELECT COUNT(*) AS count FROM canonical_backfill_checkpoints WHERE tenant_id=? AND migration_run_id=? AND status!='completed'`, [tenantId, run.id]);
  allCompleted = allCompleted && incompleteCount === 0;
  const result = await resultFromDelta(context, starting, allCompleted);
  if (allCompleted) {
    await db.prepare(`UPDATE canonical_migration_runs SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=? WHERE tenant_id=? AND id=?`)
      .bind(nowUtc, stableCanonicalJson({ schemaVersion: 1, counts: result.counts, partitionCount: PARTITIONS.length }), nowUtc, tenantId, run.id).run();
  } else {
    await db.prepare(`UPDATE canonical_migration_runs SET status='running',updated_at_utc=? WHERE tenant_id=? AND id=?`)
      .bind(nowUtc, tenantId, run.id).run();
  }
  return result;
}
