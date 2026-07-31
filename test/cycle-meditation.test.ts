import { describe, it, expect } from 'vitest';
import { sign } from 'hono/jwt';
import { predictNextPeriod, calculateCycleStats } from '../src/lib/cycle-tracking';
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
// Phase 3 — Task 11: Cycle Tracking (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 11.1 Cycle prediction — Pure function tests ──────────────────────────

describe('predictNextPeriod', () => {
  it('predicts next period based on average cycle length', () => {
    const result = predictNextPeriod([
      { start_date: '2026-01-01', end_date: '2026-01-05' },
      { start_date: '2026-01-29', end_date: '2026-02-02' },
      { start_date: '2026-02-26', end_date: '2026-03-02' },
    ]);
    expect(result.predicted_start).toBeTruthy();
    expect(result.avg_cycle_length).toBeGreaterThan(25);
    expect(result.avg_cycle_length).toBeLessThan(35);
  });

  it('returns null prediction with fewer than 2 cycles', () => {
    const result = predictNextPeriod([
      { start_date: '2026-01-01', end_date: '2026-01-05' },
    ]);
    expect(result.predicted_start).toBeNull();
  });

  it('handles irregular cycles gracefully', () => {
    const result = predictNextPeriod([
      { start_date: '2026-01-01', end_date: '2026-01-05' },
      { start_date: '2026-02-10', end_date: '2026-02-14' }, // 40 days
      { start_date: '2026-03-05', end_date: '2026-03-09' },  // 23 days
    ]);
    expect(result.predicted_start).toBeTruthy();
    // Average should be ~31 days
    expect(result.avg_cycle_length).toBeGreaterThan(28);
    expect(result.avg_cycle_length).toBeLessThan(35);
  });

  it('returns empty for empty input', () => {
    const result = predictNextPeriod([]);
    expect(result.predicted_start).toBeNull();
    expect(result.avg_cycle_length).toBeNull();
  });
});

describe('calculateCycleStats', () => {
  it('calculates average length and variation', () => {
    const stats = calculateCycleStats([
      { start_date: '2026-01-01', end_date: '2026-01-05' },
      { start_date: '2026-01-29', end_date: '2026-02-02' },
      { start_date: '2026-02-26', end_date: '2026-03-02' },
    ]);
    expect(stats.avg_cycle_length).toBe(28);
    expect(stats.avg_period_length).toBe(4);
    expect(stats.total_cycles).toBe(2);
  });

  it('returns zero stats for insufficient data', () => {
    const stats = calculateCycleStats([]);
    expect(stats.total_cycles).toBe(0);
  });
});

// ─── 11.2 POST /wellness/cycle/log — Log period ──────────────────────────

describe('POST /wellness/cycle/log', () => {
  it('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await jsonRequest(app, '/wellness/cycle/log', {
      method: 'POST',
      body: { start_date: '2026-04-01' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts valid period log', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/cycle/log', {
      method: 'POST',
      body: {
        start_date: '2026-04-01',
        end_date: '2026-04-05',
        flow_intensity: 'medium',
        symptoms: ['cramps', 'fatigue'],
        notes: 'Mild cramps on day 2',
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('rejects invalid flow intensity', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/cycle/log', {
      method: 'POST',
      body: { start_date: '2026-04-01', flow_intensity: 'extreme' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });
});

// ─── 11.3 GET /wellness/cycle/history — Cycle history ─────────────────────

describe('GET /wellness/cycle/history', () => {
  it('returns cycle history for authenticated patient', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await app.request('/wellness/cycle/history', {
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.cycles).toBeDefined();
    expect(Array.isArray(body.cycles)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Task 9: Meditation Timer — Session Logging (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /wellness/meditation/log', () => {
  it('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await jsonRequest(app, '/wellness/meditation/log', {
      method: 'POST',
      body: { duration_min: 10 },
    });
    expect(res.status).toBe(401);
  });

  it('accepts valid meditation session', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/meditation/log', {
      method: 'POST',
      body: {
        duration_min: 15,
        type: 'guided',
        mood_before: 'okay',
        mood_after: 'good',
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('rejects invalid duration (0 or negative)', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/meditation/log', {
      method: 'POST',
      body: { duration_min: 0 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  it('rejects duration over 120 minutes', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/meditation/log', {
      method: 'POST',
      body: { duration_min: 200 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });
});
