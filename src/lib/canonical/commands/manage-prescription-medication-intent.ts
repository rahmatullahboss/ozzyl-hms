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

export type CanonicalPrescriptionStatus =
  | 'draft'
  | 'final'
  | 'amended'
  | 'cancelled'
  | 'entered_in_error';

export type CanonicalMedicationOrderStatus =
  | 'draft'
  | 'active'
  | 'on_hold'
  | 'completed'
  | 'stopped'
  | 'cancelled'
  | 'entered_in_error';

export type CanonicalMedicationOrderPriority = 'routine' | 'urgent' | 'stat' | 'prn';
export type CanonicalPrescriptionSafetyEventType =
  | 'allergy_check'
  | 'interaction_check'
  | 'duplicate_therapy_check'
  | 'dose_check'
  | 'override'
  | 'waiver'
  | 'other';
export type CanonicalPrescriptionSafetyOutcome =
  | 'passed'
  | 'warning'
  | 'blocked'
  | 'overridden'
  | 'not_applicable';
export type CanonicalPrescriptionSafetySeverity =
  | 'none'
  | 'low'
  | 'moderate'
  | 'high'
  | 'critical'
  | 'unknown';

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

export interface CanonicalMedicationOrderDraftInput {
  medicationOrderPublicId?: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  medicationCodeSystem?: string | null;
  medicationCode?: string | null;
  medicationDisplay: string;
  genericDisplay?: string | null;
  strengthSnapshot?: string | null;
  doseText: string;
  routeCode: string;
  frequencyCode: string;
  durationText?: string | null;
  instructionsText?: string | null;
  priority?: CanonicalMedicationOrderPriority;
  intendedStartUtc: string;
  intendedEndUtc?: string | null;
}

export interface CreateCanonicalPrescriptionDraftInput extends CommandBaseInput {
  prescriptionPublicId?: string;
  versionPublicId?: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  prescribingPractitionerPublicId: string;
  authoredAtUtc: string;
  contentSha256: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  medicationOrders: CanonicalMedicationOrderDraftInput[];
}

export interface ReplaceCanonicalPrescriptionDraftInput extends CommandBaseInput {
  prescriptionPublicId: string;
  expectedVersion: number;
  versionPublicId?: string;
  contentSha256: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  medicationOrders: CanonicalMedicationOrderDraftInput[];
}

export interface FinalizeCanonicalPrescriptionInput extends CommandBaseInput {
  prescriptionPublicId: string;
  expectedVersion: number;
  signedSnapshotSha256: string;
  sourceEvidenceSha256: string;
  actorPractitionerPublicId: string;
}

export interface AmendCanonicalPrescriptionInput extends CommandBaseInput {
  prescriptionPublicId: string;
  expectedVersion: number;
  versionPublicId?: string;
  contentSha256: string;
  signedSnapshotSha256: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  medicationOrders: CanonicalMedicationOrderDraftInput[];
  actorPractitionerPublicId: string;
}

export interface TransitionCanonicalMedicationOrderInput extends CommandBaseInput {
  medicationOrderPublicId: string;
  toStatus: CanonicalMedicationOrderStatus;
  expectedVersion: number;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface RecordCanonicalPrescriptionSafetyEventInput extends CommandBaseInput {
  prescriptionPublicId: string;
  prescriptionVersionPublicId?: string | null;
  medicationOrderPublicId?: string | null;
  eventType: CanonicalPrescriptionSafetyEventType;
  outcome: CanonicalPrescriptionSafetyOutcome;
  severity?: CanonicalPrescriptionSafetySeverity | null;
  evidenceCode: string;
  sourceEvidenceSha256: string;
  outboxEventPublicId?: string;
}

export interface CanonicalPrescriptionCommandResult {
  prescriptionPublicId: string;
  currentVersionPublicId: string;
  currentStatus: CanonicalPrescriptionStatus;
  statusVersion: number;
  medicationOrderCount: number;
}

export interface CanonicalMedicationOrderCommandResult {
  medicationOrderPublicId: string;
  currentStatus: CanonicalMedicationOrderStatus;
  statusVersion: number;
}

export interface CanonicalPrescriptionSafetyEventResult {
  eventPublicId: string;
  prescriptionPublicId: string;
  eventType: CanonicalPrescriptionSafetyEventType;
  outcome: CanonicalPrescriptionSafetyOutcome;
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

interface NormalizedMedicationOrder {
  medicationOrderPublicId: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  medicationCodeSystem: string | null;
  medicationCode: string | null;
  medicationDisplay: string;
  genericDisplay: string | null;
  strengthSnapshot: string | null;
  doseText: string;
  routeCode: string;
  frequencyCode: string;
  durationText: string | null;
  instructionsText: string | null;
  priority: CanonicalMedicationOrderPriority;
  intendedStartUtc: string;
  intendedEndUtc: string | null;
  requestFingerprintSha256: string;
}

interface PatientLinkRow {
  link_status: string;
  effective_to_utc: string | null;
}

interface EncounterRow {
  patient_link_public_id: string | null;
  status: string;
}

interface PractitionerRow {
  status: string;
}

interface SourceMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface PrescriptionRow {
  patient_link_public_id: string;
  encounter_public_id: string;
  prescribing_practitioner_public_id: string;
  current_version_public_id: string | null;
  current_status: CanonicalPrescriptionStatus;
  status_version: number;
  authored_at_utc: string;
  finalized_at_utc: string | null;
}

interface PrescriptionVersionRow {
  version_number: number;
  version_status: string;
}

interface MedicationOrderRow {
  prescription_public_id: string | null;
  prescription_version_public_id: string | null;
  current_status: CanonicalMedicationOrderStatus;
  status_version: number;
}

const CREATE_COMMAND = 'canonical.prescription.create-draft';
const REPLACE_DRAFT_COMMAND = 'canonical.prescription.replace-draft';
const FINALIZE_COMMAND = 'canonical.prescription.finalize';
const AMEND_COMMAND = 'canonical.prescription.amend';
const TRANSITION_ORDER_COMMAND = 'canonical.medication-order.transition';
const RECORD_SAFETY_COMMAND = 'canonical.prescription.safety-event.record';

const MEDICATION_STATUSES = new Set<CanonicalMedicationOrderStatus>([
  'draft',
  'active',
  'on_hold',
  'completed',
  'stopped',
  'cancelled',
  'entered_in_error',
]);

const MEDICATION_TRANSITIONS: Readonly<
  Record<CanonicalMedicationOrderStatus, readonly CanonicalMedicationOrderStatus[]>
> = {
  draft: ['active', 'cancelled', 'entered_in_error'],
  active: ['on_hold', 'completed', 'stopped', 'cancelled', 'entered_in_error'],
  on_hold: ['active', 'stopped', 'cancelled', 'entered_in_error'],
  completed: ['entered_in_error'],
  stopped: ['entered_in_error'],
  cancelled: ['entered_in_error'],
  entered_in_error: [],
};

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  return value == null ? null : exact(value, label);
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function lowercaseSha256(value: string, label: string): string {
  exact(value, label);
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) {
    throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  }
  return value;
}

function businessDate(value: string): string {
  const normalized = exact(value, 'businessDate');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new RangeError('businessDate must use YYYY-MM-DD');
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    instant.getUTCFullYear() !== Number(match[1])
    || instant.getUTCMonth() !== Number(match[2]) - 1
    || instant.getUTCDate() !== Number(match[3])
  ) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return normalized;
}

function normalizeActor(input: CommandActorInput, requireUserOrSystem = false): NormalizedActor {
  const actorUserPublicId = optionalExact(input.actorUserPublicId, 'actorUserPublicId');
  const actorSystemKey = optionalExact(input.actorSystemKey, 'actorSystemKey');
  const actorPractitionerPublicId = optionalExact(
    input.actorPractitionerPublicId,
    'actorPractitionerPublicId',
  );
  if (requireUserOrSystem) {
    if (actorUserPublicId == null && actorSystemKey == null) {
      throw new TypeError('actorUserPublicId or actorSystemKey is required');
    }
  } else if (
    actorUserPublicId == null
    && actorSystemKey == null
    && actorPractitionerPublicId == null
  ) {
    throw new TypeError('an actor identity is required');
  }
  return { actorUserPublicId, actorSystemKey, actorPractitionerPublicId };
}

function normalizeBase(input: CommandBaseInput, requireUserOrSystem = false): NormalizedBase {
  return {
    tenantId: exact(input.tenantId, 'tenantId'),
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    occurredAtUtc: utc(input.occurredAtUtc, 'occurredAtUtc'),
    businessDate: businessDate(input.businessDate),
    ...normalizeActor(input, requireUserOrSystem),
  };
}

function medicationStatus(value: string): CanonicalMedicationOrderStatus {
  if (!MEDICATION_STATUSES.has(value as CanonicalMedicationOrderStatus)) {
    throw new RangeError('medication order status is invalid');
  }
  return value as CanonicalMedicationOrderStatus;
}

function medicationPriority(value: string | undefined): CanonicalMedicationOrderPriority {
  const resolved = value ?? 'routine';
  if (!['routine', 'urgent', 'stat', 'prn'].includes(resolved)) {
    throw new RangeError('medication order priority is invalid');
  }
  return resolved as CanonicalMedicationOrderPriority;
}

function safetyEventType(value: string): CanonicalPrescriptionSafetyEventType {
  if (![
    'allergy_check',
    'interaction_check',
    'duplicate_therapy_check',
    'dose_check',
    'override',
    'waiver',
    'other',
  ].includes(value)) {
    throw new RangeError('safety event type is invalid');
  }
  return value as CanonicalPrescriptionSafetyEventType;
}

function safetyOutcome(value: string): CanonicalPrescriptionSafetyOutcome {
  if (!['passed', 'warning', 'blocked', 'overridden', 'not_applicable'].includes(value)) {
    throw new RangeError('safety outcome is invalid');
  }
  return value as CanonicalPrescriptionSafetyOutcome;
}

function safetySeverity(
  value: CanonicalPrescriptionSafetySeverity | null | undefined,
): CanonicalPrescriptionSafetySeverity | null {
  if (value == null) return null;
  if (!['none', 'low', 'moderate', 'high', 'critical', 'unknown'].includes(value)) {
    throw new RangeError('safety severity is invalid');
  }
  return value;
}

async function deterministicId(
  prefix: string,
  tenantId: string,
  sourceType: string,
  sourcePublicId: string,
  provided: string | undefined,
  label: string,
): Promise<string> {
  return provided == null
    ? createDeterministicSourceId(prefix, tenantId, sourceType, sourcePublicId)
    : exact(provided, label);
}

async function outboxEventId(
  tenantId: string,
  commandName: string,
  idempotencyKey: string,
  provided: string | undefined,
): Promise<string> {
  return deterministicId('rxevt', tenantId, commandName, idempotencyKey, provided, 'eventPublicId');
}

async function normalizeMedicationOrders(
  tenantId: string,
  orders: readonly CanonicalMedicationOrderDraftInput[],
): Promise<NormalizedMedicationOrder[]> {
  if (!Array.isArray(orders)) throw new TypeError('medicationOrders must be an array');
  const normalized = await Promise.all(orders.map(async (raw, index) => {
    const sourceType = exact(raw.sourceType, `medicationOrders[${index}].sourceType`);
    const sourcePublicId = exact(raw.sourcePublicId, `medicationOrders[${index}].sourcePublicId`);
    const sourceTable = exact(raw.sourceTable, `medicationOrders[${index}].sourceTable`);
    const medicationOrderPublicId = await deterministicId(
      'rxord',
      tenantId,
      sourceType,
      sourcePublicId,
      raw.medicationOrderPublicId,
      `medicationOrders[${index}].medicationOrderPublicId`,
    );
    const medicationCodeSystem = optionalExact(
      raw.medicationCodeSystem,
      `medicationOrders[${index}].medicationCodeSystem`,
    );
    const medicationCode = optionalExact(raw.medicationCode, `medicationOrders[${index}].medicationCode`);
    if ((medicationCodeSystem == null) !== (medicationCode == null)) {
      throw new TypeError('medicationCodeSystem and medicationCode must be provided together');
    }
    const intendedStartUtc = utc(raw.intendedStartUtc, `medicationOrders[${index}].intendedStartUtc`);
    const intendedEndUtc = raw.intendedEndUtc == null
      ? null
      : utc(raw.intendedEndUtc, `medicationOrders[${index}].intendedEndUtc`);
    if (intendedEndUtc != null && Date.parse(intendedEndUtc) < Date.parse(intendedStartUtc)) {
      throw new RangeError('medication order intendedEndUtc cannot be before intendedStartUtc');
    }
    const request = {
      medicationOrderPublicId,
      sourceType,
      sourcePublicId,
      sourceTable,
      sourceEvidenceSha256: lowercaseSha256(
        raw.sourceEvidenceSha256,
        `medicationOrders[${index}].sourceEvidenceSha256`,
      ),
      medicationCodeSystem,
      medicationCode,
      medicationDisplay: exact(raw.medicationDisplay, `medicationOrders[${index}].medicationDisplay`),
      genericDisplay: optionalExact(raw.genericDisplay, `medicationOrders[${index}].genericDisplay`),
      strengthSnapshot: optionalExact(raw.strengthSnapshot, `medicationOrders[${index}].strengthSnapshot`),
      doseText: exact(raw.doseText, `medicationOrders[${index}].doseText`),
      routeCode: exact(raw.routeCode, `medicationOrders[${index}].routeCode`),
      frequencyCode: exact(raw.frequencyCode, `medicationOrders[${index}].frequencyCode`),
      durationText: optionalExact(raw.durationText, `medicationOrders[${index}].durationText`),
      instructionsText: optionalExact(raw.instructionsText, `medicationOrders[${index}].instructionsText`),
      priority: medicationPriority(raw.priority),
      intendedStartUtc,
      intendedEndUtc,
    };
    return {
      ...request,
      requestFingerprintSha256: await createRequestFingerprint(request),
    };
  }));

  const ids = new Set<string>();
  const sources = new Set<string>();
  for (const order of normalized) {
    if (ids.has(order.medicationOrderPublicId)) {
      throw new Error('duplicate medicationOrderPublicId in one command');
    }
    ids.add(order.medicationOrderPublicId);
    const sourceKey = `${order.sourceType}\u0000${order.sourcePublicId}`;
    if (sources.has(sourceKey)) throw new Error('duplicate medication-order source key in one command');
    sources.add(sourceKey);
  }
  return normalized;
}

async function requirePatientLink(
  db: CanonicalBatchDatabase,
  tenantId: string,
  patientLinkPublicId: string,
): Promise<void> {
  const row = await db.prepare(`
    SELECT link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=?
    LIMIT 1
  `).bind(tenantId, patientLinkPublicId).first<PatientLinkRow>();
  if (!row) throw new Error('patient link not found');
  if (row.link_status === 'rejected' || row.link_status === 'retired' || row.effective_to_utc != null) {
    throw new Error('prescription requires an active patient link');
  }
}

async function requireEncounterPatientLink(
  db: CanonicalBatchDatabase,
  tenantId: string,
  encounterPublicId: string,
  patientLinkPublicId: string,
): Promise<void> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,status
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(tenantId, encounterPublicId).first<EncounterRow>();
  if (!row) throw new Error('encounter not found');
  if (row.patient_link_public_id !== patientLinkPublicId) {
    throw new Error('encounter patient link does not match prescription patient link');
  }
  if (row.status === 'entered_in_error') throw new Error('prescription requires a valid encounter');
}

async function requireActivePractitioner(
  db: CanonicalBatchDatabase,
  tenantId: string,
  practitionerPublicId: string,
): Promise<void> {
  const row = await db.prepare(`
    SELECT status FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=?
    LIMIT 1
  `).bind(tenantId, practitionerPublicId).first<PractitionerRow>();
  if (!row || row.status !== 'active') throw new Error('prescription requires an active practitioner');
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
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(
    input.tenantId,
    input.entityType,
    input.sourceType,
    input.sourcePublicId,
  ).first<SourceMappingRow>();
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

async function requirePrescription(
  db: CanonicalBatchDatabase,
  tenantId: string,
  prescriptionPublicId: string,
): Promise<PrescriptionRow> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,encounter_public_id,prescribing_practitioner_public_id,
           current_version_public_id,current_status,status_version,authored_at_utc,finalized_at_utc
    FROM canonical_prescriptions
    WHERE tenant_id=? AND prescription_public_id=?
    LIMIT 1
  `).bind(tenantId, prescriptionPublicId).first<PrescriptionRow>();
  if (!row) throw new Error('prescription not found');
  return row;
}

async function requirePrescriptionVersion(
  db: CanonicalBatchDatabase,
  tenantId: string,
  prescriptionPublicId: string,
  versionPublicId: string,
): Promise<PrescriptionVersionRow> {
  const row = await db.prepare(`
    SELECT version_number,version_status
    FROM canonical_prescription_versions
    WHERE tenant_id=? AND prescription_public_id=? AND version_public_id=?
    LIMIT 1
  `).bind(tenantId, prescriptionPublicId, versionPublicId).first<PrescriptionVersionRow>();
  if (!row) throw new Error('prescription version not found');
  return row;
}

async function medicationOrderCount(
  db: CanonicalBatchDatabase,
  tenantId: string,
  prescriptionPublicId: string,
  versionPublicId: string,
  statuses?: readonly CanonicalMedicationOrderStatus[],
): Promise<number> {
  const statusClause = statuses?.length
    ? ` AND current_status IN (${statuses.map(() => '?').join(',')})`
    : '';
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM canonical_medication_orders
    WHERE tenant_id=? AND prescription_public_id=? AND prescription_version_public_id=?${statusClause}
  `).bind(tenantId, prescriptionPublicId, versionPublicId, ...(statuses ?? [])).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function medicationOrderInsertStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    patientLinkPublicId: string;
    encounterPublicId: string;
    prescribingPractitionerPublicId: string;
    prescriptionPublicId: string;
    prescriptionVersionPublicId: string;
    order: NormalizedMedicationOrder;
    currentStatus: 'draft' | 'active';
    idempotencyKey: string;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  const order = input.order;
  return db.prepare(`
    INSERT INTO canonical_medication_orders (
      tenant_id,medication_order_public_id,patient_link_public_id,encounter_public_id,
      prescribing_practitioner_public_id,prescription_public_id,prescription_version_public_id,
      medication_code_system,medication_code,medication_display,generic_display,
      strength_snapshot,dose_text,route_code,frequency_code,duration_text,instructions_text,
      priority,intended_start_utc,intended_end_utc,current_status,status_version,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)
  `).bind(
    input.tenantId,
    order.medicationOrderPublicId,
    input.patientLinkPublicId,
    input.encounterPublicId,
    input.prescribingPractitionerPublicId,
    input.prescriptionPublicId,
    input.prescriptionVersionPublicId,
    order.medicationCodeSystem,
    order.medicationCode,
    order.medicationDisplay,
    order.genericDisplay,
    order.strengthSnapshot,
    order.doseText,
    order.routeCode,
    order.frequencyCode,
    order.durationText,
    order.instructionsText,
    order.priority,
    order.intendedStartUtc,
    order.intendedEndUtc,
    input.currentStatus,
    input.idempotencyKey,
    order.requestFingerprintSha256,
    order.sourceEvidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

function medicationOrderEventStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    medicationOrderPublicId: string;
    fromStatus: CanonicalMedicationOrderStatus | null;
    toStatus: CanonicalMedicationOrderStatus;
    eventVersion: number;
    reasonCode: string;
    actor: NormalizedActor;
    idempotencyKey: string;
    sourceEvidenceSha256: string;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_medication_order_status_events (
      tenant_id,event_public_id,medication_order_public_id,from_status,to_status,
      event_version,reason_code,safe_note,actor_practitioner_public_id,
      actor_user_public_id,actor_system_key,idempotency_key,source_evidence_sha256,
      occurred_at_utc,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.eventPublicId,
    input.medicationOrderPublicId,
    input.fromStatus,
    input.toStatus,
    input.eventVersion,
    input.reasonCode,
    input.actor.actorPractitionerPublicId,
    input.actor.actorUserPublicId,
    input.actor.actorSystemKey,
    input.idempotencyKey,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

async function buildNewOrderStatements(
  db: CanonicalBatchDatabase,
  input: {
    base: NormalizedBase;
    prescription: Pick<
      PrescriptionRow,
      'patient_link_public_id' | 'encounter_public_id' | 'prescribing_practitioner_public_id'
    >;
    prescriptionPublicId: string;
    versionPublicId: string;
    orders: readonly NormalizedMedicationOrder[];
    status: 'draft' | 'active';
    reasonCode: string;
  },
): Promise<CanonicalPreparedStatement[]> {
  const statements: CanonicalPreparedStatement[] = [];
  for (let index = 0; index < input.orders.length; index += 1) {
    const order = input.orders[index];
    const orderIdempotencyKey = `${input.base.idempotencyKey}:order:${index + 1}`;
    const statusEventId = await createDeterministicSourceId(
      'rxosevt',
      input.base.tenantId,
      input.base.idempotencyKey,
      `${order.medicationOrderPublicId}:1`,
    );
    statements.push(
      medicationOrderInsertStatement(db, {
        tenantId: input.base.tenantId,
        patientLinkPublicId: input.prescription.patient_link_public_id,
        encounterPublicId: input.prescription.encounter_public_id,
        prescribingPractitionerPublicId: input.prescription.prescribing_practitioner_public_id,
        prescriptionPublicId: input.prescriptionPublicId,
        prescriptionVersionPublicId: input.versionPublicId,
        order,
        currentStatus: input.status,
        idempotencyKey: orderIdempotencyKey,
        occurredAtUtc: input.base.occurredAtUtc,
      }),
      medicationOrderEventStatement(db, {
        tenantId: input.base.tenantId,
        eventPublicId: statusEventId,
        medicationOrderPublicId: order.medicationOrderPublicId,
        fromStatus: null,
        toStatus: input.status,
        eventVersion: 1,
        reasonCode: input.reasonCode,
        actor: {
          actorPractitionerPublicId: input.prescription.prescribing_practitioner_public_id,
          actorUserPublicId: input.base.actorUserPublicId,
          actorSystemKey: input.base.actorSystemKey,
        },
        idempotencyKey: `${orderIdempotencyKey}:status:1`,
        sourceEvidenceSha256: order.sourceEvidenceSha256,
        occurredAtUtc: input.base.occurredAtUtc,
      }),
      sourceMappingStatement(db, {
        tenantId: input.base.tenantId,
        entityType: 'medication_order',
        canonicalPublicId: order.medicationOrderPublicId,
        sourceType: order.sourceType,
        sourcePublicId: order.sourcePublicId,
        sourceTable: order.sourceTable,
        evidenceSha256: order.sourceEvidenceSha256,
        occurredAtUtc: input.base.occurredAtUtc,
      }),
    );
  }
  return statements;
}

async function requireNewOrderMappings(
  db: CanonicalBatchDatabase,
  tenantId: string,
  orders: readonly NormalizedMedicationOrder[],
): Promise<void> {
  for (const order of orders) {
    await requireSourceMappingAvailable(db, {
      tenantId,
      entityType: 'medication_order',
      sourceType: order.sourceType,
      sourcePublicId: order.sourcePublicId,
      canonicalPublicId: order.medicationOrderPublicId,
    });
    const existing = await db.prepare(`
      SELECT medication_order_public_id
      FROM canonical_medication_orders
      WHERE tenant_id=? AND medication_order_public_id=?
      LIMIT 1
    `).bind(tenantId, order.medicationOrderPublicId).first<{ medication_order_public_id: string }>();
    if (existing) throw new Error('medicationOrderPublicId already exists');
  }
}

export async function createCanonicalPrescriptionDraft(
  db: CanonicalBatchDatabase,
  raw: CreateCanonicalPrescriptionDraftInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalPrescriptionCommandResult>> {
  const base = normalizeBase(raw, true);
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = lowercaseSha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const prescriptionPublicId = await deterministicId(
    'rx',
    base.tenantId,
    sourceType,
    sourcePublicId,
    raw.prescriptionPublicId,
    'prescriptionPublicId',
  );
  const versionSourcePublicId = `${sourcePublicId}:v1`;
  const versionPublicId = await deterministicId(
    'rxver',
    base.tenantId,
    sourceType,
    versionSourcePublicId,
    raw.versionPublicId,
    'versionPublicId',
  );
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const prescribingPractitionerPublicId = exact(
    raw.prescribingPractitionerPublicId,
    'prescribingPractitionerPublicId',
  );
  const authoredAtUtc = utc(raw.authoredAtUtc, 'authoredAtUtc');
  const contentSha256 = lowercaseSha256(raw.contentSha256, 'contentSha256');
  const medicationOrders = await normalizeMedicationOrders(base.tenantId, raw.medicationOrders);
  const request = {
    prescriptionPublicId,
    versionPublicId,
    patientLinkPublicId,
    encounterPublicId,
    prescribingPractitionerPublicId,
    authoredAtUtc,
    contentSha256,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    medicationOrders,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalPrescriptionCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: CREATE_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  await requirePatientLink(db, base.tenantId, patientLinkPublicId);
  await requireEncounterPatientLink(db, base.tenantId, encounterPublicId, patientLinkPublicId);
  await requireActivePractitioner(db, base.tenantId, prescribingPractitionerPublicId);
  const existing = await db.prepare(`
    SELECT prescription_public_id FROM canonical_prescriptions
    WHERE tenant_id=? AND prescription_public_id=? LIMIT 1
  `).bind(base.tenantId, prescriptionPublicId).first<{ prescription_public_id: string }>();
  if (existing) throw new Error('prescriptionPublicId already exists');
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'prescription',
    sourceType,
    sourcePublicId,
    canonicalPublicId: prescriptionPublicId,
  });
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'prescription_version',
    sourceType,
    sourcePublicId: versionSourcePublicId,
    canonicalPublicId: versionPublicId,
  });
  await requireNewOrderMappings(db, base.tenantId, medicationOrders);

  const requestFingerprintSha256 = await createRequestFingerprint(request);
  const resolvedOutboxEventId = await outboxEventId(
    base.tenantId,
    CREATE_COMMAND,
    base.idempotencyKey,
    raw.eventPublicId,
  );
  const result: CanonicalPrescriptionCommandResult = {
    prescriptionPublicId,
    currentVersionPublicId: versionPublicId,
    currentStatus: 'draft',
    statusVersion: 1,
    medicationOrderCount: medicationOrders.length,
  };
  const newOrderStatements = await buildNewOrderStatements(db, {
    base,
    prescription: {
      patient_link_public_id: patientLinkPublicId,
      encounter_public_id: encounterPublicId,
      prescribing_practitioner_public_id: prescribingPractitionerPublicId,
    },
    prescriptionPublicId,
    versionPublicId,
    orders: medicationOrders,
    status: 'draft',
    reasonCode: 'draft_created',
  });

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: CREATE_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_prescriptions (
          tenant_id,prescription_public_id,patient_link_public_id,encounter_public_id,
          prescribing_practitioner_public_id,current_version_public_id,current_status,
          status_version,authored_at_utc,finalized_at_utc,cancelled_at_utc,
          idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
          created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,NULL,'draft',1,?,NULL,NULL,?,?,?,?,?)
      `).bind(
        base.tenantId,
        prescriptionPublicId,
        patientLinkPublicId,
        encounterPublicId,
        prescribingPractitionerPublicId,
        authoredAtUtc,
        base.idempotencyKey,
        requestFingerprintSha256,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.occurredAtUtc,
      ),
      db.prepare(`
        INSERT INTO canonical_prescription_versions (
          tenant_id,version_public_id,prescription_public_id,version_number,
          supersedes_version_public_id,version_status,content_sha256,signed_snapshot_sha256,
          authored_at_utc,finalized_at_utc,authoring_practitioner_public_id,
          signing_practitioner_public_id,actor_user_public_id,actor_system_key,
          source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,1,NULL,'draft',?,NULL,?,NULL,?,NULL,?,?,?,?)
      `).bind(
        base.tenantId,
        versionPublicId,
        prescriptionPublicId,
        contentSha256,
        authoredAtUtc,
        prescribingPractitionerPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      ...newOrderStatements,
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'prescription',
        canonicalPublicId: prescriptionPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'prescription_version',
        canonicalPublicId: versionPublicId,
        sourceType,
        sourcePublicId: versionSourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      db.prepare(`
        UPDATE canonical_prescriptions
        SET current_version_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND prescription_public_id=?
          AND current_version_public_id IS NULL AND current_status='draft' AND status_version=1
      `).bind(
        versionPublicId,
        base.occurredAtUtc,
        base.tenantId,
        prescriptionPublicId,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_prescription',
      aggregatePublicId: prescriptionPublicId,
      eventType: 'canonical.prescription.draft-created',
      eventVersion: 1,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function replaceCanonicalPrescriptionDraft(
  db: CanonicalBatchDatabase,
  raw: ReplaceCanonicalPrescriptionDraftInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalPrescriptionCommandResult>> {
  const base = normalizeBase(raw, true);
  const prescriptionPublicId = exact(raw.prescriptionPublicId, 'prescriptionPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = lowercaseSha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const contentSha256 = lowercaseSha256(raw.contentSha256, 'contentSha256');
  const versionPublicId = await deterministicId(
    'rxver',
    base.tenantId,
    sourceType,
    sourcePublicId,
    raw.versionPublicId,
    'versionPublicId',
  );
  const medicationOrders = await normalizeMedicationOrders(base.tenantId, raw.medicationOrders);
  const request = {
    prescriptionPublicId,
    expectedVersion,
    versionPublicId,
    contentSha256,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    medicationOrders,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalPrescriptionCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: REPLACE_DRAFT_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const prescription = await requirePrescription(db, base.tenantId, prescriptionPublicId);
  if (Number(prescription.status_version) !== expectedVersion) {
    throw new Error(
      `expectedVersion ${expectedVersion} does not match current version ${prescription.status_version}`,
    );
  }
  if (prescription.current_status !== 'draft' || prescription.current_version_public_id == null) {
    throw new Error('replace requires a draft prescription');
  }
  const currentVersion = await requirePrescriptionVersion(
    db,
    base.tenantId,
    prescriptionPublicId,
    prescription.current_version_public_id,
  );
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'prescription_version',
    sourceType,
    sourcePublicId,
    canonicalPublicId: versionPublicId,
  });
  await requireNewOrderMappings(db, base.tenantId, medicationOrders);
  const existingVersion = await db.prepare(`
    SELECT version_public_id FROM canonical_prescription_versions
    WHERE tenant_id=? AND version_public_id=? LIMIT 1
  `).bind(base.tenantId, versionPublicId).first<{ version_public_id: string }>();
  if (existingVersion) throw new Error('versionPublicId already exists');

  const requestFingerprintSha256 = await createRequestFingerprint(request);
  const nextStatusVersion = expectedVersion + 1;
  const nextVersionNumber = Number(currentVersion.version_number) + 1;
  const result: CanonicalPrescriptionCommandResult = {
    prescriptionPublicId,
    currentVersionPublicId: versionPublicId,
    currentStatus: 'draft',
    statusVersion: nextStatusVersion,
    medicationOrderCount: medicationOrders.length,
  };
  const newOrderStatements = await buildNewOrderStatements(db, {
    base,
    prescription,
    prescriptionPublicId,
    versionPublicId,
    orders: medicationOrders,
    status: 'draft',
    reasonCode: 'draft_replaced',
  });
  const oldEventPrefix = await createDeterministicSourceId(
    'rxosevt',
    base.tenantId,
    REPLACE_DRAFT_COMMAND,
    base.idempotencyKey,
  );
  const resolvedOutboxEventId = await outboxEventId(
    base.tenantId,
    REPLACE_DRAFT_COMMAND,
    base.idempotencyKey,
    raw.eventPublicId,
  );

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: REPLACE_DRAFT_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_medication_order_status_events (
          tenant_id,event_public_id,medication_order_public_id,from_status,to_status,
          event_version,reason_code,safe_note,actor_practitioner_public_id,
          actor_user_public_id,actor_system_key,idempotency_key,source_evidence_sha256,
          occurred_at_utc,created_at_utc
        )
        SELECT tenant_id,? || ':' || medication_order_public_id,medication_order_public_id,
               current_status,'entered_in_error',status_version+1,'draft_replaced',NULL,
               prescribing_practitioner_public_id,?,?,? || ':' || medication_order_public_id,
               source_evidence_sha256,?,?
        FROM canonical_medication_orders
        WHERE tenant_id=? AND prescription_public_id=? AND prescription_version_public_id=?
          AND current_status='draft'
      `).bind(
        oldEventPrefix,
        base.actorUserPublicId,
        base.actorSystemKey,
        `${base.idempotencyKey}:old-order-entered-in-error`,
        base.occurredAtUtc,
        base.occurredAtUtc,
        base.tenantId,
        prescriptionPublicId,
        prescription.current_version_public_id,
      ),
      db.prepare(`
        UPDATE canonical_medication_orders
        SET current_status='entered_in_error',status_version=status_version+1,
            request_fingerprint_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND prescription_public_id=? AND prescription_version_public_id=?
          AND current_status='draft'
      `).bind(
        requestFingerprintSha256,
        base.occurredAtUtc,
        base.tenantId,
        prescriptionPublicId,
        prescription.current_version_public_id,
      ),
      db.prepare(`
        INSERT INTO canonical_prescription_versions (
          tenant_id,version_public_id,prescription_public_id,version_number,
          supersedes_version_public_id,version_status,content_sha256,signed_snapshot_sha256,
          authored_at_utc,finalized_at_utc,authoring_practitioner_public_id,
          signing_practitioner_public_id,actor_user_public_id,actor_system_key,
          source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,?,?,'draft',?,NULL,?,NULL,?,NULL,?,?,?,?)
      `).bind(
        base.tenantId,
        versionPublicId,
        prescriptionPublicId,
        nextVersionNumber,
        prescription.current_version_public_id,
        contentSha256,
        base.occurredAtUtc,
        prescription.prescribing_practitioner_public_id,
        base.actorUserPublicId,
        base.actorSystemKey,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      ...newOrderStatements,
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'prescription_version',
        canonicalPublicId: versionPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      db.prepare(`
        UPDATE canonical_prescriptions
        SET current_version_public_id=?,status_version=status_version+1,
            request_fingerprint_sha256=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND prescription_public_id=?
          AND current_status='draft' AND status_version=? AND current_version_public_id=?
      `).bind(
        versionPublicId,
        requestFingerprintSha256,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        prescriptionPublicId,
        expectedVersion,
        prescription.current_version_public_id,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_prescription',
      aggregatePublicId: prescriptionPublicId,
      eventType: 'canonical.prescription.draft-replaced',
      eventVersion: nextStatusVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function finalizeCanonicalPrescription(
  db: CanonicalBatchDatabase,
  raw: FinalizeCanonicalPrescriptionInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalPrescriptionCommandResult>> {
  const base = normalizeBase(raw);
  const prescriptionPublicId = exact(raw.prescriptionPublicId, 'prescriptionPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const signingPractitionerPublicId = exact(
    raw.actorPractitionerPublicId,
    'actorPractitionerPublicId',
  );
  const signedSnapshotSha256 = lowercaseSha256(
    raw.signedSnapshotSha256,
    'signedSnapshotSha256',
  );
  const sourceEvidenceSha256 = lowercaseSha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const request = {
    prescriptionPublicId,
    expectedVersion,
    signedSnapshotSha256,
    sourceEvidenceSha256,
    signingPractitionerPublicId,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalPrescriptionCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: FINALIZE_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const prescription = await requirePrescription(db, base.tenantId, prescriptionPublicId);
  if (Number(prescription.status_version) !== expectedVersion) {
    throw new Error(
      `expectedVersion ${expectedVersion} does not match current version ${prescription.status_version}`,
    );
  }
  if (prescription.current_status !== 'draft' || prescription.current_version_public_id == null) {
    throw new Error('finalize requires a draft prescription');
  }
  if (prescription.prescribing_practitioner_public_id !== signingPractitionerPublicId) {
    throw new Error('signing practitioner must match the prescribing practitioner');
  }
  await requireActivePractitioner(db, base.tenantId, signingPractitionerPublicId);
  const currentVersion = await requirePrescriptionVersion(
    db,
    base.tenantId,
    prescriptionPublicId,
    prescription.current_version_public_id,
  );
  if (currentVersion.version_status !== 'draft') {
    throw new Error('current prescription version is not draft');
  }
  const orderCount = await medicationOrderCount(
    db,
    base.tenantId,
    prescriptionPublicId,
    prescription.current_version_public_id,
    ['draft'],
  );
  if (orderCount <= 0) throw new Error('final prescription requires at least one medication order');

  const requestFingerprintSha256 = await createRequestFingerprint(request);
  const nextStatusVersion = expectedVersion + 1;
  const result: CanonicalPrescriptionCommandResult = {
    prescriptionPublicId,
    currentVersionPublicId: prescription.current_version_public_id,
    currentStatus: 'final',
    statusVersion: nextStatusVersion,
    medicationOrderCount: orderCount,
  };
  const orderEventPrefix = await createDeterministicSourceId(
    'rxosevt',
    base.tenantId,
    FINALIZE_COMMAND,
    base.idempotencyKey,
  );
  const resolvedOutboxEventId = await outboxEventId(
    base.tenantId,
    FINALIZE_COMMAND,
    base.idempotencyKey,
    raw.eventPublicId,
  );

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: FINALIZE_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_prescription_versions
        SET version_status='final',signed_snapshot_sha256=?,finalized_at_utc=?,
            signing_practitioner_public_id=?
        WHERE tenant_id=? AND prescription_public_id=? AND version_public_id=?
          AND version_status='draft' AND signed_snapshot_sha256 IS NULL
      `).bind(
        signedSnapshotSha256,
        base.occurredAtUtc,
        signingPractitionerPublicId,
        base.tenantId,
        prescriptionPublicId,
        prescription.current_version_public_id,
      ),
      db.prepare(`
        INSERT INTO canonical_medication_order_status_events (
          tenant_id,event_public_id,medication_order_public_id,from_status,to_status,
          event_version,reason_code,safe_note,actor_practitioner_public_id,
          actor_user_public_id,actor_system_key,idempotency_key,source_evidence_sha256,
          occurred_at_utc,created_at_utc
        )
        SELECT tenant_id,? || ':' || medication_order_public_id,medication_order_public_id,
               'draft','active',status_version+1,'prescription_finalized',NULL,?,?,?,
               ? || ':' || medication_order_public_id,source_evidence_sha256,?,?
        FROM canonical_medication_orders
        WHERE tenant_id=? AND prescription_public_id=? AND prescription_version_public_id=?
          AND current_status='draft'
      `).bind(
        orderEventPrefix,
        signingPractitionerPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        `${base.idempotencyKey}:order-activated`,
        base.occurredAtUtc,
        base.occurredAtUtc,
        base.tenantId,
        prescriptionPublicId,
        prescription.current_version_public_id,
      ),
      db.prepare(`
        UPDATE canonical_medication_orders
        SET current_status='active',status_version=status_version+1,
            request_fingerprint_sha256=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND prescription_public_id=? AND prescription_version_public_id=?
          AND current_status='draft'
      `).bind(
        requestFingerprintSha256,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        prescriptionPublicId,
        prescription.current_version_public_id,
      ),
      db.prepare(`
        UPDATE canonical_prescriptions
        SET current_status='final',status_version=status_version+1,finalized_at_utc=?,
            request_fingerprint_sha256=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND prescription_public_id=?
          AND current_status='draft' AND status_version=? AND current_version_public_id=?
      `).bind(
        base.occurredAtUtc,
        requestFingerprintSha256,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        prescriptionPublicId,
        expectedVersion,
        prescription.current_version_public_id,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_prescription',
      aggregatePublicId: prescriptionPublicId,
      eventType: 'canonical.prescription.finalized',
      eventVersion: nextStatusVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function amendCanonicalPrescription(
  db: CanonicalBatchDatabase,
  raw: AmendCanonicalPrescriptionInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalPrescriptionCommandResult>> {
  const base = normalizeBase(raw);
  const prescriptionPublicId = exact(raw.prescriptionPublicId, 'prescriptionPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const signingPractitionerPublicId = exact(
    raw.actorPractitionerPublicId,
    'actorPractitionerPublicId',
  );
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = lowercaseSha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const contentSha256 = lowercaseSha256(raw.contentSha256, 'contentSha256');
  const signedSnapshotSha256 = lowercaseSha256(
    raw.signedSnapshotSha256,
    'signedSnapshotSha256',
  );
  const versionPublicId = await deterministicId(
    'rxver',
    base.tenantId,
    sourceType,
    sourcePublicId,
    raw.versionPublicId,
    'versionPublicId',
  );
  const medicationOrders = await normalizeMedicationOrders(base.tenantId, raw.medicationOrders);
  if (medicationOrders.length <= 0) throw new Error('amendment requires at least one medication order');
  const request = {
    prescriptionPublicId,
    expectedVersion,
    versionPublicId,
    contentSha256,
    signedSnapshotSha256,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    medicationOrders,
    signingPractitionerPublicId,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalPrescriptionCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: AMEND_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const prescription = await requirePrescription(db, base.tenantId, prescriptionPublicId);
  if (Number(prescription.status_version) !== expectedVersion) {
    throw new Error(
      `expectedVersion ${expectedVersion} does not match current version ${prescription.status_version}`,
    );
  }
  if (!['final', 'amended'].includes(prescription.current_status) || prescription.current_version_public_id == null) {
    throw new Error('amend requires a final or amended prescription');
  }
  if (prescription.prescribing_practitioner_public_id !== signingPractitionerPublicId) {
    throw new Error('signing practitioner must match the prescribing practitioner');
  }
  await requireActivePractitioner(db, base.tenantId, signingPractitionerPublicId);
  const currentVersion = await requirePrescriptionVersion(
    db,
    base.tenantId,
    prescriptionPublicId,
    prescription.current_version_public_id,
  );
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    entityType: 'prescription_version',
    sourceType,
    sourcePublicId,
    canonicalPublicId: versionPublicId,
  });
  await requireNewOrderMappings(db, base.tenantId, medicationOrders);
  const existingVersion = await db.prepare(`
    SELECT version_public_id FROM canonical_prescription_versions
    WHERE tenant_id=? AND version_public_id=? LIMIT 1
  `).bind(base.tenantId, versionPublicId).first<{ version_public_id: string }>();
  if (existingVersion) throw new Error('versionPublicId already exists');

  const requestFingerprintSha256 = await createRequestFingerprint(request);
  const nextStatusVersion = expectedVersion + 1;
  const nextVersionNumber = Number(currentVersion.version_number) + 1;
  const result: CanonicalPrescriptionCommandResult = {
    prescriptionPublicId,
    currentVersionPublicId: versionPublicId,
    currentStatus: 'amended',
    statusVersion: nextStatusVersion,
    medicationOrderCount: medicationOrders.length,
  };
  const oldEventPrefix = await createDeterministicSourceId(
    'rxosevt',
    base.tenantId,
    AMEND_COMMAND,
    base.idempotencyKey,
  );
  const newOrderStatements = await buildNewOrderStatements(db, {
    base,
    prescription,
    prescriptionPublicId,
    versionPublicId,
    orders: medicationOrders,
    status: 'active',
    reasonCode: 'amendment_created',
  });
  const resolvedOutboxEventId = await outboxEventId(
    base.tenantId,
    AMEND_COMMAND,
    base.idempotencyKey,
    raw.eventPublicId,
  );

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: AMEND_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_medication_order_status_events (
          tenant_id,event_public_id,medication_order_public_id,from_status,to_status,
          event_version,reason_code,safe_note,actor_practitioner_public_id,
          actor_user_public_id,actor_system_key,idempotency_key,source_evidence_sha256,
          occurred_at_utc,created_at_utc
        )
        SELECT tenant_id,? || ':' || medication_order_public_id,medication_order_public_id,
               current_status,'stopped',status_version+1,'prescription_amended',NULL,?,?,?,
               ? || ':' || medication_order_public_id,source_evidence_sha256,?,?
        FROM canonical_medication_orders
        WHERE tenant_id=? AND prescription_public_id=? AND prescription_version_public_id=?
          AND current_status IN ('active','on_hold')
      `).bind(
        oldEventPrefix,
        signingPractitionerPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        `${base.idempotencyKey}:old-order-stopped`,
        base.occurredAtUtc,
        base.occurredAtUtc,
        base.tenantId,
        prescriptionPublicId,
        prescription.current_version_public_id,
      ),
      db.prepare(`
        UPDATE canonical_medication_orders
        SET current_status='stopped',status_version=status_version+1,
            request_fingerprint_sha256=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND prescription_public_id=? AND prescription_version_public_id=?
          AND current_status IN ('active','on_hold')
      `).bind(
        requestFingerprintSha256,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        prescriptionPublicId,
        prescription.current_version_public_id,
      ),
      db.prepare(`
        INSERT INTO canonical_prescription_versions (
          tenant_id,version_public_id,prescription_public_id,version_number,
          supersedes_version_public_id,version_status,content_sha256,signed_snapshot_sha256,
          authored_at_utc,finalized_at_utc,authoring_practitioner_public_id,
          signing_practitioner_public_id,actor_user_public_id,actor_system_key,
          source_evidence_sha256,created_at_utc
        ) VALUES (?,?,?,?,?,'amendment',?,?,?,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        versionPublicId,
        prescriptionPublicId,
        nextVersionNumber,
        prescription.current_version_public_id,
        contentSha256,
        signedSnapshotSha256,
        base.occurredAtUtc,
        base.occurredAtUtc,
        prescription.prescribing_practitioner_public_id,
        signingPractitionerPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      ...newOrderStatements,
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        entityType: 'prescription_version',
        canonicalPublicId: versionPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      db.prepare(`
        UPDATE canonical_prescriptions
        SET current_version_public_id=?,current_status='amended',
            status_version=status_version+1,finalized_at_utc=?,
            request_fingerprint_sha256=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND prescription_public_id=?
          AND current_status IN ('final','amended') AND status_version=?
          AND current_version_public_id=?
      `).bind(
        versionPublicId,
        base.occurredAtUtc,
        requestFingerprintSha256,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        prescriptionPublicId,
        expectedVersion,
        prescription.current_version_public_id,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_prescription',
      aggregatePublicId: prescriptionPublicId,
      eventType: 'canonical.prescription.amended',
      eventVersion: nextStatusVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function transitionCanonicalMedicationOrder(
  db: CanonicalBatchDatabase,
  raw: TransitionCanonicalMedicationOrderInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalMedicationOrderCommandResult>> {
  const base = normalizeBase(raw);
  const medicationOrderPublicId = exact(raw.medicationOrderPublicId, 'medicationOrderPublicId');
  const toStatus = medicationStatus(raw.toStatus);
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = lowercaseSha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const request = {
    medicationOrderPublicId,
    toStatus,
    expectedVersion,
    reasonCode,
    sourceEvidenceSha256,
    actorPractitionerPublicId: base.actorPractitionerPublicId,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalMedicationOrderCommandResult>(db, {
    tenantId: base.tenantId,
    commandName: TRANSITION_ORDER_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const current = await db.prepare(`
    SELECT prescription_public_id,prescription_version_public_id,current_status,status_version
    FROM canonical_medication_orders
    WHERE tenant_id=? AND medication_order_public_id=?
    LIMIT 1
  `).bind(base.tenantId, medicationOrderPublicId).first<MedicationOrderRow>();
  if (!current) throw new Error('medication order not found');
  if (Number(current.status_version) !== expectedVersion) {
    throw new Error(
      `expectedVersion ${expectedVersion} does not match current version ${current.status_version}`,
    );
  }
  const fromStatus = medicationStatus(current.current_status);
  if (!MEDICATION_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new Error(`transition ${fromStatus} -> ${toStatus} is not allowed`);
  }
  if (base.actorPractitionerPublicId != null) {
    await requireActivePractitioner(db, base.tenantId, base.actorPractitionerPublicId);
  }

  const requestFingerprintSha256 = await createRequestFingerprint(request);
  const nextVersion = expectedVersion + 1;
  const statusEventId = await createDeterministicSourceId(
    'rxosevt',
    base.tenantId,
    TRANSITION_ORDER_COMMAND,
    base.idempotencyKey,
  );
  const resolvedOutboxEventId = await outboxEventId(
    base.tenantId,
    TRANSITION_ORDER_COMMAND,
    base.idempotencyKey,
    raw.eventPublicId,
  );
  const result: CanonicalMedicationOrderCommandResult = {
    medicationOrderPublicId,
    currentStatus: toStatus,
    statusVersion: nextVersion,
  };

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: TRANSITION_ORDER_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_medication_orders
        SET current_status=?,status_version=status_version+1,
            request_fingerprint_sha256=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND medication_order_public_id=?
          AND current_status=? AND status_version=?
      `).bind(
        toStatus,
        requestFingerprintSha256,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        medicationOrderPublicId,
        fromStatus,
        expectedVersion,
      ),
      medicationOrderEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: statusEventId,
        medicationOrderPublicId,
        fromStatus,
        toStatus,
        eventVersion: nextVersion,
        reasonCode,
        actor: base,
        idempotencyKey: `${base.idempotencyKey}:status`,
        sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_medication_order',
      aggregatePublicId: medicationOrderPublicId,
      eventType: `canonical.medication-order.${toStatus}`,
      eventVersion: nextVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function recordCanonicalPrescriptionSafetyEvent(
  db: CanonicalBatchDatabase,
  raw: RecordCanonicalPrescriptionSafetyEventInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalPrescriptionSafetyEventResult>> {
  const base = normalizeBase(raw);
  const prescriptionPublicId = exact(raw.prescriptionPublicId, 'prescriptionPublicId');
  const prescriptionVersionPublicId = optionalExact(
    raw.prescriptionVersionPublicId,
    'prescriptionVersionPublicId',
  );
  const medicationOrderPublicId = optionalExact(raw.medicationOrderPublicId, 'medicationOrderPublicId');
  const eventType = safetyEventType(raw.eventType);
  const outcome = safetyOutcome(raw.outcome);
  const severity = safetySeverity(raw.severity);
  const evidenceCode = exact(raw.evidenceCode, 'evidenceCode');
  const sourceEvidenceSha256 = lowercaseSha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  if (['override', 'waiver'].includes(eventType)) {
    if (outcome !== 'overridden' || base.actorPractitionerPublicId == null) {
      throw new Error('override or waiver requires overridden outcome and an actor practitioner');
    }
  }
  const eventPublicId = raw.eventPublicId == null
    ? await createDeterministicSourceId('rxsafe', base.tenantId, RECORD_SAFETY_COMMAND, base.idempotencyKey)
    : exact(raw.eventPublicId, 'eventPublicId');
  const resolvedOutboxEventId = await outboxEventId(
    base.tenantId,
    RECORD_SAFETY_COMMAND,
    base.idempotencyKey,
    raw.outboxEventPublicId,
  );
  const request = {
    eventPublicId,
    prescriptionPublicId,
    prescriptionVersionPublicId,
    medicationOrderPublicId,
    eventType,
    outcome,
    severity,
    evidenceCode,
    sourceEvidenceSha256,
    actorPractitionerPublicId: base.actorPractitionerPublicId,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalPrescriptionSafetyEventResult>(db, {
    tenantId: base.tenantId,
    commandName: RECORD_SAFETY_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  await requirePrescription(db, base.tenantId, prescriptionPublicId);
  if (prescriptionVersionPublicId != null) {
    await requirePrescriptionVersion(
      db,
      base.tenantId,
      prescriptionPublicId,
      prescriptionVersionPublicId,
    );
  }
  if (medicationOrderPublicId != null) {
    const order = await db.prepare(`
      SELECT prescription_public_id,prescription_version_public_id,current_status,status_version
      FROM canonical_medication_orders
      WHERE tenant_id=? AND medication_order_public_id=?
      LIMIT 1
    `).bind(base.tenantId, medicationOrderPublicId).first<MedicationOrderRow>();
    if (!order) throw new Error('medication order not found');
    if (order.prescription_public_id !== prescriptionPublicId) {
      throw new Error('safety event medication order does not belong to prescription');
    }
    if (
      prescriptionVersionPublicId != null
      && order.prescription_version_public_id !== prescriptionVersionPublicId
    ) {
      throw new Error('safety event medication order does not belong to prescription version');
    }
  }
  if (base.actorPractitionerPublicId != null) {
    await requireActivePractitioner(db, base.tenantId, base.actorPractitionerPublicId);
  }

  const result: CanonicalPrescriptionSafetyEventResult = {
    eventPublicId,
    prescriptionPublicId,
    eventType,
    outcome,
  };
  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: RECORD_SAFETY_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_prescription_safety_events (
          tenant_id,event_public_id,prescription_public_id,prescription_version_public_id,
          medication_order_public_id,event_type,outcome,severity,evidence_code,
          actor_practitioner_public_id,actor_user_public_id,actor_system_key,
          idempotency_key,source_evidence_sha256,occurred_at_utc,created_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        eventPublicId,
        prescriptionPublicId,
        prescriptionVersionPublicId,
        medicationOrderPublicId,
        eventType,
        outcome,
        severity,
        evidenceCode,
        base.actorPractitionerPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        base.idempotencyKey,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.occurredAtUtc,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_prescription',
      aggregatePublicId: prescriptionPublicId,
      eventType: 'canonical.prescription.safety-recorded',
      eventVersion: 1,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}
