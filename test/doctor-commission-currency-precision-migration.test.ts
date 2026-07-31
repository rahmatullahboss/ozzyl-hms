import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0504_doctor_commission_currency_precision.sql', 'utf8');

describe('doctor commission currency precision migration', () => {
  it('repairs unsettled percentage accruals using the reserve-reduced base', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE doctor_commission_accruals (
          id INTEGER PRIMARY KEY,
          gross_amount REAL NOT NULL DEFAULT 0,
          commission_base_amount REAL NOT NULL DEFAULT 0,
          performer_reserve_amount REAL NOT NULL DEFAULT 0,
          commission_rate_bps INTEGER NOT NULL DEFAULT 0,
          commission_amount REAL NOT NULL DEFAULT 0,
          earned_commission_amount REAL NOT NULL DEFAULT 0,
          doctor_waiver_amount REAL NOT NULL DEFAULT 0,
          payable_commission_amount REAL NOT NULL DEFAULT 0,
          paid_amount REAL NOT NULL DEFAULT 0,
          balance_amount REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'accrued',
          settlement_id INTEGER,
          updated_at TEXT
        );

        INSERT INTO doctor_commission_accruals
          (id, gross_amount, commission_base_amount, performer_reserve_amount, commission_rate_bps,
           commission_amount, earned_commission_amount, doctor_waiver_amount,
           payable_commission_amount, paid_amount, balance_amount, status, settlement_id)
        VALUES
          (1, 143, 0, 0, 2500, 35, 35, 0, 35, 0, 35, 'accrued', NULL),
          (2, 800, 600, 200, 2500, 100, 100, 0, 100, 0, 100, 'approved', NULL),
          (3, 1000, 0, 0, 2500, 200, 250, 50, 200, 0, 200, 'accrued', NULL),
          (4, 143, 0, 0, 2500, 35, 35, 0, 35, 35, 0, 'paid', 9),
          (5, 143, 0, 0, 2500, 35.75, 35.75, 0, 35.75, 0, 35.75, 'accrued', NULL);

        UPDATE doctor_commission_accruals
        SET updated_at = 'keep-existing-timestamp'
        WHERE id = 5;
      `);

      db.exec(migration);

      expect(db.prepare(`
        SELECT id, commission_amount, earned_commission_amount,
               payable_commission_amount, balance_amount
        FROM doctor_commission_accruals
        ORDER BY id
      `).all()).toEqual([
        { id: 1, commission_amount: 35.75, earned_commission_amount: 35.75, payable_commission_amount: 35.75, balance_amount: 35.75 },
        { id: 2, commission_amount: 150, earned_commission_amount: 150, payable_commission_amount: 150, balance_amount: 150 },
        { id: 3, commission_amount: 200, earned_commission_amount: 250, payable_commission_amount: 200, balance_amount: 200 },
        { id: 4, commission_amount: 35, earned_commission_amount: 35, payable_commission_amount: 35, balance_amount: 0 },
        { id: 5, commission_amount: 35.75, earned_commission_amount: 35.75, payable_commission_amount: 35.75, balance_amount: 35.75 },
      ]);
      expect(db.prepare('SELECT updated_at FROM doctor_commission_accruals WHERE id = 5').get()).toEqual({
        updated_at: 'keep-existing-timestamp',
      });
    } finally {
      db.close();
    }
  });

  it('never rewrites paid or settled history', () => {
    expect(migration).toContain("COALESCE(status, 'accrued') IN ('accrued', 'approved')");
    expect(migration).toContain('COALESCE(settlement_id, 0) = 0');
    expect(migration).toContain('commission_base_amount');
    expect(migration).toContain('ROUND(');
    expect(migration).not.toContain('CAST(');
  });
});
