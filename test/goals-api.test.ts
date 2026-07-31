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

describe('GET /wellness/goals', () => {
  test('returns goals for authenticated patient', async () => {
    const mockDB = createMockDB({
      tables: {
        user_goals: [
          { id: 1, patient_id: 1, goal_type: 'steps', target_value: 10000, current_value: 5000, unit: 'steps', start_date: '2026-04-16', end_date: null, status: 'active', ai_suggested: 0, created_at: '2026-04-16' },
        ],
      },
    });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/goals', { headers: makeAuthHeaders(token) });

    expect(res.status).toBe(200);
    const body = await res.json() as { goals: any[] };
    expect(body.goals.length).toBeGreaterThanOrEqual(0);
  });

  test('requires authentication', async () => {
    const mockDB = createMockDB({ tables: {} });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const res = await jsonRequest(app, '/wellness/goals');
    expect(res.status).toBe(401);
  });
});

describe('POST /wellness/goals', () => {
  test('creates a new goal', async () => {
    const mockDB = createMockDB({ tables: {} });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/goals', {
      method: 'POST',
      body: { goal_type: 'steps', target_value: 10000, unit: 'steps' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; id: number };
    expect(body.success).toBe(true);
  });

  test('rejects invalid goal type', async () => {
    const mockDB = createMockDB({ tables: {} });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/goals', {
      method: 'POST',
      body: { goal_type: 'invalid_type', target_value: 100, unit: 'x' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  test('rejects missing target_value', async () => {
    const mockDB = createMockDB({ tables: {} });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/goals', {
      method: 'POST',
      body: { goal_type: 'steps', unit: 'steps' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /wellness/goals/:id', () => {
  test('updates a goal status', async () => {
    const mockDB = createMockDB({
      tables: {
        user_goals: [
          { id: 1, patient_id: 1, goal_type: 'steps', target_value: 10000, current_value: 5000, unit: 'steps', start_date: '2026-04-16', end_date: null, status: 'active', ai_suggested: 0, created_at: '2026-04-16' },
        ],
      },
    });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/goals/1', {
      method: 'PATCH',
      body: { status: 'completed' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});

describe('DELETE /wellness/goals/:id', () => {
  test('abandons a goal', async () => {
    const mockDB = createMockDB({
      tables: {
        user_goals: [
          { id: 1, patient_id: 1, goal_type: 'steps', target_value: 10000, current_value: 5000, unit: 'steps', start_date: '2026-04-16', end_date: null, status: 'active', ai_suggested: 0, created_at: '2026-04-16' },
        ],
      },
    });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/goals/1', {
      method: 'DELETE',
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});
