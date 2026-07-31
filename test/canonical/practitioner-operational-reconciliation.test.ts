import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  reconcilePractitionerOperationalAdoption,
  type PractitionerOperationalReconciliationDatabase,
  type PractitionerOperationalReconciliationPreparedStatement,
} from '../../scripts/canonical/reconcile-practitioner-operational-adoption';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements PractitionerOperationalReconciliationPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function database(sqlite: DatabaseSync): PractitionerOperationalReconciliationDatabase {
  return {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function fixture(): { sqlite: DatabaseSync; db: PractitionerOperationalReconciliationDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0506_canonical_practitioners.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0545_canonical_practitioner_operational_adoption.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE staff (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id INTEGER,
      name TEXT NOT NULL
    );
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      specialty TEXT,
      department TEXT,
      bmdc_reg_no TEXT,
      user_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE external_referring_doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      specialty TEXT
    );

    INSERT INTO users (id,tenant_id,name) VALUES (501,'tenant-a','Private User Name');
    INSERT INTO staff (id,tenant_id,user_id,name) VALUES (601,'tenant-a',501,'Private Staff Name');
    INSERT INTO doctors (
      id,tenant_id,name,specialty,department,bmdc_reg_no,user_id,is_active
    ) VALUES (101,'tenant-a','Private Doctor Name','Cardiology','Medicine','A-101',501,1);
    INSERT INTO external_referring_doctors (id,tenant_id,name,specialty)
    VALUES (301,'tenant-a','Private Referrer Name','Neurology');

    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
      version,source_evidence_sha256
    ) VALUES
      ('tenant-a','practitioner-101','internal','Canonical Internal','active',1,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      ('tenant-a','practitioner-301','external','Canonical External','active',1,
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('tenant-a','practitioner','practitioner-101','legacy_doctor','101','doctors','mapped',1,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      ('tenant-a','practitioner','practitioner-301','legacy_external_referrer','301',
        'external_referring_doctors','mapped',1,
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

    INSERT INTO canonical_practitioner_identifiers (
      tenant_id,practitioner_public_id,identifier_system,issuer_key,normalized_value,
      display_value,verification_status
    ) VALUES ('tenant-a','practitioner-101','bmdc','','A101','A-101','verified');

    INSERT INTO canonical_practitioner_user_links (
      tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
    ) VALUES ('tenant-a','practitioner-101',501,'active','approved_manual');

    INSERT INTO canonical_practitioner_employee_links (
      tenant_id,practitioner_public_id,legacy_staff_id,link_status,evidence_type
    ) VALUES ('tenant-a','practitioner-101',601,'active','approved_manual');

    INSERT INTO canonical_practitioner_specialties (
      tenant_id,practitioner_public_id,normalized_key,display_text,is_primary
    ) VALUES
      ('tenant-a','practitioner-101','cardiology','Cardiology',1),
      ('tenant-a','practitioner-301','neurology','Neurology',1);

    INSERT INTO canonical_practitioner_departments (
      tenant_id,practitioner_public_id,normalized_key,display_text,is_primary
    ) VALUES ('tenant-a','practitioner-101','medicine','Medicine',1);

    INSERT INTO canonical_migration_runs (
      tenant_id,run_public_id,migration_name,migration_kind,status,started_at_utc,completed_at_utc
    ) VALUES (
      'tenant-a','practitioner-migration-run','0545_canonical_practitioner_operational_adoption.sql',
      'backfill','succeeded','2026-07-26T00:00:00.000Z','2026-07-26T00:10:00.000Z'
    );
  `);
  return { sqlite, db: database(sqlite) };
}

describe('practitioner operational adoption reconciliation', () => {
  it('persists a passing aggregate receipt for exact mappings, identifiers, links, status, and tenant safety', async () => {
    const { sqlite, db } = fixture();
    try {
      const result = await reconcilePractitionerOperationalAdoption(db, {
        tenantId: 'tenant-a',
        runPublicId: 'practitioner-reconciliation-pass',
        migrationRunPublicId: 'practitioner-migration-run',
        nowUtc: '2026-07-26T12:00:00.000Z',
      });
      expect(result).toMatchObject({
        status: 'passed',
        scannedChecks: 10,
        matchedChecks: 10,
        mismatchChecks: 0,
        checks: {
          doctorSourceMappingMismatchCount: 0,
          externalReferrerMappingMismatchCount: 0,
          registrationIdentifierMismatchCount: 0,
          userLinkMismatchCount: 0,
          employeeLinkMismatchCount: 0,
          unresolvedIdentityIssueCount: 0,
          activeStatusMismatchCount: 0,
          nameOnlyMappingCount: 0,
          crossTenantLinkMismatchCount: 0,
          orphanCanonicalAssociationCount: 0,
        },
      });
      expect(result.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);

      const receipt = sqlite.prepare(`
        SELECT r.status,r.scanned_count,r.matched_count,r.mismatch_count,
               r.evidence_sha256,r.result_summary_json,m.run_public_id migration_run_public_id
        FROM canonical_reconciliation_runs r
        LEFT JOIN canonical_migration_runs m ON m.id=r.migration_run_id AND m.tenant_id=r.tenant_id
        WHERE r.tenant_id='tenant-a' AND r.run_public_id='practitioner-reconciliation-pass'
      `).get() as Record<string, string | number>;
      expect(receipt).toMatchObject({
        status: 'passed',
        scanned_count: 10,
        matched_count: 10,
        mismatch_count: 0,
        migration_run_public_id: 'practitioner-migration-run',
      });
      expect(receipt.evidence_sha256).toMatch(/^[0-9a-f]{64}$/);
      for (const forbidden of [
        'Private Doctor Name', 'Private Referrer Name', 'Private User Name',
        'Private Staff Name', 'A-101', 'Cardiology', 'Medicine', 'Neurology',
      ]) expect(receipt.result_summary_json).not.toContain(forbidden);
    } finally {
      sqlite.close();
    }
  });

  it('accepts operationally associated unverified BMDC and a stable disposition for a cross-tenant user reference', async () => {
    const { sqlite, db } = fixture();
    try {
      sqlite.exec(`
        UPDATE canonical_practitioner_identifiers
        SET verification_status='unverified'
        WHERE tenant_id='tenant-a' AND practitioner_public_id='practitioner-101';

        INSERT INTO users (id,tenant_id,name)
        VALUES (777,'tenant-b','Cross Tenant User');
        INSERT INTO doctors (
          id,tenant_id,name,specialty,department,bmdc_reg_no,user_id,is_active
        ) VALUES (102,'tenant-a','Cross Tenant Doctor',NULL,NULL,NULL,777,1);
        INSERT INTO canonical_practitioners (
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
          version,source_evidence_sha256
        ) VALUES (
          'tenant-a','practitioner-102','internal','Canonical Cross Tenant','active',1,
          'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
        );
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES (
          'tenant-a','practitioner','practitioner-102','legacy_doctor','102',
          'doctors','mapped',1,
          'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
        );
        INSERT INTO canonical_processing_issues (
          tenant_id,issue_public_id,issue_type,issue_code,entity_type,source_type,
          source_public_id,fingerprint,severity,status,summary
        ) VALUES (
          'tenant-a','issue-cross-tenant-user','identity_backfill',
          'PRACTITIONER_USER_TENANT_MISMATCH','practitioner','legacy_doctor','102',
          'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          'error','open','Explicit practitioner user link crosses tenant ownership'
        );
      `);

      const accepted = await reconcilePractitionerOperationalAdoption(db, {
        tenantId: 'tenant-a',
        runPublicId: 'practitioner-reconciliation-operational-evidence',
        nowUtc: '2026-07-26T12:05:00.000Z',
      });
      expect(accepted).toMatchObject({
        status: 'passed',
        mismatchChecks: 0,
        checks: {
          registrationIdentifierMismatchCount: 0,
          userLinkMismatchCount: 0,
        },
      });

      sqlite.prepare(`
        DELETE FROM canonical_processing_issues
        WHERE issue_public_id='issue-cross-tenant-user'
      `).run();
      const missingDisposition = await reconcilePractitionerOperationalAdoption(db, {
        tenantId: 'tenant-a',
        runPublicId: 'practitioner-reconciliation-missing-user-disposition',
        nowUtc: '2026-07-26T12:06:00.000Z',
      });
      expect(missingDisposition.status).toBe('failed');
      expect(missingDisposition.checks.userLinkMismatchCount).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when mapping, link, and active-status facts drift', async () => {
    const { sqlite, db } = fixture();
    try {
      sqlite.exec(`
        UPDATE canonical_source_mappings
        SET mapping_status='retired'
        WHERE tenant_id='tenant-a' AND source_type='legacy_external_referrer';
        UPDATE canonical_practitioners
        SET status='inactive'
        WHERE tenant_id='tenant-a' AND practitioner_public_id='practitioner-101';
        UPDATE canonical_practitioner_user_links
        SET legacy_user_id=999
        WHERE tenant_id='tenant-a' AND practitioner_public_id='practitioner-101';
      `);

      const result = await reconcilePractitionerOperationalAdoption(db, {
        tenantId: 'tenant-a',
        runPublicId: 'practitioner-reconciliation-fail',
        nowUtc: '2026-07-26T12:10:00.000Z',
      });
      expect(result.status).toBe('failed');
      expect(result.mismatchChecks).toBeGreaterThanOrEqual(3);
      expect(result.checks.externalReferrerMappingMismatchCount).toBe(1);
      expect(result.checks.userLinkMismatchCount).toBe(1);
      expect(result.checks.activeStatusMismatchCount).toBe(1);
      expect(sqlite.prepare(`
        SELECT status,mismatch_count,exception_count
        FROM canonical_reconciliation_runs
        WHERE run_public_id='practitioner-reconciliation-fail'
      `).get()).toMatchObject({
        status: 'failed',
        mismatch_count: result.mismatchChecks,
        exception_count: result.mismatchChecks,
      });
    } finally {
      sqlite.close();
    }
  });

  it('detects duplicate-name collapse and open ambiguity evidence without using names as identity proof', async () => {
    const { sqlite, db } = fixture();
    try {
      sqlite.exec(`
        INSERT INTO external_referring_doctors (id,tenant_id,name,specialty)
        VALUES (302,'tenant-a',' private   referrer name ','Neurology');
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES (
          'tenant-a','practitioner','practitioner-301','legacy_external_referrer','302',
          'external_referring_doctors','mapped',1,
          'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
        );
        INSERT INTO canonical_processing_issues (
          tenant_id,issue_public_id,issue_type,issue_code,entity_type,source_type,
          source_public_id,fingerprint,severity,status,summary
        ) VALUES (
          'tenant-a','issue-practitioner-ambiguous','identity_resolution',
          'PRACTITIONER_IDENTITY_AMBIGUOUS','practitioner','legacy_external_referrer',
          '302','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          'warning','open','Practitioner identity requires review'
        );
      `);
      const result = await reconcilePractitionerOperationalAdoption(db, {
        tenantId: 'tenant-a',
        runPublicId: 'practitioner-reconciliation-name-collapse',
        nowUtc: '2026-07-26T12:20:00.000Z',
      });
      expect(result.status).toBe('failed');
      expect(result.checks.nameOnlyMappingCount).toBe(1);
      expect(result.checks.unresolvedIdentityIssueCount).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
