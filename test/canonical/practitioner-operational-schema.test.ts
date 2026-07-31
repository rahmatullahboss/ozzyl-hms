import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const foundationMigration = 'migrations/0505_canonical_program_foundation.sql';
const practitionerMigration = 'migrations/0506_canonical_practitioners.sql';
const operationalMigration = 'migrations/0545_canonical_practitioner_operational_adoption.sql';
const schemaPath = 'src/db/schema/canonical/identity.ts';
const zeroHash = '0'.repeat(64);

function createDatabaseWithExistingPractitioner(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(foundationMigration, 'utf8'));
  db.exec(readFileSync(practitionerMigration, 'utf8'));
  db.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('tenant-a','prac_existing','internal','Existing Doctor','active')
  `).run();
  db.exec(readFileSync(operationalMigration, 'utf8'));
  return db;
}

function columns(db: DatabaseSync): Array<{
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}> {
  return db.prepare('PRAGMA table_info(canonical_practitioners)').all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }>;
}

describe('canonical practitioner operational adoption schema', () => {
  it('reserves the additive operational migration and Drizzle fields', () => {
    expect(existsSync(operationalMigration)).toBe(true);
    expect(existsSync(schemaPath)).toBe(true);
    if (!existsSync(operationalMigration) || !existsSync(schemaPath)) return;

    const migration = readFileSync(operationalMigration, 'utf8').replace(/\s+/g, ' ');
    const schema = readFileSync(schemaPath, 'utf8');
    expect(migration).toContain('ALTER TABLE canonical_practitioners ADD COLUMN version');
    expect(migration).toContain('ALTER TABLE canonical_practitioners ADD COLUMN source_evidence_sha256');
    expect(schema).toContain("version: integer('version')");
    expect(schema).toContain("sourceEvidenceSha256: text('source_evidence_sha256')");
  });

  it('backfills safe operational defaults for existing practitioners', () => {
    const db = createDatabaseWithExistingPractitioner();
    try {
      const row = db.prepare(`
        SELECT version,source_evidence_sha256
        FROM canonical_practitioners
        WHERE tenant_id='tenant-a' AND practitioner_public_id='prac_existing'
      `).get() as { version: number; source_evidence_sha256: string };
      expect(row).toEqual({ version: 1, source_evidence_sha256: zeroHash });

      const versionColumn = columns(db).find((column) => column.name === 'version');
      const evidenceColumn = columns(db).find((column) => column.name === 'source_evidence_sha256');
      expect(versionColumn).toMatchObject({ type: 'INTEGER', notnull: 1 });
      expect(evidenceColumn).toMatchObject({ type: 'TEXT', notnull: 1 });
    } finally {
      db.close();
    }
  });

  it('enforces positive versions and lowercase SHA-256 evidence', () => {
    const db = createDatabaseWithExistingPractitioner();
    try {
      expect(() => db.prepare(`
        UPDATE canonical_practitioners SET version=0
        WHERE tenant_id='tenant-a' AND practitioner_public_id='prac_existing'
      `).run()).toThrow(/CHECK constraint failed/);
      expect(() => db.prepare(`
        UPDATE canonical_practitioners SET source_evidence_sha256=?
        WHERE tenant_id='tenant-a' AND practitioner_public_id='prac_existing'
      `).run('A'.repeat(64))).toThrow(/CHECK constraint failed/);
      expect(() => db.prepare(`
        UPDATE canonical_practitioners SET source_evidence_sha256=?
        WHERE tenant_id='tenant-a' AND practitioner_public_id='prac_existing'
      `).run('g'.repeat(64))).toThrow(/CHECK constraint failed/);
      db.prepare(`
        UPDATE canonical_practitioners
        SET version=2,source_evidence_sha256=?
        WHERE tenant_id='tenant-a' AND practitioner_public_id='prac_existing'
      `).run('a'.repeat(64));
      expect(db.prepare(`
        SELECT version,source_evidence_sha256 FROM canonical_practitioners
        WHERE tenant_id='tenant-a' AND practitioner_public_id='prac_existing'
      `).get()).toEqual({ version: 2, source_evidence_sha256: 'a'.repeat(64) });
    } finally {
      db.close();
    }
  });

  it('does not copy authentication, contact, marketplace, fee, or scheduling facts', () => {
    const db = createDatabaseWithExistingPractitioner();
    try {
      const forbidden = new Set([
        'doctor_auth_id', 'password', 'password_hash', 'email', 'phone', 'mobile_number',
        'consultation_fee', 'ipd_round_fee', 'is_marketplace_visible', 'visiting_hours',
        'is_available', 'display_order', 'appointment_slot',
      ]);
      const names = columns(db).map((column) => column.name);
      expect(names.some((name) => forbidden.has(name))).toBe(false);
      expect(names).toContain('display_name');
      expect(names).toContain('practitioner_kind');
      expect(names).toContain('status');
      expect(names).toContain('version');
      expect(names).toContain('source_evidence_sha256');
    } finally {
      db.close();
    }
  });

  it('preserves canonical practitioner uniqueness and relationship constraints', () => {
    const db = createDatabaseWithExistingPractitioner();
    try {
      expect(() => db.prepare(`
        INSERT INTO canonical_practitioners (
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
          version,source_evidence_sha256
        ) VALUES ('tenant-a','prac_existing','internal','Duplicate','active',1,?)
      `).run('b'.repeat(64))).toThrow(/UNIQUE constraint failed/);

      db.prepare(`
        INSERT INTO canonical_practitioner_user_links (
          tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
        ) VALUES ('tenant-a','prac_existing',101,'active','approved_manual')
      `).run();
      expect(() => db.prepare(`
        INSERT INTO canonical_practitioner_user_links (
          tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
        ) VALUES ('tenant-a','prac_existing',102,'active','approved_manual')
      `).run()).toThrow(/UNIQUE constraint failed/);
    } finally {
      db.close();
    }
  });
});
