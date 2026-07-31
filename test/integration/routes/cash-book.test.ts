import { describe, it, expect } from 'vitest';
import cashBookRoute from '../../../src/routes/tenant/cash-book';
import bankBookRoute from '../../../src/routes/tenant/bank-book';
import { ACCOUNTING_EVENT_TYPES } from '../../../src/lib/accounting-posting';
import { createTestApp } from '../helpers/test-app';

const TENANT_1 = { id: 'tenant-1' };

const today = '2026-05-27';
const todayPayments = [
  { id: 1, bill_id: 1, amount: 5000, method: 'cash', tenant_id: TENANT_1.id, date: today, created_at: `${today} 09:00:00` },
  { id: 2, bill_id: 2, amount: 3000, method: 'cash', tenant_id: TENANT_1.id, date: today, created_at: `${today} 10:00:00` },
  { id: 3, bill_id: 3, amount: 2000, method: 'bkash', tenant_id: TENANT_1.id, date: today, created_at: `${today} 11:00:00` },
  { id: 4, bill_id: 4, amount: 1500, method: 'card', tenant_id: TENANT_1.id, date: today, created_at: `${today} 12:00:00` },
];

const todayExpenses = [
  { id: 1, category: 'Utilities', amount: 1000, payment_method: 'cash', tenant_id: TENANT_1.id, status: 'approved', date: today, created_at: `${today} 08:00:00` },
  { id: 2, category: 'Supplies', amount: 500, payment_method: 'cash', tenant_id: TENANT_1.id, status: 'approved', date: today, created_at: `${today} 14:00:00` },
];

const todayRefunds = [
  { id: 1, bill_id: 1, amount: 200, method: 'cash', tenant_id: TENANT_1.id, date: today, created_at: `${today} 15:00:00` },
];
const todayCashLedger = [
  { id: 1, amount: 5000, payment_method: 'cash', transaction_type: 'CashSales', tenant_id: TENANT_1.id, transaction_date: `${today} 09:00:00` },
  { id: 2, amount: 3000, payment_method: 'cash', transaction_type: 'CollectionFromReceivable', tenant_id: TENANT_1.id, transaction_date: `${today} 10:00:00` },
  { id: 3, amount: 200, payment_method: 'cash', transaction_type: 'SalesReturn', tenant_id: TENANT_1.id, transaction_date: `${today} 15:00:00` },
  { id: 4, amount: 2000, payment_method: 'bkash', transaction_type: 'CashSales', tenant_id: TENANT_1.id, transaction_date: `${today} 11:00:00` },
];

describe('Cash Book API', () => {
  describe('GET /cash-book', () => {
    it('returns cash book summary for a date', async () => {
      const { app } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { emp_cash_transactions: todayCashLedger, expenses: todayExpenses },
      });

      const res = await app.request(`/cash-book?date=${today}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { openingCash: number; cashCollection: number; cashExpense: number; cashRefund: number; closingCash: number } };
      expect(body.data.cashCollection).toBe(8000);
      expect(body.data.cashExpense).toBe(1500);
      expect(body.data.cashRefund).toBe(200);
    });

    it('only includes cash payments, not bkash/card', async () => {
      const { app } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { emp_cash_transactions: todayCashLedger, expenses: [] },
      });

      const res = await app.request(`/cash-book?date=${today}`);
      const body = await res.json() as { data: { cashCollection: number } };
      expect(body.data.cashCollection).toBe(8000);
    });

    it('returns 403 for non-admin role', async () => {
      const { app } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { emp_cash_transactions: [], expenses: [] },
      });

      const res = await app.request(`/cash-book?date=${today}`);
      expect(res.status).toBe(403);
    });

    it('returns zero values when no transactions', async () => {
      const { app } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { emp_cash_transactions: [], expenses: [] },
      });

      const res = await app.request(`/cash-book?date=${today}`);
      const body = await res.json() as { data: { cashCollection: number; cashExpense: number; cashRefund: number; closingCash: number } };
      expect(body.data.cashCollection).toBe(0);
      expect(body.data.cashExpense).toBe(0);
    });

    it('does not include payments from other tenants', async () => {
      const otherTenantPayment = { id: 99, bill_id: 99, amount: 50000, method: 'cash', tenant_id: 'tenant-2', created_at: `${today} 09:00:00` };
      const { app } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { emp_cash_transactions: [...todayCashLedger, otherTenantPayment], expenses: [] },
      });

      const res = await app.request(`/cash-book?date=${today}`);
      const body = await res.json() as { data: { cashCollection: number } };
      expect(body.data.cashCollection).toBe(8000);
    });

    it('defaults to today when no date param', async () => {
      const { app } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { emp_cash_transactions: [], expenses: [] },
      });

      const res = await app.request('/cash-book');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { date: string } };
      expect(body.data.date).toBeTruthy();
    });

    it('uses the authoritative cashier transaction ledger for cash in and refunds', async () => {
      const { app, mockDB } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          emp_cash_transactions: [
            { tenant_id: TENANT_1.id, payment_method: 'cash', transaction_type: 'CashSales', amount: 8000, transaction_date: `${today} 09:00:00` },
            { tenant_id: TENANT_1.id, payment_method: 'cash', transaction_type: 'SalesReturn', amount: 200, transaction_date: `${today} 15:00:00` },
          ],
          expenses: [],
        },
      });

      const res = await app.request(`/cash-book?date=${today}`);
      const body = await res.json() as { data: { cashCollection: number; cashRefund: number } };

      expect(res.status).toBe(200);
      expect(body.data.cashCollection).toBe(8000);
      expect(body.data.cashRefund).toBe(200);
      expect(mockDB.queries.some((query) => query.sql.includes('FROM emp_cash_transactions'))).toBe(true);
    });

    it('includes manual drawer movements in cash book totals without hiding the reason', async () => {
      const { app } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        queryOverride: (sql, params) => {
          const lower = sql.toLowerCase();
          const bound = params.map(String).join('|');
          if (lower.includes('from emp_cash_transactions') && bound.includes('CashSales')) {
            return { results: [{ total: 6901 }] };
          }
          if (lower.includes('from emp_cash_transactions') && bound.includes('SalesReturn')) {
            return { results: [{ total: 0 }] };
          }
          if (lower.includes('from expenses')) {
            return { results: [{ total: 0 }] };
          }
          if (lower.includes('from cash_drawer_movements') && lower.includes('manual_cash_in')) {
            return { results: [{ manual_cash_in: 0, manual_cash_out: 1600, cash_drop_total: 0, handover_total: 5301 }] };
          }
          return null;
        },
      });

      const res = await app.request(`/cash-book?date=${today}`);
      const body = await res.json() as {
        data: {
          cashCollection: number;
          cashExpense: number;
          manualCashIn: number;
          manualCashOut: number;
          cashDrop: number;
          handoverCash: number;
          closingCash: number;
        };
      };

      expect(res.status).toBe(200);
      expect(body.data.cashExpense).toBe(0);
      expect(body.data.manualCashOut).toBe(1600);
      expect(body.data.handoverCash).toBe(5301);
      expect(body.data.closingCash).toBe(0);
    });
  });

  describe('GET /cash-book/transactions', () => {
    it('returns detailed cash transactions', async () => {
      const { app } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { emp_cash_transactions: todayCashLedger, expenses: todayExpenses },
      });

      const res = await app.request(`/cash-book/transactions?date=${today}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { collections: unknown[]; expenses: unknown[]; refunds: unknown[] } };
      expect(body.data.collections.length).toBe(2);
      expect(body.data.expenses.length).toBe(2);
      expect(body.data.refunds.length).toBe(1);
    });

    it('normalizes UTC-backed cash transaction timestamps for the cash book transaction list', async () => {
      const { app, mockDB } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        queryOverride: (sql, params) => {
          const lower = sql.toLowerCase();
          const bound = params.map(String).join('|');
          if (lower.includes('from emp_cash_transactions') && bound.includes('CashSales')) {
            return {
              results: [{
                id: 90,
                amount: 1200,
                payment_method: 'cash',
                transaction_type: 'CashSales',
                tenant_id: TENANT_1.id,
                transaction_date: '2026-06-22 09:15:00',
              }],
            };
          }
          if (lower.includes('from emp_cash_transactions') && bound.includes('SalesReturn')) return { results: [] };
          if (lower.includes('from expenses')) return { results: [] };
          if (lower.includes('from cash_drawer_movements m')) return { results: [] };
          return null;
        },
      });

      const res = await app.request('/cash-book/transactions?date=2026-06-22');
      const body = await res.json() as { data: { collections: Array<{ transaction_date: string }> } };

      expect(res.status).toBe(200);
      expect(body.data.collections[0].transaction_date).toBe('2026-06-22 09:15:00');
      const collectionQuery = mockDB.queries.find((query) => query.sql.includes('FROM emp_cash_transactions') && query.sql.includes("datetime(transaction_date, '+6 hours') AS transaction_date"));
      expect(collectionQuery?.sql).toContain("datetime(transaction_date, '+6 hours') AS transaction_date");
      expect(collectionQuery?.sql).toContain("date(transaction_date, '+6 hours') = date(?)");
      expect(collectionQuery?.sql).toContain("ORDER BY datetime(transaction_date, '+6 hours')");
    });

    it('returns manual drawer movements with operator, counter, reason, and receipt status', async () => {
      const { app } = createTestApp({
        route: cashBookRoute,
        routePath: '/cash-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        queryOverride: (sql, params) => {
          const lower = sql.toLowerCase();
          const bound = params.map(String).join('|');
          if (lower.includes('from emp_cash_transactions') && bound.includes('CashSales')) return { results: [] };
          if (lower.includes('from expenses')) return { results: [] };
          if (lower.includes('from emp_cash_transactions') && bound.includes('SalesReturn')) return { results: [] };
          if (lower.includes('from cash_drawer_movements m')) {
            return {
              results: [{
                id: 42,
                movement_type: 'cash_out',
                amount: 1600,
                description: 'adjust',
                created_at: `${today} 12:59:00`,
                counter_name: 'Reception',
                operator_name: 'Nusrat Jahan Sony',
                reference_type: 'expense',
                reference_id: 77,
                receipt_key: 'expenses/tenant-1/77/photo.webp',
              }],
            };
          }
          return null;
        },
      });

      const res = await app.request(`/cash-book/transactions?date=${today}`);
      const body = await res.json() as {
        data: {
          manualMovements: Array<{
            movementType: string;
            amount: number;
            reason: string;
            operatorName: string;
            counterName: string;
            receiptAvailable: boolean;
          }>;
        };
      };

      expect(res.status).toBe(200);
      expect(body.data.manualMovements).toHaveLength(1);
      expect(body.data.manualMovements[0]).toMatchObject({
        movementType: 'cash_out',
        amount: 1600,
        reason: 'adjust',
        operatorName: 'Nusrat Jahan Sony',
        counterName: 'Reception',
        receiptAvailable: true,
      });
    });
  });
});

const bankTransactions = [
  { id: 1, type: 'deposit', amount: 50000, bank_name: 'DBBL', tenant_id: TENANT_1.id, date: today, created_at: `${today} 09:00:00` },
  { id: 2, type: 'card_settlement', amount: 15000, bank_name: 'VISA', tenant_id: TENANT_1.id, date: today, created_at: `${today} 10:00:00` },
  { id: 3, type: 'supplier_payment', amount: 20000, bank_name: 'DBBL', tenant_id: TENANT_1.id, date: today, created_at: `${today} 11:00:00` },
];

describe('Bank Book API', () => {
  describe('GET /bank-book', () => {
    it('returns bank book summary', async () => {
      const { app } = createTestApp({
        route: bankBookRoute,
        routePath: '/bank-book',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bank_transactions: bankTransactions },
      });

      const res = await app.request(`/bank-book?date=${today}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { totalDeposits: number; totalSettlements: number; totalPayments: number; netBankMovement: number } };
      expect(body.data.totalDeposits).toBe(50000);
      expect(body.data.totalSettlements).toBe(15000);
      expect(body.data.totalPayments).toBe(20000);
    });

    it('returns 403 for non-admin role', async () => {
      const { app } = createTestApp({
        route: bankBookRoute,
        routePath: '/bank-book',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { bank_transactions: [] },
      });

      const res = await app.request(`/bank-book?date=${today}`);
      expect(res.status).toBe(403);
    });
  });

  describe('deposit request approval', () => {
    const pendingRequest = {
      id: 55,
      tenant_id: TENANT_1.id,
      request_no: 'BDR-000055',
      counter_session_id: 17,
      counter_id: 7,
      requested_by: 1,
      requested_amount: 25000,
      proposed_bank_name: 'DBBL',
      request_note: 'Morning collection',
      status: 'pending',
      created_at: `${today} 09:30:00`,
      cashier_name: 'Reception One',
      counter_name: 'Main Billing Counter',
    };

    it('lists pending bank deposit requests for finance users', async () => {
      const { app } = createTestApp({
        route: bankBookRoute,
        routePath: '/bank-book',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bank_deposit_requests: [pendingRequest] },
      });

      const res = await app.request('/bank-book/deposit-requests?status=pending');
      expect(res.status).toBe(200);
      const body = await res.json() as { requests: Array<{ requestNo: string; amount: number; status: string }> };
      expect(body.requests[0]).toMatchObject({ requestNo: 'BDR-000055', amount: 25000, status: 'pending' });
    });

    it('prevents reception from confirming a bank deposit request', async () => {
      const { app } = createTestApp({
        route: bankBookRoute,
        routePath: '/bank-book',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { bank_deposit_requests: [pendingRequest] },
      });

      const res = await app.request('/bank-book/deposit-requests/55/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankName: 'DBBL Gulshan',
          referenceNo: 'SLIP-001',
          depositDate: today,
          confirmedAmount: 25000,
        }),
      });

      expect(res.status).toBe(403);
    });

    it('confirms a pending bank deposit request into the Bank Book and accounting queue', async () => {
      const { app, mockDB } = createTestApp({
        route: bankBookRoute,
        routePath: '/bank-book',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bank_deposit_requests: [pendingRequest] },
      });

      const res = await app.request('/bank-book/deposit-requests/55/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankName: 'DBBL Gulshan',
          referenceNo: 'SLIP-001',
          depositDate: today,
          confirmedAmount: 25000,
        }),
      });

      expect(res.status).toBe(200);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into bank_transactions')
        && q.params.includes(55))).toBe(true);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update bank_deposit_requests')
        && q.params.includes('approved'))).toBe(true);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('accounting_posting_events')
        && q.params.includes(ACCOUNTING_EVENT_TYPES.bankDepositConfirmed))).toBe(true);
    });

    it('rejects confirmation when the confirmed amount differs from custody amount', async () => {
      const { app, mockDB } = createTestApp({
        route: bankBookRoute,
        routePath: '/bank-book',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bank_deposit_requests: [pendingRequest] },
      });

      const res = await app.request('/bank-book/deposit-requests/55/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankName: 'DBBL Gulshan',
          referenceNo: 'SLIP-001',
          depositDate: today,
          confirmedAmount: 24999,
        }),
      });

      expect(res.status).toBe(400);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into bank_transactions'))).toBe(false);
    });

    it('rejects an already approved deposit request instead of creating a duplicate bank transaction', async () => {
      const { app, mockDB } = createTestApp({
        route: bankBookRoute,
        routePath: '/bank-book',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bank_deposit_requests: [{ ...pendingRequest, status: 'approved', bank_transaction_id: 77 }] },
      });

      const res = await app.request('/bank-book/deposit-requests/55/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankName: 'DBBL Gulshan',
          referenceNo: 'SLIP-001',
          depositDate: today,
          confirmedAmount: 25000,
        }),
      });

      expect(res.status).toBe(409);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into bank_transactions'))).toBe(false);
    });

    it('rejects a pending bank deposit request with a required reason and no bank transaction', async () => {
      const { app, mockDB } = createTestApp({
        route: bankBookRoute,
        routePath: '/bank-book',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bank_deposit_requests: [pendingRequest] },
      });

      const res = await app.request('/bank-book/deposit-requests/55/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Deposit slip amount does not match custody amount' }),
      });

      expect(res.status).toBe(200);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update bank_deposit_requests')
        && q.params.includes('rejected'))).toBe(true);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into bank_transactions'))).toBe(false);
    });

    it('returns rejected custody to an active counter with cash-in and manual journal', async () => {
      const rejectedRequest = { ...pendingRequest, status: 'rejected', rejection_reason: 'Bank closed' };
      const activeSession = {
        id: 44,
        tenant_id: TENANT_1.id,
        counter_id: 8,
        employee_id: 3,
        status: 'active',
      };
      const { app, mockDB } = createTestApp({
        route: bankBookRoute,
        routePath: '/bank-book',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          bank_deposit_requests: [rejectedRequest],
          billing_counter_sessions: [activeSession],
          accounting_account_mappings: [
            { tenant_id: TENANT_1.id, mapping_key: 'cash', account_id: 1, is_active: 1 },
            { tenant_id: TENANT_1.id, mapping_key: 'admin_cash', account_id: 16, is_active: 1 },
          ],
        },
      });

      const res = await app.request('/bank-book/deposit-requests/55/return-to-counter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetCounterSessionId: 44,
          note: 'Returned to evening reception counter',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements')
        && q.sql.toLowerCase().includes("'cash_in'"))).toBe(true);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update bank_deposit_requests')
        && q.params.includes('returned_to_counter'))).toBe(true);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('accounting_posting_events')
        && q.params.includes(ACCOUNTING_EVENT_TYPES.manualJournal))).toBe(true);
    });

    it('rejects unbalanced manual adjustment for rejected custody', async () => {
      const rejectedRequest = { ...pendingRequest, status: 'rejected', rejection_reason: 'Slip missing' };
      const { app, mockDB } = createTestApp({
        route: bankBookRoute,
        routePath: '/bank-book',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bank_deposit_requests: [rejectedRequest] },
      });

      const res = await app.request('/bank-book/deposit-requests/55/manual-adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: 'Write off custody shortage',
          lines: [
            { accountId: 25, debit: 25000, credit: 0, memo: 'Shortage' },
            { accountId: 16, debit: 0, credit: 24000, memo: 'Clear custody' },
          ],
        }),
      });

      expect(res.status).toBe(400);
      expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update bank_deposit_requests')
        && q.params.includes('manual_adjustment'))).toBe(false);
    });
  });
});
