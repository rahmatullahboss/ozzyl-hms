import { HTTPException } from 'hono/http-exception';

export type ConsultationCompletionClaim = {
  id: number;
  appointment_id: number;
  patient_id: number;
  visit_id: number;
  doctor_id: number;
  idempotency_key: string;
  request_hash: string;
  status: 'processing' | 'failed' | 'completed';
  lease_owner: string | null;
  lease_active: number;
  soap_id: number | null;
  diagnosis_id: number | null;
  prescription_id: number | null;
  encounter_id: number | null;
};

export type OwnedConsultationCompletionClaim = ConsultationCompletionClaim & {
  lease_owner: string;
  resumed: boolean;
};

function isConstraintConflict(error: unknown): boolean {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    messages.push(current instanceof Error ? current.message : String(current));
    current = typeof current === 'object' && current !== null && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null;
  }
  return /unique constraint|constraint failed|sqlite_constraint/i.test(messages.join(' '));
}

function createLeaseOwner(): string {
  const runtimeCrypto = (globalThis as typeof globalThis & {
    crypto?: { randomUUID?: () => string };
  }).crypto;
  return runtimeCrypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function readClaim(
  database: D1Database,
  tenantId: string,
  appointmentId: number,
): Promise<ConsultationCompletionClaim | null> {
  return database.prepare(`
    SELECT id, appointment_id, patient_id, visit_id, doctor_id,
           idempotency_key, request_hash, status, lease_token AS lease_owner,
           CASE WHEN lease_expires_at > datetime('now', '+6 hours') THEN 1 ELSE 0 END AS lease_active,
           soap_id, diagnosis_id, prescription_id, encounter_id
    FROM consultation_completion_claims
    WHERE tenant_id = ? AND appointment_id = ?
    LIMIT 1
  `).bind(tenantId, appointmentId).first<ConsultationCompletionClaim>();
}

export async function acquireConsultationCompletionClaim(
  database: D1Database,
  input: {
    tenantId: string;
    userId: string;
    appointmentId: number;
    patientId: number;
    visitId: number;
    doctorId: number;
    idempotencyKey: string;
    requestHash: string;
  },
): Promise<OwnedConsultationCompletionClaim> {
  const leaseOwner = createLeaseOwner();
  const inserted = await database.prepare(`
    INSERT OR IGNORE INTO consultation_completion_claims (
      tenant_id, appointment_id, patient_id, visit_id, doctor_id,
      idempotency_key, request_hash, status, lease_token, lease_expires_at,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, datetime('now', '+6 hours', '+5 minutes'), ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(
    input.tenantId,
    input.appointmentId,
    input.patientId,
    input.visitId,
    input.doctorId,
    input.idempotencyKey,
    input.requestHash,
    leaseOwner,
    Number(input.userId) || 0,
  ).run();

  if (inserted.meta.changes === 1) {
    return {
      id: Number(inserted.meta.last_row_id),
      appointment_id: input.appointmentId,
      patient_id: input.patientId,
      visit_id: input.visitId,
      doctor_id: input.doctorId,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      status: 'processing',
      lease_owner: leaseOwner,
      lease_active: 1,
      soap_id: null,
      diagnosis_id: null,
      prescription_id: null,
      encounter_id: null,
      resumed: false,
    };
  }

  let claim = await readClaim(database, input.tenantId, input.appointmentId);
  if (!claim) {
    throw new HTTPException(409, {
      message: 'The completion idempotency key is already used by another appointment',
    });
  }
  if (claim.patient_id !== input.patientId || claim.visit_id !== input.visitId || claim.doctor_id !== input.doctorId) {
    throw new HTTPException(409, { message: 'Consultation completion claim does not match this appointment context' });
  }
  if (claim.status === 'completed') {
    throw new HTTPException(409, { message: 'Consultation completion claim is already completed' });
  }
  if (claim.lease_owner === leaseOwner) return { ...claim, lease_owner: leaseOwner, resumed: true };
  if (claim.status === 'processing' && claim.lease_active === 1) {
    throw new HTTPException(409, { message: 'Consultation completion is already being processed' });
  }

  let takeover: D1Result<unknown>;
  try {
    takeover = await database.prepare(`
      UPDATE consultation_completion_claims
      SET idempotency_key = ?, request_hash = ?, status = 'processing', lease_token = ?,
          lease_expires_at = datetime('now', '+6 hours', '+5 minutes'),
          last_error_code = NULL, updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
        AND status IN ('failed', 'processing')
        AND (status = 'failed' OR lease_expires_at IS NULL OR lease_expires_at <= datetime('now', '+6 hours'))
    `).bind(input.idempotencyKey, input.requestHash, leaseOwner, claim.id, input.tenantId).run();
  } catch (error) {
    if (isConstraintConflict(error)) {
      throw new HTTPException(409, {
        message: 'The completion idempotency key is already used by another appointment',
      });
    }
    throw error;
  }
  if (takeover.meta.changes !== 1) {
    throw new HTTPException(409, { message: 'Consultation completion is already being processed' });
  }

  claim = await readClaim(database, input.tenantId, input.appointmentId);
  if (!claim || claim.lease_owner !== leaseOwner || claim.status !== 'processing') {
    throw new HTTPException(409, { message: 'Consultation completion lease could not be acquired' });
  }
  return { ...claim, lease_owner: leaseOwner, resumed: true };
}

export async function updateConsultationCompletionClaim(
  database: D1Database,
  tenantId: string,
  claim: OwnedConsultationCompletionClaim,
  refs: {
    soapId?: number | null;
    diagnosisId?: number | null;
    prescriptionId?: number | null;
    encounterId?: number | null;
  },
): Promise<void> {
  const update = await database.prepare(`
    UPDATE consultation_completion_claims
    SET soap_id = COALESCE(?, soap_id), diagnosis_id = COALESCE(?, diagnosis_id),
        prescription_id = COALESCE(?, prescription_id), encounter_id = COALESCE(?, encounter_id),
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ? AND lease_token = ? AND status = 'processing'
    RETURNING id
  `).bind(
    refs.soapId ?? null,
    refs.diagnosisId ?? null,
    refs.prescriptionId ?? null,
    refs.encounterId ?? null,
    claim.id,
    tenantId,
    claim.lease_owner,
  ).first<{ id: number }>();
  if (!update?.id) {
    throw new HTTPException(409, { message: 'Consultation completion claim was lost during processing' });
  }
}

export async function markConsultationCompletionFailed(
  database: D1Database,
  tenantId: string,
  claim: OwnedConsultationCompletionClaim | null,
  error: unknown,
): Promise<void> {
  if (!claim) return;
  const errorCode = error instanceof HTTPException ? `HTTP_${error.status}` : 'UNEXPECTED_ERROR';
  try {
    await database.prepare(`
      UPDATE consultation_completion_claims
      SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
          last_error_code = ?, updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND lease_token = ? AND status = 'processing'
    `).bind(errorCode, claim.id, tenantId, claim.lease_owner).run();
  } catch {
    // Preserve the original clinical error; an expired lease can be recovered later.
  }
}

export async function reconcileSignedConsultationCompletionClaim(
  database: D1Database,
  tenantId: string,
  appointmentId: number,
  encounterId: number,
): Promise<void> {
  await database.prepare(`
    UPDATE consultation_completion_claims
    SET status = 'completed', encounter_id = ?,
        completed_at = COALESCE(completed_at, datetime('now', '+6 hours')),
        lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL,
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND appointment_id = ? AND status <> 'completed'
  `).bind(encounterId, tenantId, appointmentId).run();
}

export async function markConsultationCompletionCompleted(
  database: D1Database,
  tenantId: string,
  claim: OwnedConsultationCompletionClaim,
  encounterId: number,
): Promise<void> {
  const update = await database.prepare(`
    UPDATE consultation_completion_claims
    SET status = 'completed', encounter_id = ?, completed_at = datetime('now', '+6 hours'),
        lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL,
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ? AND lease_token = ? AND status = 'processing'
    RETURNING id
  `).bind(encounterId, claim.id, tenantId, claim.lease_owner).first<{ id: number }>();
  if (!update?.id) {
    throw new HTTPException(409, { message: 'Consultation completion claim could not be finalized' });
  }
}
