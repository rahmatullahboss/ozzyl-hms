import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0544_canonical_tenant_patient_links.sql';
const schemaPath = 'src/db/schema/canonical/patient-identity.ts';
const barrelPath = 'src/db/schema/canonical/index.ts';

function tableSql(db: DatabaseSync, table: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table) as
    | { sql?: string }
    | undefined;
  return String(row?.sql ?? '').replace(/\s+/g, ' ');
}

function uniqueIndexColumns(db: DatabaseSync, table: string): string[][] {
  return (db.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all() as Array<{ name: string; unique: number }>)
    .filter((entry) => Number(entry.unique) === 1)
    .map((entry) =>
      (db.prepare(`PRAGMA index_info(${JSON.stringify(entry.name)})`).all() as Array<{ name: string; seqno: number }>)
        .sort((a, b) => Number(a.seqno) - Number(b.seqno))
        .map((column) => String(column.name)),
    );
}

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  db.exec(readFileSync(migrationPath, 'utf8'));
  return db;
}

describe('canonical tenant patient link foundation schema', () => {
  it('reserves the additive migration, Drizzle schema, and barrel export', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(schemaPath)).toBe(true);
    expect(existsSync(barrelPath)).toBe(true);
    if (!existsSync(schemaPath) || !existsSync(barrelPath)) return;

    const schema = readFileSync(schemaPath, 'utf8');
    const barrel = readFileSync(barrelPath, 'utf8');
    expect(schema).toContain("'canonical_tenant_patient_links'");
    expect(schema).toContain("'canonical_tenant_patient_link_events'");
    expect(barrel).toContain("export * from './patient-identity';");
  });

  it('creates both tenant-owned tables idempotently without copying demographics', () => {
    const db = createDatabase();
    try {
      db.exec(readFileSync(migrationPath, 'utf8'));
      const tables = (db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name LIKE 'canonical_tenant_patient_link%'
        ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);
      expect(tables).toEqual([
        'canonical_tenant_patient_link_events',
        'canonical_tenant_patient_links',
      ]);

      const forbidden = new Set([
        'name', 'full_name', 'phone', 'mobile', 'email', 'address', 'date_of_birth',
        'dob', 'gender', 'sex', 'national_id', 'nid', 'guardian_name',
      ]);
      for (const table of tables) {
        const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{
          name: string;
          type: string;
          notnull: number;
        }>;
        expect(columns.find((column) => column.name === 'tenant_id')).toMatchObject({
          type: 'TEXT',
          notnull: 1,
        });
        expect(columns.some((column) => forbidden.has(column.name))).toBe(false);
        expect(columns.some((column) => column.type.toUpperCase() === 'REAL')).toBe(false);
      }
    } finally {
      db.close();
    }
  });

  it('enforces link status, exact verified evidence, versions, and event lifecycle', () => {
    const db = createDatabase();
    try {
      const linksSql = tableSql(db, 'canonical_tenant_patient_links');
      const eventsSql = tableSql(db, 'canonical_tenant_patient_link_events');
      expect(linksSql).toContain("link_status IN ('unlinked', 'candidate', 'verified', 'rejected', 'merged', 'retired')");
      expect(linksSql).toContain("verification_level IN ('unverified', 'candidate', 'reviewed', 'verified')");
      expect(linksSql).toContain('length(evidence_sha256) = 64');
      expect(linksSql).toContain('version > 0');
      expect(linksSql).toContain('canonical_tenant_patient_links_verified_evidence_check');
      expect(linksSql).toContain("link_status != 'verified'");
      expect(linksSql).toContain("evidence_type IN ('unique_uhid', 'authenticated_claim', 'verified_national_identity', 'reviewed_manual')");
      expect(eventsSql).toContain('canonical_tenant_patient_link_events_type_check');
      expect(eventsSql).toContain('event_type IN (');
      for (const eventType of [
        'registered', 'candidate_detected', 'verified_linked', 'link_rejected',
        'unlinked', 'merged', 'unmerged', 'retired',
      ]) expect(eventsSql).toContain(`'${eventType}'`);
      expect(eventsSql).toContain('sequence > 0');
      expect(eventsSql).toContain('length(evidence_sha256) = 64');

      expect(uniqueIndexColumns(db, 'canonical_tenant_patient_links')).toContainEqual([
        'tenant_id',
        'patient_link_public_id',
      ]);
      expect(uniqueIndexColumns(db, 'canonical_tenant_patient_links')).toContainEqual([
        'tenant_id',
        'legacy_patient_id',
      ]);
      expect(uniqueIndexColumns(db, 'canonical_tenant_patient_link_events')).toContainEqual([
        'tenant_id',
        'patient_link_public_id',
        'sequence',
      ]);
      expect(uniqueIndexColumns(db, 'canonical_tenant_patient_link_events')).toContainEqual([
        'tenant_id',
        'idempotency_key',
      ]);
    } finally {
      db.close();
    }
  });

  it('rejects verified links without exact global identity evidence and duplicate active identities', () => {
    const db = createDatabase();
    try {
      const insert = db.prepare(`
        INSERT INTO canonical_tenant_patient_links (
          tenant_id,patient_link_public_id,legacy_patient_id,global_patient_uhid,
          link_status,verification_level,evidence_type,evidence_sha256,effective_from_utc,version
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
      `);

      expect(() => insert.run(
        'tenant-a', 'ptl_1', 1, null, 'verified', 'verified', 'unique_uhid', 'a'.repeat(64),
        '2026-07-26T00:00:00.000Z', 1,
      )).toThrow(/CHECK constraint failed/);
      expect(() => insert.run(
        'tenant-a', 'ptl_2', 2, 'UHID-2', 'verified', 'verified', 'phone_match', 'b'.repeat(64),
        '2026-07-26T00:00:00.000Z', 1,
      )).toThrow(/CHECK constraint failed/);

      insert.run(
        'tenant-a', 'ptl_3', 3, 'UHID-3', 'verified', 'verified', 'unique_uhid', 'c'.repeat(64),
        '2026-07-26T00:00:00.000Z', 1,
      );
      expect(() => insert.run(
        'tenant-a', 'ptl_4', 4, 'UHID-3', 'verified', 'verified', 'unique_uhid', 'd'.repeat(64),
        '2026-07-26T00:00:00.000Z', 1,
      )).toThrow(/UNIQUE constraint failed/);
      expect(() => insert.run(
        'tenant-a', 'ptl_5', 3, null, 'unlinked', 'unverified', 'no_link_placeholder', 'e'.repeat(64),
        '2026-07-26T00:00:00.000Z', 1,
      )).toThrow(/UNIQUE constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces tenant-scoped event foreign keys, sequence, and merge evidence', () => {
    const db = createDatabase();
    try {
      db.prepare(`
        INSERT INTO canonical_tenant_patient_links (
          tenant_id,patient_link_public_id,legacy_patient_id,link_status,
          verification_level,evidence_type,evidence_sha256,effective_from_utc,version
        ) VALUES ('tenant-a','ptl_1',1,'unlinked','unverified','no_link_placeholder',?, ?,1)
      `).run('a'.repeat(64), '2026-07-26T00:00:00.000Z');

      const event = db.prepare(`
        INSERT INTO canonical_tenant_patient_link_events (
          tenant_id,event_public_id,patient_link_public_id,legacy_patient_id,event_type,
          from_status,to_status,actor_system_key,reason_code,evidence_type,evidence_sha256,
          idempotency_key,sequence,occurred_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      event.run(
        'tenant-a', 'evt_1', 'ptl_1', 1, 'registered', null, 'unlinked', 'migration',
        'initial_registration', 'no_link_placeholder', 'a'.repeat(64), 'idem-1', 1,
        '2026-07-26T00:00:00.000Z',
      );
      expect(() => event.run(
        'tenant-b', 'evt_2', 'ptl_1', 1, 'registered', null, 'unlinked', 'migration',
        'initial_registration', 'no_link_placeholder', 'b'.repeat(64), 'idem-2', 1,
        '2026-07-26T00:00:00.000Z',
      )).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => event.run(
        'tenant-a', 'evt_3', 'ptl_1', 1, 'merged', 'unlinked', 'merged', 'reviewer',
        'duplicate_merge', 'reviewed_manual', 'c'.repeat(64), 'idem-3', 2,
        '2026-07-26T00:01:00.000Z',
      )).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });
});
