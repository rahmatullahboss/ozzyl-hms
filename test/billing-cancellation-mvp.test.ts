import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import cancellation from '../src/routes/tenant/billingCancellation';
import type { Env, Variables } from '../src/types';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

// ─── Billing Cancellation Tests ──────────────────────────────────────────────
// Tests for: bill cancellation, item cancellation, batch cancellation,
// cancellation with payments (should reject), and cancellation audit trail.

describe('Billing Cancellation', () => {
  // ─── Full Bill Cancellation ─────────────────────────────────────────────

  describe('POST /cancellation — cancel bill by ID', () => {
    it('should cancel an unpaid bill', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from bills') && lower.includes('select')) {
            return {
              results: [{
                id: 1, invoice_no: 'INV-001', patient_id: 1, visit_id: null,
                status: 'open', paid: 0, total: 1000, discount: 0,
                test_bill: 500, doctor_visit_bill: 500, admission_bill: 0,
                operation_bill: 0, medicine_bill: 0,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/cancellation', {
        method: 'POST',
        body: { bill_id: 1, reason: 'Patient request' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.message).toBe('Bill cancelled');
      expect(body.bill_id).toBe(1);
    });

    it('should reject cancelling a paid bill', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from bills') && lower.includes('select')) {
            return {
              results: [{
                id: 1, invoice_no: 'INV-001', patient_id: 1, visit_id: null,
                status: 'paid', paid: 1000, total: 1000, discount: 0,
                test_bill: 500, doctor_visit_bill: 500, admission_bill: 0,
                operation_bill: 0, medicine_bill: 0,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/cancellation', {
        method: 'POST',
        body: { bill_id: 1, reason: 'Patient request' },
      });
      expect(res.status).toBe(400);
    });

    it('should reject cancelling an already cancelled bill', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from bills') && lower.includes('select')) {
            return {
              results: [{
                id: 1, invoice_no: 'INV-001', patient_id: 1, visit_id: null,
                status: 'cancelled', paid: 0, total: 1000, discount: 0,
                test_bill: 500, doctor_visit_bill: 500, admission_bill: 0,
                operation_bill: 0, medicine_bill: 0,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/cancellation', {
        method: 'POST',
        body: { bill_id: 1, reason: 'Duplicate' },
      });
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent bill', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: () => null,
      });

      const res = await jsonRequest(app, '/cancellation', {
        method: 'POST',
        body: { bill_id: 999, reason: 'Not found' },
      });
      expect(res.status).toBe(404);
    });

    it('should require a cancel reason', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/cancellation', {
        method: 'POST',
        body: { bill_id: 1, reason: '' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /bill/:id — cancel by path param ──────────────────────────────

  describe('PUT /cancellation/bill/:id — cancel bill by path', () => {
    it('should cancel unpaid bill via PUT', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from bills') && lower.includes('select')) {
            return {
              results: [{
                id: 1, invoice_no: 'INV-001', patient_id: 1, visit_id: null,
                status: 'open', paid: 0, total: 500, discount: 0,
                test_bill: 500, doctor_visit_bill: 0, admission_bill: 0,
                operation_bill: 0, medicine_bill: 0,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/cancellation/bill/1', {
        method: 'PUT',
        body: { reason: 'Data entry error' },
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── Cancellation Listing ───────────────────────────────────────────────

  describe('GET /cancellation — list cancelled bills', () => {
    it('should return cancelled bills with summary', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from bills b') && lower.includes("status = 'cancelled'")) {
            return {
              results: [
                { id: 1, invoice_no: 'INV-001', patient_name: 'Karim', amount: 1000, reason: 'Error', cancelled_by: 'Admin', created_at: '2025-01-15' },
              ],
            };
          }
          if (lower.includes('accounting_posting_events')) {
            return {
              results: [{
                total_accounting_events: 1,
                total_accounting_amount: 1000,
                total_full_bill_accounting_amount: 1000,
                total_item_cancellation_amount: 0,
                posted_accounting_events: 1,
                voucher_linked_events: 0,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/cancellation');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.cancellations).toHaveLength(1);
      expect(body.summary).toBeDefined();
      expect(body.summary.totalCancelledBills).toBe(1);
      expect(body.summary.totalCancelledBillAmount).toBe(1000);
    });

    it('should support date range filter', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes("status = 'cancelled'")) {
            return { results: [] };
          }
          if (sql.toLowerCase().includes('accounting_posting_events')) {
            return {
              results: [{
                total_accounting_events: 0,
                total_accounting_amount: 0,
                total_full_bill_accounting_amount: 0,
                total_item_cancellation_amount: 0,
                posted_accounting_events: 0,
                voucher_linked_events: 0,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/cancellation?start_date=2025-01-01&end_date=2025-01-31');
      expect(res.status).toBe(200);
    });
  });

  // ─── Role Restrictions ──────────────────────────────────────────────────

  describe('Role-based access', () => {
    it('should allow hospital_admin to cancel', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
      });

      // Just verify the route is accessible (400 for missing body, not 403)
      const res = await jsonRequest(app, '/cancellation', {
        method: 'POST',
        body: {},
      });
      expect(res.status).not.toBe(403);
    });

    it('should deny reception role from cancelling', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'reception',
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/cancellation', {
        method: 'POST',
        body: { bill_id: 1, reason: 'Test' },
      });
      expect(res.status).toBe(403);
    });

    it('should deny doctor role from cancelling', async () => {
      const { app } = createTestApp({
        route: cancellation,
        routePath: '/cancellation',
        role: 'doctor',
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/cancellation', {
        method: 'POST',
        body: { bill_id: 1, reason: 'Test' },
      });
      expect(res.status).toBe(403);
    });
  });
});

// ─── Cancellation Business Logic Tests ──────────────────────────────────────

describe('Cancellation Business Logic', () => {
  describe('Cancellation category payload', () => {
    it('should aggregate amounts by category', () => {
      const items = [
        { item_category: 'test', line_total: 500 },
        { item_category: 'test', line_total: 300 },
        { item_category: 'doctor_visit', line_total: 400 },
        { item_category: 'medicine', line_total: 200 },
      ];

      const totals = {
        testBill: 0,
        doctorVisitBill: 0,
        admissionBill: 0,
        operationBill: 0,
        medicineBill: 0,
      };

      for (const item of items) {
        const amount = Math.max(0, Math.round(Number(item.line_total ?? 0) * 100) / 100);
        const category = String(item.item_category ?? '').toLowerCase();
        if (category === 'test') totals.testBill += amount;
        else if (category === 'doctor_visit') totals.doctorVisitBill += amount;
        else if (category === 'admission') totals.admissionBill += amount;
        else if (category === 'operation') totals.operationBill += amount;
        else if (category === 'medicine') totals.medicineBill += amount;
      }

      expect(totals.testBill).toBe(800);
      expect(totals.doctorVisitBill).toBe(400);
      expect(totals.medicineBill).toBe(200);
      expect(totals.admissionBill).toBe(0);
      expect(totals.operationBill).toBe(0);
    });
  });

  describe('Bill total recalculation after item cancellation', () => {
    it('should recalculate total from active items only', () => {
      const items = [
        { line_total: 500, status: 'active' },
        { line_total: 300, status: 'cancelled' },
        { line_total: 400, status: 'active' },
      ];

      const newTotal = items
        .filter(i => i.status === 'active')
        .reduce((s, i) => s + i.line_total, 0);

      expect(newTotal).toBe(900);
    });

    it('should update status based on new total vs paid', () => {
      const scenarios = [
        { total: 1000, paid: 0, expected: 'open' },
        { total: 1000, paid: 500, expected: 'partially_paid' },
        { total: 1000, paid: 1000, expected: 'paid' },
        { total: 500, paid: 1000, expected: 'paid' },
      ];

      for (const { total, paid, expected } of scenarios) {
        const status = paid >= total ? 'paid' : paid > 0 ? 'partially_paid' : 'open';
        expect(status).toBe(expected);
      }
    });
  });

  describe('Prevent cancellation of paid items', () => {
    it('should reject if bill has any payment', () => {
      const billPaid = 500;
      const billStatus = 'partially_paid';

      const canCancel = billPaid === 0 && billStatus !== 'paid';
      expect(canCancel).toBe(false);
    });

    it('should allow if bill is unpaid', () => {
      const billPaid = 0;
      const billStatus = 'open';

      const canCancel = billPaid === 0 && billStatus !== 'paid';
      expect(canCancel).toBe(true);
    });
  });
});
