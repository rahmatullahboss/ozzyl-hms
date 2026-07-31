/**
 * Integration tests for Pharmacy-Inventory Bridge routes.
 *
 * Covers: link suggestions, link/unlink, unified low-stock, stock sync.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import pharmacyBridgeRoute from '../../../../src/routes/tenant/inventory/pharmacyBridge';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import {
  TENANT_1,
  INV_VENDOR_1,
  INV_ITEM_1,
  INV_ITEM_MEDICINE,
  INV_STOCK_MEDICINE,
  PHARMACY_ITEM_1,
  PHARMACY_ITEM_LINKED,
  PHARMACY_SUPPLIER_1,
  PHARMACY_STOCK_LOW,
  PHARMACY_STOCK_OK,
} from '../../helpers/fixtures';

// ─── Tests ─────────────────────────────────────────────────────────────

describe('Inventory — Pharmacy Bridge Routes', () => {

  // ── GET /pharmacy-bridge/link-suggestions ──────────────────────────────

  describe('GET /pharmacy-bridge/link-suggestions', () => {
    it('returns 200 with suggestions array', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          pharmacy_items: [PHARMACY_ITEM_1],
          inventoryitem: [INV_ITEM_MEDICINE],
        },
      });
      const res = await app.request('/pharmacy-bridge/link-suggestions');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns empty when no pharmacy items exist', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          pharmacy_items: [],
          inventoryitem: [INV_ITEM_MEDICINE],
        },
      });
      const res = await app.request('/pharmacy-bridge/link-suggestions');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  // ── POST /pharmacy-bridge/link ────────────────────────────────────────

  describe('POST /pharmacy-bridge/link', () => {
    it('links a pharmacy item to an inventory item and returns 200', async () => {
      const { app, mockDB } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          pharmacy_items: [PHARMACY_ITEM_1],
          inventoryitem: [INV_ITEM_MEDICINE],
        },
      });
      const res = await jsonRequest(app, '/pharmacy-bridge/link', {
        method: 'POST',
        body: { pharmacyItemId: PHARMACY_ITEM_1.id, inventoryItemId: INV_ITEM_MEDICINE.ItemId },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { message: string };
      expect(body.message).toMatch(/link/i);

      // Verify UPDATE was issued on pharmacy_items
      const updateQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.toLowerCase().includes('pharmacy_items'),
      );
      expect(updateQ).toBeTruthy();
    });

    it('returns 400 when pharmacyItemId is missing', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { pharmacy_items: [PHARMACY_ITEM_1], inventoryitem: [INV_ITEM_MEDICINE] },
      });
      const res = await jsonRequest(app, '/pharmacy-bridge/link', {
        method: 'POST',
        body: { inventoryItemId: INV_ITEM_MEDICINE.ItemId },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when inventoryItemId is missing', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { pharmacy_items: [PHARMACY_ITEM_1], inventoryitem: [INV_ITEM_MEDICINE] },
      });
      const res = await jsonRequest(app, '/pharmacy-bridge/link', {
        method: 'POST',
        body: { pharmacyItemId: PHARMACY_ITEM_1.id },
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when pharmacy item does not exist', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          pharmacy_items: [],
          inventoryitem: [INV_ITEM_MEDICINE],
        },
      });
      const res = await jsonRequest(app, '/pharmacy-bridge/link', {
        method: 'POST',
        body: { pharmacyItemId: 999, inventoryItemId: INV_ITEM_MEDICINE.ItemId },
      });
      expect(res.status).toBe(404);
    });

    it('returns 404 when inventory item does not exist', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          pharmacy_items: [PHARMACY_ITEM_1],
          inventoryitem: [],
        },
      });
      const res = await jsonRequest(app, '/pharmacy-bridge/link', {
        method: 'POST',
        body: { pharmacyItemId: PHARMACY_ITEM_1.id, inventoryItemId: 999 },
      });
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /pharmacy-bridge/link/:pharmacyItemId ──────────────────────

  describe('DELETE /pharmacy-bridge/link/:pharmacyItemId', () => {
    it('unlinks a pharmacy item and returns 200', async () => {
      const { app, mockDB } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          pharmacy_items: [PHARMACY_ITEM_LINKED],
          inventoryitem: [INV_ITEM_MEDICINE],
        },
      });
      const res = await app.request(`/pharmacy-bridge/link/${PHARMACY_ITEM_LINKED.id}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json() as { message: string };
      expect(body.message).toMatch(/unlink/i);

      // Verify UPDATE setting inventory_item_id = NULL
      const updateQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.toLowerCase().includes('pharmacy_items'),
      );
      expect(updateQ).toBeTruthy();
    });

    it('returns 404 when pharmacy item does not exist', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { pharmacy_items: [], inventoryitem: [] },
      });
      const res = await app.request('/pharmacy-bridge/link/999', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  // ── GET /pharmacy-bridge/unified-low-stock ────────────────────────────

  describe('GET /pharmacy-bridge/unified-low-stock', () => {
    it('returns 200 with pharmacy and inventory low-stock items', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          pharmacy_items: [PHARMACY_ITEM_1, PHARMACY_ITEM_LINKED],
          pharmacy_stock: [PHARMACY_STOCK_LOW, PHARMACY_STOCK_OK],
          inventoryitem: [INV_ITEM_MEDICINE],
          inventorystock: [INV_STOCK_MEDICINE],
        },
      });
      const res = await app.request('/pharmacy-bridge/unified-low-stock');
      expect(res.status).toBe(200);
      const body = await res.json() as { pharmacy: unknown[]; inventory: unknown[] };
      expect(body).toHaveProperty('pharmacy');
      expect(body).toHaveProperty('inventory');
      expect(Array.isArray(body.pharmacy)).toBe(true);
      expect(Array.isArray(body.inventory)).toBe(true);
    });

    it('returns empty arrays when no stock exists', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          pharmacy_items: [],
          pharmacy_stock: [],
          inventoryitem: [],
          inventorystock: [],
        },
        queryOverride: (sql) => {
          const normalized = sql.toLowerCase();
          if (normalized.includes('from pharmacy_items') || normalized.includes('from inventoryitem')) {
            return { results: [] };
          }
          return null;
        },
      });
      const res = await app.request('/pharmacy-bridge/unified-low-stock');
      expect(res.status).toBe(200);
      const body = await res.json() as { pharmacy: unknown[]; inventory: unknown[] };
      expect(body.pharmacy).toHaveLength(0);
      expect(body.inventory).toHaveLength(0);
    });
  });

  // ── POST /pharmacy-bridge/sync-stock-to-pharmacy ──────────────────────

  describe('POST /pharmacy-bridge/sync-stock-to-pharmacy', () => {
    it('returns 200 with sync result for linked items', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          pharmacy_items: [PHARMACY_ITEM_LINKED],
          inventoryitem: [INV_ITEM_MEDICINE],
          inventorystock: [INV_STOCK_MEDICINE],
          pharmacy_stock: [],
        },
      });
      const res = await jsonRequest(app, '/pharmacy-bridge/sync-stock-to-pharmacy', {
        method: 'POST',
        body: {},
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { synced: number; details: unknown[] };
      expect(body).toHaveProperty('synced');
      expect(typeof body.synced).toBe('number');
      expect(body).toHaveProperty('details');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('returns 200 with 0 synced when no linked items exist', async () => {
      const { app } = createTestApp({
        route: pharmacyBridgeRoute,
        routePath: '/pharmacy-bridge',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          pharmacy_items: [PHARMACY_ITEM_1],
          inventoryitem: [INV_ITEM_MEDICINE],
          inventorystock: [],
          pharmacy_stock: [],
        },
      });
      const res = await jsonRequest(app, '/pharmacy-bridge/sync-stock-to-pharmacy', {
        method: 'POST',
        body: {},
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { synced: number };
      expect(body.synced).toBe(0);
    });
  });
});
