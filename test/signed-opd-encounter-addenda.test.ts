import { describe, expect, it } from 'vitest';
import { encounterRoutes } from '../src/routes/tenant/clinical/encounters';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function createEncounterApp(options: {
  role?: 'doctor' | 'hospital_admin' | 'md';
  encounter?: Record<string, unknown> | null;
  doctorId?: number | null;
  previousAddendumHash?: string | null;
} = {}) {
  const encounter = options.encounter === undefined
    ? {
        id: 700,
        patient_id: 12,
        visit_id: 99,
        appointment_id: 44,
        provider_id: 7,
        status: 'signed',
        snapshot_hash: 'a'.repeat(64),
        signed_at: '2026-07-11 10:00:00',
        addendum_count: 0,
      }
    : options.encounter;
  const mockDB = createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from encounters') && lower.includes('where id = ?')) {
        return { first: encounter, results: encounter ? [encounter] : [] };
      }
      if (lower.includes('from doctors') && lower.includes('user_id = ?')) {
        const doctorId = options.doctorId === undefined ? 7 : options.doctorId;
        const doctor = doctorId == null ? null : { id: doctorId };
        return { first: doctor, results: doctor ? [doctor] : [] };
      }
      if (lower.includes('from encounter_addenda') && lower.includes('order by created_at desc')) {
        const row = options.previousAddendumHash
          ? { addendum_hash: options.previousAddendumHash }
          : null;
        return { first: row, results: row ? [row] : [] };
      }
      if (lower.includes('from encounter_addenda') && lower.includes('order by created_at asc')) {
        return {
          results: [{
            id: 1,
            encounter_id: 700,
            author_id: 42,
            reason: 'Clarification',
            content: 'Corrected laterality.',
            previous_snapshot_hash: 'a'.repeat(64),
            addendum_hash: 'b'.repeat(64),
            created_at: '2026-07-11 11:00:00',
          }],
        };
      }
      return null;
    },
  });
  const { app } = createTestApp({
    route: encounterRoutes,
    routePath: '/encounters',
    role: options.role ?? 'doctor',
    tenantId: 'tenant-1',
    userId: 42,
    mockDB,
  });
  return { app, mockDB };
}

describe('signed OPD encounter addenda', () => {
  it('returns signed encounter metadata with its append-only addenda', async () => {
    const { app } = createEncounterApp();

    const res = await app.request('/encounters/700');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      Results: {
        id: 700,
        status: 'signed',
        addenda: [{
          encounter_id: 700,
          reason: 'Clarification',
          content: 'Corrected laterality.',
        }],
      },
    });
  });

  it('lets the signing doctor append a hash-chained correction without mutating the snapshot', async () => {
    const previousHash = 'c'.repeat(64);
    const { app, mockDB } = createEncounterApp({ previousAddendumHash: previousHash });

    const res = await jsonRequest(app, '/encounters/700/addenda', {
      method: 'POST',
      body: {
        reason: 'Clarify medication instruction',
        content: 'The instruction should read once daily after breakfast.',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      Results: { encounterId: number; previousHash: string; addendumHash: string };
    };
    expect(body.Results.encounterId).toBe(700);
    expect(body.Results.previousHash).toBe(previousHash);
    expect(body.Results.addendumHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mockDB.batchCalls).toHaveLength(1);
    expect(mockDB.batchCalls[0]).toHaveLength(2);
    expect(mockDB.batchCalls[0][0].toLowerCase()).toContain('insert into encounter_addenda');
    expect(mockDB.batchCalls[0][1].toLowerCase()).toContain('addendum_count = addendum_count + 1');
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('update encounters set signed_snapshot'))).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
  });

  it('allows hospital administration to add an addendum to a signed encounter', async () => {
    const { app } = createEncounterApp({ role: 'hospital_admin', doctorId: null });

    const res = await jsonRequest(app, '/encounters/700/addenda', {
      method: 'POST',
      body: { reason: 'Administrative correction', content: 'Corrected encounter reference number.' },
    });

    expect(res.status).toBe(201);
  });

  it('blocks a different doctor from adding an addendum', async () => {
    const { app, mockDB } = createEncounterApp({ doctorId: 99 });

    const res = await jsonRequest(app, '/encounters/700/addenda', {
      method: 'POST',
      body: { reason: 'Unauthorized correction', content: 'This should not be recorded.' },
    });

    expect(res.status).toBe(403);
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('rejects addenda for an unsigned encounter', async () => {
    const { app, mockDB } = createEncounterApp({
      encounter: {
        id: 700,
        patient_id: 12,
        visit_id: 99,
        appointment_id: 44,
        provider_id: 7,
        status: 'in_progress',
        snapshot_hash: null,
        signed_at: null,
        addendum_count: 0,
      },
    });

    const res = await jsonRequest(app, '/encounters/700/addenda', {
      method: 'POST',
      body: { reason: 'Correction', content: 'Unsigned encounters should be edited normally.' },
    });

    expect(res.status).toBe(409);
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('blocks direct updates to a signed encounter', async () => {
    const { app, mockDB } = createEncounterApp();

    const res = await jsonRequest(app, '/encounters/700', {
      method: 'PUT',
      body: { chiefComplaint: 'Changed after signing' },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => query.method === 'run' && query.sql.toLowerCase().startsWith('update encounters'))).toBe(false);
  });

  it('blocks deletion of a signed encounter and audits the attempt', async () => {
    const { app, mockDB } = createEncounterApp();

    const res = await jsonRequest(app, '/encounters/700', {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/cannot be deleted/i) });
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
    expect(mockDB.queries.some((query) => query.method === 'run' && query.sql.toLowerCase().startsWith('update encounters'))).toBe(false);
  });
});
