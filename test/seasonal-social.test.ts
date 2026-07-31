import { describe, it, expect } from 'vitest';
import { sign } from 'hono/jwt';
import { getRamadanInfo } from '../src/lib/ramadan';
import { getSeasonalAlerts } from '../src/lib/seasonal-alerts';
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

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Task 14: Ramadan Mode (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getRamadanInfo', () => {
  it('detects date during Ramadan 2026', () => {
    const info = getRamadanInfo('2026-03-01');
    expect(info.isRamadan).toBe(true);
    expect(info.dayOfRamadan).toBeGreaterThan(0);
    expect(info.daysRemaining).toBeGreaterThan(0);
  });

  it('detects non-Ramadan date', () => {
    const info = getRamadanInfo('2026-06-15');
    expect(info.isRamadan).toBe(false);
  });

  it('provides sehri/iftar times during Ramadan', () => {
    const info = getRamadanInfo('2026-03-01');
    expect(info.sehriTime).toBeTruthy();
    expect(info.iftarTime).toBeTruthy();
    // Times should be in HH:MM format
    expect(info.sehriTime).toMatch(/^\d{2}:\d{2}$/);
    expect(info.iftarTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('calculates correct day of Ramadan', () => {
    // Ramadan 2026 starts ~Feb 18
    const info = getRamadanInfo('2026-02-18');
    expect(info.isRamadan).toBe(true);
    expect(info.dayOfRamadan).toBe(1);
  });

  it('handles date at end of Ramadan', () => {
    const info = getRamadanInfo('2026-03-19');
    expect(info.isRamadan).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Task 15: Seasonal Health Alerts (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getSeasonalAlerts', () => {
  it('returns dengue alerts during June-October', () => {
    const alerts = getSeasonalAlerts({ month: 7 });
    const dengue = alerts.find(a => a.type === 'dengue_season');
    expect(dengue).toBeTruthy();
    expect(dengue!.title_bn).toContain('ডেঙ্গু');
  });

  it('returns no dengue alerts in January', () => {
    const alerts = getSeasonalAlerts({ month: 1 });
    const dengue = alerts.find(a => a.type === 'dengue_season');
    expect(dengue).toBeUndefined();
  });

  it('returns monsoon tips during June-September', () => {
    const alerts = getSeasonalAlerts({ month: 8 });
    const monsoon = alerts.find(a => a.type === 'monsoon_health');
    expect(monsoon).toBeTruthy();
  });

  it('returns winter tips during Nov-Feb', () => {
    const alerts = getSeasonalAlerts({ month: 12 });
    const winter = alerts.find(a => a.type === 'winter_health');
    expect(winter).toBeTruthy();
  });

  it('returns heat tips during March-May', () => {
    const alerts = getSeasonalAlerts({ month: 4 });
    const heat = alerts.find(a => a.type === 'heat_health');
    expect(heat).toBeTruthy();
  });

  it('returns dengue warning when fever + body ache during season', () => {
    const alerts = getSeasonalAlerts({ month: 7, recentSymptoms: ['fever', 'body_ache'] });
    const warning = alerts.find(a => a.type === 'dengue_warning');
    expect(warning).toBeTruthy();
    expect(warning!.priority).toBeLessThanOrEqual(2); // High priority
  });

  it('no dengue warning without symptoms during season', () => {
    const alerts = getSeasonalAlerts({ month: 7, recentSymptoms: [] });
    const warning = alerts.find(a => a.type === 'dengue_warning');
    expect(warning).toBeUndefined();
  });

  it('all alerts have both bn and en text', () => {
    const alerts = getSeasonalAlerts({ month: 7, recentSymptoms: ['fever', 'body_ache'] });
    for (const alert of alerts) {
      expect(alert.title_bn).toBeTruthy();
      expect(alert.title_en).toBeTruthy();
      expect(alert.body_bn).toBeTruthy();
      expect(alert.body_en).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Task 16: Walking Challenges (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /wellness/challenges', () => {
  it('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await jsonRequest(app, '/wellness/challenges', {
      method: 'POST',
      body: { name: 'Test Challenge', type: 'steps', target: 70000, duration_days: 7 },
    });
    expect(res.status).toBe(401);
  });

  it('creates a new walking challenge', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/challenges', {
      method: 'POST',
      body: {
        name: 'সাপ্তাহিক হাঁটা চ্যালেঞ্জ',
        type: 'steps',
        target: 70000,
        duration_days: 7,
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.challenge_id).toBeDefined();
  });

  it('rejects invalid challenge type', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/challenges', {
      method: 'POST',
      body: { name: 'Bad', type: 'swimming', target: 100, duration_days: 7 },
      headers: makeAuthHeaders(token),
    });
    expect(res.status).toBe(400);
  });

  it('rejects duration over 90 days', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/challenges', {
      method: 'POST',
      body: { name: 'Too long', type: 'steps', target: 1000000, duration_days: 100 },
      headers: makeAuthHeaders(token),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /wellness/challenges/:id/join', () => {
  it('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await jsonRequest(app, '/wellness/challenges/1/join', {
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(401);
  });

  it('allows authenticated patient to join', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/challenges/1/join', {
      method: 'POST',
      body: {},
      headers: makeAuthHeaders(token),
    });
    expect(res.status).toBe(201);
  });
});

describe('GET /wellness/challenges', () => {
  it('returns challenges list for authenticated patient', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await app.request('/wellness/challenges', {
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.challenges).toBeDefined();
    expect(Array.isArray(body.challenges)).toBe(true);
  });
});
