import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

const summaryRows = [{
  bucket: '18_30',
  unique_patients: 1,
  visits: 2,
  admissions: 1,
  services: 3,
  bill_count: 1,
  collection: 500,
  repeat_patients: 1,
}];

const patientRows = [{
  patient_id: 41,
  patient_code: 'P-0041',
  patient_name: 'Rahim Uddin',
  age_at_service: 28,
  bucket: '18_30',
  latest_service_at: '2026-07-30',
  visits: 2,
  admissions: 1,
  services: 3,
  collection: 500,
  total_rows: 1,
  overall_unique_patients: 1,
  overall_visits: 2,
  overall_services: 3,
  overall_collection: 500,
}];

const patientPath = '/dashboard/patient-age-analytics/details?ageBucket=18_30&view=patients&preset=custom&startDate=2026-07-01&endDate=2026-07-31';

describe('dashboard patient age detail privacy', () => {
  it('returns patient rows only when patients:read is present', async () => {
    let patientSql = '';
    let patientParams: unknown[] = [];
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'accountant',
      permissions: ['patients:read'],
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        if (sql.includes('dashboard_patient_age:summary')) return { results: summaryRows };
        if (sql.includes('dashboard_patient_age:details:patients')) {
          patientSql = sql;
          patientParams = params;
          return { results: patientRows };
        }
        return null;
      },
    });

    const response = await app.request(patientPath);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      view: string;
      rows: Array<Record<string, unknown>>;
      totals: Record<string, number>;
    };
    expect(body.view).toBe('patients');
    expect(body.rows[0]).toEqual({
      patientId: 41,
      patientCode: 'P-0041',
      patientName: 'Rahim Uddin',
      ageAtService: 28,
      bucket: '18_30',
      latestServiceAt: '2026-07-30',
      visits: 2,
      admissions: 1,
      services: 3,
      collection: 500,
    });
    expect(body.totals).toMatchObject({ uniquePatients: 1, visits: 2, services: 3, collection: 500 });

    const lower = patientSql.toLowerCase();
    expect(lower).toContain('/* dashboard_patient_age:details:patients */');
    expect(lower).toContain('p.patient_code');
    expect(lower).toContain('p.name as patient_name');
    expect(lower).not.toContain('p.mobile');
    expect(lower).not.toContain('p.address');
    expect(lower).not.toContain('national_id');
    expect(lower).not.toContain('result_text');
    expect(patientParams[0]).toBe('tenant-1');
  });

  it('keeps unknown patient age null instead of coercing it to zero', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'accountant',
      permissions: ['patients:read'],
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('dashboard_patient_age:summary')) {
          return {
            results: [{
              bucket: 'unknown',
              unique_patients: 1,
              visits: 1,
              admissions: 0,
              services: 0,
              bill_count: 0,
              collection: 0,
              repeat_patients: 0,
            }],
          };
        }
        if (sql.includes('dashboard_patient_age:details:patients')) {
          return {
            results: [{
              ...patientRows[0],
              age_at_service: null,
              bucket: 'unknown',
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request(patientPath.replace('ageBucket=18_30', 'ageBucket=unknown'));
    expect(response.status).toBe(200);
    const body = await response.json() as { rows: Array<{ ageAtService: number | null; bucket: string }> };
    expect(body.rows[0]).toMatchObject({ ageAtService: null, bucket: 'unknown' });
  });

  it('returns 403 without patients:read before executing patient identity SQL', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'accountant',
      permissions: [],
      tenantId: 'tenant-1',
    });

    const response = await app.request(patientPath);
    expect(response.status).toBe(403);
    expect(mockDB.queries.some((query) => query.sql.includes('dashboard_patient_age:details:patients'))).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.includes('dashboard_patient_age:summary'))).toBe(false);
  });

  it('keeps aggregate views available without patient detail permission', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'accountant',
      permissions: [],
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('dashboard_patient_age:summary')) return { results: summaryRows };
        if (sql.includes('dashboard_patient_age:details:services')) {
          return {
            results: [{
              row_id: 'service:lab:cbc',
              row_name: 'CBC',
              category: 'Lab',
              unique_patients: 1,
              visits: 0,
              services: 3,
              collection: 500,
              total_rows: 1,
              overall_unique_patients: 1,
              overall_visits: 0,
              overall_services: 3,
              overall_collection: 500,
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request(
      '/dashboard/patient-age-analytics/details?ageBucket=18_30&view=services&preset=custom&startDate=2026-07-01&endDate=2026-07-31',
    );
    expect(response.status).toBe(200);
  });

  it('never returns phone, address, national identifier, or clinical narrative fields', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'accountant',
      permissions: ['patients:read'],
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('dashboard_patient_age:summary')) return { results: summaryRows };
        if (sql.includes('dashboard_patient_age:details:patients')) return { results: patientRows };
        return null;
      },
    });

    const response = await app.request(patientPath);
    const text = await response.text();
    for (const forbidden of [
      'phone',
      'mobile',
      'address',
      'nationalId',
      'national_id',
      'medicalNarrative',
      'clinicalResult',
      'resultText',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('does not write patient identity to application logs', async () => {
    const originalLog = console.log;
    const originalError = console.error;
    const logs: unknown[][] = [];
    console.log = (...args: unknown[]) => { logs.push(args); };
    console.error = (...args: unknown[]) => { logs.push(args); };
    try {
      const { app } = createTestApp({
        route: dashboardRoutes,
        routePath: '/dashboard',
        role: 'accountant',
        permissions: ['patients:read'],
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          if (sql.includes('dashboard_patient_age:summary')) return { results: summaryRows };
          if (sql.includes('dashboard_patient_age:details:patients')) return { results: patientRows };
          return null;
        },
      });
      expect((await app.request(patientPath)).status).toBe(200);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('Rahim Uddin');
    expect(serialized).not.toContain('P-0041');
  });
});
