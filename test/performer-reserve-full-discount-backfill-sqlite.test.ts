import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0505_performer_reserve_full_discount_backfill.sql', 'utf8');

function createFixture(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      line_total REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0
    );

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
      invoice_item_id INTEGER NOT NULL,
      unit_service_amount REAL NOT NULL DEFAULT 0,
      unit_discount_amount REAL NOT NULL DEFAULT 0,
      net_unit_service_amount REAL NOT NULL DEFAULT 0,
      rule_rate_type TEXT NOT NULL,
      rule_rate_value REAL NOT NULL DEFAULT 0,
      reserved_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      assigned_doctor_id INTEGER,
      commission_accrual_id INTEGER,
      settlement_id INTEGER,
      paid_at TEXT,
      cancelled_at TEXT,
      cancelled_by INTEGER,
      cancel_reason TEXT,
      reversed_at TEXT,
      reversed_by INTEGER,
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
      settlement_id INTEGER,
      source_type TEXT NOT NULL,
      incentive_type TEXT NOT NULL,
      gross_amount REAL NOT NULL DEFAULT 0,
      commission_base_amount REAL NOT NULL DEFAULT 0,
      performer_reserve_amount REAL NOT NULL DEFAULT 0,
      performer_reserve_id INTEGER,
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
      notes TEXT,
      created_by INTEGER,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE UNIQUE INDEX uq_accrual_performer_reserve
      ON doctor_commission_accruals(tenant_id, performer_reserve_id)
      WHERE performer_reserve_id IS NOT NULL;

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

    INSERT INTO invoice_items (id, tenant_id, line_total, tax_amount) VALUES
      (2606, '102', 583, 0),
      (2608, '102', 0, 0),
      (2609, '102', 650, 0),
      (2610, '102', 350, 0),
      (2612, '102', 350, 0),
      (2618, '102', 631, 0);

    INSERT INTO bills (id, tenant_id, patient_id, visit_id, status) VALUES
      (6613, '102', 1, 11, 'paid'),
      (6616, '102', 2, 12, 'paid'),
      (6617, '102', 3, 13, 'paid'),
      (6619, '102', 4, 14, 'paid');

    INSERT INTO diagnostic_performer_reserves (
      id, tenant_id, invoice_item_id, unit_service_amount, unit_discount_amount,
      net_unit_service_amount, rule_rate_type, rule_rate_value, reserved_amount,
      status, assigned_doctor_id, commission_accrual_id, settlement_id, paid_at
    ) VALUES
      (41, '102', 2606, 583, 116.6, 466.4, 'flat', 200, 200, 'paid', 136, 2206, 99, '2026-07-18 22:05:44'),
      (42, '102', 2608, 0, 0, 0, 'flat', 200, 0, 'paid', 136, 2207, 99, '2026-07-18 22:05:44'),
      (43, '102', 2609, 650, 50, 600, 'flat', 200, 200, 'reserved', NULL, NULL, NULL, NULL),
      (44, '102', 2610, 350, 350, 0, 'flat', 200, 0, 'paid', 136, 2208, 99, '2026-07-18 22:05:44'),
      (45, '102', 2612, 350, 350, 0, 'flat', 200, 0, 'paid', 136, 2209, 99, '2026-07-18 22:05:44'),
      (46, '102', 2618, 631, 67.61, 563.39, 'flat', 200, 200, 'paid', 143, 2210, 100, '2026-07-18 22:06:51');

    INSERT INTO doctor_commission_accruals (
      id, tenant_id, doctor_id, bill_id, source_type, incentive_type,
      gross_amount, commission_base_amount, performer_reserve_amount,
      performer_reserve_id, commission_rule_id, commission_amount,
      earned_commission_amount, payable_commission_amount, paid_amount,
      balance_amount, status, accrued_date, settlement_id, notes
    ) VALUES
      (2197, '102', 136, 6613, 'lab_test', 'prescriber', 466.4, 266.4, 200, NULL, 701, 67, 67, 67, 67, 0, 'paid', '2026-07-18', 103, 'original prescriber'),
      (2204, '102', 143, 6619, 'lab_test', 'prescriber', 563.39, 363.39, 200, NULL, 702, 91, 91, 91, 91, 0, 'paid', '2026-07-18', 102, 'original prescriber'),
      (2207, '102', 136, 6614, 'lab_test', 'performer', 0, 0, 0, 42, 801, 0, 0, 0, 0, 0, 'paid', '2026-07-18', 99, 'zero performer'),
      (2208, '102', 136, 6616, 'lab_test', 'performer', 0, 0, 0, 44, 801, 0, 0, 0, 0, 0, 'paid', '2026-07-18', 99, 'zero performer'),
      (2209, '102', 136, 6617, 'lab_test', 'performer', 0, 0, 0, 45, 801, 0, 0, 0, 0, 0, 'paid', '2026-07-18', 99, 'zero performer');
  `);
  return sqlite;
}

describe('performer reserve full-discount backfill SQL', () => {
  it('repairs payables and is safe to run more than once', () => {
    const sqlite = createFixture();

    sqlite.exec(migration);
    sqlite.exec(migration);

    const reopened = sqlite.prepare(`
      SELECT id, reserved_amount, status, assigned_doctor_id,
             commission_accrual_id, settlement_id, paid_at,
             unit_discount_amount, net_unit_service_amount
      FROM diagnostic_performer_reserves
      WHERE id IN (42, 44, 45)
      ORDER BY id
    `).all();
    expect(reopened).toEqual([
      { id: 42, reserved_amount: 200, status: 'reserved', assigned_doctor_id: 136, commission_accrual_id: null, settlement_id: null, paid_at: null, unit_discount_amount: 0, net_unit_service_amount: 0 },
      { id: 44, reserved_amount: 200, status: 'reserved', assigned_doctor_id: 136, commission_accrual_id: null, settlement_id: null, paid_at: null, unit_discount_amount: 0, net_unit_service_amount: 350 },
      { id: 45, reserved_amount: 200, status: 'reserved', assigned_doctor_id: 136, commission_accrual_id: null, settlement_id: null, paid_at: null, unit_discount_amount: 0, net_unit_service_amount: 350 },
    ]);

    const canonicalSnapshots = sqlite.prepare(`
      SELECT id, unit_service_amount, unit_discount_amount, net_unit_service_amount
      FROM diagnostic_performer_reserves
      WHERE id IN (41, 43, 46)
      ORDER BY id
    `).all();
    expect(canonicalSnapshots).toEqual([
      { id: 41, unit_service_amount: 583, unit_discount_amount: 0, net_unit_service_amount: 583 },
      { id: 43, unit_service_amount: 650, unit_discount_amount: 0, net_unit_service_amount: 650 },
      { id: 46, unit_service_amount: 631, unit_discount_amount: 0, net_unit_service_amount: 631 },
    ]);

    const superseded = sqlite.prepare(`
      SELECT id, performer_reserve_id, status, settlement_id, commission_amount, notes
      FROM doctor_commission_accruals
      WHERE id IN (2207, 2208, 2209)
      ORDER BY id
    `).all();
    expect(superseded).toEqual([
      { id: 2207, performer_reserve_id: null, status: 'paid', settlement_id: 99, commission_amount: 0, notes: 'zero performer | superseded by performer reserve backfill 0505' },
      { id: 2208, performer_reserve_id: null, status: 'paid', settlement_id: 99, commission_amount: 0, notes: 'zero performer | superseded by performer reserve backfill 0505' },
      { id: 2209, performer_reserve_id: null, status: 'paid', settlement_id: 99, commission_amount: 0, notes: 'zero performer | superseded by performer reserve backfill 0505' },
    ]);

    const correction = sqlite.prepare(`
      SELECT COUNT(*) AS row_count,
             ROUND(SUM(commission_amount), 2) AS amount,
             ROUND(SUM(balance_amount), 2) AS balance
      FROM doctor_commission_accruals
      WHERE notes LIKE 'performer-reserve-0505:%'
    `).get();
    expect(correction).toEqual({ row_count: 4, amount: 121, balance: 121 });

    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM accounting_posting_events`).get())
      .toEqual({ count: 4 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM accounting_audit_logs`).get())
      .toEqual({ count: 1 });
  });
});
