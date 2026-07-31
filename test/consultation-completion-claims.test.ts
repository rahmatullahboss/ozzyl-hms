import { describe, expect, it } from 'vitest';
import {
  acquireConsultationCompletionClaim,
  markConsultationCompletionCompleted,
  markConsultationCompletionFailed,
  reconcileSignedConsultationCompletionClaim,
  updateConsultationCompletionClaim,
  type OwnedConsultationCompletionClaim,
} from '../src/lib/consultation-completion-claims';

type ClaimState = {
  id: number;
  tenant_id: string;
  appointment_id: number;
  patient_id: number;
  visit_id: number;
  doctor_id: number;
  idempotency_key: string;
  request_hash: string;
  status: 'processing' | 'failed' | 'completed';
  lease_token: string | null;
  lease_active: number;
  soap_id: number | null;
  diagnosis_id: number | null;
  prescription_id: number | null;
  encounter_id: number | null;
  last_error_code?: string | null;
};

function createClaimDatabase(initial: ClaimState | null = null) {
  let claim = initial ? { ...initial } : null;
  const queries: Array<{ sql: string; params: unknown[]; method: 'run' | 'first' }> = [];

  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
          return {
            async run() {
              queries.push({ sql, params, method: 'run' });

              if (normalized.startsWith('insert or ignore into consultation_completion_claims')) {
                if (claim) return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
                claim = {
                  id: 501,
                  tenant_id: String(params[0]),
                  appointment_id: Number(params[1]),
                  patient_id: Number(params[2]),
                  visit_id: Number(params[3]),
                  doctor_id: Number(params[4]),
                  idempotency_key: String(params[5]),
                  request_hash: String(params[6]),
                  status: 'processing',
                  lease_token: String(params[7]),
                  lease_active: 1,
                  soap_id: null,
                  diagnosis_id: null,
                  prescription_id: null,
                  encounter_id: null,
                  last_error_code: null,
                };
                return { success: true, meta: { changes: 1, last_row_id: 501, duration: 0 } };
              }

              if (normalized.includes('set idempotency_key = ?') && normalized.includes('status = \'processing\'')) {
                if (!claim || (claim.status === 'processing' && claim.lease_active === 1)) {
                  return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
                }
                claim.idempotency_key = String(params[0]);
                claim.request_hash = String(params[1]);
                claim.status = 'processing';
                claim.lease_token = String(params[2]);
                claim.lease_active = 1;
                claim.last_error_code = null;
                return { success: true, meta: { changes: 1, last_row_id: claim.id, duration: 0 } };
              }

              if (normalized.includes("set status = 'completed'") && normalized.includes('completed_at = coalesce')) {
                if (!claim || claim.tenant_id !== String(params[1]) || claim.appointment_id !== Number(params[2]) || claim.status === 'completed') {
                  return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
                }
                claim.status = 'completed';
                claim.encounter_id = Number(params[0]);
                claim.lease_token = null;
                claim.lease_active = 0;
                claim.last_error_code = null;
                return { success: true, meta: { changes: 1, last_row_id: claim.id, duration: 0 } };
              }

              if (normalized.includes("set status = 'failed'")) {
                if (!claim || claim.id !== Number(params[1]) || claim.tenant_id !== String(params[2]) || claim.lease_token !== String(params[3]) || claim.status !== 'processing') {
                  return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
                }
                claim.status = 'failed';
                claim.lease_token = null;
                claim.lease_active = 0;
                claim.last_error_code = String(params[0]);
                return { success: true, meta: { changes: 1, last_row_id: claim.id, duration: 0 } };
              }

              throw new Error(`Unhandled run SQL: ${normalized}`);
            },
            async first<T>() {
              queries.push({ sql, params, method: 'first' });

              if (normalized.startsWith('select id, appointment_id') && normalized.includes('from consultation_completion_claims')) {
                if (!claim || claim.tenant_id !== String(params[0]) || claim.appointment_id !== Number(params[1])) return null;
                return {
                  id: claim.id,
                  appointment_id: claim.appointment_id,
                  patient_id: claim.patient_id,
                  visit_id: claim.visit_id,
                  doctor_id: claim.doctor_id,
                  idempotency_key: claim.idempotency_key,
                  request_hash: claim.request_hash,
                  status: claim.status,
                  lease_owner: claim.lease_token,
                  lease_active: claim.lease_active,
                  soap_id: claim.soap_id,
                  diagnosis_id: claim.diagnosis_id,
                  prescription_id: claim.prescription_id,
                  encounter_id: claim.encounter_id,
                } as T;
              }

              if (normalized.includes('set soap_id = coalesce') && normalized.includes('returning id')) {
                if (!claim || claim.id !== Number(params[4]) || claim.tenant_id !== String(params[5]) || claim.lease_token !== String(params[6]) || claim.status !== 'processing') {
                  return null;
                }
                if (params[0] != null) claim.soap_id = Number(params[0]);
                if (params[1] != null) claim.diagnosis_id = Number(params[1]);
                if (params[2] != null) claim.prescription_id = Number(params[2]);
                if (params[3] != null) claim.encounter_id = Number(params[3]);
                return { id: claim.id } as T;
              }

              if (normalized.includes("set status = 'completed'") && normalized.includes('returning id')) {
                if (!claim || claim.id !== Number(params[1]) || claim.tenant_id !== String(params[2]) || claim.lease_token !== String(params[3]) || claim.status !== 'processing') {
                  return null;
                }
                claim.status = 'completed';
                claim.encounter_id = Number(params[0]);
                claim.lease_token = null;
                claim.lease_active = 0;
                claim.last_error_code = null;
                return { id: claim.id } as T;
              }

              throw new Error(`Unhandled first SQL: ${normalized}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return {
    database,
    queries,
    getClaim: () => claim,
    expireLease: () => {
      if (claim) claim.lease_active = 0;
    },
  };
}

const baseInput = {
  tenantId: 'tenant-1',
  userId: '42',
  appointmentId: 44,
  patientId: 12,
  visitId: 99,
  doctorId: 7,
  idempotencyKey: 'complete-44-attempt-1',
  requestHash: 'a'.repeat(64),
};

describe('consultation completion claims', () => {
  it('creates and owns a new appointment-scoped completion claim', async () => {
    const state = createClaimDatabase();

    const claim = await acquireConsultationCompletionClaim(state.database, baseInput);

    expect(claim).toMatchObject({
      id: 501,
      appointment_id: 44,
      patient_id: 12,
      visit_id: 99,
      doctor_id: 7,
      status: 'processing',
      resumed: false,
    });
    expect(claim.lease_owner).toBeTruthy();
    expect(state.getClaim()).toMatchObject({
      idempotency_key: 'complete-44-attempt-1',
      status: 'processing',
      lease_active: 1,
    });
  });

  it('rejects a concurrent request while the first completion lease is active', async () => {
    const state = createClaimDatabase();
    await acquireConsultationCompletionClaim(state.database, baseInput);

    await expect(acquireConsultationCompletionClaim(state.database, {
      ...baseInput,
      idempotencyKey: 'complete-44-attempt-2',
      requestHash: 'b'.repeat(64),
    })).rejects.toMatchObject({ status: 409 });

    expect(state.getClaim()).toMatchObject({
      idempotency_key: 'complete-44-attempt-1',
      status: 'processing',
      lease_active: 1,
    });
  });

  it('returns a conflict when an idempotency key belongs to another appointment', async () => {
    const state = createClaimDatabase({
      id: 777,
      tenant_id: 'tenant-1',
      appointment_id: 55,
      patient_id: 20,
      visit_id: 120,
      doctor_id: 7,
      idempotency_key: baseInput.idempotencyKey,
      request_hash: 'c'.repeat(64),
      status: 'failed',
      lease_token: null,
      lease_active: 0,
      soap_id: null,
      diagnosis_id: null,
      prescription_id: null,
      encounter_id: null,
      last_error_code: 'UNEXPECTED_ERROR',
    });

    await expect(acquireConsultationCompletionClaim(state.database, baseInput))
      .rejects.toMatchObject({ status: 409 });
  });

  it('takes over a failed or expired claim without creating a second appointment claim', async () => {
    const state = createClaimDatabase();
    const first = await acquireConsultationCompletionClaim(state.database, baseInput);
    await markConsultationCompletionFailed(state.database, baseInput.tenantId, first, new Error('temporary failure'));

    const resumed = await acquireConsultationCompletionClaim(state.database, {
      ...baseInput,
      idempotencyKey: 'complete-44-attempt-2',
      requestHash: 'b'.repeat(64),
    });

    expect(resumed).toMatchObject({ id: first.id, status: 'processing', resumed: true });
    expect(resumed.lease_owner).not.toBe(first.lease_owner);
    expect(state.getClaim()).toMatchObject({
      id: first.id,
      idempotency_key: 'complete-44-attempt-2',
      request_hash: 'b'.repeat(64),
      status: 'processing',
      lease_active: 1,
    });
  });

  it('checkpoints partial clinical references only for the active lease owner', async () => {
    const state = createClaimDatabase();
    const claim = await acquireConsultationCompletionClaim(state.database, baseInput);

    await updateConsultationCompletionClaim(state.database, baseInput.tenantId, claim, {
      soapId: 701,
      diagnosisId: 702,
      prescriptionId: 703,
    });

    expect(state.getClaim()).toMatchObject({
      soap_id: 701,
      diagnosis_id: 702,
      prescription_id: 703,
    });

    const lostLease = { ...claim, lease_owner: 'another-owner' } as OwnedConsultationCompletionClaim;
    await expect(updateConsultationCompletionClaim(state.database, baseInput.tenantId, lostLease, {
      encounterId: 704,
    })).rejects.toMatchObject({ status: 409 });
    expect(state.getClaim()?.encounter_id).toBeNull();
  });

  it('releases a failed claim and records a bounded error code', async () => {
    const state = createClaimDatabase();
    const claim = await acquireConsultationCompletionClaim(state.database, baseInput);

    await markConsultationCompletionFailed(state.database, baseInput.tenantId, claim, new Error('database unavailable'));

    expect(state.getClaim()).toMatchObject({
      status: 'failed',
      lease_token: null,
      lease_active: 0,
      last_error_code: 'UNEXPECTED_ERROR',
    });
  });

  it('reconciles a stale failed claim from the authoritative signed encounter on retry', async () => {
    const state = createClaimDatabase();
    const claim = await acquireConsultationCompletionClaim(state.database, baseInput);
    await markConsultationCompletionFailed(state.database, baseInput.tenantId, claim, new Error('response interrupted'));

    await reconcileSignedConsultationCompletionClaim(
      state.database,
      baseInput.tenantId,
      baseInput.appointmentId,
      905,
    );

    expect(state.getClaim()).toMatchObject({
      status: 'completed',
      encounter_id: 905,
      lease_token: null,
      lease_active: 0,
      last_error_code: null,
    });
  });

  it('finalizes the claim against the signed encounter and prevents stale-owner completion', async () => {
    const state = createClaimDatabase();
    const claim = await acquireConsultationCompletionClaim(state.database, baseInput);

    await markConsultationCompletionCompleted(state.database, baseInput.tenantId, claim, 900);

    expect(state.getClaim()).toMatchObject({
      status: 'completed',
      encounter_id: 900,
      lease_token: null,
      lease_active: 0,
    });

    await expect(markConsultationCompletionCompleted(
      state.database,
      baseInput.tenantId,
      claim,
      901,
    )).rejects.toMatchObject({ status: 409 });
  });
});
