import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sources = {
  billingCounter: readFileSync('src/routes/tenant/billingCounter.legacy.ts', 'utf8'),
  reception: [
    readFileSync('src/routes/tenant/reception.ts', 'utf8'),
    readFileSync('src/lib/canonical/reception-visit-billing.ts', 'utf8'),
  ].join('\n'),
  appointments: [
    readFileSync('src/routes/tenant/appointments.ts', 'utf8'),
    readFileSync('src/lib/canonical/appointment-billing-finalization.ts', 'utf8'),
  ].join('\n'),
  provisional: [
    readFileSync('src/routes/tenant/billingProvisional.ts', 'utf8'),
    readFileSync('src/lib/canonical/provisional-billing-finalization.ts', 'utf8'),
  ].join('\n'),
};

describe('billing scheme audit coverage', () => {
  it.each([
    ['billing counter invoice', sources.billingCounter, 'billing_counter_invoice'],
    ['reception final visit bill', sources.reception, 'reception_visit_bill'],
    ['appointment payment', sources.appointments, 'appointment_payment'],
    ['provisional bill conversion', sources.provisional, 'provisional_bill'],
  ])('%s records allocation audit and scheme usage', (_label, source, auditSource) => {
    expect(source).toContain('INSERT INTO bill_discount_allocations');
    expect(source).toContain('recordBillingSchemeUsage');
    expect(source).toContain('schemeId');
    expect(source).toContain('schemeMemberId');
    expect(source).toContain(auditSource);
  });

  it('keeps scheme usage ledger duplicate-safe by bill and scheme', () => {
    const libSource = readFileSync('src/lib/billing-scheme-eligibility.ts', 'utf8');
    const migration = readFileSync('migrations/0390_billing_scheme_usage_idempotency.sql', 'utf8');

    expect(libSource).toContain('findBillingSchemeUsageAllocationId');
    expect(libSource).toContain("json_extract(metadata_json, '$.schemeId')");
    expect(libSource).toContain('const allocationId = params.allocationId ??');
    expect(libSource).toContain('INSERT OR IGNORE INTO billing_scheme_usage');
    expect(migration).toContain('billing_scheme_usage (tenant_id, bill_id, scheme_id)');
    expect(migration).toContain('WHERE bill_id IS NOT NULL');
  });
});
