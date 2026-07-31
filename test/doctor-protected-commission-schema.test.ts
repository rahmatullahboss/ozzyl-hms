import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0539_doctor_protected_commission_floor.sql', 'utf8');
const financeSchema = readFileSync('src/db/schema/finance.ts', 'utf8');
const tenantSchema = readFileSync('tenant-schema.sql', 'utf8');

describe('doctor protected commission schema', () => {
  it('adds legacy rule policy and immutable accrual snapshot columns', () => {
    expect(migration).toContain('ALTER TABLE doctor_commission_rules ADD COLUMN waiver_policy');
    expect(migration).toContain("DEFAULT 'full_earned'");
    expect(migration).toContain('ALTER TABLE doctor_commission_rules ADD COLUMN protected_rate_bps');
    expect(migration).toContain('ALTER TABLE doctor_commission_rules ADD COLUMN protected_flat_amount');
    expect(migration).toContain('ALTER TABLE doctor_commission_accruals ADD COLUMN protected_commission_amount');
    expect(migration).toContain('ALTER TABLE doctor_commission_accruals ADD COLUMN maximum_waiver_amount');
    expect(migration).toContain('ALTER TABLE doctor_commission_accruals ADD COLUMN requested_waiver_amount');
  });

  it('adds matching canonical rule and accrual projection columns', () => {
    expect(migration).toContain('ALTER TABLE canonical_compensation_rules ADD COLUMN waiver_policy');
    expect(migration).toContain('ALTER TABLE canonical_compensation_rules ADD COLUMN protected_rate_value');
    expect(migration).toContain('ALTER TABLE canonical_compensation_accruals ADD COLUMN protected_minor');
    expect(migration).toContain('ALTER TABLE canonical_compensation_accruals ADD COLUMN waiver_capacity_minor');
    expect(migration).toContain('ALTER TABLE canonical_compensation_accruals ADD COLUMN requested_waiver_minor');
    expect(migration).toContain('ALTER TABLE canonical_compensation_accruals ADD COLUMN hospital_funded_overflow_minor');
  });

  it('keeps Drizzle and the fresh tenant schema aligned', () => {
    for (const column of [
      'waiverPolicy',
      'protectedRateBps',
      'protectedFlatAmount',
      'protectedCommissionAmount',
      'maximumWaiverAmount',
      'requestedWaiverAmount',
      'hospitalFundedOverflowAmount',
    ]) {
      expect(financeSchema).toContain(column);
    }
    expect(tenantSchema).toContain('waiver_policy TEXT NOT NULL DEFAULT \'full_earned\'');
    expect(tenantSchema).toContain('protected_commission_amount REAL NOT NULL DEFAULT 0');
  });
});
