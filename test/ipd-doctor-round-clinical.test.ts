import { describe, expect, it } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const routeUrl = new URL('../src/routes/tenant/ipdDoctorRounds.ts', import.meta.url);

async function loadRoute() {
  const module = await import(routeUrl.href);
  return module.default;
}

const baseClinicalPayload = {
  admissionId: 21,
  patientId: 9,
  roundDate: '2026-06-18',
  roundTime: '14:35',
  patientCondition: 'stable' as const,
  title: 'IPD Round Note · 2026-06-18 14:35',
  subjective: 'Patient resting comfortably',
  objective: 'BP 120/80, HR 76',
  assessment: 'Stable post-op',
  plan: 'Continue IV antibiotics',
  roundSummary: 'Routine round',
  createBillingRound: false,
  idempotencyKey: '018f6f64-8b4b-7d11-8f9d-cccccccccccc',
};

function doctorContextOverride(sql: string) {
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
  if (normalized.includes('from doctors') && normalized.includes('user_id')) {
    return { first: { id: 4, name: 'Dr Round', ipd_round_fee: 700, is_active: 1 } };
  }
  if (normalized.includes('from admissions') && normalized.includes('status in')) {
    return { first: { id: 21, patient_id: 9, status: 'admitted' } };
  }
  if (normalized.includes('from admissions where id =')) {
    return { first: { doctor_id: 4 } };
  }
  if (normalized.includes('from clinical_notes where tenant_id = ? and patient_id = ? and idempotency_key = ?')) {
    return { first: null };
  }
  if (normalized.includes('into clinical_notes')) {
    return { meta: { last_row_id: 333 } };
  }
  if (normalized.includes("into audit_logs")) {
    return { meta: { last_row_id: 1 } };
  }
  if (normalized.includes('from ipd_doctor_rounds') && normalized.includes('substr')) {
    return { first: null };
  }
  if (normalized.includes('update ipd_doctor_rounds set clinical_note_id')) {
    return { meta: { changes: 0 } };
  }
  return null;
}

describe('Doctor IPD round clinical endpoint', () => {
  it('rejects non-doctor roles', async () => {
    const route = await loadRoute();
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'nurse' });

    const response = await jsonRequest(app, '/rounds/clinical', { method: 'POST', body: baseClinicalPayload });
    expect(response.status).toBe(403);
  });

  it('creates a signed clinical note without billing when checkbox is off', async () => {
    const route = await loadRoute();
    const mockDB = createMockDB({ queryOverride: doctorContextOverride });
    const { app } = createTestApp({
      route, routePath: '/rounds', role: 'doctor', tenantId: 'tenant-1', userId: 99, mockDB,
    });

    const response = await jsonRequest(app, '/rounds/clinical', { method: 'POST', body: baseClinicalPayload });
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body.clinicalNoteId).toEqual(expect.any(Number));
    expect(body.roundId).toBeNull();
    expect(body.provisionalItemId).toBeNull();
    expect(body.createdBilling).toBe(false);

    const noteInsert = mockDB.queries.find((q) => q.sql.includes('INTO clinical_notes'));
    expect(noteInsert).toBeDefined();
    expect(noteInsert?.params).toEqual(expect.arrayContaining([baseClinicalPayload.idempotencyKey]));
    expect(noteInsert?.params).toEqual(expect.arrayContaining([baseClinicalPayload.title]));

    const roundInsert = mockDB.queries.find((q) => q.sql.includes('INTO ipd_doctor_rounds'));
    expect(roundInsert).toBeUndefined();
    expect(mockDB.queries.some((q) => q.sql.includes("'SIGN'"))).toBe(true);
    expect(mockDB.queries.filter((q) => q.sql.includes('INTO clinical_notes'))[0]?.method).toBe('all');
  });

  it('creates a signed clinical note for a staff-linked doctor profile', async () => {
    const route = await loadRoute();
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: null };
        }
        if (normalized.includes('from staff s') && normalized.includes('join doctors d')) {
          return { first: { id: 4, name: 'Dr Staff Link', ipd_round_fee: 700 } };
        }
        if (normalized.includes('from admissions') && normalized.includes('status in')) {
          return { first: { id: 21, patient_id: 9, status: 'admitted' } };
        }
        if (normalized.includes('from admissions where id =')) {
          return { first: { doctor_id: 4 } };
        }
        if (normalized.includes('from clinical_notes') && normalized.includes('idempotency_key')) {
          return { first: null };
        }
        if (normalized.includes('from ipd_doctor_rounds') && normalized.includes('substr')) {
          return { first: null };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route, routePath: '/rounds', role: 'doctor', tenantId: 'tenant-1', userId: 99, mockDB,
    });

    const response = await jsonRequest(app, '/rounds/clinical', { method: 'POST', body: baseClinicalPayload });
    expect(response.status).toBe(201);
    const staffLookup = mockDB.queries.find((q) => q.sql.includes('FROM staff s') && q.sql.includes('JOIN doctors d'));
    expect(staffLookup?.params).toEqual(expect.arrayContaining(['99', 'tenant-1']));
  });

  it('creates billable round with doctor_dashboard source when checkbox is on and fee configured', async () => {
    const route = await loadRoute();
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from ipd_doctor_rounds') && normalized.includes('idempotency_key')) {
          return { first: normalized.includes('provisional_item_id is not null')
            ? { id: 91, provisional_item_id: 92, rounded_at: '2026-06-18 14:35:00', round_fee_snapshot: 700 }
            : null };
        }
        if (normalized.includes('from admissions') && normalized.includes('status in')) {
          return { first: { id: 21, patient_id: 9, status: 'admitted' } };
        }
        if (normalized.includes('from admissions where id =')) {
          return { first: { doctor_id: 4 } };
        }
        if (normalized.includes('from doctors')) {
          return { first: { id: 4, name: 'Dr Round', ipd_round_fee: 700, is_active: 1 } };
        }
        if (normalized.includes('from clinical_notes') && normalized.includes('idempotency_key')) {
          return { first: normalized.includes('select id, title')
            ? null
            : { id: 555, title: baseClinicalPayload.title, signed_at: '2026-06-18 14:35:00' } };
        }
        if (normalized.includes("into ipd_doctor_rounds")) return { meta: { last_row_id: 91 } };
        if (normalized.includes('from ipd_doctor_rounds') && normalized.includes('substr')) return { first: null };
        return null;
      },
    });
    const { app } = createTestApp({
      route, routePath: '/rounds', role: 'doctor', mockDB,
    });

    const response = await jsonRequest(app, '/rounds/clinical', {
      method: 'POST',
      body: { ...baseClinicalPayload, createBillingRound: true },
    });
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body.clinicalNoteId).toEqual(expect.any(Number));
    expect(body.roundId).toBe(91);
    expect(body.createdBilling).toBe(true);

    // round billing idempotency key is namespaced with "doc:" to disambiguate from nurse/billing rows.
    const roundInsert = mockDB.queries.find((q) => q.sql.includes('INTO ipd_doctor_rounds'));
    expect(roundInsert?.params).toEqual(expect.arrayContaining(['doctor_dashboard']));
    expect(roundInsert?.params).toEqual(expect.arrayContaining([expect.stringMatching(/^doc:018f6f64/)]));
  });

  it('rejects billing when doctor ipd_round_fee is not configured', async () => {
    const route = await loadRoute();
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: { id: 4, name: 'Dr Round', ipd_round_fee: 0, is_active: 1 } };
        }
        if (normalized.includes('from admissions')) {
          return { first: { id: 21, patient_id: 9, status: 'admitted' } };
        }
        if (normalized.includes('from admissions where id =')) {
          return { first: { doctor_id: 4 } };
        }
        return null;
      },
    });
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'doctor', mockDB });

    const response = await jsonRequest(app, '/rounds/clinical', {
      method: 'POST',
      body: { ...baseClinicalPayload, createBillingRound: true },
    });
    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(JSON.stringify(body)).toMatch(/round fee/i);
  });

  it('rejects doctors signing for admissions they are not assigned to', async () => {
    const route = await loadRoute();
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: { id: 4, name: 'Dr Round', ipd_round_fee: 700, is_active: 1 } };
        }
        if (normalized.includes('from admissions') && normalized.includes('status in')) {
          return { first: { id: 21, patient_id: 9, status: 'admitted' } };
        }
        if (normalized.includes('from admissions where id =')) {
          return { first: { doctor_id: 999 } };
        }
        return null;
      },
    });
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'doctor', mockDB });

    const response = await jsonRequest(app, '/rounds/clinical', { method: 'POST', body: baseClinicalPayload });
    expect(response.status).toBe(403);
  });

  it('links a pre-existing billing round instead of duplicating it', async () => {
    const route = await loadRoute();
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: { id: 4, name: 'Dr Round', ipd_round_fee: 700, is_active: 1 } };
        }
        if (normalized.includes('from admissions') && normalized.includes('status in')) {
          return { first: { id: 21, patient_id: 9, status: 'admitted' } };
        }
        if (normalized.includes('from admissions where id =')) {
          return { first: { doctor_id: 4 } };
        }
        if (normalized.includes('from clinical_notes where tenant_id = ? and patient_id = ? and idempotency_key = ?')) {
          return { first: null };
        }
        if (normalized.includes('from clinical_notes') && normalized.includes('idempotency_key')) {
          return { first: { id: 666, title: baseClinicalPayload.title, signed_at: '2026-06-18 14:35:00' } };
        }
        if (normalized.includes('from ipd_doctor_rounds') && normalized.includes('substr')) {
          return { first: {
            id: 91, provisional_item_id: 92, status: 'active', clinical_status: 'billing_only', clinical_note_id: null,
          } };
        }
        if (normalized.includes('update ipd_doctor_rounds set clinical_note_id')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'doctor', mockDB });

    const response = await jsonRequest(app, '/rounds/clinical', {
      method: 'POST',
      body: { ...baseClinicalPayload, createBillingRound: true },
    });
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body.roundId).toBe(91);
    expect(body.createdBilling).toBe(false); // reuse, not new
    const newRoundInsert = mockDB.queries.find((q) => q.sql.includes('INTO ipd_doctor_rounds'));
    expect(newRoundInsert).toBeUndefined();
  });

  it('enqueues clinical round metadata after linking an existing round on local server', async () => {
    const route = await loadRoute();
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: { id: 4, name: 'Dr Round', ipd_round_fee: 700, is_active: 1 } };
        }
        if (normalized.includes('from admissions') && normalized.includes('status in')) {
          return { first: { id: 21, patient_id: 9, status: 'admitted' } };
        }
        if (normalized.includes('from admissions where id =')) {
          return { first: { doctor_id: 4 } };
        }
        if (normalized.includes('from clinical_notes') && normalized.includes('idempotency_key')) {
          return { first: null };
        }
        if (normalized.includes('from ipd_doctor_rounds') && normalized.includes('substr')) {
          return { first: {
            id: 91,
            provisional_item_id: 92,
            status: 'active',
            clinical_status: 'billing_only',
            clinical_note_id: null,
            rounded_at: '2026-06-18 14:35:00',
            doctor_name_snapshot: 'Dr Round',
            round_fee_snapshot: 700,
            entry_source: 'nurse_station',
            entered_by: 7,
            idempotency_key: 'round-existing-key',
          } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route,
      routePath: '/rounds',
      role: 'doctor',
      userId: 99,
      mockDB,
      extraEnv: { ENVIRONMENT: 'local_server', LOCAL_SERVER_ID: 'ward-a' },
    });

    const response = await jsonRequest(app, '/rounds/clinical', {
      method: 'POST',
      body: baseClinicalPayload,
    });
    expect(response.status).toBe(201);
    const outbox = mockDB.queries.find((q) => q.sql.includes('INSERT OR IGNORE INTO local_sync_outbox'));
    expect(outbox).toBeDefined();
    const payload = JSON.parse(String(outbox?.params[4])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      tenant_id: 'tenant-1',
      admission_id: 21,
      patient_id: 9,
      doctor_id: 4,
      rounded_at: '2026-06-18 14:35:00',
      doctor_name_snapshot: 'Dr Round',
      round_fee_snapshot: 700,
      entry_source: 'nurse_station',
      entered_by: 7,
      idempotency_key: 'round-existing-key',
      status: 'active',
      clinical_status: 'documented',
      signed_by: '99',
      round_summary: 'Routine round',
      patient_condition: 'stable',
      clinical_note_idempotency_key: baseClinicalPayload.idempotencyKey,
    });
    expect(payload).not.toHaveProperty('clinical_note_id');
  });

  it('does not persist a clinical note when the atomic clinical batch fails', async () => {
    const route = await loadRoute();
    const mockDB = createMockDB({ queryOverride: doctorContextOverride, batchError: 'clinical batch failed' });
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'doctor', mockDB });

    const response = await jsonRequest(app, '/rounds/clinical', { method: 'POST', body: baseClinicalPayload });

    expect(response.status).toBe(500);
    expect(mockDB.queries.some((q) => q.sql.includes('INTO clinical_notes') && q.method === 'run')).toBe(false);
  });

  it('lists rounds with clinical_status / signed_at / patient_condition columns', async () => {
    const route = await loadRoute();
    const mockDB = createMockDB({
      tables: {
        ipd_doctor_rounds: [{
          id: 91,
          tenant_id: 'tenant-1',
          admission_id: 21,
          patient_id: 9,
          doctor_id: 4,
          doctor_name_snapshot: 'Dr Round',
          rounded_at: '2026-06-18 14:35:00',
          round_fee_snapshot: 700,
          entry_source: 'nurse_station',
          status: 'active',
          clinical_status: 'signed',
          signed_at: '2026-06-18 14:40:00',
          patient_condition: 'improving',
        }],
      },
    });
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'reception', mockDB });

    const response = await app.request('/rounds?admission_id=21');
    expect(response.status).toBe(200);
    const body = await response.json() as { rounds: Array<Record<string, unknown>> };
    expect(body.rounds).toHaveLength(1);
    expect(body.rounds[0]).toMatchObject({
      id: 91,
      clinical_status: 'signed',
      signed_at: '2026-06-18 14:40:00',
      patient_condition: 'improving',
    });
  });
});
