/**
 * Integration tests for invoice_no search on
 * GET /api/ip-billing/patients.
 *
 * The /patients endpoint lists admitted/critical IP patients with a billing
 * summary for the IP Billing UI. When a `search` query parameter is supplied
 * the SQL must ALSO match bills associated with the patient via a LEFT JOIN
 * against bills.invoice_no — with typo-tolerant o->0 and numeric zero-padding
 * via buildInvoiceSearchTerms.
 *
 * Companion change: src/routes/tenant/ipBilling.ts adds a LEFT JOIN against
 * an aggregated bills subquery and three LIKE patterns in the search OR-clause.
 */

import { describe, it, expect } from 'vitest';
import ipBillingRoutes from '../../../src/routes/tenant/ipBilling';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

describe('GET /ip-billing/patients — invoice_no search', () => {
  it('matches when search text contains the invoice number', async () => {
    const { app, mockDB } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        admissions: [
          {
            id: 1,
            tenant_id: TENANT_1.id,
            admission_no: 'A-001',
            patient_id: 10,
            doctor_id: null,
            bed_id: 1,
            status: 'admitted',
            admission_date: '2026-07-01',
            created_at: '2026-07-01 09:00:00',
          },
        ],
        patients: [
          {
            id: 10,
            tenant_id: TENANT_1.id,
            name: 'Selim',
            patient_code: 'P-003',
            mobile: '01700000003',
          },
        ],
        beds: [
          {
            id: 1,
            tenant_id: TENANT_1.id,
            ward_name: 'Ward A',
            bed_number: 'A-1',
          },
        ],
        doctors: [],
        bills: [
          {
            id: 200,
            tenant_id: TENANT_1.id,
            visit_id: null,
            admission_id: 1,
            patient_id: 10,
            invoice_no: 'INV-000099',
            total: 2000,
            paid: 0,
            due: 2000,
            status: 'open',
            created_at: '2026-07-01 09:30:00',
          },
        ],
      },
    });

    const res = await jsonRequest(app, '/ip-billing/patients?search=inv-oooo99');
    expect(res.status).toBe(200);

    const patientSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+admissions/i.test(sql) && sql.includes('invoice_no'));
    expect(patientSql).toBeDefined();
    expect(patientSql!.toLowerCase()).toContain('invoice_no like');
  });

  it('does not add an invoice_no clause when search is empty', async () => {
    const { app, mockDB } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        admissions: [
          {
            id: 1,
            tenant_id: TENANT_1.id,
            admission_no: 'A-001',
            patient_id: 10,
            doctor_id: null,
            bed_id: 1,
            status: 'admitted',
            admission_date: '2026-07-01',
            created_at: '2026-07-01 09:00:00',
          },
        ],
        patients: [
          {
            id: 10,
            tenant_id: TENANT_1.id,
            name: 'Selim',
            patient_code: 'P-003',
            mobile: '01700000003',
          },
        ],
        beds: [
          {
            id: 1,
            tenant_id: TENANT_1.id,
            ward_name: 'Ward A',
            bed_number: 'A-1',
          },
        ],
        doctors: [],
        bills: [],
      },
    });

    const res = await jsonRequest(app, '/ip-billing/patients');
    expect(res.status).toBe(200);

    const patientSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+admissions/i.test(sql));
    expect(patientSql).toBeDefined();
    expect(patientSql!.toLowerCase()).not.toContain('invoice_no like');
  });

  it('selects patient address for the IPD billing identity display', async () => {
    const { app, mockDB } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        admissions: [{
          id: 1,
          tenant_id: TENANT_1.id,
          admission_no: 'A-001',
          patient_id: 10,
          doctor_id: null,
          bed_id: 1,
          status: 'admitted',
          admission_date: '2026-07-01 14:30:00',
          created_at: '2026-07-01 14:30:00',
        }],
        patients: [{
          id: 10,
          tenant_id: TENANT_1.id,
          name: 'Selim',
          patient_code: 'P-003',
          mobile: '01700000003',
          date_of_birth: '1981-01-01',
          address: 'Mirpur, Dhaka',
        }],
        beds: [{ id: 1, tenant_id: TENANT_1.id, ward_name: 'Ward A', bed_number: 'A-1' }],
        doctors: [],
        bills: [],
      },
    });

    const res = await jsonRequest(app, '/ip-billing/patients');
    expect(res.status).toBe(200);

    const patientSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+admissions/i.test(sql));
    expect(patientSql).toBeDefined();
    expect(patientSql).toMatch(/p\.address\s+AS\s+patient_address/i);
  });

  it('exposes canonical-compatible UTC admission time for UTC-naive D1 rows', async () => {
    const { app } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        admissions: [{
          id: 1,
          tenant_id: TENANT_1.id,
          admission_no: 'A-001',
          patient_id: 10,
          doctor_id: null,
          bed_id: 1,
          status: 'admitted',
          admission_date: '2026-07-29 05:46:53',
          created_at: '2026-07-29 05:46:54',
        }],
        patients: [{
          id: 10,
          tenant_id: TENANT_1.id,
          name: 'Sohorab Sikder',
          patient_code: 'P-001146',
          mobile: '01700000003',
          date_of_birth: '1956-01-01',
          address: 'Dholua',
        }],
        beds: [{ id: 1, tenant_id: TENANT_1.id, ward_name: 'General Ward 305', bed_number: '2' }],
        doctors: [],
        bills: [],
      },
    });

    const res = await jsonRequest(app, '/ip-billing/patients');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ admitted_at_utc?: string }> };
    expect(body.data[0]?.admitted_at_utc).toBe('2026-07-29T05:46:53.000Z');
  });

  it('escapes LIKE wildcards in user search input (append ESCAPE)', async () => {
    const { app, mockDB } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        admissions: [
          {
            id: 1,
            tenant_id: TENANT_1.id,
            admission_no: 'A-001',
            patient_id: 10,
            doctor_id: null,
            bed_id: 1,
            status: 'admitted',
            admission_date: '2026-07-01',
            created_at: '2026-07-01 09:00:00',
          },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Selim', patient_code: 'P-003', mobile: '01700000003' }],
        beds: [{ id: 1, tenant_id: TENANT_1.id, ward_name: 'Ward A', bed_number: 'A-1' }],
        doctors: [],
        bills: [
          {
            id: 200,
            tenant_id: TENANT_1.id,
            visit_id: null,
            admission_id: 1,
            patient_id: 10,
            invoice_no: 'INV-000099',
            total: 2000,
            paid: 0,
            due: 2000,
            status: 'open',
            created_at: '2026-07-01 09:30:00',
          },
        ],
      },
    });

    const res = await jsonRequest(app, '/ip-billing/patients?search=inv%25');
    expect(res.status).toBe(200);

    const patientSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+admissions/i.test(sql) && sql.includes('invoice_no'));
    expect(patientSql).toBeDefined();
    expect(patientSql!.toLowerCase()).toContain('like ? escape');
  });

  it('scopes the bills subquery by tenant_id (subquery WHERE tenant_id = ?)', async () => {
    const { app, mockDB } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        admissions: [
          {
            id: 1,
            tenant_id: TENANT_1.id,
            admission_no: 'A-001',
            patient_id: 10,
            doctor_id: null,
            bed_id: 1,
            status: 'admitted',
            admission_date: '2026-07-01',
            created_at: '2026-07-01 09:00:00',
          },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Selim', patient_code: 'P-003', mobile: '01700000003' }],
        beds: [{ id: 1, tenant_id: TENANT_1.id, ward_name: 'Ward A', bed_number: 'A-1' }],
        doctors: [],
        bills: [],
      },
    });

    const res = await jsonRequest(app, '/ip-billing/patients?search=inv-000099');
    expect(res.status).toBe(200);

    const patientSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+admissions/i.test(sql) && /FROM\s+bills/i.test(sql));
    expect(patientSql).toBeDefined();
    // The bills subquery must include WHERE tenant_id = ? so it does not
    // scan bills from other tenants.
    expect(patientSql!.toLowerCase()).toContain('from bills');
    expect(patientSql).toMatch(/FROM\s+bills[\s\S]*WHERE\s+tenant_id\s*=\s*\?/i);
  });
});