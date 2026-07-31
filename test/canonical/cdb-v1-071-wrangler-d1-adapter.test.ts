import { describe, expect, test } from 'vitest';
import {
  createCdbV1071WranglerD1Database,
  renderCdbV1071BoundSql,
  toCdbV1071SqlLiteral,
  type CdbV1071WranglerRunner,
} from '../../scripts/canonical/cdb-v1-071-wrangler-d1-adapter';

describe('CDB-V1-071 Wrangler D1 adapter', () => {
  test('renders supported bound values without changing quoted question marks', () => {
    expect(renderCdbV1071BoundSql(
      "SELECT '?' AS literal, ? AS text, ? AS amount, ? AS empty_value, ? AS enabled",
      ["O'Brien", 42, null, true],
    )).toBe("SELECT '?' AS literal, 'O''Brien' AS text, 42 AS amount, NULL AS empty_value, 1 AS enabled");
  });

  test('rejects unsupported SQL values and placeholder drift', () => {
    expect(() => toCdbV1071SqlLiteral({})).toThrow('Unsupported SQL binding value');
    expect(() => renderCdbV1071BoundSql('SELECT ?', [])).toThrow('SQL placeholder count does not match');
    expect(() => renderCdbV1071BoundSql('SELECT 1', [1])).toThrow('SQL placeholder count does not match');
  });

  test('executes read statements and enforces read-only metadata', async () => {
    const calls: string[][] = [];
    const runner: CdbV1071WranglerRunner = (args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify([{ success: true, results: [{ value: 7 }], meta: { changed_db: false, rows_written: 0 } }]),
        stderr: '',
      };
    };
    const db = createCdbV1071WranglerD1Database(runner);
    const row = await db.prepare('SELECT ? AS value').bind(7).first<{ value: number }>();
    expect(row).toEqual({ value: 7 });
    expect(calls[0]).toContain('SELECT 7 AS value');
    expect(calls[0]).not.toContain('--yes');
  });

  test('rejects a read response that reports database mutation', async () => {
    const runner: CdbV1071WranglerRunner = () => ({
      status: 0,
      stdout: JSON.stringify([{ success: true, results: [], meta: { changed_db: true, rows_written: 1 } }]),
      stderr: '',
    });
    const db = createCdbV1071WranglerD1Database(runner);
    await expect(db.prepare('SELECT 1').all()).rejects.toThrow('Read-only D1 command reported mutation');
  });

  test('executes write statements and batches with explicit confirmation', async () => {
    const calls: string[][] = [];
    const runner: CdbV1071WranglerRunner = (args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify([{ success: true, results: [], meta: { changed_db: true, changes: 2, rows_written: 2 } }]),
        stderr: '',
      };
    };
    const db = createCdbV1071WranglerD1Database(runner);
    const run = await db.prepare('INSERT INTO x(value) VALUES (?)').bind('a').run();
    expect(run.meta?.changes).toBe(2);
    await db.batch([
      db.prepare('INSERT INTO x(value) VALUES (?)').bind('b'),
      db.prepare('INSERT INTO x(value) VALUES (?)').bind('c'),
    ]);
    expect(calls[0]).toContain('--yes');
    expect(calls[1]).toContain('--yes');
    expect(calls[1].find((value) => value.includes("VALUES ('b')"))).toContain("VALUES ('c')");
  });

  test('fails closed when Wrangler exits non-zero or returns unsuccessful envelopes', async () => {
    const failed: CdbV1071WranglerRunner = () => ({ status: 1, stdout: '', stderr: 'failed' });
    await expect(createCdbV1071WranglerD1Database(failed).prepare('SELECT 1').all()).rejects.toThrow('failed');

    const unsuccessful: CdbV1071WranglerRunner = () => ({
      status: 0,
      stdout: JSON.stringify([{ success: false, results: [], meta: { changed_db: false, rows_written: 0 } }]),
      stderr: '',
    });
    await expect(createCdbV1071WranglerD1Database(unsuccessful).prepare('SELECT 1').all()).rejects.toThrow('unsuccessful envelope');
  });
});
