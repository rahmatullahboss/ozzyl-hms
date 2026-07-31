import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0538_doctor_commission_recovery_compatibility.sql', 'utf8');
const financeSchema = readFileSync('src/db/schema/finance.ts', 'utf8');
const tenantSchema = readFileSync('tenant-schema.sql', 'utf8');
const accountingProvisioning = readFileSync('src/lib/accounting-provisioning.ts', 'utf8');

describe('doctor commission recovery compatibility schema', () => {
  it('formalises the existing recovery ledger without restoring abandoned accrual identity', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS doctor_commission_adjustments');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS doctor_commission_adjustment_applications');
    expect(migration).toContain('idx_doctor_commission_adjustments_doctor_status');
    expect(migration).toContain('idx_doctor_commission_adjustment_applications_settlement');
    expect(migration).not.toContain('ALTER TABLE doctor_commission_accruals');
    expect(migration).not.toContain('accrual_key');
  });

  it('keeps Drizzle and fresh tenant schema aligned with the compatibility ledger', () => {
    expect(financeSchema).toContain("sqliteTable('doctor_commission_adjustments'");
    expect(financeSchema).toContain("sqliteTable('doctor_commission_adjustment_applications'");
    expect(tenantSchema).toContain('CREATE TABLE IF NOT EXISTS doctor_commission_adjustments');
    expect(tenantSchema).toContain('CREATE TABLE IF NOT EXISTS doctor_commission_adjustment_applications');
  });

  it('provisions every account mapping required by balanced recovery settlement posting', () => {
    expect(accountingProvisioning).toContain("doctor_advance_receivable: '7210'");
    expect(accountingProvisioning).toContain("doctor_settlement_adjustment: '5855'");
    expect(accountingProvisioning).toContain("rounding_adjustment: '5992'");
    expect(migration).toContain("'doctor_advance_receivable'");
    expect(migration).toContain("'doctor_settlement_adjustment'");
    expect(migration).toContain("'rounding_adjustment'");
  });
});
