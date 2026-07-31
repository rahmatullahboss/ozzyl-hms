import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', ['--', dbPath, sql], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function readRows<T>(dbPath: string, sql: string): T[] {
  const output = execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' }).trim();
  return output ? JSON.parse(output) as T[] : [];
}

describe('refund reserve custody migration', () => {
  it('adds custody lifecycle fields and prevents duplicate drawer release credits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'refund-reserve-custody-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE billing_counter_sessions (
          id INTEGER PRIMARY KEY,
          tenant_id TEXT NOT NULL
        );
        CREATE TABLE billing_refund_cash_holds (
          id INTEGER PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          amount REAL NOT NULL,
          status TEXT NOT NULL,
          released_at TEXT
        );
        CREATE TABLE cash_drawer_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL,
          movement_type TEXT NOT NULL,
          reference_type TEXT,
          reference_id INTEGER
        );
        INSERT INTO billing_refund_cash_holds VALUES (1, 'tenant-1', 350, 'held', NULL);
      `);

      runSql(dbPath, readFileSync(join(process.cwd(), 'migrations/0518_refund_reserve_custody_release.sql'), 'utf8'));

      expect(readRows<{ name: string }>(dbPath, 'PRAGMA table_info(billing_counter_sessions)')
        .map((column) => column.name))
        .toEqual(expect.arrayContaining([
          'refund_reserve_at_close',
          'available_cash_at_close',
          'total_physical_cash_at_close',
        ]));
      expect(readRows<{ name: string }>(dbPath, 'PRAGMA table_info(billing_refund_cash_holds)')
        .map((column) => column.name))
        .toEqual(expect.arrayContaining([
          'custody_user_id',
          'release_status',
          'release_counter_session_id',
          'release_cash_movement_id',
          'release_credited_at',
        ]));
      expect(readRows<{ release_status: string }>(dbPath, 'SELECT release_status FROM billing_refund_cash_holds WHERE id = 1'))
        .toEqual([{ release_status: 'not_applicable' }]);

      runSql(dbPath, `
        INSERT INTO cash_drawer_movements (tenant_id, movement_type, reference_type, reference_id)
        VALUES ('tenant-1', 'cash_in', 'refund_reserve_release', 1);
      `);
      expect(() => runSql(dbPath, `
        INSERT INTO cash_drawer_movements (tenant_id, movement_type, reference_type, reference_id)
        VALUES ('tenant-1', 'cash_in', 'refund_reserve_release', 1);
      `)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
