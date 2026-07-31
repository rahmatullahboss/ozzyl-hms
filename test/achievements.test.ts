import { describe, expect, test } from 'vitest';
import { sign } from 'hono/jwt';
import wellnessRoutes from '../src/routes/wellness';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const JWT_SECRET = 'test-secret-key-for-testing-only';

async function makePatientToken(patientId: number): Promise<string> {
  return sign({ userId: String(patientId), scope: 'global' }, JWT_SECRET);
}

function makeAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('GET /wellness/achievements', () => {
  test('returns achievements for authenticated patient', async () => {
    const mockDB = createMockDB({
      tables: {
        achievements: [
          { id: 1, patient_id: 1, achievement_key: 'first_checkin', earned_at: '2026-04-16T10:00:00' },
        ],
      },
    });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/achievements', { headers: makeAuthHeaders(token) });

    expect(res.status).toBe(200);
    const body = await res.json() as { earned: any[]; catalog: string[] };
    expect(body.earned.length).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.catalog)).toBe(true);
    expect(body.catalog.length).toBeGreaterThan(0);
  });

  test('requires authentication', async () => {
    const mockDB = createMockDB({ tables: {} });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const res = await jsonRequest(app, '/wellness/achievements');
    expect(res.status).toBe(401);
  });

  test('includes catalog of all available achievements', async () => {
    const mockDB = createMockDB({ tables: { achievements: [] } });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/achievements', { headers: makeAuthHeaders(token) });

    expect(res.status).toBe(200);
    const body = await res.json() as { catalog: string[] };
    expect(body.catalog).toContain('first_checkin');
    expect(body.catalog).toContain('7_day_streak');
    expect(body.catalog).toContain('30_day_streak');
    expect(body.catalog).toContain('perfect_day');
  });
});

describe('Achievement unlock on check-in', () => {
  test('unlocks first_checkin on first batch log', async () => {
    const mockDB = createMockDB({
      tables: {
        achievements: [],
        streaks: [],
      },
    });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/batch', {
      method: 'POST',
      body: { mood: 'good', water_glasses: 4 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { new_achievements?: string[] };
    expect(Array.isArray(body.new_achievements)).toBe(true);
  });
});
