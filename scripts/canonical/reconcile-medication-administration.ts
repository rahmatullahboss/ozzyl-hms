import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface MedicationAdministrationReconciliationPreparedStatement {
  bind(...values: unknown[]): MedicationAdministrationReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface MedicationAdministrationReconciliationDatabase {
  prepare(sql: string): MedicationAdministrationReconciliationPreparedStatement;
}

export interface MedicationAdministrationReconciliationOptions {
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

export interface MedicationAdministrationReconciliationChecks {
  sourceMappingMismatches: number;
  orderOwnershipMismatches: number;
  orderVersionMismatches: number;
  patientScopeMismatches: number;
  encounterScopeMismatches: number;
  practitionerScopeMismatches: number;
  actorMissing: number;
  invalidEventKindsOrOutcomes: number;
  doseUnitCompleteness: number;
  routeReasonCompleteness: number;
  timeOrdering: number;
  correctionScopeMismatches: number;
  correctionMultiplicity: number;
  reconciliationCurrentVersionOwnership: number;
  reconciliationVersionSequence: number;
  reconciliationItemSequence: number;
  finalSignatureContentMismatch: number;
  criticalOpenIssues: number;
  sourceFingerprintMismatch: number;
  foreignKeyViolations: number;
  integrityFailure: number;
  secondPassNewBusinessRows: number;
}

export interface MedicationAdministrationReconciliationResult {
  status: 'passed' | 'failed';
  scannedChecks: 22;
  matchedChecks: number;
  mismatchChecks: number;
  checks: MedicationAdministrationReconciliationChecks;
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

async function count(
  db: MedicationAdministrationReconciliationDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}

async function resolveMigrationRun(
  db: MedicationAdministrationReconciliationDatabase,
  tenantId: string,
  migrationRunPublicId: string,
): Promise<MigrationRunRow> {
  const row = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, migrationRunPublicId).first<MigrationRunRow>();
  if (!row) throw new Error('medication administration backfill migration run not found');
  if (row.status !== 'succeeded') throw new Error('medication administration backfill migration run is not succeeded');
  return row;
}

async function collectChecks(
  db: MedicationAdministrationReconciliationDatabase,
  tenantId: string,
  input: Pick<
    MedicationAdministrationReconciliationOptions,
    'sourceFingerprintBefore' | 'sourceFingerprintAfter' | 'foreignKeyViolationCount' | 'integrityStatus' | 'secondPassNewBusinessRows'
  >,
): Promise<MedicationAdministrationReconciliationChecks> {
  return {
    sourceMappingMismatches: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT m.id
        FROM canonical_source_mappings m
        LEFT JOIN canonical_medication_administration_events a
          ON a.tenant_id=m.tenant_id AND a.administration_event_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='medication_administration_event'
          AND m.mapping_status='mapped' AND a.id IS NULL
        UNION ALL
        SELECT m.id
        FROM canonical_source_mappings m
        LEFT JOIN canonical_medication_reconciliations r
          ON r.tenant_id=m.tenant_id AND r.reconciliation_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='medication_reconciliation'
          AND m.mapping_status='mapped' AND r.id IS NULL
        UNION ALL
        SELECT m.id
        FROM canonical_source_mappings m
        LEFT JOIN canonical_medication_reconciliation_items i
          ON i.tenant_id=m.tenant_id AND i.item_public_id=m.canonical_public_id
        WHERE m.tenant_id=? AND m.entity_type='medication_reconciliation_item'
          AND m.mapping_status='mapped' AND i.id IS NULL
      )
    `, [tenantId, tenantId, tenantId]),
    orderOwnershipMismatches: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events a
      LEFT JOIN canonical_medication_orders o
        ON o.tenant_id=a.tenant_id AND o.medication_order_public_id=a.medication_order_public_id
      WHERE a.tenant_id=? AND (
        o.id IS NULL
        OR o.patient_link_public_id IS NOT a.patient_link_public_id
        OR o.encounter_public_id IS NOT a.encounter_public_id
      )
    `, [tenantId]),
    orderVersionMismatches: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events a
      LEFT JOIN canonical_medication_order_status_events e
        ON e.tenant_id=a.tenant_id
       AND e.medication_order_public_id=a.medication_order_public_id
       AND e.event_version=a.medication_order_status_version
      WHERE a.tenant_id=? AND e.id IS NULL
    `, [tenantId]),
    patientScopeMismatches: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events a
      LEFT JOIN canonical_tenant_patient_links p
        ON p.tenant_id=a.tenant_id AND p.patient_link_public_id=a.patient_link_public_id
      WHERE a.tenant_id=? AND (p.id IS NULL OR p.link_status IN ('rejected','retired') OR p.effective_to_utc IS NOT NULL)
    `, [tenantId]),
    encounterScopeMismatches: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events a
      LEFT JOIN canonical_encounters e
        ON e.tenant_id=a.tenant_id AND e.encounter_public_id=a.encounter_public_id
      WHERE a.tenant_id=? AND (e.id IS NULL OR e.patient_link_public_id IS NOT a.patient_link_public_id)
    `, [tenantId]),
    practitionerScopeMismatches: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events a
      LEFT JOIN canonical_practitioners p
        ON p.tenant_id=a.tenant_id
       AND p.practitioner_public_id=a.administering_practitioner_public_id
      WHERE a.tenant_id=? AND (p.id IS NULL OR p.status!='active')
    `, [tenantId]),
    actorMissing: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events
      WHERE tenant_id=? AND actor_user_public_id IS NULL AND actor_system_key IS NULL
    `, [tenantId]),
    invalidEventKindsOrOutcomes: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events
      WHERE tenant_id=? AND NOT (
        event_kind IN ('administration','correction','entered_in_error')
        AND (
          (event_kind IN ('administration','correction')
            AND outcome_code IN ('given','partially_given','withheld','refused','omitted','not_available','cancelled'))
          OR (event_kind='entered_in_error' AND outcome_code IS NULL)
        )
      )
    `, [tenantId]),
    doseUnitCompleteness: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events
      WHERE tenant_id=? AND (
        (administered_dose_value_decimal IS NULL) != (administered_dose_unit_code IS NULL)
        OR (outcome_code IN ('given','partially_given')
          AND (administered_dose_value_decimal IS NULL OR administered_dose_unit_code IS NULL))
        OR (outcome_code NOT IN ('given','partially_given')
          AND (administered_dose_value_decimal IS NOT NULL OR administered_dose_unit_code IS NOT NULL))
      )
    `, [tenantId]),
    routeReasonCompleteness: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events
      WHERE tenant_id=? AND (
        (outcome_code IN ('given','partially_given') AND (route_code IS NULL OR length(trim(route_code))=0))
        OR (outcome_code IN ('withheld','refused','omitted','not_available','cancelled')
          AND (reason_code IS NULL OR length(trim(reason_code))=0 OR route_code IS NOT NULL))
        OR (event_kind='entered_in_error' AND (reason_code IS NULL OR length(trim(reason_code))=0))
      )
    `, [tenantId]),
    timeOrdering: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events
      WHERE tenant_id=? AND (
        substr(occurred_at_utc,-1)!='Z'
        OR substr(recorded_at_utc,-1)!='Z'
        OR (scheduled_at_utc IS NOT NULL AND substr(scheduled_at_utc,-1)!='Z')
        OR (recorded_at_utc<occurred_at_utc AND late_entry_reason_code IS NULL)
      )
    `, [tenantId]),
    correctionScopeMismatches: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_administration_events replacement
      LEFT JOIN canonical_medication_administration_events original
        ON original.tenant_id=replacement.tenant_id
       AND original.administration_event_public_id=replacement.supersedes_administration_event_public_id
      WHERE replacement.tenant_id=? AND replacement.supersedes_administration_event_public_id IS NOT NULL
        AND (
          original.id IS NULL
          OR original.medication_order_public_id IS NOT replacement.medication_order_public_id
          OR original.patient_link_public_id IS NOT replacement.patient_link_public_id
          OR original.encounter_public_id IS NOT replacement.encounter_public_id
        )
    `, [tenantId]),
    correctionMultiplicity: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT supersedes_administration_event_public_id
        FROM canonical_medication_administration_events
        WHERE tenant_id=? AND supersedes_administration_event_public_id IS NOT NULL
        GROUP BY supersedes_administration_event_public_id HAVING COUNT(*)>1
      )
    `, [tenantId]),
    reconciliationCurrentVersionOwnership: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_reconciliations r
      LEFT JOIN canonical_medication_reconciliation_versions v
        ON v.tenant_id=r.tenant_id
       AND v.reconciliation_public_id=r.reconciliation_public_id
       AND v.version_public_id=r.current_version_public_id
      WHERE r.tenant_id=? AND (
        r.current_version_public_id IS NULL
        OR v.id IS NULL
        OR v.version_status IS NOT r.current_status
      )
    `, [tenantId]),
    reconciliationVersionSequence: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT reconciliation_public_id,MIN(version_number) AS minimum_version,
               MAX(version_number) AS maximum_version,COUNT(*) AS version_count
        FROM canonical_medication_reconciliation_versions
        WHERE tenant_id=? GROUP BY reconciliation_public_id
        HAVING minimum_version!=1 OR maximum_version!=version_count
      )
    `, [tenantId]),
    reconciliationItemSequence: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT reconciliation_public_id,version_public_id,
               MIN(item_sequence) AS minimum_sequence,
               MAX(item_sequence) AS maximum_sequence,
               COUNT(*) AS item_count
        FROM canonical_medication_reconciliation_items
        WHERE tenant_id=? GROUP BY reconciliation_public_id,version_public_id
        HAVING minimum_sequence!=1 OR maximum_sequence!=item_count
      )
    `, [tenantId]),
    finalSignatureContentMismatch: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_medication_reconciliation_versions
      WHERE tenant_id=? AND version_status='final' AND (
        signed_content_sha256 IS NULL
        OR signed_content_sha256 IS NOT content_sha256
        OR finalizing_practitioner_public_id IS NULL
        OR finalized_at_utc IS NULL
      )
    `, [tenantId]),
    criticalOpenIssues: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_processing_issues
      WHERE tenant_id=? AND entity_type='medication_administration_reconciliation'
        AND status='open' AND severity='critical'
    `, [tenantId]),
    sourceFingerprintMismatch: input.sourceFingerprintBefore === input.sourceFingerprintAfter ? 0 : 1,
    foreignKeyViolations: input.foreignKeyViolationCount,
    integrityFailure: input.integrityStatus === 'ok' ? 0 : 1,
    secondPassNewBusinessRows: input.secondPassNewBusinessRows,
  };
}

export async function reconcileMedicationAdministration(
  db: MedicationAdministrationReconciliationDatabase,
  raw: MedicationAdministrationReconciliationOptions,
): Promise<MedicationAdministrationReconciliationResult> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const runPublicId = exact(raw.runPublicId, 'runPublicId');
  const migrationRunPublicId = exact(raw.migrationRunPublicId, 'migrationRunPublicId');
  const nowUtc = normalizedUtc(raw.nowUtc);
  const sourceFingerprintBefore = sha256(raw.sourceFingerprintBefore, 'sourceFingerprintBefore');
  const sourceFingerprintAfter = sha256(raw.sourceFingerprintAfter, 'sourceFingerprintAfter');
  const foreignKeyViolationCount = nonNegativeInteger(raw.foreignKeyViolationCount, 'foreignKeyViolationCount');
  const secondPassNewBusinessRows = nonNegativeInteger(raw.secondPassNewBusinessRows, 'secondPassNewBusinessRows');

  const existing = await db.prepare(`
    SELECT result_summary_json FROM canonical_reconciliation_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, runPublicId).first<ExistingReceiptRow>();
  if (existing?.result_summary_json) {
    return JSON.parse(existing.result_summary_json) as MedicationAdministrationReconciliationResult;
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
  const matchedChecks = 22 - mismatchChecks;
  const status = mismatchChecks === 0 ? 'passed' : 'failed';
  const evidenceSha256 = await createSourceEvidenceSha256({
    schemaVersion: 1,
    domain: 'medication_administration_reconciliation',
    migrationRunPublicId,
    checks,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    foreignKeyViolationCount,
    integrityStatus: raw.integrityStatus,
    secondPassNewBusinessRows,
  });
  const result: MedicationAdministrationReconciliationResult = {
    status,
    scannedChecks: 22,
    matchedChecks,
    mismatchChecks,
    checks,
    evidenceSha256,
  };
  const resultSummary = stableCanonicalJson(result);
  await db.prepare(`
    INSERT INTO canonical_reconciliation_runs (
      tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
      scanned_count,matched_count,mismatch_count,exception_count,evidence_sha256,
      result_summary_json,started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'medication_administration_reconciliation','backfill',?,?,?,?,0,?,?,?,?,?,?)
  `).bind(
    tenantId,
    runPublicId,
    migrationRun.id,
    status,
    22,
    matchedChecks,
    mismatchChecks,
    evidenceSha256,
    resultSummary,
    nowUtc,
    nowUtc,
    nowUtc,
    nowUtc,
  ).run();
  return result;
}
