import { describe, it, expect } from 'vitest';
import billVersionsRoute from '../../../src/routes/tenant/bill-versions';
import { createTestApp } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

const existingBill = {
  id: 100, invoice_no: 'INV-001', patient_id: 50, total: 5000,
  discount: 0, paid: 0, status: 'open', tenant_id: TENANT_1.id,
};

const version1 = {
  id: 1, tenant_id: TENANT_1.id, bill_id: 100, version_number: 1,
  edited_by: 1, edit_reason: 'Price correction',
  total: 5000, discount: 0, discount_reason: null, tax_total: 0, due: 0,
  test_bill: 3000, admission_bill: 0, doctor_visit_bill: 2000,
  operation_bill: 0, medicine_bill: 0,
  items_snapshot: JSON.stringify([
    { item_category: 'test', description: 'Blood Test', quantity: 1, unit_price: 3000, line_total: 3000 },
    { item_category: 'doctor_visit', description: 'Consultation', quantity: 1, unit_price: 2000, line_total: 2000 },
  ]),
  created_at: '2026-05-27 10:00:00',
};

const version2 = {
  ...version1, id: 2, version_number: 2, total: 6000,
  edit_reason: 'Added extra test',
  items_snapshot: JSON.stringify([
    { item_category: 'test', description: 'Blood Test', quantity: 1, unit_price: 3000, line_total: 3000 },
    { item_category: 'test', description: 'Urine Test', quantity: 1, unit_price: 1000, line_total: 1000 },
    { item_category: 'doctor_visit', description: 'Consultation', quantity: 1, unit_price: 2000, line_total: 2000 },
  ]),
};

describe('Bill Versions API', () => {
  describe('GET /bill-versions/:billId', () => {
    it('returns version history for a bill', async () => {
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bill_versions: [version1, version2], bills: [existingBill] },
      });

      const res = await app.request('/bill-versions/100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: { total: number } };
      expect(body.data.length).toBe(2);
      expect(body.pagination.total).toBe(2);
    });

    it('returns versions in descending order (newest first)', async () => {
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bill_versions: [version2, version1], bills: [existingBill] },
      });

      const res = await app.request('/bill-versions/100');
      const body = await res.json() as { data: { version_number: number }[] };
      expect(body.data[0].version_number).toBe(2);
      expect(body.data[1].version_number).toBe(1);
    });

    it('parses items_snapshot JSON', async () => {
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bill_versions: [version1], bills: [existingBill] },
      });

      const res = await app.request('/bill-versions/100');
      const body = await res.json() as { data: { items_snapshot: unknown }[] };
      expect(Array.isArray(body.data[0].items_snapshot)).toBe(true);
    });

    it('returns empty list for bill with no versions', async () => {
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bill_versions: [], bills: [existingBill] },
      });

      const res = await app.request('/bill-versions/100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('returns 403 for non-admin role', async () => {
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { bill_versions: [] },
      });

      const res = await app.request('/bill-versions/100');
      expect(res.status).toBe(403);
    });

    it('does not show versions from other tenants', async () => {
      const otherTenantVersion = { ...version1, tenant_id: 'tenant-2' };
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bill_versions: [version1, otherTenantVersion], bills: [existingBill] },
      });

      const res = await app.request('/bill-versions/100');
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('paginates results', async () => {
      const versions = Array.from({ length: 25 }, (_, i) => ({
        ...version1, id: i + 1, version_number: i + 1,
      }));
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bill_versions: versions, bills: [existingBill] },
      });

      const res = await app.request('/bill-versions/100?page=2&limit=10');
      const body = await res.json() as { pagination: { page: number; totalPages: number } };
      expect(body.pagination.page).toBe(2);
      expect(body.pagination.totalPages).toBe(3);
    });

    it('returns 400 for non-numeric billId', async () => {
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bill_versions: [] },
      });

      const res = await app.request('/bill-versions/abc');
      expect(res.status).toBe(400);
    });

    it('returns 400 for negative billId', async () => {
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bill_versions: [] },
      });

      const res = await app.request('/bill-versions/-1');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /bill-versions/:billId/latest', () => {
    it('returns the latest version', async () => {
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bill_versions: [version2, version1], bills: [existingBill] },
      });

      const res = await app.request('/bill-versions/100/latest');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { version_number: number } };
      expect(body.data.version_number).toBe(2);
    });

    it('returns 404 when no versions exist', async () => {
      const { app } = createTestApp({
        route: billVersionsRoute,
        routePath: '/bill-versions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bill_versions: [], bills: [existingBill] },
      });

      const res = await app.request('/bill-versions/100/latest');
      expect(res.status).toBe(404);
    });
  });
});
