import { describe, expect, it } from 'vitest';
import {
  getReceptionBillPrintPath,
  getReceptionLabTestBillPrintPath,
} from './receptionBilling';

describe('reception bill print paths', () => {
  it('builds full and lab/test-only routes without duplicating the reception segment', () => {
    expect(getReceptionBillPrintPath('/h/demo', 90)).toBe('/h/demo/reception/billing/90/print');
    expect(getReceptionLabTestBillPrintPath('/h/demo', 90)).toBe('/h/demo/reception/billing/90/lab-print');
    expect(getReceptionLabTestBillPrintPath('/h/demo/reception', 90)).toBe('/h/demo/reception/billing/90/lab-print');
  });
});
