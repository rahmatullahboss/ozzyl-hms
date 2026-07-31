import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  autoCloseStaleCounterSessions,
  calculateBillingCounterSessionCashSummary,
  loadActiveBillingCounterSession,
} from '../../src/lib/billing-counter-session';

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindSql(sql: string, params: unknown[]): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    if (index >= params.length) throw new Error('Missing SQL bind value');
    return sqlValue(params[index++]);
  });
}

function makeSqliteD1(dbPath: string): D1Database {
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          params = values;
          return this;
        },
        async first<T>() {
          const output = execFileSync('sqlite3', ['-json', dbPath, bindSql(sql, params)], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();
          const rows = output ? JSON.parse(output) as T[] : [];
          return rows[0] ?? null;
        },
        async run() {
          execFileSync('sqlite3', [dbPath, bindSql(sql, params)], { stdio: ['ignore', 'pipe', 'pipe'] });
          return { meta: { changes: 0 } };
        },
      };
    },
  } as unknown as D1Database;
}

function runSql(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('calculateBillingCounterSessionCashSummary', () => {
  it('does not multiply manual cash movements by cash transaction row count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-counter-session-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE billing_counter_sessions (id INTEGER, tenant_id TEXT, opening_cash REAL, opened_at TEXT);
        CREATE TABLE emp_cash_transactions (
          id INTEGER,
          tenant_id TEXT,
          counter_session_id INTEGER,
          payment_method TEXT,
          transaction_type TEXT,
          amount REAL,
          reference_id INTEGER
        );
        CREATE TABLE cash_drawer_movements (
          id INTEGER,
          tenant_id TEXT,
          counter_session_id INTEGER,
          movement_type TEXT,
          amount REAL
        );
        CREATE TABLE bills (
          id INTEGER,
          tenant_id TEXT,
          counter_session_id INTEGER,
          doctor_visit_bill REAL,
          test_bill REAL,
          discount REAL
        );
        CREATE TABLE appointments (id INTEGER, tenant_id TEXT, billing_status TEXT, updated_at TEXT);
        CREATE TABLE doctor_commission_accruals (
          id INTEGER,
          tenant_id TEXT,
          source_type TEXT,
          status TEXT,
          commission_amount REAL,
          accrued_date TEXT
        );

        INSERT INTO billing_counter_sessions (id, tenant_id, opening_cash, opened_at)
        VALUES (17, 'tenant-1', 0, '2026-05-15 09:00:00');
        INSERT INTO emp_cash_transactions (id, tenant_id, counter_session_id, payment_method, transaction_type, amount, reference_id)
        WITH RECURSIVE seq(id) AS (
          SELECT 1
          UNION ALL
          SELECT id + 1 FROM seq WHERE id < 68
        )
        SELECT id, 'tenant-1', 17, 'cash', 'CashSales',
          CASE WHEN id = 68 THEN 162550 ELSE 23800 END,
          id
        FROM seq;
        INSERT INTO cash_drawer_movements (id, tenant_id, counter_session_id, movement_type, amount)
        VALUES (1, 'tenant-1', 17, 'cash_out', 50000);
      `);

      const summary = await calculateBillingCounterSessionCashSummary(makeSqliteD1(dbPath), 'tenant-1', 17);

      expect(summary.cashIn).toBe(1757150);
      expect(summary.manualCashOut).toBe(50000);
      expect(summary.expectedCash).toBe(1707150);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('subtracts only active refund holds from operationally available cash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-counter-refund-hold-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE billing_counter_sessions (id INTEGER, tenant_id TEXT, opening_cash REAL, opened_at TEXT);
        CREATE TABLE emp_cash_transactions (
          id INTEGER,
          tenant_id TEXT,
          counter_session_id INTEGER,
          payment_method TEXT,
          transaction_type TEXT,
          amount REAL,
          reference_id INTEGER
        );
        CREATE TABLE cash_drawer_movements (
          id INTEGER,
          tenant_id TEXT,
          counter_session_id INTEGER,
          movement_type TEXT,
          amount REAL
        );
        CREATE TABLE bills (
          id INTEGER,
          tenant_id TEXT,
          counter_session_id INTEGER,
          doctor_visit_bill REAL,
          test_bill REAL,
          discount REAL
        );
        CREATE TABLE appointments (id INTEGER, tenant_id TEXT, billing_status TEXT, updated_at TEXT);
        CREATE TABLE doctor_commission_accruals (
          id INTEGER,
          tenant_id TEXT,
          source_type TEXT,
          status TEXT,
          commission_amount REAL,
          accrued_date TEXT
        );
        CREATE TABLE billing_refund_cash_holds (
          id INTEGER,
          tenant_id TEXT,
          counter_session_id INTEGER,
          amount REAL,
          status TEXT
        );

        INSERT INTO billing_counter_sessions VALUES (17, 'tenant-1', 1000, '2026-05-15 09:00:00');
        INSERT INTO emp_cash_transactions VALUES (1, 'tenant-1', 17, 'cash', 'CashSales', 4000, 1);
        INSERT INTO billing_refund_cash_holds VALUES (1, 'tenant-1', 17, 1200, 'held');
        INSERT INTO billing_refund_cash_holds VALUES (2, 'tenant-1', 17, 500, 'released');
        INSERT INTO billing_refund_cash_holds VALUES (3, 'tenant-1', 17, 300, 'consumed');
      `);

      const summary = await calculateBillingCounterSessionCashSummary(makeSqliteD1(dbPath), 'tenant-1', 17);

      expect(summary.expectedCash).toBe(5000);
      expect(summary.heldRefundCash).toBe(1200);
      expect(summary.availableCash).toBe(3800);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('autoCloseStaleCounterSessions refund hold guard', () => {
  it('keeps a stale session active while a refund hold is pending', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-counter-refund-hold-close-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE billing_counter_sessions (
          id INTEGER,
          tenant_id TEXT,
          employee_id INTEGER,
          status TEXT,
          opened_at TEXT,
          variance_approval_status TEXT,
          closed_at TEXT,
          closed_by INTEGER,
          remarks TEXT,
          updated_at TEXT
        );
        CREATE TABLE billing_refund_cash_holds (
          id INTEGER,
          tenant_id TEXT,
          counter_session_id INTEGER,
          amount REAL,
          status TEXT
        );
        INSERT INTO billing_counter_sessions
          (id, tenant_id, employee_id, status, opened_at, variance_approval_status)
        VALUES (17, 'tenant-1', 101, 'active', '2020-01-01 00:00:00', NULL);
        INSERT INTO billing_refund_cash_holds VALUES (1, 'tenant-1', 17, 1200, 'held');
      `);

      await autoCloseStaleCounterSessions(makeSqliteD1(dbPath), 'tenant-1', 24);
      const row = execFileSync('sqlite3', ['-json', dbPath, 'SELECT status FROM billing_counter_sessions WHERE id = 17'], { encoding: 'utf8' });
      expect(JSON.parse(row)[0].status).toBe('active');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('loadActiveBillingCounterSession workstation ownership', () => {
  it('falls back to legacy sessions when workstation lock columns are not migrated yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-counter-workstation-legacy-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE billing_counters (
          id INTEGER,
          tenant_id TEXT,
          counter_name TEXT,
          counter_code TEXT,
          is_active INTEGER
        );
        CREATE TABLE billing_counter_sessions (
          id INTEGER,
          tenant_id TEXT,
          counter_id INTEGER,
          employee_id INTEGER,
          counter_type TEXT,
          opening_cash REAL,
          opened_at TEXT,
          status TEXT,
          closed_at TEXT,
          closed_by INTEGER,
          remarks TEXT,
          updated_at TEXT
        );
        INSERT INTO billing_counters VALUES (7, 'tenant-1', 'Reception', 'BILL-1', 1);
        INSERT INTO billing_counter_sessions
          (id, tenant_id, counter_id, employee_id, counter_type, opening_cash, opened_at, status)
        VALUES
          (17, 'tenant-1', 7, 101, 'billing', 250, datetime('now', '+6 hours'), 'active');
      `);

      const session = await loadActiveBillingCounterSession(makeSqliteD1(dbPath), 'tenant-1', '101', {
        workstationId: 'hms-ws-main',
        requireCurrentWorkstation: true,
      });

      expect(session?.id).toBe(17);
      expect(session?.workstation_id).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not return a workstation-bound counter session when the current workstation is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-counter-workstation-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE billing_counters (
          id INTEGER,
          tenant_id TEXT,
          counter_name TEXT,
          counter_code TEXT,
          is_active INTEGER
        );
        CREATE TABLE billing_counter_sessions (
          id INTEGER,
          tenant_id TEXT,
          counter_id INTEGER,
          employee_id INTEGER,
          counter_type TEXT,
          opening_cash REAL,
          opened_at TEXT,
          workstation_id TEXT,
          heartbeat_at TEXT,
          status TEXT,
          closed_at TEXT,
          closed_by INTEGER,
          remarks TEXT,
          updated_at TEXT
        );
        INSERT INTO billing_counters VALUES (7, 'tenant-1', 'Reception', 'BILL-1', 1);
        INSERT INTO billing_counter_sessions
          (id, tenant_id, counter_id, employee_id, counter_type, opening_cash, opened_at, workstation_id, heartbeat_at, status)
        VALUES
          (17, 'tenant-1', 7, 101, 'billing', 0, datetime('now', '+6 hours'), 'hms-ws-main', datetime('now', '+6 hours'), 'active');
      `);

      const session = await loadActiveBillingCounterSession(makeSqliteD1(dbPath), 'tenant-1', '101', {
        requireCurrentWorkstation: true,
      });

      expect(session).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets the same cashier rebind a live counter session after workstation restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-counter-workstation-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE billing_counters (
          id INTEGER,
          tenant_id TEXT,
          counter_name TEXT,
          counter_code TEXT,
          is_active INTEGER
        );
        CREATE TABLE billing_counter_sessions (
          id INTEGER,
          tenant_id TEXT,
          counter_id INTEGER,
          employee_id INTEGER,
          counter_type TEXT,
          opening_cash REAL,
          opened_at TEXT,
          workstation_id TEXT,
          heartbeat_at TEXT,
          status TEXT,
          closed_at TEXT,
          closed_by INTEGER,
          remarks TEXT,
          updated_at TEXT
        );
        INSERT INTO billing_counters VALUES (7, 'tenant-1', 'Reception', 'BILL-1', 1);
        INSERT INTO billing_counter_sessions
          (id, tenant_id, counter_id, employee_id, counter_type, opening_cash, opened_at, workstation_id, heartbeat_at, status)
        VALUES
          (17, 'tenant-1', 7, 101, 'billing', 0, datetime('now', '+6 hours'), 'hms-ws-main', datetime('now', '+6 hours'), 'active');
      `);

      const session = await loadActiveBillingCounterSession(makeSqliteD1(dbPath), 'tenant-1', '101', {
        workstationId: 'hms-ws-other',
        requireCurrentWorkstation: true,
      });

      expect(session?.id).toBe(17);
      expect(session?.workstation_id).toBe('hms-ws-other');

      const row = execFileSync('sqlite3', ['-json', dbPath, 'SELECT workstation_id FROM billing_counter_sessions WHERE id = 17'], {
        encoding: 'utf8',
      });
      expect(JSON.parse(row)).toEqual([{ workstation_id: 'hms-ws-other' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves the active cash session when rebinding an old workstation heartbeat', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-counter-workstation-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE billing_counters (
          id INTEGER,
          tenant_id TEXT,
          counter_name TEXT,
          counter_code TEXT,
          is_active INTEGER
        );
        CREATE TABLE billing_counter_sessions (
          id INTEGER,
          tenant_id TEXT,
          counter_id INTEGER,
          employee_id INTEGER,
          counter_type TEXT,
          opening_cash REAL,
          opened_at TEXT,
          workstation_id TEXT,
          heartbeat_at TEXT,
          status TEXT,
          closed_at TEXT,
          closed_by INTEGER,
          remarks TEXT,
          updated_at TEXT
        );
        INSERT INTO billing_counters VALUES (7, 'tenant-1', 'Reception', 'BILL-1', 1);
        INSERT INTO billing_counter_sessions
          (id, tenant_id, counter_id, employee_id, counter_type, opening_cash, opened_at, workstation_id, heartbeat_at, status)
        VALUES
          (17, 'tenant-1', 7, 101, 'billing', 0, datetime('now', '+6 hours'), 'hms-ws-old', datetime('now', '+6 hours', '-15 minutes'), 'active');
      `);

      const session = await loadActiveBillingCounterSession(makeSqliteD1(dbPath), 'tenant-1', '101', {
        workstationId: 'hms-ws-new',
        requireCurrentWorkstation: true,
      });

      expect(session?.id).toBe(17);
      expect(session?.workstation_id).toBe('hms-ws-new');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not auto-close old active sessions because cash must be reconciled explicitly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-counter-no-auto-close-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      runSql(dbPath, `
        CREATE TABLE billing_counters (
          id INTEGER,
          tenant_id TEXT,
          counter_name TEXT,
          counter_code TEXT,
          is_active INTEGER
        );
        CREATE TABLE billing_counter_sessions (
          id INTEGER,
          tenant_id TEXT,
          counter_id INTEGER,
          employee_id INTEGER,
          counter_type TEXT,
          opening_cash REAL,
          opened_at TEXT,
          workstation_id TEXT,
          heartbeat_at TEXT,
          status TEXT,
          closed_at TEXT,
          closed_by INTEGER,
          remarks TEXT,
          updated_at TEXT
        );
        INSERT INTO billing_counters VALUES (7, 'tenant-1', 'Reception', 'BILL-1', 1);
        INSERT INTO billing_counter_sessions
          (id, tenant_id, counter_id, employee_id, counter_type, opening_cash, opened_at, workstation_id, heartbeat_at, status)
        VALUES
          (17, 'tenant-1', 7, 101, 'billing', 5000, datetime('now', '+6 hours', '-2 days'), 'hms-ws-old', datetime('now', '+6 hours', '-2 days'), 'active');
      `);

      const session = await loadActiveBillingCounterSession(makeSqliteD1(dbPath), 'tenant-1', '101', {
        workstationId: 'hms-ws-new',
        requireCurrentWorkstation: true,
      });
      const row = execFileSync('sqlite3', ['-json', dbPath, 'SELECT status, closed_at FROM billing_counter_sessions WHERE id = 17'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

      expect(session?.id).toBe(17);
      expect(JSON.parse(row)).toEqual([{ status: 'active', closed_at: null }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
