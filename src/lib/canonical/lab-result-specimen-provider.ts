import { toUtcIso } from './time';

export type LabResultSpecimenProviderMode = 'legacy' | 'shadow' | 'canonical';
export type LabResultSpecimenProviderSourceType = 'legacy_lab_specimen' | 'legacy_lab_result_set';

export interface LabResultSpecimenProviderPreparedStatement {
  bind(...values: unknown[]): LabResultSpecimenProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface LabResultSpecimenProviderDatabase {
  prepare(sql: string): LabResultSpecimenProviderPreparedStatement;
}

export interface LabResultSpecimenProviderInput {
  tenantId: string;
  sourceType: LabResultSpecimenProviderSourceType;
  legacyId: number;
  identitySensitive?: boolean;
}

export interface LabResultSpecimenParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  encounter: boolean;
  request: boolean;
  service: boolean;
  specimen: boolean;
  status: boolean;
  clinicalShape: boolean;
  effectiveTime: boolean;
  custodyHistoryVisible: boolean;
  versionHistoryVisible: boolean;
  signatureHistoryVisible: boolean;
  analyzerHistoryVisible: boolean;
}

export interface LabSpecimenCustodyProjection {
  eventPublicId: string;
  eventVersion: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  practitionerPublicId: string | null;
  occurredAtUtc: string;
}

export interface LabResultVersionProjection {
  versionPublicId: string;
  versionNumber: number;
  supersedesVersionPublicId: string | null;
  versionKind: string;
  versionStatus: string;
  contentSha256: string;
  signedContentSha256: string | null;
  authoringPractitionerPublicId: string;
  verifyingPractitionerPublicId: string | null;
  validatingPractitionerPublicId: string | null;
  authoredAtUtc: string;
  verifiedAtUtc: string | null;
  validatedAtUtc: string | null;
  publishedAtUtc: string | null;
  retractedAtUtc: string | null;
}

export interface LabResultObservationProjection {
  observationPublicId: string;
  versionPublicId: string;
  observationSequence: number;
  observationCode: string;
  codeSystem: string;
  displaySnapshot: string;
  valueType: string;
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
  observationStatus: string;
}

export interface LabResultStatusProjection {
  eventPublicId: string;
  versionPublicId: string;
  eventVersion: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  practitionerPublicId: string | null;
  signedContentSha256: string | null;
  occurredAtUtc: string;
}

export interface LabAnalyzerEvidenceProjection {
  analyzerEvidencePublicId: string;
  versionPublicId: string | null;
  observationPublicId: string | null;
  sourceType: string;
  sourcePublicId: string;
  ingestionMessagePublicId: string | null;
  observationIndex: number;
  machineSourceType: string | null;
  machineSourcePublicId: string | null;
  protocol: string | null;
  payloadSha256: string;
  qcState: string;
  validationState: string;
  matchState: string;
  disposition: string;
  occurredAtUtc: string;
}

export interface LabResultSpecimenProjection {
  mode: LabResultSpecimenProviderMode;
  kind: 'specimen' | 'result';
  canonicalPublicId: string | null;
  patientLinkPublicId: string | null;
  encounterPublicId: string | null;
  requestPublicId: string | null;
  servicePublicId: string | null;
  specimenPublicId: string | null;
  practitionerPublicId: string | null;
  status: string;
  statusVersion: number;
  effectiveAtUtc: string;
  currentVersionPublicId: string | null;
  versionNumber: number;
  observationCount: number;
  historyVisible: boolean;
  custodyHistory: LabSpecimenCustodyProjection[];
  versions: LabResultVersionProjection[];
  observations: LabResultObservationProjection[];
  statusHistory: LabResultStatusProjection[];
  analyzerEvidence: LabAnalyzerEvidenceProjection[];
  legacy: {
    sourceType: LabResultSpecimenProviderSourceType;
    legacyId: number;
  };
  parity?: LabResultSpecimenParity;
}

interface ProviderFlagRow { mode: string; is_enabled: number | string }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface EncounterRow { encounter_public_id: string; patient_link_public_id: string | null; status: string }
interface PractitionerRow { practitioner_public_id: string; status: string }
interface LegacyFacts {
  kind: 'specimen' | 'result';
  patientId: number;
  encounterLegacyId: number;
  orderItemLegacyId: number;
  specimenLegacyId: number | null;
  practitionerLegacyUserId: number | null;
  status: string;
  effectiveAtUtc: string;
  observationCount: number;
  analyzerEvidenceCount: number;
}
interface CanonicalSpecimenRow {
  specimen_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  primary_request_public_id: string;
  primary_service_public_id: string;
  current_status: string;
  status_version: number;
  effective_at_utc: string;
}
interface CanonicalResultRow {
  result_set_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  request_public_id: string;
  service_public_id: string;
  specimen_public_id: string;
  creating_practitioner_public_id: string;
  current_status: string;
  status_version: number;
  current_version_public_id: string;
  version_number: number;
  effective_at_utc: string;
}
interface CustodyRow {
  event_public_id: string;
  event_version: number;
  event_type: string;
  from_status: string | null;
  to_status: string;
  actor_practitioner_public_id: string | null;
  occurred_at_utc: string;
}
interface VersionProjectionRow {
  version_public_id: string;
  version_number: number;
  supersedes_version_public_id: string | null;
  version_kind: string;
  version_status: string;
  content_sha256: string;
  signed_content_sha256: string | null;
  authoring_practitioner_public_id: string;
  verifying_practitioner_public_id: string | null;
  validating_practitioner_public_id: string | null;
  authored_at_utc: string;
  verified_at_utc: string | null;
  validated_at_utc: string | null;
  published_at_utc: string | null;
  retracted_at_utc: string | null;
}
interface ObservationProjectionRow {
  observation_public_id: string;
  version_public_id: string;
  observation_sequence: number;
  observation_code: string;
  code_system: string;
  display_snapshot: string;
  value_type: string;
  value_text: string | null;
  value_decimal: string | null;
  value_code: string | null;
  value_code_system: string | null;
  value_boolean: number | null;
  value_date_time_utc: string | null;
  unit_code: string | null;
  reference_low_decimal: string | null;
  reference_high_decimal: string | null;
  reference_text: string | null;
  interpretation_code: string | null;
  observation_status: string;
}
interface StatusProjectionRow {
  event_public_id: string;
  version_public_id: string;
  event_version: number;
  event_type: string;
  from_status: string | null;
  to_status: string;
  actor_practitioner_public_id: string | null;
  signed_content_sha256: string | null;
  occurred_at_utc: string;
}
interface AnalyzerProjectionRow {
  analyzer_evidence_public_id: string;
  version_public_id: string | null;
  observation_public_id: string | null;
  source_type: string;
  source_public_id: string;
  ingestion_message_public_id: string | null;
  observation_index: number;
  machine_source_type: string | null;
  machine_source_public_id: string | null;
  protocol: string | null;
  payload_sha256: string;
  qc_state: string;
  validation_state: string;
  match_state: string;
  disposition: string;
  occurred_at_utc: string;
}

const FLAG_KEY = 'canonical_lab_result_specimen_provider_v1';

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
  if (raw.endsWith('Z')) return toUtcIso(raw);
  const local = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return toUtcIso(`${local}+06:00`);
}

function mappedPublicId(row: MappingRow | null): string | null {
  return row?.mapping_status === 'mapped' && row.canonical_public_id ? row.canonical_public_id : null;
}

async function all<T>(statement: LabResultSpecimenProviderPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function readMapping(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
  entityType: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<string | null> {
  const row = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
  return mappedPublicId(row);
}

async function readProviderMapping(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
  sourceType: LabResultSpecimenProviderSourceType,
  legacyId: number,
): Promise<string | null> {
  return readMapping(
    db,
    tenantId,
    sourceType === 'legacy_lab_specimen' ? 'lab_specimen' : 'lab_result_set',
    sourceType,
    String(legacyId),
  );
}

async function resolvePatientLink(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
  patientId: number,
): Promise<string | null> {
  let publicId = await readMapping(db, tenantId, 'patient_link', 'legacy_patient', String(patientId));
  if (!publicId) {
    const direct = await db.prepare(`
      SELECT patient_link_public_id,link_status,effective_to_utc
      FROM canonical_tenant_patient_links
      WHERE tenant_id=? AND legacy_patient_id=? LIMIT 1
    `).bind(tenantId, patientId).first<PatientLinkRow>();
    if (direct && !['rejected', 'retired'].includes(direct.link_status) && direct.effective_to_utc == null) {
      publicId = direct.patient_link_public_id;
    }
  }
  if (!publicId) return null;
  const row = await db.prepare(`
    SELECT patient_link_public_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<PatientLinkRow>();
  return row && !['rejected', 'retired'].includes(row.link_status) && row.effective_to_utc == null
    ? row.patient_link_public_id
    : null;
}

async function resolveEncounter(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
  legacyVisitId: number,
  patientLinkPublicId: string | null,
): Promise<string | null> {
  if (!patientLinkPublicId) return null;
  const publicId = await readMapping(db, tenantId, 'encounter', 'legacy_visit', String(legacyVisitId));
  if (!publicId) return null;
  const row = await db.prepare(`
    SELECT encounter_public_id,patient_link_public_id,status FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<EncounterRow>();
  return row && row.patient_link_public_id === patientLinkPublicId && row.status !== 'entered_in_error'
    ? row.encounter_public_id
    : null;
}

async function resolvePractitioner(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
  legacyUserId: number | null,
): Promise<string | null> {
  if (legacyUserId == null) return null;
  const row = await db.prepare(`
    SELECT l.practitioner_public_id,p.status
    FROM canonical_practitioner_user_links l
    JOIN canonical_practitioners p
      ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
    WHERE l.tenant_id=? AND l.legacy_user_id=? AND l.link_status='active' LIMIT 1
  `).bind(tenantId, legacyUserId).first<PractitionerRow>();
  return row?.status === 'active' ? row.practitioner_public_id : null;
}

async function readLegacySpecimenFacts(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
  legacyId: number,
): Promise<LegacyFacts> {
  const row = await db.prepare(`
    SELECT s.patient_id,s.collection_status,s.collected_by,s.collected_at,
           s.received_by,s.received_at,s.rejected_by,s.rejected_at,s.created_at,s.updated_at,
           si.order_item_id,oi.visit_id
    FROM lab_specimens s
    LEFT JOIN lab_specimen_items si
      ON si.tenant_id=s.tenant_id AND si.specimen_id=s.id
    LEFT JOIN lab_order_items oi
      ON oi.tenant_id=si.tenant_id AND oi.id=si.order_item_id
    WHERE s.tenant_id=? AND s.id=? ORDER BY si.id LIMIT 1
  `).bind(tenantId, legacyId).first<Record<string, unknown>>();
  if (!row) throw new Error('legacy lab specimen row not found');
  const orderItemLegacyId = Number(row.order_item_id);
  const encounterLegacyId = Number(row.visit_id);
  if (!Number.isSafeInteger(orderItemLegacyId) || orderItemLegacyId <= 0) {
    throw new Error('legacy lab specimen has no exact order item');
  }
  if (!Number.isSafeInteger(encounterLegacyId) || encounterLegacyId <= 0) {
    throw new Error('legacy lab specimen has no exact encounter source');
  }
  const status = String(row.collection_status ?? 'unknown').trim().toLowerCase();
  const effective = status === 'rejected'
    ? row.rejected_at
    : status === 'received'
      ? row.received_at
      : status === 'collected'
        ? row.collected_at
        : row.updated_at ?? row.created_at;
  const actor = status === 'rejected'
    ? row.rejected_by
    : status === 'received'
      ? row.received_by
      : row.collected_by;
  return {
    kind: 'specimen',
    patientId: Number(row.patient_id),
    encounterLegacyId,
    orderItemLegacyId,
    specimenLegacyId: legacyId,
    practitionerLegacyUserId: actor == null ? null : Number(actor),
    status,
    effectiveAtUtc: normalizedUtc(effective as string | null, 'legacy specimen effective time'),
    observationCount: 0,
    analyzerEvidenceCount: 0,
  };
}

async function readLegacyResultFacts(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
  legacyId: number,
): Promise<LegacyFacts> {
  const row = await db.prepare(`
    SELECT oi.patient_id,oi.visit_id,oi.specimen_id,oi.status AS order_status,
           oi.result_status,oi.completed_at,oi.updated_at,
           (SELECT r.status FROM lab_results r
             WHERE r.tenant_id=oi.tenant_id AND r.order_item_id=oi.id ORDER BY r.id DESC LIMIT 1) AS result_status_row,
           (SELECT r.reported_by FROM lab_results r
             WHERE r.tenant_id=oi.tenant_id AND r.order_item_id=oi.id ORDER BY r.id DESC LIMIT 1) AS reported_by,
           (SELECT r.reported_at FROM lab_results r
             WHERE r.tenant_id=oi.tenant_id AND r.order_item_id=oi.id ORDER BY r.id DESC LIMIT 1) AS reported_at,
           (SELECT r.verified_by FROM lab_results r
             WHERE r.tenant_id=oi.tenant_id AND r.order_item_id=oi.id ORDER BY r.id DESC LIMIT 1) AS result_verified_by,
           (SELECT r.verified_at FROM lab_results r
             WHERE r.tenant_id=oi.tenant_id AND r.order_item_id=oi.id ORDER BY r.id DESC LIMIT 1) AS result_verified_at,
           (SELECT rp.report_status FROM lab_reports rp
             WHERE rp.tenant_id=oi.tenant_id AND rp.order_item_id=oi.id ORDER BY rp.id DESC LIMIT 1) AS report_status,
           (SELECT rp.reviewer_id FROM lab_reports rp
             WHERE rp.tenant_id=oi.tenant_id AND rp.order_item_id=oi.id ORDER BY rp.id DESC LIMIT 1) AS reviewer_id,
           (SELECT rp.validator_id FROM lab_reports rp
             WHERE rp.tenant_id=oi.tenant_id AND rp.order_item_id=oi.id ORDER BY rp.id DESC LIMIT 1) AS validator_id,
           (SELECT rp.verified_at FROM lab_reports rp
             WHERE rp.tenant_id=oi.tenant_id AND rp.order_item_id=oi.id ORDER BY rp.id DESC LIMIT 1) AS report_verified_at,
           (SELECT rp.validated_at FROM lab_reports rp
             WHERE rp.tenant_id=oi.tenant_id AND rp.order_item_id=oi.id ORDER BY rp.id DESC LIMIT 1) AS validated_at,
           (SELECT rp.published_at FROM lab_reports rp
             WHERE rp.tenant_id=oi.tenant_id AND rp.order_item_id=oi.id ORDER BY rp.id DESC LIMIT 1) AS published_at,
           (SELECT COUNT(*) FROM lab_results r
             WHERE r.tenant_id=oi.tenant_id AND r.order_item_id=oi.id) AS observation_count,
           (SELECT COUNT(*) FROM lab_results r
             WHERE r.tenant_id=oi.tenant_id AND r.order_item_id=oi.id AND r.analyzer_inbox_id IS NOT NULL) AS analyzer_count
    FROM lab_order_items oi WHERE oi.tenant_id=? AND oi.id=? LIMIT 1
  `).bind(tenantId, legacyId).first<Record<string, unknown>>();
  if (!row) throw new Error('legacy lab result row not found');
  const status = String(row.report_status ?? row.result_status_row ?? row.result_status ?? row.order_status ?? 'unknown')
    .trim().toLowerCase();
  const effective = row.published_at ?? row.validated_at ?? row.report_verified_at
    ?? row.result_verified_at ?? row.reported_at ?? row.completed_at ?? row.updated_at;
  const actor = row.validator_id ?? row.reviewer_id ?? row.result_verified_by ?? row.reported_by;
  return {
    kind: 'result',
    patientId: Number(row.patient_id),
    encounterLegacyId: Number(row.visit_id),
    orderItemLegacyId: legacyId,
    specimenLegacyId: row.specimen_id == null ? null : Number(row.specimen_id),
    practitionerLegacyUserId: actor == null ? null : Number(actor),
    status,
    effectiveAtUtc: normalizedUtc(effective as string | null, 'legacy result effective time'),
    observationCount: Number(row.observation_count ?? 0),
    analyzerEvidenceCount: Number(row.analyzer_count ?? 0),
  };
}

async function readLegacyFacts(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
  sourceType: LabResultSpecimenProviderSourceType,
  legacyId: number,
): Promise<LegacyFacts> {
  return sourceType === 'legacy_lab_specimen'
    ? readLegacySpecimenFacts(db, tenantId, legacyId)
    : readLegacyResultFacts(db, tenantId, legacyId);
}

export async function resolveLabResultSpecimenProviderMode(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
): Promise<LabResultSpecimenProviderMode> {
  const tenant = exact(tenantId, 'tenantId');
  let row: ProviderFlagRow | null;
  try {
    row = await db.prepare(`
      SELECT mode,is_enabled FROM canonical_feature_flags
      WHERE tenant_id=? AND flag_key=? LIMIT 1
    `).bind(tenant, FLAG_KEY).first<ProviderFlagRow>();
  } catch (error) {
    if (/no such table:\s*canonical_feature_flags/i.test(error instanceof Error ? error.message : String(error))) {
      return 'legacy';
    }
    throw error;
  }
  if (!row || Number(row.is_enabled) !== 1) return 'legacy';
  return row.mode === 'shadow' || row.mode === 'canonical' ? row.mode : 'legacy';
}

function mapCustody(row: CustodyRow): LabSpecimenCustodyProjection {
  return {
    eventPublicId: row.event_public_id,
    eventVersion: Number(row.event_version),
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    practitionerPublicId: row.actor_practitioner_public_id,
    occurredAtUtc: row.occurred_at_utc,
  };
}

async function readCanonicalSpecimen(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
  mappedPublicId: string,
  sourceType: LabResultSpecimenProviderSourceType,
  legacyId: number,
  mode: LabResultSpecimenProviderMode,
): Promise<LabResultSpecimenProjection> {
  const row = await db.prepare(`
    SELECT s.specimen_public_id,s.patient_link_public_id,s.encounter_public_id,
           s.primary_request_public_id,s.primary_service_public_id,s.current_status,s.status_version,
           e.occurred_at_utc AS effective_at_utc
    FROM canonical_lab_specimens s
    JOIN canonical_lab_specimen_status_events e
      ON e.tenant_id=s.tenant_id AND e.specimen_public_id=s.specimen_public_id
     AND e.event_public_id=s.current_status_event_public_id
    WHERE s.tenant_id=? AND s.specimen_public_id=? LIMIT 1
  `).bind(tenantId, mappedPublicId).first<CanonicalSpecimenRow>();
  if (!row) throw new Error('mapped canonical lab specimen not found');
  const custodyHistory = (await all<CustodyRow>(db.prepare(`
    SELECT event_public_id,event_version,event_type,from_status,to_status,
           actor_practitioner_public_id,occurred_at_utc
    FROM canonical_lab_specimen_status_events
    WHERE tenant_id=? AND specimen_public_id=? ORDER BY event_version,event_public_id
  `).bind(tenantId, mappedPublicId))).map(mapCustody);
  return {
    mode,
    kind: 'specimen',
    canonicalPublicId: row.specimen_public_id,
    patientLinkPublicId: row.patient_link_public_id,
    encounterPublicId: row.encounter_public_id,
    requestPublicId: row.primary_request_public_id,
    servicePublicId: row.primary_service_public_id,
    specimenPublicId: row.specimen_public_id,
    practitionerPublicId: custodyHistory.at(-1)?.practitionerPublicId ?? null,
    status: row.current_status,
    statusVersion: Number(row.status_version),
    effectiveAtUtc: row.effective_at_utc,
    currentVersionPublicId: null,
    versionNumber: 0,
    observationCount: 0,
    historyVisible: custodyHistory.length > 0,
    custodyHistory,
    versions: [],
    observations: [],
    statusHistory: [],
    analyzerEvidence: [],
    legacy: { sourceType, legacyId },
  };
}

function mapVersion(row: VersionProjectionRow): LabResultVersionProjection {
  return {
    versionPublicId: row.version_public_id,
    versionNumber: Number(row.version_number),
    supersedesVersionPublicId: row.supersedes_version_public_id,
    versionKind: row.version_kind,
    versionStatus: row.version_status,
    contentSha256: row.content_sha256,
    signedContentSha256: row.signed_content_sha256,
    authoringPractitionerPublicId: row.authoring_practitioner_public_id,
    verifyingPractitionerPublicId: row.verifying_practitioner_public_id,
    validatingPractitionerPublicId: row.validating_practitioner_public_id,
    authoredAtUtc: row.authored_at_utc,
    verifiedAtUtc: row.verified_at_utc,
    validatedAtUtc: row.validated_at_utc,
    publishedAtUtc: row.published_at_utc,
    retractedAtUtc: row.retracted_at_utc,
  };
}

function mapObservation(row: ObservationProjectionRow): LabResultObservationProjection {
  return {
    observationPublicId: row.observation_public_id,
    versionPublicId: row.version_public_id,
    observationSequence: Number(row.observation_sequence),
    observationCode: row.observation_code,
    codeSystem: row.code_system,
    displaySnapshot: row.display_snapshot,
    valueType: row.value_type,
    valueText: row.value_text,
    valueDecimal: row.value_decimal,
    valueCode: row.value_code,
    valueCodeSystem: row.value_code_system,
    valueBoolean: row.value_boolean == null ? null : Number(row.value_boolean),
    valueDateTimeUtc: row.value_date_time_utc,
    unitCode: row.unit_code,
    referenceLowDecimal: row.reference_low_decimal,
    referenceHighDecimal: row.reference_high_decimal,
    referenceText: row.reference_text,
    interpretationCode: row.interpretation_code,
    observationStatus: row.observation_status,
  };
}

function mapStatus(row: StatusProjectionRow): LabResultStatusProjection {
  return {
    eventPublicId: row.event_public_id,
    versionPublicId: row.version_public_id,
    eventVersion: Number(row.event_version),
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    practitionerPublicId: row.actor_practitioner_public_id,
    signedContentSha256: row.signed_content_sha256,
    occurredAtUtc: row.occurred_at_utc,
  };
}

function mapAnalyzer(row: AnalyzerProjectionRow): LabAnalyzerEvidenceProjection {
  return {
    analyzerEvidencePublicId: row.analyzer_evidence_public_id,
    versionPublicId: row.version_public_id,
    observationPublicId: row.observation_public_id,
    sourceType: row.source_type,
    sourcePublicId: row.source_public_id,
    ingestionMessagePublicId: row.ingestion_message_public_id,
    observationIndex: Number(row.observation_index),
    machineSourceType: row.machine_source_type,
    machineSourcePublicId: row.machine_source_public_id,
    protocol: row.protocol,
    payloadSha256: row.payload_sha256,
    qcState: row.qc_state,
    validationState: row.validation_state,
    matchState: row.match_state,
    disposition: row.disposition,
    occurredAtUtc: row.occurred_at_utc,
  };
}

async function readCanonicalResult(
  db: LabResultSpecimenProviderDatabase,
  tenantId: string,
  mappedPublicId: string,
  sourceType: LabResultSpecimenProviderSourceType,
  legacyId: number,
  mode: LabResultSpecimenProviderMode,
): Promise<LabResultSpecimenProjection> {
  const row = await db.prepare(`
    SELECT r.result_set_public_id,r.patient_link_public_id,r.encounter_public_id,
           r.request_public_id,r.service_public_id,r.specimen_public_id,
           r.creating_practitioner_public_id,r.current_status,r.status_version,
           r.current_version_public_id,v.version_number,
           COALESCE(v.published_at_utc,v.validated_at_utc,v.verified_at_utc,v.authored_at_utc) AS effective_at_utc
    FROM canonical_lab_result_sets r
    JOIN canonical_lab_result_versions v
      ON v.tenant_id=r.tenant_id AND v.result_set_public_id=r.result_set_public_id
     AND v.version_public_id=r.current_version_public_id
    WHERE r.tenant_id=? AND r.result_set_public_id=? LIMIT 1
  `).bind(tenantId, mappedPublicId).first<CanonicalResultRow>();
  if (!row) throw new Error('mapped canonical lab result set not found');
  const versions = (await all<VersionProjectionRow>(db.prepare(`
    SELECT version_public_id,version_number,supersedes_version_public_id,version_kind,
           version_status,content_sha256,signed_content_sha256,
           authoring_practitioner_public_id,verifying_practitioner_public_id,
           validating_practitioner_public_id,authored_at_utc,verified_at_utc,
           validated_at_utc,published_at_utc,retracted_at_utc
    FROM canonical_lab_result_versions
    WHERE tenant_id=? AND result_set_public_id=? ORDER BY version_number,version_public_id
  `).bind(tenantId, mappedPublicId))).map(mapVersion);
  const observations = (await all<ObservationProjectionRow>(db.prepare(`
    SELECT observation_public_id,version_public_id,observation_sequence,observation_code,
           code_system,display_snapshot,value_type,value_text,value_decimal,value_code,
           value_code_system,value_boolean,value_date_time_utc,unit_code,
           reference_low_decimal,reference_high_decimal,reference_text,
           interpretation_code,observation_status
    FROM canonical_lab_result_observations
    WHERE tenant_id=? AND result_set_public_id=?
    ORDER BY version_public_id,observation_sequence,observation_public_id
  `).bind(tenantId, mappedPublicId))).map(mapObservation);
  const statusHistory = (await all<StatusProjectionRow>(db.prepare(`
    SELECT event_public_id,version_public_id,event_version,event_type,from_status,to_status,
           actor_practitioner_public_id,signed_content_sha256,occurred_at_utc
    FROM canonical_lab_result_status_events
    WHERE tenant_id=? AND result_set_public_id=? ORDER BY event_version,event_public_id
  `).bind(tenantId, mappedPublicId))).map(mapStatus);
  const analyzerEvidence = (await all<AnalyzerProjectionRow>(db.prepare(`
    SELECT analyzer_evidence_public_id,version_public_id,observation_public_id,
           source_type,source_public_id,ingestion_message_public_id,observation_index,
           machine_source_type,machine_source_public_id,protocol,payload_sha256,
           qc_state,validation_state,match_state,disposition,occurred_at_utc
    FROM canonical_lab_analyzer_evidence
    WHERE tenant_id=? AND result_set_public_id=?
    ORDER BY version_public_id,observation_index,analyzer_evidence_public_id
  `).bind(tenantId, mappedPublicId))).map(mapAnalyzer);
  const custodyHistory = (await all<CustodyRow>(db.prepare(`
    SELECT event_public_id,event_version,event_type,from_status,to_status,
           actor_practitioner_public_id,occurred_at_utc
    FROM canonical_lab_specimen_status_events
    WHERE tenant_id=? AND specimen_public_id=? ORDER BY event_version,event_public_id
  `).bind(tenantId, row.specimen_public_id))).map(mapCustody);
  return {
    mode,
    kind: 'result',
    canonicalPublicId: row.result_set_public_id,
    patientLinkPublicId: row.patient_link_public_id,
    encounterPublicId: row.encounter_public_id,
    requestPublicId: row.request_public_id,
    servicePublicId: row.service_public_id,
    specimenPublicId: row.specimen_public_id,
    practitionerPublicId: statusHistory.at(-1)?.practitionerPublicId ?? row.creating_practitioner_public_id,
    status: row.current_status,
    statusVersion: Number(row.status_version),
    effectiveAtUtc: row.effective_at_utc,
    currentVersionPublicId: row.current_version_public_id,
    versionNumber: Number(row.version_number),
    observationCount: observations.filter((item) => item.versionPublicId === row.current_version_public_id).length,
    historyVisible: custodyHistory.length > 0 && versions.length > 0 && statusHistory.length > 0,
    custodyHistory,
    versions,
    observations,
    statusHistory,
    analyzerEvidence,
    legacy: { sourceType, legacyId },
  };
}

function parity(
  legacy: LabResultSpecimenProjection,
  canonical: LabResultSpecimenProjection | null,
  legacyAnalyzerCount: number,
): LabResultSpecimenParity {
  const requiresSignature = ['verified', 'validated', 'published'].includes(legacy.status);
  const result = {
    mapping: canonical != null,
    patientLink: canonical != null && legacy.patientLinkPublicId === canonical.patientLinkPublicId,
    encounter: canonical != null && legacy.encounterPublicId === canonical.encounterPublicId,
    request: canonical != null && legacy.requestPublicId === canonical.requestPublicId,
    service: canonical != null && legacy.servicePublicId === canonical.servicePublicId,
    specimen: canonical != null && legacy.specimenPublicId === canonical.specimenPublicId,
    status: canonical != null && legacy.status === canonical.status,
    clinicalShape: canonical != null && (
      legacy.kind === 'specimen' || legacy.observationCount === canonical.observationCount
    ),
    effectiveTime: canonical != null && legacy.effectiveAtUtc === canonical.effectiveAtUtc,
    custodyHistoryVisible: canonical != null && canonical.custodyHistory.length >= 1,
    versionHistoryVisible: canonical != null && (
      legacy.kind === 'specimen' || canonical.versions.length >= 1
    ),
    signatureHistoryVisible: canonical != null && (
      legacy.kind === 'specimen'
      || !requiresSignature
      || canonical.statusHistory.some((event) => event.signedContentSha256 != null)
    ),
    analyzerHistoryVisible: canonical != null && (
      legacy.kind === 'specimen'
      || legacyAnalyzerCount === 0
      || canonical.analyzerEvidence.length >= legacyAnalyzerCount
    ),
  };
  return { ok: Object.values(result).every(Boolean), ...result };
}

export async function resolveLabResultSpecimenProjection(
  db: LabResultSpecimenProviderDatabase,
  input: LabResultSpecimenProviderInput,
): Promise<LabResultSpecimenProjection> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const legacyId = positive(input.legacyId, 'legacyId');
  const sourceType = input.sourceType;
  const mode = await resolveLabResultSpecimenProviderMode(db, tenantId);
  const facts = await readLegacyFacts(db, tenantId, sourceType, legacyId);
  const canonicalPublicId = await readProviderMapping(db, tenantId, sourceType, legacyId);
  if (input.identitySensitive && !canonicalPublicId) {
    throw new Error('explicit lab result specimen source mapping is required for identity-sensitive reads');
  }
  if (mode === 'canonical' && !canonicalPublicId) {
    throw new Error('canonical lab result specimen mapping is required');
  }
  const patientLinkPublicId = await resolvePatientLink(db, tenantId, facts.patientId);
  const encounterPublicId = await resolveEncounter(db, tenantId, facts.encounterLegacyId, patientLinkPublicId);
  const requestPublicId = await readMapping(
    db, tenantId, 'service_request', 'legacy_lab_order_item', String(facts.orderItemLegacyId),
  );
  const servicePublicId = requestPublicId == null
    ? null
    : (await db.prepare(`
        SELECT service_public_id FROM canonical_service_requests
        WHERE tenant_id=? AND request_public_id=? LIMIT 1
      `).bind(tenantId, requestPublicId).first<{ service_public_id: string }>())?.service_public_id ?? null;
  const specimenPublicId = facts.specimenLegacyId == null
    ? null
    : await readMapping(db, tenantId, 'lab_specimen', 'legacy_lab_specimen', String(facts.specimenLegacyId));
  const practitionerPublicId = await resolvePractitioner(db, tenantId, facts.practitionerLegacyUserId);
  const legacyProjection: LabResultSpecimenProjection = {
    mode,
    kind: facts.kind,
    canonicalPublicId,
    patientLinkPublicId,
    encounterPublicId,
    requestPublicId,
    servicePublicId,
    specimenPublicId,
    practitionerPublicId,
    status: facts.status,
    statusVersion: 0,
    effectiveAtUtc: facts.effectiveAtUtc,
    currentVersionPublicId: null,
    versionNumber: 0,
    observationCount: facts.observationCount,
    historyVisible: false,
    custodyHistory: [],
    versions: [],
    observations: [],
    statusHistory: [],
    analyzerEvidence: [],
    legacy: { sourceType, legacyId },
  };
  if (mode === 'legacy') return legacyProjection;
  const canonicalProjection = canonicalPublicId
    ? sourceType === 'legacy_lab_specimen'
      ? await readCanonicalSpecimen(db, tenantId, canonicalPublicId, sourceType, legacyId, mode)
      : await readCanonicalResult(db, tenantId, canonicalPublicId, sourceType, legacyId, mode)
    : null;
  if (mode === 'canonical') {
    if (!canonicalProjection) throw new Error('canonical lab result specimen mapping is required');
    return canonicalProjection;
  }
  return {
    ...legacyProjection,
    mode: 'shadow',
    parity: parity(legacyProjection, canonicalProjection, facts.analyzerEvidenceCount),
  };
}
