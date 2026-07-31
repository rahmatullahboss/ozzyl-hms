import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('lab test commission eligibility contract', () => {
  it('adds an additive opt-out column and backfills Cross Matching only', () => {
    const migration = read('migrations/0520_lab_test_commission_eligibility.sql');

    expect(migration).toContain('ALTER TABLE lab_test_catalog ADD COLUMN is_commissionable');
    expect(migration).toMatch(/is_commissionable\s+INTEGER\s+NOT NULL\s+DEFAULT\s+1/i);
    expect(migration).toMatch(/CHECK\s*\(is_commissionable IN \(0, 1\)\)/i);
    expect(migration).toMatch(/UPDATE lab_test_catalog[\s\S]*crossmatching/i);
  });

  it('accepts and persists commission eligibility in catalog create and update', () => {
    const schema = read('src/schemas/lab.ts');
    const route = read('src/routes/tenant/lab.ts');

    expect(schema).toContain('is_commissionable: activeStatusSchema.optional()');
    expect(route).toContain('is_commissionable: number | null');
    expect(route).toMatch(/INSERT INTO lab_test_catalog[\s\S]*is_commissionable/);
    expect(route).toMatch(/UPDATE lab_test_catalog[\s\S]*is_commissionable = \?/);
    expect(route).toContain('normalizeActiveStatus(data.is_commissionable, 1)');
    expect(route).toContain('normalizeActiveStatus(data.is_commissionable, existing.is_commissionable)');
  });
});
