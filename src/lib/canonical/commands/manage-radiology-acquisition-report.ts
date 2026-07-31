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

export type CanonicalImagingAcquisitionStatus =
  | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'cancelled' | 'entered_in_error';
export type CanonicalImagingReportStatus =
  | 'draft' | 'verified' | 'final' | 'published' | 'retracted' | 'entered_in_error';

interface ActorInput { actorUserPublicId?: string | null; actorSystemKey?: string | null }
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

export interface RegisterCanonicalImagingAcquisitionInput extends CommandBase, SourceInput {
  acquisitionPublicId?: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  requestPublicId: string;
  eventPublicId?: string | null;
  servicePublicId: string;
  accessionNamespace: string;
  accessionValue: string;
  modalityCode: string;
  bodySiteCode?: string | null;
  procedureSnapshot?: string | null;
  performingPractitionerPublicId?: string | null;
  occurredAtUtc: string;
}
interface AcquisitionTransitionBase extends CommandBase {
  acquisitionPublicId: string;
  expectedStatusVersion: number;
  practitionerPublicId?: string | null;
  performingPractitionerPublicId?: string | null;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
  recordedAtUtc: string;
  modalitySourceType?: string | null;
  modalitySourcePublicId?: string | null;
  pacsEndpointSourceType?: string | null;
  pacsEndpointSourcePublicId?: string | null;
  reasonCode?: string;
}
export interface StartCanonicalImagingAcquisitionInput extends AcquisitionTransitionBase {}
export interface CompleteCanonicalImagingAcquisitionInput extends AcquisitionTransitionBase {}
export interface CancelCanonicalImagingAcquisitionInput extends AcquisitionTransitionBase { reasonCode: string }
export interface EnterCanonicalImagingAcquisitionInErrorInput extends AcquisitionTransitionBase { reasonCode: string }

export interface RegisterCanonicalImagingStudyInput extends CommandBase, SourceInput {
  acquisitionPublicId: string;
  studyPublicId?: string;
  studyUidNamespace: string;
  studyInstanceUid: string;
  accessionNamespace: string;
  accessionValue: string;
  modalityCode: string;
  studyStartedAtUtc: string;
  occurredAtUtc: string;
}
export interface RegisterCanonicalImagingSeriesInput extends CommandBase, SourceInput {
  studyPublicId: string;
  seriesPublicId?: string;
  seriesUidNamespace: string;
  seriesInstanceUid: string;
  seriesNumber?: number | null;
  modalityCode: string;
  bodyPartCode?: string | null;
  protocolName?: string | null;
  lateralityCode?: string | null;
  descriptionSnapshot?: string | null;
  occurredAtUtc: string;
}
export interface RegisterCanonicalImagingInstanceInput extends CommandBase, SourceInput {
  studyPublicId: string;
  seriesPublicId: string;
  instancePublicId?: string;
  sopUidNamespace: string;
  sopInstanceUid: string;
  sopClassUid: string;
  instanceNumber?: number | null;
  frameCount: number;
  transferSyntaxUid?: string | null;
  objectContentSha256: string;
  byteSize: number;
  storageProviderType: string;
  storageProviderPublicId: string;
  storageObjectKey: string;
  storageGeneration: string;
  occurredAtUtc: string;
}
export type ImagingProvenanceEventType =
  | 'worklist_sent' | 'acquisition_started' | 'acquisition_completed' | 'dicom_received'
  | 'instance_staged' | 'instance_accepted' | 'duplicate_detected' | 'collision_detected'
  | 'mapped' | 'stored' | 'storage_verified' | 'replaced' | 'retracted' | 'entered_in_error';
export type ImagingProvenanceDisposition =
  | 'staged' | 'accepted' | 'duplicate' | 'replaced' | 'rejected' | 'collision' | 'retracted' | 'entered_in_error';
export interface RecordCanonicalImagingProvenanceInput extends CommandBase, SourceInput {
  provenanceEventPublicId?: string;
  acquisitionPublicId?: string | null;
  studyPublicId?: string | null;
  seriesPublicId?: string | null;
  instancePublicId?: string | null;
  eventType: ImagingProvenanceEventType;
  disposition: ImagingProvenanceDisposition;
  eventVersion: number;
  modalitySourceType?: string | null;
  modalitySourcePublicId?: string | null;
  sourceAeTitle?: string | null;
  calledAeTitle?: string | null;
  pacsEndpointSourceType?: string | null;
  pacsEndpointSourcePublicId?: string | null;
  bridgeSourceType?: string | null;
  bridgeSourcePublicId?: string | null;
  messageSourceType?: string | null;
  messageSourcePublicId?: string | null;
  protocol?: string | null;
  transferSyntaxUid?: string | null;
  objectContentSha256?: string | null;
  storageProviderType?: string | null;
  storageProviderPublicId?: string | null;
  storageObjectKey?: string | null;
  storageGeneration?: string | null;
  occurredAtUtc: string;
  recordedAtUtc: string;
  reasonCode: string;
}

export interface CanonicalImagingReportContent {
  indication: string | null;
  technique: string | null;
  findings: string;
  impression: string;
  comparison: string | null;
  recommendations: string | null;
}
export interface CreateCanonicalImagingReportDraftInput extends CommandBase, SourceInput {
  reportSetPublicId?: string;
  versionPublicId?: string;
  acquisitionPublicId: string;
  studyPublicId: string;
  reportingPractitionerPublicId: string;
  reportNumberNamespace: string;
  reportNumberValue: string;
  content: CanonicalImagingReportContent;
  occurredAtUtc: string;
}
interface ReplaceReportBase extends CommandBase {
  reportSetPublicId: string;
  expectedStatusVersion: number;
  versionPublicId?: string;
  authoringPractitionerPublicId: string;
  reasonCode: string;
  content: CanonicalImagingReportContent;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
}
export interface ReplaceCanonicalImagingReportDraftInput extends ReplaceReportBase {}
export interface CorrectCanonicalImagingReportVersionInput extends ReplaceReportBase {}
export interface VerifyCanonicalImagingReportVersionInput extends CommandBase {
  reportSetPublicId: string;
  versionPublicId: string;
  expectedStatusVersion: number;
  verifyingPractitionerPublicId: string;
  signedContentSha256: string;
  reasonCode: string;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
}
export interface FinalizeAndPublishCanonicalImagingReportVersionInput extends CommandBase {
  reportSetPublicId: string;
  versionPublicId: string;
  expectedStatusVersion: number;
  finalisingPractitionerPublicId: string;
  signedContentSha256: string;
  finalisationReasonCode: string;
  publicationReasonCode: string;
  sourceEvidenceSha256: string;
  finalisedAtUtc: string;
  publishedAtUtc: string;
}
interface TerminalReportInput extends CommandBase {
  reportSetPublicId: string;
  expectedStatusVersion: number;
  versionPublicId?: string;
  authoringPractitionerPublicId: string;
  reasonCode: string;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
}
export interface RetractCanonicalImagingReportVersionInput extends TerminalReportInput {}
export interface EnterCanonicalImagingReportInErrorInput extends TerminalReportInput {}

export interface ImagingAcquisitionCommandResult {
  acquisitionPublicId: string;
  currentStatus: CanonicalImagingAcquisitionStatus;
  statusVersion: number;
}
export interface ImagingHierarchyCommandResult {
  kind: 'study' | 'series' | 'instance' | 'provenance';
  publicId: string;
  parentPublicId: string | null;
  disposition: string;
}
export interface ImagingReportCommandResult {
  reportSetPublicId: string;
  versionPublicId: string;
  currentStatus: CanonicalImagingReportStatus;
  statusVersion: number;
  versionNumber: number;
}

interface Actor { actorUserPublicId: string | null; actorSystemKey: string | null }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface AcquisitionRow {
  patient_link_public_id: string;
  encounter_public_id: string;
  request_public_id: string;
  event_public_id: string | null;
  service_public_id: string;
  accession_namespace: string;
  accession_value: string;
  modality_code: string;
  current_status: CanonicalImagingAcquisitionStatus;
  status_version: number;
}
interface StudyRow {
  acquisition_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  request_public_id: string;
  service_public_id: string;
  study_instance_uid: string;
}
interface SeriesRow { study_public_id: string; series_instance_uid: string }
interface InstanceRow { instance_public_id: string; object_content_sha256: string; study_public_id: string; series_public_id: string }
interface ReportSetRow {
  patient_link_public_id: string;
  encounter_public_id: string;
  request_public_id: string;
  service_public_id: string;
  acquisition_public_id: string;
  study_public_id: string;
  current_version_public_id: string | null;
  current_status: CanonicalImagingReportStatus;
  status_version: number;
}
interface ReportVersionRow {
  version_public_id: string;
  version_number: number;
  version_status: CanonicalImagingReportStatus;
  content_json: string;
  content_sha256: string;
}

const REGISTER_ACQ = 'registerCanonicalImagingAcquisition';
const START_ACQ = 'startCanonicalImagingAcquisition';
const COMPLETE_ACQ = 'completeCanonicalImagingAcquisition';
const CANCEL_ACQ = 'cancelCanonicalImagingAcquisition';
const ERROR_ACQ = 'enterCanonicalImagingAcquisitionInError';
const REGISTER_STUDY = 'registerCanonicalImagingStudy';
const REGISTER_SERIES = 'registerCanonicalImagingSeries';
const REGISTER_INSTANCE = 'registerCanonicalImagingInstance';
const RECORD_PROVENANCE = 'recordCanonicalImagingProvenance';
const CREATE_REPORT = 'createCanonicalImagingReportDraft';
const REPLACE_REPORT = 'replaceCanonicalImagingReportDraft';
const VERIFY_REPORT = 'verifyCanonicalImagingReportVersion';
const FINAL_PUBLISH_REPORT = 'finalizeAndPublishCanonicalImagingReportVersion';
const CORRECT_REPORT = 'correctCanonicalImagingReportVersion';
const RETRACT_REPORT = 'retractCanonicalImagingReportVersion';
const ERROR_REPORT = 'enterCanonicalImagingReportInError';

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
function nonnegative(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
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
  const actorUserPublicId = optional(input.actorUserPublicId, 'actorUserPublicId');
  const actorSystemKey = optional(input.actorSystemKey, 'actorSystemKey');
  if (!actorUserPublicId && !actorSystemKey) throw new TypeError('actorUserPublicId or actorSystemKey is required');
  return { actorUserPublicId, actorSystemKey };
}
function pair(left: string | null, right: string | null, label: string): void {
  if ((left == null) !== (right == null)) throw new TypeError(`${label} type and public ID must be provided together`);
}
async function publicId(prefix: string, tenantId: string, sourceType: string, sourcePublicId: string, supplied: string | null | undefined, label: string): Promise<string> {
  return supplied == null ? createDeterministicSourceId(prefix, tenantId, sourceType, sourcePublicId) : exact(supplied, label);
}
async function eventId(tenantId: string, commandName: string, idempotencyKey: string, suffix: string): Promise<string> {
  return createDeterministicSourceId('imgevt', tenantId, commandName, `${idempotencyKey}:${suffix}`);
}
async function outboxId(tenantId: string, commandName: string, idempotencyKey: string, supplied?: string): Promise<string> {
  return publicId('evt', tenantId, commandName, idempotencyKey, supplied, 'outboxEventPublicId');
}
async function request(fullOperation: unknown, businessDate: string) {
  return { schemaVersion: 1 as const, operationFingerprintSha256: await createRequestFingerprint(fullOperation), businessDate };
}
async function requirePractitioner(db: CanonicalBatchDatabase, tenantId: string, practitionerPublicId: string): Promise<void> {
  const row = await db.prepare(`SELECT status FROM canonical_practitioners WHERE tenant_id=? AND practitioner_public_id=? LIMIT 1`)
    .bind(tenantId, practitionerPublicId).first<{ status: string }>();
  if (!row || row.status !== 'active') throw new Error('active practitioner is required');
}
async function requireClinicalScope(db: CanonicalBatchDatabase, input: {
  tenantId: string; patientLinkPublicId: string; encounterPublicId: string;
  requestPublicId: string; eventPublicId: string | null; servicePublicId: string;
}): Promise<void> {
  const patient = await db.prepare(`SELECT link_status,effective_to_utc FROM canonical_tenant_patient_links WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1`)
    .bind(input.tenantId, input.patientLinkPublicId).first<{ link_status: string; effective_to_utc: string | null }>();
  if (!patient || ['rejected','retired'].includes(patient.link_status) || patient.effective_to_utc != null) throw new Error('active patient link is required');
  const encounter = await db.prepare(`SELECT patient_link_public_id,status FROM canonical_encounters WHERE tenant_id=? AND encounter_public_id=? LIMIT 1`)
    .bind(input.tenantId, input.encounterPublicId).first<{ patient_link_public_id: string | null; status: string }>();
  if (!encounter || encounter.patient_link_public_id !== input.patientLinkPublicId || encounter.status === 'entered_in_error') throw new Error('encounter patient scope mismatch');
  const service = await db.prepare(`SELECT item_kind,status FROM canonical_service_catalog_items WHERE tenant_id=? AND service_public_id=? LIMIT 1`)
    .bind(input.tenantId, input.servicePublicId).first<{ item_kind: string; status: string }>();
  if (!service || service.item_kind !== 'radiology' || service.status !== 'active') throw new Error('active radiology service is required');
  const req = await db.prepare(`SELECT encounter_public_id,service_public_id,status FROM canonical_service_requests WHERE tenant_id=? AND request_public_id=? LIMIT 1`)
    .bind(input.tenantId, input.requestPublicId).first<{ encounter_public_id: string; service_public_id: string; status: string }>();
  if (!req || req.encounter_public_id !== input.encounterPublicId || req.service_public_id !== input.servicePublicId) throw new Error('service request scope mismatch');
  if (input.eventPublicId) {
    const evt = await db.prepare(`SELECT request_public_id,encounter_public_id,service_public_id,status FROM canonical_service_events WHERE tenant_id=? AND event_public_id=? LIMIT 1`)
      .bind(input.tenantId, input.eventPublicId).first<{ request_public_id: string; encounter_public_id: string; service_public_id: string; status: string }>();
    if (!evt || evt.request_public_id !== input.requestPublicId || evt.encounter_public_id !== input.encounterPublicId || evt.service_public_id !== input.servicePublicId || evt.status !== 'posted') throw new Error('service event scope mismatch');
  }
}
async function requireMappingAvailable(db: CanonicalBatchDatabase, input: {
  tenantId: string; entityType: string; sourceType: string; sourcePublicId: string; canonicalPublicId: string;
}): Promise<void> {
  const row = await db.prepare(`SELECT canonical_public_id,mapping_status FROM canonical_source_mappings WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1`)
    .bind(input.tenantId,input.entityType,input.sourceType,input.sourcePublicId).first<MappingRow>();
  if (!row) return;
  if (row.mapping_status !== 'mapped' || row.canonical_public_id !== input.canonicalPublicId) throw new Error('source mapping already belongs to another canonical record');
  throw new Error('source mapping already exists without replay evidence');
}
function mappingStatement(db: CanonicalBatchDatabase, input: {
  tenantId: string; entityType: string; canonicalPublicId: string; sourceType: string;
  sourcePublicId: string; sourceTable: string; evidenceSha256: string; occurredAtUtc: string;
}): CanonicalPreparedStatement {
  return db.prepare(`INSERT INTO canonical_source_mappings (
    tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
    mapping_status,mapping_version,migration_run_id,evidence_sha256,created_at_utc,updated_at_utc
  ) VALUES (?,?,?,?,?,?,'mapped',1,NULL,?,?,?)`).bind(
    input.tenantId,input.entityType,input.canonicalPublicId,input.sourceType,input.sourcePublicId,
    input.sourceTable,input.evidenceSha256,input.occurredAtUtc,input.occurredAtUtc,
  );
}

async function acquisitionRow(db: CanonicalBatchDatabase, tenantId: string, acquisitionPublicId: string): Promise<AcquisitionRow> {
  const row = await db.prepare(`SELECT patient_link_public_id,encounter_public_id,request_public_id,event_public_id,service_public_id,accession_namespace,accession_value,modality_code,current_status,status_version FROM canonical_imaging_acquisitions WHERE tenant_id=? AND acquisition_public_id=? LIMIT 1`)
    .bind(tenantId, acquisitionPublicId).first<AcquisitionRow>();
  if (!row) throw new Error('canonical imaging acquisition not found');
  return row;
}
function acquisitionEventStatement(db: CanonicalBatchDatabase, input: {
  tenantId: string; eventPublicId: string; acquisitionPublicId: string;
  fromStatus: CanonicalImagingAcquisitionStatus | null; toStatus: CanonicalImagingAcquisitionStatus;
  eventVersion: number; eventType: string; practitionerPublicId: string | null; actor: Actor;
  modalitySourceType?: string | null; modalitySourcePublicId?: string | null;
  pacsEndpointSourceType?: string | null; pacsEndpointSourcePublicId?: string | null;
  occurredAtUtc: string; recordedAtUtc: string; reasonCode: string; evidenceSha256: string;
}): CanonicalPreparedStatement {
  return db.prepare(`INSERT INTO canonical_imaging_acquisition_status_events (
    tenant_id,event_public_id,acquisition_public_id,from_status,to_status,event_version,event_type,
    actor_practitioner_public_id,actor_user_public_id,actor_system_key,modality_source_type,
    modality_source_public_id,pacs_endpoint_source_type,pacs_endpoint_source_public_id,
    occurred_at_utc,recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    input.tenantId,input.eventPublicId,input.acquisitionPublicId,input.fromStatus,input.toStatus,
    input.eventVersion,input.eventType,input.practitionerPublicId,input.actor.actorUserPublicId,
    input.actor.actorSystemKey,input.modalitySourceType ?? null,input.modalitySourcePublicId ?? null,
    input.pacsEndpointSourceType ?? null,input.pacsEndpointSourcePublicId ?? null,
    input.occurredAtUtc,input.recordedAtUtc,input.reasonCode,input.evidenceSha256,input.recordedAtUtc,
  );
}

export async function registerCanonicalImagingAcquisition(
  db: CanonicalBatchDatabase,
  raw: RegisterCanonicalImagingAcquisitionInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<ImagingAcquisitionCommandResult>> {
  const tenantId=exact(raw.tenantId,'tenantId'); const idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey');
  const occurredAtUtc=utc(raw.occurredAtUtc,'occurredAtUtc'); const businessDate=exact(raw.businessDate,'businessDate');
  const commandActor=actor(raw); const sourceType=exact(raw.sourceType,'sourceType'); const sourcePublicId=exact(raw.sourcePublicId,'sourcePublicId');
  const sourceTable=exact(raw.sourceTable,'sourceTable'); const evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256');
  const acquisitionPublicId=await publicId('imgacq',tenantId,sourceType,sourcePublicId,raw.acquisitionPublicId,'acquisitionPublicId');
  const patientLinkPublicId=exact(raw.patientLinkPublicId,'patientLinkPublicId'); const encounterPublicId=exact(raw.encounterPublicId,'encounterPublicId');
  const requestPublicId=exact(raw.requestPublicId,'requestPublicId'); const eventPublicId=optional(raw.eventPublicId,'eventPublicId');
  const servicePublicId=exact(raw.servicePublicId,'servicePublicId'); const performer=optional(raw.performingPractitionerPublicId,'performingPractitionerPublicId');
  const full={acquisitionPublicId,patientLinkPublicId,encounterPublicId,requestPublicId,eventPublicId,servicePublicId,
    accessionNamespace:exact(raw.accessionNamespace,'accessionNamespace'),accessionValue:exact(raw.accessionValue,'accessionValue'),
    modalityCode:exact(raw.modalityCode,'modalityCode'),bodySiteCode:optional(raw.bodySiteCode,'bodySiteCode'),
    procedureSnapshot:optional(raw.procedureSnapshot,'procedureSnapshot'),performer,sourceType,sourcePublicId,sourceTable,evidence,commandActor,occurredAtUtc};
  const req=await request(full,businessDate); const replay=await readCanonicalCommandReplay<ImagingAcquisitionCommandResult>(db,{tenantId,commandName:REGISTER_ACQ,idempotencyKey,request:req});
  if(replay)return replay;
  await requireClinicalScope(db,{tenantId,patientLinkPublicId,encounterPublicId,requestPublicId,eventPublicId,servicePublicId});
  if(performer)await requirePractitioner(db,tenantId,performer);
  await requireMappingAvailable(db,{tenantId,entityType:'imaging_acquisition',sourceType,sourcePublicId,canonicalPublicId:acquisitionPublicId});
  const fingerprint=await createRequestFingerprint(full); const initialEvent=await eventId(tenantId,REGISTER_ACQ,idempotencyKey,'registered');
  const result:ImagingAcquisitionCommandResult={acquisitionPublicId,currentStatus:'scheduled',statusVersion:1};
  return runCanonicalBatch(db,{tenantId,commandName:REGISTER_ACQ,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,
    statements:[
      db.prepare(`INSERT INTO canonical_imaging_acquisitions (
        tenant_id,acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,event_public_id,
        service_public_id,accession_namespace,accession_value,modality_code,body_site_code,procedure_snapshot,
        current_status,status_version,performing_practitioner_public_id,actor_user_public_id,actor_system_key,
        idempotency_key,request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'scheduled',1,?,?,?,?,?,?,?,?)`).bind(
        tenantId,acquisitionPublicId,patientLinkPublicId,encounterPublicId,requestPublicId,eventPublicId,servicePublicId,
        full.accessionNamespace,full.accessionValue,full.modalityCode,full.bodySiteCode,full.procedureSnapshot,performer,
        commandActor.actorUserPublicId,commandActor.actorSystemKey,idempotencyKey,fingerprint,evidence,occurredAtUtc,occurredAtUtc),
      acquisitionEventStatement(db,{tenantId,eventPublicId:initialEvent,acquisitionPublicId,fromStatus:null,toStatus:'scheduled',eventVersion:1,eventType:'registered',practitionerPublicId:performer,actor:commandActor,occurredAtUtc,recordedAtUtc:occurredAtUtc,reasonCode:'registered',evidenceSha256:evidence}),
      db.prepare(`UPDATE canonical_imaging_acquisitions SET current_status_event_public_id=?,scheduled_at_utc=?,updated_at_utc=? WHERE tenant_id=? AND acquisition_public_id=? AND current_status_event_public_id IS NULL`).bind(initialEvent,occurredAtUtc,occurredAtUtc,tenantId,acquisitionPublicId),
      mappingStatement(db,{tenantId,entityType:'imaging_acquisition',canonicalPublicId:acquisitionPublicId,sourceType,sourcePublicId,sourceTable,evidenceSha256:evidence,occurredAtUtc}),
    ],result,event:{eventPublicId:await outboxId(tenantId,REGISTER_ACQ,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_acquisition',aggregatePublicId:acquisitionPublicId,eventType:'canonical.imaging-acquisition.registered',occurredAtUtc,businessDate,payload:result}});
}

async function transitionAcquisition(db:CanonicalBatchDatabase, raw:AcquisitionTransitionBase, config:{commandName:string;from:readonly CanonicalImagingAcquisitionStatus[];to:CanonicalImagingAcquisitionStatus;eventType:string;reason:string;timeColumn:'started_at_utc'|'completed_at_utc'|'cancelled_at_utc'|'entered_in_error_at_utc';outboxType:string}, execution:CanonicalCommandExecutionOptions):Promise<CanonicalCommandResult<ImagingAcquisitionCommandResult>>{
  const tenantId=exact(raw.tenantId,'tenantId');const idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey');const acquisitionPublicId=exact(raw.acquisitionPublicId,'acquisitionPublicId');
  const expected=positive(raw.expectedStatusVersion,'expectedStatusVersion');const practitioner=optional(raw.performingPractitionerPublicId ?? raw.practitionerPublicId,'practitionerPublicId');
  const occurredAtUtc=utc(raw.occurredAtUtc,'occurredAtUtc');const recordedAtUtc=utc(raw.recordedAtUtc,'recordedAtUtc');if(recordedAtUtc<occurredAtUtc)throw new RangeError('recordedAtUtc cannot precede occurredAtUtc');
  const evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256');const businessDate=exact(raw.businessDate,'businessDate');const commandActor=actor(raw);
  const modalitySourceType=optional(raw.modalitySourceType,'modalitySourceType');const modalitySourcePublicId=optional(raw.modalitySourcePublicId,'modalitySourcePublicId');pair(modalitySourceType,modalitySourcePublicId,'modality source');
  const pacsEndpointSourceType=optional(raw.pacsEndpointSourceType,'pacsEndpointSourceType');const pacsEndpointSourcePublicId=optional(raw.pacsEndpointSourcePublicId,'pacsEndpointSourcePublicId');pair(pacsEndpointSourceType,pacsEndpointSourcePublicId,'PACS endpoint source');
  const reason=exact(raw.reasonCode ?? config.reason,'reasonCode');const full={acquisitionPublicId,expected,practitioner,to:config.to,reason,evidence,commandActor,modalitySourceType,modalitySourcePublicId,pacsEndpointSourceType,pacsEndpointSourcePublicId,occurredAtUtc,recordedAtUtc};
  const req=await request(full,businessDate);const replay=await readCanonicalCommandReplay<ImagingAcquisitionCommandResult>(db,{tenantId,commandName:config.commandName,idempotencyKey,request:req});if(replay)return replay;
  const current=await acquisitionRow(db,tenantId,acquisitionPublicId);if(!config.from.includes(current.current_status)||Number(current.status_version)!==expected)throw new Error('canonical imaging acquisition status version conflict');
  if(config.to==='completed'&&!current.event_public_id)throw new Error('completed acquisition requires exact service event');
  if(config.to==='completed'&&!practitioner)throw new Error('completed acquisition requires exact performer');
  if(practitioner)await requirePractitioner(db,tenantId,practitioner);
  const next=expected+1;const lifecycle=await eventId(tenantId,config.commandName,idempotencyKey,String(next));const result:ImagingAcquisitionCommandResult={acquisitionPublicId,currentStatus:config.to,statusVersion:next};
  return runCanonicalBatch(db,{tenantId,commandName:config.commandName,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,
    statements:[acquisitionEventStatement(db,{tenantId,eventPublicId:lifecycle,acquisitionPublicId,fromStatus:current.current_status,toStatus:config.to,eventVersion:next,eventType:config.eventType,practitionerPublicId:practitioner,actor:commandActor,modalitySourceType,modalitySourcePublicId,pacsEndpointSourceType,pacsEndpointSourcePublicId,occurredAtUtc,recordedAtUtc,reasonCode:reason,evidenceSha256:evidence}),
      db.prepare(`UPDATE canonical_imaging_acquisitions SET current_status=?,status_version=?,current_status_event_public_id=?,${config.timeColumn}=?,performing_practitioner_public_id=COALESCE(?,performing_practitioner_public_id),updated_at_utc=? WHERE tenant_id=? AND acquisition_public_id=? AND current_status=? AND status_version=?`).bind(config.to,next,lifecycle,occurredAtUtc,practitioner,recordedAtUtc,tenantId,acquisitionPublicId,current.current_status,expected)],
    result,event:{eventPublicId:await outboxId(tenantId,config.commandName,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_acquisition',aggregatePublicId:acquisitionPublicId,eventType:config.outboxType,occurredAtUtc,businessDate,payload:result}});
}
export function startCanonicalImagingAcquisition(db:CanonicalBatchDatabase,input:StartCanonicalImagingAcquisitionInput,execution:CanonicalCommandExecutionOptions={}){return transitionAcquisition(db,input,{commandName:START_ACQ,from:['scheduled','ready'],to:'in_progress',eventType:'started',reason:'started',timeColumn:'started_at_utc',outboxType:'canonical.imaging-acquisition.started'},execution);}
export function completeCanonicalImagingAcquisition(db:CanonicalBatchDatabase,input:CompleteCanonicalImagingAcquisitionInput,execution:CanonicalCommandExecutionOptions={}){return transitionAcquisition(db,input,{commandName:COMPLETE_ACQ,from:['in_progress'],to:'completed',eventType:'completed',reason:'completed',timeColumn:'completed_at_utc',outboxType:'canonical.imaging-acquisition.completed'},execution);}
export function cancelCanonicalImagingAcquisition(db:CanonicalBatchDatabase,input:CancelCanonicalImagingAcquisitionInput,execution:CanonicalCommandExecutionOptions={}){return transitionAcquisition(db,input,{commandName:CANCEL_ACQ,from:['scheduled','ready','in_progress'],to:'cancelled',eventType:'cancelled',reason:input.reasonCode,timeColumn:'cancelled_at_utc',outboxType:'canonical.imaging-acquisition.cancelled'},execution);}
export function enterCanonicalImagingAcquisitionInError(db:CanonicalBatchDatabase,input:EnterCanonicalImagingAcquisitionInErrorInput,execution:CanonicalCommandExecutionOptions={}){return transitionAcquisition(db,input,{commandName:ERROR_ACQ,from:['scheduled','ready','in_progress','completed'],to:'entered_in_error',eventType:'entered_in_error',reason:input.reasonCode,timeColumn:'entered_in_error_at_utc',outboxType:'canonical.imaging-acquisition.entered-in-error'},execution);}

async function studyRow(db:CanonicalBatchDatabase,tenantId:string,studyPublicId:string):Promise<StudyRow>{const row=await db.prepare(`SELECT acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id,study_instance_uid FROM canonical_imaging_studies WHERE tenant_id=? AND study_public_id=? LIMIT 1`).bind(tenantId,studyPublicId).first<StudyRow>();if(!row)throw new Error('canonical imaging study not found');return row;}
async function seriesRow(db:CanonicalBatchDatabase,tenantId:string,seriesPublicId:string):Promise<SeriesRow>{const row=await db.prepare(`SELECT study_public_id,series_instance_uid FROM canonical_imaging_series WHERE tenant_id=? AND series_public_id=? LIMIT 1`).bind(tenantId,seriesPublicId).first<SeriesRow>();if(!row)throw new Error('canonical imaging series not found');return row;}

export async function registerCanonicalImagingStudy(db:CanonicalBatchDatabase,raw:RegisterCanonicalImagingStudyInput,execution:CanonicalCommandExecutionOptions={}):Promise<CanonicalCommandResult<ImagingHierarchyCommandResult>>{
  const tenantId=exact(raw.tenantId,'tenantId');const idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey');const acquisitionPublicId=exact(raw.acquisitionPublicId,'acquisitionPublicId');const occurredAtUtc=utc(raw.occurredAtUtc,'occurredAtUtc');const studyStartedAtUtc=utc(raw.studyStartedAtUtc,'studyStartedAtUtc');const businessDate=exact(raw.businessDate,'businessDate');const commandActor=actor(raw);
  const sourceType=exact(raw.sourceType,'sourceType'),sourcePublicId=exact(raw.sourcePublicId,'sourcePublicId'),sourceTable=exact(raw.sourceTable,'sourceTable'),evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256');const studyPublicId=await publicId('imgstudy',tenantId,sourceType,sourcePublicId,raw.studyPublicId,'studyPublicId');
  const full={studyPublicId,acquisitionPublicId,studyUidNamespace:exact(raw.studyUidNamespace,'studyUidNamespace'),studyInstanceUid:exact(raw.studyInstanceUid,'studyInstanceUid'),accessionNamespace:exact(raw.accessionNamespace,'accessionNamespace'),accessionValue:exact(raw.accessionValue,'accessionValue'),modalityCode:exact(raw.modalityCode,'modalityCode'),studyStartedAtUtc,sourceType,sourcePublicId,sourceTable,evidence,commandActor,occurredAtUtc};
  const req=await request(full,businessDate);const replay=await readCanonicalCommandReplay<ImagingHierarchyCommandResult>(db,{tenantId,commandName:REGISTER_STUDY,idempotencyKey,request:req});if(replay)return replay;
  const acq=await acquisitionRow(db,tenantId,acquisitionPublicId);if(acq.accession_namespace!==full.accessionNamespace||acq.accession_value!==full.accessionValue||acq.modality_code!==full.modalityCode)throw new Error('imaging study acquisition accession or modality scope mismatch');
  await requireMappingAvailable(db,{tenantId,entityType:'imaging_study',sourceType,sourcePublicId,canonicalPublicId:studyPublicId});const fingerprint=await createRequestFingerprint(full);const result:ImagingHierarchyCommandResult={kind:'study',publicId:studyPublicId,parentPublicId:acquisitionPublicId,disposition:'active'};
  return runCanonicalBatch(db,{tenantId,commandName:REGISTER_STUDY,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,statements:[
    db.prepare(`INSERT INTO canonical_imaging_studies (tenant_id,study_public_id,acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id,study_uid_namespace,study_instance_uid,accession_namespace,accession_value,modality_code,study_started_at_utc,current_status,status_version,actor_user_public_id,actor_system_key,idempotency_key,request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',1,?,?,?,?,?,?,?)`).bind(tenantId,studyPublicId,acquisitionPublicId,acq.patient_link_public_id,acq.encounter_public_id,acq.request_public_id,acq.service_public_id,full.studyUidNamespace,full.studyInstanceUid,full.accessionNamespace,full.accessionValue,full.modalityCode,studyStartedAtUtc,commandActor.actorUserPublicId,commandActor.actorSystemKey,idempotencyKey,fingerprint,evidence,occurredAtUtc,occurredAtUtc),
    mappingStatement(db,{tenantId,entityType:'imaging_study',canonicalPublicId:studyPublicId,sourceType,sourcePublicId,sourceTable,evidenceSha256:evidence,occurredAtUtc})],result,event:{eventPublicId:await outboxId(tenantId,REGISTER_STUDY,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_study',aggregatePublicId:studyPublicId,eventType:'canonical.imaging-study.registered',occurredAtUtc,businessDate,payload:result}});
}

export async function registerCanonicalImagingSeries(db:CanonicalBatchDatabase,raw:RegisterCanonicalImagingSeriesInput,execution:CanonicalCommandExecutionOptions={}):Promise<CanonicalCommandResult<ImagingHierarchyCommandResult>>{
  const tenantId=exact(raw.tenantId,'tenantId'),idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey'),studyPublicId=exact(raw.studyPublicId,'studyPublicId'),occurredAtUtc=utc(raw.occurredAtUtc,'occurredAtUtc'),businessDate=exact(raw.businessDate,'businessDate');const commandActor=actor(raw);
  const sourceType=exact(raw.sourceType,'sourceType'),sourcePublicId=exact(raw.sourcePublicId,'sourcePublicId'),sourceTable=exact(raw.sourceTable,'sourceTable'),evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256');const seriesPublicId=await publicId('imgseries',tenantId,sourceType,sourcePublicId,raw.seriesPublicId,'seriesPublicId');
  const full={seriesPublicId,studyPublicId,seriesUidNamespace:exact(raw.seriesUidNamespace,'seriesUidNamespace'),seriesInstanceUid:exact(raw.seriesInstanceUid,'seriesInstanceUid'),seriesNumber:nonnegative(raw.seriesNumber,'seriesNumber'),modalityCode:exact(raw.modalityCode,'modalityCode'),bodyPartCode:optional(raw.bodyPartCode,'bodyPartCode'),protocolName:optional(raw.protocolName,'protocolName'),lateralityCode:optional(raw.lateralityCode,'lateralityCode'),descriptionSnapshot:optional(raw.descriptionSnapshot,'descriptionSnapshot'),sourceType,sourcePublicId,sourceTable,evidence,commandActor,occurredAtUtc};
  const req=await request(full,businessDate);const replay=await readCanonicalCommandReplay<ImagingHierarchyCommandResult>(db,{tenantId,commandName:REGISTER_SERIES,idempotencyKey,request:req});if(replay)return replay;await studyRow(db,tenantId,studyPublicId);await requireMappingAvailable(db,{tenantId,entityType:'imaging_series',sourceType,sourcePublicId,canonicalPublicId:seriesPublicId});const result:ImagingHierarchyCommandResult={kind:'series',publicId:seriesPublicId,parentPublicId:studyPublicId,disposition:'active'};
  return runCanonicalBatch(db,{tenantId,commandName:REGISTER_SERIES,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,statements:[
    db.prepare(`INSERT INTO canonical_imaging_series (tenant_id,series_public_id,study_public_id,series_uid_namespace,series_instance_uid,series_number,modality_code,body_part_code,protocol_name,laterality_code,description_snapshot,current_status,instance_count,source_evidence_sha256,created_at_utc,updated_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',0,?,?,?)`).bind(tenantId,seriesPublicId,studyPublicId,full.seriesUidNamespace,full.seriesInstanceUid,full.seriesNumber,full.modalityCode,full.bodyPartCode,full.protocolName,full.lateralityCode,full.descriptionSnapshot,evidence,occurredAtUtc,occurredAtUtc),
    mappingStatement(db,{tenantId,entityType:'imaging_series',canonicalPublicId:seriesPublicId,sourceType,sourcePublicId,sourceTable,evidenceSha256:evidence,occurredAtUtc})],result,event:{eventPublicId:await outboxId(tenantId,REGISTER_SERIES,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_series',aggregatePublicId:seriesPublicId,eventType:'canonical.imaging-series.registered',occurredAtUtc,businessDate,payload:result}});
}

export async function registerCanonicalImagingInstance(db:CanonicalBatchDatabase,raw:RegisterCanonicalImagingInstanceInput,execution:CanonicalCommandExecutionOptions={}):Promise<CanonicalCommandResult<ImagingHierarchyCommandResult>>{
  const tenantId=exact(raw.tenantId,'tenantId'),idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey'),studyPublicId=exact(raw.studyPublicId,'studyPublicId'),seriesPublicId=exact(raw.seriesPublicId,'seriesPublicId'),occurredAtUtc=utc(raw.occurredAtUtc,'occurredAtUtc'),businessDate=exact(raw.businessDate,'businessDate');const commandActor=actor(raw);
  const sourceType=exact(raw.sourceType,'sourceType'),sourcePublicId=exact(raw.sourcePublicId,'sourcePublicId'),sourceTable=exact(raw.sourceTable,'sourceTable'),evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256');const instancePublicId=await publicId('imginst',tenantId,sourceType,sourcePublicId,raw.instancePublicId,'instancePublicId');const objectHash=digest(raw.objectContentSha256,'objectContentSha256');
  const full={instancePublicId,studyPublicId,seriesPublicId,sopUidNamespace:exact(raw.sopUidNamespace,'sopUidNamespace'),sopInstanceUid:exact(raw.sopInstanceUid,'sopInstanceUid'),sopClassUid:exact(raw.sopClassUid,'sopClassUid'),instanceNumber:nonnegative(raw.instanceNumber,'instanceNumber'),frameCount:positive(raw.frameCount,'frameCount'),transferSyntaxUid:optional(raw.transferSyntaxUid,'transferSyntaxUid'),objectHash,byteSize:nonnegative(raw.byteSize,'byteSize'),storageProviderType:exact(raw.storageProviderType,'storageProviderType'),storageProviderPublicId:exact(raw.storageProviderPublicId,'storageProviderPublicId'),storageObjectKey:exact(raw.storageObjectKey,'storageObjectKey'),storageGeneration:exact(raw.storageGeneration,'storageGeneration'),sourceType,sourcePublicId,sourceTable,evidence,commandActor,occurredAtUtc};
  const req=await request(full,businessDate);const replay=await readCanonicalCommandReplay<ImagingHierarchyCommandResult>(db,{tenantId,commandName:REGISTER_INSTANCE,idempotencyKey,request:req});if(replay)return replay;const series=await seriesRow(db,tenantId,seriesPublicId);if(series.study_public_id!==studyPublicId)throw new Error('imaging instance series/study scope mismatch');
  const collision=await db.prepare(`SELECT instance_public_id,object_content_sha256,study_public_id,series_public_id FROM canonical_imaging_instances WHERE tenant_id=? AND sop_uid_namespace=? AND sop_instance_uid=? LIMIT 1`).bind(tenantId,full.sopUidNamespace,full.sopInstanceUid).first<InstanceRow>();if(collision)throw new Error(collision.object_content_sha256===objectHash?'SOP instance is already registered':'SOP instance UID content collision');
  await requireMappingAvailable(db,{tenantId,entityType:'imaging_instance',sourceType,sourcePublicId,canonicalPublicId:instancePublicId});const result:ImagingHierarchyCommandResult={kind:'instance',publicId:instancePublicId,parentPublicId:seriesPublicId,disposition:'accepted'};
  return runCanonicalBatch(db,{tenantId,commandName:REGISTER_INSTANCE,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,statements:[
    db.prepare(`INSERT INTO canonical_imaging_instances (tenant_id,instance_public_id,study_public_id,series_public_id,sop_uid_namespace,sop_instance_uid,sop_class_uid,instance_number,frame_count,transfer_syntax_uid,object_content_sha256,byte_size,storage_provider_type,storage_provider_public_id,storage_object_key,storage_generation,current_disposition,source_evidence_sha256,created_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'accepted',?,?)`).bind(tenantId,instancePublicId,studyPublicId,seriesPublicId,full.sopUidNamespace,full.sopInstanceUid,full.sopClassUid,full.instanceNumber,full.frameCount,full.transferSyntaxUid,objectHash,full.byteSize,full.storageProviderType,full.storageProviderPublicId,full.storageObjectKey,full.storageGeneration,evidence,occurredAtUtc),
    mappingStatement(db,{tenantId,entityType:'imaging_instance',canonicalPublicId:instancePublicId,sourceType,sourcePublicId,sourceTable,evidenceSha256:evidence,occurredAtUtc})],result,event:{eventPublicId:await outboxId(tenantId,REGISTER_INSTANCE,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_instance',aggregatePublicId:instancePublicId,eventType:'canonical.imaging-instance.registered',occurredAtUtc,businessDate,payload:result}});
}

export async function recordCanonicalImagingProvenance(db:CanonicalBatchDatabase,raw:RecordCanonicalImagingProvenanceInput,execution:CanonicalCommandExecutionOptions={}):Promise<CanonicalCommandResult<ImagingHierarchyCommandResult>>{
  const tenantId=exact(raw.tenantId,'tenantId'),idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey'),occurredAtUtc=utc(raw.occurredAtUtc,'occurredAtUtc'),recordedAtUtc=utc(raw.recordedAtUtc,'recordedAtUtc'),businessDate=exact(raw.businessDate,'businessDate');if(recordedAtUtc<occurredAtUtc)throw new RangeError('recordedAtUtc cannot precede occurredAtUtc');const commandActor=actor(raw);
  const sourceType=exact(raw.sourceType,'sourceType'),sourcePublicId=exact(raw.sourcePublicId,'sourcePublicId'),sourceTable=exact(raw.sourceTable,'sourceTable'),evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256');const provenanceEventPublicId=await publicId('imgprov',tenantId,sourceType,sourcePublicId,raw.provenanceEventPublicId,'provenanceEventPublicId');
  const acquisitionPublicId=optional(raw.acquisitionPublicId,'acquisitionPublicId'),studyPublicId=optional(raw.studyPublicId,'studyPublicId'),seriesPublicId=optional(raw.seriesPublicId,'seriesPublicId'),instancePublicId=optional(raw.instancePublicId,'instancePublicId');
  const modalitySourceType=optional(raw.modalitySourceType,'modalitySourceType'),modalitySourcePublicId=optional(raw.modalitySourcePublicId,'modalitySourcePublicId');pair(modalitySourceType,modalitySourcePublicId,'modality source');const pacsEndpointSourceType=optional(raw.pacsEndpointSourceType,'pacsEndpointSourceType'),pacsEndpointSourcePublicId=optional(raw.pacsEndpointSourcePublicId,'pacsEndpointSourcePublicId');pair(pacsEndpointSourceType,pacsEndpointSourcePublicId,'PACS endpoint');const bridgeSourceType=optional(raw.bridgeSourceType,'bridgeSourceType'),bridgeSourcePublicId=optional(raw.bridgeSourcePublicId,'bridgeSourcePublicId');pair(bridgeSourceType,bridgeSourcePublicId,'bridge source');const messageSourceType=optional(raw.messageSourceType,'messageSourceType'),messageSourcePublicId=optional(raw.messageSourcePublicId,'messageSourcePublicId');pair(messageSourceType,messageSourcePublicId,'message source');
  const storageProviderType=optional(raw.storageProviderType,'storageProviderType'),storageProviderPublicId=optional(raw.storageProviderPublicId,'storageProviderPublicId'),storageObjectKey=optional(raw.storageObjectKey,'storageObjectKey'),storageGeneration=optional(raw.storageGeneration,'storageGeneration');if([storageProviderType,storageProviderPublicId,storageObjectKey,storageGeneration].filter(v=>v!=null).length!==(storageProviderType?4:0))throw new TypeError('storage identity must be complete');const objectHash=raw.objectContentSha256==null?null:digest(raw.objectContentSha256,'objectContentSha256');
  const full={provenanceEventPublicId,acquisitionPublicId,studyPublicId,seriesPublicId,instancePublicId,eventType:raw.eventType,disposition:raw.disposition,eventVersion:positive(raw.eventVersion,'eventVersion'),modalitySourceType,modalitySourcePublicId,sourceAeTitle:optional(raw.sourceAeTitle,'sourceAeTitle'),calledAeTitle:optional(raw.calledAeTitle,'calledAeTitle'),pacsEndpointSourceType,pacsEndpointSourcePublicId,bridgeSourceType,bridgeSourcePublicId,messageSourceType,messageSourcePublicId,protocol:optional(raw.protocol,'protocol'),transferSyntaxUid:optional(raw.transferSyntaxUid,'transferSyntaxUid'),objectHash,storageProviderType,storageProviderPublicId,storageObjectKey,storageGeneration,reasonCode:exact(raw.reasonCode,'reasonCode'),sourceType,sourcePublicId,sourceTable,evidence,commandActor,occurredAtUtc,recordedAtUtc};
  const req=await request(full,businessDate);const replay=await readCanonicalCommandReplay<ImagingHierarchyCommandResult>(db,{tenantId,commandName:RECORD_PROVENANCE,idempotencyKey,request:req});if(replay)return replay;
  if(acquisitionPublicId)await acquisitionRow(db,tenantId,acquisitionPublicId);if(studyPublicId)await studyRow(db,tenantId,studyPublicId);if(seriesPublicId){const s=await seriesRow(db,tenantId,seriesPublicId);if(studyPublicId&&s.study_public_id!==studyPublicId)throw new Error('provenance series/study scope mismatch');}if(instancePublicId){const i=await db.prepare(`SELECT instance_public_id,object_content_sha256,study_public_id,series_public_id FROM canonical_imaging_instances WHERE tenant_id=? AND instance_public_id=? LIMIT 1`).bind(tenantId,instancePublicId).first<InstanceRow>();if(!i)throw new Error('provenance instance not found');if(studyPublicId&&i.study_public_id!==studyPublicId)throw new Error('provenance instance/study scope mismatch');if(seriesPublicId&&i.series_public_id!==seriesPublicId)throw new Error('provenance instance/series scope mismatch');if(objectHash&&i.object_content_sha256!==objectHash)throw new Error('provenance object content hash mismatch');}
  await requireMappingAvailable(db,{tenantId,entityType:'imaging_provenance',sourceType,sourcePublicId,canonicalPublicId:provenanceEventPublicId});const result:ImagingHierarchyCommandResult={kind:'provenance',publicId:provenanceEventPublicId,parentPublicId:instancePublicId??seriesPublicId??studyPublicId??acquisitionPublicId,disposition:raw.disposition};
  return runCanonicalBatch(db,{tenantId,commandName:RECORD_PROVENANCE,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,statements:[
    db.prepare(`INSERT INTO canonical_imaging_provenance_events (tenant_id,provenance_event_public_id,acquisition_public_id,study_public_id,series_public_id,instance_public_id,event_type,disposition,event_version,modality_source_type,modality_source_public_id,source_ae_title,called_ae_title,pacs_endpoint_source_type,pacs_endpoint_source_public_id,bridge_source_type,bridge_source_public_id,message_source_type,message_source_public_id,protocol,transfer_syntax_uid,object_content_sha256,storage_provider_type,storage_provider_public_id,storage_object_key,storage_generation,actor_user_public_id,actor_system_key,occurred_at_utc,recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(tenantId,provenanceEventPublicId,acquisitionPublicId,studyPublicId,seriesPublicId,instancePublicId,raw.eventType,raw.disposition,full.eventVersion,modalitySourceType,modalitySourcePublicId,full.sourceAeTitle,full.calledAeTitle,pacsEndpointSourceType,pacsEndpointSourcePublicId,bridgeSourceType,bridgeSourcePublicId,messageSourceType,messageSourcePublicId,full.protocol,full.transferSyntaxUid,objectHash,storageProviderType,storageProviderPublicId,storageObjectKey,storageGeneration,commandActor.actorUserPublicId,commandActor.actorSystemKey,occurredAtUtc,recordedAtUtc,full.reasonCode,evidence,recordedAtUtc),
    mappingStatement(db,{tenantId,entityType:'imaging_provenance',canonicalPublicId:provenanceEventPublicId,sourceType,sourcePublicId,sourceTable,evidenceSha256:evidence,occurredAtUtc})],result,event:{eventPublicId:await outboxId(tenantId,RECORD_PROVENANCE,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_provenance',aggregatePublicId:provenanceEventPublicId,eventType:'canonical.imaging-provenance.recorded',occurredAtUtc,businessDate,payload:result}});
}

function normalizeContent(raw:CanonicalImagingReportContent):CanonicalImagingReportContent{
  const findings=exact(raw.findings,'content.findings'),impression=exact(raw.impression,'content.impression');return {indication:optional(raw.indication,'content.indication'),technique:optional(raw.technique,'content.technique'),findings,impression,comparison:optional(raw.comparison,'content.comparison'),recommendations:optional(raw.recommendations,'content.recommendations')};
}
async function reportSetRow(db:CanonicalBatchDatabase,tenantId:string,reportSetPublicId:string):Promise<ReportSetRow>{const row=await db.prepare(`SELECT patient_link_public_id,encounter_public_id,request_public_id,service_public_id,acquisition_public_id,study_public_id,current_version_public_id,current_status,status_version FROM canonical_imaging_report_sets WHERE tenant_id=? AND report_set_public_id=? LIMIT 1`).bind(tenantId,reportSetPublicId).first<ReportSetRow>();if(!row)throw new Error('canonical imaging report set not found');return row;}
async function reportVersionRow(db:CanonicalBatchDatabase,tenantId:string,reportSetPublicId:string,versionPublicId:string):Promise<ReportVersionRow>{const row=await db.prepare(`SELECT version_public_id,version_number,version_status,content_json,content_sha256 FROM canonical_imaging_report_versions WHERE tenant_id=? AND report_set_public_id=? AND version_public_id=? LIMIT 1`).bind(tenantId,reportSetPublicId,versionPublicId).first<ReportVersionRow>();if(!row)throw new Error('canonical imaging report version not found');return row;}
function reportVersionStatement(db:CanonicalBatchDatabase,input:{tenantId:string;versionPublicId:string;reportSetPublicId:string;versionNumber:number;supersedes:string|null;kind:'draft'|'amendment'|'correction'|'retraction'|'entered_in_error';contentJson:string;contentHash:string;author:string;commandActor:Actor;occurredAtUtc:string;reason:string|null;evidence:string;}):CanonicalPreparedStatement{return db.prepare(`INSERT INTO canonical_imaging_report_versions (tenant_id,version_public_id,report_set_public_id,version_number,supersedes_version_public_id,version_kind,version_status,content_json,content_sha256,authoring_practitioner_public_id,actor_user_public_id,actor_system_key,authored_at_utc,reason_code,source_evidence_sha256,created_at_utc) VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?)`).bind(input.tenantId,input.versionPublicId,input.reportSetPublicId,input.versionNumber,input.supersedes,input.kind,input.contentJson,input.contentHash,input.author,input.commandActor.actorUserPublicId,input.commandActor.actorSystemKey,input.occurredAtUtc,input.reason,input.evidence,input.occurredAtUtc);}
function reportEventStatement(db:CanonicalBatchDatabase,input:{tenantId:string;eventPublicId:string;reportSetPublicId:string;versionPublicId:string;fromStatus:CanonicalImagingReportStatus|null;toStatus:CanonicalImagingReportStatus;eventVersion:number;eventType:string;practitioner:string|null;commandActor:Actor;signedHash:string|null;reason:string;occurredAtUtc:string;evidence:string;}):CanonicalPreparedStatement{return db.prepare(`INSERT INTO canonical_imaging_report_status_events (tenant_id,event_public_id,report_set_public_id,version_public_id,from_status,to_status,event_version,event_type,actor_practitioner_public_id,actor_user_public_id,actor_system_key,signed_content_sha256,reason_code,occurred_at_utc,source_evidence_sha256,created_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(input.tenantId,input.eventPublicId,input.reportSetPublicId,input.versionPublicId,input.fromStatus,input.toStatus,input.eventVersion,input.eventType,input.practitioner,input.commandActor.actorUserPublicId,input.commandActor.actorSystemKey,input.signedHash,input.reason,input.occurredAtUtc,input.evidence,input.occurredAtUtc);}

export async function createCanonicalImagingReportDraft(db:CanonicalBatchDatabase,raw:CreateCanonicalImagingReportDraftInput,execution:CanonicalCommandExecutionOptions={}):Promise<CanonicalCommandResult<ImagingReportCommandResult>>{
  const tenantId=exact(raw.tenantId,'tenantId'),idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey'),acquisitionPublicId=exact(raw.acquisitionPublicId,'acquisitionPublicId'),studyPublicId=exact(raw.studyPublicId,'studyPublicId'),reporter=exact(raw.reportingPractitionerPublicId,'reportingPractitionerPublicId'),occurredAtUtc=utc(raw.occurredAtUtc,'occurredAtUtc'),businessDate=exact(raw.businessDate,'businessDate'),commandActor=actor(raw);
  const sourceType=exact(raw.sourceType,'sourceType'),sourcePublicId=exact(raw.sourcePublicId,'sourcePublicId'),sourceTable=exact(raw.sourceTable,'sourceTable'),evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256');const reportSetPublicId=await publicId('imgreport',tenantId,sourceType,sourcePublicId,raw.reportSetPublicId,'reportSetPublicId'),versionPublicId=await publicId('imgrepver',tenantId,sourceType,`${sourcePublicId}:v1`,raw.versionPublicId,'versionPublicId');const content=normalizeContent(raw.content),contentJson=JSON.stringify(content),contentHash=await createRequestFingerprint({schemaVersion:1,reportSetPublicId,versionPublicId,versionNumber:1,content});
  const full={reportSetPublicId,versionPublicId,acquisitionPublicId,studyPublicId,reporter,reportNumberNamespace:exact(raw.reportNumberNamespace,'reportNumberNamespace'),reportNumberValue:exact(raw.reportNumberValue,'reportNumberValue'),content,sourceType,sourcePublicId,sourceTable,evidence,commandActor,occurredAtUtc};const req=await request(full,businessDate);const replay=await readCanonicalCommandReplay<ImagingReportCommandResult>(db,{tenantId,commandName:CREATE_REPORT,idempotencyKey,request:req});if(replay)return replay;
  const acq=await acquisitionRow(db,tenantId,acquisitionPublicId),study=await studyRow(db,tenantId,studyPublicId);if(study.acquisition_public_id!==acquisitionPublicId||study.patient_link_public_id!==acq.patient_link_public_id||study.encounter_public_id!==acq.encounter_public_id||study.request_public_id!==acq.request_public_id||study.service_public_id!==acq.service_public_id)throw new Error('imaging report acquisition/study scope mismatch');await requirePractitioner(db,tenantId,reporter);await requireMappingAvailable(db,{tenantId,entityType:'imaging_report_set',sourceType,sourcePublicId,canonicalPublicId:reportSetPublicId});const fingerprint=await createRequestFingerprint(full),initialEvent=await eventId(tenantId,CREATE_REPORT,idempotencyKey,'draft');const result:ImagingReportCommandResult={reportSetPublicId,versionPublicId,currentStatus:'draft',statusVersion:1,versionNumber:1};
  return runCanonicalBatch(db,{tenantId,commandName:CREATE_REPORT,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,statements:[
    db.prepare(`INSERT INTO canonical_imaging_report_sets (tenant_id,report_set_public_id,patient_link_public_id,encounter_public_id,request_public_id,service_public_id,acquisition_public_id,study_public_id,current_status,status_version,reporting_practitioner_public_id,report_number_namespace,report_number_value,actor_user_public_id,actor_system_key,idempotency_key,request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc) VALUES (?,?,?,?,?,?,?,?,'draft',1,?,?,?,?,?,?,?,?,?,?)`).bind(tenantId,reportSetPublicId,acq.patient_link_public_id,acq.encounter_public_id,acq.request_public_id,acq.service_public_id,acquisitionPublicId,studyPublicId,reporter,full.reportNumberNamespace,full.reportNumberValue,commandActor.actorUserPublicId,commandActor.actorSystemKey,idempotencyKey,fingerprint,evidence,occurredAtUtc,occurredAtUtc),
    reportVersionStatement(db,{tenantId,versionPublicId,reportSetPublicId,versionNumber:1,supersedes:null,kind:'draft',contentJson,contentHash,author:reporter,commandActor,occurredAtUtc,reason:null,evidence}),
    reportEventStatement(db,{tenantId,eventPublicId:initialEvent,reportSetPublicId,versionPublicId,fromStatus:null,toStatus:'draft',eventVersion:1,eventType:'draft_created',practitioner:reporter,commandActor,signedHash:null,reason:'draft_created',occurredAtUtc,evidence}),
    db.prepare(`UPDATE canonical_imaging_report_sets SET current_version_public_id=?,current_status_event_public_id=?,updated_at_utc=? WHERE tenant_id=? AND report_set_public_id=? AND current_version_public_id IS NULL`).bind(versionPublicId,initialEvent,occurredAtUtc,tenantId,reportSetPublicId),
    mappingStatement(db,{tenantId,entityType:'imaging_report_set',canonicalPublicId:reportSetPublicId,sourceType,sourcePublicId,sourceTable,evidenceSha256:evidence,occurredAtUtc})],result,event:{eventPublicId:await outboxId(tenantId,CREATE_REPORT,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_report',aggregatePublicId:reportSetPublicId,eventType:'canonical.imaging-report.draft-created',occurredAtUtc,businessDate,payload:result}});
}

async function replaceReport(db:CanonicalBatchDatabase,raw:ReplaceReportBase,config:{commandName:string;kind:'amendment'|'correction';eventType:'draft_replaced'|'corrected';reasonDefault:string;outboxType:string},execution:CanonicalCommandExecutionOptions):Promise<CanonicalCommandResult<ImagingReportCommandResult>>{
  const tenantId=exact(raw.tenantId,'tenantId'),idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey'),reportSetPublicId=exact(raw.reportSetPublicId,'reportSetPublicId'),expected=positive(raw.expectedStatusVersion,'expectedStatusVersion'),author=exact(raw.authoringPractitionerPublicId,'authoringPractitionerPublicId'),reason=exact(raw.reasonCode||config.reasonDefault,'reasonCode'),occurredAtUtc=utc(raw.occurredAtUtc,'occurredAtUtc'),businessDate=exact(raw.businessDate,'businessDate'),commandActor=actor(raw),evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256');const content=normalizeContent(raw.content);
  const versionPublicId=await publicId('imgrepver',tenantId,config.commandName,`${idempotencyKey}:${expected+1}`,raw.versionPublicId,'versionPublicId');const full={reportSetPublicId,expected,versionPublicId,author,reason,content,evidence,commandActor,occurredAtUtc};const req=await request(full,businessDate);const replay=await readCanonicalCommandReplay<ImagingReportCommandResult>(db,{tenantId,commandName:config.commandName,idempotencyKey,request:req});if(replay)return replay;const set=await reportSetRow(db,tenantId,reportSetPublicId);if(Number(set.status_version)!==expected||!set.current_version_public_id||['retracted','entered_in_error'].includes(set.current_status))throw new Error('canonical imaging report status version conflict');await requirePractitioner(db,tenantId,author);const previous=await reportVersionRow(db,tenantId,reportSetPublicId,set.current_version_public_id),nextNumber=Number(previous.version_number)+1,contentJson=JSON.stringify(content),contentHash=await createRequestFingerprint({schemaVersion:1,reportSetPublicId,versionPublicId,versionNumber:nextNumber,supersedes:previous.version_public_id,content}),nextStatusVersion=expected+1,lifecycle=await eventId(tenantId,config.commandName,idempotencyKey,String(nextStatusVersion));const result:ImagingReportCommandResult={reportSetPublicId,versionPublicId,currentStatus:'draft',statusVersion:nextStatusVersion,versionNumber:nextNumber};
  return runCanonicalBatch(db,{tenantId,commandName:config.commandName,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,statements:[reportVersionStatement(db,{tenantId,versionPublicId,reportSetPublicId,versionNumber:nextNumber,supersedes:previous.version_public_id,kind:config.kind,contentJson,contentHash,author,commandActor,occurredAtUtc,reason,evidence}),reportEventStatement(db,{tenantId,eventPublicId:lifecycle,reportSetPublicId,versionPublicId,fromStatus:set.current_status,toStatus:'draft',eventVersion:nextStatusVersion,eventType:config.eventType,practitioner:author,commandActor,signedHash:null,reason,occurredAtUtc,evidence}),db.prepare(`UPDATE canonical_imaging_report_sets SET current_version_public_id=?,current_status='draft',status_version=?,current_status_event_public_id=?,reporting_practitioner_public_id=?,updated_at_utc=? WHERE tenant_id=? AND report_set_public_id=? AND status_version=?`).bind(versionPublicId,nextStatusVersion,lifecycle,author,occurredAtUtc,tenantId,reportSetPublicId,expected)],result,event:{eventPublicId:await outboxId(tenantId,config.commandName,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_report',aggregatePublicId:reportSetPublicId,eventType:config.outboxType,occurredAtUtc,businessDate,payload:result}});
}
export function replaceCanonicalImagingReportDraft(db:CanonicalBatchDatabase,input:ReplaceCanonicalImagingReportDraftInput,execution:CanonicalCommandExecutionOptions={}){return replaceReport(db,input,{commandName:REPLACE_REPORT,kind:'amendment',eventType:'draft_replaced',reasonDefault:'draft_replaced',outboxType:'canonical.imaging-report.draft-replaced'},execution);}
export function correctCanonicalImagingReportVersion(db:CanonicalBatchDatabase,input:CorrectCanonicalImagingReportVersionInput,execution:CanonicalCommandExecutionOptions={}){return replaceReport(db,input,{commandName:CORRECT_REPORT,kind:'correction',eventType:'corrected',reasonDefault:'corrected',outboxType:'canonical.imaging-report.corrected'},execution);}

export async function verifyCanonicalImagingReportVersion(db:CanonicalBatchDatabase,raw:VerifyCanonicalImagingReportVersionInput,execution:CanonicalCommandExecutionOptions={}):Promise<CanonicalCommandResult<ImagingReportCommandResult>>{
  const tenantId=exact(raw.tenantId,'tenantId'),idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey'),reportSetPublicId=exact(raw.reportSetPublicId,'reportSetPublicId'),versionPublicId=exact(raw.versionPublicId,'versionPublicId'),expected=positive(raw.expectedStatusVersion,'expectedStatusVersion'),verifier=exact(raw.verifyingPractitionerPublicId,'verifyingPractitionerPublicId'),signedHash=digest(raw.signedContentSha256,'signedContentSha256'),reason=exact(raw.reasonCode,'reasonCode'),evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256'),occurredAtUtc=utc(raw.occurredAtUtc,'occurredAtUtc'),businessDate=exact(raw.businessDate,'businessDate'),commandActor=actor(raw);const full={reportSetPublicId,versionPublicId,expected,verifier,signedHash,reason,evidence,commandActor,occurredAtUtc};const req=await request(full,businessDate);const replay=await readCanonicalCommandReplay<ImagingReportCommandResult>(db,{tenantId,commandName:VERIFY_REPORT,idempotencyKey,request:req});if(replay)return replay;const set=await reportSetRow(db,tenantId,reportSetPublicId),version=await reportVersionRow(db,tenantId,reportSetPublicId,versionPublicId);if(set.current_status!=='draft'||set.current_version_public_id!==versionPublicId||Number(set.status_version)!==expected||version.version_status!=='draft')throw new Error('canonical imaging report is not the current draft');if(version.content_sha256!==signedHash)throw new Error('signed content hash does not match report content hash');await requirePractitioner(db,tenantId,verifier);const next=expected+1,lifecycle=await eventId(tenantId,VERIFY_REPORT,idempotencyKey,String(next)),result:ImagingReportCommandResult={reportSetPublicId,versionPublicId,currentStatus:'verified',statusVersion:next,versionNumber:Number(version.version_number)};
  return runCanonicalBatch(db,{tenantId,commandName:VERIFY_REPORT,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,statements:[reportEventStatement(db,{tenantId,eventPublicId:lifecycle,reportSetPublicId,versionPublicId,fromStatus:'draft',toStatus:'verified',eventVersion:next,eventType:'verified',practitioner:verifier,commandActor,signedHash,reason,occurredAtUtc,evidence}),db.prepare(`UPDATE canonical_imaging_report_versions SET version_status='verified',signed_content_sha256=?,verifying_practitioner_public_id=?,verified_at_utc=? WHERE tenant_id=? AND report_set_public_id=? AND version_public_id=? AND version_status='draft'`).bind(signedHash,verifier,occurredAtUtc,tenantId,reportSetPublicId,versionPublicId),db.prepare(`UPDATE canonical_imaging_report_sets SET current_status='verified',status_version=?,current_status_event_public_id=?,updated_at_utc=? WHERE tenant_id=? AND report_set_public_id=? AND status_version=?`).bind(next,lifecycle,occurredAtUtc,tenantId,reportSetPublicId,expected)],result,event:{eventPublicId:await outboxId(tenantId,VERIFY_REPORT,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_report',aggregatePublicId:reportSetPublicId,eventType:'canonical.imaging-report.verified',occurredAtUtc,businessDate,payload:result}});
}

export async function finalizeAndPublishCanonicalImagingReportVersion(db:CanonicalBatchDatabase,raw:FinalizeAndPublishCanonicalImagingReportVersionInput,execution:CanonicalCommandExecutionOptions={}):Promise<CanonicalCommandResult<ImagingReportCommandResult>>{
  const tenantId=exact(raw.tenantId,'tenantId'),idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey'),reportSetPublicId=exact(raw.reportSetPublicId,'reportSetPublicId'),versionPublicId=exact(raw.versionPublicId,'versionPublicId'),expected=positive(raw.expectedStatusVersion,'expectedStatusVersion'),finaliser=exact(raw.finalisingPractitionerPublicId,'finalisingPractitionerPublicId'),signedHash=digest(raw.signedContentSha256,'signedContentSha256'),finalReason=exact(raw.finalisationReasonCode,'finalisationReasonCode'),publishReason=exact(raw.publicationReasonCode,'publicationReasonCode'),evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256'),finalisedAtUtc=utc(raw.finalisedAtUtc,'finalisedAtUtc'),publishedAtUtc=utc(raw.publishedAtUtc,'publishedAtUtc'),businessDate=exact(raw.businessDate,'businessDate'),commandActor=actor(raw);if(publishedAtUtc<finalisedAtUtc)throw new RangeError('publishedAtUtc cannot precede finalisedAtUtc');const full={reportSetPublicId,versionPublicId,expected,finaliser,signedHash,finalReason,publishReason,evidence,commandActor,finalisedAtUtc,publishedAtUtc};const req=await request(full,businessDate);const replay=await readCanonicalCommandReplay<ImagingReportCommandResult>(db,{tenantId,commandName:FINAL_PUBLISH_REPORT,idempotencyKey,request:req});if(replay)return replay;const set=await reportSetRow(db,tenantId,reportSetPublicId),version=await reportVersionRow(db,tenantId,reportSetPublicId,versionPublicId);if(set.current_status!=='verified'||set.current_version_public_id!==versionPublicId||Number(set.status_version)!==expected||version.version_status!=='verified')throw new Error('canonical imaging report is not the current verified version');if(version.content_sha256!==signedHash)throw new Error('signed content hash does not match report content hash');await requirePractitioner(db,tenantId,finaliser);const finalVersion=expected+1,publishVersion=expected+2,finalEvent=await eventId(tenantId,FINAL_PUBLISH_REPORT,idempotencyKey,'final'),publishEvent=await eventId(tenantId,FINAL_PUBLISH_REPORT,idempotencyKey,'published'),result:ImagingReportCommandResult={reportSetPublicId,versionPublicId,currentStatus:'published',statusVersion:publishVersion,versionNumber:Number(version.version_number)};
  return runCanonicalBatch(db,{tenantId,commandName:FINAL_PUBLISH_REPORT,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,statements:[reportEventStatement(db,{tenantId,eventPublicId:finalEvent,reportSetPublicId,versionPublicId,fromStatus:'verified',toStatus:'final',eventVersion:finalVersion,eventType:'finalised',practitioner:finaliser,commandActor,signedHash,reason:finalReason,occurredAtUtc:finalisedAtUtc,evidence}),db.prepare(`UPDATE canonical_imaging_report_versions SET version_status='final',finalising_practitioner_public_id=?,finalised_at_utc=? WHERE tenant_id=? AND report_set_public_id=? AND version_public_id=? AND version_status='verified'`).bind(finaliser,finalisedAtUtc,tenantId,reportSetPublicId,versionPublicId),db.prepare(`UPDATE canonical_imaging_report_sets SET current_status='final',status_version=?,current_status_event_public_id=?,updated_at_utc=? WHERE tenant_id=? AND report_set_public_id=? AND status_version=?`).bind(finalVersion,finalEvent,finalisedAtUtc,tenantId,reportSetPublicId,expected),reportEventStatement(db,{tenantId,eventPublicId:publishEvent,reportSetPublicId,versionPublicId,fromStatus:'final',toStatus:'published',eventVersion:publishVersion,eventType:'published',practitioner:finaliser,commandActor,signedHash,reason:publishReason,occurredAtUtc:publishedAtUtc,evidence}),db.prepare(`UPDATE canonical_imaging_report_versions SET version_status='published',published_at_utc=? WHERE tenant_id=? AND report_set_public_id=? AND version_public_id=? AND version_status='final'`).bind(publishedAtUtc,tenantId,reportSetPublicId,versionPublicId),db.prepare(`UPDATE canonical_imaging_report_sets SET current_status='published',status_version=?,current_status_event_public_id=?,updated_at_utc=? WHERE tenant_id=? AND report_set_public_id=? AND status_version=?`).bind(publishVersion,publishEvent,publishedAtUtc,tenantId,reportSetPublicId,finalVersion)],result,event:{eventPublicId:await outboxId(tenantId,FINAL_PUBLISH_REPORT,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_report',aggregatePublicId:reportSetPublicId,eventType:'canonical.imaging-report.published',occurredAtUtc:publishedAtUtc,businessDate,payload:result}});
}

async function terminalReport(db:CanonicalBatchDatabase,raw:TerminalReportInput,config:{commandName:string;kind:'retraction'|'entered_in_error';status:'retracted'|'entered_in_error';eventType:'retracted'|'entered_in_error';outboxType:string},execution:CanonicalCommandExecutionOptions):Promise<CanonicalCommandResult<ImagingReportCommandResult>>{
  const tenantId=exact(raw.tenantId,'tenantId'),idempotencyKey=exact(raw.idempotencyKey,'idempotencyKey'),reportSetPublicId=exact(raw.reportSetPublicId,'reportSetPublicId'),expected=positive(raw.expectedStatusVersion,'expectedStatusVersion'),author=exact(raw.authoringPractitionerPublicId,'authoringPractitionerPublicId'),reason=exact(raw.reasonCode,'reasonCode'),evidence=digest(raw.sourceEvidenceSha256,'sourceEvidenceSha256'),occurredAtUtc=utc(raw.occurredAtUtc,'occurredAtUtc'),businessDate=exact(raw.businessDate,'businessDate'),commandActor=actor(raw);const versionPublicId=await publicId('imgrepver',tenantId,config.commandName,`${idempotencyKey}:${expected+1}`,raw.versionPublicId,'versionPublicId');const full={reportSetPublicId,expected,versionPublicId,author,reason,evidence,commandActor,occurredAtUtc,status:config.status};const req=await request(full,businessDate);const replay=await readCanonicalCommandReplay<ImagingReportCommandResult>(db,{tenantId,commandName:config.commandName,idempotencyKey,request:req});if(replay)return replay;const set=await reportSetRow(db,tenantId,reportSetPublicId);if(Number(set.status_version)!==expected||!set.current_version_public_id||['retracted','entered_in_error'].includes(set.current_status))throw new Error('canonical imaging report status version conflict');await requirePractitioner(db,tenantId,author);const previous=await reportVersionRow(db,tenantId,reportSetPublicId,set.current_version_public_id),nextNumber=Number(previous.version_number)+1,nextStatusVersion=expected+1,lifecycle=await eventId(tenantId,config.commandName,idempotencyKey,String(nextStatusVersion)),contentHash=await createRequestFingerprint({schemaVersion:1,reportSetPublicId,versionPublicId,versionNumber:nextNumber,supersedes:previous.version_public_id,kind:config.kind,reason,contentJson:previous.content_json}),result:ImagingReportCommandResult={reportSetPublicId,versionPublicId,currentStatus:config.status,statusVersion:nextStatusVersion,versionNumber:nextNumber};
  return runCanonicalBatch(db,{tenantId,commandName:config.commandName,idempotencyKey,request:req,authoritativeStatements:execution.authoritativeStatements,statements:[reportVersionStatement(db,{tenantId,versionPublicId,reportSetPublicId,versionNumber:nextNumber,supersedes:previous.version_public_id,kind:config.kind,contentJson:previous.content_json,contentHash,author,commandActor,occurredAtUtc,reason,evidence}),reportEventStatement(db,{tenantId,eventPublicId:lifecycle,reportSetPublicId,versionPublicId,fromStatus:set.current_status,toStatus:config.status,eventVersion:nextStatusVersion,eventType:config.eventType,practitioner:author,commandActor,signedHash:null,reason,occurredAtUtc,evidence}),db.prepare(`UPDATE canonical_imaging_report_versions SET version_status=?,${config.status==='retracted'?'retracted_at_utc':'reason_code'}=? WHERE tenant_id=? AND report_set_public_id=? AND version_public_id=? AND version_status='draft'`).bind(config.status,config.status==='retracted'?occurredAtUtc:reason,tenantId,reportSetPublicId,versionPublicId),db.prepare(`UPDATE canonical_imaging_report_sets SET current_version_public_id=?,current_status=?,status_version=?,current_status_event_public_id=?,updated_at_utc=? WHERE tenant_id=? AND report_set_public_id=? AND status_version=?`).bind(versionPublicId,config.status,nextStatusVersion,lifecycle,occurredAtUtc,tenantId,reportSetPublicId,expected)],result,event:{eventPublicId:await outboxId(tenantId,config.commandName,idempotencyKey,raw.outboxEventPublicId),aggregateType:'canonical_imaging_report',aggregatePublicId:reportSetPublicId,eventType:config.outboxType,occurredAtUtc,businessDate,payload:result}});
}
export function retractCanonicalImagingReportVersion(db:CanonicalBatchDatabase,input:RetractCanonicalImagingReportVersionInput,execution:CanonicalCommandExecutionOptions={}){return terminalReport(db,input,{commandName:RETRACT_REPORT,kind:'retraction',status:'retracted',eventType:'retracted',outboxType:'canonical.imaging-report.retracted'},execution);}
export function enterCanonicalImagingReportInError(db:CanonicalBatchDatabase,input:EnterCanonicalImagingReportInErrorInput,execution:CanonicalCommandExecutionOptions={}){return terminalReport(db,input,{commandName:ERROR_REPORT,kind:'entered_in_error',status:'entered_in_error',eventType:'entered_in_error',outboxType:'canonical.imaging-report.entered-in-error'},execution);}
