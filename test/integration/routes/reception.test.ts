/**
 * Integration tests for src/routes/tenant/reception.ts
 *
 * Tests the Danphe-style reception workflow:
 *   GET  /services          — service catalog
 *   GET  /visits            — today's visits
 *   POST /visits/:id/services          — add service to visit
 *   POST /visits/:id/services/lab      — add lab tests
 *   POST /visits/:id/services/procedure — order procedure
 *   POST /visits/:id/generate-bill     — generate bill from pending services
 *   GET  /daily-report       — daily collection report
 */

import { describe, it, expect } from 'vitest';
import receptionRoute from '../../../src/routes/tenant/reception';
import { getTodayGMT6 } from '../../../src/lib/date-utils';
import { createIdempotencyRequestHash } from '../../../src/lib/request-idempotency';
import { createTestApp, createTestAppNoRole, jsonRequest } from '../helpers/test-app';
import { TENANT_1, PATIENT_1, DOCTOR_USER, RECEPTIONIST_USER } from '../helpers/fixtures';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const VISIT_1 = {
  id: 1,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  doctor_id: DOCTOR_USER.id,
  visit_type: 'opd',
  visit_date: new Date().toISOString().split('T')[0],
  created_at: new Date().toISOString(),
};

const BILLING_DEPT = {
  id: 10,
  tenant_id: TENANT_1.id,
  department_name: 'Procedures',
  department_code: 'PROC',
  is_active: 1,
  created_by: 1,
};

const SERVICE_ITEM = {
  id: 100,
  tenant_id: TENANT_1.id,
  item_name: 'Suture Removal',
  item_code: 'PROC-001',
  service_department_id: 10,
  price: 100,
  tax_applicable: 0,
  tax_percent: 0,
  allow_discount: 1,
  allow_multiple_qty: 1,
  is_active: 1,
  created_by: 1,
};

const LAB_TEST = {
  id: 200,
  tenant_id: TENANT_1.id,
  name: 'CBC',
  price: 500,
  category: 'Hematology',
  is_active: 1,
};

function closedPeriodRow(periodName: string) {
  return {
    id: 1,
    tenant_id: TENANT_1.id,
    fiscal_year_id: 1,
    period_name: periodName,
    status: 'closed',
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Reception Routes', () => {

  describe('GET /admission-candidates — eligible IPD patients', () => {
    it('excludes patients with an active admission from the candidate query', async () => {
      const eligiblePatient = {
        id: PATIENT_1.id,
        name: PATIENT_1.name,
        patient_code: 'PT-001',
        mobile: '01700000000',
        date_of_birth: '1990-01-01',
      };
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        queryOverride: (sql) => {
          const normalized = sql.toLowerCase();
          if (normalized.includes('from patients p') && normalized.includes('not exists')) {
            expect(normalized).toContain("active.status in ('admitted','critical','transferred')");
            return { results: [eligiblePatient] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/reception/admission-candidates?search=patient&limit=8');
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ patients: [eligiblePatient] });
    });
  });

  describe('GET /services — Service Catalog', () => {
    it('returns empty array when no service items exist', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          billing_service_items: [],
          billing_service_departments: [],
          lab_test_catalog: [],
          radiology_imaging_items: [],
          radiology_imaging_types: [],
          billing_service_item_usage_stats: [],
        },
      });

      const res = await jsonRequest(app, '/reception/services');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.services).toEqual([]);
    });

    it('returns active service items', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          billing_service_items: [SERVICE_ITEM],
          billing_service_departments: [BILLING_DEPT],
        },
        universalFallback: true, // MockDB needs fallback for the default price_category subquery
      });

      const res = await jsonRequest(app, '/reception/services');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.services).toHaveLength(1);
      expect(body.services[0].item_name).toBe('Suture Removal');
      // Note: department_name comes from SQL JOIN — mock DB can't resolve JOINs in .all()
    });

    it('does not duplicate lab tests that are already synced to billable service items', async () => {
      const labDepartment = {
        id: 22,
        tenant_id: TENANT_1.id,
        department_name: 'Laboratory',
        department_code: 'LAB',
        is_active: 1,
        created_by: 1,
      };
      const labServiceItem = {
        id: 901,
        tenant_id: TENANT_1.id,
        item_name: 'APTT',
        item_code: 'APTT',
        service_department_id: 22,
        price: 60000,
        tax_applicable: 0,
        tax_percent: 0,
        allow_discount: 1,
        allow_multiple_qty: 1,
        is_active: 1,
        created_by: 1,
      };
      const labCatalogRow = {
        id: 77,
        tenant_id: TENANT_1.id,
        name: 'APTT',
        code: 'APTT',
        category: 'Hematology',
        price: 60000,
        is_active: 1,
      };

      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          billing_service_items: [labServiceItem],
          billing_service_departments: [labDepartment],
          lab_test_catalog: [labCatalogRow],
        },
        queryOverride: (sql) => {
          const normalized = sql.toLowerCase();
          if (normalized.includes('from billing_service_items si')) {
            return {
              results: [
                { id: 901, item_name: 'APTT', item_code: 'APTT', department_name: 'Laboratory', price: 60000, is_lab_catalog: 1 },
              ],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/reception/services?search=APTT&limit=12');

      expect(res.status).toBe(200);
      const body = await res.json() as { services: Array<{ id: number; item_name: string; is_lab_catalog: number }> };
      expect(body.services).toHaveLength(1);
      expect(body.services[0]).toMatchObject({ id: 901, item_name: 'APTT', is_lab_catalog: 1 });
      const serviceSearchSql = mockDB.queries.find((q) => q.sql.toLowerCase().includes('from billing_service_items si'))?.sql.toLowerCase();
      expect(serviceSearchSql).toBeDefined();
      expect(serviceSearchSql).not.toContain('union all');
    });

    it('applies search in the billing catalog query instead of relying on a preloaded first page', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          billing_service_items: [],
          billing_service_departments: [],
        },
        queryOverride: (sql) => {
          const normalized = sql.toLowerCase();
          if (normalized.includes('from billing_service_items si')) {
            return {
              results: [
                { id: 1201, item_name: 'TC, DC, Hb% (CBC)', item_code: 'HCP-02', department_name: 'Laboratory', price: 500, is_lab_catalog: 1, is_radiology: 0 },
              ],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/reception/services?search=cbc&limit=200');

      expect(res.status).toBe(200);
      const body = await res.json() as { services: Array<{ id: number; item_name: string; item_code: string }> };
      expect(body.services).toEqual([
        expect.objectContaining({ id: 1201, item_name: 'TC, DC, Hb% (CBC)', item_code: 'HCP-02' }),
      ]);
      const serviceSearch = mockDB.queries.find((q) => q.sql.toLowerCase().includes('from billing_service_items si'));
      expect(serviceSearch?.params).toContain('%cbc%');
    });
  });

  describe('GET /service-departments', () => {
    it('returns departments for the tenant', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          billing_service_departments: [BILLING_DEPT],
          billing_service_items: [SERVICE_ITEM],
        },
      });

      const res = await jsonRequest(app, '/reception/service-departments');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.departments).toHaveLength(1);
      expect(body.departments[0].department_name).toBe('Procedures');
    });
  });

  describe('GET /visits — Today\'s Visits', () => {
    it('returns visits for the given date', async () => {
      const today = getTodayGMT6();
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          doctors: [{ id: DOCTOR_USER.id, name: DOCTOR_USER.name, specialty: 'General' }],
        },
      });

      const res = await jsonRequest(app, `/reception/visits?date=${today}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.visits).toBeDefined();
      const query = mockDB.queries.find((entry) => entry.method === 'all' && /FROM visits v/i.test(entry.sql));
      expect(query?.sql).toContain('pending_doctor_visit_services');
      expect(query?.sql).toContain('pending_doctor_visit_amount');
    });

    it('defaults to today when date param is missing', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {},
      });

      const res = await jsonRequest(app, '/reception/visits');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.visits).toEqual([]);
    });
  });

  describe('POST /visits/:id/services — Add Service', () => {
    it('returns 404 when visit does not exist', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { visits: [], patients: [], billing_service_items: [SERVICE_ITEM] },
      });

      const res = await jsonRequest(app, '/reception/visits/999/services', {
        method: 'POST',
        body: { serviceItemId: 100 },
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when serviceItemId is missing', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { visits: [VISIT_1], patients: [PATIENT_1] },
      });

      const res = await jsonRequest(app, '/reception/visits/1/services', {
        method: 'POST',
        body: {},
      });
      expect(res.status).toBe(400);
    });

    it('blocks adding a billable visit service in a closed accounting period before inserting pending charges', async () => {
      const today = getTodayGMT6();
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          billing_service_items: [SERVICE_ITEM],
          accounting_period_closes: [closedPeriodRow(today.slice(0, 7))],
          visit_services: [],
        },
      });

      const res = await jsonRequest(app, '/reception/visits/1/services', {
        method: 'POST',
        body: { serviceItemId: SERVICE_ITEM.id },
      });

      expect(res.status).toBe(409);
      const sql = mockDB.queries.map((query) => query.sql).join('\n');
      expect(sql).not.toMatch(/INSERT\s+INTO\s+visit_services/i);
    });

    it('allows receptionist service discounts and inserts pending charges', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          billing_service_items: [SERVICE_ITEM],
          visit_services: [],
        },
      });

      const res = await jsonRequest(app, '/reception/visits/1/services', {
        method: 'POST',
        body: { serviceItemId: SERVICE_ITEM.id, discountAmount: 10 },
      });

      expect(res.status).toBe(201);
      const sql = mockDB.queries.map((query) => query.sql).join('\n');
      expect(sql).toMatch(/INSERT\s+INTO\s+visit_services/i);
      const insert = mockDB.queries.find((query) => query.method === 'run' && /INSERT\s+INTO\s+visit_services/i.test(query.sql));
      expect(insert?.params[3]).toBe('procedure');
    });
  });

  describe('POST /visits/:id/services/bulk — Bulk Add Services', () => {
    it('allows receptionist bulk service discounts and inserts pending charges', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          billing_service_items: [SERVICE_ITEM],
          visit_services: [],
        },
      });

      const res = await jsonRequest(app, '/reception/visits/1/services/bulk', {
        method: 'POST',
        body: { serviceItemIds: [SERVICE_ITEM.id], discountAmount: 10 },
      });

      expect(res.status).toBe(201);
      const sql = mockDB.queries.map((query) => query.sql).join('\n');
      expect(sql).toMatch(/INSERT\s+INTO\s+visit_services/i);
      const insert = mockDB.queries.find((query) => /INSERT\s+INTO\s+visit_services/i.test(query.sql));
      expect(insert?.params[3]).toBe('procedure');
    });
  });

  describe('POST /visits/:id/services/lab — Add Lab Tests', () => {
    it('returns 400 when labTestIds array is empty', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { visits: [VISIT_1], patients: [PATIENT_1] },
      });

      const res = await jsonRequest(app, '/reception/visits/1/services/lab', {
        method: 'POST',
        body: { labTestIds: [] },
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when visit does not exist', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { visits: [], patients: [] },
      });

      const res = await jsonRequest(app, '/reception/visits/999/services/lab', {
        method: 'POST',
        body: { labTestIds: [200] },
      });
      expect(res.status).toBe(404);
    });

    it('blocks adding lab visit services in a closed accounting period before lab or pending-charge rows', async () => {
      const today = getTodayGMT6();
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          lab_test_catalog: [LAB_TEST],
          accounting_period_closes: [closedPeriodRow(today.slice(0, 7))],
          lab_orders: [],
          lab_order_items: [],
          visit_services: [],
        },
      });

      const res = await jsonRequest(app, '/reception/visits/1/services/lab', {
        method: 'POST',
        body: { labTestIds: [LAB_TEST.id], orderDate: today },
      });

      expect(res.status).toBe(409);
      const sql = mockDB.queries.map((query) => query.sql).join('\n');
      expect(sql).not.toMatch(/INSERT\s+INTO\s+lab_orders/i);
      expect(sql).not.toMatch(/INSERT\s+INTO\s+visit_services/i);
    });

    it('allows receptionist lab discounts and creates lab order pending-charge rows', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST_USER.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          doctors: [
            { id: VISIT_1.doctor_id, tenant_id: TENANT_1.id, user_id: DOCTOR_USER.id, is_active: 1 },
          ],
          lab_test_catalog: [LAB_TEST],
          lab_orders: [],
          lab_order_items: [],
          visit_services: [],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/reception/visits/1/services/lab', {
        method: 'POST',
        body: { labTestIds: [LAB_TEST.id], discountAmount: 50 },
      });

      expect(res.status).toBe(201);
      const sql = mockDB.queries.map((query) => query.sql).join('\n');
      expect(sql).toMatch(/INSERT\s+INTO\s+lab_orders/i);
      expect(sql).toMatch(/INSERT\s+INTO\s+visit_services/i);

      const orderInsert = mockDB.queries.find((query) => /INSERT\s+INTO\s+lab_orders/i.test(query.sql));
      expect(orderInsert?.sql).toContain('ordering_clinician_doctor_id');
      expect(Number(orderInsert?.params[3])).toBe(RECEPTIONIST_USER.id);
      expect(Number(orderInsert?.params[4])).toBe(VISIT_1.doctor_id);
    });
  });

  describe('POST /visits/:id/services/procedure — Order Procedure', () => {
    it('returns 400 when procedureName is empty', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { visits: [VISIT_1], patients: [PATIENT_1] },
      });

      const res = await jsonRequest(app, '/reception/visits/1/services/procedure', {
        method: 'POST',
        body: { procedureName: '', serviceItemId: 0 },
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when visit does not exist', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { visits: [], patients: [] },
      });

      const res = await jsonRequest(app, '/reception/visits/999/services/procedure', {
        method: 'POST',
        body: { procedureName: 'Suture Removal', serviceItemId: 1 },
      });
      expect(res.status).toBe(404);
    });

    it('blocks adding procedure visit services in a closed accounting period before procedure or pending-charge rows', async () => {
      const today = getTodayGMT6();
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          billing_service_items: [SERVICE_ITEM],
          accounting_period_closes: [closedPeriodRow(today.slice(0, 7))],
          procedure_orders: [],
          visit_services: [],
        },
      });

      const res = await jsonRequest(app, '/reception/visits/1/services/procedure', {
        method: 'POST',
        body: { procedureName: 'Suture Removal', serviceItemId: SERVICE_ITEM.id },
      });

      expect(res.status).toBe(409);
      const sql = mockDB.queries.map((query) => query.sql).join('\n');
      expect(sql).not.toMatch(/INSERT\s+INTO\s+procedure_orders/i);
      expect(sql).not.toMatch(/INSERT\s+INTO\s+visit_services/i);
    });

    it('allows receptionist procedure discounts and creates procedure pending-charge rows', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          billing_service_items: [SERVICE_ITEM],
          procedure_orders: [],
          visit_services: [],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/reception/visits/1/services/procedure', {
        method: 'POST',
        body: { procedureName: 'Suture Removal', serviceItemId: SERVICE_ITEM.id, discountAmount: 10 },
      });

      expect(res.status).toBe(201);
      const sql = mockDB.queries.map((query) => query.sql).join('\n');
      expect(sql).toMatch(/INSERT\s+INTO\s+procedure_orders/i);
      expect(sql).toMatch(/INSERT\s+INTO\s+visit_services/i);
    });
  });

  describe('POST /visits/:id/generate-bill — Generate Bill', () => {
    it('allows receptionist final bill discounts and creates a bill', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          visit_services: [
            {
              id: 31,
              tenant_id: TENANT_1.id,
              visit_id: VISIT_1.id,
              patient_id: PATIENT_1.id,
              service_type: 'doctor_visit',
              description: 'Consultation',
              service_item_id: 901,
              amount: 500,
              discount_amount: 0,
              quantity: 1,
              total_amount: 500,
              status: 'pending',
            },
          ],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
        method: 'POST',
        body: { discount: 50, discountByName: 'Manager' },
      });

      expect(res.status).toBe(201);
      expect(mockDB.queries.some((query) =>
        query.sql.toLowerCase().includes('insert into "bills"') ||
        query.sql.toLowerCase().includes('insert into bills')
      )).toBe(true);
      expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('billing_scheme_usage'))).toBe(false);
      expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('from billing_schemes'))).toBe(false);
    });

    it('rejects final visit bill scheme discounts above the eligible cap', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          visit_services: [
            {
              id: 32,
              tenant_id: TENANT_1.id,
              visit_id: VISIT_1.id,
              patient_id: PATIENT_1.id,
              service_type: 'test',
              description: 'CBC',
              service_item_id: 901,
              amount: 500,
              discount_amount: 0,
              quantity: 1,
              total_amount: 500,
              status: 'pending',
            },
          ],
        },
        universalFallback: true,
        queryOverride(sql) {
          const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
          if (normalized.includes('from billing_schemes') && normalized.includes('where tenant_id = ? and id = ?')) {
            return { first: {
              id: 42,
              scheme_name: 'Staff Benefit',
              scheme_code: 'STAFF10',
              scheme_type: 'staff',
              default_discount_percent: 10,
              default_price_category_id: null,
              default_discount_source: 'staff_benefit_discount',
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
            return { first: { count: 0 } };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
        method: 'POST',
        body: { discount: 100, discountByName: 'Manager', schemeApplication: { schemeId: 42 } },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error?: string; message?: string };
      expect(body.error ?? body.message).toMatch(/scheme discount exceeds/i);
      expect(mockDB.queries.some((query) =>
        query.sql.toLowerCase().includes('insert into "bills"') ||
        query.sql.toLowerCase().includes('insert into bills')
      )).toBe(false);
    });

    it('records scheme usage when final visit bill benefit is applied', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          visit_services: [
            {
              id: 33,
              tenant_id: TENANT_1.id,
              visit_id: VISIT_1.id,
              patient_id: PATIENT_1.id,
              service_type: 'test',
              description: 'CBC',
              service_item_id: 901,
              amount: 500,
              discount_amount: 0,
              quantity: 1,
              total_amount: 500,
              status: 'pending',
            },
          ],
        },
        universalFallback: true,
        queryOverride(sql) {
          const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
          if (normalized.includes('from billing_schemes') && normalized.includes('where tenant_id = ? and id = ?')) {
            return { first: {
              id: 42,
              scheme_name: 'Staff Benefit',
              scheme_code: 'STAFF10',
              scheme_type: 'staff',
              default_discount_percent: 10,
              default_price_category_id: null,
              default_discount_source: 'staff_benefit_discount',
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
            return { first: { count: 0 } };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
        method: 'POST',
        body: { discount: 50, discountByName: 'Manager', schemeApplication: { schemeId: 42 } },
      });

      expect(res.status).toBe(201);
      const usageInsert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('billing_scheme_usage'));
      expect(usageInsert).toBeDefined();
      expect(usageInsert?.params).toContain(42);
      expect(usageInsert?.params).toContain(PATIENT_1.id);
      expect(usageInsert?.params).toContain(50);
      const allocationInsert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into bill_discount_allocations'));
      expect(allocationInsert?.params).toContain('staff_benefit_discount');
    });

    it('requires discount by name when final visit bill discount is above 20 percent', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          visit_services: [
            {
              id: 31,
              tenant_id: TENANT_1.id,
              visit_id: VISIT_1.id,
              patient_id: PATIENT_1.id,
              service_type: 'test',
              description: 'CBC',
              service_item_id: 901,
              amount: 1000,
              discount_amount: 0,
              quantity: 1,
              total_amount: 1000,
              status: 'pending',
            },
          ],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
        method: 'POST',
        body: { discount: 250 },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error?: string; message?: string };
      expect(String(body.message ?? body.error ?? '')).toMatch(/discount referred by/i);
      expect(mockDB.queries.some((query) =>
        query.sql.toLowerCase().includes('insert into "bills"') ||
        query.sql.toLowerCase().includes('insert into bills')
      )).toBe(false);
    });

    it('writes category totals on the bill when generating from pending visit services', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          visit_services: [
            {
              id: 11,
              tenant_id: TENANT_1.id,
              visit_id: VISIT_1.id,
              patient_id: PATIENT_1.id,
              service_type: 'doctor_visit',
              description: 'Consultation',
              service_item_id: 901,
              amount: 500,
              discount_amount: 0,
              quantity: 1,
              total_amount: 500,
              status: 'pending',
            },
            {
              id: 12,
              tenant_id: TENANT_1.id,
              visit_id: VISIT_1.id,
              patient_id: PATIENT_1.id,
              service_type: 'test',
              description: 'CBC',
              reference_type: 'lab_order_item',
              reference_id: 902,
              amount: 700,
              discount_amount: 0,
              quantity: 1,
              total_amount: 700,
              status: 'pending',
            },
          ],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
        method: 'POST',
        body: {},
      });

      expect(res.status).toBe(201);
      const billInsert = mockDB.queries.find((query) =>
        query.sql.toLowerCase().includes('insert into "bills"') ||
        query.sql.toLowerCase().includes('insert into bills')
      );
      expect(billInsert?.sql).toContain('doctor_visit_bill');
      expect(billInsert?.sql).toContain('test_bill');
      expect(billInsert?.params).toContain(500);
      expect(billInsert?.params).toContain(700);
      expect(mockDB.queries.some((query) =>
        query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
        && query.params.includes('billing')
        && query.params.includes('bill_created')
      )).toBe(true);
    });

    it('returns the existing reception OPD bill response when an idempotency key is replayed', async () => {
      const requestBody = { discount: 0, idempotencyKey: 'reception-opd-bill-replay-1' };
      const requestHash = await createIdempotencyRequestHash({
        visitId: VISIT_1.id,
        ...requestBody,
        idempotencyKey: undefined,
      });
      const existingResponse = {
        message: 'Bill generated from visit services',
        billId: 9100,
        invoiceNo: 'INV-REPLAY-9100',
        total: 500,
        serviceCount: 1,
      };

      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          visit_services: [
            {
              id: 41,
              tenant_id: TENANT_1.id,
              visit_id: VISIT_1.id,
              patient_id: PATIENT_1.id,
              service_type: 'doctor_visit',
              description: 'Consultation',
              service_item_id: 901,
              amount: 500,
              discount_amount: 0,
              quantity: 1,
              total_amount: 500,
              status: 'pending',
            },
          ],
        },
        queryOverride(sql) {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: requestHash,
                status: 'completed',
                response_json: JSON.stringify(existingResponse),
              },
            };
          }
          return null;
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
        method: 'POST',
        body: requestBody,
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { idempotent?: boolean; invoiceNo?: string };
      expect(body).toMatchObject({ idempotent: true, invoiceNo: 'INV-REPLAY-9100' });
      expect(mockDB.queries.some((query) =>
        query.sql.toLowerCase().includes('insert into "bills"') ||
        query.sql.toLowerCase().includes('insert into bills')
      )).toBe(false);
    });

    it('rejects a reception OPD bill idempotency key reused with a different payload', async () => {
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          visit_services: [
            {
              id: 42,
              tenant_id: TENANT_1.id,
              visit_id: VISIT_1.id,
              patient_id: PATIENT_1.id,
              service_type: 'doctor_visit',
              description: 'Consultation',
              service_item_id: 901,
              amount: 500,
              discount_amount: 0,
              quantity: 1,
              total_amount: 500,
              status: 'pending',
            },
          ],
        },
        queryOverride(sql) {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: 'different-payload-hash',
                status: 'completed',
                response_json: JSON.stringify({ invoiceNo: 'INV-REPLAY-9100' }),
              },
            };
          }
          return null;
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
        method: 'POST',
        body: { discount: 0, idempotencyKey: 'reception-opd-bill-replay-1' },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/already used/i);
      expect(mockDB.queries.some((query) =>
        query.sql.toLowerCase().includes('insert into "bills"') ||
        query.sql.toLowerCase().includes('insert into bills')
      )).toBe(false);
    });

    it('blocks bill generation in a closed accounting period', async () => {
      const today = new Date().toISOString().split('T')[0];
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          accounting_period_closes: [closedPeriodRow(today.slice(0, 7))],
          visit_services: [
            {
              id: 21,
              tenant_id: TENANT_1.id,
              visit_id: VISIT_1.id,
              patient_id: PATIENT_1.id,
              service_type: 'doctor_visit',
              description: 'Consultation',
              service_item_id: 901,
              amount: 500,
              discount_amount: 0,
              quantity: 1,
              total_amount: 500,
              status: 'pending',
            },
          ],
        },
      });

      const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
        method: 'POST',
        body: {},
      });

      expect(res.status).toBe(409);
      expect(mockDB.queries.some((query) =>
        query.method === 'all' && query.sql.toLowerCase().includes('insert into "bills"')
      )).toBe(false);
    });

    it('returns 404 when visit does not exist', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { visits: [], patients: [] },
      });

      const res = await jsonRequest(app, '/reception/visits/999/generate-bill', {
        method: 'POST',
        body: {},
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when no pending services exist for visit', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          patients: [PATIENT_1],
          visit_services: [],
        },
      });

      const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
        method: 'POST',
        body: {},
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /visits/:id/services — List Visit Services', () => {
    it('returns services and pending total for a visit', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          visits: [VISIT_1],
          visit_services: [
            { id: 1, tenant_id: TENANT_1.id, visit_id: 1, patient_id: PATIENT_1.id, service_type: 'doctor_visit', description: 'Consultation', amount: 500, discount_amount: 0, quantity: 1, total_amount: 500, status: 'pending' },
            { id: 2, tenant_id: TENANT_1.id, visit_id: 1, patient_id: PATIENT_1.id, service_type: 'test', description: 'CBC', amount: 500, discount_amount: 0, quantity: 1, total_amount: 500, status: 'billed', bill_id: 1 },
          ],
        },
      });

      const res = await jsonRequest(app, '/reception/visits/1/services');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.services).toHaveLength(2);
      expect(body.pendingTotal).toBe(500); // only the pending one
    });

    it('returns empty services when visit has no services', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { visits: [], patients: [], visit_services: [] },
      });

      const res = await jsonRequest(app, '/reception/visits/999/services');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.services).toEqual([]);
      expect(body.pendingTotal).toBe(0);
    });
  });

  describe('GET /daily-report — Daily Collection Report', () => {
    it('returns report structure with all aggregates', async () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { app, mockDB } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          bills: [
            { id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, total_amount: 5000, paid_amount: 5000, discount: 0, status: 'paid', created_at: today },
            { id: 2, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, total_amount: 2000, paid_amount: 1200, discount: 0, status: 'partial_paid', created_at: yesterday },
          ],
          payments: [
            { id: 1, tenant_id: TENANT_1.id, bill_id: 1, amount: 5000, payment_type: 'current', payment_method: 'cash', date: today },
            { id: 2, tenant_id: TENANT_1.id, bill_id: 2, amount: 1200, payment_type: 'due', payment_method: 'cash', date: today },
          ],
          invoice_items: [
            { id: 1, tenant_id: TENANT_1.id, bill_id: 1, item_category: 'doctor_visit', total_amount: 3000, quantity: 1 },
            { id: 2, tenant_id: TENANT_1.id, bill_id: 1, item_category: 'test', total_amount: 2000, quantity: 1 },
          ],
          visit_services: [
            { id: 1, tenant_id: TENANT_1.id, visit_id: 1, patient_id: PATIENT_1.id, service_type: 'doctor_visit', amount: 3000, total_amount: 3000, status: 'billed', bill_id: 1, doctor_id: DOCTOR_USER.id },
            { id: 2, tenant_id: TENANT_1.id, visit_id: 1, patient_id: PATIENT_1.id, service_type: 'test', amount: 2000, total_amount: 2000, status: 'billed', bill_id: 1, doctor_id: DOCTOR_USER.id },
          ],
          doctors: [{ id: DOCTOR_USER.id, name: DOCTOR_USER.name }],
        },
        queryOverride(sql) {
          if (sql.includes('FROM payments p') && sql.includes('billing_collection')) {
            return { first: { billing_collection: 5000, due_collection: 1200, total_collection: 6200 } };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, `/reception/daily-report?date=${today}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.summary).toBeDefined();
      expect(body.summary.totalPaid).toBe(5000);
      expect(body.summary.dueCollection).toBe(1200);
      expect(body.summary.totalCashReceived).toBe(6200);
      expect(body.byCategory).toBeDefined();
      expect(body.byPaymentMethod).toBeDefined();
      expect(body.byDoctor).toBeDefined();

      const paymentTotalsQuery = mockDB.queries.find((query) =>
        query.method === 'first' && query.sql.includes('billing_collection')
      );
      expect(paymentTotalsQuery?.sql).toContain('date(COALESCE(p.date, p.created_at)) = date(?)');
      expect(paymentTotalsQuery?.sql).not.toContain("date(p.date, p.created_at");
    });

    it('defaults to today when date param is missing', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          bills: [],
          payments: [],
          invoice_items: [],
          visit_services: [],
          doctors: [],
        },
      });

      const res = await jsonRequest(app, '/reception/daily-report');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.summary).toBeDefined();
      expect(body.summary.totalBilled).toBe(0);
      expect(body.summary.billCount).toBe(0);
    });
  });

  describe('GET /patients/:id/context — Patient Context', () => {
    it('returns past (discharged) admissions excluding active admissions', async () => {
      const activeAdmission = {
        id: 20,
        tenant_id: TENANT_1.id,
        admission_no: 'ADM-00001',
        patient_id: PATIENT_1.id,
        bed_id: 11,
        doctor_id: 5,
        status: 'admitted',
        admission_date: '2024-01-20T08:00:00Z',
        discharge_date: null,
      };
      const dischargedAdmission = {
        id: 21,
        tenant_id: TENANT_1.id,
        admission_no: 'ADM-00002',
        patient_id: PATIENT_1.id,
        bed_id: null,
        doctor_id: 5,
        status: 'discharged',
        admission_date: '2024-01-10T08:00:00Z',
        discharge_date: '2024-01-14T10:00:00Z',
      };

      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          patients: [PATIENT_1],
          visits: [],
          bills: [],
          admissions: [activeAdmission, dischargedAdmission],
          billing_deposits: [],
          lab_orders: [],
          lab_order_items: [],
          payments: [],
          doctors: [{ id: 5, tenant_id: TENANT_1.id, name: 'Dr. Fatima Akhter' }],
          beds: [
            { id: 11, tenant_id: TENANT_1.id, ward_name: 'Cabin', bed_number: 'C-01' },
          ],
        },
        queryOverride: (sql) => {
          const normalized = sql.toLowerCase();
          if (normalized.includes("a.status = 'discharged'")) {
            return {
              results: [
                {
                  id: dischargedAdmission.id,
                  admission_no: dischargedAdmission.admission_no,
                  status: dischargedAdmission.status,
                  admission_date: dischargedAdmission.admission_date,
                  discharge_date: dischargedAdmission.discharge_date,
                  ward_name: null,
                  bed_number: null,
                  doctor_name: 'Dr. Fatima Akhter',
                },
              ],
            };
          }
          return null;
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, `/reception/patients/${PATIENT_1.id}/context`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        pastAdmissions: Array<{ id: number; status: string; admission_no: string }>;
        activeAdmission: { id: number; status: string } | null;
      };

      expect(body.pastAdmissions).toHaveLength(1);
      expect(body.pastAdmissions[0].id).toBe(dischargedAdmission.id);
      expect(body.pastAdmissions[0].status).toBe('discharged');
      expect(body.pastAdmissions[0].admission_no).toBe('ADM-00002');

      expect(body.activeAdmission).toBeDefined();
      expect(body.activeAdmission?.id).toBe(activeAdmission.id);
    });
  });

  describe('Authorization guards', () => {
    it('rejects requests without an authorized reception role', async () => {
      const { app } = createTestAppNoRole({
        route: receptionRoute,
        routePath: '/reception',
        tenantId: TENANT_1.id,
        tables: { billing_service_items: [], billing_service_departments: [] },
      });

      const res = await jsonRequest(app, '/reception/services');
      expect(res.status).toBe(403);
    });

    it('allows receptionist role', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { billing_service_items: [], billing_service_departments: [] },
      });

      const res = await jsonRequest(app, '/reception/services');
      expect(res.status).toBe(200);
    });

    it('allows hospital_admin role', async () => {
      const { app } = createTestApp({
        route: receptionRoute,
        routePath: '/reception',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { billing_service_items: [], billing_service_departments: [] },
      });

      const res = await jsonRequest(app, '/reception/services');
      expect(res.status).toBe(200);
    });
  });

});
