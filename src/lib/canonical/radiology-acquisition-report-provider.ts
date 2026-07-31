import { toUtcIso } from './time';

export type RadiologyAcquisitionReportProviderMode = 'legacy' | 'shadow' | 'canonical';
export type RadiologyAcquisitionReportProviderSourceType =
  | 'legacy_radiology_requisition'
  | 'legacy_radiology_dicom_study'
  | 'legacy_radiology_report';

export interface RadiologyAcquisitionReportProviderPreparedStatement {
  bind(...values: unknown[]): RadiologyAcquisitionReportProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface RadiologyAcquisitionReportProviderDatabase {
  prepare(sql: string): RadiologyAcquisitionReportProviderPreparedStatement;
}
export interface RadiologyAcquisitionReportProviderInput {
  tenantId: string;
  sourceType: RadiologyAcquisitionReportProviderSourceType;
  legacyId: number;
  identitySensitive?: boolean;
}
export interface RadiologyAcquisitionReportParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  encounter: boolean;
  request: boolean;
  service: boolean;
  acquisition: boolean;
  acquisitionStatus: boolean;
  study: boolean;
  hierarchyVisible: boolean;
  provenanceVisible: boolean;
  report: boolean;
  reportStatus: boolean;
  signedHistoryVisible: boolean;
  effectiveTime: boolean;
}
export interface ImagingAcquisitionHistoryProjection {
  eventPublicId: string;
  eventVersion: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  practitionerPublicId: string | null;
  occurredAtUtc: string;
  reasonCode: string;
}
export interface ImagingStudyProjection {
  studyPublicId: string;
  studyInstanceUid: string;
  modalityCode: string;
  currentStatus: string;
  studyStartedAtUtc: string;
  seriesCount: number;
  instanceCount: number;
}
export interface ImagingSeriesProjection {
  seriesPublicId: string;
  studyPublicId: string;
  seriesInstanceUid: string;
  modalityCode: string;
  currentStatus: string;
  instanceCount: number;
}
export interface ImagingInstanceProjection {
  instancePublicId: string;
  studyPublicId: string;
  seriesPublicId: string;
  sopInstanceUid: string;
  sopClassUid: string;
  objectContentSha256: string;
  storageProviderType: string;
  storageProviderPublicId: string;
  storageObjectKey: string;
  storageGeneration: string;
  disposition: string;
}
export interface ImagingProvenanceProjection {
  provenanceEventPublicId: string;
  acquisitionPublicId: string | null;
  studyPublicId: string | null;
  seriesPublicId: string | null;
  instancePublicId: string | null;
  eventType: string;
  disposition: string;
  eventVersion: number;
  sourceAeTitle: string | null;
  protocol: string | null;
  objectContentSha256: string | null;
  storageProviderType: string | null;
  storageProviderPublicId: string | null;
  storageObjectKey: string | null;
  storageGeneration: string | null;
  occurredAtUtc: string;
}
export interface ImagingReportVersionProjection {
  versionPublicId: string;
  versionNumber: number;
  supersedesVersionPublicId: string | null;
  versionKind: string;
  versionStatus: string;
  contentJson: string;
  contentSha256: string;
  signedContentSha256: string | null;
  authoringPractitionerPublicId: string;
  verifyingPractitionerPublicId: string | null;
  finalisingPractitionerPublicId: string | null;
  authoredAtUtc: string;
  verifiedAtUtc: string | null;
  finalisedAtUtc: string | null;
  publishedAtUtc: string | null;
  retractedAtUtc: string | null;
  reasonCode: string | null;
}
export interface ImagingReportStatusProjection {
  eventPublicId: string;
  versionPublicId: string;
  eventVersion: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  practitionerPublicId: string | null;
  signedContentSha256: string | null;
  reasonCode: string;
  occurredAtUtc: string;
}
export interface RadiologyAcquisitionReportProjection {
  mode: RadiologyAcquisitionReportProviderMode;
  kind: 'acquisition' | 'study' | 'report';
  canonicalPublicId: string | null;
  acquisitionPublicId: string | null;
  studyPublicId: string | null;
  reportSetPublicId: string | null;
  patientLinkPublicId: string | null;
  encounterPublicId: string | null;
  requestPublicId: string | null;
  servicePublicId: string | null;
  practitionerPublicId: string | null;
  status: string;
  statusVersion: number;
  effectiveAtUtc: string;
  historyVisible: boolean;
  acquisitionHistory: ImagingAcquisitionHistoryProjection[];
  studies: ImagingStudyProjection[];
  series: ImagingSeriesProjection[];
  instances: ImagingInstanceProjection[];
  provenance: ImagingProvenanceProjection[];
  reportVersions: ImagingReportVersionProjection[];
  reportStatusHistory: ImagingReportStatusProjection[];
  legacy: { sourceType: RadiologyAcquisitionReportProviderSourceType; legacyId: number };
  parity?: RadiologyAcquisitionReportParity;
}

interface FlagRow { mode: string; is_enabled: number | string }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface LegacyFacts {
  kind: 'acquisition' | 'study' | 'report';
  status: string;
  effectiveAtUtc: string;
  patientId: number | null;
  requisitionId: number | null;
  studyId: number | null;
  practitionerId: number | null;
  seriesCount: number;
  instanceCount: number;
}
interface AcquisitionRow {
  acquisition_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  request_public_id: string;
  service_public_id: string;
  performing_practitioner_public_id: string | null;
  current_status: string;
  status_version: number;
  scheduled_at_utc: string | null;
  started_at_utc: string | null;
  completed_at_utc: string | null;
  cancelled_at_utc: string | null;
  entered_in_error_at_utc: string | null;
  created_at_utc: string;
}
interface StudyRow {
  study_public_id: string;
  acquisition_public_id: string;
  study_instance_uid: string;
  modality_code: string;
  current_status: string;
  study_started_at_utc: string;
  series_count: number;
  instance_count: number;
}
interface ReportSetRow {
  report_set_public_id: string;
  acquisition_public_id: string;
  study_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  request_public_id: string;
  service_public_id: string;
  reporting_practitioner_public_id: string;
  current_status: string;
  status_version: number;
  created_at_utc: string;
}

const FLAG_KEY = 'canonical_radiology_acquisition_report_provider_v1';

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
async function all<T>(statement: RadiologyAcquisitionReportProviderPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}
async function mapping(
  db: RadiologyAcquisitionReportProviderDatabase,
  tenantId: string,
  entityType: string,
  sourceType: string,
  legacyId: number,
): Promise<string | null> {
  const row = await db.prepare(`SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1`)
    .bind(tenantId, entityType, sourceType, String(legacyId)).first<MappingRow>();
  return row?.mapping_status === 'mapped' && row.canonical_public_id ? row.canonical_public_id : null;
}

export async function resolveRadiologyAcquisitionReportProviderMode(
  db: RadiologyAcquisitionReportProviderDatabase,
  tenantIdRaw: string,
): Promise<RadiologyAcquisitionReportProviderMode> {
  const tenantId = exact(tenantIdRaw, 'tenantId');
  const row = await db.prepare(`SELECT mode,is_enabled FROM canonical_feature_flags
    WHERE tenant_id=? AND flag_key=? ORDER BY version DESC LIMIT 1`).bind(tenantId, FLAG_KEY).first<FlagRow>();
  const enabled = Number(row?.is_enabled ?? 0) === 1;
  if (!enabled) return 'legacy';
  return row?.mode === 'shadow' || row?.mode === 'canonical' ? row.mode : 'legacy';
}

async function readLegacyFacts(
  db: RadiologyAcquisitionReportProviderDatabase,
  tenantId: string,
  sourceType: RadiologyAcquisitionReportProviderSourceType,
  legacyId: number,
): Promise<LegacyFacts> {
  if (sourceType === 'legacy_radiology_requisition') {
    const row = await db.prepare(`SELECT patient_id,order_status,is_scanned,scanned_by,scanned_on,created_at,updated_at
      FROM radiology_requisitions WHERE tenant_id=? AND id=? LIMIT 1`).bind(tenantId, legacyId).first<{
      patient_id: number; order_status: string; is_scanned: number; scanned_by: string | null;
      scanned_on: string | null; created_at: string | null; updated_at: string | null;
    }>();
    if (!row) throw new Error('legacy radiology requisition not found');
    return {
      kind: 'acquisition', status: row.order_status || (row.is_scanned ? 'scanned' : 'pending'),
      effectiveAtUtc: normalizedLegacyUtc(row.scanned_on ?? row.updated_at ?? row.created_at),
      patientId: row.patient_id, requisitionId: legacyId, studyId: null,
      practitionerId: row.scanned_by ? Number(row.scanned_by) : null, seriesCount: 0, instanceCount: 0,
    };
  }
  if (sourceType === 'legacy_radiology_dicom_study') {
    const row = await db.prepare(`SELECT patient_id,requisition_id,is_active,series_count,image_count,study_date,created_at,updated_at
      FROM radiology_dicom_studies WHERE tenant_id=? AND id=? LIMIT 1`).bind(tenantId, legacyId).first<{
      patient_id: number | null; requisition_id: number | null; is_active: number;
      series_count: number; image_count: number; study_date: string | null;
      created_at: string | null; updated_at: string | null;
    }>();
    if (!row) throw new Error('legacy radiology DICOM study not found');
    return {
      kind: 'study', status: row.is_active === 1 ? 'active' : 'inactive',
      effectiveAtUtc: normalizedLegacyUtc(row.study_date ?? row.updated_at ?? row.created_at),
      patientId: row.patient_id, requisitionId: row.requisition_id, studyId: legacyId,
      practitionerId: null, seriesCount: Number(row.series_count ?? 0), instanceCount: Number(row.image_count ?? 0),
    };
  }
  const row = await db.prepare(`SELECT patient_id,requisition_id,patient_study_id,performer_id,order_status,is_active,created_at,updated_at
    FROM radiology_reports WHERE tenant_id=? AND id=? LIMIT 1`).bind(tenantId, legacyId).first<{
    patient_id: number; requisition_id: number; patient_study_id: number | null; performer_id: number | null;
    order_status: string; is_active: number; created_at: string | null; updated_at: string | null;
  }>();
  if (!row) throw new Error('legacy radiology report not found');
  return {
    kind: 'report', status: row.is_active === 0 ? 'entered_in_error' : row.order_status,
    effectiveAtUtc: normalizedLegacyUtc(row.updated_at ?? row.created_at),
    patientId: row.patient_id, requisitionId: row.requisition_id, studyId: row.patient_study_id,
    practitionerId: row.performer_id, seriesCount: 0, instanceCount: 0,
  };
}

async function canonicalRoot(
  db: RadiologyAcquisitionReportProviderDatabase,
  tenantId: string,
  sourceType: RadiologyAcquisitionReportProviderSourceType,
  canonicalPublicId: string,
): Promise<{ acquisition: AcquisitionRow; study: StudyRow | null; report: ReportSetRow | null }> {
  let acquisition: AcquisitionRow | null = null;
  let study: StudyRow | null = null;
  let report: ReportSetRow | null = null;
  if (sourceType === 'legacy_radiology_requisition') {
    acquisition = await db.prepare(`SELECT acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,
      service_public_id,performing_practitioner_public_id,current_status,status_version,scheduled_at_utc,started_at_utc,
      completed_at_utc,cancelled_at_utc,entered_in_error_at_utc,created_at_utc
      FROM canonical_imaging_acquisitions WHERE tenant_id=? AND acquisition_public_id=? LIMIT 1`)
      .bind(tenantId, canonicalPublicId).first<AcquisitionRow>();
  } else if (sourceType === 'legacy_radiology_dicom_study') {
    study = await db.prepare(`SELECT study_public_id,acquisition_public_id,study_instance_uid,modality_code,current_status,
      study_started_at_utc,series_count,instance_count FROM canonical_imaging_studies
      WHERE tenant_id=? AND study_public_id=? LIMIT 1`).bind(tenantId, canonicalPublicId).first<StudyRow>();
    if (study) acquisition = await db.prepare(`SELECT acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,
      service_public_id,performing_practitioner_public_id,current_status,status_version,scheduled_at_utc,started_at_utc,
      completed_at_utc,cancelled_at_utc,entered_in_error_at_utc,created_at_utc FROM canonical_imaging_acquisitions
      WHERE tenant_id=? AND acquisition_public_id=? LIMIT 1`).bind(tenantId, study.acquisition_public_id).first<AcquisitionRow>();
  } else {
    report = await db.prepare(`SELECT report_set_public_id,acquisition_public_id,study_public_id,patient_link_public_id,
      encounter_public_id,request_public_id,service_public_id,reporting_practitioner_public_id,current_status,status_version,
      created_at_utc FROM canonical_imaging_report_sets WHERE tenant_id=? AND report_set_public_id=? LIMIT 1`)
      .bind(tenantId, canonicalPublicId).first<ReportSetRow>();
    if (report) {
      study = await db.prepare(`SELECT study_public_id,acquisition_public_id,study_instance_uid,modality_code,current_status,
        study_started_at_utc,series_count,instance_count FROM canonical_imaging_studies WHERE tenant_id=? AND study_public_id=? LIMIT 1`)
        .bind(tenantId, report.study_public_id).first<StudyRow>();
      acquisition = await db.prepare(`SELECT acquisition_public_id,patient_link_public_id,encounter_public_id,request_public_id,
        service_public_id,performing_practitioner_public_id,current_status,status_version,scheduled_at_utc,started_at_utc,
        completed_at_utc,cancelled_at_utc,entered_in_error_at_utc,created_at_utc FROM canonical_imaging_acquisitions
        WHERE tenant_id=? AND acquisition_public_id=? LIMIT 1`).bind(tenantId, report.acquisition_public_id).first<AcquisitionRow>();
    }
  }
  if (!acquisition) throw new Error('exact canonical radiology acquisition mapping does not resolve');
  return { acquisition, study, report };
}

function canonicalEffectiveAt(acquisition: AcquisitionRow, report: ReportSetRow | null, study: StudyRow | null): string {
  return report?.created_at_utc ?? study?.study_started_at_utc ?? acquisition.completed_at_utc
    ?? acquisition.started_at_utc ?? acquisition.scheduled_at_utc ?? acquisition.created_at_utc;
}

export async function resolveRadiologyAcquisitionReportProjection(
  db: RadiologyAcquisitionReportProviderDatabase,
  raw: RadiologyAcquisitionReportProviderInput,
): Promise<RadiologyAcquisitionReportProjection> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const legacyId = positive(raw.legacyId, 'legacyId');
  const sourceType = raw.sourceType;
  const mode = await resolveRadiologyAcquisitionReportProviderMode(db, tenantId);
  const legacy = await readLegacyFacts(db, tenantId, sourceType, legacyId);
  const entityType = sourceType === 'legacy_radiology_requisition' ? 'imaging_acquisition'
    : sourceType === 'legacy_radiology_dicom_study' ? 'imaging_study' : 'imaging_report_set';
  const canonicalPublicId = await mapping(db, tenantId, entityType, sourceType, legacyId);

  if (mode === 'legacy') {
    if (raw.identitySensitive && !canonicalPublicId) throw new Error('explicit radiology acquisition/report source mapping is required');
    return {
      mode, kind: legacy.kind, canonicalPublicId, acquisitionPublicId: null, studyPublicId: null,
      reportSetPublicId: null, patientLinkPublicId: null, encounterPublicId: null, requestPublicId: null,
      servicePublicId: null, practitionerPublicId: null, status: legacy.status, statusVersion: 0,
      effectiveAtUtc: legacy.effectiveAtUtc, historyVisible: false, acquisitionHistory: [], studies: [],
      series: [], instances: [], provenance: [], reportVersions: [], reportStatusHistory: [],
      legacy: { sourceType, legacyId },
    };
  }
  if (!canonicalPublicId) throw new Error('explicit radiology acquisition/report source mapping is required for canonical provider mode');

  const root = await canonicalRoot(db, tenantId, sourceType, canonicalPublicId);
  const acquisitionId = root.acquisition.acquisition_public_id;
  const studies = await all<StudyRow>(db.prepare(`SELECT study_public_id,acquisition_public_id,study_instance_uid,modality_code,
    current_status,study_started_at_utc,series_count,instance_count FROM canonical_imaging_studies
    WHERE tenant_id=? AND acquisition_public_id=? ORDER BY study_started_at_utc,study_public_id`).bind(tenantId, acquisitionId));
  const acquisitionHistoryRows = await all<{
    event_public_id: string; event_version: number; event_type: string; from_status: string | null;
    to_status: string; actor_practitioner_public_id: string | null; occurred_at_utc: string; reason_code: string;
  }>(db.prepare(`SELECT event_public_id,event_version,event_type,from_status,to_status,actor_practitioner_public_id,
    occurred_at_utc,reason_code FROM canonical_imaging_acquisition_status_events
    WHERE tenant_id=? AND acquisition_public_id=? ORDER BY event_version`).bind(tenantId, acquisitionId));
  const seriesRows = await all<{
    series_public_id: string; study_public_id: string; series_instance_uid: string; modality_code: string;
    current_status: string; instance_count: number;
  }>(db.prepare(`SELECT s.series_public_id,s.study_public_id,s.series_instance_uid,s.modality_code,s.current_status,s.instance_count
    FROM canonical_imaging_series s JOIN canonical_imaging_studies st
      ON st.tenant_id=s.tenant_id AND st.study_public_id=s.study_public_id
    WHERE s.tenant_id=? AND st.acquisition_public_id=? ORDER BY s.study_public_id,s.series_public_id`).bind(tenantId, acquisitionId));
  const instanceRows = await all<{
    instance_public_id: string; study_public_id: string; series_public_id: string; sop_instance_uid: string;
    sop_class_uid: string; object_content_sha256: string; storage_provider_type: string;
    storage_provider_public_id: string; storage_object_key: string; storage_generation: string; current_disposition: string;
  }>(db.prepare(`SELECT i.instance_public_id,i.study_public_id,i.series_public_id,i.sop_instance_uid,i.sop_class_uid,
    i.object_content_sha256,i.storage_provider_type,i.storage_provider_public_id,i.storage_object_key,
    i.storage_generation,i.current_disposition FROM canonical_imaging_instances i
    JOIN canonical_imaging_studies st ON st.tenant_id=i.tenant_id AND st.study_public_id=i.study_public_id
    WHERE i.tenant_id=? AND st.acquisition_public_id=? ORDER BY i.study_public_id,i.series_public_id,i.instance_public_id`).bind(tenantId, acquisitionId));
  const provenanceRows = await all<{
    provenance_event_public_id: string; acquisition_public_id: string | null; study_public_id: string | null;
    series_public_id: string | null; instance_public_id: string | null; event_type: string; disposition: string;
    event_version: number; source_ae_title: string | null; protocol: string | null; object_content_sha256: string | null;
    storage_provider_type: string | null; storage_provider_public_id: string | null; storage_object_key: string | null;
    storage_generation: string | null; occurred_at_utc: string;
  }>(db.prepare(`SELECT provenance_event_public_id,acquisition_public_id,study_public_id,series_public_id,instance_public_id,
    event_type,disposition,event_version,source_ae_title,protocol,object_content_sha256,storage_provider_type,
    storage_provider_public_id,storage_object_key,storage_generation,occurred_at_utc
    FROM canonical_imaging_provenance_events WHERE tenant_id=? AND acquisition_public_id=?
    ORDER BY occurred_at_utc,provenance_event_public_id`).bind(tenantId, acquisitionId));
  const reportSet = root.report ?? await db.prepare(`SELECT report_set_public_id,acquisition_public_id,study_public_id,
    patient_link_public_id,encounter_public_id,request_public_id,service_public_id,reporting_practitioner_public_id,
    current_status,status_version,created_at_utc FROM canonical_imaging_report_sets
    WHERE tenant_id=? AND acquisition_public_id=? ORDER BY created_at_utc DESC LIMIT 1`).bind(tenantId, acquisitionId).first<ReportSetRow>();
  const reportVersions = reportSet ? await all<{
    version_public_id: string; version_number: number; supersedes_version_public_id: string | null;
    version_kind: string; version_status: string; content_json: string; content_sha256: string;
    signed_content_sha256: string | null; authoring_practitioner_public_id: string;
    verifying_practitioner_public_id: string | null; finalising_practitioner_public_id: string | null;
    authored_at_utc: string; verified_at_utc: string | null; finalised_at_utc: string | null;
    published_at_utc: string | null; retracted_at_utc: string | null; reason_code: string | null;
  }>(db.prepare(`SELECT version_public_id,version_number,supersedes_version_public_id,version_kind,version_status,
    content_json,content_sha256,signed_content_sha256,authoring_practitioner_public_id,verifying_practitioner_public_id,
    finalising_practitioner_public_id,authored_at_utc,verified_at_utc,finalised_at_utc,published_at_utc,
    retracted_at_utc,reason_code FROM canonical_imaging_report_versions
    WHERE tenant_id=? AND report_set_public_id=? ORDER BY version_number`).bind(tenantId, reportSet.report_set_public_id)) : [];
  const reportEvents = reportSet ? await all<{
    event_public_id: string; version_public_id: string; event_version: number; event_type: string;
    from_status: string | null; to_status: string; actor_practitioner_public_id: string | null;
    signed_content_sha256: string | null; reason_code: string; occurred_at_utc: string;
  }>(db.prepare(`SELECT event_public_id,version_public_id,event_version,event_type,from_status,to_status,
    actor_practitioner_public_id,signed_content_sha256,reason_code,occurred_at_utc
    FROM canonical_imaging_report_status_events WHERE tenant_id=? AND report_set_public_id=? ORDER BY event_version`)
    .bind(tenantId, reportSet.report_set_public_id)) : [];

  const canonicalStatus = sourceType === 'legacy_radiology_report' && reportSet ? reportSet.current_status
    : sourceType === 'legacy_radiology_dicom_study' && root.study ? root.study.current_status : root.acquisition.current_status;
  const canonicalVersion = sourceType === 'legacy_radiology_report' && reportSet ? Number(reportSet.status_version)
    : sourceType === 'legacy_radiology_dicom_study' && root.study ? 1 : Number(root.acquisition.status_version);
  const effectiveAtUtc = canonicalEffectiveAt(root.acquisition, reportSet, root.study);
  const parity: RadiologyAcquisitionReportParity = {
    mapping: true,
    patientLink: Boolean(root.acquisition.patient_link_public_id),
    encounter: Boolean(root.acquisition.encounter_public_id),
    request: Boolean(root.acquisition.request_public_id),
    service: Boolean(root.acquisition.service_public_id),
    acquisition: true,
    acquisitionStatus: sourceType !== 'legacy_radiology_requisition' || legacy.status === canonicalStatus || (legacy.status === 'reported' && canonicalStatus === 'completed'),
    study: sourceType === 'legacy_radiology_requisition' || studies.length > 0,
    hierarchyVisible: studies.length > 0,
    provenanceVisible: provenanceRows.length > 0,
    report: sourceType !== 'legacy_radiology_report' || Boolean(reportSet),
    reportStatus: sourceType !== 'legacy_radiology_report' || legacy.status === canonicalStatus || (legacy.status === 'final' && canonicalStatus === 'published'),
    signedHistoryVisible: sourceType !== 'legacy_radiology_report' || reportEvents.some((event) => event.signed_content_sha256 != null),
    effectiveTime: effectiveAtUtc !== '1970-01-01T00:00:00.000Z',
    ok: false,
  };
  parity.ok = Object.entries(parity).filter(([key]) => key !== 'ok').every(([, value]) => value === true);

  return {
    mode,
    kind: legacy.kind,
    canonicalPublicId,
    acquisitionPublicId: acquisitionId,
    studyPublicId: root.study?.study_public_id ?? reportSet?.study_public_id ?? studies[0]?.study_public_id ?? null,
    reportSetPublicId: reportSet?.report_set_public_id ?? null,
    patientLinkPublicId: root.acquisition.patient_link_public_id,
    encounterPublicId: root.acquisition.encounter_public_id,
    requestPublicId: root.acquisition.request_public_id,
    servicePublicId: root.acquisition.service_public_id,
    practitionerPublicId: reportSet?.reporting_practitioner_public_id ?? root.acquisition.performing_practitioner_public_id,
    status: mode === 'shadow' ? legacy.status : canonicalStatus,
    statusVersion: mode === 'shadow' ? 0 : canonicalVersion,
    effectiveAtUtc: mode === 'shadow' ? legacy.effectiveAtUtc : effectiveAtUtc,
    historyVisible: mode === 'canonical',
    acquisitionHistory: mode === 'canonical' ? acquisitionHistoryRows.map((row) => ({
      eventPublicId: row.event_public_id, eventVersion: Number(row.event_version), eventType: row.event_type,
      fromStatus: row.from_status, toStatus: row.to_status, practitionerPublicId: row.actor_practitioner_public_id,
      occurredAtUtc: row.occurred_at_utc, reasonCode: row.reason_code,
    })) : [],
    studies: mode === 'canonical' ? studies.map((row) => ({
      studyPublicId: row.study_public_id, studyInstanceUid: row.study_instance_uid, modalityCode: row.modality_code,
      currentStatus: row.current_status, studyStartedAtUtc: row.study_started_at_utc,
      seriesCount: Number(row.series_count), instanceCount: Number(row.instance_count),
    })) : [],
    series: mode === 'canonical' ? seriesRows.map((row) => ({
      seriesPublicId: row.series_public_id, studyPublicId: row.study_public_id,
      seriesInstanceUid: row.series_instance_uid, modalityCode: row.modality_code,
      currentStatus: row.current_status, instanceCount: Number(row.instance_count),
    })) : [],
    instances: mode === 'canonical' ? instanceRows.map((row) => ({
      instancePublicId: row.instance_public_id, studyPublicId: row.study_public_id,
      seriesPublicId: row.series_public_id, sopInstanceUid: row.sop_instance_uid, sopClassUid: row.sop_class_uid,
      objectContentSha256: row.object_content_sha256, storageProviderType: row.storage_provider_type,
      storageProviderPublicId: row.storage_provider_public_id, storageObjectKey: row.storage_object_key,
      storageGeneration: row.storage_generation, disposition: row.current_disposition,
    })) : [],
    provenance: mode === 'canonical' ? provenanceRows.map((row) => ({
      provenanceEventPublicId: row.provenance_event_public_id, acquisitionPublicId: row.acquisition_public_id,
      studyPublicId: row.study_public_id, seriesPublicId: row.series_public_id, instancePublicId: row.instance_public_id,
      eventType: row.event_type, disposition: row.disposition, eventVersion: Number(row.event_version),
      sourceAeTitle: row.source_ae_title, protocol: row.protocol, objectContentSha256: row.object_content_sha256,
      storageProviderType: row.storage_provider_type, storageProviderPublicId: row.storage_provider_public_id,
      storageObjectKey: row.storage_object_key, storageGeneration: row.storage_generation, occurredAtUtc: row.occurred_at_utc,
    })) : [],
    reportVersions: mode === 'canonical' ? reportVersions.map((row) => ({
      versionPublicId: row.version_public_id, versionNumber: Number(row.version_number),
      supersedesVersionPublicId: row.supersedes_version_public_id, versionKind: row.version_kind,
      versionStatus: row.version_status, contentJson: row.content_json, contentSha256: row.content_sha256,
      signedContentSha256: row.signed_content_sha256, authoringPractitionerPublicId: row.authoring_practitioner_public_id,
      verifyingPractitionerPublicId: row.verifying_practitioner_public_id,
      finalisingPractitionerPublicId: row.finalising_practitioner_public_id, authoredAtUtc: row.authored_at_utc,
      verifiedAtUtc: row.verified_at_utc, finalisedAtUtc: row.finalised_at_utc,
      publishedAtUtc: row.published_at_utc, retractedAtUtc: row.retracted_at_utc, reasonCode: row.reason_code,
    })) : [],
    reportStatusHistory: mode === 'canonical' ? reportEvents.map((row) => ({
      eventPublicId: row.event_public_id, versionPublicId: row.version_public_id,
      eventVersion: Number(row.event_version), eventType: row.event_type, fromStatus: row.from_status,
      toStatus: row.to_status, practitionerPublicId: row.actor_practitioner_public_id,
      signedContentSha256: row.signed_content_sha256, reasonCode: row.reason_code, occurredAtUtc: row.occurred_at_utc,
    })) : [],
    legacy: { sourceType, legacyId },
    parity,
  };
}
