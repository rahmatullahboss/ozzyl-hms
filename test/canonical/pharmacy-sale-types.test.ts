import { describe, expect, it } from 'vitest';
import {
  pharmacyMoneyMinor,
  pharmacyTender,
  positivePharmacyQuantity,
  validatePharmacyPaymentIdentity,
} from '../../src/lib/canonical/pharmacy-sale-types';

describe('pharmacy sale contracts', () => {
  it('converts runtime currency amounts to exact minor units', () => {
    expect(pharmacyMoneyMinor(100, 'total')).toBe(10_000);
    expect(pharmacyMoneyMinor(12.34, 'total')).toBe(1_234);
    expect(() => pharmacyMoneyMinor(12.345, 'total')).toThrow(/total.*two decimal/i);
    expect(() => pharmacyMoneyMinor(-1, 'total')).toThrow(/total.*negative/i);
  });

  it('requires positive integer physical quantities for strict canonical sales', () => {
    expect(positivePharmacyQuantity(3, 'quantity')).toBe(3);
    expect(() => positivePharmacyQuantity(1.5, 'quantity')).toThrow(/quantity.*positive safe integer/i);
    expect(() => positivePharmacyQuantity(0, 'quantity')).toThrow(/quantity.*positive safe integer/i);
  });

  it('requires paid, deposit and credit portions to equal the invoice total', () => {
    expect(validatePharmacyPaymentIdentity({
      totalMinor: 10_000,
      paidMinor: 4_000,
      depositMinor: 3_000,
      creditMinor: 3_000,
    })).toEqual({ settledMinor: 7_000, dueMinor: 3_000 });
    expect(() => validatePharmacyPaymentIdentity({
      totalMinor: 10_000,
      paidMinor: 4_000,
      depositMinor: 3_000,
      creditMinor: 2_000,
    })).toThrow(/payment split/i);
  });

  it('maps legacy pharmacy payment modes to canonical tenders', () => {
    expect(pharmacyTender('cash')).toEqual({ tenderType: 'cash', methodCode: 'cash' });
    expect(pharmacyTender('card')).toEqual({ tenderType: 'card', methodCode: 'card' });
    expect(pharmacyTender('mobile')).toEqual({ tenderType: 'mobile_wallet', methodCode: 'mobile' });
    expect(pharmacyTender('credit')).toEqual({ tenderType: 'other', methodCode: 'credit' });
    expect(pharmacyTender('deposit')).toEqual({ tenderType: 'other', methodCode: 'deposit' });
  });
});
