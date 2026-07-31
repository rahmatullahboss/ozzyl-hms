import { createRequestFingerprint, stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface ClinicalDocumentDiagnosisBackfillPreparedStatement {
  bind(...values: unknown[]): ClinicalDocumentDiagnosisBackfillPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface ClinicalDocumentDiagnosisBackfillDatabase {
  prepare(sql: string): ClinicalDocumentDiagnosisBackfillPreparedStatement;
  batch(statements: ClinicalDocumentDiagnosisBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface ClinicalDocumentDiagnosisBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc: string;
  maxSourceRecords?: number;
}

export interface ClinicalDocumentDiagnosisBackfillCounts {
  scanned: number;
  documentsCreated: number;
  versionsCreated: number;
  signaturesCreated: number;
  attachmentsCreated: number;
  diagnosesCreated: number;
  diagnosisEventsCreated: number;
  mappingsCreated: number;
  skipped: number;
  issues: number;
}

export interface ClinicalDocumentDiagnosisBackfillResult {
  completed: boolean;
  counts: ClinicalDocumentDiagnosisBackfillCounts;
}

type DocumentType =
  | 'progress_note' | 'soap_note' | 'consultation_note' | 'doctor_round_note'
  | 'treatment_plan' | 'encounter_summary' | 'discharge_summary' | 'procedure_note'
  | 'operative_note' | 'referral_note' | 'other';

interface MigrationRunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow { canonical_public_id: string | null; mapping_status: string; evidence_sha256?: string | null }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface PractitionerRow { practitioner_public_id: string; status: string }
interface DocumentRow { document_public_id: string; current_version_public_id: string | null; patient_link_public_id: string; encounter_public_id: string | null }
interface VersionRow { version_public_id: string; content_sha256: string }

interface StartingCounts {
  documents: number;
  versions: number;
  signatures: number;
  attachments: number;
  diagnoses: number;
  diagnosisEvents: number;
  mappings: number;
  issues: number;
}

interface Context {
  db: ClinicalDocumentDiagnosisBackfillDatabase;
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

interface ClinicalNoteRow {
  id: number;
  patient_id: number;
  visit_id: number | null;
  note_type: string;
  content: string;
  chief_complaint: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  follow_up: string | null;
  follow_up_unit: string | null;
  performer_id: number | null;
  is_signed: number | null;
  signed_by: number | null;
  signed_at: string | null;
  is_active: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string | null;
}

interface SoapRow {
  SOAPId: number;
  PatientId: number;
  EncounterId: number | null;
  ChiefComplaint: string | null;
  Subjective: string | null;
  Objective: string | null;
  Assessment: string | null;
  Plan: string | null;
  CreatedById: string | null;
  CreatedAt: string;
}

interface TreatmentPlanRow {
  TreatmentPlanId: number;
  PatientId: number;
  EncounterId: number | null;
  PresentingIssues: string | null;
  PatientHistory: string | null;
  Medications: string | null;
  AnyOtherRelevantInformation: string | null;
  Diagnosis: string | null;
  TreatmentReceived: string | null;
  RecommendationForFollowUp: string | null;
  CreatedById: string | null;
  CreatedAt: string;
}

interface EncounterSnapshotRow {
  id: number;
  patient_id: number;
  provider_id: number | null;
  signed_snapshot: string | null;
  snapshot_hash: string | null;
  signed_by: number | null;
  signed_at: string | null;
  signature_version: number | null;
  is_active: number | null;
  created_at: string;
  updated_at: string | null;
}

interface DocumentRecordRow {
  id: number;
  patient_id: number;
  document_type: string;
  file_key: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  is_active: number | null;
  created_at: string;
}

interface ClinicalImageRow {
  id: number;
  patient_id: number;
  visit_id: number | null;
  image_type: string;
  file_key: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  body_part: string | null;
  is_active: number | null;
  uploaded_by: number | null;
  created_at: string;
}

interface ClinicalDiagnosisRow {
  DiagnosisId: number;
  PatientId: number;
  PatientVisitId: number | null;
  ICD10Code: string | null;
  ICD10Description: string;
  icd11_code: string | null;
  icd11_title: string | null;
  DiagnosisType: string | null;
  IsActive: number | null;
  CreatedBy: string | null;
  CreatedOn: string;
  ModifiedOn: string | null;
  review_status: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface FinalDiagnosisRow {
  id: number;
  patient_id: number;
  visit_id: number | null;
  is_primary: number | null;
  is_active: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  code: string | null;
  description: string | null;
  icd11_code: string | null;
  icd11_title: string | null;
}

interface ProjectionRow { id: number; icd10_code: string | null; icd11_code: string | null }

const MIGRATION_NAME = 'CDB-122D clinical document diagnosis backfill';
const ENTITY_TYPE = 'clinical_document_diagnosis';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function sourceLimit(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive safe integer');
  return value;
}

function normalizedUtc(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  if (raw.endsWith('Z')) return toUtcIso(raw);
  return toUtcIso(`${raw.includes('T') ? raw : raw.replace(' ', 'T')}+06:00`);
}

function documentType(value: string): DocumentType {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('soap')) return 'soap_note';
  if (normalized.includes('round')) return 'doctor_round_note';
  if (normalized.includes('consult')) return 'consultation_note';
  if (normalized.includes('discharge')) return 'discharge_summary';
  if (normalized.includes('procedure')) return 'procedure_note';
  if (normalized.includes('operative')) return 'operative_note';
  if (normalized.includes('referral')) return 'referral_note';
  if (normalized.includes('treatment')) return 'treatment_plan';
  if (normalized.includes('encounter')) return 'encounter_summary';
  if (normalized.includes('progress')) return 'progress_note';
  return 'other';
}

function diagnosisRole(value: string | null, primary = false): 'primary' | 'secondary' | 'admitting' | 'discharge' | 'other' {
  if (primary) return 'primary';
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'primary') return 'primary';
  if (normalized === 'secondary') return 'secondary';
  if (normalized === 'admitting') return 'admitting';
  if (normalized === 'discharge') return 'discharge';
  return 'other';
}

async function rows<T>(statement: ClinicalDocumentDiagnosisBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function count(db: ClinicalDocumentDiagnosisBackfillDatabase, sql: string, values: readonly unknown[] = []): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}

async function captureCounts(db: ClinicalDocumentDiagnosisBackfillDatabase, tenantId: string): Promise<StartingCounts> {
  return {
    documents: await count(db, `SELECT COUNT(*) AS count FROM canonical_clinical_documents WHERE tenant_id=?`, [tenantId]),
    versions: await count(db, `SELECT COUNT(*) AS count FROM canonical_clinical_document_versions WHERE tenant_id=?`, [tenantId]),
    signatures: await count(db, `SELECT COUNT(*) AS count FROM canonical_clinical_document_signatures WHERE tenant_id=?`, [tenantId]),
    attachments: await count(db, `SELECT COUNT(*) AS count FROM canonical_clinical_document_attachments WHERE tenant_id=?`, [tenantId]),
    diagnoses: await count(db, `SELECT COUNT(*) AS count FROM canonical_diagnosis_assertions WHERE tenant_id=?`, [tenantId]),
    diagnosisEvents: await count(db, `SELECT COUNT(*) AS count FROM canonical_diagnosis_status_events WHERE tenant_id=?`, [tenantId]),
    mappings: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type IN (
        'clinical_document','clinical_document_version','clinical_document_signature',
        'clinical_document_attachment','diagnosis_assertion'
      )
    `, [tenantId]),
    issues: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_processing_issues
      WHERE tenant_id=? AND entity_type IN ('clinical_document','clinical_attachment','diagnosis_assertion','clinical_projection')
    `, [tenantId]),
  };
}

async function resultFromDelta(
  db: ClinicalDocumentDiagnosisBackfillDatabase,
  context: Context,
  starting: StartingCounts,
  completed: boolean,
): Promise<ClinicalDocumentDiagnosisBackfillResult> {
  const ending = await captureCounts(db, context.tenantId);
  return {
    completed,
    counts: {
      scanned: context.scanned,
      documentsCreated: ending.documents - starting.documents,
      versionsCreated: ending.versions - starting.versions,
      signaturesCreated: ending.signatures - starting.signatures,
      attachmentsCreated: ending.attachments - starting.attachments,
      diagnosesCreated: ending.diagnoses - starting.diagnoses,
      diagnosisEventsCreated: ending.diagnosisEvents - starting.diagnosisEvents,
      mappingsCreated: ending.mappings - starting.mappings,
      skipped: context.skipped,
      issues: ending.issues - starting.issues,
    },
  };
}

async function ensureRun(
  db: ClinicalDocumentDiagnosisBackfillDatabase,
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
        tenant_id,run_public_id,migration_name,migration_kind,status,started_at_utc,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'backfill','running',?,?,?)
    `).bind(tenantId, runPublicId, MIGRATION_NAME, nowUtc, nowUtc, nowUtc).run();
    run = await db.prepare(`
      SELECT id,status FROM canonical_migration_runs
      WHERE tenant_id=? AND run_public_id=? LIMIT 1
    `).bind(tenantId, runPublicId).first<MigrationRunRow>();
  } else if (run.status !== 'succeeded') {
    await db.prepare(`
      UPDATE canonical_migration_runs SET status='running',completed_at_utc=NULL,
        error_code=NULL,error_summary=NULL,updated_at_utc=? WHERE tenant_id=? AND id=?
    `).bind(nowUtc, tenantId, run.id).run();
  }
  if (!run) throw new Error('failed to create clinical document diagnosis migration run');
  return run;
}

async function ensureCheckpoint(
  db: ClinicalDocumentDiagnosisBackfillDatabase,
  input: { tenantId: string; runId: number; runPublicId: string; sourceType: string; partitionKey: string; nowUtc: string },
): Promise<CheckpointRow> {
  let checkpoint = await db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type=?
      AND source_type=? AND partition_key=? LIMIT 1
  `).bind(input.tenantId, input.runId, ENTITY_TYPE, input.sourceType, input.partitionKey).first<CheckpointRow>();
  if (!checkpoint) {
    const checkpointPublicId = await createDeterministicSourceId(
      'clincp', input.tenantId, input.runPublicId, `${input.sourceType}:${input.partitionKey}`,
    );
    await db.prepare(`
      INSERT INTO canonical_backfill_checkpoints (
        tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
        partition_key,cursor_value,status,started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,NULL,'running',?,?,?)
    `).bind(
      input.tenantId, checkpointPublicId, input.runId, ENTITY_TYPE, input.sourceType,
      input.partitionKey, input.nowUtc, input.nowUtc, input.nowUtc,
    ).run();
    checkpoint = await db.prepare(`
      SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
      WHERE tenant_id=? AND migration_run_id=? AND entity_type=?
        AND source_type=? AND partition_key=? LIMIT 1
    `).bind(input.tenantId, input.runId, ENTITY_TYPE, input.sourceType, input.partitionKey).first<CheckpointRow>();
  }
  if (!checkpoint) throw new Error('failed to create clinical document diagnosis checkpoint');
  return checkpoint;
}

async function advanceCheckpoint(
  context: Context,
  checkpoint: CheckpointRow,
  cursor: string | null,
  completed: boolean,
): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET cursor_value=?,status=?,completed_at_utc=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    cursor,
    completed ? 'completed' : 'running',
    completed ? context.nowUtc : null,
    context.nowUtc,
    context.tenantId,
    checkpoint.id,
  ).run();
  checkpoint.cursor_value = cursor;
  checkpoint.status = completed ? 'completed' : 'running';
}

async function mapping(
  db: ClinicalDocumentDiagnosisBackfillDatabase,
  tenantId: string,
  entityType: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256 FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
}

async function patientLink(db: ClinicalDocumentDiagnosisBackfillDatabase, tenantId: string, legacyPatientId: number): Promise<string | null> {
  const mapped = await mapping(db, tenantId, 'patient_link', 'legacy_patient', String(legacyPatientId));
  if (!mapped?.canonical_public_id || mapped.mapping_status !== 'mapped') return null;
  const row = await db.prepare(`
    SELECT patient_link_public_id,link_status,effective_to_utc FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(tenantId, mapped.canonical_public_id).first<PatientLinkRow>();
  if (!row || ['rejected', 'retired'].includes(row.link_status) || row.effective_to_utc != null) return null;
  return row.patient_link_public_id;
}

async function practitioner(
  db: ClinicalDocumentDiagnosisBackfillDatabase,
  tenantId: string,
  legacyUserId: string | number | null,
): Promise<string | null> {
  if (legacyUserId == null || String(legacyUserId).trim() === '') return null;
  const numeric = Number(legacyUserId);
  let practitionerPublicId: string | null = null;
  if (Number.isSafeInteger(numeric) && numeric > 0) {
    const link = await db.prepare(`
      SELECT practitioner_public_id FROM canonical_practitioner_user_links
      WHERE tenant_id=? AND legacy_user_id=? AND link_status='active' LIMIT 1
    `).bind(tenantId, numeric).first<{ practitioner_public_id: string }>();
    practitionerPublicId = link?.practitioner_public_id ?? null;
  }
  if (!practitionerPublicId) {
    const mapped = await mapping(db, tenantId, 'practitioner', 'legacy_doctor', String(legacyUserId));
    practitionerPublicId = mapped?.mapping_status === 'mapped' ? mapped.canonical_public_id : null;
  }
  if (!practitionerPublicId) return null;
  const row = await db.prepare(`
    SELECT practitioner_public_id,status FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=? LIMIT 1
  `).bind(tenantId, practitionerPublicId).first<PractitionerRow>();
  return row?.status === 'active' ? row.practitioner_public_id : null;
}

async function encounter(
  db: ClinicalDocumentDiagnosisBackfillDatabase,
  tenantId: string,
  sourceType: 'legacy_visit' | 'legacy_encounter',
  legacyId: number | null,
  expectedPatientLinkPublicId: string,
): Promise<string | null> {
  if (legacyId == null) return null;
  const mapped = await mapping(db, tenantId, 'encounter', sourceType, String(legacyId));
  if (!mapped?.canonical_public_id || mapped.mapping_status !== 'mapped') return null;
  const row = await db.prepare(`
    SELECT encounter_public_id,patient_link_public_id,status FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(tenantId, mapped.canonical_public_id).first<{
    encounter_public_id: string; patient_link_public_id: string | null; status: string;
  }>();
  if (!row || row.patient_link_public_id !== expectedPatientLinkPublicId || row.status === 'entered_in_error') return null;
  return row.encounter_public_id;
}

function mappingStatement(
  db: ClinicalDocumentDiagnosisBackfillDatabase,
  input: {
    tenantId: string; entityType: string; canonicalPublicId: string; sourceType: string;
    sourcePublicId: string; sourceTable: string; migrationRunId: number;
    evidenceSha256: string; nowUtc: string;
  },
): ClinicalDocumentDiagnosisBackfillPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,'mapped',1,?,?,?,?)
  `).bind(
    input.tenantId, input.entityType, input.canonicalPublicId, input.sourceType,
    input.sourcePublicId, input.sourceTable, input.migrationRunId, input.evidenceSha256,
    input.nowUtc, input.nowUtc,
  );
}

async function recordIssue(
  context: Context,
  input: {
    issueCode: string; entityType: string; sourceType: string; sourcePublicId: string;
    severity?: 'warning' | 'error' | 'critical'; summary: string; details?: Record<string, unknown>;
  },
): Promise<void> {
  const fingerprint = await createRequestFingerprint({
    issueCode: input.issueCode,
    entityType: input.entityType,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
  });
  const issuePublicId = await createDeterministicSourceId('clinissue', context.tenantId, input.issueCode, input.sourcePublicId);
  const detailsJson = stableCanonicalJson({
    schemaVersion: 1,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    ...(input.details ?? {}),
  });
  await context.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,entity_type,
      source_type,source_public_id,fingerprint,severity,status,occurrence_count,
      summary,details_json,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'backfill',?,?,?,?,?,?,'open',1,?,?,?,?,?,?)
    ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    context.tenantId, issuePublicId, context.runId, input.issueCode, input.entityType,
    input.sourceType, input.sourcePublicId, fingerprint, input.severity ?? 'error',
    input.summary, detailsJson, context.nowUtc, context.nowUtc, context.nowUtc, context.nowUtc,
  ).run();
  context.skipped += 1;
}

async function existingSourceMapping(
  context: Context,
  entityType: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<string | null> {
  const row = await mapping(context.db, context.tenantId, entityType, sourceType, sourcePublicId);
  return row?.mapping_status === 'mapped' ? row.canonical_public_id : null;
}

async function createDocument(
  context: Context,
  input: {
    sourceType: string; sourcePublicId: string; sourceTable: string;
    patientLinkPublicId: string; encounterPublicId: string; authoringPractitionerPublicId: string;
    documentType: DocumentType; authoredAtUtc: string; contentFormat: 'plain_text' | 'soap_json' | 'structured_json';
    contentPayload: string; status: 'draft' | 'final' | 'entered_in_error';
    signerPractitionerPublicId?: string | null; signedAtUtc?: string | null;
    assertedContentSha256?: string | null;
  },
): Promise<void> {
  const existing = await existingSourceMapping(context, 'clinical_document', input.sourceType, input.sourcePublicId);
  if (existing) return;
  const documentPublicId = await createDeterministicSourceId('cldoc', context.tenantId, input.sourceType, input.sourcePublicId);
  const versionPublicId = await createDeterministicSourceId('cldver', context.tenantId, input.sourceType, `${input.sourcePublicId}:v1`);
  const contentSha256 = input.assertedContentSha256 && /^[0-9a-f]{64}$/.test(input.assertedContentSha256)
    ? input.assertedContentSha256
    : await createRequestFingerprint({ contentFormat: input.contentFormat, contentPayload: input.contentPayload });
  const evidenceSha256 = await createSourceEvidenceSha256({
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    patientLinkPublicId: input.patientLinkPublicId,
    encounterPublicId: input.encounterPublicId,
    authoringPractitionerPublicId: input.authoringPractitionerPublicId,
    contentSha256,
    status: input.status,
  });
  const idempotencyKey = `backfill:${input.sourceType}:${input.sourcePublicId}`;
  const fingerprint = await createRequestFingerprint({ documentPublicId, versionPublicId, evidenceSha256 });
  const statements: ClinicalDocumentDiagnosisBackfillPreparedStatement[] = [
    context.db.prepare(`
      INSERT INTO canonical_clinical_documents (
        tenant_id,document_public_id,patient_link_public_id,encounter_public_id,
        scope_kind,authoring_practitioner_public_id,document_type,current_version_public_id,
        current_status,status_version,confidentiality_code,authored_at_utc,
        finalized_at_utc,entered_in_error_at_utc,idempotency_key,
        request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?, 'encounter',?,?,NULL,'draft',1,'normal',?,NULL,NULL,?,?,?,?,?)
    `).bind(
      context.tenantId, documentPublicId, input.patientLinkPublicId, input.encounterPublicId,
      input.authoringPractitionerPublicId, input.documentType, input.authoredAtUtc,
      idempotencyKey, fingerprint, evidenceSha256, context.nowUtc, context.nowUtc,
    ),
    context.db.prepare(`
      INSERT INTO canonical_clinical_document_versions (
        tenant_id,version_public_id,document_public_id,version_number,
        supersedes_version_public_id,version_kind,content_format,content_payload,
        encrypted_payload_reference,encryption_key_version,content_sha256,
        section_manifest_json,authoring_practitioner_public_id,actor_user_public_id,
        actor_system_key,authored_at_utc,finalized_at_utc,source_evidence_sha256,created_at_utc
      ) VALUES (?,?,?,1,NULL,'draft',?,?,NULL,NULL,?,NULL,?,NULL,'canonical.backfill',?,NULL,?,?)
    `).bind(
      context.tenantId, versionPublicId, documentPublicId, input.contentFormat,
      input.contentPayload, contentSha256, input.authoringPractitionerPublicId,
      input.authoredAtUtc, evidenceSha256, context.nowUtc,
    ),
    mappingStatement(context.db, {
      tenantId: context.tenantId, entityType: 'clinical_document', canonicalPublicId: documentPublicId,
      sourceType: input.sourceType, sourcePublicId: input.sourcePublicId, sourceTable: input.sourceTable,
      migrationRunId: context.runId, evidenceSha256, nowUtc: context.nowUtc,
    }),
    mappingStatement(context.db, {
      tenantId: context.tenantId, entityType: 'clinical_document_version', canonicalPublicId: versionPublicId,
      sourceType: input.sourceType, sourcePublicId: `${input.sourcePublicId}:v1`, sourceTable: input.sourceTable,
      migrationRunId: context.runId, evidenceSha256, nowUtc: context.nowUtc,
    }),
  ];
  if (input.status === 'final' && input.signerPractitionerPublicId && input.signedAtUtc) {
    const signaturePublicId = await createDeterministicSourceId('clsig', context.tenantId, input.sourceType, `${input.sourcePublicId}:signature`);
    const attestationSha256 = await createSourceEvidenceSha256({
      signaturePublicId, signerPractitionerPublicId: input.signerPractitionerPublicId,
      contentSha256, signedAtUtc: input.signedAtUtc,
    });
    statements.push(
      context.db.prepare(`
        INSERT INTO canonical_clinical_document_signatures (
          tenant_id,signature_public_id,document_public_id,version_public_id,
          signer_practitioner_public_id,actor_user_public_id,signature_method,
          signed_content_sha256,attestation_sha256,signing_key_reference,
          signed_at_utc,source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,?,?,NULL,'imported_legacy_signature',?,?,NULL,?,?,?)
      `).bind(
        context.tenantId, signaturePublicId, documentPublicId, versionPublicId,
        input.signerPractitionerPublicId, contentSha256, attestationSha256,
        input.signedAtUtc, evidenceSha256, context.nowUtc,
      ),
      mappingStatement(context.db, {
        tenantId: context.tenantId, entityType: 'clinical_document_signature', canonicalPublicId: signaturePublicId,
        sourceType: input.sourceType, sourcePublicId: `${input.sourcePublicId}:signature`, sourceTable: input.sourceTable,
        migrationRunId: context.runId, evidenceSha256, nowUtc: context.nowUtc,
      }),
      context.db.prepare(`
        UPDATE canonical_clinical_document_versions
        SET version_kind='final',finalized_at_utc=?
        WHERE tenant_id=? AND document_public_id=? AND version_public_id=?
          AND version_kind='draft' AND content_sha256=?
      `).bind(input.signedAtUtc, context.tenantId, documentPublicId, versionPublicId, contentSha256),
      context.db.prepare(`
        UPDATE canonical_clinical_documents
        SET current_version_public_id=?,current_status='final',finalized_at_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND document_public_id=? AND current_version_public_id IS NULL
      `).bind(versionPublicId, input.signedAtUtc, context.nowUtc, context.tenantId, documentPublicId),
    );
  } else {
    statements.push(context.db.prepare(`
      UPDATE canonical_clinical_documents
      SET current_version_public_id=?,current_status=?,entered_in_error_at_utc=?,updated_at_utc=?
      WHERE tenant_id=? AND document_public_id=? AND current_version_public_id IS NULL
    `).bind(
      versionPublicId,
      input.status,
      input.status === 'entered_in_error' ? context.nowUtc : null,
      context.nowUtc,
      context.tenantId,
      documentPublicId,
    ));
  }
  await context.db.batch(statements);
}

async function processClinicalNotes(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const limit = context.remaining;
  if (limit <= 0) return false;
  const sourceRows = await rows<ClinicalNoteRow>(context.db.prepare(`
    SELECT id,patient_id,visit_id,note_type,content,chief_complaint,subjective,objective,
           assessment,plan,follow_up,follow_up_unit,performer_id,is_signed,signed_by,
           signed_at,is_active,created_by,created_at,updated_at
    FROM clinical_notes WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, Number(checkpoint.cursor_value ?? 0), limit + 1));
  const batch = sourceRows.slice(0, limit);
  for (const row of batch) {
    context.scanned += 1; context.remaining -= 1;
    const sourcePublicId = String(row.id);
    const patient = await patientLink(context.db, context.tenantId, row.patient_id);
    const author = await practitioner(context.db, context.tenantId, row.performer_id ?? row.created_by);
    const enc = patient ? await encounter(context.db, context.tenantId, 'legacy_visit', row.visit_id, patient) : null;
    const signer = row.is_signed === 1 ? await practitioner(context.db, context.tenantId, row.signed_by) : null;
    const signedAt = row.is_signed === 1 ? normalizedUtc(row.signed_at, context.nowUtc) : null;
    if (!patient || !author || !enc || (row.is_signed === 1 && (!signer || !signedAt))) {
      await recordIssue(context, {
        issueCode: 'CLINICAL_DOCUMENT_SCOPE_UNRESOLVED', entityType: 'clinical_document',
        sourceType: 'legacy_clinical_note', sourcePublicId, summary: 'Clinical note exact scope could not be resolved',
        details: { hasPatient: Boolean(patient), hasEncounter: Boolean(enc), hasAuthor: Boolean(author), hasSigner: row.is_signed === 1 ? Boolean(signer) : null },
      });
    } else if (row.is_signed === 1 && row.updated_at && signedAt && normalizedUtc(row.updated_at, context.nowUtc) > signedAt) {
      await recordIssue(context, {
        issueCode: 'CLINICAL_POST_SIGN_MUTATION', entityType: 'clinical_document',
        sourceType: 'legacy_clinical_note', sourcePublicId, severity: 'critical',
        summary: 'Signed clinical note changed after signature', details: { signed: true, postSignMutation: true },
      });
    } else {
      const payload = stableCanonicalJson({
        schemaVersion: 1, content: row.content, chiefComplaint: row.chief_complaint,
        subjective: row.subjective, objective: row.objective, assessment: row.assessment,
        plan: row.plan, followUp: row.follow_up, followUpUnit: row.follow_up_unit,
      });
      await createDocument(context, {
        sourceType: 'legacy_clinical_note', sourcePublicId, sourceTable: 'clinical_notes',
        patientLinkPublicId: patient, encounterPublicId: enc, authoringPractitionerPublicId: author,
        documentType: documentType(row.note_type), authoredAtUtc: normalizedUtc(row.created_at, context.nowUtc),
        contentFormat: 'structured_json', contentPayload: payload,
        status: row.is_active === 0 ? 'entered_in_error' : row.is_signed === 1 ? 'final' : 'draft',
        signerPractitionerPublicId: signer, signedAtUtc: signedAt,
      });
    }
    checkpoint.cursor_value = sourcePublicId;
  }
  const completed = sourceRows.length <= limit;
  await advanceCheckpoint(context, checkpoint, checkpoint.cursor_value, completed);
  return completed;
}

async function processSoap(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (context.remaining <= 0) return false;
  const sourceRows = await rows<SoapRow>(context.db.prepare(`
    SELECT SOAPId,PatientId,EncounterId,ChiefComplaint,Subjective,Objective,Assessment,Plan,CreatedById,CreatedAt
    FROM FormSOAP WHERE tenant_id=? AND SOAPId>? ORDER BY SOAPId LIMIT ?
  `).bind(context.tenantId, Number(checkpoint.cursor_value ?? 0), context.remaining + 1));
  const limit = context.remaining;
  for (const row of sourceRows.slice(0, limit)) {
    context.scanned += 1; context.remaining -= 1;
    const sourcePublicId = String(row.SOAPId);
    const patient = await patientLink(context.db, context.tenantId, row.PatientId);
    const author = await practitioner(context.db, context.tenantId, row.CreatedById);
    const enc = patient ? await encounter(context.db, context.tenantId, 'legacy_encounter', row.EncounterId, patient) : null;
    if (!patient || !author || !enc) {
      await recordIssue(context, {
        issueCode: 'CLINICAL_DOCUMENT_SCOPE_UNRESOLVED', entityType: 'clinical_document',
        sourceType: 'legacy_form_soap', sourcePublicId, summary: 'SOAP exact scope could not be resolved',
        details: { hasPatient: Boolean(patient), hasEncounter: Boolean(enc), hasAuthor: Boolean(author) },
      });
    } else {
      await createDocument(context, {
        sourceType: 'legacy_form_soap', sourcePublicId, sourceTable: 'FormSOAP',
        patientLinkPublicId: patient, encounterPublicId: enc, authoringPractitionerPublicId: author,
        documentType: 'soap_note', authoredAtUtc: normalizedUtc(row.CreatedAt, context.nowUtc),
        contentFormat: 'soap_json', contentPayload: stableCanonicalJson({
          schemaVersion: 1, chiefComplaint: row.ChiefComplaint, subjective: row.Subjective,
          objective: row.Objective, assessment: row.Assessment, plan: row.Plan,
        }), status: 'draft',
      });
    }
    checkpoint.cursor_value = sourcePublicId;
  }
  const completed = sourceRows.length <= limit;
  await advanceCheckpoint(context, checkpoint, checkpoint.cursor_value, completed);
  return completed;
}

async function processTreatmentPlans(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (context.remaining <= 0) return false;
  const sourceRows = await rows<TreatmentPlanRow>(context.db.prepare(`
    SELECT TreatmentPlanId,PatientId,EncounterId,PresentingIssues,PatientHistory,Medications,
           AnyOtherRelevantInformation,Diagnosis,TreatmentReceived,RecommendationForFollowUp,
           CreatedById,CreatedAt
    FROM FormTreatmentPlan WHERE tenant_id=? AND TreatmentPlanId>? ORDER BY TreatmentPlanId LIMIT ?
  `).bind(context.tenantId, Number(checkpoint.cursor_value ?? 0), context.remaining + 1));
  const limit = context.remaining;
  for (const row of sourceRows.slice(0, limit)) {
    context.scanned += 1; context.remaining -= 1;
    const sourcePublicId = String(row.TreatmentPlanId);
    const patient = await patientLink(context.db, context.tenantId, row.PatientId);
    const author = await practitioner(context.db, context.tenantId, row.CreatedById);
    const enc = patient ? await encounter(context.db, context.tenantId, 'legacy_encounter', row.EncounterId, patient) : null;
    if (!patient || !author || !enc) {
      await recordIssue(context, {
        issueCode: 'CLINICAL_DOCUMENT_SCOPE_UNRESOLVED', entityType: 'clinical_document',
        sourceType: 'legacy_treatment_plan', sourcePublicId, summary: 'Treatment plan exact scope could not be resolved',
        details: { hasPatient: Boolean(patient), hasEncounter: Boolean(enc), hasAuthor: Boolean(author) },
      });
    } else {
      await createDocument(context, {
        sourceType: 'legacy_treatment_plan', sourcePublicId, sourceTable: 'FormTreatmentPlan',
        patientLinkPublicId: patient, encounterPublicId: enc, authoringPractitionerPublicId: author,
        documentType: 'treatment_plan', authoredAtUtc: normalizedUtc(row.CreatedAt, context.nowUtc),
        contentFormat: 'structured_json', contentPayload: stableCanonicalJson({
          schemaVersion: 1, presentingIssues: row.PresentingIssues, history: row.PatientHistory,
          medications: row.Medications, other: row.AnyOtherRelevantInformation,
          diagnosisText: row.Diagnosis, treatmentReceived: row.TreatmentReceived,
          followUp: row.RecommendationForFollowUp,
        }), status: 'draft',
      });
    }
    checkpoint.cursor_value = sourcePublicId;
  }
  const completed = sourceRows.length <= limit;
  await advanceCheckpoint(context, checkpoint, checkpoint.cursor_value, completed);
  return completed;
}

async function processEncounterSnapshots(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (context.remaining <= 0) return false;
  const sourceRows = await rows<EncounterSnapshotRow>(context.db.prepare(`
    SELECT id,patient_id,provider_id,signed_snapshot,snapshot_hash,signed_by,signed_at,
           signature_version,is_active,created_at,updated_at
    FROM encounters WHERE tenant_id=? AND id>? AND signed_snapshot IS NOT NULL
    ORDER BY id LIMIT ?
  `).bind(context.tenantId, Number(checkpoint.cursor_value ?? 0), context.remaining + 1));
  const limit = context.remaining;
  for (const row of sourceRows.slice(0, limit)) {
    context.scanned += 1; context.remaining -= 1;
    const sourcePublicId = String(row.id);
    const patient = await patientLink(context.db, context.tenantId, row.patient_id);
    const author = await practitioner(context.db, context.tenantId, row.provider_id);
    const signer = await practitioner(context.db, context.tenantId, row.signed_by);
    const enc = patient ? await encounter(context.db, context.tenantId, 'legacy_encounter', row.id, patient) : null;
    const assertedHash = row.snapshot_hash?.trim().toLowerCase() ?? null;
    if (!patient || !author || !signer || !enc || !row.signed_at || !/^[0-9a-f]{64}$/.test(assertedHash ?? '')) {
      await recordIssue(context, {
        issueCode: 'CLINICAL_SIGNATURE_EVIDENCE_INVALID', entityType: 'clinical_document',
        sourceType: 'legacy_encounter_snapshot', sourcePublicId, severity: 'critical',
        summary: 'Signed encounter snapshot evidence is incomplete',
        details: { hasPatient: Boolean(patient), hasEncounter: Boolean(enc), hasAuthor: Boolean(author), hasSigner: Boolean(signer), hasHash: Boolean(assertedHash) },
      });
    } else {
      await createDocument(context, {
        sourceType: 'legacy_encounter_snapshot', sourcePublicId, sourceTable: 'encounters',
        patientLinkPublicId: patient, encounterPublicId: enc, authoringPractitionerPublicId: author,
        documentType: 'encounter_summary', authoredAtUtc: normalizedUtc(row.created_at, context.nowUtc),
        contentFormat: 'plain_text', contentPayload: row.signed_snapshot ?? '', status: 'final',
        signerPractitionerPublicId: signer, signedAtUtc: normalizedUtc(row.signed_at, context.nowUtc),
        assertedContentSha256: assertedHash,
      });
    }
    checkpoint.cursor_value = sourcePublicId;
  }
  const completed = sourceRows.length <= limit;
  await advanceCheckpoint(context, checkpoint, checkpoint.cursor_value, completed);
  return completed;
}

async function processDocumentRecords(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (context.remaining <= 0) return false;
  const sourceRows = await rows<DocumentRecordRow>(context.db.prepare(`
    SELECT id,patient_id,document_type,file_key,file_name,file_size,mime_type,uploaded_by,is_active,created_at
    FROM document_records WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, Number(checkpoint.cursor_value ?? 0), context.remaining + 1));
  const limit = context.remaining;
  for (const row of sourceRows.slice(0, limit)) {
    context.scanned += 1; context.remaining -= 1;
    const sourcePublicId = String(row.id);
    const parent = await mapping(context.db, context.tenantId, 'clinical_attachment_parent', 'legacy_document_record', sourcePublicId);
    if (!parent?.canonical_public_id || parent.mapping_status !== 'mapped' || !parent.evidence_sha256) {
      await recordIssue(context, {
        issueCode: 'CLINICAL_ATTACHMENT_SCOPE_MISSING', entityType: 'clinical_attachment',
        sourceType: 'legacy_document_record', sourcePublicId,
        summary: 'Document record lacks exact clinical document and verified hash scope',
        details: { hasParentMapping: Boolean(parent?.canonical_public_id), hasVerifiedHash: Boolean(parent?.evidence_sha256) },
      });
    }
    checkpoint.cursor_value = sourcePublicId;
  }
  const completed = sourceRows.length <= limit;
  await advanceCheckpoint(context, checkpoint, checkpoint.cursor_value, completed);
  return completed;
}

async function createAttachment(
  context: Context,
  input: {
    sourceType: string; sourcePublicId: string; sourceTable: string; documentPublicId: string;
    attachmentType: string; bodyPartCode: string | null; storageProvider: string; objectReference: string;
    contentSha256: string; fileSizeBytes: number; mimeType: string; originalFilename: string | null;
    uploaderPractitionerPublicId: string; lifecycleStatus: string; occurredAtUtc: string;
  },
): Promise<void> {
  const existing = await existingSourceMapping(context, 'clinical_document_attachment', input.sourceType, input.sourcePublicId);
  if (existing) return;
  const document = await context.db.prepare(`
    SELECT document_public_id,current_version_public_id,patient_link_public_id,encounter_public_id
    FROM canonical_clinical_documents WHERE tenant_id=? AND document_public_id=? LIMIT 1
  `).bind(context.tenantId, input.documentPublicId).first<DocumentRow>();
  if (!document) throw new Error('attachment parent clinical document not found');
  const attachmentPublicId = await createDeterministicSourceId('clatt', context.tenantId, input.sourceType, input.sourcePublicId);
  const evidenceSha256 = await createSourceEvidenceSha256({
    sourceType: input.sourceType, sourcePublicId: input.sourcePublicId,
    documentPublicId: input.documentPublicId, contentSha256: input.contentSha256,
  });
  await context.db.batch([
    context.db.prepare(`
      INSERT INTO canonical_clinical_document_attachments (
        tenant_id,attachment_public_id,document_public_id,version_public_id,
        patient_link_public_id,encounter_public_id,attachment_type,body_part_code,
        storage_provider,object_reference,content_sha256,file_size_bytes,mime_type,
        original_filename,uploader_practitioner_public_id,uploader_user_public_id,
        uploader_system_key,lifecycle_status,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,'canonical.backfill',?,?,?,?)
    `).bind(
      context.tenantId, attachmentPublicId, input.documentPublicId, document.current_version_public_id,
      document.patient_link_public_id, document.encounter_public_id, input.attachmentType,
      input.bodyPartCode, input.storageProvider, input.objectReference, input.contentSha256,
      input.fileSizeBytes, input.mimeType, input.originalFilename, input.uploaderPractitionerPublicId,
      input.lifecycleStatus, evidenceSha256, input.occurredAtUtc, input.occurredAtUtc,
    ),
    mappingStatement(context.db, {
      tenantId: context.tenantId, entityType: 'clinical_document_attachment', canonicalPublicId: attachmentPublicId,
      sourceType: input.sourceType, sourcePublicId: input.sourcePublicId, sourceTable: input.sourceTable,
      migrationRunId: context.runId, evidenceSha256, nowUtc: context.nowUtc,
    }),
  ]);
}

async function processClinicalImages(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (context.remaining <= 0) return false;
  const sourceRows = await rows<ClinicalImageRow>(context.db.prepare(`
    SELECT id,patient_id,visit_id,image_type,file_key,file_name,file_size,mime_type,
           body_part,is_active,uploaded_by,created_at
    FROM clinical_images WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, Number(checkpoint.cursor_value ?? 0), context.remaining + 1));
  const limit = context.remaining;
  for (const row of sourceRows.slice(0, limit)) {
    context.scanned += 1; context.remaining -= 1;
    const sourcePublicId = String(row.id);
    const parent = await mapping(context.db, context.tenantId, 'clinical_attachment_parent', 'legacy_clinical_image', sourcePublicId);
    const uploader = await practitioner(context.db, context.tenantId, row.uploaded_by);
    const patient = await patientLink(context.db, context.tenantId, row.patient_id);
    const enc = patient ? await encounter(context.db, context.tenantId, 'legacy_visit', row.visit_id, patient) : null;
    if (!parent?.canonical_public_id || parent.mapping_status !== 'mapped' || !parent.evidence_sha256 || !uploader || !patient || !enc || !row.mime_type) {
      await recordIssue(context, {
        issueCode: 'CLINICAL_ATTACHMENT_SCOPE_MISSING', entityType: 'clinical_attachment',
        sourceType: 'legacy_clinical_image', sourcePublicId,
        summary: 'Clinical image lacks exact document, scope, uploader, MIME, or verified hash evidence',
        details: {
          hasParentMapping: Boolean(parent?.canonical_public_id), hasVerifiedHash: Boolean(parent?.evidence_sha256),
          hasUploader: Boolean(uploader), hasPatient: Boolean(patient), hasEncounter: Boolean(enc), hasMime: Boolean(row.mime_type),
        },
      });
    } else {
      await createAttachment(context, {
        sourceType: 'legacy_clinical_image', sourcePublicId, sourceTable: 'clinical_images',
        documentPublicId: parent.canonical_public_id, attachmentType: 'clinical_image',
        bodyPartCode: row.body_part, storageProvider: 'legacy_object_store', objectReference: row.file_key,
        contentSha256: parent.evidence_sha256, fileSizeBytes: Math.max(0, Number(row.file_size ?? 0)),
        mimeType: row.mime_type, originalFilename: row.file_name, uploaderPractitionerPublicId: uploader,
        lifecycleStatus: row.is_active === 0 ? 'entered_in_error' : 'active',
        occurredAtUtc: normalizedUtc(row.created_at, context.nowUtc),
      });
    }
    checkpoint.cursor_value = sourcePublicId;
  }
  const completed = sourceRows.length <= limit;
  await advanceCheckpoint(context, checkpoint, checkpoint.cursor_value, completed);
  return completed;
}

async function processClinicalDiagnoses(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (context.remaining <= 0) return false;
  const sourceRows = await rows<ClinicalDiagnosisRow>(context.db.prepare(`
    SELECT DiagnosisId,PatientId,PatientVisitId,ICD10Code,ICD10Description,
           icd11_code,icd11_title,DiagnosisType,IsActive,CreatedBy,CreatedOn,
           ModifiedOn,review_status,reviewed_by,reviewed_at
    FROM ClinicalDiagnosis WHERE tenant_id=? AND DiagnosisId>? ORDER BY DiagnosisId LIMIT ?
  `).bind(context.tenantId, Number(checkpoint.cursor_value ?? 0), context.remaining + 1));
  const limit = context.remaining;
  for (const row of sourceRows.slice(0, limit)) {
    context.scanned += 1; context.remaining -= 1;
    const sourcePublicId = String(row.DiagnosisId);
    const existing = await existingSourceMapping(context, 'diagnosis_assertion', 'legacy_clinical_diagnosis', sourcePublicId);
    if (!existing) {
      const patient = await patientLink(context.db, context.tenantId, row.PatientId);
      const enc = patient ? await encounter(context.db, context.tenantId, 'legacy_visit', row.PatientVisitId, patient) : null;
      const author = await practitioner(context.db, context.tenantId, row.CreatedBy);
      const reviewStatus = row.review_status?.trim().toLowerCase() ?? 'unverified';
      const verificationStatus = ['verified', 'reviewed', 'approved'].includes(reviewStatus)
        ? 'verified'
        : ['refuted', 'rejected'].includes(reviewStatus)
          ? 'refuted'
          : 'provisional';
      const reviewer = verificationStatus === 'provisional'
        ? null
        : await practitioner(context.db, context.tenantId, row.reviewed_by);
      const codeSystem = row.icd11_code?.trim() ? 'icd11' : 'icd10';
      const code = row.icd11_code?.trim() || row.ICD10Code?.trim() || '';
      const display = row.icd11_title?.trim() || row.ICD10Description?.trim() || '';
      if (!patient || !enc || !author || (verificationStatus !== 'provisional' && !reviewer) || !code || !display) {
        await recordIssue(context, {
          issueCode: !code ? 'CLINICAL_DIAGNOSIS_CODE_INVALID' : 'CLINICAL_DIAGNOSIS_SCOPE_UNRESOLVED',
          entityType: 'diagnosis_assertion', sourceType: 'legacy_clinical_diagnosis', sourcePublicId,
          summary: 'Clinical diagnosis exact scope, reviewer, or code evidence is incomplete',
          details: {
            hasPatient: Boolean(patient), hasEncounter: Boolean(enc), hasAuthor: Boolean(author),
            hasReviewer: verificationStatus === 'provisional' ? null : Boolean(reviewer), hasCode: Boolean(code),
          },
        });
      } else {
        const diagnosisPublicId = await createDeterministicSourceId('diag', context.tenantId, 'legacy_clinical_diagnosis', sourcePublicId);
        const eventPublicId = await createDeterministicSourceId('diagevt', context.tenantId, 'legacy_clinical_diagnosis', `${sourcePublicId}:event:1`);
        const evidenceSha256 = await createSourceEvidenceSha256({
          sourceType: 'legacy_clinical_diagnosis', sourcePublicId, patient, encounter: enc,
          author, reviewer, codeSystem, code, verificationStatus,
        });
        const requestFingerprintSha256 = await createRequestFingerprint({ diagnosisPublicId, evidenceSha256 });
        const assertedAtUtc = normalizedUtc(row.CreatedOn, context.nowUtc);
        const reviewedAtUtc = verificationStatus === 'provisional'
          ? null : normalizedUtc(row.reviewed_at ?? row.ModifiedOn, context.nowUtc);
        const clinicalStatus = row.IsActive === 0 ? 'inactive' : 'active';
        await context.db.batch([
          context.db.prepare(`
            INSERT INTO canonical_diagnosis_assertions (
              tenant_id,diagnosis_public_id,patient_link_public_id,encounter_public_id,
              asserting_practitioner_public_id,supporting_document_public_id,
              supporting_version_public_id,code_system,code_system_version,code,
              display_snapshot,coding_public_id,diagnosis_role,certainty,clinical_status,
              verification_status,status_version,asserted_at_utc,reviewed_at_utc,
              resolved_at_utc,entered_in_error_at_utc,idempotency_key,
              request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
            ) VALUES (?,?,?,?,?,NULL,NULL,?,NULL,?,?,NULL,?,'confirmed',?,?,1,?,?,NULL,NULL,?,?,?,?,?)
          `).bind(
            context.tenantId, diagnosisPublicId, patient, enc, author, codeSystem, code, display,
            diagnosisRole(row.DiagnosisType), clinicalStatus, verificationStatus, assertedAtUtc,
            reviewedAtUtc, `backfill:legacy_clinical_diagnosis:${sourcePublicId}`,
            requestFingerprintSha256, evidenceSha256, context.nowUtc, context.nowUtc,
          ),
          context.db.prepare(`
            INSERT INTO canonical_diagnosis_status_events (
              tenant_id,event_public_id,diagnosis_public_id,from_verification_status,
              to_verification_status,from_clinical_status,to_clinical_status,event_version,
              event_type,reason_code,actor_practitioner_public_id,actor_user_public_id,
              actor_system_key,occurred_at_utc,source_evidence_sha256,created_at_utc
            ) VALUES (?,?,?,NULL,?,NULL,?,1,'asserted','legacy_backfill',?,NULL,'canonical.backfill',?,?,?)
          `).bind(
            context.tenantId, eventPublicId, diagnosisPublicId, verificationStatus,
            clinicalStatus, author, assertedAtUtc, evidenceSha256, context.nowUtc,
          ),
          mappingStatement(context.db, {
            tenantId: context.tenantId, entityType: 'diagnosis_assertion', canonicalPublicId: diagnosisPublicId,
            sourceType: 'legacy_clinical_diagnosis', sourcePublicId, sourceTable: 'ClinicalDiagnosis',
            migrationRunId: context.runId, evidenceSha256, nowUtc: context.nowUtc,
          }),
        ]);
      }
    }
    checkpoint.cursor_value = sourcePublicId;
  }
  const completed = sourceRows.length <= limit;
  await advanceCheckpoint(context, checkpoint, checkpoint.cursor_value, completed);
  return completed;
}

async function processFinalDiagnoses(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (context.remaining <= 0) return false;
  const sourceRows = await rows<FinalDiagnosisRow>(context.db.prepare(`
    SELECT fd.id,fd.patient_id,fd.visit_id,fd.is_primary,fd.is_active,fd.created_by,
           fd.created_at,fd.updated_at,ic.code,ic.description,fd.icd11_code,fd.icd11_title
    FROM final_diagnosis fd
    LEFT JOIN icd10_codes ic ON ic.id=fd.icd10_id AND ic.tenant_id=fd.tenant_id
    WHERE fd.tenant_id=? AND fd.id>? ORDER BY fd.id LIMIT ?
  `).bind(context.tenantId, Number(checkpoint.cursor_value ?? 0), context.remaining + 1));
  const limit = context.remaining;
  for (const row of sourceRows.slice(0, limit)) {
    context.scanned += 1; context.remaining -= 1;
    const sourcePublicId = String(row.id);
    await recordIssue(context, {
      issueCode: 'CLINICAL_FINAL_DIAGNOSIS_UNVERIFIED', entityType: 'diagnosis_assertion',
      sourceType: 'legacy_final_diagnosis', sourcePublicId,
      summary: 'Final diagnosis lacks independent review/signature evidence and was not promoted',
      details: { hasCode: Boolean(row.icd11_code?.trim() || row.code?.trim()), hasReviewEvidence: false, isPrimary: row.is_primary === 1 },
    });
    checkpoint.cursor_value = sourcePublicId;
  }
  const completed = sourceRows.length <= limit;
  await advanceCheckpoint(context, checkpoint, checkpoint.cursor_value, completed);
  return completed;
}

async function processProjectionDisposition(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (context.remaining <= 0) return false;
  const sourceRows = await rows<ProjectionRow>(context.db.prepare(`
    SELECT id,icd10_code,icd11_code FROM visits
    WHERE tenant_id=? AND id>? AND (icd10_code IS NOT NULL OR icd11_code IS NOT NULL)
    ORDER BY id LIMIT ?
  `).bind(context.tenantId, Number(checkpoint.cursor_value ?? 0), context.remaining + 1));
  const limit = context.remaining;
  for (const row of sourceRows.slice(0, limit)) {
    context.scanned += 1; context.remaining -= 1;
    const sourcePublicId = String(row.id);
    await recordIssue(context, {
      issueCode: 'CLINICAL_PROJECTION_NOT_AUTHORITY', entityType: 'clinical_projection',
      sourceType: 'legacy_visit_diagnosis_projection', sourcePublicId, severity: 'warning',
      summary: 'Visit diagnosis projection was retained as consumer evidence, not promoted as diagnosis authority',
      details: { hasIcd10Projection: Boolean(row.icd10_code), hasIcd11Projection: Boolean(row.icd11_code) },
    });
    checkpoint.cursor_value = sourcePublicId;
  }
  const completed = sourceRows.length <= limit;
  await advanceCheckpoint(context, checkpoint, checkpoint.cursor_value, completed);
  return completed;
}

const partitions: Partition[] = [
  { sourceType: 'legacy_clinical_note', partitionKey: 'clinical_notes_headers', process: processClinicalNotes },
  { sourceType: 'legacy_clinical_note', partitionKey: 'clinical_notes_versions_signatures', process: async (context, checkpoint) => {
    // Versions and signatures are committed atomically with the header partition.
    await advanceCheckpoint(context, checkpoint, checkpoint.cursor_value, true); return true;
  } },
  { sourceType: 'legacy_form_soap', partitionKey: 'form_soap_documents', process: processSoap },
  { sourceType: 'legacy_treatment_plan', partitionKey: 'form_treatment_plan_documents', process: processTreatmentPlans },
  { sourceType: 'legacy_encounter_snapshot', partitionKey: 'signed_encounter_snapshots', process: processEncounterSnapshots },
  { sourceType: 'legacy_document_record', partitionKey: 'document_record_attachments', process: processDocumentRecords },
  { sourceType: 'legacy_clinical_image', partitionKey: 'clinical_image_attachments', process: processClinicalImages },
  { sourceType: 'legacy_clinical_diagnosis', partitionKey: 'clinical_diagnosis_assertions', process: processClinicalDiagnoses },
  { sourceType: 'legacy_final_diagnosis', partitionKey: 'final_diagnosis_assertions', process: processFinalDiagnoses },
  { sourceType: 'legacy_visit_diagnosis_projection', partitionKey: 'projection_duplicate_disposition', process: processProjectionDisposition },
];

export async function backfillClinicalDocumentDiagnosis(
  db: ClinicalDocumentDiagnosisBackfillDatabase,
  raw: ClinicalDocumentDiagnosisBackfillOptions,
): Promise<ClinicalDocumentDiagnosisBackfillResult> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const runPublicId = exact(raw.runPublicId, 'runPublicId');
  const nowUtc = normalizedUtc(raw.nowUtc, raw.nowUtc);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  const starting = await captureCounts(db, tenantId);
  const context: Context = {
    db, tenantId, runId: run.id, runPublicId, nowUtc,
    remaining: sourceLimit(raw.maxSourceRecords), scanned: 0, skipped: 0,
  };
  let allCompleted = true;
  try {
    for (const partition of partitions) {
      const checkpoint = await ensureCheckpoint(db, {
        tenantId, runId: run.id, runPublicId, sourceType: partition.sourceType,
        partitionKey: partition.partitionKey, nowUtc,
      });
      if (checkpoint.status === 'completed') continue;
      if (context.remaining <= 0) { allCompleted = false; break; }
      const completed = await partition.process(context, checkpoint);
      if (!completed) { allCompleted = false; break; }
    }
    if (allCompleted) {
      const incomplete = await count(db, `
        SELECT COUNT(*) AS count FROM canonical_backfill_checkpoints
        WHERE tenant_id=? AND migration_run_id=? AND entity_type=? AND status!='completed'
      `, [tenantId, run.id, ENTITY_TYPE]);
      allCompleted = incomplete === 0;
    }
    const result = await resultFromDelta(db, context, starting, allCompleted);
    await db.prepare(`
      UPDATE canonical_migration_runs
      SET status=?,completed_at_utc=?,result_summary_json=?,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(
      allCompleted ? 'succeeded' : 'running',
      allCompleted ? nowUtc : null,
      stableCanonicalJson({ schemaVersion: 1, completed: allCompleted, counts: result.counts }),
      nowUtc,
      tenantId,
      run.id,
    ).run();
    return result;
  } catch (error) {
    await db.prepare(`
      UPDATE canonical_migration_runs
      SET status='failed',completed_at_utc=?,error_code='CDB_122D_BACKFILL_FAILED',
          error_summary=?,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(
      nowUtc,
      error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      nowUtc,
      tenantId,
      run.id,
    ).run();
    throw error;
  }
}
