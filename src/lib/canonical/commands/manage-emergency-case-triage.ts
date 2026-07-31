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

export type CanonicalEmergencyCaseStatus =
  | 'arrived'
  | 'awaiting_triage'
  | 'triaged'
  | 'care_in_progress'
  | 'observation'
  | 'disposition_pending'
  | 'admitted'
  | 'discharged'
  | 'transferred'
  | 'lama'
  | 'dor'
  | 'death'
  | 'entered_in_error';

export type CanonicalEmergencyTransitionStatus =
  | 'awaiting_triage'
  | 'triaged'
  | 'care_in_progress'
  | 'observation'
  | 'disposition_pending';

export type CanonicalEmergencyDispositionCode =
  | 'admitted'
  | 'discharged'
  | 'transferred'
  | 'lama'
  | 'dor'
  | 'death'
  | 'observation_continuation';

export type CanonicalEmergencyAcuityCode = 'red' | 'yellow' | 'green';

interface ActorInput {
  actorPractitionerPublicId?: string | null;
  actorUserPublicId?: string | null;
  actorSystemKey?: string | null;
}

interface CommandBase extends ActorInput {
  tenantId: string;
  idempotencyKey: string;
  outboxEventPublicId?: string;
  businessDate: string;
}

interface SourceInput {
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
}

interface ArrivalFields {
  arrivalAtUtc: string;
  modeOfArrivalCode: string;
  modeSourceType?: string | null;
  modeSourcePublicId?: string | null;
  referralSourceType?: string | null;
  referralSourcePublicId?: string | null;
  referralSnapshot?: string | null;
  conditionOnArrivalCode: string;
  conditionSnapshot?: string | null;
  broughtByCategory?: string | null;
  broughtByRelationshipCategory?: string | null;
  policeCaseIndicator?: boolean;
  observedAtUtc: string;
  recordedAtUtc: string;
}

interface TriageFields {
  triageAssessmentPublicId?: string;
  acuityCode: CanonicalEmergencyAcuityCode;
  legacyAcuityCode?: string | null;
  triagePractitionerPublicId: string;
  vitalObservationSetPublicId?: string | null;
  presentingRiskCode?: string | null;
  immediateInterventionCode?: string | null;
  clinicalRationaleSnapshot?: string | null;
  observedAtUtc: string;
  recordedAtUtc: string;
  reasonCode?: string | null;
}

interface ClassificationFields {
  classificationPublicId?: string;
  classificationFamilyPublicId: string;
  classificationNamespace: string;
  classificationCode: string;
  categoryCode: string;
  subcategoryCode?: string | null;
  animalCategoryCode?: string | null;
  biteSiteCode?: string | null;
  biteAtUtc?: string | null;
  firstAidCode?: string | null;
  policeCaseIndicator?: boolean;
  boundedSourceSnapshot?: string | null;
  occurredAtUtc: string;
  recordedAtUtc: string;
  reasonCode?: string | null;
}

export interface RegisterCanonicalEmergencyCaseInput extends CommandBase, SourceInput, ArrivalFields {
  emergencyCasePublicId?: string;
  arrivalAssessmentPublicId?: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  emergencyNumberNamespace?: string | null;
  emergencyNumberValue?: string | null;
  initialStatus?: 'arrived' | 'awaiting_triage';
}

export interface ReplaceCanonicalEmergencyArrivalAssessmentInput extends CommandBase, SourceInput, ArrivalFields {
  emergencyCasePublicId: string;
  expectedStatusVersion: number;
  expectedArrivalVersion: number;
  arrivalAssessmentPublicId?: string;
  reasonCode: string;
}

export interface RecordCanonicalEmergencyTriageAssessmentInput extends CommandBase, SourceInput, TriageFields {
  emergencyCasePublicId: string;
  expectedStatusVersion: number;
  expectedTriageVersion: number;
}

export interface CorrectCanonicalEmergencyTriageAssessmentInput extends CommandBase, SourceInput, TriageFields {
  emergencyCasePublicId: string;
  expectedStatusVersion: number;
  expectedTriageVersion: number;
  reasonCode: string;
}

export interface RecordCanonicalEmergencyCaseClassificationInput extends CommandBase, SourceInput, ClassificationFields {
  emergencyCasePublicId: string;
  expectedStatusVersion: number;
}

export interface CorrectCanonicalEmergencyCaseClassificationInput extends CommandBase, SourceInput, ClassificationFields {
  emergencyCasePublicId: string;
  expectedStatusVersion: number;
  expectedClassificationVersion: number;
  reasonCode: string;
}

export interface TransitionCanonicalEmergencyCaseInput extends CommandBase, SourceInput {
  emergencyCasePublicId: string;
  expectedStatusVersion: number;
  toStatus: CanonicalEmergencyTransitionStatus;
  reasonCode: string;
  occurredAtUtc: string;
  recordedAtUtc: string;
}

export interface RecordCanonicalEmergencyDispositionInput extends CommandBase, SourceInput {
  emergencyCasePublicId: string;
  expectedStatusVersion: number;
  expectedDispositionVersion: number;
  dispositionEventPublicId?: string;
  dispositionCode: CanonicalEmergencyDispositionCode;
  canonicalAdmissionPublicId?: string | null;
  dischargeDocumentPublicId?: string | null;
  dischargeDocumentVersionPublicId?: string | null;
  dischargeDocumentContentSha256?: string | null;
  receivingOrganizationSourceType?: string | null;
  receivingOrganizationSourcePublicId?: string | null;
  receivingEncounterSourceType?: string | null;
  receivingEncounterSourcePublicId?: string | null;
  transportServiceEventPublicId?: string | null;
  terminalEvidenceCode?: string | null;
  occurredAtUtc: string;
  recordedAtUtc: string;
  reasonCode: string;
  remarksSnapshot?: string | null;
}

export interface EnterCanonicalEmergencyCaseInErrorInput extends CommandBase, SourceInput {
  emergencyCasePublicId: string;
  expectedStatusVersion: number;
  expectedDispositionVersion: number;
  dispositionEventPublicId?: string;
  terminalEvidenceCode: string;
  occurredAtUtc: string;
  recordedAtUtc: string;
  reasonCode: string;
  remarksSnapshot?: string | null;
}

export interface EmergencyCaseCommandResult {
  emergencyCasePublicId: string;
  currentStatus: CanonicalEmergencyCaseStatus;
  statusVersion: number;
  currentArrivalAssessmentPublicId: string | null;
  currentTriageAssessmentPublicId: string | null;
  currentDispositionEventPublicId: string | null;
}

export interface EmergencyClassificationCommandResult {
  emergencyCasePublicId: string;
  classificationFamilyPublicId: string;
  classificationPublicId: string;
  versionNumber: number;
}

interface Actor {
  actorPractitionerPublicId: string | null;
  actorUserPublicId: string | null;
  actorSystemKey: string | null;
}

interface Source {
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  evidenceSha256: string;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface CaseRow {
  patient_link_public_id: string;
  encounter_public_id: string;
  current_status: CanonicalEmergencyCaseStatus;
  status_version: number;
  current_arrival_assessment_public_id: string | null;
  current_status_event_public_id: string | null;
  current_triage_assessment_public_id: string | null;
  current_disposition_event_public_id: string | null;
}

interface ArrivalRow {
  arrival_assessment_public_id: string;
  version_number: number;
}

interface TriageRow {
  triage_assessment_public_id: string;
  version_number: number;
}

interface ClassificationRow {
  classification_public_id: string;
  emergency_case_public_id: string;
  version_number: number;
}

interface DispositionRow {
  disposition_event_public_id: string;
  disposition_version: number;
  disposition_code: string;
}

const REGISTER_CASE = 'registerCanonicalEmergencyCase';
const REPLACE_ARRIVAL = 'replaceCanonicalEmergencyArrivalAssessment';
const RECORD_TRIAGE = 'recordCanonicalEmergencyTriageAssessment';
const CORRECT_TRIAGE = 'correctCanonicalEmergencyTriageAssessment';
const RECORD_CLASSIFICATION = 'recordCanonicalEmergencyCaseClassification';
const CORRECT_CLASSIFICATION = 'correctCanonicalEmergencyCaseClassification';
const TRANSITION_CASE = 'transitionCanonicalEmergencyCase';
const RECORD_DISPOSITION = 'recordCanonicalEmergencyDisposition';
const ENTER_CASE_ERROR = 'enterCanonicalEmergencyCaseInError';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function optional(value: string | null | undefined, label: string): string | null {
  return value == null ? null : exact(value, label);
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function nonnegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
}

function digest(value: string, label: string): string {
  const normalized = exact(value, label);
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  return normalized;
}

function utc(value: string, label: string): string {
  const normalized = toUtcIso(value);
  if (normalized !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return normalized;
}

function actor(input: ActorInput): Actor {
  const actorPractitionerPublicId = optional(input.actorPractitionerPublicId, 'actorPractitionerPublicId');
  const actorUserPublicId = optional(input.actorUserPublicId, 'actorUserPublicId');
  const actorSystemKey = optional(input.actorSystemKey, 'actorSystemKey');
  if (!actorPractitionerPublicId && !actorUserPublicId && !actorSystemKey) {
    throw new TypeError('actorPractitionerPublicId, actorUserPublicId, or actorSystemKey is required');
  }
  return { actorPractitionerPublicId, actorUserPublicId, actorSystemKey };
}

function source(input: SourceInput): Source {
  return {
    sourceType: exact(input.sourceType, 'sourceType'),
    sourcePublicId: exact(input.sourcePublicId, 'sourcePublicId'),
    sourceTable: exact(input.sourceTable, 'sourceTable'),
    evidenceSha256: digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256'),
  };
}

function pair(left: string | null, right: string | null, label: string): void {
  if ((left == null) !== (right == null)) throw new TypeError(`${label} type and public ID must be provided together`);
}

async function publicId(
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

async function eventId(tenantId: string, commandName: string, idempotencyKey: string, suffix: string): Promise<string> {
  return createDeterministicSourceId('erevt', tenantId, commandName, `${idempotencyKey}:${suffix}`);
}

async function outboxId(
  tenantId: string,
  commandName: string,
  idempotencyKey: string,
  supplied?: string,
): Promise<string> {
  return publicId('evt', tenantId, commandName, idempotencyKey, supplied, 'outboxEventPublicId');
}

async function request(fullOperation: unknown, businessDate: string) {
  return {
    schemaVersion: 1 as const,
    operationFingerprintSha256: await createRequestFingerprint(fullOperation),
    businessDate: exact(businessDate, 'businessDate'),
  };
}

function caseResult(
  emergencyCasePublicId: string,
  currentStatus: CanonicalEmergencyCaseStatus,
  statusVersion: number,
  currentArrivalAssessmentPublicId: string | null,
  currentTriageAssessmentPublicId: string | null,
  currentDispositionEventPublicId: string | null,
): EmergencyCaseCommandResult {
  return {
    emergencyCasePublicId,
    currentStatus,
    statusVersion,
    currentArrivalAssessmentPublicId,
    currentTriageAssessmentPublicId,
    currentDispositionEventPublicId,
  };
}

function eventPayload(result: EmergencyCaseCommandResult) {
  return {
    currentStatus: result.currentStatus,
    statusVersion: result.statusVersion,
    hasArrivalAssessment: result.currentArrivalAssessmentPublicId != null,
    hasTriageAssessment: result.currentTriageAssessmentPublicId != null,
    hasDisposition: result.currentDispositionEventPublicId != null,
  };
}

async function requirePractitioner(
  db: CanonicalBatchDatabase,
  tenantId: string,
  practitionerPublicId: string,
): Promise<void> {
  const row = await db.prepare(
    `SELECT status FROM canonical_practitioners
     WHERE tenant_id=? AND practitioner_public_id=? LIMIT 1`,
  ).bind(tenantId, practitionerPublicId).first<{ status: string }>();
  if (!row || row.status !== 'active') throw new Error('active practitioner is required');
}

async function requireEmergencyScope(
  db: CanonicalBatchDatabase,
  tenantId: string,
  patientLinkPublicId: string,
  encounterPublicId: string,
): Promise<void> {
  const patient = await db.prepare(
    `SELECT link_status,effective_to_utc FROM canonical_tenant_patient_links
     WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1`,
  ).bind(tenantId, patientLinkPublicId).first<{ link_status: string; effective_to_utc: string | null }>();
  if (!patient || ['rejected', 'retired'].includes(patient.link_status) || patient.effective_to_utc != null) {
    throw new Error('active patient link is required');
  }
  const encounter = await db.prepare(
    `SELECT patient_link_public_id,encounter_type,status FROM canonical_encounters
     WHERE tenant_id=? AND encounter_public_id=? LIMIT 1`,
  ).bind(tenantId, encounterPublicId).first<{
    patient_link_public_id: string | null;
    encounter_type: string;
    status: string;
  }>();
  if (
    !encounter
    || encounter.patient_link_public_id !== patientLinkPublicId
    || encounter.encounter_type !== 'emergency'
    || encounter.status === 'cancelled'
  ) {
    throw new Error('emergency encounter patient scope mismatch');
  }
}

async function requireVitalScope(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    observationSetPublicId: string;
    patientLinkPublicId: string;
    encounterPublicId: string;
  },
): Promise<void> {
  const row = await db.prepare(
    `SELECT review_status FROM canonical_vital_observation_sets
     WHERE tenant_id=? AND observation_set_public_id=? AND patient_link_public_id=?
       AND encounter_public_id=? LIMIT 1`,
  ).bind(
    input.tenantId,
    input.observationSetPublicId,
    input.patientLinkPublicId,
    input.encounterPublicId,
  ).first<{ review_status: string }>();
  if (!row || row.review_status === 'entered_in_error') throw new Error('vital observation scope mismatch');
}

async function requireAdmissionScope(
  db: CanonicalBatchDatabase,
  tenantId: string,
  admissionPublicId: string,
  patientLinkPublicId: string,
): Promise<void> {
  const row = await db.prepare(
    `SELECT patient_link_public_id,current_status FROM canonical_admissions
     WHERE tenant_id=? AND admission_public_id=? LIMIT 1`,
  ).bind(tenantId, admissionPublicId).first<{ patient_link_public_id: string; current_status: string }>();
  if (!row || row.patient_link_public_id !== patientLinkPublicId || row.current_status === 'entered_in_error') {
    throw new Error('admission patient mismatch');
  }
}

async function requireDischargeDocumentScope(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    documentPublicId: string;
    versionPublicId: string;
    contentSha256: string;
    patientLinkPublicId: string;
    encounterPublicId: string;
  },
): Promise<void> {
  const row = await db.prepare(
    `SELECT v.version_kind
     FROM canonical_clinical_document_versions v
     JOIN canonical_clinical_documents d
       ON d.tenant_id=v.tenant_id AND d.document_public_id=v.document_public_id
     JOIN canonical_clinical_document_signatures s
       ON s.tenant_id=v.tenant_id AND s.document_public_id=v.document_public_id
      AND s.version_public_id=v.version_public_id AND s.signed_content_sha256=v.content_sha256
     WHERE v.tenant_id=? AND v.document_public_id=? AND v.version_public_id=?
       AND v.content_sha256=? AND v.version_kind IN ('final','amendment')
       AND d.document_type='discharge_summary' AND d.patient_link_public_id=?
       AND d.encounter_public_id=? LIMIT 1`,
  ).bind(
    input.tenantId,
    input.documentPublicId,
    input.versionPublicId,
    input.contentSha256,
    input.patientLinkPublicId,
    input.encounterPublicId,
  ).first<{ version_kind: string }>();
  if (!row) throw new Error('discharge document scope mismatch or unsigned document');
}

async function requireTransportEventScope(
  db: CanonicalBatchDatabase,
  tenantId: string,
  eventPublicId: string,
  encounterPublicId: string,
): Promise<void> {
  const row = await db.prepare(
    `SELECT status FROM canonical_service_events
     WHERE tenant_id=? AND event_public_id=? AND encounter_public_id=? LIMIT 1`,
  ).bind(tenantId, eventPublicId, encounterPublicId).first<{ status: string }>();
  if (!row || row.status !== 'posted') throw new Error('transport service event scope mismatch');
}

async function requireMappingAvailable(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: string;
    sourceType: string;
    sourcePublicId: string;
    canonicalPublicId: string;
  },
): Promise<void> {
  const row = await db.prepare(
    `SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
     WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1`,
  ).bind(
    input.tenantId,
    input.entityType,
    input.sourceType,
    input.sourcePublicId,
  ).first<MappingRow>();
  if (!row) return;
  if (row.mapping_status !== 'mapped' || row.canonical_public_id !== input.canonicalPublicId) {
    throw new Error('source mapping already belongs to another canonical record');
  }
  throw new Error('source mapping already exists without replay evidence');
}

function mappingStatement(
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
  return db.prepare(
    `INSERT INTO canonical_source_mappings (
       tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
       mapping_status,mapping_version,migration_run_id,evidence_sha256,created_at_utc,updated_at_utc
     ) VALUES (?,?,?,?,?,?,'mapped',1,NULL,?,?,?)`,
  ).bind(
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

async function emergencyCaseRow(
  db: CanonicalBatchDatabase,
  tenantId: string,
  emergencyCasePublicId: string,
): Promise<CaseRow> {
  const row = await db.prepare(
    `SELECT patient_link_public_id,encounter_public_id,current_status,status_version,
            current_arrival_assessment_public_id,current_status_event_public_id,
            current_triage_assessment_public_id,current_disposition_event_public_id
     FROM canonical_emergency_cases
     WHERE tenant_id=? AND emergency_case_public_id=? LIMIT 1`,
  ).bind(tenantId, emergencyCasePublicId).first<CaseRow>();
  if (!row) throw new Error('canonical emergency case not found');
  return row;
}

async function currentArrivalRow(
  db: CanonicalBatchDatabase,
  tenantId: string,
  emergencyCasePublicId: string,
  arrivalAssessmentPublicId: string,
): Promise<ArrivalRow> {
  const row = await db.prepare(
    `SELECT arrival_assessment_public_id,version_number
     FROM canonical_emergency_arrival_assessments
     WHERE tenant_id=? AND emergency_case_public_id=? AND arrival_assessment_public_id=? LIMIT 1`,
  ).bind(tenantId, emergencyCasePublicId, arrivalAssessmentPublicId).first<ArrivalRow>();
  if (!row) throw new Error('canonical emergency arrival assessment not found');
  return row;
}

async function currentTriageRow(
  db: CanonicalBatchDatabase,
  tenantId: string,
  emergencyCasePublicId: string,
  triageAssessmentPublicId: string,
): Promise<TriageRow> {
  const row = await db.prepare(
    `SELECT triage_assessment_public_id,version_number
     FROM canonical_emergency_triage_assessments
     WHERE tenant_id=? AND emergency_case_public_id=? AND triage_assessment_public_id=? LIMIT 1`,
  ).bind(tenantId, emergencyCasePublicId, triageAssessmentPublicId).first<TriageRow>();
  if (!row) throw new Error('canonical emergency triage assessment not found');
  return row;
}

async function currentClassificationRow(
  db: CanonicalBatchDatabase,
  tenantId: string,
  classificationFamilyPublicId: string,
): Promise<ClassificationRow | null> {
  return db.prepare(
    `SELECT classification_public_id,emergency_case_public_id,version_number
     FROM canonical_emergency_case_classifications
     WHERE tenant_id=? AND classification_family_public_id=?
     ORDER BY version_number DESC LIMIT 1`,
  ).bind(tenantId, classificationFamilyPublicId).first<ClassificationRow>();
}

async function currentDispositionRow(
  db: CanonicalBatchDatabase,
  tenantId: string,
  emergencyCasePublicId: string,
): Promise<DispositionRow | null> {
  return db.prepare(
    `SELECT disposition_event_public_id,disposition_version,disposition_code
     FROM canonical_emergency_disposition_events
     WHERE tenant_id=? AND emergency_case_public_id=?
     ORDER BY disposition_version DESC LIMIT 1`,
  ).bind(tenantId, emergencyCasePublicId).first<DispositionRow>();
}

function statusEventStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    emergencyCasePublicId: string;
    fromStatus: CanonicalEmergencyCaseStatus | null;
    toStatus: CanonicalEmergencyCaseStatus;
    eventVersion: number;
    eventType: string;
    actor: Actor;
    occurredAtUtc: string;
    recordedAtUtc: string;
    reasonCode: string;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(
    `INSERT INTO canonical_emergency_case_status_events (
       tenant_id,event_public_id,emergency_case_public_id,from_status,to_status,event_version,event_type,
       actor_practitioner_public_id,actor_user_public_id,actor_system_key,occurred_at_utc,recorded_at_utc,
       reason_code,source_evidence_sha256,created_at_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    input.tenantId,
    input.eventPublicId,
    input.emergencyCasePublicId,
    input.fromStatus,
    input.toStatus,
    input.eventVersion,
    input.eventType,
    input.actor.actorPractitionerPublicId,
    input.actor.actorUserPublicId,
    input.actor.actorSystemKey,
    input.occurredAtUtc,
    input.recordedAtUtc,
    input.reasonCode,
    input.evidenceSha256,
    input.recordedAtUtc,
  );
}

function normalizeArrival(raw: ArrivalFields) {
  const arrivalAtUtc = utc(raw.arrivalAtUtc, 'arrivalAtUtc');
  const observedAtUtc = utc(raw.observedAtUtc, 'observedAtUtc');
  const recordedAtUtc = utc(raw.recordedAtUtc, 'recordedAtUtc');
  if (recordedAtUtc < observedAtUtc) throw new RangeError('recordedAtUtc cannot precede observedAtUtc');
  if (recordedAtUtc < arrivalAtUtc) throw new RangeError('recordedAtUtc cannot precede arrivalAtUtc');
  const modeSourceType = optional(raw.modeSourceType, 'modeSourceType');
  const modeSourcePublicId = optional(raw.modeSourcePublicId, 'modeSourcePublicId');
  const referralSourceType = optional(raw.referralSourceType, 'referralSourceType');
  const referralSourcePublicId = optional(raw.referralSourcePublicId, 'referralSourcePublicId');
  pair(modeSourceType, modeSourcePublicId, 'mode source');
  pair(referralSourceType, referralSourcePublicId, 'referral source');
  return {
    arrivalAtUtc,
    modeOfArrivalCode: exact(raw.modeOfArrivalCode, 'modeOfArrivalCode'),
    modeSourceType,
    modeSourcePublicId,
    referralSourceType,
    referralSourcePublicId,
    referralSnapshot: optional(raw.referralSnapshot, 'referralSnapshot'),
    conditionOnArrivalCode: exact(raw.conditionOnArrivalCode, 'conditionOnArrivalCode'),
    conditionSnapshot: optional(raw.conditionSnapshot, 'conditionSnapshot'),
    broughtByCategory: optional(raw.broughtByCategory, 'broughtByCategory'),
    broughtByRelationshipCategory: optional(raw.broughtByRelationshipCategory, 'broughtByRelationshipCategory'),
    policeCaseIndicator: raw.policeCaseIndicator === true ? 1 : 0,
    observedAtUtc,
    recordedAtUtc,
  };
}

function normalizeTriage(raw: TriageFields) {
  const observedAtUtc = utc(raw.observedAtUtc, 'observedAtUtc');
  const recordedAtUtc = utc(raw.recordedAtUtc, 'recordedAtUtc');
  if (recordedAtUtc < observedAtUtc) throw new RangeError('recordedAtUtc cannot precede observedAtUtc');
  if (!['red', 'yellow', 'green'].includes(raw.acuityCode)) throw new TypeError('acuityCode must be red, yellow, or green');
  return {
    acuityCode: raw.acuityCode,
    legacyAcuityCode: optional(raw.legacyAcuityCode, 'legacyAcuityCode'),
    triagePractitionerPublicId: exact(raw.triagePractitionerPublicId, 'triagePractitionerPublicId'),
    vitalObservationSetPublicId: optional(raw.vitalObservationSetPublicId, 'vitalObservationSetPublicId'),
    presentingRiskCode: optional(raw.presentingRiskCode, 'presentingRiskCode'),
    immediateInterventionCode: optional(raw.immediateInterventionCode, 'immediateInterventionCode'),
    clinicalRationaleSnapshot: optional(raw.clinicalRationaleSnapshot, 'clinicalRationaleSnapshot'),
    observedAtUtc,
    recordedAtUtc,
    reasonCode: optional(raw.reasonCode, 'reasonCode'),
  };
}

function normalizeClassification(raw: ClassificationFields) {
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const recordedAtUtc = utc(raw.recordedAtUtc, 'recordedAtUtc');
  if (recordedAtUtc < occurredAtUtc) throw new RangeError('recordedAtUtc cannot precede occurredAtUtc');
  const categoryCode = exact(raw.categoryCode, 'categoryCode');
  const animalCategoryCode = optional(raw.animalCategoryCode, 'animalCategoryCode');
  const biteSiteCode = optional(raw.biteSiteCode, 'biteSiteCode');
  const biteAtUtc = raw.biteAtUtc == null ? null : utc(raw.biteAtUtc, 'biteAtUtc');
  const policeCaseIndicator = raw.policeCaseIndicator === true ? 1 : 0;
  if (categoryCode === 'animal_bite' && (!animalCategoryCode || !biteSiteCode || !biteAtUtc)) {
    throw new Error('animal bite evidence is incomplete');
  }
  if (categoryCode === 'police_case' && policeCaseIndicator !== 1) {
    throw new Error('police case evidence is incomplete');
  }
  return {
    classificationFamilyPublicId: exact(raw.classificationFamilyPublicId, 'classificationFamilyPublicId'),
    classificationNamespace: exact(raw.classificationNamespace, 'classificationNamespace'),
    classificationCode: exact(raw.classificationCode, 'classificationCode'),
    categoryCode,
    subcategoryCode: optional(raw.subcategoryCode, 'subcategoryCode'),
    animalCategoryCode,
    biteSiteCode,
    biteAtUtc,
    firstAidCode: optional(raw.firstAidCode, 'firstAidCode'),
    policeCaseIndicator,
    boundedSourceSnapshot: optional(raw.boundedSourceSnapshot, 'boundedSourceSnapshot'),
    occurredAtUtc,
    recordedAtUtc,
    reasonCode: optional(raw.reasonCode, 'reasonCode'),
  };
}

function classificationStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    classificationPublicId: string;
    classificationFamilyPublicId: string;
    emergencyCasePublicId: string;
    patientLinkPublicId: string;
    encounterPublicId: string;
    versionNumber: number;
    supersedesClassificationPublicId: string | null;
    versionKind: 'initial' | 'correction';
    classificationNamespace: string;
    classificationCode: string;
    categoryCode: string;
    subcategoryCode: string | null;
    animalCategoryCode: string | null;
    biteSiteCode: string | null;
    biteAtUtc: string | null;
    firstAidCode: string | null;
    policeCaseIndicator: number;
    boundedSourceSnapshot: string | null;
    actor: Actor;
    occurredAtUtc: string;
    recordedAtUtc: string;
    reasonCode: string | null;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(
    `INSERT INTO canonical_emergency_case_classifications (
       tenant_id,classification_public_id,classification_family_public_id,emergency_case_public_id,
       patient_link_public_id,encounter_public_id,version_number,supersedes_classification_public_id,
       version_kind,classification_namespace,classification_code,category_code,subcategory_code,
       animal_category_code,bite_site_code,bite_at_utc,first_aid_code,police_case_indicator,
       bounded_source_snapshot,actor_practitioner_public_id,actor_user_public_id,actor_system_key,
       occurred_at_utc,recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    input.tenantId,
    input.classificationPublicId,
    input.classificationFamilyPublicId,
    input.emergencyCasePublicId,
    input.patientLinkPublicId,
    input.encounterPublicId,
    input.versionNumber,
    input.supersedesClassificationPublicId,
    input.versionKind,
    input.classificationNamespace,
    input.classificationCode,
    input.categoryCode,
    input.subcategoryCode,
    input.animalCategoryCode,
    input.biteSiteCode,
    input.biteAtUtc,
    input.firstAidCode,
    input.policeCaseIndicator,
    input.boundedSourceSnapshot,
    input.actor.actorPractitionerPublicId,
    input.actor.actorUserPublicId,
    input.actor.actorSystemKey,
    input.occurredAtUtc,
    input.recordedAtUtc,
    input.reasonCode,
    input.evidenceSha256,
    input.recordedAtUtc,
  );
}

export async function registerCanonicalEmergencyCase(
  db: CanonicalBatchDatabase,
  raw: RegisterCanonicalEmergencyCaseInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<EmergencyCaseCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const commandActor = actor(raw);
  const commandSource = source(raw);
  const arrival = normalizeArrival(raw);
  const emergencyNumberNamespace = optional(raw.emergencyNumberNamespace, 'emergencyNumberNamespace');
  const emergencyNumberValue = optional(raw.emergencyNumberValue, 'emergencyNumberValue');
  pair(emergencyNumberNamespace, emergencyNumberValue, 'emergency number');
  const initialStatus = raw.initialStatus ?? 'arrived';
  if (!['arrived', 'awaiting_triage'].includes(initialStatus)) {
    throw new TypeError('initialStatus must be arrived or awaiting_triage');
  }
  const emergencyCasePublicId = await publicId(
    'ercase', tenantId, commandSource.sourceType, commandSource.sourcePublicId,
    raw.emergencyCasePublicId, 'emergencyCasePublicId',
  );
  const arrivalAssessmentPublicId = await publicId(
    'erarr', tenantId, commandSource.sourceType, `${commandSource.sourcePublicId}:arrival:1`,
    raw.arrivalAssessmentPublicId, 'arrivalAssessmentPublicId',
  );
  const full = {
    emergencyCasePublicId,
    arrivalAssessmentPublicId,
    patientLinkPublicId,
    encounterPublicId,
    emergencyNumberNamespace,
    emergencyNumberValue,
    initialStatus,
    arrival,
    commandActor,
    commandSource,
  };
  const commandRequest = await request(full, businessDate);
  const replay = await readCanonicalCommandReplay<EmergencyCaseCommandResult>(db, {
    tenantId,
    commandName: REGISTER_CASE,
    idempotencyKey,
    request: commandRequest,
  });
  if (replay) return replay;
  await requireEmergencyScope(db, tenantId, patientLinkPublicId, encounterPublicId);
  if (commandActor.actorPractitionerPublicId) {
    await requirePractitioner(db, tenantId, commandActor.actorPractitionerPublicId);
  }
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'emergency_case',
    sourceType: commandSource.sourceType,
    sourcePublicId: commandSource.sourcePublicId,
    canonicalPublicId: emergencyCasePublicId,
  });
  const fingerprint = await createRequestFingerprint(full);
  const initialStatusEventPublicId = await eventId(tenantId, REGISTER_CASE, idempotencyKey, 'status:1');
  const result = caseResult(
    emergencyCasePublicId,
    initialStatus,
    1,
    arrivalAssessmentPublicId,
    null,
    null,
  );
  return runCanonicalBatch(db, {
    tenantId,
    commandName: REGISTER_CASE,
    idempotencyKey,
    request: commandRequest,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(
        `INSERT INTO canonical_emergency_cases (
           tenant_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
           emergency_number_namespace,emergency_number_value,current_status,status_version,
           actor_user_public_id,actor_system_key,idempotency_key,request_fingerprint_sha256,
           source_evidence_sha256,created_at_utc,updated_at_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        tenantId,
        emergencyCasePublicId,
        patientLinkPublicId,
        encounterPublicId,
        emergencyNumberNamespace,
        emergencyNumberValue,
        initialStatus,
        1,
        commandActor.actorUserPublicId,
        commandActor.actorSystemKey,
        idempotencyKey,
        fingerprint,
        commandSource.evidenceSha256,
        arrival.recordedAtUtc,
        arrival.recordedAtUtc,
      ),
      db.prepare(
        `INSERT INTO canonical_emergency_arrival_assessments (
           tenant_id,arrival_assessment_public_id,emergency_case_public_id,patient_link_public_id,
           encounter_public_id,version_number,supersedes_arrival_assessment_public_id,version_kind,
           arrival_at_utc,mode_of_arrival_code,mode_source_type,mode_source_public_id,
           referral_source_type,referral_source_public_id,referral_snapshot,condition_on_arrival_code,
           condition_snapshot,brought_by_category,brought_by_relationship_category,police_case_indicator,
           actor_practitioner_public_id,actor_user_public_id,actor_system_key,observed_at_utc,
           recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        tenantId,
        arrivalAssessmentPublicId,
        emergencyCasePublicId,
        patientLinkPublicId,
        encounterPublicId,
        1,
        null,
        'initial',
        arrival.arrivalAtUtc,
        arrival.modeOfArrivalCode,
        arrival.modeSourceType,
        arrival.modeSourcePublicId,
        arrival.referralSourceType,
        arrival.referralSourcePublicId,
        arrival.referralSnapshot,
        arrival.conditionOnArrivalCode,
        arrival.conditionSnapshot,
        arrival.broughtByCategory,
        arrival.broughtByRelationshipCategory,
        arrival.policeCaseIndicator,
        commandActor.actorPractitionerPublicId,
        commandActor.actorUserPublicId,
        commandActor.actorSystemKey,
        arrival.observedAtUtc,
        arrival.recordedAtUtc,
        null,
        commandSource.evidenceSha256,
        arrival.recordedAtUtc,
      ),
      statusEventStatement(db, {
        tenantId,
        eventPublicId: initialStatusEventPublicId,
        emergencyCasePublicId,
        fromStatus: null,
        toStatus: initialStatus,
        eventVersion: 1,
        eventType: 'registered',
        actor: commandActor,
        occurredAtUtc: arrival.arrivalAtUtc,
        recordedAtUtc: arrival.recordedAtUtc,
        reasonCode: 'registered',
        evidenceSha256: commandSource.evidenceSha256,
      }),
      db.prepare(
        `UPDATE canonical_emergency_cases
         SET current_arrival_assessment_public_id=?,current_status_event_public_id=?,updated_at_utc=?
         WHERE tenant_id=? AND emergency_case_public_id=?
           AND current_arrival_assessment_public_id IS NULL AND current_status_event_public_id IS NULL`,
      ).bind(
        arrivalAssessmentPublicId,
        initialStatusEventPublicId,
        arrival.recordedAtUtc,
        tenantId,
        emergencyCasePublicId,
      ),
      mappingStatement(db, {
        tenantId,
        entityType: 'emergency_case',
        canonicalPublicId: emergencyCasePublicId,
        sourceType: commandSource.sourceType,
        sourcePublicId: commandSource.sourcePublicId,
        sourceTable: commandSource.sourceTable,
        evidenceSha256: commandSource.evidenceSha256,
        occurredAtUtc: arrival.recordedAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, REGISTER_CASE, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_emergency_case',
      aggregatePublicId: emergencyCasePublicId,
      eventType: 'canonical.emergency-case.registered',
      eventVersion: 1,
      occurredAtUtc: arrival.recordedAtUtc,
      businessDate,
      payload: eventPayload(result),
    },
  });
}

export async function replaceCanonicalEmergencyArrivalAssessment(
  db: CanonicalBatchDatabase,
  raw: ReplaceCanonicalEmergencyArrivalAssessmentInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<EmergencyCaseCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const emergencyCasePublicId = exact(raw.emergencyCasePublicId, 'emergencyCasePublicId');
  const expectedStatusVersion = positive(raw.expectedStatusVersion, 'expectedStatusVersion');
  const expectedArrivalVersion = positive(raw.expectedArrivalVersion, 'expectedArrivalVersion');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const commandActor = actor(raw);
  const commandSource = source(raw);
  const arrival = normalizeArrival(raw);
  const arrivalAssessmentPublicId = await publicId(
    'erarr', tenantId, commandSource.sourceType, commandSource.sourcePublicId,
    raw.arrivalAssessmentPublicId, 'arrivalAssessmentPublicId',
  );
  const full = {
    emergencyCasePublicId,
    expectedStatusVersion,
    expectedArrivalVersion,
    arrivalAssessmentPublicId,
    reasonCode,
    arrival,
    commandActor,
    commandSource,
  };
  const commandRequest = await request(full, businessDate);
  const replay = await readCanonicalCommandReplay<EmergencyCaseCommandResult>(db, {
    tenantId,
    commandName: REPLACE_ARRIVAL,
    idempotencyKey,
    request: commandRequest,
  });
  if (replay) return replay;
  const current = await emergencyCaseRow(db, tenantId, emergencyCasePublicId);
  if (Number(current.status_version) !== expectedStatusVersion || current.current_status === 'entered_in_error') {
    throw new Error('canonical emergency case status version conflict');
  }
  if (!current.current_arrival_assessment_public_id) throw new Error('current arrival assessment is required');
  const previous = await currentArrivalRow(
    db,
    tenantId,
    emergencyCasePublicId,
    current.current_arrival_assessment_public_id,
  );
  if (Number(previous.version_number) !== expectedArrivalVersion) {
    throw new Error('canonical emergency arrival version conflict');
  }
  if (commandActor.actorPractitionerPublicId) {
    await requirePractitioner(db, tenantId, commandActor.actorPractitionerPublicId);
  }
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'emergency_arrival_assessment',
    sourceType: commandSource.sourceType,
    sourcePublicId: commandSource.sourcePublicId,
    canonicalPublicId: arrivalAssessmentPublicId,
  });
  const nextVersion = expectedArrivalVersion + 1;
  const result = caseResult(
    emergencyCasePublicId,
    current.current_status,
    expectedStatusVersion,
    arrivalAssessmentPublicId,
    current.current_triage_assessment_public_id,
    current.current_disposition_event_public_id,
  );
  return runCanonicalBatch(db, {
    tenantId,
    commandName: REPLACE_ARRIVAL,
    idempotencyKey,
    request: commandRequest,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(
        `INSERT INTO canonical_emergency_arrival_assessments (
           tenant_id,arrival_assessment_public_id,emergency_case_public_id,patient_link_public_id,
           encounter_public_id,version_number,supersedes_arrival_assessment_public_id,version_kind,
           arrival_at_utc,mode_of_arrival_code,mode_source_type,mode_source_public_id,
           referral_source_type,referral_source_public_id,referral_snapshot,condition_on_arrival_code,
           condition_snapshot,brought_by_category,brought_by_relationship_category,police_case_indicator,
           actor_practitioner_public_id,actor_user_public_id,actor_system_key,observed_at_utc,
           recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        tenantId,
        arrivalAssessmentPublicId,
        emergencyCasePublicId,
        current.patient_link_public_id,
        current.encounter_public_id,
        nextVersion,
        previous.arrival_assessment_public_id,
        'correction',
        arrival.arrivalAtUtc,
        arrival.modeOfArrivalCode,
        arrival.modeSourceType,
        arrival.modeSourcePublicId,
        arrival.referralSourceType,
        arrival.referralSourcePublicId,
        arrival.referralSnapshot,
        arrival.conditionOnArrivalCode,
        arrival.conditionSnapshot,
        arrival.broughtByCategory,
        arrival.broughtByRelationshipCategory,
        arrival.policeCaseIndicator,
        commandActor.actorPractitionerPublicId,
        commandActor.actorUserPublicId,
        commandActor.actorSystemKey,
        arrival.observedAtUtc,
        arrival.recordedAtUtc,
        reasonCode,
        commandSource.evidenceSha256,
        arrival.recordedAtUtc,
      ),
      db.prepare(
        `UPDATE canonical_emergency_cases
         SET current_arrival_assessment_public_id=?,updated_at_utc=?
         WHERE tenant_id=? AND emergency_case_public_id=? AND status_version=?
           AND current_arrival_assessment_public_id=?`,
      ).bind(
        arrivalAssessmentPublicId,
        arrival.recordedAtUtc,
        tenantId,
        emergencyCasePublicId,
        expectedStatusVersion,
        previous.arrival_assessment_public_id,
      ),
      mappingStatement(db, {
        tenantId,
        entityType: 'emergency_arrival_assessment',
        canonicalPublicId: arrivalAssessmentPublicId,
        sourceType: commandSource.sourceType,
        sourcePublicId: commandSource.sourcePublicId,
        sourceTable: commandSource.sourceTable,
        evidenceSha256: commandSource.evidenceSha256,
        occurredAtUtc: arrival.recordedAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, REPLACE_ARRIVAL, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_emergency_case',
      aggregatePublicId: emergencyCasePublicId,
      eventType: 'canonical.emergency-arrival.corrected',
      eventVersion: nextVersion,
      occurredAtUtc: arrival.recordedAtUtc,
      businessDate,
      payload: eventPayload(result),
    },
  });
}

async function writeTriageAssessment(
  db: CanonicalBatchDatabase,
  raw: RecordCanonicalEmergencyTriageAssessmentInput | CorrectCanonicalEmergencyTriageAssessmentInput,
  config: { commandName: typeof RECORD_TRIAGE | typeof CORRECT_TRIAGE; correction: boolean },
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<EmergencyCaseCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const emergencyCasePublicId = exact(raw.emergencyCasePublicId, 'emergencyCasePublicId');
  const expectedStatusVersion = positive(raw.expectedStatusVersion, 'expectedStatusVersion');
  const expectedTriageVersion = nonnegative(raw.expectedTriageVersion, 'expectedTriageVersion');
  const commandActor = actor(raw);
  const commandSource = source(raw);
  const triage = normalizeTriage(raw);
  const triageAssessmentPublicId = await publicId(
    'ertri', tenantId, commandSource.sourceType, commandSource.sourcePublicId,
    raw.triageAssessmentPublicId, 'triageAssessmentPublicId',
  );
  const full = {
    emergencyCasePublicId,
    expectedStatusVersion,
    expectedTriageVersion,
    triageAssessmentPublicId,
    triage,
    correction: config.correction,
    commandActor,
    commandSource,
  };
  const commandRequest = await request(full, businessDate);
  const replay = await readCanonicalCommandReplay<EmergencyCaseCommandResult>(db, {
    tenantId,
    commandName: config.commandName,
    idempotencyKey,
    request: commandRequest,
  });
  if (replay) return replay;
  const current = await emergencyCaseRow(db, tenantId, emergencyCasePublicId);
  if (Number(current.status_version) !== expectedStatusVersion || current.current_status === 'entered_in_error') {
    throw new Error('canonical emergency case status version conflict');
  }
  if (!['arrived', 'awaiting_triage', 'triaged', 'care_in_progress', 'observation', 'disposition_pending'].includes(current.current_status)) {
    throw new Error('canonical emergency case does not accept triage assessment in the current state');
  }
  let previous: TriageRow | null = null;
  if (current.current_triage_assessment_public_id) {
    previous = await currentTriageRow(
      db,
      tenantId,
      emergencyCasePublicId,
      current.current_triage_assessment_public_id,
    );
  }
  if (expectedTriageVersion === 0) {
    if (previous) throw new Error('canonical emergency triage version conflict');
    if (config.correction) throw new Error('triage correction requires an existing assessment');
  } else if (!previous || Number(previous.version_number) !== expectedTriageVersion) {
    throw new Error('canonical emergency triage version conflict');
  }
  if (config.correction && expectedTriageVersion <= 0) {
    throw new Error('triage correction requires an existing assessment');
  }
  if (expectedTriageVersion > 0 && !triage.reasonCode) {
    throw new TypeError('reasonCode is required for triage reassessment or correction');
  }
  await requirePractitioner(db, tenantId, triage.triagePractitionerPublicId);
  if (triage.vitalObservationSetPublicId) {
    await requireVitalScope(db, {
      tenantId,
      observationSetPublicId: triage.vitalObservationSetPublicId,
      patientLinkPublicId: current.patient_link_public_id,
      encounterPublicId: current.encounter_public_id,
    });
  }
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'emergency_triage_assessment',
    sourceType: commandSource.sourceType,
    sourcePublicId: commandSource.sourcePublicId,
    canonicalPublicId: triageAssessmentPublicId,
  });
  const nextTriageVersion = expectedTriageVersion + 1;
  const versionKind = expectedTriageVersion === 0
    ? 'initial'
    : config.correction ? 'correction' : 'reassessment';
  const advancesStatus = expectedTriageVersion === 0
    && ['arrived', 'awaiting_triage'].includes(current.current_status);
  const nextStatusVersion = advancesStatus ? expectedStatusVersion + 1 : expectedStatusVersion;
  const nextStatus: CanonicalEmergencyCaseStatus = advancesStatus ? 'triaged' : current.current_status;
  const lifecycleEventPublicId = advancesStatus
    ? await eventId(tenantId, config.commandName, idempotencyKey, `status:${nextStatusVersion}`)
    : current.current_status_event_public_id;
  const result = caseResult(
    emergencyCasePublicId,
    nextStatus,
    nextStatusVersion,
    current.current_arrival_assessment_public_id,
    triageAssessmentPublicId,
    current.current_disposition_event_public_id,
  );
  const statements: CanonicalPreparedStatement[] = [
    db.prepare(
      `INSERT INTO canonical_emergency_triage_assessments (
         tenant_id,triage_assessment_public_id,emergency_case_public_id,patient_link_public_id,
         encounter_public_id,version_number,supersedes_triage_assessment_public_id,version_kind,
         acuity_code,legacy_acuity_code,triage_practitioner_public_id,vital_observation_set_public_id,
         presenting_risk_code,immediate_intervention_code,clinical_rationale_snapshot,observed_at_utc,
         recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      tenantId,
      triageAssessmentPublicId,
      emergencyCasePublicId,
      current.patient_link_public_id,
      current.encounter_public_id,
      nextTriageVersion,
      previous?.triage_assessment_public_id ?? null,
      versionKind,
      triage.acuityCode,
      triage.legacyAcuityCode,
      triage.triagePractitionerPublicId,
      triage.vitalObservationSetPublicId,
      triage.presentingRiskCode,
      triage.immediateInterventionCode,
      triage.clinicalRationaleSnapshot,
      triage.observedAtUtc,
      triage.recordedAtUtc,
      triage.reasonCode,
      commandSource.evidenceSha256,
      triage.recordedAtUtc,
    ),
  ];
  if (advancesStatus && lifecycleEventPublicId) {
    statements.push(statusEventStatement(db, {
      tenantId,
      eventPublicId: lifecycleEventPublicId,
      emergencyCasePublicId,
      fromStatus: current.current_status,
      toStatus: 'triaged',
      eventVersion: nextStatusVersion,
      eventType: 'triaged',
      actor: {
        ...commandActor,
        actorPractitionerPublicId: triage.triagePractitionerPublicId,
      },
      occurredAtUtc: triage.observedAtUtc,
      recordedAtUtc: triage.recordedAtUtc,
      reasonCode: triage.reasonCode ?? 'triaged',
      evidenceSha256: commandSource.evidenceSha256,
    }));
    statements.push(db.prepare(
      `UPDATE canonical_emergency_cases
       SET current_triage_assessment_public_id=?,current_status='triaged',status_version=?,
           current_status_event_public_id=?,updated_at_utc=?
       WHERE tenant_id=? AND emergency_case_public_id=? AND current_status=? AND status_version=?
         AND current_triage_assessment_public_id IS NULL`,
    ).bind(
      triageAssessmentPublicId,
      nextStatusVersion,
      lifecycleEventPublicId,
      triage.recordedAtUtc,
      tenantId,
      emergencyCasePublicId,
      current.current_status,
      expectedStatusVersion,
    ));
  } else {
    statements.push(db.prepare(
      `UPDATE canonical_emergency_cases
       SET current_triage_assessment_public_id=?,updated_at_utc=?
       WHERE tenant_id=? AND emergency_case_public_id=? AND status_version=?
         AND current_triage_assessment_public_id IS ?`,
    ).bind(
      triageAssessmentPublicId,
      triage.recordedAtUtc,
      tenantId,
      emergencyCasePublicId,
      expectedStatusVersion,
      previous?.triage_assessment_public_id ?? null,
    ));
  }
  statements.push(mappingStatement(db, {
    tenantId,
    entityType: 'emergency_triage_assessment',
    canonicalPublicId: triageAssessmentPublicId,
    sourceType: commandSource.sourceType,
    sourcePublicId: commandSource.sourcePublicId,
    sourceTable: commandSource.sourceTable,
    evidenceSha256: commandSource.evidenceSha256,
    occurredAtUtc: triage.recordedAtUtc,
  }));
  return runCanonicalBatch(db, {
    tenantId,
    commandName: config.commandName,
    idempotencyKey,
    request: commandRequest,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: await outboxId(tenantId, config.commandName, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_emergency_case',
      aggregatePublicId: emergencyCasePublicId,
      eventType: config.correction
        ? 'canonical.emergency-triage.corrected'
        : expectedTriageVersion === 0
          ? 'canonical.emergency-triage.recorded'
          : 'canonical.emergency-triage.reassessed',
      eventVersion: nextTriageVersion,
      occurredAtUtc: triage.recordedAtUtc,
      businessDate,
      payload: eventPayload(result),
    },
  });
}

export function recordCanonicalEmergencyTriageAssessment(
  db: CanonicalBatchDatabase,
  input: RecordCanonicalEmergencyTriageAssessmentInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return writeTriageAssessment(db, input, { commandName: RECORD_TRIAGE, correction: false }, execution);
}

export function correctCanonicalEmergencyTriageAssessment(
  db: CanonicalBatchDatabase,
  input: CorrectCanonicalEmergencyTriageAssessmentInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return writeTriageAssessment(db, input, { commandName: CORRECT_TRIAGE, correction: true }, execution);
}

export async function recordCanonicalEmergencyCaseClassification(
  db: CanonicalBatchDatabase,
  raw: RecordCanonicalEmergencyCaseClassificationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<EmergencyClassificationCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const emergencyCasePublicId = exact(raw.emergencyCasePublicId, 'emergencyCasePublicId');
  const expectedStatusVersion = positive(raw.expectedStatusVersion, 'expectedStatusVersion');
  const commandActor = actor(raw);
  const commandSource = source(raw);
  const classification = normalizeClassification(raw);
  const classificationPublicId = await publicId(
    'erclass', tenantId, commandSource.sourceType, commandSource.sourcePublicId,
    raw.classificationPublicId, 'classificationPublicId',
  );
  const full = {
    emergencyCasePublicId,
    expectedStatusVersion,
    classificationPublicId,
    classification,
    commandActor,
    commandSource,
  };
  const commandRequest = await request(full, businessDate);
  const replay = await readCanonicalCommandReplay<EmergencyClassificationCommandResult>(db, {
    tenantId,
    commandName: RECORD_CLASSIFICATION,
    idempotencyKey,
    request: commandRequest,
  });
  if (replay) return replay;
  const current = await emergencyCaseRow(db, tenantId, emergencyCasePublicId);
  if (Number(current.status_version) !== expectedStatusVersion || current.current_status === 'entered_in_error') {
    throw new Error('canonical emergency case status version conflict');
  }
  if (await currentClassificationRow(db, tenantId, classification.classificationFamilyPublicId)) {
    throw new Error('canonical emergency classification family already exists');
  }
  if (commandActor.actorPractitionerPublicId) {
    await requirePractitioner(db, tenantId, commandActor.actorPractitionerPublicId);
  }
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'emergency_case_classification',
    sourceType: commandSource.sourceType,
    sourcePublicId: commandSource.sourcePublicId,
    canonicalPublicId: classificationPublicId,
  });
  const result: EmergencyClassificationCommandResult = {
    emergencyCasePublicId,
    classificationFamilyPublicId: classification.classificationFamilyPublicId,
    classificationPublicId,
    versionNumber: 1,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: RECORD_CLASSIFICATION,
    idempotencyKey,
    request: commandRequest,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      classificationStatement(db, {
        tenantId,
        classificationPublicId,
        classificationFamilyPublicId: classification.classificationFamilyPublicId,
        emergencyCasePublicId,
        patientLinkPublicId: current.patient_link_public_id,
        encounterPublicId: current.encounter_public_id,
        versionNumber: 1,
        supersedesClassificationPublicId: null,
        versionKind: 'initial',
        classificationNamespace: classification.classificationNamespace,
        classificationCode: classification.classificationCode,
        categoryCode: classification.categoryCode,
        subcategoryCode: classification.subcategoryCode,
        animalCategoryCode: classification.animalCategoryCode,
        biteSiteCode: classification.biteSiteCode,
        biteAtUtc: classification.biteAtUtc,
        firstAidCode: classification.firstAidCode,
        policeCaseIndicator: classification.policeCaseIndicator,
        boundedSourceSnapshot: classification.boundedSourceSnapshot,
        actor: commandActor,
        occurredAtUtc: classification.occurredAtUtc,
        recordedAtUtc: classification.recordedAtUtc,
        reasonCode: null,
        evidenceSha256: commandSource.evidenceSha256,
      }),
      mappingStatement(db, {
        tenantId,
        entityType: 'emergency_case_classification',
        canonicalPublicId: classificationPublicId,
        sourceType: commandSource.sourceType,
        sourcePublicId: commandSource.sourcePublicId,
        sourceTable: commandSource.sourceTable,
        evidenceSha256: commandSource.evidenceSha256,
        occurredAtUtc: classification.recordedAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, RECORD_CLASSIFICATION, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_emergency_case',
      aggregatePublicId: emergencyCasePublicId,
      eventType: 'canonical.emergency-classification.recorded',
      eventVersion: 1,
      occurredAtUtc: classification.recordedAtUtc,
      businessDate,
      payload: { classificationVersion: 1 },
    },
  });
}

export async function correctCanonicalEmergencyCaseClassification(
  db: CanonicalBatchDatabase,
  raw: CorrectCanonicalEmergencyCaseClassificationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<EmergencyClassificationCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const emergencyCasePublicId = exact(raw.emergencyCasePublicId, 'emergencyCasePublicId');
  const expectedStatusVersion = positive(raw.expectedStatusVersion, 'expectedStatusVersion');
  const expectedClassificationVersion = positive(raw.expectedClassificationVersion, 'expectedClassificationVersion');
  const commandActor = actor(raw);
  const commandSource = source(raw);
  const classification = normalizeClassification(raw);
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const classificationPublicId = await publicId(
    'erclass', tenantId, commandSource.sourceType, commandSource.sourcePublicId,
    raw.classificationPublicId, 'classificationPublicId',
  );
  const full = {
    emergencyCasePublicId,
    expectedStatusVersion,
    expectedClassificationVersion,
    classificationPublicId,
    classification,
    reasonCode,
    commandActor,
    commandSource,
  };
  const commandRequest = await request(full, businessDate);
  const replay = await readCanonicalCommandReplay<EmergencyClassificationCommandResult>(db, {
    tenantId,
    commandName: CORRECT_CLASSIFICATION,
    idempotencyKey,
    request: commandRequest,
  });
  if (replay) return replay;
  const current = await emergencyCaseRow(db, tenantId, emergencyCasePublicId);
  if (Number(current.status_version) !== expectedStatusVersion || current.current_status === 'entered_in_error') {
    throw new Error('canonical emergency case status version conflict');
  }
  const previous = await currentClassificationRow(db, tenantId, classification.classificationFamilyPublicId);
  if (
    !previous
    || previous.emergency_case_public_id !== emergencyCasePublicId
    || Number(previous.version_number) !== expectedClassificationVersion
  ) {
    throw new Error('canonical emergency classification version conflict');
  }
  if (commandActor.actorPractitionerPublicId) {
    await requirePractitioner(db, tenantId, commandActor.actorPractitionerPublicId);
  }
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'emergency_case_classification',
    sourceType: commandSource.sourceType,
    sourcePublicId: commandSource.sourcePublicId,
    canonicalPublicId: classificationPublicId,
  });
  const nextVersion = expectedClassificationVersion + 1;
  const result: EmergencyClassificationCommandResult = {
    emergencyCasePublicId,
    classificationFamilyPublicId: classification.classificationFamilyPublicId,
    classificationPublicId,
    versionNumber: nextVersion,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: CORRECT_CLASSIFICATION,
    idempotencyKey,
    request: commandRequest,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      classificationStatement(db, {
        tenantId,
        classificationPublicId,
        classificationFamilyPublicId: classification.classificationFamilyPublicId,
        emergencyCasePublicId,
        patientLinkPublicId: current.patient_link_public_id,
        encounterPublicId: current.encounter_public_id,
        versionNumber: nextVersion,
        supersedesClassificationPublicId: previous.classification_public_id,
        versionKind: 'correction',
        classificationNamespace: classification.classificationNamespace,
        classificationCode: classification.classificationCode,
        categoryCode: classification.categoryCode,
        subcategoryCode: classification.subcategoryCode,
        animalCategoryCode: classification.animalCategoryCode,
        biteSiteCode: classification.biteSiteCode,
        biteAtUtc: classification.biteAtUtc,
        firstAidCode: classification.firstAidCode,
        policeCaseIndicator: classification.policeCaseIndicator,
        boundedSourceSnapshot: classification.boundedSourceSnapshot,
        actor: commandActor,
        occurredAtUtc: classification.occurredAtUtc,
        recordedAtUtc: classification.recordedAtUtc,
        reasonCode,
        evidenceSha256: commandSource.evidenceSha256,
      }),
      mappingStatement(db, {
        tenantId,
        entityType: 'emergency_case_classification',
        canonicalPublicId: classificationPublicId,
        sourceType: commandSource.sourceType,
        sourcePublicId: commandSource.sourcePublicId,
        sourceTable: commandSource.sourceTable,
        evidenceSha256: commandSource.evidenceSha256,
        occurredAtUtc: classification.recordedAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, CORRECT_CLASSIFICATION, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_emergency_case',
      aggregatePublicId: emergencyCasePublicId,
      eventType: 'canonical.emergency-classification.corrected',
      eventVersion: nextVersion,
      occurredAtUtc: classification.recordedAtUtc,
      businessDate,
      payload: { classificationVersion: nextVersion },
    },
  });
}

const transitionRules: Record<CanonicalEmergencyCaseStatus, readonly CanonicalEmergencyTransitionStatus[]> = {
  arrived: ['awaiting_triage', 'triaged', 'care_in_progress'],
  awaiting_triage: ['triaged', 'care_in_progress'],
  triaged: ['care_in_progress', 'observation', 'disposition_pending'],
  care_in_progress: ['observation', 'disposition_pending'],
  observation: ['care_in_progress', 'disposition_pending'],
  disposition_pending: ['care_in_progress', 'observation'],
  admitted: [],
  discharged: [],
  transferred: [],
  lama: [],
  dor: [],
  death: [],
  entered_in_error: [],
};

function transitionEventType(toStatus: CanonicalEmergencyTransitionStatus): string {
  switch (toStatus) {
    case 'awaiting_triage': return 'awaiting_triage';
    case 'triaged': return 'triaged';
    case 'care_in_progress': return 'care_started';
    case 'observation': return 'observation_started';
    case 'disposition_pending': return 'disposition_pending';
  }
}

export async function transitionCanonicalEmergencyCase(
  db: CanonicalBatchDatabase,
  raw: TransitionCanonicalEmergencyCaseInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<EmergencyCaseCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const emergencyCasePublicId = exact(raw.emergencyCasePublicId, 'emergencyCasePublicId');
  const expectedStatusVersion = positive(raw.expectedStatusVersion, 'expectedStatusVersion');
  if (!['awaiting_triage', 'triaged', 'care_in_progress', 'observation', 'disposition_pending'].includes(raw.toStatus)) {
    throw new Error('terminal status requires the emergency disposition command');
  }
  const toStatus = raw.toStatus as CanonicalEmergencyTransitionStatus;
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const recordedAtUtc = utc(raw.recordedAtUtc, 'recordedAtUtc');
  if (recordedAtUtc < occurredAtUtc) throw new RangeError('recordedAtUtc cannot precede occurredAtUtc');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const commandActor = actor(raw);
  const commandSource = source(raw);
  const full = {
    emergencyCasePublicId,
    expectedStatusVersion,
    toStatus,
    occurredAtUtc,
    recordedAtUtc,
    reasonCode,
    commandActor,
    commandSource,
  };
  const commandRequest = await request(full, businessDate);
  const replay = await readCanonicalCommandReplay<EmergencyCaseCommandResult>(db, {
    tenantId,
    commandName: TRANSITION_CASE,
    idempotencyKey,
    request: commandRequest,
  });
  if (replay) return replay;
  const current = await emergencyCaseRow(db, tenantId, emergencyCasePublicId);
  if (Number(current.status_version) !== expectedStatusVersion) {
    throw new Error('canonical emergency case status version conflict');
  }
  if (!transitionRules[current.current_status].includes(toStatus)) {
    throw new Error('canonical emergency lifecycle transition is invalid');
  }
  if (toStatus === 'triaged' && !current.current_triage_assessment_public_id) {
    throw new Error('triaged status requires a current triage assessment');
  }
  if (commandActor.actorPractitionerPublicId) {
    await requirePractitioner(db, tenantId, commandActor.actorPractitionerPublicId);
  }
  const nextStatusVersion = expectedStatusVersion + 1;
  const lifecycleEventPublicId = await eventId(
    tenantId,
    TRANSITION_CASE,
    idempotencyKey,
    `status:${nextStatusVersion}`,
  );
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'emergency_case_status_event',
    sourceType: commandSource.sourceType,
    sourcePublicId: commandSource.sourcePublicId,
    canonicalPublicId: lifecycleEventPublicId,
  });
  const result = caseResult(
    emergencyCasePublicId,
    toStatus,
    nextStatusVersion,
    current.current_arrival_assessment_public_id,
    current.current_triage_assessment_public_id,
    current.current_disposition_event_public_id,
  );
  return runCanonicalBatch(db, {
    tenantId,
    commandName: TRANSITION_CASE,
    idempotencyKey,
    request: commandRequest,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      statusEventStatement(db, {
        tenantId,
        eventPublicId: lifecycleEventPublicId,
        emergencyCasePublicId,
        fromStatus: current.current_status,
        toStatus,
        eventVersion: nextStatusVersion,
        eventType: transitionEventType(toStatus),
        actor: commandActor,
        occurredAtUtc,
        recordedAtUtc,
        reasonCode,
        evidenceSha256: commandSource.evidenceSha256,
      }),
      db.prepare(
        `UPDATE canonical_emergency_cases
         SET current_status=?,status_version=?,current_status_event_public_id=?,updated_at_utc=?
         WHERE tenant_id=? AND emergency_case_public_id=? AND current_status=? AND status_version=?`,
      ).bind(
        toStatus,
        nextStatusVersion,
        lifecycleEventPublicId,
        recordedAtUtc,
        tenantId,
        emergencyCasePublicId,
        current.current_status,
        expectedStatusVersion,
      ),
      mappingStatement(db, {
        tenantId,
        entityType: 'emergency_case_status_event',
        canonicalPublicId: lifecycleEventPublicId,
        sourceType: commandSource.sourceType,
        sourcePublicId: commandSource.sourcePublicId,
        sourceTable: commandSource.sourceTable,
        evidenceSha256: commandSource.evidenceSha256,
        occurredAtUtc: recordedAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, TRANSITION_CASE, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_emergency_case',
      aggregatePublicId: emergencyCasePublicId,
      eventType: `canonical.emergency-case.${toStatus.replaceAll('_', '-')}`,
      eventVersion: nextStatusVersion,
      occurredAtUtc: recordedAtUtc,
      businessDate,
      payload: eventPayload(result),
    },
  });
}

interface NormalizedDisposition {
  canonicalAdmissionPublicId: string | null;
  dischargeDocumentPublicId: string | null;
  dischargeDocumentVersionPublicId: string | null;
  dischargeDocumentContentSha256: string | null;
  receivingOrganizationSourceType: string | null;
  receivingOrganizationSourcePublicId: string | null;
  receivingEncounterSourceType: string | null;
  receivingEncounterSourcePublicId: string | null;
  transportServiceEventPublicId: string | null;
  terminalEvidenceCode: string | null;
  occurredAtUtc: string;
  recordedAtUtc: string;
  reasonCode: string;
  remarksSnapshot: string | null;
}

function normalizeDisposition(raw: {
  canonicalAdmissionPublicId?: string | null;
  dischargeDocumentPublicId?: string | null;
  dischargeDocumentVersionPublicId?: string | null;
  dischargeDocumentContentSha256?: string | null;
  receivingOrganizationSourceType?: string | null;
  receivingOrganizationSourcePublicId?: string | null;
  receivingEncounterSourceType?: string | null;
  receivingEncounterSourcePublicId?: string | null;
  transportServiceEventPublicId?: string | null;
  terminalEvidenceCode?: string | null;
  occurredAtUtc: string;
  recordedAtUtc: string;
  reasonCode: string;
  remarksSnapshot?: string | null;
}): NormalizedDisposition {
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const recordedAtUtc = utc(raw.recordedAtUtc, 'recordedAtUtc');
  if (recordedAtUtc < occurredAtUtc) throw new RangeError('recordedAtUtc cannot precede occurredAtUtc');
  const dischargeDocumentPublicId = optional(raw.dischargeDocumentPublicId, 'dischargeDocumentPublicId');
  const dischargeDocumentVersionPublicId = optional(
    raw.dischargeDocumentVersionPublicId,
    'dischargeDocumentVersionPublicId',
  );
  const dischargeDocumentContentSha256 = raw.dischargeDocumentContentSha256 == null
    ? null
    : digest(raw.dischargeDocumentContentSha256, 'dischargeDocumentContentSha256');
  const documentParts = [
    dischargeDocumentPublicId,
    dischargeDocumentVersionPublicId,
    dischargeDocumentContentSha256,
  ].filter((value) => value != null).length;
  if (documentParts !== 0 && documentParts !== 3) {
    throw new TypeError('discharge document public ID, version public ID, and content hash must be provided together');
  }
  const receivingOrganizationSourceType = optional(
    raw.receivingOrganizationSourceType,
    'receivingOrganizationSourceType',
  );
  const receivingOrganizationSourcePublicId = optional(
    raw.receivingOrganizationSourcePublicId,
    'receivingOrganizationSourcePublicId',
  );
  const receivingEncounterSourceType = optional(raw.receivingEncounterSourceType, 'receivingEncounterSourceType');
  const receivingEncounterSourcePublicId = optional(
    raw.receivingEncounterSourcePublicId,
    'receivingEncounterSourcePublicId',
  );
  pair(receivingOrganizationSourceType, receivingOrganizationSourcePublicId, 'receiving organization source');
  pair(receivingEncounterSourceType, receivingEncounterSourcePublicId, 'receiving encounter source');
  return {
    canonicalAdmissionPublicId: optional(raw.canonicalAdmissionPublicId, 'canonicalAdmissionPublicId'),
    dischargeDocumentPublicId,
    dischargeDocumentVersionPublicId,
    dischargeDocumentContentSha256,
    receivingOrganizationSourceType,
    receivingOrganizationSourcePublicId,
    receivingEncounterSourceType,
    receivingEncounterSourcePublicId,
    transportServiceEventPublicId: optional(raw.transportServiceEventPublicId, 'transportServiceEventPublicId'),
    terminalEvidenceCode: optional(raw.terminalEvidenceCode, 'terminalEvidenceCode'),
    occurredAtUtc,
    recordedAtUtc,
    reasonCode: exact(raw.reasonCode, 'reasonCode'),
    remarksSnapshot: optional(raw.remarksSnapshot, 'remarksSnapshot'),
  };
}

async function writeDisposition(
  db: CanonicalBatchDatabase,
  raw: RecordCanonicalEmergencyDispositionInput | EnterCanonicalEmergencyCaseInErrorInput,
  config: {
    commandName: typeof RECORD_DISPOSITION | typeof ENTER_CASE_ERROR;
    dispositionCode: CanonicalEmergencyDispositionCode | 'entered_in_error';
    allowTerminalSource: boolean;
  },
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<EmergencyCaseCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const emergencyCasePublicId = exact(raw.emergencyCasePublicId, 'emergencyCasePublicId');
  const expectedStatusVersion = positive(raw.expectedStatusVersion, 'expectedStatusVersion');
  const expectedDispositionVersion = nonnegative(raw.expectedDispositionVersion, 'expectedDispositionVersion');
  const commandActor = actor(raw);
  if (!commandActor.actorPractitionerPublicId) {
    throw new TypeError('actorPractitionerPublicId is required for emergency disposition');
  }
  const commandSource = source(raw);
  const disposition = normalizeDisposition(raw);
  const dispositionCode = config.dispositionCode;
  const dispositionEventPublicId = await publicId(
    'erdisp', tenantId, commandSource.sourceType, commandSource.sourcePublicId,
    raw.dispositionEventPublicId, 'dispositionEventPublicId',
  );
  const full = {
    emergencyCasePublicId,
    expectedStatusVersion,
    expectedDispositionVersion,
    dispositionEventPublicId,
    dispositionCode,
    disposition,
    commandActor,
    commandSource,
  };
  const commandRequest = await request(full, businessDate);
  const replay = await readCanonicalCommandReplay<EmergencyCaseCommandResult>(db, {
    tenantId,
    commandName: config.commandName,
    idempotencyKey,
    request: commandRequest,
  });
  if (replay) return replay;
  const current = await emergencyCaseRow(db, tenantId, emergencyCasePublicId);
  if (Number(current.status_version) !== expectedStatusVersion) {
    throw new Error('canonical emergency case status version conflict');
  }
  if (config.allowTerminalSource) {
    if (current.current_status === 'entered_in_error') throw new Error('canonical emergency case is already entered in error');
  } else if (current.current_status !== 'disposition_pending') {
    throw new Error('canonical emergency disposition requires disposition_pending status');
  }
  const previousDisposition = await currentDispositionRow(db, tenantId, emergencyCasePublicId);
  const currentDispositionVersion = previousDisposition ? Number(previousDisposition.disposition_version) : 0;
  if (currentDispositionVersion !== expectedDispositionVersion) {
    throw new Error('canonical emergency disposition version conflict');
  }
  await requirePractitioner(db, tenantId, commandActor.actorPractitionerPublicId);
  if (dispositionCode === 'admitted') {
    if (!disposition.canonicalAdmissionPublicId) throw new Error('admitted disposition requires admission evidence');
    await requireAdmissionScope(
      db,
      tenantId,
      disposition.canonicalAdmissionPublicId,
      current.patient_link_public_id,
    );
  } else if (disposition.canonicalAdmissionPublicId) {
    throw new Error('admission evidence is only valid for admitted disposition');
  }
  if (dispositionCode === 'discharged' && disposition.dischargeDocumentPublicId) {
    await requireDischargeDocumentScope(db, {
      tenantId,
      documentPublicId: disposition.dischargeDocumentPublicId,
      versionPublicId: disposition.dischargeDocumentVersionPublicId!,
      contentSha256: disposition.dischargeDocumentContentSha256!,
      patientLinkPublicId: current.patient_link_public_id,
      encounterPublicId: current.encounter_public_id,
    });
  } else if (dispositionCode !== 'discharged' && disposition.dischargeDocumentPublicId) {
    throw new Error('discharge document evidence is only valid for discharged disposition');
  }
  if (
    dispositionCode === 'transferred'
    && (!disposition.receivingOrganizationSourceType || !disposition.receivingOrganizationSourcePublicId)
  ) {
    throw new Error('transfer destination evidence is incomplete');
  }
  if (
    ['lama', 'dor', 'death', 'entered_in_error'].includes(dispositionCode)
    && !disposition.terminalEvidenceCode
  ) {
    throw new Error('typed terminal evidence is required');
  }
  if (disposition.transportServiceEventPublicId) {
    await requireTransportEventScope(
      db,
      tenantId,
      disposition.transportServiceEventPublicId,
      current.encounter_public_id,
    );
  }
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'emergency_disposition_event',
    sourceType: commandSource.sourceType,
    sourcePublicId: commandSource.sourcePublicId,
    canonicalPublicId: dispositionEventPublicId,
  });
  const nextDispositionVersion = expectedDispositionVersion + 1;
  const nextStatusVersion = expectedStatusVersion + 1;
  const nextStatus: CanonicalEmergencyCaseStatus = dispositionCode === 'observation_continuation'
    ? 'observation'
    : dispositionCode;
  const lifecycleEventPublicId = await eventId(
    tenantId,
    config.commandName,
    idempotencyKey,
    `status:${nextStatusVersion}`,
  );
  const eventType = dispositionCode === 'observation_continuation' ? 'observation_started' : dispositionCode;
  const result = caseResult(
    emergencyCasePublicId,
    nextStatus,
    nextStatusVersion,
    current.current_arrival_assessment_public_id,
    current.current_triage_assessment_public_id,
    dispositionEventPublicId,
  );
  return runCanonicalBatch(db, {
    tenantId,
    commandName: config.commandName,
    idempotencyKey,
    request: commandRequest,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(
        `INSERT INTO canonical_emergency_disposition_events (
           tenant_id,disposition_event_public_id,emergency_case_public_id,patient_link_public_id,
           encounter_public_id,disposition_version,disposition_code,actor_practitioner_public_id,
           actor_user_public_id,actor_system_key,canonical_admission_public_id,discharge_document_public_id,
           discharge_document_version_public_id,discharge_document_content_sha256,
           receiving_organization_source_type,receiving_organization_source_public_id,
           receiving_encounter_source_type,receiving_encounter_source_public_id,
           transport_service_event_public_id,terminal_evidence_code,occurred_at_utc,recorded_at_utc,
           reason_code,remarks_snapshot,source_evidence_sha256,created_at_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        tenantId,
        dispositionEventPublicId,
        emergencyCasePublicId,
        current.patient_link_public_id,
        current.encounter_public_id,
        nextDispositionVersion,
        dispositionCode,
        commandActor.actorPractitionerPublicId,
        commandActor.actorUserPublicId,
        commandActor.actorSystemKey,
        disposition.canonicalAdmissionPublicId,
        disposition.dischargeDocumentPublicId,
        disposition.dischargeDocumentVersionPublicId,
        disposition.dischargeDocumentContentSha256,
        disposition.receivingOrganizationSourceType,
        disposition.receivingOrganizationSourcePublicId,
        disposition.receivingEncounterSourceType,
        disposition.receivingEncounterSourcePublicId,
        disposition.transportServiceEventPublicId,
        disposition.terminalEvidenceCode,
        disposition.occurredAtUtc,
        disposition.recordedAtUtc,
        disposition.reasonCode,
        disposition.remarksSnapshot,
        commandSource.evidenceSha256,
        disposition.recordedAtUtc,
      ),
      statusEventStatement(db, {
        tenantId,
        eventPublicId: lifecycleEventPublicId,
        emergencyCasePublicId,
        fromStatus: current.current_status,
        toStatus: nextStatus,
        eventVersion: nextStatusVersion,
        eventType,
        actor: commandActor,
        occurredAtUtc: disposition.occurredAtUtc,
        recordedAtUtc: disposition.recordedAtUtc,
        reasonCode: disposition.reasonCode,
        evidenceSha256: commandSource.evidenceSha256,
      }),
      db.prepare(
        `UPDATE canonical_emergency_cases
         SET current_status=?,status_version=?,current_status_event_public_id=?,
             current_disposition_event_public_id=?,updated_at_utc=?
         WHERE tenant_id=? AND emergency_case_public_id=? AND current_status=? AND status_version=?
           AND current_disposition_event_public_id IS ?`,
      ).bind(
        nextStatus,
        nextStatusVersion,
        lifecycleEventPublicId,
        dispositionEventPublicId,
        disposition.recordedAtUtc,
        tenantId,
        emergencyCasePublicId,
        current.current_status,
        expectedStatusVersion,
        previousDisposition?.disposition_event_public_id ?? null,
      ),
      mappingStatement(db, {
        tenantId,
        entityType: 'emergency_disposition_event',
        canonicalPublicId: dispositionEventPublicId,
        sourceType: commandSource.sourceType,
        sourcePublicId: commandSource.sourcePublicId,
        sourceTable: commandSource.sourceTable,
        evidenceSha256: commandSource.evidenceSha256,
        occurredAtUtc: disposition.recordedAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, config.commandName, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_emergency_case',
      aggregatePublicId: emergencyCasePublicId,
      eventType: dispositionCode === 'entered_in_error'
        ? 'canonical.emergency-case.entered-in-error'
        : `canonical.emergency-disposition.${dispositionCode.replaceAll('_', '-')}`,
      eventVersion: nextStatusVersion,
      occurredAtUtc: disposition.recordedAtUtc,
      businessDate,
      payload: eventPayload(result),
    },
  });
}

export function recordCanonicalEmergencyDisposition(
  db: CanonicalBatchDatabase,
  input: RecordCanonicalEmergencyDispositionInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return writeDisposition(
    db,
    input,
    { commandName: RECORD_DISPOSITION, dispositionCode: input.dispositionCode, allowTerminalSource: false },
    execution,
  );
}

export function enterCanonicalEmergencyCaseInError(
  db: CanonicalBatchDatabase,
  input: EnterCanonicalEmergencyCaseInErrorInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return writeDisposition(
    db,
    input,
    { commandName: ENTER_CASE_ERROR, dispositionCode: 'entered_in_error', allowTerminalSource: true },
    execution,
  );
}
