import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0505_performer_reserve_full_discount_backfill.sql', 'utf8');

describe('performer reserve full-discount backfill migration', () => {
  it('reopens only the three zero-value paid reserves as payable BDT 200 reserves', () => {
    expect(migration).toContain("performer_reserve_id IN (42, 44, 45)");
    expect(migration).toContain('performer_reserve_id = NULL');
    expect(migration).toContain('id IN (42, 44, 45)');
    expect(migration).toContain("status = 'reserved'");
    expect(migration).toContain('reserved_amount = 200');
    expect(migration).toContain('commission_accrual_id = NULL');
    expect(migration).toContain('settlement_id = NULL');
  });

  it('repairs the canonical net service snapshots without applying discount twice', () => {
    expect(migration).toContain('unit_discount_amount = 0');
    expect(migration).toContain('COALESCE(ii.line_total, 0) - COALESCE(ii.tax_amount, 0)');
    expect(migration).toContain('id IN (41, 42, 43, 44, 45, 46)');
  });

  it('creates exact unpaid commission corrections and preserves paid settlement history', () => {
    expect(migration).toContain('performer-reserve-0505:noorsali-lamia:29.00');
    expect(migration).toContain('performer-reserve-0505:noorsali-tahmina:37.50');
    expect(migration).toContain('performer-reserve-0505:noorsali-nipa:37.50');
    expect(migration).toContain('performer-reserve-0505:farhana-halima:17.00');
    expect(migration).toContain("'accrued'");
    expect(migration).toContain('accounting_posting_events');
    expect(migration).not.toContain('UPDATE doctor_commission_settlements');
    expect(migration).not.toContain('INSERT INTO cash_drawer_movements');
  });
});
