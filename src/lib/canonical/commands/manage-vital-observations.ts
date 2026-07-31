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

export type CanonicalVitalSourceKind =
  | 'practitioner_entered'
  | 'nurse_entered'
  | 'patient_reported'
  | 'device_imported'
  | 'system_derived'
  | 'legacy_backfill';

export type CanonicalVitalReviewStatus =
  | 'pending_review'
  | 'verified'
  | 'rejected'
  | 'superseded'
  | 'entered_in_error';

export type CanonicalVitalMeasurementCode =
  | 'body_temperature'
  | 'heart_rate'
  | 'respiratory_rate'
  | 'oxygen_saturation'
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic'
  | 'body_weight'
  | 'body_height'
  | 'body_mass_index'
  | 'pain_score'
  | 'blood_glucose';

interface CommandActorInput {
  actorUserPublicId?: string | null;
  actorSystemKey?: string | null;
}

interface CommandBaseInput extends CommandActorInput {
  tenantId: string;
  idempotencyKey: string;
  eventPublicId?: string;
  occurredAtUtc: string;
  businessDate: string;
}

interface SourceInput {
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
}

export interface CanonicalVitalComponentInput {
  componentPublicId?: string;
  measurementCode: CanonicalVitalMeasurementCode;
  numericValue: number;
  unitCode: string;
  methodCode?: string | null;
  bodySiteCode?: string | null;
  postureCode?: string | null;
  lateralityCode?: string | null;
  fastingContextCode?: string | null;
  referenceLow?: number | null;
  referenceHigh?: number | null;
  alertLevel?: 'normal' | 'low' | 'high' | 'critical' | null;
  sourceEvidenceSha256: string;
}

export interface RecordCanonicalVitalObservationSetInput extends CommandBaseInput, SourceInput {
  observationSetPublicId?: string;
  patientLinkPublicId: string;
  encounterPublicId?: string | null;
  practitionerPublicId?: string | null;
  sourceKind: CanonicalVitalSourceKind;
  externalDeviceSourceType?: string | null;
  externalDeviceSourcePublicId?: string | null;
  effectiveAtUtc: string;
  recordedAtUtc: string;
  components: CanonicalVitalComponentInput[];
}

export interface ReviewCanonicalVitalObservationSetInput extends CommandBaseInput {
  observationSetPublicId: string;
  expectedVersion: number;
  reviewerPractitionerPublicId: string;
  toReviewStatus: 'verified' | 'rejected';
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface CorrectCanonicalVitalObservationSetInput extends CommandBaseInput, SourceInput {
  observationSetPublicId: string;
  expectedVersion: number;
  replacementObservationSetPublicId?: string;
  correctingPractitionerPublicId: string;
  effectiveAtUtc: string;
  recordedAtUtc: string;
  components: CanonicalVitalComponentInput[];
  reasonCode: string;
}

export interface EnterCanonicalVitalObservationSetInErrorInput extends CommandBaseInput {
  observationSetPublicId: string;
  expectedVersion: number;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface CanonicalVitalObservationSetResult {
  observationSetPublicId: string;
  reviewStatus: CanonicalVitalReviewStatus;
  statusVersion: number;
}

export interface CanonicalVitalRecordResult extends CanonicalVitalObservationSetResult {
  componentCount: number;
  derivedComponentCount: number;
}

export interface CanonicalVitalCorrectionResult extends CanonicalVitalObservationSetResult {
  replacementObservationSetPublicId: string;
  replacementReviewStatus: 'pending_review';
  replacementStatusVersion: 1;
}

interface NormalizedActor {
  actorUserPublicId: string | null;
  actorSystemKey: string | null;
}

interface NormalizedBase extends NormalizedActor {
  tenantId: string;
  idempotencyKey: string;
  occurredAtUtc: string;
  businessDate: string;
}

interface ObservationSetRow {
  patient_link_public_id: string;
  encounter_public_id: string | null;
  practitioner_public_id: string | null;
  source_kind: CanonicalVitalSourceKind;
  review_status: CanonicalVitalReviewStatus;
  status_version: number;
}

interface SourceMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface NormalizedComponent {
  componentPublicId: string;
  componentSequence: number;
  measurementCode: CanonicalVitalMeasurementCode;
  numericValue: number;
  canonicalUnitCode: string;
  sourceNumericValue: number | null;
  sourceUnitCode: string | null;
  methodCode: string | null;
  bodySiteCode: string | null;
  postureCode: string | null;
  lateralityCode: string | null;
  fastingContextCode: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  alertLevel: 'normal' | 'low' | 'high' | 'critical' | null;
  isDerived: 0 | 1;
  derivationFormulaKey: string | null;
  derivationFormulaVersion: string | null;
  sourceEvidenceSha256: string;
}

const RECORD = 'recordCanonicalVitalObservationSet';
const REVIEW = 'reviewCanonicalVitalObservationSet';
const CORRECT = 'correctCanonicalVitalObservationSet';
const ENTER_ERROR = 'enterCanonicalVitalObservationSetInError';

const CANONICAL_UNITS: Record<Exclude<CanonicalVitalMeasurementCode, 'body_temperature' | 'body_mass_index'>, string> = {
  heart_rate: '/min',
  respiratory_rate: '/min',
  oxygen_saturation: '%',
  blood_pressure_systolic: 'mm[Hg]',
  blood_pressure_diastolic: 'mm[Hg]',
  body_weight: 'kg',
  body_height: 'cm',
  pain_score: '{score}',
  blood_glucose: 'mg/dL',
};

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
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function nullableFinite(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  return finite(value, label);
}

function normalizeActor(raw: CommandActorInput): NormalizedActor {
  const actorUserPublicId = optionalExact(raw.actorUserPublicId, 'actorUserPublicId');
  const actorSystemKey = optionalExact(raw.actorSystemKey, 'actorSystemKey');
  if (actorUserPublicId == null && actorSystemKey == null) {
    throw new TypeError('actorUserPublicId or actorSystemKey is required');
  }
  return { actorUserPublicId, actorSystemKey };
}

function normalizeBase(raw: CommandBaseInput): NormalizedBase {
  return {
    tenantId: exact(raw.tenantId, 'tenantId'),
    idempotencyKey: exact(raw.idempotencyKey, 'idempotencyKey'),
    occurredAtUtc: utc(raw.occurredAtUtc, 'occurredAtUtc'),
    businessDate: exact(raw.businessDate, 'businessDate'),
    ...normalizeActor(raw),
  };
}

function round(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  const rounded = Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function validateRange(code: CanonicalVitalMeasurementCode, value: number): void {
  const valid = (() => {
    switch (code) {
      case 'body_temperature': return value >= 20 && value <= 50;
      case 'heart_rate': return value >= 1 && value <= 350;
      case 'respiratory_rate': return value >= 1 && value <= 150;
      case 'oxygen_saturation': return value >= 0 && value <= 100;
      case 'blood_pressure_systolic': return value >= 20 && value <= 350;
      case 'blood_pressure_diastolic': return value >= 10 && value <= 250;
      case 'body_weight': return value > 0 && value <= 1000;
      case 'body_height': return value > 0 && value <= 300;
      case 'body_mass_index': return value > 0 && value <= 200;
      case 'pain_score': return Number.isInteger(value) && value >= 0 && value <= 10;
      case 'blood_glucose': return value > 0 && value <= 3000;
    }
  })();
  if (!valid) throw new RangeError(`${code} numericValue is outside the supported range`);
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

async function lifecycleEventId(
  tenantId: string,
  commandName: string,
  idempotencyKey: string,
  suffix: string,
): Promise<string> {
  return createDeterministicSourceId('vitalevt', tenantId, commandName, `${idempotencyKey}:${suffix}`);
}

async function requirePatientLink(db: CanonicalBatchDatabase, tenantId: string, patientLinkPublicId: string): Promise<void> {
  const row = await db.prepare(`
    SELECT link_status,effective_to_utc FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(tenantId, patientLinkPublicId).first<{ link_status: string; effective_to_utc: string | null }>();
  if (!row) throw new Error('patient link not found');
  if (row.link_status === 'rejected' || row.link_status === 'retired' || row.effective_to_utc != null) {
    throw new Error('vital observation requires an active patient link');
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
  if (row.status === 'entered_in_error') throw new Error('vital observation requires a valid encounter');
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
  if (!row || row.status !== 'active') throw new Error('vital observation requires an active practitioner');
}

async function requireObservationSet(
  db: CanonicalBatchDatabase,
  tenantId: string,
  observationSetPublicId: string,
): Promise<ObservationSetRow> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,encounter_public_id,practitioner_public_id,
           source_kind,review_status,status_version
    FROM canonical_vital_observation_sets
    WHERE tenant_id=? AND observation_set_public_id=? LIMIT 1
  `).bind(tenantId, observationSetPublicId).first<ObservationSetRow>();
  if (!row) throw new Error('canonical vital observation set not found');
  return row;
}

async function requireSourceMappingAvailable(
  db: CanonicalBatchDatabase,
  input: { tenantId: string; sourceType: string; sourcePublicId: string; canonicalPublicId: string },
): Promise<void> {
  const row = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='vital_observation_set'
      AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(input.tenantId, input.sourceType, input.sourcePublicId).first<SourceMappingRow>();
  if (!row) return;
  if (row.mapping_status !== 'mapped' || row.canonical_public_id !== input.canonicalPublicId) {
    throw new Error('vital observation source mapping already belongs to another canonical record');
  }
  throw new Error('vital observation source mapping already exists without replay evidence');
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
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
    ) VALUES (?,'vital_observation_set',?,?,?,?,'mapped',1,NULL,?,?,?)
  `).bind(
    input.tenantId,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.evidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

async function normalizeComponents(
  input: {
    tenantId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceEvidenceSha256: string;
    components: CanonicalVitalComponentInput[];
  },
): Promise<NormalizedComponent[]> {
  if (!Array.isArray(input.components) || input.components.length === 0) {
    throw new TypeError('at least one vital component is required');
  }
  const seen = new Set<CanonicalVitalMeasurementCode>();
  const normalized: NormalizedComponent[] = [];

  for (const [index, raw] of input.components.entries()) {
    const measurementCode = exact(raw.measurementCode, `components[${index}].measurementCode`) as CanonicalVitalMeasurementCode;
    if (seen.has(measurementCode)) throw new TypeError(`duplicate vital measurement code: ${measurementCode}`);
    seen.add(measurementCode);
    if (measurementCode === 'body_mass_index') {
      throw new TypeError('BMI must be derived from canonical weight and height components');
    }
    const suppliedValue = finite(raw.numericValue, `components[${index}].numericValue`);
    const suppliedUnit = exact(raw.unitCode, `components[${index}].unitCode`);
    let numericValue = suppliedValue;
    let canonicalUnitCode: string;
    let sourceNumericValue: number | null = null;
    let sourceUnitCode: string | null = null;

    if (measurementCode === 'body_temperature') {
      canonicalUnitCode = 'Cel';
      if (suppliedUnit === 'Cel') {
        numericValue = suppliedValue;
      } else if (suppliedUnit === '[degF]') {
        numericValue = round((suppliedValue - 32) * 5 / 9, 4);
        sourceNumericValue = suppliedValue;
        sourceUnitCode = suppliedUnit;
      } else {
        throw new TypeError('body_temperature unit must be Cel or [degF]');
      }
    } else {
      canonicalUnitCode = CANONICAL_UNITS[measurementCode];
      if (suppliedUnit !== canonicalUnitCode) {
        throw new TypeError(`${measurementCode} unit must be ${canonicalUnitCode}`);
      }
    }
    validateRange(measurementCode, numericValue);
    const referenceLow = nullableFinite(raw.referenceLow, `components[${index}].referenceLow`);
    const referenceHigh = nullableFinite(raw.referenceHigh, `components[${index}].referenceHigh`);
    if (referenceLow != null && referenceHigh != null && referenceLow > referenceHigh) {
      throw new RangeError(`components[${index}] referenceLow cannot exceed referenceHigh`);
    }
    normalized.push({
      componentPublicId: await deterministicId(
        'vitalcmp',
        input.tenantId,
        input.sourceType,
        `${input.sourcePublicId}:${measurementCode}`,
        raw.componentPublicId,
        `components[${index}].componentPublicId`,
      ),
      componentSequence: normalized.length + 1,
      measurementCode,
      numericValue,
      canonicalUnitCode,
      sourceNumericValue,
      sourceUnitCode,
      methodCode: optionalExact(raw.methodCode, `components[${index}].methodCode`),
      bodySiteCode: optionalExact(raw.bodySiteCode, `components[${index}].bodySiteCode`),
      postureCode: optionalExact(raw.postureCode, `components[${index}].postureCode`),
      lateralityCode: optionalExact(raw.lateralityCode, `components[${index}].lateralityCode`),
      fastingContextCode: optionalExact(raw.fastingContextCode, `components[${index}].fastingContextCode`),
      referenceLow,
      referenceHigh,
      alertLevel: raw.alertLevel ?? null,
      isDerived: 0,
      derivationFormulaKey: null,
      derivationFormulaVersion: null,
      sourceEvidenceSha256: sha256(raw.sourceEvidenceSha256, `components[${index}].sourceEvidenceSha256`),
    });
  }

  const hasSystolic = seen.has('blood_pressure_systolic');
  const hasDiastolic = seen.has('blood_pressure_diastolic');
  if (hasSystolic !== hasDiastolic) throw new TypeError('paired blood pressure requires systolic and diastolic components');

  const weight = normalized.find((component) => component.measurementCode === 'body_weight');
  const height = normalized.find((component) => component.measurementCode === 'body_height');
  if (weight && height) {
    const bmi = round(weight.numericValue / ((height.numericValue / 100) ** 2), 4);
    validateRange('body_mass_index', bmi);
    normalized.push({
      componentPublicId: await deterministicId(
        'vitalcmp',
        input.tenantId,
        input.sourceType,
        `${input.sourcePublicId}:body_mass_index`,
        undefined,
        'derivedBmiComponentPublicId',
      ),
      componentSequence: normalized.length + 1,
      measurementCode: 'body_mass_index',
      numericValue: bmi,
      canonicalUnitCode: 'kg/m2',
      sourceNumericValue: null,
      sourceUnitCode: null,
      methodCode: null,
      bodySiteCode: null,
      postureCode: null,
      lateralityCode: null,
      fastingContextCode: null,
      referenceLow: null,
      referenceHigh: null,
      alertLevel: null,
      isDerived: 1,
      derivationFormulaKey: 'bmi_weight_kg_height_m_v1',
      derivationFormulaVersion: '1',
      sourceEvidenceSha256: input.sourceEvidenceSha256,
    });
  }
  return normalized;
}

function componentStatement(
  db: CanonicalBatchDatabase,
  tenantId: string,
  observationSetPublicId: string,
  component: NormalizedComponent,
  occurredAtUtc: string,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_vital_observation_components (
      tenant_id,component_public_id,observation_set_public_id,component_sequence,
      measurement_code,numeric_value,canonical_unit_code,source_numeric_value,
      source_unit_code,method_code,body_site_code,posture_code,laterality_code,
      fasting_context_code,reference_low,reference_high,alert_level,is_derived,
      derivation_formula_key,derivation_formula_version,source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    tenantId,
    component.componentPublicId,
    observationSetPublicId,
    component.componentSequence,
    component.measurementCode,
    component.numericValue,
    component.canonicalUnitCode,
    component.sourceNumericValue,
    component.sourceUnitCode,
    component.methodCode,
    component.bodySiteCode,
    component.postureCode,
    component.lateralityCode,
    component.fastingContextCode,
    component.referenceLow,
    component.referenceHigh,
    component.alertLevel,
    component.isDerived,
    component.derivationFormulaKey,
    component.derivationFormulaVersion,
    component.sourceEvidenceSha256,
    occurredAtUtc,
  );
}

function statusEventStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    observationSetPublicId: string;
    fromReviewStatus: CanonicalVitalReviewStatus | null;
    toReviewStatus: CanonicalVitalReviewStatus;
    eventVersion: number;
    eventType: 'recorded' | 'verified' | 'rejected' | 'superseded' | 'entered_in_error';
    reasonCode: string;
    actorPractitionerPublicId: string | null;
    actorUserPublicId: string | null;
    actorSystemKey: string | null;
    occurredAtUtc: string;
    sourceEvidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_vital_observation_status_events (
      tenant_id,event_public_id,observation_set_public_id,from_review_status,
      to_review_status,event_version,event_type,reason_code,actor_practitioner_public_id,
      actor_user_public_id,actor_system_key,occurred_at_utc,source_evidence_sha256,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.eventPublicId,
    input.observationSetPublicId,
    input.fromReviewStatus,
    input.toReviewStatus,
    input.eventVersion,
    input.eventType,
    input.reasonCode,
    input.actorPractitionerPublicId,
    input.actorUserPublicId,
    input.actorSystemKey,
    input.occurredAtUtc,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
  );
}

export async function recordCanonicalVitalObservationSet(
  db: CanonicalBatchDatabase,
  raw: RecordCanonicalVitalObservationSetInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalVitalRecordResult>> {
  const base = normalizeBase(raw);
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const observationSetPublicId = await deterministicId(
    'vitalset', base.tenantId, sourceType, sourcePublicId,
    raw.observationSetPublicId, 'observationSetPublicId',
  );
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const encounterPublicId = optionalExact(raw.encounterPublicId, 'encounterPublicId');
  const practitionerPublicId = optionalExact(raw.practitionerPublicId, 'practitionerPublicId');
  const sourceKind = raw.sourceKind;
  const externalDeviceSourceType = optionalExact(raw.externalDeviceSourceType, 'externalDeviceSourceType');
  const externalDeviceSourcePublicId = optionalExact(raw.externalDeviceSourcePublicId, 'externalDeviceSourcePublicId');
  const effectiveAtUtc = utc(raw.effectiveAtUtc, 'effectiveAtUtc');
  const recordedAtUtc = utc(raw.recordedAtUtc, 'recordedAtUtc');
  if (recordedAtUtc < effectiveAtUtc) throw new RangeError('recordedAtUtc cannot precede effectiveAtUtc');
  if ((externalDeviceSourceType == null) !== (externalDeviceSourcePublicId == null)) {
    throw new TypeError('external device source type and public ID must be provided together');
  }
  if (sourceKind === 'device_imported' && externalDeviceSourceType == null) {
    throw new TypeError('device_imported observations require exact external device source identity');
  }
  if ((sourceKind === 'practitioner_entered' || sourceKind === 'nurse_entered') && practitionerPublicId == null) {
    throw new TypeError(`${sourceKind} observations require practitionerPublicId`);
  }
  const components = await normalizeComponents({
    tenantId: base.tenantId,
    sourceType,
    sourcePublicId,
    sourceEvidenceSha256,
    components: raw.components,
  });
  const request = {
    observationSetPublicId,
    patientLinkPublicId,
    encounterPublicId,
    practitionerPublicId,
    sourceKind,
    externalDeviceSourceType,
    externalDeviceSourcePublicId,
    effectiveAtUtc,
    recordedAtUtc,
    components,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalVitalRecordResult>(db, {
    tenantId: base.tenantId,
    commandName: RECORD,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  await requirePatientLink(db, base.tenantId, patientLinkPublicId);
  if (encounterPublicId != null) await requireEncounterScope(db, base.tenantId, encounterPublicId, patientLinkPublicId);
  if (practitionerPublicId != null) await requireActivePractitioner(db, base.tenantId, practitionerPublicId);
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    sourceType,
    sourcePublicId,
    canonicalPublicId: observationSetPublicId,
  });
  const fingerprint = await createRequestFingerprint(request);
  const result: CanonicalVitalRecordResult = {
    observationSetPublicId,
    reviewStatus: 'pending_review',
    statusVersion: 1,
    componentCount: components.length,
    derivedComponentCount: components.filter((component) => component.isDerived === 1).length,
  };
  const resolvedOutboxEventId = await outboxEventId(base.tenantId, RECORD, base.idempotencyKey, raw.eventPublicId);
  const recordedEventPublicId = await lifecycleEventId(base.tenantId, RECORD, base.idempotencyKey, 'recorded');

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: RECORD,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_vital_observation_sets (
          tenant_id,observation_set_public_id,patient_link_public_id,encounter_public_id,
          practitioner_public_id,source_kind,external_device_source_type,
          external_device_source_public_id,effective_at_utc,recorded_at_utc,review_status,
          status_version,supersedes_observation_set_public_id,actor_user_public_id,
          actor_system_key,idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
          created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,'pending_review',1,NULL,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        observationSetPublicId,
        patientLinkPublicId,
        encounterPublicId,
        practitionerPublicId,
        sourceKind,
        externalDeviceSourceType,
        externalDeviceSourcePublicId,
        effectiveAtUtc,
        recordedAtUtc,
        base.actorUserPublicId,
        base.actorSystemKey,
        base.idempotencyKey,
        fingerprint,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.occurredAtUtc,
      ),
      ...components.map((component) => componentStatement(
        db, base.tenantId, observationSetPublicId, component, base.occurredAtUtc,
      )),
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: recordedEventPublicId,
        observationSetPublicId,
        fromReviewStatus: null,
        toReviewStatus: 'pending_review',
        eventVersion: 1,
        eventType: 'recorded',
        reasonCode: 'recorded',
        actorPractitionerPublicId: practitionerPublicId,
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        occurredAtUtc: base.occurredAtUtc,
        sourceEvidenceSha256,
      }),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        canonicalPublicId: observationSetPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_vital_observation_set',
      aggregatePublicId: observationSetPublicId,
      eventType: 'canonical.vital-observation.recorded',
      eventVersion: 1,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function reviewCanonicalVitalObservationSet(
  db: CanonicalBatchDatabase,
  raw: ReviewCanonicalVitalObservationSetInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalVitalObservationSetResult>> {
  const base = normalizeBase(raw);
  const observationSetPublicId = exact(raw.observationSetPublicId, 'observationSetPublicId');
  const expectedVersion = positiveInteger(raw.expectedVersion, 'expectedVersion');
  const reviewerPractitionerPublicId = exact(raw.reviewerPractitionerPublicId, 'reviewerPractitionerPublicId');
  const toReviewStatus = raw.toReviewStatus;
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const request = {
    observationSetPublicId,
    expectedVersion,
    reviewerPractitionerPublicId,
    toReviewStatus,
    reasonCode,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalVitalObservationSetResult>(db, {
    tenantId: base.tenantId,
    commandName: REVIEW,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const observation = await requireObservationSet(db, base.tenantId, observationSetPublicId);
  if (Number(observation.status_version) !== expectedVersion) throw new Error('canonical vital observation version conflict');
  if (observation.review_status !== 'pending_review') throw new Error('review requires a pending observation set');
  await requireActivePractitioner(db, base.tenantId, reviewerPractitionerPublicId);
  const nextVersion = expectedVersion + 1;
  const result: CanonicalVitalObservationSetResult = {
    observationSetPublicId,
    reviewStatus: toReviewStatus,
    statusVersion: nextVersion,
  };
  const resolvedOutboxEventId = await outboxEventId(base.tenantId, REVIEW, base.idempotencyKey, raw.eventPublicId);
  const statusEventPublicId = await lifecycleEventId(base.tenantId, REVIEW, base.idempotencyKey, toReviewStatus);

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: REVIEW,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: statusEventPublicId,
        observationSetPublicId,
        fromReviewStatus: 'pending_review',
        toReviewStatus,
        eventVersion: nextVersion,
        eventType: toReviewStatus,
        reasonCode,
        actorPractitionerPublicId: reviewerPractitionerPublicId,
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        occurredAtUtc: base.occurredAtUtc,
        sourceEvidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_vital_observation_sets
        SET review_status=?,status_version=?,updated_at_utc=?
        WHERE tenant_id=? AND observation_set_public_id=?
          AND review_status='pending_review' AND status_version=?
      `).bind(
        toReviewStatus,
        nextVersion,
        base.occurredAtUtc,
        base.tenantId,
        observationSetPublicId,
        expectedVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_vital_observation_set',
      aggregatePublicId: observationSetPublicId,
      eventType: `canonical.vital-observation.${toReviewStatus}`,
      eventVersion: nextVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function correctCanonicalVitalObservationSet(
  db: CanonicalBatchDatabase,
  raw: CorrectCanonicalVitalObservationSetInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalVitalCorrectionResult>> {
  const base = normalizeBase(raw);
  const observationSetPublicId = exact(raw.observationSetPublicId, 'observationSetPublicId');
  const expectedVersion = positiveInteger(raw.expectedVersion, 'expectedVersion');
  const correctingPractitionerPublicId = exact(raw.correctingPractitionerPublicId, 'correctingPractitionerPublicId');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const replacementObservationSetPublicId = await deterministicId(
    'vitalset', base.tenantId, sourceType, sourcePublicId,
    raw.replacementObservationSetPublicId, 'replacementObservationSetPublicId',
  );
  const effectiveAtUtc = utc(raw.effectiveAtUtc, 'effectiveAtUtc');
  const recordedAtUtc = utc(raw.recordedAtUtc, 'recordedAtUtc');
  if (recordedAtUtc < effectiveAtUtc) throw new RangeError('recordedAtUtc cannot precede effectiveAtUtc');
  const components = await normalizeComponents({
    tenantId: base.tenantId,
    sourceType,
    sourcePublicId,
    sourceEvidenceSha256,
    components: raw.components,
  });
  const request = {
    observationSetPublicId,
    expectedVersion,
    replacementObservationSetPublicId,
    correctingPractitionerPublicId,
    effectiveAtUtc,
    recordedAtUtc,
    components,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    reasonCode,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalVitalCorrectionResult>(db, {
    tenantId: base.tenantId,
    commandName: CORRECT,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const original = await requireObservationSet(db, base.tenantId, observationSetPublicId);
  if (Number(original.status_version) !== expectedVersion) throw new Error('canonical vital observation version conflict');
  if (original.review_status !== 'verified') throw new Error('correction requires a verified observation set');
  await requireActivePractitioner(db, base.tenantId, correctingPractitionerPublicId);
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    sourceType,
    sourcePublicId,
    canonicalPublicId: replacementObservationSetPublicId,
  });
  const fingerprint = await createRequestFingerprint(request);
  const nextOriginalVersion = expectedVersion + 1;
  const result: CanonicalVitalCorrectionResult = {
    observationSetPublicId,
    reviewStatus: 'superseded',
    statusVersion: nextOriginalVersion,
    replacementObservationSetPublicId,
    replacementReviewStatus: 'pending_review',
    replacementStatusVersion: 1,
  };
  const resolvedOutboxEventId = await outboxEventId(base.tenantId, CORRECT, base.idempotencyKey, raw.eventPublicId);
  const replacementRecordedEventPublicId = await lifecycleEventId(base.tenantId, CORRECT, base.idempotencyKey, 'replacement-recorded');
  const originalSupersededEventPublicId = await lifecycleEventId(base.tenantId, CORRECT, base.idempotencyKey, 'original-superseded');

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: CORRECT,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_vital_observation_sets (
          tenant_id,observation_set_public_id,patient_link_public_id,encounter_public_id,
          practitioner_public_id,source_kind,external_device_source_type,
          external_device_source_public_id,effective_at_utc,recorded_at_utc,review_status,
          status_version,supersedes_observation_set_public_id,actor_user_public_id,
          actor_system_key,idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
          created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,'practitioner_entered',NULL,NULL,?,?,'pending_review',1,?,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        replacementObservationSetPublicId,
        original.patient_link_public_id,
        original.encounter_public_id,
        correctingPractitionerPublicId,
        effectiveAtUtc,
        recordedAtUtc,
        observationSetPublicId,
        base.actorUserPublicId,
        base.actorSystemKey,
        base.idempotencyKey,
        fingerprint,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.occurredAtUtc,
      ),
      ...components.map((component) => componentStatement(
        db, base.tenantId, replacementObservationSetPublicId, component, base.occurredAtUtc,
      )),
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: replacementRecordedEventPublicId,
        observationSetPublicId: replacementObservationSetPublicId,
        fromReviewStatus: null,
        toReviewStatus: 'pending_review',
        eventVersion: 1,
        eventType: 'recorded',
        reasonCode: 'correction_recorded',
        actorPractitionerPublicId: correctingPractitionerPublicId,
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        occurredAtUtc: base.occurredAtUtc,
        sourceEvidenceSha256,
      }),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        canonicalPublicId: replacementObservationSetPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        evidenceSha256: sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: originalSupersededEventPublicId,
        observationSetPublicId,
        fromReviewStatus: 'verified',
        toReviewStatus: 'superseded',
        eventVersion: nextOriginalVersion,
        eventType: 'superseded',
        reasonCode,
        actorPractitionerPublicId: correctingPractitionerPublicId,
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        occurredAtUtc: base.occurredAtUtc,
        sourceEvidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_vital_observation_sets
        SET review_status='superseded',status_version=?,updated_at_utc=?
        WHERE tenant_id=? AND observation_set_public_id=?
          AND review_status='verified' AND status_version=?
      `).bind(
        nextOriginalVersion,
        base.occurredAtUtc,
        base.tenantId,
        observationSetPublicId,
        expectedVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_vital_observation_set',
      aggregatePublicId: observationSetPublicId,
      eventType: 'canonical.vital-observation.corrected',
      eventVersion: nextOriginalVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function enterCanonicalVitalObservationSetInError(
  db: CanonicalBatchDatabase,
  raw: EnterCanonicalVitalObservationSetInErrorInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalVitalObservationSetResult>> {
  const base = normalizeBase(raw);
  const observationSetPublicId = exact(raw.observationSetPublicId, 'observationSetPublicId');
  const expectedVersion = positiveInteger(raw.expectedVersion, 'expectedVersion');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const request = {
    observationSetPublicId,
    expectedVersion,
    reasonCode,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    occurredAtUtc: base.occurredAtUtc,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<CanonicalVitalObservationSetResult>(db, {
    tenantId: base.tenantId,
    commandName: ENTER_ERROR,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const observation = await requireObservationSet(db, base.tenantId, observationSetPublicId);
  if (Number(observation.status_version) !== expectedVersion) throw new Error('canonical vital observation version conflict');
  if (!['pending_review', 'verified', 'rejected'].includes(observation.review_status)) {
    throw new Error('canonical vital observation cannot enter error from its current state');
  }
  const nextVersion = expectedVersion + 1;
  const result: CanonicalVitalObservationSetResult = {
    observationSetPublicId,
    reviewStatus: 'entered_in_error',
    statusVersion: nextVersion,
  };
  const resolvedOutboxEventId = await outboxEventId(base.tenantId, ENTER_ERROR, base.idempotencyKey, raw.eventPublicId);
  const statusEventPublicId = await lifecycleEventId(base.tenantId, ENTER_ERROR, base.idempotencyKey, 'entered-in-error');

  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: ENTER_ERROR,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: statusEventPublicId,
        observationSetPublicId,
        fromReviewStatus: observation.review_status,
        toReviewStatus: 'entered_in_error',
        eventVersion: nextVersion,
        eventType: 'entered_in_error',
        reasonCode,
        actorPractitionerPublicId: null,
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        occurredAtUtc: base.occurredAtUtc,
        sourceEvidenceSha256,
      }),
      db.prepare(`
        UPDATE canonical_vital_observation_sets
        SET review_status='entered_in_error',status_version=?,updated_at_utc=?
        WHERE tenant_id=? AND observation_set_public_id=?
          AND review_status=? AND status_version=?
      `).bind(
        nextVersion,
        base.occurredAtUtc,
        base.tenantId,
        observationSetPublicId,
        observation.review_status,
        expectedVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_vital_observation_set',
      aggregatePublicId: observationSetPublicId,
      eventType: 'canonical.vital-observation.entered-in-error',
      eventVersion: nextVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}
