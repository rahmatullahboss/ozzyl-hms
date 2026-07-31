import { describe, it, expect } from 'vitest';
import {
  hasFeature,
  calculateMonthlyPrice,
  isTrialExpired,
  getDefaultSignupPlan,
  TRIAL_DAYS,
  PLANS,
  ADDONS
} from '../../src/schemas/pricing';

describe('Pricing Helpers', () => {
  describe('getDefaultSignupPlan', () => {
    it('returns the correct default plan configuration', () => {
      const config = getDefaultSignupPlan();

      expect(config).toEqual({
        plan: 'starter',
        trialDays: TRIAL_DAYS,
        price: 0,
      });
    });
  });

  describe('hasFeature', () => {
    it('returns true if plan includes the feature', () => {
      expect(hasFeature('starter', [], 'opd')).toBe(true);
    });

    it('returns false if plan does not include the feature', () => {
      expect(hasFeature('starter', [], 'ipd')).toBe(false);
    });

    it('returns true if enterprise plan is used', () => {
      expect(hasFeature('enterprise', [], 'any_feature_at_all')).toBe(true);
    });

    it('returns true if addon provides the feature', () => {
      expect(hasFeature('starter', ['ai'], 'ai')).toBe(true);
    });

    it('returns false if invalid plan id is provided', () => {
      expect(hasFeature('invalid' as any, [], 'opd')).toBe(false);
    });
  });

  describe('calculateMonthlyPrice', () => {
    it('calculates monthly price without addons', () => {
      const expected = PLANS.starter.priceMonthly;
      expect(calculateMonthlyPrice('starter', 'monthly')).toBe(expected);
    });

    it('calculates annual price without addons', () => {
      const expected = PLANS.starter.priceAnnual;
      expect(calculateMonthlyPrice('starter', 'annual')).toBe(expected);
    });

    it('calculates monthly price with addons', () => {
      const basePrice = PLANS.starter.priceMonthly;
      const addonPrice = ADDONS.ai.priceMonthly;
      expect(calculateMonthlyPrice('starter', 'monthly', ['ai'])).toBe(basePrice + addonPrice);
    });

    it('calculates annual price with addons', () => {
      const basePrice = PLANS.starter.priceAnnual;
      const addonPrice = ADDONS.ai.priceMonthly;
      expect(calculateMonthlyPrice('starter', 'annual', ['ai'])).toBe(basePrice + addonPrice);
    });

    it('returns 0 for invalid plan', () => {
      expect(calculateMonthlyPrice('invalid' as any, 'monthly')).toBe(0);
    });

    it('ignores invalid addons when calculating price', () => {
      const basePrice = PLANS.starter.priceMonthly;
      expect(calculateMonthlyPrice('starter', 'monthly', ['invalid' as any])).toBe(basePrice);
    });
  });

  describe('isTrialExpired', () => {
    it('returns true if trialEndsAt is null', () => {
      expect(isTrialExpired(null)).toBe(true);
    });

    it('returns true if trial has expired', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      expect(isTrialExpired(pastDate.toISOString())).toBe(true);
    });

    it('returns false if trial is still active', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      expect(isTrialExpired(futureDate.toISOString())).toBe(false);
    });
  });
});
