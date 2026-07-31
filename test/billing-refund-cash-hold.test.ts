import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  getActiveRefundHoldTotal,
  getCounterAvailableCash,
  loadHeldRefundCashHold,
  loadRefundCashHold,
} from '../src/lib/billing-refund-cash-hold';

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindSql(sql: string, params: unknown[]): string {
  let index = 0;
  return sql.replace(/\?/g, () => sqlValue(params[index++]));
}

function makeSqliteD1(dbPath: string): D1Database {
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      return {
        bind(...values: unknown[]) { params = values; return this; },
        async first<T>() {
          const output = execFileSync('sqlite3', ['-json', dbPath, bindSql(sql, params)], { encoding: 'utf8' }).trim();
          const rows = output ? JSON.parse(output) as T[] : [];
          return rows[0] ?? null;
        },
      };
    },
  } as unknown as D1Database;
}

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('billing refund cash holds', () => {
  it('loads held amounts and counter available cash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'refund-holds-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE billing_counter_sessions (id INTEGER, tenant_id TEXT, opening_cash REAL, opened_at TEXT);
        CREATE TABLE emp_cash_transactions (id INTEGER, tenant_id TEXT, counter_session_id INTEGER, payment_method TEXT, transaction_type TEXT, amount REAL, reference_id INTEGER);
        CREATE TABLE cash_drawer_movements (id INTEGER, tenant_id TEXT, counter_session_id INTEGER, movement_type TEXT, amount REAL);
        CREATE TABLE bills (id INTEGER, tenant_id TEXT, counter_session_id INTEGER, doctor_visit_bill REAL, test_bill REAL, discount REAL);
        CREATE TABLE appointments (id INTEGER, tenant_id TEXT, billing_status TEXT, updated_at TEXT);
        CREATE TABLE doctor_commission_accruals (id INTEGER, tenant_id TEXT, source_type TEXT, status TEXT, commission_amount REAL, accrued_date TEXT);
        CREATE TABLE billing_refund_cash_holds (
          id INTEGER, tenant_id TEXT, approval_request_id INTEGER, bill_id INTEGER, patient_id INTEGER,
          amount REAL, payment_method TEXT, employee_id INTEGER, counter_id INTEGER, counter_session_id INTEGER,
          status TEXT, credit_note_id INTEGER, idempotency_key TEXT, held_at TEXT, consumed_at TEXT, released_at TEXT
        );
        INSERT INTO billing_counter_sessions VALUES (17, 'tenant-1', 1000, '2026-05-15 09:00:00');
        INSERT INTO emp_cash_transactions VALUES (1, 'tenant-1', 17, 'cash', 'CashSales', 4000, 1);
        INSERT INTO billing_refund_cash_holds VALUES (9, 'tenant-1', 55, 16, 8, 1200, 'cash', 101, 7, 17, 'held', NULL, 'key-1', '2026-07-12', NULL, NULL);
        INSERT INTO billing_refund_cash_holds VALUES (10, 'tenant-1', 56, 17, 8, 500, 'cash', 101, 7, 17, 'consumed', 44, 'key-2', '2026-07-12', '2026-07-12', NULL);
      `);

      const db = makeSqliteD1(dbPath);
      expect(await getActiveRefundHoldTotal(db, 'tenant-1', 17)).toBe(1200);
      expect(await getCounterAvailableCash(db, 'tenant-1', 17)).toEqual({ expectedCash: 5000, heldRefundCash: 1200, availableCash: 3800 });
      expect(await loadHeldRefundCashHold(db, 'tenant-1', 55)).toMatchObject({ id: 9, approvalRequestId: 55, amount: 1200, status: 'held' });
      expect(await loadRefundCashHold(db, 'tenant-1', 56)).toMatchObject({ id: 10, approvalRequestId: 56, status: 'consumed', creditNoteId: 44 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
