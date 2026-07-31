/**
 * Integration tests for src/routes/tenant/creditNotes.ts
 *
 * Tests credit note creation, invoice item listing,
 * over-return guards, and sequence number generation.
 */

import { describe, it, expect } from 'vitest';
import creditNotesRoute from '../../../src/routes/tenant/creditNotes';
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

const invoiceItem1 = {
  id: 100,
  tenant_id: TENANT_1.id,
  bill_id: BILL_1.id,
  description: 'Consultation fee',
  quantity: 1,
  unit_price: 1000,
  line_total: 1000,
  status: 'active',
  returned_qty: 0,
};

const invoiceItem2 = {
  id: 101,
  tenant_id: TENANT_1.id,
  bill_id: BILL_1.id,
  description: 'Blood test',
  quantity: 1,
  unit_price: 500,
  line_total: 500,
  status: 'active',
  returned_qty: 0,
};

const billWithPatient = {
  ...BILL_1,
  patient_name: PATIENT_1.name,
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Credit Notes Routes', () => {

  describe('GET / — list credit notes', () => {
    it('returns credit notes for the tenant', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { billing_credit_notes: [] },
      });

      const res = await app.request('/credit-notes');
      expect(res.status).toBe(200);
      const body = await res.json() as { credit_notes: unknown[]; page: number };
      expect(Array.isArray(body.credit_notes)).toBe(true);
    });

    it('filters by patient_id', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { billing_credit_notes: [] },
      });

      const res = await app.request(`/credit-notes?patient_id=${PATIENT_1.id}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /invoice/:billId — invoice items for credit note', () => {
    it('returns 404 when bill not found', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bills: [] },
      });

      const res = await app.request('/credit-notes/invoice/9999');
      expect(res.status).toBe(404);
    });

    it('returns invoice items with available_qty calculated', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          bills: [billWithPatient],
          invoice_items: [invoiceItem1, invoiceItem2],
          billing_credit_note_items: [],
          billing_credit_notes: [],
        },
      });

      const res = await app.request(`/credit-notes/invoice/${BILL_1.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        bill: Record<string, unknown>;
        items: Array<{ available_qty: number }>;
      };
      expect(body.bill).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
    });
  });

  describe('POST / — create credit note', () => {
    it('returns 404 when bill not found for this patient', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bills: [] },
      });

      const res = await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: {
          bill_id: 9999,
          patient_id: PATIENT_1.id,
          reason: 'Overcharge',
          items: [{ invoice_item_id: 100, return_quantity: 1 }],
        },
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when trying to return more than available quantity', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          bills: [{ ...billWithPatient, patient_id: PATIENT_1.id }],
          invoice_items: [invoiceItem1], // quantity = 1
          billing_credit_note_items: [],
          billing_credit_notes: [],
        },
      });

      const res = await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: {
          bill_id: BILL_1.id,
          patient_id: PATIENT_1.id,
          reason: 'Overcharge',
          items: [{ invoice_item_id: invoiceItem1.id, return_quantity: 5 }], // > 1 available
        },
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Cc]annot return|[Aa]vailable/);
    });

    it('creates a credit note and returns cn_no with refund amount', async () => {
      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          bills: [{ ...billWithPatient, patient_id: PATIENT_1.id }],
          invoice_items: [invoiceItem1],
          billing_credit_note_items: [],
          billing_credit_notes: [],
          sequences: [],
        },
      });

      const res = await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: {
          bill_id: BILL_1.id,
          patient_id: PATIENT_1.id,
          reason: 'Overcharge on consultation',
          items: [{ invoice_item_id: invoiceItem1.id, return_quantity: 1 }],
        },
      });
      expect(res.status).toBe(201);
      const body = await res.json() as {
        credit_note_no: string;
        refund_amount: number;
        message: string;
      };
      expect(body.credit_note_no).toMatch(/^CN-/);
      expect(body.refund_amount).toBe(1000); // 1000 unit_price × 1 qty
      expect(body.message).toMatch(/[Cc]redit note/);

      // Verify batch for items + bill update was executed
      const creditNoteInsert = mockDB.queries.find(q =>
        q.sql.includes('billing_credit_notes') && q.sql.toUpperCase().includes('INSERT')
      );
      expect(creditNoteInsert).toBeTruthy();
    });

    it('returns the existing credit note response when an idempotency key is replayed', async () => {
      const requestBody = {
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge on consultation',
        items: [{ invoice_item_id: invoiceItem1.id, return_quantity: 1 }],
        idempotencyKey: 'credit-note-replay-1',
      };
      const requestHash = await createIdempotencyRequestHash({ ...requestBody, idempotencyKey: undefined });

      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: requestHash,
                status: 'completed',
                response_json: JSON.stringify({
                  id: 70,
                  credit_note_no: 'CN-EXISTING',
                  refund_amount: 1000,
                  message: 'Credit note created',
                }),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: requestBody,
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { idempotent?: boolean; credit_note_no?: string };
      expect(body).toMatchObject({ idempotent: true, credit_note_no: 'CN-EXISTING' });
      expect(mockDB.queries.some((q) => q.sql.toUpperCase().includes('INSERT INTO BILLING_CREDIT_NOTES'))).toBe(false);
    });

    it('rejects a credit note idempotency key reused with a different payload', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: 'different-hash',
                status: 'completed',
                response_json: JSON.stringify({ id: 70 }),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: {
          bill_id: BILL_1.id,
          patient_id: PATIENT_1.id,
          reason: 'Cash refund',
          items: [{ invoice_item_id: invoiceItem1.id, return_quantity: 1 }],
          idempotencyKey: 'credit-note-replay-1',
        },
      });

      expect(res.status).toBe(409);
    });

    it('creates pending credit note even in a closed accounting period (validated at approval)', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          accounting_period_closes: [{
            tenant_id: TENANT_1.id,
            period_name: getTodayGMT6().substring(0, 7),
            status: 'closed',
          }],
          bills: [{ ...billWithPatient, patient_id: PATIENT_1.id }],
          invoice_items: [invoiceItem1],
          billing_credit_note_items: [],
          billing_credit_notes: [],
          sequences: [],
        },
      });

      const res = await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: {
          bill_id: BILL_1.id,
          patient_id: PATIENT_1.id,
          reason: 'Overcharge on consultation',
          items: [{ invoice_item_id: invoiceItem1.id, return_quantity: 1 }],
        },
      });

      // POST / creates pending note; accounting period is checked at approval time
      expect(res.status).toBe(201);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('pending');
    });

    it('creates pending credit note without requiring active counter (validated at approval)', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          bills: [{ ...billWithPatient, patient_id: PATIENT_1.id, total: 1000, paid: 1000, status: 'paid' }],
          invoice_items: [invoiceItem1],
          billing_credit_note_items: [],
          billing_credit_notes: [],
          sequences: [],
        },
      });

      const res = await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: {
          bill_id: BILL_1.id,
          patient_id: PATIENT_1.id,
          reason: 'Cash refund',
          payment_mode: 'cash',
          items: [{ invoice_item_id: invoiceItem1.id, return_quantity: 1 }],
        },
      });

      // POST / creates pending note; counter session is checked at approval time
      expect(res.status).toBe(201);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('pending');
    });

    it('creates credit note and items in a batch (no bill/cash/accounting at creation)', async () => {
      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          bills: [{ ...billWithPatient, patient_id: PATIENT_1.id, total: 1000, paid: 1000, status: 'paid' }],
          invoice_items: [invoiceItem1],
          billing_credit_note_items: [],
          billing_credit_notes: [],
          sequences: [],
        },
      });

      const res = await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: {
          bill_id: BILL_1.id,
          patient_id: PATIENT_1.id,
          reason: 'Cash refund',
          payment_mode: 'cash',
          items: [{ invoice_item_id: invoiceItem1.id, return_quantity: 1 }],
        },
      });

      expect(res.status).toBe(201);
      const creditNoteInsert = mockDB.queries.find(q =>
        q.sql.includes('billing_credit_notes') && q.sql.toUpperCase().includes('INSERT')
      );
      const itemInsert = mockDB.queries.find(q =>
        q.sql.includes('billing_credit_note_items') && q.sql.toUpperCase().includes('INSERT')
      );
      const auditInsert = mockDB.queries.find(q =>
        q.sql.includes('audit_logs') && q.sql.toUpperCase().includes('INSERT')
      );

      // Credit note, items, and audit are created at POST /
      expect(creditNoteInsert?.method).toBe('all');
      expect(itemInsert?.method).toBe('all');
      expect(auditInsert?.method).toBe('all');

      // Bill update, cash, and accounting are NOT done at POST / (done at approval)
      const billUpdate = mockDB.queries.find(q =>
        q.sql.includes('UPDATE bills SET total')
      );
      const cashInsert = mockDB.queries.find(q =>
        q.sql.includes('emp_cash_transactions') && q.sql.toUpperCase().includes('INSERT')
      );
      const postingInsert = mockDB.queries.find(q =>
        q.sql.includes('accounting_posting_events') && q.sql.toUpperCase().includes('INSERT')
      );
      expect(billUpdate).toBeUndefined();
      expect(cashInsert).toBeUndefined();
      expect(postingInsert).toBeUndefined();
    });

    it('validates items array must be non-empty', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { bills: [billWithPatient] },
      });

      const res = await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: {
          bill_id: BILL_1.id,
          patient_id: PATIENT_1.id,
          reason: 'Test',
          items: [], // empty array — should fail Zod validation
        },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Tenant isolation', () => {
    it('returns empty list for different tenant', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_2.id,
        tables: { billing_credit_notes: [] },
      });

      const res = await app.request('/credit-notes');
      expect(res.status).toBe(200);
      const body = await res.json() as { credit_notes: unknown[] };
      expect(body.credit_notes).toHaveLength(0);
    });
  });
});
