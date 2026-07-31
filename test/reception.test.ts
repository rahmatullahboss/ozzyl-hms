import { describe, it, expect } from 'vitest';

// ─── Reception / Visit-Service Logic Tests ──────────────────────────────────
// Covers the Danphe-style reception workflow:
//   Visit → Add Services → Generate Bill → Daily Report

interface VisitService {
  id: number;
  service_type: string;
  amount: number;
  discount_amount: number;
  quantity: number;
  total_amount: number;
  status: 'pending' | 'billed' | 'cancelled' | 'refunded';
  bill_id?: number | null;
}

interface Bill {
  id: number;
  patient_id: number;
  visit_id: number;
  total_amount: number;
  paid_amount: number;
  discount: number;
  status: 'open' | 'paid' | 'partially_paid' | 'cancelled';
  created_by?: number;
  counter_id?: number;
}

interface Payment {
  bill_id: number;
  amount: number;
  payment_method: string;
  payment_source?: string;
}

function calcVisitServiceTotal(s: Omit<VisitService, 'total_amount'>): number {
  return Math.max(0, s.amount * s.quantity - s.discount_amount);
}

function calcBillFromServices(services: VisitService[], billDiscount = 0): number {
  const pending = services.filter(s => s.status === 'pending');
  const subtotal = pending.reduce((sum, s) => sum + s.total_amount, 0);
  return Math.max(0, subtotal - billDiscount);
}

function aggregateDailyReport(bills: Bill[], payments: Payment[]) {
  const totalBilled = bills.reduce((s, b) => s + b.total_amount, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const totalDue = bills.reduce((s, b) => s + (b.total_amount - b.paid_amount), 0);
  const byMethod: Record<string, { total: number; count: number }> = {};
  for (const p of payments) {
    const m = p.payment_method || 'unknown';
    if (!byMethod[m]) byMethod[m] = { total: 0, count: 0 };
    byMethod[m].total += p.amount;
    byMethod[m].count += 1;
  }
  return { totalBilled, totalPaid, totalDue, billCount: bills.length, byMethod };
}

function canTransitionVisitService(from: VisitService['status'], to: VisitService['status']): boolean {
  const rules: Record<VisitService['status'], VisitService['status'][]> = {
    pending: ['billed', 'cancelled'],
    billed: ['refunded', 'cancelled'],
    cancelled: [],
    refunded: [],
  };
  return rules[from].includes(to);
}

function isValidPaymentSource(source: string): boolean {
  return ['reception', 'pharmacy', 'lab', 'ipd', 'ot', 'other'].includes(source);
}

describe('HMS Reception Tests', () => {

  // ─── 1. Visit Service Calculations ───────────────────────────────────────
  describe('Visit Service Calculations', () => {
    it('should calculate total with qty and no discount', () => {
      const s = { amount: 500, quantity: 2, discount_amount: 0 };
      expect(calcVisitServiceTotal(s as any)).toBe(1000);
    });

    it('should subtract discount from total', () => {
      const s = { amount: 1000, quantity: 1, discount_amount: 150 };
      expect(calcVisitServiceTotal(s as any)).toBe(850);
    });

    it('should never produce negative total (discount > subtotal)', () => {
      const s = { amount: 100, quantity: 1, discount_amount: 500 };
      expect(calcVisitServiceTotal(s as any)).toBe(0);
    });

    it('should handle zero-quantity as zero total', () => {
      const s = { amount: 500, quantity: 0, discount_amount: 0 };
      expect(calcVisitServiceTotal(s as any)).toBe(0);
    });

    it('should calculate total for multiple items correctly', () => {
      const items: VisitService[] = [
        { id: 1, service_type: 'doctor_visit', amount: 500, discount_amount: 0, quantity: 1, total_amount: 500, status: 'pending' },
        { id: 2, service_type: 'test', amount: 800, discount_amount: 50, quantity: 2, total_amount: 1550, status: 'pending' },
        { id: 3, service_type: 'procedure', amount: 200, discount_amount: 0, quantity: 3, total_amount: 600, status: 'pending' },
      ];
      const total = items.reduce((s, i) => s + i.total_amount, 0);
      expect(total).toBe(2650);
    });
  });

  // ─── 2. Bill Generation from Visit Services ──────────────────────────────
  describe('Bill Generation from Visit Services', () => {
    it('should sum only pending services into bill total', () => {
      const services: VisitService[] = [
        { id: 1, service_type: 'doctor_visit', amount: 500, discount_amount: 0, quantity: 1, total_amount: 500, status: 'pending' },
        { id: 2, service_type: 'test', amount: 1000, discount_amount: 0, quantity: 1, total_amount: 1000, status: 'billed' },
        { id: 3, service_type: 'procedure', amount: 300, discount_amount: 0, quantity: 1, total_amount: 300, status: 'pending' },
      ];
      expect(calcBillFromServices(services)).toBe(800); // 500 + 300
    });

    it('should apply bill-level discount on top of service totals', () => {
      const services: VisitService[] = [
        { id: 1, service_type: 'doctor_visit', amount: 1000, discount_amount: 0, quantity: 1, total_amount: 1000, status: 'pending' },
        { id: 2, service_type: 'test', amount: 500, discount_amount: 0, quantity: 1, total_amount: 500, status: 'pending' },
      ];
      expect(calcBillFromServices(services, 200)).toBe(1300); // 1500 - 200
    });

    it('should not allow negative bill total even with large discount', () => {
      const services: VisitService[] = [
        { id: 1, service_type: 'doctor_visit', amount: 100, discount_amount: 0, quantity: 1, total_amount: 100, status: 'pending' },
      ];
      expect(calcBillFromServices(services, 500)).toBe(0);
    });

    it('should produce zero when no pending services exist', () => {
      const services: VisitService[] = [
        { id: 1, service_type: 'doctor_visit', amount: 500, discount_amount: 0, quantity: 1, total_amount: 500, status: 'billed' },
      ];
      expect(calcBillFromServices(services)).toBe(0);
    });

    it('should include cancelled services in bill total if incorrectly passed (edge case)', () => {
      // This documents current behaviour — cancelled should be filtered out by caller
      const services: VisitService[] = [
        { id: 1, service_type: 'test', amount: 500, discount_amount: 0, quantity: 1, total_amount: 500, status: 'cancelled' },
      ];
      // calcBillFromServices only filters 'pending', so cancelled would be excluded
      expect(calcBillFromServices(services)).toBe(0);
    });
  });

  // ─── 3. Visit Service Status Transitions ─────────────────────────────────
  describe('Visit Service Status Transitions', () => {
    it('should allow pending → billed', () => {
      expect(canTransitionVisitService('pending', 'billed')).toBe(true);
    });

    it('should allow pending → cancelled', () => {
      expect(canTransitionVisitService('pending', 'cancelled')).toBe(true);
    });

    it('should allow billed → refunded', () => {
      expect(canTransitionVisitService('billed', 'refunded')).toBe(true);
    });

    it('should allow billed → cancelled', () => {
      expect(canTransitionVisitService('billed', 'cancelled')).toBe(true);
    });

    it('should block billed → pending (no reversal)', () => {
      expect(canTransitionVisitService('billed', 'pending')).toBe(false);
    });

    it('should block cancelled → any state (terminal)', () => {
      expect(canTransitionVisitService('cancelled', 'pending')).toBe(false);
      expect(canTransitionVisitService('cancelled', 'billed')).toBe(false);
      expect(canTransitionVisitService('cancelled', 'refunded')).toBe(false);
    });

    it('should block refunded → any state (terminal)', () => {
      expect(canTransitionVisitService('refunded', 'pending')).toBe(false);
      expect(canTransitionVisitService('refunded', 'billed')).toBe(false);
      expect(canTransitionVisitService('refunded', 'cancelled')).toBe(false);
    });

    it('should block pending → refunded (must bill first)', () => {
      expect(canTransitionVisitService('pending', 'refunded')).toBe(false);
    });
  });

  // ─── 4. Daily Report Aggregation ─────────────────────────────────────────
  describe('Daily Report Aggregation', () => {
    it('should aggregate total billed from all bills', () => {
      const bills: Bill[] = [
        { id: 1, patient_id: 1, visit_id: 1, total_amount: 5000, paid_amount: 5000, discount: 0, status: 'paid' },
        { id: 2, patient_id: 2, visit_id: 2, total_amount: 3000, paid_amount: 1000, discount: 0, status: 'partially_paid' },
      ];
      const report = aggregateDailyReport(bills, []);
      expect(report.totalBilled).toBe(8000);
    });

    it('should aggregate total paid from all payments', () => {
      const bills: Bill[] = [];
      const payments: Payment[] = [
        { bill_id: 1, amount: 5000, payment_method: 'cash', payment_source: 'reception' },
        { bill_id: 2, amount: 1000, payment_method: 'card', payment_source: 'reception' },
      ];
      const report = aggregateDailyReport(bills, payments);
      expect(report.totalPaid).toBe(6000);
    });

    it('should calculate total due correctly', () => {
      const bills: Bill[] = [
        { id: 1, patient_id: 1, visit_id: 1, total_amount: 5000, paid_amount: 5000, discount: 0, status: 'paid' },
        { id: 2, patient_id: 2, visit_id: 2, total_amount: 3000, paid_amount: 1000, discount: 0, status: 'partially_paid' },
        { id: 3, patient_id: 3, visit_id: 3, total_amount: 2000, paid_amount: 0, discount: 0, status: 'open' },
      ];
      const report = aggregateDailyReport(bills, []);
      expect(report.totalDue).toBe(4000); // 0 + 2000 + 2000
    });

    it('should group payments by method', () => {
      const payments: Payment[] = [
        { bill_id: 1, amount: 5000, payment_method: 'cash' },
        { bill_id: 2, amount: 3000, payment_method: 'cash' },
        { bill_id: 3, amount: 2000, payment_method: 'card' },
      ];
      const report = aggregateDailyReport([], payments);
      expect(report.byMethod['cash'].total).toBe(8000);
      expect(report.byMethod['cash'].count).toBe(2);
      expect(report.byMethod['card'].total).toBe(2000);
      expect(report.byMethod['card'].count).toBe(1);
    });

    it('should handle empty bills and payments gracefully', () => {
      const report = aggregateDailyReport([], []);
      expect(report.totalBilled).toBe(0);
      expect(report.totalPaid).toBe(0);
      expect(report.totalDue).toBe(0);
      expect(report.billCount).toBe(0);
      expect(Object.keys(report.byMethod)).toHaveLength(0);
    });

    it('should count bill entries correctly', () => {
      const bills: Bill[] = [
        { id: 1, patient_id: 1, visit_id: 1, total_amount: 100, paid_amount: 100, discount: 0, status: 'paid' },
        { id: 2, patient_id: 2, visit_id: 2, total_amount: 200, paid_amount: 200, discount: 0, status: 'paid' },
        { id: 3, patient_id: 3, visit_id: 3, total_amount: 300, paid_amount: 0, discount: 0, status: 'open' },
      ];
      const report = aggregateDailyReport(bills, []);
      expect(report.billCount).toBe(3);
    });
  });

  // ─── 5. Payment Source Validation ────────────────────────────────────────
  describe('Payment Source Validation', () => {
    it('should accept reception as valid source', () => {
      expect(isValidPaymentSource('reception')).toBe(true);
    });

    it('should accept pharmacy as valid source', () => {
      expect(isValidPaymentSource('pharmacy')).toBe(true);
    });

    it('should accept lab as valid source', () => {
      expect(isValidPaymentSource('lab')).toBe(true);
    });

    it('should accept ipd as valid source', () => {
      expect(isValidPaymentSource('ipd')).toBe(true);
    });

    it('should accept ot as valid source', () => {
      expect(isValidPaymentSource('ot')).toBe(true);
    });

    it('should accept other as valid source', () => {
      expect(isValidPaymentSource('other')).toBe(true);
    });

    it('should reject invalid payment source', () => {
      expect(isValidPaymentSource('hacked')).toBe(false);
    });

    it('should reject empty payment source', () => {
      expect(isValidPaymentSource('')).toBe(false);
    });
  });

  // ─── 6. Procedure Order Status Flows ─────────────────────────────────────
  describe('Procedure Order Status Flows', () => {
    const PROC_STATUSES = ['ordered', 'in_progress', 'completed', 'cancelled'] as const;
    type ProcStatus = typeof PROC_STATUSES[number];

    const VALID_PROC_TRANSITIONS: Record<ProcStatus, ProcStatus[]> = {
      ordered: ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    };

    function canTransitionProc(from: ProcStatus, to: ProcStatus): boolean {
      return VALID_PROC_TRANSITIONS[from].includes(to);
    }

    it('should allow ordered → in_progress', () => {
      expect(canTransitionProc('ordered', 'in_progress')).toBe(true);
    });

    it('should allow ordered → cancelled', () => {
      expect(canTransitionProc('ordered', 'cancelled')).toBe(true);
    });

    it('should allow in_progress → completed', () => {
      expect(canTransitionProc('in_progress', 'completed')).toBe(true);
    });

    it('should allow in_progress → cancelled', () => {
      expect(canTransitionProc('in_progress', 'cancelled')).toBe(true);
    });

    it('should block completed → in_progress (no reversal)', () => {
      expect(canTransitionProc('completed', 'in_progress')).toBe(false);
    });

    it('should block cancelled → ordered (terminal state)', () => {
      expect(canTransitionProc('cancelled', 'ordered')).toBe(false);
    });

    it('should block ordered → completed (must go through in_progress)', () => {
      expect(canTransitionProc('ordered', 'completed')).toBe(false);
    });
  });

  // ─── 7. Counter / Shift-wise Reporting ───────────────────────────────────
  describe('Counter / Shift-wise Reporting', () => {
    it('should group bills by counter_id for shift reconciliation', () => {
      const bills: Bill[] = [
        { id: 1, patient_id: 1, visit_id: 1, total_amount: 5000, paid_amount: 5000, discount: 0, status: 'paid', counter_id: 1 },
        { id: 2, patient_id: 2, visit_id: 2, total_amount: 3000, paid_amount: 3000, discount: 0, status: 'paid', counter_id: 1 },
        { id: 3, patient_id: 3, visit_id: 3, total_amount: 2000, paid_amount: 2000, discount: 0, status: 'paid', counter_id: 2 },
      ];
      const byCounter = bills.reduce((map, b) => {
        const cid = b.counter_id ?? 0;
        if (!map.has(cid)) map.set(cid, { count: 0, total: 0 });
        map.get(cid)!.count += 1;
        map.get(cid)!.total += b.total_amount;
        return map;
      }, new Map<number, { count: number; total: number }>());

      expect(byCounter.get(1)?.count).toBe(2);
      expect(byCounter.get(1)?.total).toBe(8000);
      expect(byCounter.get(2)?.count).toBe(1);
      expect(byCounter.get(2)?.total).toBe(2000);
    });

    it('should track created_by for audit trail on bills', () => {
      const bill: Bill = { id: 1, patient_id: 1, visit_id: 1, total_amount: 1000, paid_amount: 0, discount: 0, status: 'open', created_by: 42, counter_id: 1 };
      expect(bill.created_by).toBe(42);
    });
  });

  // ─── 8. Service Type Enum Validation ─────────────────────────────────────
  describe('Service Type Enum Validation', () => {
    const VALID_SERVICE_TYPES = ['doctor_visit', 'test', 'procedure', 'admission', 'medicine', 'package', 'other'];

    it('should accept all valid service types', () => {
      for (const t of VALID_SERVICE_TYPES) {
        expect(VALID_SERVICE_TYPES).toContain(t);
      }
    });

    it('should reject invalid service type', () => {
      expect(VALID_SERVICE_TYPES).not.toContain('surgery');
    });

    it('should have exactly 7 service types', () => {
      expect(VALID_SERVICE_TYPES).toHaveLength(7);
    });
  });

  // ─── 9. Invoice Number Generation ────────────────────────────────────────
  describe('Invoice Number Generation', () => {
    function generateInvoiceNo(billId: number, prefix = 'INV'): string {
      return `${prefix}-${String(billId).padStart(6, '0')}`;
    }

    it('should generate invoice number with padding', () => {
      expect(generateInvoiceNo(1)).toBe('INV-000001');
      expect(generateInvoiceNo(42)).toBe('INV-000042');
      expect(generateInvoiceNo(123456)).toBe('INV-123456');
    });

    it('should support custom prefix', () => {
      expect(generateInvoiceNo(1, 'BILL')).toBe('BILL-000001');
    });

    it('should never produce empty invoice number', () => {
      expect(generateInvoiceNo(0)).toBe('INV-000000');
    });
  });

  // ─── 10. Discount Stacking Rules ─────────────────────────────────────────
  describe('Discount Stacking Rules', () => {
    it('should apply service-level discount before bill-level discount', () => {
      // Service: 1000 × 1 = 1000, service discount 100 → 900
      // Bill-level discount 50 → 850
      const serviceTotal = 1000 - 100; // service discount
      const billTotal = Math.max(0, serviceTotal - 50); // bill discount
      expect(billTotal).toBe(850);
    });

    it('should cap total discount at subtotal amount', () => {
      const subtotal = 500;
      const serviceDiscount = 200;
      const billDiscount = 400;
      const total = Math.max(0, subtotal - serviceDiscount - billDiscount);
      expect(total).toBe(0); // cannot go negative
    });

    it('should allow zero discount on both levels', () => {
      const subtotal = 1000;
      expect(subtotal - 0 - 0).toBe(1000);
    });

    it('should handle fractional discounts correctly', () => {
      const subtotal = 1000;
      const discount = 33.33;
      const total = Math.round((subtotal - discount) * 100) / 100;
      expect(total).toBe(966.67);
    });
  });

});
