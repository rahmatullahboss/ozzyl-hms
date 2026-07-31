import { describe, it, expect } from 'vitest';
import billingReportsRoute from '../src/routes/tenant/billingReports';
import { createTestApp } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp(role = 'hospital_admin') {
  return createTestApp({
    route: billingReportsRoute,
    routePath: '/billing-reports',
    role,
    tenantId: TENANT_ID,
    universalFallback: true,
  });
}

describe('Billing Reports', () => {

  describe('GET /daily-sales', () => {
    it('returns invoices, settlements, user_collections, summary', async () => {
      const { app } = makeApp();

      const res = await app.request('/billing-reports/daily-sales?date=2025-06-01');
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('date');
      expect(body).toHaveProperty('invoices');
      expect(body).toHaveProperty('settlements');
      expect(body).toHaveProperty('user_collections');
      expect(body).toHaveProperty('summary');

      const settlements = body.settlements as Record<string, unknown>;
      expect(settlements).toHaveProperty('total_settlement');
      expect(settlements).toHaveProperty('total_refund');
      expect(settlements).toHaveProperty('total_adjustment');

      const summary = body.summary as Record<string, unknown>;
      expect(summary).toHaveProperty('total_cash_sales');
      expect(summary).toHaveProperty('total_sales_return');
    });

    it('applies counter_id filter', async () => {
      const { app, mockDB } = makeApp();

      const res = await app.request('/billing-reports/daily-sales?date=2025-06-01&counter_id=5');
      expect(res.status).toBe(200);

      const invoiceQuery = mockDB.queries.find(q =>
        q.sql.includes('bills') && q.method === 'all' && q.sql.includes('counter_id'),
      );
      expect(invoiceQuery).toBeTruthy();
      expect(invoiceQuery!.params).toContain(5);
    });
  });

  describe('GET /sales-daybook', () => {
    it('returns daybook grouped by date', async () => {
      const { app } = makeApp();

      const res = await app.request(
        '/billing-reports/sales-daybook?start_date=2025-06-01&end_date=2025-06-30',
      );
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('daybook');
    });
  });

  describe('GET /handover/receive', () => {
    it('requires start_date and end_date', async () => {
      const { app } = makeApp();

      const res = await app.request('/billing-reports/handover/receive');
      expect(res.status).toBe(400);

      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain('start_date');
    });

    it('returns handovers and summary', async () => {
      const { app } = makeApp();

      const res = await app.request(
        '/billing-reports/handover/receive?start_date=2025-06-01&end_date=2025-06-30',
      );
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('handovers');
      expect(body).toHaveProperty('summary');

      const summary = body.summary as Record<string, unknown>;
      expect(summary).toHaveProperty('total_handovers');
      expect(summary).toHaveProperty('total_amount');
      expect(summary).toHaveProperty('total_due');
    });
  });

  describe('GET /discount/scheme-wise', () => {
    it('returns discounts and summary', async () => {
      const { app } = makeApp();

      const res = await app.request(
        '/billing-reports/discount/scheme-wise?start_date=2025-06-01&end_date=2025-06-30',
      );
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('discounts');
      expect(body).toHaveProperty('summary');

      const summary = body.summary as Record<string, unknown>;
      expect(summary).toHaveProperty('total_bills');
      expect(summary).toHaveProperty('total_discount');
    });
  });

  describe('GET /payment-mode', () => {
    it('returns payment_modes', async () => {
      const { app } = makeApp();

      const res = await app.request(
        '/billing-reports/payment-mode?start_date=2025-06-01&end_date=2025-06-30',
      );
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('payment_modes');
    });
  });

  describe('GET /item-summary', () => {
    it('returns items', async () => {
      const { app } = makeApp();

      const res = await app.request(
        '/billing-reports/item-summary?start_date=2025-06-01&end_date=2025-06-30',
      );
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('items');
    });
  });

  describe('Validation', () => {
    it('returns 400 when start_date is missing', async () => {
      const { app } = makeApp();

      const res = await app.request(
        '/billing-reports/handover/receive?end_date=2025-06-30',
      );
      expect(res.status).toBe(400);

      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain('start_date');
    });

    it('returns 400 for invalid date format', async () => {
      const { app } = makeApp();

      const res = await app.request(
        '/billing-reports/handover/receive?start_date=01-06-2025&end_date=2025-06-30',
      );
      expect(res.status).toBe(400);

      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain('YYYY-MM-DD');
    });
  });
});
