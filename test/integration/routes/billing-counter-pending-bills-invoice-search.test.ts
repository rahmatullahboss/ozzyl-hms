/**
 * Integration tests for invoice_no search on
 * GET /api/billing-counter/pending-bills.
 *
 * The /pending-bills endpoint lists unpaid, non-cancelled bills for the
 * billing counter UI. When a `search` query parameter is supplied the
 * SQL must also match the bill's `invoice_no` — with typo-tolerant
 * o->0 and numeric zero-padding via buildInvoiceSearchTerms.
 *
 * Companion change: src/routes/tenant/billingCounter.ts wires
 * buildInvoiceSearchTerms into the search clause for /pending-bills.
 */

import { describe, it, expect } from 'vitest';
import billingCounterRoutes from '../../../src/routes/tenant/billingCounter';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

describe('GET /billing-counter/pending-bills - invoice_no search', () => {
  it('applies invoice_no LIKE clauses when ?search= is supplied', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        bills: [
          {
            id: 500,
            tenant_id: TENANT_1.id,
            visit_id: null,
            patient_id: 10,
            invoice_no: 'INV-000001',
            total: 1000,
            paid: 0,
            due: 1000,
            status: 'open',
            created_at: '2026-07-01 10:00:00',
            test_bill: 1,
            operation_bill: 0,
            admission_bill: 0,
            medicine_bill: 0,
          },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Karim', patient_code: 'P-002', mobile: '01700000002' }],
        invoice_items: [{ id: 1, tenant_id: TENANT_1.id, bill_id: 500, item_category: 'test', description: 'CBC', quantity: 1, unit_price: 1000, line_total: 1000, reference_id: null }],
        visit_services: [],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/pending-bills?search=inv-oooo1');
    expect(res.status).toBe(200);

    const pendingSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+bills/i.test(sql) && sql.toLowerCase().includes('invoice_no like'));
    expect(pendingSql).toBeDefined();
  });

  it('does not add invoice_no clause when search is empty', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        bills: [
          {
            id: 500,
            tenant_id: TENANT_1.id,
            visit_id: null,
            patient_id: 10,
            invoice_no: 'INV-000001',
            total: 1000,
            paid: 0,
            due: 1000,
            status: 'open',
            created_at: '2026-07-01 10:00:00',
            test_bill: 1,
            operation_bill: 0,
            admission_bill: 0,
            medicine_bill: 0,
          },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Karim', patient_code: 'P-002', mobile: '01700000002' }],
        invoice_items: [{ id: 1, tenant_id: TENANT_1.id, bill_id: 500, item_category: 'test', description: 'CBC', quantity: 1, unit_price: 1000, line_total: 1000, reference_id: null }],
        visit_services: [],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/pending-bills');
    expect(res.status).toBe(200);

    const pendingSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+bills/i.test(sql));
    expect(pendingSql).toBeDefined();
    expect(pendingSql!.toLowerCase()).not.toContain('invoice_no like');
  });

  it('escapes LIKE wildcards in user search input (append ESCAPE)', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        bills: [
          {
            id: 500,
            tenant_id: TENANT_1.id,
            visit_id: null,
            patient_id: 10,
            invoice_no: 'INV-000001',
            total: 1000,
            paid: 0,
            due: 1000,
            status: 'open',
            created_at: '2026-07-01 10:00:00',
            test_bill: 1,
            operation_bill: 0,
            admission_bill: 0,
            medicine_bill: 0,
          },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Karim', patient_code: 'P-002', mobile: '01700000002' }],
        invoice_items: [{ id: 1, tenant_id: TENANT_1.id, bill_id: 500, item_category: 'test', description: 'CBC', quantity: 1, unit_price: 1000, line_total: 1000, reference_id: null }],
        visit_services: [],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/pending-bills?search=inv%25');
    expect(res.status).toBe(200);

    const pendingSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+bills/i.test(sql) && sql.toLowerCase().includes('invoice_no like'));
    expect(pendingSql).toBeDefined();
    // Every LIKE clause in the search branch should append the ESCAPE modifier
    expect(pendingSql!.toLowerCase()).toContain('like ? escape');
  });
});
