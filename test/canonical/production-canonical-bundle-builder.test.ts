import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildProductionCanonicalBundle } from '../../scripts/canonical/build-production-canonical-bundle';
import { validateCanonicalImportBundleSql } from '../../scripts/canonical/production-cutover-contract';

const TABLES = ['canonical_alpha', 'canonical_beta'];

function fixture(): { root: string; database: string; sourceExport: string } {
  const root = mkdtempSync(join(tmpdir(), 'cdb101-bundle-'));
  chmodSync(root, 0o700);
  const database = join(root, 'source.sqlite');
  const sqlite = new DatabaseSync(database);
  sqlite.exec(`
    CREATE TABLE canonical_alpha (
      tenant_id TEXT NOT NULL,
      public_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      note TEXT,
      payload BLOB,
      PRIMARY KEY (tenant_id, public_id)
    );
    CREATE TABLE canonical_beta (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ratio REAL,
      nullable_value TEXT
    );
    INSERT INTO canonical_alpha VALUES
      ('100', 'alpha-2', 900719925474099, 'Dr. O''Brien (Lab, North)\nline two', X'00FF'),
      ('100', 'alpha-1', -5, 'comma, quote '' and )', NULL),
      ('101', 'other-tenant', 7, 'must not leak', X'AA');
    INSERT INTO canonical_beta VALUES
      (2, '100', 1.25, NULL),
      (1, '100', -0.5, 'ready'),
      (3, '101', 3.5, 'must not leak');
  `);
  sqlite.close();
  chmodSync(database, 0o600);
  const sourceExport = join(root, 'source-export.sql');
  writeFileSync(sourceExport, 'protected source export fixture\n', { mode: 0o600 });
  return { root, database, sourceExport };
}

function buildAt(root: string, database: string, sourceExport: string, name: string) {
  const outputDirectory = join(root, name);
  return buildProductionCanonicalBundle({
    sourceDatabase: database,
    sourceExportPath: sourceExport,
    outputDirectory,
    authorizationId: 'cdb101-night0-authorization-candidate',
    deterministicRunId: 'cdb101-tenant-100-deterministic-run',
    allowedTables: TABLES,
  });
}

describe('CDB-101 production canonical bundle builder', () => {
  it('builds deterministic tenant-100-only one-row DML with exact counts and safe literals', () => {
    const input = fixture();
    const first = buildAt(input.root, input.database, input.sourceExport, 'first');
    const second = buildAt(input.root, input.database, input.sourceExport, 'second');
    const firstSql = readFileSync(first.bundlePath, 'utf8');
    const secondSql = readFileSync(second.bundlePath, 'utf8');
    const firstManifest = JSON.parse(readFileSync(first.manifestPath, 'utf8'));
    const secondManifest = JSON.parse(readFileSync(second.manifestPath, 'utf8'));

    expect(firstSql).toBe(secondSql);
    expect(firstManifest).toEqual(secondManifest);
    expect(firstSql).toContain("Dr. O''Brien (Lab, North)");
    expect(firstSql).toContain("X'00FF'");
    expect(firstSql).not.toContain('other-tenant');
    expect(firstSql).not.toContain('must not leak');
    expect(firstSql.indexOf('alpha-1')).toBeLessThan(firstSql.indexOf('alpha-2'));
    expect(firstSql.indexOf('canonical_alpha')).toBeLessThan(firstSql.indexOf('canonical_beta'));
    expect(firstManifest.rowCountSummary).toEqual({ canonical_alpha: 2, canonical_beta: 2 });
    expect(firstManifest.allowedTables).toEqual(TABLES);
    expect(firstManifest.tenantIds).toEqual(['100']);
    expect(firstManifest.secondPassRequired).toBe(true);
    expect(validateCanonicalImportBundleSql(firstSql, TABLES)).toMatchObject({
      valid: true,
      statementCount: 4,
      referencedTables: TABLES,
    });
    expect(statSync(first.bundlePath).mode & 0o777).toBe(0o600);
    expect(statSync(first.manifestPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(input.root, 'first')).mode & 0o777).toBe(0o700);
  });

  it('emits guarded updates for changed existing rows and inserts only missing rows', () => {
    const input = fixture();
    const baseline = join(input.root, 'baseline.sqlite');
    copyFileSync(input.database, baseline);
    chmodSync(baseline, 0o600);

    const target = new DatabaseSync(input.database);
    target.exec(`
      UPDATE canonical_alpha
      SET amount_minor=25,note='repaired'
      WHERE tenant_id='100' AND public_id='alpha-1';
      INSERT INTO canonical_alpha VALUES ('100','alpha-3',75,'new row',NULL);
    `);
    target.close();

    const built = buildProductionCanonicalBundle({
      sourceDatabase: input.database,
      baselineDatabase: baseline,
      sourceExportPath: input.sourceExport,
      outputDirectory: join(input.root, 'delta'),
      authorizationId: 'cdb101-night0-authorization-candidate',
      deterministicRunId: 'cdb101-tenant-100-deterministic-run',
      allowedTables: TABLES,
    });
    const sql = readFileSync(built.bundlePath, 'utf8');

    expect(sql).toContain('UPDATE "canonical_alpha" SET');
    expect(sql).toContain('"amount_minor"=25');
    expect(sql).toContain("tenant_id = '100'");
    expect(sql).toContain("\"public_id\"='alpha-1'");
    expect(sql).toContain('"amount_minor"=-5');
    expect(sql).toContain("INSERT OR IGNORE INTO \"canonical_alpha\"");
    expect(sql).toContain("'alpha-3'");
    expect(sql).not.toContain("'alpha-2', 900719925474099");
    expect(built.rowCount).toBe(5);
    expect(built.statementCount).toBe(2);
    expect(JSON.parse(readFileSync(built.manifestPath, 'utf8')).rowCountSummary)
      .toEqual({ canonical_alpha: 3, canonical_beta: 2 });

    const replay = new DatabaseSync(baseline);
    replay.exec(sql);
    expect(replay.prepare("SELECT amount_minor,note FROM canonical_alpha WHERE tenant_id='100' AND public_id='alpha-1'").get())
      .toEqual({ amount_minor: 25, note: 'repaired' });
    expect(replay.prepare("SELECT COUNT(*) AS count FROM canonical_alpha WHERE tenant_id='100' AND public_id='alpha-3'").get())
      .toEqual({ count: 1 });
    const before = replay.prepare('SELECT total_changes() AS changes').get() as { changes: number };
    replay.exec(sql);
    const after = replay.prepare('SELECT total_changes() AS changes').get() as { changes: number };
    expect(after.changes - before.changes).toBe(0);
    replay.close();
  });

  it('rehearses first-pass counts and a zero-write second pass', () => {
    const input = fixture();
    const built = buildAt(input.root, input.database, input.sourceExport, 'rehearsal');
    const sql = readFileSync(built.bundlePath, 'utf8');
    const target = new DatabaseSync(':memory:');
    target.exec(`
      CREATE TABLE canonical_alpha (
        tenant_id TEXT NOT NULL,
        public_id TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        note TEXT,
        payload BLOB,
        PRIMARY KEY (tenant_id, public_id)
      );
      CREATE TABLE canonical_beta (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        ratio REAL,
        nullable_value TEXT
      );
    `);
    target.exec(sql);
    expect(target.prepare("SELECT COUNT(*) AS count FROM canonical_alpha WHERE tenant_id='100'").get()).toEqual({ count: 2 });
    expect(target.prepare("SELECT COUNT(*) AS count FROM canonical_beta WHERE tenant_id='100'").get()).toEqual({ count: 2 });
    const before = target.prepare('SELECT total_changes() AS changes').get() as { changes: number };
    target.exec(sql);
    const after = target.prepare('SELECT total_changes() AS changes').get() as { changes: number };
    expect(after.changes - before.changes).toBe(0);
    target.close();
  });

  it('refuses overwrite, repository outputs, missing tenant columns, and execution arguments', () => {
    const input = fixture();
    const built = buildAt(input.root, input.database, input.sourceExport, 'protected');
    expect(() => buildProductionCanonicalBundle({
      sourceDatabase: input.database,
      sourceExportPath: input.sourceExport,
      outputDirectory: join(input.root, 'protected'),
      authorizationId: 'cdb101-night0-authorization-candidate',
      deterministicRunId: 'cdb101-tenant-100-deterministic-run',
      allowedTables: TABLES,
    })).toThrow(/overwrite|empty/i);
    expect(built.aggregateOnly).toBe(true);
    expect(JSON.stringify(built)).not.toContain(input.root);

    const badDb = join(input.root, 'bad.sqlite');
    const bad = new DatabaseSync(badDb);
    bad.exec('CREATE TABLE canonical_alpha(public_id TEXT PRIMARY KEY);');
    bad.close();
    chmodSync(badDb, 0o600);
    mkdirSync(join(input.root, 'bad-output'), { mode: 0o700 });
    expect(() => buildProductionCanonicalBundle({
      sourceDatabase: badDb,
      sourceExportPath: input.sourceExport,
      outputDirectory: join(input.root, 'bad-output'),
      authorizationId: 'cdb101-night0-authorization-candidate',
      deterministicRunId: 'cdb101-tenant-100-deterministic-run',
      allowedTables: ['canonical_alpha'],
    })).toThrow(/tenant_id/i);
  });
});
