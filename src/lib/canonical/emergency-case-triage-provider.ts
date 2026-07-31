import { toUtcIso } from './time';

export type EmergencyCaseTriageProviderMode = 'legacy' | 'shadow' | 'canonical';
export type EmergencyCaseTriageProviderSourceType = 'legacy_er_patient';

export interface EmergencyCaseTriageProviderPreparedStatement {
  bind(...values: unknown[]): EmergencyCaseTriageProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface EmergencyCaseTriageProviderDatabase {
  prepare(sql: string): EmergencyCaseTriageProviderPreparedStatement;
}
export interface EmergencyCaseTriageProviderInput {
  tenantId: string;
  sourceType: EmergencyCaseTriageProviderSourceType;
  legacyId: number;
  identitySensitive?: boolean;
}
export interface EmergencyCaseTriageParity {
  ok: boolean;
  mapping: boolean;
  patientScope: boolean;
  encounterScope: boolean;
  lifecycleStatus: boolean;
  triageAcuity: boolean;
  disposition: boolean;
  arrivalHistoryVisible: boolean;
  lifecycleHistoryVisible: boolean;
  triageHistoryVisible: boolean;
  classificationHistoryVisible: boolean;
  dispositionHistoryVisible: boolean;
  effectiveTime: boolean;
}
export interface EmergencyArrivalProjection {
  arrivalAssessmentPublicId: string;
  versionNumber: number;
  versionKind: string;
  supersedesArrivalAssessmentPublicId: string | null;
  arrivalAtUtc: string;
  modeOfArrivalCode: string;
  conditionOnArrivalCode: string;
  broughtByCategory: string | null;
  policeCaseIndicator: boolean;
  observedAtUtc: string;
  recordedAtUtc: string;
  reasonCode: string | null;
}
export interface EmergencyStatusProjection {
  eventPublicId: string;
  eventVersion: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  practitionerPublicId: string | null;
  occurredAtUtc: string;
  recordedAtUtc: string;
  reasonCode: string;
}
export interface EmergencyTriageProjection {
  triageAssessmentPublicId: string;
  versionNumber: number;
  versionKind: string;
  supersedesTriageAssessmentPublicId: string | null;
  acuityCode: string;
  practitionerPublicId: string;
  vitalObservationSetPublicId: string | null;
  observedAtUtc: string;
  recordedAtUtc: string;
  reasonCode: string | null;
}
export interface EmergencyClassificationProjection {
  classificationPublicId: string;
  classificationFamilyPublicId: string;
  versionNumber: number;
  versionKind: string;
  supersedesClassificationPublicId: string | null;
  classificationNamespace: string;
  classificationCode: string;
  categoryCode: string;
  subcategoryCode: string | null;
  animalCategoryCode: string | null;
  biteSiteCode: string | null;
  biteAtUtc: string | null;
  policeCaseIndicator: boolean;
  occurredAtUtc: string;
  recordedAtUtc: string;
  reasonCode: string | null;
}
export interface EmergencyDispositionProjection {
  dispositionEventPublicId: string;
  dispositionVersion: number;
  dispositionCode: string;
  practitionerPublicId: string | null;
  canonicalAdmissionPublicId: string | null;
  dischargeDocumentPublicId: string | null;
  dischargeDocumentVersionPublicId: string | null;
  receivingOrganizationSourceType: string | null;
  receivingOrganizationSourcePublicId: string | null;
  terminalEvidenceCode: string | null;
  occurredAtUtc: string;
  recordedAtUtc: string;
  reasonCode: string;
}
export interface EmergencyCaseTriageProjection {
  mode: EmergencyCaseTriageProviderMode;
  canonicalPublicId: string | null;
  patientLinkPublicId: string | null;
  encounterPublicId: string | null;
  status: string;
  statusVersion: number;
  currentAcuityCode: string | null;
  currentDispositionCode: string | null;
  effectiveAtUtc: string;
  historyVisible: boolean;
  arrivalHistory: EmergencyArrivalProjection[];
  lifecycleHistory: EmergencyStatusProjection[];
  triageHistory: EmergencyTriageProjection[];
  classificationHistory: EmergencyClassificationProjection[];
  dispositionHistory: EmergencyDispositionProjection[];
  legacy: { sourceType: EmergencyCaseTriageProviderSourceType; legacyId: number };
  parity?: EmergencyCaseTriageParity;
}

interface FlagRow { mode: string; is_enabled: number | string }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface LegacyFacts {
  patientId: number | null;
  visitId: number | null;
  status: string;
  triageCode: string | null;
  dispositionCode: string | null;
  effectiveAtUtc: string;
}
interface CaseRow {
  emergency_case_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  current_status: string;
  status_version: number;
  current_triage_assessment_public_id: string | null;
  current_disposition_event_public_id: string | null;
  created_at_utc: string;
}

const FLAG_KEY = 'canonical_emergency_case_triage_provider_v1';

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
function normalizedLegacyUtc(value: string | null | undefined): string {
  if (!value?.trim()) return '1970-01-01T00:00:00.000Z';
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  if (raw.endsWith('Z')) return toUtcIso(raw);
  return toUtcIso(`${raw.includes('T') ? raw : raw.replace(' ', 'T')}+06:00`);
}
async function all<T>(statement: EmergencyCaseTriageProviderPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}
function legacyStatus(erStatus: string | null, finalStatus: string | null): string {
  const status = erStatus?.trim().toLowerCase();
  if (status === 'finalized' && finalStatus?.trim()) return finalStatus.trim().toLowerCase();
  if (status === 'triaged') return 'triaged';
  if (status === 'new') return 'arrived';
  return status || 'arrived';
}

export async function resolveEmergencyCaseTriageProviderMode(
  db: EmergencyCaseTriageProviderDatabase,
  tenantIdRaw: string,
): Promise<EmergencyCaseTriageProviderMode> {
  const tenantId = exact(tenantIdRaw, 'tenantId');
  const row = await db.prepare(`SELECT mode,is_enabled FROM canonical_feature_flags
    WHERE tenant_id=? AND flag_key=? ORDER BY version DESC LIMIT 1`).bind(tenantId, FLAG_KEY).first<FlagRow>();
  if (Number(row?.is_enabled ?? 0) !== 1) return 'legacy';
  return row?.mode === 'shadow' || row?.mode === 'canonical' ? row.mode : 'legacy';
}

async function readLegacyFacts(
  db: EmergencyCaseTriageProviderDatabase,
  tenantId: string,
  legacyId: number,
): Promise<LegacyFacts> {
  const row = await db.prepare(`SELECT patient_id,visit_id,er_status,triage_code,finalized_status,
    visit_datetime,triaged_on,finalized_on,created_at,updated_at
    FROM er_patients WHERE tenant_id=? AND id=? LIMIT 1`).bind(tenantId, legacyId).first<{
      patient_id: number | null;
      visit_id: number | null;
      er_status: string | null;
      triage_code: string | null;
      finalized_status: string | null;
      visit_datetime: string | null;
      triaged_on: string | null;
      finalized_on: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>();
  if (!row) throw new Error('legacy emergency patient not found');
  return {
    patientId: row.patient_id,
    visitId: row.visit_id,
    status: legacyStatus(row.er_status, row.finalized_status),
    triageCode: row.triage_code?.trim().toLowerCase() || null,
    dispositionCode: row.finalized_status?.trim().toLowerCase() || null,
    effectiveAtUtc: normalizedLegacyUtc(
      row.finalized_on ?? row.triaged_on ?? row.updated_at ?? row.visit_datetime ?? row.created_at,
    ),
  };
}

async function mapping(
  db: EmergencyCaseTriageProviderDatabase,
  tenantId: string,
  legacyId: number,
): Promise<string | null> {
  const row = await db.prepare(`SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='emergency_case' AND source_type='legacy_er_patient'
      AND source_public_id=? LIMIT 1`).bind(tenantId, String(legacyId)).first<MappingRow>();
  return row?.mapping_status === 'mapped' && row.canonical_public_id ? row.canonical_public_id : null;
}

async function readCanonical(
  db: EmergencyCaseTriageProviderDatabase,
  tenantId: string,
  emergencyCasePublicId: string,
): Promise<{
  caseRow: CaseRow;
  arrivalHistory: EmergencyArrivalProjection[];
  lifecycleHistory: EmergencyStatusProjection[];
  triageHistory: EmergencyTriageProjection[];
  classificationHistory: EmergencyClassificationProjection[];
  dispositionHistory: EmergencyDispositionProjection[];
}> {
  const caseRow = await db.prepare(`SELECT emergency_case_public_id,patient_link_public_id,encounter_public_id,
    current_status,status_version,current_triage_assessment_public_id,current_disposition_event_public_id,created_at_utc
    FROM canonical_emergency_cases WHERE tenant_id=? AND emergency_case_public_id=? LIMIT 1`)
    .bind(tenantId, emergencyCasePublicId).first<CaseRow>();
  if (!caseRow) throw new Error('exact canonical emergency case mapping does not resolve');
  const arrivalHistory = (await all<{
    arrival_assessment_public_id: string; version_number: number; version_kind: string;
    supersedes_arrival_assessment_public_id: string | null; arrival_at_utc: string; mode_of_arrival_code: string;
    condition_on_arrival_code: string; brought_by_category: string | null; police_case_indicator: number;
    observed_at_utc: string; recorded_at_utc: string; reason_code: string | null;
  }>(db.prepare(`SELECT arrival_assessment_public_id,version_number,version_kind,
    supersedes_arrival_assessment_public_id,arrival_at_utc,mode_of_arrival_code,condition_on_arrival_code,
    brought_by_category,police_case_indicator,observed_at_utc,recorded_at_utc,reason_code
    FROM canonical_emergency_arrival_assessments WHERE tenant_id=? AND emergency_case_public_id=?
    ORDER BY version_number`).bind(tenantId, emergencyCasePublicId))).map((row) => ({
      arrivalAssessmentPublicId: row.arrival_assessment_public_id,
      versionNumber: Number(row.version_number),
      versionKind: row.version_kind,
      supersedesArrivalAssessmentPublicId: row.supersedes_arrival_assessment_public_id,
      arrivalAtUtc: row.arrival_at_utc,
      modeOfArrivalCode: row.mode_of_arrival_code,
      conditionOnArrivalCode: row.condition_on_arrival_code,
      broughtByCategory: row.brought_by_category,
      policeCaseIndicator: Number(row.police_case_indicator) === 1,
      observedAtUtc: row.observed_at_utc,
      recordedAtUtc: row.recorded_at_utc,
      reasonCode: row.reason_code,
    }));
  const lifecycleHistory = (await all<{
    event_public_id: string; event_version: number; event_type: string; from_status: string | null;
    to_status: string; actor_practitioner_public_id: string | null; occurred_at_utc: string;
    recorded_at_utc: string; reason_code: string;
  }>(db.prepare(`SELECT event_public_id,event_version,event_type,from_status,to_status,
    actor_practitioner_public_id,occurred_at_utc,recorded_at_utc,reason_code
    FROM canonical_emergency_case_status_events WHERE tenant_id=? AND emergency_case_public_id=?
    ORDER BY event_version`).bind(tenantId, emergencyCasePublicId))).map((row) => ({
      eventPublicId: row.event_public_id,
      eventVersion: Number(row.event_version),
      eventType: row.event_type,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      practitionerPublicId: row.actor_practitioner_public_id,
      occurredAtUtc: row.occurred_at_utc,
      recordedAtUtc: row.recorded_at_utc,
      reasonCode: row.reason_code,
    }));
  const triageHistory = (await all<{
    triage_assessment_public_id: string; version_number: number; version_kind: string;
    supersedes_triage_assessment_public_id: string | null; acuity_code: string;
    triage_practitioner_public_id: string; vital_observation_set_public_id: string | null;
    observed_at_utc: string; recorded_at_utc: string; reason_code: string | null;
  }>(db.prepare(`SELECT triage_assessment_public_id,version_number,version_kind,
    supersedes_triage_assessment_public_id,acuity_code,triage_practitioner_public_id,
    vital_observation_set_public_id,observed_at_utc,recorded_at_utc,reason_code
    FROM canonical_emergency_triage_assessments WHERE tenant_id=? AND emergency_case_public_id=?
    ORDER BY version_number`).bind(tenantId, emergencyCasePublicId))).map((row) => ({
      triageAssessmentPublicId: row.triage_assessment_public_id,
      versionNumber: Number(row.version_number),
      versionKind: row.version_kind,
      supersedesTriageAssessmentPublicId: row.supersedes_triage_assessment_public_id,
      acuityCode: row.acuity_code,
      practitionerPublicId: row.triage_practitioner_public_id,
      vitalObservationSetPublicId: row.vital_observation_set_public_id,
      observedAtUtc: row.observed_at_utc,
      recordedAtUtc: row.recorded_at_utc,
      reasonCode: row.reason_code,
    }));
  const classificationHistory = (await all<{
    classification_public_id: string; classification_family_public_id: string; version_number: number;
    version_kind: string; supersedes_classification_public_id: string | null; classification_namespace: string;
    classification_code: string; category_code: string; subcategory_code: string | null;
    animal_category_code: string | null; bite_site_code: string | null; bite_at_utc: string | null;
    police_case_indicator: number; occurred_at_utc: string; recorded_at_utc: string; reason_code: string | null;
  }>(db.prepare(`SELECT classification_public_id,classification_family_public_id,version_number,version_kind,
    supersedes_classification_public_id,classification_namespace,classification_code,category_code,
    subcategory_code,animal_category_code,bite_site_code,bite_at_utc,police_case_indicator,
    occurred_at_utc,recorded_at_utc,reason_code
    FROM canonical_emergency_case_classifications WHERE tenant_id=? AND emergency_case_public_id=?
    ORDER BY classification_family_public_id,version_number`).bind(tenantId, emergencyCasePublicId))).map((row) => ({
      classificationPublicId: row.classification_public_id,
      classificationFamilyPublicId: row.classification_family_public_id,
      versionNumber: Number(row.version_number),
      versionKind: row.version_kind,
      supersedesClassificationPublicId: row.supersedes_classification_public_id,
      classificationNamespace: row.classification_namespace,
      classificationCode: row.classification_code,
      categoryCode: row.category_code,
      subcategoryCode: row.subcategory_code,
      animalCategoryCode: row.animal_category_code,
      biteSiteCode: row.bite_site_code,
      biteAtUtc: row.bite_at_utc,
      policeCaseIndicator: Number(row.police_case_indicator) === 1,
      occurredAtUtc: row.occurred_at_utc,
      recordedAtUtc: row.recorded_at_utc,
      reasonCode: row.reason_code,
    }));
  const dispositionHistory = (await all<{
    disposition_event_public_id: string; disposition_version: number; disposition_code: string;
    actor_practitioner_public_id: string | null; canonical_admission_public_id: string | null;
    discharge_document_public_id: string | null; discharge_document_version_public_id: string | null;
    receiving_organization_source_type: string | null; receiving_organization_source_public_id: string | null;
    terminal_evidence_code: string | null; occurred_at_utc: string; recorded_at_utc: string; reason_code: string;
  }>(db.prepare(`SELECT disposition_event_public_id,disposition_version,disposition_code,
    actor_practitioner_public_id,canonical_admission_public_id,discharge_document_public_id,
    discharge_document_version_public_id,receiving_organization_source_type,
    receiving_organization_source_public_id,terminal_evidence_code,occurred_at_utc,recorded_at_utc,reason_code
    FROM canonical_emergency_disposition_events WHERE tenant_id=? AND emergency_case_public_id=?
    ORDER BY disposition_version`).bind(tenantId, emergencyCasePublicId))).map((row) => ({
      dispositionEventPublicId: row.disposition_event_public_id,
      dispositionVersion: Number(row.disposition_version),
      dispositionCode: row.disposition_code,
      practitionerPublicId: row.actor_practitioner_public_id,
      canonicalAdmissionPublicId: row.canonical_admission_public_id,
      dischargeDocumentPublicId: row.discharge_document_public_id,
      dischargeDocumentVersionPublicId: row.discharge_document_version_public_id,
      receivingOrganizationSourceType: row.receiving_organization_source_type,
      receivingOrganizationSourcePublicId: row.receiving_organization_source_public_id,
      terminalEvidenceCode: row.terminal_evidence_code,
      occurredAtUtc: row.occurred_at_utc,
      recordedAtUtc: row.recorded_at_utc,
      reasonCode: row.reason_code,
    }));
  return { caseRow, arrivalHistory, lifecycleHistory, triageHistory, classificationHistory, dispositionHistory };
}

function canonicalEffectiveAt(input: {
  caseRow: CaseRow;
  arrivalHistory: EmergencyArrivalProjection[];
  lifecycleHistory: EmergencyStatusProjection[];
  triageHistory: EmergencyTriageProjection[];
  dispositionHistory: EmergencyDispositionProjection[];
}): string {
  return input.dispositionHistory.at(-1)?.occurredAtUtc
    ?? input.triageHistory.at(-1)?.observedAtUtc
    ?? input.lifecycleHistory.at(-1)?.occurredAtUtc
    ?? input.arrivalHistory.at(-1)?.arrivalAtUtc
    ?? input.caseRow.created_at_utc;
}

export async function resolveEmergencyCaseTriageProjection(
  db: EmergencyCaseTriageProviderDatabase,
  raw: EmergencyCaseTriageProviderInput,
): Promise<EmergencyCaseTriageProjection> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const legacyId = positive(raw.legacyId, 'legacyId');
  if (raw.sourceType !== 'legacy_er_patient') throw new TypeError('sourceType must be legacy_er_patient');
  const mode = await resolveEmergencyCaseTriageProviderMode(db, tenantId);
  const legacy = await readLegacyFacts(db, tenantId, legacyId);
  const canonicalPublicId = await mapping(db, tenantId, legacyId);
  if (!canonicalPublicId) {
    if (mode !== 'legacy' || raw.identitySensitive) {
      throw new Error('exact canonical emergency case mapping is required');
    }
    return {
      mode,
      canonicalPublicId: null,
      patientLinkPublicId: null,
      encounterPublicId: null,
      status: legacy.status,
      statusVersion: 0,
      currentAcuityCode: legacy.triageCode,
      currentDispositionCode: legacy.dispositionCode,
      effectiveAtUtc: legacy.effectiveAtUtc,
      historyVisible: false,
      arrivalHistory: [],
      lifecycleHistory: [],
      triageHistory: [],
      classificationHistory: [],
      dispositionHistory: [],
      legacy: { sourceType: raw.sourceType, legacyId },
    };
  }
  if (mode === 'legacy' && !raw.identitySensitive) {
    return {
      mode,
      canonicalPublicId,
      patientLinkPublicId: null,
      encounterPublicId: null,
      status: legacy.status,
      statusVersion: 0,
      currentAcuityCode: legacy.triageCode,
      currentDispositionCode: legacy.dispositionCode,
      effectiveAtUtc: legacy.effectiveAtUtc,
      historyVisible: false,
      arrivalHistory: [],
      lifecycleHistory: [],
      triageHistory: [],
      classificationHistory: [],
      dispositionHistory: [],
      legacy: { sourceType: raw.sourceType, legacyId },
    };
  }
  const canonical = await readCanonical(db, tenantId, canonicalPublicId);
  const currentAcuity = canonical.triageHistory.at(-1)?.acuityCode ?? null;
  const currentDisposition = canonical.dispositionHistory.at(-1)?.dispositionCode ?? null;
  const canonicalEffective = canonicalEffectiveAt(canonical);
  const parity: EmergencyCaseTriageParity = {
    ok: false,
    mapping: true,
    patientScope: legacy.patientId != null,
    encounterScope: legacy.visitId != null,
    lifecycleStatus: legacy.status === canonical.caseRow.current_status,
    triageAcuity: legacy.triageCode === currentAcuity,
    disposition: legacy.dispositionCode === currentDisposition,
    arrivalHistoryVisible: canonical.arrivalHistory.length > 0,
    lifecycleHistoryVisible: canonical.lifecycleHistory.length > 0,
    triageHistoryVisible: legacy.triageCode == null || canonical.triageHistory.length > 0,
    classificationHistoryVisible: true,
    dispositionHistoryVisible: legacy.dispositionCode == null || canonical.dispositionHistory.length > 0,
    effectiveTime: legacy.effectiveAtUtc === canonicalEffective,
  };
  parity.ok = Object.entries(parity).filter(([key]) => key !== 'ok').every(([, value]) => value === true);
  return {
    mode,
    canonicalPublicId,
    patientLinkPublicId: canonical.caseRow.patient_link_public_id,
    encounterPublicId: canonical.caseRow.encounter_public_id,
    status: mode === 'shadow' ? legacy.status : canonical.caseRow.current_status,
    statusVersion: canonical.caseRow.status_version,
    currentAcuityCode: mode === 'shadow' ? legacy.triageCode : currentAcuity,
    currentDispositionCode: mode === 'shadow' ? legacy.dispositionCode : currentDisposition,
    effectiveAtUtc: mode === 'shadow' ? legacy.effectiveAtUtc : canonicalEffective,
    historyVisible: true,
    arrivalHistory: canonical.arrivalHistory,
    lifecycleHistory: canonical.lifecycleHistory,
    triageHistory: canonical.triageHistory,
    classificationHistory: canonical.classificationHistory,
    dispositionHistory: canonical.dispositionHistory,
    legacy: { sourceType: raw.sourceType, legacyId },
    parity: mode === 'shadow' ? parity : undefined,
  };
}
