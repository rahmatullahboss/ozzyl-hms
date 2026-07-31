import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('live doctor compensation dual-write schema', () => {
  it('adds a tenant-scoped stable canonical source key to legacy accruals', () => {
    const migration = readFileSync('migrations/0519_live_doctor_compensation_dual_write.sql', 'utf8');
    const drizzle = readFileSync('src/db/schema/finance.ts', 'utf8');

    expect(migration).toContain('ALTER TABLE doctor_commission_accruals');
    expect(migration).toContain('ADD COLUMN canonical_source_key TEXT');
    expect(migration).toContain('uq_doctor_commission_accrual_canonical_source_key');
    expect(migration).toContain('(tenant_id, canonical_source_key)');
    expect(migration).toContain('WHERE canonical_source_key IS NOT NULL');
    expect(migration).toContain('ALTER TABLE diagnostic_performer_reserves');
    expect(migration).toContain('uq_diagnostic_performer_reserve_canonical_source_key');

    expect(drizzle).toContain("canonicalSourceKey: text('canonical_source_key')");
    expect(drizzle).toContain('uq_doctor_commission_accrual_canonical_source_key');
    expect(drizzle).toContain('uq_diagnostic_performer_reserve_canonical_source_key');
  });
});
