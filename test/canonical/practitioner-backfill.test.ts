import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillPractitioners,
  type PractitionerBackfillDatabase,
  type PractitionerBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-practitioners';
import {
  createDeterministicSourceId,
  normalizeIdentityText,
  normalizeRegistrationNumber,
} from '../../src/lib/canonical/source-mapping';

type SqlValue = string | number | bigint | null | Uint8Array;

class SqliteStatement implements PractitionerBackfillPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(
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

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function createDatabase(sqlite: DatabaseSync): PractitionerBackfillDatabase {
  return {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
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

function createFixture(): { sqlite: DatabaseSync; db: PractitionerBackfillDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0506_canonical_practitioners.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0545_canonical_practitioner_operational_adoption.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER,
      name TEXT NOT NULL
    );
    CREATE TABLE staff (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      user_id INTEGER,
      name TEXT NOT NULL
    );
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      specialty TEXT,
      department TEXT,
      bmdc_reg_no TEXT,
      user_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE external_referring_doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      specialty TEXT,
      phone TEXT,
      chamber TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  return { sqlite, db: createDatabase(sqlite) };
}

function seedIdentityFixture(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO users (id, tenant_id, name) VALUES
      (1, 1, 'Linked User'),
      (2, 2, 'Other Tenant User');

    INSERT INTO staff (id, tenant_id, user_id, name) VALUES
      (10, 1, 1, 'Linked Staff');

    INSERT INTO doctors (
      id, tenant_id, name, specialty, department, bmdc_reg_no, user_id, is_active
    ) VALUES
      (1, 1, 'Doctor Linked', 'Cardiology', 'Medicine', 'A-1', 1, 1),
      (2, 1, 'Doctor No User', 'Medicine', 'Medicine', 'B 2', NULL, 1),
      (3, 1, 'Doctor Duplicate One', 'Surgery', 'Surgery', 'DUP-9', NULL, 1),
      (4, 1, 'Doctor Duplicate Two', 'Surgery', 'Surgery', 'dup 9', NULL, 1),
      (5, 1, 'Doctor Cross Tenant', 'Radiology', 'Diagnostics', 'CROSS-5', 2, 1),
      (6, 1, 'Same Name Person', 'Medicine', 'OPD', NULL, NULL, 1),
      (7, 2, 'Other Tenant Doctor', 'Cardiology', 'Medicine', 'A-1', NULL, 1);

    INSERT INTO external_referring_doctors (
      id, tenant_id, name, specialty, phone, chamber
    ) VALUES
      (100, '1', 'External Unique', 'Medicine', '01000000000', 'Outside'),
      (101, '1', 'Same Name Person', 'Medicine', '01000000001', 'Outside'),
      (102, '1', 'Repeated External', 'Surgery', '01000000002', 'Outside'),
      (103, '1', ' repeated   external ', 'Surgery', '01000000003', 'Outside');
  `);
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function identityCounts(sqlite: DatabaseSync) {
  return {
    practitioners: count(sqlite, 'canonical_practitioners'),
    userLinks: count(sqlite, 'canonical_practitioner_user_links'),
    employeeLinks: count(sqlite, 'canonical_practitioner_employee_links'),
    identifiers: count(sqlite, 'canonical_practitioner_identifiers'),
    specialties: count(sqlite, 'canonical_practitioner_specialties'),
    departments: count(sqlite, 'canonical_practitioner_departments'),
    mappings: count(sqlite, 'canonical_source_mappings'),
    issues: count(sqlite, 'canonical_processing_issues'),
  };
}

describe('canonical practitioner migration', () => {
  it('creates six tenant-scoped identity tables with typed links and uniqueness', () => {
    expect(existsSync('migrations/0506_canonical_practitioners.sql')).toBe(true);
    expect(existsSync('src/db/schema/canonical/identity.ts')).toBe(true);

    const { sqlite } = createFixture();
    try {
      const tables = (
        sqlite
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type='table' AND name LIKE 'canonical_practitioner%'
             ORDER BY name`,
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(tables).toEqual([
        'canonical_practitioner_departments',
        'canonical_practitioner_employee_links',
        'canonical_practitioner_identifiers',
        'canonical_practitioner_specialties',
        'canonical_practitioner_user_links',
        'canonical_practitioners',
      ]);

      for (const table of tables) {
        const tenant = sqlite
          .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
          .all()
          .find((column) => String(column.name) === 'tenant_id') as
          | { type: string; notnull: number }
          | undefined;
        expect(tenant).toMatchObject({ type: 'TEXT', notnull: 1 });
      }

      sqlite
        .prepare(
          `INSERT INTO canonical_practitioners (
             tenant_id, practitioner_public_id, practitioner_kind, display_name, status
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('1', 'prc_one', 'internal', 'Synthetic Doctor', 'active');
      sqlite
        .prepare(
          `INSERT INTO canonical_practitioner_identifiers (
             tenant_id, practitioner_public_id, identifier_system,
             normalized_value, display_value, verification_status
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('1', 'prc_one', 'bmdc', 'A1', 'A-1', 'unverified');

      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO canonical_practitioner_identifiers (
               tenant_id, practitioner_public_id, identifier_system,
               normalized_value, display_value, verification_status
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('1', 'prc_one', 'bmdc', 'A1', 'A-1', 'unverified'),
      ).toThrow(/UNIQUE constraint failed/);
    } finally {
      sqlite.close();
    }
  });
});

describe('practitioner source mapping primitives', () => {
  it('normalizes identifiers and names without treating a name as an identity key', async () => {
    expect(normalizeRegistrationNumber(' bmdc- 12 34 ')).toBe('BMDC1234');
    expect(normalizeIdentityText('  Same   Name  ')).toBe('same name');

    const first = await createDeterministicSourceId('prc', '1', 'legacy_doctor', '17');
    const same = await createDeterministicSourceId('prc', '1', 'legacy_doctor', '17');
    const otherTenant = await createDeterministicSourceId('prc', '2', 'legacy_doctor', '17');
    expect(first).toBe(same);
    expect(first).not.toBe(otherTenant);
    expect(first).toMatch(/^prc_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('canonical practitioner backfill', () => {
  it('maps deterministic internal/external identities and records conflicts without guessing', async () => {
    const { sqlite, db } = createFixture();
    seedIdentityFixture(sqlite);
    try {
      const result = await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-practitioner-1',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });

      expect(result.completed).toBe(true);
      expect(result.counts).toMatchObject({
        scanned: 10,
        created: 7,
        mapped: 7,
        ambiguous: 3,
        userLinks: 1,
        employeeLinks: 1,
        issues: 5,
      });
      expect(identityCounts(sqlite)).toEqual({
        practitioners: 7,
        userLinks: 1,
        employeeLinks: 1,
        identifiers: 3,
        specialties: 7,
        departments: 6,
        mappings: 10,
        issues: 5,
      });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM canonical_practitioners
        WHERE version=1
          AND source_evidence_sha256 GLOB '[0-9a-f]*'
          AND length(source_evidence_sha256)=64
          AND source_evidence_sha256!='0000000000000000000000000000000000000000000000000000000000000000'
      `).get()).toEqual({ count: 7 });

      const crossTenantLink = sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM canonical_practitioner_user_links
           WHERE legacy_user_id = 2`,
        )
        .get() as { count: number };
      expect(crossTenantLink.count).toBe(0);

      const ambiguousMappings = sqlite
        .prepare(
          `SELECT source_public_id, canonical_public_id, mapping_status
           FROM canonical_source_mappings
           WHERE source_type='legacy_external_referrer'
             AND mapping_status='ambiguous'
           ORDER BY source_public_id`,
        )
        .all();
      expect(ambiguousMappings).toEqual([
        { source_public_id: '101', canonical_public_id: null, mapping_status: 'ambiguous' },
        { source_public_id: '102', canonical_public_id: null, mapping_status: 'ambiguous' },
        { source_public_id: '103', canonical_public_id: null, mapping_status: 'ambiguous' },
      ]);

      const duplicateIdentifierRows = sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM canonical_practitioner_identifiers
           WHERE normalized_value='DUP9'`,
        )
        .get() as { count: number };
      expect(duplicateIdentifierRows.count).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('does not choose a winner when two doctors share one explicit user and employee identity', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO users (id, tenant_id, name) VALUES (1, 1, 'Shared User');
      INSERT INTO staff (id, tenant_id, user_id, name) VALUES (10, 1, 1, 'Shared Staff');
      INSERT INTO doctors (id, tenant_id, name, bmdc_reg_no, user_id, is_active) VALUES
        (1, 1, 'Doctor One', 'R-1', 1, 1),
        (2, 1, 'Doctor Two', 'R-2', 1, 1);
    `);
    try {
      const result = await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-shared-user',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });

      expect(result.completed).toBe(true);
      expect(count(sqlite, 'canonical_practitioners')).toBe(2);
      expect(count(sqlite, 'canonical_practitioner_user_links')).toBe(0);
      expect(count(sqlite, 'canonical_practitioner_employee_links')).toBe(0);
      expect(
        sqlite
          .prepare(
            `SELECT issue_code, occurrence_count FROM canonical_processing_issues
             WHERE tenant_id='1' AND issue_code='PRACTITIONER_USER_LINK_AMBIGUOUS'`,
          )
          .get(),
      ).toEqual({ issue_code: 'PRACTITIONER_USER_LINK_AMBIGUOUS', occurrence_count: 2 });
    } finally {
      sqlite.close();
    }
  });

  it('reuses an existing practitioner when a unique registration identifier proves the identity', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO canonical_practitioners (
        tenant_id, practitioner_public_id, practitioner_kind, display_name, status
      ) VALUES ('1', 'prc_existing', 'internal', 'Existing Practitioner', 'active');
      INSERT INTO canonical_practitioner_identifiers (
        tenant_id, practitioner_public_id, identifier_system, issuer_key,
        normalized_value, display_value, verification_status
      ) VALUES ('1', 'prc_existing', 'bmdc', '', 'A1', 'A-1', 'verified');
      INSERT INTO doctors (id, tenant_id, name, bmdc_reg_no, is_active)
      VALUES (1, 1, 'Legacy Doctor', 'A-1', 1);
    `);
    try {
      await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-existing-identifier',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });

      expect(count(sqlite, 'canonical_practitioners')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_identifiers')).toBe(1);
      expect(
        sqlite
          .prepare(
            `SELECT canonical_public_id, mapping_status FROM canonical_source_mappings
             WHERE tenant_id='1' AND source_type='legacy_doctor' AND source_public_id='1'`,
          )
          .get(),
      ).toEqual({ canonical_public_id: 'prc_existing', mapping_status: 'mapped' });
      expect(count(sqlite, 'canonical_processing_issues')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('reuses an existing practitioner when an explicit user link proves the identity', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO users (id, tenant_id, name) VALUES (1, 1, 'Linked User');
      INSERT INTO canonical_practitioners (
        tenant_id, practitioner_public_id, practitioner_kind, display_name, status
      ) VALUES ('1', 'prc_existing_user', 'internal', 'Existing User Practitioner', 'active');
      INSERT INTO canonical_practitioner_user_links (
        tenant_id, practitioner_public_id, legacy_user_id, link_status, evidence_type
      ) VALUES ('1', 'prc_existing_user', 1, 'active', 'approved_manual');
      INSERT INTO doctors (id, tenant_id, name, user_id, is_active)
      VALUES (1, 1, 'Legacy Doctor', 1, 1);
    `);
    try {
      await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-existing-user-link',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });

      expect(count(sqlite, 'canonical_practitioners')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_user_links')).toBe(1);
      expect(
        sqlite
          .prepare(
            `SELECT canonical_public_id FROM canonical_source_mappings
             WHERE tenant_id='1' AND source_type='legacy_doctor' AND source_public_id='1'`,
          )
          .get(),
      ).toEqual({ canonical_public_id: 'prc_existing_user' });
    } finally {
      sqlite.close();
    }
  });

  it('operationally adopts an exact existing mapping by restoring missing identifier and explicit links', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO users (id, tenant_id, name) VALUES (1, 1, 'Linked User');
      INSERT INTO staff (id, tenant_id, user_id, name) VALUES (10, 1, 1, 'Linked Staff');
      INSERT INTO doctors (
        id, tenant_id, name, specialty, department, bmdc_reg_no, user_id, is_active
      ) VALUES (1, 1, 'Mapped Doctor', 'Cardiology', 'Medicine', 'A-1', 1, 1);
    `);
    try {
      await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-mapped-operational-seed',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });
      const mappingBefore = sqlite.prepare(`
        SELECT canonical_public_id,evidence_sha256
        FROM canonical_source_mappings
        WHERE tenant_id='1' AND entity_type='practitioner'
          AND source_type='legacy_doctor' AND source_public_id='1'
      `).get();
      sqlite.exec(`
        DELETE FROM canonical_practitioner_identifiers;
        DELETE FROM canonical_practitioner_user_links;
        DELETE FROM canonical_practitioner_employee_links;
      `);

      const result = await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-mapped-operational-adoption',
        nowUtc: '2026-07-14T00:10:00.000Z',
      });

      expect(result).toEqual({
        completed: true,
        counts: {
          scanned: 1,
          created: 0,
          mapped: 0,
          ambiguous: 0,
          userLinks: 1,
          employeeLinks: 1,
          issues: 0,
        },
      });
      expect(count(sqlite, 'canonical_practitioners')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_identifiers')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_user_links')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_employee_links')).toBe(1);
      expect(sqlite.prepare(`
        SELECT canonical_public_id,evidence_sha256
        FROM canonical_source_mappings
        WHERE tenant_id='1' AND entity_type='practitioner'
          AND source_type='legacy_doctor' AND source_public_id='1'
      `).get()).toEqual(mappingBefore);
    } finally {
      sqlite.close();
    }
  });

  it('leaves the source ambiguous when registration and user evidence resolve to different practitioners', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO users (id, tenant_id, name) VALUES (1, 1, 'Linked User');
      INSERT INTO canonical_practitioners (
        tenant_id, practitioner_public_id, practitioner_kind, display_name, status
      ) VALUES
        ('1', 'prc_by_registration', 'internal', 'Registration Practitioner', 'active'),
        ('1', 'prc_by_user', 'internal', 'User Practitioner', 'active');
      INSERT INTO canonical_practitioner_identifiers (
        tenant_id, practitioner_public_id, identifier_system, issuer_key,
        normalized_value, display_value, verification_status
      ) VALUES ('1', 'prc_by_registration', 'bmdc', '', 'A1', 'A-1', 'verified');
      INSERT INTO canonical_practitioner_user_links (
        tenant_id, practitioner_public_id, legacy_user_id, link_status, evidence_type
      ) VALUES ('1', 'prc_by_user', 1, 'active', 'approved_manual');
      INSERT INTO doctors (id, tenant_id, name, bmdc_reg_no, user_id, is_active)
      VALUES (1, 1, 'Conflicting Legacy Doctor', 'A-1', 1, 1);
    `);
    try {
      await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-conflicting-evidence',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });

      expect(count(sqlite, 'canonical_practitioners')).toBe(2);
      expect(
        sqlite
          .prepare(
            `SELECT canonical_public_id, mapping_status FROM canonical_source_mappings
             WHERE tenant_id='1' AND source_type='legacy_doctor' AND source_public_id='1'`,
          )
          .get(),
      ).toEqual({ canonical_public_id: null, mapping_status: 'ambiguous' });
      expect(
        sqlite
          .prepare(
            `SELECT issue_code FROM canonical_processing_issues
             WHERE tenant_id='1' AND issue_code='PRACTITIONER_DETERMINISTIC_IDENTITY_CONFLICT'`,
          )
          .get(),
      ).toEqual({ issue_code: 'PRACTITIONER_DETERMINISTIC_IDENTITY_CONFLICT' });
    } finally {
      sqlite.close();
    }
  });

  it('detects source evidence drift after a mapping has already been established', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO doctors (id, tenant_id, name, specialty, department, bmdc_reg_no, is_active)
      VALUES (1, 1, 'Doctor One', 'Medicine', 'OPD', 'R-1', 1);
    `);
    try {
      await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-evidence-original',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });
      const originalMapping = sqlite
        .prepare(
          `SELECT evidence_sha256 FROM canonical_source_mappings
           WHERE tenant_id='1' AND source_type='legacy_doctor' AND source_public_id='1'`,
        )
        .get() as { evidence_sha256: string | null };
      expect(originalMapping.evidence_sha256).toMatch(/^[a-f0-9]{64}$/);

      sqlite.exec(`UPDATE doctors SET department='Emergency' WHERE id=1 AND tenant_id=1;`);
      const rerun = await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-evidence-rerun',
        nowUtc: '2026-07-14T00:01:00.000Z',
      });

      expect(rerun.counts.created).toBe(0);
      expect(
        sqlite
          .prepare(
            `SELECT issue_code, source_public_id FROM canonical_processing_issues
             WHERE tenant_id='1' AND issue_code='PRACTITIONER_SOURCE_EVIDENCE_CHANGED'`,
          )
          .get(),
      ).toEqual({ issue_code: 'PRACTITIONER_SOURCE_EVIDENCE_CHANGED', source_public_id: '1' });
    } finally {
      sqlite.close();
    }
  });

  it('allows the same registration number in another tenant and reruns without duplicate business rows', async () => {
    const { sqlite, db } = createFixture();
    seedIdentityFixture(sqlite);
    try {
      await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-tenant-1',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });
      await backfillPractitioners(db, {
        tenantId: '2',
        runPublicId: 'run-tenant-2',
        nowUtc: '2026-07-14T00:01:00.000Z',
      });
      const beforeRerun = identityCounts(sqlite);

      const rerun = await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-tenant-1-rerun',
        nowUtc: '2026-07-14T00:02:00.000Z',
      });

      expect(rerun.completed).toBe(true);
      expect(rerun.counts.created).toBe(0);
      expect(identityCounts(sqlite)).toEqual(beforeRerun);
      expect(
        count(sqlite, 'canonical_practitioner_identifiers'),
      ).toBe(4);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back a failed source row and resumes from the last committed checkpoint', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO doctors (id, tenant_id, name, bmdc_reg_no, is_active) VALUES
        (1, 1, 'Doctor One', 'R-1', 1),
        (2, 1, 'Doctor Two', 'R-2', 1);
      CREATE TRIGGER fail_second_practitioner
      BEFORE INSERT ON canonical_practitioners
      WHEN NEW.display_name = 'Doctor Two'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic practitioner backfill failure');
      END;
    `);
    try {
      await expect(
        backfillPractitioners(db, {
          tenantId: '1',
          runPublicId: 'run-failure-resume',
          nowUtc: '2026-07-14T00:00:00.000Z',
        }),
      ).rejects.toThrow(/synthetic practitioner backfill failure/);

      expect(count(sqlite, 'canonical_practitioners')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(
        sqlite
          .prepare(
            `SELECT cursor_value, status FROM canonical_backfill_checkpoints
             WHERE tenant_id='1' AND source_type='legacy_doctor'`,
          )
          .get(),
      ).toEqual({ cursor_value: '1', status: 'running' });

      sqlite.exec(`DROP TRIGGER fail_second_practitioner;`);
      const resumed = await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-failure-resume',
        nowUtc: '2026-07-14T00:01:00.000Z',
      });

      expect(resumed.completed).toBe(true);
      expect(count(sqlite, 'canonical_practitioners')).toBe(2);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('persists checkpoints and resumes a bounded partial run', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO doctors (id, tenant_id, name, bmdc_reg_no, is_active) VALUES
        (1, 1, 'Doctor One', 'R-1', 1),
        (2, 1, 'Doctor Two', 'R-2', 1),
        (3, 1, 'Doctor Three', 'R-3', 1);
    `);
    try {
      const partial = await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-partial',
        nowUtc: '2026-07-14T00:00:00.000Z',
        maxSourceRecords: 2,
      });
      expect(partial.completed).toBe(false);
      expect(count(sqlite, 'canonical_practitioners')).toBe(2);

      const checkpoint = sqlite
        .prepare(
          `SELECT cursor_value, status FROM canonical_backfill_checkpoints
           WHERE tenant_id='1' AND source_type='legacy_doctor'`,
        )
        .get();
      expect(checkpoint).toEqual({ cursor_value: '2', status: 'paused' });

      const resumed = await backfillPractitioners(db, {
        tenantId: '1',
        runPublicId: 'run-partial',
        nowUtc: '2026-07-14T00:01:00.000Z',
        maxSourceRecords: 10,
      });
      expect(resumed.completed).toBe(true);
      expect(count(sqlite, 'canonical_practitioners')).toBe(3);
      expect(
        sqlite
          .prepare(`SELECT status FROM canonical_migration_runs WHERE run_public_id='run-partial'`)
          .get(),
      ).toEqual({ status: 'succeeded' });
    } finally {
      sqlite.close();
    }
  });
});
