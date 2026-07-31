import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface LabResultSpecimenReconciliationPreparedStatement {
  bind(...values: unknown[]): LabResultSpecimenReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface LabResultSpecimenReconciliationDatabase {
  prepare(sql: string): LabResultSpecimenReconciliationPreparedStatement;
}
export interface LabResultSpecimenReconciliationOptions {
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
export interface LabResultSpecimenReconciliationChecks {
  sourceMappingMismatches: number;
  specimenPatientEncounterOwnership: number;
  specimenPrimaryRequestOwnership: number;
  specimenServiceItemConsistency: number;
  specimenParentScopeConsistency: number;
  specimenCurrentEventOwnership: number;
  specimenStatusEventConsistency: number;
  specimenEventSequence: number;
  specimenActorCompleteness: number;
  resultSetPatientOwnership: number;
  resultSetEncounterOwnership: number;
  resultSetRequestEventOwnership: number;
  resultSetSpecimenServiceConsistency: number;
  currentResultVersionOwnership: number;
  resultVersionSequence: number;
  resultVersionSupersession: number;
  observationSequence: number;
  observationValueCompleteness: number;
  decimalTextValidity: number;
  observationUnitRangeInterpretation: number;
  practitionerSignatureScope: number;
  signedContentHashParity: number;
  resultStatusEventConsistency: number;
  analyzerSourceObservationOwnership: number;
  criticalOpenIssues: number;
  sourceFingerprintMismatch: number;
  foreignKeyOrIntegrityFailure: number;
  secondPassNewBusinessRows: number;
}
export interface LabResultSpecimenReconciliationResult {
  status: 'passed' | 'failed';
  scannedChecks: 28;
  matchedChecks: number;
  mismatchChecks: number;
  checks: LabResultSpecimenReconciliationChecks;
  evidenceSha256: string;
}

interface MigrationRunRow { id: number; status: string }
interface ExistingReceiptRow { result_summary_json: string | null }
interface CountRow { count: number }

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
async function count(db: LabResultSpecimenReconciliationDatabase, sql: string, values: readonly unknown[] = []): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}
async function resolveMigrationRun(db: LabResultSpecimenReconciliationDatabase, tenantId: string, runPublicId: string): Promise<MigrationRunRow> {
  const row = await db.prepare(`SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1`)
    .bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!row) throw new Error('lab result specimen backfill migration run not found');
  if (row.status !== 'succeeded') throw new Error('lab result specimen backfill migration run is not succeeded');
  return row;
}

async function collectChecks(
  db: LabResultSpecimenReconciliationDatabase,
  tenantId: string,
  input: Pick<LabResultSpecimenReconciliationOptions, 'sourceFingerprintBefore' | 'sourceFingerprintAfter' | 'foreignKeyViolationCount' | 'integrityStatus' | 'secondPassNewBusinessRows'>,
): Promise<LabResultSpecimenReconciliationChecks> {
  return {
    sourceMappingMismatches: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT m.id FROM canonical_source_mappings m
        LEFT JOIN canonical_lab_specimens s ON s.tenant_id=m.tenant_id AND s.specimen_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='lab_specimen' AND m.mapping_status='mapped' AND s.id IS NULL
        UNION ALL
        SELECT m.id FROM canonical_source_mappings m
        LEFT JOIN canonical_lab_result_sets r ON r.tenant_id=m.tenant_id AND r.result_set_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='lab_result_set' AND m.mapping_status='mapped' AND r.id IS NULL
        UNION ALL
        SELECT m.id FROM canonical_source_mappings m
        LEFT JOIN canonical_lab_result_observations o ON o.tenant_id=m.tenant_id AND o.observation_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='lab_result_observation' AND m.mapping_status='mapped' AND o.id IS NULL
        UNION ALL
        SELECT m.id FROM canonical_source_mappings m
        LEFT JOIN canonical_lab_analyzer_evidence a ON a.tenant_id=m.tenant_id AND a.analyzer_evidence_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='lab_analyzer_evidence' AND m.mapping_status='mapped' AND a.id IS NULL
      )
    `, [tenantId, tenantId, tenantId, tenantId]),
    specimenPatientEncounterOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_specimens s
      LEFT JOIN canonical_tenant_patient_links p ON p.tenant_id=s.tenant_id AND p.patient_link_public_id=s.patient_link_public_id
      LEFT JOIN canonical_encounters e ON e.tenant_id=s.tenant_id AND e.encounter_public_id=s.encounter_public_id
      WHERE s.tenant_id=? AND (
        p.id IS NULL OR p.link_status IN ('rejected','retired') OR p.effective_to_utc IS NOT NULL
        OR e.id IS NULL OR e.patient_link_public_id IS NOT s.patient_link_public_id
      )
    `, [tenantId]),
    specimenPrimaryRequestOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_specimens s
      LEFT JOIN canonical_service_requests r ON r.tenant_id=s.tenant_id AND r.request_public_id=s.primary_request_public_id
      WHERE s.tenant_id=? AND (
        r.id IS NULL OR r.encounter_public_id IS NOT s.encounter_public_id
        OR r.service_public_id IS NOT s.primary_service_public_id
      )
    `, [tenantId]),
    specimenServiceItemConsistency: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_specimen_service_items l
      LEFT JOIN canonical_lab_specimens s ON s.tenant_id=l.tenant_id AND s.specimen_public_id=l.specimen_public_id
      LEFT JOIN canonical_service_requests r ON r.tenant_id=l.tenant_id AND r.request_public_id=l.request_public_id
      LEFT JOIN canonical_service_events e ON e.tenant_id=l.tenant_id AND e.event_public_id=l.event_public_id
      WHERE l.tenant_id=? AND (
        s.id IS NULL OR r.id IS NULL
        OR s.primary_request_public_id IS NOT l.request_public_id
        OR s.primary_service_public_id IS NOT l.service_public_id
        OR r.service_public_id IS NOT l.service_public_id
        OR (l.event_public_id IS NOT NULL AND (e.id IS NULL OR e.request_public_id IS NOT l.request_public_id OR e.service_public_id IS NOT l.service_public_id))
      )
    `, [tenantId]),
    specimenParentScopeConsistency: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_specimens child
      LEFT JOIN canonical_lab_specimens parent ON parent.tenant_id=child.tenant_id AND parent.specimen_public_id=child.parent_specimen_public_id
      WHERE child.tenant_id=? AND child.parent_specimen_public_id IS NOT NULL AND (
        parent.id IS NULL OR parent.patient_link_public_id IS NOT child.patient_link_public_id
        OR parent.encounter_public_id IS NOT child.encounter_public_id
      )
    `, [tenantId]),
    specimenCurrentEventOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_specimens s
      LEFT JOIN canonical_lab_specimen_status_events e ON e.tenant_id=s.tenant_id AND e.specimen_public_id=s.specimen_public_id AND e.event_public_id=s.current_status_event_public_id
      WHERE s.tenant_id=? AND (s.current_status_event_public_id IS NULL OR e.id IS NULL)
    `, [tenantId]),
    specimenStatusEventConsistency: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_specimens s
      LEFT JOIN canonical_lab_specimen_status_events e ON e.tenant_id=s.tenant_id AND e.specimen_public_id=s.specimen_public_id AND e.event_public_id=s.current_status_event_public_id
      WHERE s.tenant_id=? AND (e.id IS NULL OR e.event_version!=s.status_version OR e.to_status IS NOT s.current_status)
    `, [tenantId]),
    specimenEventSequence: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT specimen_public_id,MIN(event_version) AS minimum_version,MAX(event_version) AS maximum_version,COUNT(*) AS event_count
        FROM canonical_lab_specimen_status_events WHERE tenant_id=? GROUP BY specimen_public_id
        HAVING minimum_version!=1 OR maximum_version!=event_count
      )
    `, [tenantId]),
    specimenActorCompleteness: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_specimen_status_events
      WHERE tenant_id=? AND actor_practitioner_public_id IS NULL AND actor_user_public_id IS NULL AND actor_system_key IS NULL
    `, [tenantId]),
    resultSetPatientOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_sets r
      LEFT JOIN canonical_tenant_patient_links p ON p.tenant_id=r.tenant_id AND p.patient_link_public_id=r.patient_link_public_id
      WHERE r.tenant_id=? AND (p.id IS NULL OR p.link_status IN ('rejected','retired') OR p.effective_to_utc IS NOT NULL)
    `, [tenantId]),
    resultSetEncounterOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_sets r
      LEFT JOIN canonical_encounters e ON e.tenant_id=r.tenant_id AND e.encounter_public_id=r.encounter_public_id
      WHERE r.tenant_id=? AND (e.id IS NULL OR e.patient_link_public_id IS NOT r.patient_link_public_id)
    `, [tenantId]),
    resultSetRequestEventOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_sets r
      LEFT JOIN canonical_service_requests q ON q.tenant_id=r.tenant_id AND q.request_public_id=r.request_public_id
      LEFT JOIN canonical_service_events e ON e.tenant_id=r.tenant_id AND e.event_public_id=r.event_public_id
      WHERE r.tenant_id=? AND (
        q.id IS NULL OR q.encounter_public_id IS NOT r.encounter_public_id OR q.service_public_id IS NOT r.service_public_id
        OR (r.event_public_id IS NOT NULL AND (e.id IS NULL OR e.request_public_id IS NOT r.request_public_id OR e.encounter_public_id IS NOT r.encounter_public_id OR e.service_public_id IS NOT r.service_public_id))
      )
    `, [tenantId]),
    resultSetSpecimenServiceConsistency: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_sets r
      LEFT JOIN canonical_lab_specimens s ON s.tenant_id=r.tenant_id AND s.specimen_public_id=r.specimen_public_id
      WHERE r.tenant_id=? AND (
        s.id IS NULL OR s.patient_link_public_id IS NOT r.patient_link_public_id
        OR s.encounter_public_id IS NOT r.encounter_public_id
        OR s.primary_request_public_id IS NOT r.request_public_id
        OR s.primary_service_public_id IS NOT r.service_public_id
      )
    `, [tenantId]),
    currentResultVersionOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_sets r
      LEFT JOIN canonical_lab_result_versions v ON v.tenant_id=r.tenant_id AND v.result_set_public_id=r.result_set_public_id AND v.version_public_id=r.current_version_public_id
      WHERE r.tenant_id=? AND (r.current_version_public_id IS NULL OR v.id IS NULL OR v.version_status IS NOT r.current_status)
    `, [tenantId]),
    resultVersionSequence: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT result_set_public_id,MIN(version_number) AS minimum_version,MAX(version_number) AS maximum_version,COUNT(*) AS version_count
        FROM canonical_lab_result_versions WHERE tenant_id=? GROUP BY result_set_public_id
        HAVING minimum_version!=1 OR maximum_version!=version_count
      )
    `, [tenantId]),
    resultVersionSupersession: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT child.id FROM canonical_lab_result_versions child
        LEFT JOIN canonical_lab_result_versions parent ON parent.tenant_id=child.tenant_id AND parent.result_set_public_id=child.result_set_public_id AND parent.version_public_id=child.supersedes_version_public_id
        WHERE child.tenant_id=? AND child.supersedes_version_public_id IS NOT NULL AND parent.id IS NULL
        UNION ALL
        SELECT MIN(id) FROM canonical_lab_result_versions
        WHERE tenant_id=? AND supersedes_version_public_id IS NOT NULL
        GROUP BY result_set_public_id,supersedes_version_public_id HAVING COUNT(*)>1
      )
    `, [tenantId, tenantId]),
    observationSequence: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT result_set_public_id,version_public_id,MIN(observation_sequence) AS minimum_sequence,MAX(observation_sequence) AS maximum_sequence,COUNT(*) AS observation_count
        FROM canonical_lab_result_observations WHERE tenant_id=? GROUP BY result_set_public_id,version_public_id
        HAVING minimum_sequence!=1 OR maximum_sequence!=observation_count
      )
    `, [tenantId]),
    observationValueCompleteness: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_observations WHERE tenant_id=? AND NOT (
        (value_type='decimal' AND value_decimal IS NOT NULL AND value_text IS NULL AND value_code IS NULL AND value_code_system IS NULL AND value_boolean IS NULL AND value_date_time_utc IS NULL AND unit_code IS NOT NULL)
        OR (value_type='text' AND value_text IS NOT NULL AND value_decimal IS NULL AND value_code IS NULL AND value_code_system IS NULL AND value_boolean IS NULL AND value_date_time_utc IS NULL)
        OR (value_type='coded' AND value_text IS NULL AND value_decimal IS NULL AND value_code IS NOT NULL AND value_code_system IS NOT NULL AND value_boolean IS NULL AND value_date_time_utc IS NULL)
        OR (value_type='boolean' AND value_boolean IN (0,1) AND value_text IS NULL AND value_decimal IS NULL AND value_code IS NULL AND value_code_system IS NULL AND value_date_time_utc IS NULL)
        OR (value_type='date_time' AND value_date_time_utc IS NOT NULL AND substr(value_date_time_utc,-1)='Z' AND value_text IS NULL AND value_decimal IS NULL AND value_code IS NULL AND value_code_system IS NULL AND value_boolean IS NULL)
        OR (value_type='absent' AND reason_code IS NOT NULL AND value_text IS NULL AND value_decimal IS NULL AND value_code IS NULL AND value_code_system IS NULL AND value_boolean IS NULL AND value_date_time_utc IS NULL)
      )
    `, [tenantId]),
    decimalTextValidity: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_observations WHERE tenant_id=? AND (
        (value_decimal IS NOT NULL AND (value_decimal!=trim(value_decimal) OR value_decimal NOT GLOB '*[0-9]*' OR value_decimal GLOB '*[^0-9.-]*' OR value_decimal LIKE '.%' OR value_decimal LIKE '%.' OR value_decimal GLOB '*.*.*' OR value_decimal GLOB '*-*-*' OR (instr(value_decimal,'-') NOT IN (0,1))))
        OR (reference_low_decimal IS NOT NULL AND (reference_low_decimal!=trim(reference_low_decimal) OR reference_low_decimal GLOB '*[^0-9.-]*'))
        OR (reference_high_decimal IS NOT NULL AND (reference_high_decimal!=trim(reference_high_decimal) OR reference_high_decimal GLOB '*[^0-9.-]*'))
      )
    `, [tenantId]),
    observationUnitRangeInterpretation: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_observations WHERE tenant_id=? AND (
        (value_type='decimal' AND (unit_code IS NULL OR length(trim(unit_code))=0))
        OR (reference_low_decimal IS NOT NULL AND reference_high_decimal IS NOT NULL AND CAST(reference_low_decimal AS REAL)>CAST(reference_high_decimal AS REAL))
        OR (observation_status IN ('retracted','entered_in_error','absent') AND (reason_code IS NULL OR length(trim(reason_code))=0))
      )
    `, [tenantId]),
    practitionerSignatureScope: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_versions v
      LEFT JOIN canonical_practitioners author ON author.tenant_id=v.tenant_id AND author.practitioner_public_id=v.authoring_practitioner_public_id
      LEFT JOIN canonical_practitioners verifier ON verifier.tenant_id=v.tenant_id AND verifier.practitioner_public_id=v.verifying_practitioner_public_id
      LEFT JOIN canonical_practitioners validator ON validator.tenant_id=v.tenant_id AND validator.practitioner_public_id=v.validating_practitioner_public_id
      WHERE v.tenant_id=? AND (
        author.id IS NULL OR author.status!='active'
        OR (v.verifying_practitioner_public_id IS NOT NULL AND (verifier.id IS NULL OR verifier.status!='active'))
        OR (v.validating_practitioner_public_id IS NOT NULL AND (validator.id IS NULL OR validator.status!='active'))
      )
    `, [tenantId]),
    signedContentHashParity: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_versions WHERE tenant_id=? AND version_status IN ('verified','validated','published') AND (
        signed_content_sha256 IS NULL OR signed_content_sha256 IS NOT content_sha256
        OR verifying_practitioner_public_id IS NULL OR verified_at_utc IS NULL
        OR (version_status IN ('validated','published') AND (validating_practitioner_public_id IS NULL OR validated_at_utc IS NULL))
        OR (version_status='published' AND published_at_utc IS NULL)
      )
    `, [tenantId]),
    resultStatusEventConsistency: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_result_sets r
      LEFT JOIN canonical_lab_result_status_events e ON e.tenant_id=r.tenant_id AND e.result_set_public_id=r.result_set_public_id AND e.event_public_id=r.current_status_event_public_id
      WHERE r.tenant_id=? AND (
        r.current_status_event_public_id IS NULL OR e.id IS NULL OR e.event_version!=r.status_version
        OR e.to_status IS NOT r.current_status OR e.version_public_id IS NOT r.current_version_public_id
      )
    `, [tenantId]),
    analyzerSourceObservationOwnership: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_lab_analyzer_evidence a
      LEFT JOIN canonical_lab_result_observations o ON o.tenant_id=a.tenant_id AND o.result_set_public_id=a.result_set_public_id AND o.version_public_id=a.version_public_id AND o.observation_public_id=a.observation_public_id
      WHERE a.tenant_id=? AND (
        (a.disposition='accepted' AND o.id IS NULL)
        OR length(a.payload_sha256)!=64
        OR (a.disposition='accepted' AND (a.match_state!='matched' OR a.qc_state NOT IN ('passed','not_applicable') OR a.validation_state NOT IN ('passed','overridden')))
      )
    `, [tenantId]),
    criticalOpenIssues: await count(db, `SELECT COUNT(*) AS count FROM canonical_processing_issues WHERE tenant_id=? AND entity_type='lab_result_specimen' AND status='open' AND severity='critical'`, [tenantId]),
    sourceFingerprintMismatch: input.sourceFingerprintBefore === input.sourceFingerprintAfter ? 0 : 1,
    foreignKeyOrIntegrityFailure: input.foreignKeyViolationCount + (input.integrityStatus === 'ok' ? 0 : 1),
    secondPassNewBusinessRows: input.secondPassNewBusinessRows,
  };
}

export async function reconcileLabResultSpecimen(
  db: LabResultSpecimenReconciliationDatabase,
  raw: LabResultSpecimenReconciliationOptions,
): Promise<LabResultSpecimenReconciliationResult> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const runPublicId = exact(raw.runPublicId, 'runPublicId');
  const migrationRunPublicId = exact(raw.migrationRunPublicId, 'migrationRunPublicId');
  const nowUtc = normalizedUtc(raw.nowUtc);
  const sourceFingerprintBefore = sha256(raw.sourceFingerprintBefore, 'sourceFingerprintBefore');
  const sourceFingerprintAfter = sha256(raw.sourceFingerprintAfter, 'sourceFingerprintAfter');
  const foreignKeyViolationCount = nonNegativeInteger(raw.foreignKeyViolationCount, 'foreignKeyViolationCount');
  const secondPassNewBusinessRows = nonNegativeInteger(raw.secondPassNewBusinessRows, 'secondPassNewBusinessRows');

  const existing = await db.prepare(`SELECT result_summary_json FROM canonical_reconciliation_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1`)
    .bind(tenantId, runPublicId).first<ExistingReceiptRow>();
  if (existing?.result_summary_json) return JSON.parse(existing.result_summary_json) as LabResultSpecimenReconciliationResult;

  const migrationRun = await resolveMigrationRun(db, tenantId, migrationRunPublicId);
  const checks = await collectChecks(db, tenantId, {
    sourceFingerprintBefore, sourceFingerprintAfter, foreignKeyViolationCount,
    integrityStatus: raw.integrityStatus, secondPassNewBusinessRows,
  });
  const mismatchChecks = Object.values(checks).filter((value) => value !== 0).length;
  const matchedChecks = 28 - mismatchChecks;
  const status = mismatchChecks === 0 ? 'passed' : 'failed';
  const evidenceSha256 = await createSourceEvidenceSha256({
    schemaVersion: 1, domain: 'lab_result_specimen', migrationRunPublicId, checks,
    sourceFingerprintBefore, sourceFingerprintAfter, foreignKeyViolationCount,
    integrityStatus: raw.integrityStatus, secondPassNewBusinessRows,
  });
  const result: LabResultSpecimenReconciliationResult = {
    status, scannedChecks: 28, matchedChecks, mismatchChecks, checks, evidenceSha256,
  };
  await db.prepare(`
    INSERT INTO canonical_reconciliation_runs (
      tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
      scanned_count,matched_count,mismatch_count,exception_count,evidence_sha256,
      result_summary_json,started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'lab_result_specimen','backfill',?,?,?,?,0,?,?,?,?,?,?)
  `).bind(
    tenantId, runPublicId, migrationRun.id, status, 28, matchedChecks, mismatchChecks,
    evidenceSha256, stableCanonicalJson(result), nowUtc, nowUtc, nowUtc, nowUtc,
  ).run();
  return result;
}
