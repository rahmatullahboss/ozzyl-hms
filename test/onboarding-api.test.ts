import { describe, expect, test } from 'vitest';
import { sign } from 'hono/jwt';
import patientAuthRoutes from '../src/routes/patient-auth';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const JWT_SECRET = 'test-secret-key-for-testing-only';

function findQuery(
  queries: Array<{ sql: string; params: unknown[]; method: string }>,
  pattern: string,
  method?: string,
) {
  return queries.find((q) =>
    q.sql.toLowerCase().includes(pattern.toLowerCase()) && (!method || q.method === method));
}

async function makePatientToken(patientId: number): Promise<string> {
  return sign({ userId: String(patientId), scope: 'global' }, JWT_SECRET);
}

const VALID_ONBOARDING = {
  language: 'bn',
  name: 'Rahim Uddin',
  gender: 'male',
  height_cm: 170,
  weight_kg: 72.5,
  goals: ['goalActive', 'goalEat'],
  skipHospital: false,
  permissions: { notifications: true, health: true, camera: true, biometric: true },
};

function createVerifiedOnboardingDB() {
  return createMockDB({
    universalFallback: true,
    queryOverride(sql) {
      if (sql.toLowerCase().includes('select auth_status from global_patient_auth')) {
        return { first: { auth_status: 'verified' }, success: true, meta: {} };
      }
      return null;
    },
  });
}

describe('POST /patient-auth/onboarding', () => {
  test('rejects unauthenticated requests', async () => {
    const mockDB = createVerifiedOnboardingDB();
    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const res = await jsonRequest(app, '/patient-auth/onboarding', {
      method: 'POST',
      body: VALID_ONBOARDING,
    });

    expect(res.status).toBe(401);
  });

  test('rejects invalid goal selections', async () => {
    const mockDB = createVerifiedOnboardingDB();
    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const res = await jsonRequest(app, '/patient-auth/onboarding', {
      method: 'POST',
      body: { ...VALID_ONBOARDING, goals: ['invalidGoal'] },
    });

    expect(res.status).toBe(400);
  });

  test('rejects more than 3 goals', async () => {
    const mockDB = createVerifiedOnboardingDB();
    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const res = await jsonRequest(app, '/patient-auth/onboarding', {
      method: 'POST',
      body: { ...VALID_ONBOARDING, goals: ['goalActive', 'goalEat', 'goalSleep', 'goalMind'] },
    });

    expect(res.status).toBe(400);
  });

  test('maps goals to active wellness modules', async () => {
    const mockDB = createVerifiedOnboardingDB();
    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/patient-auth/onboarding', {
      method: 'POST',
      body: VALID_ONBOARDING,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);

    const prefInsert = findQuery(mockDB.queries, 'wellness_preferences', 'run');
    expect(prefInsert).toBeTruthy();

    const params = JSON.stringify(prefInsert!.params);
    expect(params).toContain('activity');
    expect(params).toContain('nutrition');
  });

  test('adjusts daily goals based on selected goals', async () => {
    const mockDB = createVerifiedOnboardingDB();
    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/patient-auth/onboarding', {
      method: 'POST',
      body: { ...VALID_ONBOARDING, goals: ['goalActive'] },
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);

    const prefInsert = findQuery(mockDB.queries, 'wellness_preferences', 'run');
    expect(prefInsert).toBeTruthy();

    const params = JSON.stringify(prefInsert!.params);
    expect(params).toContain('8000');
  });

  test('sets onboarding_completed = 1 in wellness_profile', async () => {
    const mockDB = createVerifiedOnboardingDB();
    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/patient-auth/onboarding', {
      method: 'POST',
      body: VALID_ONBOARDING,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);

    const profileInsert = findQuery(mockDB.queries, 'wellness_profile', 'run');
    expect(profileInsert).toBeTruthy();
    expect(profileInsert!.params).toContain(1);
  });

  test('updates patient name if provided', async () => {
    const mockDB = createVerifiedOnboardingDB();
    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/patient-auth/onboarding', {
      method: 'POST',
      body: { ...VALID_ONBOARDING, name: 'Karim Rahman' },
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);

    const nameUpdate = findQuery(mockDB.queries, 'global_patient_auth', 'run');
    expect(nameUpdate).toBeTruthy();
  });

  test('returns success: true on valid submission', async () => {
    const mockDB = createVerifiedOnboardingDB();
    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/patient-auth/onboarding', {
      method: 'POST',
      body: VALID_ONBOARDING,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});
