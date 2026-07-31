import { describe, expect, it } from 'vitest';
import billingMasterRoutes from '../../../src/routes/tenant/billingMaster';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

const SERVICE_DEPARTMENT = {
  id: 31,
  tenant_id: TENANT_1.id,
  department_name: 'Laboratory',
  department_code: 'LAB',
  is_active: 1,
};

describe('billing master service/test item setup', () => {
  it('creates service items with default price-category mapping for billing counter pricing', async () => {
    const { app, mockDB } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_departments: [SERVICE_DEPARTMENT],
        billing_service_items: [],
        price_categories: [{ id: 2, tenant_id: TENANT_1.id, category_name: 'Normal', category_code: 'NOR', is_default: 1, is_active: 1 }],
        billing_item_price_category_maps: [],
      },
    });

    const res = await jsonRequest(app, '/billing-master/service-items', {
      method: 'POST',
      body: {
        item_name: 'CBC',
        item_code: 'LAB-CBC',
        service_department_id: SERVICE_DEPARTMENT.id,
        price: 500,
        tax_applicable: false,
        allow_discount: true,
        allow_multiple_qty: true,
      },
    });

    expect(res.status).toBe(201);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/INSERT INTO price_categories/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+"?billing_service_items"?/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+"?billing_item_price_category_maps"?/i);
    expect(mockDB.queries.some((query) =>
      /INSERT\s+INTO\s+"?billing_item_price_category_maps"?/i.test(query.sql)
      && query.params.includes(500)
    )).toBe(true);
  });

  it('returns linked lab commission eligibility in the service item list', async () => {
    const serviceItem = {
      id: 10,
      tenant_id: TENANT_1.id,
      item_name: 'Cross Matching',
      item_code: 'CROSS-MATCHING',
      service_department_id: SERVICE_DEPARTMENT.id,
      price: 1000,
      tax_applicable: 0,
      tax_percent: 0,
      allow_discount: 1,
      is_active: 1,
      display_order: 0,
    };
    const { app } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_departments: [SERVICE_DEPARTMENT],
        billing_service_items: [serviceItem],
        billing_service_item_tenant_overrides: [],
        lab_test_catalog: [{
          id: 77,
          tenant_id: TENANT_1.id,
          billing_service_item_id: serviceItem.id,
          code: serviceItem.item_code,
          name: serviceItem.item_name,
          is_active: 1,
          is_commissionable: 0,
        }],
      },
      queryOverride(sql) {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('select si.*') && normalized.includes('from billing_service_items') && normalized.includes('lab_test_catalog')) {
          return { results: [{ ...serviceItem, department_name: 'Laboratory', is_commissionable: 0 }] };
        }
        if (normalized.includes('select count(*) as total') && normalized.includes('from billing_service_items')) {
          return { first: { total: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-master/service-items?per_page=100');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ item_name: string; is_commissionable?: number }> };
    expect(body.data.find((item) => item.item_name === 'Cross Matching')?.is_commissionable).toBe(0);
  });

  it('persists lab commission eligibility when a Billing Master item is edited', async () => {
    const serviceItem = {
      id: 10,
      tenant_id: TENANT_1.id,
      item_name: 'Cross Matching',
      item_code: 'CROSS-MATCHING',
      service_department_id: SERVICE_DEPARTMENT.id,
      price: 1000,
      description: 'Laboratory',
      tax_applicable: 0,
      tax_percent: 0,
      allow_discount: 1,
      allow_multiple_qty: 1,
      is_active: 1,
      display_order: 0,
    };
    const { app, mockDB } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_departments: [SERVICE_DEPARTMENT],
        billing_service_items: [serviceItem],
        lab_test_categories: [{ id: 5, tenant_id: TENANT_1.id, category_name: 'Laboratory', is_active: 1 }],
        lab_test_catalog: [{
          id: 77,
          tenant_id: TENANT_1.id,
          billing_service_item_id: serviceItem.id,
          code: serviceItem.item_code,
          name: serviceItem.item_name,
          category: 'Laboratory',
          price: serviceItem.price,
          is_active: 1,
          is_commissionable: 1,
        }],
      },
      queryOverride(sql) {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('select * from billing_service_items')) {
          return { first: serviceItem };
        }
        if (normalized.startsWith('update "billing_service_items"')) {
          return { meta: { changes: 1 } };
        }
        if (normalized.includes('select si.id, si.item_name') && normalized.includes('sd.department_code')) {
          return { first: { ...serviceItem, department_code: 'LAB', department_name: 'Laboratory' } };
        }
        if (normalized.includes('select id from lab_test_categories')) {
          return { first: { id: 5 } };
        }
        if (normalized.includes('select id from lab_test_catalog')) {
          return { first: { id: 77 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, `/billing-master/service-items/${serviceItem.id}`, {
      method: 'PUT',
      body: {
        item_name: serviceItem.item_name,
        is_commissionable: false,
      },
    });

    expect(res.status).toBe(200);
    const eligibilityUpdate = mockDB.queries.find((query) =>
      /UPDATE\s+lab_test_catalog/i.test(query.sql)
      && /is_commissionable/i.test(query.sql)
    );
    expect(eligibilityUpdate).toBeDefined();
    expect(eligibilityUpdate?.params).toContain(0);
  });

  it('keeps tenant items linked to global service departments visible in the service item list', async () => {
    const globalDepartment = {
      ...SERVICE_DEPARTMENT,
      tenant_id: '0',
      department_name: 'Nursing Charges',
      department_code: 'NUR',
    };
    const { app, mockDB } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_departments: [globalDepartment],
        billing_service_items: [{
          id: 101,
          tenant_id: TENANT_1.id,
          item_name: 'Nursing Charge',
          item_code: 'NUR-001',
          service_department_id: globalDepartment.id,
          price: 100,
          tax_applicable: 0,
          tax_percent: 0,
          allow_discount: 1,
          is_active: 1,
          display_order: 0,
        }],
      },
    });

    const res = await jsonRequest(app, '/billing-master/service-items');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ item_name: string }> };
    expect(body.data.some(item => item.item_name === 'Nursing Charge')).toBe(true);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/sd\.tenant_id\s+IN\s*\(si\.tenant_id,\s*'0'\)/i);
    expect(sql).not.toMatch(/sd\.tenant_id\s*=\s*si\.tenant_id/i);
  });

  it('hides shared default service items per tenant instead of deactivating them globally', async () => {
    const defaultItem = {
      id: 201,
      tenant_id: '0',
      item_name: 'Default Oxygen',
      item_code: 'OXY-DEFAULT',
      service_department_id: null,
      price: 100,
      tax_applicable: 0,
      tax_percent: 0,
      allow_discount: 1,
      is_active: 1,
      display_order: 0,
    };
    const { app, mockDB } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: [defaultItem],
        billing_service_item_tenant_overrides: [],
      },
    });

    const res = await jsonRequest(app, `/billing-master/service-items/${defaultItem.id}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/INSERT\s+INTO\s+billing_service_item_tenant_overrides/i);
    expect(mockDB.queries.some((query) =>
      /INSERT\s+INTO\s+billing_service_item_tenant_overrides/i.test(query.sql)
      && query.params.includes(TENANT_1.id)
      && query.params.includes(defaultItem.id)
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      /UPDATE\s+billing_service_items\s+SET/i.test(query.sql)
      && query.params.includes(defaultItem.id)
    )).toBe(false);
  });

  it('copies a shared default service item into the current tenant when edited', async () => {
    const defaultItem = {
      id: 202,
      tenant_id: '0',
      item_name: 'Default Oxygen',
      item_code: 'OXY-DEFAULT',
      service_department_id: null,
      price: 100,
      tax_applicable: 0,
      tax_percent: 0,
      allow_discount: 1,
      allow_multiple_qty: 1,
      is_active: 1,
      display_order: 0,
    };
    const { app, mockDB } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: [defaultItem],
        billing_service_item_tenant_overrides: [],
        price_categories: [{ id: 2, tenant_id: TENANT_1.id, category_name: 'Normal', category_code: 'NOR', is_default: 1, is_active: 1 }],
        billing_item_price_category_maps: [],
      },
    });

    const res = await jsonRequest(app, `/billing-master/service-items/${defaultItem.id}`, {
      method: 'PUT',
      body: { item_name: 'Hospital Oxygen', price: 150 },
    });

    expect(res.status).toBe(200);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/INSERT\s+INTO\s+billing_service_items/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+billing_service_item_tenant_overrides/i);
    expect(mockDB.queries.some((query) =>
      /INSERT\s+INTO\s+billing_service_items/i.test(query.sql)
      && query.params.includes('Hospital Oxygen')
      && query.params.includes(150)
      && query.params.includes(TENANT_1.id)
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      /INSERT\s+INTO\s+billing_service_item_tenant_overrides/i.test(query.sql)
      && query.params.includes(TENANT_1.id)
      && query.params.includes(defaultItem.id)
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      /UPDATE\s+billing_service_items\s+SET/i.test(query.sql)
      && query.params.includes(defaultItem.id)
    )).toBe(false);
  });

  it('serves the same price categories used by the billing counter price lookup', async () => {
    const { app, mockDB } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        price_categories: [{ id: 2, tenant_id: TENANT_1.id, category_name: 'Normal', category_code: 'NOR', is_default: 1, is_active: 1 }],
      },
    });

    const res = await jsonRequest(app, '/billing-master/price-categories');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: number; category_name: string }> };
    expect(body.data[0].category_name).toBe('Normal');
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/FROM price_categories/i);
    expect(sql).not.toMatch(/FROM billing_price_categories/i);
  });

  it('returns Billing Master health-check metrics for unsafe setup gaps', async () => {
    const { app } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        price_categories: [{ id: 2, tenant_id: TENANT_1.id, category_name: 'Normal', category_code: 'NOR', is_default: 1, is_active: 1 }],
        billing_service_items: [
          { id: 1, tenant_id: TENANT_1.id, item_name: 'CBC', item_code: 'LAB-DUP', service_department_id: null, price: 500, is_active: 1 },
          { id: 2, tenant_id: TENANT_1.id, item_name: 'CBC 2', item_code: 'LAB-DUP', service_department_id: null, price: 600, is_active: 1 },
        ],
        billing_item_price_category_maps: [],
        billing_schemes: [{ id: 1, tenant_id: TENANT_1.id, scheme_name: 'Staff', default_discount_percent: 10, default_discount_source: '', is_active: 1 }],
        billing_packages: [{ id: 1, tenant_id: TENANT_1.id, package_name: 'Normal Delivery', total_price: 20000, is_active: 1 }],
        billing_package_items: [],
        billing_credit_organizations: [],
        billing_counters: [],
        billing_deposit_heads: [],
        referral_hospitals: [],
        billing_fiscal_years: [],
      },
    });

    const res = await jsonRequest(app, '/billing-master/health-check');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { summary: Record<string, number>; issues: Array<{ key: string; count: number }>; health_score: number } };
    expect(body.data.summary.active_service_items).toBeGreaterThanOrEqual(2);
    expect(body.data.issues.some((issue) => issue.key === 'duplicate_item_codes')).toBe(true);
    expect(body.data.issues.some((issue) => issue.key === 'items_missing_department')).toBe(true);
    expect(body.data.health_score).toBeLessThan(100);
  });

  it('returns category-wise price matrix rows with inherited base prices', async () => {
    const { app } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        price_categories: [
          { id: 2, tenant_id: TENANT_1.id, category_name: 'Normal', category_code: 'NOR', is_default: 1, is_active: 1 },
          { id: 3, tenant_id: TENANT_1.id, category_name: 'Corporate', category_code: 'COR', is_default: 0, is_active: 1 },
        ],
        billing_service_departments: [SERVICE_DEPARTMENT],
        billing_service_items: [{ id: 10, tenant_id: TENANT_1.id, item_name: 'CBC', item_code: 'LAB-CBC', service_department_id: SERVICE_DEPARTMENT.id, price: 500, allow_discount: 1, is_active: 1 }],
        billing_item_price_category_maps: [{ id: 77, tenant_id: TENANT_1.id, service_item_id: 10, price_category_id: 3, price: 450, is_discount_applicable: 1, is_active: 1 }],
      },
    });

    const res = await jsonRequest(app, '/billing-master/price-matrix');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { categories: Array<{ id: number }>; rows: Array<{ service_item_id: number; prices: Array<{ price_category_id: number; price: number; inherited_from_base: boolean }> }> } };
    expect(body.data.categories.map((category) => category.id)).toEqual([2, 3]);
    expect(body.data.rows[0].service_item_id).toBe(10);
    expect(body.data.rows[0].prices.find((price) => price.price_category_id === 2)?.price).toBe(500);
    expect(body.data.rows[0].prices.find((price) => price.price_category_id === 2)?.inherited_from_base).toBe(true);
    expect(body.data.rows[0].prices.find((price) => price.price_category_id === 3)?.price).toBe(450);
  });

  it('saves price matrix updates through the bulk endpoint', async () => {
    const { app, mockDB } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: [{
          id: 10,
          tenant_id: TENANT_1.id,
          item_name: 'CBC',
          item_code: 'LAB-CBC',
          service_department_id: SERVICE_DEPARTMENT.id,
          price: 500,
          is_active: 1,
          canonical_source_key: null,
        }],
        billing_service_departments: [SERVICE_DEPARTMENT],
        billing_item_price_category_maps: [],
      },
    });

    const res = await jsonRequest(app, '/billing-master/price-matrix', {
      method: 'PUT',
      body: {
        mappings: [
          { service_item_id: 10, price_category_id: 3, price: 450, is_discount_applicable: true },
        ],
      },
    });

    expect(res.status).toBe(200);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).toMatch(/INSERT\s+INTO\s+billing_item_price_category_maps/i);
    expect(mockDB.queries.some((query) => query.params.includes(450))).toBe(true);
  });

  it('previews scheme eligibility by member code with cap and member metadata', async () => {
    const scheme = {
      id: 42,
      scheme_name: 'Staff Family Benefit',
      scheme_code: 'STAFF20',
      scheme_type: 'staff',
      default_discount_percent: 20,
      default_price_category_id: 3,
      default_discount_source: 'staff_benefit_discount',
      valid_from: '2020-01-01',
      valid_to: '2099-12-31',
      max_discount_amount_per_bill: 1500,
      max_discount_amount_per_month: 5000,
      max_discount_amount_per_year: 20000,
      approval_required_over_percent: 25,
      requires_reference: 1,
      is_auto_apply: 0,
      is_active: 1,
    };
    const member = {
      id: 77,
      patient_id: TENANT_1.id === 'tenant-1' ? 1 : 1,
      member_code: 'EMP-77',
      member_name: 'Employee Dependent',
      relation: 'family',
      valid_from: '2020-01-01',
      valid_to: '2099-12-31',
      status: 'active',
    };
    const { app } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from billing_schemes') && normalized.includes('lower(coalesce(m.member_code')) {
          return { first: scheme };
        }
        if (normalized.includes('count(1) as count') && normalized.includes('from billing_scheme_members')) {
          return { first: { count: 1 } };
        }
        if (normalized.includes('select id, patient_id, member_code') && normalized.includes('from billing_scheme_members')) {
          return { first: member };
        }
        if (normalized.includes('from billing_scheme_usage') && normalized.includes('sum(discount_amount)')) {
          return { first: { total: 500 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-master/apply-scheme-preview', {
      method: 'POST',
      body: { member_code: 'EMP-77', subtotal: 10000 },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      eligible: boolean;
      scheme_id: number;
      matched_member_id: number;
      suggested_discount: number;
      allocation_type: string;
      default_price_category_id: number;
      requires_reference: boolean;
      cap_remaining_month: number;
    };
    expect(body.eligible).toBe(true);
    expect(body.scheme_id).toBe(42);
    expect(body.matched_member_id).toBe(77);
    expect(body.suggested_discount).toBe(1500);
    expect(body.allocation_type).toBe('staff_benefit_discount');
    expect(body.default_price_category_id).toBe(3);
    expect(body.requires_reference).toBe(true);
    expect(body.cap_remaining_month).toBe(4500);
  });

  it('blocks scheme preview when a configured member list does not include the patient or code', async () => {
    const { app } = createTestApp({
      route: billingMasterRoutes,
      routePath: '/billing-master',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from billing_schemes') && normalized.includes('where tenant_id = ? and id = ?')) {
          return { first: {
            id: 9,
            scheme_name: 'VIP Benefit',
            scheme_code: 'VIP',
            scheme_type: 'vip',
            default_discount_percent: 30,
            default_price_category_id: null,
            default_discount_source: 'vip_benefit_discount',
            valid_from: '2020-01-01',
            valid_to: '2099-12-31',
            max_discount_amount_per_bill: 0,
            max_discount_amount_per_month: 0,
            max_discount_amount_per_year: 0,
            approval_required_over_percent: 0,
            requires_reference: 0,
            is_auto_apply: 0,
            is_active: 1,
          } };
        }
        if (normalized.includes('count(1) as count') && normalized.includes('from billing_scheme_members')) {
          return { first: { count: 1 } };
        }
        if (normalized.includes('select id, patient_id, member_code') && normalized.includes('from billing_scheme_members')) {
          return { first: null };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-master/scheme-eligibility?scheme_id=9&patient_id=1&subtotal=1000');

    expect(res.status).toBe(200);
    const body = await res.json() as { eligible: boolean; blockers: string[]; suggested_discount: number };
    expect(body.eligible).toBe(false);
    expect(body.suggested_discount).toBe(0);
    expect(body.blockers).toContain('Patient/member is not eligible for this scheme');
  });

});
