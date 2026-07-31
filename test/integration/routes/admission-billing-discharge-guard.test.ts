import { describe, expect, it } from 'vitest';
import admissionsRoutes from '../../../src/routes/tenant/admissions';
import { createMockDB } from '../helpers/mock-db';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

describe('Admission billing discharge guard', () => {
  it('blocks billing discharge when provisional charges are still pending', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM admissions') && sql.includes("status IN ('admitted','critical')")) {
          return { first: { bed_id: 10, patient_id: 1, admission_date: '2026-01-01' } };
        }
        if (sql.includes('FROM billing_provisional_items')) {
          return { first: { amount: 750 } };
        }
        if (sql.includes('FROM visit_services')) {
          return { first: { amount: 0 } };
        }
        if (sql.includes('FROM bills')) {
          return { first: { amount: 0 } };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: admissionsRoutes,
      routePath: '/admissions',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      mockDB,
    });

    const res = await jsonRequest(app, '/admissions/1/billing-discharge', {
      method: 'PUT',
      body: {},
    });

    expect(res.status).toBe(400);
    expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions set status ='))).toBe(false);
  });

  it('blocks clear due when patient still has billing dues', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM accounting_period_closes')) {
          return { first: null };
        }
        if (sql.includes('FROM admissions') && sql.includes("status IN ('admitted','critical')")) {
          return { first: { patient_id: 1, admission_date: '2026-01-01' } };
        }
        if (sql.includes('FROM billing_provisional_items')) {
          return { first: { amount: 0 } };
        }
        if (sql.includes('FROM visit_services')) {
          return { first: { amount: 0 } };
        }
        if (sql.includes('FROM bills')) {
          return { first: { amount: 150 } };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: admissionsRoutes,
      routePath: '/admissions',
      role: 'accountant',
      tenantId: TENANT_1.id,
      mockDB,
    });

    const res = await jsonRequest(app, '/admissions/1/clear-due', {
      method: 'PUT',
      body: { reason: 'checked at billing counter' },
    });

    expect(res.status).toBe(400);
    expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions set discharge_due_cleared_on'))).toBe(false);
  });

  it('blocks clear due in a closed accounting period before updating the admission', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM admissions') && sql.includes("status IN ('admitted','critical')")) {
          return { first: { patient_id: 1, admission_date: '2026-01-01' } };
        }
        if (sql.includes('FROM accounting_period_closes')) {
          return { first: { status: 'closed' } };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: admissionsRoutes,
      routePath: '/admissions',
      role: 'accountant',
      tenantId: TENANT_1.id,
      mockDB,
    });

    const res = await jsonRequest(app, '/admissions/1/clear-due', {
      method: 'PUT',
      body: { reason: 'checked at billing counter' },
    });

    expect(res.status).toBe(409);
    expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions set discharge_due_cleared_on'))).toBe(false);
  });

  it('blocks billing discharge in a closed accounting period before bed/admission updates', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM admissions') && sql.includes("status IN ('admitted','critical')")) {
          return { first: { bed_id: 10, patient_id: 1, admission_date: '2026-01-01' } };
        }
        if (sql.includes('FROM accounting_period_closes')) {
          return { first: { status: 'audited' } };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: admissionsRoutes,
      routePath: '/admissions',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      mockDB,
    });

    const res = await jsonRequest(app, '/admissions/1/billing-discharge', {
      method: 'PUT',
      body: { reason: 'final billing done' },
    });

    expect(res.status).toBe(409);
    expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions set status ='))).toBe(false);
    expect(db.queries.some((q) => q.sql.toLowerCase().includes('update patient_bed_infos'))).toBe(false);
  });

  it('blocks clinical discharge in a closed accounting period before bed/admission updates', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM admissions') && sql.includes("status IN ('admitted','critical')")) {
          return { first: { bed_id: 10, patient_id: 1, admission_date: '2026-01-01' } };
        }
        if (sql.includes('FROM accounting_period_closes')) {
          return { first: { status: 'closed' } };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: admissionsRoutes,
      routePath: '/admissions',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      mockDB,
    });

    const res = await jsonRequest(app, '/admissions/1', {
      method: 'PUT',
      body: { status: 'discharged', discharge_type: 'regular' },
    });

    expect(res.status).toBe(409);
    expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions set status ='))).toBe(false);
    expect(db.queries.some((q) => q.sql.toLowerCase().includes('update patient_bed_infos'))).toBe(false);
  });

  it('audits successful clear due after all discharge billing checks pass', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM accounting_period_closes')) {
          return { first: null };
        }
        if (sql.includes('FROM admissions') && sql.includes("status IN ('admitted','critical')")) {
          return { first: { patient_id: 1, admission_date: '2026-01-01' } };
        }
        if (sql.includes('FROM billing_provisional_items') || sql.includes('FROM visit_services') || sql.includes('FROM bills')) {
          return { first: { amount: 0 } };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: admissionsRoutes,
      routePath: '/admissions',
      role: 'accountant',
      tenantId: TENANT_1.id,
      mockDB,
    });

    const res = await jsonRequest(app, '/admissions/1/clear-due', {
      method: 'PUT',
      body: { reason: 'all due paid' },
    });

    expect(res.status).toBe(200);
    expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions set discharge_due_cleared_on'))).toBe(true);
    expect(db.queries.some((q) => q.sql.includes('INSERT INTO audit_logs'))).toBe(true);
  });
});
