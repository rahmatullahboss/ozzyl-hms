import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface RadiologyAcquisitionReportReconciliationPreparedStatement {
  bind(...values: unknown[]): RadiologyAcquisitionReportReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface RadiologyAcquisitionReportReconciliationDatabase {
  prepare(sql: string): RadiologyAcquisitionReportReconciliationPreparedStatement;
}
export interface RadiologyAcquisitionReportReconciliationOptions {
  tenantId: string;
  runPublicId: string;
  migrationRunPublicId: string;
  nowUtc: string;
  sourceFingerprintBefore: string;
  sourceFingerprintAfter: string;
  foreignKeyViolationCount: number;
  integrityStatus: 'ok' | 'failed';
  secondPassNewBusinessRows: number;
}
export interface RadiologyAcquisitionReportReconciliationChecks {
  sourceMappingOwnership: number;
  acquisitionPatientOwnership: number;
  acquisitionEncounterOwnership: number;
  acquisitionRequestEventServiceConsistency: number;
  acquisitionCurrentStatusEventOwnership: number;
  acquisitionStatusEventSequenceCurrentState: number;
  acquisitionPerformerActorCompleteness: number;
  studyAcquisitionPatientRequestOwnership: number;
  studyUidNamespaceUniqueness: number;
  studyAccessionModalityConsistency: number;
  seriesStudyOwnershipUidUniqueness: number;
  seriesStatusInstanceCountProjection: number;
  instanceSeriesStudyOwnership: number;
  sopInstanceUidClassUniqueness: number;
  acceptedInstanceHashStorageCompleteness: number;
  provenanceSourceIdentityContentHashUniqueness: number;
  provenanceHierarchyOwnership: number;
  reportSetPatientEncounterRequestStudyOwnership: number;
  currentReportVersionOwnership: number;
  reportVersionSequenceContiguity: number;
  reportSupersessionScopeReplacement: number;
  reportContentCompletenessHashValidity: number;
  reportPractitionerScope: number;
  signedContentHashParity: number;
  reportStatusEventSequenceCurrentState: number;
  correctionRetractionErrorLineage: number;
  unresolvedCriticalProcessingIssues: number;
  sourceFingerprintParity: number;
  foreignKeyIntegrityCompositeGate: number;
  secondPassNewBusinessRows: number;
}
export interface RadiologyAcquisitionReportReconciliationResult {
  status: 'passed' | 'failed';
  scannedChecks: 30;
  matchedChecks: number;
  mismatchChecks: number;
  checks: RadiologyAcquisitionReportReconciliationChecks;
  evidenceSha256: string;
}

interface MigrationRunRow { id: number; status: string }
interface ExistingReceiptRow { result_summary_json: string | null }
interface CountRow { count: number }
interface PersistedSummary {
  schemaVersion: 1;
  namedChecks: string[];
  result: RadiologyAcquisitionReportReconciliationResult;
  sourceFingerprints: { before: string; after: string };
  integrity: { foreignKeyViolationCount: number; status: 'ok' | 'failed' };
  secondPass: { newBusinessRows: number };
}

export const RADIOLOGY_RECONCILIATION_CHECK_NAMES = [
  'source_mapping_ownership',
  'acquisition_patient_ownership',
  'acquisition_encounter_ownership',
  'acquisition_request_event_service_consistency',
  'acquisition_current_status_event_ownership',
  'acquisition_status_event_sequence_current_state',
  'acquisition_performer_actor_completeness',
  'study_acquisition_patient_request_ownership',
  'study_uid_namespace_uniqueness',
  'study_accession_modality_consistency',
  'series_study_ownership_uid_uniqueness',
  'series_status_instance_count_projection',
  'instance_series_study_ownership',
  'sop_instance_uid_class_uniqueness',
  'accepted_instance_hash_storage_completeness',
  'provenance_source_identity_content_hash_uniqueness',
  'provenance_hierarchy_ownership',
  'report_set_patient_encounter_request_study_ownership',
  'current_report_version_ownership',
  'report_version_sequence_contiguity',
  'report_supersession_scope_replacement',
  'report_content_completeness_hash_validity',
  'report_practitioner_scope',
  'signed_content_hash_parity',
  'report_status_event_sequence_current_state',
  'correction_retraction_error_lineage',
  'unresolved_critical_processing_issues',
  'source_fingerprint_parity',
  'foreign_key_integrity_composite_gate',
  'second_pass_new_business_rows',
] as const;

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}
function sha256(value: string, label: string): string {
  const normalized = exact(value, label);
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  return normalized;
}
function normalizedUtc(value: string): string {
  const normalized = toUtcIso(value);
  if (normalized !== value) throw new RangeError('nowUtc must be a normalized UTC ISO timestamp');
  return normalized;
}
function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
}
async function count(
  db: RadiologyAcquisitionReportReconciliationDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}
async function resolveMigrationRun(
  db: RadiologyAcquisitionReportReconciliationDatabase,
  tenantId: string,
  runPublicId: string,
): Promise<MigrationRunRow> {
  const row = await db.prepare(`SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1`)
    .bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!row) throw new Error('radiology acquisition/report backfill migration run not found');
  if (row.status !== 'succeeded') throw new Error('radiology acquisition/report backfill migration run is not succeeded');
  return row;
}

async function collectChecks(
  db: RadiologyAcquisitionReportReconciliationDatabase,
  tenantId: string,
  input: Pick<RadiologyAcquisitionReportReconciliationOptions,
    'sourceFingerprintBefore' | 'sourceFingerprintAfter' | 'foreignKeyViolationCount' | 'integrityStatus' | 'secondPassNewBusinessRows'>,
): Promise<RadiologyAcquisitionReportReconciliationChecks> {
  return {
    sourceMappingOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT m.id FROM canonical_source_mappings m
        LEFT JOIN canonical_imaging_acquisitions a ON a.tenant_id=m.tenant_id AND a.acquisition_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='imaging_acquisition' AND m.mapping_status='mapped' AND a.id IS NULL
        UNION ALL
        SELECT m.id FROM canonical_source_mappings m
        LEFT JOIN canonical_imaging_studies s ON s.tenant_id=m.tenant_id AND s.study_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='imaging_study' AND m.mapping_status='mapped' AND s.id IS NULL
        UNION ALL
        SELECT m.id FROM canonical_source_mappings m
        LEFT JOIN canonical_imaging_series s ON s.tenant_id=m.tenant_id AND s.series_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='imaging_series' AND m.mapping_status='mapped' AND s.id IS NULL
        UNION ALL
        SELECT m.id FROM canonical_source_mappings m
        LEFT JOIN canonical_imaging_instances i ON i.tenant_id=m.tenant_id AND i.instance_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='imaging_instance' AND m.mapping_status='mapped' AND i.id IS NULL
        UNION ALL
        SELECT m.id FROM canonical_source_mappings m
        LEFT JOIN canonical_imaging_provenance_events p ON p.tenant_id=m.tenant_id AND p.provenance_event_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='imaging_provenance' AND m.mapping_status='mapped' AND p.id IS NULL
        UNION ALL
        SELECT m.id FROM canonical_source_mappings m
        LEFT JOIN canonical_imaging_report_sets r ON r.tenant_id=m.tenant_id AND r.report_set_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='imaging_report_set' AND m.mapping_status='mapped' AND r.id IS NULL
      )
    `, [tenantId, tenantId, tenantId, tenantId, tenantId, tenantId]),

    acquisitionPatientOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_acquisitions a
      LEFT JOIN canonical_tenant_patient_links p
        ON p.tenant_id=a.tenant_id AND p.patient_link_public_id=a.patient_link_public_id
      WHERE a.tenant_id=? AND (
        p.id IS NULL OR p.link_status IN ('rejected','retired') OR p.effective_to_utc IS NOT NULL
      )
    `, [tenantId]),

    acquisitionEncounterOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_acquisitions a
      LEFT JOIN canonical_encounters e
        ON e.tenant_id=a.tenant_id AND e.encounter_public_id=a.encounter_public_id
      WHERE a.tenant_id=? AND (
        e.id IS NULL OR e.patient_link_public_id IS NOT a.patient_link_public_id OR e.status='entered_in_error'
      )
    `, [tenantId]),

    acquisitionRequestEventServiceConsistency: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_acquisitions a
      LEFT JOIN canonical_service_requests r
        ON r.tenant_id=a.tenant_id AND r.request_public_id=a.request_public_id
      LEFT JOIN canonical_service_catalog_items c
        ON c.tenant_id=a.tenant_id AND c.service_public_id=a.service_public_id
      LEFT JOIN canonical_service_events e
        ON e.tenant_id=a.tenant_id AND e.event_public_id=a.event_public_id
      WHERE a.tenant_id=? AND (
        r.id IS NULL OR r.encounter_public_id IS NOT a.encounter_public_id OR r.service_public_id IS NOT a.service_public_id
        OR c.id IS NULL OR c.item_kind!='radiology'
        OR (a.event_public_id IS NOT NULL AND (
          e.id IS NULL OR e.request_public_id IS NOT a.request_public_id
          OR e.encounter_public_id IS NOT a.encounter_public_id OR e.service_public_id IS NOT a.service_public_id
          OR e.status!='posted'
        ))
      )
    `, [tenantId]),

    acquisitionCurrentStatusEventOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_acquisitions a
      LEFT JOIN canonical_imaging_acquisition_status_events e
        ON e.tenant_id=a.tenant_id AND e.acquisition_public_id=a.acquisition_public_id
       AND e.event_public_id=a.current_status_event_public_id
      WHERE a.tenant_id=? AND (a.current_status_event_public_id IS NULL OR e.id IS NULL)
    `, [tenantId]),

    acquisitionStatusEventSequenceCurrentState: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT a.id FROM canonical_imaging_acquisitions a
        LEFT JOIN canonical_imaging_acquisition_status_events e
          ON e.tenant_id=a.tenant_id AND e.acquisition_public_id=a.acquisition_public_id
         AND e.event_public_id=a.current_status_event_public_id
        WHERE a.tenant_id=? AND (
          e.id IS NULL OR e.event_version!=a.status_version OR e.to_status IS NOT a.current_status
        )
        UNION ALL
        SELECT MIN(id) FROM canonical_imaging_acquisition_status_events
        WHERE tenant_id=? GROUP BY acquisition_public_id
        HAVING MIN(event_version)!=1 OR MAX(event_version)!=COUNT(*)
      )
    `, [tenantId, tenantId]),

    acquisitionPerformerActorCompleteness: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT a.id FROM canonical_imaging_acquisitions a
        LEFT JOIN canonical_practitioners p
          ON p.tenant_id=a.tenant_id AND p.practitioner_public_id=a.performing_practitioner_public_id
        WHERE a.tenant_id=? AND a.current_status='completed'
          AND (a.performing_practitioner_public_id IS NULL OR p.id IS NULL OR p.status!='active')
        UNION ALL
        SELECT e.id FROM canonical_imaging_acquisition_status_events e
        LEFT JOIN canonical_practitioners p
          ON p.tenant_id=e.tenant_id AND p.practitioner_public_id=e.actor_practitioner_public_id
        WHERE e.tenant_id=? AND (
          (e.actor_practitioner_public_id IS NULL AND e.actor_user_public_id IS NULL AND e.actor_system_key IS NULL)
          OR (e.event_type='completed' AND (e.actor_practitioner_public_id IS NULL OR p.id IS NULL OR p.status!='active'))
        )
      )
    `, [tenantId, tenantId]),

    studyAcquisitionPatientRequestOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_studies s
      LEFT JOIN canonical_imaging_acquisitions a
        ON a.tenant_id=s.tenant_id AND a.acquisition_public_id=s.acquisition_public_id
      WHERE s.tenant_id=? AND (
        a.id IS NULL OR a.patient_link_public_id IS NOT s.patient_link_public_id
        OR a.encounter_public_id IS NOT s.encounter_public_id
        OR a.request_public_id IS NOT s.request_public_id
        OR a.service_public_id IS NOT s.service_public_id
      )
    `, [tenantId]),

    studyUidNamespaceUniqueness: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT MIN(id) FROM canonical_imaging_studies WHERE tenant_id=?
        GROUP BY study_uid_namespace,study_instance_uid HAVING COUNT(*)>1
        UNION ALL
        SELECT id FROM canonical_imaging_studies WHERE tenant_id=? AND (
          length(trim(study_uid_namespace))=0 OR length(trim(study_instance_uid))=0
        )
      )
    `, [tenantId, tenantId]),

    studyAccessionModalityConsistency: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_studies s
      JOIN canonical_imaging_acquisitions a
        ON a.tenant_id=s.tenant_id AND a.acquisition_public_id=s.acquisition_public_id
      WHERE s.tenant_id=? AND (
        s.accession_namespace IS NOT a.accession_namespace
        OR s.accession_value IS NOT a.accession_value
        OR s.modality_code IS NOT a.modality_code
      )
    `, [tenantId]),

    seriesStudyOwnershipUidUniqueness: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT s.id FROM canonical_imaging_series s
        LEFT JOIN canonical_imaging_studies st
          ON st.tenant_id=s.tenant_id AND st.study_public_id=s.study_public_id
        WHERE s.tenant_id=? AND st.id IS NULL
        UNION ALL
        SELECT MIN(id) FROM canonical_imaging_series WHERE tenant_id=?
        GROUP BY series_uid_namespace,series_instance_uid HAVING COUNT(*)>1
        UNION ALL
        SELECT id FROM canonical_imaging_series WHERE tenant_id=? AND (
          length(trim(series_uid_namespace))=0 OR length(trim(series_instance_uid))=0
        )
      )
    `, [tenantId, tenantId, tenantId]),

    seriesStatusInstanceCountProjection: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_series s
      WHERE s.tenant_id=? AND (
        s.current_status NOT IN ('active','completed','retracted','entered_in_error')
        OR s.instance_count!=(SELECT COUNT(*) FROM canonical_imaging_instances i
          WHERE i.tenant_id=s.tenant_id AND i.series_public_id=s.series_public_id)
      )
    `, [tenantId]),

    instanceSeriesStudyOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_instances i
      LEFT JOIN canonical_imaging_series s
        ON s.tenant_id=i.tenant_id AND s.series_public_id=i.series_public_id
      LEFT JOIN canonical_imaging_studies st
        ON st.tenant_id=i.tenant_id AND st.study_public_id=i.study_public_id
      WHERE i.tenant_id=? AND (
        s.id IS NULL OR st.id IS NULL OR s.study_public_id IS NOT i.study_public_id
      )
    `, [tenantId]),

    sopInstanceUidClassUniqueness: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT MIN(id) FROM canonical_imaging_instances WHERE tenant_id=?
        GROUP BY sop_uid_namespace,sop_instance_uid HAVING COUNT(*)>1
        UNION ALL
        SELECT id FROM canonical_imaging_instances WHERE tenant_id=? AND (
          length(trim(sop_uid_namespace))=0 OR length(trim(sop_instance_uid))=0 OR length(trim(sop_class_uid))=0
        )
      )
    `, [tenantId, tenantId]),

    acceptedInstanceHashStorageCompleteness: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_instances WHERE tenant_id=? AND current_disposition='accepted' AND (
        length(object_content_sha256)!=64 OR object_content_sha256!=lower(object_content_sha256)
        OR object_content_sha256 GLOB '*[^0-9a-f]*'
        OR length(trim(storage_provider_type))=0 OR length(trim(storage_provider_public_id))=0
        OR length(trim(storage_object_key))=0 OR length(trim(storage_generation))=0
        OR byte_size<0 OR frame_count<=0
      )
    `, [tenantId]),

    provenanceSourceIdentityContentHashUniqueness: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT id FROM canonical_imaging_provenance_events WHERE tenant_id=? AND (
          (modality_source_type IS NULL)!=(modality_source_public_id IS NULL)
          OR (pacs_endpoint_source_type IS NULL)!=(pacs_endpoint_source_public_id IS NULL)
          OR (bridge_source_type IS NULL)!=(bridge_source_public_id IS NULL)
          OR (message_source_type IS NULL)!=(message_source_public_id IS NULL)
          OR ((storage_provider_type IS NULL OR storage_provider_public_id IS NULL OR storage_object_key IS NULL OR storage_generation IS NULL)
              AND NOT (storage_provider_type IS NULL AND storage_provider_public_id IS NULL AND storage_object_key IS NULL AND storage_generation IS NULL))
          OR (object_content_sha256 IS NOT NULL AND (
            length(object_content_sha256)!=64 OR object_content_sha256!=lower(object_content_sha256)
            OR object_content_sha256 GLOB '*[^0-9a-f]*'
          ))
        )
        UNION ALL
        SELECT MIN(id) FROM canonical_imaging_provenance_events
        WHERE tenant_id=? AND instance_public_id IS NOT NULL AND object_content_sha256 IS NOT NULL
        GROUP BY instance_public_id,object_content_sha256,disposition HAVING COUNT(*)>1
      )
    `, [tenantId, tenantId]),

    provenanceHierarchyOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_provenance_events p
      LEFT JOIN canonical_imaging_acquisitions a
        ON a.tenant_id=p.tenant_id AND a.acquisition_public_id=p.acquisition_public_id
      LEFT JOIN canonical_imaging_studies st
        ON st.tenant_id=p.tenant_id AND st.study_public_id=p.study_public_id
      LEFT JOIN canonical_imaging_series s
        ON s.tenant_id=p.tenant_id AND s.series_public_id=p.series_public_id
      LEFT JOIN canonical_imaging_instances i
        ON i.tenant_id=p.tenant_id AND i.instance_public_id=p.instance_public_id
      WHERE p.tenant_id=? AND (
        (p.acquisition_public_id IS NOT NULL AND a.id IS NULL)
        OR (p.study_public_id IS NOT NULL AND (st.id IS NULL OR (p.acquisition_public_id IS NOT NULL AND st.acquisition_public_id IS NOT p.acquisition_public_id)))
        OR (p.series_public_id IS NOT NULL AND (s.id IS NULL OR p.study_public_id IS NULL OR s.study_public_id IS NOT p.study_public_id))
        OR (p.instance_public_id IS NOT NULL AND (
          i.id IS NULL OR p.study_public_id IS NULL OR p.series_public_id IS NULL
          OR i.study_public_id IS NOT p.study_public_id OR i.series_public_id IS NOT p.series_public_id
        ))
      )
    `, [tenantId]),

    reportSetPatientEncounterRequestStudyOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_report_sets r
      LEFT JOIN canonical_imaging_acquisitions a
        ON a.tenant_id=r.tenant_id AND a.acquisition_public_id=r.acquisition_public_id
      LEFT JOIN canonical_imaging_studies s
        ON s.tenant_id=r.tenant_id AND s.study_public_id=r.study_public_id
      WHERE r.tenant_id=? AND (
        a.id IS NULL OR s.id IS NULL OR s.acquisition_public_id IS NOT r.acquisition_public_id
        OR a.patient_link_public_id IS NOT r.patient_link_public_id
        OR a.encounter_public_id IS NOT r.encounter_public_id
        OR a.request_public_id IS NOT r.request_public_id
        OR a.service_public_id IS NOT r.service_public_id
        OR s.patient_link_public_id IS NOT r.patient_link_public_id
        OR s.encounter_public_id IS NOT r.encounter_public_id
        OR s.request_public_id IS NOT r.request_public_id
        OR s.service_public_id IS NOT r.service_public_id
      )
    `, [tenantId]),

    currentReportVersionOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_report_sets r
      LEFT JOIN canonical_imaging_report_versions v
        ON v.tenant_id=r.tenant_id AND v.report_set_public_id=r.report_set_public_id
       AND v.version_public_id=r.current_version_public_id
      WHERE r.tenant_id=? AND (
        r.current_version_public_id IS NULL OR v.id IS NULL OR v.version_status IS NOT r.current_status
      )
    `, [tenantId]),

    reportVersionSequenceContiguity: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT MIN(id) FROM canonical_imaging_report_versions WHERE tenant_id=?
        GROUP BY report_set_public_id
        HAVING MIN(version_number)!=1 OR MAX(version_number)!=COUNT(*)
      )
    `, [tenantId]),

    reportSupersessionScopeReplacement: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT child.id FROM canonical_imaging_report_versions child
        LEFT JOIN canonical_imaging_report_versions parent
          ON parent.tenant_id=child.tenant_id AND parent.report_set_public_id=child.report_set_public_id
         AND parent.version_public_id=child.supersedes_version_public_id
        WHERE child.tenant_id=? AND child.supersedes_version_public_id IS NOT NULL AND parent.id IS NULL
        UNION ALL
        SELECT MIN(id) FROM canonical_imaging_report_versions
        WHERE tenant_id=? AND supersedes_version_public_id IS NOT NULL
        GROUP BY report_set_public_id,supersedes_version_public_id HAVING COUNT(*)>1
      )
    `, [tenantId, tenantId]),

    reportContentCompletenessHashValidity: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_report_versions WHERE tenant_id=? AND (
        json_valid(content_json)=0
        OR length(trim(COALESCE(json_extract(content_json,'$.findings'),'')))=0
        OR length(trim(COALESCE(json_extract(content_json,'$.impression'),'')))=0
        OR length(content_sha256)!=64 OR content_sha256!=lower(content_sha256)
        OR content_sha256 GLOB '*[^0-9a-f]*'
      )
    `, [tenantId]),

    reportPractitionerScope: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_report_versions v
      LEFT JOIN canonical_practitioners author
        ON author.tenant_id=v.tenant_id AND author.practitioner_public_id=v.authoring_practitioner_public_id
      LEFT JOIN canonical_practitioners verifier
        ON verifier.tenant_id=v.tenant_id AND verifier.practitioner_public_id=v.verifying_practitioner_public_id
      LEFT JOIN canonical_practitioners finaliser
        ON finaliser.tenant_id=v.tenant_id AND finaliser.practitioner_public_id=v.finalising_practitioner_public_id
      WHERE v.tenant_id=? AND (
        author.id IS NULL OR author.status!='active'
        OR (v.verifying_practitioner_public_id IS NOT NULL AND (verifier.id IS NULL OR verifier.status!='active'))
        OR (v.finalising_practitioner_public_id IS NOT NULL AND (finaliser.id IS NULL OR finaliser.status!='active'))
      )
    `, [tenantId]),

    signedContentHashParity: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT v.id FROM canonical_imaging_report_versions v
        WHERE v.tenant_id=? AND v.version_status IN ('verified','final','published') AND (
          v.signed_content_sha256 IS NULL OR v.signed_content_sha256 IS NOT v.content_sha256
          OR v.verifying_practitioner_public_id IS NULL OR v.verified_at_utc IS NULL
          OR (v.version_status IN ('final','published') AND (v.finalising_practitioner_public_id IS NULL OR v.finalised_at_utc IS NULL))
          OR (v.version_status='published' AND v.published_at_utc IS NULL)
        )
        UNION ALL
        SELECT e.id FROM canonical_imaging_report_status_events e
        JOIN canonical_imaging_report_versions v
          ON v.tenant_id=e.tenant_id AND v.report_set_public_id=e.report_set_public_id
         AND v.version_public_id=e.version_public_id
        WHERE e.tenant_id=? AND e.event_type IN ('verified','finalised','published') AND (
          e.signed_content_sha256 IS NULL OR e.signed_content_sha256 IS NOT v.content_sha256
        )
      )
    `, [tenantId, tenantId]),

    reportStatusEventSequenceCurrentState: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT r.id FROM canonical_imaging_report_sets r
        LEFT JOIN canonical_imaging_report_status_events e
          ON e.tenant_id=r.tenant_id AND e.report_set_public_id=r.report_set_public_id
         AND e.event_public_id=r.current_status_event_public_id
        WHERE r.tenant_id=? AND (
          e.id IS NULL OR e.event_version!=r.status_version OR e.to_status IS NOT r.current_status
          OR e.version_public_id IS NOT r.current_version_public_id
        )
        UNION ALL
        SELECT MIN(id) FROM canonical_imaging_report_status_events
        WHERE tenant_id=? GROUP BY report_set_public_id
        HAVING MIN(event_version)!=1 OR MAX(event_version)!=COUNT(*)
      )
    `, [tenantId, tenantId]),

    correctionRetractionErrorLineage: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_imaging_report_versions v WHERE v.tenant_id=? AND (
        (v.version_kind='draft' AND v.supersedes_version_public_id IS NOT NULL)
        OR (v.version_kind IN ('amendment','correction','retraction','entered_in_error') AND (
          v.supersedes_version_public_id IS NULL OR v.reason_code IS NULL OR length(trim(v.reason_code))=0
        ))
        OR (v.version_kind='retraction' AND v.version_status!='retracted')
        OR (v.version_kind='entered_in_error' AND v.version_status!='entered_in_error')
      )
    `, [tenantId]),

    unresolvedCriticalProcessingIssues: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_processing_issues
      WHERE tenant_id=? AND entity_type='radiology_acquisition_report'
        AND severity='critical' AND status IN ('open','acknowledged')
    `, [tenantId]),

    sourceFingerprintParity: input.sourceFingerprintBefore === input.sourceFingerprintAfter ? 0 : 1,
    foreignKeyIntegrityCompositeGate: input.foreignKeyViolationCount + (input.integrityStatus === 'ok' ? 0 : 1),
    secondPassNewBusinessRows: input.secondPassNewBusinessRows,
  };
}

export async function reconcileCanonicalRadiologyAcquisitionReport(
  db: RadiologyAcquisitionReportReconciliationDatabase,
  raw: RadiologyAcquisitionReportReconciliationOptions,
): Promise<RadiologyAcquisitionReportReconciliationResult> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const runPublicId = exact(raw.runPublicId, 'runPublicId');
  const migrationRunPublicId = exact(raw.migrationRunPublicId, 'migrationRunPublicId');
  const nowUtc = normalizedUtc(raw.nowUtc);
  const sourceFingerprintBefore = sha256(raw.sourceFingerprintBefore, 'sourceFingerprintBefore');
  const sourceFingerprintAfter = sha256(raw.sourceFingerprintAfter, 'sourceFingerprintAfter');
  const foreignKeyViolationCount = nonNegativeInteger(raw.foreignKeyViolationCount, 'foreignKeyViolationCount');
  const secondPassNewBusinessRows = nonNegativeInteger(raw.secondPassNewBusinessRows, 'secondPassNewBusinessRows');
  if (!['ok', 'failed'].includes(raw.integrityStatus)) throw new TypeError('integrityStatus must be ok or failed');

  const existing = await db.prepare(`SELECT result_summary_json FROM canonical_reconciliation_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1`)
    .bind(tenantId, runPublicId).first<ExistingReceiptRow>();
  if (existing?.result_summary_json) {
    const parsed = JSON.parse(existing.result_summary_json) as PersistedSummary;
    return parsed.result;
  }

  const migrationRun = await resolveMigrationRun(db, tenantId, migrationRunPublicId);
  const checks = await collectChecks(db, tenantId, {
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    foreignKeyViolationCount,
    integrityStatus: raw.integrityStatus,
    secondPassNewBusinessRows,
  });
  const mismatchChecks = Object.values(checks).filter((value) => value !== 0).length;
  const matchedChecks = 30 - mismatchChecks;
  const status = mismatchChecks === 0 ? 'passed' : 'failed';
  const evidenceSha256 = await createSourceEvidenceSha256({
    schemaVersion: 1,
    domain: 'radiology_acquisition_report',
    migrationRunPublicId,
    namedChecks: RADIOLOGY_RECONCILIATION_CHECK_NAMES,
    checks,
    sourceFingerprints: { before: sourceFingerprintBefore, after: sourceFingerprintAfter },
    integrity: { foreignKeyViolationCount, status: raw.integrityStatus },
    secondPass: { newBusinessRows: secondPassNewBusinessRows },
  });
  const result: RadiologyAcquisitionReportReconciliationResult = {
    status,
    scannedChecks: 30,
    matchedChecks,
    mismatchChecks,
    checks,
    evidenceSha256,
  };
  const summary: PersistedSummary = {
    schemaVersion: 1,
    namedChecks: [...RADIOLOGY_RECONCILIATION_CHECK_NAMES],
    result,
    sourceFingerprints: { before: sourceFingerprintBefore, after: sourceFingerprintAfter },
    integrity: { foreignKeyViolationCount, status: raw.integrityStatus },
    secondPass: { newBusinessRows: secondPassNewBusinessRows },
  };
  await db.prepare(`INSERT INTO canonical_reconciliation_runs (
    tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
    scanned_count,matched_count,mismatch_count,exception_count,evidence_sha256,result_summary_json,
    started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
  ) VALUES (?,?,?,'radiology_acquisition_report','backfill',?,?,?,?,0,?,?,?,?,?,?)`).bind(
    tenantId,
    runPublicId,
    migrationRun.id,
    status,
    30,
    matchedChecks,
    mismatchChecks,
    evidenceSha256,
    stableCanonicalJson(summary),
    nowUtc,
    nowUtc,
    nowUtc,
    nowUtc,
  ).run();
  return result;
}
