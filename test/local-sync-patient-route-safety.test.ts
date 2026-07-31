import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { createMockDB, createMockKV } from './integration/helpers/mock-db';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

const syncToken = ['cloud', 'sync', 'test'].join('-');

function createEnv(
  queryOverride?: (sql: string, params: unknown[]) => Record<string, unknown> | null,
  overrides: Partial<Env> = {},
  seed: {
    patients?: Array<{ id: number; tenant_id: string; patient_code: string | null; uhid: string | null; sync_key: string | null; name: string }>;
    mappings?: Array<{ server_id: string; tenant_id: string; entity_type: string; local_entity_id: string; cloud_entity_id: string; natural_key: string | null }>;
  } = {},
) {
  const patients = (seed.patients ?? []).map((row) => ({ ...row }));
  const mappings = (seed.mappings ?? []).map((row) => ({ ...row }));
  let nextPatientId = Math.max(999, ...patients.map((row) => row.id)) + 1;

  const mockDB = createMockDB({
    queryOverride(sql, params) {
      const override = queryOverride?.(sql, params);
      if (override) return override;
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (/INSERT\s+OR\s+IGNORE\s+INTO\s+cloud_sync_ingest_events/i.test(sql)) {
        return { success: true, meta: { changes: 1 } };
      }
      if (normalized.includes('from sync_entity_mappings') && normalized.includes('local_entity_id = ?')) {
        const [serverId, tenantId, entityType, localId] = params.map(String);
        return { first: mappings.find((row) => row.server_id === serverId && row.tenant_id === tenantId && row.entity_type === entityType && row.local_entity_id === localId) ?? null };
      }
      if (normalized.includes('from sync_entity_mappings') && normalized.includes('cloud_entity_id = ?')) {
        const [serverId, tenantId, entityType, cloudId] = params.map(String);
        return { first: mappings.find((row) => row.server_id === serverId && row.tenant_id === tenantId && row.entity_type === entityType && row.cloud_entity_id === cloudId) ?? null };
      }
      if (normalized.startsWith('insert or ignore into sync_entity_mappings')) {
        const [serverId, tenantId, entityType, localId, cloudId, naturalKey] = params.map((value) => value == null ? null : String(value));
        const duplicate = mappings.some((row) => row.server_id === serverId && row.tenant_id === tenantId && row.entity_type === entityType && (row.local_entity_id === localId || row.cloud_entity_id === cloudId));
        if (!duplicate) mappings.push({ server_id: serverId!, tenant_id: tenantId!, entity_type: entityType!, local_entity_id: localId!, cloud_entity_id: cloudId!, natural_key: naturalKey });
        return { success: true, meta: { changes: duplicate ? 0 : 1 } };
      }
      if (normalized.startsWith('update sync_entity_mappings')) {
        return { success: true, meta: { changes: 1 } };
      }
      if (normalized.includes('from patients') && normalized.includes('where tenant_id = ? and sync_key = ?')) {
        const [tenantId, syncKey] = params.map(String);
        return { first: patients.find((row) => row.tenant_id === tenantId && row.sync_key === syncKey) ?? null };
      }
      if (normalized.includes('from patients') && normalized.includes('where id = ? and tenant_id = ?')) {
        const [id, tenantId] = params;
        return { first: patients.find((row) => row.id === Number(id) && row.tenant_id === String(tenantId)) ?? null };
      }
      if (normalized.includes('from patients') && normalized.includes(' id in ')) {
        const requested = new Set(params.map(String));
        return { results: patients.filter((row) => requested.has(String(row.id))) };
      }
      if (normalized.includes('from patients') && normalized.includes(' uhid in ')) {
        const [tenantId, ...values] = params.map(String);
        const requested = new Set(values);
        return { results: patients.filter((row) => row.tenant_id === tenantId && row.uhid && requested.has(row.uhid)) };
      }
      if (normalized.includes('from patients') && normalized.includes(' patient_code in ')) {
        const [tenantId, ...values] = params.map(String);
        const requested = new Set(values);
        return { results: patients.filter((row) => row.tenant_id === tenantId && row.patient_code && requested.has(row.patient_code)) };
      }
      if (normalized.includes('from patients') && normalized.includes('upper(trim(uhid))')) {
        const [tenantId, rawUhid, , rawCode] = params;
        const uhid = rawUhid == null ? null : String(rawUhid).trim().toUpperCase();
        const code = rawCode == null ? null : String(rawCode).trim().toUpperCase();
        return { results: patients.filter((row) => row.tenant_id === String(tenantId) && ((uhid && row.uhid?.trim().toUpperCase() === uhid) || (code && row.patient_code?.trim().toUpperCase() === code))).slice(0, 3) };
      }
      if (normalized.startsWith('insert into patients') && normalized.includes('on conflict(tenant_id, sync_key)')) {
        const [tenantId, syncKey, name, , , , , code, uhid] = params;
        let patient = patients.find((row) => row.tenant_id === String(tenantId) && row.sync_key === String(syncKey));
        if (!patient) {
          patient = { id: nextPatientId++, tenant_id: String(tenantId), patient_code: code == null ? null : String(code), uhid: uhid == null ? null : String(uhid), sync_key: String(syncKey), name: String(name) };
          patients.push(patient);
        } else {
          patient.name = String(name);
          patient.patient_code = code == null ? null : String(code);
          patient.uhid = uhid == null ? null : String(uhid);
        }
        return { first: patient };
      }
      if (normalized.startsWith('update patients set sync_key = coalesce')) {
        const syncKey = String(params[0]); const name = String(params[1]); const code = params[6] == null ? null : String(params[6]); const uhid = params[7] == null ? null : String(params[7]); const id = Number(params[12]); const tenantId = String(params[13]); const expected = String(params[14]);
        const patient = patients.find((row) => row.id === id && row.tenant_id === tenantId && (row.sync_key == null || row.sync_key === expected));
        if (!patient) return { first: null };
        patient.sync_key ??= syncKey; patient.name = name; patient.patient_code = code; patient.uhid = uhid;
        return { first: patient };
      }
      if (normalized.startsWith('update patients set sync_key = ?, updated_at')) {
        const [syncKey, id, tenantId] = params.map(String); const patient = patients.find((row) => row.id === Number(id) && row.tenant_id === tenantId && row.sync_key == null);
        if (!patient) return { first: null }; patient.sync_key = syncKey; return { first: patient };
      }
      return null;
    },
  });
  const env = { DB: mockDB.db, KV: createMockKV().kv, UPLOADS: { list: async () => ({ objects: [], truncated: false }), get: async () => null, put: async () => undefined, delete: async () => undefined }, ASSETS: { fetch: async () => new Response('asset') }, JWT_SECRET: ['wt', 'test'].join('-'), ENVIRONMENT: 'production', ALLOWED_ORIGINS: '', CLOUD_SYNC_TOKEN: syncToken, ...overrides } as unknown as Env;
  return { env, mockDB, patients, mappings };
}

function request(body: unknown) {
  return new Request('http://localhost/api/sync/ingest', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${syncToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(',')}}`;
}

async function hash(payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(payload)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function ingest(entityType: string, entityId: string, payload: Record<string, unknown>, env: Env) {
  return worker.fetch(request({
    serverId: 'hospital-lan-primary',
    batchId: `batch-${entityType}-${entityId}`,
    events: [{
      idempotencyKey: `sync-${entityType}-${entityId}`,
      tenantId: 'tenant-1',
      entityType,
      entityId,
      operation: 'upsert',
      payloadHash: await hash(payload),
      payload,
    }],
  }), env);
}

describe('local-server patient cloud apply identity safety', () => {
  it('maps a local numeric patient ID to a different cloud ID instead of colliding', async () => {
    const payload = { id: 123, tenant_id: 'tenant-1', name: 'Patient', patient_code: 'P-000123', uhid: 'UHID-123' };
    const { env, patients, mappings } = createEnv(undefined, {}, {
      patients: [{
        id: 123,
        tenant_id: 'tenant-2',
        patient_code: 'P-OTHER',
        uhid: 'UHID-OTHER',
        sync_key: null,
        name: 'Other Tenant Patient',
      }],
    });

    const response = await ingest('patients', '123', payload, env);
    const body = await response.json() as { entityMappings?: Array<Record<string, unknown>> };

    expect(response.status).toBe(202);
    expect(patients).toHaveLength(2);
    expect(body.entityMappings).toContainEqual(expect.objectContaining({
      serverId: 'hospital-lan-primary',
      tenantId: 'tenant-1',
      entityType: 'patients',
      localEntityId: '123',
      cloudEntityId: String(patients[1]!.id),
    }));
    expect(body.entityMappings?.[0]).not.toHaveProperty('naturalKey');
    expect(JSON.stringify(body)).not.toContain('UHID-123');
    expect(mappings).toHaveLength(1);
  });

  it('blocks a different UHID from mutating an already mapped cloud patient', async () => {
    const payload = { id: 123, tenant_id: 'tenant-1', name: 'Patient', patient_code: 'P-000123', uhid: 'UHID-NEW' };
    const { env } = createEnv(undefined, {}, {
      patients: [{
        id: 900,
        tenant_id: 'tenant-1',
        patient_code: 'P-000123',
        uhid: 'UHID-EXISTING',
        sync_key: 'uhid:UHID-EXISTING',
        name: 'Existing Patient',
      }],
      mappings: [{
        server_id: 'hospital-lan-primary',
        tenant_id: 'tenant-1',
        entity_type: 'patients',
        local_entity_id: '123',
        cloud_entity_id: '900',
        natural_key: 'uhid:UHID-EXISTING',
      }],
    });

    const response = await ingest('patients', '123', payload, env);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/uhid conflicts/i) });
  });

  it('blocks ambiguous UHID and patient code matches from choosing a cloud patient', async () => {
    const payload = { id: 123, tenant_id: 'tenant-1', name: 'Patient', patient_code: 'P-000123', uhid: 'UHID-123' };
    const { env } = createEnv(undefined, {}, {
      patients: [
        { id: 801, tenant_id: 'tenant-1', patient_code: 'P-000123', uhid: null, sync_key: null, name: 'Code Match' },
        { id: 802, tenant_id: 'tenant-1', patient_code: null, uhid: 'UHID-123', sync_key: null, name: 'UHID Match' },
      ],
    });

    const response = await ingest('patients', '123', payload, env);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/multiple cloud patient records/i) });
  });

  it('blocks a patient health link when its patient ID is not mapped in cloud', async () => {
    const payload = { tenant_id: 'tenant-1', patient_id: 123, uhid: 'UHID-123', national_id: 'NID-123' };
    const { env, mockDB } = createEnv((sql) => {
      if (/SELECT\s+id,\s+uhid\s+FROM\s+patients/i.test(sql)) return { first: null };
      return null;
    });

    const response = await ingest('patient_health_links', 'tenant-1:123:UHID-123', payload, env);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/no stable local-to-cloud patient mapping/i) });
    expect(mockDB.queries.some((query) => /INSERT\s+OR\s+IGNORE\s+INTO\s+patient_health_links/i.test(query.sql))).toBe(false);
  });

  it('applies a mapped cloud patient snapshot using the original local patient ID', async () => {
    const { env, mockDB, mappings } = createEnv((sql) => {
      if (/PRAGMA\s+table_info\("patients"\)/i.test(sql)) {
        return {
          results: [
            { name: 'id', pk: 1 },
            { name: 'tenant_id', pk: 0 },
            { name: 'name', pk: 0 },
            { name: 'patient_code', pk: 0 },
            { name: 'uhid', pk: 0 },
            { name: 'sync_key', pk: 0 },
          ],
        };
      }
      return null;
    }, {
      ENVIRONMENT: 'local_server',
      LOCAL_TENANT_ID: 'tenant-1',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
    }, {
      patients: [{
        id: 123,
        tenant_id: 'tenant-1',
        patient_code: 'P-000123',
        uhid: 'UHID-123',
        sync_key: 'uhid:UHID-123',
        name: 'Local Patient',
      }],
      mappings: [{
        server_id: 'hospital-lan-primary',
        tenant_id: 'tenant-1',
        entity_type: 'patients',
        local_entity_id: '123',
        cloud_entity_id: '900',
        natural_key: 'uhid:UHID-123',
      }],
    });

    const response = await worker.fetch(new Request('http://localhost/api/sync/cloud-pull/apply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${syncToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantId: 'tenant-1',
        snapshotId: 'snapshot-mapped-patient',
        generatedAt: '2026-07-11T02:00:00.000Z',
        tables: [{
          name: 'patients',
          primaryKey: 'id',
          rows: [{
            id: 900,
            tenant_id: 'tenant-1',
            name: 'Cloud Updated Patient',
            patient_code: 'P-000123',
            uhid: 'UHID-123',
            sync_key: 'uhid:UHID-123',
          }],
        }],
      }),
    }), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ appliedTables: 1, appliedRows: 1, failedTables: 0 });
    const patientUpsert = mockDB.queries.find((query) =>
      /INSERT\s+OR\s+REPLACE\s+INTO\s+"patients"/i.test(query.sql),
    );
    expect(patientUpsert?.params[0]).toBe(123);
    expect(mappings).toEqual([expect.objectContaining({ local_entity_id: '123', cloud_entity_id: '900' })]);
  });

  it('records a failed cloud-pull table when the numeric patient ID belongs to another local tenant', async () => {
    const incomingPatient = {
      id: 41,
      tenant_id: 'tenant-1',
      name: 'Cloud Patient',
      patient_code: 'P-000041',
      uhid: 'UHID-041',
    };
    const { env, mockDB } = createEnv((sql) => {
      if (/PRAGMA\s+table_info\("patients"\)/i.test(sql)) {
        return {
          results: [
            { name: 'id', pk: 1 },
            { name: 'tenant_id', pk: 0 },
            { name: 'name', pk: 0 },
            { name: 'patient_code', pk: 0 },
            { name: 'uhid', pk: 0 },
          ],
        };
      }
      if (/FROM\s+patients/i.test(sql) && /\bid\s+IN\s*\(/i.test(sql)) {
        return { results: [{ id: 41, tenant_id: 'tenant-2', patient_code: 'P-OTHER', uhid: 'UHID-OTHER' }] };
      }
      if (/FROM\s+patients/i.test(sql) && /\buhid\s+IN\s*\(/i.test(sql)) return { results: [] };
      if (/FROM\s+patients/i.test(sql) && /patient_code\s+IN\s*\(/i.test(sql)) return { results: [] };
      return null;
    }, {
      ENVIRONMENT: 'local_server',
      LOCAL_TENANT_ID: 'tenant-1',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
    });

    const response = await worker.fetch(new Request('http://localhost/api/sync/cloud-pull/apply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${syncToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantId: 'tenant-1',
        snapshotId: 'snapshot-patient-cross-tenant-id',
        generatedAt: '2026-07-11T01:00:00.000Z',
        tables: [{ name: 'patients', primaryKey: 'id', rows: [incomingPatient] }],
      }),
    }), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      appliedTables: 0,
      appliedRows: 0,
      failedTables: 1,
      failures: [{ table: 'patients', error: expect.stringMatching(/belongs to another local tenant/i) }],
    });
    expect(mockDB.queries.some((query) => /INSERT\s+OR\s+REPLACE\s+INTO\s+"patients"/i.test(query.sql))).toBe(false);
  });

  it('records a failed cloud-pull table instead of replacing a conflicting local patient identity', async () => {
    const incomingPatient = {
      id: 41,
      tenant_id: 'tenant-1',
      name: 'Cloud Patient',
      patient_code: 'P-000041',
      uhid: 'UHID-041',
    };
    const { env, mockDB } = createEnv((sql) => {
      if (/PRAGMA\s+table_info\("patients"\)/i.test(sql)) {
        return {
          results: [
            { name: 'id', pk: 1 },
            { name: 'tenant_id', pk: 0 },
            { name: 'name', pk: 0 },
            { name: 'patient_code', pk: 0 },
            { name: 'uhid', pk: 0 },
          ],
        };
      }
      if (/FROM\s+patients/i.test(sql) && /\bid\s+IN\s*\(/i.test(sql)) {
        return { results: [{ id: 41, tenant_id: 'tenant-1', patient_code: 'P-LOCAL-041', uhid: 'UHID-LOCAL-041' }] };
      }
      if (/FROM\s+patients/i.test(sql) && /\buhid\s+IN\s*\(/i.test(sql)) return { results: [] };
      if (/FROM\s+patients/i.test(sql) && /patient_code\s+IN\s*\(/i.test(sql)) return { results: [] };
      return null;
    }, {
      ENVIRONMENT: 'local_server',
      LOCAL_TENANT_ID: 'tenant-1',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
    });

    const response = await worker.fetch(new Request('http://localhost/api/sync/cloud-pull/apply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${syncToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantId: 'tenant-1',
        snapshotId: 'snapshot-patient-collision',
        generatedAt: '2026-07-11T01:00:00.000Z',
        tables: [{ name: 'patients', primaryKey: 'id', rows: [incomingPatient] }],
      }),
    }), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      appliedTables: 0,
      appliedRows: 0,
      failedTables: 1,
      failures: [{ table: 'patients', error: expect.stringMatching(/uhid conflicts/i) }],
    });
    expect(mockDB.queries.some((query) => /INSERT\s+OR\s+REPLACE\s+INTO\s+"patients"/i.test(query.sql))).toBe(false);
  });
});
