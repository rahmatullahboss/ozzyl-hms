import { describe, it, expect } from 'vitest';
import psychiatryRoutes from '../src/routes/tenant/psychiatry';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

function buildApp(tables: Record<string, unknown[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  return createTestApp({
    route: psychiatryRoutes,
    routePath: '/psychiatry',
    role: 'doctor',
    tenantId: 'tenant-1',
    userId: 10,
    mockDB,
  });
}

const validMSE = {
  PatientId: 1,
  Appearance: 'Well-groomed',
  Behavior: 'Cooperative',
  Mood: 'Euthymic',
  Affect: 'Congruent',
  ThoughtProcess: 'Linear',
  SuicideRisk: 'low',
  ViolenceRisk: 'low',
};

const validSuicideRisk = {
  PatientId: 1,
  OverallRisk: 'low',
  RiskLevel: 2,
  Disposition: 'routine-followup',
};

const validTherapyNote = {
  PatientId: 1,
  SessionDate: '2025-06-01',
  SessionType: 'individual',
  Duration: 50,
  PatientEngagement: 'good',
  ProgressTowardsGoals: 'moderate',
  SessionSuicideRisk: 'low',
};

// ═══════════════════════════════════════════════════════════════════════════════
// MENTAL STATUS EXAMINATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Psychiatry – Mental Status Examination', () => {
  it('GET /mse/:patientId returns list', async () => {
    const { app } = buildApp();
    const res = await app.request('/psychiatry/mse/1');
    expect(res.status).toBe(200);
    const body = await res.json() as { Results: unknown[] };
    expect(body).toHaveProperty('Results');
    expect(Array.isArray(body.Results)).toBe(true);
  });

  it('POST /mse creates MSE with valid data', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/mse', {
      method: 'POST',
      body: validMSE,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { Results: { id: number } };
    expect(body.Results).toHaveProperty('id');
  });

  it('POST /mse with invalid suicide_risk → 400', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/mse', {
      method: 'POST',
      body: { ...validMSE, SuicideRisk: 'invalid' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /mse with invalid violence_risk → 400', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/mse', {
      method: 'POST',
      body: { ...validMSE, ViolenceRisk: 'invalid' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /mse with missing required fields → 400', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/mse', {
      method: 'POST',
      body: { Appearance: 'test' },
    });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUICIDE RISK ASSESSMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Psychiatry – Suicide Risk Assessment', () => {
  it('GET /suicide-risk/:patientId returns list', async () => {
    const { app } = buildApp();
    const res = await app.request('/psychiatry/suicide-risk/1');
    expect(res.status).toBe(200);
    const body = await res.json() as { Results: unknown[] };
    expect(body).toHaveProperty('Results');
    expect(Array.isArray(body.Results)).toBe(true);
  });

  it('POST /suicide-risk creates assessment', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/suicide-risk', {
      method: 'POST',
      body: validSuicideRisk,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { Results: { id: number } };
    expect(body.Results).toHaveProperty('id');
  });

  it('POST /suicide-risk with invalid OverallRisk → 400', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/suicide-risk', {
      method: 'POST',
      body: { ...validSuicideRisk, OverallRisk: 'invalid' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /suicide-risk with invalid Disposition → 400', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/suicide-risk', {
      method: 'POST',
      body: { ...validSuicideRisk, Disposition: 'invalid' },
    });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// THERAPY SESSION NOTES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Psychiatry – Therapy Session Notes', () => {
  it('GET /therapy-notes/:patientId returns list', async () => {
    const { app } = buildApp();
    const res = await app.request('/psychiatry/therapy-notes/1');
    expect(res.status).toBe(200);
    const body = await res.json() as { Results: unknown[] };
    expect(body).toHaveProperty('Results');
    expect(Array.isArray(body.Results)).toBe(true);
  });

  it('POST /therapy-notes creates note', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/therapy-notes', {
      method: 'POST',
      body: validTherapyNote,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { Results: { id: number } };
    expect(body.Results).toHaveProperty('id');
  });

  it('POST /therapy-notes with invalid SessionType → 400', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/therapy-notes', {
      method: 'POST',
      body: { ...validTherapyNote, SessionType: 'invalid' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /therapy-notes with invalid PatientEngagement → 400', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/therapy-notes', {
      method: 'POST',
      body: { ...validTherapyNote, PatientEngagement: 'invalid' },
    });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ASSESSMENT TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Psychiatry – Assessment Tools', () => {
  it('GET /assessment-tools returns 404 (not yet implemented)', async () => {
    const { app } = buildApp();
    const res = await app.request('/psychiatry/assessment-tools');
    expect(res.status).toBe(404);
  });

  it('POST /assessment-tools/:toolId/score returns 404 (not yet implemented)', async () => {
    const { app } = buildApp();
    const res = await jsonRequest(app, '/psychiatry/assessment-tools/1/score', {
      method: 'POST',
      body: { PatientId: 1, Responses: [{ item: 1, score: 2 }] },
    });
    expect(res.status).toBe(404);
  });
});
