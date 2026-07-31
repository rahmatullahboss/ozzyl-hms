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

export type CanonicalLabSpecimenStatus =
  | 'registered'
  | 'collected'
  | 'in_transit'
  | 'received'
  | 'processing'
  | 'rejected'
  | 'disposed'
  | 'entered_in_error';

export type CanonicalLabResultStatus =
  | 'draft'
  | 'verified'
  | 'validated'
  | 'published'
  | 'retracted'
  | 'entered_in_error';

export type CanonicalLabObservationValueType =
  | 'decimal'
  | 'text'
  | 'coded'
  | 'boolean'
  | 'date_time'
  | 'absent';

export type CanonicalLabObservationStatus =
  | 'preliminary'
  | 'final'
  | 'corrected'
  | 'retracted'
  | 'entered_in_error'
  | 'absent';

interface CommandActorInput {
  actorUserPublicId?: string | null;
  actorSystemKey?: string | null;
}

interface CommandBase extends CommandActorInput {
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

export interface RegisterCanonicalLabSpecimenInput extends CommandBase, SourceInput {
  specimenPublicId?: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  requestPublicId: string;
  servicePublicId: string;
  eventPublicId?: string | null;
  accessionNamespace: string;
  accessionValue: string;
  barcodeNamespace: string;
  barcodeValue: string;
  specimenTypeCode: string;
  containerCode?: string | null;
  parentSpecimenPublicId?: string | null;
  practitionerPublicId?: string | null;
  occurredAtUtc: string;
}

interface SpecimenTransitionBase extends CommandBase {
  specimenPublicId: string;
  expectedStatusVersion: number;
  practitionerPublicId: string;
  occurredAtUtc: string;
  recordedAtUtc: string;
  sourceEvidenceSha256: string;
  locationSourceType?: string | null;
  locationSourcePublicId?: string | null;
}

export interface CollectCanonicalLabSpecimenInput extends SpecimenTransitionBase {
  collectionMethodCode?: string | null;
}

export interface ReceiveCanonicalLabSpecimenInput extends SpecimenTransitionBase {
  transportConditionCode?: string | null;
}

export interface RejectCanonicalLabSpecimenInput extends SpecimenTransitionBase {
  reasonCode: string;
}

export interface CreateCanonicalLabSpecimenAliquotInput extends CommandBase, SourceInput {
  parentSpecimenPublicId: string;
  expectedParentStatusVersion: number;
  aliquotSpecimenPublicId?: string;
  accessionNamespace: string;
  accessionValue: string;
  barcodeNamespace: string;
  barcodeValue: string;
  specimenTypeCode: string;
  containerCode?: string | null;
  practitionerPublicId: string;
  occurredAtUtc: string;
}

export interface CanonicalLabObservationInput {
  observationPublicId?: string;
  servicePublicId: string;
  componentSourceType: string;
  componentSourcePublicId: string;
  observationCode: string;
  codeSystem: string;
  displaySnapshot: string;
  valueType: CanonicalLabObservationValueType;
  valueText?: string | null;
  valueDecimal?: string | null;
  valueCode?: string | null;
  valueCodeSystem?: string | null;
  valueBoolean?: boolean | null;
  valueDateTimeUtc?: string | null;
  unitCode?: string | null;
  referenceLowDecimal?: string | null;
  referenceHighDecimal?: string | null;
  referenceText?: string | null;
  interpretationCode?: string | null;
  methodCode?: string | null;
  observationStatus: CanonicalLabObservationStatus;
  reasonCode?: string | null;
  sourceEvidenceSha256: string;
}

export interface CreateCanonicalLabResultDraftInput extends CommandBase, SourceInput {
  resultSetPublicId?: string;
  versionPublicId?: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  requestPublicId: string;
  eventPublicId?: string | null;
  specimenPublicId: string;
  servicePublicId: string;
  creatingPractitionerPublicId: string;
  observations: CanonicalLabObservationInput[];
  occurredAtUtc: string;
}

interface ReplaceLabResultVersionBase extends CommandBase {
  resultSetPublicId: string;
  expectedStatusVersion: number;
  versionPublicId?: string;
  authoringPractitionerPublicId: string;
  reasonCode: string;
  observations: CanonicalLabObservationInput[];
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
}

export interface ReplaceCanonicalLabResultDraftInput extends ReplaceLabResultVersionBase {}
export interface CorrectCanonicalLabResultVersionInput extends ReplaceLabResultVersionBase {}

export interface VerifyCanonicalLabResultVersionInput extends CommandBase {
  resultSetPublicId: string;
  versionPublicId: string;
  expectedStatusVersion: number;
  verifyingPractitionerPublicId: string;
  signedContentSha256: string;
  reasonCode: string;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
}

export interface ValidateAndPublishCanonicalLabResultVersionInput extends CommandBase {
  resultSetPublicId: string;
  versionPublicId: string;
  expectedStatusVersion: number;
  validatingPractitionerPublicId: string;
  signedContentSha256: string;
  validationReasonCode: string;
  publicationReasonCode: string;
  sourceEvidenceSha256: string;
  validatedAtUtc: string;
  publishedAtUtc: string;
}

interface TerminalLabResultInput extends CommandBase {
  resultSetPublicId: string;
  expectedStatusVersion: number;
  versionPublicId?: string;
  authoringPractitionerPublicId: string;
  reasonCode: string;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
}

export interface RetractCanonicalLabResultVersionInput extends TerminalLabResultInput {}
export interface EnterCanonicalLabResultInErrorInput extends TerminalLabResultInput {}

export type CanonicalLabAnalyzerQcState = 'pending' | 'passed' | 'failed' | 'not_applicable';
export type CanonicalLabAnalyzerValidationState = 'pending' | 'passed' | 'failed' | 'overridden';
export type CanonicalLabAnalyzerMatchState = 'unmatched' | 'candidate' | 'matched' | 'ambiguous' | 'rejected';
export type CanonicalLabAnalyzerDisposition = 'staged' | 'accepted' | 'rejected' | 'superseded' | 'collision';

export interface AttachCanonicalLabAnalyzerEvidenceInput extends CommandBase {
  resultSetPublicId: string;
  versionPublicId: string;
  observationPublicId: string;
  analyzerEvidencePublicId?: string;
  sourceType: string;
  sourcePublicId: string;
  ingestionMessagePublicId?: string | null;
  observationIndex: number;
  machineSourceType?: string | null;
  machineSourcePublicId?: string | null;
  bridgeSourceType?: string | null;
  bridgeSourcePublicId?: string | null;
  logSourceType?: string | null;
  logSourcePublicId?: string | null;
  protocol?: string | null;
  payloadSha256: string;
  qcState: CanonicalLabAnalyzerQcState;
  validationState: CanonicalLabAnalyzerValidationState;
  matchState: CanonicalLabAnalyzerMatchState;
  disposition: CanonicalLabAnalyzerDisposition;
  conversionFactorDecimal?: string | null;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
}

export interface CanonicalLabSpecimenCommandResult {
  specimenPublicId: string;
  currentStatus: CanonicalLabSpecimenStatus;
  statusVersion: number;
  parentSpecimenPublicId?: string;
}

export interface CanonicalLabResultCommandResult {
  resultSetPublicId: string;
  versionPublicId: string;
  currentStatus: CanonicalLabResultStatus;
  statusVersion: number;
  versionNumber: number;
  observationCount: number;
}

export interface CanonicalLabAnalyzerCommandResult {
  analyzerEvidencePublicId: string;
  observationPublicId: string;
  disposition: CanonicalLabAnalyzerDisposition;
}

interface NormalizedActor {
  actorUserPublicId: string | null;
  actorSystemKey: string | null;
}

interface ScopeRow {
  patient_link_public_id: string;
  encounter_public_id: string;
  request_public_id: string;
  event_public_id: string | null;
  specimen_public_id: string;
  service_public_id: string;
  current_version_public_id: string | null;
  current_status: CanonicalLabResultStatus;
  status_version: number;
}

interface SpecimenRow {
  patient_link_public_id: string;
  encounter_public_id: string;
  primary_request_public_id: string;
  primary_service_public_id: string;
  current_status: CanonicalLabSpecimenStatus;
  status_version: number;
}

interface VersionRow {
  version_public_id: string;
  version_number: number;
  version_status: CanonicalLabResultStatus;
  content_sha256: string;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface NormalizedObservation {
  observationPublicId: string;
  observationSequence: number;
  servicePublicId: string;
  componentSourceType: string;
  componentSourcePublicId: string;
  observationCode: string;
  codeSystem: string;
  displaySnapshot: string;
  valueType: CanonicalLabObservationValueType;
  valueText: string | null;
  valueDecimal: string | null;
  valueCode: string | null;
  valueCodeSystem: string | null;
  valueBoolean: number | null;
  valueDateTimeUtc: string | null;
  unitCode: string | null;
  referenceLowDecimal: string | null;
  referenceHighDecimal: string | null;
  referenceText: string | null;
  interpretationCode: string | null;
  methodCode: string | null;
  observationStatus: CanonicalLabObservationStatus;
  reasonCode: string | null;
  sourceEvidenceSha256: string;
}

const REGISTER_SPECIMEN = 'registerCanonicalLabSpecimen';
const COLLECT_SPECIMEN = 'collectCanonicalLabSpecimen';
const RECEIVE_SPECIMEN = 'receiveCanonicalLabSpecimen';
const REJECT_SPECIMEN = 'rejectCanonicalLabSpecimen';
const CREATE_ALIQUOT = 'createCanonicalLabSpecimenAliquot';
const CREATE_RESULT = 'createCanonicalLabResultDraft';
const REPLACE_RESULT = 'replaceCanonicalLabResultDraft';
const VERIFY_RESULT = 'verifyCanonicalLabResultVersion';
const VALIDATE_PUBLISH_RESULT = 'validateAndPublishCanonicalLabResultVersion';
const CORRECT_RESULT = 'correctCanonicalLabResultVersion';
const RETRACT_RESULT = 'retractCanonicalLabResultVersion';
const ERROR_RESULT = 'enterCanonicalLabResultInError';
const ATTACH_ANALYZER = 'attachCanonicalLabAnalyzerEvidence';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  return value == null ? null : exact(value, label);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
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

function normalizeActor(input: CommandActorInput): NormalizedActor {
  const actorUserPublicId = optionalExact(input.actorUserPublicId, 'actorUserPublicId');
  const actorSystemKey = optionalExact(input.actorSystemKey, 'actorSystemKey');
  if (actorUserPublicId == null && actorSystemKey == null) {
    throw new TypeError('actorUserPublicId or actorSystemKey is required');
  }
  return { actorUserPublicId, actorSystemKey };
}

function decimal(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  const raw = exact(value, label);
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
    throw new TypeError(`${label} must be a plain decimal string`);
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [integer, fraction = ''] = unsigned.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const normalizedUnsigned = trimmed ? `${integer}.${trimmed}` : integer;
  if (/^0(?:\.0*)?$/.test(normalizedUnsigned)) return '0';
  return negative ? `-${normalizedUnsigned}` : normalizedUnsigned;
}

function paired(left: string | null, right: string | null, label: string): void {
  if ((left == null) !== (right == null)) throw new TypeError(`${label} source type and public ID must be provided together`);
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

async function outboxId(
  tenantId: string,
  commandName: string,
  idempotencyKey: string,
  supplied?: string,
): Promise<string> {
  return deterministicId('evt', tenantId, commandName, idempotencyKey, supplied, 'outboxEventPublicId');
}

async function lifecycleId(
  prefix: string,
  tenantId: string,
  commandName: string,
  idempotencyKey: string,
  suffix: string,
): Promise<string> {
  return createDeterministicSourceId(prefix, tenantId, commandName, `${idempotencyKey}:${suffix}`);
}

async function minimalRequest(fullOperation: unknown, businessDate: string) {
  return {
    schemaVersion: 1 as const,
    operationFingerprintSha256: await createRequestFingerprint(fullOperation),
    businessDate,
  };
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
  if (!row || row.status !== 'active') throw new Error('active practitioner is required');
}

async function requireClinicalScope(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    patientLinkPublicId: string;
    encounterPublicId: string;
    requestPublicId: string;
    servicePublicId: string;
    eventPublicId: string | null;
  },
): Promise<void> {
  const patient = await db.prepare(`
    SELECT link_status,effective_to_utc FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(input.tenantId, input.patientLinkPublicId).first<{ link_status: string; effective_to_utc: string | null }>();
  if (!patient || ['rejected', 'retired'].includes(patient.link_status) || patient.effective_to_utc != null) {
    throw new Error('active patient link is required');
  }
  const encounter = await db.prepare(`
    SELECT patient_link_public_id,status FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(input.tenantId, input.encounterPublicId).first<{ patient_link_public_id: string | null; status: string }>();
  if (!encounter || encounter.patient_link_public_id !== input.patientLinkPublicId || encounter.status === 'entered_in_error') {
    throw new Error('encounter patient scope mismatch');
  }
  const request = await db.prepare(`
    SELECT encounter_public_id,service_public_id,status FROM canonical_service_requests
    WHERE tenant_id=? AND request_public_id=? LIMIT 1
  `).bind(input.tenantId, input.requestPublicId).first<{
    encounter_public_id: string;
    service_public_id: string;
    status: string;
  }>();
  if (!request || request.encounter_public_id !== input.encounterPublicId || request.service_public_id !== input.servicePublicId) {
    throw new Error('service request scope mismatch');
  }
  const service = await db.prepare(`
    SELECT status,item_kind FROM canonical_service_catalog_items
    WHERE tenant_id=? AND service_public_id=? LIMIT 1
  `).bind(input.tenantId, input.servicePublicId).first<{ status: string; item_kind: string }>();
  if (!service || service.status !== 'active' || service.item_kind !== 'laboratory') {
    throw new Error('active laboratory service is required');
  }
  if (input.eventPublicId) {
    const event = await db.prepare(`
      SELECT request_public_id,encounter_public_id,service_public_id,status,event_type
      FROM canonical_service_events
      WHERE tenant_id=? AND event_public_id=? LIMIT 1
    `).bind(input.tenantId, input.eventPublicId).first<{
      request_public_id: string;
      encounter_public_id: string;
      service_public_id: string;
      status: string;
      event_type: string;
    }>();
    if (
      !event
      || event.request_public_id !== input.requestPublicId
      || event.encounter_public_id !== input.encounterPublicId
      || event.service_public_id !== input.servicePublicId
      || event.status !== 'posted'
    ) throw new Error('service event scope mismatch');
  }
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
  const row = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(
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

function specimenHeaderStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    specimenPublicId: string;
    patientLinkPublicId: string;
    encounterPublicId: string;
    requestPublicId: string;
    servicePublicId: string;
    accessionNamespace: string;
    accessionValue: string;
    barcodeNamespace: string;
    barcodeValue: string;
    specimenTypeCode: string;
    containerCode: string | null;
    parentSpecimenPublicId: string | null;
    actor: NormalizedActor;
    idempotencyKey: string;
    fingerprint: string;
    evidenceSha256: string;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_lab_specimens (
      tenant_id,specimen_public_id,patient_link_public_id,encounter_public_id,
      primary_request_public_id,primary_service_public_id,accession_namespace,
      accession_value,barcode_namespace,barcode_value,specimen_type_code,
      container_code,parent_specimen_public_id,current_status,status_version,
      current_status_event_public_id,actor_user_public_id,actor_system_key,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'registered',1,NULL,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.specimenPublicId,
    input.patientLinkPublicId,
    input.encounterPublicId,
    input.requestPublicId,
    input.servicePublicId,
    input.accessionNamespace,
    input.accessionValue,
    input.barcodeNamespace,
    input.barcodeValue,
    input.specimenTypeCode,
    input.containerCode,
    input.parentSpecimenPublicId,
    input.actor.actorUserPublicId,
    input.actor.actorSystemKey,
    input.idempotencyKey,
    input.fingerprint,
    input.evidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

function specimenEventStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    specimenPublicId: string;
    fromStatus: CanonicalLabSpecimenStatus | null;
    toStatus: CanonicalLabSpecimenStatus;
    eventVersion: number;
    eventType: string;
    practitionerPublicId: string | null;
    actor: NormalizedActor;
    occurredAtUtc: string;
    recordedAtUtc: string;
    locationSourceType?: string | null;
    locationSourcePublicId?: string | null;
    collectionMethodCode?: string | null;
    transportConditionCode?: string | null;
    reasonCode: string;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_lab_specimen_status_events (
      tenant_id,event_public_id,specimen_public_id,from_status,to_status,event_version,
      event_type,actor_practitioner_public_id,actor_user_public_id,actor_system_key,
      occurred_at_utc,recorded_at_utc,location_source_type,location_source_public_id,
      collection_method_code,transport_condition_code,reason_code,
      source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.eventPublicId,
    input.specimenPublicId,
    input.fromStatus,
    input.toStatus,
    input.eventVersion,
    input.eventType,
    input.practitionerPublicId,
    input.actor.actorUserPublicId,
    input.actor.actorSystemKey,
    input.occurredAtUtc,
    input.recordedAtUtc,
    input.locationSourceType ?? null,
    input.locationSourcePublicId ?? null,
    input.collectionMethodCode ?? null,
    input.transportConditionCode ?? null,
    input.reasonCode,
    input.evidenceSha256,
    input.recordedAtUtc,
  );
}

function specimenServiceStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    linkPublicId: string;
    specimenPublicId: string;
    requestPublicId: string;
    eventPublicId: string | null;
    servicePublicId: string;
    role: 'primary' | 'aliquot';
    evidenceSha256: string;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_lab_specimen_service_items (
      tenant_id,link_public_id,specimen_public_id,request_public_id,event_public_id,
      service_public_id,relationship_role,source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.linkPublicId,
    input.specimenPublicId,
    input.requestPublicId,
    input.eventPublicId,
    input.servicePublicId,
    input.role,
    input.evidenceSha256,
    input.occurredAtUtc,
  );
}

async function requireSpecimen(
  db: CanonicalBatchDatabase,
  tenantId: string,
  specimenPublicId: string,
): Promise<SpecimenRow> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,encounter_public_id,primary_request_public_id,
           primary_service_public_id,current_status,status_version
    FROM canonical_lab_specimens
    WHERE tenant_id=? AND specimen_public_id=? LIMIT 1
  `).bind(tenantId, specimenPublicId).first<SpecimenRow>();
  if (!row) throw new Error('canonical lab specimen not found');
  return row;
}

export async function registerCanonicalLabSpecimen(
  db: CanonicalBatchDatabase,
  raw: RegisterCanonicalLabSpecimenInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalLabSpecimenCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const actor = normalizeActor(raw);
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const specimenPublicId = await deterministicId(
    'labspec', tenantId, sourceType, sourcePublicId, raw.specimenPublicId, 'specimenPublicId',
  );
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const requestPublicId = exact(raw.requestPublicId, 'requestPublicId');
  const servicePublicId = exact(raw.servicePublicId, 'servicePublicId');
  const eventPublicId = optionalExact(raw.eventPublicId, 'eventPublicId');
  const practitionerPublicId = optionalExact(raw.practitionerPublicId, 'practitionerPublicId');
  const fullOperation = {
    specimenPublicId,
    patientLinkPublicId,
    encounterPublicId,
    requestPublicId,
    servicePublicId,
    eventPublicId,
    accessionNamespace: exact(raw.accessionNamespace, 'accessionNamespace'),
    accessionValue: exact(raw.accessionValue, 'accessionValue'),
    barcodeNamespace: exact(raw.barcodeNamespace, 'barcodeNamespace'),
    barcodeValue: exact(raw.barcodeValue, 'barcodeValue'),
    specimenTypeCode: exact(raw.specimenTypeCode, 'specimenTypeCode'),
    containerCode: optionalExact(raw.containerCode, 'containerCode'),
    parentSpecimenPublicId: optionalExact(raw.parentSpecimenPublicId, 'parentSpecimenPublicId'),
    practitionerPublicId,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actor,
    occurredAtUtc,
  };
  const request = await minimalRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalLabSpecimenCommandResult>(db, {
    tenantId, commandName: REGISTER_SPECIMEN, idempotencyKey, request,
  });
  if (replay) return replay;
  await requireClinicalScope(db, {
    tenantId,
    patientLinkPublicId,
    encounterPublicId,
    requestPublicId,
    servicePublicId,
    eventPublicId,
  });
  if (practitionerPublicId) await requireActivePractitioner(db, tenantId, practitionerPublicId);
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'lab_specimen',
    sourceType,
    sourcePublicId,
    canonicalPublicId: specimenPublicId,
  });
  const fingerprint = await createRequestFingerprint(fullOperation);
  const initialEventPublicId = await lifecycleId('labspecevt', tenantId, REGISTER_SPECIMEN, idempotencyKey, 'registered');
  const linkPublicId = await lifecycleId('labspeclink', tenantId, REGISTER_SPECIMEN, idempotencyKey, 'primary');
  const result: CanonicalLabSpecimenCommandResult = {
    specimenPublicId,
    currentStatus: 'registered',
    statusVersion: 1,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: REGISTER_SPECIMEN,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      specimenHeaderStatement(db, {
        tenantId,
        specimenPublicId,
        patientLinkPublicId,
        encounterPublicId,
        requestPublicId,
        servicePublicId,
        accessionNamespace: fullOperation.accessionNamespace,
        accessionValue: fullOperation.accessionValue,
        barcodeNamespace: fullOperation.barcodeNamespace,
        barcodeValue: fullOperation.barcodeValue,
        specimenTypeCode: fullOperation.specimenTypeCode,
        containerCode: fullOperation.containerCode,
        parentSpecimenPublicId: fullOperation.parentSpecimenPublicId,
        actor,
        idempotencyKey,
        fingerprint,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc,
      }),
      specimenEventStatement(db, {
        tenantId,
        eventPublicId: initialEventPublicId,
        specimenPublicId,
        fromStatus: null,
        toStatus: 'registered',
        eventVersion: 1,
        eventType: 'registered',
        practitionerPublicId,
        actor,
        occurredAtUtc,
        recordedAtUtc: occurredAtUtc,
        reasonCode: 'registered',
        evidenceSha256: sourceEvidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_lab_specimens
        SET current_status_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND specimen_public_id=?
          AND current_status_event_public_id IS NULL AND status_version=1
      `).bind(initialEventPublicId, occurredAtUtc, tenantId, specimenPublicId),
      specimenServiceStatement(db, {
        tenantId,
        linkPublicId,
        specimenPublicId,
        requestPublicId,
        eventPublicId,
        servicePublicId,
        role: 'primary',
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc,
      }),
      mappingStatement(db, {
        tenantId,
        entityType: 'lab_specimen',
        canonicalPublicId: specimenPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, REGISTER_SPECIMEN, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_lab_specimen',
      aggregatePublicId: specimenPublicId,
      eventType: 'canonical.lab-specimen.registered',
      occurredAtUtc,
      businessDate,
      payload: result,
    },
  });
}

async function transitionSpecimen(
  db: CanonicalBatchDatabase,
  input: SpecimenTransitionBase & {
    commandName: string;
    expectedFrom: readonly CanonicalLabSpecimenStatus[];
    toStatus: CanonicalLabSpecimenStatus;
    eventType: string;
    reasonCode: string;
    collectionMethodCode?: string | null;
    transportConditionCode?: string | null;
    outboxType: string;
    effectiveColumn: 'collected_at_utc' | 'received_at_utc' | 'rejected_at_utc';
  },
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<CanonicalLabSpecimenCommandResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const idempotencyKey = exact(input.idempotencyKey, 'idempotencyKey');
  const specimenPublicId = exact(input.specimenPublicId, 'specimenPublicId');
  const expectedStatusVersion = positiveInteger(input.expectedStatusVersion, 'expectedStatusVersion');
  const practitionerPublicId = exact(input.practitionerPublicId, 'practitionerPublicId');
  const occurredAtUtc = utc(input.occurredAtUtc, 'occurredAtUtc');
  const recordedAtUtc = utc(input.recordedAtUtc, 'recordedAtUtc');
  if (recordedAtUtc < occurredAtUtc) throw new RangeError('recordedAtUtc cannot precede occurredAtUtc');
  const evidenceSha256 = sha256(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const businessDate = exact(input.businessDate, 'businessDate');
  const actor = normalizeActor(input);
  const locationSourceType = optionalExact(input.locationSourceType, 'locationSourceType');
  const locationSourcePublicId = optionalExact(input.locationSourcePublicId, 'locationSourcePublicId');
  paired(locationSourceType, locationSourcePublicId, 'location');
  const fullOperation = {
    specimenPublicId,
    expectedStatusVersion,
    practitionerPublicId,
    toStatus: input.toStatus,
    reasonCode: exact(input.reasonCode, 'reasonCode'),
    collectionMethodCode: optionalExact(input.collectionMethodCode, 'collectionMethodCode'),
    transportConditionCode: optionalExact(input.transportConditionCode, 'transportConditionCode'),
    locationSourceType,
    locationSourcePublicId,
    evidenceSha256,
    actor,
    occurredAtUtc,
    recordedAtUtc,
  };
  const request = await minimalRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalLabSpecimenCommandResult>(db, {
    tenantId, commandName: input.commandName, idempotencyKey, request,
  });
  if (replay) return replay;
  const specimen = await requireSpecimen(db, tenantId, specimenPublicId);
  if (!input.expectedFrom.includes(specimen.current_status) || Number(specimen.status_version) !== expectedStatusVersion) {
    throw new Error('canonical lab specimen status version conflict');
  }
  await requireActivePractitioner(db, tenantId, practitionerPublicId);
  const nextVersion = expectedStatusVersion + 1;
  const eventPublicId = await lifecycleId('labspecevt', tenantId, input.commandName, idempotencyKey, String(nextVersion));
  const result: CanonicalLabSpecimenCommandResult = {
    specimenPublicId,
    currentStatus: input.toStatus,
    statusVersion: nextVersion,
  };
  const updateSql = `
    UPDATE canonical_lab_specimens
    SET current_status=?,status_version=?,current_status_event_public_id=?,
        ${input.effectiveColumn}=?,updated_at_utc=?
    WHERE tenant_id=? AND specimen_public_id=?
      AND current_status=? AND status_version=?
  `;
  return runCanonicalBatch(db, {
    tenantId,
    commandName: input.commandName,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      specimenEventStatement(db, {
        tenantId,
        eventPublicId,
        specimenPublicId,
        fromStatus: specimen.current_status,
        toStatus: input.toStatus,
        eventVersion: nextVersion,
        eventType: input.eventType,
        practitionerPublicId,
        actor,
        occurredAtUtc,
        recordedAtUtc,
        locationSourceType,
        locationSourcePublicId,
        collectionMethodCode: fullOperation.collectionMethodCode,
        transportConditionCode: fullOperation.transportConditionCode,
        reasonCode: fullOperation.reasonCode,
        evidenceSha256,
      }),
      db.prepare(updateSql).bind(
        input.toStatus,
        nextVersion,
        eventPublicId,
        occurredAtUtc,
        recordedAtUtc,
        tenantId,
        specimenPublicId,
        specimen.current_status,
        expectedStatusVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, input.commandName, idempotencyKey, input.outboxEventPublicId),
      aggregateType: 'canonical_lab_specimen',
      aggregatePublicId: specimenPublicId,
      eventType: input.outboxType,
      occurredAtUtc,
      businessDate,
      payload: result,
    },
  });
}

export function collectCanonicalLabSpecimen(
  db: CanonicalBatchDatabase,
  input: CollectCanonicalLabSpecimenInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return transitionSpecimen(db, {
    ...input,
    commandName: COLLECT_SPECIMEN,
    expectedFrom: ['registered'],
    toStatus: 'collected',
    eventType: 'collected',
    reasonCode: 'collected',
    outboxType: 'canonical.lab-specimen.collected',
    effectiveColumn: 'collected_at_utc',
  }, execution);
}

export function receiveCanonicalLabSpecimen(
  db: CanonicalBatchDatabase,
  input: ReceiveCanonicalLabSpecimenInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return transitionSpecimen(db, {
    ...input,
    commandName: RECEIVE_SPECIMEN,
    expectedFrom: ['collected', 'in_transit'],
    toStatus: 'received',
    eventType: 'received',
    reasonCode: 'received',
    outboxType: 'canonical.lab-specimen.received',
    effectiveColumn: 'received_at_utc',
  }, execution);
}

export function rejectCanonicalLabSpecimen(
  db: CanonicalBatchDatabase,
  input: RejectCanonicalLabSpecimenInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return transitionSpecimen(db, {
    ...input,
    commandName: REJECT_SPECIMEN,
    expectedFrom: ['collected', 'in_transit', 'received'],
    toStatus: 'rejected',
    eventType: 'rejected',
    reasonCode: exact(input.reasonCode, 'reasonCode'),
    outboxType: 'canonical.lab-specimen.rejected',
    effectiveColumn: 'rejected_at_utc',
  }, execution);
}

export async function createCanonicalLabSpecimenAliquot(
  db: CanonicalBatchDatabase,
  raw: CreateCanonicalLabSpecimenAliquotInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalLabSpecimenCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const parentSpecimenPublicId = exact(raw.parentSpecimenPublicId, 'parentSpecimenPublicId');
  const expectedParentStatusVersion = positiveInteger(raw.expectedParentStatusVersion, 'expectedParentStatusVersion');
  const practitionerPublicId = exact(raw.practitionerPublicId, 'practitionerPublicId');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const actor = normalizeActor(raw);
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const evidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const specimenPublicId = await deterministicId(
    'labspec', tenantId, sourceType, sourcePublicId, raw.aliquotSpecimenPublicId, 'aliquotSpecimenPublicId',
  );
  const fullOperation = {
    parentSpecimenPublicId,
    expectedParentStatusVersion,
    specimenPublicId,
    accessionNamespace: exact(raw.accessionNamespace, 'accessionNamespace'),
    accessionValue: exact(raw.accessionValue, 'accessionValue'),
    barcodeNamespace: exact(raw.barcodeNamespace, 'barcodeNamespace'),
    barcodeValue: exact(raw.barcodeValue, 'barcodeValue'),
    specimenTypeCode: exact(raw.specimenTypeCode, 'specimenTypeCode'),
    containerCode: optionalExact(raw.containerCode, 'containerCode'),
    practitionerPublicId,
    sourceType,
    sourcePublicId,
    sourceTable,
    evidenceSha256,
    actor,
    occurredAtUtc,
  };
  const request = await minimalRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalLabSpecimenCommandResult>(db, {
    tenantId, commandName: CREATE_ALIQUOT, idempotencyKey, request,
  });
  if (replay) return replay;
  const parent = await requireSpecimen(db, tenantId, parentSpecimenPublicId);
  if (!['received', 'processing'].includes(parent.current_status) || Number(parent.status_version) !== expectedParentStatusVersion) {
    throw new Error('parent specimen status version conflict');
  }
  await requireActivePractitioner(db, tenantId, practitionerPublicId);
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'lab_specimen',
    sourceType,
    sourcePublicId,
    canonicalPublicId: specimenPublicId,
  });
  const fingerprint = await createRequestFingerprint(fullOperation);
  const initialEventPublicId = await lifecycleId('labspecevt', tenantId, CREATE_ALIQUOT, idempotencyKey, 'registered');
  const linkPublicId = await lifecycleId('labspeclink', tenantId, CREATE_ALIQUOT, idempotencyKey, 'aliquot');
  const result: CanonicalLabSpecimenCommandResult = {
    specimenPublicId,
    currentStatus: 'registered',
    statusVersion: 1,
    parentSpecimenPublicId,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: CREATE_ALIQUOT,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      specimenHeaderStatement(db, {
        tenantId,
        specimenPublicId,
        patientLinkPublicId: parent.patient_link_public_id,
        encounterPublicId: parent.encounter_public_id,
        requestPublicId: parent.primary_request_public_id,
        servicePublicId: parent.primary_service_public_id,
        accessionNamespace: fullOperation.accessionNamespace,
        accessionValue: fullOperation.accessionValue,
        barcodeNamespace: fullOperation.barcodeNamespace,
        barcodeValue: fullOperation.barcodeValue,
        specimenTypeCode: fullOperation.specimenTypeCode,
        containerCode: fullOperation.containerCode,
        parentSpecimenPublicId,
        actor,
        idempotencyKey,
        fingerprint,
        evidenceSha256,
        occurredAtUtc,
      }),
      specimenEventStatement(db, {
        tenantId,
        eventPublicId: initialEventPublicId,
        specimenPublicId,
        fromStatus: null,
        toStatus: 'registered',
        eventVersion: 1,
        eventType: 'registered',
        practitionerPublicId,
        actor,
        occurredAtUtc,
        recordedAtUtc: occurredAtUtc,
        reasonCode: 'aliquot_registered',
        evidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_lab_specimens
        SET current_status_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND specimen_public_id=? AND current_status_event_public_id IS NULL
      `).bind(initialEventPublicId, occurredAtUtc, tenantId, specimenPublicId),
      specimenServiceStatement(db, {
        tenantId,
        linkPublicId,
        specimenPublicId,
        requestPublicId: parent.primary_request_public_id,
        eventPublicId: null,
        servicePublicId: parent.primary_service_public_id,
        role: 'aliquot',
        evidenceSha256,
        occurredAtUtc,
      }),
      mappingStatement(db, {
        tenantId,
        entityType: 'lab_specimen',
        canonicalPublicId: specimenPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256,
        occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, CREATE_ALIQUOT, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_lab_specimen',
      aggregatePublicId: specimenPublicId,
      eventType: 'canonical.lab-specimen.aliquot-created',
      occurredAtUtc,
      businessDate,
      payload: result,
    },
  });
}

async function normalizeObservations(
  input: {
    tenantId: string;
    commandName: string;
    idempotencyKey: string;
    observations: CanonicalLabObservationInput[];
  },
): Promise<NormalizedObservation[]> {
  if (!Array.isArray(input.observations) || input.observations.length === 0) {
    throw new TypeError('at least one laboratory observation is required');
  }
  const output: NormalizedObservation[] = [];
  for (const [index, raw] of input.observations.entries()) {
    const valueType = raw.valueType;
    const valueText = optionalExact(raw.valueText, `observations[${index}].valueText`);
    const valueDecimal = decimal(raw.valueDecimal, `observations[${index}].valueDecimal`);
    const valueCode = optionalExact(raw.valueCode, `observations[${index}].valueCode`);
    const valueCodeSystem = optionalExact(raw.valueCodeSystem, `observations[${index}].valueCodeSystem`);
    const valueBoolean = raw.valueBoolean == null ? null : raw.valueBoolean ? 1 : 0;
    const valueDateTimeUtc = raw.valueDateTimeUtc == null ? null : utc(raw.valueDateTimeUtc, `observations[${index}].valueDateTimeUtc`);
    const unitCode = optionalExact(raw.unitCode, `observations[${index}].unitCode`);
    const reasonCode = optionalExact(raw.reasonCode, `observations[${index}].reasonCode`);
    if (valueType === 'decimal') {
      if (valueDecimal == null || unitCode == null || valueText != null || valueCode != null || valueCodeSystem != null || valueBoolean != null || valueDateTimeUtc != null) {
        throw new TypeError(`observations[${index}] decimal value shape is invalid`);
      }
    } else if (valueType === 'text') {
      if (valueText == null || valueDecimal != null || valueCode != null || valueCodeSystem != null || valueBoolean != null || valueDateTimeUtc != null) {
        throw new TypeError(`observations[${index}] text value shape is invalid`);
      }
    } else if (valueType === 'coded') {
      if (valueCode == null || valueCodeSystem == null || valueText != null || valueDecimal != null || valueBoolean != null || valueDateTimeUtc != null) {
        throw new TypeError(`observations[${index}] coded value shape is invalid`);
      }
    } else if (valueType === 'boolean') {
      if (valueBoolean == null || valueText != null || valueDecimal != null || valueCode != null || valueCodeSystem != null || valueDateTimeUtc != null) {
        throw new TypeError(`observations[${index}] boolean value shape is invalid`);
      }
    } else if (valueType === 'date_time') {
      if (valueDateTimeUtc == null || valueText != null || valueDecimal != null || valueCode != null || valueCodeSystem != null || valueBoolean != null) {
        throw new TypeError(`observations[${index}] date-time value shape is invalid`);
      }
    } else if (valueType === 'absent') {
      if (reasonCode == null || valueText != null || valueDecimal != null || valueCode != null || valueCodeSystem != null || valueBoolean != null || valueDateTimeUtc != null) {
        throw new TypeError(`observations[${index}] absent value shape is invalid`);
      }
    }
    if (['retracted', 'entered_in_error', 'absent'].includes(raw.observationStatus) && reasonCode == null) {
      throw new TypeError(`observations[${index}] status requires a reason code`);
    }
    output.push({
      observationPublicId: await deterministicId(
        'labobs', input.tenantId, input.commandName, `${input.idempotencyKey}:${index + 1}`,
        raw.observationPublicId, `observations[${index}].observationPublicId`,
      ),
      observationSequence: index + 1,
      servicePublicId: exact(raw.servicePublicId, `observations[${index}].servicePublicId`),
      componentSourceType: exact(raw.componentSourceType, `observations[${index}].componentSourceType`),
      componentSourcePublicId: exact(raw.componentSourcePublicId, `observations[${index}].componentSourcePublicId`),
      observationCode: exact(raw.observationCode, `observations[${index}].observationCode`),
      codeSystem: exact(raw.codeSystem, `observations[${index}].codeSystem`),
      displaySnapshot: exact(raw.displaySnapshot, `observations[${index}].displaySnapshot`),
      valueType,
      valueText,
      valueDecimal,
      valueCode,
      valueCodeSystem,
      valueBoolean,
      valueDateTimeUtc,
      unitCode,
      referenceLowDecimal: decimal(raw.referenceLowDecimal, `observations[${index}].referenceLowDecimal`),
      referenceHighDecimal: decimal(raw.referenceHighDecimal, `observations[${index}].referenceHighDecimal`),
      referenceText: optionalExact(raw.referenceText, `observations[${index}].referenceText`),
      interpretationCode: optionalExact(raw.interpretationCode, `observations[${index}].interpretationCode`),
      methodCode: optionalExact(raw.methodCode, `observations[${index}].methodCode`),
      observationStatus: raw.observationStatus,
      reasonCode,
      sourceEvidenceSha256: sha256(raw.sourceEvidenceSha256, `observations[${index}].sourceEvidenceSha256`),
    });
  }
  return output;
}

function resultVersionStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    versionPublicId: string;
    resultSetPublicId: string;
    versionNumber: number;
    supersedesVersionPublicId: string | null;
    versionKind: 'draft' | 'amendment' | 'correction' | 'retraction' | 'entered_in_error';
    contentSha256: string;
    authoringPractitionerPublicId: string;
    actor: NormalizedActor;
    occurredAtUtc: string;
    reasonCode: string | null;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_lab_result_versions (
      tenant_id,version_public_id,result_set_public_id,version_number,
      supersedes_version_public_id,version_kind,version_status,content_sha256,
      authoring_practitioner_public_id,actor_user_public_id,actor_system_key,
      authored_at_utc,reason_code,source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.versionPublicId,
    input.resultSetPublicId,
    input.versionNumber,
    input.supersedesVersionPublicId,
    input.versionKind,
    input.contentSha256,
    input.authoringPractitionerPublicId,
    input.actor.actorUserPublicId,
    input.actor.actorSystemKey,
    input.occurredAtUtc,
    input.reasonCode,
    input.evidenceSha256,
    input.occurredAtUtc,
  );
}

function observationStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    resultSetPublicId: string;
    versionPublicId: string;
    specimenPublicId: string;
    observation: NormalizedObservation;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  const observation = input.observation;
  return db.prepare(`
    INSERT INTO canonical_lab_result_observations (
      tenant_id,observation_public_id,result_set_public_id,version_public_id,
      observation_sequence,service_public_id,component_source_type,
      component_source_public_id,observation_code,code_system,display_snapshot,
      value_type,value_text,value_decimal,value_code,value_code_system,value_boolean,
      value_date_time_utc,unit_code,reference_low_decimal,reference_high_decimal,
      reference_text,interpretation_code,method_code,specimen_public_id,
      observation_status,reason_code,source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    observation.observationPublicId,
    input.resultSetPublicId,
    input.versionPublicId,
    observation.observationSequence,
    observation.servicePublicId,
    observation.componentSourceType,
    observation.componentSourcePublicId,
    observation.observationCode,
    observation.codeSystem,
    observation.displaySnapshot,
    observation.valueType,
    observation.valueText,
    observation.valueDecimal,
    observation.valueCode,
    observation.valueCodeSystem,
    observation.valueBoolean,
    observation.valueDateTimeUtc,
    observation.unitCode,
    observation.referenceLowDecimal,
    observation.referenceHighDecimal,
    observation.referenceText,
    observation.interpretationCode,
    observation.methodCode,
    input.specimenPublicId,
    observation.observationStatus,
    observation.reasonCode,
    observation.sourceEvidenceSha256,
    input.occurredAtUtc,
  );
}

function resultEventStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    resultSetPublicId: string;
    versionPublicId: string;
    fromStatus: CanonicalLabResultStatus | null;
    toStatus: CanonicalLabResultStatus;
    eventVersion: number;
    eventType: string;
    practitionerPublicId: string | null;
    actor: NormalizedActor;
    signedContentSha256: string | null;
    reasonCode: string;
    occurredAtUtc: string;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_lab_result_status_events (
      tenant_id,event_public_id,result_set_public_id,version_public_id,from_status,
      to_status,event_version,event_type,actor_practitioner_public_id,
      actor_user_public_id,actor_system_key,signed_content_sha256,reason_code,
      occurred_at_utc,source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.eventPublicId,
    input.resultSetPublicId,
    input.versionPublicId,
    input.fromStatus,
    input.toStatus,
    input.eventVersion,
    input.eventType,
    input.practitionerPublicId,
    input.actor.actorUserPublicId,
    input.actor.actorSystemKey,
    input.signedContentSha256,
    input.reasonCode,
    input.occurredAtUtc,
    input.evidenceSha256,
    input.occurredAtUtc,
  );
}

async function requireResultSet(
  db: CanonicalBatchDatabase,
  tenantId: string,
  resultSetPublicId: string,
): Promise<ScopeRow> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,encounter_public_id,request_public_id,event_public_id,
           specimen_public_id,service_public_id,current_version_public_id,
           current_status,status_version
    FROM canonical_lab_result_sets
    WHERE tenant_id=? AND result_set_public_id=? LIMIT 1
  `).bind(tenantId, resultSetPublicId).first<ScopeRow>();
  if (!row) throw new Error('canonical laboratory result set not found');
  return row;
}

async function requireVersion(
  db: CanonicalBatchDatabase,
  tenantId: string,
  resultSetPublicId: string,
  versionPublicId: string,
): Promise<VersionRow> {
  const row = await db.prepare(`
    SELECT version_public_id,version_number,version_status,content_sha256
    FROM canonical_lab_result_versions
    WHERE tenant_id=? AND result_set_public_id=? AND version_public_id=? LIMIT 1
  `).bind(tenantId, resultSetPublicId, versionPublicId).first<VersionRow>();
  if (!row) throw new Error('canonical laboratory result version not found');
  return row;
}

function resultContent(
  input: {
    resultSetPublicId: string;
    versionPublicId: string;
    versionNumber: number;
    versionKind: string;
    supersedesVersionPublicId: string | null;
    patientLinkPublicId: string;
    encounterPublicId: string;
    requestPublicId: string;
    eventPublicId: string | null;
    specimenPublicId: string;
    servicePublicId: string;
    observations: NormalizedObservation[];
  },
) {
  return { schemaVersion: 1 as const, ...input };
}

export async function createCanonicalLabResultDraft(
  db: CanonicalBatchDatabase,
  raw: CreateCanonicalLabResultDraftInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalLabResultCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const actor = normalizeActor(raw);
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const evidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const resultSetPublicId = await deterministicId('labres', tenantId, sourceType, sourcePublicId, raw.resultSetPublicId, 'resultSetPublicId');
  const versionPublicId = await deterministicId('labresver', tenantId, sourceType, `${sourcePublicId}:v1`, raw.versionPublicId, 'versionPublicId');
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const requestPublicId = exact(raw.requestPublicId, 'requestPublicId');
  const eventPublicId = optionalExact(raw.eventPublicId, 'eventPublicId');
  const specimenPublicId = exact(raw.specimenPublicId, 'specimenPublicId');
  const servicePublicId = exact(raw.servicePublicId, 'servicePublicId');
  const practitionerPublicId = exact(raw.creatingPractitionerPublicId, 'creatingPractitionerPublicId');
  const observations = await normalizeObservations({ tenantId, commandName: CREATE_RESULT, idempotencyKey, observations: raw.observations });
  const fullOperation = {
    resultSetPublicId,
    versionPublicId,
    patientLinkPublicId,
    encounterPublicId,
    requestPublicId,
    eventPublicId,
    specimenPublicId,
    servicePublicId,
    practitionerPublicId,
    observations,
    sourceType,
    sourcePublicId,
    sourceTable,
    evidenceSha256,
    actor,
    occurredAtUtc,
  };
  const request = await minimalRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalLabResultCommandResult>(db, {
    tenantId, commandName: CREATE_RESULT, idempotencyKey, request,
  });
  if (replay) return replay;
  await requireClinicalScope(db, {
    tenantId, patientLinkPublicId, encounterPublicId, requestPublicId, servicePublicId, eventPublicId,
  });
  const specimen = await requireSpecimen(db, tenantId, specimenPublicId);
  if (
    specimen.patient_link_public_id !== patientLinkPublicId
    || specimen.encounter_public_id !== encounterPublicId
    || specimen.primary_request_public_id !== requestPublicId
    || specimen.primary_service_public_id !== servicePublicId
  ) throw new Error('laboratory specimen scope mismatch');
  await requireActivePractitioner(db, tenantId, practitionerPublicId);
  for (const observation of observations) {
    if (observation.servicePublicId !== servicePublicId) throw new Error('laboratory observation service scope mismatch');
  }
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'lab_result_set',
    sourceType,
    sourcePublicId,
    canonicalPublicId: resultSetPublicId,
  });
  const versionContent = resultContent({
    resultSetPublicId,
    versionPublicId,
    versionNumber: 1,
    versionKind: 'draft',
    supersedesVersionPublicId: null,
    patientLinkPublicId,
    encounterPublicId,
    requestPublicId,
    eventPublicId,
    specimenPublicId,
    servicePublicId,
    observations,
  });
  const contentSha256 = await createRequestFingerprint(versionContent);
  const fingerprint = await createRequestFingerprint(fullOperation);
  const initialEventPublicId = await lifecycleId('labresevt', tenantId, CREATE_RESULT, idempotencyKey, 'draft-created');
  const result: CanonicalLabResultCommandResult = {
    resultSetPublicId,
    versionPublicId,
    currentStatus: 'draft',
    statusVersion: 1,
    versionNumber: 1,
    observationCount: observations.length,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: CREATE_RESULT,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_lab_result_sets (
          tenant_id,result_set_public_id,patient_link_public_id,encounter_public_id,
          request_public_id,event_public_id,specimen_public_id,service_public_id,
          current_version_public_id,current_status,status_version,
          current_status_event_public_id,creating_practitioner_public_id,
          actor_user_public_id,actor_system_key,idempotency_key,
          request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,NULL,'draft',1,NULL,?,?,?,?,?,?,?,?)
      `).bind(
        tenantId,
        resultSetPublicId,
        patientLinkPublicId,
        encounterPublicId,
        requestPublicId,
        eventPublicId,
        specimenPublicId,
        servicePublicId,
        practitionerPublicId,
        actor.actorUserPublicId,
        actor.actorSystemKey,
        idempotencyKey,
        fingerprint,
        evidenceSha256,
        occurredAtUtc,
        occurredAtUtc,
      ),
      resultVersionStatement(db, {
        tenantId,
        versionPublicId,
        resultSetPublicId,
        versionNumber: 1,
        supersedesVersionPublicId: null,
        versionKind: 'draft',
        contentSha256,
        authoringPractitionerPublicId: practitionerPublicId,
        actor,
        occurredAtUtc,
        reasonCode: null,
        evidenceSha256,
      }),
      ...observations.map((observation) => observationStatement(db, {
        tenantId, resultSetPublicId, versionPublicId, specimenPublicId, observation, occurredAtUtc,
      })),
      resultEventStatement(db, {
        tenantId,
        eventPublicId: initialEventPublicId,
        resultSetPublicId,
        versionPublicId,
        fromStatus: null,
        toStatus: 'draft',
        eventVersion: 1,
        eventType: 'draft_created',
        practitionerPublicId,
        actor,
        signedContentSha256: null,
        reasonCode: 'draft_created',
        occurredAtUtc,
        evidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_lab_result_sets
        SET current_version_public_id=?,current_status_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND result_set_public_id=?
          AND current_version_public_id IS NULL AND status_version=1
      `).bind(versionPublicId, initialEventPublicId, occurredAtUtc, tenantId, resultSetPublicId),
      mappingStatement(db, {
        tenantId,
        entityType: 'lab_result_set',
        canonicalPublicId: resultSetPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256,
        occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, CREATE_RESULT, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_lab_result_set',
      aggregatePublicId: resultSetPublicId,
      eventType: 'canonical.lab-result.draft-created',
      occurredAtUtc,
      businessDate,
      payload: result,
    },
  });
}

async function createReplacementResultVersion(
  db: CanonicalBatchDatabase,
  raw: ReplaceLabResultVersionBase,
  input: {
    commandName: string;
    versionKind: 'amendment' | 'correction';
    eventType: 'draft_replaced' | 'corrected';
    requireDraft: boolean;
    outboxType: string;
  },
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<CanonicalLabResultCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const resultSetPublicId = exact(raw.resultSetPublicId, 'resultSetPublicId');
  const expectedStatusVersion = positiveInteger(raw.expectedStatusVersion, 'expectedStatusVersion');
  const practitionerPublicId = exact(raw.authoringPractitionerPublicId, 'authoringPractitionerPublicId');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const evidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const actor = normalizeActor(raw);
  const versionPublicId = await deterministicId(
    'labresver', tenantId, input.commandName, `${idempotencyKey}:replacement`, raw.versionPublicId, 'versionPublicId',
  );
  const observations = await normalizeObservations({ tenantId, commandName: input.commandName, idempotencyKey, observations: raw.observations });
  const fullOperation = {
    resultSetPublicId,
    expectedStatusVersion,
    versionPublicId,
    practitionerPublicId,
    reasonCode,
    observations,
    evidenceSha256,
    actor,
    occurredAtUtc,
    versionKind: input.versionKind,
  };
  const request = await minimalRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalLabResultCommandResult>(db, {
    tenantId, commandName: input.commandName, idempotencyKey, request,
  });
  if (replay) return replay;
  const resultSet = await requireResultSet(db, tenantId, resultSetPublicId);
  if (Number(resultSet.status_version) !== expectedStatusVersion || !resultSet.current_version_public_id) {
    throw new Error('canonical laboratory result status version conflict');
  }
  if (input.requireDraft && resultSet.current_status !== 'draft') {
    throw new Error('canonical laboratory result draft is no longer active');
  }
  await requireActivePractitioner(db, tenantId, practitionerPublicId);
  const currentVersion = await requireVersion(db, tenantId, resultSetPublicId, resultSet.current_version_public_id);
  const versionNumber = Number(currentVersion.version_number) + 1;
  for (const observation of observations) {
    if (observation.servicePublicId !== resultSet.service_public_id) throw new Error('laboratory observation service scope mismatch');
  }
  const contentSha256 = await createRequestFingerprint(resultContent({
    resultSetPublicId,
    versionPublicId,
    versionNumber,
    versionKind: input.versionKind,
    supersedesVersionPublicId: currentVersion.version_public_id,
    patientLinkPublicId: resultSet.patient_link_public_id,
    encounterPublicId: resultSet.encounter_public_id,
    requestPublicId: resultSet.request_public_id,
    eventPublicId: resultSet.event_public_id,
    specimenPublicId: resultSet.specimen_public_id,
    servicePublicId: resultSet.service_public_id,
    observations,
  }));
  const nextStatusVersion = expectedStatusVersion + 1;
  const statusEventPublicId = await lifecycleId('labresevt', tenantId, input.commandName, idempotencyKey, String(nextStatusVersion));
  const result: CanonicalLabResultCommandResult = {
    resultSetPublicId,
    versionPublicId,
    currentStatus: 'draft',
    statusVersion: nextStatusVersion,
    versionNumber,
    observationCount: observations.length,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: input.commandName,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      resultVersionStatement(db, {
        tenantId,
        versionPublicId,
        resultSetPublicId,
        versionNumber,
        supersedesVersionPublicId: currentVersion.version_public_id,
        versionKind: input.versionKind,
        contentSha256,
        authoringPractitionerPublicId: practitionerPublicId,
        actor,
        occurredAtUtc,
        reasonCode,
        evidenceSha256,
      }),
      ...observations.map((observation) => observationStatement(db, {
        tenantId,
        resultSetPublicId,
        versionPublicId,
        specimenPublicId: resultSet.specimen_public_id,
        observation,
        occurredAtUtc,
      })),
      resultEventStatement(db, {
        tenantId,
        eventPublicId: statusEventPublicId,
        resultSetPublicId,
        versionPublicId,
        fromStatus: resultSet.current_status,
        toStatus: 'draft',
        eventVersion: nextStatusVersion,
        eventType: input.eventType,
        practitionerPublicId,
        actor,
        signedContentSha256: null,
        reasonCode,
        occurredAtUtc,
        evidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_lab_result_sets
        SET current_version_public_id=?,current_status='draft',status_version=?,
            current_status_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND result_set_public_id=?
          AND current_version_public_id=? AND current_status=? AND status_version=?
      `).bind(
        versionPublicId,
        nextStatusVersion,
        statusEventPublicId,
        occurredAtUtc,
        tenantId,
        resultSetPublicId,
        currentVersion.version_public_id,
        resultSet.current_status,
        expectedStatusVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, input.commandName, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_lab_result_set',
      aggregatePublicId: resultSetPublicId,
      eventType: input.outboxType,
      occurredAtUtc,
      businessDate,
      payload: result,
    },
  });
}

export function replaceCanonicalLabResultDraft(
  db: CanonicalBatchDatabase,
  input: ReplaceCanonicalLabResultDraftInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return createReplacementResultVersion(db, input, {
    commandName: REPLACE_RESULT,
    versionKind: 'amendment',
    eventType: 'draft_replaced',
    requireDraft: true,
    outboxType: 'canonical.lab-result.draft-replaced',
  }, execution);
}

export function correctCanonicalLabResultVersion(
  db: CanonicalBatchDatabase,
  input: CorrectCanonicalLabResultVersionInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return createReplacementResultVersion(db, input, {
    commandName: CORRECT_RESULT,
    versionKind: 'correction',
    eventType: 'corrected',
    requireDraft: false,
    outboxType: 'canonical.lab-result.corrected',
  }, execution);
}

export async function verifyCanonicalLabResultVersion(
  db: CanonicalBatchDatabase,
  raw: VerifyCanonicalLabResultVersionInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalLabResultCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const resultSetPublicId = exact(raw.resultSetPublicId, 'resultSetPublicId');
  const versionPublicId = exact(raw.versionPublicId, 'versionPublicId');
  const expectedStatusVersion = positiveInteger(raw.expectedStatusVersion, 'expectedStatusVersion');
  const practitionerPublicId = exact(raw.verifyingPractitionerPublicId, 'verifyingPractitionerPublicId');
  const signedContentSha256 = sha256(raw.signedContentSha256, 'signedContentSha256');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const evidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const actor = normalizeActor(raw);
  const fullOperation = {
    resultSetPublicId,
    versionPublicId,
    expectedStatusVersion,
    practitionerPublicId,
    signedContentSha256,
    reasonCode,
    evidenceSha256,
    actor,
    occurredAtUtc,
  };
  const request = await minimalRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalLabResultCommandResult>(db, {
    tenantId, commandName: VERIFY_RESULT, idempotencyKey, request,
  });
  if (replay) return replay;
  const resultSet = await requireResultSet(db, tenantId, resultSetPublicId);
  if (
    resultSet.current_status !== 'draft'
    || resultSet.current_version_public_id !== versionPublicId
    || Number(resultSet.status_version) !== expectedStatusVersion
  ) throw new Error('canonical laboratory result draft/version conflict');
  const version = await requireVersion(db, tenantId, resultSetPublicId, versionPublicId);
  if (version.version_status !== 'draft' || version.content_sha256 !== signedContentSha256) {
    throw new Error('signed content hash does not match active draft content hash');
  }
  await requireActivePractitioner(db, tenantId, practitionerPublicId);
  const nextStatusVersion = expectedStatusVersion + 1;
  const statusEventPublicId = await lifecycleId('labresevt', tenantId, VERIFY_RESULT, idempotencyKey, String(nextStatusVersion));
  const result: CanonicalLabResultCommandResult = {
    resultSetPublicId,
    versionPublicId,
    currentStatus: 'verified',
    statusVersion: nextStatusVersion,
    versionNumber: Number(version.version_number),
    observationCount: 0,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: VERIFY_RESULT,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      resultEventStatement(db, {
        tenantId,
        eventPublicId: statusEventPublicId,
        resultSetPublicId,
        versionPublicId,
        fromStatus: 'draft',
        toStatus: 'verified',
        eventVersion: nextStatusVersion,
        eventType: 'verified',
        practitionerPublicId,
        actor,
        signedContentSha256,
        reasonCode,
        occurredAtUtc,
        evidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_lab_result_versions
        SET version_status='verified',signed_content_sha256=?,
            verifying_practitioner_public_id=?,verified_at_utc=?
        WHERE tenant_id=? AND result_set_public_id=? AND version_public_id=?
          AND version_status='draft' AND content_sha256=?
      `).bind(
        signedContentSha256,
        practitionerPublicId,
        occurredAtUtc,
        tenantId,
        resultSetPublicId,
        versionPublicId,
        signedContentSha256,
      ),
      db.prepare(`
        UPDATE canonical_lab_result_sets
        SET current_status='verified',status_version=?,current_status_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND result_set_public_id=? AND current_version_public_id=?
          AND current_status='draft' AND status_version=?
      `).bind(
        nextStatusVersion,
        statusEventPublicId,
        occurredAtUtc,
        tenantId,
        resultSetPublicId,
        versionPublicId,
        expectedStatusVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, VERIFY_RESULT, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_lab_result_set',
      aggregatePublicId: resultSetPublicId,
      eventType: 'canonical.lab-result.verified',
      occurredAtUtc,
      businessDate,
      payload: result,
    },
  });
}

export async function validateAndPublishCanonicalLabResultVersion(
  db: CanonicalBatchDatabase,
  raw: ValidateAndPublishCanonicalLabResultVersionInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalLabResultCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const resultSetPublicId = exact(raw.resultSetPublicId, 'resultSetPublicId');
  const versionPublicId = exact(raw.versionPublicId, 'versionPublicId');
  const expectedStatusVersion = positiveInteger(raw.expectedStatusVersion, 'expectedStatusVersion');
  const practitionerPublicId = exact(raw.validatingPractitionerPublicId, 'validatingPractitionerPublicId');
  const signedContentSha256 = sha256(raw.signedContentSha256, 'signedContentSha256');
  const validationReasonCode = exact(raw.validationReasonCode, 'validationReasonCode');
  const publicationReasonCode = exact(raw.publicationReasonCode, 'publicationReasonCode');
  const evidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const validatedAtUtc = utc(raw.validatedAtUtc, 'validatedAtUtc');
  const publishedAtUtc = utc(raw.publishedAtUtc, 'publishedAtUtc');
  if (publishedAtUtc < validatedAtUtc) throw new RangeError('publishedAtUtc cannot precede validatedAtUtc');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const actor = normalizeActor(raw);
  const fullOperation = {
    resultSetPublicId,
    versionPublicId,
    expectedStatusVersion,
    practitionerPublicId,
    signedContentSha256,
    validationReasonCode,
    publicationReasonCode,
    evidenceSha256,
    actor,
    validatedAtUtc,
    publishedAtUtc,
  };
  const request = await minimalRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalLabResultCommandResult>(db, {
    tenantId, commandName: VALIDATE_PUBLISH_RESULT, idempotencyKey, request,
  });
  if (replay) return replay;
  const resultSet = await requireResultSet(db, tenantId, resultSetPublicId);
  if (
    resultSet.current_status !== 'verified'
    || resultSet.current_version_public_id !== versionPublicId
    || Number(resultSet.status_version) !== expectedStatusVersion
  ) throw new Error('canonical laboratory verified result/version conflict');
  const version = await requireVersion(db, tenantId, resultSetPublicId, versionPublicId);
  if (version.version_status !== 'verified' || version.content_sha256 !== signedContentSha256) {
    throw new Error('signed content hash does not match verified result content hash');
  }
  await requireActivePractitioner(db, tenantId, practitionerPublicId);
  const validatedStatusVersion = expectedStatusVersion + 1;
  const publishedStatusVersion = expectedStatusVersion + 2;
  const validatedEventPublicId = await lifecycleId('labresevt', tenantId, VALIDATE_PUBLISH_RESULT, idempotencyKey, 'validated');
  const publishedEventPublicId = await lifecycleId('labresevt', tenantId, VALIDATE_PUBLISH_RESULT, idempotencyKey, 'published');
  const result: CanonicalLabResultCommandResult = {
    resultSetPublicId,
    versionPublicId,
    currentStatus: 'published',
    statusVersion: publishedStatusVersion,
    versionNumber: Number(version.version_number),
    observationCount: 0,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: VALIDATE_PUBLISH_RESULT,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      resultEventStatement(db, {
        tenantId,
        eventPublicId: validatedEventPublicId,
        resultSetPublicId,
        versionPublicId,
        fromStatus: 'verified',
        toStatus: 'validated',
        eventVersion: validatedStatusVersion,
        eventType: 'validated',
        practitionerPublicId,
        actor,
        signedContentSha256,
        reasonCode: validationReasonCode,
        occurredAtUtc: validatedAtUtc,
        evidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_lab_result_versions
        SET version_status='validated',signed_content_sha256=?,
            validating_practitioner_public_id=?,validated_at_utc=?
        WHERE tenant_id=? AND result_set_public_id=? AND version_public_id=?
          AND version_status='verified' AND content_sha256=?
      `).bind(
        signedContentSha256,
        practitionerPublicId,
        validatedAtUtc,
        tenantId,
        resultSetPublicId,
        versionPublicId,
        signedContentSha256,
      ),
      db.prepare(`
        UPDATE canonical_lab_result_sets
        SET current_status='validated',status_version=?,current_status_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND result_set_public_id=? AND current_version_public_id=?
          AND current_status='verified' AND status_version=?
      `).bind(
        validatedStatusVersion,
        validatedEventPublicId,
        validatedAtUtc,
        tenantId,
        resultSetPublicId,
        versionPublicId,
        expectedStatusVersion,
      ),
      resultEventStatement(db, {
        tenantId,
        eventPublicId: publishedEventPublicId,
        resultSetPublicId,
        versionPublicId,
        fromStatus: 'validated',
        toStatus: 'published',
        eventVersion: publishedStatusVersion,
        eventType: 'published',
        practitionerPublicId,
        actor,
        signedContentSha256,
        reasonCode: publicationReasonCode,
        occurredAtUtc: publishedAtUtc,
        evidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_lab_result_versions
        SET version_status='published',published_at_utc=?
        WHERE tenant_id=? AND result_set_public_id=? AND version_public_id=?
          AND version_status='validated'
      `).bind(publishedAtUtc, tenantId, resultSetPublicId, versionPublicId),
      db.prepare(`
        UPDATE canonical_lab_result_sets
        SET current_status='published',status_version=?,current_status_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND result_set_public_id=? AND current_version_public_id=?
          AND current_status='validated' AND status_version=?
      `).bind(
        publishedStatusVersion,
        publishedEventPublicId,
        publishedAtUtc,
        tenantId,
        resultSetPublicId,
        versionPublicId,
        validatedStatusVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, VALIDATE_PUBLISH_RESULT, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_lab_result_set',
      aggregatePublicId: resultSetPublicId,
      eventType: 'canonical.lab-result.published',
      occurredAtUtc: publishedAtUtc,
      businessDate,
      payload: result,
    },
  });
}

async function createTerminalResultVersion(
  db: CanonicalBatchDatabase,
  raw: TerminalLabResultInput,
  input: {
    commandName: string;
    targetStatus: 'retracted' | 'entered_in_error';
    versionKind: 'retraction' | 'entered_in_error';
    eventType: 'retracted' | 'entered_in_error';
    outboxType: string;
  },
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<CanonicalLabResultCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const resultSetPublicId = exact(raw.resultSetPublicId, 'resultSetPublicId');
  const expectedStatusVersion = positiveInteger(raw.expectedStatusVersion, 'expectedStatusVersion');
  const practitionerPublicId = exact(raw.authoringPractitionerPublicId, 'authoringPractitionerPublicId');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const evidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const actor = normalizeActor(raw);
  const versionPublicId = await deterministicId(
    'labresver', tenantId, input.commandName, `${idempotencyKey}:terminal`, raw.versionPublicId, 'versionPublicId',
  );
  const fullOperation = {
    resultSetPublicId,
    expectedStatusVersion,
    versionPublicId,
    practitionerPublicId,
    reasonCode,
    evidenceSha256,
    actor,
    occurredAtUtc,
    targetStatus: input.targetStatus,
  };
  const request = await minimalRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalLabResultCommandResult>(db, {
    tenantId, commandName: input.commandName, idempotencyKey, request,
  });
  if (replay) return replay;
  const resultSet = await requireResultSet(db, tenantId, resultSetPublicId);
  if (!resultSet.current_version_public_id || Number(resultSet.status_version) !== expectedStatusVersion) {
    throw new Error('canonical laboratory result status version conflict');
  }
  if (['retracted', 'entered_in_error'].includes(resultSet.current_status)) {
    throw new Error('canonical laboratory result is already terminal');
  }
  await requireActivePractitioner(db, tenantId, practitionerPublicId);
  const currentVersion = await requireVersion(db, tenantId, resultSetPublicId, resultSet.current_version_public_id);
  const versionNumber = Number(currentVersion.version_number) + 1;
  const contentSha256 = await createRequestFingerprint({
    schemaVersion: 1,
    resultSetPublicId,
    versionPublicId,
    versionNumber,
    versionKind: input.versionKind,
    supersedesVersionPublicId: currentVersion.version_public_id,
    reasonCode,
  });
  const nextStatusVersion = expectedStatusVersion + 1;
  const statusEventPublicId = await lifecycleId('labresevt', tenantId, input.commandName, idempotencyKey, String(nextStatusVersion));
  const result: CanonicalLabResultCommandResult = {
    resultSetPublicId,
    versionPublicId,
    currentStatus: input.targetStatus,
    statusVersion: nextStatusVersion,
    versionNumber,
    observationCount: 0,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: input.commandName,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      resultVersionStatement(db, {
        tenantId,
        versionPublicId,
        resultSetPublicId,
        versionNumber,
        supersedesVersionPublicId: currentVersion.version_public_id,
        versionKind: input.versionKind,
        contentSha256,
        authoringPractitionerPublicId: practitionerPublicId,
        actor,
        occurredAtUtc,
        reasonCode,
        evidenceSha256,
      }),
      resultEventStatement(db, {
        tenantId,
        eventPublicId: statusEventPublicId,
        resultSetPublicId,
        versionPublicId,
        fromStatus: resultSet.current_status,
        toStatus: input.targetStatus,
        eventVersion: nextStatusVersion,
        eventType: input.eventType,
        practitionerPublicId,
        actor,
        signedContentSha256: null,
        reasonCode,
        occurredAtUtc,
        evidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_lab_result_versions
        SET version_status=?,retracted_at_utc=?
        WHERE tenant_id=? AND result_set_public_id=? AND version_public_id=?
          AND version_status='draft'
      `).bind(
        input.targetStatus,
        input.targetStatus === 'retracted' ? occurredAtUtc : null,
        tenantId,
        resultSetPublicId,
        versionPublicId,
      ),
      db.prepare(`
        UPDATE canonical_lab_result_sets
        SET current_version_public_id=?,current_status=?,status_version=?,
            current_status_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND result_set_public_id=? AND current_version_public_id=?
          AND current_status=? AND status_version=?
      `).bind(
        versionPublicId,
        input.targetStatus,
        nextStatusVersion,
        statusEventPublicId,
        occurredAtUtc,
        tenantId,
        resultSetPublicId,
        currentVersion.version_public_id,
        resultSet.current_status,
        expectedStatusVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, input.commandName, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_lab_result_set',
      aggregatePublicId: resultSetPublicId,
      eventType: input.outboxType,
      occurredAtUtc,
      businessDate,
      payload: result,
    },
  });
}

export function retractCanonicalLabResultVersion(
  db: CanonicalBatchDatabase,
  input: RetractCanonicalLabResultVersionInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return createTerminalResultVersion(db, input, {
    commandName: RETRACT_RESULT,
    targetStatus: 'retracted',
    versionKind: 'retraction',
    eventType: 'retracted',
    outboxType: 'canonical.lab-result.retracted',
  }, execution);
}

export function enterCanonicalLabResultInError(
  db: CanonicalBatchDatabase,
  input: EnterCanonicalLabResultInErrorInput,
  execution: CanonicalCommandExecutionOptions = {},
) {
  return createTerminalResultVersion(db, input, {
    commandName: ERROR_RESULT,
    targetStatus: 'entered_in_error',
    versionKind: 'entered_in_error',
    eventType: 'entered_in_error',
    outboxType: 'canonical.lab-result.entered-in-error',
  }, execution);
}

export async function attachCanonicalLabAnalyzerEvidence(
  db: CanonicalBatchDatabase,
  raw: AttachCanonicalLabAnalyzerEvidenceInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalLabAnalyzerCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const resultSetPublicId = exact(raw.resultSetPublicId, 'resultSetPublicId');
  const versionPublicId = exact(raw.versionPublicId, 'versionPublicId');
  const observationPublicId = exact(raw.observationPublicId, 'observationPublicId');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const analyzerEvidencePublicId = await deterministicId(
    'labanalyzer', tenantId, sourceType, `${sourcePublicId}:${raw.observationIndex}`,
    raw.analyzerEvidencePublicId, 'analyzerEvidencePublicId',
  );
  const observationIndex = nonnegativeInteger(raw.observationIndex, 'observationIndex');
  const payloadSha256 = sha256(raw.payloadSha256, 'payloadSha256');
  const evidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const businessDate = exact(raw.businessDate, 'businessDate');
  const actor = normalizeActor(raw);
  const machineSourceType = optionalExact(raw.machineSourceType, 'machineSourceType');
  const machineSourcePublicId = optionalExact(raw.machineSourcePublicId, 'machineSourcePublicId');
  const bridgeSourceType = optionalExact(raw.bridgeSourceType, 'bridgeSourceType');
  const bridgeSourcePublicId = optionalExact(raw.bridgeSourcePublicId, 'bridgeSourcePublicId');
  const logSourceType = optionalExact(raw.logSourceType, 'logSourceType');
  const logSourcePublicId = optionalExact(raw.logSourcePublicId, 'logSourcePublicId');
  paired(machineSourceType, machineSourcePublicId, 'machine');
  paired(bridgeSourceType, bridgeSourcePublicId, 'bridge');
  paired(logSourceType, logSourcePublicId, 'log');
  if (raw.disposition === 'accepted' && (
    raw.matchState !== 'matched'
    || !['passed', 'not_applicable'].includes(raw.qcState)
    || !['passed', 'overridden'].includes(raw.validationState)
  )) throw new TypeError('accepted analyzer evidence requires matched, QC-passed, validated evidence');
  const fullOperation = {
    resultSetPublicId,
    versionPublicId,
    observationPublicId,
    analyzerEvidencePublicId,
    sourceType,
    sourcePublicId,
    ingestionMessagePublicId: optionalExact(raw.ingestionMessagePublicId, 'ingestionMessagePublicId'),
    observationIndex,
    machineSourceType,
    machineSourcePublicId,
    bridgeSourceType,
    bridgeSourcePublicId,
    logSourceType,
    logSourcePublicId,
    protocol: optionalExact(raw.protocol, 'protocol'),
    payloadSha256,
    qcState: raw.qcState,
    validationState: raw.validationState,
    matchState: raw.matchState,
    disposition: raw.disposition,
    conversionFactorDecimal: decimal(raw.conversionFactorDecimal, 'conversionFactorDecimal'),
    evidenceSha256,
    actor,
    occurredAtUtc,
  };
  const request = await minimalRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalLabAnalyzerCommandResult>(db, {
    tenantId, commandName: ATTACH_ANALYZER, idempotencyKey, request,
  });
  if (replay) return replay;
  const observation = await db.prepare(`
    SELECT 1 AS present FROM canonical_lab_result_observations
    WHERE tenant_id=? AND result_set_public_id=? AND version_public_id=?
      AND observation_public_id=? LIMIT 1
  `).bind(tenantId, resultSetPublicId, versionPublicId, observationPublicId).first();
  if (!observation) throw new Error('canonical laboratory observation ownership mismatch');
  await requireMappingAvailable(db, {
    tenantId,
    entityType: 'lab_analyzer_evidence',
    sourceType,
    sourcePublicId: `${sourcePublicId}:${observationIndex}`,
    canonicalPublicId: analyzerEvidencePublicId,
  });
  const result: CanonicalLabAnalyzerCommandResult = {
    analyzerEvidencePublicId,
    observationPublicId,
    disposition: raw.disposition,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: ATTACH_ANALYZER,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_lab_analyzer_evidence (
          tenant_id,analyzer_evidence_public_id,result_set_public_id,version_public_id,
          observation_public_id,source_type,source_public_id,ingestion_message_public_id,
          observation_index,machine_source_type,machine_source_public_id,
          bridge_source_type,bridge_source_public_id,log_source_type,log_source_public_id,
          protocol,payload_sha256,qc_state,validation_state,match_state,disposition,
          conversion_factor_decimal,actor_user_public_id,actor_system_key,
          occurred_at_utc,source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        tenantId,
        analyzerEvidencePublicId,
        resultSetPublicId,
        versionPublicId,
        observationPublicId,
        sourceType,
        sourcePublicId,
        fullOperation.ingestionMessagePublicId,
        observationIndex,
        machineSourceType,
        machineSourcePublicId,
        bridgeSourceType,
        bridgeSourcePublicId,
        logSourceType,
        logSourcePublicId,
        fullOperation.protocol,
        payloadSha256,
        raw.qcState,
        raw.validationState,
        raw.matchState,
        raw.disposition,
        fullOperation.conversionFactorDecimal,
        actor.actorUserPublicId,
        actor.actorSystemKey,
        occurredAtUtc,
        evidenceSha256,
        occurredAtUtc,
      ),
      mappingStatement(db, {
        tenantId,
        entityType: 'lab_analyzer_evidence',
        canonicalPublicId: analyzerEvidencePublicId,
        sourceType,
        sourcePublicId: `${sourcePublicId}:${observationIndex}`,
        sourceTable: 'lis_analyzer_evidence',
        evidenceSha256,
        occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxId(tenantId, ATTACH_ANALYZER, idempotencyKey, raw.outboxEventPublicId),
      aggregateType: 'canonical_lab_analyzer_evidence',
      aggregatePublicId: analyzerEvidencePublicId,
      eventType: 'canonical.lab-analyzer.evidence-attached',
      occurredAtUtc,
      businessDate,
      payload: result,
    },
  });
}
