import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('billing inventory alerts', () => {
  it('returns open lab inventory exceptions with bill detail payloads', () => {
    const source = readFileSync('src/routes/tenant/billing.ts', 'utf8');
    expect(source).toContain('const reagentInventoryAlerts = await db.$client.prepare');
    expect(source).toContain('FROM lab_inventory_exceptions e');
    expect(source).toContain('reagent_inventory_alerts: reagentInventoryAlerts.results');
  });
});
