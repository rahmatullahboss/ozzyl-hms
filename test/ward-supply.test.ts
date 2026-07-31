import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import wardSupplyRoutes from '../src/routes/tenant/wardSupply';

const routePath = '/ward-supply';

function setupApp(opts: { tables?: Record<string, Record<string, unknown>[]>; queryOverride?: Parameters<typeof createTestApp>[0]['queryOverride'] } = {}) {
  return createTestApp({
    route: wardSupplyRoutes,
    routePath,
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    universalFallback: true,
    ...opts,
  });
}

describe('Ward Supply Routes', () => {
  // ─── GET /requisitions ────────────────────────────────────────────────────
  describe('GET /requisitions', () => {
    it('returns list with pagination', async () => {
      const rows = [
        { id: 1, tenant_id: 'tenant-1', requisition_no: 'WSR-2026-0001', ward_id: 1, status: 'submitted', is_active: 1 },
        { id: 2, tenant_id: 'tenant-1', requisition_no: 'WSR-2026-0002', ward_id: 2, status: 'approved', is_active: 1 },
      ];
      const { app } = setupApp({
        tables: { ward_supply_requisitions: rows },
      });

      const res = await app.request(`${routePath}/requisitions?page=1&limit=20`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('requisitions');
      expect(body).toHaveProperty('pagination');
      const pagination = body.pagination as Record<string, number>;
      expect(pagination.page).toBe(1);
      expect(pagination.limit).toBe(20);
    });

    it('applies status filter', async () => {
      const rows = [
        { id: 1, tenant_id: 'tenant-1', status: 'submitted', is_active: 1 },
        { id: 2, tenant_id: 'tenant-1', status: 'approved', is_active: 1 },
      ];
      const { app, mockDB } = setupApp({
        tables: { ward_supply_requisitions: rows },
      });

      const res = await app.request(`${routePath}/requisitions?status=submitted`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('requisitions');
      expect(mockDB.queries.some((q) => q.sql.includes('status = ?'))).toBe(true);
    });
  });

  // ─── GET /requisitions/:id ────────────────────────────────────────────────
  describe('GET /requisitions/:id', () => {
    it('returns requisition with items', async () => {
      const { app } = setupApp();

      const res = await app.request(`${routePath}/requisitions/1`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('requisition');
      const req = body.requisition as Record<string, unknown>;
      expect(req).toHaveProperty('items');
    });

    it('returns 404 when requisition not found', async () => {
      const { app } = createTestApp({
        route: wardSupplyRoutes,
        routePath,
        role: 'hospital_admin',
        tenantId: 'tenant-1',
      });

      const res = await app.request(`${routePath}/requisitions/999`);
      expect(res.status).toBe(404);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe('Requisition not found');
    });
  });

  // ─── POST /requisitions ───────────────────────────────────────────────────
  describe('POST /requisitions', () => {
    it('creates requisition with items', async () => {
      const { app, mockDB } = setupApp();

      const payload = {
        wardId: 1,
        requestedBy: 'Nurse A',
        priority: 'routine',
        items: [
          { itemName: 'Bandage', quantityRequested: 10, unit: 'pcs' },
          { itemName: 'Syringe', quantityRequested: 50, unit: 'pcs', unitPrice: 2.5 },
        ],
      };

      const res = await jsonRequest(app, `${routePath}/requisitions`, {
        method: 'POST',
        body: payload,
      });

      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('requisitionNo');
      expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO ward_supply_requisitions'))).toBe(true);
      expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO ward_supply_requisition_items'))).toBe(true);
    });

    it('returns 400 with invalid body (missing required fields)', async () => {
      const { app } = setupApp();

      const res = await jsonRequest(app, `${routePath}/requisitions`, {
        method: 'POST',
        body: { wardId: 1 },
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /requisitions/:id/status ───────────────────────────────────────
  describe('PATCH /requisitions/:id/status', () => {
    it('updates status', async () => {
      const { app, mockDB } = setupApp({
        tables: {
          ward_supply_requisitions: [
            { id: 1, tenant_id: 'tenant-1', status: 'submitted', is_active: 1 },
          ],
        },
      });

      const res = await jsonRequest(app, `${routePath}/requisitions/1/status`, {
        method: 'PATCH',
        body: { status: 'approved', approvalRemarks: 'Looks good' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(mockDB.queries.some((q) => q.sql.includes('UPDATE ward_supply_requisitions'))).toBe(true);
    });
  });

  // ─── DELETE /requisitions/:id ─────────────────────────────────────────────
  describe('DELETE /requisitions/:id', () => {
    it('soft deletes requisition', async () => {
      const { app, mockDB } = setupApp();

      const res = await app.request(`${routePath}/requisitions/1`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(mockDB.queries.some((q) => q.sql.includes('SET is_active = 0'))).toBe(true);
    });
  });

  // ─── GET /dispatches ──────────────────────────────────────────────────────
  describe('GET /dispatches', () => {
    it('returns list of dispatches', async () => {
      const { app } = setupApp();

      const res = await app.request(`${routePath}/dispatches`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('dispatches');
    });
  });

  // ─── GET /dispatches/:id ──────────────────────────────────────────────────
  describe('GET /dispatches/:id', () => {
    it('returns dispatch with items', async () => {
      const { app } = setupApp();

      const res = await app.request(`${routePath}/dispatches/1`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('dispatch');
      const dispatch = body.dispatch as Record<string, unknown>;
      expect(dispatch).toHaveProperty('items');
    });
  });

  // ─── GET /stats ───────────────────────────────────────────────────────────
  describe('GET /stats', () => {
    it('returns dashboard stats', async () => {
      const { app } = setupApp();

      const res = await app.request(`${routePath}/stats`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('pendingRequisitions');
      expect(body).toHaveProperty('todayDispatches');
      expect(body).toHaveProperty('lowStockItems');
      expect(body).toHaveProperty('totalRequisitionsThisMonth');
    });
  });

  // ─── POST /consumption ────────────────────────────────────────────────────
  describe('POST /consumption', () => {
    it('returns 400 with insufficient stock', async () => {
      const { app } = createTestApp({
        route: wardSupplyRoutes,
        routePath,
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        tables: {
          ward_supply_stock: [
            { tenant_id: 'tenant-1', ward_id: 1, inventory_item_id: 1, item_name: 'Bandage', current_quantity: 2, min_stock_level: 5 },
          ],
          ward_supply_location_stock: [],
        },
      });

      const res = await jsonRequest(app, `${routePath}/consumption`, {
        method: 'POST',
        body: {
          wardId: 1,
          itemName: 'Bandage',
          quantity: 100,
          unit: 'pcs',
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toMatch(/insufficient/i);
    });
  });
});
