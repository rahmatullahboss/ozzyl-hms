import { createRequestFingerprint, stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface ClinicalDocumentDiagnosisReconciliationPreparedStatement {
  bind(...values: unknown[]): ClinicalDocumentDiagnosisReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface ClinicalDocumentDiagnosisReconciliationDatabase {
  prepare(sql: string): ClinicalDocumentDiagnosisReconciliationPreparedStatement;
}

export interface ClinicalDocumentDiagnosisReconciliationOptions {
  tenantId: string;
  runPublicId: string;
  migrationRunPublicId: string;
  nowUtc: string;
  sourceFingerprintBefore: string;
  sourceFingerprintAfter: string;
  foreignKeyViolationCount: number;
  integrityStatus: string;
  secondPassNewBusinessRows: number;
}

export interface ClinicalDocumentDiagnosisReconciliationChecks {
  sourceMappingMismatchCount: number;
  documentPatientReferenceMismatchCount: number;
  documentEncounterScopeMismatchCount: number;
  documentAuthorReferenceMismatchCount: number;
  currentVersionOwnershipMismatchCount: number;
  finalSignatureMissingCount: number;
  signatureHashMismatchCount: number;
  attachmentDocumentScopeMismatchCount: number;
  attachmentVersionMismatchCount: number;
  diagnosisPatientReferenceMismatchCount: number;
  diagnosisEncounterScopeMismatchCount: number;
  diagnosisPractitionerReferenceMismatchCount: number;
  diagnosisSupportingVersionMismatchCount: number;
  diagnosisEventSequenceMismatchCount: number;
  encounterAddendumDuplicateAuthorityCount: number;
  unresolvedCriticalIssueCount: number;
  sourceFingerprintMismatchCount: number;
  foreignKeyViolationCount: number;
  integrityFailureCount: number;
  secondPassNewBusinessRowCount: number;
}

export interface ClinicalDocumentDiagnosisReconciliationResult {
  status: 'passed' | 'failed';
  scannedChecks: 20;
  matchedChecks: number;
  mismatchChecks: number;
  checks: ClinicalDocumentDiagnosisReconciliationChecks;
  evidenceSha256: string;
}

interface CountRow { count: number }
interface MigrationRunRow { id: number; status: string }

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

function nonnegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
}

function normalizedUtc(value: string): string {
  const normalized = toUtcIso(value);
  if (normalized !== value) throw new RangeError('nowUtc must be a normalized UTC ISO timestamp');
  return normalized;
}

async function count(
  db: ClinicalDocumentDiagnosisReconciliationDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}

async function migrationRun(
  db: ClinicalDocumentDiagnosisReconciliationDatabase,
  tenantId: string,
  runPublicId: string,
): Promise<MigrationRunRow> {
  const row = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!row) throw new Error('clinical document diagnosis migration run not found');
  if (row.status !== 'succeeded') throw new Error('clinical document diagnosis migration run is not complete');
  return row;
}

async function collectChecks(
  db: ClinicalDocumentDiagnosisReconciliationDatabase,
  tenantId: string,
  input: {
    sourceFingerprintBefore: string;
    sourceFingerprintAfter: string;
    foreignKeyViolationCount: number;
    integrityStatus: string;
    secondPassNewBusinessRows: number;
  },
): Promise<ClinicalDocumentDiagnosisReconciliationChecks> {
  return {
    sourceMappingMismatchCount: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_source_mappings m
      LEFT JOIN canonical_clinical_documents d
        ON m.entity_type='clinical_document'
       AND d.tenant_id=m.tenant_id AND d.document_public_id=m.canonical_public_id
      LEFT JOIN canonical_clinical_document_versions v
        ON m.entity_type='clinical_document_version'
       AND v.tenant_id=m.tenant_id AND v.version_public_id=m.canonical_public_id
      LEFT JOIN canonical_clinical_document_signatures s
        ON m.entity_type='clinical_document_signature'
       AND s.tenant_id=m.tenant_id AND s.signature_public_id=m.canonical_public_id
      LEFT JOIN canonical_clinical_document_attachments a
        ON m.entity_type='clinical_document_attachment'
       AND a.tenant_id=m.tenant_id AND a.attachment_public_id=m.canonical_public_id
      LEFT JOIN canonical_diagnosis_assertions x
        ON m.entity_type='diagnosis_assertion'
       AND x.tenant_id=m.tenant_id AND x.diagnosis_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.mapping_status='mapped'
        AND m.entity_type IN (
          'clinical_document','clinical_document_version','clinical_document_signature',
          'clinical_document_attachment','diagnosis_assertion'
        )
        AND CASE m.entity_type
          WHEN 'clinical_document' THEN d.id
          WHEN 'clinical_document_version' THEN v.id
          WHEN 'clinical_document_signature' THEN s.id
          WHEN 'clinical_document_attachment' THEN a.id
          WHEN 'diagnosis_assertion' THEN x.id
        END IS NULL
    `, [tenantId]),
    documentPatientReferenceMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_clinical_documents d
      LEFT JOIN canonical_tenant_patient_links p
        ON p.tenant_id=d.tenant_id AND p.patient_link_public_id=d.patient_link_public_id
      WHERE d.tenant_id=? AND p.id IS NULL
    `, [tenantId]),
    documentEncounterScopeMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_clinical_documents d
      LEFT JOIN canonical_encounters e
        ON e.tenant_id=d.tenant_id AND e.encounter_public_id=d.encounter_public_id
       AND e.patient_link_public_id=d.patient_link_public_id
      WHERE d.tenant_id=? AND d.encounter_public_id IS NOT NULL AND e.id IS NULL
    `, [tenantId]),
    documentAuthorReferenceMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_clinical_documents d
      LEFT JOIN canonical_practitioners p
        ON p.tenant_id=d.tenant_id AND p.practitioner_public_id=d.authoring_practitioner_public_id
       AND p.status='active'
      WHERE d.tenant_id=? AND p.id IS NULL
    `, [tenantId]),
    currentVersionOwnershipMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_clinical_documents d
      LEFT JOIN canonical_clinical_document_versions v
        ON v.tenant_id=d.tenant_id AND v.document_public_id=d.document_public_id
       AND v.version_public_id=d.current_version_public_id
      WHERE d.tenant_id=? AND (d.current_version_public_id IS NULL OR v.id IS NULL)
    `, [tenantId]),
    finalSignatureMissingCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_clinical_documents d
      LEFT JOIN canonical_clinical_document_signatures s
        ON s.tenant_id=d.tenant_id AND s.document_public_id=d.document_public_id
       AND s.version_public_id=d.current_version_public_id
      WHERE d.tenant_id=? AND d.current_status IN ('final','amended') AND s.id IS NULL
    `, [tenantId]),
    signatureHashMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_clinical_document_signatures s
      LEFT JOIN canonical_clinical_document_versions v
        ON v.tenant_id=s.tenant_id AND v.document_public_id=s.document_public_id
       AND v.version_public_id=s.version_public_id AND v.content_sha256=s.signed_content_sha256
      WHERE s.tenant_id=? AND v.id IS NULL
    `, [tenantId]),
    attachmentDocumentScopeMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_clinical_document_attachments a
      LEFT JOIN canonical_clinical_documents d
        ON d.tenant_id=a.tenant_id AND d.document_public_id=a.document_public_id
       AND d.patient_link_public_id=a.patient_link_public_id
       AND d.encounter_public_id IS a.encounter_public_id
      WHERE a.tenant_id=? AND d.id IS NULL
    `, [tenantId]),
    attachmentVersionMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_clinical_document_attachments a
      LEFT JOIN canonical_clinical_document_versions v
        ON v.tenant_id=a.tenant_id AND v.document_public_id=a.document_public_id
       AND v.version_public_id=a.version_public_id
      WHERE a.tenant_id=? AND a.version_public_id IS NOT NULL AND v.id IS NULL
    `, [tenantId]),
    diagnosisPatientReferenceMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_diagnosis_assertions d
      LEFT JOIN canonical_tenant_patient_links p
        ON p.tenant_id=d.tenant_id AND p.patient_link_public_id=d.patient_link_public_id
      WHERE d.tenant_id=? AND p.id IS NULL
    `, [tenantId]),
    diagnosisEncounterScopeMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_diagnosis_assertions d
      LEFT JOIN canonical_encounters e
        ON e.tenant_id=d.tenant_id AND e.encounter_public_id=d.encounter_public_id
       AND e.patient_link_public_id=d.patient_link_public_id
      WHERE d.tenant_id=? AND e.id IS NULL
    `, [tenantId]),
    diagnosisPractitionerReferenceMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_diagnosis_assertions d
      LEFT JOIN canonical_practitioners p
        ON p.tenant_id=d.tenant_id AND p.practitioner_public_id=d.asserting_practitioner_public_id
       AND p.status='active'
      WHERE d.tenant_id=? AND p.id IS NULL
    `, [tenantId]),
    diagnosisSupportingVersionMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_diagnosis_assertions d
      LEFT JOIN canonical_clinical_documents c
        ON c.tenant_id=d.tenant_id AND c.document_public_id=d.supporting_document_public_id
       AND c.patient_link_public_id=d.patient_link_public_id
       AND c.encounter_public_id=d.encounter_public_id
      LEFT JOIN canonical_clinical_document_versions v
        ON v.tenant_id=d.tenant_id AND v.document_public_id=d.supporting_document_public_id
       AND v.version_public_id=d.supporting_version_public_id
      WHERE d.tenant_id=? AND d.supporting_document_public_id IS NOT NULL
        AND (c.id IS NULL OR v.id IS NULL)
    `, [tenantId]),
    diagnosisEventSequenceMismatchCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_diagnosis_assertions d
      LEFT JOIN (
        SELECT tenant_id,diagnosis_public_id,COUNT(*) AS event_count,MAX(event_version) AS max_version
        FROM canonical_diagnosis_status_events GROUP BY tenant_id,diagnosis_public_id
      ) e ON e.tenant_id=d.tenant_id AND e.diagnosis_public_id=d.diagnosis_public_id
      WHERE d.tenant_id=? AND (
        e.event_count IS NULL OR e.event_count!=d.status_version OR e.max_version!=d.status_version
      )
    `, [tenantId]),
    encounterAddendumDuplicateAuthorityCount: await count(db, `
      SELECT COUNT(*) AS count FROM sqlite_schema
      WHERE type='table' AND name IN ('canonical_clinical_document_addenda','canonical_document_addenda')
    `),
    unresolvedCriticalIssueCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_processing_issues
      WHERE tenant_id=? AND entity_type IN (
        'clinical_document','clinical_attachment','diagnosis_assertion','clinical_projection'
      ) AND status IN ('open','acknowledged') AND severity='critical'
    `, [tenantId]),
    sourceFingerprintMismatchCount: input.sourceFingerprintBefore === input.sourceFingerprintAfter ? 0 : 1,
    foreignKeyViolationCount: input.foreignKeyViolationCount,
    integrityFailureCount: input.integrityStatus === 'ok' ? 0 : 1,
    secondPassNewBusinessRowCount: input.secondPassNewBusinessRows,
  };
}

export async function reconcileClinicalDocumentDiagnosis(
  db: ClinicalDocumentDiagnosisReconciliationDatabase,
  raw: ClinicalDocumentDiagnosisReconciliationOptions,
): Promise<ClinicalDocumentDiagnosisReconciliationResult> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const runPublicId = exact(raw.runPublicId, 'runPublicId');
  const migrationRunPublicId = exact(raw.migrationRunPublicId, 'migrationRunPublicId');
  const nowUtc = normalizedUtc(raw.nowUtc);
  const sourceFingerprintBefore = sha256(raw.sourceFingerprintBefore, 'sourceFingerprintBefore');
  const sourceFingerprintAfter = sha256(raw.sourceFingerprintAfter, 'sourceFingerprintAfter');
  const foreignKeyViolationCount = nonnegative(raw.foreignKeyViolationCount, 'foreignKeyViolationCount');
  const secondPassNewBusinessRows = nonnegative(raw.secondPassNewBusinessRows, 'secondPassNewBusinessRows');
  const integrityStatus = exact(raw.integrityStatus, 'integrityStatus');
  const migration = await migrationRun(db, tenantId, migrationRunPublicId);
  const checks = await collectChecks(db, tenantId, {
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    foreignKeyViolationCount,
    integrityStatus,
    secondPassNewBusinessRows,
  });
  const mismatchChecks = Object.values(checks).filter((value) => value > 0).length;
  const scannedChecks = 20 as const;
  const matchedChecks = scannedChecks - mismatchChecks;
  const status = mismatchChecks === 0 ? 'passed' : 'failed';
  const evidenceSha256 = await createRequestFingerprint({
    schemaVersion: 1,
    domain: 'clinical_document_diagnosis',
    migrationRunPublicId,
    checks,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
  });
  const summary = stableCanonicalJson({
    schemaVersion: 1,
    checks,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    integrityStatus,
  });
  await db.prepare(`
    INSERT INTO canonical_reconciliation_runs (
      tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
      scanned_count,matched_count,mismatch_count,exception_count,evidence_sha256,
      result_summary_json,started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'clinical_document_diagnosis','backfill',?,?,?,?,0,?,?,?,?,?,?)
    ON CONFLICT(tenant_id,run_public_id) DO UPDATE SET
      migration_run_id=excluded.migration_run_id,status=excluded.status,
      scanned_count=excluded.scanned_count,matched_count=excluded.matched_count,
      mismatch_count=excluded.mismatch_count,exception_count=excluded.exception_count,
      evidence_sha256=excluded.evidence_sha256,result_summary_json=excluded.result_summary_json,
      completed_at_utc=excluded.completed_at_utc,updated_at_utc=excluded.updated_at_utc
  `).bind(
    tenantId,
    runPublicId,
    migration.id,
    status,
    scannedChecks,
    matchedChecks,
    mismatchChecks,
    evidenceSha256,
    summary,
    nowUtc,
    nowUtc,
    nowUtc,
    nowUtc,
  ).run();
  return { status, scannedChecks, matchedChecks, mismatchChecks, checks, evidenceSha256 };
}
