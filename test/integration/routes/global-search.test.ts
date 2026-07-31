import { describe, it, expect } from 'vitest';
import globalSearchRoute from '../../../src/routes/tenant/global-search';
import { createTestApp } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';

const TENANT_1 = { id: 'tenant-1' };

const patients = [
  { id: 1, name: 'John Doe', mobile: '01712345678', patient_code: 'P001', tenant_id: TENANT_1.id },
  { id: 2, name: 'Jane Smith', mobile: '01812345678', patient_code: 'P002', tenant_id: TENANT_1.id },
  { id: 3, name: 'Bob Johnson', mobile: '01912345678', patient_code: 'P003', tenant_id: TENANT_1.id },
];

const bills = [
  { id: 1, invoice_no: 'INV-000001', patient_id: 1, total: 5000, status: 'paid', tenant_id: TENANT_1.id },
  { id: 2, invoice_no: 'INV-000002', patient_id: 2, total: 3000, status: 'open', tenant_id: TENANT_1.id },
];

const doctors = [
  { id: 1, name: 'Dr. Ahmed', phone: '01612345678', tenant_id: TENANT_1.id },
  { id: 2, name: 'Dr. Fatima', phone: '01512345678', tenant_id: TENANT_1.id },
];

const admissions = [
  { id: 1, patient_id: 1, patient_name: 'John Doe', bed_number: '101-A', status: 'admitted', tenant_id: TENANT_1.id },
];

/**
 * queryOverride for OR-based LIKE searches — the mock DB applies all
 * conditions as AND, but global-search uses OR within each entity query.
 */
function orLikeOverride(
  allTables: Record<string, Record<string, unknown>[]>,
  table: string,
  matchFields: string[],
) {
  return (sql: string, params: unknown[]) => {
    if (!sql.includes('LIKE ?') || !sql.toUpperCase().includes(table.toUpperCase())) return null;
    const searchTerms = params
      .filter((p): p is string => typeof p === 'string' && p.startsWith('%'))
      .map((p) => p.replace(/%/g, ''))
      .filter(Boolean);
    if (!searchTerms.length) return null;
    let rows = (allTables[table] ?? []).filter((row: Record<string, unknown>) =>
      matchFields.some((field) => {
        const value = String(row[field] ?? '');
        const valueCompact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        return searchTerms.some((term) => {
          const termCompact = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
          return value.toLowerCase().includes(term.toLowerCase())
            || (termCompact.length > 0 && valueCompact.includes(termCompact));
        });
      }),
    );
    // Apply LIMIT if present (last param is typically the limit)
    const limitParam = params[params.length - 1];
    if (typeof limitParam === 'number' && sql.toUpperCase().includes('LIMIT')) {
      rows = rows.slice(0, limitParam);
    }
    return { results: rows, last_row_id: 0, changes: 0 };
  };
}

describe('Global Search API', () => {
  describe('GET /search', () => {
    it('returns matching patients', async () => {
      const mockDB = createMockDB({
        tables: { patients, bills, doctors, admissions: [] },
        queryOverride: (sql, params) => orLikeOverride({ patients, bills, doctors, admissions: [] }, 'patients', ['name', 'mobile', 'patient_code'])(sql, params),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=John');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { patients: unknown[] } };
      expect(body.data.patients.length).toBeGreaterThan(0);
    });

    it('returns matching invoices', async () => {
      const mockDB = createMockDB({
        tables: { patients: [], bills, doctors: [], admissions: [] },
        queryOverride: orLikeOverride({ patients: [], bills, doctors: [], admissions: [] }, 'bills', ['invoice_no', 'patient_id', 'patient_name', 'patient_code']),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=INV-000001');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { bills: unknown[] } };
      expect(body.data.bills.length).toBe(1);
    });

    it('returns bill_no invoices when only the numeric suffix is typed', async () => {
      const invoiceRows = [
        { id: 259, invoice_no: null, bill_no: 'INV-D-2026-000259', patient_id: 1, total: 1100, status: 'paid', tenant_id: TENANT_1.id },
      ];
      const mockDB = createMockDB({
        tables: { patients: [], bills: invoiceRows, doctors: [], admissions: [] },
        queryOverride: orLikeOverride({ patients: [], bills: invoiceRows, doctors: [], admissions: [] }, 'bills', ['invoice_no', 'bill_no', 'id', 'patient_id', 'patient_name', 'patient_code']),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=259');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { bills: Array<{ invoice_no?: string | null; bill_no?: string | null }> } };
      expect(body.data.bills).toHaveLength(1);
      expect(body.data.bills[0].invoice_no ?? body.data.bills[0].bill_no).toBe('INV-D-2026-000259');
    });

    it('returns BL invoices when the typed query has extra separators', async () => {
      const blBills = [
        { id: 14, invoice_no: 'BL-000014', patient_id: 1, total: 1500, status: 'paid', tenant_id: TENANT_1.id },
      ];
      const mockDB = createMockDB({
        tables: { patients: [], bills: blBills, doctors: [], admissions: [] },
        queryOverride: orLikeOverride({ patients: [], bills: blBills, doctors: [], admissions: [] }, 'bills', ['invoice_no', 'patient_id', 'patient_name', 'patient_code']),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=BL-0000-14');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { bills: Array<{ invoice_no: string }> } };
      expect(body.data.bills).toHaveLength(1);
      expect(body.data.bills[0].invoice_no).toBe('BL-000014');
    });

    it('returns multiple invoices from comma-separated numeric search fragments', async () => {
      const invoiceRows = [
        { id: 14, invoice_no: 'BL-000014', patient_id: 1, total: 1500, status: 'paid', tenant_id: TENANT_1.id },
        { id: 23, invoice_no: 'INV-000023', patient_id: 2, total: 2500, status: 'paid', tenant_id: TENANT_1.id },
        { id: 289, invoice_no: 'INV-D-2026-000289', patient_id: 3, total: 3500, status: 'open', tenant_id: TENANT_1.id },
      ];
      const mockDB = createMockDB({
        tables: { patients: [], bills: invoiceRows, doctors: [], admissions: [] },
        queryOverride: orLikeOverride({ patients: [], bills: invoiceRows, doctors: [], admissions: [] }, 'bills', ['invoice_no', 'patient_id', 'patient_name', 'patient_code']),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=14,289,23');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { bills: Array<{ invoice_no: string }> } };
      expect(body.data.bills.map((bill) => bill.invoice_no).sort()).toEqual(['BL-000014', 'INV-000023', 'INV-D-2026-000289'].sort());
    });

    it('returns matching doctors', async () => {
      const mockDB = createMockDB({
        tables: { patients: [], bills: [], doctors, admissions: [] },
        queryOverride: (sql, params) => orLikeOverride({ patients: [], bills: [], doctors, admissions: [] }, 'doctors', ['name', 'phone'])(sql, params),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=Ahmed');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { doctors: unknown[] } };
      expect(body.data.doctors.length).toBe(1);
    });

    it('returns results across all categories', async () => {
      const mockDB = createMockDB({
        tables: { patients, bills, doctors, admissions },
        queryOverride: (sql, params) => {
          const allTables = { patients, bills, doctors, admissions };
          for (const [table, fields] of [['patients', ['name', 'mobile', 'patient_code']], ['doctors', ['name', 'phone']], ['admissions', ['patient_name', 'bed_number']]] as const) {
            const result = orLikeOverride(allTables, table, fields)(sql, params);
            if (result) return result;
          }
          return null;
        },
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=John');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { patients: unknown[]; bills: unknown[]; doctors: unknown[]; admissions: unknown[] } };
      expect(body.data).toHaveProperty('patients');
      expect(body.data).toHaveProperty('bills');
      expect(body.data).toHaveProperty('doctors');
      expect(body.data).toHaveProperty('admissions');
    });

    it('does not return results from other tenants', async () => {
      const otherTenantPatient = { id: 99, name: 'John Other', mobile: '01799999999', patient_code: 'P999', tenant_id: 'tenant-2' };
      const allPatients = [...patients, otherTenantPatient];
      const mockDB = createMockDB({
        tables: { patients: allPatients, bills: [], doctors: [], admissions: [] },
        queryOverride: (sql, params) => {
          const result = orLikeOverride({ patients: allPatients, bills: [], doctors: [], admissions: [] }, 'patients', ['name', 'mobile', 'patient_code'])(sql, params);
          if (result && sql.includes('tenant_id')) {
            const tenantParam = params.find(p => typeof p === 'string' && p.startsWith('tenant-'));
            if (tenantParam) {
              result.results = result.results.filter((r: Record<string, unknown>) => r.tenant_id === tenantParam);
            }
          }
          return result;
        },
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=John');
      const body = await res.json() as { data: { patients: { tenant_id: string }[] } };
      expect(body.data.patients.every(p => p.tenant_id === TENANT_1.id)).toBe(true);
    });

    it('returns 400 for query less than 2 chars', async () => {
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { patients: [], bills: [], doctors: [], admissions: [] },
      });

      const res = await app.request('/search?q=J');
      expect(res.status).toBe(400);
    });

    it('returns empty results when no matches', async () => {
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { patients: [], bills: [], doctors: [], admissions: [] },
      });

      const res = await app.request('/search?q=NonExistent');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { patients: unknown[]; bills: unknown[] } };
      expect(body.data.patients).toHaveLength(0);
      expect(body.data.bills).toHaveLength(0);
    });

    it('respects limit parameter', async () => {
      const manyPatients = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, name: `John Patient ${i}`, mobile: `0171234${String(i).padStart(4, '0')}`,
        patient_code: `P${String(i).padStart(3, '0')}`, tenant_id: TENANT_1.id,
      }));

      const mockDB = createMockDB({
        tables: { patients: manyPatients, bills: [], doctors: [], admissions: [] },
        queryOverride: (sql, params) => orLikeOverride({ patients: manyPatients, bills: [], doctors: [], admissions: [] }, 'patients', ['name', 'mobile', 'patient_code'])(sql, params),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=John&limit=3');
      const body = await res.json() as { data: { patients: unknown[] } };
      expect(body.data.patients.length).toBeLessThanOrEqual(3);
    });

    it('returns 403 for non-admin role', async () => {
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'marketing_referral',
        tenantId: TENANT_1.id,
        tables: { patients: [], bills: [], doctors: [], admissions: [] },
      });

      const res = await app.request('/search?q=John');
      expect(res.status).toBe(403);
    });

    it('searches by phone number', async () => {
      const mockDB = createMockDB({
        tables: { patients, bills: [], doctors: [], admissions: [] },
        queryOverride: (sql, params) => orLikeOverride({ patients, bills: [], doctors: [], admissions: [] }, 'patients', ['name', 'mobile', 'patient_code'])(sql, params),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=01712345678');
      const body = await res.json() as { data: { patients: unknown[] } };
      expect(body.data.patients.length).toBe(1);
    });

    it('searches by patient code', async () => {
      const mockDB = createMockDB({
        tables: { patients, bills: [], doctors: [], admissions: [] },
        queryOverride: (sql, params) => orLikeOverride({ patients, bills: [], doctors: [], admissions: [] }, 'patients', ['name', 'mobile', 'patient_code'])(sql, params),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=P001');
      const body = await res.json() as { data: { patients: unknown[] } };
      expect(body.data.patients.length).toBe(1);
    });

    it('returns 400 for missing q param', async () => {
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { patients: [], bills: [], doctors: [], admissions: [] },
      });

      const res = await app.request('/search');
      expect(res.status).toBe(400);
    });

    it('searches with exactly 2 chars (boundary)', async () => {
      const mockDB = createMockDB({
        tables: { patients, bills: [], doctors: [], admissions: [] },
        queryOverride: (sql, params) => orLikeOverride({ patients, bills: [], doctors: [], admissions: [] }, 'patients', ['name', 'mobile', 'patient_code'])(sql, params),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=Jo');
      expect(res.status).toBe(200);
    });

    it('returns 400 for whitespace-only query', async () => {
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { patients: [], bills: [], doctors: [], admissions: [] },
      });

      const res = await app.request('/search?q=%20%20');
      expect(res.status).toBe(400);
    });

    it('handles SQL injection attempt safely', async () => {
      const mockDB = createMockDB({
        tables: { patients, bills: [], doctors: [], admissions: [] },
        queryOverride: (sql, params) => orLikeOverride({ patients, bills: [], doctors: [], admissions: [] }, 'patients', ['name', 'mobile', 'patient_code'])(sql, params),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request("/search?q='; DROP TABLE patients; --");
      expect(res.status).toBe(200);
    });

    it('searches by invoice number', async () => {
      const mockDB = createMockDB({
        tables: { patients: [], bills, doctors: [], admissions: [] },
        queryOverride: orLikeOverride({ patients: [], bills, doctors: [], admissions: [] }, 'bills', ['invoice_no', 'patient_id', 'patient_name', 'patient_code']),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=INV-000002');
      const body = await res.json() as { data: { bills: unknown[] } };
      expect(body.data.bills.length).toBe(1);
    });

    it('finds invoice with bare digit (e.g. "02" → INV-000002 via padding)', async () => {
      const mockDB = createMockDB({
        tables: { patients: [], bills, doctors: [], admissions: [] },
        queryOverride: orLikeOverride({ patients: [], bills, doctors: [], admissions: [] }, 'bills', ['invoice_no', 'patient_id', 'patient_name', 'patient_code']),
      });
      const { app } = createTestApp({
        route: globalSearchRoute,
        routePath: '/search',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        mockDB,
      });

      const res = await app.request('/search?q=02');
      const body = await res.json() as { data: { bills: { invoice_no: string }[] } };
      expect(body.data.bills.length).toBe(1);
      expect(body.data.bills[0].invoice_no).toBe('INV-000002');
    });
  });
});
