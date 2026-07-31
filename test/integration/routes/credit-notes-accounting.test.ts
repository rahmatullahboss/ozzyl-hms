import { describe, expect, it } from 'vitest';
import creditNoteRoutes from '../../../src/routes/tenant/creditNotes';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { ACTIVE_BILLING_COUNTER_TABLES } from '../helpers/fixtures';

describe('credit note accounting', () => {
  it('records a central accounting event and adjusts paid amount for cash refunds', async () => {
    const { app, mockDB } = createTestApp({
      route: creditNoteRoutes,
      routePath: '/credit-notes',
      role: 'accountant',
      queryOverride(sql) {
        if (/FROM lab_order_items loi[\s\S]*JOIN lab_orders lo/i.test(sql)) {
          return { results: [{ id: 501, status: 'pending' }] };
        }
        if (/FROM radiology_requisitions/i.test(sql)) return { results: [] };
        return null;
      },
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        bills: [{
          id: 10,
          tenant_id: 'tenant-1',
          patient_id: 7,
          total: 1000,
          paid: 1000,
          status: 'paid',
        }],
        invoice_items: [{
          id: 22,
          tenant_id: 'tenant-1',
          bill_id: 10,
          item_category: 'test',
          description: 'CBC',
          quantity: 1,
          unit_price: 500,
          line_total: 500,
          reference_id: 501,
          status: 'active',
        }],
        lab_orders: [{
          id: 600,
          tenant_id: 'tenant-1',
          bill_id: 10,
          patient_id: 7,
          status: 'pending',
        }],
        lab_order_items: [{
          id: 501,
          tenant_id: 'tenant-1',
          lab_order_id: 600,
          status: 'pending',
        }],
      },
    });

    const res = await jsonRequest(app, '/credit-notes', {
      method: 'POST',
      body: {
        bill_id: 10,
        patient_id: 7,
        reason: 'Returned service',
        payment_mode: 'cash',
        items: [{ invoice_item_id: 22, return_quantity: 1 }],
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; credit_note_no: string; refund_amount: number; status: string };
    expect(body.credit_note_no).toBeDefined();
    expect(body.refund_amount).toBe(500);
    expect(body.status).toBe('pending');
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT INTO billing_credit_notes')
    )).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT INTO billing_credit_note_items')
    )).toBe(true);
  });
});
