import { describe, it, expect } from 'vitest';
import { sign } from 'hono/jwt';
import { scorePHQ9, scoreGAD7, classifySeverity } from '../src/lib/mental-health-scoring';
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
// Phase 3 — Task 7: PHQ-9 & GAD-7 Mental Health Screening (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 7.1 PHQ-9 Scoring (Depression) ────────────────────────────────────────

describe('scorePHQ9', () => {
  it('scores all zeros as 0 (none)', () => {
    const result = scorePHQ9([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.total).toBe(0);
    expect(result.severity).toBe('none');
  });

  it('scores minimal depression (1-4)', () => {
    const result = scorePHQ9([1, 0, 1, 0, 1, 0, 1, 0, 0]);
    expect(result.total).toBe(4);
    expect(result.severity).toBe('minimal');
  });

  it('scores mild depression (5-9)', () => {
    const result = scorePHQ9([1, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(result.total).toBe(8);
    expect(result.severity).toBe('mild');
  });

  it('scores moderate depression (10-14)', () => {
    const result = scorePHQ9([2, 1, 2, 1, 2, 1, 1, 1, 1]);
    expect(result.total).toBe(12);
    expect(result.severity).toBe('moderate');
  });

  it('scores moderately severe depression (15-19)', () => {
    const result = scorePHQ9([2, 2, 2, 2, 2, 2, 2, 2, 1]);
    expect(result.total).toBe(17);
    expect(result.severity).toBe('moderately_severe');
  });

  it('scores severe depression (20-27)', () => {
    const result = scorePHQ9([3, 3, 3, 3, 3, 3, 3, 3, 0]);
    expect(result.total).toBe(24);
    expect(result.severity).toBe('severe');
  });

  it('max score is 27', () => {
    const result = scorePHQ9([3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(result.total).toBe(27);
    expect(result.severity).toBe('severe');
  });

  it('flags question 9 (suicidal ideation) specially', () => {
    const result = scorePHQ9([0, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(result.suicidal_risk).toBe(true);
  });

  it('no suicidal risk when q9 is 0', () => {
    const result = scorePHQ9([3, 3, 3, 3, 3, 3, 3, 3, 0]);
    expect(result.suicidal_risk).toBe(false);
  });

  it('rejects wrong number of answers', () => {
    expect(() => scorePHQ9([1, 2, 3])).toThrow();
    expect(() => scorePHQ9([])).toThrow();
  });

  it('rejects values outside 0-3 range', () => {
    expect(() => scorePHQ9([0, 0, 0, 0, 0, 0, 0, 0, 4])).toThrow();
    expect(() => scorePHQ9([0, 0, 0, 0, 0, 0, 0, 0, -1])).toThrow();
  });
});

// ─── 7.2 GAD-7 Scoring (Anxiety) ──────────────────────────────────────────

describe('scoreGAD7', () => {
  it('scores all zeros as 0 (none)', () => {
    const result = scoreGAD7([0, 0, 0, 0, 0, 0, 0]);
    expect(result.total).toBe(0);
    expect(result.severity).toBe('none');
  });

  it('scores mild anxiety (5-9)', () => {
    const result = scoreGAD7([1, 1, 1, 1, 1, 1, 1]);
    expect(result.total).toBe(7);
    expect(result.severity).toBe('mild');
  });

  it('scores moderate anxiety (10-14)', () => {
    const result = scoreGAD7([2, 2, 2, 2, 2, 1, 1]);
    expect(result.total).toBe(12);
    expect(result.severity).toBe('moderate');
  });

  it('scores severe anxiety (15-21)', () => {
    const result = scoreGAD7([3, 3, 3, 3, 3, 2, 2]);
    expect(result.total).toBe(19);
    expect(result.severity).toBe('severe');
  });

  it('max score is 21', () => {
    const result = scoreGAD7([3, 3, 3, 3, 3, 3, 3]);
    expect(result.total).toBe(21);
    expect(result.severity).toBe('severe');
  });

  it('rejects wrong number of answers', () => {
    expect(() => scoreGAD7([1, 2])).toThrow();
  });

  it('rejects values outside 0-3 range', () => {
    expect(() => scoreGAD7([0, 0, 0, 0, 0, 0, 5])).toThrow();
  });
});

// ─── 7.3 Severity classifier ──────────────────────────────────────────────

describe('classifySeverity', () => {
  it('maps PHQ-9 thresholds correctly', () => {
    expect(classifySeverity('phq9', 0)).toBe('none');
    expect(classifySeverity('phq9', 4)).toBe('minimal');
    expect(classifySeverity('phq9', 5)).toBe('mild');
    expect(classifySeverity('phq9', 10)).toBe('moderate');
    expect(classifySeverity('phq9', 15)).toBe('moderately_severe');
    expect(classifySeverity('phq9', 20)).toBe('severe');
  });

  it('maps GAD-7 thresholds correctly', () => {
    expect(classifySeverity('gad7', 0)).toBe('none');
    expect(classifySeverity('gad7', 4)).toBe('minimal');
    expect(classifySeverity('gad7', 5)).toBe('mild');
    expect(classifySeverity('gad7', 10)).toBe('moderate');
    expect(classifySeverity('gad7', 15)).toBe('severe');
  });
});

// ─── 7.4 POST /wellness/screening — Route integration ────────────────────

describe('POST /wellness/screening', () => {
  it('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await jsonRequest(app, '/wellness/screening', {
      method: 'POST',
      body: { type: 'phq9', answers: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    });

    expect(res.status).toBe(401);
  });

  it('accepts valid PHQ-9 submission and returns score', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from mental_health_screenings') && sql.toLowerCase().includes('date(')) {
          return { first: null, results: [], success: true, meta: {} };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/screening', {
      method: 'POST',
      body: {
        type: 'phq9',
        answers: [1, 1, 2, 1, 0, 1, 1, 0, 0],
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.total).toBe(7);
    expect(body.severity).toBe('mild');
    expect(body.suicidal_risk).toBe(false);
  });

  it('accepts valid GAD-7 submission and returns score', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from mental_health_screenings') && sql.toLowerCase().includes('date(')) {
          return { first: null, results: [], success: true, meta: {} };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/screening', {
      method: 'POST',
      body: {
        type: 'gad7',
        answers: [2, 2, 2, 2, 2, 1, 1],
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.total).toBe(12);
    expect(body.severity).toBe('moderate');
  });

  it('rejects invalid screening type', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/screening', {
      method: 'POST',
      body: { type: 'invalid', answers: [0] },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  it('rejects wrong number of PHQ-9 answers', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from mental_health_screenings') && sql.toLowerCase().includes('date(')) {
          return { first: null, results: [], success: true, meta: {} };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/screening', {
      method: 'POST',
      body: { type: 'phq9', answers: [1, 2, 3] },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });
});

// ─── 7.5 GET /wellness/screenings — History ──────────────────────────────

describe('GET /wellness/screenings', () => {
  it('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await app.request('/wellness/screenings');
    expect(res.status).toBe(401);
  });

  it('returns screening history for authenticated patient', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await app.request('/wellness/screenings', {
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.screenings).toBeDefined();
    expect(Array.isArray(body.screenings)).toBe(true);
  });
});
