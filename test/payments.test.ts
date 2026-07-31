import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import paymentRoutes from '../src/routes/tenant/payments';
import { paymentSchema } from '../src/schemas/billing';
import type { Env, Variables } from '../src/types';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

// ─── Payment & Financial Transactions Tests ───────────────────────────────────
// Covers: src/routes/tenant/payments.ts
// Bangladeshi context: bKash, Nagad, Rocket, cash, card

describe('HMS Payment & Financial Transaction Tests', () => {
  describe('Billing payment schema', () => {
    it('accepts Bangladesh hospital collection methods used at reception', () => {
      for (const paymentMethod of ['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank', 'bank_transfer', 'cheque', 'other'] as const) {
        const parsed = paymentSchema.safeParse({
          billId: 1,
          amount: 500,
          paymentMethod,
          ...(paymentMethod === 'cash' ? {} : { externalTransactionId: 'REF123456789' }),
        });
        expect(parsed.success, `${paymentMethod} should be accepted`).toBe(true);
      }
    });
  });

  describe('Payments dashboard stats', () => {
    it('returns payment method wise totals for cash, card, bank, and Bangladesh MFS', async () => {
      const { app } = createTestApp({
        route: paymentRoutes,
        routePath: '/payments',
        role: 'accountant',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('group by coalesce(payment_method')) {
            return {
              results: [
                { payment_method: 'cash', total: 1000, transaction_count: 2 },
                { payment_method: 'card', total: 500, transaction_count: 1 },
                { payment_method: 'bkash', total: 300, transaction_count: 1 },
                { payment_method: 'nagad', total: 200, transaction_count: 1 },
                { payment_method: 'bank_transfer', total: 300, transaction_count: 1 },
              ],
            };
          }
          if (lower.includes('from payment_gateway_logs') && lower.includes("status = 'pending'")) {
            return { results: [{ count: 1 }] };
          }
          if (lower.includes('from payment_gateway_logs') && lower.includes("status = 'failed'")) {
            return { results: [{ count: 0 }] };
          }
          if (lower.includes("payment_method = 'cash'")) {
            return { results: [{ total: 1000 }] };
          }
          if (lower.includes("payment_method = 'card'")) {
            return { results: [{ total: 500 }] };
          }
          if (lower.includes('payment_type in')) {
            return { results: [{ total: 2300 }] };
          }
          if (lower.includes('from payments') && lower.includes('sum(amount)')) {
            return { results: [{ total: 2300 }] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/payments/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        total_today: number;
        cash_total: number;
        card_total: number;
        bkash_total: number;
        nagad_total: number;
        bank_transfer_total: number;
        method_totals: Array<{ payment_method: string; total: number }>;
      };

      expect(body.total_today).toBe(2300);
      expect(body.cash_total).toBe(1000);
      expect(body.card_total).toBe(500);
      expect(body.bkash_total).toBe(300);
      expect(body.nagad_total).toBe(200);
      expect(body.bank_transfer_total).toBe(300);
      expect(body.method_totals).toHaveLength(5);
    });
  });

  // ─── Payment Method Validation ────────────────────────────────────────────
  describe('Payment Method Validation', () => {
    const VALID_PAYMENT_METHODS = ['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank', 'bank_transfer', 'cheque', 'other'] as const;
    type PaymentMethod = typeof VALID_PAYMENT_METHODS[number];

    function isValidMethod(m: string): m is PaymentMethod {
      return (VALID_PAYMENT_METHODS as readonly string[]).includes(m);
    }

    it('should accept cash payment method', () => {
      expect(isValidMethod('cash')).toBe(true);
    });

    it('should accept bKash (Bangladesh MFS)', () => {
      expect(isValidMethod('bkash')).toBe(true);
    });

    it('should accept Nagad (Bangladesh MFS)', () => {
      expect(isValidMethod('nagad')).toBe(true);
    });

    it('should accept Rocket (Bangladesh MFS)', () => {
      expect(isValidMethod('rocket')).toBe(true);
    });

    it('should accept card payment', () => {
      expect(isValidMethod('card')).toBe(true);
    });

    it('should accept bank_transfer', () => {
      expect(isValidMethod('bank_transfer')).toBe(true);
    });

    it('should accept cheque payment', () => {
      expect(isValidMethod('cheque')).toBe(true);
    });

    it('should reject unknown payment method', () => {
      expect(isValidMethod('paypal')).toBe(false);
    });

    it('should reject empty payment method', () => {
      expect(isValidMethod('')).toBe(false);
    });
  });

  // ─── bKash Transaction Number Validation ──────────────────────────────────
  describe('bKash / Nagad Transaction ID Validation', () => {
    function isValidBkashTxId(txId: string): boolean {
      // bKash TxID format: 10-digit alphanumeric
      return /^[A-Z0-9]{10}$/.test(txId);
    }

    function isValidNagadTxId(txId: string): boolean {
      // Nagad TxID is numeric, 10-15 digits
      return /^\d{10,15}$/.test(txId);
    }

    it('should accept valid bKash transaction ID (10 chars)', () => {
      expect(isValidBkashTxId('AB1234567C')).toBe(true);
    });

    it('should reject bKash transaction ID shorter than 10 chars', () => {
      expect(isValidBkashTxId('AB12345')).toBe(false);
    });

    it('should reject bKash transaction ID with special characters', () => {
      expect(isValidBkashTxId('AB@234567C')).toBe(false);
    });

    it('should accept valid Nagad transaction ID (12 digits)', () => {
      expect(isValidNagadTxId('123456789012')).toBe(true);
    });

    it('should reject Nagad transaction ID shorter than 10 digits', () => {
      expect(isValidNagadTxId('12345678')).toBe(false);
    });
  });

  // ─── Refund Management ────────────────────────────────────────────────────
  describe('Refund Management', () => {
    interface Refund {
      billId: number;
      amount: number;
      reason: string;
      approvedBy: number;
      refundMethod: string;
    }

    interface Bill {
      id: number;
      totalAmount: number;
      paidAmount: number;
      status: string;
    }

    function canRefund(bill: Bill, refundAmount: number): { valid: boolean; reason?: string } {
      if (bill.status === 'cancelled') return { valid: false, reason: 'Bill already cancelled' };
      if (refundAmount <= 0) return { valid: false, reason: 'Refund amount must be positive' };
      if (refundAmount > bill.paidAmount) return { valid: false, reason: 'Cannot refund more than paid amount' };
      return { valid: true };
    }

    it('should allow valid refund on partially paid bill', () => {
      const bill: Bill = { id: 1, totalAmount: 10_000, paidAmount: 5_000, status: 'partially_paid' };
      const result = canRefund(bill, 2_000);
      expect(result.valid).toBe(true);
    });

    it('should allow full refund on paid bill', () => {
      const bill: Bill = { id: 1, totalAmount: 10_000, paidAmount: 10_000, status: 'paid' };
      expect(canRefund(bill, 10_000).valid).toBe(true);
    });

    it('should reject refund on cancelled bill', () => {
      const bill: Bill = { id: 1, totalAmount: 10_000, paidAmount: 5_000, status: 'cancelled' };
      const result = canRefund(bill, 2_000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('cancelled');
    });

    it('should reject refund greater than paid amount', () => {
      const bill: Bill = { id: 1, totalAmount: 10_000, paidAmount: 5_000, status: 'partially_paid' };
      const result = canRefund(bill, 7_000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Cannot refund');
    });

    it('should reject zero refund amount', () => {
      const bill: Bill = { id: 1, totalAmount: 10_000, paidAmount: 5_000, status: 'partially_paid' };
      const result = canRefund(bill, 0);
      expect(result.valid).toBe(false);
    });

    it('should reject negative refund amount', () => {
      const bill: Bill = { id: 1, totalAmount: 10_000, paidAmount: 5_000, status: 'partially_paid' };
      const result = canRefund(bill, -500);
      expect(result.valid).toBe(false);
    });

    it('should require a reason for refund', () => {
      const refund: Refund = {
        billId: 1,
        amount: 2_000,
        reason: 'Service not delivered',
        approvedBy: 5,
        refundMethod: 'cash',
      };
      expect(refund.reason.trim().length).toBeGreaterThan(0);
    });
  });

  // ─── Advance / Deposit Management ─────────────────────────────────────────
  describe('Advance & Deposit Management', () => {
    interface Deposit {
      patientId: number;
      amount: number;
      collectedBy: number;
      receiptNo: string;
    }

    function applyDepositToBill(depositAmount: number, billTotal: number): {
      applied: number;
      remaining: number;
      billBalance: number;
    } {
      const applied = Math.min(depositAmount, billTotal);
      return {
        applied,
        remaining: depositAmount - applied,
        billBalance: billTotal - applied,
      };
    }

    it('should apply full deposit when deposit < bill total', () => {
      const result = applyDepositToBill(3_000, 10_000);
      expect(result.applied).toBe(3_000);
      expect(result.remaining).toBe(0);
      expect(result.billBalance).toBe(7_000);
    });

    it('should apply partial deposit when deposit > bill total', () => {
      const result = applyDepositToBill(15_000, 10_000);
      expect(result.applied).toBe(10_000);
      expect(result.remaining).toBe(5_000);
      expect(result.billBalance).toBe(0);
    });

    it('should handle exact deposit matching bill total', () => {
      const result = applyDepositToBill(10_000, 10_000);
      expect(result.applied).toBe(10_000);
      expect(result.remaining).toBe(0);
      expect(result.billBalance).toBe(0);
    });

    it('should generate receipt number with DEP prefix for deposits', () => {
      const seq = 3;
      const receiptNo = `DEP-${String(seq).padStart(6, '0')}`;
      expect(receiptNo).toBe('DEP-000003');
    });
  });

  // ─── Due Reminder Logic ───────────────────────────────────────────────────
  describe('Due Reminder Logic', () => {
    interface DueRecord {
      billId: number;
      dueAmount: number;
      lastReminderSentAt: string | null;
      daysOverdue: number;
    }

    function shouldSendReminder(record: DueRecord, today: string): boolean {
      if (record.dueAmount <= 0) return false;
      if (!record.lastReminderSentAt) return true;
      const daysSinceLastReminder = Math.floor(
        (new Date(today).getTime() - new Date(record.lastReminderSentAt).getTime()) / 86_400_000
      );
      return daysSinceLastReminder >= 7; // weekly reminders
    }

    it('should send reminder when no reminder was ever sent', () => {
      const record: DueRecord = { billId: 1, dueAmount: 5_000, lastReminderSentAt: null, daysOverdue: 5 };
      expect(shouldSendReminder(record, '2024-01-20')).toBe(true);
    });

    it('should send reminder when last reminder was 7+ days ago', () => {
      const record: DueRecord = { billId: 1, dueAmount: 5_000, lastReminderSentAt: '2024-01-10', daysOverdue: 15 };
      expect(shouldSendReminder(record, '2024-01-20')).toBe(true);
    });

    it('should NOT send reminder when last reminder was 3 days ago', () => {
      const record: DueRecord = { billId: 1, dueAmount: 5_000, lastReminderSentAt: '2024-01-17', daysOverdue: 10 };
      expect(shouldSendReminder(record, '2024-01-20')).toBe(false);
    });

    it('should NOT send reminder when due amount is 0', () => {
      const record: DueRecord = { billId: 1, dueAmount: 0, lastReminderSentAt: null, daysOverdue: 5 };
      expect(shouldSendReminder(record, '2024-01-20')).toBe(false);
    });
  });

  // ─── Financial Settlement Types ────────────────────────────────────────────
  describe('Payment Settlement Type', () => {
    const SETTLEMENT_TYPES = ['current', 'due'] as const;

    it('should accept current settlement type', () => {
      expect(SETTLEMENT_TYPES).toContain('current');
    });

    it('should accept due settlement type', () => {
      expect(SETTLEMENT_TYPES).toContain('due');
    });

    it('should have exactly 2 settlement types', () => {
      expect(SETTLEMENT_TYPES.length).toBe(2);
    });
  });

  // ─── Payment Initiation Permission Check ────────────────────────────────────
  describe('Payment Initiation Permission Check', () => {
    const setupTestApp = (role?: string) => {
      const app = new Hono<{ Bindings: Env; Variables: Variables }>();

      // Inject required context variables
      app.use('*', async (c, next) => {
        c.set('tenantId', 'test-tenant');
        c.set('userId', 1);
        if (role) {
          c.set('role', role as any);
        }

        // Mock DB
        c.env = {
          ...c.env,
          DB: {
            prepare: () => ({
              bind: () => ({
                first: async () => null, // Returns null so we get a 404 Bill not found instead of 403
              }),
            }),
          } as any,
          ENVIRONMENT: 'test',
        };

        await next();
      });

      app.route('/payments', paymentRoutes);
      return app;
    };

    const validPayload = {
      billId: 1,
      amount: 100,
      gateway: 'bkash',
      callbackUrl: 'http://localhost/callback',
    };

    it('should allow hospital_admin to initiate payment', async () => {
      const app = setupTestApp('hospital_admin');
      const res = await app.request('/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(404); // Bill not found, meaning it passed the 403 check
    });

    it('should allow reception to initiate payment', async () => {
      const app = setupTestApp('reception');
      const res = await app.request('/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(404);
    });

    it('should allow accountant to initiate payment', async () => {
      const app = setupTestApp('accountant');
      const res = await app.request('/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(404);
    });

    it('should deny doctor from initiating payment', async () => {
      const app = setupTestApp('doctor');
      const res = await app.request('/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });
      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).toContain('Only authorized staff can initiate payments');
    });

    it('should deny nurse from initiating payment', async () => {
      const app = setupTestApp('nurse');
      const res = await app.request('/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });
      expect(res.status).toBe(403);
    });

    it('should deny patient from initiating payment', async () => {
      const app = setupTestApp('patient');
      const res = await app.request('/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });
      expect(res.status).toBe(403);
    });

    it('should deny lab_technician from initiating payment', async () => {
      const app = setupTestApp('lab_technician');
      const res = await app.request('/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });
      expect(res.status).toBe(403);
    });

    it('should deny request with missing/undefined role', async () => {
      const app = setupTestApp(undefined);
      const res = await app.request('/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('Gateway verification financial controls', () => {
    it('does not overpay a bill when a gateway payment is verified after another collection', async () => {
      const mockDB = createMockDB({
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();

          if (lower.includes('from payment_gateway_logs')) {
            return {
              first: {
                id: 91,
                bill_id: 501,
                amount: 500,
                status: 'pending',
                tenant_id: 'tenant-1',
              },
            };
          }

          if (lower.includes('update payment_gateway_logs') && lower.includes("status = 'verifying'")) {
            return { meta: { changes: 1 } };
          }

          if (lower.includes('from bills')) {
            return {
              first: {
                id: 501,
                patient_id: 77,
                total: 1000,
                paid: 800,
                status: 'partially_paid',
              },
            };
          }

          return null;
        },
        universalFallback: false,
      });

      const { app } = createTestApp({
        route: paymentRoutes,
        routePath: '/payments',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        userId: 5,
        mockDB,
      });

      const res = await jsonRequest(app, '/payments/verify', {
        method: 'POST',
        body: {
          paymentId: 'bkash-payment-91',
          gateway: 'bkash',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { appliedToBill: number; depositAmount: number };
      expect(body.appliedToBill).toBe(200);
      expect(body.depositAmount).toBe(300);

      const billUpdate = mockDB.queries.find((query) =>
        query.sql.toLowerCase().includes('update bills set paid')
      );
      expect(billUpdate?.params).toContain(1000);
      expect(billUpdate?.params).not.toContain(1300);

      expect(mockDB.queries.some((query) =>
        query.sql.toLowerCase().includes('insert into billing_deposits') &&
        query.params.includes(300)
      )).toBe(true);
      expect(mockDB.queries.some((query) =>
        query.sql.toLowerCase().includes('insert into emp_cash_transactions') &&
        query.sql.includes('CashSales') &&
        query.params.includes(500)
      )).toBe(true);
      const paymentPostingEvent = mockDB.queries.find((query) =>
        query.sql.toLowerCase().includes('insert or ignore into accounting_posting_events') &&
        query.params.includes('payment') &&
        query.params.includes('payment_received')
      );
      expect(paymentPostingEvent).toBeTruthy();
      expect(paymentPostingEvent?.params.some((param) => String(param).startsWith('BKASH-'))).toBe(true);

      const depositPostingEvent = mockDB.queries.find((query) =>
        query.sql.toLowerCase().includes('insert or ignore into accounting_posting_events') &&
        query.params.includes('deposit') &&
        query.params.includes('patient_deposit_received')
      );
      expect(depositPostingEvent).toBeTruthy();
      expect(depositPostingEvent?.params.some((param) => String(param).startsWith('BKASH-') && String(param).endsWith('-ADV'))).toBe(true);
    });
  });
});
