import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  cancelCanonicalImagingAcquisition,
  completeCanonicalImagingAcquisition,
  createCanonicalImagingReportDraft,
  enterCanonicalImagingReportInError,
  finalizeAndPublishCanonicalImagingReportVersion,
  recordCanonicalImagingProvenance,
  registerCanonicalImagingAcquisition,
  registerCanonicalImagingStudy,
  startCanonicalImagingAcquisition,
  verifyCanonicalImagingReportVersion,
} from '../../src/lib/canonical/commands/manage-radiology-acquisition-report';
import { createRequestFingerprint, stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface RadiologyAcquisitionReportBackfillPreparedStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): RadiologyAcquisitionReportBackfillPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface RadiologyAcquisitionReportBackfillDatabase extends CanonicalBatchDatabase {
  prepare(sql: string): RadiologyAcquisitionReportBackfillPreparedStatement;
  batch(statements: RadiologyAcquisitionReportBackfillPreparedStatement[]): Promise<unknown[]>;
}
export interface RadiologyAcquisitionReportBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc: string;
  maxSourceRecords?: number;
}
export interface RadiologyAcquisitionReportBackfillCounts {
  scanned: number;
  acquisitionsCreated: number;
  acquisitionEventsCreated: number;
  studiesCreated: number;
  seriesCreated: number;
  instancesCreated: number;
  provenanceEventsCreated: number;
  reportSetsCreated: number;
  reportVersionsCreated: number;
  reportStatusEventsCreated: number;
  mappingsCreated: number;
  issuesCreated: number;
  skipped: number;
}
export interface RadiologyAcquisitionReportBackfillResult {
  completed: boolean;
  counts: RadiologyAcquisitionReportBackfillCounts;
}

interface MigrationRunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface PractitionerRow { practitioner_public_id: string; status: string }
interface AcquisitionStateRow {
  acquisition_public_id: string;
  accession_namespace: string;
  accession_value: string;
  modality_code: string;
  current_status: 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'cancelled' | 'entered_in_error';
  status_version: number;
}
interface StudyStateRow { study_public_id: string; acquisition_public_id: string }
interface ReportStateRow {
  report_set_public_id: string;
  current_version_public_id: string | null;
  current_status: 'draft' | 'verified' | 'final' | 'published' | 'retracted' | 'entered_in_error';
  status_version: number;
}
interface ReportVersionRow { version_public_id: string; content_sha256: string; version_number: number; version_status: string }

interface RequisitionRow {
  id: number;
  patient_id: number;
  visit_id: number | null;
  admission_id: number | null;
  imaging_item_id: number | null;
  imaging_type_name: string | null;
  imaging_item_name: string | null;
  procedure_code: string | null;
  prescriber_id: number | null;
  imaging_date: string | null;
  order_status: string;
  is_report_saved: number;
  is_scanned: number;
  scanned_by: string | null;
  scanned_on: string | null;
  is_active: number;
  cancel_remarks: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}
interface DicomStudyRow {
  id: number;
  patient_id: number | null;
  study_instance_uid: string;
  sop_class_uid: string | null;
  study_date: string | null;
  modality: string | null;
  study_description: string | null;
  requisition_id: number | null;
  is_mapped: number;
  series_count: number;
  image_count: number;
  is_active: number;
  updated_at: string | null;
  r2_key: string | null;
  source_ae_title: string | null;
  created_at: string | null;
}
interface ReportRow {
  id: number;
  requisition_id: number;
  patient_id: number;
  visit_id: number | null;
  imaging_item_id: number | null;
  performer_id: number | null;
  report_text: string | null;
  indication: string | null;
  radiology_number: string | null;
  patient_study_id: number | null;
  signatories: string | null;
  order_status: string;
  is_active: number;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}
interface RisQueueRow {
  id: number;
  requisition_id: number | null;
  dicom_study_id: number | null;
  issue_type: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}
interface IdRow { id: number }
interface StartingCounts {
  acquisitions: number;
  acquisitionEvents: number;
  studies: number;
  series: number;
  instances: number;
  provenance: number;
  reportSets: number;
  reportVersions: number;
  reportEvents: number;
  mappings: number;
  issues: number;
}
interface ProcessOutcome { created?: boolean; mapped?: boolean; skipped?: boolean; issue?: boolean }
interface Context {
  db: RadiologyAcquisitionReportBackfillDatabase;
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

const MIGRATION_NAME = 'CDB-126D radiology acquisition report backfill';
const ENTITY_TYPE = 'radiology_acquisition_report';
const ACTOR_SYSTEM_KEY = 'canonical.radiology.backfill';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}
function limit(value: number | undefined): number {
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
  const parsed = Number(value.replace(/^[A-Z]+:/, '').split(':').at(-1));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
function safeCode(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim().toUpperCase().replace(/\s+/g, '_');
  return normalized || fallback;
}
async function rows<T>(statement: RadiologyAcquisitionReportBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}
async function count(db: RadiologyAcquisitionReportBackfillDatabase, sql: string, values: readonly unknown[] = []): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}
async function tableExists(db: RadiologyAcquisitionReportBackfillDatabase, table: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=? LIMIT 1`).bind(table).first()) != null;
}
async function captureCounts(db: RadiologyAcquisitionReportBackfillDatabase, tenantId: string): Promise<StartingCounts> {
  return {
    acquisitions: await count(db, `SELECT COUNT(*) AS count FROM canonical_imaging_acquisitions WHERE tenant_id=?`, [tenantId]),
    acquisitionEvents: await count(db, `SELECT COUNT(*) AS count FROM canonical_imaging_acquisition_status_events WHERE tenant_id=?`, [tenantId]),
    studies: await count(db, `SELECT COUNT(*) AS count FROM canonical_imaging_studies WHERE tenant_id=?`, [tenantId]),
    series: await count(db, `SELECT COUNT(*) AS count FROM canonical_imaging_series WHERE tenant_id=?`, [tenantId]),
    instances: await count(db, `SELECT COUNT(*) AS count FROM canonical_imaging_instances WHERE tenant_id=?`, [tenantId]),
    provenance: await count(db, `SELECT COUNT(*) AS count FROM canonical_imaging_provenance_events WHERE tenant_id=?`, [tenantId]),
    reportSets: await count(db, `SELECT COUNT(*) AS count FROM canonical_imaging_report_sets WHERE tenant_id=?`, [tenantId]),
    reportVersions: await count(db, `SELECT COUNT(*) AS count FROM canonical_imaging_report_versions WHERE tenant_id=?`, [tenantId]),
    reportEvents: await count(db, `SELECT COUNT(*) AS count FROM canonical_imaging_report_status_events WHERE tenant_id=?`, [tenantId]),
    mappings: await count(db, `SELECT COUNT(*) AS count FROM canonical_source_mappings WHERE tenant_id=? AND entity_type IN ('imaging_acquisition','imaging_study','imaging_series','imaging_instance','imaging_provenance','imaging_report_set')`, [tenantId]),
    issues: await count(db, `SELECT COUNT(*) AS count FROM canonical_processing_issues WHERE tenant_id=? AND entity_type=?`, [tenantId, ENTITY_TYPE]),
  };
}
async function resultFromDelta(context: Context, starting: StartingCounts, completed: boolean): Promise<RadiologyAcquisitionReportBackfillResult> {
  const ending = await captureCounts(context.db, context.tenantId);
  return {
    completed,
    counts: {
      scanned: context.scanned,
      acquisitionsCreated: ending.acquisitions - starting.acquisitions,
      acquisitionEventsCreated: ending.acquisitionEvents - starting.acquisitionEvents,
      studiesCreated: ending.studies - starting.studies,
      seriesCreated: ending.series - starting.series,
      instancesCreated: ending.instances - starting.instances,
      provenanceEventsCreated: ending.provenance - starting.provenance,
      reportSetsCreated: ending.reportSets - starting.reportSets,
      reportVersionsCreated: ending.reportVersions - starting.reportVersions,
      reportStatusEventsCreated: ending.reportEvents - starting.reportEvents,
      mappingsCreated: ending.mappings - starting.mappings,
      issuesCreated: ending.issues - starting.issues,
      skipped: context.skipped,
    },
  };
}

async function ensureRun(db: RadiologyAcquisitionReportBackfillDatabase, tenantId: string, runPublicId: string, nowUtc: string): Promise<MigrationRunRow> {
  let run = await db.prepare(`SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1`)
    .bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (run) return run;
  await db.prepare(`INSERT INTO canonical_migration_runs (
    tenant_id,run_public_id,migration_name,migration_kind,status,started_at_utc,created_at_utc,updated_at_utc
  ) VALUES (?,?,?,'backfill','running',?,?,?)`).bind(tenantId, runPublicId, MIGRATION_NAME, nowUtc, nowUtc, nowUtc).run();
  run = await db.prepare(`SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1`)
    .bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!run) throw new Error('failed to create radiology acquisition/report backfill run');
  return run;
}
async function ensureCheckpoint(context: Context, partition: Partition): Promise<CheckpointRow> {
  let checkpoint = await context.db.prepare(`SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type=? AND source_type=? AND partition_key=? LIMIT 1`)
    .bind(context.tenantId, context.runId, ENTITY_TYPE, partition.sourceType, partition.partitionKey).first<CheckpointRow>();
  if (checkpoint) return checkpoint;
  const checkpointPublicId = await createDeterministicSourceId('radcp', context.tenantId, partition.sourceType, `${context.runPublicId}:${partition.partitionKey}`);
  await context.db.prepare(`INSERT INTO canonical_backfill_checkpoints (
    tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,partition_key,status,
    started_at_utc,created_at_utc,updated_at_utc
  ) VALUES (?,?,?,?,?,?,'pending',?,?,?)`).bind(
    context.tenantId, checkpointPublicId, context.runId, ENTITY_TYPE, partition.sourceType,
    partition.partitionKey, context.nowUtc, context.nowUtc, context.nowUtc,
  ).run();
  checkpoint = await context.db.prepare(`SELECT id,cursor_value,status FROM canonical_backfill_checkpoints WHERE tenant_id=? AND checkpoint_public_id=? LIMIT 1`)
    .bind(context.tenantId, checkpointPublicId).first<CheckpointRow>();
  if (!checkpoint) throw new Error('failed to create radiology acquisition/report checkpoint');
  return checkpoint;
}
async function markRunning(context: Context, checkpoint: CheckpointRow): Promise<void> {
  if (checkpoint.status === 'completed') return;
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints SET status='running',completed_at_utc=NULL,updated_at_utc=? WHERE tenant_id=? AND id=?`)
    .bind(context.nowUtc, context.tenantId, checkpoint.id).run();
}
async function recordOutcome(context: Context, checkpoint: CheckpointRow, cursor: string, outcome: ProcessOutcome): Promise<void> {
  await context.db.prepare(`UPDATE canonical_backfill_checkpoints SET
    cursor_value=?,scanned_count=scanned_count+1,created_count=created_count+?,mapped_count=mapped_count+?,
    skipped_count=skipped_count+?,exception_count=exception_count+?,updated_at_utc=?
    WHERE tenant_id=? AND id=?`).bind(
    cursor, outcome.created ? 1 : 0, outcome.mapped ? 1 : 0, outcome.skipped ? 1 : 0,
    outcome.issue ? 1 : 0, context.nowUtc, context.tenantId, checkpoint.id,
  ).run();
  checkpoint.cursor_value = cursor;
  context.scanned += 1;
  context.remaining -= 1;
  if (outcome.skipped) context.skipped += 1;
}
async function setCursor(context: Context, checkpoint: CheckpointRow, cursor: string): Promise<void> {
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
  code: string;
  sourceType: string;
  sourcePublicId: string;
  reasonCode: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
}): Promise<void> {
  const fingerprint = await createRequestFingerprint({ schemaVersion: 1, issueCode: input.code, sourceType: input.sourceType, sourcePublicId: input.sourcePublicId });
  const issuePublicId = await createDeterministicSourceId('radissue', context.tenantId, input.sourceType, `${input.code}:${input.sourcePublicId}`);
  const details = stableCanonicalJson({ schemaVersion: 1, reasonCode: input.reasonCode });
  await context.db.prepare(`INSERT INTO canonical_processing_issues (
    tenant_id,issue_public_id,migration_run_id,reconciliation_run_id,issue_type,issue_code,
    entity_type,entity_public_id,source_type,source_public_id,fingerprint,severity,status,
    occurrence_count,summary,details_json,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
  ) VALUES (?,?,?,NULL,'migration_mapping',?,?,NULL,?,?,?,?,'open',1,?,?,?,?,?,?)
  ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
    occurrence_count=canonical_processing_issues.occurrence_count+1,
    last_seen_at_utc=excluded.last_seen_at_utc,updated_at_utc=excluded.updated_at_utc`).bind(
    context.tenantId, issuePublicId, context.runId, input.code, ENTITY_TYPE, input.sourceType,
    input.sourcePublicId, fingerprint, input.severity ?? 'warning', input.code, details,
    context.nowUtc, context.nowUtc, context.nowUtc, context.nowUtc,
  ).run();
}
async function sourceMapping(db: RadiologyAcquisitionReportBackfillDatabase, tenantId: string, entityType: string, sourceType: string, sourcePublicId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1`)
    .bind(tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
  return row?.mapping_status === 'mapped' ? row.canonical_public_id : null;
}
async function resolvePatientLink(db: RadiologyAcquisitionReportBackfillDatabase, tenantId: string, patientId: number): Promise<string | null> {
  const direct = await db.prepare(`SELECT patient_link_public_id,link_status,effective_to_utc FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=? LIMIT 1`).bind(tenantId, patientId).first<PatientLinkRow>();
  if (direct && !['rejected', 'retired'].includes(direct.link_status) && direct.effective_to_utc == null) return direct.patient_link_public_id;
  return sourceMapping(db, tenantId, 'patient_link', 'legacy_patient', String(patientId));
}
async function resolveEncounter(db: RadiologyAcquisitionReportBackfillDatabase, tenantId: string, visitId: number | null, admissionId: number | null): Promise<string | null> {
  if (visitId != null) {
    const visit = await sourceMapping(db, tenantId, 'encounter', 'legacy_visit', String(visitId));
    if (visit) return visit;
  }
  if (admissionId != null) return sourceMapping(db, tenantId, 'encounter', 'legacy_admission', String(admissionId));
  return null;
}
async function resolvePractitioner(db: RadiologyAcquisitionReportBackfillDatabase, tenantId: string, sourceId: string | number | null): Promise<string | null> {
  if (sourceId == null || String(sourceId).trim() === '') return null;
  const direct = await sourceMapping(db, tenantId, 'practitioner', 'legacy_doctor', String(sourceId));
  if (direct) return direct;
  const numeric = Number(sourceId);
  if (!Number.isSafeInteger(numeric)) return null;
  const row = await db.prepare(`SELECT p.practitioner_public_id,p.status FROM canonical_practitioner_user_links l
    JOIN canonical_practitioners p ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
    WHERE l.tenant_id=? AND l.legacy_user_id=? AND l.link_status='active' LIMIT 1`)
    .bind(tenantId, numeric).first<PractitionerRow>();
  return row?.status === 'active' ? row.practitioner_public_id : null;
}
async function acquisitionState(db: RadiologyAcquisitionReportBackfillDatabase, tenantId: string, acquisitionPublicId: string): Promise<AcquisitionStateRow | null> {
  return db.prepare(`SELECT acquisition_public_id,accession_namespace,accession_value,modality_code,current_status,status_version
    FROM canonical_imaging_acquisitions WHERE tenant_id=? AND acquisition_public_id=? LIMIT 1`)
    .bind(tenantId, acquisitionPublicId).first<AcquisitionStateRow>();
}
async function studyState(db: RadiologyAcquisitionReportBackfillDatabase, tenantId: string, studyPublicId: string): Promise<StudyStateRow | null> {
  return db.prepare(`SELECT study_public_id,acquisition_public_id FROM canonical_imaging_studies WHERE tenant_id=? AND study_public_id=? LIMIT 1`)
    .bind(tenantId, studyPublicId).first<StudyStateRow>();
}
async function reportState(db: RadiologyAcquisitionReportBackfillDatabase, tenantId: string, reportSetPublicId: string): Promise<ReportStateRow | null> {
  return db.prepare(`SELECT report_set_public_id,current_version_public_id,current_status,status_version
    FROM canonical_imaging_report_sets WHERE tenant_id=? AND report_set_public_id=? LIMIT 1`)
    .bind(tenantId, reportSetPublicId).first<ReportStateRow>();
}
async function reportVersion(db: RadiologyAcquisitionReportBackfillDatabase, tenantId: string, reportSetPublicId: string, versionPublicId: string): Promise<ReportVersionRow | null> {
  return db.prepare(`SELECT version_public_id,content_sha256,version_number,version_status FROM canonical_imaging_report_versions
    WHERE tenant_id=? AND report_set_public_id=? AND version_public_id=? LIMIT 1`)
    .bind(tenantId, reportSetPublicId, versionPublicId).first<ReportVersionRow>();
}
async function exactScope(context: Context, row: RequisitionRow) {
  const patientLinkPublicId = await resolvePatientLink(context.db, context.tenantId, row.patient_id);
  const encounterPublicId = await resolveEncounter(context.db, context.tenantId, row.visit_id, row.admission_id);
  const requestPublicId = await sourceMapping(context.db, context.tenantId, 'service_request', 'legacy_radiology_requisition', String(row.id));
  const eventPublicId = await sourceMapping(context.db, context.tenantId, 'service_event', 'legacy_radiology_requisition_event', String(row.id));
  const servicePublicId = row.imaging_item_id == null ? null : await sourceMapping(context.db, context.tenantId, 'service_catalog', 'legacy_radiology_imaging_item', String(row.imaging_item_id));
  return { patientLinkPublicId, encounterPublicId, requestPublicId, eventPublicId, servicePublicId };
}

async function processRequisitionScope(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'radiology_requisitions'))) return true;
  const requested = context.remaining;
  const records = await rows<RequisitionRow>(context.db.prepare(`SELECT id,patient_id,visit_id,admission_id,imaging_item_id,
    imaging_type_name,imaging_item_name,procedure_code,prescriber_id,imaging_date,order_status,is_report_saved,is_scanned,
    scanned_by,scanned_on,is_active,cancel_remarks,created_by,created_at,updated_at
    FROM radiology_requisitions WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), requested));
  for (const row of records) {
    const scope = await exactScope(context, row);
    const missing = Object.entries(scope).filter(([, value]) => value == null).map(([key]) => key);
    if (missing.length) {
      await recordIssue(context, { code: 'RAD_REQUISITION_SCOPE_UNRESOLVED', sourceType: 'legacy_radiology_requisition', sourcePublicId: String(row.id), reasonCode: `missing_exact_${missing.join('_')}` });
      await recordOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
    } else {
      await recordOutcome(context, checkpoint, String(row.id), { skipped: true });
    }
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processAcquisitionIdentity(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'radiology_requisitions'))) return true;
  const requested = context.remaining;
  const records = await rows<RequisitionRow>(context.db.prepare(`SELECT id,patient_id,visit_id,admission_id,imaging_item_id,
    imaging_type_name,imaging_item_name,procedure_code,prescriber_id,imaging_date,order_status,is_report_saved,is_scanned,
    scanned_by,scanned_on,is_active,cancel_remarks,created_by,created_at,updated_at
    FROM radiology_requisitions WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), requested));
  for (const row of records) {
    const scope = await exactScope(context, row);
    if (!scope.patientLinkPublicId || !scope.encounterPublicId || !scope.requestPublicId || !scope.eventPublicId || !scope.servicePublicId) {
      await recordOutcome(context, checkpoint, String(row.id), { skipped: true });
    } else {
      const occurredAtUtc = normalizedUtc(row.created_at ?? row.imaging_date, context.nowUtc);
      const performer = await resolvePractitioner(context.db, context.tenantId, row.scanned_by);
      const evidence = await createSourceEvidenceSha256({
        table: 'radiology_requisitions', id: row.id, patientId: row.patient_id, visitId: row.visit_id,
        admissionId: row.admission_id, imagingItemId: row.imaging_item_id, procedureCode: row.procedure_code,
        orderStatus: row.order_status, isScanned: row.is_scanned, isActive: row.is_active,
        createdAt: row.created_at, updatedAt: row.updated_at,
      });
      const applied = await registerCanonicalImagingAcquisition(context.db, {
        tenantId: context.tenantId,
        patientLinkPublicId: scope.patientLinkPublicId,
        encounterPublicId: scope.encounterPublicId,
        requestPublicId: scope.requestPublicId,
        eventPublicId: scope.eventPublicId,
        servicePublicId: scope.servicePublicId,
        accessionNamespace: 'legacy_radiology_requisition',
        accessionValue: `RADREQ-${row.id}`,
        modalityCode: safeCode(row.procedure_code ?? row.imaging_type_name, 'OT'),
        procedureSnapshot: row.imaging_item_name?.trim() || null,
        performingPractitionerPublicId: performer,
        sourceType: 'legacy_radiology_requisition',
        sourcePublicId: String(row.id),
        sourceTable: 'radiology_requisitions',
        sourceEvidenceSha256: evidence,
        actorSystemKey: ACTOR_SYSTEM_KEY,
        idempotencyKey: `cdb126:acquisition:${row.id}`,
        occurredAtUtc,
        businessDate: businessDate(occurredAtUtc),
      });
      await recordOutcome(context, checkpoint, String(row.id), { created: applied.status === 'applied', mapped: true, skipped: applied.status === 'replayed' });
    }
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processAcquisitionLifecycle(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'radiology_requisitions'))) return true;
  const requested = context.remaining;
  const records = await rows<RequisitionRow>(context.db.prepare(`SELECT id,patient_id,visit_id,admission_id,imaging_item_id,
    imaging_type_name,imaging_item_name,procedure_code,prescriber_id,imaging_date,order_status,is_report_saved,is_scanned,
    scanned_by,scanned_on,is_active,cancel_remarks,created_by,created_at,updated_at
    FROM radiology_requisitions WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), requested));
  for (const row of records) {
    const acquisitionPublicId = await sourceMapping(context.db, context.tenantId, 'imaging_acquisition', 'legacy_radiology_requisition', String(row.id));
    if (!acquisitionPublicId) {
      await recordOutcome(context, checkpoint, String(row.id), { skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const evidence = await createSourceEvidenceSha256({ table: 'radiology_requisitions', id: row.id, orderStatus: row.order_status, isScanned: row.is_scanned, isReportSaved: row.is_report_saved, isActive: row.is_active, scannedOn: row.scanned_on, updatedAt: row.updated_at });
    const performer = await resolvePractitioner(context.db, context.tenantId, row.scanned_by);
    const occurredAtUtc = normalizedUtc(row.scanned_on ?? row.updated_at ?? row.created_at, context.nowUtc);
    let current = await acquisitionState(context.db, context.tenantId, acquisitionPublicId);
    let created = false;
    let issue = false;
    if (!current) {
      await recordOutcome(context, checkpoint, String(row.id), { skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    if (row.order_status === 'cancelled' || row.is_active === 0) {
      if (['scheduled', 'ready', 'in_progress'].includes(current.current_status)) {
        const applied = await cancelCanonicalImagingAcquisition(context.db, {
          tenantId: context.tenantId, acquisitionPublicId, expectedStatusVersion: current.status_version,
          practitionerPublicId: performer, reasonCode: 'legacy_cancelled', sourceEvidenceSha256: evidence,
          actorSystemKey: ACTOR_SYSTEM_KEY, idempotencyKey: `cdb126:acquisition-cancel:${row.id}`,
          occurredAtUtc, recordedAtUtc: context.nowUtc, businessDate: businessDate(occurredAtUtc),
        });
        created ||= applied.status === 'applied';
      }
    } else if (row.is_scanned === 1 || row.order_status === 'scanned' || row.order_status === 'reported' || row.is_report_saved === 1) {
      if (['scheduled', 'ready'].includes(current.current_status)) {
        const applied = await startCanonicalImagingAcquisition(context.db, {
          tenantId: context.tenantId, acquisitionPublicId, expectedStatusVersion: current.status_version,
          performingPractitionerPublicId: performer, sourceEvidenceSha256: evidence,
          actorSystemKey: ACTOR_SYSTEM_KEY, idempotencyKey: `cdb126:acquisition-start:${row.id}`,
          occurredAtUtc, recordedAtUtc: context.nowUtc, businessDate: businessDate(occurredAtUtc),
        });
        created ||= applied.status === 'applied';
        current = await acquisitionState(context.db, context.tenantId, acquisitionPublicId);
      }
      if ((row.order_status === 'reported' || row.is_report_saved === 1) && current?.current_status === 'in_progress') {
        if (!performer) {
          await recordIssue(context, { code: 'RAD_ACQUISITION_PERFORMER_UNRESOLVED', sourceType: 'legacy_radiology_requisition', sourcePublicId: String(row.id), reasonCode: 'completed_acquisition_requires_exact_active_performer' });
          issue = true;
        } else {
          const applied = await completeCanonicalImagingAcquisition(context.db, {
            tenantId: context.tenantId, acquisitionPublicId, expectedStatusVersion: current.status_version,
            performingPractitionerPublicId: performer, sourceEvidenceSha256: evidence,
            actorSystemKey: ACTOR_SYSTEM_KEY, idempotencyKey: `cdb126:acquisition-complete:${row.id}`,
            occurredAtUtc: normalizedUtc(row.updated_at ?? row.scanned_on, context.nowUtc),
            recordedAtUtc: context.nowUtc, businessDate: businessDate(occurredAtUtc),
          });
          created ||= applied.status === 'applied';
        }
      }
    }
    await recordOutcome(context, checkpoint, String(row.id), { created, issue, skipped: !created && !issue });
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processStudyIdentity(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'radiology_dicom_studies'))) return true;
  const requested = context.remaining;
  const records = await rows<DicomStudyRow>(context.db.prepare(`SELECT id,patient_id,study_instance_uid,sop_class_uid,study_date,
    modality,study_description,requisition_id,is_mapped,series_count,image_count,is_active,updated_at,r2_key,source_ae_title,created_at
    FROM radiology_dicom_studies WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), requested));
  for (const row of records) {
    const acquisitionPublicId = row.requisition_id == null ? null : await sourceMapping(context.db, context.tenantId, 'imaging_acquisition', 'legacy_radiology_requisition', String(row.requisition_id));
    const acquisition = acquisitionPublicId ? await acquisitionState(context.db, context.tenantId, acquisitionPublicId) : null;
    if (!acquisition || !row.study_instance_uid?.trim()) {
      await recordIssue(context, { code: 'RAD_STUDY_MAPPING_UNRESOLVED', sourceType: 'legacy_radiology_dicom_study', sourcePublicId: String(row.id), reasonCode: acquisition ? 'exact_study_instance_uid_missing' : 'exact_requisition_acquisition_mapping_missing' });
      await recordOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
    } else if (safeCode(row.modality, acquisition.modality_code) !== acquisition.modality_code) {
      await recordIssue(context, { code: 'RAD_STUDY_MODALITY_MISMATCH', sourceType: 'legacy_radiology_dicom_study', sourcePublicId: String(row.id), reasonCode: 'legacy_study_modality_differs_from_exact_acquisition_modality' });
      await recordOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
    } else {
      const occurredAtUtc = normalizedUtc(row.created_at ?? row.study_date, context.nowUtc);
      const evidence = await createSourceEvidenceSha256({ table: 'radiology_dicom_studies', id: row.id, requisitionId: row.requisition_id, studyInstanceUid: row.study_instance_uid, sopClassUid: row.sop_class_uid, studyDate: row.study_date, modality: row.modality, isMapped: row.is_mapped, isActive: row.is_active });
      const applied = await registerCanonicalImagingStudy(context.db, {
        tenantId: context.tenantId, acquisitionPublicId: acquisition.acquisition_public_id,
        studyUidNamespace: 'dicom', studyInstanceUid: row.study_instance_uid.trim(),
        accessionNamespace: acquisition.accession_namespace, accessionValue: acquisition.accession_value,
        modalityCode: acquisition.modality_code, studyStartedAtUtc: normalizedUtc(row.study_date ?? row.created_at, occurredAtUtc),
        sourceType: 'legacy_radiology_dicom_study', sourcePublicId: String(row.id), sourceTable: 'radiology_dicom_studies',
        sourceEvidenceSha256: evidence, actorSystemKey: ACTOR_SYSTEM_KEY,
        idempotencyKey: `cdb126:study:${row.id}`, occurredAtUtc, businessDate: businessDate(occurredAtUtc),
      });
      await recordOutcome(context, checkpoint, String(row.id), { created: applied.status === 'applied', mapped: true, skipped: applied.status === 'replayed' });
    }
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processHierarchyDisposition(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'radiology_dicom_studies'))) return true;
  const requested = context.remaining;
  const records = await rows<DicomStudyRow>(context.db.prepare(`SELECT id,patient_id,study_instance_uid,sop_class_uid,study_date,
    modality,study_description,requisition_id,is_mapped,series_count,image_count,is_active,updated_at,r2_key,source_ae_title,created_at
    FROM radiology_dicom_studies WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), requested));
  for (const row of records) {
    if (Number(row.series_count ?? 0) > 0 || Number(row.image_count ?? 0) > 0) {
      await recordIssue(context, { code: 'RAD_DICOM_HIERARCHY_NOT_EXACT', sourceType: 'legacy_radiology_dicom_study', sourcePublicId: String(row.id), reasonCode: 'study_counts_do_not_prove_series_or_sop_instance_identity' });
      await recordOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
    } else {
      await recordOutcome(context, checkpoint, String(row.id), { skipped: true });
    }
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processProvenance(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'radiology_dicom_studies'))) return true;
  const requested = context.remaining;
  const records = await rows<DicomStudyRow>(context.db.prepare(`SELECT id,patient_id,study_instance_uid,sop_class_uid,study_date,
    modality,study_description,requisition_id,is_mapped,series_count,image_count,is_active,updated_at,r2_key,source_ae_title,created_at
    FROM radiology_dicom_studies WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), requested));
  for (const row of records) {
    const studyPublicId = await sourceMapping(context.db, context.tenantId, 'imaging_study', 'legacy_radiology_dicom_study', String(row.id));
    const study = studyPublicId ? await studyState(context.db, context.tenantId, studyPublicId) : null;
    if (!study) {
      await recordOutcome(context, checkpoint, String(row.id), { skipped: true });
    } else {
      const occurredAtUtc = normalizedUtc(row.updated_at ?? row.created_at ?? row.study_date, context.nowUtc);
      const evidence = await createSourceEvidenceSha256({ table: 'radiology_dicom_studies', id: row.id, studyInstanceUid: row.study_instance_uid, sourceAeTitle: row.source_ae_title, modality: row.modality, r2KeyPresent: Boolean(row.r2_key), updatedAt: row.updated_at });
      const applied = await recordCanonicalImagingProvenance(context.db, {
        tenantId: context.tenantId, acquisitionPublicId: study.acquisition_public_id, studyPublicId: study.study_public_id,
        eventType: 'dicom_received', disposition: 'accepted', eventVersion: 1,
        modalitySourceType: row.source_ae_title?.trim() ? 'dicom_ae_title' : null,
        modalitySourcePublicId: row.source_ae_title?.trim() || null,
        sourceAeTitle: row.source_ae_title?.trim() || null, protocol: 'DICOM',
        sourceType: 'legacy_radiology_dicom_study_provenance', sourcePublicId: String(row.id),
        sourceTable: 'radiology_dicom_studies', sourceEvidenceSha256: evidence,
        actorSystemKey: ACTOR_SYSTEM_KEY, idempotencyKey: `cdb126:provenance:${row.id}`,
        occurredAtUtc, recordedAtUtc: context.nowUtc, reasonCode: 'legacy_dicom_received',
        businessDate: businessDate(occurredAtUtc),
      });
      let issue = false;
      if (row.r2_key?.trim()) {
        await recordIssue(context, { code: 'RAD_STORAGE_IDENTITY_INCOMPLETE', sourceType: 'legacy_radiology_dicom_study', sourcePublicId: String(row.id), reasonCode: 'r2_key_without_exact_provider_generation_and_object_hash_is_projection_only' });
        issue = true;
      }
      await recordOutcome(context, checkpoint, String(row.id), { created: applied.status === 'applied', mapped: true, issue, skipped: applied.status === 'replayed' && !issue });
    }
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processReportVersion(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'radiology_reports'))) return true;
  const requested = context.remaining;
  const records = await rows<ReportRow>(context.db.prepare(`SELECT id,requisition_id,patient_id,visit_id,imaging_item_id,performer_id,
    report_text,indication,radiology_number,patient_study_id,signatories,order_status,is_active,created_by,created_at,updated_at
    FROM radiology_reports WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), requested));
  for (const row of records) {
    const acquisitionPublicId = await sourceMapping(context.db, context.tenantId, 'imaging_acquisition', 'legacy_radiology_requisition', String(row.requisition_id));
    let studyPublicId: string | null = null;
    if (row.patient_study_id != null) studyPublicId = await sourceMapping(context.db, context.tenantId, 'imaging_study', 'legacy_radiology_dicom_study', String(row.patient_study_id));
    const reporter = await resolvePractitioner(context.db, context.tenantId, row.performer_id ?? row.created_by);
    if (!acquisitionPublicId || !studyPublicId || !reporter || !row.report_text?.trim()) {
      await recordIssue(context, { code: 'RAD_REPORT_SCOPE_UNRESOLVED', sourceType: 'legacy_radiology_report', sourcePublicId: String(row.id), reasonCode: 'exact_acquisition_study_reporter_or_complete_content_missing' });
      await recordOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
    } else {
      const occurredAtUtc = normalizedUtc(row.created_at, context.nowUtc);
      const evidence = await createSourceEvidenceSha256({ table: 'radiology_reports', id: row.id, requisitionId: row.requisition_id, patientId: row.patient_id, visitId: row.visit_id, imagingItemId: row.imaging_item_id, performerId: row.performer_id, patientStudyId: row.patient_study_id, orderStatus: row.order_status, isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at, contentHash: await createRequestFingerprint(row.report_text) });
      const text = row.report_text.trim();
      const applied = await createCanonicalImagingReportDraft(context.db, {
        tenantId: context.tenantId, acquisitionPublicId, studyPublicId,
        reportingPractitionerPublicId: reporter,
        reportNumberNamespace: 'legacy_radiology', reportNumberValue: row.radiology_number?.trim() || `RADREP-${row.id}`,
        content: { indication: row.indication?.trim() || null, technique: null, findings: text, impression: text, comparison: null, recommendations: null },
        sourceType: 'legacy_radiology_report', sourcePublicId: String(row.id), sourceTable: 'radiology_reports',
        sourceEvidenceSha256: evidence, actorSystemKey: ACTOR_SYSTEM_KEY,
        idempotencyKey: `cdb126:report:${row.id}`, occurredAtUtc, businessDate: businessDate(occurredAtUtc),
      });
      await recordOutcome(context, checkpoint, String(row.id), { created: applied.status === 'applied', mapped: true, skipped: applied.status === 'replayed' });
    }
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processReportLifecycle(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'radiology_reports'))) return true;
  const requested = context.remaining;
  const records = await rows<ReportRow>(context.db.prepare(`SELECT id,requisition_id,patient_id,visit_id,imaging_item_id,performer_id,
    report_text,indication,radiology_number,patient_study_id,signatories,order_status,is_active,created_by,created_at,updated_at
    FROM radiology_reports WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), requested));
  for (const row of records) {
    const reportSetPublicId = await sourceMapping(context.db, context.tenantId, 'imaging_report_set', 'legacy_radiology_report', String(row.id));
    const reporter = await resolvePractitioner(context.db, context.tenantId, row.performer_id ?? row.created_by);
    let created = false;
    let issue = false;
    if (reportSetPublicId && reporter) {
      let state = await reportState(context.db, context.tenantId, reportSetPublicId);
      if (state?.current_version_public_id) {
        let version = await reportVersion(context.db, context.tenantId, reportSetPublicId, state.current_version_public_id);
        const occurredAtUtc = normalizedUtc(row.updated_at ?? row.created_at, context.nowUtc);
        const evidence = await createSourceEvidenceSha256({ table: 'radiology_reports', id: row.id, orderStatus: row.order_status, isActive: row.is_active, signatoriesPresent: Boolean(row.signatories), updatedAt: row.updated_at });
        if ((row.is_active === 0 || row.order_status === 'deleted') && !['entered_in_error', 'retracted'].includes(state.current_status)) {
          const applied = await enterCanonicalImagingReportInError(context.db, {
            tenantId: context.tenantId, reportSetPublicId, expectedStatusVersion: state.status_version,
            authoringPractitionerPublicId: reporter, reasonCode: 'legacy_report_inactive', sourceEvidenceSha256: evidence,
            actorSystemKey: ACTOR_SYSTEM_KEY, idempotencyKey: `cdb126:report-error:${row.id}`,
            occurredAtUtc, businessDate: businessDate(occurredAtUtc),
          });
          created ||= applied.status === 'applied';
        } else if (row.order_status === 'final') {
          if (state.current_status === 'draft' && version) {
            const applied = await verifyCanonicalImagingReportVersion(context.db, {
              tenantId: context.tenantId, reportSetPublicId, versionPublicId: version.version_public_id,
              expectedStatusVersion: state.status_version, verifyingPractitionerPublicId: reporter,
              signedContentSha256: version.content_sha256, reasonCode: 'legacy_final_verified',
              sourceEvidenceSha256: evidence, actorSystemKey: ACTOR_SYSTEM_KEY,
              idempotencyKey: `cdb126:report-verify:${row.id}`, occurredAtUtc,
              businessDate: businessDate(occurredAtUtc),
            });
            created ||= applied.status === 'applied';
            state = await reportState(context.db, context.tenantId, reportSetPublicId);
            version = state?.current_version_public_id ? await reportVersion(context.db, context.tenantId, reportSetPublicId, state.current_version_public_id) : null;
          }
          if (state?.current_status === 'verified' && version) {
            const applied = await finalizeAndPublishCanonicalImagingReportVersion(context.db, {
              tenantId: context.tenantId, reportSetPublicId, versionPublicId: version.version_public_id,
              expectedStatusVersion: state.status_version, finalisingPractitionerPublicId: reporter,
              signedContentSha256: version.content_sha256, finalisationReasonCode: 'legacy_finalised',
              publicationReasonCode: 'legacy_published', sourceEvidenceSha256: evidence,
              actorSystemKey: ACTOR_SYSTEM_KEY, idempotencyKey: `cdb126:report-publish:${row.id}`,
              finalisedAtUtc: occurredAtUtc, publishedAtUtc: occurredAtUtc,
              businessDate: businessDate(occurredAtUtc),
            });
            created ||= applied.status === 'applied';
          }
        }
      }
    } else if (row.order_status === 'final' || row.is_active === 0) {
      await recordIssue(context, { code: 'RAD_REPORT_LIFECYCLE_UNRESOLVED', sourceType: 'legacy_radiology_report', sourcePublicId: String(row.id), reasonCode: 'exact_report_set_or_practitioner_mapping_missing' });
      issue = true;
    }
    await recordOutcome(context, checkpoint, String(row.id), { created, issue, skipped: !created && !issue });
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processRisQueue(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'ris_study_reconciliation_queue'))) return true;
  const requested = context.remaining;
  const records = await rows<RisQueueRow>(context.db.prepare(`SELECT id,requisition_id,dicom_study_id,issue_type,status,created_at,updated_at
    FROM ris_study_reconciliation_queue WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
    .bind(context.tenantId, cursorNumber(checkpoint.cursor_value), requested));
  for (const row of records) {
    if (!['resolved', 'closed'].includes(row.status)) {
      await recordIssue(context, { code: 'RAD_RIS_RECONCILIATION_UNRESOLVED', sourceType: 'legacy_ris_reconciliation', sourcePublicId: String(row.id), reasonCode: `status_${safeCode(row.status, 'OPEN').toLowerCase()}_issue_${safeCode(row.issue_type, 'UNKNOWN').toLowerCase()}` });
      await recordOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
    } else {
      await recordOutcome(context, checkpoint, String(row.id), { skipped: true });
    }
    if (context.remaining === 0) return false;
  }
  return records.length < requested;
}

async function processProjectionDisposition(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const tables = ['radiology_report_templates', 'radiology_film_usage', 'invoice_items'] as const;
  const rawCursor = checkpoint.cursor_value ?? '0:0';
  const [indexText, idText] = rawCursor.split(':');
  let tableIndex = Number(indexText);
  let lastId = Number(idText);
  if (!Number.isSafeInteger(tableIndex) || tableIndex < 0) tableIndex = 0;
  if (!Number.isSafeInteger(lastId) || lastId < 0) lastId = 0;
  for (; tableIndex < tables.length; tableIndex += 1) {
    const table = tables[tableIndex];
    if (!(await tableExists(context.db, table))) {
      lastId = 0;
      await setCursor(context, checkpoint, `${tableIndex + 1}:0`);
      continue;
    }
    const requested = context.remaining;
    const records = await rows<IdRow>(context.db.prepare(`SELECT id FROM ${table} WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?`)
      .bind(context.tenantId, lastId, requested));
    for (const row of records) {
      lastId = row.id;
      await recordOutcome(context, checkpoint, `${tableIndex}:${row.id}`, { skipped: true });
      if (context.remaining === 0) return false;
    }
    if (records.length === requested) return false;
    lastId = 0;
    await setCursor(context, checkpoint, `${tableIndex + 1}:0`);
  }
  return true;
}

const PARTITIONS: readonly Partition[] = [
  { sourceType: 'radiology_requisition_scope', partitionKey: '01', process: processRequisitionScope },
  { sourceType: 'radiology_acquisition_identity', partitionKey: '02', process: processAcquisitionIdentity },
  { sourceType: 'radiology_acquisition_lifecycle', partitionKey: '03', process: processAcquisitionLifecycle },
  { sourceType: 'radiology_dicom_study_identity', partitionKey: '04', process: processStudyIdentity },
  { sourceType: 'radiology_dicom_hierarchy', partitionKey: '05', process: processHierarchyDisposition },
  { sourceType: 'radiology_pacs_provenance', partitionKey: '06', process: processProvenance },
  { sourceType: 'radiology_report_version', partitionKey: '07', process: processReportVersion },
  { sourceType: 'radiology_report_lifecycle', partitionKey: '08', process: processReportLifecycle },
  { sourceType: 'ris_study_reconciliation', partitionKey: '09', process: processRisQueue },
  { sourceType: 'radiology_projection_disposition', partitionKey: '10', process: processProjectionDisposition },
];

export async function backfillCanonicalRadiologyAcquisitionReport(
  db: RadiologyAcquisitionReportBackfillDatabase,
  options: RadiologyAcquisitionReportBackfillOptions,
): Promise<RadiologyAcquisitionReportBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const nowUtc = normalizedUtc(options.nowUtc, options.nowUtc);
  if (nowUtc !== options.nowUtc) throw new RangeError('nowUtc must be a normalized UTC ISO timestamp');
  const starting = await captureCounts(db, tenantId);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  const context: Context = {
    db, tenantId, runId: run.id, runPublicId, nowUtc,
    remaining: limit(options.maxSourceRecords), scanned: 0, skipped: 0,
  };

  for (const partition of PARTITIONS) {
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
      await db.prepare(`UPDATE canonical_migration_runs SET status='running',completed_at_utc=NULL,updated_at_utc=? WHERE tenant_id=? AND id=?`)
        .bind(nowUtc, tenantId, run.id).run();
      return resultFromDelta(context, starting, false);
    }
  }

  const incomplete = await count(db, `SELECT COUNT(*) AS count FROM canonical_backfill_checkpoints WHERE tenant_id=? AND migration_run_id=? AND status!='completed'`, [tenantId, run.id]);
  const completed = incomplete === 0;
  const result = await resultFromDelta(context, starting, completed);
  if (completed) {
    await db.prepare(`UPDATE canonical_migration_runs SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=? WHERE tenant_id=? AND id=?`)
      .bind(nowUtc, stableCanonicalJson({ schemaVersion: 1, partitionCount: PARTITIONS.length, counts: result.counts }), nowUtc, tenantId, run.id).run();
  }
  return result;
}
