import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import { diagnosisRoutes } from '../src/routes/tenant/clinical/diagnosis';

describe('Diagnosis ICD-11 route integration', () => {
  it('hydrates canonical ICD-11 title from terminology catalog before insert', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql, params) => {
        if (sql.includes('FROM catalog_icd11_mms') && params[0] === 'BA00') {
          return {
            first: {
              id: 1,
              code: 'BA00',
              title: 'Essential hypertension',
              is_active: 1,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const { app } = createTestApp({
      route: diagnosisRoutes,
      routePath: '/diagnosis',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/diagnosis', {
      method: 'POST',
      body: {
        PatientId: 1,
        icd11_code: 'BA00',
        icd11_title: 'Wrong free text',
        DiagnosisType: 'primary',
      },
    });

    expect(res.status).toBe(201);
    const insertQuery = mockDB.queries.find((q) => q.method === 'run' && q.sql.includes('INSERT INTO ClinicalDiagnosis'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.params).toContain('BA00');
    expect(insertQuery?.params).toContain('Essential hypertension');
    expect(insertQuery?.params).toContain('clinician');
    expect(insertQuery?.params).not.toContain('Wrong free text');
  });

  it('rejects unknown ICD-11 code with 400', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('FROM catalog_icd11_mms')) {
          return { first: null };
        }
        return null;
      },
      universalFallback: true,
    });

    const { app } = createTestApp({
      route: diagnosisRoutes,
      routePath: '/diagnosis',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/diagnosis', {
      method: 'POST',
      body: {
        PatientId: 1,
        icd11_code: 'ZZ99',
        icd11_title: 'Unknown diagnosis',
        DiagnosisType: 'primary',
      },
    });

    expect(res.status).toBe(400);
  });
});
