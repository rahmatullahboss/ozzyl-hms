import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface PrescriptionMedicationReconciliationPreparedStatement {
  bind(...values: unknown[]): PrescriptionMedicationReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PrescriptionMedicationReconciliationDatabase {
  prepare(sql: string): PrescriptionMedicationReconciliationPreparedStatement;
  batch(statements: PrescriptionMedicationReconciliationPreparedStatement[]): Promise<unknown[]>;
}

export interface ReconcilePrescriptionMedicationIntentInput {
  tenantId: string;
  runPublicId: string;
  migrationRunPublicId?: string | null;
  nowUtc: string;
  sourceFingerprintBefore: string;
  sourceFingerprintAfter: string;
  foreignKeyViolationCount: number;
  integrityStatus: string;
  secondPassNewBusinessRows: number;
}

export interface PrescriptionMedicationReconciliationChecks {
  prescriptionSourceCoverageMismatchCount: number;
  prescriptionItemCoverageMismatchCount: number;
  cpoeSourceCoverageMismatchCount: number;
  patientReferenceMismatchCount: number;
  encounterReferenceMismatchCount: number;
  practitionerReferenceMismatchCount: number;
  currentVersionMismatchCount: number;
  finalSignatureMismatchCount: number;
  versionSequenceMismatchCount: number;
  linkedOrderScopeMismatchCount: number;
  orderLatestEventMismatchCount: number;
  orderEventSequenceMismatchCount: number;
  safetyScopeMismatchCount: number;
  sourceFingerprintMismatchCount: number;
  foreignKeyViolationCount: number;
  integrityOrSecondPassMismatchCount: number;
  secondPassNewBusinessRowCount: number;
}

export interface PrescriptionMedicationReconciliationResult {
  status: 'passed' | 'failed';
  scannedChecks: 16;
  matchedChecks: number;
  mismatchChecks: number;
  checks: PrescriptionMedicationReconciliationChecks;
  evidenceSha256: string;
}

interface CountRow { count: number }
interface MigrationRunRow { id: number }
interface EventRow {
  medication_order_public_id: string;
  from_status: string | null;
  to_status: string;
  event_version: number;
}

const TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ['active', 'cancelled', 'entered_in_error'],
  active: ['on_hold', 'completed', 'stopped', 'cancelled', 'entered_in_error'],
  on_hold: ['active', 'stopped', 'cancelled', 'entered_in_error'],
  completed: ['entered_in_error'],
  stopped: ['entered_in_error'],
  cancelled: ['entered_in_error'],
  entered_in_error: [],
};

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function hash(value: string, label: string): string {
  const normalized = exact(value, label);
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return normalized;
}

function nonnegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

async function count(
  db: PrescriptionMedicationReconciliationDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function allRows<T>(
  statement: PrescriptionMedicationReconciliationPreparedStatement,
): Promise<T[]> {
  return (await statement.all<T>()).results;
}

function invalidOrderHistories(events: EventRow[]): number {
  const grouped = new Map<string, EventRow[]>();
  for (const event of events) {
    const list = grouped.get(event.medication_order_public_id) ?? [];
    list.push(event);
    grouped.set(event.medication_order_public_id, list);
  }
  let invalid = 0;
  for (const list of grouped.values()) {
    list.sort((a, b) => Number(a.event_version) - Number(b.event_version));
    const first = list[0];
    if (!first || Number(first.event_version) !== 1 || first.from_status !== null) {
      invalid += 1;
      continue;
    }
    let previous = first.to_status;
    let expected = 2;
    let bad = false;
    for (const event of list.slice(1)) {
      if (
        Number(event.event_version) !== expected
        || event.from_status !== previous
        || !TRANSITIONS[previous]?.includes(event.to_status)
      ) {
        bad = true;
        break;
      }
      previous = event.to_status;
      expected += 1;
    }
    if (bad) invalid += 1;
  }
  return invalid;
}

export async function reconcilePrescriptionMedicationIntent(
  db: PrescriptionMedicationReconciliationDatabase,
  raw: ReconcilePrescriptionMedicationIntentInput,
): Promise<PrescriptionMedicationReconciliationResult> {
  const input = {
    tenantId: exact(raw.tenantId, 'tenantId'),
    runPublicId: exact(raw.runPublicId, 'runPublicId'),
    migrationRunPublicId: raw.migrationRunPublicId == null
      ? null
      : exact(raw.migrationRunPublicId, 'migrationRunPublicId'),
    nowUtc: toUtcIso(raw.nowUtc),
    sourceFingerprintBefore: hash(raw.sourceFingerprintBefore, 'sourceFingerprintBefore'),
    sourceFingerprintAfter: hash(raw.sourceFingerprintAfter, 'sourceFingerprintAfter'),
    foreignKeyViolationCount: nonnegative(raw.foreignKeyViolationCount, 'foreignKeyViolationCount'),
    integrityStatus: exact(raw.integrityStatus, 'integrityStatus'),
    secondPassNewBusinessRows: nonnegative(raw.secondPassNewBusinessRows, 'secondPassNewBusinessRows'),
  };

  const migrationRun = input.migrationRunPublicId == null
    ? null
    : await db.prepare(`
        SELECT id FROM canonical_migration_runs
        WHERE tenant_id=? AND run_public_id=? LIMIT 1
      `).bind(input.tenantId, input.migrationRunPublicId).first<MigrationRunRow>();
  if (input.migrationRunPublicId && !migrationRun) {
    throw new Error('Referenced prescription medication migration run was not found for the tenant');
  }

  const prescriptionSourceCoverageMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM prescriptions p
    LEFT JOIN canonical_source_mappings m
      ON m.tenant_id=CAST(p.tenant_id AS TEXT)
     AND m.entity_type='prescription'
     AND m.source_type='legacy_prescription'
     AND m.source_public_id=CAST(p.id AS TEXT)
     AND m.mapping_status='mapped'
    LEFT JOIN canonical_processing_issues i
      ON i.tenant_id=CAST(p.tenant_id AS TEXT)
     AND i.entity_type='prescription'
     AND i.source_type='legacy_prescription'
     AND i.source_public_id=CAST(p.id AS TEXT)
     AND i.status IN ('open','acknowledged','waived')
    WHERE CAST(p.tenant_id AS TEXT)=? AND m.id IS NULL AND i.id IS NULL
  `, [input.tenantId]);

  const prescriptionItemCoverageMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM prescription_items pi
    JOIN prescriptions p ON p.id=pi.prescription_id
    LEFT JOIN canonical_source_mappings pm
      ON pm.tenant_id=CAST(p.tenant_id AS TEXT)
     AND pm.entity_type='prescription'
     AND pm.source_type='legacy_prescription'
     AND pm.source_public_id=CAST(p.id AS TEXT)
     AND pm.mapping_status='mapped'
    LEFT JOIN canonical_source_mappings im
      ON im.tenant_id=CAST(p.tenant_id AS TEXT)
     AND im.entity_type='medication_order'
     AND im.source_type='legacy_prescription_item'
     AND im.source_public_id=CAST(pi.id AS TEXT)
     AND im.mapping_status='mapped'
    WHERE CAST(p.tenant_id AS TEXT)=? AND pm.id IS NOT NULL AND im.id IS NULL
  `, [input.tenantId]);

  const cpoeSourceCoverageMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM cln_medication_orders c
    LEFT JOIN canonical_source_mappings m
      ON m.tenant_id=CAST(c.tenant_id AS TEXT)
     AND m.entity_type='medication_order'
     AND m.source_type='legacy_cln_medication_order'
     AND m.source_public_id=CAST(c.id AS TEXT)
     AND m.mapping_status='mapped'
    LEFT JOIN canonical_processing_issues i
      ON i.tenant_id=CAST(c.tenant_id AS TEXT)
     AND i.entity_type='medication_order'
     AND i.source_type='legacy_cln_medication_order'
     AND i.source_public_id=CAST(c.id AS TEXT)
     AND i.status IN ('open','acknowledged','waived')
    WHERE CAST(c.tenant_id AS TEXT)=? AND m.id IS NULL AND i.id IS NULL
  `, [input.tenantId]);

  const patientReferenceMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_medication_orders o
    LEFT JOIN canonical_tenant_patient_links p
      ON p.tenant_id=o.tenant_id AND p.patient_link_public_id=o.patient_link_public_id
    WHERE o.tenant_id=? AND (
      p.id IS NULL OR p.link_status IN ('rejected','retired') OR p.effective_to_utc IS NOT NULL
    )
  `, [input.tenantId]);

  const encounterReferenceMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_medication_orders o
    LEFT JOIN canonical_encounters e
      ON e.tenant_id=o.tenant_id AND e.encounter_public_id=o.encounter_public_id
    WHERE o.tenant_id=? AND (
      e.id IS NULL OR e.patient_link_public_id!=o.patient_link_public_id OR e.status='entered_in_error'
    )
  `, [input.tenantId]);

  const practitionerReferenceMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_medication_orders o
    LEFT JOIN canonical_practitioners p
      ON p.tenant_id=o.tenant_id
     AND p.practitioner_public_id=o.prescribing_practitioner_public_id
    WHERE o.tenant_id=? AND (p.id IS NULL OR p.status!='active')
  `, [input.tenantId]);

  const currentVersionMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_prescriptions p
    LEFT JOIN canonical_prescription_versions v
      ON v.tenant_id=p.tenant_id
     AND v.prescription_public_id=p.prescription_public_id
     AND v.version_public_id=p.current_version_public_id
    WHERE p.tenant_id=? AND (
      p.current_version_public_id IS NULL OR v.id IS NULL
      OR (p.current_status='draft' AND v.version_status!='draft')
      OR (p.current_status='final' AND v.version_status!='final')
      OR (p.current_status='amended' AND v.version_status!='amendment')
    )
  `, [input.tenantId]);

  const finalSignatureMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_prescription_versions v
    WHERE v.tenant_id=? AND v.version_status IN ('final','amendment')
      AND (
        v.signed_snapshot_sha256 IS NULL OR v.finalized_at_utc IS NULL
        OR v.signing_practitioner_public_id IS NULL
      )
  `, [input.tenantId]);

  const versionSequenceMismatchCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT prescription_public_id
      FROM canonical_prescription_versions
      WHERE tenant_id=?
      GROUP BY prescription_public_id
      HAVING MIN(version_number)!=1
        OR COUNT(*)!=MAX(version_number)
        OR COUNT(DISTINCT version_number)!=COUNT(*)
    )
  `, [input.tenantId]);

  const linkedOrderScopeMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_medication_orders o
    LEFT JOIN canonical_prescriptions p
      ON p.tenant_id=o.tenant_id AND p.prescription_public_id=o.prescription_public_id
    LEFT JOIN canonical_prescription_versions v
      ON v.tenant_id=o.tenant_id
     AND v.prescription_public_id=o.prescription_public_id
     AND v.version_public_id=o.prescription_version_public_id
    WHERE o.tenant_id=? AND o.prescription_public_id IS NOT NULL
      AND (
        p.id IS NULL OR v.id IS NULL
        OR p.patient_link_public_id!=o.patient_link_public_id
        OR p.encounter_public_id!=o.encounter_public_id
        OR p.prescribing_practitioner_public_id!=o.prescribing_practitioner_public_id
      )
  `, [input.tenantId]);

  const orderLatestEventMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_medication_orders o
    LEFT JOIN canonical_medication_order_status_events e
      ON e.tenant_id=o.tenant_id
     AND e.medication_order_public_id=o.medication_order_public_id
     AND e.event_version=(
       SELECT MAX(e2.event_version)
       FROM canonical_medication_order_status_events e2
       WHERE e2.tenant_id=o.tenant_id
         AND e2.medication_order_public_id=o.medication_order_public_id
     )
    WHERE o.tenant_id=? AND (
      e.id IS NULL OR e.to_status!=o.current_status OR e.event_version!=o.status_version
    )
  `, [input.tenantId]);

  const orderEventSequenceSqlMismatch = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT o.medication_order_public_id
      FROM canonical_medication_orders o
      LEFT JOIN canonical_medication_order_status_events e
        ON e.tenant_id=o.tenant_id
       AND e.medication_order_public_id=o.medication_order_public_id
      WHERE o.tenant_id=?
      GROUP BY o.medication_order_public_id,o.status_version
      HAVING COUNT(e.id)=0
        OR MIN(e.event_version)!=1
        OR COUNT(e.id)!=MAX(e.event_version)
        OR MAX(e.event_version)!=o.status_version
    )
  `, [input.tenantId]);
  const eventRows = await allRows<EventRow>(db.prepare(`
    SELECT medication_order_public_id,from_status,to_status,event_version
    FROM canonical_medication_order_status_events
    WHERE tenant_id=? ORDER BY medication_order_public_id,event_version
  `).bind(input.tenantId));
  const orderEventSequenceMismatchCount = orderEventSequenceSqlMismatch + invalidOrderHistories(eventRows);

  const safetyScopeMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_prescription_safety_events s
    LEFT JOIN canonical_prescriptions p
      ON p.tenant_id=s.tenant_id AND p.prescription_public_id=s.prescription_public_id
    LEFT JOIN canonical_prescription_versions v
      ON v.tenant_id=s.tenant_id
     AND v.prescription_public_id=s.prescription_public_id
     AND v.version_public_id=s.prescription_version_public_id
    LEFT JOIN canonical_medication_orders o
      ON o.tenant_id=s.tenant_id AND o.medication_order_public_id=s.medication_order_public_id
    WHERE s.tenant_id=? AND (
      p.id IS NULL
      OR (s.prescription_version_public_id IS NOT NULL AND v.id IS NULL)
      OR (s.medication_order_public_id IS NOT NULL AND (
        o.id IS NULL OR o.prescription_public_id!=s.prescription_public_id
        OR (s.prescription_version_public_id IS NOT NULL
          AND o.prescription_version_public_id!=s.prescription_version_public_id)
      ))
      OR (s.event_type IN ('override','waiver') AND (
        s.outcome!='overridden' OR s.actor_practitioner_public_id IS NULL
      ))
    )
  `, [input.tenantId]);

  const sourceFingerprintMismatchCount = input.sourceFingerprintBefore === input.sourceFingerprintAfter ? 0 : 1;
  const integrityOrSecondPassMismatchCount = input.integrityStatus === 'ok' && input.secondPassNewBusinessRows === 0 ? 0 : 1;
  const checks: PrescriptionMedicationReconciliationChecks = {
    prescriptionSourceCoverageMismatchCount,
    prescriptionItemCoverageMismatchCount,
    cpoeSourceCoverageMismatchCount,
    patientReferenceMismatchCount,
    encounterReferenceMismatchCount,
    practitionerReferenceMismatchCount,
    currentVersionMismatchCount,
    finalSignatureMismatchCount,
    versionSequenceMismatchCount,
    linkedOrderScopeMismatchCount,
    orderLatestEventMismatchCount,
    orderEventSequenceMismatchCount,
    safetyScopeMismatchCount,
    sourceFingerprintMismatchCount,
    foreignKeyViolationCount: input.foreignKeyViolationCount,
    integrityOrSecondPassMismatchCount,
    secondPassNewBusinessRowCount: input.secondPassNewBusinessRows,
  };

  const checkValues = [
    prescriptionSourceCoverageMismatchCount,
    prescriptionItemCoverageMismatchCount,
    cpoeSourceCoverageMismatchCount,
    patientReferenceMismatchCount,
    encounterReferenceMismatchCount,
    practitionerReferenceMismatchCount,
    currentVersionMismatchCount,
    finalSignatureMismatchCount,
    versionSequenceMismatchCount,
    linkedOrderScopeMismatchCount,
    orderLatestEventMismatchCount,
    orderEventSequenceMismatchCount,
    safetyScopeMismatchCount,
    sourceFingerprintMismatchCount,
    input.foreignKeyViolationCount,
    integrityOrSecondPassMismatchCount,
  ];
  const mismatchChecks = checkValues.filter((value) => Number(value) !== 0).length;
  const matchedChecks = 16 - mismatchChecks;
  const status: 'passed' | 'failed' = mismatchChecks === 0 ? 'passed' : 'failed';
  const evidenceSha256 = await createSourceEvidenceSha256({
    schemaVersion: 1,
    domain: 'prescription_medication_intent',
    tenantId: input.tenantId,
    migrationRunPublicId: input.migrationRunPublicId,
    status,
    checks,
  });
  const result: PrescriptionMedicationReconciliationResult = {
    status,
    scannedChecks: 16,
    matchedChecks,
    mismatchChecks,
    checks,
    evidenceSha256,
  };
  const summary = stableCanonicalJson({
    schemaVersion: 1,
    status,
    scannedChecks: 16,
    matchedChecks,
    mismatchChecks,
    checks,
  });

  await db.prepare(`
    INSERT INTO canonical_reconciliation_runs (
      tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
      scanned_count,matched_count,mismatch_count,exception_count,
      evidence_sha256,result_summary_json,started_at_utc,completed_at_utc,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'prescription_medication_intent','backfill',?,?,?,?,?,?,?, ?,?,?,?)
    ON CONFLICT(tenant_id,run_public_id) DO UPDATE SET
      migration_run_id=excluded.migration_run_id,
      status=excluded.status,
      scanned_count=excluded.scanned_count,
      matched_count=excluded.matched_count,
      mismatch_count=excluded.mismatch_count,
      exception_count=excluded.exception_count,
      evidence_sha256=excluded.evidence_sha256,
      result_summary_json=excluded.result_summary_json,
      completed_at_utc=excluded.completed_at_utc,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    input.tenantId,
    input.runPublicId,
    migrationRun?.id ?? null,
    status,
    16,
    matchedChecks,
    mismatchChecks,
    mismatchChecks > 0 ? 1 : 0,
    evidenceSha256,
    summary,
    input.nowUtc,
    input.nowUtc,
    input.nowUtc,
    input.nowUtc,
  ).run();
  return result;
}
