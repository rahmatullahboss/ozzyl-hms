import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/tenant/billingCounter.legacy.ts', 'utf8');

describe('billing counter reagent policy enforcement', () => {
  it('loads one policy and blocks billing-time reagent failures only in strict mode', () => {
    const helperStart = source.indexOf('async function consumeBillingCounterLabOrderReagents');
    const helperEnd = source.indexOf('\nfunction resolveReferredByType', helperStart);
    const helper = source.slice(helperStart, helperEnd);

    expect(helper).toContain('const labInventoryPolicy = await getLabInventoryPolicy');
    expect(helper).toContain("labInventoryPolicy.reagent_consumption_timing !== 'billing'");
    expect(helper).toContain("shouldBlockLabInventoryException(labInventoryPolicy, 'billing')");

    const blockIndex = helper.indexOf("shouldBlockLabInventoryException(labInventoryPolicy, 'billing')");
    const warningIndex = helper.indexOf('warnings.push');
    expect(blockIndex).toBeGreaterThan(0);
    expect(warningIndex).toBeGreaterThan(blockIndex);
  });
});
