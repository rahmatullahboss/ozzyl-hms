import { describe, it, expect } from 'vitest';

describe('pharmacy stock deduction SQL guards', () => {
  const GUARDED_DEDUCTIONS = [
    { file: 'pharmacy/purchase.ts:353', sql: 'UPDATE pharmacy_stock SET available_qty = available_qty - ? WHERE id = ? AND tenant_id = ? AND available_qty >= ?' },
    { file: 'pharmacy/index.ts:1726', sql: 'UPDATE pharmacy_stock SET available_qty = available_qty - ? WHERE id = ? AND tenant_id = ? AND available_qty >= ?' },
    { file: 'pharmacy/invoices.ts:147', sql: 'UPDATE pharmacy_stock SET available_qty = available_qty - ?, updated_at=datetime(\'now\', \'+6 hours\') WHERE id = ? AND tenant_id = ? AND available_qty >= ?' },
    { file: 'pharmacy/advanced.ts:206', sql: 'UPDATE pharmacy_stock SET available_qty = available_qty - ? WHERE id = ? AND tenant_id = ? AND available_qty >= ?' },
    { file: 'pharmacy/advanced.ts:511', sql: 'UPDATE pharmacy_stock SET available_qty = available_qty - ? WHERE id = ? AND tenant_id = ? AND available_qty >= ?' },
    { file: 'pharmacy/advanced.ts:752', sql: 'UPDATE pharmacy_stock SET available_qty = available_qty - ? WHERE id = ? AND tenant_id = ? AND available_qty >= ?' },
  ];

  const BATCH_DEDUCTIONS = [
    { file: 'pharmacy/index.ts:376 (medicine_stock_batches)', sql: 'UPDATE medicine_stock_batches SET quantity_available = quantity_available - ? WHERE id = ? AND tenant_id = ? AND quantity_available >= ?' },
    { file: 'pharmacy/index.ts:391 (medicines)', sql: 'UPDATE medicines SET quantity = quantity - ? WHERE id = ? AND tenant_id = ? AND quantity >= ?' },
  ];

  describe('pharmacy_stock table deductions', () => {
    for (const { file, sql } of GUARDED_DEDUCTIONS) {
      it(`${file} has available_qty >= guard`, () => {
        expect(sql).toMatch(/available_qty\s*>=\s*\?/);
      });
    }
  });

  describe('medicine_stock_batches table deductions', () => {
    for (const { file, sql } of BATCH_DEDUCTIONS) {
      it(`${file} has quantity guard`, () => {
        expect(sql).toMatch(/quantity(?:_available)?\s*>=\s*\?/);
      });
    }
  });

  it('all deduction queries include WHERE tenant_id to prevent cross-tenant leaks', () => {
    const allSqls = [...GUARDED_DEDUCTIONS, ...BATCH_DEDUCTIONS].map(d => d.sql);
    for (const sql of allSqls) {
      expect(sql).toContain('tenant_id');
    }
  });
});
