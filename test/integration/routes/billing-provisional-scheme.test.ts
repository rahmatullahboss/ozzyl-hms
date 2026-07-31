import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('billing provisional scheme benefits', () => {
  it('validates and records scheme usage only when provisional pay sends schemeApplication', () => {
    const source = readFileSync('src/routes/tenant/billingProvisional.ts', 'utf8');
    const adapter = readFileSync('src/lib/canonical/provisional-billing-finalization.ts', 'utf8');

    expect(source).toContain('schemeApplication: provisionalSchemeApplicationSchema.optional()');
    expect(source).toContain('evaluateBillingSchemeEligibility(c.env.DB');
    expect(source).toContain('Scheme discount exceeds eligible scheme cap.');
    expect(adapter).toContain('INSERT INTO bill_discount_allocations');
    expect(source).toContain('recordBillingSchemeUsage(c.env.DB');
    expect(source).toContain("serviceCategory: data.schemeApplication.serviceCategory ?? 'provisional_bill'");
  });

  it('keeps scheme usage idempotent at bill level', () => {
    const libSource = readFileSync('src/lib/billing-scheme-eligibility.ts', 'utf8');
    const migration = readFileSync('migrations/0390_billing_scheme_usage_idempotency.sql', 'utf8');

    expect(libSource).toContain('INSERT OR IGNORE INTO billing_scheme_usage');
    expect(migration).toContain('idx_billing_scheme_usage_bill_scheme_unique');
    expect(migration).toContain('WHERE bill_id IS NOT NULL');
  });
});
