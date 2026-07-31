import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillTenantPatientLinks,
  type PatientLinkBackfillDatabase,
  type PatientLinkBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-tenant-patient-links';
import {
  reconcileTenantPatientLinks,
  type PatientLinkReconciliationDatabase,
} from '../../scripts/canonical/reconcile-tenant-patient-links';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements PatientLinkBackfillPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
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
      meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function database(sqlite: DatabaseSync): PatientLinkBackfillDatabase {
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

function fixture(): { sqlite: DatabaseSync; db: PatientLinkBackfillDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0544_canonical_tenant_patient_links.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      uhid TEXT,
      national_id TEXT,
      mobile TEXT,
      name TEXT NOT NULL
    );
    CREATE TABLE global_patient_identity (
      id INTEGER PRIMARY KEY,
      global_uhid TEXT NOT NULL,
      national_id TEXT,
      primary_mobile TEXT,
      name TEXT,
      claim_status TEXT NOT NULL DEFAULT 'unclaimed',
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  sqlite.exec(`
    INSERT INTO patients (id,tenant_id,uhid,national_id,mobile,name) VALUES
      (1,'tenant-a','UHID-1',NULL,'01700000001','Exact UHID'),
      (2,'tenant-a','UHID-DUP',NULL,'01700000002','Duplicate UHID'),
      (3,'tenant-a','UHID-MISSING',NULL,'01700000003','Missing UHID'),
      (4,'tenant-a',NULL,NULL,NULL,'No Identity Evidence'),
      (5,'tenant-a',NULL,'NID-5','01700000005','Mutable Match Only'),
      (6,'tenant-b','UHID-1',NULL,'01800000001','Other Tenant');

    INSERT INTO global_patient_identity (
      id,global_uhid,national_id,primary_mobile,name,claim_status,is_active
    ) VALUES
      (10,'UHID-1',NULL,'01700000001','Exact UHID','claimed',1),
      (11,'UHID-DUP',NULL,'01700000002','Duplicate UHID','claimed',1),
      (12,'UHID-DUP',NULL,'01999999999','Different Person','claimed',1),
      (13,'GLOBAL-5','NID-5','01700000005','Mutable Match Only','claimed',1);
  `);
  return { sqlite, db: database(sqlite) };
}

function tableCount(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('canonical tenant patient link backfill', () => {
  it('uses exact unique UHID evidence, records ambiguity, and never links by phone/name/national ID alone', async () => {
    const { sqlite, db } = fixture();
    try {
      const beforePatients = sqlite.prepare(`
        SELECT id,tenant_id,uhid,national_id,mobile,name FROM patients ORDER BY id
      `).all();
      const result = await backfillTenantPatientLinks(db, {
        tenantId: 'tenant-a',
        runPublicId: 'run-patient-link-tenant-a',
        nowUtc: '2026-07-26T00:00:00.000Z',
      });

      expect(result.completed).toBe(true);
      expect(result.counts).toEqual({
        scanned: 5,
        created: 5,
        skipped: 0,
        verified: 1,
        candidate: 2,
        unlinked: 2,
        events: 5,
        mappings: 5,
        issues: 2,
      });
      expect(tableCount(sqlite, 'canonical_tenant_patient_links')).toBe(5);
      expect(tableCount(sqlite, 'canonical_tenant_patient_link_events')).toBe(5);
      expect(tableCount(sqlite, 'canonical_source_mappings')).toBe(5);
      expect(tableCount(sqlite, 'canonical_processing_issues')).toBe(2);

      expect(sqlite.prepare(`
        SELECT legacy_patient_id,global_patient_uhid,link_status,verification_level,evidence_type
        FROM canonical_tenant_patient_links ORDER BY legacy_patient_id
      `).all()).toEqual([
        { legacy_patient_id: 1, global_patient_uhid: 'UHID-1', link_status: 'verified', verification_level: 'verified', evidence_type: 'unique_uhid' },
        { legacy_patient_id: 2, global_patient_uhid: null, link_status: 'candidate', verification_level: 'candidate', evidence_type: 'ambiguous_candidate' },
        { legacy_patient_id: 3, global_patient_uhid: null, link_status: 'candidate', verification_level: 'candidate', evidence_type: 'ambiguous_candidate' },
        { legacy_patient_id: 4, global_patient_uhid: null, link_status: 'unlinked', verification_level: 'unverified', evidence_type: 'no_link_placeholder' },
        { legacy_patient_id: 5, global_patient_uhid: null, link_status: 'unlinked', verification_level: 'unverified', evidence_type: 'no_link_placeholder' },
      ]);
      expect(sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_tenant_patient_links
        WHERE legacy_patient_id=5 AND global_patient_uhid IS NOT NULL
      `).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`
        SELECT issue_code,source_public_id FROM canonical_processing_issues ORDER BY source_public_id
      `).all()).toEqual([
        { issue_code: 'PATIENT_UHID_AMBIGUOUS', source_public_id: '2' },
        { issue_code: 'PATIENT_UHID_UNRESOLVED', source_public_id: '3' },
      ]);
      expect(sqlite.prepare(`
        SELECT id,tenant_id,uhid,national_id,mobile,name FROM patients ORDER BY id
      `).all()).toEqual(beforePatients);
    } finally {
      sqlite.close();
    }
  });

  it('is tenant-scoped, resumable, and writes zero new facts on the second pass', async () => {
    const { sqlite, db } = fixture();
    try {
      await backfillTenantPatientLinks(db, {
        tenantId: 'tenant-a',
        runPublicId: 'run-patient-link-tenant-a',
        nowUtc: '2026-07-26T00:00:00.000Z',
      });
      const before = {
        links: tableCount(sqlite, 'canonical_tenant_patient_links'),
        events: tableCount(sqlite, 'canonical_tenant_patient_link_events'),
        mappings: tableCount(sqlite, 'canonical_source_mappings'),
        issues: tableCount(sqlite, 'canonical_processing_issues'),
      };
      const second = await backfillTenantPatientLinks(db, {
        tenantId: 'tenant-a',
        runPublicId: 'run-patient-link-tenant-a-second-pass',
        nowUtc: '2026-07-26T01:00:00.000Z',
      });
      expect(second.counts).toEqual({
        scanned: 5,
        created: 0,
        skipped: 5,
        verified: 0,
        candidate: 0,
        unlinked: 0,
        events: 0,
        mappings: 0,
        issues: 0,
      });
      expect({
        links: tableCount(sqlite, 'canonical_tenant_patient_links'),
        events: tableCount(sqlite, 'canonical_tenant_patient_link_events'),
        mappings: tableCount(sqlite, 'canonical_source_mappings'),
        issues: tableCount(sqlite, 'canonical_processing_issues'),
      }).toEqual(before);
      expect(sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_tenant_patient_links WHERE tenant_id='tenant-b'
      `).get()).toEqual({ count: 0 });

      const runs = sqlite.prepare(`
        SELECT run_public_id,status,result_summary_json
        FROM canonical_migration_runs ORDER BY id
      `).all() as Array<{ run_public_id: string; status: string; result_summary_json: string }>;
      expect(runs.map((run) => ({
        run_public_id: run.run_public_id,
        status: run.status,
        summary: JSON.parse(run.result_summary_json),
      }))).toEqual([
        {
          run_public_id: 'run-patient-link-tenant-a',
          status: 'succeeded',
          summary: {
            scanned: 5,
            created: 5,
            skipped: 0,
            verified: 1,
            candidate: 2,
            unlinked: 2,
            events: 5,
            mappings: 5,
            issues: 2,
          },
        },
        {
          run_public_id: 'run-patient-link-tenant-a-second-pass',
          status: 'succeeded',
          summary: {
            scanned: 5,
            created: 0,
            skipped: 5,
            verified: 0,
            candidate: 0,
            unlinked: 0,
            events: 0,
            mappings: 0,
            issues: 0,
          },
        },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('processes deterministic chunks with durable paused/completed cursors', async () => {
    const { sqlite, db } = fixture();
    try {
      const first = await backfillTenantPatientLinks(db, {
        tenantId: 'tenant-a',
        runPublicId: 'run-patient-link-chunk-1',
        nowUtc: '2026-07-26T00:00:00.000Z',
        chunkSize: 2,
      });
      expect(first).toMatchObject({
        completed: false,
        nextCursorLegacyPatientId: 2,
        counts: { scanned: 2, created: 2 },
      });
      const second = await backfillTenantPatientLinks(db, {
        tenantId: 'tenant-a',
        runPublicId: 'run-patient-link-chunk-2',
        nowUtc: '2026-07-26T00:10:00.000Z',
        chunkSize: 2,
        afterLegacyPatientId: first.nextCursorLegacyPatientId,
      });
      expect(second).toMatchObject({
        completed: false,
        nextCursorLegacyPatientId: 4,
        counts: { scanned: 2, created: 2 },
      });
      const third = await backfillTenantPatientLinks(db, {
        tenantId: 'tenant-a',
        runPublicId: 'run-patient-link-chunk-3',
        nowUtc: '2026-07-26T00:20:00.000Z',
        chunkSize: 2,
        afterLegacyPatientId: second.nextCursorLegacyPatientId,
      });
      expect(third).toMatchObject({
        completed: true,
        nextCursorLegacyPatientId: null,
        counts: { scanned: 1, created: 1 },
      });
      expect(tableCount(sqlite, 'canonical_tenant_patient_links')).toBe(5);
      expect(sqlite.prepare(`
        SELECT status,cursor_value FROM canonical_backfill_checkpoints ORDER BY id
      `).all()).toEqual([
        { status: 'paused', cursor_value: '2' },
        { status: 'paused', cursor_value: '4' },
        { status: 'completed', cursor_value: '5' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('persists a passing reconciliation receipt for link cardinality, evidence, events, and tenant safety', async () => {
    const { sqlite, db } = fixture();
    try {
      await backfillTenantPatientLinks(db, {
        tenantId: 'tenant-a',
        runPublicId: 'run-patient-link-tenant-a',
        nowUtc: '2026-07-26T00:00:00.000Z',
      });
      const result = await reconcileTenantPatientLinks(db as PatientLinkReconciliationDatabase, {
        tenantId: 'tenant-a',
        runPublicId: 'reconcile-patient-link-tenant-a',
        migrationRunPublicId: 'run-patient-link-tenant-a',
        nowUtc: '2026-07-26T00:30:00.000Z',
      });
      expect(result).toMatchObject({
        status: 'passed',
        scannedChecks: 7,
        matchedChecks: 7,
        mismatchChecks: 0,
        checks: {
          tenantPatientCountMatchesLinkCount: true,
          duplicateCurrentLinkCount: 0,
          invalidVerifiedGlobalCount: 0,
          forbiddenVerifiedEvidenceCount: 0,
          latestEventStateMismatchCount: 0,
          invalidMergeEventCount: 0,
          crossTenantEventMismatchCount: 0,
        },
      });
      expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(sqlite.prepare(`
        SELECT r.status,r.scanned_count,r.matched_count,r.mismatch_count,r.exception_count,
               m.run_public_id AS migration_run_public_id
        FROM canonical_reconciliation_runs r
        JOIN canonical_migration_runs m ON m.id=r.migration_run_id AND m.tenant_id=r.tenant_id
      `).get()).toEqual({
        status: 'passed',
        scanned_count: 7,
        matched_count: 7,
        mismatch_count: 0,
        exception_count: 0,
        migration_run_public_id: 'run-patient-link-tenant-a',
      });
    } finally {
      sqlite.close();
    }
  });

  it('fails reconciliation when current state no longer matches immutable latest-event evidence', async () => {
    const { sqlite, db } = fixture();
    try {
      await backfillTenantPatientLinks(db, {
        tenantId: 'tenant-a',
        runPublicId: 'run-patient-link-tenant-a',
        nowUtc: '2026-07-26T00:00:00.000Z',
      });
      sqlite.prepare(`
        UPDATE canonical_tenant_patient_links
        SET link_status='rejected',updated_at_utc='2026-07-26T00:20:00.000Z'
        WHERE tenant_id='tenant-a' AND legacy_patient_id=4
      `).run();
      const result = await reconcileTenantPatientLinks(db as PatientLinkReconciliationDatabase, {
        tenantId: 'tenant-a',
        runPublicId: 'reconcile-patient-link-tampered',
        migrationRunPublicId: 'run-patient-link-tenant-a',
        nowUtc: '2026-07-26T00:30:00.000Z',
      });
      expect(result).toMatchObject({
        status: 'failed',
        scannedChecks: 7,
        matchedChecks: 6,
        mismatchChecks: 1,
        checks: { latestEventStateMismatchCount: 1 },
      });
      expect(sqlite.prepare(`
        SELECT status,mismatch_count,exception_count
        FROM canonical_reconciliation_runs
        WHERE run_public_id='reconcile-patient-link-tampered'
      `).get()).toEqual({ status: 'failed', mismatch_count: 1, exception_count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('supports the production global identity schema with uhid and verified identity status', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
    sqlite.exec(readFileSync('migrations/0544_canonical_tenant_patient_links.sql', 'utf8'));
    sqlite.exec(`
      CREATE TABLE patients (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        uhid TEXT,
        national_id TEXT
      );
      CREATE TABLE global_patient_identity (
        id INTEGER PRIMARY KEY,
        uhid TEXT NOT NULL UNIQUE,
        identity_status TEXT NOT NULL
      );
      INSERT INTO patients (id,tenant_id,uhid,national_id)
      VALUES (1,'tenant-a','PROD-UHID-1',NULL);
      INSERT INTO global_patient_identity (id,uhid,identity_status)
      VALUES (10,'PROD-UHID-1','verified');
    `);
    const db = database(sqlite);
    try {
      const backfill = await backfillTenantPatientLinks(db, {
        tenantId: 'tenant-a',
        runPublicId: 'run-production-shape-patient-link',
        nowUtc: '2026-07-27T00:00:00.000Z',
      });
      expect(backfill).toMatchObject({
        completed: true,
        counts: { scanned: 1, created: 1, verified: 1, candidate: 0, issues: 0 },
      });
      expect(sqlite.prepare(`
        SELECT global_patient_uhid,link_status,evidence_type
        FROM canonical_tenant_patient_links
      `).get()).toEqual({
        global_patient_uhid: 'PROD-UHID-1',
        link_status: 'verified',
        evidence_type: 'unique_uhid',
      });
      const reconciliation = await reconcileTenantPatientLinks(
        db as PatientLinkReconciliationDatabase,
        {
          tenantId: 'tenant-a',
          runPublicId: 'reconcile-production-shape-patient-link',
          migrationRunPublicId: 'run-production-shape-patient-link',
          nowUtc: '2026-07-27T00:01:00.000Z',
        },
      );
      expect(reconciliation).toMatchObject({ status: 'passed', mismatchChecks: 0 });
    } finally {
      sqlite.close();
    }
  });
});
