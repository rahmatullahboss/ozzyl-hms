import { describe, expect, test } from 'vitest';
import { sign } from 'hono/jwt';
import wellnessRoutes from '../src/routes/wellness';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const JWT_SECRET = 'test-secret-key-for-testing-only';

async function makePatientToken(patientId: number): Promise<string> {
  return sign({ userId: String(patientId), scope: 'global', role: 'patient' }, JWT_SECRET);
}

function makeAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('Wellness Trends API (TDD)', () => {
  test('GET /wellness/trends returns time-series data', async () => {
    const mockDB = createMockDB({ universalFallback: true });

    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    
    const res = await jsonRequest(app, '/wellness/trends?days=7', {
      method: 'GET',
      headers: makeAuthHeaders(token),
    });

    // Should return 200 once implemented (currently returns 404 because route doesn't exist)
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('trends');
    expect(Array.isArray(body.trends)).toBe(true);
  });
});
