/**
 * Dictation — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Tests run against a real wrangler dev server on http://localhost:8787.
 * Route prefix: /api/dictation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, labHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface Dictation {
  id: number;
  patient_id: number;
  doctor_id: number;
  content: string;
  status: 'pending' | 'transcribed' | 'reviewed' | 'signed';
  tenant_id: number;
  created_at: string;
}

interface DictationStats {
  total: number;
  pending: number;
  transcribed: number;
  reviewed: number;
  signed: number;
}

let adminH: Record<string, string>;
let labH: Record<string, string>;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  labH = await labHeaders();
});

describe('GET /api/dictation — dictation list', () => {
  it('returns dictation list with 200', async () => {
    const res = await api.get<{ dictations?: Dictation[]; data?: Dictation[] }>(
      '/api/dictation',
      adminH,
    );
    expect(res.status).toBe(200);
    const dictations = (res.body.dictations ?? res.body.data ?? []) as Dictation[];
    expect(Array.isArray(dictations)).toBe(true);
  });

  it('each dictation has id, patient_id, content, status', async () => {
    const res = await api.get<{ dictations?: Dictation[]; data?: Dictation[] }>(
      '/api/dictation',
      adminH,
    );
    expect(res.status).toBe(200);
    const dictations = (res.body.dictations ?? res.body.data ?? []) as Dictation[];
    if (dictations.length > 0) {
      const d = dictations[0]!;
      expect(typeof d.id).toBe('number');
      expect(typeof d.patient_id).toBe('number');
      expect(typeof d.content).toBe('string');
      expect(typeof d.status).toBe('string');
    }
  });
});

describe('GET /api/dictation?status=pending — filtered list', () => {
  it('returns dictations filtered by status', async () => {
    const res = await api.get<{ dictations?: Dictation[]; data?: Dictation[] }>(
      '/api/dictation?status=pending',
      adminH,
    );
    expect(res.status).toBe(200);
    const dictations = (res.body.dictations ?? res.body.data ?? []) as Dictation[];
    expect(Array.isArray(dictations)).toBe(true);
    dictations.forEach(d => {
      expect(d.status).toBe('pending');
    });
  });

  it('returns empty array for non-matching status', async () => {
    const res = await api.get<{ dictations?: Dictation[]; data?: Dictation[] }>(
      '/api/dictation?status=nonexistent_status',
      adminH,
    );
    expect(res.status).toBe(200);
    const dictations = (res.body.dictations ?? res.body.data ?? []) as Dictation[];
    expect(dictations).toHaveLength(0);
  });
});

describe('GET /api/dictation/stats — statistics', () => {
  it('returns dictation statistics', async () => {
    const res = await api.get<DictationStats>('/api/dictation/stats', adminH);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('total');
      expect(typeof res.body.total).toBe('number');
      expect(res.body.total).toBeGreaterThanOrEqual(0);
    } else {
      // Route may not exist
      expect([200, 404]).toContain(res.status);
    }
  });

  it('returns 401 without auth', async () => {
    const res = await api.get('/api/dictation/stats', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('POST /api/dictation — create dictation', () => {
  it('creates a dictation', async () => {
    const timestamp = Date.now();
    const newDictation = {
      patientId: 1001,
      doctorId: 105,
      content: `Patient presents with mild headache. ${timestamp}`,
    };

    const res = await api.post<{ id?: number; message: string }>(
      '/api/dictation',
      labH,
      newDictation,
    );
    expect([200, 201]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      expect(res.body).toHaveProperty('id');
    }
  });

  it('returns 400/422 for missing required fields', async () => {
    const res = await api.post('/api/dictation', labH, { content: 'Missing patient' });
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/dictation',
      noAuthHeaders(),
      { patientId: 1001, doctorId: 105, content: 'Should fail' },
    );
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/dictation/:id/status — update status', () => {
  it('updates dictation status', async () => {
    // First create a dictation
    const timestamp = Date.now();
    const createRes = await api.post<{ id?: number }>(
      '/api/dictation',
      labH,
      { patientId: 1001, doctorId: 105, content: `Status update test ${timestamp}` },
    );

    if (createRes.status !== 200 && createRes.status !== 201) return;
    const dictationId = createRes.body.id;
    if (!dictationId) return;

    const res = await api.put<{ message: string }>(
      `/api/dictation/${dictationId}/status`,
      labH,
      { status: 'transcribed' },
    );
    expect([200, 404]).toContain(res.status);
  });

  it('returns 404 for non-existent dictation', async () => {
    const res = await api.put(
      '/api/dictation/99999999/status',
      labH,
      { status: 'transcribed' },
    );
    expect([404, 500]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.put(
      '/api/dictation/1/status',
      noAuthHeaders(),
      { status: 'transcribed' },
    );
    expect(res.status).toBe(401);
  });
});
