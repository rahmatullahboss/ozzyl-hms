import { describe, expect, it } from 'vitest';
import pharmacyRoutes from '../src/routes/tenant/pharmacy';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const invoiceBody = {
  patientId: 1,
  counterId: 7,
  paidAmount: 1000,
  tender: 1000,
  paymentMode: 'cash' as const,
  items: [
    { itemId: 10, stockId: 1, batchNo: 'B-1', quantity: 1, mrp: 1200, price: 1000 },
  ],
};

describe('pharmacy billing accounting flow', () => {
  it('rejects paid pharmacy invoices without an active billing/pharmacy counter session', async () => {
    const { app, mockDB } = createTestApp({
      route: pharmacyRoutes,
      routePath: '/pharmacy',
      role: 'pharmacist',
      tenantId: 'tenant-1',
      userId: 7,
      tables: {
        billing_counter_sessions: [],
      },
    });

    const res = await jsonRequest(app, '/pharmacy/invoices', {
      method: 'POST',
      body: invoiceBody,
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO pharmacy_invoices/i.test(q.sql))).toBe(false);
  });

  it('links paid pharmacy invoices to the active counter and posts revenue, payment, COGS, and drawer movement', async () => {
    const { app, mockDB } = createTestApp({
      route: pharmacyRoutes,
      routePath: '/pharmacy',
      role: 'pharmacist',
      tenantId: 'tenant-1',
      userId: 7,
      tables: {
        billing_counter_sessions: [{
          id: 17,
          counter_id: 7,
          employee_id: '7',
          tenant_id: 'tenant-1',
          status: 'active',
          counter_type: 'pharmacy',
          opening_cash: 0,
          opened_at: '2026-05-13 08:00:00',
        }],
        billing_counters: [{
          id: 7,
          tenant_id: 'tenant-1',
          counter_name: 'Pharmacy Counter',
          counter_code: 'PH-1',
          counter_type: 'pharmacy',
          is_active: 1,
        }],
        pharmacy_stock: [{
          id: 1,
          item_id: 10,
          tenant_id: 'tenant-1',
          available_qty: 5,
          expiry_date: '2099-12-31',
          cost_price: 600,
          is_active: 1,
          batch_no: 'B-1',
        }],
      },
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        // Return success for stock availability checks
        if (s.includes('select') && s.includes('pharmacy_stock') && s.includes('available_qty')) {
          return { first: { available_qty: 5, cost_price: 600 }, results: [{ available_qty: 5, cost_price: 600 }] };
        }
        // Return success for stock deduction (UPDATE with guard)
        if (s.startsWith('update') && s.includes('pharmacy_stock') && s.includes('available_qty >= ?')) {
          return { success: true, meta: { last_row_id: 0, changes: 1, duration: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/pharmacy/invoices', {
      method: 'POST',
      body: invoiceBody,
    });

    expect(res.status).toBe(201);
    const invoiceInsert = mockDB.queries.find((q) => /INSERT INTO pharmacy_invoices/i.test(q.sql));
    expect(invoiceInsert?.sql).toContain('counter_session_id');
    expect(invoiceInsert?.params).toContain(17);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params.includes('bill_created')
    )).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params.includes('payment_received')
    )).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params.includes('pharmacy_sale_cogs')
    )).toBe(true);
    expect(mockDB.queries.some((q) =>
      /INSERT INTO emp_cash_transactions/i.test(q.sql)
      && q.sql.includes('counter_session_id')
      && q.params.includes(17)
    )).toBe(true);
  });

  it('prevents duplicate pharmacy returns from exceeding the original sold quantity', async () => {
    const { app, mockDB } = createTestApp({
      route: pharmacyRoutes,
      routePath: '/pharmacy',
      role: 'pharmacist',
      tenantId: 'tenant-1',
      userId: 7,
      tables: {
        pharmacy_invoices: [{
          id: 77,
          tenant_id: 'tenant-1',
          is_active: 1,
          is_return: 0,
        }],
        pharmacy_invoice_items: [{
          id: 11,
          invoice_id: 77,
          item_id: 10,
          tenant_id: 'tenant-1',
          quantity: 2,
        }],
        pharmacy_invoice_return_items: [{
          id: 1,
          invoice_item_id: 11,
          invoice_id: 77,
          tenant_id: 'tenant-1',
          quantity: 1,
        }],
        pharmacy_invoice_returns: [{
          id: 1,
          invoice_id: 77,
          tenant_id: 'tenant-1',
          is_active: 1,
        }],
      },
    });

    const res = await jsonRequest(app, '/pharmacy/invoice-returns', {
      method: 'POST',
      body: {
        invoiceId: 77,
        returnDate: '2026-05-13',
        items: [{
          invoiceItemId: 11,
          itemId: 10,
          stockId: 1,
          batchNo: 'B-1',
          quantity: 2,
          price: 1000,
        }],
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('remaining sold qty');
    expect(mockDB.queries.some((q) => /INSERT INTO pharmacy_invoice_returns/i.test(q.sql))).toBe(false);
  });
});
