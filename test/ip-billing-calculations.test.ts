/**
 * IP Billing — Financial Calculation Unit Tests
 *
 * Tests the billing math used in the frontend sidebar:
 * SubTotal, Discount, Billing Total, Deposit Balance,
 * ToBePaid, Tender/Change, and Net Payable calculations.
 *
 * These pure functions exist in the IPBillingPage component;
 * here we test the arithmetic independently.
 */

import { describe, it, expect } from 'vitest';

// ─── Pure Calculation Functions (mirrors IPBillingPage logic) ───────────────

function calcSubTotal(provisionalItems: { total_amount: number }[], bedCharges: { charge_amount: number }[]): number {
  const itemsTotal = provisionalItems.reduce((s, i) => s + i.total_amount, 0);
  const bedTotal = bedCharges.reduce((s, b) => s + b.charge_amount, 0);
  return itemsTotal + bedTotal;
}

function calcDiscountAmount(subTotal: number, discountPercent: number): number {
  return subTotal * (discountPercent / 100);
}

function calcBillingTotal(subTotal: number, discountPercent: number): number {
  return Math.max(0, subTotal - calcDiscountAmount(subTotal, discountPercent));
}

function calcToBePaid(billingTotal: number, depositBalance: number, useDeposit: boolean): number {
  if (!useDeposit) return billingTotal;
  return Math.max(0, billingTotal - depositBalance);
}

function calcChange(tender: number, toBePaid: number): number {
  if (tender < toBePaid) return 0;
  return tender - toBePaid;
}

function calcNetPayable(grandTotal: number, depositBalance: number): number {
  return Math.max(0, grandTotal - depositBalance);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('IP Billing Calculations', () => {

  describe('SubTotal', () => {
    it('sums provisional items and bed charges', () => {
      const items = [
        { total_amount: 500 },
        { total_amount: 1350 },
      ];
      const beds = [
        { charge_amount: 3600 },
      ];
      expect(calcSubTotal(items, beds)).toBe(5450);
    });

    it('returns 0 when no items and no bed charges', () => {
      expect(calcSubTotal([], [])).toBe(0);
    });

    it('returns only bed charges when no items', () => {
      const beds = [
        { charge_amount: 1200 },
        { charge_amount: 2400 },
      ];
      expect(calcSubTotal([], beds)).toBe(3600);
    });

    it('returns only items total when no bed charges', () => {
      const items = [
        { total_amount: 2000 },
        { total_amount: 1000 },
        { total_amount: 500 },
      ];
      expect(calcSubTotal(items, [])).toBe(3500);
    });

    it('handles single item with single bed', () => {
      expect(calcSubTotal([{ total_amount: 1000 }], [{ charge_amount: 500 }])).toBe(1500);
    });
  });

  describe('Discount Amount', () => {
    it('calculates 10% discount correctly', () => {
      expect(calcDiscountAmount(5000, 10)).toBe(500);
    });

    it('returns 0 for 0% discount', () => {
      expect(calcDiscountAmount(5000, 0)).toBe(0);
    });

    it('returns 0 for zero subTotal', () => {
      expect(calcDiscountAmount(0, 20)).toBe(0);
    });

    it('returns full amount for 100% discount', () => {
      expect(calcDiscountAmount(5000, 100)).toBe(5000);
    });

    it('handles fractional discount percents', () => {
      expect(calcDiscountAmount(1000, 7.5)).toBe(75);
    });

    it('handles large numbers without overflow', () => {
      expect(calcDiscountAmount(999999, 33.33)).toBeCloseTo(333300, -1);
    });
  });

  describe('Billing Total', () => {
    it('subtotal minus discount equals billing total', () => {
      expect(calcBillingTotal(5000, 10)).toBe(4500);
    });

    it('billing total never goes below 0', () => {
      expect(calcBillingTotal(1000, 150)).toBe(0);
    });

    it('equals subtotal when discount is 0', () => {
      expect(calcBillingTotal(3750, 0)).toBe(3750);
    });

    it('zero for zero subtotal', () => {
      expect(calcBillingTotal(0, 25)).toBe(0);
    });
  });

  describe('To Be Paid', () => {
    it('deducts deposit from billing total', () => {
      expect(calcToBePaid(5000, 2000, true)).toBe(3000);
    });

    it('returns 0 when deposit covers full amount', () => {
      expect(calcToBePaid(3000, 5000, true)).toBe(0);
    });

    it('returns full billing when deposit not used', () => {
      expect(calcToBePaid(5000, 2000, false)).toBe(5000);
    });

    it('returns full billing when deposit is 0', () => {
      expect(calcToBePaid(5000, 0, true)).toBe(5000);
    });

    it('returns 0 when both are 0', () => {
      expect(calcToBePaid(0, 0, true)).toBe(0);
    });
  });

  describe('Change / Return', () => {
    it('returns correct change when tender exceeds to be paid', () => {
      expect(calcChange(5000, 3800)).toBe(1200);
    });

    it('returns 0 when tender equals to be paid', () => {
      expect(calcChange(5000, 5000)).toBe(0);
    });

    it('returns 0 when tender is less than to be paid', () => {
      expect(calcChange(3000, 5000)).toBe(0);
    });

    it('returns 0 when to be paid is 0 and tender is 0', () => {
      expect(calcChange(0, 0)).toBe(0);
    });

    it('change is tender minus toBePaid (exact)', () => {
      expect(calcChange(10000, 7540)).toBe(2460);
    });
  });

  describe('Net Payable', () => {
    it('deducts deposit from grand total', () => {
      expect(calcNetPayable(8000, 3000)).toBe(5000);
    });

    it('returns 0 when deposit exceeds grand total', () => {
      expect(calcNetPayable(4000, 10000)).toBe(0);
    });

    it('returns grand total when deposit is 0', () => {
      expect(calcNetPayable(6500, 0)).toBe(6500);
    });
  });

  // ─── Full Billing Scenarios ──────────────────────────────────────────────

  describe('Full Billing Scenarios', () => {
    it('Scenario 1: Simple OPD-style billing (no bed, no discount, full payment)', () => {
      const items = [
        { total_amount: 500 },  // CBC
        { total_amount: 1000 }, // Consultation
      ];
      const beds: { charge_amount: number }[] = [];
      const subTotal = calcSubTotal(items, beds);               // 1500
      const discount = 0;
      const billingTotal = calcBillingTotal(subTotal, discount); // 1500
      const depositBal = 0;
      const toBePaid = calcToBePaid(billingTotal, depositBal, true); // 1500
      const tender = 2000;
      const change = calcChange(tender, toBePaid);               // 500

      expect(subTotal).toBe(1500);
      expect(billingTotal).toBe(1500);
      expect(toBePaid).toBe(1500);
      expect(change).toBe(500);
    });

    it('Scenario 2: IPD with bed charges, discount, and deposit', () => {
      const items = [
        { total_amount: 500 },
        { total_amount: 1350 },
      ];
      const beds = [{ charge_amount: 3600 }];                    // 3 days @ 1200
      const subTotal = calcSubTotal(items, beds);                // 5450
      const discount = 10;
      const billingTotal = calcBillingTotal(subTotal, discount);  // 4905
      const depositBal = 5000;
      const toBePaid = calcToBePaid(billingTotal, depositBal, true); // 0
      const netPayable = calcNetPayable(billingTotal, depositBal);   // 0

      expect(subTotal).toBe(5450);
      expect(billingTotal).toBe(4905);
      expect(toBePaid).toBe(0);
      expect(netPayable).toBe(0);
    });

    it('Scenario 3: High bill with partial deposit', () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        total_amount: 2500 + (i * 500),
      }));
      const beds = [
        { charge_amount: 15000 },  // long stay
        { charge_amount: 5000 },   // ICU
      ];
      const subTotal = calcSubTotal(items, beds);
      const discount = 5;
      const billingTotal = calcBillingTotal(subTotal, discount);
      const depositBalance = 10000;
      const toBePaid = calcToBePaid(billingTotal, depositBalance, true);
      const tender = 50000;
      const change = calcChange(tender, toBePaid);

      // items: 2500+3000+3500+...+7000 = (2500+7000)*10/2 = 47500
      expect(subTotal).toBe(47500 + 20000); // 67500
      expect(billingTotal).toBe(64125);      // 67500 - 5% = 64125
      expect(toBePaid).toBe(54125);          // 64125 - 10000
      expect(change).toBe(0);                 // 50000 < 54125
    });

    it('Scenario 4: Zero charges discharge (all covered)', () => {
      expect(calcSubTotal([], [])).toBe(0);
      expect(calcBillingTotal(0, 0)).toBe(0);
      expect(calcToBePaid(0, 0, true)).toBe(0);
      expect(calcToBePaid(0, 5000, true)).toBe(0);
    });

    it('Scenario 5: Discount of 100% should zero the bill', () => {
      const items = [{ total_amount: 10000 }];
      const beds = [{ charge_amount: 5000 }];
      const subTotal = calcSubTotal(items, beds);
      const billingTotal = calcBillingTotal(subTotal, 100);

      expect(subTotal).toBe(15000);
      expect(billingTotal).toBe(0);
    });
  });
});
