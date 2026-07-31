import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const serviceUrl = new URL('../src/lib/ipd-doctor-rounds.ts', import.meta.url);
const routeUrl = new URL('../src/routes/tenant/ipdDoctorRounds.ts', import.meta.url);

async function loadService() {
  expect(existsSync(serviceUrl), 'doctor round service should exist').toBe(true);
  if (!existsSync(serviceUrl)) return null;
  return import(serviceUrl.href);
}

async function loadRoute() {
  expect(existsSync(routeUrl), 'doctor round route should exist').toBe(true);
  if (!existsSync(routeUrl)) return null;
  const module = await import(routeUrl.href);
  return module.default;
}

const payload = {
  admissionId: 21,
  patientId: 9,
  doctorId: 4,
  roundDate: '2026-06-18',
  roundTime: '14:35',
  entrySource: 'nurse_station',
  idempotencyKey: '018f6f64-8b4b-7d11-8f9d-aaaaaaaaaaaa',
};

function roundQueryOverride(sql: string) {
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
  if (normalized.includes('from ipd_doctor_rounds') && normalized.includes('idempotency_key')) {
    return normalized.includes('and provisional_item_id is not null')
      ? { first: { id: 91, provisional_item_id: 92, rounded_at: '2026-06-18 14:35:00', round_fee_snapshot: 700 } }
      : { first: null };
  }
  if (normalized.includes('from admissions')) {
    return { first: { id: 21, patient_id: 9, status: 'admitted' } };
  }
  if (normalized.includes('from doctors')) {
    return { first: { id: 4, name: 'Dr Round', ipd_round_fee: 700, is_active: 1 } };
  }
  return null;
}

describe('IPD doctor round service', () => {
  it('normalizes selected Bangladesh date and time without runtime timezone drift', async () => {
    const service = await loadService();
    if (!service) return;

    expect(service.normalizeRoundDateTime('2026-06-18', '14:35')).toBe('2026-06-18 14:35:00');
    expect(() => service.normalizeRoundDateTime('2026-02-30', '14:35')).toThrow('Invalid round date');
    expect(() => service.normalizeRoundDateTime('2026-06-18', '24:00')).toThrow('Invalid round time');
  });

  it('ships one mounted API route backed by an atomic batch', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const service = existsSync(serviceUrl) ? readFileSync(serviceUrl, 'utf8') : '';

    expect(index).toContain("app.route('/api/ipd-doctor-rounds', ipdDoctorRoundRoutes)");
    expect(service).toContain('env.DB.batch(');
    expect(service).toContain("item_category, item_name");
    expect(service).toContain("'doctor_round'");
    expect(service).toContain('INSERT INTO audit_logs');
  });
});

describe('IPD doctor round routes', () => {
  it('creates a nurse-entered round and returns the fee snapshot', async () => {
    const route = await loadRoute();
    if (!route) return;
    const mockDB = createMockDB({ queryOverride: roundQueryOverride });
    const { app } = createTestApp({
      route,
      routePath: '/rounds',
      role: 'nurse',
      tenantId: 'tenant-1',
      userId: 7,
      mockDB,
    });

    const response = await jsonRequest(app, '/rounds', { method: 'POST', body: payload });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      roundId: 91,
      provisionalItemId: 92,
      roundedAt: '2026-06-18 14:35:00',
      fee: 700,
    });
    expect(mockDB.queries.some(query => query.sql.includes('INTO ipd_doctor_rounds'))).toBe(true);
    expect(mockDB.queries.some(query => query.sql.includes('INTO billing_provisional_items'))).toBe(true);
  });

  it('returns an existing same-key round without issuing another batch insert', async () => {
    const route = await loadRoute();
    if (!route) return;
    const mockDB = createMockDB({
      queryOverride: (sql) => sql.includes('FROM ipd_doctor_rounds')
        ? { first: { id: 91, provisional_item_id: 92, rounded_at: '2026-06-18 14:35:00', round_fee_snapshot: 700 } }
        : null,
    });
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'nurse', mockDB });

    const response = await jsonRequest(app, '/rounds', { method: 'POST', body: payload });
    expect(response.status).toBe(200);
    expect(mockDB.queries.some(query => query.sql.includes('INTO billing_provisional_items'))).toBe(false);
  });

  it('prevents a nurse from spoofing an IP billing source', async () => {
    const route = await loadRoute();
    if (!route) return;
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'nurse' });

    const response = await jsonRequest(app, '/rounds', {
      method: 'POST',
      body: { ...payload, entrySource: 'ipd_billing' },
    });
    expect(response.status).toBe(403);
  });

  it('prevents billing roles from spoofing a nurse station source', async () => {
    const route = await loadRoute();
    if (!route) return;
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'reception' });

    const response = await jsonRequest(app, '/rounds', {
      method: 'POST',
      body: payload,
    });
    expect(response.status).toBe(403);
  });

  it('fails the request when the atomic D1 batch fails', async () => {
    const route = await loadRoute();
    if (!route) return;
    const mockDB = createMockDB({ queryOverride: roundQueryOverride, batchError: 'round batch failed' });
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'nurse', mockDB });

    const response = await jsonRequest(app, '/rounds', { method: 'POST', body: payload });
    expect(response.status).toBe(500);
  });

  it('adds metadata-only round and provisional outbox events to the local atomic batch', async () => {
    const route = await loadRoute();
    if (!route) return;
    const mockDB = createMockDB({ queryOverride: roundQueryOverride });
    const { app } = createTestApp({
      route,
      routePath: '/rounds',
      role: 'nurse',
      mockDB,
      extraEnv: { ENVIRONMENT: 'local_server', LOCAL_SERVER_ID: 'ward-a' },
    });

    const response = await jsonRequest(app, '/rounds', { method: 'POST', body: payload });
    expect(response.status).toBe(201);
    const outboxQueries = mockDB.queries.filter(query => query.sql.includes('INSERT OR IGNORE INTO local_sync_outbox'));
    expect(outboxQueries).toHaveLength(2);
    expect(outboxQueries.map(query => query.params[1])).toEqual([
      'ipd_doctor_round',
      'billing_provisional_doctor_round',
    ]);
    expect(JSON.stringify(outboxQueries.map(query => query.params))).not.toMatch(/clinical_note|"note"/i);
  });

  it('lists round history for one admission', async () => {
    const route = await loadRoute();
    if (!route) return;
    const { app } = createTestApp({
      route,
      routePath: '/rounds',
      role: 'reception',
      tables: {
        ipd_doctor_rounds: [{
          id: 91,
          tenant_id: 'tenant-1',
          admission_id: 21,
          doctor_name_snapshot: 'Dr Round',
          rounded_at: '2026-06-18 14:35:00',
          round_fee_snapshot: 700,
        }],
      },
    });

    const response = await app.request('/rounds?admission_id=21');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rounds: [expect.objectContaining({ id: 91, doctor_name_snapshot: 'Dr Round' })],
    });
  });

  it('allows a staff-linked assigned doctor to list round history', async () => {
    const route = await loadRoute();
    if (!route) return;
    const mockDB = createMockDB({
      tables: {
        ipd_doctor_rounds: [{
          id: 91,
          tenant_id: 'tenant-1',
          admission_id: 21,
          patient_id: 9,
          doctor_id: 4,
          doctor_name_snapshot: 'Dr Staff Link',
          rounded_at: '2026-06-18 14:35:00',
          round_fee_snapshot: 700,
        }],
      },
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: null };
        }
        if (normalized.includes('from staff s') && normalized.includes('join doctors d')) {
          return { first: { id: 4 } };
        }
        if (normalized.includes('select doctor_id from admissions')) {
          return { first: { doctor_id: 4 } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route,
      routePath: '/rounds',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 99,
      mockDB,
    });

    const response = await app.request('/rounds?admission_id=21');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rounds: [expect.objectContaining({ id: 91, doctor_name_snapshot: 'Dr Staff Link' })],
    });
  });

  it('rejects a doctor listing rounds for an unassigned admission', async () => {
    const route = await loadRoute();
    if (!route) return;
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: { id: 4 } };
        }
        if (normalized.includes('select doctor_id from admissions')) {
          return { first: { doctor_id: 999 } };
        }
        return null;
      },
    });
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'doctor', mockDB });

    const response = await app.request('/rounds?admission_id=21');
    expect(response.status).toBe(403);
    expect(mockDB.queries.some((query) => query.method === 'all' && query.sql.includes('FROM ipd_doctor_rounds r'))).toBe(false);
  });

  it('atomically cancels an active round and its provisional item', async () => {
    const route = await loadRoute();
    if (!route) return;
    const mockDB = createMockDB({
      queryOverride: (sql) => sql.includes('LEFT JOIN billing_provisional_items')
        ? { first: {
            id: 91,
            status: 'active',
            provisional_item_id: 92,
            bill_status: 'provisional',
            admission_id: 21,
            patient_id: 9,
            doctor_id: 4,
            rounded_at: '2026-06-18 14:35:00',
            doctor_name_snapshot: 'Dr Round',
            round_fee_snapshot: 700,
            entry_source: 'nurse_station',
            entered_by: 7,
            idempotency_key: payload.idempotencyKey,
          } }
        : null,
    });
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'hospital_admin', mockDB });

    const response = await jsonRequest(app, '/rounds/91/cancel', {
      method: 'POST',
      body: { reason: 'Entered in error' },
    });
    expect(response.status).toBe(200);
    expect(mockDB.queries.some(query => query.sql.includes('UPDATE ipd_doctor_rounds'))).toBe(true);
    expect(mockDB.queries.some(query => query.sql.includes('UPDATE billing_provisional_items'))).toBe(true);
    expect(mockDB.queries.some(query => query.sql.includes("'CANCEL'"))).toBe(true);
  });

  it('includes cancellation outbox events in the same local batch', async () => {
    const route = await loadRoute();
    if (!route) return;
    const mockDB = createMockDB({
      queryOverride: (sql) => sql.includes('LEFT JOIN billing_provisional_items')
        ? { first: {
            id: 91,
            status: 'active',
            provisional_item_id: 92,
            bill_status: 'provisional',
            admission_id: 21,
            patient_id: 9,
            doctor_id: 4,
            rounded_at: '2026-06-18 14:35:00',
            doctor_name_snapshot: 'Dr Round',
            round_fee_snapshot: 700,
            entry_source: 'nurse_station',
            entered_by: 7,
            idempotency_key: payload.idempotencyKey,
          } }
        : null,
    });
    const { app } = createTestApp({
      route,
      routePath: '/rounds',
      role: 'hospital_admin',
      mockDB,
      extraEnv: { ENVIRONMENT: 'local_server', LOCAL_SERVER_ID: 'ward-a' },
    });

    const response = await jsonRequest(app, '/rounds/91/cancel', {
      method: 'POST',
      body: { reason: 'Entered in error' },
    });
    expect(response.status).toBe(200);
    const outboxQueries = mockDB.queries.filter(query => query.sql.includes('INSERT OR IGNORE INTO local_sync_outbox'));
    expect(outboxQueries).toHaveLength(2);
    expect(outboxQueries.every(query => String(query.params[4]).includes('cancelled'))).toBe(true);
  });

  it('rejects direct cancellation after the linked item is finalized', async () => {
    const route = await loadRoute();
    if (!route) return;
    const mockDB = createMockDB({
      queryOverride: (sql) => sql.includes('LEFT JOIN billing_provisional_items')
        ? { first: { id: 91, status: 'active', provisional_item_id: 92, bill_status: 'finalized' } }
        : null,
    });
    const { app } = createTestApp({ route, routePath: '/rounds', role: 'hospital_admin', mockDB });

    const response = await jsonRequest(app, '/rounds/91/cancel', {
      method: 'POST',
      body: { reason: 'Entered in error' },
    });
    expect(response.status).toBe(409);
    expect(mockDB.queries.some(query => query.sql.includes('UPDATE ipd_doctor_rounds'))).toBe(false);
  });
});
