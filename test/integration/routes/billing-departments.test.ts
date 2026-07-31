/**
 * Integration tests for GET /api/billing/departments
 *
 * This endpoint is called by AdmissionIPD.tsx (line 390) to populate
 * the department dropdown in the IPD billing form.
 *
 * NOTE: The mock DB does not evaluate EXISTS subqueries or COALESCE
 * conditions in WHERE clauses. Tests that need those filters use
 * queryOverride to return the expected SQL results.
 */

import { describe, it, expect } from 'vitest';
import billingRoutes from '../../../src/routes/tenant/billing';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

const DEPT_LAB = {
  id: 11,
  tenant_id: TENANT_1.id,
  department_name: 'Laboratory',
  department_code: 'LAB',
  is_active: 1,
};

const DEPT_RADIOLOGY = {
  id: 12,
  tenant_id: TENANT_1.id,
  department_name: 'Radiology',
  department_code: 'RAD',
  is_active: 1,
};

const DEPT_INACTIVE = {
  id: 13,
  tenant_id: TENANT_1.id,
  department_name: 'Physiotherapy',
  department_code: 'PHYSIO',
  is_active: 0,
};

const SERVICE_ITEM_CBC = {
  id: 501,
  tenant_id: TENANT_1.id,
  item_name: 'CBC',
  service_department_id: DEPT_LAB.id,
  price: 500,
  is_active: 1,
};

const SERVICE_ITEM_XRAY = {
  id: 502,
  tenant_id: TENANT_1.id,
  item_name: 'X-Ray Chest',
  service_department_id: DEPT_RADIOLOGY.id,
  price: 800,
  is_active: 1,
};

describe('GET /api/billing/departments', () => {
  it('returns departments that have active service items', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_service_departments') && sql.includes('EXISTS')) {
          return {
            results: [
              { id: DEPT_LAB.id, department_name: DEPT_LAB.department_name, department_code: DEPT_LAB.department_code },
              { id: DEPT_RADIOLOGY.id, department_name: DEPT_RADIOLOGY.department_name, department_code: DEPT_RADIOLOGY.department_code },
            ],
          };
        }
        return null;
      },
      tables: {
        billing_service_departments: [DEPT_LAB, DEPT_RADIOLOGY],
        billing_service_items: [SERVICE_ITEM_CBC, SERVICE_ITEM_XRAY],
      },
    });

    const res = await jsonRequest(app, '/billing/departments');
    expect(res.status).toBe(200);
    const body = await res.json() as { departments: Array<{ id: number; department_name: string }> };
    expect(body.departments).toHaveLength(2);
    expect(body.departments[0].department_name).toBe('Laboratory');
    expect(body.departments[1].department_name).toBe('Radiology');

    const sql = mockDB.queries.map(q => q.sql).join('\n');
    expect(sql).toContain('billing_service_departments');
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('billing_service_items');
  });

  it('excludes departments with no active service items', async () => {
    const DEPT_EMPTY = {
      id: 14,
      tenant_id: TENANT_1.id,
      department_name: 'Pathology',
      department_code: 'PATH',
      is_active: 1,
    };

    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_service_departments') && sql.includes('EXISTS')) {
          return {
            results: [
              { id: DEPT_LAB.id, department_name: DEPT_LAB.department_name, department_code: DEPT_LAB.department_code },
            ],
          };
        }
        return null;
      },
      tables: {
        billing_service_departments: [DEPT_LAB, DEPT_EMPTY],
        billing_service_items: [SERVICE_ITEM_CBC],
      },
    });

    const res = await jsonRequest(app, '/billing/departments');
    expect(res.status).toBe(200);
    const body = await res.json() as { departments: Array<{ id: number; department_name: string }> };
    expect(body.departments).toHaveLength(1);
    expect(body.departments[0].department_name).toBe('Laboratory');
  });

  it('excludes inactive departments', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_service_departments') && sql.includes('EXISTS')) {
          return {
            results: [
              { id: DEPT_LAB.id, department_name: DEPT_LAB.department_name, department_code: DEPT_LAB.department_code },
            ],
          };
        }
        return null;
      },
      tables: {
        billing_service_departments: [DEPT_LAB, DEPT_INACTIVE],
        billing_service_items: [
          SERVICE_ITEM_CBC,
          { ...SERVICE_ITEM_XRAY, service_department_id: DEPT_INACTIVE.id },
        ],
      },
    });

    const res = await jsonRequest(app, '/billing/departments');
    expect(res.status).toBe(200);
    const body = await res.json() as { departments: Array<{ id: number; department_name: string }> };
    expect(body.departments).toHaveLength(1);
    expect(body.departments[0].department_name).toBe('Laboratory');
  });

  it('returns empty array when no departments exist', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_departments: [],
        billing_service_items: [],
      },
    });

    const res = await jsonRequest(app, '/billing/departments');
    expect(res.status).toBe(200);
    const body = await res.json() as { departments: unknown[] };
    expect(body.departments).toEqual([]);
  });

  it('orders departments by department_name', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_service_departments') && sql.includes('EXISTS')) {
          return {
            results: [
              { id: DEPT_LAB.id, department_name: DEPT_LAB.department_name, department_code: DEPT_LAB.department_code },
              { id: DEPT_RADIOLOGY.id, department_name: DEPT_RADIOLOGY.department_name, department_code: DEPT_RADIOLOGY.department_code },
            ],
          };
        }
        return null;
      },
      tables: {
        billing_service_departments: [DEPT_RADIOLOGY, DEPT_LAB],
        billing_service_items: [SERVICE_ITEM_CBC, SERVICE_ITEM_XRAY],
      },
    });

    const res = await jsonRequest(app, '/billing/departments');
    expect(res.status).toBe(200);
    const body = await res.json() as { departments: Array<{ department_name: string }> };
    const names = body.departments.map(d => d.department_name);
    expect(names).toEqual(['Laboratory', 'Radiology']);

    const sql = mockDB.queries.map(q => q.sql).join('\n');
    expect(sql).toContain('ORDER BY department_name');
  });

  it('queries are scoped to the current tenant', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('billing_service_departments') && sql.includes('EXISTS')) {
          return { results: [] };
        }
        return null;
      },
      tables: {
        billing_service_departments: [],
        billing_service_items: [],
      },
    });

    await jsonRequest(app, '/billing/departments');
    const lastQuery = mockDB.queries[0];
    expect(lastQuery.params[0]).toBe(TENANT_1.id);
  });
});
