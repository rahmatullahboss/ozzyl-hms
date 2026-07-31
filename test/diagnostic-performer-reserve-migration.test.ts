import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0422_diagnostic_performer_reserve_payout.sql', 'utf8');
const tenantSchema = readFileSync('tenant-schema.sql', 'utf8');
const drizzle = readFileSync('src/db/schema/finance.ts', 'utf8');

describe('diagnostic performer reserve schema', () => {
  it('creates versioned rules and immutable unit reserves', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS diagnostic_performer_payout_rules');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS diagnostic_performer_reserves');
    expect(migration).toContain("CHECK (rate_type IN ('flat', 'percent'))");
    expect(migration).toContain("CHECK (diagnostic_kind IN ('lab', 'radiology'))");
    expect(migration).toContain("CHECK (status IN ('reserved', 'paid', 'cancelled', 'reversed'))");
    expect(migration).toContain('UNIQUE (tenant_id, invoice_item_id, unit_sequence)');
    expect(migration).toContain('cancelled_by INTEGER REFERENCES users(id)');
    expect(migration).toContain('reversed_by INTEGER REFERENCES users(id)');
  });

  it('adds deterministic reserve linkage and settlement reversal metadata', () => {
    expect(migration).toContain('ADD COLUMN commission_base_amount REAL NOT NULL DEFAULT 0');
    expect(migration).toContain('ADD COLUMN performer_reserve_amount REAL NOT NULL DEFAULT 0');
    expect(migration).toContain('ADD COLUMN performer_reserve_id INTEGER');
    expect(migration).toContain('uq_doctor_commission_accrual_performer_reserve');
    expect(migration).toContain('ADD COLUMN reversed_at TEXT');
    expect(migration).toContain('ADD COLUMN reversed_by INTEGER');
    expect(migration).toContain('ADD COLUMN reversal_reason TEXT');
    expect(migration).toContain('ADD COLUMN reversal_voucher_id INTEGER');
  });

  it('keeps fresh-install and Drizzle declarations in parity', () => {
    for (const text of [tenantSchema, drizzle]) {
      expect(text).toContain('diagnostic_performer_payout_rules');
      expect(text).toContain('diagnostic_performer_reserves');
      expect(text).toContain('performer_reserve_id');
      expect(text).toContain('reversal_voucher_id');
    }
  });

  it('executes cleanly against the existing finance table shape', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE doctor_commission_accruals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL
        );
        CREATE TABLE doctor_commission_settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL
        );
      `);
      db.exec(migration);

      const tableNames = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('diagnostic_performer_payout_rules', 'diagnostic_performer_reserves')
        ORDER BY name
      `).all().map((row) => String(row.name));
      expect(tableNames).toEqual(['diagnostic_performer_payout_rules', 'diagnostic_performer_reserves']);

      const accrualColumns = db.prepare(`PRAGMA table_info(doctor_commission_accruals)`).all()
        .map((row) => String(row.name));
      expect(accrualColumns).toEqual(expect.arrayContaining([
        'commission_base_amount',
        'performer_reserve_amount',
        'performer_reserve_id',
      ]));

      const settlementColumns = db.prepare(`PRAGMA table_info(doctor_commission_settlements)`).all()
        .map((row) => String(row.name));
      expect(settlementColumns).toEqual(expect.arrayContaining([
        'reversed_at',
        'reversed_by',
        'reversal_reason',
        'reversal_voucher_id',
      ]));
    } finally {
      db.close();
    }
  });
});
