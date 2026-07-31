import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MedicineDispensing', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./MedicineDispensing');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('uses one optional hospital fulfilment command rather than mutating clinical prescription state', () => {
    const source = readFileSync('src/pages/MedicineDispensing.tsx', 'utf8');
    expect(source).toContain('/hospital-dispense');
    expect(source).toContain('optional');
    expect(source).toContain('paymentMethod');
    expect(source).toContain('Payment received by');
    expect(source).not.toContain('unitPrice: med.price');
    expect(source).not.toContain("api.post('/api/pharmacy/sales'");
    expect(source).not.toContain('dispense_status:');
  });
});
