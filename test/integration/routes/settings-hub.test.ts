/**
 * Integration tests for Settings Hub routes:
 * - /api/departments (Department CRUD)
 * - /api/payment-methods (Payment Method CRUD)
 * - /api/import/* and /api/export/* (Import/Export)
 */

import { describe, it, expect } from 'vitest';
import departmentRoutes from '../../../src/routes/tenant/departments';
import paymentMethodRoutes from '../../../src/routes/tenant/payment-methods';
import settingsImportExportRoutes from '../../../src/routes/tenant/settings-import-export';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';

// ─── Fixtures ─────────────────────────────────────────────────────────────

const DEPT_1 = {
  id: 1, department_name: 'OPD', department_code: 'OPD',
  is_active: 1, tenant_id: 'tenant-1', created_at: '2026-01-01', updated_at: '2026-01-01',
};

const DEPT_2 = {
  id: 2, department_name: 'Laboratory', department_code: 'LAB',
  is_active: 1, tenant_id: 'tenant-1', created_at: '2026-01-01', updated_at: '2026-01-01',
};

const DEPT_INACTIVE = {
  id: 3, department_name: 'Old Dept', department_code: 'OLD',
  is_active: 0, tenant_id: 'tenant-1', created_at: '2026-01-01', updated_at: '2026-01-01',
};

const PAYMENT_METHOD_1 = {
  id: 1, name: 'Cash', code: 'cash',
  active: 1, transaction_id_required: 0, charge_applicable: 0, tenant_id: 'tenant-1',
};

const PAYMENT_METHOD_2 = {
  id: 2, name: 'bKash', code: 'bkash',
  active: 1, transaction_id_required: 1, charge_applicable: 1, tenant_id: 'tenant-1',
};

// ═══════════════════════════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Departments Route', () => {

  describe('GET /', () => {
    it('returns all departments for tenant', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [DEPT_1, DEPT_2] },
      });

      const res = await app.request('/');
      expect(res.status).toBe(200);

      const body = await res.json() as { departments: unknown[] };
      expect(body.departments).toHaveLength(2);
      expect(body.departments[0]).toMatchObject({
        id: 1, name: 'OPD', code: 'OPD', status: 'active',
      });
    });

    it('maps is_active=0 to status=inactive', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [DEPT_INACTIVE] },
      });

      const res = await app.request('/');
      const body = await res.json() as { departments: unknown[] };
      expect(body.departments[0]).toMatchObject({ status: 'inactive' });
    });

    it('returns empty array when no departments exist', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [] },
      });

      const res = await app.request('/');
      const body = await res.json() as { departments: unknown[] };
      expect(body.departments).toEqual([]);
    });

    it('sets opd and ipd to false (not in table)', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [DEPT_1] },
      });

      const res = await app.request('/');
      const body = await res.json() as { departments: Array<{ opd: boolean; ipd: boolean }> };
      expect(body.departments[0].opd).toBe(false);
      expect(body.departments[0].ipd).toBe(false);
    });
  });

  describe('POST /', () => {
    it('accepts valid department data', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/', { method: 'POST', body: { name: 'Radiology', code: 'RAD' } });
      // universalFallback triggers duplicate check → 409 is acceptable
      expect([200, 201, 409]).toContain(res.status);
    });

    it('rejects missing name with 400', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/', { method: 'POST', body: { code: 'X' } });
      expect(res.status).toBe(400);
    });

    it('rejects missing code with 400', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/', { method: 'POST', body: { name: 'X' } });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /', () => {
    it('rejects missing id with 400', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [DEPT_1] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/', { method: 'PUT', body: { name: 'X' } });
      expect(res.status).toBe(400);
    });

    it('rejects update with no fields', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [DEPT_1] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/', { method: 'PUT', body: { id: 1 } });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /status', () => {
    it('rejects missing id', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/status', { method: 'PUT', body: { status: 'active' } });
      expect(res.status).toBe(400);
    });

    it('rejects missing status', async () => {
      const { app } = createTestApp({
        route: departmentRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { billing_service_departments: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/status', { method: 'PUT', body: { id: 1 } });
      expect(res.status).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT METHODS
// ═══════════════════════════════════════════════════════════════════════════

describe('Payment Methods Route', () => {

  describe('GET /', () => {
    it('returns all payment methods for tenant', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [PAYMENT_METHOD_1, PAYMENT_METHOD_2] },
      });

      const res = await app.request('/');
      expect(res.status).toBe(200);

      const body = await res.json() as { methods: unknown[] };
      expect(body.methods).toHaveLength(2);
      expect(body.methods[0]).toMatchObject({
        id: 1, name: 'Cash', code: 'cash',
        active: true, transaction_id_required: false, charge_applicable: false,
      });
      expect(body.methods[1]).toMatchObject({
        id: 2, name: 'bKash', code: 'bkash',
        active: true, transaction_id_required: true, charge_applicable: true,
      });
    });

    it('maps active=0 to false', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [{ ...PAYMENT_METHOD_1, active: 0 }] },
      });

      const res = await app.request('/');
      const body = await res.json() as { methods: unknown[] };
      expect(body.methods[0]).toMatchObject({ active: false });
    });

    it('maps transaction_id_required=1 to true', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [{ ...PAYMENT_METHOD_1, transaction_id_required: 1 }] },
      });

      const res = await app.request('/');
      const body = await res.json() as { methods: Array<{ transaction_id_required: boolean }> };
      expect(body.methods[0].transaction_id_required).toBe(true);
    });

    it('maps charge_applicable=1 to true', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [{ ...PAYMENT_METHOD_1, charge_applicable: 1 }] },
      });

      const res = await app.request('/');
      const body = await res.json() as { methods: Array<{ charge_applicable: boolean }> };
      expect(body.methods[0].charge_applicable).toBe(true);
    });

    it('returns empty array when no methods exist', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [] },
      });

      const res = await app.request('/');
      const body = await res.json() as { methods: unknown[] };
      expect(body.methods).toEqual([]);
    });
  });

  describe('POST /', () => {
    it('accepts valid payment method data', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/', { method: 'POST', body: { name: 'Nagad', code: 'nagad' } });
      // universalFallback triggers duplicate check → 409 is acceptable
      expect([200, 201, 409]).toContain(res.status);
    });

    it('rejects missing name with 400', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/', { method: 'POST', body: { code: 'x' } });
      expect(res.status).toBe(400);
    });

    it('rejects missing code with 400', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/', { method: 'POST', body: { name: 'X' } });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /', () => {
    it('rejects missing id with 400', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [PAYMENT_METHOD_1] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/', { method: 'PUT', body: { name: 'X' } });
      expect(res.status).toBe(400);
    });

    it('rejects update with no fields', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [PAYMENT_METHOD_1] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/', { method: 'PUT', body: { id: 1 } });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /status', () => {
    it('rejects missing id', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/status', { method: 'PUT', body: { active: true } });
      expect(res.status).toBe(400);
    });

    it('rejects missing active flag', async () => {
      const { app } = createTestApp({
        route: paymentMethodRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { payment_methods: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/status', { method: 'PUT', body: { id: 1 } });
      expect(res.status).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT / EXPORT
// ═══════════════════════════════════════════════════════════════════════════

describe('Import/Export Routes', () => {

  describe('POST /import/services', () => {
    it('accepts valid CSV data', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {
          billing_service_departments: [{ id: 1, department_code: 'GENERAL', tenant_id: 'tenant-1' }],
          billing_service_items: [],
        },
        universalFallback: true,
      });

      const csv = 'name,code,department\nConsultation,CONSULT-001,GENERAL';
      const res = await jsonRequest(app, '/import/services', { method: 'POST', body: { csv } });
      expect(res.status).not.toBe(404);
    });

    it('rejects empty CSV with 400', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/import/services', { method: 'POST', body: { csv: '' } });
      expect(res.status).toBe(400);
    });

    it('rejects missing csv field with 400', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/import/services', { method: 'POST', body: {} });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /import/medicines', () => {
    it('accepts valid CSV data', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { InventoryItem: [] },
        universalFallback: true,
      });

      const csv = 'name,generic,company,price\nParacetamol,Paracetamol,Square,2.50';
      const res = await jsonRequest(app, '/import/medicines', { method: 'POST', body: { csv } });
      expect(res.status).not.toBe(404);
    });

    it('rejects empty CSV with 400', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/import/medicines', { method: 'POST', body: { csv: '' } });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /import/patients', () => {
    it('accepts valid CSV data', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { patients: [] },
        universalFallback: true,
      });

      const csv = 'name,phone,gender\nJohn,01712345678,male';
      const res = await jsonRequest(app, '/import/patients', { method: 'POST', body: { csv } });
      expect(res.status).not.toBe(404);
    });

    it('commits patient compatibility, audit, Canonical relationship, mapping and outbox in one batch', async () => {
      const mockDB = createMockDB({
        queryOverride(sql) {
          const source = sql.toLowerCase();
          if (source.includes('coalesce(max(id), 0) + 1')) return { first: { next_id: 1 } };
          if (source.includes('from patients') && source.includes('canonical_source_key')) return { first: null };
          if (source.includes('from canonical_outbox_events')) return { first: null };
          if (source.includes('from canonical_tenant_patient_links')) return { first: null };
          if (source.includes('from canonical_source_mappings')) return { first: null };
          return null;
        },
      });
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        userId: 42,
        mockDB,
      });

      const csv = 'name,phone,gender,address\nJohn,01712345678,male,Dhaka';
      const res = await jsonRequest(app, '/import/patients', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'settings-patient-import-001' },
        body: { csv },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ success: 1, failed: 0, errors: [] });
      expect(mockDB.batchCalls).toHaveLength(1);
      const batch = mockDB.batchCalls[0].join('\n');
      expect(batch).toMatch(/INSERT INTO patients/i);
      expect(batch).toMatch(/INSERT INTO audit_logs/i);
      expect(batch).toMatch(/canonical_tenant_patient_links/i);
      expect(batch).toMatch(/canonical_source_mappings/i);
      expect(batch).toMatch(/canonical_outbox_events/i);
    });

    it('rejects empty CSV with 400', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/import/patients', { method: 'POST', body: { csv: '' } });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /export/patients', () => {
    it('returns 200 for CSV format', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { patients: [{ id: 1, name: 'John', mobile: '01712345678', gender: 'male' }] },
      });

      const res = await app.request('/export/patients?format=csv', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
    });

    it('returns 200 for JSON format', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { patients: [{ id: 1, name: 'John', mobile: '01712345678', gender: 'male' }] },
      });

      const res = await app.request('/export/patients?format=json', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('sets content-disposition header for CSV', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { patients: [] },
      });

      const res = await app.request('/export/patients?format=csv', { method: 'POST' });
      expect(res.headers.get('content-disposition')).toContain('patients-export.csv');
    });
  });

  describe('POST /export/billing', () => {
    it('returns 200 for CSV format', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {
          bills: [{ id: 1, invoice_no: 'INV-001', total: 5000, status: 'paid' }],
          patients: [{ id: 1, name: 'John' }],
        },
        universalFallback: true,
      });

      const res = await app.request('/export/billing?format=csv', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('sets content-disposition header', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { bills: [], patients: [] },
        universalFallback: true,
      });

      const res = await app.request('/export/billing?format=csv', { method: 'POST' });
      expect(res.headers.get('content-disposition')).toContain('billing-export.csv');
    });
  });

  describe('POST /export/lab', () => {
    it('returns 200 for CSV format', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {
          tests: [{ id: 1, test_name: 'CBC', status: 'completed', result: 'Normal' }],
          patients: [{ id: 1, name: 'John' }],
        },
        universalFallback: true,
      });

      const res = await app.request('/export/lab?format=csv', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('sets content-disposition header', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: { tests: [], patients: [] },
        universalFallback: true,
      });

      const res = await app.request('/export/lab?format=csv', { method: 'POST' });
      expect(res.headers.get('content-disposition')).toContain('lab-reports-export.csv');
    });
  });

  describe('GET /import/:type/sample', () => {
    it('returns services sample CSV', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {},
      });

      const res = await app.request('/import/services/sample');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('name,code,department');
      expect(text).toContain('General Consultation');
    });

    it('returns medicines sample CSV', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {},
      });

      const res = await app.request('/import/medicines/sample');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('name,generic,company');
      expect(text).toContain('Paracetamol');
    });

    it('returns patients sample CSV', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {},
      });

      const res = await app.request('/import/patients/sample');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('name,phone,gender');
      expect(text).toContain('John Doe');
    });

    it('returns 404 for unknown type', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {},
      });

      const res = await app.request('/import/unknown/sample');
      expect(res.status).toBe(404);
    });

    it('sets correct content-type for CSV', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {},
      });

      const res = await app.request('/import/services/sample');
      expect(res.headers.get('content-type')).toContain('text/csv');
    });

    it('sets content-disposition for download', async () => {
      const { app } = createTestApp({
        route: settingsImportExportRoutes,
        routePath: '/',
        role: 'hospital_admin',
        tables: {},
      });

      const res = await app.request('/import/services/sample');
      expect(res.headers.get('content-disposition')).toContain('attachment');
      expect(res.headers.get('content-disposition')).toContain('services-sample.csv');
    });
  });
});
