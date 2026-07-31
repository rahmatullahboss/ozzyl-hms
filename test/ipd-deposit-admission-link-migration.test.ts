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

describe('IPD deposit admission linkage migration', () => {
  it('links exact, IPD-labelled, and in-admission unlabelled deposits without linking pre-admission reservations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ipd-deposit-admission-link-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE admissions (
          id INTEGER PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          patient_id INTEGER NOT NULL,
          admission_no TEXT NOT NULL,
          admission_date TEXT NOT NULL,
          discharge_date TEXT
        );
        CREATE TABLE billing_deposits (
          id INTEGER PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          patient_id INTEGER NOT NULL,
          deposit_receipt_no TEXT NOT NULL,
          amount REAL NOT NULL,
          transaction_type TEXT NOT NULL,
          remarks TEXT,
          created_at TEXT NOT NULL
        );

        INSERT INTO admissions VALUES
          (101, 'tenant-1', 10, 'ADM-101', '2026-07-18 11:07:23', NULL),
          (102, 'tenant-1', 20, 'ADM-102', '2026-07-10 08:00:00', '2026-07-12 15:00:00');

        INSERT INTO billing_deposits VALUES
          (1, 'tenant-1', 10, 'DEP-1', 1000, 'deposit', 'Admission deposit for ADM-101', '2026-07-18 11:07:23'),
          (2, 'tenant-1', 10, 'DEP-2', 2000, 'deposit', 'IPD deposit from provisional billing', '2026-07-19 09:00:00'),
          (3, 'tenant-1', 10, 'DEP-3', 3000, 'deposit', NULL, '2026-07-18 05:00:45'),
          (4, 'tenant-1', 20, 'DEP-4', 4000, 'deposit', NULL, '2026-07-11 12:00:00'),
          (5, 'tenant-1', 10, 'DEP-5', 5000, 'deposit', 'Deposit for bed reservation', '2026-07-17 09:00:00'),
          (6, 'tenant-1', 10, 'DAD-1', 500, 'adjustment', 'IPD adjustment', '2026-07-19 10:00:00');
      `);

      const migration = readFileSync(join(process.cwd(), 'migrations/0517_billing_deposit_admission_link.sql'), 'utf8');
      runSql(dbPath, migration);

      expect(readRows<{ id: number; admission_id: number | null }>(
        dbPath,
        'SELECT id, admission_id FROM billing_deposits ORDER BY id',
      )).toEqual([
        { id: 1, admission_id: 101 },
        { id: 2, admission_id: 101 },
        { id: 3, admission_id: 101 },
        { id: 4, admission_id: 102 },
        { id: 5, admission_id: null },
        { id: 6, admission_id: null },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
