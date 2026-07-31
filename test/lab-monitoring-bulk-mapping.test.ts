import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('lab monitoring bulk reagent mapping import', () => {
  it('registers the bulk mapping endpoint and upsert summary payload', () => {
    const source = readFileSync('src/routes/tenant/labMonitoring.ts', 'utf8');
    expect(source).toContain("labMonitoring.post('/test-consumable-map/bulk'");
    expect(source).toContain('bulkTestConsumableMapSchema');
    expect(source).toContain('Bulk mapping import completed');
    expect(source).toContain('duplicate_in_payload');
  });
});
