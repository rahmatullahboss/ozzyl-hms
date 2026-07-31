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

export type CanonicalMedicationAdministrationOutcome =
  | 'given'
  | 'partially_given'
  | 'withheld'
  | 'refused'
  | 'omitted'
  | 'not_available'
  | 'cancelled';

export type CanonicalMedicationReconciliationType = 'admission' | 'transfer' | 'discharge';
export type CanonicalMedicationReconciliationStatus = 'draft' | 'final' | 'cancelled' | 'entered_in_error';
export type CanonicalMedicationReconciliationItemSourceKind = 'home' | 'inpatient' | 'new' | 'unknown';
export type CanonicalMedicationReconciliationDecision = 'continue' | 'modify' | 'discontinue' | 'add';

interface CommandActorInput {
  actorUserPublicId?: string | null;
  actorSystemKey?: string | null;
}

interface SourceInput {
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
}

interface AdministrationCommandBase extends CommandActorInput {
  tenantId: string;
  idempotencyKey: string;
  eventPublicId?: string;
  commandOccurredAtUtc: string;
  businessDate: string;
}

interface ReconciliationCommandBase extends CommandActorInput {
  tenantId: string;
  idempotencyKey: string;
  eventPublicId?: string;
  occurredAtUtc: string;
  businessDate: string;
}

interface AdministrationClinicalInput {
  administeringPractitionerPublicId: string;
  scheduledAtUtc?: string | null;
  occurredAtUtc: string;
  recordedAtUtc: string;
  lateEntryReasonCode?: string | null;
  outcomeCode: CanonicalMedicationAdministrationOutcome;
  administeredDoseValueDecimal?: string | null;
  administeredDoseUnitCode?: string | null;
  routeCode?: string | null;
  siteCode?: string | null;
  methodCode?: string | null;
  reasonCode?: string | null;
  dispenseSourceType?: string | null;
  dispenseSourcePublicId?: string | null;
  lotSourceType?: string | null;
  lotSourcePublicId?: string | null;
  barcodeSourceType?: string | null;
  barcodeSourcePublicId?: string | null;
  deviceSourceType?: string | null;
  deviceSourcePublicId?: string | null;
}

export interface RecordCanonicalMedicationAdministrationEventInput
  extends AdministrationCommandBase,
    AdministrationClinicalInput,
    SourceInput {
  administrationEventPublicId?: string;
  medicationOrderPublicId: string;
  medicationOrderStatusVersion: number;
  patientLinkPublicId: string;
  encounterPublicId: string;
}

export interface CorrectCanonicalMedicationAdministrationEventInput
  extends AdministrationCommandBase,
    AdministrationClinicalInput,
    SourceInput {
  administrationEventPublicId: string;
  replacementAdministrationEventPublicId?: string;
}

export interface EnterCanonicalMedicationAdministrationInErrorInput
  extends ReconciliationCommandBase,
    SourceInput {
  administrationEventPublicId: string;
  errorEventPublicId?: string;
  administeringPractitionerPublicId: string;
  reasonCode: string;
}

export interface CanonicalMedicationReconciliationItemInput {
  itemPublicId?: string;
  sourceKind: CanonicalMedicationReconciliationItemSourceKind;
  decisionCode: CanonicalMedicationReconciliationDecision;
  prescriptionPublicId?: string | null;
  prescriptionVersionPublicId?: string | null;
  medicationOrderPublicId?: string | null;
  medicationDescriptionSnapshot: string;
  priorDoseSnapshot?: string | null;
  priorRouteSnapshot?: string | null;
  priorFrequencySnapshot?: string | null;
  proposedDoseSnapshot?: string | null;
  proposedRouteSnapshot?: string | null;
  proposedFrequencySnapshot?: string | null;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface CreateCanonicalMedicationReconciliationDraftInput
  extends ReconciliationCommandBase,
    SourceInput {
  reconciliationPublicId?: string;
  versionPublicId?: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  reconciliationType: CanonicalMedicationReconciliationType;
  creatingPractitionerPublicId: string;
  items: CanonicalMedicationReconciliationItemInput[];
  sourceSummarySha256: string;
}

export interface ReplaceCanonicalMedicationReconciliationDraftInput extends ReconciliationCommandBase {
  reconciliationPublicId: string;
  expectedStatusVersion: number;
  versionPublicId?: string;
  authoringPractitionerPublicId: string;
  items: CanonicalMedicationReconciliationItemInput[];
  sourceSummarySha256: string;
  sourceEvidenceSha256: string;
}

export interface FinalizeCanonicalMedicationReconciliationInput extends ReconciliationCommandBase {
  reconciliationPublicId: string;
  expectedStatusVersion: number;
  versionPublicId: string;
  finalizingPractitionerPublicId: string;
  signedContentSha256: string;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface CancelCanonicalMedicationReconciliationInput extends ReconciliationCommandBase {
  reconciliationPublicId: string;
  expectedStatusVersion: number;
  versionPublicId: string;
  cancellingPractitionerPublicId: string;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface CanonicalMedicationAdministrationCommandResult {
  administrationEventPublicId: string;
  eventKind: 'administration' | 'correction' | 'entered_in_error';
  outcomeCode: CanonicalMedicationAdministrationOutcome | null;
  medicationOrderStatusVersion?: number;
  supersedesAdministrationEventPublicId?: string;
}

export interface CanonicalMedicationReconciliationCommandResult {
  reconciliationPublicId: string;
  versionPublicId: string;
  currentStatus: CanonicalMedicationReconciliationStatus;
  statusVersion: number;
  versionNumber: number;
  itemCount: number;
}

interface NormalizedActor {
  actorUserPublicId: string | null;
  actorSystemKey: string | null;
}

interface MedicationOrderRow {
  patient_link_public_id: string;
  encounter_public_id: string;
  current_status: string;
  status_version: number;
}

interface AdministrationRow {
  medication_order_public_id: string;
  medication_order_status_version: number;
  patient_link_public_id: string;
  encounter_public_id: string;
  outcome_code: CanonicalMedicationAdministrationOutcome | null;
}

interface ReconciliationRow {
  patient_link_public_id: string;
  encounter_public_id: string;
  reconciliation_type: CanonicalMedicationReconciliationType;
  current_version_public_id: string | null;
  current_status: CanonicalMedicationReconciliationStatus;
  status_version: number;
}

interface ReconciliationVersionRow {
  version_number: number;
  version_status: CanonicalMedicationReconciliationStatus;
  content_sha256: string;
}

interface CountRow { count: number }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }

interface NormalizedAdministrationClinical {
  administeringPractitionerPublicId: string;
  scheduledAtUtc: string | null;
  occurredAtUtc: string;
  recordedAtUtc: string;
  lateEntryReasonCode: string | null;
  outcomeCode: CanonicalMedicationAdministrationOutcome;
  administeredDoseValueDecimal: string | null;
  administeredDoseUnitCode: string | null;
  routeCode: string | null;
  siteCode: string | null;
  methodCode: string | null;
  reasonCode: string | null;
  dispenseSourceType: string | null;
  dispenseSourcePublicId: string | null;
  lotSourceType: string | null;
  lotSourcePublicId: string | null;
  barcodeSourceType: string | null;
  barcodeSourcePublicId: string | null;
  deviceSourceType: string | null;
  deviceSourcePublicId: string | null;
}

interface NormalizedReconciliationItem {
  itemPublicId: string;
  itemSequence: number;
  sourceKind: CanonicalMedicationReconciliationItemSourceKind;
  decisionCode: CanonicalMedicationReconciliationDecision;
  prescriptionPublicId: string | null;
  prescriptionVersionPublicId: string | null;
  medicationOrderPublicId: string | null;
  medicationDescriptionSnapshot: string;
  priorDoseSnapshot: string | null;
  priorRouteSnapshot: string | null;
  priorFrequencySnapshot: string | null;
  proposedDoseSnapshot: string | null;
  proposedRouteSnapshot: string | null;
  proposedFrequencySnapshot: string | null;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

const RECORD_ADMIN = 'recordCanonicalMedicationAdministrationEvent';
const CORRECT_ADMIN = 'correctCanonicalMedicationAdministrationEvent';
const ERROR_ADMIN = 'enterCanonicalMedicationAdministrationInError';
const CREATE_RECON = 'createCanonicalMedicationReconciliationDraft';
const REPLACE_RECON = 'replaceCanonicalMedicationReconciliationDraft';
const FINALIZE_RECON = 'finalizeCanonicalMedicationReconciliation';
const CANCEL_RECON = 'cancelCanonicalMedicationReconciliation';

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

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function normalizeActor(raw: CommandActorInput): NormalizedActor {
  const actorUserPublicId = optionalExact(raw.actorUserPublicId, 'actorUserPublicId');
  const actorSystemKey = optionalExact(raw.actorSystemKey, 'actorSystemKey');
  if (actorUserPublicId == null && actorSystemKey == null) {
    throw new TypeError('actorUserPublicId or actorSystemKey is required');
  }
  return { actorUserPublicId, actorSystemKey };
}

function canonicalDecimal(raw: string | null | undefined, label: string): string | null {
  if (raw == null) return null;
  const value = exact(raw, label);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new TypeError(`${label} must be a positive plain decimal string`);
  }
  const [integer, fraction = ''] = value.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const normalized = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
  if (/^0(?:\.0*)?$/.test(normalized)) throw new RangeError(`${label} must be greater than zero`);
  return normalized;
}

function validatePaired(left: string | null, right: string | null, label: string): void {
  if ((left == null) !== (right == null)) throw new TypeError(`${label} source type and public ID must be provided together`);
}

function normalizeAdministrationClinical(raw: AdministrationClinicalInput): NormalizedAdministrationClinical {
  const outcomeCode = raw.outcomeCode;
  const administeredDoseValueDecimal = canonicalDecimal(
    raw.administeredDoseValueDecimal,
    'administeredDoseValueDecimal',
  );
  const administeredDoseUnitCode = optionalExact(raw.administeredDoseUnitCode, 'administeredDoseUnitCode');
  if ((administeredDoseValueDecimal == null) !== (administeredDoseUnitCode == null)) {
    throw new TypeError('administered dose value and unit must be provided together');
  }
  const routeCode = optionalExact(raw.routeCode, 'routeCode');
  const reasonCode = optionalExact(raw.reasonCode, 'reasonCode');
  if (outcomeCode === 'given' || outcomeCode === 'partially_given') {
    if (administeredDoseValueDecimal == null || administeredDoseUnitCode == null || routeCode == null) {
      throw new TypeError(`${outcomeCode} requires administered dose, unit, and route`);
    }
  } else {
    if (reasonCode == null) throw new TypeError(`${outcomeCode} requires a reason code`);
    if (administeredDoseValueDecimal != null || administeredDoseUnitCode != null || routeCode != null) {
      throw new TypeError(`${outcomeCode} cannot claim administered dose or route`);
    }
  }
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const recordedAtUtc = utc(raw.recordedAtUtc, 'recordedAtUtc');
  const lateEntryReasonCode = optionalExact(raw.lateEntryReasonCode, 'lateEntryReasonCode');
  if (recordedAtUtc < occurredAtUtc && lateEntryReasonCode == null) {
    throw new RangeError('recordedAtUtc cannot precede occurredAtUtc without lateEntryReasonCode');
  }
  const dispenseSourceType = optionalExact(raw.dispenseSourceType, 'dispenseSourceType');
  const dispenseSourcePublicId = optionalExact(raw.dispenseSourcePublicId, 'dispenseSourcePublicId');
  const lotSourceType = optionalExact(raw.lotSourceType, 'lotSourceType');
  const lotSourcePublicId = optionalExact(raw.lotSourcePublicId, 'lotSourcePublicId');
  const barcodeSourceType = optionalExact(raw.barcodeSourceType, 'barcodeSourceType');
  const barcodeSourcePublicId = optionalExact(raw.barcodeSourcePublicId, 'barcodeSourcePublicId');
  const deviceSourceType = optionalExact(raw.deviceSourceType, 'deviceSourceType');
  const deviceSourcePublicId = optionalExact(raw.deviceSourcePublicId, 'deviceSourcePublicId');
  validatePaired(dispenseSourceType, dispenseSourcePublicId, 'dispense');
  validatePaired(lotSourceType, lotSourcePublicId, 'lot');
  validatePaired(barcodeSourceType, barcodeSourcePublicId, 'barcode');
  validatePaired(deviceSourceType, deviceSourcePublicId, 'device');
  return {
    administeringPractitionerPublicId: exact(
      raw.administeringPractitionerPublicId,
      'administeringPractitionerPublicId',
    ),
    scheduledAtUtc: raw.scheduledAtUtc == null ? null : utc(raw.scheduledAtUtc, 'scheduledAtUtc'),
    occurredAtUtc,
    recordedAtUtc,
    lateEntryReasonCode,
    outcomeCode,
    administeredDoseValueDecimal,
    administeredDoseUnitCode,
    routeCode,
    siteCode: optionalExact(raw.siteCode, 'siteCode'),
    methodCode: optionalExact(raw.methodCode, 'methodCode'),
    reasonCode,
    dispenseSourceType,
    dispenseSourcePublicId,
    lotSourceType,
    lotSourcePublicId,
    barcodeSourceType,
    barcodeSourcePublicId,
    deviceSourceType,
    deviceSourcePublicId,
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
  return deterministicId('evt', tenantId, commandName, idempotencyKey, supplied, 'eventPublicId');
}

async function lifecycleEventId(
  tenantId: string,
  commandName: string,
  idempotencyKey: string,
  suffix: string,
): Promise<string> {
  return createDeterministicSourceId('medevt', tenantId, commandName, `${idempotencyKey}:${suffix}`);
}

async function phiMinimisedCommandRequest(
  fullOperation: unknown,
  businessDate: string,
): Promise<{ schemaVersion: 1; operationFingerprintSha256: string; businessDate: string }> {
  return {
    schemaVersion: 1,
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

async function requirePatientEncounterScope(
  db: CanonicalBatchDatabase,
  tenantId: string,
  patientLinkPublicId: string,
  encounterPublicId: string,
): Promise<void> {
  const patient = await db.prepare(`
    SELECT link_status,effective_to_utc FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(tenantId, patientLinkPublicId).first<{ link_status: string; effective_to_utc: string | null }>();
  if (!patient || ['rejected', 'retired'].includes(patient.link_status) || patient.effective_to_utc != null) {
    throw new Error('active patient link is required');
  }
  const encounter = await db.prepare(`
    SELECT patient_link_public_id,status FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(tenantId, encounterPublicId).first<{ patient_link_public_id: string | null; status: string }>();
  if (!encounter || encounter.patient_link_public_id !== patientLinkPublicId) {
    throw new Error('encounter patient scope mismatch');
  }
  if (encounter.status === 'entered_in_error') throw new Error('valid encounter is required');
}

async function requireMedicationOrder(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    medicationOrderPublicId: string;
    medicationOrderStatusVersion: number;
    patientLinkPublicId: string;
    encounterPublicId: string;
  },
): Promise<MedicationOrderRow> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,encounter_public_id,current_status,status_version
    FROM canonical_medication_orders
    WHERE tenant_id=? AND medication_order_public_id=? LIMIT 1
  `).bind(input.tenantId, input.medicationOrderPublicId).first<MedicationOrderRow>();
  if (!row) throw new Error('medication order not found');
  if (row.patient_link_public_id !== input.patientLinkPublicId || row.encounter_public_id !== input.encounterPublicId) {
    throw new Error('medication order scope mismatch');
  }
  if (Number(row.status_version) !== input.medicationOrderStatusVersion) {
    throw new Error('medication order status version conflict');
  }
  if (row.current_status !== 'active') throw new Error('medication administration requires an active medication order');
  const event = await db.prepare(`
    SELECT to_status FROM canonical_medication_order_status_events
    WHERE tenant_id=? AND medication_order_public_id=? AND event_version=? LIMIT 1
  `).bind(
    input.tenantId,
    input.medicationOrderPublicId,
    input.medicationOrderStatusVersion,
  ).first<{ to_status: string }>();
  if (!event || event.to_status !== row.current_status) throw new Error('medication order status-version evidence is missing');
  return row;
}

async function requireAdministrationEvent(
  db: CanonicalBatchDatabase,
  tenantId: string,
  administrationEventPublicId: string,
): Promise<AdministrationRow> {
  const row = await db.prepare(`
    SELECT medication_order_public_id,medication_order_status_version,
           patient_link_public_id,encounter_public_id,outcome_code
    FROM canonical_medication_administration_events
    WHERE tenant_id=? AND administration_event_public_id=? LIMIT 1
  `).bind(tenantId, administrationEventPublicId).first<AdministrationRow>();
  if (!row) throw new Error('canonical medication administration event not found');
  const replacement = await db.prepare(`
    SELECT 1 AS present FROM canonical_medication_administration_events
    WHERE tenant_id=? AND supersedes_administration_event_public_id=? LIMIT 1
  `).bind(tenantId, administrationEventPublicId).first();
  if (replacement) throw new Error('canonical medication administration event already has a replacement');
  return row;
}

async function requireSourceMappingAvailable(
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

function administrationInsertStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    administrationEventPublicId: string;
    eventKind: 'administration' | 'correction' | 'entered_in_error';
    medicationOrderPublicId: string;
    medicationOrderStatusVersion: number;
    patientLinkPublicId: string;
    encounterPublicId: string;
    clinical: NormalizedAdministrationClinical | null;
    administeringPractitionerPublicId: string;
    actor: NormalizedActor;
    commandOccurredAtUtc: string;
    reasonCode: string | null;
    supersedesAdministrationEventPublicId: string | null;
    idempotencyKey: string;
    requestFingerprintSha256: string;
    sourceEvidenceSha256: string;
  },
): CanonicalPreparedStatement {
  const clinical = input.clinical;
  return db.prepare(`
    INSERT INTO canonical_medication_administration_events (
      tenant_id,administration_event_public_id,event_kind,medication_order_public_id,
      medication_order_status_version,patient_link_public_id,encounter_public_id,
      administering_practitioner_public_id,actor_user_public_id,actor_system_key,
      scheduled_at_utc,occurred_at_utc,recorded_at_utc,late_entry_reason_code,
      outcome_code,administered_dose_value_decimal,administered_dose_unit_code,
      route_code,site_code,method_code,reason_code,dispense_source_type,
      dispense_source_public_id,lot_source_type,lot_source_public_id,
      barcode_source_type,barcode_source_public_id,device_source_type,
      device_source_public_id,supersedes_administration_event_public_id,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.administrationEventPublicId,
    input.eventKind,
    input.medicationOrderPublicId,
    input.medicationOrderStatusVersion,
    input.patientLinkPublicId,
    input.encounterPublicId,
    input.administeringPractitionerPublicId,
    input.actor.actorUserPublicId,
    input.actor.actorSystemKey,
    clinical?.scheduledAtUtc ?? null,
    clinical?.occurredAtUtc ?? input.commandOccurredAtUtc,
    clinical?.recordedAtUtc ?? input.commandOccurredAtUtc,
    clinical?.lateEntryReasonCode ?? null,
    clinical?.outcomeCode ?? null,
    clinical?.administeredDoseValueDecimal ?? null,
    clinical?.administeredDoseUnitCode ?? null,
    clinical?.routeCode ?? null,
    clinical?.siteCode ?? null,
    clinical?.methodCode ?? null,
    input.reasonCode ?? clinical?.reasonCode ?? null,
    clinical?.dispenseSourceType ?? null,
    clinical?.dispenseSourcePublicId ?? null,
    clinical?.lotSourceType ?? null,
    clinical?.lotSourcePublicId ?? null,
    clinical?.barcodeSourceType ?? null,
    clinical?.barcodeSourcePublicId ?? null,
    clinical?.deviceSourceType ?? null,
    clinical?.deviceSourcePublicId ?? null,
    input.supersedesAdministrationEventPublicId,
    input.idempotencyKey,
    input.requestFingerprintSha256,
    input.sourceEvidenceSha256,
    input.commandOccurredAtUtc,
  );
}

export async function recordCanonicalMedicationAdministrationEvent(
  db: CanonicalBatchDatabase,
  raw: RecordCanonicalMedicationAdministrationEventInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalMedicationAdministrationCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const commandOccurredAtUtc = utc(raw.commandOccurredAtUtc, 'commandOccurredAtUtc');
  const actor = normalizeActor(raw);
  const medicationOrderPublicId = exact(raw.medicationOrderPublicId, 'medicationOrderPublicId');
  const medicationOrderStatusVersion = positiveInteger(raw.medicationOrderStatusVersion, 'medicationOrderStatusVersion');
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const clinical = normalizeAdministrationClinical(raw);
  const administrationEventPublicId = await deterministicId(
    'medadmin', tenantId, sourceType, sourcePublicId,
    raw.administrationEventPublicId, 'administrationEventPublicId',
  );
  const businessDate = exact(raw.businessDate, 'businessDate');
  const fullOperation = {
    administrationEventPublicId,
    medicationOrderPublicId,
    medicationOrderStatusVersion,
    patientLinkPublicId,
    encounterPublicId,
    clinical,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actor,
    commandOccurredAtUtc,
  };
  const request = await phiMinimisedCommandRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalMedicationAdministrationCommandResult>(db, {
    tenantId, commandName: RECORD_ADMIN, idempotencyKey, request,
  });
  if (replay) return replay;
  await requireMedicationOrder(db, {
    tenantId,
    medicationOrderPublicId,
    medicationOrderStatusVersion,
    patientLinkPublicId,
    encounterPublicId,
  });
  await requirePatientEncounterScope(db, tenantId, patientLinkPublicId, encounterPublicId);
  await requireActivePractitioner(db, tenantId, clinical.administeringPractitionerPublicId);
  await requireSourceMappingAvailable(db, {
    tenantId,
    entityType: 'medication_administration_event',
    sourceType,
    sourcePublicId,
    canonicalPublicId: administrationEventPublicId,
  });
  const fingerprint = await createRequestFingerprint(request);
  const result: CanonicalMedicationAdministrationCommandResult = {
    administrationEventPublicId,
    eventKind: 'administration',
    outcomeCode: clinical.outcomeCode,
    medicationOrderStatusVersion,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: RECORD_ADMIN,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      administrationInsertStatement(db, {
        tenantId,
        administrationEventPublicId,
        eventKind: 'administration',
        medicationOrderPublicId,
        medicationOrderStatusVersion,
        patientLinkPublicId,
        encounterPublicId,
        clinical,
        administeringPractitionerPublicId: clinical.administeringPractitionerPublicId,
        actor,
        commandOccurredAtUtc,
        reasonCode: clinical.reasonCode,
        supersedesAdministrationEventPublicId: null,
        idempotencyKey,
        requestFingerprintSha256: fingerprint,
        sourceEvidenceSha256,
      }),
      sourceMappingStatement(db, {
        tenantId,
        entityType: 'medication_administration_event',
        canonicalPublicId: administrationEventPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: commandOccurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxEventId(tenantId, RECORD_ADMIN, idempotencyKey, raw.eventPublicId),
      aggregateType: 'canonical_medication_administration_event',
      aggregatePublicId: administrationEventPublicId,
      eventType: 'canonical.medication-administration.recorded',
      eventVersion: 1,
      occurredAtUtc: commandOccurredAtUtc,
      businessDate: request.businessDate,
      payload: result,
    },
  });
}

export async function correctCanonicalMedicationAdministrationEvent(
  db: CanonicalBatchDatabase,
  raw: CorrectCanonicalMedicationAdministrationEventInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalMedicationAdministrationCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const commandOccurredAtUtc = utc(raw.commandOccurredAtUtc, 'commandOccurredAtUtc');
  const actor = normalizeActor(raw);
  const originalPublicId = exact(raw.administrationEventPublicId, 'administrationEventPublicId');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const clinical = normalizeAdministrationClinical(raw);
  const replacementPublicId = await deterministicId(
    'medadmin', tenantId, sourceType, sourcePublicId,
    raw.replacementAdministrationEventPublicId, 'replacementAdministrationEventPublicId',
  );
  const businessDate = exact(raw.businessDate, 'businessDate');
  const fullOperation = {
    originalPublicId,
    replacementPublicId,
    clinical,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actor,
    commandOccurredAtUtc,
  };
  const request = await phiMinimisedCommandRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalMedicationAdministrationCommandResult>(db, {
    tenantId, commandName: CORRECT_ADMIN, idempotencyKey, request,
  });
  if (replay) return replay;
  const original = await requireAdministrationEvent(db, tenantId, originalPublicId);
  await requireMedicationOrder(db, {
    tenantId,
    medicationOrderPublicId: original.medication_order_public_id,
    medicationOrderStatusVersion: Number(original.medication_order_status_version),
    patientLinkPublicId: original.patient_link_public_id,
    encounterPublicId: original.encounter_public_id,
  });
  await requireActivePractitioner(db, tenantId, clinical.administeringPractitionerPublicId);
  await requireSourceMappingAvailable(db, {
    tenantId,
    entityType: 'medication_administration_event',
    sourceType,
    sourcePublicId,
    canonicalPublicId: replacementPublicId,
  });
  const fingerprint = await createRequestFingerprint(request);
  const result: CanonicalMedicationAdministrationCommandResult = {
    administrationEventPublicId: replacementPublicId,
    eventKind: 'correction',
    outcomeCode: clinical.outcomeCode,
    supersedesAdministrationEventPublicId: originalPublicId,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: CORRECT_ADMIN,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      administrationInsertStatement(db, {
        tenantId,
        administrationEventPublicId: replacementPublicId,
        eventKind: 'correction',
        medicationOrderPublicId: original.medication_order_public_id,
        medicationOrderStatusVersion: Number(original.medication_order_status_version),
        patientLinkPublicId: original.patient_link_public_id,
        encounterPublicId: original.encounter_public_id,
        clinical,
        administeringPractitionerPublicId: clinical.administeringPractitionerPublicId,
        actor,
        commandOccurredAtUtc,
        reasonCode: clinical.reasonCode,
        supersedesAdministrationEventPublicId: originalPublicId,
        idempotencyKey,
        requestFingerprintSha256: fingerprint,
        sourceEvidenceSha256,
      }),
      sourceMappingStatement(db, {
        tenantId,
        entityType: 'medication_administration_event',
        canonicalPublicId: replacementPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: commandOccurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxEventId(tenantId, CORRECT_ADMIN, idempotencyKey, raw.eventPublicId),
      aggregateType: 'canonical_medication_administration_event',
      aggregatePublicId: replacementPublicId,
      eventType: 'canonical.medication-administration.corrected',
      eventVersion: 1,
      occurredAtUtc: commandOccurredAtUtc,
      businessDate: request.businessDate,
      payload: result,
    },
  });
}

export async function enterCanonicalMedicationAdministrationInError(
  db: CanonicalBatchDatabase,
  raw: EnterCanonicalMedicationAdministrationInErrorInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalMedicationAdministrationCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const actor = normalizeActor(raw);
  const originalPublicId = exact(raw.administrationEventPublicId, 'administrationEventPublicId');
  const practitionerPublicId = exact(raw.administeringPractitionerPublicId, 'administeringPractitionerPublicId');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const errorPublicId = await deterministicId(
    'medadmin', tenantId, sourceType, sourcePublicId,
    raw.errorEventPublicId, 'errorEventPublicId',
  );
  const businessDate = exact(raw.businessDate, 'businessDate');
  const fullOperation = {
    originalPublicId,
    errorPublicId,
    practitionerPublicId,
    reasonCode,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actor,
    occurredAtUtc,
  };
  const request = await phiMinimisedCommandRequest(fullOperation, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalMedicationAdministrationCommandResult>(db, {
    tenantId, commandName: ERROR_ADMIN, idempotencyKey, request,
  });
  if (replay) return replay;
  const original = await requireAdministrationEvent(db, tenantId, originalPublicId);
  await requireActivePractitioner(db, tenantId, practitionerPublicId);
  await requireSourceMappingAvailable(db, {
    tenantId,
    entityType: 'medication_administration_event',
    sourceType,
    sourcePublicId,
    canonicalPublicId: errorPublicId,
  });
  const fingerprint = await createRequestFingerprint(request);
  const result: CanonicalMedicationAdministrationCommandResult = {
    administrationEventPublicId: errorPublicId,
    eventKind: 'entered_in_error',
    outcomeCode: null,
    supersedesAdministrationEventPublicId: originalPublicId,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: ERROR_ADMIN,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      administrationInsertStatement(db, {
        tenantId,
        administrationEventPublicId: errorPublicId,
        eventKind: 'entered_in_error',
        medicationOrderPublicId: original.medication_order_public_id,
        medicationOrderStatusVersion: Number(original.medication_order_status_version),
        patientLinkPublicId: original.patient_link_public_id,
        encounterPublicId: original.encounter_public_id,
        clinical: null,
        administeringPractitionerPublicId: practitionerPublicId,
        actor,
        commandOccurredAtUtc: occurredAtUtc,
        reasonCode,
        supersedesAdministrationEventPublicId: originalPublicId,
        idempotencyKey,
        requestFingerprintSha256: fingerprint,
        sourceEvidenceSha256,
      }),
      sourceMappingStatement(db, {
        tenantId,
        entityType: 'medication_administration_event',
        canonicalPublicId: errorPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxEventId(tenantId, ERROR_ADMIN, idempotencyKey, raw.eventPublicId),
      aggregateType: 'canonical_medication_administration_event',
      aggregatePublicId: errorPublicId,
      eventType: 'canonical.medication-administration.entered-in-error',
      eventVersion: 1,
      occurredAtUtc,
      businessDate: request.businessDate,
      payload: result,
    },
  });
}

async function normalizeReconciliationItems(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    reconciliationPublicId: string;
    versionPublicId: string;
    patientLinkPublicId: string;
    encounterPublicId: string;
    commandName: string;
    idempotencyKey: string;
    items: CanonicalMedicationReconciliationItemInput[];
  },
): Promise<NormalizedReconciliationItem[]> {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new TypeError('at least one reconciliation item is required');
  const normalized: NormalizedReconciliationItem[] = [];
  for (const [index, raw] of input.items.entries()) {
    const prescriptionPublicId = optionalExact(raw.prescriptionPublicId, `items[${index}].prescriptionPublicId`);
    const prescriptionVersionPublicId = optionalExact(raw.prescriptionVersionPublicId, `items[${index}].prescriptionVersionPublicId`);
    if ((prescriptionPublicId == null) !== (prescriptionVersionPublicId == null)) {
      throw new TypeError(`items[${index}] prescription and version must be provided together`);
    }
    if (prescriptionPublicId && prescriptionVersionPublicId) {
      const prescription = await db.prepare(`
        SELECT 1 AS present FROM canonical_prescription_versions v
        JOIN canonical_prescriptions p
          ON p.tenant_id=v.tenant_id AND p.prescription_public_id=v.prescription_public_id
        WHERE v.tenant_id=? AND v.prescription_public_id=? AND v.version_public_id=?
          AND p.patient_link_public_id=? AND p.encounter_public_id=? LIMIT 1
      `).bind(
        input.tenantId,
        prescriptionPublicId,
        prescriptionVersionPublicId,
        input.patientLinkPublicId,
        input.encounterPublicId,
      ).first();
      if (!prescription) throw new Error(`items[${index}] prescription version scope mismatch`);
    }
    const medicationOrderPublicId = optionalExact(raw.medicationOrderPublicId, `items[${index}].medicationOrderPublicId`);
    if (medicationOrderPublicId) {
      const order = await db.prepare(`
        SELECT 1 AS present FROM canonical_medication_orders
        WHERE tenant_id=? AND medication_order_public_id=?
          AND patient_link_public_id=? AND encounter_public_id=? LIMIT 1
      `).bind(
        input.tenantId,
        medicationOrderPublicId,
        input.patientLinkPublicId,
        input.encounterPublicId,
      ).first();
      if (!order) throw new Error(`items[${index}] medication order scope mismatch`);
    }
    const decisionCode = raw.decisionCode;
    const proposedDoseSnapshot = optionalExact(raw.proposedDoseSnapshot, `items[${index}].proposedDoseSnapshot`);
    const proposedRouteSnapshot = optionalExact(raw.proposedRouteSnapshot, `items[${index}].proposedRouteSnapshot`);
    const proposedFrequencySnapshot = optionalExact(raw.proposedFrequencySnapshot, `items[${index}].proposedFrequencySnapshot`);
    if ((decisionCode === 'modify' || decisionCode === 'add')
      && proposedDoseSnapshot == null
      && proposedRouteSnapshot == null
      && proposedFrequencySnapshot == null) {
      throw new TypeError(`items[${index}] ${decisionCode} requires proposed medication instructions`);
    }
    normalized.push({
      itemPublicId: await deterministicId(
        'medrecitem',
        input.tenantId,
        input.commandName,
        `${input.idempotencyKey}:${index + 1}`,
        raw.itemPublicId,
        `items[${index}].itemPublicId`,
      ),
      itemSequence: index + 1,
      sourceKind: raw.sourceKind,
      decisionCode,
      prescriptionPublicId,
      prescriptionVersionPublicId,
      medicationOrderPublicId,
      medicationDescriptionSnapshot: exact(
        raw.medicationDescriptionSnapshot,
        `items[${index}].medicationDescriptionSnapshot`,
      ),
      priorDoseSnapshot: optionalExact(raw.priorDoseSnapshot, `items[${index}].priorDoseSnapshot`),
      priorRouteSnapshot: optionalExact(raw.priorRouteSnapshot, `items[${index}].priorRouteSnapshot`),
      priorFrequencySnapshot: optionalExact(raw.priorFrequencySnapshot, `items[${index}].priorFrequencySnapshot`),
      proposedDoseSnapshot,
      proposedRouteSnapshot,
      proposedFrequencySnapshot,
      reasonCode: exact(raw.reasonCode, `items[${index}].reasonCode`),
      sourceEvidenceSha256: sha256(raw.sourceEvidenceSha256, `items[${index}].sourceEvidenceSha256`),
    });
  }
  return normalized;
}

function reconciliationVersionStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    versionPublicId: string;
    reconciliationPublicId: string;
    versionNumber: number;
    supersedesVersionPublicId: string | null;
    sourceSummarySha256: string;
    contentSha256: string;
    authoringPractitionerPublicId: string;
    actor: NormalizedActor;
    occurredAtUtc: string;
    sourceEvidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_medication_reconciliation_versions (
      tenant_id,version_public_id,reconciliation_public_id,version_number,
      supersedes_version_public_id,version_status,source_summary_sha256,
      content_sha256,signed_content_sha256,authoring_practitioner_public_id,
      finalizing_practitioner_public_id,actor_user_public_id,actor_system_key,
      authored_at_utc,finalized_at_utc,source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,'draft',?,?,NULL,?,NULL,?,?,?,NULL,?,?)
  `).bind(
    input.tenantId,
    input.versionPublicId,
    input.reconciliationPublicId,
    input.versionNumber,
    input.supersedesVersionPublicId,
    input.sourceSummarySha256,
    input.contentSha256,
    input.authoringPractitionerPublicId,
    input.actor.actorUserPublicId,
    input.actor.actorSystemKey,
    input.occurredAtUtc,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
  );
}

function reconciliationItemStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    reconciliationPublicId: string;
    versionPublicId: string;
    item: NormalizedReconciliationItem;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  const item = input.item;
  return db.prepare(`
    INSERT INTO canonical_medication_reconciliation_items (
      tenant_id,item_public_id,reconciliation_public_id,version_public_id,
      item_sequence,source_kind,decision_code,prescription_public_id,
      prescription_version_public_id,medication_order_public_id,
      medication_description_snapshot,prior_dose_snapshot,prior_route_snapshot,
      prior_frequency_snapshot,proposed_dose_snapshot,proposed_route_snapshot,
      proposed_frequency_snapshot,reason_code,source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    item.itemPublicId,
    input.reconciliationPublicId,
    input.versionPublicId,
    item.itemSequence,
    item.sourceKind,
    item.decisionCode,
    item.prescriptionPublicId,
    item.prescriptionVersionPublicId,
    item.medicationOrderPublicId,
    item.medicationDescriptionSnapshot,
    item.priorDoseSnapshot,
    item.priorRouteSnapshot,
    item.priorFrequencySnapshot,
    item.proposedDoseSnapshot,
    item.proposedRouteSnapshot,
    item.proposedFrequencySnapshot,
    item.reasonCode,
    item.sourceEvidenceSha256,
    input.occurredAtUtc,
  );
}

function reconciliationEventStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    reconciliationPublicId: string;
    versionPublicId: string;
    fromStatus: CanonicalMedicationReconciliationStatus | null;
    toStatus: CanonicalMedicationReconciliationStatus;
    eventVersion: number;
    eventType: 'draft_created' | 'draft_replaced' | 'finalized' | 'cancelled' | 'entered_in_error';
    reasonCode: string;
    practitionerPublicId: string | null;
    actor: NormalizedActor;
    occurredAtUtc: string;
    sourceEvidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_medication_reconciliation_status_events (
      tenant_id,event_public_id,reconciliation_public_id,version_public_id,
      from_status,to_status,event_version,event_type,reason_code,
      actor_practitioner_public_id,actor_user_public_id,actor_system_key,
      occurred_at_utc,source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.eventPublicId,
    input.reconciliationPublicId,
    input.versionPublicId,
    input.fromStatus,
    input.toStatus,
    input.eventVersion,
    input.eventType,
    input.reasonCode,
    input.practitionerPublicId,
    input.actor.actorUserPublicId,
    input.actor.actorSystemKey,
    input.occurredAtUtc,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
  );
}

async function requireReconciliation(
  db: CanonicalBatchDatabase,
  tenantId: string,
  reconciliationPublicId: string,
): Promise<ReconciliationRow> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,encounter_public_id,reconciliation_type,
           current_version_public_id,current_status,status_version
    FROM canonical_medication_reconciliations
    WHERE tenant_id=? AND reconciliation_public_id=? LIMIT 1
  `).bind(tenantId, reconciliationPublicId).first<ReconciliationRow>();
  if (!row) throw new Error('canonical medication reconciliation not found');
  return row;
}

async function requireReconciliationVersion(
  db: CanonicalBatchDatabase,
  tenantId: string,
  reconciliationPublicId: string,
  versionPublicId: string,
): Promise<ReconciliationVersionRow> {
  const row = await db.prepare(`
    SELECT version_number,version_status,content_sha256
    FROM canonical_medication_reconciliation_versions
    WHERE tenant_id=? AND reconciliation_public_id=? AND version_public_id=? LIMIT 1
  `).bind(tenantId, reconciliationPublicId, versionPublicId).first<ReconciliationVersionRow>();
  if (!row) throw new Error('canonical medication reconciliation version not found');
  return row;
}

async function reconciliationItemCount(
  db: CanonicalBatchDatabase,
  tenantId: string,
  reconciliationPublicId: string,
  versionPublicId: string,
): Promise<number> {
  return Number((await db.prepare(`
    SELECT COUNT(*) AS count FROM canonical_medication_reconciliation_items
    WHERE tenant_id=? AND reconciliation_public_id=? AND version_public_id=?
  `).bind(tenantId, reconciliationPublicId, versionPublicId).first<CountRow>())?.count ?? 0);
}

export async function createCanonicalMedicationReconciliationDraft(
  db: CanonicalBatchDatabase,
  raw: CreateCanonicalMedicationReconciliationDraftInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalMedicationReconciliationCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const actor = normalizeActor(raw);
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const creatingPractitionerPublicId = exact(raw.creatingPractitionerPublicId, 'creatingPractitionerPublicId');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const sourceSummarySha256 = sha256(raw.sourceSummarySha256, 'sourceSummarySha256');
  const reconciliationPublicId = await deterministicId(
    'medrec', tenantId, sourceType, sourcePublicId,
    raw.reconciliationPublicId, 'reconciliationPublicId',
  );
  const versionPublicId = await deterministicId(
    'medrecver', tenantId, sourceType, `${sourcePublicId}:v1`,
    raw.versionPublicId, 'versionPublicId',
  );
  const businessDate = exact(raw.businessDate, 'businessDate');
  const request = await phiMinimisedCommandRequest({
    reconciliationPublicId,
    versionPublicId,
    patientLinkPublicId,
    encounterPublicId,
    reconciliationType: raw.reconciliationType,
    creatingPractitionerPublicId,
    rawItems: raw.items,
    sourceSummarySha256,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actor,
    occurredAtUtc,
  }, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalMedicationReconciliationCommandResult>(db, {
    tenantId, commandName: CREATE_RECON, idempotencyKey, request,
  });
  if (replay) return replay;
  await requirePatientEncounterScope(db, tenantId, patientLinkPublicId, encounterPublicId);
  await requireActivePractitioner(db, tenantId, creatingPractitionerPublicId);
  const items = await normalizeReconciliationItems(db, {
    tenantId,
    reconciliationPublicId,
    versionPublicId,
    patientLinkPublicId,
    encounterPublicId,
    commandName: CREATE_RECON,
    idempotencyKey,
    items: raw.items,
  });
  const versionContent = {
    schemaVersion: 1,
    reconciliationPublicId,
    versionPublicId,
    versionNumber: 1,
    reconciliationType: raw.reconciliationType,
    patientLinkPublicId,
    encounterPublicId,
    items,
  };
  const contentSha256 = await createRequestFingerprint(versionContent);
  await requireSourceMappingAvailable(db, {
    tenantId,
    entityType: 'medication_reconciliation',
    sourceType,
    sourcePublicId,
    canonicalPublicId: reconciliationPublicId,
  });
  const fingerprint = await createRequestFingerprint(request);
  const result: CanonicalMedicationReconciliationCommandResult = {
    reconciliationPublicId,
    versionPublicId,
    currentStatus: 'draft',
    statusVersion: 1,
    versionNumber: 1,
    itemCount: items.length,
  };
  const draftEventId = await lifecycleEventId(tenantId, CREATE_RECON, idempotencyKey, 'draft-created');
  return runCanonicalBatch(db, {
    tenantId,
    commandName: CREATE_RECON,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_medication_reconciliations (
          tenant_id,reconciliation_public_id,patient_link_public_id,encounter_public_id,
          reconciliation_type,current_version_public_id,current_status,status_version,
          creating_practitioner_public_id,actor_user_public_id,actor_system_key,
          idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
          created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        tenantId,
        reconciliationPublicId,
        patientLinkPublicId,
        encounterPublicId,
        raw.reconciliationType,
        null,
        'draft',
        1,
        creatingPractitionerPublicId,
        actor.actorUserPublicId,
        actor.actorSystemKey,
        idempotencyKey,
        fingerprint,
        sourceEvidenceSha256,
        occurredAtUtc,
        occurredAtUtc,
      ),
      reconciliationVersionStatement(db, {
        tenantId,
        versionPublicId,
        reconciliationPublicId,
        versionNumber: 1,
        supersedesVersionPublicId: null,
        sourceSummarySha256,
        contentSha256,
        authoringPractitionerPublicId: creatingPractitionerPublicId,
        actor,
        occurredAtUtc,
        sourceEvidenceSha256,
      }),
      ...items.map((item) => reconciliationItemStatement(db, {
        tenantId, reconciliationPublicId, versionPublicId, item, occurredAtUtc,
      })),
      reconciliationEventStatement(db, {
        tenantId,
        eventPublicId: draftEventId,
        reconciliationPublicId,
        versionPublicId,
        fromStatus: null,
        toStatus: 'draft',
        eventVersion: 1,
        eventType: 'draft_created',
        reasonCode: 'draft_created',
        practitionerPublicId: creatingPractitionerPublicId,
        actor,
        occurredAtUtc,
        sourceEvidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_medication_reconciliations
        SET current_version_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND reconciliation_public_id=?
          AND current_version_public_id IS NULL AND current_status='draft' AND status_version=1
      `).bind(versionPublicId, occurredAtUtc, tenantId, reconciliationPublicId),
      sourceMappingStatement(db, {
        tenantId,
        entityType: 'medication_reconciliation',
        canonicalPublicId: reconciliationPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await outboxEventId(tenantId, CREATE_RECON, idempotencyKey, raw.eventPublicId),
      aggregateType: 'canonical_medication_reconciliation',
      aggregatePublicId: reconciliationPublicId,
      eventType: 'canonical.medication-reconciliation.draft-created',
      eventVersion: 1,
      occurredAtUtc,
      businessDate: request.businessDate,
      payload: result,
    },
  });
}

export async function replaceCanonicalMedicationReconciliationDraft(
  db: CanonicalBatchDatabase,
  raw: ReplaceCanonicalMedicationReconciliationDraftInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalMedicationReconciliationCommandResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const actor = normalizeActor(raw);
  const reconciliationPublicId = exact(raw.reconciliationPublicId, 'reconciliationPublicId');
  const expectedStatusVersion = positiveInteger(raw.expectedStatusVersion, 'expectedStatusVersion');
  const authoringPractitionerPublicId = exact(raw.authoringPractitionerPublicId, 'authoringPractitionerPublicId');
  const sourceSummarySha256 = sha256(raw.sourceSummarySha256, 'sourceSummarySha256');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const versionPublicId = await deterministicId(
    'medrecver', tenantId, REPLACE_RECON, `${idempotencyKey}:replacement`,
    raw.versionPublicId, 'versionPublicId',
  );
  const businessDate = exact(raw.businessDate, 'businessDate');
  const request = await phiMinimisedCommandRequest({
    reconciliationPublicId,
    expectedStatusVersion,
    versionPublicId,
    authoringPractitionerPublicId,
    rawItems: raw.items,
    sourceSummarySha256,
    sourceEvidenceSha256,
    actor,
    occurredAtUtc,
  }, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalMedicationReconciliationCommandResult>(db, {
    tenantId, commandName: REPLACE_RECON, idempotencyKey, request,
  });
  if (replay) return replay;
  const reconciliation = await requireReconciliation(db, tenantId, reconciliationPublicId);
  const currentVersionPublicId = reconciliation.current_version_public_id;
  if (reconciliation.current_status !== 'draft' || Number(reconciliation.status_version) !== expectedStatusVersion) {
    throw new Error('canonical medication reconciliation version conflict or draft is no longer active');
  }
  if (!currentVersionPublicId) throw new Error('canonical medication reconciliation current version is missing');
  const currentVersion = await requireReconciliationVersion(db, tenantId, reconciliationPublicId, currentVersionPublicId);
  const versionNumber = Number(currentVersion.version_number) + 1;
  await requireActivePractitioner(db, tenantId, authoringPractitionerPublicId);
  const items = await normalizeReconciliationItems(db, {
    tenantId,
    reconciliationPublicId,
    versionPublicId,
    patientLinkPublicId: reconciliation.patient_link_public_id,
    encounterPublicId: reconciliation.encounter_public_id,
    commandName: REPLACE_RECON,
    idempotencyKey,
    items: raw.items,
  });
  const versionContent = {
    schemaVersion: 1,
    reconciliationPublicId,
    versionPublicId,
    versionNumber,
    supersedesVersionPublicId: currentVersionPublicId,
    reconciliationType: reconciliation.reconciliation_type,
    patientLinkPublicId: reconciliation.patient_link_public_id,
    encounterPublicId: reconciliation.encounter_public_id,
    items,
  };
  const contentSha256 = await createRequestFingerprint(versionContent);
  const nextStatusVersion = expectedStatusVersion + 1;
  const result: CanonicalMedicationReconciliationCommandResult = {
    reconciliationPublicId,
    versionPublicId,
    currentStatus: 'draft',
    statusVersion: nextStatusVersion,
    versionNumber,
    itemCount: items.length,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: REPLACE_RECON,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      reconciliationVersionStatement(db, {
        tenantId,
        versionPublicId,
        reconciliationPublicId,
        versionNumber,
        supersedesVersionPublicId: currentVersionPublicId,
        sourceSummarySha256,
        contentSha256,
        authoringPractitionerPublicId,
        actor,
        occurredAtUtc,
        sourceEvidenceSha256,
      }),
      ...items.map((item) => reconciliationItemStatement(db, {
        tenantId, reconciliationPublicId, versionPublicId, item, occurredAtUtc,
      })),
      reconciliationEventStatement(db, {
        tenantId,
        eventPublicId: await lifecycleEventId(tenantId, REPLACE_RECON, idempotencyKey, 'draft-replaced'),
        reconciliationPublicId,
        versionPublicId,
        fromStatus: 'draft',
        toStatus: 'draft',
        eventVersion: nextStatusVersion,
        eventType: 'draft_replaced',
        reasonCode: 'draft_replaced',
        practitionerPublicId: authoringPractitionerPublicId,
        actor,
        occurredAtUtc,
        sourceEvidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_medication_reconciliations
        SET current_version_public_id=?,current_status='draft',status_version=?,updated_at_utc=?
        WHERE tenant_id=? AND reconciliation_public_id=?
          AND current_version_public_id=? AND current_status='draft' AND status_version=?
      `).bind(
        versionPublicId,
        nextStatusVersion,
        occurredAtUtc,
        tenantId,
        reconciliationPublicId,
        currentVersionPublicId,
        expectedStatusVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: await outboxEventId(tenantId, REPLACE_RECON, idempotencyKey, raw.eventPublicId),
      aggregateType: 'canonical_medication_reconciliation',
      aggregatePublicId: reconciliationPublicId,
      eventType: 'canonical.medication-reconciliation.draft-replaced',
      eventVersion: nextStatusVersion,
      occurredAtUtc,
      businessDate: request.businessDate,
      payload: result,
    },
  });
}

export async function finalizeCanonicalMedicationReconciliation(
  db: CanonicalBatchDatabase,
  raw: FinalizeCanonicalMedicationReconciliationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalMedicationReconciliationCommandResult>> {
  return transitionReconciliation(db, raw, execution, 'final');
}

export async function cancelCanonicalMedicationReconciliation(
  db: CanonicalBatchDatabase,
  raw: CancelCanonicalMedicationReconciliationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalMedicationReconciliationCommandResult>> {
  return transitionReconciliation(db, raw, execution, 'cancelled');
}

async function transitionReconciliation(
  db: CanonicalBatchDatabase,
  raw: FinalizeCanonicalMedicationReconciliationInput | CancelCanonicalMedicationReconciliationInput,
  execution: CanonicalCommandExecutionOptions,
  targetStatus: 'final' | 'cancelled',
): Promise<CanonicalCommandResult<CanonicalMedicationReconciliationCommandResult>> {
  const commandName = targetStatus === 'final' ? FINALIZE_RECON : CANCEL_RECON;
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const occurredAtUtc = utc(raw.occurredAtUtc, 'occurredAtUtc');
  const actor = normalizeActor(raw);
  const reconciliationPublicId = exact(raw.reconciliationPublicId, 'reconciliationPublicId');
  const versionPublicId = exact(raw.versionPublicId, 'versionPublicId');
  const expectedStatusVersion = positiveInteger(raw.expectedStatusVersion, 'expectedStatusVersion');
  const practitionerPublicId = exact(
    targetStatus === 'final'
      ? (raw as FinalizeCanonicalMedicationReconciliationInput).finalizingPractitionerPublicId
      : (raw as CancelCanonicalMedicationReconciliationInput).cancellingPractitionerPublicId,
    targetStatus === 'final' ? 'finalizingPractitionerPublicId' : 'cancellingPractitionerPublicId',
  );
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const signedContentSha256 = targetStatus === 'final'
    ? sha256((raw as FinalizeCanonicalMedicationReconciliationInput).signedContentSha256, 'signedContentSha256')
    : null;
  const businessDate = exact(raw.businessDate, 'businessDate');
  const request = await phiMinimisedCommandRequest({
    reconciliationPublicId,
    versionPublicId,
    expectedStatusVersion,
    practitionerPublicId,
    reasonCode,
    sourceEvidenceSha256,
    signedContentSha256,
    actor,
    occurredAtUtc,
  }, businessDate);
  const replay = await readCanonicalCommandReplay<CanonicalMedicationReconciliationCommandResult>(db, {
    tenantId, commandName, idempotencyKey, request,
  });
  if (replay) return replay;
  const reconciliation = await requireReconciliation(db, tenantId, reconciliationPublicId);
  if (reconciliation.current_status !== 'draft'
    || Number(reconciliation.status_version) !== expectedStatusVersion
    || reconciliation.current_version_public_id !== versionPublicId) {
    throw new Error('canonical medication reconciliation version conflict or draft is no longer active');
  }
  const version = await requireReconciliationVersion(db, tenantId, reconciliationPublicId, versionPublicId);
  if (version.version_status !== 'draft') throw new Error('canonical medication reconciliation version is not draft');
  if (targetStatus === 'final' && signedContentSha256 !== version.content_sha256) {
    throw new Error('signed content hash does not match reconciliation content hash');
  }
  await requireActivePractitioner(db, tenantId, practitionerPublicId);
  const itemCount = await reconciliationItemCount(db, tenantId, reconciliationPublicId, versionPublicId);
  if (itemCount <= 0) throw new Error('canonical medication reconciliation version has no items');
  const nextStatusVersion = expectedStatusVersion + 1;
  const result: CanonicalMedicationReconciliationCommandResult = {
    reconciliationPublicId,
    versionPublicId,
    currentStatus: targetStatus,
    statusVersion: nextStatusVersion,
    versionNumber: Number(version.version_number),
    itemCount,
  };
  const eventType = targetStatus === 'final' ? 'finalized' : 'cancelled';
  return runCanonicalBatch(db, {
    tenantId,
    commandName,
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      reconciliationEventStatement(db, {
        tenantId,
        eventPublicId: await lifecycleEventId(tenantId, commandName, idempotencyKey, eventType),
        reconciliationPublicId,
        versionPublicId,
        fromStatus: 'draft',
        toStatus: targetStatus,
        eventVersion: nextStatusVersion,
        eventType,
        reasonCode,
        practitionerPublicId,
        actor,
        occurredAtUtc,
        sourceEvidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_medication_reconciliation_versions
        SET version_status=?,signed_content_sha256=?,finalizing_practitioner_public_id=?,
            finalized_at_utc=?
        WHERE tenant_id=? AND reconciliation_public_id=? AND version_public_id=?
          AND version_status='draft'
      `).bind(
        targetStatus,
        signedContentSha256,
        targetStatus === 'final' ? practitionerPublicId : null,
        targetStatus === 'final' ? occurredAtUtc : null,
        tenantId,
        reconciliationPublicId,
        versionPublicId,
      ),
      db.prepare(`
        UPDATE canonical_medication_reconciliations
        SET current_status=?,status_version=?,updated_at_utc=?
        WHERE tenant_id=? AND reconciliation_public_id=?
          AND current_version_public_id=? AND current_status='draft' AND status_version=?
      `).bind(
        targetStatus,
        nextStatusVersion,
        occurredAtUtc,
        tenantId,
        reconciliationPublicId,
        versionPublicId,
        expectedStatusVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: await outboxEventId(tenantId, commandName, idempotencyKey, raw.eventPublicId),
      aggregateType: 'canonical_medication_reconciliation',
      aggregatePublicId: reconciliationPublicId,
      eventType: `canonical.medication-reconciliation.${targetStatus}`,
      eventVersion: nextStatusVersion,
      occurredAtUtc,
      businessDate: request.businessDate,
      payload: result,
    },
  });
}
