import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCloneImportBundle } from '../../scripts/canonical/build-clone-import';

function sqlite(args: string[]): string {
  const result = spawnSync('sqlite3', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout;
}

describe('CDB-011 ordered clone import bundle', () => {
  it('loads historical rows before triggers and waives only approved orphan constraints', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-011-bundle-'));
    const source = join(root, 'source.sqlite');
    const target = join(root, 'target.sqlite');
    const output = join(root, 'bundle.sql');

    sqlite([
      source,
      `PRAGMA foreign_keys=OFF;
       CREATE TABLE parents (id INTEGER PRIMARY KEY);
       CREATE TABLE children (
         id INTEGER PRIMARY KEY,
         parent_id INTEGER REFERENCES parents(id),
         value INTEGER NOT NULL
       );
       INSERT INTO children VALUES (1, 999, 90);
       CREATE UNIQUE INDEX idx_children_value ON children(value);
       CREATE TRIGGER reject_high_value
       BEFORE INSERT ON children
       WHEN NEW.value > 50
       BEGIN
         SELECT RAISE(ABORT, 'historical high value blocked');
       END;`,
    ]);

    const result = buildCloneImportBundle({
      sourceDatabase: source,
      output,
      waivers: [
        {
          table: 'children',
          column: 'parent_id',
          parentTable: 'parents',
          reason: 'fixture orphan',
        },
      ],
    });

    expect(result.tableCount).toBe(2);
    expect(result.indexCount).toBe(1);
    expect(result.triggerCount).toBe(1);
    const bundle = readFileSync(output, 'utf8');
    expect(bundle.indexOf('CREATE TABLE children')).toBeLessThan(
      bundle.indexOf('INSERT INTO children'),
    );
    expect(bundle.indexOf('INSERT INTO children')).toBeLessThan(
      bundle.indexOf('CREATE TRIGGER reject_high_value'),
    );
    expect(bundle).not.toContain('parent_id INTEGER REFERENCES parents(id)');

    sqlite([target, 'PRAGMA foreign_keys=ON;', `.read ${output}`]);
    expect(sqlite([target, 'SELECT COUNT(*) FROM children;']).trim()).toBe('1');
    expect(
      sqlite([
        target,
        "SELECT COUNT(*) FROM sqlite_schema WHERE type='trigger' AND name='reject_high_value';",
      ]).trim(),
    ).toBe('1');
    expect(sqlite([target, 'PRAGMA foreign_key_check;']).trim()).toBe('');
  });

  it('converts SQLite unistr dump literals into D1-compatible text literals', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-011-unistr-'));
    const source = join(root, 'source.sqlite');
    const target = join(root, 'target.sqlite');
    const output = join(root, 'bundle.sql');

    sqlite([
      source,
      `CREATE TABLE observations (id INTEGER PRIMARY KEY, payload TEXT);
       INSERT INTO observations VALUES (1, char(1) || 'safe' || char(10));`,
    ]);

    buildCloneImportBundle({ sourceDatabase: source, output, waivers: [] });
    const bundle = readFileSync(output, 'utf8');

    expect(bundle.toLowerCase()).not.toContain('unistr(');
    expect(bundle).toMatch(/CAST\(X'[0-9A-F]+' AS TEXT\)/i);
    sqlite([target, `.read ${output}`]);
    expect(
      sqlite([target, 'SELECT hex(payload) FROM observations WHERE id=1;']).trim(),
    ).toBe('01736166650A');
  });

  it('orders parent tables before children and waives cyclic/self-referential edges for chunked import', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-011-graph-'));
    const source = join(root, 'source.sqlite');
    const target = join(root, 'target.sqlite');
    const output = join(root, 'bundle.sql');

    sqlite([
      source,
      `PRAGMA foreign_keys=OFF;
       CREATE TABLE z_parents (id INTEGER PRIMARY KEY);
       CREATE TABLE a_children (
         id INTEGER PRIMARY KEY,
         parent_id INTEGER REFERENCES z_parents(id)
       );
       CREATE TABLE cycle_a (
         id INTEGER PRIMARY KEY,
         cycle_b_id INTEGER REFERENCES cycle_b(id)
       );
       CREATE TABLE cycle_b (
         id INTEGER PRIMARY KEY,
         cycle_a_id INTEGER REFERENCES cycle_a(id)
       );
       CREATE TABLE self_nodes (
         id INTEGER PRIMARY KEY,
         parent_id INTEGER REFERENCES self_nodes(id)
       );
       INSERT INTO z_parents VALUES (1);
       INSERT INTO a_children VALUES (1, 1);
       INSERT INTO cycle_a VALUES (1, 1);
       INSERT INTO cycle_b VALUES (1, 1);
       INSERT INTO self_nodes VALUES (2, 1);
       INSERT INTO self_nodes VALUES (1, NULL);`,
    ]);

    const result = buildCloneImportBundle({
      sourceDatabase: source,
      output,
      waivers: [],
    });
    const bundle = readFileSync(output, 'utf8');

    expect(result.graphWaiverCount).toBe(3);
    expect(bundle.indexOf('INSERT INTO z_parents')).toBeLessThan(
      bundle.indexOf('INSERT INTO a_children'),
    );
    expect(bundle).not.toContain('cycle_b_id INTEGER REFERENCES cycle_b(id)');
    expect(bundle).not.toContain('cycle_a_id INTEGER REFERENCES cycle_a(id)');
    expect(bundle).not.toContain('parent_id INTEGER REFERENCES self_nodes(id)');

    sqlite([target, 'PRAGMA foreign_keys=ON;', `.read ${output}`]);
    expect(sqlite([target, 'SELECT COUNT(*) FROM a_children;']).trim()).toBe('1');
    expect(sqlite([target, 'SELECT COUNT(*) FROM cycle_a;']).trim()).toBe('1');
    expect(sqlite([target, 'SELECT COUNT(*) FROM cycle_b;']).trim()).toBe('1');
    expect(sqlite([target, 'SELECT COUNT(*) FROM self_nodes;']).trim()).toBe('2');
  });
});
