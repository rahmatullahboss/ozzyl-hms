import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface PractitionerOperationalReconciliationPreparedStatement {
  bind(...values: unknown[]): PractitionerOperationalReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface PractitionerOperationalReconciliationDatabase {
  prepare(sql: string): PractitionerOperationalReconciliationPreparedStatement;
  batch(
    statements: PractitionerOperationalReconciliationPreparedStatement[],
  ): Promise<Array<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>>;
}

export interface ReconcilePractitionerOperationalAdoptionInput {
  tenantId: string;
  runPublicId: string;
  migrationRunPublicId?: string | null;
  nowUtc: string;
}

export interface PractitionerOperationalReconciliationChecks {
  doctorSourceMappingMismatchCount: number;
  externalReferrerMappingMismatchCount: number;
  registrationIdentifierMismatchCount: number;
  userLinkMismatchCount: number;
  employeeLinkMismatchCount: number;
  unresolvedIdentityIssueCount: number;
  activeStatusMismatchCount: number;
  nameOnlyMappingCount: number;
  crossTenantLinkMismatchCount: number;
  orphanCanonicalAssociationCount: number;
}

export interface PractitionerOperationalReconciliationResult {
  status: 'passed' | 'failed';
  scannedChecks: 10;
  matchedChecks: number;
  mismatchChecks: number;
  checks: PractitionerOperationalReconciliationChecks;
  evidenceSha256: string;
}

type CountRow = { count: number };
type MigrationRunRow = { id: number };

function exact(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function normalizedUtc(value: string): string {
  if (toUtcIso(value) !== value) throw new RangeError('nowUtc must be a normalized UTC ISO timestamp');
  return value;
}

async function count(
  db: PractitionerOperationalReconciliationDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<CountRow>();
  return Number(row?.count ?? 0);
}

const NORMALIZED_NAME_SQL = `
  replace(
    replace(
      replace(lower(trim(name)), '  ', ' '),
      '  ', ' '
    ),
    '  ', ' '
  )
`;

export async function reconcilePractitionerOperationalAdoption(
  db: PractitionerOperationalReconciliationDatabase,
  raw: ReconcilePractitionerOperationalAdoptionInput,
): Promise<PractitionerOperationalReconciliationResult> {
  const input = {
    tenantId: exact(raw.tenantId, 'tenantId'),
    runPublicId: exact(raw.runPublicId, 'runPublicId'),
    migrationRunPublicId: raw.migrationRunPublicId == null
      ? null
      : exact(raw.migrationRunPublicId, 'migrationRunPublicId'),
    nowUtc: normalizedUtc(raw.nowUtc),
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
    throw new Error('Referenced practitioner migration run was not found for the tenant');
  }

  const doctorSourceMappingMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM doctors d
    LEFT JOIN canonical_source_mappings m
      ON m.tenant_id=CAST(d.tenant_id AS TEXT)
     AND m.entity_type='practitioner'
     AND m.source_type='legacy_doctor'
     AND m.source_public_id=CAST(d.id AS TEXT)
    LEFT JOIN canonical_practitioners p
      ON p.tenant_id=m.tenant_id
     AND p.practitioner_public_id=m.canonical_public_id
    WHERE CAST(d.tenant_id AS TEXT)=?
      AND (
        m.id IS NULL
        OR m.mapping_status!='mapped'
        OR m.evidence_sha256 IS NULL
        OR length(m.evidence_sha256)!=64
        OR p.id IS NULL
        OR p.practitioner_kind!='internal'
      )
  `, [input.tenantId]);

  const externalReferrerMappingMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM external_referring_doctors e
    LEFT JOIN canonical_source_mappings m
      ON m.tenant_id=CAST(e.tenant_id AS TEXT)
     AND m.entity_type='practitioner'
     AND m.source_type='legacy_external_referrer'
     AND m.source_public_id=CAST(e.id AS TEXT)
    LEFT JOIN canonical_practitioners p
      ON p.tenant_id=m.tenant_id
     AND p.practitioner_public_id=m.canonical_public_id
    WHERE CAST(e.tenant_id AS TEXT)=?
      AND (
        m.id IS NULL
        OR m.mapping_status!='mapped'
        OR m.evidence_sha256 IS NULL
        OR length(m.evidence_sha256)!=64
        OR p.id IS NULL
        OR p.practitioner_kind!='external'
      )
  `, [input.tenantId]);

  const registrationIdentifierMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM doctors d
    JOIN canonical_source_mappings m
      ON m.tenant_id=CAST(d.tenant_id AS TEXT)
     AND m.entity_type='practitioner'
     AND m.source_type='legacy_doctor'
     AND m.source_public_id=CAST(d.id AS TEXT)
     AND m.mapping_status='mapped'
    WHERE CAST(d.tenant_id AS TEXT)=?
      AND d.bmdc_reg_no IS NOT NULL
      AND trim(d.bmdc_reg_no)!=''
      AND NOT EXISTS (
        SELECT 1
        FROM canonical_practitioner_identifiers i
        WHERE i.tenant_id=m.tenant_id
          AND i.practitioner_public_id=m.canonical_public_id
          AND i.identifier_system='bmdc'
          AND i.verification_status IN ('verified','unverified')
          AND i.normalized_value=replace(replace(upper(trim(d.bmdc_reg_no)), '-', ''), ' ', '')
      )
  `, [input.tenantId]);

  const userLinkMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM doctors d
    JOIN canonical_source_mappings m
      ON m.tenant_id=CAST(d.tenant_id AS TEXT)
     AND m.entity_type='practitioner'
     AND m.source_type='legacy_doctor'
     AND m.source_public_id=CAST(d.id AS TEXT)
     AND m.mapping_status='mapped'
    WHERE CAST(d.tenant_id AS TEXT)=?
      AND d.user_id IS NOT NULL
      AND NOT (
        EXISTS (
          SELECT 1
          FROM canonical_practitioner_user_links l
          JOIN users u
            ON u.id=l.legacy_user_id
           AND CAST(u.tenant_id AS TEXT)=l.tenant_id
          WHERE l.tenant_id=m.tenant_id
            AND l.practitioner_public_id=m.canonical_public_id
            AND l.legacy_user_id=d.user_id
            AND l.link_status='active'
        )
        OR (
          NOT EXISTS (
            SELECT 1 FROM users u
            WHERE u.id=d.user_id
              AND CAST(u.tenant_id AS TEXT)=CAST(d.tenant_id AS TEXT)
          )
          AND EXISTS (
            SELECT 1
            FROM canonical_processing_issues i
            WHERE i.tenant_id=m.tenant_id
              AND i.entity_type='practitioner'
              AND i.issue_type='identity_backfill'
              AND i.issue_code IN (
                'PRACTITIONER_USER_ORPHAN',
                'PRACTITIONER_USER_TENANT_MISMATCH'
              )
              AND i.source_type='legacy_doctor'
              AND i.source_public_id=CAST(d.id AS TEXT)
              AND i.status IN ('open','acknowledged','waived')
          )
        )
        OR (
          (
            SELECT COUNT(*)
            FROM doctors d2
            WHERE CAST(d2.tenant_id AS TEXT)=CAST(d.tenant_id AS TEXT)
              AND d2.user_id=d.user_id
          ) > 1
          AND EXISTS (
            SELECT 1
            FROM canonical_processing_issues i
            WHERE i.tenant_id=m.tenant_id
              AND i.entity_type='practitioner'
              AND i.issue_type='identity_backfill'
              AND i.issue_code='PRACTITIONER_USER_LINK_AMBIGUOUS'
              AND i.status IN ('open','acknowledged','waived')
          )
        )
      )
  `, [input.tenantId]);

  const employeeLinkMismatchCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM doctors d
    JOIN staff s
      ON CAST(s.tenant_id AS TEXT)=CAST(d.tenant_id AS TEXT)
     AND s.user_id=d.user_id
    JOIN canonical_source_mappings m
      ON m.tenant_id=CAST(d.tenant_id AS TEXT)
     AND m.entity_type='practitioner'
     AND m.source_type='legacy_doctor'
     AND m.source_public_id=CAST(d.id AS TEXT)
     AND m.mapping_status='mapped'
    WHERE CAST(d.tenant_id AS TEXT)=?
      AND d.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM canonical_practitioner_employee_links l
        WHERE l.tenant_id=m.tenant_id
          AND l.practitioner_public_id=m.canonical_public_id
          AND l.legacy_staff_id=s.id
          AND l.link_status='active'
      )
  `, [input.tenantId]);

  const unresolvedIdentityIssueCount = await count(db, `
    SELECT COUNT(*) AS count
    FROM canonical_processing_issues
    WHERE tenant_id=?
      AND entity_type='practitioner'
      AND issue_type='identity_resolution'
      AND status IN ('open','acknowledged')
  `, [input.tenantId]);

  const activeStatusMismatchCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT d.id
      FROM doctors d
      JOIN canonical_source_mappings m
        ON m.tenant_id=CAST(d.tenant_id AS TEXT)
       AND m.entity_type='practitioner'
       AND m.source_type='legacy_doctor'
       AND m.source_public_id=CAST(d.id AS TEXT)
       AND m.mapping_status='mapped'
      JOIN canonical_practitioners p
        ON p.tenant_id=m.tenant_id
       AND p.practitioner_public_id=m.canonical_public_id
      WHERE CAST(d.tenant_id AS TEXT)=?
        AND (
          (d.is_active=1 AND p.status!='active')
          OR (d.is_active!=1 AND p.status!='inactive')
        )
      UNION ALL
      SELECT e.id
      FROM external_referring_doctors e
      JOIN canonical_source_mappings m
        ON m.tenant_id=CAST(e.tenant_id AS TEXT)
       AND m.entity_type='practitioner'
       AND m.source_type='legacy_external_referrer'
       AND m.source_public_id=CAST(e.id AS TEXT)
       AND m.mapping_status='mapped'
      JOIN canonical_practitioners p
        ON p.tenant_id=m.tenant_id
       AND p.practitioner_public_id=m.canonical_public_id
      WHERE CAST(e.tenant_id AS TEXT)=? AND p.status!='active'
    )
  `, [input.tenantId, input.tenantId]);

  const nameOnlyMappingCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT m.canonical_public_id, ${NORMALIZED_NAME_SQL} AS normalized_name
      FROM doctors d
      JOIN canonical_source_mappings m
        ON m.tenant_id=CAST(d.tenant_id AS TEXT)
       AND m.entity_type='practitioner'
       AND m.source_type='legacy_doctor'
       AND m.source_public_id=CAST(d.id AS TEXT)
       AND m.mapping_status='mapped'
      WHERE CAST(d.tenant_id AS TEXT)=?
      GROUP BY m.canonical_public_id, normalized_name
      HAVING COUNT(*) > 1
      UNION ALL
      SELECT m.canonical_public_id, ${NORMALIZED_NAME_SQL} AS normalized_name
      FROM external_referring_doctors e
      JOIN canonical_source_mappings m
        ON m.tenant_id=CAST(e.tenant_id AS TEXT)
       AND m.entity_type='practitioner'
       AND m.source_type='legacy_external_referrer'
       AND m.source_public_id=CAST(e.id AS TEXT)
       AND m.mapping_status='mapped'
      WHERE CAST(e.tenant_id AS TEXT)=?
      GROUP BY m.canonical_public_id, normalized_name
      HAVING COUNT(*) > 1
    )
  `, [input.tenantId, input.tenantId]);

  const crossTenantLinkMismatchCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT l.id
      FROM canonical_practitioner_user_links l
      LEFT JOIN users u ON u.id=l.legacy_user_id
      WHERE l.tenant_id=?
        AND l.link_status='active'
        AND (u.id IS NULL OR CAST(u.tenant_id AS TEXT)!=l.tenant_id)
      UNION ALL
      SELECT l.id
      FROM canonical_practitioner_employee_links l
      LEFT JOIN staff s ON s.id=l.legacy_staff_id
      WHERE l.tenant_id=?
        AND l.link_status='active'
        AND (s.id IS NULL OR CAST(s.tenant_id AS TEXT)!=l.tenant_id)
    )
  `, [input.tenantId, input.tenantId]);

  const orphanCanonicalAssociationCount = await count(db, `
    SELECT COUNT(*) AS count FROM (
      SELECT l.id
      FROM canonical_practitioner_user_links l
      LEFT JOIN canonical_practitioners p
        ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
      WHERE l.tenant_id=? AND p.id IS NULL
      UNION ALL
      SELECT l.id
      FROM canonical_practitioner_employee_links l
      LEFT JOIN canonical_practitioners p
        ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
      WHERE l.tenant_id=? AND p.id IS NULL
      UNION ALL
      SELECT i.id
      FROM canonical_practitioner_identifiers i
      LEFT JOIN canonical_practitioners p
        ON p.tenant_id=i.tenant_id AND p.practitioner_public_id=i.practitioner_public_id
      WHERE i.tenant_id=? AND p.id IS NULL
      UNION ALL
      SELECT s.id
      FROM canonical_practitioner_specialties s
      LEFT JOIN canonical_practitioners p
        ON p.tenant_id=s.tenant_id AND p.practitioner_public_id=s.practitioner_public_id
      WHERE s.tenant_id=? AND p.id IS NULL
      UNION ALL
      SELECT d.id
      FROM canonical_practitioner_departments d
      LEFT JOIN canonical_practitioners p
        ON p.tenant_id=d.tenant_id AND p.practitioner_public_id=d.practitioner_public_id
      WHERE d.tenant_id=? AND p.id IS NULL
    )
  `, [input.tenantId, input.tenantId, input.tenantId, input.tenantId, input.tenantId]);

  const checks: PractitionerOperationalReconciliationChecks = {
    doctorSourceMappingMismatchCount,
    externalReferrerMappingMismatchCount,
    registrationIdentifierMismatchCount,
    userLinkMismatchCount,
    employeeLinkMismatchCount,
    unresolvedIdentityIssueCount,
    activeStatusMismatchCount,
    nameOnlyMappingCount,
    crossTenantLinkMismatchCount,
    orphanCanonicalAssociationCount,
  };
  const failedChecks = Object.values(checks).filter((value) => value > 0).length;
  const status = failedChecks === 0 ? 'passed' : 'failed';
  const evidenceSha256 = await createSourceEvidenceSha256({
    tenantId: input.tenantId,
    reconciliationType: 'practitioner_operational_adoption',
    checks,
  });
  const result: PractitionerOperationalReconciliationResult = {
    status,
    scannedChecks: 10,
    matchedChecks: 10 - failedChecks,
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
        reconciliationType: 'practitioner_operational_adoption',
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
