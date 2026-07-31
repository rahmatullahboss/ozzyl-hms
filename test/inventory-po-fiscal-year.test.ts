import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/tenant/inventory/po.ts', 'utf8');

describe('inventory purchase order draft fiscal year', () => {
  it('uses the tenant active fiscal year for new PO drafts', () => {
    expect(source).toContain("import { getActiveFiscalYear } from '../../../lib/fiscal-year';");
    expect(source).toContain('const activeFy = await getActiveFiscalYear(c.env.DB, tenantId!, today);');
    expect(source).toContain('nextDraftNo, activeFy?.id || 1, body.VendorId');
  });

  it('does not hardcode fiscal year id before vendor details in the PO draft insert', () => {
    expect(source).not.toContain('nextDraftNo, 1, body.VendorId');
  });
});
