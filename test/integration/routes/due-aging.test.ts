import { describe, it, expect } from 'vitest';
import dueAgingRoute from '../../../src/routes/tenant/due-aging';
import { createTestApp } from '../helpers/test-app';

const TENANT_1 = { id: 'tenant-1' };

const bills = [
  { id: 1, invoice_no: 'INV-001', patient_id: 1, total: 5000, paid: 3000, due: 2000, status: 'partially_paid', tenant_id: TENANT_1.id, created_at: '2026-05-19 10:00:00' },
  { id: 2, invoice_no: 'INV-002', patient_id: 2, total: 3000, paid: 0, due: 3000, status: 'open', tenant_id: TENANT_1.id, created_at: '2026-05-25 10:00:00' },
  { id: 3, invoice_no: 'INV-003', patient_id: 3, total: 8000, paid: 0, due: 8000, status: 'open', tenant_id: TENANT_1.id, created_at: '2026-05-10 10:00:00' },
  { id: 4, invoice_no: 'INV-004', patient_id: 4, total: 2000, paid: 2000, due: 0, status: 'paid', tenant_id: TENANT_1.id, created_at: '2026-05-01 10:00:00' },
  { id: 5, invoice_no: 'INV-005', patient_id: 5, total: 10000, paid: 0, due: 10000, status: 'open', tenant_id: TENANT_1.id, created_at: '2026-03-15 10:00:00' },
];

describe('Due Aging Report API', () => {
  describe('GET /due-aging', () => {
    it('returns aging buckets for outstanding dues', async () => {
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills },
      });

      const res = await app.request('/due-aging?asOfDate=2026-05-27');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { buckets: unknown[]; totalDue: number } };
      expect(body.data.totalDue).toBe(23000); // 2000+3000+8000+10000
      expect(body.data.buckets).toHaveLength(5);
    });

    it('correctly categorizes dues into age buckets', async () => {
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills },
      });

      const res = await app.request('/due-aging?asOfDate=2026-05-27');
      const body = await res.json() as { data: { buckets: { label: string; amount: number; count: number }[] } };

      const buckets = body.data.buckets;
      // 0-7 days: INV-002 (May 25) = 3000
      const bucket07 = buckets.find(b => b.label === '0-7 days');
      expect(bucket07?.amount).toBe(3000);
      expect(bucket07?.count).toBe(1);

      // 8-15 days: INV-001 (May 19) = 2000
      const bucket815 = buckets.find(b => b.label === '8-15 days');
      expect(bucket815?.amount).toBe(2000);

      // 16-30 days: INV-003 (May 10) = 8000
      const bucket1630 = buckets.find(b => b.label === '16-30 days');
      expect(bucket1630?.amount).toBe(8000);

      // 60+ days: INV-005 (Mar 15) = 10000
      const bucket60 = buckets.find(b => b.label === '60+ days');
      expect(bucket60?.amount).toBe(10000);
    });

    it('excludes paid bills', async () => {
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills },
      });

      const res = await app.request('/due-aging?asOfDate=2026-05-27');
      const body = await res.json() as { data: { totalDue: number } };
      // INV-004 is paid (due=0), should not be counted
      expect(body.data.totalDue).toBe(23000);
    });

    it('excludes cancelled bills', async () => {
      const cancelledBill = { id: 6, invoice_no: 'INV-006', patient_id: 6, total: 5000, paid: 0, due: 5000, status: 'cancelled', tenant_id: TENANT_1.id, created_at: '2026-05-20 10:00:00' };
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills: [...bills, cancelledBill] },
      });

      const res = await app.request('/due-aging?asOfDate=2026-05-27');
      const body = await res.json() as { data: { totalDue: number } };
      expect(body.data.totalDue).toBe(23000); // cancelled bill excluded
    });

    it('uses today as default asOfDate', async () => {
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills },
      });

      const res = await app.request('/due-aging');
      expect(res.status).toBe(200);
    });

    it('returns 403 for non-admin role', async () => {
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { bills },
      });

      const res = await app.request('/due-aging');
      expect(res.status).toBe(403);
    });

    it('does not include bills from other tenants', async () => {
      const otherTenantBill = { id: 99, invoice_no: 'INV-999', patient_id: 99, total: 10000, paid: 0, due: 10000, status: 'open', tenant_id: 'tenant-2', created_at: '2026-05-10 10:00:00' };
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills: [...bills, otherTenantBill] },
      });

      const res = await app.request('/due-aging?asOfDate=2026-05-27');
      const body = await res.json() as { data: { totalDue: number } };
      expect(body.data.totalDue).toBe(23000);
    });

    it('returns zero buckets when no outstanding dues', async () => {
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills: [{ ...bills[3] }] }, // only paid bill
      });

      const res = await app.request('/due-aging');
      const body = await res.json() as { data: { totalDue: number; buckets: { amount: number }[] } };
      expect(body.data.totalDue).toBe(0);
      expect(body.data.buckets.every(b => b.amount === 0)).toBe(true);
    });

    it('returns 400 for invalid asOfDate format', async () => {
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills: [] },
      });

      const res = await app.request('/due-aging?asOfDate=invalid-date');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /due-aging/details', () => {
    it('returns 400 for invalid bucket name', async () => {
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills: [] },
      });

      const res = await app.request('/due-aging/details?bucket=invalid');
      expect(res.status).toBe(400);
    });

    it('returns detailed due list for a specific bucket', async () => {
      const { app } = createTestApp({
        route: dueAgingRoute,
        routePath: '/due-aging',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { bills },
      });

      const res = await app.request('/due-aging/details?bucket=0-7&asOfDate=2026-05-27');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(1); // only INV-002
    });
  });
});
