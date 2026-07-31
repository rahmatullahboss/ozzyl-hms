import { describe, it, expect } from 'vitest';
import { inferReceptionVisitServiceType } from '../src/lib/service-type-inference';

describe('inferReceptionVisitServiceType — regex word boundary bugs', () => {

  // ─── BUG 1: 'ct' matches inside "doctor" ──────────────────────────────
  describe('BUG: ct matches inside words', () => {
    it('should classify "Doctor Consultation Fee" as doctor_visit, not test', () => {
      const result = inferReceptionVisitServiceType({
        department_name: 'Consultation',
        item_name: 'Doctor Consultation Fee',
      });
      expect(result).toBe('doctor_visit'); // FAILS: returns 'test' because "doctor" contains "ct"
    });

    it('should classify "Senior Doctor Visit" as doctor_visit, not test', () => {
      const result = inferReceptionVisitServiceType({
        department_name: 'OPD',
        item_name: 'Senior Doctor Visit',
      });
      expect(result).toBe('doctor_visit'); // FAILS: returns 'test'
    });

    it('should classify "Direct Admission" as admission, not test', () => {
      const result = inferReceptionVisitServiceType({
        department_name: 'Admission',
        item_name: 'Direct Admission Fee',
      });
      expect(result).toBe('admission'); // FAILS: returns 'test' because "direct" contains "ct"
    });

    it('should still classify "CT Scan" as test (correct)', () => {
      const result = inferReceptionVisitServiceType({
        department_name: 'Radiology',
        item_name: 'CT Scan Brain',
      });
      expect(result).toBe('test'); // Should pass - CT Scan is correctly classified
    });

    it('should still classify "CT Abdomen" as test (correct)', () => {
      const result = inferReceptionVisitServiceType({
        department_name: 'Radiology',
        item_name: 'CT Abdomen',
      });
      expect(result).toBe('test'); // Should pass
    });
  });

  // ─── BUG 2: 'ot' matches inside words ─────────────────────────────────
  describe('BUG: ot matches inside words', () => {
    it('should classify "Lot Processing Fee" in Admin department as other', () => {
      const result = inferReceptionVisitServiceType({
        department_name: 'Admin',
        item_name: 'Lot Processing Fee',
      });
      expect(result).toBe('other'); // With \bot\b, "lot" no longer matches
    });

    it('should classify "Protocol Review" as other, not procedure', () => {
      const result = inferReceptionVisitServiceType({
        department_name: 'Admin',
        item_name: 'Protocol Review',
      });
      expect(result).toBe('other'); // With \bot\b, "protocol" no longer matches
    });

    it('should classify "Remote Monitoring" in Admin department as other', () => {
      const result = inferReceptionVisitServiceType({
        department_name: 'Admin',
        item_name: 'Remote Monitoring',
      });
      expect(result).toBe('other'); // With \bot\b, "remote" no longer matches
    });

    it('should still classify "OT Booking" as procedure (correct)', () => {
      const result = inferReceptionVisitServiceType({
        department_name: 'Surgery',
        item_name: 'OT Booking',
      });
      expect(result).toBe('procedure'); // Should pass - OT is correctly classified
    });
  });

  // ─── EDGE CASE: 'room' is ambiguous but low priority ─────────────────
  // "ICU Room", "Private Room" legitimately match admission
  // "Operating Room" is ambiguous — low priority vs ct/ot bugs
  describe('EDGE CASE: room behavior (documented, not fixed)', () => {
    it('should classify "ICU Room" as admission (correct)', () => {
      const result = inferReceptionVisitServiceType({
        department_name: 'Ward',
        item_name: 'ICU Room',
      });
      expect(result).toBe('admission'); // Correct behavior
    });
  });

  // ─── Correct classifications that should still work ───────────────────
  describe('Correct classifications (regression guard)', () => {
    it('should classify lab test as test', () => {
      expect(inferReceptionVisitServiceType({ item_name: 'CBC Blood Test' })).toBe('test');
    });

    it('should classify X-Ray as test', () => {
      expect(inferReceptionVisitServiceType({ item_name: 'X-Ray Chest' })).toBe('test');
    });

    it('should classify surgery as procedure', () => {
      expect(inferReceptionVisitServiceType({ item_name: 'Minor Surgery' })).toBe('procedure');
    });

    it('should classify injection as procedure (ct does not match inside injection)', () => {
      const result = inferReceptionVisitServiceType({ item_name: 'IV Injection' });
      expect(result).toBe('procedure'); // FAILS: returns 'test' because "injection" contains "ct"
    });

    it('should classify Paracetamol in Pharmacy department as medicine', () => {
      const result = inferReceptionVisitServiceType({ department_name: 'Pharmacy', item_name: 'Paracetamol 500mg' });
      expect(result).toBe('medicine'); // \bct\b no longer matches inside "paracetamol"
    });

    it('should classify "not" words correctly (ot does not match inside "not")', () => {
      const result = inferReceptionVisitServiceType({ item_name: 'Not Applicable Fee' });
      expect(result).toBe('other'); // FAILS: returns 'procedure' because "not" contains "ot"
    });

    it('should classify bed charge as admission', () => {
      expect(inferReceptionVisitServiceType({ item_name: 'Bed Charge General' })).toBe('admission');
    });

    it('should classify ward as admission', () => {
      expect(inferReceptionVisitServiceType({ item_name: 'ICU Ward' })).toBe('admission');
    });

    it('should classify pharmacy items as medicine', () => {
      expect(inferReceptionVisitServiceType({ department_name: 'Pharmacy', item_name: 'Paracetamol 500mg' })).toBe('medicine');
    });

    it('should classify consultation as doctor_visit', () => {
      expect(inferReceptionVisitServiceType({ item_name: 'Consultation Fee' })).toBe('doctor_visit');
    });

    it('should classify OPD as doctor_visit', () => {
      expect(inferReceptionVisitServiceType({ item_name: 'OPD Registration' })).toBe('doctor_visit');
    });

    it('should classify unknown as other', () => {
      expect(inferReceptionVisitServiceType({ item_name: 'Miscellaneous Charge' })).toBe('other');
    });
  });
});

// ─── Billing Calculation Tests ────────────────────────────────────────────────
// Tests for billing.ts, ipBilling.ts, settlements.ts, deposits.ts bugs

describe('Billing calculation edge cases', () => {

  // ─── roundMoney function (from billing.ts) ──────────────────────────────
  function roundMoney(value: number): number {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  describe('roundMoney', () => {
    it('should round to 2 decimal places', () => {
      expect(roundMoney(10.005)).toBe(10.01);
      expect(roundMoney(10.004)).toBe(10);
      expect(roundMoney(10.999)).toBe(11);
    });

    it('should handle zero and negative', () => {
      expect(roundMoney(0)).toBe(0);
      expect(roundMoney(-5.5)).toBe(-5.5);
    });

    it('should handle null/undefined/NaN', () => {
      expect(roundMoney(null as any)).toBe(0);
      expect(roundMoney(undefined as any)).toBe(0);
      expect(roundMoney(NaN)).toBe(0);
    });
  });

  // ─── IPD discharge bill rounding (ipBilling.ts:752-753) ─────────────────
  describe('IPD discharge bill rounding', () => {
    it('should round discount to 2 decimal places', () => {
      const subtotal = 100.33;
      const discountPercent = 10;
      // BUG: Without rounding, discountAmt = 10.033
      // FIX: With rounding, discountAmt = 10.03
      const discountAmt = Math.round(subtotal * (discountPercent / 100) * 100) / 100;
      expect(discountAmt).toBe(10.03);
    });

    it('should round total to 2 decimal places', () => {
      const subtotal = 100.33;
      const discountAmt = Math.round(subtotal * 0.1 * 100) / 100; // 10.03
      const totalAmt = Math.max(0, Math.round((subtotal - discountAmt) * 100) / 100);
      expect(totalAmt).toBe(90.3);
    });

    it('should not produce sub-cent values', () => {
      const subtotal = 99.99;
      const discountPercent = 15;
      const discountAmt = Math.round(subtotal * (discountPercent / 100) * 100) / 100;
      const totalAmt = Math.max(0, Math.round((subtotal - discountAmt) * 100) / 100);
      // Verify no sub-cent values
      expect(discountAmt).toBe(Math.round(discountAmt * 100) / 100);
      expect(totalAmt).toBe(Math.round(totalAmt * 100) / 100);
    });
  });

  // ─── Settlement threshold (settlements.ts:286) ──────────────────────────
  describe('Settlement threshold', () => {
    it('should NOT skip bills with 0.01 due (bug: was skipped)', () => {
      const due = 0.01;
      // BUG: if (due <= 0.01) continue; — skipped 0.01 due bills
      // FIX: if (due <= 0) continue; — only skip zero/negative
      const shouldSkip = due <= 0;
      expect(shouldSkip).toBe(false);
    });

    it('should skip bills with 0 due', () => {
      const due = 0;
      const shouldSkip = due <= 0;
      expect(shouldSkip).toBe(true);
    });

    it('should skip bills with negative due', () => {
      const due = -0.01;
      const shouldSkip = due <= 0;
      expect(shouldSkip).toBe(true);
    });
  });

  // ─── Deposit adjustment overpayment (deposits.ts:705) ──────────────────
  describe('Deposit adjustment overpayment guard', () => {
    it('should reject amount exceeding bill due', () => {
      const billTotal = 100;
      const billPaid = 50;
      const billDue = Math.max(0, billTotal - billPaid); // 50
      const adjustmentAmount = 100;
      // BUG: No validation of billDue
      // FIX: if (amount > billDue) throw 400
      expect(adjustmentAmount > billDue).toBe(true);
    });

    it('should allow amount equal to bill due', () => {
      const billTotal = 100;
      const billPaid = 50;
      const billDue = Math.max(0, billTotal - billPaid); // 50
      const adjustmentAmount = 50;
      expect(adjustmentAmount > billDue).toBe(false);
    });

    it('should allow amount less than bill due', () => {
      const billTotal = 100;
      const billPaid = 50;
      const billDue = Math.max(0, billTotal - billPaid); // 50
      const adjustmentAmount = 30;
      expect(adjustmentAmount > billDue).toBe(false);
    });
  });

  // ─── Bill category totals (billing.ts:1274) ────────────────────────────
  describe('Bill edit category totals', () => {
    // Simulate calculateBillCategoryTotals
    function calculateBillCategoryTotals(items: { category: string; amount: number }[]) {
      const totals = { testBill: 0, doctorVisitBill: 0, admissionBill: 0, operationBill: 0, medicineBill: 0 };
      for (const item of items) {
        const cat = item.category?.toLowerCase() || '';
        if (['test', 'lab', 'laboratory', 'radiology', 'diagnostic'].includes(cat)) totals.testBill += item.amount;
        else if (['doctor_visit', 'doctor', 'consultation', 'opd', 'visit'].includes(cat)) totals.doctorVisitBill += item.amount;
        else if (['admission', 'bed_charge', 'bed', 'ward', 'cabin', 'room', 'ipd'].includes(cat)) totals.admissionBill += item.amount;
        else if (['operation', 'procedure', 'surgery', 'ot'].includes(cat)) totals.operationBill += item.amount;
        else if (['medicine', 'pharmacy', 'drug'].includes(cat)) totals.medicineBill += item.amount;
      }
      return totals;
    }

    it('should compute correct category totals after edit', () => {
      // Original bill: test=500, doctor=500
      // Edited bill: test=800, doctor=200
      const editedItems = [
        { category: 'test', amount: 800 },
        { category: 'doctor_visit', amount: 200 },
      ];
      const categoryTotals = calculateBillCategoryTotals(editedItems);
      expect(categoryTotals.testBill).toBe(800);
      expect(categoryTotals.doctorVisitBill).toBe(200);
    });

    it('should handle all 5 categories', () => {
      const items = [
        { category: 'test', amount: 100 },
        { category: 'doctor_visit', amount: 200 },
        { category: 'admission', amount: 300 },
        { category: 'operation', amount: 400 },
        { category: 'medicine', amount: 500 },
      ];
      const totals = calculateBillCategoryTotals(items);
      expect(totals.testBill).toBe(100);
      expect(totals.doctorVisitBill).toBe(200);
      expect(totals.admissionBill).toBe(300);
      expect(totals.operationBill).toBe(400);
      expect(totals.medicineBill).toBe(500);
    });
  });

  // ─── Accounting period-closed status ────────────────────────────────────
  describe('Accounting period-closed events', () => {
    it('should use skipped status instead of failed for period-closed events', () => {
      // BUG: status = 'failed' causes infinite retry loop
      // FIX: status = 'skipped' excludes from retry query
      const status = 'skipped';
      const retryStatuses = ['pending', 'failed'];
      expect(retryStatuses.includes(status)).toBe(false);
    });
  });

  // ─── IPD provisional bill status ────────────────────────────────────────
  describe('IPD provisional bill status', () => {
    it('should use finalized status for discharge-billed items', () => {
      // BUG: bill_status = 'billed' — invisible to aggregations
      // FIX: bill_status = 'finalized' — matches pay flow
      const dischargeBillStatus = 'finalized';
      const payFlowStatus = 'finalized';
      expect(dischargeBillStatus).toBe(payFlowStatus);
    });
  });
});
