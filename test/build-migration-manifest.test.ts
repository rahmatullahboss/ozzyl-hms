import { describe, it, expect } from 'vitest';
import {
  buildMigrationEntry,
  buildCompressedMigrationManifest,
  classifyMigration,
  decodeCompressedMigrationManifest,
  toMigrationMetadata,
} from '../scripts/build-migration-manifest';

describe('classifyMigration', () => {
  it('classifies NNNN_*.sql as safe', () => {
    expect(classifyMigration('0334_add_appointments_table.sql')).toBe('safe');
  });

  it('classifies NNNNd_*.sql as destructive', () => {
    expect(classifyMigration('0334d_drop_legacy_column.sql')).toBe('destructive');
  });

  it('is case-insensitive on the d suffix', () => {
    expect(classifyMigration('0334D_rename_x.sql')).toBe('destructive');
  });

  it('rejects filenames that do not match the convention', () => {
    expect(() => classifyMigration('add_table.sql')).toThrow(/must match/);
    expect(() => classifyMigration('0334.sql')).toThrow(/must match/);
    expect(() => classifyMigration('abc1_add.sql')).toThrow(/must match/);
  });

  it('rejects historical b-suffix filenames like 0035b_*.sql', () => {
    expect(() => classifyMigration('0035b_billing_alter_columns.sql')).toThrow(/must match/);
    expect(() => classifyMigration('0157b_seed_procedure_billing_items.sql')).toThrow(/must match/);
  });
});

describe('buildMigrationEntry', () => {
  it('produces a manifest entry with order, safety, contentHash, sql, filename', () => {
    const entry = buildMigrationEntry('0334_add_table.sql', 'CREATE TABLE x (id INTEGER);');
    expect(entry.filename).toBe('0334_add_table.sql');
    expect(entry.order).toBe(334);
    expect(entry.safety).toBe('safe');
    expect(entry.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(entry.sql).toBe('CREATE TABLE x (id INTEGER);');
  });

  it('strips raw SQL from metadata that is bundled into the Worker', () => {
    const entry = buildMigrationEntry('0334_add_table.sql', 'CREATE TABLE x (id INTEGER);');
    const metadata = toMigrationMetadata(entry);

    expect(metadata).toEqual({
      filename: '0334_add_table.sql',
      order: 334,
      safety: 'safe',
      contentHash: entry.contentHash,
    });
    expect('sql' in metadata).toBe(false);
  });

  it('compresses full migration SQL into an external artifact', () => {
    const sql = Array.from({ length: 100 }, (_, index) => (
      `INSERT INTO example (id, name) VALUES (${index}, 'same repeated migration text');`
    )).join('\n');

    const entry = buildMigrationEntry('0335_seed_example.sql', sql);
    const compressed = buildCompressedMigrationManifest({
      version: 'test-version',
      checksum: 'sha256:test',
      migrations: [entry],
    });
    const decoded = decodeCompressedMigrationManifest(compressed);

    expect(compressed.byteLength).toBeLessThan(sql.length / 2);
    expect(decoded.version).toBe('test-version');
    expect(decoded.checksum).toBe('sha256:test');
    expect(decoded.migrations[0]?.sql).toBe(sql);
  });

  it('orders destructive variants as NNNN.1', () => {
    const entry = buildMigrationEntry('0334d_drop_x.sql', 'DROP TABLE x;');
    expect(entry.order).toBe(334.1);
    expect(entry.safety).toBe('destructive');
  });
});
