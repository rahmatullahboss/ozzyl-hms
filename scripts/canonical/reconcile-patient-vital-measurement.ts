import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface PatientVitalMeasurementReconciliationPreparedStatement {
  bind(...values: unknown[]): PatientVitalMeasurementReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PatientVitalMeasurementReconciliationDatabase {
  prepare(sql: string): PatientVitalMeasurementReconciliationPreparedStatement;
}

export interface PatientVitalMeasurementReconciliationOptions {
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

export interface PatientVitalMeasurementReconciliationChecks {
  sourceMappingOwnership: number;
  patientLinkScope: number;
  encounterPatientScope: number;
  practitionerScope: number;
  deviceSourcePairing: number;
  componentOwnership: number;
  componentSequenceDuplicates: number;
  measurementCodeUnitOrValueInvalid: number;
  bloodPressurePairMismatch: number;
  bmiDerivationMismatch: number;
  timeOrderMismatch: number;
  statusEventSequenceMismatch: number;
  supersessionLinkMismatch: number;
  patientReportedReviewMismatch: number;
  alertProjectionLinkMismatch: number;
  unresolvedCriticalIssues: number;
  integrityStatusFailure: number;
  sourceFingerprintMismatch: number;
  foreignKeyViolations: number;
  secondPassNewBusinessRows: number;
}

export interface PatientVitalMeasurementReconciliationResult {
  status: 'passed' | 'failed';
  scannedChecks: 20;
  matchedChecks: number;
  mismatchChecks: number;
  checks: PatientVitalMeasurementReconciliationChecks;
  evidenceSha256: string;
}

interface MigrationRunRow { id: number; status: string }
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
  db: PatientVitalMeasurementReconciliationDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}

async function tableExists(db: PatientVitalMeasurementReconciliationDatabase, table: string): Promise<boolean> {
  return (await db.prepare(`
    SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=? LIMIT 1
  `).bind(table).first()) != null;
}

async function resolveMigrationRun(
  db: PatientVitalMeasurementReconciliationDatabase,
  tenantId: string,
  migrationRunPublicId: string,
): Promise<MigrationRunRow> {
  const row = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, migrationRunPublicId).first<MigrationRunRow>();
  if (!row) throw new Error('patient vital backfill migration run not found');
  if (row.status !== 'succeeded') throw new Error('patient vital backfill migration run is not succeeded');
  return row;
}

async function alertProjectionMismatch(
  db: PatientVitalMeasurementReconciliationDatabase,
  tenantId: string,
): Promise<number> {
  if (!(await tableExists(db, 'vital_alerts'))) return 0;
  return count(db, `
    SELECT COUNT(*) AS count
    FROM vital_alerts a
    LEFT JOIN canonical_source_mappings m
      ON m.tenant_id=a.tenant_id
     AND m.entity_type='vital_observation_set'
     AND m.source_type='legacy_patient_vitals'
     AND m.source_public_id=CAST(a.vital_id AS TEXT)
     AND m.mapping_status='mapped'
    WHERE a.tenant_id=? AND m.id IS NULL
  `, [tenantId]);
}

async function collectChecks(
  db: PatientVitalMeasurementReconciliationDatabase,
  tenantId: string,
  input: Pick<
    PatientVitalMeasurementReconciliationOptions,
    'sourceFingerprintBefore' | 'sourceFingerprintAfter' | 'foreignKeyViolationCount' | 'integrityStatus' | 'secondPassNewBusinessRows'
  >,
): Promise<PatientVitalMeasurementReconciliationChecks> {
  return {
    sourceMappingOwnership: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_source_mappings m
      LEFT JOIN canonical_vital_observation_sets s
        ON s.tenant_id=m.tenant_id AND s.observation_set_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='vital_observation_set'
        AND m.mapping_status='mapped' AND s.id IS NULL
    `, [tenantId]),
    patientLinkScope: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_sets s
      LEFT JOIN canonical_tenant_patient_links p
        ON p.tenant_id=s.tenant_id AND p.patient_link_public_id=s.patient_link_public_id
      WHERE s.tenant_id=? AND p.id IS NULL
    `, [tenantId]),
    encounterPatientScope: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_sets s
      LEFT JOIN canonical_encounters e
        ON e.tenant_id=s.tenant_id AND e.encounter_public_id=s.encounter_public_id
      WHERE s.tenant_id=? AND s.encounter_public_id IS NOT NULL
        AND (e.id IS NULL OR e.patient_link_public_id IS NOT s.patient_link_public_id)
    `, [tenantId]),
    practitionerScope: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_sets s
      LEFT JOIN canonical_practitioners p
        ON p.tenant_id=s.tenant_id AND p.practitioner_public_id=s.practitioner_public_id
      WHERE s.tenant_id=? AND s.practitioner_public_id IS NOT NULL
        AND (p.id IS NULL OR p.status!='active')
    `, [tenantId]),
    deviceSourcePairing: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_sets
      WHERE tenant_id=? AND (
        (external_device_source_type IS NULL) != (external_device_source_public_id IS NULL)
        OR (source_kind='device_imported' AND external_device_source_type IS NULL)
      )
    `, [tenantId]),
    componentOwnership: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_components c
      LEFT JOIN canonical_vital_observation_sets s
        ON s.tenant_id=c.tenant_id AND s.observation_set_public_id=c.observation_set_public_id
      WHERE c.tenant_id=? AND s.id IS NULL
    `, [tenantId]),
    componentSequenceDuplicates: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT observation_set_public_id,component_sequence,COUNT(*) AS duplicate_count
        FROM canonical_vital_observation_components
        WHERE tenant_id=?
        GROUP BY observation_set_public_id,component_sequence
        HAVING COUNT(*)>1
      )
    `, [tenantId]),
    measurementCodeUnitOrValueInvalid: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_components
      WHERE tenant_id=? AND NOT (
        numeric_value=numeric_value
        AND (
          (measurement_code='body_temperature' AND canonical_unit_code='Cel' AND numeric_value BETWEEN 20 AND 50)
          OR (measurement_code='heart_rate' AND canonical_unit_code='/min' AND numeric_value BETWEEN 1 AND 350)
          OR (measurement_code='respiratory_rate' AND canonical_unit_code='/min' AND numeric_value BETWEEN 1 AND 150)
          OR (measurement_code='oxygen_saturation' AND canonical_unit_code='%' AND numeric_value BETWEEN 0 AND 100)
          OR (measurement_code='blood_pressure_systolic' AND canonical_unit_code='mm[Hg]' AND numeric_value BETWEEN 20 AND 350)
          OR (measurement_code='blood_pressure_diastolic' AND canonical_unit_code='mm[Hg]' AND numeric_value BETWEEN 10 AND 250)
          OR (measurement_code='body_weight' AND canonical_unit_code='kg' AND numeric_value>0 AND numeric_value<=1000)
          OR (measurement_code='body_height' AND canonical_unit_code='cm' AND numeric_value>0 AND numeric_value<=300)
          OR (measurement_code='body_mass_index' AND canonical_unit_code='kg/m2' AND numeric_value>0 AND numeric_value<=200)
          OR (measurement_code='pain_score' AND canonical_unit_code='{score}' AND numeric_value BETWEEN 0 AND 10 AND numeric_value=CAST(numeric_value AS INTEGER))
          OR (measurement_code='blood_glucose' AND canonical_unit_code='mg/dL' AND numeric_value>0 AND numeric_value<=3000)
        )
      )
    `, [tenantId]),
    bloodPressurePairMismatch: await count(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT observation_set_public_id,
          SUM(CASE WHEN measurement_code='blood_pressure_systolic' THEN 1 ELSE 0 END) AS systolic_count,
          SUM(CASE WHEN measurement_code='blood_pressure_diastolic' THEN 1 ELSE 0 END) AS diastolic_count
        FROM canonical_vital_observation_components
        WHERE tenant_id=?
        GROUP BY observation_set_public_id
        HAVING systolic_count!=diastolic_count
      )
    `, [tenantId]),
    bmiDerivationMismatch: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_components bmi
      JOIN canonical_vital_observation_components weight
        ON weight.tenant_id=bmi.tenant_id
       AND weight.observation_set_public_id=bmi.observation_set_public_id
       AND weight.measurement_code='body_weight'
      JOIN canonical_vital_observation_components height
        ON height.tenant_id=bmi.tenant_id
       AND height.observation_set_public_id=bmi.observation_set_public_id
       AND height.measurement_code='body_height'
      WHERE bmi.tenant_id=? AND bmi.measurement_code='body_mass_index'
        AND (
          bmi.is_derived!=1
          OR bmi.derivation_formula_key!='bmi_weight_kg_height_m_v1'
          OR bmi.derivation_formula_version!='1'
          OR ABS(bmi.numeric_value - (weight.numeric_value / ((height.numeric_value/100.0)*(height.numeric_value/100.0)))) > 0.01
        )
    `, [tenantId]),
    timeOrderMismatch: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_sets
      WHERE tenant_id=? AND (
        substr(effective_at_utc,-1)!='Z'
        OR substr(recorded_at_utc,-1)!='Z'
        OR recorded_at_utc<effective_at_utc
      )
    `, [tenantId]),
    statusEventSequenceMismatch: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_sets s
      LEFT JOIN canonical_vital_observation_status_events e
        ON e.tenant_id=s.tenant_id
       AND e.observation_set_public_id=s.observation_set_public_id
       AND e.event_version=s.status_version
       AND e.to_review_status=s.review_status
      WHERE s.tenant_id=? AND e.id IS NULL
    `, [tenantId]),
    supersessionLinkMismatch: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_sets original
      WHERE original.tenant_id=? AND original.review_status='superseded'
        AND NOT EXISTS (
          SELECT 1 FROM canonical_vital_observation_sets replacement
          WHERE replacement.tenant_id=original.tenant_id
            AND replacement.supersedes_observation_set_public_id=original.observation_set_public_id
        )
    `, [tenantId]),
    patientReportedReviewMismatch: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_vital_observation_sets
      WHERE tenant_id=? AND source_kind='patient_reported'
        AND status_version=1 AND review_status!='pending_review'
    `, [tenantId]),
    alertProjectionLinkMismatch: await alertProjectionMismatch(db, tenantId),
    unresolvedCriticalIssues: await count(db, `
      SELECT COUNT(*) AS count
      FROM canonical_processing_issues
      WHERE tenant_id=? AND entity_type='patient_vital_measurement'
        AND status IN ('open','acknowledged') AND severity='critical'
    `, [tenantId]),
    integrityStatusFailure: input.integrityStatus === 'ok' ? 0 : 1,
    sourceFingerprintMismatch: input.sourceFingerprintBefore === input.sourceFingerprintAfter ? 0 : 1,
    foreignKeyViolations: input.foreignKeyViolationCount,
    secondPassNewBusinessRows: input.secondPassNewBusinessRows,
  };
}

export async function reconcilePatientVitalMeasurement(
  db: PatientVitalMeasurementReconciliationDatabase,
  options: PatientVitalMeasurementReconciliationOptions,
): Promise<PatientVitalMeasurementReconciliationResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const migrationRunPublicId = exact(options.migrationRunPublicId, 'migrationRunPublicId');
  const nowUtc = normalizedUtc(options.nowUtc);
  const sourceFingerprintBefore = sha256(options.sourceFingerprintBefore, 'sourceFingerprintBefore');
  const sourceFingerprintAfter = sha256(options.sourceFingerprintAfter, 'sourceFingerprintAfter');
  const foreignKeyViolationCount = nonNegativeInteger(options.foreignKeyViolationCount, 'foreignKeyViolationCount');
  const secondPassNewBusinessRows = nonNegativeInteger(options.secondPassNewBusinessRows, 'secondPassNewBusinessRows');
  const migrationRun = await resolveMigrationRun(db, tenantId, migrationRunPublicId);
  const checks = await collectChecks(db, tenantId, {
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    foreignKeyViolationCount,
    integrityStatus: options.integrityStatus,
    secondPassNewBusinessRows,
  });
  const values = Object.values(checks);
  const scannedChecks = 20 as const;
  if (values.length !== scannedChecks) throw new Error('patient vital reconciliation check cardinality drift');
  const mismatchChecks = values.filter((value) => value !== 0).length;
  const matchedChecks = scannedChecks - mismatchChecks;
  const status = mismatchChecks === 0 ? 'passed' : 'failed';
  const evidence = {
    schemaVersion: 1,
    domain: 'patient_vital_measurement',
    migrationRunPublicId,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    foreignKeyViolationCount,
    integrityStatus: options.integrityStatus,
    secondPassNewBusinessRows,
    checks,
    status,
  };
  const evidenceSha256 = await createSourceEvidenceSha256(evidence);
  const result: PatientVitalMeasurementReconciliationResult = {
    status,
    scannedChecks,
    matchedChecks,
    mismatchChecks,
    checks,
    evidenceSha256,
  };

  await db.prepare(`
    INSERT INTO canonical_reconciliation_runs (
      tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
      scanned_count,matched_count,mismatch_count,exception_count,evidence_sha256,
      result_summary_json,started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'patient_vital_measurement','backfill',?,?,?,?,0,?,?,?,?,?,?)
  `).bind(
    tenantId,
    runPublicId,
    migrationRun.id,
    status,
    scannedChecks,
    matchedChecks,
    mismatchChecks,
    evidenceSha256,
    stableCanonicalJson({ schemaVersion: 1, result }),
    nowUtc,
    nowUtc,
    nowUtc,
    nowUtc,
  ).run();
  return result;
}
