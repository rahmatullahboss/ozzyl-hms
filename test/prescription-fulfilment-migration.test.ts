import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0275_medication_fulfilment_orders.sql';

describe('medication fulfilment persistence migration', () => {
  it('creates order truth separately from clinical prescriptions', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS medication_orders');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS medication_order_items');
    expect(sql).toContain('UNIQUE(tenant_id, idempotency_key)');
    expect(sql).toContain('ALTER TABLE pharmacy_sales ADD COLUMN medication_order_id');
  });

  it('adds stock and over-dispensing guards without creating doctor commission storage', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).not.toContain('doctor_id');
    expect(sql).not.toContain('medication_platform_fees');
    expect(sql).toContain('trg_medication_fulfilment_batch_nonnegative');
    expect(sql).toContain('trg_medication_fulfilment_item_overdispense');
    expect(sql).toContain('RAISE(ABORT');
  });
});
