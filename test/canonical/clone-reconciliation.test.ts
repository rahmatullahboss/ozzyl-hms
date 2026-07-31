import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileSqlExports } from '../../scripts/canonical/reconcile-clone-exports';

function writeSql(root: string, name: string, sql: string): string {
  const path = join(root, name);
  writeFileSync(path, sql, 'utf8');
  return path;
}

const BASE_SCHEMA = `
CREATE TABLE patients (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE bills (id INTEGER PRIMARY KEY, total INTEGER);
`;

describe('CDB-011 clone export reconciliation', () => {
  it('reports an exact table and aggregate row-count match without row contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-011-reconcile-match-'));
    const source = writeSql(
      root,
      'source.sql',
      `${BASE_SCHEMA}
INSERT INTO patients VALUES (1, 'Sensitive One'), (2, 'Sensitive Two');
INSERT INTO bills VALUES (1, 5000);
`,
    );
    const clone = writeSql(
      root,
      'clone.sql',
      `${BASE_SCHEMA}
INSERT INTO patients VALUES (1, 'Changed Display'), (2, 'Other Display');
INSERT INTO bills VALUES (1, 5000);
`,
    );
    const output = join(root, 'report.json');

    const report = reconcileSqlExports({ source, clone, output });

    expect(report.exactMatch).toBe(true);
    expect(report.source.tableCount).toBe(2);
    expect(report.source.totalRowCount).toBe(3);
    expect(report.clone.totalRowCount).toBe(3);
    expect(report.missingFromClone).toEqual([]);
    expect(report.extraInClone).toEqual([]);
    expect(report.rowCountMismatches).toEqual([]);
    const persisted = readFileSync(output, 'utf8');
    expect(persisted).not.toContain('Sensitive One');
    expect(persisted).not.toContain('Changed Display');
  });

  it('reports missing tables and row-count differences deterministically', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-011-reconcile-mismatch-'));
    const source = writeSql(
      root,
      'source.sql',
      `${BASE_SCHEMA}
INSERT INTO patients VALUES (1, 'A'), (2, 'B');
INSERT INTO bills VALUES (1, 5000);
`,
    );
    const clone = writeSql(
      root,
      'clone.sql',
      `CREATE TABLE patients (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE clone_only (id INTEGER PRIMARY KEY);
INSERT INTO patients VALUES (1, 'A');
`,
    );
    const output = join(root, 'report.json');

    const report = reconcileSqlExports({ source, clone, output });

    expect(report.exactMatch).toBe(false);
    expect(report.missingFromClone).toEqual(['bills']);
    expect(report.extraInClone).toEqual(['clone_only']);
    expect(report.rowCountMismatches).toEqual([
      { table: 'patients', sourceRows: 2, cloneRows: 1 },
    ]);
  });
});
