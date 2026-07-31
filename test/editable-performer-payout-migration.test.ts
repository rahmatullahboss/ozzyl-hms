import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('editable performer payout migration', () => {
  const migration = readFileSync('migrations/0537_editable_performer_payout_overrides.sql', 'utf8');

  it('adds immutable calculated and override evidence to settlement items', () => {
    expect(migration).toContain('ALTER TABLE doctor_commission_settlement_items ADD COLUMN calculated_commission_amount REAL');
    expect(migration).toContain('ALTER TABLE doctor_commission_settlement_items ADD COLUMN override_amount REAL');
    expect(migration).toContain('ALTER TABLE doctor_commission_settlement_items ADD COLUMN override_reason TEXT');
    expect(migration).toContain('ALTER TABLE doctor_commission_settlement_items ADD COLUMN overridden_by INTEGER');
    expect(migration).toContain('ALTER TABLE doctor_commission_settlement_items ADD COLUMN overridden_at TEXT');
  });

  it('is additive and does not rebuild governed canonical tables', () => {
    expect(migration).not.toContain('DROP TABLE canonical_compensation_adjustments');
    expect(migration).not.toContain('canonical_compensation_adjustments_new');
  });
});
