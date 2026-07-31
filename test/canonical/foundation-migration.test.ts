import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0505_canonical_program_foundation.sql';
const schemaPath = 'src/db/schema/canonical/meta.ts';
const canonicalBarrelPath = 'src/db/schema/canonical/index.ts';
const schemaBarrelPath = 'src/db/schema/index.ts';

const expectedTables = [
  'canonical_backfill_checkpoints',
  'canonical_feature_flags',
  'canonical_migration_runs',
  'canonical_outbox_events',
  'canonical_processing_issues',
  'canonical_reconciliation_runs',
  'canonical_schema_versions',
  'canonical_source_mappings',
] as const;

function normalizedTableSql(db: DatabaseSync, tableName: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(tableName) as
    | { sql?: string }
    | undefined;
  return String(row?.sql ?? '').replace(/\s+/g, ' ');
}

function uniqueIndexColumns(db: DatabaseSync, tableName: string): string[][] {
  const indexes = db.prepare(`PRAGMA index_list(${JSON.stringify(tableName)})`).all() as Array<{
    name: string;
    unique: number;
  }>;

  return indexes
    .filter((index) => Number(index.unique) === 1)
    .map((index) =>
      (db.prepare(`PRAGMA index_info(${JSON.stringify(index.name)})`).all() as Array<{ name: string; seqno: number }>)
        .sort((a, b) => Number(a.seqno) - Number(b.seqno))
        .map((column) => String(column.name)),
    );
}

function indexNames(db: DatabaseSync, tableName: string): string[] {
  return (db.prepare(`PRAGMA index_list(${JSON.stringify(tableName)})`).all() as Array<{ name: string }>)
    .map((index) => String(index.name))
    .sort();
}

describe('canonical program foundation migration', () => {
  it('reserves the additive D1 foundation files and schema exports', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(schemaPath)).toBe(true);
    expect(existsSync(canonicalBarrelPath)).toBe(true);

    if (!existsSync(schemaPath) || !existsSync(canonicalBarrelPath)) return;

    const canonicalSchema = readFileSync(schemaPath, 'utf8');
    const canonicalBarrel = readFileSync(canonicalBarrelPath, 'utf8');
    const schemaBarrel = readFileSync(schemaBarrelPath, 'utf8');

    for (const tableName of expectedTables) {
      expect(canonicalSchema).toContain(`'${tableName}'`);
    }
    expect(canonicalBarrel).toContain("export * from './meta';");
    expect(schemaBarrel).toContain("export * from './canonical';");
  });

  it('creates all eight tables idempotently with text tenant ownership and UTC audit timestamps', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, 'utf8');
    const db = new DatabaseSync(':memory:');

    try {
      db.exec(migration);
      db.exec(migration);

      const tableNames = (db
        .prepare(
          `SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'canonical_%' ORDER BY name`,
        )
        .all() as Array<{ name: string }>).map((row) => row.name);
      expect(tableNames).toEqual(expectedTables);

      for (const tableName of expectedTables) {
        const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(tableName)})`).all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
        }>;
        const byName = new Map(columns.map((column) => [column.name, column]));

        expect(byName.get('tenant_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
        expect(byName.get('created_at_utc')).toMatchObject({ type: 'TEXT', notnull: 1 });
        expect(byName.get('updated_at_utc')).toMatchObject({ type: 'TEXT', notnull: 1 });
        expect(String(byName.get('created_at_utc')?.dflt_value)).toContain("strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        expect(String(byName.get('updated_at_utc')?.dflt_value)).toContain("strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        expect(columns.some((column) => String(column.type).toUpperCase() === 'REAL')).toBe(false);
      }
    } finally {
      db.close();
    }
  });

  it('enforces lifecycle checks and the required source, idempotency, and feature-flag uniqueness', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const db = new DatabaseSync(':memory:');
    try {
      db.exec(readFileSync(migrationPath, 'utf8'));

      expect(normalizedTableSql(db, 'canonical_schema_versions')).toContain(
        "state IN ('registered', 'shadow', 'active', 'retired')",
      );
      expect(normalizedTableSql(db, 'canonical_migration_runs')).toContain(
        "status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')",
      );
      expect(normalizedTableSql(db, 'canonical_backfill_checkpoints')).toContain(
        "status IN ('pending', 'running', 'paused', 'completed', 'failed')",
      );
      expect(normalizedTableSql(db, 'canonical_source_mappings')).toContain(
        "mapping_status IN ('mapped', 'ambiguous', 'rejected', 'retired')",
      );
      expect(normalizedTableSql(db, 'canonical_outbox_events')).toContain(
        "status IN ('pending', 'processing', 'published', 'retry', 'dead_letter', 'cancelled')",
      );
      expect(normalizedTableSql(db, 'canonical_processing_issues')).toContain(
        "status IN ('open', 'acknowledged', 'resolved', 'waived')",
      );
      expect(normalizedTableSql(db, 'canonical_reconciliation_runs')).toContain(
        "status IN ('pending', 'running', 'passed', 'failed', 'accepted_with_exceptions')",
      );
      expect(normalizedTableSql(db, 'canonical_feature_flags')).toContain(
        "mode IN ('legacy', 'shadow', 'canonical', 'disabled')",
      );

      expect(uniqueIndexColumns(db, 'canonical_source_mappings')).toContainEqual([
        'tenant_id',
        'entity_type',
        'source_type',
        'source_public_id',
      ]);
      expect(uniqueIndexColumns(db, 'canonical_outbox_events')).toContainEqual(['tenant_id', 'idempotency_key']);
      expect(uniqueIndexColumns(db, 'canonical_feature_flags')).toContainEqual(['tenant_id', 'flag_key']);

      expect(indexNames(db, 'canonical_schema_versions')).toContain('uq_canonical_schema_versions_active');
      expect(indexNames(db, 'canonical_source_mappings')).toContain('uq_canonical_source_mapping_source');
      expect(indexNames(db, 'canonical_outbox_events')).toContain('uq_canonical_outbox_idempotency');
      expect(indexNames(db, 'canonical_feature_flags')).toContain('uq_canonical_feature_flags_key');
    } finally {
      db.close();
    }
  });

  it('enforces tenant-scoped audit references and prevents deleting a migration run with checkpoints', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(readFileSync(migrationPath, 'utf8'));
      db.prepare(`
        INSERT INTO canonical_migration_runs (
          tenant_id, run_public_id, migration_name, migration_kind
        ) VALUES (?, ?, ?, ?)
      `).run('tenant-a', 'run-a', '0423', 'schema');

      expect(() =>
        db.prepare(`
          INSERT INTO canonical_backfill_checkpoints (
            tenant_id, checkpoint_public_id, migration_run_id, entity_type, source_type
          ) VALUES (?, ?, ?, ?, ?)
        `).run('tenant-b', 'checkpoint-cross-tenant', 1, 'patient', 'patients'),
      ).toThrow(/FOREIGN KEY constraint failed/);

      db.prepare(`
        INSERT INTO canonical_backfill_checkpoints (
          tenant_id, checkpoint_public_id, migration_run_id, entity_type, source_type
        ) VALUES (?, ?, ?, ?, ?)
      `).run('tenant-a', 'checkpoint-a', 1, 'patient', 'patients');

      expect(() => db.prepare('DELETE FROM canonical_migration_runs WHERE id = 1').run()).toThrow(
        /FOREIGN KEY constraint failed/,
      );
    } finally {
      db.close();
    }
  });

  it('never requires or accepts a guessed canonical ID for ambiguous source mappings', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(readFileSync(migrationPath, 'utf8'));

      db.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id, entity_type, canonical_public_id, source_type, source_public_id,
          source_table, mapping_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('tenant-a', 'practitioner', null, 'legacy_doctor', '17', 'doctors', 'ambiguous');

      expect(() =>
        db.prepare(`
          INSERT INTO canonical_source_mappings (
            tenant_id, entity_type, canonical_public_id, source_type, source_public_id,
            source_table, mapping_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('tenant-a', 'practitioner', null, 'legacy_doctor', '18', 'doctors', 'mapped'),
      ).toThrow(/CHECK constraint failed/);

      expect(() =>
        db.prepare(`
          INSERT INTO canonical_source_mappings (
            tenant_id, entity_type, canonical_public_id, source_type, source_public_id,
            source_table, mapping_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('tenant-a', 'practitioner', 'practitioner-guessed', 'legacy_doctor', '19', 'doctors', 'ambiguous'),
      ).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces one active schema version and terminal lifecycle evidence', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(readFileSync(migrationPath, 'utf8'));

      const insertVersion = db.prepare(`
        INSERT INTO canonical_schema_versions (
          tenant_id, domain, schema_version, migration_name, migration_checksum, state
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      insertVersion.run('tenant-a', 'billing', 1, '0423', 'sha-1', 'active');
      expect(() => insertVersion.run('tenant-a', 'billing', 2, '0424', 'sha-2', 'active')).toThrow(
        /UNIQUE constraint failed/,
      );
      insertVersion.run('tenant-a', 'billing', 3, '0425', 'sha-3', 'shadow');

      expect(() =>
        db.prepare(`
          INSERT INTO canonical_migration_runs (
            tenant_id, run_public_id, migration_name, migration_kind, status
          ) VALUES (?, ?, ?, ?, ?)
        `).run('tenant-a', 'run-terminal-without-time', '0423', 'schema', 'succeeded'),
      ).toThrow(/CHECK constraint failed/);

      expect(() =>
        db.prepare(`
          INSERT INTO canonical_outbox_events (
            tenant_id, event_public_id, aggregate_type, aggregate_public_id, event_type,
            payload_json, occurred_at_utc, idempotency_key, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'tenant-a',
          'event-1',
          'invoice',
          'invoice-1',
          'invoice.issued',
          '{}',
          '2026-07-13T16:00:00.000Z',
          'invoice-1-issued',
          'published',
        ),
      ).toThrow(/CHECK constraint failed/);

      expect(() =>
        db.prepare(`
          INSERT INTO canonical_feature_flags (
            tenant_id, flag_key, domain, mode, is_enabled
          ) VALUES (?, ?, ?, ?, ?)
        `).run('tenant-a', 'billing-v2', 'billing', 'disabled', 1),
      ).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });
});
