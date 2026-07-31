import { describe, expect, it } from 'vitest';
import {
  canDoctorAccessPatientLabResults,
  fetchDoctorLabInboxSummary,
  fetchDoctorLabResults,
  isAbnormalLabFlag,
  isCriticalLabFlag,
} from '../src/lib/doctor-lab-inbox';
import { createMockDB } from './integration/helpers/mock-db';

describe('doctor-lab-inbox helpers', () => {
  it('detects abnormal and critical flags', () => {
    expect(isAbnormalLabFlag('high')).toBe(true);
    expect(isAbnormalLabFlag('critical')).toBe(true);
    expect(isAbnormalLabFlag('normal')).toBe(false);
    expect(isCriticalLabFlag('critical_high')).toBe(true);
    expect(isCriticalLabFlag('high')).toBe(false);
  });

  it('excludes formally retracted results from doctor clinical summaries and inbox rows', async () => {
    const mock = createMockDB({
      queryOverride(sql) {
        if (sql.includes('SUM(CASE')) {
          return {
            first: { total_reports: 0, pending: 0, abnormal: 0, critical: 0, needs_review: 0 },
            success: true,
            meta: {},
          };
        }
        if (sql.includes('SELECT') && sql.includes('loi.id') && sql.includes('patient_name')) {
          return { results: [], success: true, meta: {} };
        }
        return null;
      },
    });

    await fetchDoctorLabInboxSummary(mock.db, 'tenant-1', 11, 'doctor-user');
    await fetchDoctorLabResults(mock.db, {
      tenantId: 'tenant-1',
      doctorId: 11,
      userId: 'doctor-user',
    });

    const clinicalQueries = mock.queries.filter(query => query.sql.includes('FROM lab_order_items loi'));
    expect(clinicalQueries).toHaveLength(2);
    for (const query of clinicalQueries) {
      expect(query.sql).toContain("COALESCE(loi.result_status, '') <> 'retracted'");
    }
  });

  it('checks patient lab result access against the linked doctor scope', async () => {
    const allowedDb = createMockDB({
      queryOverride(sql) {
        if (sql.toLowerCase().includes('select 1 as allowed')) {
          return { first: { allowed: 1 }, success: true, meta: {} };
        }
        return null;
      },
    });
    await expect(canDoctorAccessPatientLabResults(allowedDb.db, 'tenant-1', 7, 11, 'doctor-user')).resolves.toBe(true);

    const deniedDb = createMockDB({
      queryOverride(sql) {
        if (sql.toLowerCase().includes('select 1 as allowed')) {
          return { first: null, success: true, meta: {} };
        }
        return null;
      },
    });
    await expect(canDoctorAccessPatientLabResults(deniedDb.db, 'tenant-1', 8, 11, 'doctor-user')).resolves.toBe(false);
  });
});
