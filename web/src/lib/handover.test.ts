import { describe, expect, it } from 'vitest';

import { getIpdRunningBillPrintPath, getRoleBasePath } from './handover';

describe('handover route helpers', () => {
  it('builds IPD running bill print paths on authenticated app routes', () => {
    const receptionBasePath = getRoleBasePath('demo-hospital', 'reception');
    expect(getIpdRunningBillPrintPath(receptionBasePath, 13051)).toBe('/h/demo-hospital/reception/ip-billing/13051/running-print');
    expect(getIpdRunningBillPrintPath('/h/demo-hospital', 13051)).toBe('/h/demo-hospital/ip-billing/13051/running-print');
    expect(getIpdRunningBillPrintPath(receptionBasePath, 13051)).not.toContain('/api/');
  });
});
