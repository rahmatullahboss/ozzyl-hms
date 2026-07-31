/**
 * Tests for credit note approval workflow (Task 4)
 *
 * Credit notes should be created as "pending" and require approval
 * before refund processing happens.
 */

import { describe, it, expect } from 'vitest';
import creditNotesRoute from '../src/routes/tenant/creditNotes';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import {
  ACTIVE_BILLING_COUNTER_TABLES,
  TENANT_1,
  PATIENT_1,
  BILL_1,
} from './integration/helpers/fixtures';
import { getTodayGMT6 } from '../src/lib/date-utils';

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
  item_category: 'doctor_visit',
};

const billPaid = {
  ...BILL_1,
  patient_id: PATIENT_1.id,
  patient_name: PATIENT_1.name,
  total: 1000,
  paid: 1000,
  status: 'paid',
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Credit Note Approval Workflow', () => {

  describe('POST / — create credit note sets status = pending', () => {
    it('creates a credit note with status pending', async () => {
      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          bills: [billPaid],
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
          reason: 'Overcharge',
          payment_mode: 'cash',
          items: [{ invoice_item_id: invoiceItem1.id, return_quantity: 1 }],
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { id: number; credit_note_no: string; status?: string };
      expect(body.credit_note_no).toMatch(/^CN-/);

      // Verify the INSERT includes status = 'pending' (in SQL literal)
      const creditNoteInsert = mockDB.queries.find(q =>
        q.sql.includes('billing_credit_notes') && q.sql.toUpperCase().includes('INSERT')
      );
      expect(creditNoteInsert).toBeTruthy();
      expect(creditNoteInsert!.sql).toContain('status');
      expect(creditNoteInsert!.sql).toContain('pending');
    });

    it('does NOT update bill total when creating pending credit note', async () => {
      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          bills: [billPaid],
          invoice_items: [invoiceItem1],
          billing_credit_note_items: [],
          billing_credit_notes: [],
          sequences: [],
        },
      });

      await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: {
          bill_id: BILL_1.id,
          patient_id: PATIENT_1.id,
          reason: 'Overcharge',
          payment_mode: 'cash',
          items: [{ invoice_item_id: invoiceItem1.id, return_quantity: 1 }],
        },
      });

      // Bill should NOT be updated on creation — only on approval
      const billUpdate = mockDB.queries.find(q =>
        q.sql.includes('UPDATE bills SET total')
      );
      expect(billUpdate).toBeUndefined();
    });

    it('does NOT create cash transaction when creating pending credit note', async () => {
      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          bills: [billPaid],
          invoice_items: [invoiceItem1],
          billing_credit_note_items: [],
          billing_credit_notes: [],
          sequences: [],
        },
      });

      await jsonRequest(app, '/credit-notes', {
        method: 'POST',
        body: {
          bill_id: BILL_1.id,
          patient_id: PATIENT_1.id,
          reason: 'Overcharge',
          payment_mode: 'cash',
          items: [{ invoice_item_id: invoiceItem1.id, return_quantity: 1 }],
        },
      });

      // Cash transaction should NOT be created on creation — only on approval
      const cashInsert = mockDB.queries.find(q =>
        q.sql.includes('emp_cash_transactions') && q.sql.toUpperCase().includes('INSERT')
      );
      expect(cashInsert).toBeUndefined();
    });
  });

  describe('POST /:id/approve — approve credit note', () => {
    it('approves a pending credit note and sets status to approved', async () => {
      const pendingNote = {
        id: 50,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000050',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        payment_mode: 'cash',
        status: 'pending',
        is_active: 1,
        created_by: 1,
      };

      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        userId: 2,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          billing_credit_notes: [pendingNote],
          billing_credit_note_items: [{
            id: 1,
            tenant_id: TENANT_1.id,
            credit_note_id: 50,
            invoice_item_id: invoiceItem1.id,
            item_name: 'Consultation fee',
            unit_price: 1000,
            return_quantity: 1,
            total_amount: 1000,
          }],
          bills: [billPaid],
          invoice_items: [invoiceItem1],
          sequences: [],
        },
        queryOverride: (sql) => {
          // Mock the counter session JOIN query
          if (sql.includes('billing_counter_sessions') && sql.includes('JOIN billing_counters')) {
            return {
              first: {
                id: 7101,
                counter_id: 7001,
                counter_name: 'Main Billing Counter',
                counter_code: 'BILL-1',
                counter_type: 'billing',
                opening_cash: 0,
                opened_at: '2024-01-19T08:00:00Z',
              },
            };
          }
          // Status UPDATE — mock filterRows can't parse SET clause params correctly
          if (sql.includes('billing_credit_notes') && sql.toUpperCase().includes('SET STATUS')) {
            return { meta: { changes: 1 } };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/credit-notes/50/approve', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { message: string; status?: string };
      expect(body.message).toMatch(/approved/i);

      // Verify UPDATE sets status = 'approved' (in SQL string) and approved_by (in params)
      const statusUpdate = mockDB.queries.find(q =>
        q.sql.includes('billing_credit_notes') && q.sql.toUpperCase().includes('UPDATE') && q.sql.includes('approved')
      );
      expect(statusUpdate).toBeTruthy();
      expect(statusUpdate!.params).toContain('2'); // userId as approved_by (string from requireUserId)
    });

    it('processes refund (updates bill) when approving', async () => {
      const pendingNote = {
        id: 50,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000050',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        payment_mode: 'cash',
        status: 'pending',
        is_active: 1,
        created_by: 1,
      };

      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          billing_credit_notes: [pendingNote],
          billing_credit_note_items: [{
            id: 1,
            tenant_id: TENANT_1.id,
            credit_note_id: 50,
            invoice_item_id: invoiceItem1.id,
            item_name: 'Consultation fee',
            unit_price: 1000,
            return_quantity: 1,
            total_amount: 1000,
          }],
          bills: [billPaid],
          invoice_items: [invoiceItem1],
          sequences: [],
        },
        queryOverride: (sql) => {
          if (sql.includes('billing_counter_sessions') && sql.includes('JOIN billing_counters')) {
            return {
              first: {
                id: 7101,
                counter_id: 7001,
                counter_name: 'Main Billing Counter',
                counter_code: 'BILL-1',
                counter_type: 'billing',
                opening_cash: 0,
                opened_at: '2024-01-19T08:00:00Z',
              },
            };
          }
          // Status UPDATE — mock filterRows can't parse SET clause params correctly
          if (sql.includes('billing_credit_notes') && sql.toUpperCase().includes('SET STATUS')) {
            return { meta: { changes: 1 } };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/credit-notes/50/approve', {
        method: 'POST',
      });

      expect(res.status).toBe(200);

      // Verify bill update happens
      const billUpdate = mockDB.queries.find(q =>
        q.sql.includes('UPDATE bills SET total')
      );
      expect(billUpdate).toBeTruthy();

      // Verify cash transaction is created
      const cashInsert = mockDB.queries.find(q =>
        q.sql.includes('emp_cash_transactions') && q.sql.toUpperCase().includes('INSERT')
      );
      expect(cashInsert).toBeTruthy();

      // Verify accounting event is created
      const accountingInsert = mockDB.queries.find(q =>
        q.sql.includes('accounting_posting_events') && q.sql.toUpperCase().includes('INSERT')
      );
      expect(accountingInsert).toBeTruthy();
    });

    it('returns 404 when credit note not found', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          billing_credit_notes: [],
        },
      });

      const res = await jsonRequest(app, '/credit-notes/999/approve', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when credit note is already approved', async () => {
      const approvedNote = {
        id: 51,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000051',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        status: 'approved',
        is_active: 1,
        approved_by: 1,
        approved_at: '2026-05-20 10:00:00',
      };

      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          billing_credit_notes: [approvedNote],
        },
      });

      const res = await jsonRequest(app, '/credit-notes/51/approve', {
        method: 'POST',
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/already|status/i);
    });

    it('returns 400 when credit note is rejected', async () => {
      const rejectedNote = {
        id: 52,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000052',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        status: 'rejected',
        is_active: 1,
        approved_by: 1,
        approved_at: '2026-05-20 10:00:00',
      };

      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          billing_credit_notes: [rejectedNote],
        },
      });

      const res = await jsonRequest(app, '/credit-notes/52/approve', {
        method: 'POST',
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when bill is cancelled', async () => {
      const pendingNote = {
        id: 58,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000058',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        payment_mode: 'cash',
        status: 'pending',
        is_active: 1,
        created_by: 1,
      };

      const cancelledBill = {
        ...BILL_1,
        patient_id: PATIENT_1.id,
        patient_name: PATIENT_1.name,
        total: 1000,
        paid: 1000,
        status: 'cancelled',
      };

      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          billing_credit_notes: [pendingNote],
          billing_credit_note_items: [{
            id: 1,
            tenant_id: TENANT_1.id,
            credit_note_id: 58,
            invoice_item_id: invoiceItem1.id,
            item_name: 'Consultation fee',
            unit_price: 1000,
            return_quantity: 1,
            total_amount: 1000,
          }],
          bills: [cancelledBill],
          invoice_items: [invoiceItem1],
          sequences: [],
        },
      });

      const res = await jsonRequest(app, '/credit-notes/58/approve', {
        method: 'POST',
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/cancelled|refunded/i);
    });

    it('returns 400 when bill is refunded', async () => {
      const pendingNote = {
        id: 59,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000059',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        payment_mode: 'cash',
        status: 'pending',
        is_active: 1,
        created_by: 1,
      };

      const refundedBill = {
        ...BILL_1,
        patient_id: PATIENT_1.id,
        patient_name: PATIENT_1.name,
        total: 0,
        paid: 0,
        status: 'refunded',
      };

      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          billing_credit_notes: [pendingNote],
          billing_credit_note_items: [{
            id: 1,
            tenant_id: TENANT_1.id,
            credit_note_id: 59,
            invoice_item_id: invoiceItem1.id,
            item_name: 'Consultation fee',
            unit_price: 1000,
            return_quantity: 1,
            total_amount: 1000,
          }],
          bills: [refundedBill],
          invoice_items: [invoiceItem1],
          sequences: [],
        },
      });

      const res = await jsonRequest(app, '/credit-notes/59/approve', {
        method: 'POST',
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/cancelled|refunded/i);
    });
  });

  describe('POST /:id/reject — reject credit note', () => {
    it('rejects a pending credit note without processing refund', async () => {
      const pendingNote = {
        id: 53,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000053',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        payment_mode: 'cash',
        status: 'pending',
        is_active: 1,
        created_by: 1,
      };

      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        userId: 3,
        tables: {
          billing_credit_notes: [pendingNote],
          bills: [billPaid],
        },
      });

      const res = await jsonRequest(app, '/credit-notes/53/reject', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { message: string };
      expect(body.message).toMatch(/rejected/i);

      // Verify UPDATE sets status = 'rejected' (in SQL literal) and approved_by (in params)
      const statusUpdate = mockDB.queries.find(q =>
        q.sql.includes('billing_credit_notes') && q.sql.toUpperCase().includes('UPDATE') && q.sql.includes('rejected')
      );
      expect(statusUpdate).toBeTruthy();
      expect(statusUpdate!.params).toContain('3'); // userId as approved_by (string from requireUserId)

      // Verify NO bill update
      const billUpdate = mockDB.queries.find(q =>
        q.sql.includes('UPDATE bills SET total')
      );
      expect(billUpdate).toBeUndefined();

      // Verify NO cash transaction
      const cashInsert = mockDB.queries.find(q =>
        q.sql.includes('emp_cash_transactions') && q.sql.toUpperCase().includes('INSERT')
      );
      expect(cashInsert).toBeUndefined();

      // Verify NO accounting event
      const accountingInsert = mockDB.queries.find(q =>
        q.sql.includes('accounting_posting_events') && q.sql.toUpperCase().includes('INSERT')
      );
      expect(accountingInsert).toBeUndefined();
    });

    it('returns 404 when credit note not found', async () => {
      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          billing_credit_notes: [],
        },
      });

      const res = await jsonRequest(app, '/credit-notes/999/reject', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when credit note is already approved', async () => {
      const approvedNote = {
        id: 54,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000054',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        status: 'approved',
        is_active: 1,
        approved_by: 1,
        approved_at: '2026-05-20 10:00:00',
      };

      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          billing_credit_notes: [approvedNote],
        },
      });

      const res = await jsonRequest(app, '/credit-notes/54/reject', {
        method: 'POST',
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/already|status/i);
    });

    it('returns 400 when credit note is already rejected', async () => {
      const rejectedNote = {
        id: 55,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000055',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        status: 'rejected',
        is_active: 1,
        approved_by: 1,
        approved_at: '2026-05-20 10:00:00',
      };

      const { app } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          billing_credit_notes: [rejectedNote],
        },
      });

      const res = await jsonRequest(app, '/credit-notes/55/reject', {
        method: 'POST',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('Approval audit logging', () => {
    it('creates an audit log entry when approving', async () => {
      const pendingNote = {
        id: 56,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000056',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        payment_mode: 'cash',
        status: 'pending',
        is_active: 1,
        created_by: 1,
      };

      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        userId: 2,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          billing_credit_notes: [pendingNote],
          billing_credit_note_items: [{
            id: 1,
            tenant_id: TENANT_1.id,
            credit_note_id: 56,
            invoice_item_id: invoiceItem1.id,
            item_name: 'Consultation fee',
            unit_price: 1000,
            return_quantity: 1,
            total_amount: 1000,
          }],
          bills: [billPaid],
          invoice_items: [invoiceItem1],
          sequences: [],
        },
        queryOverride: (sql) => {
          if (sql.includes('billing_counter_sessions') && sql.includes('JOIN billing_counters')) {
            return {
              first: {
                id: 7101,
                counter_id: 7001,
                counter_name: 'Main Billing Counter',
                counter_code: 'BILL-1',
                counter_type: 'billing',
                opening_cash: 0,
                opened_at: '2024-01-19T08:00:00Z',
              },
            };
          }
          // Status UPDATE — mock filterRows can't parse SET clause params correctly
          if (sql.includes('billing_credit_notes') && sql.toUpperCase().includes('SET STATUS')) {
            return { meta: { changes: 1 } };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/credit-notes/56/approve', {
        method: 'POST',
      });
      expect(res.status).toBe(200);

      // Verify audit log is created with APPROVE action (in SQL literal)
      const auditInsert = mockDB.queries.find(q =>
        q.sql.includes('audit_logs') && q.sql.toUpperCase().includes('INSERT') && q.sql.includes('APPROVE')
      );
      expect(auditInsert).toBeTruthy();
    });

    it('creates an audit log entry when rejecting', async () => {
      const pendingNote = {
        id: 57,
        tenant_id: TENANT_1.id,
        credit_note_no: 'CN-000057',
        bill_id: BILL_1.id,
        patient_id: PATIENT_1.id,
        reason: 'Overcharge',
        total_amount: 1000,
        refund_amount: 1000,
        status: 'pending',
        is_active: 1,
        created_by: 1,
      };

      const { app, mockDB } = createTestApp({
        route: creditNotesRoute,
        routePath: '/credit-notes',
        role: 'accountant',
        tenantId: TENANT_1.id,
        userId: 3,
        tables: {
          billing_credit_notes: [pendingNote],
          bills: [billPaid],
        },
      });

      const res = await jsonRequest(app, '/credit-notes/57/reject', {
        method: 'POST',
      });
      expect(res.status).toBe(200);

      // Verify audit log is created with REJECT action (in SQL literal)
      const auditInsert = mockDB.queries.find(q =>
        q.sql.includes('audit_logs') && q.sql.toUpperCase().includes('INSERT') && q.sql.includes('REJECT')
      );
      expect(auditInsert).toBeTruthy();
    });
  });
});
