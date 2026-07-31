import { describe, expect, it } from 'vitest';
import {
  buildPatientSyncKey,
  recoverLegacyAppliedPatientMapping,
  resolveMappedCloudPatientId,
  translatePatientSnapshotRows,
  upsertMappedCloudPatient,
  type LocalSyncPatientPayload,
} from '../src/lib/local-sync-patient-mapping';

type PatientRow = {
  id: number;
  tenant_id: string;
  patient_code: string | null;
  uhid: string | null;
  sync_key: string | null;
  name: string;
  father_husband: string;
  address: string;
};

type MappingRow = {
  server_id: string;
  tenant_id: string;
  entity_type: string;
  local_entity_id: string;
  cloud_entity_id: string;
  natural_key: string | null;
};

function createDatabase(initialPatients: PatientRow[] = [], initialMappings: MappingRow[] = []) {
  const patients = initialPatients.map((row) => ({ ...row }));
  const mappings = initialMappings.map((row) => ({ ...row }));
  let nextPatientId = Math.max(0, ...patients.map((row) => row.id)) + 1;

  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
          return {
            async first<T>() {
              if (normalized.includes('from sync_entity_mappings') && normalized.includes('local_entity_id = ?')) {
                const [serverId, tenantId, entityType, localId] = params.map(String);
                return (mappings.find((row) => row.server_id === serverId
                  && row.tenant_id === tenantId
                  && row.entity_type === entityType
                  && row.local_entity_id === localId) ?? null) as T | null;
              }
              if (normalized.includes('from sync_entity_mappings') && normalized.includes('cloud_entity_id = ?')) {
                const [serverId, tenantId, entityType, cloudId] = params.map(String);
                return (mappings.find((row) => row.server_id === serverId
                  && row.tenant_id === tenantId
                  && row.entity_type === entityType
                  && row.cloud_entity_id === cloudId) ?? null) as T | null;
              }
              if (normalized.includes('from patients') && normalized.includes('where id = ? and tenant_id = ?')) {
                const [id, tenantId] = params;
                return (patients.find((row) => row.id === Number(id) && row.tenant_id === String(tenantId)) ?? null) as T | null;
              }
              if (normalized.includes('from patients') && normalized.includes('where tenant_id = ? and sync_key = ?')) {
                const [tenantId, syncKey] = params.map(String);
                return (patients.find((row) => row.tenant_id === tenantId && row.sync_key === syncKey) ?? null) as T | null;
              }
              if (normalized.startsWith('update patients set sync_key = ?, updated_at')) {
                const [syncKey, id, tenantId] = params.map(String);
                const patient = patients.find((row) => row.id === Number(id) && row.tenant_id === tenantId && row.sync_key == null);
                if (!patient) return null as T | null;
                if (patients.some((row) => row.tenant_id === tenantId && row.sync_key === syncKey && row.id !== patient.id)) {
                  throw new Error('UNIQUE constraint failed: patients.tenant_id, patients.sync_key');
                }
                patient.sync_key = syncKey;
                return patient as T;
              }
              if (normalized.startsWith('insert into patients') && normalized.includes('on conflict(tenant_id, sync_key)')) {
                const [tenantId, syncKey, name, fatherHusband, address, , , patientCode, uhid] = params;
                let patient = patients.find((row) => row.tenant_id === String(tenantId) && row.sync_key === String(syncKey));
                if (!patient) {
                  patient = {
                    id: nextPatientId++,
                    tenant_id: String(tenantId),
                    patient_code: patientCode == null ? null : String(patientCode),
                    uhid: uhid == null ? null : String(uhid),
                    sync_key: String(syncKey),
                    name: String(name),
                    father_husband: String(fatherHusband),
                    address: String(address),
                  };
                  patients.push(patient);
                } else {
                  patient.name = String(name);
                  patient.father_husband = String(fatherHusband);
                  patient.address = String(address);
                  patient.patient_code = patientCode == null ? null : String(patientCode);
                  patient.uhid = uhid == null ? null : String(uhid);
                }
                return patient as T;
              }
              if (normalized.startsWith('update patients set sync_key = coalesce')) {
                const syncKey = String(params[0]);
                const name = String(params[1]);
                const fatherHusband = String(params[2]);
                const address = String(params[3]);
                const patientCode = params[6] == null ? null : String(params[6]);
                const uhid = params[7] == null ? null : String(params[7]);
                const id = Number(params[12]);
                const tenantId = String(params[13]);
                const expectedSyncKey = String(params[14]);
                const patient = patients.find((row) => row.id === id && row.tenant_id === tenantId
                  && (row.sync_key == null || row.sync_key === expectedSyncKey));
                if (!patient) return null as T | null;
                patient.sync_key ??= syncKey;
                patient.name = name;
                patient.father_husband = fatherHusband;
                patient.address = address;
                patient.patient_code = patientCode;
                patient.uhid = uhid;
                return patient as T;
              }
              throw new Error(`Unhandled first SQL: ${normalized}`);
            },
            async all<T>() {
              if (normalized.includes('from patients') && normalized.includes('upper(trim(uhid))')) {
                const [tenantId, rawUhid, , rawCode] = params;
                const uhid = rawUhid == null ? null : String(rawUhid).trim().toUpperCase();
                const patientCode = rawCode == null ? null : String(rawCode).trim().toUpperCase();
                return {
                  results: patients.filter((row) => row.tenant_id === String(tenantId)
                    && ((uhid && row.uhid?.trim().toUpperCase() === uhid)
                      || (patientCode && row.patient_code?.trim().toUpperCase() === patientCode))).slice(0, 3),
                } as { results: T[] };
              }
              throw new Error(`Unhandled all SQL: ${normalized}`);
            },
            async run() {
              if (normalized.startsWith('insert or ignore into sync_entity_mappings')) {
                const [serverId, tenantId, entityType, localId, cloudId, naturalKey] = params.map((value) => value == null ? null : String(value));
                const duplicate = mappings.some((row) => row.server_id === serverId
                  && row.tenant_id === tenantId
                  && row.entity_type === entityType
                  && (row.local_entity_id === localId || row.cloud_entity_id === cloudId));
                if (!duplicate) {
                  mappings.push({
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
                const [naturalKey, serverId, tenantId, entityType, localId, cloudId] = params.map((value) => value == null ? null : String(value));
                const mapping = mappings.find((row) => row.server_id === serverId
                  && row.tenant_id === tenantId
                  && row.entity_type === entityType
                  && row.local_entity_id === localId
                  && row.cloud_entity_id === cloudId);
                if (mapping && mapping.natural_key == null) mapping.natural_key = naturalKey;
                return { success: true, meta: { changes: mapping ? 1 : 0 } };
              }
              throw new Error(`Unhandled run SQL: ${normalized}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, patients, mappings };
}

const payload: LocalSyncPatientPayload = {
  name: 'Patient One',
  fatherHusband: 'Guardian',
  address: 'Dhaka',
  mobile: '01700000000',
  email: null,
  patientCode: 'P-00123',
  uhid: 'uhid-123',
  nationalId: null,
  dateOfBirth: null,
  gender: 'male',
  age: 34,
  createdAt: '2026-07-11 10:00:00',
};

describe('stable local-server patient mapping', () => {
  it('builds a tenant patient sync key from normalized UHID and falls back to server origin', () => {
    expect(buildPatientSyncKey({ serverId: 'lan-a', localPatientId: 123, uhid: ' uhid-123 ' }))
      .toBe('uhid:UHID-123');
    expect(buildPatientSyncKey({ serverId: 'lan-a', localPatientId: 123, uhid: null }))
      .toBe('origin:lan-a:patients:123');
  });

  it('creates one cloud patient and persists the local-to-cloud mapping', async () => {
    const state = createDatabase();
    const result = await upsertMappedCloudPatient(state.db, {
      serverId: 'lan-a', tenantId: 'tenant-1', localPatientId: 123, payload,
    });

    expect(result.cloudPatientId).toBe(1);
    expect(state.patients).toHaveLength(1);
    expect(state.patients[0]).toMatchObject({ sync_key: 'uhid:UHID-123', father_husband: 'Guardian', address: 'Dhaka' });
    expect(state.mappings).toEqual([expect.objectContaining({ local_entity_id: '123', cloud_entity_id: '1' })]);
  });

  it('replays the same local patient without creating another cloud patient', async () => {
    const state = createDatabase();
    await upsertMappedCloudPatient(state.db, {
      serverId: 'lan-a', tenantId: 'tenant-1', localPatientId: 123, payload,
    });
    const replay = await upsertMappedCloudPatient(state.db, {
      serverId: 'lan-a', tenantId: 'tenant-1', localPatientId: 123,
      payload: { ...payload, name: 'Patient One Updated' },
    });

    expect(replay.cloudPatientId).toBe(1);
    expect(state.patients).toHaveLength(1);
    expect(state.patients[0]?.name).toBe('Patient One Updated');
    expect(state.mappings).toHaveLength(1);
  });

  it('claims and reuses one existing cloud patient with the same UHID', async () => {
    const state = createDatabase([{
      id: 88,
      tenant_id: 'tenant-1',
      patient_code: 'P-00123',
      uhid: 'UHID-123',
      sync_key: null,
      name: 'Existing',
      father_husband: '',
      address: '',
    }]);

    const result = await upsertMappedCloudPatient(state.db, {
      serverId: 'lan-a', tenantId: 'tenant-1', localPatientId: 123, payload,
    });
    expect(result.cloudPatientId).toBe(88);
    expect(state.patients).toHaveLength(1);
    expect(state.patients[0]?.sync_key).toBe('uhid:UHID-123');
  });

  it('rejects an ambiguous UHID or patient code instead of choosing a cloud patient', async () => {
    const state = createDatabase([
      { id: 10, tenant_id: 'tenant-1', patient_code: 'P-00123', uhid: null, sync_key: null, name: 'A', father_husband: '', address: '' },
      { id: 11, tenant_id: 'tenant-1', patient_code: null, uhid: 'UHID-123', sync_key: null, name: 'B', father_husband: '', address: '' },
    ]);

    await expect(upsertMappedCloudPatient(state.db, {
      serverId: 'lan-a', tenantId: 'tenant-1', localPatientId: 123, payload,
    })).rejects.toMatchObject({ status: 409 });
    expect(state.mappings).toHaveLength(0);
  });

  it('recovers a legacy applied patient without UHID by claiming the old numeric cloud row', async () => {
    const legacyPayload: LocalSyncPatientPayload = {
      ...payload,
      patientCode: null,
      uhid: null,
    };
    const state = createDatabase([{
      id: 123,
      tenant_id: 'tenant-1',
      patient_code: null,
      uhid: null,
      sync_key: null,
      name: 'Legacy Patient',
      father_husband: '',
      address: '',
    }]);

    const recovered = await recoverLegacyAppliedPatientMapping(state.db, {
      serverId: 'lan-a',
      tenantId: 'tenant-1',
      localPatientId: 123,
      payload: legacyPayload,
    });

    expect(recovered.cloudPatientId).toBe(123);
    expect(state.patients).toHaveLength(1);
    expect(state.patients[0]?.sync_key).toBe('origin:lan-a:patients:123');
    expect(state.mappings).toEqual([expect.objectContaining({
      local_entity_id: '123',
      cloud_entity_id: '123',
      natural_key: 'origin:lan-a:patients:123',
    })]);
  });

  it('translates a mapped cloud snapshot patient back to the original local ID', async () => {
    const state = createDatabase([{
      id: 123,
      tenant_id: 'tenant-1',
      patient_code: 'P-00123',
      uhid: 'UHID-123',
      sync_key: 'uhid:UHID-123',
      name: 'Local Patient',
      father_husband: '',
      address: '',
    }], [{
      server_id: 'lan-a',
      tenant_id: 'tenant-1',
      entity_type: 'patients',
      local_entity_id: '123',
      cloud_entity_id: '900',
      natural_key: 'uhid:UHID-123',
    }]);

    const translated = await translatePatientSnapshotRows(state.db, {
      serverId: 'lan-a',
      tenantId: 'tenant-1',
      rows: [{ id: 900, tenant_id: 'tenant-1', patient_code: 'P-00123', uhid: 'UHID-123', sync_key: 'uhid:UHID-123' }],
    });

    expect(translated.rows).toEqual([expect.objectContaining({ id: 123, sync_key: 'uhid:UHID-123' })]);
    expect(translated.mappings).toEqual([expect.objectContaining({ localEntityId: '123', cloudEntityId: '900' })]);
  });

  it('reuses a local patient with the same sync key when the pull mapping is missing', async () => {
    const state = createDatabase([{
      id: 123,
      tenant_id: 'tenant-1',
      patient_code: 'P-00123',
      uhid: 'UHID-123',
      sync_key: 'uhid:UHID-123',
      name: 'Local Patient',
      father_husband: '',
      address: '',
    }]);

    const translated = await translatePatientSnapshotRows(state.db, {
      serverId: 'lan-a',
      tenantId: 'tenant-1',
      rows: [{ id: 900, tenant_id: 'tenant-1', patient_code: 'P-00123', uhid: 'UHID-123', sync_key: 'uhid:UHID-123' }],
    });

    expect(translated.rows[0]?.id).toBe(123);
    expect(translated.mappings[0]).toMatchObject({ localEntityId: '123', cloudEntityId: '900' });
  });

  it('keeps a safe new cloud numeric ID and returns a mapping for first local import', async () => {
    const state = createDatabase();
    const translated = await translatePatientSnapshotRows(state.db, {
      serverId: 'lan-a',
      tenantId: 'tenant-1',
      rows: [{ id: 900, tenant_id: 'tenant-1', patient_code: 'P-00900', uhid: 'UHID-900', sync_key: 'uhid:UHID-900' }],
    });

    expect(translated.rows[0]?.id).toBe(900);
    expect(translated.mappings[0]).toMatchObject({ localEntityId: '900', cloudEntityId: '900' });
  });

  it('translates a local patient ID to the mapped cloud patient ID for health links', async () => {
    const state = createDatabase([{
      id: 88,
      tenant_id: 'tenant-1',
      patient_code: 'P-00123',
      uhid: 'UHID-123',
      sync_key: 'uhid:UHID-123',
      name: 'Existing',
      father_husband: '',
      address: '',
    }], [{
      server_id: 'lan-a',
      tenant_id: 'tenant-1',
      entity_type: 'patients',
      local_entity_id: '123',
      cloud_entity_id: '88',
      natural_key: 'uhid:UHID-123',
    }]);

    await expect(resolveMappedCloudPatientId(state.db, {
      serverId: 'lan-a', tenantId: 'tenant-1', localPatientId: 123, uhid: 'uhid-123',
    })).resolves.toMatchObject({ cloudPatientId: 88 });
  });
});
