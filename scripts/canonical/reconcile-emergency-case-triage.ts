import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface EmergencyCaseTriageReconciliationPreparedStatement {
  bind(...values: unknown[]): EmergencyCaseTriageReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface EmergencyCaseTriageReconciliationDatabase {
  prepare(sql: string): EmergencyCaseTriageReconciliationPreparedStatement;
}
export interface EmergencyCaseTriageReconciliationOptions {
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
export interface EmergencyCaseTriageReconciliationChecks {
  sourceMappingOwnership: number;
  caseTenantPatientEncounterOwnership: number;
  oneCasePerEncounter: number;
  initialArrivalOwnership: number;
  arrivalVersionReplacementLineage: number;
  currentArrivalPointerOwnership: number;
  currentStatusEventOwnership: number;
  statusEventSequenceCurrentState: number;
  lifecycleTransitionValidity: number;
  actorPractitionerScope: number;
  triageAssessmentOwnership: number;
  triageVersionReplacementLineage: number;
  currentTriagePointerParity: number;
  acuityObservedRecordedTimeValidity: number;
  exactVitalObservationLinkScope: number;
  classificationOwnershipVersionCodeValidity: number;
  animalBitePoliceTypedEvidenceCompleteness: number;
  dispositionOwnershipSequenceCurrentPointer: number;
  admittedCanonicalAdmissionExactLink: number;
  dischargedSignedDocumentExactLink: number;
  transferLamaDorDeathTypedEvidenceCompleteness: number;
  sourceFingerprintParity: number;
  foreignKeyIntegrityCompositeGate: number;
  secondPassNewBusinessRows: number;
}
export interface EmergencyCaseTriageReconciliationResult {
  status: 'passed' | 'failed';
  scannedChecks: 24;
  matchedChecks: number;
  mismatchChecks: number;
  checks: EmergencyCaseTriageReconciliationChecks;
  evidenceSha256: string;
}
interface MigrationRunRow { id: number; status: string }
interface ExistingReceiptRow { result_summary_json: string | null }
interface CountRow { count: number }
interface PersistedSummary {
  schemaVersion: 1;
  namedChecks: string[];
  result: EmergencyCaseTriageReconciliationResult;
  sourceFingerprints: { before: string; after: string };
  integrity: { foreignKeyViolationCount: number; status: 'ok' | 'failed'; unresolvedCriticalIssues: number };
  secondPass: { newBusinessRows: number };
}

export const EMERGENCY_RECONCILIATION_CHECK_NAMES = [
  'source_mapping_ownership',
  'case_tenant_patient_encounter_ownership',
  'one_case_per_encounter',
  'initial_arrival_ownership',
  'arrival_version_replacement_lineage',
  'current_arrival_pointer_ownership',
  'current_status_event_ownership',
  'status_event_sequence_current_state',
  'lifecycle_transition_validity',
  'actor_practitioner_scope',
  'triage_assessment_ownership',
  'triage_version_replacement_lineage',
  'current_triage_pointer_parity',
  'acuity_observed_recorded_time_validity',
  'exact_vital_observation_link_scope',
  'classification_ownership_version_code_validity',
  'animal_bite_police_typed_evidence_completeness',
  'disposition_ownership_sequence_current_pointer',
  'admitted_canonical_admission_exact_link',
  'discharged_signed_document_exact_link',
  'transfer_lama_dor_death_typed_evidence_completeness',
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
function digest(value: string, label: string): string {
  const normalized = exact(value, label);
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  return normalized;
}
function normalizedUtc(value: string): string {
  const normalized = toUtcIso(value);
  if (normalized !== value) throw new RangeError('nowUtc must be a normalized UTC ISO timestamp');
  return normalized;
}
function nonnegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
}
async function count(
  db: EmergencyCaseTriageReconciliationDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}
async function resolveMigrationRun(
  db: EmergencyCaseTriageReconciliationDatabase,
  tenantId: string,
  runPublicId: string,
): Promise<MigrationRunRow> {
  const row = await db.prepare(`SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1`).bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!row) throw new Error('emergency case/triage backfill migration run not found');
  if (row.status !== 'succeeded') throw new Error('emergency case/triage backfill migration run is not succeeded');
  return row;
}

async function collectChecks(
  db: EmergencyCaseTriageReconciliationDatabase,
  tenantId: string,
  input: Pick<EmergencyCaseTriageReconciliationOptions,
    'sourceFingerprintBefore' | 'sourceFingerprintAfter' | 'foreignKeyViolationCount' | 'integrityStatus' | 'secondPassNewBusinessRows'>,
): Promise<{ checks: EmergencyCaseTriageReconciliationChecks; unresolvedCriticalIssues: number }> {
  const unresolvedCriticalIssues = await count(db, `SELECT COUNT(*) AS count FROM canonical_processing_issues
    WHERE tenant_id=? AND entity_type='emergency_case_triage' AND status='open' AND severity='critical'`, [tenantId]);
  const checks: EmergencyCaseTriageReconciliationChecks = {
    sourceMappingOwnership: await count(db, `SELECT COUNT(*) AS count FROM (
      SELECT m.id FROM canonical_source_mappings m LEFT JOIN canonical_emergency_cases c
        ON c.tenant_id=m.tenant_id AND c.emergency_case_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='emergency_case' AND m.mapping_status='mapped' AND c.id IS NULL
      UNION ALL
      SELECT m.id FROM canonical_source_mappings m LEFT JOIN canonical_emergency_arrival_assessments a
        ON a.tenant_id=m.tenant_id AND a.arrival_assessment_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='emergency_arrival_assessment' AND m.mapping_status='mapped' AND a.id IS NULL
      UNION ALL
      SELECT m.id FROM canonical_source_mappings m LEFT JOIN canonical_emergency_triage_assessments t
        ON t.tenant_id=m.tenant_id AND t.triage_assessment_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='emergency_triage_assessment' AND m.mapping_status='mapped' AND t.id IS NULL
      UNION ALL
      SELECT m.id FROM canonical_source_mappings m LEFT JOIN canonical_emergency_case_classifications x
        ON x.tenant_id=m.tenant_id AND x.classification_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='emergency_case_classification' AND m.mapping_status='mapped' AND x.id IS NULL
      UNION ALL
      SELECT m.id FROM canonical_source_mappings m LEFT JOIN canonical_emergency_case_status_events e
        ON e.tenant_id=m.tenant_id AND e.event_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='emergency_case_status_event' AND m.mapping_status='mapped' AND e.id IS NULL
      UNION ALL
      SELECT m.id FROM canonical_source_mappings m LEFT JOIN canonical_emergency_disposition_events d
        ON d.tenant_id=m.tenant_id AND d.disposition_event_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='emergency_disposition_event' AND m.mapping_status='mapped' AND d.id IS NULL
    )`, [tenantId, tenantId, tenantId, tenantId, tenantId, tenantId]),

    caseTenantPatientEncounterOwnership: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_cases c
      LEFT JOIN canonical_tenant_patient_links p
        ON p.tenant_id=c.tenant_id AND p.patient_link_public_id=c.patient_link_public_id
      LEFT JOIN canonical_encounters e
        ON e.tenant_id=c.tenant_id AND e.encounter_public_id=c.encounter_public_id
      WHERE c.tenant_id=? AND (
        p.id IS NULL OR p.link_status IN ('rejected','retired') OR p.effective_to_utc IS NOT NULL
        OR e.id IS NULL OR e.patient_link_public_id IS NOT c.patient_link_public_id
        OR e.encounter_type!='emergency' OR e.status='cancelled'
      )`, [tenantId]),

    oneCasePerEncounter: await count(db, `SELECT COUNT(*) AS count FROM (
      SELECT encounter_public_id FROM canonical_emergency_cases WHERE tenant_id=?
      GROUP BY encounter_public_id HAVING COUNT(*)>1
    )`, [tenantId]),

    initialArrivalOwnership: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_cases c
      LEFT JOIN canonical_emergency_arrival_assessments a
        ON a.tenant_id=c.tenant_id AND a.emergency_case_public_id=c.emergency_case_public_id
       AND a.version_number=1 AND a.version_kind='initial'
      WHERE c.tenant_id=? AND (a.id IS NULL OR a.patient_link_public_id IS NOT c.patient_link_public_id
        OR a.encounter_public_id IS NOT c.encounter_public_id)`, [tenantId]),

    arrivalVersionReplacementLineage: await count(db, `SELECT COUNT(*) AS count FROM (
      SELECT emergency_case_public_id FROM canonical_emergency_arrival_assessments WHERE tenant_id=?
      GROUP BY emergency_case_public_id HAVING MIN(version_number)!=1 OR MAX(version_number)!=COUNT(*)
      UNION ALL
      SELECT a.arrival_assessment_public_id FROM canonical_emergency_arrival_assessments a
      LEFT JOIN canonical_emergency_arrival_assessments p
        ON p.tenant_id=a.tenant_id AND p.arrival_assessment_public_id=a.supersedes_arrival_assessment_public_id
      WHERE a.tenant_id=? AND a.version_number>1 AND (
        p.id IS NULL OR p.emergency_case_public_id IS NOT a.emergency_case_public_id
        OR p.version_number!=a.version_number-1 OR a.reason_code IS NULL
      )
    )`, [tenantId, tenantId]),

    currentArrivalPointerOwnership: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_cases c
      LEFT JOIN canonical_emergency_arrival_assessments a
        ON a.tenant_id=c.tenant_id AND a.emergency_case_public_id=c.emergency_case_public_id
       AND a.arrival_assessment_public_id=c.current_arrival_assessment_public_id
      WHERE c.tenant_id=? AND (
        a.id IS NULL OR a.patient_link_public_id IS NOT c.patient_link_public_id
        OR a.encounter_public_id IS NOT c.encounter_public_id
        OR a.version_number!=(SELECT MAX(a2.version_number) FROM canonical_emergency_arrival_assessments a2
          WHERE a2.tenant_id=c.tenant_id AND a2.emergency_case_public_id=c.emergency_case_public_id)
      )`, [tenantId]),

    currentStatusEventOwnership: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_cases c
      LEFT JOIN canonical_emergency_case_status_events e
        ON e.tenant_id=c.tenant_id AND e.emergency_case_public_id=c.emergency_case_public_id
       AND e.event_public_id=c.current_status_event_public_id
      WHERE c.tenant_id=? AND (e.id IS NULL OR e.event_version!=c.status_version OR e.to_status IS NOT c.current_status)`, [tenantId]),

    statusEventSequenceCurrentState: await count(db, `SELECT COUNT(*) AS count FROM (
      SELECT emergency_case_public_id FROM canonical_emergency_case_status_events WHERE tenant_id=?
      GROUP BY emergency_case_public_id HAVING MIN(event_version)!=1 OR MAX(event_version)!=COUNT(*)
      UNION ALL
      SELECT e.event_public_id FROM canonical_emergency_case_status_events e
      LEFT JOIN canonical_emergency_case_status_events p
        ON p.tenant_id=e.tenant_id AND p.emergency_case_public_id=e.emergency_case_public_id
       AND p.event_version=e.event_version-1
      WHERE e.tenant_id=? AND e.event_version>1 AND (p.id IS NULL OR p.to_status IS NOT e.from_status)
    )`, [tenantId, tenantId]),

    lifecycleTransitionValidity: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_case_status_events e
      WHERE e.tenant_id=? AND e.event_version>1 AND NOT (
        (e.from_status='arrived' AND e.to_status IN ('awaiting_triage','triaged','care_in_progress','entered_in_error'))
        OR (e.from_status='awaiting_triage' AND e.to_status IN ('triaged','care_in_progress','entered_in_error'))
        OR (e.from_status='triaged' AND e.to_status IN ('care_in_progress','observation','disposition_pending','entered_in_error'))
        OR (e.from_status='care_in_progress' AND e.to_status IN ('observation','disposition_pending','entered_in_error'))
        OR (e.from_status='observation' AND e.to_status IN ('care_in_progress','disposition_pending','entered_in_error'))
        OR (e.from_status='disposition_pending' AND e.to_status IN ('care_in_progress','observation','admitted','discharged','transferred','lama','dor','death','entered_in_error'))
        OR (e.from_status IN ('admitted','discharged','transferred','lama','dor','death') AND e.to_status='entered_in_error')
      )`, [tenantId]),

    actorPractitionerScope: await count(db, `SELECT COUNT(*) AS count FROM (
      SELECT a.id FROM canonical_emergency_arrival_assessments a LEFT JOIN canonical_practitioners p
        ON p.tenant_id=a.tenant_id AND p.practitioner_public_id=a.actor_practitioner_public_id
        WHERE a.tenant_id=? AND a.actor_practitioner_public_id IS NOT NULL AND (p.id IS NULL OR p.status!='active')
      UNION ALL
      SELECT e.id FROM canonical_emergency_case_status_events e LEFT JOIN canonical_practitioners p
        ON p.tenant_id=e.tenant_id AND p.practitioner_public_id=e.actor_practitioner_public_id
        WHERE e.tenant_id=? AND e.actor_practitioner_public_id IS NOT NULL AND (p.id IS NULL OR p.status!='active')
      UNION ALL
      SELECT t.id FROM canonical_emergency_triage_assessments t LEFT JOIN canonical_practitioners p
        ON p.tenant_id=t.tenant_id AND p.practitioner_public_id=t.triage_practitioner_public_id
        WHERE t.tenant_id=? AND (p.id IS NULL OR p.status!='active')
      UNION ALL
      SELECT x.id FROM canonical_emergency_case_classifications x LEFT JOIN canonical_practitioners p
        ON p.tenant_id=x.tenant_id AND p.practitioner_public_id=x.actor_practitioner_public_id
        WHERE x.tenant_id=? AND x.actor_practitioner_public_id IS NOT NULL AND (p.id IS NULL OR p.status!='active')
      UNION ALL
      SELECT d.id FROM canonical_emergency_disposition_events d LEFT JOIN canonical_practitioners p
        ON p.tenant_id=d.tenant_id AND p.practitioner_public_id=d.actor_practitioner_public_id
        WHERE d.tenant_id=? AND d.actor_practitioner_public_id IS NOT NULL AND (p.id IS NULL OR p.status!='active')
    )`, [tenantId, tenantId, tenantId, tenantId, tenantId]),

    triageAssessmentOwnership: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_triage_assessments t
      LEFT JOIN canonical_emergency_cases c
        ON c.tenant_id=t.tenant_id AND c.emergency_case_public_id=t.emergency_case_public_id
      WHERE t.tenant_id=? AND (c.id IS NULL OR c.patient_link_public_id IS NOT t.patient_link_public_id
        OR c.encounter_public_id IS NOT t.encounter_public_id)`, [tenantId]),

    triageVersionReplacementLineage: await count(db, `SELECT COUNT(*) AS count FROM (
      SELECT emergency_case_public_id FROM canonical_emergency_triage_assessments WHERE tenant_id=?
      GROUP BY emergency_case_public_id HAVING MIN(version_number)!=1 OR MAX(version_number)!=COUNT(*)
      UNION ALL
      SELECT t.triage_assessment_public_id FROM canonical_emergency_triage_assessments t
      LEFT JOIN canonical_emergency_triage_assessments p
        ON p.tenant_id=t.tenant_id AND p.triage_assessment_public_id=t.supersedes_triage_assessment_public_id
      WHERE t.tenant_id=? AND t.version_number>1 AND (
        p.id IS NULL OR p.emergency_case_public_id IS NOT t.emergency_case_public_id
        OR p.version_number!=t.version_number-1 OR t.reason_code IS NULL
      )
    )`, [tenantId, tenantId]),

    currentTriagePointerParity: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_cases c
      LEFT JOIN canonical_emergency_triage_assessments t
        ON t.tenant_id=c.tenant_id AND t.emergency_case_public_id=c.emergency_case_public_id
       AND t.triage_assessment_public_id=c.current_triage_assessment_public_id
      WHERE c.tenant_id=? AND (
        (c.current_triage_assessment_public_id IS NULL AND EXISTS (
          SELECT 1 FROM canonical_emergency_triage_assessments tx
          WHERE tx.tenant_id=c.tenant_id AND tx.emergency_case_public_id=c.emergency_case_public_id
        ))
        OR (c.current_triage_assessment_public_id IS NOT NULL AND (
          t.id IS NULL OR t.version_number!=(SELECT MAX(t2.version_number) FROM canonical_emergency_triage_assessments t2
            WHERE t2.tenant_id=c.tenant_id AND t2.emergency_case_public_id=c.emergency_case_public_id)
        ))
      )`, [tenantId]),

    acuityObservedRecordedTimeValidity: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_triage_assessments
      WHERE tenant_id=? AND (acuity_code NOT IN ('red','yellow','green') OR recorded_at_utc<observed_at_utc)`, [tenantId]),

    exactVitalObservationLinkScope: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_triage_assessments t
      LEFT JOIN canonical_vital_observation_sets v
        ON v.tenant_id=t.tenant_id AND v.observation_set_public_id=t.vital_observation_set_public_id
      WHERE t.tenant_id=? AND t.vital_observation_set_public_id IS NOT NULL AND (
        v.id IS NULL OR v.patient_link_public_id IS NOT t.patient_link_public_id
        OR v.encounter_public_id IS NOT t.encounter_public_id OR v.review_status='entered_in_error'
      )`, [tenantId]),

    classificationOwnershipVersionCodeValidity: await count(db, `SELECT COUNT(*) AS count FROM (
      SELECT x.id FROM canonical_emergency_case_classifications x LEFT JOIN canonical_emergency_cases c
        ON c.tenant_id=x.tenant_id AND c.emergency_case_public_id=x.emergency_case_public_id
        WHERE x.tenant_id=? AND (c.id IS NULL OR c.patient_link_public_id IS NOT x.patient_link_public_id
          OR c.encounter_public_id IS NOT x.encounter_public_id OR length(trim(x.classification_namespace))=0
          OR length(trim(x.classification_code))=0 OR length(trim(x.category_code))=0)
      UNION ALL
      SELECT classification_family_public_id FROM canonical_emergency_case_classifications WHERE tenant_id=?
        GROUP BY classification_family_public_id HAVING MIN(version_number)!=1 OR MAX(version_number)!=COUNT(*)
    )`, [tenantId, tenantId]),

    animalBitePoliceTypedEvidenceCompleteness: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_case_classifications
      WHERE tenant_id=? AND (
        (category_code='animal_bite' AND (animal_category_code IS NULL OR bite_site_code IS NULL OR bite_at_utc IS NULL))
        OR (category_code='police_case' AND police_case_indicator!=1)
      )`, [tenantId]),

    dispositionOwnershipSequenceCurrentPointer: await count(db, `SELECT COUNT(*) AS count FROM (
      SELECT d.id FROM canonical_emergency_disposition_events d LEFT JOIN canonical_emergency_cases c
        ON c.tenant_id=d.tenant_id AND c.emergency_case_public_id=d.emergency_case_public_id
        WHERE d.tenant_id=? AND (c.id IS NULL OR c.patient_link_public_id IS NOT d.patient_link_public_id
          OR c.encounter_public_id IS NOT d.encounter_public_id)
      UNION ALL
      SELECT emergency_case_public_id FROM canonical_emergency_disposition_events WHERE tenant_id=?
        GROUP BY emergency_case_public_id HAVING MIN(disposition_version)!=1 OR MAX(disposition_version)!=COUNT(*)
      UNION ALL
      SELECT c.emergency_case_public_id FROM canonical_emergency_cases c
        LEFT JOIN canonical_emergency_disposition_events d
          ON d.tenant_id=c.tenant_id AND d.emergency_case_public_id=c.emergency_case_public_id
         AND d.disposition_event_public_id=c.current_disposition_event_public_id
        WHERE c.tenant_id=? AND c.current_status IN ('admitted','discharged','transferred','lama','dor','death','entered_in_error')
          AND (d.id IS NULL OR d.disposition_code IS NOT c.current_status OR d.disposition_version!=(
            SELECT MAX(d2.disposition_version) FROM canonical_emergency_disposition_events d2
            WHERE d2.tenant_id=c.tenant_id AND d2.emergency_case_public_id=c.emergency_case_public_id
          ))
    )`, [tenantId, tenantId, tenantId]),

    admittedCanonicalAdmissionExactLink: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_disposition_events d
      LEFT JOIN canonical_admissions a
        ON a.tenant_id=d.tenant_id AND a.admission_public_id=d.canonical_admission_public_id
      WHERE d.tenant_id=? AND d.disposition_code='admitted' AND (
        a.id IS NULL OR a.patient_link_public_id IS NOT d.patient_link_public_id OR a.current_status='entered_in_error'
      )`, [tenantId]),

    dischargedSignedDocumentExactLink: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_disposition_events d
      LEFT JOIN canonical_clinical_document_versions v
        ON v.tenant_id=d.tenant_id AND v.document_public_id=d.discharge_document_public_id
       AND v.version_public_id=d.discharge_document_version_public_id
       AND v.content_sha256=d.discharge_document_content_sha256
      LEFT JOIN canonical_clinical_documents h
        ON h.tenant_id=v.tenant_id AND h.document_public_id=v.document_public_id
      WHERE d.tenant_id=? AND d.disposition_code='discharged' AND d.discharge_document_public_id IS NOT NULL AND (
        v.id IS NULL OR v.version_kind NOT IN ('final','amendment') OR h.document_type!='discharge_summary'
        OR h.patient_link_public_id IS NOT d.patient_link_public_id OR h.encounter_public_id IS NOT d.encounter_public_id
        OR NOT EXISTS (SELECT 1 FROM canonical_clinical_document_signatures s
          WHERE s.tenant_id=v.tenant_id AND s.document_public_id=v.document_public_id
            AND s.version_public_id=v.version_public_id AND s.signed_content_sha256=v.content_sha256)
      )`, [tenantId]),

    transferLamaDorDeathTypedEvidenceCompleteness: await count(db, `SELECT COUNT(*) AS count FROM canonical_emergency_disposition_events
      WHERE tenant_id=? AND (
        (disposition_code='transferred' AND (receiving_organization_source_type IS NULL OR receiving_organization_source_public_id IS NULL))
        OR (disposition_code IN ('lama','dor','death','entered_in_error') AND (terminal_evidence_code IS NULL OR length(trim(terminal_evidence_code))=0))
      )`, [tenantId]),

    sourceFingerprintParity: input.sourceFingerprintBefore === input.sourceFingerprintAfter ? 0 : 1,
    foreignKeyIntegrityCompositeGate: input.foreignKeyViolationCount === 0
      && input.integrityStatus === 'ok' && unresolvedCriticalIssues === 0 ? 0 : 1,
    secondPassNewBusinessRows: input.secondPassNewBusinessRows,
  };
  return { checks, unresolvedCriticalIssues };
}

export async function reconcileCanonicalEmergencyCaseTriage(
  db: EmergencyCaseTriageReconciliationDatabase,
  options: EmergencyCaseTriageReconciliationOptions,
): Promise<EmergencyCaseTriageReconciliationResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const migrationRunPublicId = exact(options.migrationRunPublicId, 'migrationRunPublicId');
  const nowUtc = normalizedUtc(options.nowUtc);
  const sourceFingerprintBefore = digest(options.sourceFingerprintBefore, 'sourceFingerprintBefore');
  const sourceFingerprintAfter = digest(options.sourceFingerprintAfter, 'sourceFingerprintAfter');
  const foreignKeyViolationCount = nonnegative(options.foreignKeyViolationCount, 'foreignKeyViolationCount');
  const secondPassNewBusinessRows = nonnegative(options.secondPassNewBusinessRows, 'secondPassNewBusinessRows');
  const existing = await db.prepare(`SELECT result_summary_json FROM canonical_reconciliation_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1`).bind(tenantId, runPublicId).first<ExistingReceiptRow>();
  if (existing?.result_summary_json) {
    return (JSON.parse(existing.result_summary_json) as PersistedSummary).result;
  }
  const migrationRun = await resolveMigrationRun(db, tenantId, migrationRunPublicId);
  const collected = await collectChecks(db, tenantId, {
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    foreignKeyViolationCount,
    integrityStatus: options.integrityStatus,
    secondPassNewBusinessRows,
  });
  const values = Object.values(collected.checks);
  const mismatchChecks = values.filter((value) => value !== 0).length;
  const matchedChecks = EMERGENCY_RECONCILIATION_CHECK_NAMES.length - mismatchChecks;
  const evidenceSha256 = await createSourceEvidenceSha256({
    schemaVersion: 1,
    namedChecks: EMERGENCY_RECONCILIATION_CHECK_NAMES,
    checks: collected.checks,
    sourceFingerprints: { before: sourceFingerprintBefore, after: sourceFingerprintAfter },
    integrity: {
      foreignKeyViolationCount,
      status: options.integrityStatus,
      unresolvedCriticalIssues: collected.unresolvedCriticalIssues,
    },
    secondPass: { newBusinessRows: secondPassNewBusinessRows },
  });
  const result: EmergencyCaseTriageReconciliationResult = {
    status: mismatchChecks === 0 ? 'passed' : 'failed',
    scannedChecks: 24,
    matchedChecks,
    mismatchChecks,
    checks: collected.checks,
    evidenceSha256,
  };
  const summary: PersistedSummary = {
    schemaVersion: 1,
    namedChecks: [...EMERGENCY_RECONCILIATION_CHECK_NAMES],
    result,
    sourceFingerprints: { before: sourceFingerprintBefore, after: sourceFingerprintAfter },
    integrity: {
      foreignKeyViolationCount,
      status: options.integrityStatus,
      unresolvedCriticalIssues: collected.unresolvedCriticalIssues,
    },
    secondPass: { newBusinessRows: secondPassNewBusinessRows },
  };
  await db.prepare(`INSERT INTO canonical_reconciliation_runs (
    tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
    scanned_count,matched_count,mismatch_count,exception_count,evidence_sha256,result_summary_json,
    started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
  ) VALUES (?,?,?,'emergency_case_triage','backfill',?,?,?,?,?,?,?,?,?,?,?)`).bind(
    tenantId,
    runPublicId,
    migrationRun.id,
    result.status,
    result.scannedChecks,
    result.matchedChecks,
    result.mismatchChecks,
    0,
    result.evidenceSha256,
    stableCanonicalJson(summary),
    nowUtc,
    nowUtc,
    nowUtc,
    nowUtc,
  ).run();
  return result;
}
