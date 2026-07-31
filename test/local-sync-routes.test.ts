import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { createMockDB, createMockKV } from './integration/helpers/mock-db';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
}));

describe('IPD doctor round sync contract', () => {
  it('pulls round history and applies only explicit metadata event mappers', () => {
    const syncSource = readFileSync(new URL('../src/routes/sync.ts', import.meta.url), 'utf8');
    const snapshotSource = readFileSync(
      new URL('../scripts/local-server/export-tenant-snapshot.ts', import.meta.url),
      'utf8',
    );

    expect(syncSource).toContain("'ipd_doctor_rounds'");
    expect(syncSource).toContain("event.entityType === 'ipd_doctor_round'");
    expect(syncSource).toContain("event.entityType === 'billing_provisional_doctor_round'");
    expect(snapshotSource).toContain("'ipd_doctor_rounds'");
  });
});

function createEnv(
  overrides: Partial<Env> = {},
  options: {
    ingestChanges?: number;
    queryOverride?: (sql: string, params: unknown[]) => { results?: Record<string, unknown>[]; first?: Record<string, unknown> | null; success?: boolean; meta?: Record<string, unknown> } | null;
    uploads?: Partial<R2Bucket>;
  } = {},
) {
  const patientRows: Array<{
    id: number;
    tenant_id: string;
    patient_code: string | null;
    uhid: string | null;
    sync_key: string | null;
    name: string;
  }> = [];
  const mappingRows: Array<{
    server_id: string;
    tenant_id: string;
    entity_type: string;
    local_entity_id: string;
    cloud_entity_id: string;
    natural_key: string | null;
  }> = [];
  let nextPatientId = 1000;

  const mockDB = createMockDB({
    queryOverride(sql, params) {
      const override = options.queryOverride?.(sql, params);
      if (override) return override;
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (/INSERT\s+OR\s+IGNORE\s+INTO\s+cloud_sync_ingest_events/i.test(sql)) {
        return { success: true, meta: { changes: options.ingestChanges ?? 1 } };
      }

      if (normalized.includes('from sync_entity_mappings') && normalized.includes('local_entity_id = ?')) {
        const [serverId, tenantId, entityType, localId] = params.map(String);
        return {
          first: mappingRows.find((row) =>
            row.server_id === serverId
            && row.tenant_id === tenantId
            && row.entity_type === entityType
            && row.local_entity_id === localId,
          ) ?? null,
        };
      }
      if (normalized.includes('from sync_entity_mappings') && normalized.includes('cloud_entity_id = ?')) {
        const [serverId, tenantId, entityType, cloudId] = params.map(String);
        return {
          first: mappingRows.find((row) =>
            row.server_id === serverId
            && row.tenant_id === tenantId
            && row.entity_type === entityType
            && row.cloud_entity_id === cloudId,
          ) ?? null,
        };
      }
      if (normalized.startsWith('insert or ignore into sync_entity_mappings')) {
        const [serverId, tenantId, entityType, localId, cloudId, naturalKey] =
          params.map((value) => value == null ? null : String(value));
        const duplicate = mappingRows.some((row) =>
          row.server_id === serverId
          && row.tenant_id === tenantId
          && row.entity_type === entityType
          && (row.local_entity_id === localId || row.cloud_entity_id === cloudId),
        );
        if (!duplicate) {
          mappingRows.push({
            server_id: serverId!,
            tenant_id: tenantId!,
            entity_type: entityType!,
            local_entity_id: localId!,
            cloud_entity_id: cloudId!,
            natural_key: naturalKey,
          });
        }
        return { success: true, meta: { changes: duplicate ? 0 : 1 } };
      }
      if (normalized.startsWith('update sync_entity_mappings')) {
        const [naturalKey, serverId, tenantId, entityType, localId, cloudId] =
          params.map((value) => value == null ? null : String(value));
        const mapping = mappingRows.find((row) =>
          row.server_id === serverId
          && row.tenant_id === tenantId
          && row.entity_type === entityType
          && row.local_entity_id === localId
          && row.cloud_entity_id === cloudId,
        );
        if (mapping && mapping.natural_key == null) mapping.natural_key = naturalKey;
        return { success: true, meta: { changes: mapping ? 1 : 0 } };
      }

      if (normalized.includes('from patients') && normalized.includes('where tenant_id = ? and sync_key = ?')) {
        const [tenantId, syncKey] = params.map(String);
        return {
          first: patientRows.find((row) => row.tenant_id === tenantId && row.sync_key === syncKey) ?? null,
        };
      }
      if (normalized.includes('from patients') && normalized.includes('where id = ? and tenant_id = ?')) {
        const [id, tenantId] = params;
        return {
          first: patientRows.find((row) => row.id === Number(id) && row.tenant_id === String(tenantId)) ?? null,
        };
      }
      if (normalized.includes('from patients') && normalized.includes('upper(trim(uhid))')) {
        const [tenantId, rawUhid, , rawCode] = params;
        const uhid = rawUhid == null ? null : String(rawUhid).trim().toUpperCase();
        const patientCode = rawCode == null ? null : String(rawCode).trim().toUpperCase();
        return {
          results: patientRows.filter((row) =>
            row.tenant_id === String(tenantId)
            && ((uhid && row.uhid?.trim().toUpperCase() === uhid)
              || (patientCode && row.patient_code?.trim().toUpperCase() === patientCode)),
          ).slice(0, 3),
        };
      }
      if (normalized.startsWith('insert into patients') && normalized.includes('on conflict(tenant_id, sync_key)')) {
        const [tenantId, syncKey, name, , , , , patientCode, uhid] = params;
        let patient = patientRows.find((row) =>
          row.tenant_id === String(tenantId) && row.sync_key === String(syncKey),
        );
        if (!patient) {
          patient = {
            id: nextPatientId++,
            tenant_id: String(tenantId),
            patient_code: patientCode == null ? null : String(patientCode),
            uhid: uhid == null ? null : String(uhid),
            sync_key: String(syncKey),
            name: String(name),
          };
          patientRows.push(patient);
        } else {
          patient.name = String(name);
          patient.patient_code = patientCode == null ? null : String(patientCode);
          patient.uhid = uhid == null ? null : String(uhid);
        }
        return { first: patient };
      }
      if (normalized.startsWith('update patients set sync_key = coalesce')) {
        const syncKey = String(params[0]);
        const name = String(params[1]);
        const patientCode = params[6] == null ? null : String(params[6]);
        const uhid = params[7] == null ? null : String(params[7]);
        const id = Number(params[12]);
        const tenantId = String(params[13]);
        const expectedSyncKey = String(params[14]);
        const patient = patientRows.find((row) =>
          row.id === id
          && row.tenant_id === tenantId
          && (row.sync_key == null || row.sync_key === expectedSyncKey),
        );
        if (!patient) return { first: null };
        patient.sync_key ??= syncKey;
        patient.name = name;
        patient.patient_code = patientCode;
        patient.uhid = uhid;
        return { first: patient };
      }
      if (normalized.startsWith('update patients set sync_key = ?, updated_at')) {
        const [syncKey, id, tenantId] = params.map(String);
        const patient = patientRows.find((row) =>
          row.id === Number(id) && row.tenant_id === tenantId && row.sync_key == null,
        );
        if (!patient) return { first: null };
        patient.sync_key = syncKey;
        return { first: patient };
      }

      return null;
    },
  });
  const mockKV = createMockKV();
  const env = {
    DB: mockDB.db,
    KV: mockKV.kv,
    UPLOADS: {
      list: async () => ({ objects: [], truncated: false }),
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
      ...options.uploads,
    },
    ASSETS: { fetch: async () => new Response('asset') },
    JWT_SECRET: 'jwt-test-secret',
    ENVIRONMENT: 'production',
    ALLOWED_ORIGINS: '',
    CLOUD_SYNC_TOKEN: 'cloud-sync-secret',
    ...overrides,
  } as unknown as Env;

  return { env, mockDB, patientRows, mappingRows };
}

function syncRequest(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      Authorization: 'Bearer cloud-sync-secret',
      ...(init.headers ?? {}),
    },
  });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`;
}

async function payloadHash(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const SIGNED_ROUND_KEY = 'signed-round-key-001';

function signedRoundPayload(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: 'tenant-1',
    admission_id: 21,
    patient_id: 9,
    doctor_id: 4,
    rounded_at: '2026-06-18 14:35:00',
    doctor_name_snapshot: 'Dr Round',
    round_fee_snapshot: 700,
    entry_source: 'doctor_dashboard',
    entered_by: 99,
    idempotency_key: SIGNED_ROUND_KEY,
    status: 'active',
    clinical_status: 'signed',
    signed_by: 99,
    signed_at: '2026-06-18T08:40:00.000Z',
    round_summary: 'Routine round',
    patient_condition: 'stable',
    clinical_note_idempotency_key: 'signed-note-key-001',
    ...overrides,
  };
}

function existingSignedRound(overrides: Record<string, unknown> = {}) {
  return { id: 700, ...signedRoundPayload(), ...overrides };
}

function ipdRoundTableInfo() {
  return [
    { name: 'id', pk: 1 },
    { name: 'tenant_id', pk: 0 },
    { name: 'admission_id', pk: 0 },
    { name: 'patient_id', pk: 0 },
    { name: 'doctor_id', pk: 0 },
    { name: 'rounded_at', pk: 0 },
    { name: 'doctor_name_snapshot', pk: 0 },
    { name: 'round_fee_snapshot', pk: 0 },
    { name: 'entry_source', pk: 0 },
    { name: 'entered_by', pk: 0 },
    { name: 'idempotency_key', pk: 0 },
    { name: 'status', pk: 0 },
    { name: 'clinical_note_id', pk: 0 },
    { name: 'clinical_status', pk: 0 },
    { name: 'signed_by', pk: 0 },
    { name: 'signed_at', pk: 0 },
    { name: 'round_summary', pk: 0 },
    { name: 'patient_condition', pk: 0 },
    { name: 'created_at', pk: 0 },
    { name: 'updated_at', pk: 0 },
  ];
}

describe('local server cloud sync routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects sync requests without the configured bearer token', async () => {
    const { env } = createEnv();

    const res = await worker.fetch(
      new Request('http://localhost/api/sync/ping', {
        headers: { Authorization: 'Bearer wrong-token' },
      }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('accepts sync ping with cloud sync bearer auth before user JWT middleware', async () => {
    const { env } = createEnv();

    const res = await worker.fetch(syncRequest('/api/sync/ping'), env);
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: 'production',
    });
  });

  it('ingests idempotent event metadata without storing sensitive payload bodies', async () => {
    const { env, mockDB } = createEnv();
    const payload = { patientName: 'Sensitive Name', diagnosis: 'Sensitive diagnosis' };

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-2026-06-04-001',
          events: [
            {
              idempotencyKey: 'hospital-lan-primary:patients:123:update:1',
              tenantId: 'tenant-1',
              entityType: 'patients',
              entityId: '123',
              operation: 'update',
              payloadHash: await payloadHash(payload),
              payload,
            },
          ],
        }),
      }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ accepted: 1, duplicates: 0 });

    const insert = mockDB.queries.find((query) =>
      /INSERT\s+OR\s+IGNORE\s+INTO\s+cloud_sync_ingest_events/i.test(query.sql),
    );
    expect(insert).toBeDefined();
    expect(JSON.stringify(insert?.params)).not.toContain('Sensitive Name');
    expect(JSON.stringify(insert?.params)).not.toContain('Sensitive diagnosis');
  });

  it('keeps a payload-bearing local event failed when cloud has no explicit apply mapper', async () => {
    const payload = { id: 77, tenant_id: 'tenant-1', value: 'local-only-change' };
    const { env, mockDB } = createEnv();

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-unsupported-payload',
          events: [{
            idempotencyKey: 'hospital-lan-primary:unsupported-local-entity:77:upsert',
            tenantId: 'tenant-1',
            entityType: 'unsupported_local_entity',
            entityId: '77',
            operation: 'upsert',
            payloadHash: await payloadHash(payload),
            payload,
          }],
        }),
      }),
      env,
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/no supported cloud apply mapper/i),
    });
    const failedReceipt = mockDB.queries.find((query) =>
      /UPDATE\s+cloud_sync_ingest_events/i.test(query.sql)
      && query.params[0] === 'failed',
    );
    expect(failedReceipt?.params[1]).toMatch(/no supported cloud apply mapper/i);
  });

  it('rejects known-entity payloads when the payload hash does not match', async () => {
    const { env, mockDB } = createEnv();

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-bad-hash',
          events: [
            {
              idempotencyKey: 'hospital-lan-primary:patients:123:upsert:1',
              tenantId: 'tenant-1',
              entityType: 'patients',
              entityId: '123',
              operation: 'upsert',
              payloadHash: '0'.repeat(64),
              payload: {
                id: 123,
                tenant_id: 'tenant-1',
                name: 'Hash Mismatch',
                mobile: '01700000000',
              },
            },
          ],
        }),
      }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid sync batch payload' });
    expect(mockDB.queries.some((query) => /cloud_sync_ingest_events/i.test(query.sql))).toBe(false);
  });

  it('applies a patient upsert payload through the cloud sync mapper and ignores unsupported fields', async () => {
    const patientPayload = {
      id: 123,
      tenant_id: 'tenant-1',
      name: 'Synced Patient',
      mobile: '01700000000',
      patient_code: 'P-000123',
      uhid: 'UHID-123',
      diagnosis: 'must not be persisted by patient mapper',
    };
    const { env, mockDB } = createEnv();

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-patient-upsert',
          events: [
            {
              idempotencyKey: 'hospital-lan-primary:patients:123:upsert:1',
              tenantId: 'tenant-1',
              entityType: 'patients',
              entityId: '123',
              operation: 'upsert',
              payloadHash: await payloadHash(patientPayload),
              payload: patientPayload,
            },
          ],
        }),
      }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ accepted: 1, duplicates: 0, applied: 1 });

    const patientUpsert = mockDB.queries.find((query) =>
      /INSERT\s+INTO\s+patients/i.test(query.sql) && /ON\s+CONFLICT/i.test(query.sql),
    );
    expect(patientUpsert).toBeDefined();
    expect(JSON.stringify(patientUpsert?.params)).toContain('Synced Patient');
    expect(JSON.stringify(patientUpsert?.params)).not.toContain('must not be persisted');
  });

  it('applies doctor-dashboard IPD round clinical fields and resolves note by idempotency key', async () => {
    const roundPayload = {
      tenant_id: 'tenant-1',
      admission_id: 21,
      patient_id: 9,
      doctor_id: 4,
      rounded_at: '2026-06-18 14:35:00',
      doctor_name_snapshot: 'Dr Round',
      round_fee_snapshot: 700,
      entry_source: 'doctor_dashboard',
      entered_by: 99,
      idempotency_key: 'doc:018f6f64-8b4b-7d11-8f9d-cccccccccccc',
      status: 'active',
      clinical_status: 'signed',
      signed_by: 99,
      signed_at: '2026-06-18T08:40:00.000Z',
      round_summary: 'Routine round',
      patient_condition: 'stable',
      clinical_note_idempotency_key: '018f6f64-8b4b-7d11-8f9d-cccccccccccc',
    };
    const { env, mockDB } = createEnv({}, {
      queryOverride: (sql) => {
        if (/FROM\s+clinical_notes/i.test(sql)) {
          return { first: { id: 555 } };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-ipd-round-clinical',
          events: [
            {
              idempotencyKey: 'hospital-lan-primary:ipd_doctor_round:doc-round:upsert:1',
              tenantId: 'tenant-1',
              entityType: 'ipd_doctor_round',
              entityId: 'doc:018f6f64-8b4b-7d11-8f9d-cccccccccccc',
              operation: 'upsert',
              payloadHash: await payloadHash(roundPayload),
              payload: roundPayload,
            },
          ],
        }),
      }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ accepted: 1, applied: 1 });
    const noteLookup = mockDB.queries.find((query) => /FROM\s+clinical_notes/i.test(query.sql));
    expect(noteLookup?.params).toEqual([
      'tenant-1',
      9,
      '018f6f64-8b4b-7d11-8f9d-cccccccccccc',
    ]);
    const roundUpsert = mockDB.queries.find((query) =>
      /INSERT\s+INTO\s+ipd_doctor_rounds/i.test(query.sql),
    );
    expect(roundUpsert?.params).toEqual([
      'tenant-1',
      21,
      9,
      4,
      '2026-06-18 14:35:00',
      'Dr Round',
      700,
      'doctor_dashboard',
      99,
      'doc:018f6f64-8b4b-7d11-8f9d-cccccccccccc',
      'active',
      555,
      'signed',
      99,
      '2026-06-18T08:40:00.000Z',
      'Routine round',
      'stable',
      'signed',
    ]);
    expect(roundUpsert?.sql).toContain("WHERE COALESCE(ipd_doctor_rounds.clinical_status, '') <> 'signed'");
    expect(roundUpsert?.sql).toContain('ipd_doctor_rounds.signed_at IS NULL');
    expect(roundPayload).not.toHaveProperty('clinical_note_id');
  });

  it('treats an exact signed IPD round replay as an immutable no-op', async () => {
    const roundPayload = signedRoundPayload();
    const { env, mockDB } = createEnv({}, {
      queryOverride: (sql) => {
        if (/SELECT\s+id,\s+admission_id[\s\S]*FROM\s+ipd_doctor_rounds/i.test(sql)) {
          return { first: existingSignedRound() };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-signed-round-replay',
          events: [{
            idempotencyKey: 'sync-event-signed-round-replay',
            tenantId: 'tenant-1',
            entityType: 'ipd_doctor_round',
            entityId: SIGNED_ROUND_KEY,
            operation: 'upsert',
            payloadHash: await payloadHash(roundPayload),
            payload: roundPayload,
          }],
        }),
      }),
      env,
    );

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({ accepted: 1, applied: 1 });
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+ipd_doctor_rounds/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /FROM\s+clinical_notes/i.test(query.sql))).toBe(false);
  });

  it('ignores a delayed pre-sign replay after the IPD round is already signed', async () => {
    const roundPayload = signedRoundPayload({
      clinical_status: undefined,
      signed_by: undefined,
      signed_at: undefined,
      round_summary: undefined,
      patient_condition: undefined,
      clinical_note_idempotency_key: undefined,
    });
    const { env, mockDB } = createEnv({}, {
      queryOverride: (sql) => {
        if (/SELECT\s+id,\s+admission_id[\s\S]*FROM\s+ipd_doctor_rounds/i.test(sql)) {
          return { first: existingSignedRound() };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-stale-round-replay',
          events: [{
            idempotencyKey: 'sync-event-stale-round-replay',
            tenantId: 'tenant-1',
            entityType: 'ipd_doctor_round',
            entityId: SIGNED_ROUND_KEY,
            operation: 'upsert',
            payloadHash: await payloadHash(roundPayload),
            payload: roundPayload,
          }],
        }),
      }),
      env,
    );

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({ accepted: 1, applied: 1 });
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+ipd_doctor_rounds/i.test(query.sql))).toBe(false);
  });

  it('routes changed signed IPD round payloads to sync conflict review without overwriting clinical data', async () => {
    const roundPayload = signedRoundPayload({ round_summary: 'Changed after signing' });
    const { env, mockDB } = createEnv({}, {
      queryOverride: (sql) => {
        if (/SELECT\s+id,\s+admission_id[\s\S]*FROM\s+ipd_doctor_rounds/i.test(sql)) {
          return { first: existingSignedRound() };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-signed-round-conflict',
          events: [{
            idempotencyKey: 'sync-event-signed-round-conflict',
            tenantId: 'tenant-1',
            entityType: 'ipd_doctor_round',
            entityId: SIGNED_ROUND_KEY,
            operation: 'upsert',
            payloadHash: await payloadHash(roundPayload),
            payload: roundPayload,
          }],
        }),
      }),
      env,
    );

    expect(res.status).toBe(409);
    const failedStatus = mockDB.queries.find((query) => /UPDATE\s+cloud_sync_ingest_events/i.test(query.sql));
    expect(failedStatus?.params[0]).toBe('failed');
    expect(String(failedStatus?.params[1])).toMatch(/signed ipd doctor round sync conflict/i);
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+ipd_doctor_rounds/i.test(query.sql))).toBe(false);
  });

  it('blocks cancellation of an already signed IPD round during sync', async () => {
    const roundPayload = signedRoundPayload({
      status: 'cancelled',
      clinical_status: undefined,
      signed_by: undefined,
      signed_at: undefined,
      round_summary: undefined,
      patient_condition: undefined,
      clinical_note_idempotency_key: undefined,
    });
    const { env, mockDB } = createEnv({}, {
      queryOverride: (sql) => {
        if (/SELECT\s+id,\s+admission_id[\s\S]*FROM\s+ipd_doctor_rounds/i.test(sql)) {
          return { first: existingSignedRound() };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-signed-round-cancel-conflict',
          events: [{
            idempotencyKey: 'sync-event-signed-round-cancel',
            tenantId: 'tenant-1',
            entityType: 'ipd_doctor_round',
            entityId: SIGNED_ROUND_KEY,
            operation: 'upsert',
            payloadHash: await payloadHash(roundPayload),
            payload: roundPayload,
          }],
        }),
      }),
      env,
    );

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+ipd_doctor_rounds/i.test(query.sql))).toBe(false);
  });

  it('returns global patient matches to authenticated local servers from cloud only', async () => {
    const { env } = createEnv({}, {
      queryOverride(sql) {
        if (/FROM\s+global_patient_identity\s+gpi/i.test(sql)) {
          return {
            results: [{
              uhid: 'UHID-888',
              primary_name: 'Cloud Patient',
              primary_phone: '01788888888',
              primary_email: null,
              date_of_birth: '1990-01-01',
              gender: 'Male',
              claim_status: 'unclaimed',
              blood_group: 'B+',
              national_id: null,
              linked_patient_id: null,
            }],
            success: true,
            meta: {},
          };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/global-patient-lookup?tenantId=tenant-1&q=01788888888'),
      env,
    );
    const body = await res.json<{ results: Array<Record<string, unknown>> }>();

    expect(res.status).toBe(200);
    expect(body.results).toEqual([
      expect.objectContaining({
        uhid: 'UHID-888',
        primary_name: 'Cloud Patient',
        primary_phone: '01788888888',
        linked_patient_id: null,
      }),
    ]);
  });

  it('does not expose global patient lookup from local server mode', async () => {
    const { env } = createEnv({ ENVIRONMENT: 'local_server' });

    const res = await worker.fetch(
      syncRequest('/api/sync/global-patient-lookup?tenantId=tenant-1&q=01788888888'),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(403);
    expect(body).toMatchObject({ error: 'Global patient lookup is only available on the cloud sync endpoint' });
  });

  it('serves upload objects to authenticated local sync clients from cloud only', async () => {
    const { env } = createEnv({}, {
      uploads: {
        get: async () => ({
          body: new Blob(['logo-bytes']).stream(),
          httpMetadata: { contentType: 'image/png' },
        }) as unknown as R2ObjectBody,
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/uploads?key=102%2Fhospital-logo'),
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/png');
    expect(await res.text()).toBe('logo-bytes');
  });

  it('applies a medicine catalog event through the cloud sync mapper', async () => {
    const payload = {
      source: 'medex',
      brand_name: 'Napa',
      generic_name: 'Paracetamol',
      manufacturer: 'Beximco Pharmaceuticals Ltd.',
      strength: '500mg',
      dosage_form: 'Tablet',
    };
    const { env, mockDB } = createEnv();

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-medicine-catalog',
          events: [
            {
              idempotencyKey: 'hospital-lan-primary:medicine_catalog_entry:napa:upsert:1',
              tenantId: 'tenant-1',
              entityType: 'medicine_catalog_entry',
              entityId: 'napa-500mg-tablet',
              operation: 'upsert',
              payloadHash: await payloadHash(payload),
              payload,
            },
          ],
        }),
      }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ accepted: 1, duplicates: 0, applied: 1 });
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+master_drugs/i.test(query.sql))).toBe(true);
  });

  it('exports tenant-scoped cloud snapshot rows for authenticated local servers', async () => {
    const { env } = createEnv({}, {
      queryOverride(sql, params) {
        if (/PRAGMA\s+table_info\("patients"\)/i.test(sql)) {
          return {
            results: [
              { name: 'id', pk: 1 },
              { name: 'tenant_id', pk: 0 },
              { name: 'name', pk: 0 },
              { name: 'updated_at', pk: 0 },
            ],
            success: true,
            meta: {},
          };
        }
        if (/FROM\s+"patients"/i.test(sql)) {
          expect(params[0]).toBe('tenant-1');
          return {
            results: [
              { id: 101, tenant_id: 'tenant-1', name: 'Cloud Patient', updated_at: '2026-06-10 10:00:00' },
            ],
            success: true,
            meta: {},
          };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/tenant-snapshot?tenantId=tenant-1&tables=patients'),
      env,
    );
    const body = await res.json<{
      tenantId: string;
      tables: Array<{ name: string; primaryKey: string; rows: Array<Record<string, unknown>> }>;
    }>();

    expect(res.status).toBe(200);
    expect(body.tenantId).toBe('tenant-1');
    expect(body.tables).toEqual([
      {
        name: 'patients',
        primaryKey: 'id',
        rows: [
          { id: 101, tenant_id: 'tenant-1', name: 'Cloud Patient', updated_at: '2026-06-10 10:00:00' },
        ],
      },
    ]);
  });

  it('applies a cloud snapshot on local server and records pull state', async () => {
    const { env, mockDB } = createEnv({
      ENVIRONMENT: 'local_server',
      LOCAL_TENANT_ID: 'tenant-1',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
    }, {
      queryOverride(sql) {
        if (/PRAGMA\s+table_info\("patients"\)/i.test(sql)) {
          return {
            results: [
              { name: 'id', pk: 1 },
              { name: 'tenant_id', pk: 0 },
              { name: 'name', pk: 0 },
              { name: 'updated_at', pk: 0 },
            ],
            success: true,
            meta: {},
          };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/cloud-pull/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'tenant-1',
          snapshotId: 'snap-1',
          generatedAt: '2026-06-10T10:00:00.000Z',
          tables: [
            {
              name: 'patients',
              primaryKey: 'id',
              rows: [
                { id: 101, tenant_id: 'tenant-1', name: 'Cloud Patient', updated_at: '2026-06-10 10:00:00' },
              ],
            },
          ],
        }),
      }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ appliedTables: 1, appliedRows: 1, skippedTables: 0 });
    expect(mockDB.queries.some((query) =>
      /INSERT\s+OR\s+REPLACE\s+INTO\s+"patients"/i.test(query.sql)
      && JSON.stringify(query.params).includes('Cloud Patient'),
    )).toBe(true);
    expect(mockDB.queries.some((query) => /INSERT\s+OR\s+REPLACE\s+INTO\s+local_cloud_pull_state/i.test(query.sql))).toBe(true);
  });

  it('treats an identical signed IPD round cloud snapshot as an immutable local no-op', async () => {
    const cloudRound = {
      id: 700,
      ...signedRoundPayload(),
      clinical_note_id: 999,
      created_at: '2026-06-18 14:35:00',
      updated_at: '2026-06-18 14:40:00',
    };
    const { env, mockDB } = createEnv({
      ENVIRONMENT: 'local_server',
      LOCAL_TENANT_ID: 'tenant-1',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
    }, {
      queryOverride(sql) {
        if (/PRAGMA\s+table_info\("ipd_doctor_rounds"\)/i.test(sql)) {
          return { results: ipdRoundTableInfo(), success: true, meta: {} };
        }
        if (/FROM\s+ipd_doctor_rounds/i.test(sql) && /id\s+IN/i.test(sql)) {
          return { results: [existingSignedRound({ clinical_note_id: 555 })], success: true, meta: {} };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/cloud-pull/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'tenant-1',
          snapshotId: 'snap-signed-same',
          generatedAt: '2026-06-18T09:00:00.000Z',
          tables: [{ name: 'ipd_doctor_rounds', primaryKey: 'id', rows: [cloudRound] }],
        }),
      }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ appliedTables: 1, appliedRows: 0, failedTables: 0 });
    expect(mockDB.queries.some((query) =>
      /INSERT\s+OR\s+REPLACE\s+INTO\s+"ipd_doctor_rounds"/i.test(query.sql),
    )).toBe(false);
    expect(JSON.stringify(body)).not.toContain('clinical_note_id');
  });

  it('records a failed cloud-pull table instead of overwriting a changed signed local IPD round', async () => {
    const cloudRound = {
      id: 700,
      ...signedRoundPayload({ round_summary: 'Changed in cloud after signing' }),
      clinical_note_id: 999,
    };
    const { env, mockDB } = createEnv({
      ENVIRONMENT: 'local_server',
      LOCAL_TENANT_ID: 'tenant-1',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
    }, {
      queryOverride(sql) {
        if (/PRAGMA\s+table_info\("ipd_doctor_rounds"\)/i.test(sql)) {
          return { results: ipdRoundTableInfo(), success: true, meta: {} };
        }
        if (/FROM\s+ipd_doctor_rounds/i.test(sql) && /id\s+IN/i.test(sql)) {
          return { results: [existingSignedRound({ clinical_note_id: 555 })], success: true, meta: {} };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/cloud-pull/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'tenant-1',
          snapshotId: 'snap-signed-conflict',
          generatedAt: '2026-06-18T09:05:00.000Z',
          tables: [{ name: 'ipd_doctor_rounds', primaryKey: 'id', rows: [cloudRound] }],
        }),
      }),
      env,
    );
    const body = await res.json<{
      appliedTables: number;
      appliedRows: number;
      failedTables: number;
      failures: Array<{ table: string; error: string }>;
    }>();

    expect(res.status).toBe(200);
    expect(body.appliedTables).toBe(0);
    expect(body.appliedRows).toBe(0);
    expect(body.failedTables).toBe(1);
    expect(body.failures[0]).toMatchObject({
      table: 'ipd_doctor_rounds',
      error: expect.stringMatching(/signed ipd round 700 differs/i),
    });
    expect(mockDB.queries.some((query) =>
      /INSERT\s+OR\s+REPLACE\s+INTO\s+"ipd_doctor_rounds"/i.test(query.sql),
    )).toBe(false);
    const failedState = mockDB.queries.find((query) =>
      /INSERT\s+OR\s+REPLACE\s+INTO\s+local_cloud_pull_state/i.test(query.sql)
      && query.params.includes('failed'),
    );
    expect(failedState?.params).toContain('snap-signed-conflict');
  });

  it('does not import a remote signed IPD round when the local clinical note cannot be reconciled', async () => {
    const cloudRound = {
      id: 701,
      ...signedRoundPayload({ idempotency_key: 'signed-round-key-remote' }),
      clinical_note_id: 888,
    };
    const { env, mockDB } = createEnv({
      ENVIRONMENT: 'local_server',
      LOCAL_TENANT_ID: 'tenant-1',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
    }, {
      queryOverride(sql) {
        if (/PRAGMA\s+table_info\("ipd_doctor_rounds"\)/i.test(sql)) {
          return { results: ipdRoundTableInfo(), success: true, meta: {} };
        }
        if (/FROM\s+ipd_doctor_rounds/i.test(sql) && /id\s+IN/i.test(sql)) {
          return { results: [], success: true, meta: {} };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/cloud-pull/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'tenant-1',
          snapshotId: 'snap-remote-signed',
          generatedAt: '2026-06-18T09:10:00.000Z',
          tables: [{ name: 'ipd_doctor_rounds', primaryKey: 'id', rows: [cloudRound] }],
        }),
      }),
      env,
    );
    const body = await res.json<{ failedTables: number; failures: Array<{ error: string }> }>();

    expect(res.status).toBe(200);
    expect(body.failedTables).toBe(1);
    expect(body.failures[0].error).toMatch(/explicit clinical-note reconciliation/i);
    expect(mockDB.queries.some((query) =>
      /INSERT\s+OR\s+REPLACE\s+INTO\s+"ipd_doctor_rounds"/i.test(query.sql),
    )).toBe(false);
  });

  it('runs local cloud-pull by fetching a cloud snapshot and applying it locally', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      tenantId: 'tenant-1',
      snapshotId: 'snap-2',
      generatedAt: '2026-06-10T10:05:00.000Z',
      tables: [
        {
          name: 'patients',
          primaryKey: 'id',
          rows: [
            { id: 102, tenant_id: 'tenant-1', name: 'Pulled Patient', updated_at: '2026-06-10 10:05:00' },
          ],
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { env, mockDB } = createEnv({
      ENVIRONMENT: 'local_server',
      LOCAL_TENANT_ID: 'tenant-1',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
      CLOUD_SYNC_BASE_URL: 'https://cloud.example.test',
    }, {
      queryOverride(sql) {
        if (/PRAGMA\s+table_info\("patients"\)/i.test(sql)) {
          return {
            results: [
              { name: 'id', pk: 1 },
              { name: 'tenant_id', pk: 0 },
              { name: 'name', pk: 0 },
              { name: 'updated_at', pk: 0 },
            ],
            success: true,
            meta: {},
          };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/cloud-pull/run', { method: 'POST' }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ appliedTables: 1, appliedRows: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cloud.example.test/api/sync/tenant-snapshot?tenantId=tenant-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer cloud-sync-secret',
        }),
      }),
    );
    expect(mockDB.queries.some((query) =>
      /INSERT\s+OR\s+REPLACE\s+INTO\s+"patients"/i.test(query.sql)
      && JSON.stringify(query.params).includes('Pulled Patient'),
    )).toBe(true);
  });

  it('reports local cloud-pull status without exposing row payloads', async () => {
    const { env } = createEnv({
      ENVIRONMENT: 'local_server',
      LOCAL_TENANT_ID: 'tenant-1',
    }, {
      queryOverride(sql) {
        if (/FROM\s+local_cloud_pull_state/i.test(sql)) {
          return {
            results: [
              {
                table_name: 'patients',
                last_snapshot_id: 'snap-2',
                last_pulled_at: '2026-06-10 10:05:00',
                rows_received: 1,
                rows_applied: 1,
                status: 'applied',
                last_error: null,
              },
            ],
            success: true,
            meta: {},
          };
        }
        return null;
      },
    });

    const res = await worker.fetch(syncRequest('/api/sync/cloud-pull/status'), env);
    const body = await res.json<{ tables: Array<Record<string, unknown>> }>();

    expect(res.status).toBe(200);
    expect(body.tables).toEqual([
      {
        tableName: 'patients',
        lastSnapshotId: 'snap-2',
        lastPulledAt: '2026-06-10 10:05:00',
        rowsReceived: 1,
        rowsApplied: 1,
        status: 'applied',
        lastError: null,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('Pulled Patient');
  });

  it('counts a verified already-applied ingest receipt as a duplicate without reapplying it', async () => {
    const { env, mockDB } = createEnv({}, {
      ingestChanges: 0,
      queryOverride(sql) {
        if (/SELECT\s+server_id,\s+tenant_id/i.test(sql) && /cloud_sync_ingest_events/i.test(sql)) {
          return {
            first: {
              server_id: 'hospital-lan-primary',
              tenant_id: 'tenant-1',
              entity_type: 'billing',
              entity_id: '456',
              operation: 'update',
              payload_hash: 'b'.repeat(64),
              apply_status: 'applied',
            },
          };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-duplicate',
          events: [
            {
              idempotencyKey: 'hospital-lan-primary:billing:456:update:1',
              tenantId: 'tenant-1',
              entityType: 'billing',
              entityId: '456',
              operation: 'update',
              payloadHash: 'b'.repeat(64),
            },
          ],
        }),
      }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ accepted: 0, duplicates: 1, retried: 0, applied: 0 });
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+patients/i.test(query.sql))).toBe(false);
  });


  it('self-heals a missing patient mapping from an already-applied duplicate receipt', async () => {
    const patientPayload = {
      id: 321,
      tenant_id: 'tenant-1',
      name: 'Legacy Applied Patient',
      patient_code: 'P-00321',
      uhid: 'UHID-321',
    };
    const eventHash = await payloadHash(patientPayload);
    const { env, mappingRows } = createEnv({}, {
      ingestChanges: 0,
      queryOverride(sql) {
        if (/SELECT\s+server_id,\s+tenant_id/i.test(sql) && /cloud_sync_ingest_events/i.test(sql)) {
          return {
            first: {
              server_id: 'hospital-lan-primary',
              tenant_id: 'tenant-1',
              entity_type: 'patients',
              entity_id: '321',
              operation: 'upsert',
              payload_hash: eventHash,
              apply_status: 'applied',
              apply_error: null,
            },
          };
        }
        return null;
      },
    });

    const response = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-legacy-mapping-heal',
          events: [{
            idempotencyKey: 'hospital-lan-primary:patients:321:upsert:legacy',
            tenantId: 'tenant-1',
            entityType: 'patients',
            entityId: '321',
            operation: 'upsert',
            payloadHash: eventHash,
            payload: patientPayload,
          }],
        }),
      }),
      env,
    );
    const body = await response.json() as {
      entityMappings?: Array<Record<string, unknown>>;
      duplicates?: number;
    };

    expect(response.status).toBe(202);
    expect(body.duplicates).toBe(1);
    expect(body.entityMappings).toEqual([
      expect.objectContaining({
        serverId: 'hospital-lan-primary',
        tenantId: 'tenant-1',
        entityType: 'patients',
        localEntityId: '321',
      }),
    ]);
    expect(mappingRows).toHaveLength(1);
  });

  it('reapplies a matching failed cloud ingest receipt instead of exporting a false duplicate success', async () => {
    const patientPayload = {
      id: 321,
      tenant_id: 'tenant-1',
      name: 'Retry Patient',
      mobile: '01700000321',
    };
    const eventHash = await payloadHash(patientPayload);
    let ingestInsertCount = 0;
    let patientApplyCount = 0;
    let receiptStatus = 'metadata_only';
    let receiptError: string | null = null;

    const { env, mockDB } = createEnv({}, {
      queryOverride(sql, params) {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.startsWith('insert or ignore into cloud_sync_ingest_events')) {
          ingestInsertCount += 1;
          return { success: true, meta: { changes: ingestInsertCount === 1 ? 1 : 0 } };
        }
        if (normalized.startsWith('select server_id, tenant_id') && normalized.includes('from cloud_sync_ingest_events')) {
          return {
            first: {
              server_id: 'hospital-lan-primary',
              tenant_id: 'tenant-1',
              entity_type: 'patients',
              entity_id: '321',
              operation: 'upsert',
              payload_hash: eventHash,
              apply_status: receiptStatus,
              apply_error: receiptError,
            },
          };
        }
        if (normalized.startsWith('insert into patients')) {
          patientApplyCount += 1;
          if (patientApplyCount === 1) throw new Error('temporary patient apply failure');
          return null;
        }
        if (normalized.startsWith('update cloud_sync_ingest_events') && normalized.includes('set apply_error = ?')) {
          if (String(params[2]) !== receiptStatus || String(params[3] ?? '') !== String(receiptError ?? '')) {
            return { first: null };
          }
          receiptError = String(params[0]);
          return { first: { id: 1 } };
        }
        if (normalized.startsWith('update cloud_sync_ingest_events')) {
          receiptStatus = String(params[0]);
          receiptError = params[1] == null ? null : String(params[1]);
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const requestBody = {
      serverId: 'hospital-lan-primary',
      batchId: 'batch-retry-1',
      events: [{
        idempotencyKey: 'hospital-lan-primary:patients:321:upsert:retry',
        tenantId: 'tenant-1',
        entityType: 'patients',
        entityId: '321',
        operation: 'upsert',
        payloadHash: eventHash,
        payload: patientPayload,
      }],
    };

    const first = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }),
      env,
    );
    expect(first.status).toBe(500);
    expect(receiptStatus).toBe('failed');

    const second = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, batchId: 'batch-retry-2' }),
      }),
      env,
    );
    const body = await second.json<Record<string, unknown>>();

    expect(second.status).toBe(202);
    expect(body).toMatchObject({ accepted: 0, duplicates: 1, retried: 1, applied: 1 });
    expect(patientApplyCount).toBe(2);
    expect(receiptStatus).toBe('applied');
  });

  it('rejects a duplicate receipt while another cloud apply lease is still active', async () => {
    const activeMarker = `PROCESSING:${Date.now()}:active-owner`;
    const { env, mockDB } = createEnv({}, {
      ingestChanges: 0,
      queryOverride(sql) {
        if (/SELECT\s+server_id,\s+tenant_id/i.test(sql) && /cloud_sync_ingest_events/i.test(sql)) {
          return {
            first: {
              server_id: 'hospital-lan-primary',
              tenant_id: 'tenant-1',
              entity_type: 'patients',
              entity_id: '321',
              operation: 'upsert',
              payload_hash: 'd'.repeat(64),
              apply_status: 'metadata_only',
              apply_error: activeMarker,
            },
          };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-active-processing',
          events: [{
            idempotencyKey: 'hospital-lan-primary:patients:321:active-processing',
            tenantId: 'tenant-1',
            entityType: 'patients',
            entityId: '321',
            operation: 'upsert',
            payloadHash: 'd'.repeat(64),
          }],
        }),
      }),
      env,
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/already being applied/i),
    });
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+patients/i.test(query.sql))).toBe(false);
  });

  it('does not apply a failed receipt when another retry wins the compare-and-swap claim', async () => {
    const { env, mockDB } = createEnv({}, {
      ingestChanges: 0,
      queryOverride(sql) {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.startsWith('select server_id, tenant_id') && normalized.includes('from cloud_sync_ingest_events')) {
          return {
            first: {
              server_id: 'hospital-lan-primary',
              tenant_id: 'tenant-1',
              entity_type: 'patients',
              entity_id: '321',
              operation: 'upsert',
              payload_hash: 'e'.repeat(64),
              apply_status: 'failed',
              apply_error: 'temporary apply failure',
            },
          };
        }
        if (normalized.startsWith('update cloud_sync_ingest_events') && normalized.includes('set apply_error = ?')) {
          return { first: null };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-retry-claim-lost',
          events: [{
            idempotencyKey: 'hospital-lan-primary:patients:321:claim-lost',
            tenantId: 'tenant-1',
            entityType: 'patients',
            entityId: '321',
            operation: 'upsert',
            payloadHash: 'e'.repeat(64),
          }],
        }),
      }),
      env,
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/already being claimed/i),
    });
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+patients/i.test(query.sql))).toBe(false);
  });

  it('rejects reuse of a sync idempotency key for different event metadata or payload', async () => {
    const { env, mockDB } = createEnv({}, {
      ingestChanges: 0,
      queryOverride(sql) {
        if (/SELECT\s+server_id,\s+tenant_id/i.test(sql) && /cloud_sync_ingest_events/i.test(sql)) {
          return {
            first: {
              server_id: 'hospital-lan-primary',
              tenant_id: 'tenant-1',
              entity_type: 'patients',
              entity_id: '999',
              operation: 'upsert',
              payload_hash: 'a'.repeat(64),
              apply_status: 'failed',
            },
          };
        }
        return null;
      },
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: 'hospital-lan-primary',
          batchId: 'batch-key-conflict',
          events: [{
            idempotencyKey: 'hospital-lan-primary:patients:shared-key',
            tenantId: 'tenant-1',
            entityType: 'patients',
            entityId: '321',
            operation: 'upsert',
            payloadHash: 'b'.repeat(64),
          }],
        }),
      }),
      env,
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/different event/i),
    });
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+patients/i.test(query.sql))).toBe(false);
  });

  it('flushes pending local outbox payloads to the cloud ingest endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        accepted: 1,
        duplicates: 0,
        batchId: 'cloud-batch',
        entityMappings: [{
          serverId: 'hospital-lan-primary',
          tenantId: 'tenant-1',
          entityType: 'patients',
          localEntityId: '123',
          cloudEntityId: '1000',
          naturalKey: null,
        }],
      }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const { env, mockDB, mappingRows } = createEnv({
      ENVIRONMENT: 'local_server',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
      CLOUD_SYNC_BASE_URL: 'https://cloud.example.test',
    });
    const outboxRows = [
      {
        id: 10,
        tenant_id: 'tenant-1',
        entity_type: 'patients',
        entity_id: '123',
        operation: 'update',
        payload_hash: 'c'.repeat(64),
        idempotency_key: 'hospital-lan-primary:patients:123:update:1',
        payload_json: JSON.stringify({ id: 123, tenant_id: 'tenant-1', name: 'Local Patient' }),
      },
    ];
    mockDB.reset();
    const originalPrepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      if (/FROM\s+local_sync_outbox/i.test(sql)) {
        return {
          bind: () => ({
            all: async () => ({ results: outboxRows, success: true, meta: {} }),
          }),
        } as unknown as D1PreparedStatement;
      }
      return originalPrepare(sql);
    });

    const res = await worker.fetch(
      syncRequest('/api/sync/outbox/flush', { method: 'POST' }),
      env,
    );
    const body = await res.json<Record<string, unknown>>();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ attempted: 1, exported: 1, failed: 0, entityMappings: 1 });
    expect(mappingRows).toEqual([expect.objectContaining({
      server_id: 'hospital-lan-primary',
      tenant_id: 'tenant-1',
      entity_type: 'patients',
      local_entity_id: '123',
      cloud_entity_id: '1000',
    })]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cloud.example.test/api/sync/ingest',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer cloud-sync-secret',
          'Content-Type': 'application/json',
        }),
      }),
    );

    const postedBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(postedBody).toMatchObject({
      serverId: 'hospital-lan-primary',
      events: [
        {
          tenantId: 'tenant-1',
          entityType: 'patients',
          entityId: '123',
          operation: 'update',
          payloadHash: 'c'.repeat(64),
          idempotencyKey: 'hospital-lan-primary:patients:123:update:1',
          payload: { id: 123, tenant_id: 'tenant-1', name: 'Local Patient' },
        },
      ],
    });
    expect(Object.prototype.hasOwnProperty.call(postedBody.events[0], 'payload')).toBe(true);

    const update = mockDB.queries.find((query) =>
      /UPDATE\s+local_sync_outbox\s+SET\s+status\s*=\s*'exported'/i.test(query.sql),
    );
    expect(update).toBeDefined();
  });

  it('does not export a patient outbox event when cloud does not confirm the entity mapping', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ accepted: 1, duplicates: 0, batchId: 'cloud-batch', entityMappings: [] }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const { env, mockDB, mappingRows } = createEnv({
      ENVIRONMENT: 'local_server',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
      CLOUD_SYNC_BASE_URL: 'https://cloud.example.test',
    });
    const outboxRows = [{
      id: 11,
      tenant_id: 'tenant-1',
      entity_type: 'patients',
      entity_id: '123',
      operation: 'update',
      payload_hash: 'd'.repeat(64),
      idempotency_key: 'hospital-lan-primary:patients:123:update:missing-map',
      payload_json: JSON.stringify({ id: 123, tenant_id: 'tenant-1', name: 'Local Patient' }),
    }];
    const originalPrepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      if (/FROM\s+local_sync_outbox/i.test(sql)) {
        return {
          bind: () => ({
            all: async () => ({ results: outboxRows, success: true, meta: {} }),
          }),
        } as unknown as D1PreparedStatement;
      }
      return originalPrepare(sql);
    });

    const response = await worker.fetch(syncRequest('/api/sync/outbox/flush', { method: 'POST' }), env);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ attempted: 1, exported: 0, failed: 1 });
    expect(mappingRows).toHaveLength(0);
    expect(mockDB.queries.some((query) =>
      /UPDATE\s+local_sync_outbox[\s\S]*status\s*=\s*'exported'/i.test(query.sql),
    )).toBe(false);
    expect(mockDB.queries.some((query) =>
      /UPDATE\s+local_sync_outbox[\s\S]*status\s*=\s*CASE/i.test(query.sql),
    )).toBe(true);
  });
});
