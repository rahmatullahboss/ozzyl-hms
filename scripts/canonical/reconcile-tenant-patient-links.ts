import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface PatientLinkReconciliationPreparedStatement {
  bind(...values: unknown[]): PatientLinkReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface PatientLinkReconciliationDatabase {
  prepare(sql: string): PatientLinkReconciliationPreparedStatement;
  batch(
    statements: PatientLinkReconciliationPreparedStatement[],
  ): Promise<Array<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>>;
}

export interface ReconcileTenantPatientLinksInput {
  tenantId: string;
  runPublicId: string;
  migrationRunPublicId?: string | null;
  nowUtc: string;
}

export interface PatientLinkReconciliationChecks {
  tenantPatientCountMatchesLinkCount: boolean;
  duplicateCurrentLinkCount: number;
  invalidVerifiedGlobalCount: number;
  forbiddenVerifiedEvidenceCount: number;
  latestEventStateMismatchCount: number;
  invalidMergeEventCount: number;
  crossTenantEventMismatchCount: number;
}

export interface PatientLinkReconciliationResult {
  status: 'passed' | 'failed';
  scannedChecks: 7;
  matchedChecks: number;
  mismatchChecks: number;
  checks: PatientLinkReconciliationChecks;
  evidenceSha256: string;
}

type CountRow = { count: number };
type MigrationRunRow = { id: number };
type GlobalIdentitySchema = {
  uhidColumn: 'global_uhid' | 'uhid';
  activePredicate: 'is_active=1' | "identity_status='verified'";
};

async function hasGlobalIdentityColumn(
  db: PatientLinkReconciliationDatabase,
  name: string,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 AS found
    FROM pragma_table_info('global_patient_identity')
    WHERE name=?
    LIMIT 1
  `).bind(name).first<{ found: number }>();
  return row != null;
}

async function resolveGlobalIdentitySchema(
  db: PatientLinkReconciliationDatabase,
): Promise<GlobalIdentitySchema> {
  const uhidColumn = await hasGlobalIdentityColumn(db, 'global_uhid')
    ? 'global_uhid'
    : await hasGlobalIdentityColumn(db, 'uhid')
      ? 'uhid'
      : null;
  if (!uhidColumn) {
    throw new Error('global_patient_identity requires global_uhid or uhid');
  }
  const activePredicate = await hasGlobalIdentityColumn(db, 'is_active')
    ? 'is_active=1'
    : await hasGlobalIdentityColumn(db, 'identity_status')
      ? "identity_status='verified'"
      : null;
  if (!activePredicate) {
    throw new Error('global_patient_identity requires is_active or identity_status');
  }
  return { uhidColumn, activePredicate };
}

function requireExactString(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function requireNormalizedUtc(value: string): string {
  const normalized = toUtcIso(value);
  if (normalized !== value) throw new RangeError('nowUtc must be a normalized UTC ISO timestamp');
  return value;
}

async function count(
  db: PatientLinkReconciliationDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<CountRow>();
  return Number(row?.count ?? 0);
}

export async function reconcileTenantPatientLinks(
  db: PatientLinkReconciliationDatabase,
  rawInput: ReconcileTenantPatientLinksInput,
): Promise<PatientLinkReconciliationResult> {
  const input = {
    tenantId: requireExactString(rawInput.tenantId, 'tenantId'),
    runPublicId: requireExactString(rawInput.runPublicId, 'runPublicId'),
    migrationRunPublicId: rawInput.migrationRunPublicId == null
      ? null
      : requireExactString(rawInput.migrationRunPublicId, 'migrationRunPublicId'),
    nowUtc: requireNormalizedUtc(rawInput.nowUtc),
  };

  const migrationRun = input.migrationRunPublicId == null
    ? null
    : await db.prepare(`
      SELECT id
      FROM canonical_migration_runs
      WHERE tenant_id=? AND run_public_id=?
      LIMIT 1
    `).bind(input.tenantId, input.migrationRunPublicId).first<MigrationRunRow>();
  if (input.migrationRunPublicId && !migrationRun) {
    throw new Error('Referenced patient-link migration run was not found for the tenant');
  }

  const tenantPatientCount = await count(
    db,
    'SELECT COUNT(*) AS count FROM patients WHERE tenant_id=?',
    [input.tenantId],
  );
  const linkCount = await count(
    db,
    'SELECT COUNT(*) AS count FROM canonical_tenant_patient_links WHERE tenant_id=?',
    [input.tenantId],
  );
  const duplicateCurrentLinkCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT legacy_patient_id
      FROM canonical_tenant_patient_links
      WHERE tenant_id=?
      GROUP BY legacy_patient_id
      HAVING COUNT(*) > 1
    )
  `, [input.tenantId]);
  const globalIdentitySchema = await resolveGlobalIdentitySchema(db);
  const invalidVerifiedGlobalCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_tenant_patient_links l
    WHERE l.tenant_id=?
      AND l.link_status='verified'
      AND (
        l.global_patient_uhid IS NULL
        OR (
          SELECT COUNT(*)
          FROM global_patient_identity g
          WHERE g.${globalIdentitySchema.uhidColumn}=l.global_patient_uhid
            AND ${globalIdentitySchema.activePredicate}
        ) != 1
      )
  `, [input.tenantId]);
  const forbiddenVerifiedEvidenceCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND link_status='verified'
      AND evidence_type NOT IN (
        'unique_uhid','authenticated_claim','verified_national_identity','reviewed_manual'
      )
  `, [input.tenantId]);
  const latestEventStateMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_tenant_patient_links l
    LEFT JOIN canonical_tenant_patient_link_events e
      ON e.tenant_id=l.tenant_id
     AND e.patient_link_public_id=l.patient_link_public_id
     AND e.sequence=(
       SELECT MAX(e2.sequence)
       FROM canonical_tenant_patient_link_events e2
       WHERE e2.tenant_id=l.tenant_id
         AND e2.patient_link_public_id=l.patient_link_public_id
     )
    WHERE l.tenant_id=?
      AND (
        e.id IS NULL
        OR e.to_status != l.link_status
        OR e.sequence != l.version
        OR e.legacy_patient_id != l.legacy_patient_id
        OR COALESCE(e.global_patient_uhid,'') != COALESCE(l.global_patient_uhid,'')
      )
  `, [input.tenantId]);
  const invalidMergeEventCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_tenant_patient_link_events
    WHERE tenant_id=? AND event_type IN ('merged','unmerged')
      AND (
        source_legacy_patient_id IS NULL
        OR target_legacy_patient_id IS NULL
        OR source_legacy_patient_id <= 0
        OR target_legacy_patient_id <= 0
        OR source_legacy_patient_id = target_legacy_patient_id
      )
  `, [input.tenantId]);
  const crossTenantEventMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_tenant_patient_link_events e
    LEFT JOIN canonical_tenant_patient_links l
      ON l.tenant_id=e.tenant_id
     AND l.patient_link_public_id=e.patient_link_public_id
    WHERE e.tenant_id=? AND l.id IS NULL
  `, [input.tenantId]);

  const checks: PatientLinkReconciliationChecks = {
    tenantPatientCountMatchesLinkCount: tenantPatientCount === linkCount,
    duplicateCurrentLinkCount,
    invalidVerifiedGlobalCount,
    forbiddenVerifiedEvidenceCount,
    latestEventStateMismatchCount,
    invalidMergeEventCount,
    crossTenantEventMismatchCount,
  };
  const failedChecks = [
    !checks.tenantPatientCountMatchesLinkCount,
    checks.duplicateCurrentLinkCount > 0,
    checks.invalidVerifiedGlobalCount > 0,
    checks.forbiddenVerifiedEvidenceCount > 0,
    checks.latestEventStateMismatchCount > 0,
    checks.invalidMergeEventCount > 0,
    checks.crossTenantEventMismatchCount > 0,
  ].filter(Boolean).length;
  const status = failedChecks === 0 ? 'passed' : 'failed';
  const evidenceSha256 = await createSourceEvidenceSha256({
    tenantId: input.tenantId,
    reconciliationType: 'tenant_patient_linkage',
    tenantPatientCount,
    linkCount,
    checks,
  });
  const result: PatientLinkReconciliationResult = {
    status,
    scannedChecks: 7,
    matchedChecks: 7 - failedChecks,
    mismatchChecks: failedChecks,
    checks,
    evidenceSha256,
  };

  await db.batch([
    db.prepare(`
      INSERT INTO canonical_reconciliation_runs (
        tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
        scanned_count,matched_count,mismatch_count,exception_count,evidence_sha256,
        result_summary_json,started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      input.tenantId,
      input.runPublicId,
      migrationRun?.id ?? null,
      'identity',
      'backfill',
      status,
      result.scannedChecks,
      result.matchedChecks,
      result.mismatchChecks,
      result.mismatchChecks,
      evidenceSha256,
      stableCanonicalJson({
        tenantPatientCount,
        linkCount,
        checks,
      }),
      input.nowUtc,
      input.nowUtc,
      input.nowUtc,
      input.nowUtc,
    ),
  ]);

  return result;
}
