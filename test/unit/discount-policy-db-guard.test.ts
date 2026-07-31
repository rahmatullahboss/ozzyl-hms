import { describe, expect, it } from 'vitest';
import { assertDiscountReferralNameForHighDiscount } from '../../src/lib/discount-policy';

describe('discount policy guard', () => {
  it('rejects missing referral name for any applied discount', () => {
    expect(() => assertDiscountReferralNameForHighDiscount(1000, 10, '')).toThrow('Discount referred by name is required');
  });

  it('allows discount when referral name is present', () => {
    expect(() => assertDiscountReferralNameForHighDiscount(300, 200, 'Director')).not.toThrow();
  });

  it('allows no-discount bills without a referral name', () => {
    expect(() => assertDiscountReferralNameForHighDiscount(300, 0, '')).not.toThrow();
  });
});
