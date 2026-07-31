/**
 * Integration tests for src/routes/tenant/deposits.ts
 *
 * Tests deposit collection, balance query, refund processing,
 * and deposit adjustment against a bill.
 */

import { describe, it, expect } from 'vitest';
import depositsRoute from '../../../src/routes/tenant/deposits';
import { createIdempotencyRequestHash } from '../../../src/lib/request-idempotency';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { ACTIVE_BILLING_COUNTER_TABLES, TENANT_1, TENANT_2, PATIENT_1, PATIENT_TENANT_2, BILL_1 } from '../helpers/fixtures';

// ─── Shared test data ──────────────────────────────────────────────────────────

const depositRow = {
  id: 40,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  deposit_receipt_no: 'DEP-000001',
  amount: 5000,
  transaction_type: 'deposit',
  payment_method: 'cash',
  is_active: 1,
  created_at: '2024-01-19T09:00:00Z',
};

const refundRow = {
  id: 41,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  deposit_receipt_no: 'DRF-000001',
  amount: 1000,
  transaction_type: 'refund',
  is_active: 1,
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Deposits Routes', () => {

  describe('GET / — list deposits', () => {
    it('returns deposits for the tenant', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { billing_deposits: [depositRow] },
      });

      const res = await app.request('/deposits');
      expect(res.status).toBe(200);
      const body = await res.json() as { deposits: unknown[]; page: number };
      expect(Array.isArray(body.deposits)).toBe(true);
      expect(body.page).toBe(1);
    });

    it('filters deposits by patient_id', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { billing_deposits: [depositRow] },
      });

      const res = await app.request(`/deposits?patient_id=${PATIENT_1.id}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /balance/:patientId — deposit balance', () => {
    it('returns correct balance shape', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { billing_deposits: [depositRow, refundRow] },
      });

      const res = await app.request(`/deposits/balance/${PATIENT_1.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        patient_id: number;
        total_deposits: number;
        total_refunds: number;
        balance: number;
      };
      expect(body.patient_id).toBe(PATIENT_1.id);
      expect(typeof body.total_deposits).toBe('number');
      expect(typeof body.balance).toBe('number');
    });
  });

  describe('POST / — collect deposit', () => {
    it('rejects deposit collection without an active billing counter session', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { patients: [PATIENT_1], billing_deposits: [] },
      });

      const res = await jsonRequest(app, '/deposits', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 3000, payment_method: 'cash' },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/Activate a billing counter/);
    });

    it('creates a deposit and returns receipt_no', async () => {
      const { app, mockDB } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          billing_deposits: [],
          sequences: [],
          cash_ledger_entries: [],
          sequence_counters: [],
        },
      });

      const res = await jsonRequest(app, '/deposits', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          amount: 3000,
          payment_method: 'cash',
          remarks: 'Pre-surgery deposit',
        },
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { receipt_no: string; message: string };
      expect(body.receipt_no).toMatch(/^DEP-/);
      expect(body.message).toMatch(/[Dd]eposit/);

      // Verify INSERT was run
      const insertQ = mockDB.queries.find(q =>
        q.sql.toUpperCase().includes('INSERT') && q.sql.includes('billing_deposits')
      );
      expect(insertQ).toBeTruthy();

      const accountingEvent = mockDB.queries.find(q =>
        q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      );
      expect(accountingEvent?.params).toEqual(expect.arrayContaining([
        TENANT_1.id,
        expect.stringContaining('patient_deposit_received'),
        'patient_deposit',
        'patient_deposit_received',
      ]));
      const ledgerAttempt = mockDB.queries.find(q => q.sql.includes('cash_ledger_entries'));
      expect(ledgerAttempt).toBeTruthy();
    });

    it('persists a validated admission link for IPD deposit reporting', async () => {
      const admission = {
        id: 701,
        tenant_id: TENANT_1.id,
        patient_id: PATIENT_1.id,
        admission_no: 'ADM-000701',
        status: 'admitted',
      };
      const { app, mockDB } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          admissions: [admission],
          billing_deposits: [],
          sequences: [],
          cash_ledger_entries: [],
          sequence_counters: [],
        },
      });

      const res = await jsonRequest(app, '/deposits', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          admission_id: admission.id,
          amount: 3000,
          payment_method: 'cash',
          remarks: 'IPD deposit',
        },
      });

      expect(res.status).toBe(201);
      const insert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO billing_deposits'));
      expect(insert?.sql).toContain('admission_id');
      expect(insert?.params).toContain(admission.id);
    });

    it('rejects an admission link that does not belong to the deposit patient', async () => {
      const { app, mockDB } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          admissions: [{ id: 702, tenant_id: TENANT_1.id, patient_id: 999, admission_no: 'ADM-000702' }],
          billing_deposits: [],
          sequences: [],
        },
      });

      const res = await jsonRequest(app, '/deposits', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          admission_id: 702,
          amount: 3000,
          payment_method: 'cash',
        },
      });

      expect(res.status).toBe(400);
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO billing_deposits'))).toBe(false);
    });

    it('returns the original deposit response when an idempotency key is retried', async () => {
      const requestBody = {
        patient_id: PATIENT_1.id,
        amount: 3000,
        payment_method: 'cash',
        remarks: 'Pre-surgery deposit',
        idempotencyKey: 'deposit-replay-001',
      };
      const requestHash = await createIdempotencyRequestHash({
        ...requestBody,
        idempotencyKey: undefined,
      });
      const { app, mockDB } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          billing_deposits: [],
          sequences: [],
        },
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: requestHash,
                status: 'completed',
                response_json: JSON.stringify({
                  id: 44,
                  receipt_no: 'DEP-REPLAY',
                  message: 'Deposit collected',
                }),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/deposits', {
        method: 'POST',
        body: requestBody,
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { receipt_no: string; idempotent?: boolean };
      expect(body).toMatchObject({ receipt_no: 'DEP-REPLAY', idempotent: true });
      expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO billing_deposits'))).toBe(false);
    });

    it('rejects a reused deposit idempotency key with a different payload', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          billing_deposits: [],
          sequences: [],
        },
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: 'different-deposit-payload',
                status: 'completed',
                response_json: JSON.stringify({ id: 44, receipt_no: 'DEP-REPLAY' }),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/deposits', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          amount: 3500,
          payment_method: 'cash',
          idempotencyKey: 'deposit-replay-001',
        },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/different deposit request/);
    });

    it('returns 404 when patient not found in tenant', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { ...ACTIVE_BILLING_COUNTER_TABLES, patients: [] },
      });

      const res = await jsonRequest(app, '/deposits', {
        method: 'POST',
        body: { patient_id: 9999, amount: 1000 },
      });
      expect(res.status).toBe(404);
    });

    it('rejects missing amount (Zod validation)', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { patients: [PATIENT_1] },
      });

      const res = await jsonRequest(app, '/deposits', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /refund — refund deposit', () => {
    it('returns 400 when refund exceeds balance', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          billing_deposits: [], // no deposits → balance = 0
        },
      });

      const res = await jsonRequest(app, '/deposits/refund', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 5000 },
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Ii]nsufficient/);
    });

    it('batches deposit refund, cash, accounting, and audit records atomically', async () => {
      const { app, mockDB } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          billing_deposits: [depositRow],
          sequences: [],
          cash_ledger_entries: [],
          sequence_counters: [],
        },
      });

      const res = await jsonRequest(app, '/deposits/refund', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 1000, payment_method: 'cash' },
      });

      expect(res.status).toBe(201);
      const refundInsert = mockDB.queries.find(q =>
        q.sql.includes('billing_deposits') && q.sql.toUpperCase().includes('INSERT') && q.sql.includes("'refund'")
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

      expect(refundInsert?.method).toBe('all');
      expect(cashInsert?.method).toBe('all');
      expect(postingInsert?.method).toBe('all');
      expect(auditInsert?.method).toBe('all');
      expect(mockDB.queries.some(q => q.method === 'run' && q.sql.includes('accounting_posting_events'))).toBe(false);
      expect(mockDB.queries.some(q => q.method === 'run' && q.sql.includes('emp_cash_transactions'))).toBe(false);
      const ledgerAttempt = mockDB.queries.find(q => q.sql.includes('cash_ledger_entries'));
      expect(ledgerAttempt).toBeTruthy();
    });

    it('returns the existing deposit refund response when an idempotency key is replayed', async () => {
      const requestBody = {
        patient_id: PATIENT_1.id,
        amount: 1000,
        payment_method: 'cash',
        idempotencyKey: 'deposit-refund-replay-001',
      };
      const requestHash = await createIdempotencyRequestHash({ ...requestBody, idempotencyKey: undefined });
      const { app, mockDB } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          billing_deposits: [depositRow],
          sequences: [],
        },
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: requestHash,
                status: 'completed',
                response_json: JSON.stringify({
                  id: 45,
                  receipt_no: 'DRF-REPLAY',
                  message: 'Refund processed',
                }),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/deposits/refund', {
        method: 'POST',
        body: requestBody,
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { receipt_no: string; idempotent?: boolean };
      expect(body).toMatchObject({ receipt_no: 'DRF-REPLAY', idempotent: true });
      expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO billing_deposits'))).toBe(false);
    });

    it('rejects a reused deposit refund idempotency key with a different payload', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          billing_deposits: [depositRow],
          sequences: [],
        },
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: 'different-refund-payload',
                status: 'completed',
                response_json: JSON.stringify({ id: 45, receipt_no: 'DRF-REPLAY' }),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/deposits/refund', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          amount: 1500,
          payment_method: 'cash',
          idempotencyKey: 'deposit-refund-replay-001',
        },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/different deposit refund request/);
    });
  });

  describe('POST /adjust — adjust deposit against bill', () => {
    it('returns 400 when adjustment exceeds deposit balance', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          bills: [BILL_1],
          billing_deposits: [], // no balance
        },
      });

      const res = await jsonRequest(app, '/deposits/adjust', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 2000, bill_id: BILL_1.id },
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when bill not found', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_1],
          bills: [],
          billing_deposits: [depositRow],
        },
      });

      const res = await jsonRequest(app, '/deposits/adjust', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 500, bill_id: 9999 },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Tenant isolation', () => {
    it('deposit listing returns empty for different tenant', async () => {
      const { app } = createTestApp({
        route: depositsRoute,
        routePath: '/deposits',
        role: 'receptionist',
        tenantId: TENANT_2.id,
        tables: { billing_deposits: [depositRow] }, // depositRow has TENANT_1.id
      });

      const res = await app.request('/deposits');
      expect(res.status).toBe(200);
      const body = await res.json() as { deposits: unknown[] };
      expect(body.deposits).toHaveLength(0);
    });
  });
});
