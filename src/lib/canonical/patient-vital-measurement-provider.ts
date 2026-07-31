import { toUtcIso } from './time';

export type PatientVitalMeasurementProviderMode = 'legacy' | 'shadow' | 'canonical';
export type PatientVitalMeasurementProviderSourceType =
  | 'legacy_patient_vitals'
  | 'legacy_clinical_vitals'
  | 'legacy_global_vitals_uhid'
  | 'legacy_global_vitals_patient'
  | 'legacy_nursing_monitoring';

export interface PatientVitalMeasurementProviderPreparedStatement {
  bind(...values: unknown[]): PatientVitalMeasurementProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PatientVitalMeasurementProviderDatabase {
  prepare(sql: string): PatientVitalMeasurementProviderPreparedStatement;
}

export interface PatientVitalMeasurementProviderInput {
  tenantId: string;
  sourceType: PatientVitalMeasurementProviderSourceType;
  legacyId: number;
  identitySensitive?: boolean;
}

export interface VitalObservationComponentProjection {
  measurementCode: string;
  numericValue: number;
  unitCode: string;
  isDerived: boolean;
}

export interface PatientVitalMeasurementParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  encounter: boolean;
  practitioner: boolean;
  effectiveTime: boolean;
  componentCodes: boolean;
  componentValues: boolean;
}

export interface VitalObservationProjection {
  mode: PatientVitalMeasurementProviderMode;
  observationSetPublicId: string | null;
  patientLinkPublicId: string | null;
  encounterPublicId: string | null;
  practitionerPublicId: string | null;
  sourceKind: string;
  effectiveAtUtc: string;
  recordedAtUtc: string;
  reviewStatus: string;
  statusVersion: number;
  components: VitalObservationComponentProjection[];
  legacy: {
    sourceType: PatientVitalMeasurementProviderSourceType;
    legacyId: number;
  };
  parity?: PatientVitalMeasurementParity;
}

interface ProviderFlagRow { mode: string; is_enabled: number | string }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface EncounterRow { encounter_public_id: string; patient_link_public_id: string | null; status: string }
interface PractitionerRow { practitioner_public_id: string; status: string }
interface CanonicalSetRow {
  observation_set_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string | null;
  practitioner_public_id: string | null;
  source_kind: string;
  effective_at_utc: string;
  recorded_at_utc: string;
  review_status: string;
  status_version: number;
}
interface CanonicalComponentRow {
  measurement_code: string;
  numeric_value: number;
  canonical_unit_code: string;
  is_derived: number | string;
}

interface LegacyFacts {
  patientId: number | null;
  patientUhid: string | null;
  encounterSourceType: 'legacy_visit' | 'legacy_admission' | null;
  encounterLegacyId: number | null;
  practitionerLegacyUserId: string | number | null;
  sourceKind: string;
  effectiveAtUtc: string;
  recordedAtUtc: string;
  components: VitalObservationComponentProjection[];
}

const FLAG_KEY = 'canonical_patient_vital_measurement_provider_v1';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function normalizedUtc(value: string | null | undefined, label: string): string {
  if (!value?.trim()) throw new TypeError(`${label} is required`);
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  if (raw.endsWith('Z')) return toUtcIso(raw);
  const local = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return toUtcIso(`${local}+06:00`);
}

function addComponent(
  components: VitalObservationComponentProjection[],
  measurementCode: string,
  numericValue: number | null | undefined,
  unitCode: string,
  isDerived = false,
): void {
  if (numericValue == null) return;
  components.push({ measurementCode, numericValue: Number(numericValue), unitCode, isDerived });
}

async function readMapping(
  db: PatientVitalMeasurementProviderDatabase,
  tenantId: string,
  entityType: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
}

function mappedPublicId(row: MappingRow | null): string | null {
  return row?.mapping_status === 'mapped' && row.canonical_public_id ? String(row.canonical_public_id) : null;
}

async function resolvePatientLink(
  db: PatientVitalMeasurementProviderDatabase,
  tenantId: string,
  facts: LegacyFacts,
): Promise<string | null> {
  let publicId: string | null = null;
  if (facts.patientUhid) {
    publicId = mappedPublicId(await readMapping(
      db, tenantId, 'patient_link', 'global_patient_uhid', facts.patientUhid,
    ));
  } else if (facts.patientId != null) {
    publicId = mappedPublicId(await readMapping(
      db, tenantId, 'patient_link', 'legacy_patient', String(facts.patientId),
    ));
    if (!publicId) {
      const direct = await db.prepare(`
        SELECT patient_link_public_id,link_status,effective_to_utc
        FROM canonical_tenant_patient_links
        WHERE tenant_id=? AND legacy_patient_id=? LIMIT 1
      `).bind(tenantId, facts.patientId).first<PatientLinkRow>();
      if (direct && !['rejected', 'retired'].includes(direct.link_status) && direct.effective_to_utc == null) {
        publicId = direct.patient_link_public_id;
      }
    }
  }
  if (!publicId) return null;
  const row = await db.prepare(`
    SELECT patient_link_public_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<PatientLinkRow>();
  if (!row || ['rejected', 'retired'].includes(row.link_status) || row.effective_to_utc != null) return null;
  return row.patient_link_public_id;
}

async function resolveEncounter(
  db: PatientVitalMeasurementProviderDatabase,
  tenantId: string,
  facts: LegacyFacts,
  patientLinkPublicId: string | null,
): Promise<string | null> {
  if (!facts.encounterSourceType || facts.encounterLegacyId == null || patientLinkPublicId == null) return null;
  const publicId = mappedPublicId(await readMapping(
    db,
    tenantId,
    'encounter',
    facts.encounterSourceType,
    String(facts.encounterLegacyId),
  ));
  if (!publicId) return null;
  const row = await db.prepare(`
    SELECT encounter_public_id,patient_link_public_id,status FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<EncounterRow>();
  if (!row || row.patient_link_public_id !== patientLinkPublicId || row.status === 'entered_in_error') return null;
  return row.encounter_public_id;
}

async function resolvePractitioner(
  db: PatientVitalMeasurementProviderDatabase,
  tenantId: string,
  legacyUserId: string | number | null,
): Promise<string | null> {
  if (legacyUserId == null || String(legacyUserId).trim() === '') return null;
  const numeric = Number(legacyUserId);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  const row = await db.prepare(`
    SELECT l.practitioner_public_id,p.status
    FROM canonical_practitioner_user_links l
    JOIN canonical_practitioners p
      ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
    WHERE l.tenant_id=? AND l.legacy_user_id=? AND l.link_status='active' LIMIT 1
  `).bind(tenantId, numeric).first<PractitionerRow>();
  return row?.status === 'active' ? row.practitioner_public_id : null;
}

export async function resolvePatientVitalMeasurementProviderMode(
  db: PatientVitalMeasurementProviderDatabase,
  tenantId: string,
): Promise<PatientVitalMeasurementProviderMode> {
  const tenant = exact(tenantId, 'tenantId');
  let row: ProviderFlagRow | null;
  try {
    row = await db.prepare(`
      SELECT mode,is_enabled FROM canonical_feature_flags
      WHERE tenant_id=? AND flag_key=? LIMIT 1
    `).bind(tenant, FLAG_KEY).first<ProviderFlagRow>();
  } catch (error) {
    if (/no such table:\s*canonical_feature_flags/i.test(error instanceof Error ? error.message : String(error))) return 'legacy';
    throw error;
  }
  if (!row || Number(row.is_enabled) !== 1) return 'legacy';
  if (row.mode === 'shadow') return 'shadow';
  if (row.mode === 'canonical') return 'canonical';
  return 'legacy';
}

async function readLegacyPatientVitals(
  db: PatientVitalMeasurementProviderDatabase,
  tenantId: string,
  legacyId: number,
): Promise<LegacyFacts> {
  const row = await db.prepare(`
    SELECT patient_id,admission_id,systolic,diastolic,temperature,heart_rate,
           spo2,respiratory_rate,weight,recorded_by,recorded_at
    FROM patient_vitals WHERE tenant_id=? AND id=? LIMIT 1
  `).bind(tenantId, legacyId).first<Record<string, unknown>>();
  if (!row) throw new Error('legacy patient vital observation not found');
  const components: VitalObservationComponentProjection[] = [];
  addComponent(components, 'blood_pressure_systolic', row.systolic as number | null, 'mm[Hg]');
  addComponent(components, 'blood_pressure_diastolic', row.diastolic as number | null, 'mm[Hg]');
  addComponent(components, 'body_temperature', row.temperature as number | null, 'Cel');
  addComponent(components, 'heart_rate', row.heart_rate as number | null, '/min');
  addComponent(components, 'oxygen_saturation', row.spo2 as number | null, '%');
  addComponent(components, 'respiratory_rate', row.respiratory_rate as number | null, '/min');
  addComponent(components, 'body_weight', row.weight as number | null, 'kg');
  const effectiveAtUtc = normalizedUtc(row.recorded_at as string | null, 'recorded_at');
  return {
    patientId: Number(row.patient_id),
    patientUhid: null,
    encounterSourceType: 'legacy_admission',
    encounterLegacyId: row.admission_id == null ? null : Number(row.admission_id),
    practitionerLegacyUserId: row.recorded_by as string | number | null,
    sourceKind: 'legacy_backfill',
    effectiveAtUtc,
    recordedAtUtc: effectiveAtUtc,
    components,
  };
}

async function readLegacyClinicalVitals(
  db: PatientVitalMeasurementProviderDatabase,
  tenantId: string,
  legacyId: number,
): Promise<LegacyFacts> {
  const row = await db.prepare(`
    SELECT patient_id,visit_id,temperature,pulse,blood_pressure_systolic,
           blood_pressure_diastolic,respiratory_rate,spo2,weight,height,bmi,
           pain_scale,blood_sugar,taken_by,taken_at
    FROM clinical_vitals WHERE tenant_id=? AND id=? AND COALESCE(is_active,1)=1 LIMIT 1
  `).bind(tenantId, legacyId).first<Record<string, unknown>>();
  if (!row) throw new Error('legacy clinical vital observation not found');
  const components: VitalObservationComponentProjection[] = [];
  addComponent(components, 'body_temperature', row.temperature as number | null, '[degF]');
  addComponent(components, 'heart_rate', row.pulse as number | null, '/min');
  addComponent(components, 'blood_pressure_systolic', row.blood_pressure_systolic as number | null, 'mm[Hg]');
  addComponent(components, 'blood_pressure_diastolic', row.blood_pressure_diastolic as number | null, 'mm[Hg]');
  addComponent(components, 'respiratory_rate', row.respiratory_rate as number | null, '/min');
  addComponent(components, 'oxygen_saturation', row.spo2 as number | null, '%');
  addComponent(components, 'body_weight', row.weight as number | null, 'kg');
  addComponent(components, 'body_height', row.height as number | null, 'cm');
  addComponent(components, 'body_mass_index', row.bmi as number | null, 'kg/m2', true);
  addComponent(components, 'pain_score', row.pain_scale as number | null, '{score}');
  addComponent(components, 'blood_glucose', row.blood_sugar as number | null, 'mg/dL');
  const effectiveAtUtc = normalizedUtc(row.taken_at as string | null, 'taken_at');
  return {
    patientId: Number(row.patient_id),
    patientUhid: null,
    encounterSourceType: 'legacy_visit',
    encounterLegacyId: row.visit_id == null ? null : Number(row.visit_id),
    practitionerLegacyUserId: row.taken_by as string | number | null,
    sourceKind: 'legacy_backfill',
    effectiveAtUtc,
    recordedAtUtc: effectiveAtUtc,
    components,
  };
}

async function readLegacyGlobalUhidVitals(
  db: PatientVitalMeasurementProviderDatabase,
  legacyId: number,
): Promise<LegacyFacts> {
  const row = await db.prepare(`
    SELECT uhid,logged_on,systolic,diastolic,heart_rate,blood_sugar,created_at
    FROM global_patient_vitals WHERE id=? AND uhid IS NOT NULL AND logged_on IS NOT NULL LIMIT 1
  `).bind(legacyId).first<Record<string, unknown>>();
  if (!row) throw new Error('legacy global UHID vital observation not found');
  const components: VitalObservationComponentProjection[] = [];
  addComponent(components, 'blood_pressure_systolic', row.systolic as number | null, 'mm[Hg]');
  addComponent(components, 'blood_pressure_diastolic', row.diastolic as number | null, 'mm[Hg]');
  addComponent(components, 'heart_rate', row.heart_rate as number | null, '/min');
  addComponent(components, 'blood_glucose', row.blood_sugar as number | null, 'mg/dL');
  const effectiveAtUtc = normalizedUtc(row.logged_on as string | null, 'logged_on');
  return {
    patientId: null,
    patientUhid: exact(String(row.uhid), 'uhid'),
    encounterSourceType: null,
    encounterLegacyId: null,
    practitionerLegacyUserId: null,
    sourceKind: 'patient_reported',
    effectiveAtUtc,
    recordedAtUtc: row.created_at ? normalizedUtc(String(row.created_at), 'created_at') : effectiveAtUtc,
    components,
  };
}

async function readLegacyGlobalPatientVitals(
  db: PatientVitalMeasurementProviderDatabase,
  legacyId: number,
): Promise<LegacyFacts> {
  const row = await db.prepare(`
    SELECT patient_id,logged_at,systolic,diastolic,heart_rate,blood_sugar,
           weight_kg,temperature_f,spo2,created_at
    FROM global_patient_vitals WHERE id=? AND patient_id IS NOT NULL AND logged_at IS NOT NULL LIMIT 1
  `).bind(legacyId).first<Record<string, unknown>>();
  if (!row) throw new Error('legacy global patient vital observation not found');
  const components: VitalObservationComponentProjection[] = [];
  addComponent(components, 'blood_pressure_systolic', row.systolic as number | null, 'mm[Hg]');
  addComponent(components, 'blood_pressure_diastolic', row.diastolic as number | null, 'mm[Hg]');
  addComponent(components, 'heart_rate', row.heart_rate as number | null, '/min');
  addComponent(components, 'blood_glucose', row.blood_sugar as number | null, 'mg/dL');
  addComponent(components, 'body_weight', row.weight_kg as number | null, 'kg');
  addComponent(components, 'body_temperature', row.temperature_f as number | null, '[degF]');
  addComponent(components, 'oxygen_saturation', row.spo2 as number | null, '%');
  const effectiveAtUtc = normalizedUtc(row.logged_at as string | null, 'logged_at');
  return {
    patientId: Number(row.patient_id),
    patientUhid: null,
    encounterSourceType: null,
    encounterLegacyId: null,
    practitionerLegacyUserId: null,
    sourceKind: 'patient_reported',
    effectiveAtUtc,
    recordedAtUtc: row.created_at ? normalizedUtc(String(row.created_at), 'created_at') : effectiveAtUtc,
    components,
  };
}

async function readLegacyNursingMonitoring(
  db: PatientVitalMeasurementProviderDatabase,
  tenantId: string,
  legacyId: number,
): Promise<LegacyFacts> {
  const row = await db.prepare(`
    SELECT patient_id,visit_id,temperature,temperature_unit,pulse,respiration,
           bp_systolic,bp_diastolic,spo2,pain_scale,recorded_on,created_by
    FROM nur_patient_monitoring WHERE tenant_id=? AND id=? AND COALESCE(is_active,1)=1 LIMIT 1
  `).bind(tenantId, legacyId).first<Record<string, unknown>>();
  if (!row) throw new Error('legacy nursing vital observation not found');
  const components: VitalObservationComponentProjection[] = [];
  const temperatureUnit = String(row.temperature_unit ?? '').toUpperCase() === 'F' ? '[degF]' : 'Cel';
  addComponent(components, 'body_temperature', row.temperature as number | null, temperatureUnit);
  addComponent(components, 'heart_rate', row.pulse as number | null, '/min');
  addComponent(components, 'respiratory_rate', row.respiration as number | null, '/min');
  addComponent(components, 'blood_pressure_systolic', row.bp_systolic as number | null, 'mm[Hg]');
  addComponent(components, 'blood_pressure_diastolic', row.bp_diastolic as number | null, 'mm[Hg]');
  addComponent(components, 'oxygen_saturation', row.spo2 as number | null, '%');
  addComponent(components, 'pain_score', row.pain_scale as number | null, '{score}');
  const effectiveAtUtc = normalizedUtc(row.recorded_on as string | null, 'recorded_on');
  return {
    patientId: Number(row.patient_id),
    patientUhid: null,
    encounterSourceType: 'legacy_visit',
    encounterLegacyId: Number(row.visit_id),
    practitionerLegacyUserId: row.created_by as number | null,
    sourceKind: 'nurse_entered',
    effectiveAtUtc,
    recordedAtUtc: effectiveAtUtc,
    components,
  };
}

async function readLegacyFacts(
  db: PatientVitalMeasurementProviderDatabase,
  tenantId: string,
  sourceType: PatientVitalMeasurementProviderSourceType,
  legacyId: number,
): Promise<LegacyFacts> {
  switch (sourceType) {
    case 'legacy_patient_vitals': return readLegacyPatientVitals(db, tenantId, legacyId);
    case 'legacy_clinical_vitals': return readLegacyClinicalVitals(db, tenantId, legacyId);
    case 'legacy_global_vitals_uhid': return readLegacyGlobalUhidVitals(db, legacyId);
    case 'legacy_global_vitals_patient': return readLegacyGlobalPatientVitals(db, legacyId);
    case 'legacy_nursing_monitoring': return readLegacyNursingMonitoring(db, tenantId, legacyId);
  }
}

async function readCanonicalProjection(
  db: PatientVitalMeasurementProviderDatabase,
  tenantId: string,
  observationSetPublicId: string,
  sourceType: PatientVitalMeasurementProviderSourceType,
  legacyId: number,
  mode: PatientVitalMeasurementProviderMode,
): Promise<VitalObservationProjection> {
  const row = await db.prepare(`
    SELECT observation_set_public_id,patient_link_public_id,encounter_public_id,
           practitioner_public_id,source_kind,effective_at_utc,recorded_at_utc,
           review_status,status_version
    FROM canonical_vital_observation_sets
    WHERE tenant_id=? AND observation_set_public_id=? LIMIT 1
  `).bind(tenantId, observationSetPublicId).first<CanonicalSetRow>();
  if (!row) throw new Error('mapped canonical vital observation set not found');
  const componentRows = (await db.prepare(`
    SELECT measurement_code,numeric_value,canonical_unit_code,is_derived
    FROM canonical_vital_observation_components
    WHERE tenant_id=? AND observation_set_public_id=? ORDER BY component_sequence
  `).bind(tenantId, observationSetPublicId).all<CanonicalComponentRow>()).results;
  return {
    mode,
    observationSetPublicId: row.observation_set_public_id,
    patientLinkPublicId: row.patient_link_public_id,
    encounterPublicId: row.encounter_public_id,
    practitionerPublicId: row.practitioner_public_id,
    sourceKind: row.source_kind,
    effectiveAtUtc: row.effective_at_utc,
    recordedAtUtc: row.recorded_at_utc,
    reviewStatus: row.review_status,
    statusVersion: Number(row.status_version),
    components: componentRows.map((component) => ({
      measurementCode: component.measurement_code,
      numericValue: Number(component.numeric_value),
      unitCode: component.canonical_unit_code,
      isDerived: Number(component.is_derived) === 1,
    })),
    legacy: { sourceType, legacyId },
  };
}

function canonicalValueForComparison(component: VitalObservationComponentProjection): number {
  if (component.measurementCode === 'body_temperature' && component.unitCode === '[degF]') {
    return Math.round((((component.numericValue - 32) * 5 / 9) + Number.EPSILON) * 10_000) / 10_000;
  }
  return component.numericValue;
}

function componentMap(components: VitalObservationComponentProjection[]): Map<string, number> {
  return new Map(components.map((component) => [component.measurementCode, canonicalValueForComparison(component)]));
}

function parity(
  legacy: VitalObservationProjection,
  canonical: VitalObservationProjection | null,
): PatientVitalMeasurementParity {
  const legacyComponents = componentMap(legacy.components);
  const canonicalComponents = componentMap(canonical?.components ?? []);
  const legacyCodes = [...legacyComponents.keys()].sort();
  const canonicalCodes = [...canonicalComponents.keys()].sort();
  const componentCodes = JSON.stringify(legacyCodes) === JSON.stringify(canonicalCodes);
  const componentValues = componentCodes && legacyCodes.every((code) => {
    const legacyValue = legacyComponents.get(code);
    const canonicalValue = canonicalComponents.get(code);
    return legacyValue != null && canonicalValue != null && Math.abs(legacyValue - canonicalValue) <= 0.0001;
  });
  const result = {
    mapping: canonical != null,
    patientLink: canonical != null && legacy.patientLinkPublicId === canonical.patientLinkPublicId,
    encounter: canonical != null && legacy.encounterPublicId === canonical.encounterPublicId,
    practitioner: canonical != null && legacy.practitionerPublicId === canonical.practitionerPublicId,
    effectiveTime: canonical != null && legacy.effectiveAtUtc === canonical.effectiveAtUtc,
    componentCodes,
    componentValues,
  };
  return { ok: Object.values(result).every(Boolean), ...result };
}

export async function resolveVitalObservationProjection(
  db: PatientVitalMeasurementProviderDatabase,
  input: PatientVitalMeasurementProviderInput,
): Promise<VitalObservationProjection> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const legacyId = positive(input.legacyId, 'legacyId');
  const sourceType = input.sourceType;
  const mode = await resolvePatientVitalMeasurementProviderMode(db, tenantId);
  const facts = await readLegacyFacts(db, tenantId, sourceType, legacyId);
  const mapping = await readMapping(
    db, tenantId, 'vital_observation_set', sourceType, String(legacyId),
  );
  const observationSetPublicId = mappedPublicId(mapping);
  if (input.identitySensitive && !observationSetPublicId) {
    throw new Error('explicit vital-observation source mapping is required for identity-sensitive reads');
  }
  if (mode === 'canonical' && !observationSetPublicId) {
    throw new Error('canonical vital observation mapping is required');
  }
  const patientLinkPublicId = await resolvePatientLink(db, tenantId, facts);
  const encounterPublicId = await resolveEncounter(db, tenantId, facts, patientLinkPublicId);
  const practitionerPublicId = await resolvePractitioner(db, tenantId, facts.practitionerLegacyUserId);
  const legacyProjection: VitalObservationProjection = {
    mode,
    observationSetPublicId,
    patientLinkPublicId,
    encounterPublicId,
    practitionerPublicId,
    sourceKind: facts.sourceKind,
    effectiveAtUtc: facts.effectiveAtUtc,
    recordedAtUtc: facts.recordedAtUtc,
    reviewStatus: 'legacy',
    statusVersion: 0,
    components: facts.components,
    legacy: { sourceType, legacyId },
  };
  if (mode === 'legacy') return legacyProjection;
  const canonicalProjection = observationSetPublicId
    ? await readCanonicalProjection(db, tenantId, observationSetPublicId, sourceType, legacyId, mode)
    : null;
  if (mode === 'canonical') {
    if (!canonicalProjection) throw new Error('canonical vital observation mapping is required');
    return canonicalProjection;
  }
  return {
    ...legacyProjection,
    mode: 'shadow',
    parity: parity(legacyProjection, canonicalProjection),
  };
}
