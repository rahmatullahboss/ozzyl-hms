/**
 * Integration tests for src/routes/tenant/settlements.ts
 *
 * Tests pending bill listing, patient settlement info,
 * settlement creation guards (overpayment, deposit balance),
 * and atomicity of bill status updates.
 */

import { describe, it, expect } from 'vitest';
import settlementsRoute from '../../../src/routes/tenant/settlements.ts';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import {
  ACTIVE_BILLING_COUNTER_TABLES,
  TENANT_1,
  TENANT_2,
  PATIENT_1,
  BILL_1,
} from '../helpers/fixtures';
import { getTodayGMT6 } from '../../../src/lib/date-utils';
import { createIdempotencyRequestHash } from '../../../src/lib/request-idempotency';

// ─── Shared test data ──────────────────────────────────────────────────────────

const unpaidBill = {
  ...BILL_1,
  patient_name: PATIENT_1.name,
  patient_code: PATIENT_1.patient_code,
};

const settlementRow = {
  id: 60,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  settlement_receipt_no: 'STL-000001',
  payable_amount: 2500,
  paid_amount: 2500,
  deposit_deducted: 0,
  discount_amount: 0,
  payment_mode: 'cash',
  is_active: 1,
  created_at: '2024-01-21T10:00:00Z',
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Settlements Routes', () => {

  describe('GET / — list settlements', () => {
    it('returns settlement list', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { billing_settlements: [settlementRow] },
      });

      const res = await app.request('/settlements');
      expect(res.status).toBe(200);
      const body = await res.json() as { settlements: unknown[]; page: number };
      expect(Array.isArray(body.settlements)).toBe(true);
    });
  });

  describe('GET /pending — bills awaiting payment', () => {
    it('returns open/partially_paid bills', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bills: [unpaidBill], patients: [PATIENT_1] },
      });

      const res = await app.request('/settlements/pending');
      expect(res.status).toBe(200);
      const body = await res.json() as { pending_bills: unknown[] };
      expect(Array.isArray(body.pending_bills)).toBe(true);
    });
  });

  describe('GET /patient/:patientId/info — patient settlement summary', () => {
    it('returns 404 when patient not found', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { patients: [] },
      });

      const res = await app.request('/settlements/patient/9999/info');
      expect(res.status).toBe(404);
    });

    it('returns patient info with pending bills and deposit balance', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          patients: [PATIENT_1],
          bills: [unpaidBill],
          billing_deposits: [],
        },
      });

      const res = await app.request(`/settlements/patient/${PATIENT_1.id}/info`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        patient: unknown;
        pending_bills: unknown[];
        deposit_balance: number;
        total_due: number;
        net_payable: number;
      };
      expect(body.patient).toBeDefined();
      expect(Array.isArray(body.pending_bills)).toBe(true);
      expect(typeof body.total_due).toBe('number');
      expect(typeof body.net_payable).toBe('number');
    });
  });

  describe('POST / — create settlement', () => {
    it('returns 400 when some bills not found', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bills: [] },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [9999],
          paid_amount: 2500,
        },
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Bb]ill/);
    });

    it('returns 400 for overpayment', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          bills: [{ ...unpaidBill, total: 1000, paid: 0, patient_id: PATIENT_1.id }],
          billing_deposits: [],
        },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_1.id],
          paid_amount: 5000, // overpayment vs 1000 due
        },
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Oo]verpay/);
    });

    it('rejects zero-value settlements that do not collect, adjust, or discount receivables', async () => {
      const { app, mockDB } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          bills: [{ ...unpaidBill, total: 2500, paid: 0, patient_id: PATIENT_1.id }],
          billing_deposits: [],
          billing_settlements: [],
        },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_1.id],
          paid_amount: 0,
          deposit_deducted: 0,
          discount_amount: 0,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/payment|settlement/i);
      expect(mockDB.queries.some(q => q.sql.includes('billing_settlements') && q.sql.toUpperCase().includes('INSERT'))).toBe(false);
    });

    it('requires discount by name when settlement discount is above 20 percent', async () => {
      const { app, mockDB } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          bills: [{ ...unpaidBill, total: 1000, paid: 0, patient_id: PATIENT_1.id }],
          billing_deposits: [],
          billing_settlements: [],
        },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_1.id],
          paid_amount: 750,
          deposit_deducted: 0,
          discount_amount: 250,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error?: string; message?: string };
      expect(String(body.message ?? body.error ?? '')).toMatch(/discount referred by/i);
      expect(mockDB.queries.some(q => q.sql.includes('billing_settlements') && q.sql.toUpperCase().includes('INSERT'))).toBe(false);
    });

    it('creates settlement and returns receipt_no', async () => {
      const { app, mockDB } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          bills: [{ ...unpaidBill, total: 2500, paid: 0, patient_id: PATIENT_1.id }],
          billing_deposits: [],
          billing_settlements: [],
          sequences: [],
        },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_1.id],
          paid_amount: 2500,
          deposit_deducted: 0,
          discount_amount: 0,
          payment_mode: 'cash',
        },
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { receipt_no: string; message: string };
      expect(body.receipt_no).toMatch(/^STL-/);

      // Verify settlement was inserted
      const stlInsert = mockDB.queries.find(q =>
        q.sql.includes('billing_settlements') && q.sql.toUpperCase().includes('INSERT')
      );
      expect(stlInsert).toBeTruthy();
      expect(stlInsert?.sql).toContain('counter_session_id');
    });

    it('stores settlement discount source allocation rows', async () => {
      const { app, mockDB } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          bills: [{ ...unpaidBill, total: 2500, paid: 0, patient_id: PATIENT_1.id }],
          billing_deposits: [],
          billing_settlements: [],
          sequences: [],
        },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_1.id],
          paid_amount: 2250,
          deposit_deducted: 0,
          discount_amount: 250,
          reason_code: 'poor_patient_charity',
          discount_by_name: 'Director',
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(201);
      const allocationInsert = mockDB.queries.find(q => q.sql.includes('INSERT INTO bill_discount_allocations'));
      expect(allocationInsert).toBeTruthy();
      expect(allocationInsert?.params).toContain('charity_discount');
      expect(allocationInsert?.params).toContain('poor_patient_charity');
      expect(allocationInsert?.params).toContain(250);
    });

    it('batches settlement, cash, accounting, and audit records atomically', async () => {
      const { app, mockDB } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          bills: [{ ...unpaidBill, total: 2500, paid: 0, patient_id: PATIENT_1.id }],
          billing_deposits: [],
          billing_settlements: [],
          sequences: [],
          cash_ledger_entries: [],
          sequence_counters: [],
        },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_1.id],
          paid_amount: 2500,
          deposit_deducted: 0,
          discount_amount: 0,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(201);
      const settlementInsert = mockDB.queries.find(q =>
        q.sql.includes('billing_settlements') && q.sql.toUpperCase().includes('INSERT')
      );
      const cashInsert = mockDB.queries.find(q =>
        q.sql.includes('emp_cash_transactions') && q.sql.toUpperCase().includes('INSERT')
      );
      const postingInsert = mockDB.queries.find(q =>
        q.sql.includes('accounting_posting_events') && q.sql.toUpperCase().includes('INSERT')
      );
      const auditInsert = mockDB.queries.find(q =>
        q.sql.includes('audit_logs') && q.sql.toUpperCase().includes('INSERT')
      );

      expect(settlementInsert?.method).toBe('all');
      expect(cashInsert?.method).toBe('all');
      expect(postingInsert?.method).toBe('all');
      expect(auditInsert?.method).toBe('all');
      expect(mockDB.queries.some(q => q.method === 'run' && q.sql.includes('billing_settlements'))).toBe(false);
      expect(mockDB.queries.some(q => q.method === 'run' && q.sql.includes('accounting_posting_events'))).toBe(false);
      expect(mockDB.queries.some(q => q.sql.includes('cash_ledger_entries'))).toBe(true);
    });

    it('returns the existing settlement response when an idempotency key is replayed', async () => {
      const requestBody = {
        patient_id: PATIENT_1.id,
        bill_ids: [BILL_1.id],
        paid_amount: 2500,
        deposit_deducted: 0,
        discount_amount: 0,
        payment_mode: 'cash',
        idempotencyKey: 'settlement-replay-1',
      };
      const requestHash = await createIdempotencyRequestHash({ ...requestBody, idempotencyKey: undefined });

      const { app, mockDB } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: requestHash,
                status: 'completed',
                response_json: JSON.stringify({ id: 60, receipt_no: 'STL-EXISTING', message: 'Settlement created' }),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: requestBody,
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { idempotent?: boolean; receipt_no?: string };
      expect(body).toMatchObject({ idempotent: true, receipt_no: 'STL-EXISTING' });
      expect(mockDB.queries.some((q) => q.sql.toUpperCase().includes('INSERT INTO BILLING_SETTLEMENTS'))).toBe(false);
    });

    it('rejects a settlement idempotency key reused with a different payload', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: 'different-hash',
                status: 'completed',
                response_json: JSON.stringify({ id: 60 }),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_1.id],
          paid_amount: 2500,
          idempotencyKey: 'settlement-replay-1',
        },
      });

      expect(res.status).toBe(409);
    });

    it('rejects settlement creation when no billing counter is active', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          bills: [{ ...unpaidBill, total: 2500, paid: 0, patient_id: PATIENT_1.id }],
          billing_deposits: [],
          billing_settlements: [],
        },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_1.id],
          paid_amount: 2500,
          deposit_deducted: 0,
          discount_amount: 0,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('billing counter');
    });

    it('rejects settlement creation in a closed accounting period', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          accounting_period_closes: [{
            tenant_id: TENANT_1.id,
            period_name: getTodayGMT6().substring(0, 7),
            status: 'closed',
          }],
          bills: [{ ...unpaidBill, total: 2500, paid: 0, patient_id: PATIENT_1.id }],
          billing_deposits: [],
          billing_settlements: [],
        },
      });

      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_1.id],
          paid_amount: 2500,
          deposit_deducted: 0,
          discount_amount: 0,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('accounting period');
    });
  });

  describe('Tenant isolation', () => {
    it('returns empty settlements for different tenant', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'accountant',
        tenantId: TENANT_2.id,
        tables: { billing_settlements: [settlementRow] }, // settlementRow has TENANT_1.id
      });

      const res = await app.request('/settlements');
      expect(res.status).toBe(200);
      const body = await res.json() as { settlements: unknown[] };
      expect(body.settlements).toHaveLength(0);
    });
  });

  describe('PUT /:id/cancel — cancel settlement', () => {
    it('cancels an active settlement and reverts bills', async () => {
      const { app, mockDB } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          billing_settlements: [{ ...settlementRow, id: 60, is_active: 1 }],
          bills: [{ ...BILL_1, id: 1, settlement_id: 60, paid: 2500, due: 0, total: 2500 }],
          audit_logs: [],
        },
      });

      const res = await jsonRequest(app, '/settlements/60/cancel', { method: 'PUT' });
      expect(res.status).toBe(200);
      const body = await res.json() as { message: string; settlement_id: string };
      expect(body.message).toContain('cancelled');
      expect(body.settlement_id).toBe('60');
    });

    it('reverses cash-plus-discount settlement allocations from the settled bill delta', async () => {
      const { app, mockDB } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          billing_settlements: [{
            ...settlementRow,
            id: 60,
            settlement_receipt_no: 'STL-000001',
            payable_amount: 100,
            paid_amount: 30,
            discount_amount: 70,
            is_active: 1,
          }],
          bills: [{
            ...BILL_1,
            id: 1,
            tenant_id: TENANT_1.id,
            patient_id: PATIENT_1.id,
            settlement_id: 60,
            total: 100,
            paid: 100,
            due: 0,
            status: 'paid',
          }],
          payments: [{
            id: 1,
            tenant_id: TENANT_1.id,
            bill_id: 1,
            receipt_no: 'STL-000001-B1',
            amount: 30,
          }],
          billing_deposits: [],
          audit_logs: [],
        },
        queryOverride: (sql, params) => {
          const normalized = sql.toLowerCase();
          if (normalized.includes('sum(amount)') && normalized.includes('from payments')) {
            return { results: [{ total: params[0] === 1 ? 30 : 0 }] };
          }
          if (normalized.includes('sum(amount)') && normalized.includes('from billing_deposits')) {
            return { results: [{ total: 0 }] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/settlements/60/cancel', { method: 'PUT' });

      expect(res.status).toBe(200);
      const billUpdate = mockDB.queries.find(q =>
        q.sql.includes('UPDATE bills SET paid = ?') && q.params.includes(1)
      );
      expect(billUpdate?.params.slice(0, 3)).toEqual([0, 100, 'open']);
    });

    it('returns 404 for non-existent settlement', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          billing_settlements: [],
        },
      });

      const res = await jsonRequest(app, '/settlements/999/cancel', { method: 'PUT' });
      expect(res.status).toBe(404);
    });

    it('returns 404 for already cancelled settlement', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          billing_settlements: [{ ...settlementRow, id: 60, is_active: 0 }],
        },
        // The mock DB may not filter by is_active properly, so use queryOverride
        queryOverride: (sql) => {
          if (sql.includes('billing_settlements') && sql.includes('is_active = 1')) {
            return { first: null }; // Simulate no active settlement found
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/settlements/60/cancel', { method: 'PUT' });
      expect(res.status).toBe(404);
    });

    it('denies non-admin roles from cancelling settlements', async () => {
      const { app } = createTestApp({
        route: settlementsRoute,
        routePath: '/settlements',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          billing_settlements: [{ ...settlementRow, id: 60, is_active: 1 }],
        },
      });

      const res = await jsonRequest(app, '/settlements/60/cancel', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
  });
});
