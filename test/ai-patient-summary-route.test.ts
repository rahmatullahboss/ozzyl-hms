import { afterEach, describe, expect, it, vi } from 'vitest';
import aiRoutes from '../src/routes/tenant/ai';
import { createTestApp } from './integration/helpers/test-app';

const patient = {
  id: 7,
  name: 'Sensitive Patient Name',
  patient_code: 'PID-SECRET-7',
  date_of_birth: '1990-03-04',
  gender: 'Female',
};

function makeApp(role = 'doctor') {
  return createTestApp({
    route: aiRoutes,
    routePath: '/ai',
    role,
    extraEnv: {
      OPENROUTER_API_KEY: 'test-openrouter-key',
      AI_MODEL: 'test/clinical-summary-model',
    },
    queryOverride(sql) {
      if (sql.includes('FROM tenants')) {
        return { first: { addons: '["ai-summary"]', ai_enabled: 1 } };
      }
      if (sql.includes('FROM ai_patient_summaries')) return { first: null };
      if (sql.includes('FROM patients')) return { first: patient };
      if (sql.includes('FROM allergies')) {
        return { results: [{ allergen: 'Penicillin', reaction: 'Rash', severity: 'high' }] };
      }
      if (sql.includes('FROM vitals')) {
        return { results: [{ bp_systolic: 120, bp_diastolic: 80, heart_rate: 72 }] };
      }
      if (sql.includes('FROM prescriptions')) {
        return { results: [{ drug_name: 'Medication A', status: 'active' }] };
      }
      if (sql.includes('FROM lab_results')) {
        return { results: [{ test_name: 'CBC', flag: 'high', result: '11' }] };
      }
      return null;
    },
  });
}

function successfulAIResponse(summary = '• Generated clinical overview') {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ summary }) } }],
    model: 'test/clinical-summary-model',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AI patient summary route', () => {
  it('rejects partially numeric and non-positive patient identifiers', async () => {
    const { app } = makeApp('doctor');

    expect((await app.request('/ai/patient-summary/7abc')).status).toBe(400);
    expect((await app.request('/ai/patient-summary/0')).status).toBe(400);
  });

  it('rejects a non-clinical reception role before reading patient data', async () => {
    const { app, mockDB } = makeApp('reception');

    const response = await app.request('/ai/patient-summary/7');

    expect(response.status).toBe(403);
    expect(mockDB.queries.some((query) => query.sql.includes('FROM patients'))).toBe(false);
  });

  it('generates and caches a summary for an allowed clinical role without sending identifiers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
    const fetchMock = vi.fn(async () => successfulAIResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { app, mockDB } = makeApp('doctor');

    const response = await app.request('/ai/patient-summary/7');
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      summary: '• Generated clinical overview',
      cached: false,
      fallback: false,
      model: 'test/clinical-summary-model',
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const externalBody = String(request.body);
    expect(externalBody).not.toContain(patient.name);
    expect(externalBody).not.toContain(patient.patient_code);
    expect(externalBody).not.toContain(patient.date_of_birth);
    expect(externalBody).toContain('Age: 36');

    const insert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO ai_patient_summaries'));
    expect(insert?.params).toEqual([
      'tenant-1',
      7,
      '• Generated clinical overview',
      'test/clinical-summary-model',
    ]);
  });

  it('returns 404 for a patient outside the tenant instead of generating a summary', async () => {
    const fetchMock = vi.fn(async () => successfulAIResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { app } = createTestApp({
      route: aiRoutes,
      routePath: '/ai',
      role: 'doctor',
      extraEnv: { OPENROUTER_API_KEY: 'test-key' },
      queryOverride(sql) {
        if (sql.includes('FROM tenants')) return { first: { addons: '["ai-summary"]', ai_enabled: 1 } };
        if (sql.includes('FROM ai_patient_summaries')) return { first: null };
        if (sql.includes('FROM patients')) return { first: null };
        return { results: [] };
      },
    });

    const response = await app.request('/ai/patient-summary/7');

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the same model and fallback metadata for a cached generated summary', async () => {
    const { app } = createTestApp({
      route: aiRoutes,
      routePath: '/ai',
      role: 'doctor',
      extraEnv: { OPENROUTER_API_KEY: 'test-key' },
      queryOverride(sql) {
        if (sql.includes('FROM tenants')) return { first: { addons: '["ai-summary"]', ai_enabled: 1 } };
        if (sql.includes('FROM ai_patient_summaries')) {
          return {
            first: {
              summary: '• Cached generated overview',
              generated_at: '2026-06-21T10:00:00Z',
              model_used: 'test/cached-model',
            },
          };
        }
        return null;
      },
    });

    const response = await app.request('/ai/patient-summary/7');
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      summary: '• Cached generated overview',
      cached: true,
      fallback: false,
      model: 'test/cached-model',
    });
  });

  it('does not cache a deterministic fallback when the external model fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream unavailable', { status: 503 })));
    const { app, mockDB } = makeApp('nurse');

    const response = await app.request('/ai/patient-summary/7');
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ cached: false, fallback: true, model: null });
    expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO ai_patient_summaries'))).toBe(false);
  });
});
