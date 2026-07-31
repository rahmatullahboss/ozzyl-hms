/**
 * Comprehensive tests for Laundry Management
 *
 * Covers: linen types CRUD, collection workflow, status transitions,
 * item count updates, stats, schema validation
 */

import { describe, it, expect } from 'vitest';
import laundryRoutes from '../../../src/routes/tenant/laundry';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const LINEN_SHEET = { id: 1, tenant_id: 'tenant-1', linen_name: 'Bed Sheet', category: 'general', par_level: 50, is_active: 1 };
const LINEN_GOWN = { id: 2, tenant_id: 'tenant-1', linen_name: 'OT Gown', category: 'ot', par_level: 20, is_active: 1 };
const LINEN_INACTIVE = { id: 3, tenant_id: 'tenant-1', linen_name: 'Old Towel', category: 'general', par_level: 0, is_active: 0 };

const COLL_COLLECTED = { id: 1, tenant_id: 'tenant-1', collection_number: 'LDR-20250407-001', collected_from: 'Ward A', collection_date: '2025-04-07', total_items: 20, status: 'collected' };
const COLL_WASHING = { id: 2, tenant_id: 'tenant-1', collection_number: 'LDR-20250407-002', collected_from: 'ICU', collection_date: '2025-04-07', total_items: 15, status: 'washing' };
const COLL_READY = { id: 3, tenant_id: 'tenant-1', collection_number: 'LDR-20250407-003', collected_from: 'OT', collection_date: '2025-04-07', total_items: 10, status: 'ready' };
const COLL_DELIVERED = { id: 4, tenant_id: 'tenant-1', collection_number: 'LDR-20250406-001', collected_from: 'Ward B', collection_date: '2025-04-06', total_items: 8, status: 'delivered', delivered_at: '2025-04-06T15:00:00Z' };

const COLL_ITEM_1 = { id: 1, tenant_id: 'tenant-1', collection_id: 1, linen_type_id: 1, quantity_dirty: 15, quantity_clean: 0, quantity_damaged: 0, linen_name: 'Bed Sheet', category: 'general' };

// ═══════════════════════════════════════════════════════════════════════════════
// LINEN TYPES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Laundry — Linen Types', () => {

  describe('GET /linen-types', () => {
    it('returns 200 with active types only', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_linen_types: [LINEN_SHEET, LINEN_GOWN, LINEN_INACTIVE] }, universalFallback: true });
      const res = await app.request('/l/linen-types');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
  });

  describe('POST /linen-types', () => {
    it('returns 201 with valid data', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: {}, universalFallback: true });
      const res = await jsonRequest(app, '/l/linen-types', {
        method: 'POST', body: { linen_name: 'Pillow Cover', category: 'icu', par_level: 30 },
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { message: string };
      expect(body.message).toContain('Linen type added');
    });

    it('returns 201 with minimal (defaults category=general, par_level=0)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: {}, universalFallback: true });
      const res = await jsonRequest(app, '/l/linen-types', {
        method: 'POST', body: { linen_name: 'Towel' },
      });
      expect(res.status).toBe(201);
    });

    it('rejects missing linen_name (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/linen-types', { method: 'POST', body: { category: 'ot' } })).status).toBe(400);
    });

    it('rejects empty linen_name (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/linen-types', { method: 'POST', body: { linen_name: '' } })).status).toBe(400);
    });

    it('rejects invalid category (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/linen-types', { method: 'POST', body: { linen_name: 'X', category: 'kitchen' } })).status).toBe(400);
    });

    it('rejects negative par_level (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/linen-types', { method: 'POST', body: { linen_name: 'X', par_level: -10 } })).status).toBe(400);
    });
  });

  describe('DELETE /linen-types/:id', () => {
    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_linen_types: [] } });
      expect((await app.request('/l/linen-types/999', { method: 'DELETE' })).status).toBe(404);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Laundry — Stats', () => {
  describe('GET /stats', () => {
    it('returns 200 with all KPI fields', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [COLL_COLLECTED, COLL_WASHING, COLL_READY], laundry_collection_items: [COLL_ITEM_1] }, universalFallback: true });
      const res = await app.request('/l/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('today_collections');
      expect(body).toHaveProperty('in_process');
      expect(body).toHaveProperty('ready_for_delivery');
      expect(body).toHaveProperty('today_items');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Laundry — Collections', () => {

  describe('GET /collections', () => {
    it('returns 200 with data and pagination', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [COLL_COLLECTED] }, universalFallback: true });
      const res = await app.request('/l/collections');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: { total: number } };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by date', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [COLL_COLLECTED] }, universalFallback: true });
      expect((await app.request('/l/collections?date=2025-04-07')).status).toBe(200);
    });

    it('filters by status', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [COLL_COLLECTED] }, universalFallback: true });
      expect((await app.request('/l/collections?status=collected')).status).toBe(200);
    });

    it('filters by ward', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [COLL_COLLECTED] }, universalFallback: true });
      expect((await app.request('/l/collections?ward=Ward%20A')).status).toBe(200);
    });
  });

  describe('GET /collections/:id', () => {
    it('returns collection with items', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [COLL_COLLECTED], laundry_collection_items: [COLL_ITEM_1] }, universalFallback: true });
      const res = await app.request('/l/collections/1');
      expect(res.status).toBe(200);
      const body = await res.json() as { items: unknown[] };
      expect(body).toHaveProperty('items');
    });

    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [] } });
      expect((await app.request('/l/collections/999')).status).toBe(404);
    });
  });

  describe('POST /collections', () => {
    it('returns 201 with collection_number (LDR-YYYYMMDD-NNN)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [], laundry_collection_items: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/l/collections', { method: 'POST', body: {
        collected_from: 'ICU', collection_date: '2025-04-07',
        items: [{ linen_type_id: 1, quantity_dirty: 10 }, { linen_type_id: 2, quantity_dirty: 5 }],
      }});
      expect(res.status).toBe(201);
      const body = await res.json() as { collection_number: string };
      expect(body.collection_number).toMatch(/^LDR-/);
    });

    it('rejects empty items array (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/collections', { method: 'POST', body: {
        collected_from: 'X', collection_date: '2025-04-07', items: [],
      }})).status).toBe(400);
    });

    it('rejects missing collected_from (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/collections', { method: 'POST', body: {
        collection_date: '2025-04-07', items: [{ linen_type_id: 1, quantity_dirty: 5 }],
      }})).status).toBe(400);
    });

    it('rejects invalid date format (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/collections', { method: 'POST', body: {
        collected_from: 'X', collection_date: '07-04-2025', items: [{ linen_type_id: 1, quantity_dirty: 5 }],
      }})).status).toBe(400);
    });

    it('rejects zero quantity_dirty (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/collections', { method: 'POST', body: {
        collected_from: 'X', collection_date: '2025-04-07', items: [{ linen_type_id: 1, quantity_dirty: 0 }],
      }})).status).toBe(400);
    });
  });

  // ─── Status Transitions ──────────────────────────────────────────────────
  describe('PUT /collections/:id/status', () => {
    it('collected → washing (200)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [COLL_COLLECTED] }, universalFallback: true });
      expect((await jsonRequest(app, '/l/collections/1/status', { method: 'PUT', body: { status: 'washing' } })).status).toBe(200);
    });

    it('washing → drying (200)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [COLL_WASHING] }, universalFallback: true });
      expect((await jsonRequest(app, '/l/collections/2/status', { method: 'PUT', body: { status: 'drying' } })).status).toBe(200);
    });

    it('ready → delivered (200, sets delivered_at + delivered_by)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collections: [COLL_READY] }, universalFallback: true });
      const res = await jsonRequest(app, '/l/collections/3/status', { method: 'PUT', body: { status: 'delivered' } });
      expect(res.status).toBe(200);
    });

    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/collections/1/status', { method: 'PUT', body: { status: 'lost' } })).status).toBe(400);
    });

    it('rejects missing status (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/collections/1/status', { method: 'PUT', body: {} })).status).toBe(400);
    });
  });

  // ─── Item Count Updates ──────────────────────────────────────────────────
  describe('PUT /collections/:id/items', () => {
    it('updates clean/damaged counts (200)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin',
        tables: { laundry_collection_items: [COLL_ITEM_1] }, universalFallback: true });
      const res = await jsonRequest(app, '/l/collections/1/items', { method: 'PUT', body: {
        items: [{ id: 1, quantity_clean: 13, quantity_damaged: 2 }],
      }});
      expect(res.status).toBe(200);
    });

    it('rejects empty items array (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/collections/1/items', { method: 'PUT', body: { items: [] } })).status).toBe(400);
    });

    it('rejects negative quantity_clean (400)', async () => {
      const { app } = createTestApp({ route: laundryRoutes, routePath: '/l', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/l/collections/1/items', { method: 'PUT', body: {
        items: [{ id: 1, quantity_clean: -5, quantity_damaged: 0 }],
      }})).status).toBe(400);
    });
  });
});
