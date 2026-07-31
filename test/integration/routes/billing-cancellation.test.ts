/**
 * Integration tests for src/routes/tenant/billingCancellation.ts
 *
 * Tests bill cancellation (entire bill, single item, batch items),
 * already-cancelled guards, and bill total recalculation on item cancel.
 */

import { describe, it, expect } from 'vitest';
import cancellationRoute from '../../../src/routes/tenant/billingCancellation';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1, TENANT_2, BILL_1 } from '../helpers/fixtures';
import { getTodayGMT6 } from '../../../src/lib/date-utils';

// ─── Shared test data ──────────────────────────────────────────────────────────

const activeBill = {
  ...BILL_1,
  status: 'unpaid',
};

const cancelledBill = {
  ...BILL_1,
  id: 32,
  status: 'cancelled',
};

const activeItem = {
  id: 201,
  tenant_id: TENANT_1.id,
  bill_id: BILL_1.id,
  description: 'Consultation',
  quantity: 1,
  unit_price: 1000,
  line_total: 1000,
  status: 'active',
};

const cancelledItem = {
  id: 202,
  tenant_id: TENANT_1.id,
  bill_id: BILL_1.id,
  description: 'Lab test',
  unit_price: 500,
  line_total: 500,
  status: 'cancelled',
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Billing Cancellation Routes', () => {

  describe('PUT /bill/:id — cancel entire bill', () => {
    it('returns 404 when bill not found', async () => {
      const { app } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills: [] },
      });

      const res = await jsonRequest(app, '/billing-cancellation/bill/9999', {
        method: 'PUT',
        body: { reason: 'Duplicate entry' },
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when bill is already cancelled', async () => {
      const { app } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills: [cancelledBill] },
      });

      const res = await jsonRequest(app, `/billing-cancellation/bill/${cancelledBill.id}`, {
        method: 'PUT',
        body: { reason: 'Test' },
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Aa]lready cancelled/);
    });

    it('cancels an unpaid bill successfully', async () => {
      const { app, mockDB } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills: [activeBill] },
      });

      const res = await jsonRequest(app, `/billing-cancellation/bill/${BILL_1.id}`, {
        method: 'PUT',
        body: { reason: 'Patient refused treatment' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { message: string; bill_id: number };
      expect(body.message).toMatch(/[Cc]ancell/);
      expect(body.bill_id).toBe(BILL_1.id);

      // Verify batch UPDATE was issued (bill + invoice_items)
      const billUpdate = mockDB.queries.find(q =>
        q.sql.toUpperCase().includes('UPDATE') && q.sql.includes('bills')
      );
      expect(billUpdate).toBeTruthy();
      expect(mockDB.queries.some((q) =>
        q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
        && q.params.includes('bill_cancelled')
      )).toBe(true);
    });

    it('rejects bill cancellation in a closed accounting period', async () => {
      const { app } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          accounting_period_closes: [{
            tenant_id: TENANT_1.id,
            period_name: getTodayGMT6().substring(0, 7),
            status: 'closed',
          }],
          bills: [activeBill],
        },
      });

      const res = await jsonRequest(app, `/billing-cancellation/bill/${BILL_1.id}`, {
        method: 'PUT',
        body: { reason: 'Patient refused treatment' },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('accounting period');
    });

    it('requires non-empty reason (Zod validation)', async () => {
      const { app } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills: [activeBill] },
      });

      const res = await jsonRequest(app, `/billing-cancellation/bill/${BILL_1.id}`, {
        method: 'PUT',
        body: { reason: '' }, // empty string — fails Zod min(1)
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /item — cancel single invoice item', () => {
    it('returns 404 when item not found', async () => {
      const { app } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { invoice_items: [] },
      });

      const res = await jsonRequest(app, '/billing-cancellation/item', {
        method: 'PUT',
        body: { invoice_item_id: 9999, reason: 'Type error' },
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when item already cancelled', async () => {
      const { app } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: { invoice_items: [cancelledItem], bills: [activeBill] },
      });

      const res = await jsonRequest(app, '/billing-cancellation/item', {
        method: 'PUT',
        body: { invoice_item_id: cancelledItem.id, reason: 'Already done' },
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/[Aa]lready cancelled/);
    });

    it('cancels the item and recalculates bill total', async () => {
      const { app, mockDB } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          invoice_items: [activeItem],
          bills: [activeBill],
        },
      });

      const res = await jsonRequest(app, '/billing-cancellation/item', {
        method: 'PUT',
        body: { invoice_item_id: activeItem.id, reason: 'Patient request' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { message: string; new_bill_total: number };
      expect(body.message).toMatch(/[Cc]ancell/);

      // Verify bill total was updated
      const billUpdate = mockDB.queries.find(q =>
        q.sql.toUpperCase().includes('UPDATE') && q.sql.includes('bills')
      );
      expect(billUpdate).toBeTruthy();
      expect(mockDB.queries.some((q) =>
        q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
        && q.params.includes('billing_item_cancellation')
        && q.params.includes('bill_cancelled')
      )).toBe(true);
    });

    it('rejects item cancellation in a closed accounting period', async () => {
      const { app } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'accountant',
        tenantId: TENANT_1.id,
        tables: {
          accounting_period_closes: [{
            tenant_id: TENANT_1.id,
            period_name: getTodayGMT6().substring(0, 7),
            status: 'closed',
          }],
          invoice_items: [activeItem],
          bills: [activeBill],
        },
      });

      const res = await jsonRequest(app, '/billing-cancellation/item', {
        method: 'PUT',
        body: { invoice_item_id: activeItem.id, reason: 'Patient request' },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('accounting period');
    });
  });

  describe('PUT /items/batch — cancel multiple items', () => {
    it('batch-cancels multiple items', async () => {
      const { app, mockDB } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          invoice_items: [activeItem],
        },
      });

      const res = await jsonRequest(app, '/billing-cancellation/items/batch', {
        method: 'PUT',
        body: { invoice_item_ids: [activeItem.id], reason: 'Batch cancel' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { message: string };
      expect(body.message).toMatch(/[Cc]ancell/);

      const batchUpdate = mockDB.queries.find(q =>
        q.sql.toUpperCase().includes('UPDATE') && q.sql.includes('invoice_items')
      );
      expect(batchUpdate).toBeTruthy();
    });

    it('validates invoice_item_ids must be non-empty', async () => {
      const { app } = createTestApp({
        route: cancellationRoute,
        routePath: '/billing-cancellation',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/billing-cancellation/items/batch', {
        method: 'PUT',
        body: { invoice_item_ids: [], reason: 'Test' },
      });
      expect(res.status).toBe(400);
    });
  });
});
