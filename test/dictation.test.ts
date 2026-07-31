import { describe, it, expect } from 'vitest';
import dictationRoutes from '../src/routes/tenant/dictation';
import { createTestApp } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

function makeDictationApp(overrides?: Parameters<typeof createMockDB>[0]) {
  const mockDB = createMockDB({
    universalFallback: true,
    ...overrides,
  });

  return createTestApp({
    route: dictationRoutes,
    routePath: '/dictation',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    userId: 1,
    mockDB,
  });
}

const validCreateBody = {
  PatientId: 1,
  EncounterId: 1,
  DictationText: 'Patient presents with chest pain',
  AdditionalNotes: 'Follow-up required',
  Priority: 'normal' as const,
  IsSpeechToTextEnabled: false,
};

describe('Dictation Routes', () => {
  // ─── GET / ────────────────────────────────────────────────────────────────

  it('GET / returns list with pagination', async () => {
    const { app } = makeDictationApp({
      tables: {
        dictation: [
          { DictationId: 1, PatientId: 1, Status: 'pending', Priority: 'normal', tenant_id: 'tenant-1', IsActive: 1 },
          { DictationId: 2, PatientId: 2, Status: 'completed', Priority: 'urgent', tenant_id: 'tenant-1', IsActive: 1 },
          { DictationId: 3, PatientId: 3, Status: 'in-progress', Priority: 'stat', tenant_id: 'tenant-1', IsActive: 1 },
        ],
      },
    });

    const res = await app.request('/dictation', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[]; total: number };
    expect(body.Results).toBeDefined();
    expect(Array.isArray(body.Results)).toBe(true);
    expect(body.Results.length).toBe(3);
    expect(body.total).toBeDefined();
    expect(typeof body.total).toBe('number');
  });

  it('GET / with status filter narrows results', async () => {
    const { app } = makeDictationApp({
      tables: {
        dictation: [
          { DictationId: 1, PatientId: 1, Status: 'pending', Priority: 'normal', tenant_id: 'tenant-1', IsActive: 1 },
          { DictationId: 2, PatientId: 2, Status: 'completed', Priority: 'urgent', tenant_id: 'tenant-1', IsActive: 1 },
          { DictationId: 3, PatientId: 3, Status: 'pending', Priority: 'stat', tenant_id: 'tenant-1', IsActive: 1 },
        ],
      },
    });

    const res = await app.request('/dictation?status=pending', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[] };
    expect(body.Results).toBeDefined();
    expect(body.Results.length).toBe(2);
  });

  // ─── GET /stats ───────────────────────────────────────────────────────────

  it('GET /stats returns statistics', async () => {
    const { app } = makeDictationApp({
      tables: {
        dictation: [
          { DictationId: 1, Status: 'pending', tenant_id: 'tenant-1', IsActive: 1 },
          { DictationId: 2, Status: 'completed', tenant_id: 'tenant-1', IsActive: 1 },
          { DictationId: 3, Status: 'in-progress', tenant_id: 'tenant-1', IsActive: 1 },
        ],
      },
    });

    const res = await app.request('/dictation/stats', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, number> };
    expect(body.Results).toBeDefined();
    expect(typeof body.Results.pending).toBe('number');
    expect(typeof body.Results.inProgress).toBe('number');
    expect(typeof body.Results.transcribing).toBe('number');
    expect(typeof body.Results.completed).toBe('number');
    expect(typeof body.Results.cancelled).toBe('number');
  });

  // ─── GET /:id ─────────────────────────────────────────────────────────────

  it('GET /:id returns single dictation', async () => {
    const { app } = makeDictationApp({
      tables: {
        dictation: [
          { DictationId: 1, PatientId: 1, Status: 'pending', Priority: 'normal', tenant_id: 'tenant-1', IsActive: 1 },
        ],
        dictationtranscription: [],
        dictationassignment: [],
      },
    });

    const res = await app.request('/dictation/1', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { DictationId: number; transcriptions: unknown[]; assignments: unknown[] } };
    expect(body.Results).toBeDefined();
    expect(body.Results.DictationId).toBe(1);
    expect(Array.isArray(body.Results.transcriptions)).toBe(true);
    expect(Array.isArray(body.Results.assignments)).toBe(true);
  });

  it('GET /:id returns 404 when not found', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: dictationRoutes,
      routePath: '/dictation',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      mockDB,
    });

    const res = await app.request('/dictation/999', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  // ─── POST / ───────────────────────────────────────────────────────────────

  it('POST / creates dictation with valid data', async () => {
    const { app } = makeDictationApp();

    const res = await app.request('/dictation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreateBody),
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
    expect(typeof body.Results.id).toBe('number');
  });

  it('POST / with invalid priority returns 400', async () => {
    const { app } = makeDictationApp();

    const res = await app.request('/dictation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validCreateBody,
        Priority: 'invalid_priority',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('POST / with missing PatientId returns 400', async () => {
    const { app } = makeDictationApp();

    const res = await app.request('/dictation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        DictationText: 'Some text',
        Priority: 'normal',
      }),
    });

    expect(res.status).toBe(400);
  });

  // ─── PUT /:id/assign ──────────────────────────────────────────────────────

  it('PUT /:id/assign assigns transcriber', async () => {
    const { app } = makeDictationApp();

    const res = await app.request('/dictation/1/assign', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TranscriberId: 5,
        Priority: 'urgent',
        DueDate: '2026-06-01',
        Notes: 'Rush assignment',
      }),
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { success: boolean } };
    expect(body.Results.success).toBe(true);
  });

  it('PUT /:id/assign with invalid TranscriberId returns 400', async () => {
    const { app } = makeDictationApp();

    const res = await app.request('/dictation/1/assign', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TranscriberId: -1,
      }),
    });

    expect(res.status).toBe(400);
  });

  it('PUT /:id/assign returns 404 when not found', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: dictationRoutes,
      routePath: '/dictation',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      mockDB,
    });

    const res = await app.request('/dictation/999/assign', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ TranscriberId: 5 }),
    });

    expect(res.status).toBe(404);
  });

  // ─── PUT /:id/status ──────────────────────────────────────────────────────

  it('PUT /:id/status updates status', async () => {
    const { app } = makeDictationApp();

    const res = await app.request('/dictation/1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Status: 'completed' }),
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { success: boolean } };
    expect(body.Results.success).toBe(true);
  });

  it('PUT /:id/status with invalid status returns 400', async () => {
    const { app } = makeDictationApp();

    const res = await app.request('/dictation/1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Status: 'invalid_status' }),
    });

    expect(res.status).toBe(400);
  });

  it('PUT /:id/status returns 404 when not found', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: dictationRoutes,
      routePath: '/dictation',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      mockDB,
    });

    const res = await app.request('/dictation/999/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Status: 'completed' }),
    });

    expect(res.status).toBe(404);
  });

  // ─── PUT /:id/transcription ───────────────────────────────────────────────

  it('PUT /:id/transcription submits transcription', async () => {
    const { app } = makeDictationApp();

    const res = await app.request('/dictation/1/transcription', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TranscriptionText: 'Patient presents with acute chest pain radiating to the left arm.',
        TranscriptionNotes: 'Clear audio, high confidence',
        AccuracyScore: 95,
        QualityFlags: ['minor-stutter'],
      }),
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { version: number } };
    expect(body.Results.version).toBeDefined();
    expect(typeof body.Results.version).toBe('number');
    expect(body.Results.version).toBeGreaterThanOrEqual(1);
  });

  it('PUT /:id/transcription with empty text returns 400', async () => {
    const { app } = makeDictationApp();

    const res = await app.request('/dictation/1/transcription', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TranscriptionText: '',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('PUT /:id/transcription returns 404 when not found', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: dictationRoutes,
      routePath: '/dictation',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      mockDB,
    });

    const res = await app.request('/dictation/999/transcription', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TranscriptionText: 'Some transcription text',
      }),
    });

    expect(res.status).toBe(404);
  });
});
