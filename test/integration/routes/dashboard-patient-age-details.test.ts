import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type DetailResponse = {
  period: { startDate: string; endDate: string };
  ageBucket: string;
  view: string;
  rows: Array<Record<string, unknown>>;
  totals: { uniquePatients: number; visits: number; services: number; collection: number };
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
  reconciliation: Record<string, { status: string; summaryTotal: number; detailTotal: number }>;
};

const summaryRows = [{
  bucket: '18_30',
  unique_patients: 3,
  visits: 4,
  admissions: 1,
  services: 6,
  bill_count: 2,
  collection: 1200,
  repeat_patients: 1,
}];

function createDetailsApp(detailMarker: string, detailRows: Array<Record<string, unknown>>) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const testApp = createTestApp({
    route: dashboardRoutes,
    routePath: '/dashboard',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    queryOverride: (sql, params) => {
      if (sql.includes('dashboard_patient_age:summary')) return { results: summaryRows };
      if (sql.includes(detailMarker)) {
        queries.push({ sql, params });
        return { results: detailRows };
      }
      return null;
    },
  });
  return { ...testApp, queries };
}

describe('dashboard patient age aggregate drilldowns', () => {
  it('returns service name, category, quantity, unique patients, and collection', async () => {
    const { app, queries } = createDetailsApp('dashboard_patient_age:details:services', [{
      row_id: 'service:lab:cbc',
      row_name: 'CBC',
      category: 'Lab',
      unique_patients: 2,
      visits: 0,
      services: 4,
      collection: 800,
      total_rows: 2,
      overall_unique_patients: 3,
      overall_visits: 0,
      overall_services: 6,
      overall_collection: 1200,
    }]);

    const response = await app.request(
      '/dashboard/patient-age-analytics/details?ageBucket=18_30&view=services&preset=custom&startDate=2026-07-01&endDate=2026-07-31&page=1&pageSize=25&sortBy=collection&sortDirection=desc',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as DetailResponse;
    expect(body).toMatchObject({
      ageBucket: '18_30',
      view: 'services',
      page: 1,
      pageSize: 25,
      totalRows: 2,
      hasNextPage: false,
      totals: { uniquePatients: 3, visits: 0, services: 6, collection: 1200 },
    });
    expect(body.rows[0]).toMatchObject({
      id: 'service:lab:cbc',
      name: 'CBC',
      category: 'Lab',
      uniquePatients: 2,
      visits: 0,
      services: 4,
      quantity: 4,
      collection: 800,
    });
    expect(body.reconciliation.services).toMatchObject({ status: 'reconciled', summaryTotal: 6, detailTotal: 6 });
    expect(body.reconciliation.collection).toMatchObject({ status: 'reconciled', summaryTotal: 1200, detailTotal: 1200 });

    expect(queries).toHaveLength(1);
    const lower = queries[0].sql.toLowerCase();
    expect(lower).toContain('/* dashboard_patient_age:details:services */');
    expect(lower).toContain('invoice_items');
    expect(lower).toContain('ii.tenant_id = eb.tenant_id');
    expect(lower).toContain('d.tenant_id = ii.tenant_id');
    expect(lower).toContain('sd.tenant_id = ii.tenant_id');
    expect(lower).toContain('service_department_id');
    expect(lower).toContain('age_at_service');
    expect(lower).not.toContain('patient_name');
    expect(queries[0].params.slice(-2)).toEqual([25, 0]);
  });

  it('returns stable doctor identifiers with visits, services, and collection', async () => {
    const { app } = createDetailsApp('dashboard_patient_age:details:doctors', [{
      row_id: 17,
      row_name: 'Dr. A',
      category: 'Doctor',
      unique_patients: 3,
      visits: 4,
      services: 6,
      collection: 1200,
      total_rows: 1,
      overall_unique_patients: 3,
      overall_visits: 4,
      overall_services: 6,
      overall_collection: 1200,
    }]);

    const response = await app.request(
      '/dashboard/patient-age-analytics/details?ageBucket=18_30&view=doctors&preset=custom&startDate=2026-07-01&endDate=2026-07-31',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as DetailResponse;
    expect(body.rows[0]).toMatchObject({
      id: 17,
      name: 'Dr. A',
      uniquePatients: 3,
      visits: 4,
      services: 6,
      collection: 1200,
    });
    expect(body.reconciliation.visits).toMatchObject({ status: 'reconciled', summaryTotal: 4, detailTotal: 4 });
    expect(body.reconciliation.services).toMatchObject({ status: 'reconciled', summaryTotal: 6, detailTotal: 6 });
  });

  it('returns stable department identifiers with visits, services, and collection', async () => {
    const { app } = createDetailsApp('dashboard_patient_age:details:departments', [{
      row_id: 4,
      row_name: 'Laboratory',
      category: 'Department',
      unique_patients: 3,
      visits: 4,
      services: 6,
      collection: 1200,
      total_rows: 1,
      overall_unique_patients: 3,
      overall_visits: 4,
      overall_services: 6,
      overall_collection: 1200,
    }]);

    const response = await app.request(
      '/dashboard/patient-age-analytics/details?ageBucket=18_30&view=departments&preset=custom&startDate=2026-07-01&endDate=2026-07-31',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as DetailResponse;
    expect(body.rows[0]).toMatchObject({ id: 4, name: 'Laboratory', category: 'Department' });
    expect(body.totals).toEqual({ uniquePatients: 3, visits: 4, services: 6, collection: 1200 });
  });

  it('uses age at each service date and applies safe pagination and sorting allowlists', async () => {
    const { app, queries } = createDetailsApp('dashboard_patient_age:details:doctors', [{
      row_id: null,
      row_name: 'Unassigned doctor',
      category: 'Doctor',
      unique_patients: 1,
      visits: 0,
      services: 1,
      collection: 100,
      total_rows: 40,
      overall_unique_patients: 3,
      overall_visits: 4,
      overall_services: 6,
      overall_collection: 1200,
    }]);

    const response = await app.request(
      '/dashboard/patient-age-analytics/details?ageBucket=18_30&view=doctors&preset=custom&startDate=2026-07-01&endDate=2026-07-31&page=2&pageSize=25&sortBy=name&sortDirection=asc',
    );
    const body = await response.json() as DetailResponse;
    expect(body).toMatchObject({ page: 2, pageSize: 25, totalRows: 40, hasNextPage: false });
    expect(body.rows[0]).toMatchObject({ id: null, name: 'Unassigned doctor' });
    expect(queries[0].sql).toContain('ORDER BY row_name ASC');
    expect(queries[0].sql).toContain("strftime('%Y', service_date)");
    expect(queries[0].params.slice(-2)).toEqual([25, 25]);
  });

  it('rejects invalid bucket, view, sort, and pagination before detail queries', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });
    const base = '/dashboard/patient-age-analytics/details?preset=custom&startDate=2026-07-01&endDate=2026-07-31';
    expect((await app.request(`${base}&ageBucket=adult&view=services`)).status).toBe(400);
    expect((await app.request(`${base}&ageBucket=18_30&view=unknown`)).status).toBe(400);
    expect((await app.request(`${base}&ageBucket=18_30&view=services&sortBy=patientName`)).status).toBe(400);
    expect((await app.request(`${base}&ageBucket=18_30&view=services&page=0`)).status).toBe(400);
    expect((await app.request(`${base}&ageBucket=18_30&view=services&pageSize=101`)).status).toBe(400);
    expect(mockDB.queries.some((query) => query.sql.includes('dashboard_patient_age:details:'))).toBe(false);
  });

  it('keeps all aggregate detail JSON free of patient identity', async () => {
    const { app } = createDetailsApp('dashboard_patient_age:details:services', [{
      row_id: 'service:other',
      row_name: 'Service',
      category: 'Other',
      unique_patients: 1,
      visits: 0,
      services: 1,
      collection: 100,
      total_rows: 1,
      overall_unique_patients: 1,
      overall_visits: 0,
      overall_services: 1,
      overall_collection: 100,
    }]);
    const response = await app.request(
      '/dashboard/patient-age-analytics/details?ageBucket=18_30&view=services&preset=custom&startDate=2026-07-01&endDate=2026-07-31',
    );
    const text = await response.text();
    for (const forbidden of ['patientName', 'patientCode', 'phone', 'address', 'nationalId', 'dateOfBirth']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
