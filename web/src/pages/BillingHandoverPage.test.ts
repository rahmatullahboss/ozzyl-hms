import { describe, expect, it } from 'vitest';
import { getRemainingAdminCashAmount } from './BillingHandoverPage';

describe('BillingHandoverPage', () => {
  it('can be imported without error', async () => {
    const mod = await import('./BillingHandoverPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('uses remaining due for partial/disputed rows and total for untouched rows', () => {
    expect(getRemainingAdminCashAmount({ status: 'partial', handoverAmount: 1000, dueAmount: 250 })).toBe(250);
    expect(getRemainingAdminCashAmount({ status: 'disputed', handoverAmount: 1000, dueAmount: -50 })).toBe(0);
    expect(getRemainingAdminCashAmount({ status: 'pending', handoverAmount: 1000, dueAmount: 0 })).toBe(1000);
  });
});
