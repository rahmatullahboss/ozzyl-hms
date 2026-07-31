import { HTTPException } from 'hono/http-exception';
import {
  ensureSyncEntityMapping,
  getSyncEntityMappingByCloud,
  getSyncEntityMappingByLocal,
  type SyncEntityMapping,
} from './local-sync-entity-mappings';

export type LocalSyncPatientPayload = {
  name: string;
  fatherHusband: string;
  address: string;
  mobile: string | null;
  email: string | null;
  patientCode: string | null;
  uhid: string | null;
  nationalId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  age: number | null;
  createdAt: string | null;
};

type CloudPatientRow = {
  id: number;
  tenant_id: string;
  patient_code: string | null;
  uhid: string | null;
  sync_key: string | null;
};

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function normalizedIdentity(value: string): string {
  return value.trim().toUpperCase();
}

export function buildPatientSyncKey(input: {
  serverId: string;
  localPatientId: string | number;
  uhid?: string | null;
}): string {
  const uhid = normalized(input.uhid);
  if (uhid) return `uhid:${normalizedIdentity(uhid)}`;
  return `origin:${input.serverId}:patients:${String(input.localPatientId)}`;
}

function patientNaturalKey(payload: Pick<LocalSyncPatientPayload, 'uhid' | 'patientCode'>): string | null {
  const uhid = normalized(payload.uhid);
  if (uhid) return `uhid:${normalizedIdentity(uhid)}`;
  const patientCode = normalized(payload.patientCode);
  return patientCode ? `patient_code:${normalizedIdentity(patientCode)}` : null;
}

async function loadCloudPatient(
  database: D1Database,
  tenantId: string,
  cloudPatientId: string | number,
): Promise<CloudPatientRow | null> {
  return database.prepare(`
    SELECT id, tenant_id, patient_code, uhid, sync_key
    FROM patients
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(Number(cloudPatientId), tenantId).first<CloudPatientRow>();
}

async function loadCloudPatientBySyncKey(
  database: D1Database,
  tenantId: string,
  syncKey: string,
): Promise<CloudPatientRow | null> {
  return database.prepare(`
    SELECT id, tenant_id, patient_code, uhid, sync_key
    FROM patients
    WHERE tenant_id = ? AND sync_key = ?
    LIMIT 1
  `).bind(tenantId, syncKey).first<CloudPatientRow>();
}

function assertNaturalIdentityCompatible(
  existing: CloudPatientRow,
  payload: Pick<LocalSyncPatientPayload, 'uhid' | 'patientCode'>,
) {
  const incomingUhid = normalized(payload.uhid);
  const existingUhid = normalized(existing.uhid);
  if (incomingUhid && existingUhid && normalizedIdentity(incomingUhid) !== normalizedIdentity(existingUhid)) {
    throw new HTTPException(409, {
      message: 'Mapped cloud patient UHID conflicts with the local patient identity',
    });
  }
  const incomingCode = normalized(payload.patientCode);
  const existingCode = normalized(existing.patient_code);
  if (incomingCode && existingCode && normalizedIdentity(incomingCode) !== normalizedIdentity(existingCode)) {
    throw new HTTPException(409, {
      message: 'Mapped cloud patient code conflicts with the local patient identity',
    });
  }
}

async function findNaturalPatientMatches(
  database: D1Database,
  tenantId: string,
  uhid: string | null,
  patientCode: string | null,
): Promise<CloudPatientRow[]> {
  const normalizedUhid = normalized(uhid);
  const normalizedCode = normalized(patientCode);
  if (!normalizedUhid && !normalizedCode) return [];
  const { results } = await database.prepare(`
    SELECT id, tenant_id, patient_code, uhid, sync_key
    FROM patients
    WHERE tenant_id = ?
      AND (
        (? IS NOT NULL AND UPPER(TRIM(uhid)) = UPPER(TRIM(?)))
        OR (? IS NOT NULL AND UPPER(TRIM(patient_code)) = UPPER(TRIM(?)))
      )
    ORDER BY id
    LIMIT 3
  `).bind(
    tenantId,
    normalizedUhid,
    normalizedUhid,
    normalizedCode,
    normalizedCode,
  ).all<CloudPatientRow>();
  return results ?? [];
}

async function claimExistingPatientSyncKey(
  database: D1Database,
  tenantId: string,
  patient: CloudPatientRow,
  syncKey: string,
): Promise<CloudPatientRow> {
  if (patient.sync_key && patient.sync_key !== syncKey) {
    throw new HTTPException(409, {
      message: 'Existing cloud patient is already owned by a different sync identity',
    });
  }
  if (patient.sync_key === syncKey) return patient;

  try {
    const claimed = await database.prepare(`
      UPDATE patients
      SET sync_key = ?, updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ? AND sync_key IS NULL
      RETURNING id, tenant_id, patient_code, uhid, sync_key
    `).bind(syncKey, patient.id, tenantId).first<CloudPatientRow>();
    if (claimed) return claimed;
  } catch {
    // A concurrent writer may have claimed the same unique sync key. The
    // post-check below determines whether it is the same canonical patient.
  }

  const byKey = await loadCloudPatientBySyncKey(database, tenantId, syncKey);
  if (byKey?.id === patient.id) return byKey;
  throw new HTTPException(409, {
    message: 'Patient sync identity is already claimed by another cloud patient',
  });
}

async function upsertCloudPatientBySyncKey(
  database: D1Database,
  tenantId: string,
  syncKey: string,
  payload: LocalSyncPatientPayload,
): Promise<CloudPatientRow> {
  const row = await database.prepare(`
    INSERT INTO patients (
      tenant_id, sync_key, name, father_husband, address, mobile, email,
      patient_code, uhid, national_id, date_of_birth, gender, age,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
    ON CONFLICT(tenant_id, sync_key) DO UPDATE SET
      name = excluded.name,
      father_husband = excluded.father_husband,
      address = excluded.address,
      mobile = excluded.mobile,
      email = excluded.email,
      patient_code = excluded.patient_code,
      uhid = excluded.uhid,
      national_id = excluded.national_id,
      date_of_birth = excluded.date_of_birth,
      gender = excluded.gender,
      age = excluded.age,
      updated_at = datetime('now')
    RETURNING id, tenant_id, patient_code, uhid, sync_key
  `).bind(
    tenantId,
    syncKey,
    payload.name,
    payload.fatherHusband,
    payload.address,
    payload.mobile,
    payload.email,
    payload.patientCode,
    payload.uhid,
    payload.nationalId,
    payload.dateOfBirth,
    payload.gender,
    payload.age,
    payload.createdAt,
  ).first<CloudPatientRow>();
  if (!row?.id) {
    throw new HTTPException(500, { message: 'Cloud patient upsert could not be confirmed' });
  }
  return row;
}

async function updateMappedCloudPatient(
  database: D1Database,
  tenantId: string,
  cloudPatientId: number,
  syncKey: string,
  payload: LocalSyncPatientPayload,
): Promise<CloudPatientRow> {
  const row = await database.prepare(`
    UPDATE patients
    SET sync_key = COALESCE(sync_key, ?), name = ?, father_husband = ?, address = ?,
        mobile = ?, email = ?, patient_code = ?, uhid = ?, national_id = ?,
        date_of_birth = ?, gender = ?, age = ?, updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ? AND (sync_key IS NULL OR sync_key = ?)
    RETURNING id, tenant_id, patient_code, uhid, sync_key
  `).bind(
    syncKey,
    payload.name,
    payload.fatherHusband,
    payload.address,
    payload.mobile,
    payload.email,
    payload.patientCode,
    payload.uhid,
    payload.nationalId,
    payload.dateOfBirth,
    payload.gender,
    payload.age,
    cloudPatientId,
    tenantId,
    syncKey,
  ).first<CloudPatientRow>();
  if (!row?.id) {
    throw new HTTPException(409, { message: 'Mapped cloud patient could not be updated safely' });
  }
  return row;
}

export async function upsertMappedCloudPatient(
  database: D1Database,
  input: {
    serverId: string;
    tenantId: string;
    localPatientId: string | number;
    payload: LocalSyncPatientPayload;
  },
): Promise<{ cloudPatientId: number; mapping: SyncEntityMapping }> {
  const localPatientId = String(input.localPatientId);
  const syncKey = buildPatientSyncKey({
    serverId: input.serverId,
    localPatientId,
    uhid: input.payload.uhid,
  });
  const naturalKey = patientNaturalKey(input.payload);
  const existingMapping = await getSyncEntityMappingByLocal(
    database,
    input.serverId,
    input.tenantId,
    'patients',
    localPatientId,
  );

  let patient: CloudPatientRow;
  if (existingMapping) {
    const mappedPatientId = Number(existingMapping.cloudEntityId);
    if (!Number.isInteger(mappedPatientId) || mappedPatientId <= 0) {
      throw new HTTPException(409, { message: 'Mapped cloud patient ID is invalid' });
    }
    const existingPatient = await loadCloudPatient(database, input.tenantId, mappedPatientId);
    if (!existingPatient) {
      throw new HTTPException(409, { message: 'Patient mapping points to a missing cloud patient record' });
    }
    assertNaturalIdentityCompatible(existingPatient, input.payload);
    patient = await updateMappedCloudPatient(
      database,
      input.tenantId,
      mappedPatientId,
      existingPatient.sync_key ?? syncKey,
      input.payload,
    );
  } else {
    const bySyncKey = await loadCloudPatientBySyncKey(database, input.tenantId, syncKey);
    if (bySyncKey) {
      assertNaturalIdentityCompatible(bySyncKey, input.payload);
      patient = await updateMappedCloudPatient(
        database,
        input.tenantId,
        bySyncKey.id,
        syncKey,
        input.payload,
      );
    } else {
      const naturalMatches = await findNaturalPatientMatches(
        database,
        input.tenantId,
        input.payload.uhid,
        input.payload.patientCode,
      );
      const distinctIds = [...new Set(naturalMatches.map((row) => Number(row.id)))];
      if (distinctIds.length > 1) {
        throw new HTTPException(409, {
          message: 'Patient UHID or patient code resolves to multiple cloud patient records',
        });
      }
      if (naturalMatches[0]) {
        assertNaturalIdentityCompatible(naturalMatches[0], input.payload);
        const claimed = await claimExistingPatientSyncKey(
          database,
          input.tenantId,
          naturalMatches[0],
          syncKey,
        );
        patient = await updateMappedCloudPatient(
          database,
          input.tenantId,
          claimed.id,
          syncKey,
          input.payload,
        );
      } else {
        patient = await upsertCloudPatientBySyncKey(
          database,
          input.tenantId,
          syncKey,
          input.payload,
        );
      }
    }
  }

  const mapping = await ensureSyncEntityMapping(database, {
    serverId: input.serverId,
    tenantId: input.tenantId,
    entityType: 'patients',
    localEntityId: localPatientId,
    cloudEntityId: String(patient.id),
    naturalKey,
  });
  return { cloudPatientId: Number(patient.id), mapping };
}

export async function recoverLegacyAppliedPatientMapping(
  database: D1Database,
  input: {
    serverId: string;
    tenantId: string;
    localPatientId: string | number;
    payload: LocalSyncPatientPayload;
  },
): Promise<{ cloudPatientId: number; mapping: SyncEntityMapping }> {
  const localPatientId = String(input.localPatientId);
  const existingMapping = await getSyncEntityMappingByLocal(
    database,
    input.serverId,
    input.tenantId,
    'patients',
    localPatientId,
  );
  if (existingMapping) {
    return { cloudPatientId: Number(existingMapping.cloudEntityId), mapping: existingMapping };
  }

  const legacyPatientId = Number(localPatientId);
  const legacyPatient = Number.isInteger(legacyPatientId) && legacyPatientId > 0
    ? await loadCloudPatient(database, input.tenantId, legacyPatientId)
    : null;
  if (!legacyPatient) {
    return upsertMappedCloudPatient(database, input);
  }

  assertNaturalIdentityCompatible(legacyPatient, input.payload);
  const syncKey = buildPatientSyncKey({
    serverId: input.serverId,
    localPatientId,
    uhid: input.payload.uhid,
  });
  const claimed = await claimExistingPatientSyncKey(
    database,
    input.tenantId,
    legacyPatient,
    syncKey,
  );
  const updated = await updateMappedCloudPatient(
    database,
    input.tenantId,
    claimed.id,
    syncKey,
    input.payload,
  );
  const mapping = await ensureSyncEntityMapping(database, {
    serverId: input.serverId,
    tenantId: input.tenantId,
    entityType: 'patients',
    localEntityId: localPatientId,
    cloudEntityId: String(updated.id),
    naturalKey: patientNaturalKey(input.payload) ?? syncKey,
  });
  return { cloudPatientId: Number(updated.id), mapping };
}

export async function resolveMappedCloudPatientId(
  database: D1Database,
  input: {
    serverId: string;
    tenantId: string;
    localPatientId: string | number;
    uhid: string;
  },
): Promise<{ cloudPatientId: number; mapping: SyncEntityMapping }> {
  const localPatientId = String(input.localPatientId);
  let mapping = await getSyncEntityMappingByLocal(
    database,
    input.serverId,
    input.tenantId,
    'patients',
    localPatientId,
  );

  if (!mapping) {
    const matches = await findNaturalPatientMatches(database, input.tenantId, input.uhid, null);
    if (matches.length !== 1) {
      throw new HTTPException(409, {
        message: matches.length > 1
          ? 'Patient health link UHID resolves to multiple cloud patient records'
          : 'Patient health link has no stable local-to-cloud patient mapping',
      });
    }
    mapping = await ensureSyncEntityMapping(database, {
      serverId: input.serverId,
      tenantId: input.tenantId,
      entityType: 'patients',
      localEntityId: localPatientId,
      cloudEntityId: String(matches[0]!.id),
      naturalKey: `uhid:${normalizedIdentity(input.uhid)}`,
    });
  }

  const cloudPatientId = Number(mapping.cloudEntityId);
  const patient = await loadCloudPatient(database, input.tenantId, cloudPatientId);
  if (!patient) {
    throw new HTTPException(409, { message: 'Mapped patient health link points to a missing cloud patient' });
  }
  const patientUhid = normalized(patient.uhid);
  if (patientUhid && normalizedIdentity(patientUhid) !== normalizedIdentity(input.uhid)) {
    throw new HTTPException(409, { message: 'Patient health link UHID does not match the mapped cloud patient' });
  }
  return { cloudPatientId, mapping };
}

export async function translatePatientSnapshotRows(
  database: D1Database,
  input: {
    serverId: string;
    tenantId: string;
    rows: Array<Record<string, unknown>>;
  },
): Promise<{ rows: Array<Record<string, unknown>>; mappings: SyncEntityMapping[] }> {
  const translatedRows: Array<Record<string, unknown>> = [];
  const mappings: SyncEntityMapping[] = [];

  for (const rawRow of input.rows) {
    if (String(rawRow.tenant_id ?? '') !== input.tenantId) continue;
    const cloudPatientId = Number(rawRow.id);
    if (!Number.isInteger(cloudPatientId) || cloudPatientId <= 0) {
      throw new HTTPException(409, { message: 'Cloud patient snapshot row has an invalid ID' });
    }

    const incomingUhid = normalized(rawRow.uhid == null ? null : String(rawRow.uhid));
    const incomingPatientCode = normalized(rawRow.patient_code == null ? null : String(rawRow.patient_code));
    const incomingSyncKey = normalized(rawRow.sync_key == null ? null : String(rawRow.sync_key))
      ?? (incomingUhid ? `uhid:${normalizedIdentity(incomingUhid)}` : `cloud:${cloudPatientId}`);

    const existingByCloud = await getSyncEntityMappingByCloud(
      database,
      input.serverId,
      input.tenantId,
      'patients',
      cloudPatientId,
    );

    let localPatientId: number;
    let localPatient: CloudPatientRow | null = null;
    if (existingByCloud) {
      localPatientId = Number(existingByCloud.localEntityId);
      if (!Number.isInteger(localPatientId) || localPatientId <= 0) {
        throw new HTTPException(409, { message: 'Patient snapshot mapping has an invalid local ID' });
      }
      localPatient = await loadCloudPatient(database, input.tenantId, localPatientId);
      if (!localPatient) {
        throw new HTTPException(409, { message: 'Patient snapshot mapping points to a missing local patient' });
      }
      assertNaturalIdentityCompatible(localPatient, {
        uhid: incomingUhid,
        patientCode: incomingPatientCode,
      });
      mappings.push(existingByCloud);
    } else {
      localPatient = await loadCloudPatientBySyncKey(database, input.tenantId, incomingSyncKey);
      if (!localPatient) {
        const naturalMatches = await findNaturalPatientMatches(
          database,
          input.tenantId,
          incomingUhid,
          incomingPatientCode,
        );
        const distinctIds = [...new Set(naturalMatches.map((row) => Number(row.id)))];
        if (distinctIds.length > 1) {
          throw new HTTPException(409, {
            message: 'Cloud patient snapshot identity resolves to multiple local patients',
          });
        }
        localPatient = naturalMatches[0] ?? null;
      }

      if (localPatient) {
        assertNaturalIdentityCompatible(localPatient, {
          uhid: incomingUhid,
          patientCode: incomingPatientCode,
        });
        if (localPatient.sync_key && localPatient.sync_key !== incomingSyncKey) {
          throw new HTTPException(409, {
            message: 'Local patient is already owned by a different sync identity',
          });
        }
        localPatientId = Number(localPatient.id);
      } else {
        localPatientId = cloudPatientId;
      }

      const existingByLocal = await getSyncEntityMappingByLocal(
        database,
        input.serverId,
        input.tenantId,
        'patients',
        localPatientId,
      );
      if (existingByLocal && String(existingByLocal.cloudEntityId) !== String(cloudPatientId)) {
        throw new HTTPException(409, {
          message: 'Local patient is already mapped to a different cloud patient',
        });
      }

      mappings.push(existingByLocal ?? {
        serverId: input.serverId,
        tenantId: input.tenantId,
        entityType: 'patients',
        localEntityId: String(localPatientId),
        cloudEntityId: String(cloudPatientId),
        naturalKey: incomingUhid
          ? `uhid:${normalizedIdentity(incomingUhid)}`
          : incomingPatientCode
            ? `patient_code:${normalizedIdentity(incomingPatientCode)}`
            : incomingSyncKey,
      });
    }

    translatedRows.push({
      ...rawRow,
      id: localPatientId,
      sync_key: localPatient?.sync_key ?? incomingSyncKey,
    });
  }

  return { rows: translatedRows, mappings };
}
