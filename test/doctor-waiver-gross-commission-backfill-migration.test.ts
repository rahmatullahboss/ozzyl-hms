import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0506_doctor_waiver_gross_commission_backfill.sql', 'utf8');

describe('doctor waiver gross commission backfill migration', () => {
  it('repairs the affected reserve snapshot without changing its paid payout', () => {
    expect(migration).toContain("tenant_id = '102'");
    expect(migration).toContain('id = 17');
    expect(migration).toContain('unit_discount_amount = 0');
    expect(migration).toContain('net_unit_service_amount = 724');
    expect(migration).not.toContain("status = 'reserved'");
  });

  it('creates the exact unpaid aggregate correction for bill 6427', () => {
    expect(migration).toContain('doctor-waiver-0506:bill-6427:gross-base-correction');
    expect(migration).toContain('181.00');
    expect(migration).toContain('112.00');
    expect(migration).toContain('69.00');
    expect(migration).toContain("'accrued'");
    expect(migration).toContain('accounting_posting_events');
  });

  it('preserves historical settlements and cash drawers', () => {
    expect(migration).not.toContain('UPDATE doctor_commission_settlements');
    expect(migration).not.toContain('UPDATE cash_drawer_movements');
    expect(migration).not.toContain('INSERT INTO cash_drawer_movements');
  });
});
