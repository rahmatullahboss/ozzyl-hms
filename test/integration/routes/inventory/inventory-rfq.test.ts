/**
 * Enterprise-grade integration tests for Inventory RFQ & Quotation routes.
 *
 * Covers: list RFQs, create RFQ (with vendors), list quotations, create quotation,
 *          Zod validation, tenant isolation.
 */

import { describe, it, expect } from 'vitest';
import rfqRoute from '../../../../src/routes/tenant/inventory/rfq';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import {
  TENANT_1, TENANT_2,
  INV_RFQ_1, INV_QUOTATION_1, INV_VENDOR_1, INV_ITEM_1,
} from '../../helpers/fixtures';

// ─── Test data ─────────────────────────────────────────────────────────────

const newRFQBody = {
  Subject: 'Q2 Surgical Supplies Request',
  Description: 'Requesting quotes for Q2 inventory',
  RequestedCloseDate: '2024-03-01',
  Items: [
    {
      ItemId: INV_ITEM_1.ItemId,
      Quantity: 200,
      Description: 'Surgical Gloves (M)',
    },
  ],
  VendorIds: [INV_VENDOR_1.VendorId],
};

const newQuotationBody = {
  RFQId: INV_RFQ_1.RFQId,
  VendorId: INV_VENDOR_1.VendorId,
  QuotationNo: 'QT-2024-002',
  QuotationDate: '2024-02-10',
  Items: [
    {
      ItemId: INV_ITEM_1.ItemId,
      QuotedQuantity: 200,
      QuotedRate: 42,
    },
  ],
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — RFQ & Quotation Routes', () => {

  describe('GET / — list RFQs', () => {
    it('returns paginated RFQs for tenant', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryrfq: [INV_RFQ_1] },
      });
      const res = await app.request('/rfq');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by Status', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryrfq: [INV_RFQ_1] },
      });
      const res = await app.request('/rfq?Status=active');
      expect(res.status).toBe(200);
    });

    it('filters by date range', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryrfq: [INV_RFQ_1] },
      });
      const res = await app.request('/rfq?FromDate=2024-01-01&ToDate=2024-12-31');
      expect(res.status).toBe(200);
    });

    it('returns empty list for different tenant (tenant isolation)', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventoryrfq: [INV_RFQ_1] },
      });
      const res = await app.request('/rfq');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST / — create RFQ', () => {
    it('creates RFQ with items and vendors — returns 201', async () => {
      const { app, mockDB } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventoryrfq: [],
          inventoryrfqitem: [],
          inventoryrfqvendor: [],
          inventorysequence: [],
        },
      });
      const res = await jsonRequest(app, '/rfq', { method: 'POST', body: newRFQBody });
      expect(res.status).toBe(201);
      const body = await res.json() as { RFQId: number };
      expect(typeof body.RFQId).toBe('number');

      // Verify tenant_id in RFQ INSERT
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('rfq'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('creates RFQ without VendorIds (vendors optional)', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventoryrfq: [],
          inventoryrfqitem: [],
          inventoryrfqvendor: [],
          inventorysequence: [],
        },
      });
      const { VendorIds: _removed, ...bodyNoVendors } = newRFQBody;
      const res = await jsonRequest(app, '/rfq', { method: 'POST', body: bodyNoVendors });
      expect(res.status).toBe(201);
    });

    it('returns 400 when Subject is missing (Zod min(1))', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/rfq', {
        method: 'POST',
        body: { Items: newRFQBody.Items }, // no Subject
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when Items is empty (Zod min)', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/rfq', {
        method: 'POST',
        body: { ...newRFQBody, Items: [] },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when Subject is empty string (Zod min(1))', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/rfq', {
        method: 'POST',
        body: { ...newRFQBody, Subject: '' },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /quotation — list quotations', () => {
    it('returns paginated quotations for tenant', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryquotation: [INV_QUOTATION_1] },
      });
      const res = await app.request('/rfq/quotation');
      expect(res.status).toBe(200);
    });

    it('filters by RFQId', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventoryquotation: [INV_QUOTATION_1] },
      });
      const res = await app.request(`/rfq/quotation?RFQId=${INV_RFQ_1.RFQId}`);
      expect(res.status).toBe(200);
    });

    it('filters by VendorId', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryquotation: [INV_QUOTATION_1] },
      });
      const res = await app.request(`/rfq/quotation?VendorId=${INV_VENDOR_1.VendorId}`);
      expect(res.status).toBe(200);
    });

    it('returns empty quotations for different tenant', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventoryquotation: [INV_QUOTATION_1] },
      });
      const res = await app.request('/rfq/quotation');
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });

  describe('POST /quotation — create quotation', () => {
    it('creates a quotation for a valid RFQ — returns 201', async () => {
      const { app, mockDB } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          inventoryquotation: [],
          inventoryquotationitem: [],
          inventoryrfq: [INV_RFQ_1], // existing RFQ to validate against
          inventorysequence: [],
        },
        // universalFallback ensures mock .first() finds the RFQ record even though
        // mock-db can't filter PascalCase column 'RFQId' in the condition
        universalFallback: true,
      });
      const res = await jsonRequest(app, '/rfq/quotation', { method: 'POST', body: newQuotationBody });
      expect(res.status).toBe(201);
      const body = await res.json() as { QuotationId: number };
      expect(typeof body.QuotationId).toBe('number');

      // Verify tenant_id in INSERT
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('quotation'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });


    it('returns 404 when RFQId does not belong to tenant', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_2.id, // different tenant
        tables: {
          inventoryquotation: [],
          inventoryrfq: [INV_RFQ_1], // belongs to TENANT_1
        },
      });
      const res = await jsonRequest(app, '/rfq/quotation', { method: 'POST', body: newQuotationBody });
      expect(res.status).toBe(404);
    });

    it('returns 400 when Items is empty (Zod min)', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryrfq: [INV_RFQ_1] },
      });
      const res = await jsonRequest(app, '/rfq/quotation', {
        method: 'POST',
        body: { ...newQuotationBody, Items: [] },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when RFQId is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const { RFQId: _removed, ...bodyNoRFQ } = newQuotationBody;
      const res = await jsonRequest(app, '/rfq/quotation', { method: 'POST', body: bodyNoRFQ });
      expect(res.status).toBe(400);
    });

    it('returns 400 when QuotedRate is zero (Zod positive)', async () => {
      const { app } = createTestApp({
        route: rfqRoute,
        routePath: '/rfq',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryrfq: [INV_RFQ_1] },
      });
      const res = await jsonRequest(app, '/rfq/quotation', {
        method: 'POST',
        body: {
          ...newQuotationBody,
          Items: [{ ItemId: 1, QuotedRate: 0 }],
        },
      });
      expect(res.status).toBe(400);
    });
  });
});
