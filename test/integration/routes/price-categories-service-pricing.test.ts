import { describe, expect, it } from 'vitest';
import priceCategoriesRoutes from '../../../src/routes/tenant/priceCategories';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

const SERVICE = {
  id: 10,
  tenant_id: TENANT_1.id,
  item_name: 'CBC',
  item_code: 'LAB-CBC',
  service_department_id: 31,
  price: 500,
  is_active: 1,
  canonical_source_key: null,
};

const DEPARTMENT = {
  id: 31,
  tenant_id: TENANT_1.id,
  department_code: 'LAB',
  department_name: 'Laboratory',
  is_active: 1,
};

describe('price category service pricing integration', () => {
  it('creates a price map through the Canonical service-price boundary', async () => {
    const { app, mockDB } = createTestApp({
      route: priceCategoriesRoutes,
      routePath: '/price-categories',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: [SERVICE],
        billing_service_departments: [DEPARTMENT],
        billing_item_price_category_maps: [],
      },
    });

    const res = await jsonRequest(app, '/price-categories/3/items/10', {
      method: 'POST',
      body: { price: 450, isDiscountApplicable: true },
    });

    expect(res.status).toBe(201);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/INSERT\s+INTO\s+billing_item_price_category_maps/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+canonical_service_catalog_items/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+canonical_service_prices/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+canonical_outbox_events/i);
  });

  it('updates a price map through an immutable replacement price version', async () => {
    const { app, mockDB } = createTestApp({
      route: priceCategoriesRoutes,
      routePath: '/price-categories',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: [{ ...SERVICE, canonical_source_key: 'billing-service:10' }],
        billing_service_departments: [DEPARTMENT],
        billing_item_price_category_maps: [{
          id: 77,
          tenant_id: TENANT_1.id,
          service_item_id: 10,
          price_category_id: 3,
          price: 450,
          is_discount_applicable: 1,
          is_active: 1,
          canonical_source_key: 'billing-price-map:10:3',
        }],
      },
    });

    const res = await jsonRequest(app, '/price-categories/3/items/10', {
      method: 'PUT',
      body: { price: 475, isDiscountApplicable: false },
    });

    expect(res.status).toBe(200);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/UPDATE\s+billing_item_price_category_maps/i);
    expect(sql).toMatch(/canonical_service_prices/i);
    expect(mockDB.queries.some((query) => query.params.includes(475))).toBe(true);
  });

  it('retires the mapped price when the legacy map is removed', async () => {
    const { app, mockDB } = createTestApp({
      route: priceCategoriesRoutes,
      routePath: '/price-categories',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: [{ ...SERVICE, canonical_source_key: 'billing-service:10' }],
        billing_service_departments: [DEPARTMENT],
        billing_item_price_category_maps: [{
          id: 77,
          tenant_id: TENANT_1.id,
          service_item_id: 10,
          price_category_id: 3,
          price: 450,
          is_discount_applicable: 1,
          is_active: 1,
          canonical_source_key: 'billing-price-map:10:3',
        }],
      },
    });

    const res = await jsonRequest(app, '/price-categories/3/items/10', { method: 'DELETE' });

    expect(res.status).toBe(200);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/UPDATE\s+billing_item_price_category_maps/i);
    expect(sql).toMatch(/canonical_service_prices/i);
  });
});
