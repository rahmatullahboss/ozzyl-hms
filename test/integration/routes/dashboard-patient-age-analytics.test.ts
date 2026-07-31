import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import type { PatientAgeAnalyticsResponse } from '../../../src/services/dashboard/patientAgeContract';
import { createTestApp } from '../helpers/test-app';

type QueryRow = {
  bucket: string;
  unique_patients: number;
  visits: number;
  admissions: number;
  services: number;
  bill_count: number;
  collection: number;
  repeat_patients: number;
};

const collectionWarning = 'Collection is attributed from bill paid totals to the invoice service date; payment-date allocation is not used.';
const unknownWarning = 'Some activity is grouped under Unknown age because date of birth is missing, invalid, or after the service date.';

describe('dashboard patient age analytics summary', () => {
  it('returns tenant-scoped age-at-service aggregates with stable zero-filled buckets', async () => {
    let analyticsSql = '';
    let analyticsParams: unknown[] = [];
    const rows: QueryRow[] = [
      {
        bucket: '0_5',
        unique_patients: 2,
        visits: 3,
        admissions: 1,
        services: 4,
        bill_count: 2,
        collection: 1000,
        repeat_patients: 1,
      },
      {
        bucket: '18_30',
        unique_patients: 1,
        visits: 1,
        admissions: 0,
        services: 3,
        bill_count: 1,
        collection: 500,
        repeat_patients: 0,
      },
      {
        bucket: 'unknown',
        unique_patients: 1,
        visits: 0,
        admissions: 1,
        services: 0,
        bill_count: 0,
        collection: 0,
        repeat_patients: 0,
      },
    ];
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        if (sql.includes('dashboard_patient_age:summary')) {
          analyticsSql = sql;
          analyticsParams = params;
          return { results: rows };
        }
        return null;
      },
    });

    const response = await app.request(
      '/dashboard/patient-age-analytics?preset=custom&startDate=2026-07-01&endDate=2026-07-31',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as PatientAgeAnalyticsResponse;

    expect(body.period).toMatchObject({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      preset: 'custom',
    });
    expect(body.metadata).toMatchObject({
      ageBasis: 'completed_years_at_service_date',
      dateBasis: 'service_date',
      timezone: 'Asia/Dhaka',
    });
    expect(body.rows.map((row) => row.bucket)).toEqual([
      '0_5',
      '6_17',
      '18_30',
      '31_45',
      '46_60',
      '61_plus',
      'unknown',
    ]);
    expect(body.rows.find((row) => row.bucket === '0_5')).toMatchObject({
      uniquePatients: 2,
      visits: 3,
      admissions: 1,
      services: 4,
      billCount: 2,
      collection: 1000,
      averageBill: 500,
      repeatPatients: 1,
      repeatVisitRate: 50,
      patientShare: 50,
    });
    expect(body.rows.find((row) => row.bucket === '6_17')).toMatchObject({
      uniquePatients: 0,
      visits: 0,
      services: 0,
      collection: 0,
    });
    expect(body.totals).toMatchObject({
      uniquePatients: 4,
      visits: 4,
      admissions: 2,
      services: 7,
      billCount: 3,
      collection: 1500,
      repeatPatients: 1,
    });
    expect(body.warnings).toEqual(expect.arrayContaining([collectionWarning, unknownWarning]));

    const lower = analyticsSql.toLowerCase();
    expect(lower).toContain('/* dashboard_patient_age:summary */');
    expect(lower).toContain('normalized_activity');
    expect(lower).toContain('patient_bucket_rollup');
    expect(lower).toContain('count(distinct');
    expect(lower).toContain('service_date');
    expect(lower).toContain('date_of_birth');
    expect(lower).not.toContain('patient_name');
    expect(lower).not.toContain('patient_code');
    expect(lower).not.toContain('phone');
    expect(analyticsParams).toEqual([
      'tenant-1', '2026-07-01', '2026-07-31',
      'tenant-1', '2026-07-01', '2026-07-31',
      'tenant-1', '2026-07-01', '2026-07-31',
    ]);
  });

  it('counts one patient once while preserving several service units', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => sql.includes('dashboard_patient_age:summary')
        ? {
            results: [{
              bucket: '31_45',
              unique_patients: 1,
              visits: 1,
              admissions: 1,
              services: 6,
              bill_count: 2,
              collection: 900,
              repeat_patients: 0,
            }],
          }
        : null,
    });

    const response = await app.request(
      '/dashboard/patient-age-analytics?preset=custom&startDate=2026-07-01&endDate=2026-07-10',
    );
    const body = await response.json() as PatientAgeAnalyticsResponse;
    const row = body.rows.find((item) => item.bucket === '31_45');
    expect(row).toMatchObject({ uniquePatients: 1, visits: 1, admissions: 1, services: 6, billCount: 2 });
  });

  it('returns an empty stable response when no activity matches', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => sql.includes('dashboard_patient_age:summary') ? { results: [] } : null,
    });

    const response = await app.request(
      '/dashboard/patient-age-analytics?preset=custom&startDate=2026-07-01&endDate=2026-07-01',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as PatientAgeAnalyticsResponse;
    expect(body.rows).toHaveLength(7);
    expect(body.totals).toMatchObject({ uniquePatients: 0, visits: 0, admissions: 0, services: 0, collection: 0 });
    expect(body.warnings).toContain(collectionWarning);
    expect(body.warnings).not.toContain(unknownWarning);
  });

  it('rejects invalid and overlong periods before analytics queries', async () => {
    const invalid = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    expect((await invalid.app.request(
      '/dashboard/patient-age-analytics?preset=custom&startDate=2026-07-31&endDate=2026-07-01',
    )).status).toBe(400);
    expect((await invalid.app.request(
      '/dashboard/patient-age-analytics?preset=custom&startDate=2025-01-01&endDate=2026-07-31',
    )).status).toBe(400);
    expect(invalid.mockDB.queries.some((query) => query.sql.includes('dashboard_patient_age:summary'))).toBe(false);
  });

  it('never returns patient identity in aggregate JSON', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => sql.includes('dashboard_patient_age:summary')
        ? {
            results: [{
              bucket: '18_30',
              unique_patients: 1,
              visits: 1,
              admissions: 0,
              services: 1,
              bill_count: 1,
              collection: 100,
              repeat_patients: 0,
            }],
          }
        : null,
    });

    const response = await app.request(
      '/dashboard/patient-age-analytics?preset=custom&startDate=2026-07-01&endDate=2026-07-31',
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const forbidden of ['patientName', 'patientCode', 'phone', 'address', 'nationalId', 'clinical']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
