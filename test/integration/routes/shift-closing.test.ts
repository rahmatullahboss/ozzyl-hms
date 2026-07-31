import { describe, it, expect } from 'vitest';
import shiftClosingRoute from '../../../src/routes/tenant/shift-closing';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT_1 = { id: 'tenant-1' };
const CASHIER = { id: 1, role: 'reception' };
const MANAGER = { id: 2, role: 'hospital_admin' };
const today = '2026-05-27';

const existingClosing = {
  id: 1, tenant_id: TENANT_1.id, user_id: CASHIER.id, counter_id: 1,
  shift_date: today, start_time: '08:00', end_time: '17:00',
  expected_cash: 50000, expected_bkash: 10000, expected_nagad: 5000,
  expected_card: 15000, expected_bank: 0,
  submitted_cash: 49500, submitted_bkash: 10000, submitted_nagad: 5000,
  submitted_card: 15000, submitted_bank: 0,
  cash_short_excess: -500,
  status: 'pending', approved_by: null, approved_at: null, notes: null,
  created_at: `${today} 17:05:00`,
};

describe('Shift Closing API', () => {
  describe('POST /shift-closing', () => {
    it('creates a shift closing', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: CASHIER.id,
        tables: { shift_closings: [], payments: [] },
      });

      const res = await jsonRequest(app, '/shift-closing', {
        method: 'POST',
        body: { shiftDate: today, submittedCash: 49500 },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { status: string } };
      expect(body.data.status).toBe('pending');
    });

    it('calculates expected cash from real payments columns', async () => {
      const { app, mockDB } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: CASHIER.id,
        tables: {
          shift_closings: [],
          payments: [
            { tenant_id: TENANT_1.id, amount: 5000, payment_method: 'cash', date: today },
            { tenant_id: TENANT_1.id, amount: 2500, payment_method: 'bkash', date: today },
          ],
        },
        queryOverride: (sql) => {
          if (!sql.includes('FROM payments')) return null;
          return { results: [{ method: 'cash', total: 5000 }, { method: 'bkash', total: 2500 }] };
        },
      });

      const res = await jsonRequest(app, '/shift-closing', {
        method: 'POST',
        body: { shiftDate: today, submittedCash: 4500 },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { expectedCash: number; cashShortExcess: number } };
      expect(body.data.expectedCash).toBe(5000);
      expect(body.data.cashShortExcess).toBe(-500);
      const paymentQuery = mockDB.queries.find(q => q.sql.includes('FROM payments'))?.sql ?? '';
      expect(paymentQuery).toContain('payment_method');
      expect(paymentQuery).toContain('date(date)');
      expect(paymentQuery).not.toContain('created_at');
      expect(paymentQuery).not.toContain('SELECT method');
    });

    it('returns 400 for missing shiftDate', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { shift_closings: [] },
      });

      const res = await jsonRequest(app, '/shift-closing', {
        method: 'POST',
        body: { submittedCash: 50000 },
      });

      expect(res.status).toBe(400);
    });

    it('returns 403 for unauthorized role', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: { shift_closings: [] },
      });

      const res = await jsonRequest(app, '/shift-closing', {
        method: 'POST',
        body: { shiftDate: today, submittedCash: 50000 },
      });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /shift-closing', () => {
    it('returns shift closings', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { shift_closings: [existingClosing] },
      });

      const res = await app.request('/shift-closing');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(1);
    });

    it('filters by status', async () => {
      const approved = { ...existingClosing, id: 2, status: 'approved' };
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { shift_closings: [existingClosing, approved] },
      });

      const res = await app.request('/shift-closing?status=pending');
      const body = await res.json() as { data: { status: string }[] };
      expect(body.data.length).toBe(1);
      expect(body.data[0].status).toBe('pending');
    });

    it('does not show closings from other tenants', async () => {
      const otherTenantClosing = { ...existingClosing, id: 99, tenant_id: 'tenant-2' };
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { shift_closings: [existingClosing, otherTenantClosing] },
      });

      const res = await app.request('/shift-closing');
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 403 for non-admin', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { shift_closings: [] },
      });

      const res = await app.request('/shift-closing');
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /shift-closing/:id/approve', () => {
    it('approves a pending closing', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: MANAGER.id,
        tables: { shift_closings: [existingClosing] },
      });

      const res = await jsonRequest(app, '/shift-closing/1/approve', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string } };
      expect(body.data.status).toBe('approved');
    });

    it('rejects with notes', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: MANAGER.id,
        tables: { shift_closings: [existingClosing] },
      });

      const res = await jsonRequest(app, '/shift-closing/1/approve', {
        method: 'PUT',
        body: { action: 'reject', notes: 'Cash count incorrect' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string } };
      expect(body.data.status).toBe('rejected');
    });

    it('returns 409 for already reviewed', async () => {
      const approved = { ...existingClosing, status: 'approved', approved_by: 2 };
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: MANAGER.id,
        tables: { shift_closings: [approved] },
      });

      const res = await jsonRequest(app, '/shift-closing/1/approve', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(409);
    });

    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { shift_closings: [] },
      });

      const res = await jsonRequest(app, '/shift-closing/999/approve', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(404);
    });

    it('cannot approve closing from another tenant', async () => {
      const otherTenantClosing = { ...existingClosing, id: 99, tenant_id: 'tenant-2' };
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: MANAGER.id,
        tables: { shift_closings: [otherTenantClosing] },
      });

      const res = await jsonRequest(app, '/shift-closing/99/approve', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 for non-numeric id on approve', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { shift_closings: [] },
      });

      const res = await jsonRequest(app, '/shift-closing/abc/approve', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid shiftDate format', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { shift_closings: [], payments: [] },
      });

      const res = await jsonRequest(app, '/shift-closing', {
        method: 'POST',
        body: { shiftDate: 'invalid-date', submittedCash: 50000 },
      });

      expect(res.status).toBe(400);
    });

    it('prevents self-approval of own shift closing', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: CASHIER.id,
        tables: { shift_closings: [existingClosing] },
      });

      const res = await jsonRequest(app, '/shift-closing/1/approve', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(403);
    });

    it('requires notes for rejection', async () => {
      const { app } = createTestApp({
        route: shiftClosingRoute,
        routePath: '/shift-closing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: MANAGER.id,
        tables: { shift_closings: [existingClosing] },
      });

      const res = await jsonRequest(app, '/shift-closing/1/approve', {
        method: 'PUT',
        body: { action: 'reject' },
      });

      expect(res.status).toBe(400);
    });
  });
});
