import { describe, expect, it } from 'vitest';
import labRoutes from '../../../src/routes/tenant/lab';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

describe('Lab catalog billing sync routes', () => {
  it('updates catalog fields, active status, and the synced billable service item', async () => {
    const { app, mockDB } = createTestApp({
      route: labRoutes,
      routePath: '/lab',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        lab_test_catalog: [{
          id: 100,
          tenant_id: TENANT_1.id,
          code: 'APTT',
          name: 'APTT',
          category: 'Coagulation',
          price: 60000,
          unit: 'sec',
          normal_range: '24-34',
          method: 'Old method',
          critical_low: null,
          critical_high: null,
          is_active: 1,
          billing_service_item_id: 901,
        }],
        billing_service_departments: [{
          id: 22,
          tenant_id: TENANT_1.id,
          department_name: 'Laboratory',
          department_code: 'LAB',
          is_active: 1,
        }],
        billing_service_items: [{
          id: 901,
          tenant_id: TENANT_1.id,
          item_name: 'APTT',
          item_code: 'APTT',
          service_department_id: 22,
          price: 60000,
          description: 'Coagulation',
          is_active: 1,
        }],
        price_categories: [{
          id: 2,
          tenant_id: TENANT_1.id,
          category_name: 'Normal',
          category_code: 'NOR',
          is_default: 1,
          is_active: 1,
        }],
        billing_item_price_category_maps: [{
          id: 500,
          tenant_id: TENANT_1.id,
          service_item_id: 901,
          price_category_id: 2,
          price: 60000,
          is_active: 1,
        }],
      },
    });

    const res = await jsonRequest(app, '/lab/100', {
      method: 'PUT',
      body: {
        code: 'APTT',
        name: 'Activated Partial Thromboplastin Time',
        category: 'Hematology',
        price: 65000,
        unit: 'seconds',
        normal_range: '25-35',
        method: 'Clot based',
        is_active: 0,
      },
    });

    expect(res.status).toBe(200);
    const labUpdate = mockDB.queries.find((q) => q.sql.toLowerCase().includes('update lab_test_catalog'));
    expect(labUpdate).toBeDefined();
    expect(labUpdate!.sql).toMatch(/unit\s*=\s*\?/i);
    expect(labUpdate!.sql).toMatch(/normal_range\s*=\s*\?/i);
    expect(labUpdate!.sql).toMatch(/method\s*=\s*\?/i);
    expect(labUpdate!.sql).toMatch(/is_active\s*=\s*\?/i);
    expect(labUpdate!.params).toEqual(expect.arrayContaining([
      'Activated Partial Thromboplastin Time',
      'Hematology',
      65000,
      'seconds',
      '25-35',
      'Clot based',
      0,
    ]));

    const billingUpdate = mockDB.queries.find((q) => q.sql.toLowerCase().includes('update billing_service_items'));
    expect(billingUpdate).toBeDefined();
    expect(billingUpdate!.params).toEqual(expect.arrayContaining([
      'Activated Partial Thromboplastin Time',
      'APTT',
      65000,
      'Hematology',
      0,
      901,
      TENANT_1.id,
    ]));

    const priceMapUpdate = mockDB.queries.find((q) =>
      q.sql.toLowerCase().includes('update billing_item_price_category_maps')
      && q.params.includes(65000)
    );
    expect(priceMapUpdate).toBeDefined();
  });
});
