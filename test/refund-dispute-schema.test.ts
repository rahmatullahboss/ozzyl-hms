import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL('../migrations/0521_refund_dispute_reconciliation.sql', import.meta.url);
const accountingMigrationPath = new URL('../migrations/0522_refund_dispute_receivable_account.sql', import.meta.url);
const commissionReservationMigrationPath = new URL('../migrations/0524_refund_commission_reservations.sql', import.meta.url);
const financialGuardMigrationPath = new URL('../migrations/0525_refund_financial_batch_guard.sql', import.meta.url);
const drizzleSchemaPath = new URL('../src/db/schema/schema.ts', import.meta.url);

describe('refund dispute reconciliation migration', () => {
  it('creates requester-owned dispute records and expands hold states safely', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/CREATE TABLE billing_refund_cash_disputes/i);
    expect(sql).toMatch(/status IN \('open','recovery_pending','recovered','writeoff_pending','written_off'\)/i);
    expect(sql).toMatch(/UNIQUE \(tenant_id, refund_cash_hold_id\)/i);
    expect(sql).toMatch(/status IN \('held', 'consumed', 'released', 'disputed', 'settled'\)/i);
  });

  it('preserves existing hold rows while allowing disputed and settled states', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE billing_counter_sessions (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        employee_id INTEGER NOT NULL,
        counter_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        opening_cash REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE emp_cash_transactions (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        counter_session_id INTEGER,
        payment_method TEXT,
        transaction_type TEXT,
        amount REAL
      );
      CREATE TABLE cash_drawer_movements (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        counter_session_id INTEGER,
        counter_id INTEGER,
        employee_id INTEGER,
        movement_type TEXT,
        amount REAL,
        reference_type TEXT,
        reference_id TEXT
      );
      CREATE TABLE billing_refund_cash_holds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        approval_request_id INTEGER NOT NULL,
        bill_id INTEGER NOT NULL,
        patient_id INTEGER NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method = 'cash'),
        employee_id INTEGER NOT NULL,
        counter_id INTEGER NOT NULL,
        counter_session_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'consumed', 'released')),
        idempotency_key TEXT NOT NULL,
        credit_note_id INTEGER,
        held_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
        consumed_at TEXT,
        released_at TEXT,
        custody_user_id INTEGER,
        release_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (release_status IN ('not_applicable', 'pending', 'credited')),
        release_counter_session_id INTEGER,
        release_cash_movement_id INTEGER,
        release_credited_at TEXT,
        resolved_by INTEGER,
        resolution_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
        UNIQUE (tenant_id, approval_request_id),
        UNIQUE (tenant_id, idempotency_key)
      );
      INSERT INTO billing_refund_cash_holds (
        tenant_id, approval_request_id, bill_id, patient_id, amount, employee_id,
        counter_id, counter_session_id, status, idempotency_key
      ) VALUES ('tenant-1', 55, 75, 50, 400, 3, 7, 17, 'held', 'hold-55');
    `);

    sqlite.exec(readFileSync(migrationPath, 'utf8'));

    expect(sqlite.prepare('SELECT status, amount FROM billing_refund_cash_holds WHERE id = 1').get()).toMatchObject({
      status: 'held',
      amount: 400,
    });
    sqlite.prepare("UPDATE billing_refund_cash_holds SET status = 'disputed' WHERE id = 1").run();
    sqlite.prepare("UPDATE billing_refund_cash_holds SET status = 'settled' WHERE id = 1").run();
    expect(sqlite.prepare('SELECT status FROM billing_refund_cash_holds WHERE id = 1').get()).toEqual({ status: 'settled' });
  });

  it('declares commission reservation and financial batch guard tables in migrations and Drizzle schema', () => {
    const reservationSql = readFileSync(commissionReservationMigrationPath, 'utf8');
    const guardSql = readFileSync(financialGuardMigrationPath, 'utf8');
    const drizzleSchema = readFileSync(drizzleSchemaPath, 'utf8');

    expect(reservationSql).toMatch(/CREATE TABLE IF NOT EXISTS billing_refund_commission_reservations/i);
    expect(reservationSql).toMatch(/status IN \('held', 'consumed', 'disputed', 'released', 'written_off'\)/i);
    expect(guardSql).toMatch(/CREATE TABLE IF NOT EXISTS billing_refund_batch_guard/i);
    expect(guardSql).toMatch(/CHECK\s*\(assertion_value = 1\)/i);
    expect(drizzleSchema).toMatch(/export const billingRefundCommissionReservations = sqliteTable\("billing_refund_commission_reservations"/);
    expect(drizzleSchema).toMatch(/export const billingRefundBatchGuard = sqliteTable\("billing_refund_batch_guard"/);
  });

  it('provisions a dedicated requester dispute receivable mapping for existing tenants', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE bills (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE accounting_posting_events (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE billing_refund_cash_disputes (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE chart_of_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE accounting_account_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        mapping_key TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        UNIQUE (tenant_id, mapping_key)
      );
      INSERT INTO tenants VALUES ('tenant-1');
    `);

    sqlite.exec(readFileSync(accountingMigrationPath, 'utf8'));

    expect(sqlite.prepare(`
      SELECT coa.code, coa.name, coa.type, mapping.mapping_key
      FROM accounting_account_mappings mapping
      JOIN chart_of_accounts coa ON coa.id = mapping.account_id
      WHERE mapping.tenant_id = 'tenant-1'
        AND mapping.mapping_key = 'employee_dispute_receivable'
    `).get()).toEqual({
      code: '7210',
      name: 'Employee / Requester Cash Dispute Receivable',
      type: 'asset',
      mapping_key: 'employee_dispute_receivable',
    });
  });
});
