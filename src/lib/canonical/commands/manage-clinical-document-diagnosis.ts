import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { createRequestFingerprint } from '../idempotency';
import { createDeterministicSourceId } from '../source-mapping';
import { toUtcIso } from '../time';

export type CanonicalClinicalDocumentStatus = 'draft' | 'final' | 'amended' | 'retracted' | 'entered_in_error';
export type CanonicalClinicalDocumentScope = 'patient' | 'encounter';
export type CanonicalClinicalDocumentType =
  | 'progress_note'
  | 'soap_note'
  | 'consultation_note'
  | 'doctor_round_note'
  | 'treatment_plan'
  | 'encounter_summary'
  | 'discharge_summary'
  | 'procedure_note'
  | 'operative_note'
  | 'referral_note'
  | 'other';
export type CanonicalClinicalDocumentContentFormat =
  | 'plain_text'
  | 'soap_json'
  | 'structured_json'
  | 'markdown'
  | 'html'
  | 'fhir_composition_json';
export type CanonicalClinicalDocumentSignatureMethod =
  | 'authenticated_attestation'
  | 'digital_signature'
  | 'imported_legacy_signature'
  | 'system_seal';
export type CanonicalDiagnosisRole = 'primary' | 'secondary' | 'admitting' | 'discharge' | 'differential' | 'other';
export type CanonicalDiagnosisCertainty = 'suspected' | 'probable' | 'confirmed' | 'ruled_out' | 'unknown';
export type CanonicalDiagnosisClinicalStatus = 'active' | 'resolved' | 'inactive' | 'unknown';
export type CanonicalDiagnosisVerificationStatus =
  | 'unverified'
  | 'provisional'
  | 'verified'
  | 'refuted'
  | 'entered_in_error';
export type CanonicalDiagnosisEventType =
  | 'asserted'
  | 'reviewed'
  | 'confirmed'
  | 'refuted'
  | 'resolved'
  | 'reopened'
  | 'entered_in_error';

interface CommandActorInput {
  actorUserPublicId?: string | null;
  actorSystemKey?: string | null;
  actorPractitionerPublicId?: string | null;
}

interface CommandBaseInput extends CommandActorInput {
  tenantId: string;
  idempotencyKey: string;
  eventPublicId?: string;
  occurredAtUtc: string;
  businessDate: string;
}

interface ClinicalContentInput {
  contentFormat: CanonicalClinicalDocumentContentFormat;
  contentPayload?: string | null;
  encryptedPayloadReference?: string | null;
  encryptionKeyVersion?: string | null;
  contentSha256: string;
  sectionManifestJson?: string | null;
}

interface SourceInput {
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
}

export interface CreateCanonicalClinicalDocumentDraftInput extends CommandBaseInput, ClinicalContentInput, SourceInput {
  documentPublicId?: string;
  versionPublicId?: string;
  patientLinkPublicId: string;
  encounterPublicId?: string | null;
  scopeKind: CanonicalClinicalDocumentScope;
  authoringPractitionerPublicId: string;
  documentType: CanonicalClinicalDocumentType;
  confidentialityCode?: 'normal' | 'restricted' | 'very_restricted';
  authoredAtUtc: string;
}

export interface ReplaceCanonicalClinicalDocumentDraftInput extends CommandBaseInput, ClinicalContentInput, SourceInput {
  documentPublicId: string;
  expectedVersion: number;
  versionPublicId?: string;
}

export interface SignCanonicalClinicalDocumentInput extends CommandBaseInput, SourceInput {
  documentPublicId: string;
  expectedVersion: number;
  versionPublicId: string;
  signaturePublicId?: string;
  signerPractitionerPublicId: string;
  signatureMethod: CanonicalClinicalDocumentSignatureMethod;
  signedContentSha256: string;
  attestationSha256: string;
  signingKeyReference?: string | null;
}

export interface AmendCanonicalClinicalDocumentInput extends CommandBaseInput, ClinicalContentInput, SourceInput {
  documentPublicId: string;
  expectedVersion: number;
  versionPublicId?: string;
  signaturePublicId?: string;
  signerPractitionerPublicId: string;
  signatureMethod: CanonicalClinicalDocumentSignatureMethod;
  attestationSha256: string;
  signingKeyReference?: string | null;
}

export interface EnterCanonicalClinicalDocumentInErrorInput extends CommandBaseInput {
  documentPublicId: string;
  expectedVersion: number;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface AttachCanonicalClinicalDocumentArtifactInput extends CommandBaseInput, SourceInput {
  documentPublicId: string;
  versionPublicId?: string | null;
  attachmentPublicId?: string;
  attachmentType: 'clinical_image' | 'scanned_document' | 'external_report' | 'audio' | 'video' | 'other';
  bodyPartCode?: string | null;
  storageProvider: string;
  objectReference: string;
  contentSha256: string;
  fileSizeBytes: number;
  mimeType: string;
  originalFilename?: string | null;
  uploaderPractitionerPublicId?: string | null;
  uploaderUserPublicId?: string | null;
  uploaderSystemKey?: string | null;
}

export interface AssertCanonicalDiagnosisInput extends CommandBaseInput, SourceInput {
  diagnosisPublicId?: string;
  diagnosisEventPublicId?: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  assertingPractitionerPublicId: string;
  supportingDocumentPublicId?: string | null;
  supportingVersionPublicId?: string | null;
  codeSystem: 'icd10' | 'icd11' | 'snomed_ct' | 'local' | 'other';
  codeSystemVersion?: string | null;
  code: string;
  displaySnapshot: string;
  codingPublicId?: string | null;
  diagnosisRole: CanonicalDiagnosisRole;
  certainty: CanonicalDiagnosisCertainty;
  clinicalStatus: CanonicalDiagnosisClinicalStatus;
  verificationStatus: CanonicalDiagnosisVerificationStatus;
}

export interface ReviewCanonicalDiagnosisInput extends CommandBaseInput {
  diagnosisPublicId: string;
  diagnosisEventPublicId?: string;
  expectedVersion: number;
  reviewerPractitionerPublicId: string;
  toVerificationStatus: 'verified' | 'refuted' | 'entered_in_error';
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface TransitionCanonicalDiagnosisInput extends CommandBaseInput {
  diagnosisPublicId: string;
  diagnosisEventPublicId?: string;
  expectedVersion: number;
  toClinicalStatus: CanonicalDiagnosisClinicalStatus;
  toVerificationStatus: CanonicalDiagnosisVerificationStatus;
  eventType: Exclude<CanonicalDiagnosisEventType, 'asserted' | 'reviewed'>;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface CanonicalClinicalDocumentCommandResult {
  documentPublicId: string;
  currentVersionPublicId: string;
  currentStatus: CanonicalClinicalDocumentStatus;
  statusVersion: number;
}

export interface CanonicalClinicalDocumentAttachmentResult {
  attachmentPublicId: string;
  documentPublicId: string;
  versionPublicId: string | null;
  lifecycleStatus: 'active';
}

export interface CanonicalDiagnosisCommandResult {
  diagnosisPublicId: string;
  clinicalStatus: CanonicalDiagnosisClinicalStatus;
  verificationStatus: CanonicalDiagnosisVerificationStatus;
  statusVersion: number;
}

interface NormalizedActor {
  actorUserPublicId: string | null;
  actorSystemKey: string | null;
  actorPractitionerPublicId: string | null;
}

interface NormalizedBase extends NormalizedActor {
  tenantId: string;
  idempotencyKey: string;
  occurredAtUtc: string;
  businessDate: string;
}

interface DocumentRow {
  patient_link_public_id: string;
  encounter_public_id: string | null;
  scope_kind: CanonicalClinicalDocumentScope;
  authoring_practitioner_public_id: string;
  document_type: CanonicalClinicalDocumentType;
  current_version_public_id: string | null;
  current_status: CanonicalClinicalDocumentStatus;
  status_version: number;
  confidentiality_code: 'normal' | 'restricted' | 'very_restricted';
}

interface VersionRow {
  version_public_id: string;
  version_number: number;
  version_kind: 'draft' | 'final' | 'amendment' | 'retraction' | 'entered_in_error';
  content_sha256: string;
  content_format: CanonicalClinicalDocumentContentFormat;
}

interface DiagnosisRow {
  patient_link_public_id: string;
  encounter_public_id: string;
  asserting_practitioner_public_id: string;
  clinical_status: CanonicalDiagnosisClinicalStatus;
  verification_status: CanonicalDiagnosisVerificationStatus;
  status_version: number;
}

interface SourceMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

const CREATE_DRAFT = 'createCanonicalClinicalDocumentDraft';
const REPLACE_DRAFT = 'replaceCanonicalClinicalDocumentDraft';
const SIGN_DOCUMENT = 'signCanonicalClinicalDocument';
const AMEND_DOCUMENT = 'amendCanonicalClinicalDocument';
const ENTER_DOCUMENT_ERROR = 'enterCanonicalClinicalDocumentInError';
const ATTACH_ARTIFACT = 'attachCanonicalClinicalDocumentArtifact';
const ASSERT_DIAGNOSIS = 'assertCanonicalDiagnosis';
const REVIEW_DIAGNOSIS = 'reviewCanonicalDiagnosis';
const TRANSITION_DIAGNOSIS = 'transitionCanonicalDiagnosis';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return exact(value, label);
}

function sha256(value: string, label: string): string {
  const normalized = exact(value, label);
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  return normalized;
}

function utc(value: string, label: string): string {
  const normalized = toUtcIso(value);
  if (normalized !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return normalized;
}

function positive(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative integer`);
  return value;
}

function normalizeActor(raw: CommandActorInput, requireActor = true): NormalizedActor {
  const actorUserPublicId = optionalExact(raw.actorUserPublicId, 'actorUserPublicId');
  const actorSystemKey = optionalExact(raw.actorSystemKey, 'actorSystemKey');
  const actorPractitionerPublicId = optionalExact(raw.actorPractitionerPublicId, 'actorPractitionerPublicId');
  if (requireActor && actorUserPublicId == null && actorSystemKey == null && actorPractitionerPublicId == null) {
    throw new TypeError('one command actor is required');
  }
  return { actorUserPublicId, actorSystemKey, actorPractitionerPublicId };
}

function normalizeBase(raw: CommandBaseInput, requireActor = true): NormalizedBase {
  return {
    tenantId: exact(raw.tenantId, 'tenantId'),
    idempotencyKey: exact(raw.idempotencyKey, 'idempotencyKey'),
    occurredAtUtc: utc(raw.occurredAtUtc, 'occurredAtUtc'),
    businessDate: exact(raw.businessDate, 'businessDate'),
    ...normalizeActor(raw, requireActor),
  };
}

async function deterministicId(
  prefix: string,
  tenantId: string,
  sourceType: string,
  sourcePublicId: string,
  supplied: string | null | undefined,
  label: string,
): Promise<string> {
  return supplied == null
    ? createDeterministicSourceId(prefix, tenantId, sourceType, sourcePublicId)
    : exact(supplied, label);
}

async function outboxEventId(
  tenantId: string,
  commandName: string,
  idempotencyKey: string,
  supplied: string | undefined,
): Promise<string> {
  return supplied == null
    ? createDeterministicSourceId('evt', tenantId, commandName, idempotencyKey)
    : exact(supplied, 'eventPublicId');
}

async function requirePatientLink(db: CanonicalBatchDatabase, tenantId: string, patientLinkPublicId: string): Promise<void> {
  const row = await db.prepare(`
    SELECT link_status,effective_to_utc FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(tenantId, patientLinkPublicId).first<{ link_status: string; effective_to_utc: string | null }>();
  if (!row) throw new Error('patient link not found');
  if (row.link_status === 'rejected' || row.link_status === 'retired' || row.effective_to_utc != null) {
    throw new Error('clinical command requires an active patient link');
  }
}

async function requireEncounterScope(
  db: CanonicalBatchDatabase,
  tenantId: string,
  encounterPublicId: string,
  patientLinkPublicId: string,
): Promise<void> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,status FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(tenantId, encounterPublicId).first<{ patient_link_public_id: string | null; status: string }>();
  if (!row) throw new Error('encounter not found');
  if (row.patient_link_public_id !== patientLinkPublicId) throw new Error('encounter patient link mismatch');
  if (row.status === 'entered_in_error') throw new Error('clinical command requires a valid encounter');
}

async function requireActivePractitioner(
  db: CanonicalBatchDatabase,
  tenantId: string,
  practitionerPublicId: string,
): Promise<void> {
  const row = await db.prepare(`
    SELECT status FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=? LIMIT 1
  `).bind(tenantId, practitionerPublicId).first<{ status: string }>();
  if (!row || row.status !== 'active') throw new Error('clinical command requires an active practitioner');
}

async function requireSourceMappingAvailable(
  db: CanonicalBatchDatabase,
  input: { tenantId: string; entityType: string; sourceType: string; sourcePublicId: string; canonicalPublicId: string },
): Promise<void> {
  const row = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(input.tenantId, input.entityType, input.sourceType, input.sourcePublicId).first<SourceMappingRow>();
  if (!row) return;
  if (row.mapping_status !== 'mapped' || row.canonical_public_id !== input.canonicalPublicId) {
    throw new Error(`${input.entityType} source mapping already belongs to another canonical record`);
  }
  throw new Error(`${input.entityType} source mapping already exists without replay evidence`);
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: string;
    canonicalPublicId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    evidenceSha256: string;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,'mapped',1,NULL,?,?,?)
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.evidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

async function requireDocument(db: CanonicalBatchDatabase, tenantId: string, documentPublicId: string): Promise<DocumentRow> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,encounter_public_id,scope_kind,
           authoring_practitioner_public_id,document_type,current_version_public_id,
           current_status,status_version,confidentiality_code
    FROM canonical_clinical_documents
    WHERE tenant_id=? AND document_public_id=? LIMIT 1
  `).bind(tenantId, documentPublicId).first<DocumentRow>();
  if (!row) throw new Error('clinical document not found');
  return row;
}

async function requireDocumentVersion(
  db: CanonicalBatchDatabase,
  tenantId: string,
  documentPublicId: string,
  versionPublicId: string,
): Promise<VersionRow> {
  const row = await db.prepare(`
    SELECT version_public_id,version_number,version_kind,content_sha256,content_format
    FROM canonical_clinical_document_versions
    WHERE tenant_id=? AND document_public_id=? AND version_public_id=? LIMIT 1
  `).bind(tenantId, documentPublicId, versionPublicId).first<VersionRow>();
  if (!row) throw new Error('clinical document version not found');
  return row;
}

async function requireDiagnosis(db: CanonicalBatchDatabase, tenantId: string, diagnosisPublicId: string): Promise<DiagnosisRow> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,encounter_public_id,asserting_practitioner_public_id,
           clinical_status,verification_status,status_version
    FROM canonical_diagnosis_assertions
    WHERE tenant_id=? AND diagnosis_public_id=? LIMIT 1
  `).bind(tenantId, diagnosisPublicId).first<DiagnosisRow>();
  if (!row) throw new Error('canonical diagnosis not found');
  return row;
}

function normalizeContent(raw: ClinicalContentInput): {
  contentFormat: CanonicalClinicalDocumentContentFormat;
  contentPayload: string | null;
  encryptedPayloadReference: string | null;
  encryptionKeyVersion: string | null;
  contentSha256: string;
  sectionManifestJson: string | null;
} {
  const contentFormat = exact(raw.contentFormat, 'contentFormat') as CanonicalClinicalDocumentContentFormat;
  const contentPayload = optionalExact(raw.contentPayload, 'contentPayload');
  const encryptedPayloadReference = optionalExact(raw.encryptedPayloadReference, 'encryptedPayloadReference');
  const encryptionKeyVersion = optionalExact(raw.encryptionKeyVersion, 'encryptionKeyVersion');
  if (
    (contentPayload != null && (encryptedPayloadReference != null || encryptionKeyVersion != null))
    || (contentPayload == null && (encryptedPayloadReference == null || encryptionKeyVersion == null))
  ) {
    throw new TypeError('provide exactly one inline content payload or encrypted payload reference with key version');
  }
  const sectionManifestJson = optionalExact(raw.sectionManifestJson, 'sectionManifestJson');
  if (sectionManifestJson != null) {
    try {
      JSON.parse(sectionManifestJson);
    } catch {
      throw new TypeError('sectionManifestJson must be valid JSON');
    }
  }
  return {
    contentFormat,
    contentPayload,
    encryptedPayloadReference,
    encryptionKeyVersion,
    contentSha256: sha256(raw.contentSha256, 'contentSha256'),
    sectionManifestJson,
  };
}

function documentResult(
  documentPublicId: string,
  currentVersionPublicId: string,
  currentStatus: CanonicalClinicalDocumentStatus,
  statusVersion: number,
): CanonicalClinicalDocumentCommandResult {
  return { documentPublicId, currentVersionPublicId, currentStatus, statusVersion };
}

export async function createCanonicalClinicalDocumentDraft(
  db: CanonicalBatchDatabase,
  raw: CreateCanonicalClinicalDocumentDraftInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalClinicalDocumentCommandResult>> {
  const base = normalizeBase(raw);
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const documentPublicId = await deterministicId('cldoc', base.tenantId, sourceType, sourcePublicId, raw.documentPublicId, 'documentPublicId');
  const versionPublicId = await deterministicId('cldver', base.tenantId, sourceType, `${sourcePublicId}:v1`, raw.versionPublicId, 'versionPublicId');
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const encounterPublicId = optionalExact(raw.encounterPublicId, 'encounterPublicId');
  const scopeKind = raw.scopeKind;
  if ((scopeKind === 'patient' && encounterPublicId != null) || (scopeKind === 'encounter' && encounterPublicId == null)) {
    throw new TypeError('scopeKind and encounterPublicId are inconsistent');
  }
  const authoringPractitionerPublicId = exact(raw.authoringPractitionerPublicId, 'authoringPractitionerPublicId');
  const documentType = raw.documentType;
  const confidentialityCode = raw.confidentialityCode ?? 'normal';
  const authoredAtUtc = utc(raw.authoredAtUtc, 'authoredAtUtc');
  const content = normalizeContent(raw);
  const request = {
    documentPublicId,
    versionPublicId,
    patientLinkPublicId,
    encounterPublicId,
    scopeKind,
    authoringPractitionerPublicId,
    documentType,
    confidentialityCode,
    authoredAtUtc,
    ...content,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalClinicalDocumentCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: CREATE_DRAFT,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  await requirePatientLink(db, base.tenantId, patientLinkPublicId);
  if (encounterPublicId != null) await requireEncounterScope(db, base.tenantId, encounterPublicId, patientLinkPublicId);
  await requireActivePractitioner(db, base.tenantId, authoringPractitionerPublicId);
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'clinical_document',
    sourceType,
    sourcePublicId,
    canonicalPublicId: documentPublicId,
  });
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'clinical_document_version',
    sourceType,
    sourcePublicId: `${sourcePublicId}:v1`,
    canonicalPublicId: versionPublicId,
  });
  const fingerprint = await createRequestFingerprint(request);
  const result = documentResult(documentPublicId, versionPublicId, 'draft', 1);
  const resolvedEventPublicId = await outboxEventId(base.tenantId, CREATE_DRAFT, base.idempotencyKey, raw.eventPublicId);

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: CREATE_DRAFT,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_clinical_documents (
          tenant_id,document_public_id,patient_link_public_id,encounter_public_id,
          scope_kind,authoring_practitioner_public_id,document_type,current_version_public_id,
          current_status,status_version,confidentiality_code,authored_at_utc,
          finalized_at_utc,entered_in_error_at_utc,idempotency_key,
          request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,NULL,'draft',1,?,?,NULL,NULL,?,?,?,?,?)
      `).bind(
        base.tenantId,
        documentPublicId,
        patientLinkPublicId,
        encounterPublicId,
        scopeKind,
        authoringPractitionerPublicId,
        documentType,
        confidentialityCode,
        authoredAtUtc,
        base.idempotencyKey,
        fingerprint,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.occurredAtUtc,
      ),
      db.prepare(`
        INSERT INTO canonical_clinical_document_versions (
          tenant_id,version_public_id,document_public_id,version_number,
          supersedes_version_public_id,version_kind,content_format,content_payload,
          encrypted_payload_reference,encryption_key_version,content_sha256,
          section_manifest_json,authoring_practitioner_public_id,actor_user_public_id,
          actor_system_key,authored_at_utc,finalized_at_utc,source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,1,NULL,'draft',?,?,?,?,?,?,?,?,?,?,NULL,?,?)
      `).bind(
        base.tenantId,
        versionPublicId,
        documentPublicId,
        content.contentFormat,
        content.contentPayload,
        content.encryptedPayloadReference,
        content.encryptionKeyVersion,
        content.contentSha256,
        content.sectionManifestJson,
        authoringPractitionerPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        authoredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      db.prepare(`
        UPDATE canonical_clinical_documents
        SET current_version_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND document_public_id=? AND current_version_public_id IS NULL
      `).bind(versionPublicId, base.occurredAtUtc, base.tenantId, documentPublicId),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'clinical_document',
        canonicalPublicId: documentPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'clinical_document_version',
        canonicalPublicId: versionPublicId,
        sourceType,
        sourcePublicId: `${sourcePublicId}:v1`,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: resolvedEventPublicId,
      aggregateType: 'canonical_clinical_document',
      aggregatePublicId: documentPublicId,
      eventType: 'canonical.clinical-document.draft-created',
      eventVersion: 1,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function replaceCanonicalClinicalDocumentDraft(
  db: CanonicalBatchDatabase,
  raw: ReplaceCanonicalClinicalDocumentDraftInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalClinicalDocumentCommandResult>> {
  const base = normalizeBase(raw);
  const documentPublicId = exact(raw.documentPublicId, 'documentPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const versionPublicId = await deterministicId('cldver', base.tenantId, sourceType, sourcePublicId, raw.versionPublicId, 'versionPublicId');
  const content = normalizeContent(raw);
  const request = {
    documentPublicId,
    expectedVersion,
    versionPublicId,
    ...content,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalClinicalDocumentCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: REPLACE_DRAFT,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const document = await requireDocument(db, base.tenantId, documentPublicId);
  if (Number(document.status_version) !== expectedVersion) throw new Error('clinical document version conflict');
  if (document.current_status !== 'draft' || document.current_version_public_id == null) {
    throw new Error('replace requires a current draft clinical document');
  }
  const currentVersion = await requireDocumentVersion(db, base.tenantId, documentPublicId, document.current_version_public_id);
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'clinical_document_version',
    sourceType,
    sourcePublicId,
    canonicalPublicId: versionPublicId,
  });
  const nextStatusVersion = expectedVersion + 1;
  const nextVersionNumber = Number(currentVersion.version_number) + 1;
  const fingerprint = await createRequestFingerprint(request);
  const result = documentResult(documentPublicId, versionPublicId, 'draft', nextStatusVersion);
  const resolvedEventPublicId = await outboxEventId(base.tenantId, REPLACE_DRAFT, base.idempotencyKey, raw.eventPublicId);

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: REPLACE_DRAFT,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_clinical_document_versions (
          tenant_id,version_public_id,document_public_id,version_number,
          supersedes_version_public_id,version_kind,content_format,content_payload,
          encrypted_payload_reference,encryption_key_version,content_sha256,
          section_manifest_json,authoring_practitioner_public_id,actor_user_public_id,
          actor_system_key,authored_at_utc,finalized_at_utc,source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,NULL,?,?)
      `).bind(
        base.tenantId,
        versionPublicId,
        documentPublicId,
        nextVersionNumber,
        document.current_version_public_id,
        content.contentFormat,
        content.contentPayload,
        content.encryptedPayloadReference,
        content.encryptionKeyVersion,
        content.contentSha256,
        content.sectionManifestJson,
        document.authoring_practitioner_public_id,
        base.actorUserPublicId,
        base.actorSystemKey,
        base.occurredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'clinical_document_version',
        canonicalPublicId: versionPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      db.prepare(`
        UPDATE canonical_clinical_documents
        SET current_version_public_id=?,status_version=status_version+1,
            request_fingerprint_sha256=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND document_public_id=? AND current_status='draft'
          AND status_version=? AND current_version_public_id=?
      `).bind(
        versionPublicId,
        fingerprint,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        documentPublicId,
        expectedVersion,
        document.current_version_public_id,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedEventPublicId,
      aggregateType: 'canonical_clinical_document',
      aggregatePublicId: documentPublicId,
      eventType: 'canonical.clinical-document.draft-replaced',
      eventVersion: nextStatusVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function signCanonicalClinicalDocument(
  db: CanonicalBatchDatabase,
  raw: SignCanonicalClinicalDocumentInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalClinicalDocumentCommandResult>> {
  const base = normalizeBase(raw);
  const documentPublicId = exact(raw.documentPublicId, 'documentPublicId');
  const versionPublicId = exact(raw.versionPublicId, 'versionPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const signerPractitionerPublicId = exact(raw.signerPractitionerPublicId, 'signerPractitionerPublicId');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const signedContentSha256 = sha256(raw.signedContentSha256, 'signedContentSha256');
  const attestationSha256 = sha256(raw.attestationSha256, 'attestationSha256');
  const signaturePublicId = await deterministicId('clsig', base.tenantId, sourceType, sourcePublicId, raw.signaturePublicId, 'signaturePublicId');
  const signatureMethod = raw.signatureMethod;
  const signingKeyReference = optionalExact(raw.signingKeyReference, 'signingKeyReference');
  const request = {
    documentPublicId,
    versionPublicId,
    expectedVersion,
    signerPractitionerPublicId,
    signaturePublicId,
    signatureMethod,
    signedContentSha256,
    attestationSha256,
    signingKeyReference,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalClinicalDocumentCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: SIGN_DOCUMENT,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const document = await requireDocument(db, base.tenantId, documentPublicId);
  if (Number(document.status_version) !== expectedVersion) throw new Error('clinical document version conflict');
  if (document.current_status !== 'draft' || document.current_version_public_id !== versionPublicId) {
    throw new Error('sign requires the exact current draft version');
  }
  const version = await requireDocumentVersion(db, base.tenantId, documentPublicId, versionPublicId);
  if (version.version_kind !== 'draft') throw new Error('clinical document version is not a draft');
  if (version.content_sha256 !== signedContentSha256) throw new Error('signed content hash does not match current version');
  await requireActivePractitioner(db, base.tenantId, signerPractitionerPublicId);
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'clinical_document_signature',
    sourceType,
    sourcePublicId,
    canonicalPublicId: signaturePublicId,
  });
  const nextStatusVersion = expectedVersion + 1;
  const result = documentResult(documentPublicId, versionPublicId, 'final', nextStatusVersion);
  const resolvedEventPublicId = await outboxEventId(base.tenantId, SIGN_DOCUMENT, base.idempotencyKey, raw.eventPublicId);

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: SIGN_DOCUMENT,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_clinical_document_signatures (
          tenant_id,signature_public_id,document_public_id,version_public_id,
          signer_practitioner_public_id,actor_user_public_id,signature_method,
          signed_content_sha256,attestation_sha256,signing_key_reference,
          signed_at_utc,source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        signaturePublicId,
        documentPublicId,
        versionPublicId,
        signerPractitionerPublicId,
        base.actorUserPublicId,
        signatureMethod,
        signedContentSha256,
        attestationSha256,
        signingKeyReference,
        base.occurredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      db.prepare(`
        UPDATE canonical_clinical_document_versions
        SET version_kind='final',finalized_at_utc=?
        WHERE tenant_id=? AND document_public_id=? AND version_public_id=?
          AND version_kind='draft' AND content_sha256=?
      `).bind(base.occurredAtUtc, base.tenantId, documentPublicId, versionPublicId, signedContentSha256),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'clinical_document_signature',
        canonicalPublicId: signaturePublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      db.prepare(`
        UPDATE canonical_clinical_documents
        SET current_status='final',status_version=status_version+1,
            finalized_at_utc=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND document_public_id=? AND current_status='draft'
          AND status_version=? AND current_version_public_id=?
      `).bind(
        base.occurredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        documentPublicId,
        expectedVersion,
        versionPublicId,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedEventPublicId,
      aggregateType: 'canonical_clinical_document',
      aggregatePublicId: documentPublicId,
      eventType: 'canonical.clinical-document.signed',
      eventVersion: nextStatusVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function amendCanonicalClinicalDocument(
  db: CanonicalBatchDatabase,
  raw: AmendCanonicalClinicalDocumentInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalClinicalDocumentCommandResult>> {
  const base = normalizeBase(raw);
  const documentPublicId = exact(raw.documentPublicId, 'documentPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const signerPractitionerPublicId = exact(raw.signerPractitionerPublicId, 'signerPractitionerPublicId');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const content = normalizeContent(raw);
  const versionPublicId = await deterministicId('cldver', base.tenantId, sourceType, sourcePublicId, raw.versionPublicId, 'versionPublicId');
  const signaturePublicId = await deterministicId('clsig', base.tenantId, sourceType, `${sourcePublicId}:signature`, raw.signaturePublicId, 'signaturePublicId');
  const attestationSha256 = sha256(raw.attestationSha256, 'attestationSha256');
  const signingKeyReference = optionalExact(raw.signingKeyReference, 'signingKeyReference');
  const request = {
    documentPublicId,
    expectedVersion,
    signerPractitionerPublicId,
    versionPublicId,
    signaturePublicId,
    signatureMethod: raw.signatureMethod,
    attestationSha256,
    signingKeyReference,
    ...content,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalClinicalDocumentCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: AMEND_DOCUMENT,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const document = await requireDocument(db, base.tenantId, documentPublicId);
  if (Number(document.status_version) !== expectedVersion) throw new Error('clinical document version conflict');
  if (!['final', 'amended'].includes(document.current_status) || document.current_version_public_id == null) {
    throw new Error('amend requires a final or amended clinical document');
  }
  const currentVersion = await requireDocumentVersion(db, base.tenantId, documentPublicId, document.current_version_public_id);
  await requireActivePractitioner(db, base.tenantId, signerPractitionerPublicId);
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'clinical_document_version',
    sourceType,
    sourcePublicId,
    canonicalPublicId: versionPublicId,
  });
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'clinical_document_signature',
    sourceType,
    sourcePublicId: `${sourcePublicId}:signature`,
    canonicalPublicId: signaturePublicId,
  });
  const nextStatusVersion = expectedVersion + 1;
  const nextVersionNumber = Number(currentVersion.version_number) + 1;
  const result = documentResult(documentPublicId, versionPublicId, 'amended', nextStatusVersion);
  const resolvedEventPublicId = await outboxEventId(base.tenantId, AMEND_DOCUMENT, base.idempotencyKey, raw.eventPublicId);

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: AMEND_DOCUMENT,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_clinical_document_versions (
          tenant_id,version_public_id,document_public_id,version_number,
          supersedes_version_public_id,version_kind,content_format,content_payload,
          encrypted_payload_reference,encryption_key_version,content_sha256,
          section_manifest_json,authoring_practitioner_public_id,actor_user_public_id,
          actor_system_key,authored_at_utc,finalized_at_utc,source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,NULL,?,?)
      `).bind(
        base.tenantId,
        versionPublicId,
        documentPublicId,
        nextVersionNumber,
        document.current_version_public_id,
        content.contentFormat,
        content.contentPayload,
        content.encryptedPayloadReference,
        content.encryptionKeyVersion,
        content.contentSha256,
        content.sectionManifestJson,
        signerPractitionerPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        base.occurredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      db.prepare(`
        INSERT INTO canonical_clinical_document_signatures (
          tenant_id,signature_public_id,document_public_id,version_public_id,
          signer_practitioner_public_id,actor_user_public_id,signature_method,
          signed_content_sha256,attestation_sha256,signing_key_reference,
          signed_at_utc,source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        signaturePublicId,
        documentPublicId,
        versionPublicId,
        signerPractitionerPublicId,
        base.actorUserPublicId,
        raw.signatureMethod,
        content.contentSha256,
        attestationSha256,
        signingKeyReference,
        base.occurredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      db.prepare(`
        UPDATE canonical_clinical_document_versions
        SET version_kind='amendment',finalized_at_utc=?
        WHERE tenant_id=? AND document_public_id=? AND version_public_id=?
          AND version_kind='draft' AND content_sha256=?
      `).bind(base.occurredAtUtc, base.tenantId, documentPublicId, versionPublicId, content.contentSha256),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'clinical_document_version',
        canonicalPublicId: versionPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'clinical_document_signature',
        canonicalPublicId: signaturePublicId,
        sourceType,
        sourcePublicId: `${sourcePublicId}:signature`,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      db.prepare(`
        UPDATE canonical_clinical_documents
        SET current_version_public_id=?,current_status='amended',status_version=status_version+1,
            finalized_at_utc=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND document_public_id=? AND current_status IN ('final','amended')
          AND status_version=? AND current_version_public_id=?
      `).bind(
        versionPublicId,
        base.occurredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        documentPublicId,
        expectedVersion,
        document.current_version_public_id,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedEventPublicId,
      aggregateType: 'canonical_clinical_document',
      aggregatePublicId: documentPublicId,
      eventType: 'canonical.clinical-document.amended',
      eventVersion: nextStatusVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function enterCanonicalClinicalDocumentInError(
  db: CanonicalBatchDatabase,
  raw: EnterCanonicalClinicalDocumentInErrorInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalClinicalDocumentCommandResult>> {
  const base = normalizeBase(raw);
  const documentPublicId = exact(raw.documentPublicId, 'documentPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const request = {
    documentPublicId,
    expectedVersion,
    reasonCode,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    actorPractitionerPublicId: base.actorPractitionerPublicId,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalClinicalDocumentCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: ENTER_DOCUMENT_ERROR,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const document = await requireDocument(db, base.tenantId, documentPublicId);
  if (Number(document.status_version) !== expectedVersion) throw new Error('clinical document version conflict');
  if (document.current_status === 'entered_in_error' || document.current_version_public_id == null) {
    throw new Error('clinical document cannot be entered in error from current state');
  }
  if (base.actorPractitionerPublicId != null) {
    await requireActivePractitioner(db, base.tenantId, base.actorPractitionerPublicId);
  }
  const nextStatusVersion = expectedVersion + 1;
  const result = documentResult(documentPublicId, document.current_version_public_id, 'entered_in_error', nextStatusVersion);
  const resolvedEventPublicId = await outboxEventId(base.tenantId, ENTER_DOCUMENT_ERROR, base.idempotencyKey, raw.eventPublicId);

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: ENTER_DOCUMENT_ERROR,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_clinical_documents
        SET current_status='entered_in_error',status_version=status_version+1,
            entered_in_error_at_utc=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND document_public_id=? AND status_version=?
          AND current_status!='entered_in_error'
      `).bind(
        base.occurredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        documentPublicId,
        expectedVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedEventPublicId,
      aggregateType: 'canonical_clinical_document',
      aggregatePublicId: documentPublicId,
      eventType: 'canonical.clinical-document.entered-in-error',
      eventVersion: nextStatusVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: { ...result, reasonCode },
    },
  });
}

export async function attachCanonicalClinicalDocumentArtifact(
  db: CanonicalBatchDatabase,
  raw: AttachCanonicalClinicalDocumentArtifactInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalClinicalDocumentAttachmentResult>> {
  const base = normalizeBase(raw);
  const documentPublicId = exact(raw.documentPublicId, 'documentPublicId');
  const versionPublicId = optionalExact(raw.versionPublicId, 'versionPublicId');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const attachmentPublicId = await deterministicId('clatt', base.tenantId, sourceType, sourcePublicId, raw.attachmentPublicId, 'attachmentPublicId');
  const attachmentType = raw.attachmentType;
  const bodyPartCode = optionalExact(raw.bodyPartCode, 'bodyPartCode');
  const storageProvider = exact(raw.storageProvider, 'storageProvider');
  const objectReference = exact(raw.objectReference, 'objectReference');
  const contentSha256 = sha256(raw.contentSha256, 'contentSha256');
  const fileSizeBytes = nonNegative(raw.fileSizeBytes, 'fileSizeBytes');
  const mimeType = exact(raw.mimeType, 'mimeType');
  const originalFilename = optionalExact(raw.originalFilename, 'originalFilename');
  const uploaderPractitionerPublicId = optionalExact(raw.uploaderPractitionerPublicId, 'uploaderPractitionerPublicId');
  const uploaderUserPublicId = optionalExact(raw.uploaderUserPublicId, 'uploaderUserPublicId');
  const uploaderSystemKey = optionalExact(raw.uploaderSystemKey, 'uploaderSystemKey');
  if (uploaderPractitionerPublicId == null && uploaderUserPublicId == null && uploaderSystemKey == null) {
    throw new TypeError('attachment uploader identity is required');
  }
  const request = {
    documentPublicId,
    versionPublicId,
    attachmentPublicId,
    attachmentType,
    bodyPartCode,
    storageProvider,
    objectReference,
    contentSha256,
    fileSizeBytes,
    mimeType,
    originalFilename,
    uploaderPractitionerPublicId,
    uploaderUserPublicId,
    uploaderSystemKey,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalClinicalDocumentAttachmentResult>(db, {
    tenantId: base.tenantId,
    commandName: ATTACH_ARTIFACT,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const document = await requireDocument(db, base.tenantId, documentPublicId);
  if (versionPublicId != null) await requireDocumentVersion(db, base.tenantId, documentPublicId, versionPublicId);
  if (uploaderPractitionerPublicId != null) {
    await requireActivePractitioner(db, base.tenantId, uploaderPractitionerPublicId);
  }
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'clinical_document_attachment',
    sourceType,
    sourcePublicId,
    canonicalPublicId: attachmentPublicId,
  });
  const result: CanonicalClinicalDocumentAttachmentResult = {
    attachmentPublicId,
    documentPublicId,
    versionPublicId,
    lifecycleStatus: 'active',
  };
  const resolvedEventPublicId = await outboxEventId(base.tenantId, ATTACH_ARTIFACT, base.idempotencyKey, raw.eventPublicId);

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: ATTACH_ARTIFACT,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_clinical_document_attachments (
          tenant_id,attachment_public_id,document_public_id,version_public_id,
          patient_link_public_id,encounter_public_id,attachment_type,body_part_code,
          storage_provider,object_reference,content_sha256,file_size_bytes,mime_type,
          original_filename,uploader_practitioner_public_id,uploader_user_public_id,
          uploader_system_key,lifecycle_status,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)
      `).bind(
        base.tenantId,
        attachmentPublicId,
        documentPublicId,
        versionPublicId,
        document.patient_link_public_id,
        document.encounter_public_id,
        attachmentType,
        bodyPartCode,
        storageProvider,
        objectReference,
        contentSha256,
        fileSizeBytes,
        mimeType,
        originalFilename,
        uploaderPractitionerPublicId,
        uploaderUserPublicId,
        uploaderSystemKey,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.occurredAtUtc,
      ),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'clinical_document_attachment',
        canonicalPublicId: attachmentPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: resolvedEventPublicId,
      aggregateType: 'canonical_clinical_document',
      aggregatePublicId: documentPublicId,
      eventType: 'canonical.clinical-document.attachment-added',
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function assertCanonicalDiagnosis(
  db: CanonicalBatchDatabase,
  raw: AssertCanonicalDiagnosisInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalDiagnosisCommandResult>> {
  const base = normalizeBase(raw);
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const diagnosisPublicId = await deterministicId('diag', base.tenantId, sourceType, sourcePublicId, raw.diagnosisPublicId, 'diagnosisPublicId');
  const diagnosisEventPublicId = await deterministicId('diagevt', base.tenantId, sourceType, `${sourcePublicId}:event:1`, raw.diagnosisEventPublicId, 'diagnosisEventPublicId');
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const assertingPractitionerPublicId = exact(raw.assertingPractitionerPublicId, 'assertingPractitionerPublicId');
  const supportingDocumentPublicId = optionalExact(raw.supportingDocumentPublicId, 'supportingDocumentPublicId');
  const supportingVersionPublicId = optionalExact(raw.supportingVersionPublicId, 'supportingVersionPublicId');
  if ((supportingDocumentPublicId == null) !== (supportingVersionPublicId == null)) {
    throw new TypeError('supporting document and version must be provided together');
  }
  const code = exact(raw.code, 'code');
  const displaySnapshot = exact(raw.displaySnapshot, 'displaySnapshot');
  const request = {
    diagnosisPublicId,
    diagnosisEventPublicId,
    patientLinkPublicId,
    encounterPublicId,
    assertingPractitionerPublicId,
    supportingDocumentPublicId,
    supportingVersionPublicId,
    codeSystem: raw.codeSystem,
    codeSystemVersion: optionalExact(raw.codeSystemVersion, 'codeSystemVersion'),
    code,
    displaySnapshot,
    codingPublicId: optionalExact(raw.codingPublicId, 'codingPublicId'),
    diagnosisRole: raw.diagnosisRole,
    certainty: raw.certainty,
    clinicalStatus: raw.clinicalStatus,
    verificationStatus: raw.verificationStatus,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalDiagnosisCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: ASSERT_DIAGNOSIS,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  await requirePatientLink(db, base.tenantId, patientLinkPublicId);
  await requireEncounterScope(db, base.tenantId, encounterPublicId, patientLinkPublicId);
  await requireActivePractitioner(db, base.tenantId, assertingPractitionerPublicId);
  if (supportingDocumentPublicId != null && supportingVersionPublicId != null) {
    const document = await requireDocument(db, base.tenantId, supportingDocumentPublicId);
    if (document.patient_link_public_id !== patientLinkPublicId || document.encounter_public_id !== encounterPublicId) {
      throw new Error('supporting clinical document scope mismatch');
    }
    await requireDocumentVersion(db, base.tenantId, supportingDocumentPublicId, supportingVersionPublicId);
  }
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'diagnosis_assertion',
    sourceType,
    sourcePublicId,
    canonicalPublicId: diagnosisPublicId,
  });
  const fingerprint = await createRequestFingerprint(request);
  const reviewedAtUtc = ['verified', 'refuted', 'entered_in_error'].includes(raw.verificationStatus)
    ? base.occurredAtUtc
    : null;
  const enteredInErrorAtUtc = raw.verificationStatus === 'entered_in_error' ? base.occurredAtUtc : null;
  const resolvedAtUtc = raw.clinicalStatus === 'resolved' ? base.occurredAtUtc : null;
  const result: CanonicalDiagnosisCommandResult = {
    diagnosisPublicId,
    clinicalStatus: raw.clinicalStatus,
    verificationStatus: raw.verificationStatus,
    statusVersion: 1,
  };
  const resolvedEventPublicId = await outboxEventId(base.tenantId, ASSERT_DIAGNOSIS, base.idempotencyKey, raw.eventPublicId);

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: ASSERT_DIAGNOSIS,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_diagnosis_assertions (
          tenant_id,diagnosis_public_id,patient_link_public_id,encounter_public_id,
          asserting_practitioner_public_id,supporting_document_public_id,
          supporting_version_public_id,code_system,code_system_version,code,
          display_snapshot,coding_public_id,diagnosis_role,certainty,clinical_status,
          verification_status,status_version,asserted_at_utc,reviewed_at_utc,
          resolved_at_utc,entered_in_error_at_utc,idempotency_key,
          request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        diagnosisPublicId,
        patientLinkPublicId,
        encounterPublicId,
        assertingPractitionerPublicId,
        supportingDocumentPublicId,
        supportingVersionPublicId,
        raw.codeSystem,
        request.codeSystemVersion,
        code,
        displaySnapshot,
        request.codingPublicId,
        raw.diagnosisRole,
        raw.certainty,
        raw.clinicalStatus,
        raw.verificationStatus,
        base.occurredAtUtc,
        reviewedAtUtc,
        resolvedAtUtc,
        enteredInErrorAtUtc,
        base.idempotencyKey,
        fingerprint,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.occurredAtUtc,
      ),
      db.prepare(`
        INSERT INTO canonical_diagnosis_status_events (
          tenant_id,event_public_id,diagnosis_public_id,from_verification_status,
          to_verification_status,from_clinical_status,to_clinical_status,event_version,
          event_type,reason_code,actor_practitioner_public_id,actor_user_public_id,
          actor_system_key,occurred_at_utc,source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,NULL,?,NULL,?,1,'asserted','initial_assertion',?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        diagnosisEventPublicId,
        diagnosisPublicId,
        raw.verificationStatus,
        raw.clinicalStatus,
        assertingPractitionerPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        base.occurredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'diagnosis_assertion',
        canonicalPublicId: diagnosisPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: resolvedEventPublicId,
      aggregateType: 'canonical_diagnosis',
      aggregatePublicId: diagnosisPublicId,
      eventType: 'canonical.diagnosis.asserted',
      eventVersion: 1,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function reviewCanonicalDiagnosis(
  db: CanonicalBatchDatabase,
  raw: ReviewCanonicalDiagnosisInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalDiagnosisCommandResult>> {
  const base = normalizeBase(raw);
  const diagnosisPublicId = exact(raw.diagnosisPublicId, 'diagnosisPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const reviewerPractitionerPublicId = exact(raw.reviewerPractitionerPublicId, 'reviewerPractitionerPublicId');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const diagnosisEventPublicId = await deterministicId(
    'diagevt',
    base.tenantId,
    REVIEW_DIAGNOSIS,
    `${diagnosisPublicId}:${expectedVersion + 1}:${base.idempotencyKey}`,
    raw.diagnosisEventPublicId,
    'diagnosisEventPublicId',
  );
  const request = {
    diagnosisPublicId,
    expectedVersion,
    reviewerPractitionerPublicId,
    toVerificationStatus: raw.toVerificationStatus,
    reasonCode,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalDiagnosisCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: REVIEW_DIAGNOSIS,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const diagnosis = await requireDiagnosis(db, base.tenantId, diagnosisPublicId);
  if (Number(diagnosis.status_version) !== expectedVersion) throw new Error('canonical diagnosis version conflict');
  if (diagnosis.verification_status === 'entered_in_error') throw new Error('cannot review diagnosis entered in error');
  await requireActivePractitioner(db, base.tenantId, reviewerPractitionerPublicId);
  const nextVersion = expectedVersion + 1;
  const nextClinicalStatus = raw.toVerificationStatus === 'entered_in_error'
    ? 'inactive'
    : diagnosis.clinical_status;
  const result: CanonicalDiagnosisCommandResult = {
    diagnosisPublicId,
    clinicalStatus: nextClinicalStatus,
    verificationStatus: raw.toVerificationStatus,
    statusVersion: nextVersion,
  };
  const resolvedEventPublicId = await outboxEventId(base.tenantId, REVIEW_DIAGNOSIS, base.idempotencyKey, raw.eventPublicId);
  const eventType: CanonicalDiagnosisEventType = raw.toVerificationStatus === 'verified'
    ? 'reviewed'
    : raw.toVerificationStatus === 'refuted'
      ? 'refuted'
      : 'entered_in_error';

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: REVIEW_DIAGNOSIS,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_diagnosis_status_events (
          tenant_id,event_public_id,diagnosis_public_id,from_verification_status,
          to_verification_status,from_clinical_status,to_clinical_status,event_version,
          event_type,reason_code,actor_practitioner_public_id,actor_user_public_id,
          actor_system_key,occurred_at_utc,source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        diagnosisEventPublicId,
        diagnosisPublicId,
        diagnosis.verification_status,
        raw.toVerificationStatus,
        diagnosis.clinical_status,
        nextClinicalStatus,
        nextVersion,
        eventType,
        reasonCode,
        reviewerPractitionerPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        base.occurredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      db.prepare(`
        UPDATE canonical_diagnosis_assertions
        SET verification_status=?,clinical_status=?,status_version=status_version+1,
            reviewed_at_utc=?,entered_in_error_at_utc=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND diagnosis_public_id=? AND status_version=?
          AND verification_status!='entered_in_error'
      `).bind(
        raw.toVerificationStatus,
        nextClinicalStatus,
        base.occurredAtUtc,
        raw.toVerificationStatus === 'entered_in_error' ? base.occurredAtUtc : null,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        diagnosisPublicId,
        expectedVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedEventPublicId,
      aggregateType: 'canonical_diagnosis',
      aggregatePublicId: diagnosisPublicId,
      eventType: `canonical.diagnosis.${eventType.replaceAll('_', '-')}`,
      eventVersion: nextVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function transitionCanonicalDiagnosis(
  db: CanonicalBatchDatabase,
  raw: TransitionCanonicalDiagnosisInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalDiagnosisCommandResult>> {
  const base = normalizeBase(raw);
  const diagnosisPublicId = exact(raw.diagnosisPublicId, 'diagnosisPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const diagnosisEventPublicId = await deterministicId(
    'diagevt',
    base.tenantId,
    TRANSITION_DIAGNOSIS,
    `${diagnosisPublicId}:${expectedVersion + 1}:${base.idempotencyKey}`,
    raw.diagnosisEventPublicId,
    'diagnosisEventPublicId',
  );
  const request = {
    diagnosisPublicId,
    expectedVersion,
    toClinicalStatus: raw.toClinicalStatus,
    toVerificationStatus: raw.toVerificationStatus,
    eventType: raw.eventType,
    reasonCode,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    actorPractitionerPublicId: base.actorPractitionerPublicId,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalDiagnosisCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: TRANSITION_DIAGNOSIS,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const diagnosis = await requireDiagnosis(db, base.tenantId, diagnosisPublicId);
  if (Number(diagnosis.status_version) !== expectedVersion) throw new Error('canonical diagnosis version conflict');
  if (diagnosis.verification_status === 'entered_in_error') throw new Error('cannot transition diagnosis entered in error');
  if (base.actorPractitionerPublicId != null) {
    await requireActivePractitioner(db, base.tenantId, base.actorPractitionerPublicId);
  }
  if (raw.eventType === 'resolved' && raw.toClinicalStatus !== 'resolved') {
    throw new Error('resolved event requires resolved clinical status');
  }
  if (raw.eventType === 'reopened' && raw.toClinicalStatus !== 'active') {
    throw new Error('reopened event requires active clinical status');
  }
  if (raw.eventType === 'entered_in_error' && raw.toVerificationStatus !== 'entered_in_error') {
    throw new Error('entered-in-error event requires entered-in-error verification status');
  }
  const nextVersion = expectedVersion + 1;
  const result: CanonicalDiagnosisCommandResult = {
    diagnosisPublicId,
    clinicalStatus: raw.toClinicalStatus,
    verificationStatus: raw.toVerificationStatus,
    statusVersion: nextVersion,
  };
  const resolvedEventPublicId = await outboxEventId(base.tenantId, TRANSITION_DIAGNOSIS, base.idempotencyKey, raw.eventPublicId);

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: TRANSITION_DIAGNOSIS,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_diagnosis_status_events (
          tenant_id,event_public_id,diagnosis_public_id,from_verification_status,
          to_verification_status,from_clinical_status,to_clinical_status,event_version,
          event_type,reason_code,actor_practitioner_public_id,actor_user_public_id,
          actor_system_key,occurred_at_utc,source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        diagnosisEventPublicId,
        diagnosisPublicId,
        diagnosis.verification_status,
        raw.toVerificationStatus,
        diagnosis.clinical_status,
        raw.toClinicalStatus,
        nextVersion,
        raw.eventType,
        reasonCode,
        base.actorPractitionerPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        base.occurredAtUtc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      db.prepare(`
        UPDATE canonical_diagnosis_assertions
        SET clinical_status=?,verification_status=?,status_version=status_version+1,
            resolved_at_utc=?,entered_in_error_at_utc=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND diagnosis_public_id=? AND status_version=?
          AND verification_status!='entered_in_error'
      `).bind(
        raw.toClinicalStatus,
        raw.toVerificationStatus,
        raw.toClinicalStatus === 'resolved' ? base.occurredAtUtc : null,
        raw.toVerificationStatus === 'entered_in_error' ? base.occurredAtUtc : null,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        diagnosisPublicId,
        expectedVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedEventPublicId,
      aggregateType: 'canonical_diagnosis',
      aggregatePublicId: diagnosisPublicId,
      eventType: `canonical.diagnosis.${raw.eventType.replaceAll('_', '-')}`,
      eventVersion: nextVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}
