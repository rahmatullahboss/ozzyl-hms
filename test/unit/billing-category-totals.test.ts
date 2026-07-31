import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { calculateBillCategoryTotals, normalizeBillCategory } from '../../src/lib/billing-category-totals';

describe('billing category totals', () => {
  it('normalizes bill entry categories used by multiple billing routes', () => {
    expect(normalizeBillCategory('lab')).toBe('testBill');
    expect(normalizeBillCategory('radiology')).toBe('testBill');
    expect(normalizeBillCategory('doctor_visit')).toBe('doctorVisitBill');
    expect(normalizeBillCategory('bed_charge')).toBe('admissionBill');
    expect(normalizeBillCategory('procedure')).toBe('operationBill');
    expect(normalizeBillCategory('pharmacy')).toBe('medicineBill');
  });

  it('calculates the persisted bill category columns from mixed source items', () => {
    expect(calculateBillCategoryTotals([
      { category: 'test', amount: 700 },
      { category: 'radiology', amount: 1200 },
      { category: 'doctor_visit', amount: 500 },
      { category: 'bed_charge', amount: 3000 },
      { category: 'procedure', amount: 2500 },
      { category: 'medicine', amount: 250 },
      { category: 'other', amount: 999 },
    ])).toEqual({
      testBill: 1900,
      doctorVisitBill: 500,
      admissionBill: 3000,
      operationBill: 2500,
      medicineBill: 250,
    });
  });

  it('counts doctor rounds as doctor revenue without losing the line category', () => {
    expect(normalizeBillCategory('doctor_round')).toBe('doctorVisitBill');
    expect(calculateBillCategoryTotals([
      { category: 'doctor_round', amount: 700 },
    ]).doctorVisitBill).toBe(700);

    const ipBilling = readFileSync(
      new URL('../../src/routes/tenant/ipBilling.ts', import.meta.url),
      'utf8',
    );
    expect(ipBilling).toMatch(/case 'doctor_round':[\s\S]+return category/);
  });
});
