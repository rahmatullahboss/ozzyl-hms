import { describe, expect, it } from 'vitest';
import deathRecordRoutes from '../../../src/routes/tenant/deathRecords';
import { createMockDB } from '../helpers/mock-db';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT = 'tenant-1';
const deathPayload = {
  admission_id: 10,
  patient_id: 1,
  date_of_death: '2026-05-10',
  time_of_death: '10:15',
  cause_of_death: 'Cardiac arrest',
};

describe('Death Records billing discharge guards', () => {
  it('records death and discharges admission only after billing checks pass', async () => {
    const { app, mockDB } = createTestApp({
      route: deathRecordRoutes,
      routePath: '/death-records',
      role: 'doctor',
      tenantId: TENANT,
      tables: {
        admissions: [{ id: 10, tenant_id: TENANT, patient_id: 1, bed_id: 4, status: 'admitted', admission_date: '2026-05-01' }],
        death_details: [],
        accounting_period_closes: [],
        billing_provisional_items: [],
        visit_services: [],
        bills: [],
      },
    });

    const res = await jsonRequest(app, '/death-records', { method: 'POST', body: deathPayload });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO death_details'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes("update admissions set status = 'discharged'"))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update patient_bed_infos'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update beds set status'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO audit_logs'))).toBe(true);
  });

  it('blocks death discharge when provisional billing is still pending', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM admissions')) {
          return { first: { id: 10, bed_id: 4, patient_id: 1, admission_date: '2026-05-01', status: 'admitted' } };
        }
        if (sql.includes('FROM death_details')) {
          return { first: null };
        }
        if (sql.includes('FROM accounting_period_closes')) {
          return { first: null };
        }
        if (sql.includes('FROM billing_provisional_items')) {
          return { first: { amount: 500 } };
        }
        if (sql.includes('FROM visit_services') || sql.includes('FROM bills')) {
          return { first: { amount: 0 } };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: deathRecordRoutes,
      routePath: '/death-records',
      role: 'doctor',
      tenantId: TENANT,
      mockDB,
    });

    const res = await jsonRequest(app, '/death-records', { method: 'POST', body: deathPayload });

    expect(res.status).toBe(400);
    expect(db.queries.some((q) => q.sql.includes('INSERT INTO death_details'))).toBe(false);
    expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions'))).toBe(false);
  });

  it('blocks death discharge in a closed accounting period before inserting the death record', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM admissions')) {
          return { first: { id: 10, bed_id: 4, patient_id: 1, admission_date: '2026-05-01', status: 'admitted' } };
        }
        if (sql.includes('FROM death_details')) {
          return { first: null };
        }
        if (sql.includes('FROM accounting_period_closes')) {
          return { first: { status: 'audited' } };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: deathRecordRoutes,
      routePath: '/death-records',
      role: 'doctor',
      tenantId: TENANT,
      mockDB,
    });

    const res = await jsonRequest(app, '/death-records', { method: 'POST', body: deathPayload });

    expect(res.status).toBe(409);
    expect(db.queries.some((q) => q.sql.includes('INSERT INTO death_details'))).toBe(false);
    expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions'))).toBe(false);
  });

  it('rejects patient mismatch before death discharge', async () => {
    const { app } = createTestApp({
      route: deathRecordRoutes,
      routePath: '/death-records',
      role: 'doctor',
      tenantId: TENANT,
      tables: {
        admissions: [{ id: 10, tenant_id: TENANT, patient_id: 99, bed_id: 4, status: 'admitted', admission_date: '2026-05-01' }],
        death_details: [],
      },
    });

    const res = await jsonRequest(app, '/death-records', { method: 'POST', body: deathPayload });

    expect(res.status).toBe(400);
  });
});
