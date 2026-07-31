import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0506_doctor_waiver_gross_commission_backfill.sql', 'utf8');

function createFixture(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER,
      visit_id INTEGER,
      status TEXT
    );

    CREATE TABLE diagnostic_performer_reserves (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER,
      unit_discount_amount REAL NOT NULL DEFAULT 0,
      net_unit_service_amount REAL NOT NULL DEFAULT 0,
      reserved_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      settlement_id INTEGER,
      paid_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      patient_id INTEGER,
      visit_id INTEGER,
      bill_id INTEGER,
      lab_test_id INTEGER,
      source_type TEXT NOT NULL,
      incentive_type TEXT NOT NULL,
      gross_amount REAL NOT NULL DEFAULT 0,
      commission_base_amount REAL NOT NULL DEFAULT 0,
      performer_reserve_amount REAL NOT NULL DEFAULT 0,
      commission_rule_id INTEGER,
      commission_rate_bps INTEGER NOT NULL DEFAULT 0,
      commission_flat_amount REAL NOT NULL DEFAULT 0,
      commission_amount REAL NOT NULL DEFAULT 0,
      earned_commission_amount REAL NOT NULL DEFAULT 0,
      doctor_waiver_amount REAL NOT NULL DEFAULT 0,
      payable_commission_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      balance_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      accrued_date TEXT,
      settlement_id INTEGER,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT
    );

    CREATE TABLE accounting_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      performed_by TEXT
    );

    INSERT INTO bills (id, tenant_id, patient_id, visit_id, status)
    VALUES (6427, '102', 2099, 2659, 'paid');

    INSERT INTO diagnostic_performer_reserves (
      id, tenant_id, bill_id, unit_discount_amount, net_unit_service_amount,
      reserved_amount, status, settlement_id, paid_at
    ) VALUES (17, '102', 6427, 76.21, 647.79, 200, 'paid', 83, '2026-07-14 18:00:00');

    INSERT INTO doctor_commission_accruals (
      id, tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_test_id,
      source_type, incentive_type, gross_amount, commission_base_amount,
      performer_reserve_amount, commission_rule_id, commission_rate_bps,
      commission_amount, earned_commission_amount, doctor_waiver_amount,
      payable_commission_amount, paid_amount, balance_amount, status,
      accrued_date, settlement_id, notes
    ) VALUES
      (1901, '102', 130, 2099, 2659, 6427, 1062, 'lab_test', 'prescriber', 452, 452, 0, 21, 2500, 25, 113, 88, 25, 0, 25, 'paid', '2026-07-14', 80, 'S. Creatinine'),
      (1902, '102', 130, 2099, 2659, 6427, 1095, 'lab_test', 'prescriber', 724, 724, 0, 21, 2500, 181, 181, 0, 181, 0, 181, 'paid', '2026-07-14', 80, 'H. Pylori');
  `);
  return sqlite;
}

describe('doctor waiver gross commission backfill SQL', () => {
  it('adds one payable correction and remains idempotent', () => {
    const sqlite = createFixture();

    sqlite.exec(migration);
    sqlite.exec(migration);

    expect(sqlite.prepare(`
      SELECT unit_discount_amount, net_unit_service_amount, reserved_amount,
             status, settlement_id, paid_at
      FROM diagnostic_performer_reserves WHERE id = 17
    `).get()).toEqual({
      unit_discount_amount: 0,
      net_unit_service_amount: 724,
      reserved_amount: 200,
      status: 'paid',
      settlement_id: 83,
      paid_at: '2026-07-14 18:00:00',
    });

    expect(sqlite.prepare(`
      SELECT COUNT(*) AS row_count,
             ROUND(SUM(earned_commission_amount), 2) AS earned,
             ROUND(SUM(doctor_waiver_amount), 2) AS waiver,
             ROUND(SUM(payable_commission_amount), 2) AS payable,
             ROUND(SUM(balance_amount), 2) AS balance
      FROM doctor_commission_accruals
      WHERE notes = 'doctor-waiver-0506:bill-6427:gross-base-correction'
    `).get()).toEqual({ row_count: 1, earned: 181, waiver: 112, payable: 69, balance: 69 });

    expect(sqlite.prepare(`
      SELECT status, settlement_id, commission_amount, earned_commission_amount,
             doctor_waiver_amount, payable_commission_amount
      FROM doctor_commission_accruals WHERE id = 1901
    `).get()).toEqual({
      status: 'paid',
      settlement_id: 80,
      commission_amount: 25,
      earned_commission_amount: 113,
      doctor_waiver_amount: 88,
      payable_commission_amount: 25,
    });

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM accounting_posting_events').get())
      .toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM accounting_audit_logs').get())
      .toEqual({ count: 1 });
  });
});
