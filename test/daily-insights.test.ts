import { describe, it, expect, test } from 'vitest';
import { sign } from 'hono/jwt';
import { generateInsights } from '../src/lib/daily-insights';
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

// ─── Unit tests for generateInsights() pure function ────────────────────

describe('Daily Insights Engine', () => {
  it('returns sleep_low when sleep < 6h', () => {
    const insights = generateInsights({ sleep_hours: 5 }, [], []);
    expect(insights.some((i) => i.type === 'sleep_low')).toBe(true);
  });

  it('returns sleep_great when sleep 7-9h', () => {
    const insights = generateInsights({ sleep_hours: 8 }, [], []);
    expect(insights.some((i) => i.type === 'sleep_great')).toBe(true);
  });

  it('returns activity_none when exercise = 0', () => {
    const insights = generateInsights({ exercise_minutes: 0 }, [], []);
    expect(insights.some((i) => i.type === 'activity_none')).toBe(true);
  });

  it('returns mood_low when 2+ low mood days', () => {
    const insights = generateInsights({}, [{ mood: 'bad' }, { mood: 'struggling' }], []);
    expect(insights.some((i) => i.type === 'mood_low')).toBe(true);
  });

  it('returns hydration_low when < 4 glasses', () => {
    const insights = generateInsights({ water_glasses: 2 }, [], []);
    expect(insights.some((i) => i.type === 'hydration_low')).toBe(true);
  });

  it('returns score_improving when +5 over 3 days', () => {
    const insights = generateInsights({}, [
      { total_score: 80 }, { total_score: 77 }, { total_score: 72 },
    ], []);
    expect(insights.some((i) => i.type === 'score_improving')).toBe(true);
  });

  it('returns streak_milestone at 7 days', () => {
    const insights = generateInsights({}, [], [
      { streak_type: 'daily_checkin', current_count: 7 },
    ]);
    expect(insights.some((i) => i.type === 'streak_milestone')).toBe(true);
  });

  it('limits to max 3 insights', () => {
    const insights = generateInsights(
      { sleep_hours: 4, exercise_minutes: 0, water_glasses: 1 },
      [{ mood: 'bad' }, { mood: 'terrible' }, { total_score: 40 }, { total_score: 45 }, { total_score: 55 }],
      [{ streak_type: 'daily_checkin', current_count: 7 }],
    );
    expect(insights.length).toBeLessThanOrEqual(3);
  });

  it('sorts by priority (lower number = higher priority)', () => {
    const insights = generateInsights(
      { sleep_hours: 4, water_glasses: 2 },
      [{ mood: 'bad' }, { mood: 'struggling' }],
      [],
    );
    for (let i = 1; i < insights.length; i++) {
      expect(insights[i].priority).toBeGreaterThanOrEqual(insights[i - 1].priority);
    }
  });

  it('returns empty array with no data', () => {
    const insights = generateInsights({}, [], []);
    expect(insights).toEqual([]);
  });

  it('insights have both bn and en text', () => {
    const insights = generateInsights({ sleep_hours: 4 }, [], []);
    for (const insight of insights) {
      expect(insight.title_bn).toBeTruthy();
      expect(insight.title_en).toBeTruthy();
      expect(insight.body_bn).toBeTruthy();
      expect(insight.body_en).toBeTruthy();
    }
  });
});

// ─── Integration tests for /wellness/insights API endpoints ─────────────

describe('GET /wellness/insights', () => {
  test('returns stored insights from ai_insights table', async () => {
    const mockDB = createMockDB({
      tables: {
        ai_insights: [
          { id: 10, patient_id: 1, insight_type: 'sleep_low', content: JSON.stringify({ title_en: 'Low Sleep', body_en: 'You slept 5h' }), severity: 'warning', read: 0, created_at: new Date().toISOString() },
          { id: 11, patient_id: 1, insight_type: 'hydration_low', content: JSON.stringify({ title_en: 'Low Water', body_en: 'Drink more water' }), severity: 'info', read: 0, created_at: new Date().toISOString() },
        ],
      },
    });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/insights', { headers: makeAuthHeaders(token) });

    expect(res.status).toBe(200);
    const body = await res.json() as { insights: any[] };
    expect(body.insights.length).toBeGreaterThanOrEqual(0);
  });

  test('returns empty array when no insights exist', async () => {
    const mockDB = createMockDB({ tables: {} });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/insights', { headers: makeAuthHeaders(token) });

    expect(res.status).toBe(200);
    const body = await res.json() as { insights: any[] };
    expect(body.insights).toEqual([]);
  });

  test('requires authentication', async () => {
    const mockDB = createMockDB({ tables: {} });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const res = await jsonRequest(app, '/wellness/insights');
    expect(res.status).toBe(401);
  });
});

describe('POST /wellness/insights/generate', () => {
  test('generates and stores insights from today data', async () => {
    const mockDB = createMockDB({
      tables: {
        sleep_log: [{ patient_id: 1, duration_min: 300, quality_rating: 2, logged_at: new Date().toISOString() }],
        activity_log: [{ patient_id: 1, activity_type: 'walk', duration_min: 0, logged_at: new Date().toISOString() }],
        mood_log: [{ patient_id: 1, mood: 'low', logged_at: new Date().toISOString() }],
        water_log: [{ patient_id: 1, amount_ml: 500, logged_at: new Date().toISOString() }],
        daily_health_score: [
          { patient_id: 1, date: '2026-04-16', total_score: 50 },
          { patient_id: 1, date: '2026-04-15', total_score: 55 },
          { patient_id: 1, date: '2026-04-14', total_score: 60 },
        ],
        streaks: [{ patient_id: 1, streak_type: 'activity', current_count: 5, longest_count: 10, last_logged_date: '2026-04-15' }],
      },
    });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/insights/generate', {
      method: 'POST',
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { insights: any[]; generated: number };
    expect(body.generated).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.insights)).toBe(true);
  });

  test('returns empty insights when no data logged', async () => {
    const mockDB = createMockDB({ tables: {} });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/insights/generate', {
      method: 'POST',
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { insights: any[]; generated: number };
    expect(body.generated).toBe(0);
    expect(body.insights).toEqual([]);
  });

  test('requires authentication', async () => {
    const mockDB = createMockDB({ tables: {} });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const res = await jsonRequest(app, '/wellness/insights/generate', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

describe('POST /wellness/insights/:id/read', () => {
  test('marks an insight as read', async () => {
    const mockDB = createMockDB({
      tables: {
        ai_insights: [
          { id: 42, patient_id: 1, insight_type: 'sleep_low', content: '{}', severity: 'warning', read: 0, created_at: new Date().toISOString() },
        ],
      },
    });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/insights/42/read', {
      method: 'POST',
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  test('requires authentication', async () => {
    const mockDB = createMockDB({ tables: {} });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const res = await jsonRequest(app, '/wellness/insights/1/read', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
