import type { D1Database } from '@cloudflare/workers-types';
import { HTTPException } from 'hono/http-exception';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  readMutationIdempotencyState,
  reclaimFailedMutationIdempotencyKey,
  reserveMutationIdempotencyKey,
} from './request-idempotency';

export const PATIENT_REGISTRATION_MUTATION = 'patient_registration_create';

export type PatientRegistrationAttempt =
  | {
      kind: 'new';
      ownsReservation: boolean;
      key: string | null;
      requestHash: string | null;
    }
  | {
      kind: 'replay';
      responseBody: Record<string, unknown>;
    }
  | {
      kind: 'recover';
      patientId: number;
      patientCode: string | null;
      uhid: string | null;
      key: string;
      requestHash: string;
    };

type DurablePatientRow = {
  id: number;
  patient_code: string | null;
  uhid: string | null;
};

export async function createPatientRegistrationHash(
  requestData: Record<string, unknown>,
): Promise<string> {
  return createIdempotencyRequestHash({
    ...requestData,
    idempotencyKey: undefined,
  });
}

async function loadDurablePatientByAttemptKey(
  db: D1Database,
  tenantId: string,
  idempotencyKey: string,
): Promise<DurablePatientRow | null> {
  return db.prepare(`
    SELECT id, patient_code, uhid
    FROM patients
    WHERE tenant_id = ? AND registration_idempotency_key = ?
    LIMIT 1
  `).bind(tenantId, idempotencyKey).first<DurablePatientRow>();
}

async function loadPatientBySourceId(
  db: D1Database,
  tenantId: string,
  sourceId: string | null,
): Promise<DurablePatientRow | null> {
  const patientId = Number(sourceId);
  if (!Number.isInteger(patientId) || patientId <= 0) return null;
  return db.prepare(`
    SELECT id, patient_code, uhid
    FROM patients
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(patientId, tenantId).first<DurablePatientRow>();
}

export async function beginPatientRegistrationAttempt(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string | number;
    idempotencyKey?: string;
    requestData: Record<string, unknown>;
    reserveIfMissing?: boolean;
  },
): Promise<PatientRegistrationAttempt> {
  const key = input.idempotencyKey?.trim() || null;
  const reserveIfMissing = input.reserveIfMissing ?? true;
  if (!key) {
    return { kind: 'new', ownsReservation: false, key: null, requestHash: null };
  }

  const requestHash = await createPatientRegistrationHash(input.requestData);
  const common = {
    tenantId: input.tenantId,
    mutationType: PATIENT_REGISTRATION_MUTATION,
    idempotencyKey: key,
    requestHash,
  };
  const state = await readMutationIdempotencyState(db, {
    ...common,
    mismatchMessage: 'Patient registration idempotency key was already used with different patient data',
  });

  if (state?.status === 'completed' && state.responseBody) {
    return { kind: 'replay', responseBody: state.responseBody };
  }

  if (state) {
    const recoverablePatient = (
      await loadDurablePatientByAttemptKey(db, input.tenantId, key)
      ?? await loadPatientBySourceId(db, input.tenantId, state.sourceId)
    );
    if (recoverablePatient) {
      return {
        kind: 'recover',
        patientId: recoverablePatient.id,
        patientCode: recoverablePatient.patient_code,
        uhid: recoverablePatient.uhid,
        key,
        requestHash,
      };
    }

    if (state.status === 'failed') {
      if (!reserveIfMissing) {
        return { kind: 'new', ownsReservation: false, key, requestHash };
      }
      const reclaimed = await reclaimFailedMutationIdempotencyKey(db, {
        ...common,
        createdBy: input.userId,
      });
      if (reclaimed) {
        return { kind: 'new', ownsReservation: true, key, requestHash };
      }
    }

    throw new HTTPException(409, {
      message: 'This patient registration is already being processed. Please wait a moment.',
    });
  }

  if (!reserveIfMissing) {
    return { kind: 'new', ownsReservation: false, key, requestHash };
  }

  const replay = await reserveMutationIdempotencyKey(db, {
    ...common,
    createdBy: input.userId,
    mismatchMessage: 'Patient registration idempotency key was already used with different patient data',
    conflictMessage: 'This patient registration is already being processed. Please wait a moment.',
  });
  if (replay) return { kind: 'replay', responseBody: replay.responseBody };

  return { kind: 'new', ownsReservation: true, key, requestHash };
}

export async function ensurePatientRegistrationSerial(
  db: D1Database,
  input: {
    tenantId: string;
    patientId: number;
    date: string;
  },
): Promise<string> {
  const existing = await db.prepare(`
    SELECT serial_number
    FROM serials
    WHERE tenant_id = ? AND patient_id = ? AND date = ?
    ORDER BY id ASC
    LIMIT 1
  `).bind(input.tenantId, input.patientId, input.date).first<{ serial_number: string }>();
  if (existing?.serial_number) return existing.serial_number;

  const countRow = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM serials
    WHERE tenant_id = ? AND date = ?
  `).bind(input.tenantId, input.date).first<{ count: number }>();
  const candidate = `${input.date.replace(/-/g, '')}-${String(Number(countRow?.count ?? 0) + 1).padStart(3, '0')}`;

  const inserted = await db.prepare(`
    INSERT INTO serials (patient_id, serial_number, date, status, tenant_id)
    SELECT ?, ?, ?, 'waiting', ?
    WHERE NOT EXISTS (
      SELECT 1 FROM serials
      WHERE tenant_id = ? AND patient_id = ? AND date = ?
    )
  `).bind(
    input.patientId,
    candidate,
    input.date,
    input.tenantId,
    input.tenantId,
    input.patientId,
    input.date,
  ).run();
  if (Number(inserted.meta?.changes ?? 0) > 0) return candidate;

  const persisted = await db.prepare(`
    SELECT serial_number
    FROM serials
    WHERE tenant_id = ? AND patient_id = ? AND date = ?
    ORDER BY id ASC
    LIMIT 1
  `).bind(input.tenantId, input.patientId, input.date).first<{ serial_number: string }>();

  if (!persisted?.serial_number) {
    throw new Error('Failed to persist patient registration serial');
  }
  return persisted.serial_number;
}

export async function recoverPatientRegistrationResponse(
  db: D1Database,
  input: {
    tenantId: string;
    patientId: number;
    patientCode: string | null;
    uhid: string | null;
    date: string;
  },
): Promise<Record<string, unknown>> {
  const serial = await ensurePatientRegistrationSerial(db, input);
  return {
    message: 'Patient registered',
    patientId: input.patientId,
    patientCode: input.patientCode,
    uhid: input.uhid,
    serial,
  };
}

export async function completePatientRegistrationAttempt(
  db: D1Database,
  input: {
    tenantId: string;
    attempt: PatientRegistrationAttempt;
    sourceId: number;
    responseBody: Record<string, unknown>;
  },
): Promise<void> {
  if (input.attempt.kind === 'replay' || !('key' in input.attempt) || !input.attempt.key) return;
  await completeMutationIdempotencyKey(db, {
    tenantId: input.tenantId,
    mutationType: PATIENT_REGISTRATION_MUTATION,
    idempotencyKey: input.attempt.key,
    sourceId: input.sourceId,
    responseBody: input.responseBody,
  });
}

export async function failPatientRegistrationAttempt(
  db: D1Database,
  input: {
    tenantId: string;
    attempt: PatientRegistrationAttempt | null;
  },
): Promise<void> {
  const attempt = input.attempt;
  if (!attempt || attempt.kind !== 'new' || !attempt.ownsReservation || !attempt.key) return;
  await markMutationIdempotencyKeyFailed(db, {
    tenantId: input.tenantId,
    mutationType: PATIENT_REGISTRATION_MUTATION,
    idempotencyKey: attempt.key,
  });
}
