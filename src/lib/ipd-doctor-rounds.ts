import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { hashLocalSyncPayload } from './local-sync-outbox';

export type DoctorRoundSource = 'nurse_station' | 'ipd_billing' | 'doctor_dashboard';

export type DoctorRoundClinicalStatus = 'billing_only' | 'documented' | 'signed' | 'cancelled';

export type PatientCondition = 'improving' | 'stable' | 'deteriorating' | 'critical';

export const PATIENT_CONDITIONS: readonly PatientCondition[] = ['improving', 'stable', 'deteriorating', 'critical'] as const;
export const CLINICAL_STATUSES: readonly DoctorRoundClinicalStatus[] = ['billing_only', 'documented', 'signed', 'cancelled'] as const;

export type CreateDoctorRoundInput = {
  admissionId: number;
  patientId: number;
  doctorId: number;
  roundDate: string;
  roundTime: string;
  entrySource: DoctorRoundSource;
  idempotencyKey: string;
};

export type CreateDoctorClinicalRoundInput = {
  admissionId: number;
  patientId: number;
  roundDate: string;
  roundTime: string;
  patientCondition: PatientCondition;
  title?: string | null;
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  roundSummary?: string | null;
  createBillingRound?: boolean;
  idempotencyKey: string;
};

export type DoctorClinicalRoundResult = {
  clinicalNoteId: number;
  clinicalNoteTitle: string;
  signedAt: string;
  roundId: number | null;
  provisionalItemId: number | null;
  fee: number | null;
  createdBilling: boolean;
  createdNote: boolean;
};

type DoctorRoundResult = {
  id: number;
  provisional_item_id: number;
  rounded_at: string;
  round_fee_snapshot: number;
};

function resultPayload(row: DoctorRoundResult, created: boolean) {
  return {
    roundId: Number(row.id),
    provisionalItemId: Number(row.provisional_item_id),
    roundedAt: String(row.rounded_at),
    fee: Number(row.round_fee_snapshot),
    created,
  };
}

async function buildRoundOutboxStatement(
  env: Env,
  tenantId: string,
  entityType: 'ipd_doctor_round' | 'billing_provisional_doctor_round',
  entityId: string,
  payload: Record<string, unknown>,
): Promise<D1PreparedStatement> {
  const payloadHash = await hashLocalSyncPayload(payload);
  const idempotencyKey = [
    env.LOCAL_SERVER_ID ?? 'local-server',
    tenantId,
    entityType,
    entityId,
    'upsert',
    payloadHash.slice(0, 24),
  ].join(':');
  return env.DB.prepare(`
    INSERT OR IGNORE INTO local_sync_outbox (
      tenant_id, entity_type, entity_id, operation, payload_hash,
      payload_json, schema_version, idempotency_key
    ) VALUES (?, ?, ?, 'upsert', ?, ?, 1, ?)
  `).bind(
    tenantId,
    entityType,
    entityId,
    payloadHash,
    JSON.stringify(payload),
    idempotencyKey,
  );
}

export function normalizeRoundDateTime(roundDate: string, roundTime: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(roundDate);
  if (!dateMatch) throw new HTTPException(400, { message: 'Invalid round date' });
  const [, year, month, day] = dateMatch;
  const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    utc.getUTCFullYear() !== Number(year)
    || utc.getUTCMonth() + 1 !== Number(month)
    || utc.getUTCDate() !== Number(day)
  ) {
    throw new HTTPException(400, { message: 'Invalid round date' });
  }

  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(roundTime);
  if (!timeMatch) throw new HTTPException(400, { message: 'Invalid round time' });
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new HTTPException(400, { message: 'Invalid round time' });
  }
  return `${roundDate} ${timeMatch[1]}:${timeMatch[2]}:${String(second).padStart(2, '0')}`;
}

async function loadRoundByIdempotencyKey(
  db: D1Database,
  tenantId: string,
  idempotencyKey: string,
  requireLink = false,
): Promise<DoctorRoundResult | null> {
  return db.prepare(`
    SELECT id, provisional_item_id, rounded_at, round_fee_snapshot
    FROM ipd_doctor_rounds
    WHERE tenant_id = ? AND idempotency_key = ?
      ${requireLink ? 'AND provisional_item_id IS NOT NULL' : ''}
    LIMIT 1
  `).bind(tenantId, idempotencyKey).first<DoctorRoundResult>();
}

export async function createIpdDoctorRound(
  env: Env,
  tenantId: string,
  userId: string,
  input: CreateDoctorRoundInput,
) {
  const existing = await loadRoundByIdempotencyKey(env.DB, tenantId, input.idempotencyKey);
  if (existing?.provisional_item_id) return resultPayload(existing, false);

  const admission = await env.DB.prepare(`
    SELECT id, patient_id, status
    FROM admissions
    WHERE id = ? AND patient_id = ? AND tenant_id = ?
      AND status IN ('admitted', 'critical')
    LIMIT 1
  `).bind(input.admissionId, input.patientId, tenantId).first<{ id: number }>();
  if (!admission) throw new HTTPException(400, { message: 'Active admission not found for this patient' });

  const doctor = await env.DB.prepare(`
    SELECT id, name, ipd_round_fee, is_active
    FROM doctors
    WHERE id = ? AND tenant_id = ? AND is_active = 1
    LIMIT 1
  `).bind(input.doctorId, tenantId).first<{ id: number; name: string; ipd_round_fee: number }>();
  if (!doctor) throw new HTTPException(400, { message: 'Invalid or inactive doctor' });
  const fee = Number(doctor.ipd_round_fee ?? 0);
  if (!Number.isInteger(fee) || fee <= 0) {
    throw new HTTPException(400, { message: 'IPD round fee is not configured for this doctor' });
  }

  const roundedAt = normalizeRoundDateTime(input.roundDate, input.roundTime);
  const itemName = `IPD Round - ${doctor.name}`;
  const auditValue = JSON.stringify({
    admission_id: input.admissionId,
    patient_id: input.patientId,
    doctor_id: input.doctorId,
    rounded_at: roundedAt,
    round_fee: fee,
    entry_source: input.entrySource,
  });

  const outboxStatements: D1PreparedStatement[] = [];
  if (env.ENVIRONMENT === 'local_server') {
    const roundPayload = {
      tenant_id: tenantId,
      admission_id: input.admissionId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      rounded_at: roundedAt,
      doctor_name_snapshot: doctor.name,
      round_fee_snapshot: fee,
      entry_source: input.entrySource,
      entered_by: userId,
      idempotency_key: input.idempotencyKey,
      status: 'active',
    };
    const provisionalPayload = {
      tenant_id: tenantId,
      admission_id: input.admissionId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      doctor_name: doctor.name,
      item_name: itemName,
      unit_price: fee,
      round_idempotency_key: input.idempotencyKey,
      item_category: 'doctor_round',
      bill_status: 'provisional',
      created_by: userId,
    };
    outboxStatements.push(
      await buildRoundOutboxStatement(env, tenantId, 'ipd_doctor_round', input.idempotencyKey, roundPayload),
      await buildRoundOutboxStatement(env, tenantId, 'billing_provisional_doctor_round', input.idempotencyKey, provisionalPayload),
    );
  }

  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO ipd_doctor_rounds (
        tenant_id, admission_id, patient_id, doctor_id, rounded_at,
        doctor_name_snapshot, round_fee_snapshot, entry_source, entered_by,
        idempotency_key, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).bind(
      tenantId, input.admissionId, input.patientId, input.doctorId, roundedAt,
      doctor.name, fee, input.entrySource, userId, input.idempotencyKey,
    ),
    env.DB.prepare(`
      INSERT OR IGNORE INTO billing_provisional_items (
        tenant_id, patient_id, admission_id, item_category, item_name,
        department, unit_price, quantity, discount_percent, discount_amount,
        total_amount, doctor_id, doctor_name, reference_id, bill_status,
        is_insurance, is_active, created_by, created_at
      )
      SELECT r.tenant_id, r.patient_id, r.admission_id, 'doctor_round', ?,
        'Doctor Round', r.round_fee_snapshot, 1, 0, 0, r.round_fee_snapshot,
        r.doctor_id, r.doctor_name_snapshot, r.id, 'provisional', 0, 1, ?,
        datetime('now', '+6 hours')
      FROM ipd_doctor_rounds r
      WHERE r.tenant_id = ? AND r.idempotency_key = ?
        AND r.provisional_item_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM billing_provisional_items pi
          WHERE pi.tenant_id = r.tenant_id
            AND pi.item_category = 'doctor_round'
            AND pi.reference_id = r.id
        )
    `).bind(itemName, userId, tenantId, input.idempotencyKey),
    env.DB.prepare(`
      UPDATE ipd_doctor_rounds
      SET provisional_item_id = (
        SELECT pi.id FROM billing_provisional_items pi
        WHERE pi.tenant_id = ipd_doctor_rounds.tenant_id
          AND pi.item_category = 'doctor_round'
          AND pi.reference_id = ipd_doctor_rounds.id
        ORDER BY pi.id DESC LIMIT 1
      ), updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND idempotency_key = ? AND provisional_item_id IS NULL
    `).bind(tenantId, input.idempotencyKey),
    env.DB.prepare(`
      INSERT INTO audit_logs (
        tenant_id, user_id, action, table_name, record_id, new_value, created_at
      )
      SELECT r.tenant_id, ?, 'CREATE', 'ipd_doctor_rounds', r.id, ?, datetime('now', '+6 hours')
      FROM ipd_doctor_rounds r
      WHERE r.tenant_id = ? AND r.idempotency_key = ?
        AND NOT EXISTS (
          SELECT 1 FROM audit_logs al
          WHERE al.tenant_id = r.tenant_id
            AND al.table_name = 'ipd_doctor_rounds'
            AND al.record_id = r.id AND al.action = 'CREATE'
        )
    `).bind(userId, auditValue, tenantId, input.idempotencyKey),
    ...outboxStatements,
  ]);

  const created = await loadRoundByIdempotencyKey(env.DB, tenantId, input.idempotencyKey, true);
  if (!created) throw new HTTPException(500, { message: 'Doctor round billing linkage failed' });
  return resultPayload(created, true);
}

export async function cancelIpdDoctorRound(
  env: Env,
  tenantId: string,
  userId: string,
  roundId: number,
  reason: string,
) {
  const round = await env.DB.prepare(`
    SELECT r.id, r.status, r.provisional_item_id, r.admission_id, r.patient_id,
      r.doctor_id, r.rounded_at, r.doctor_name_snapshot, r.round_fee_snapshot,
      r.entry_source, r.entered_by, r.idempotency_key, pi.bill_status
    FROM ipd_doctor_rounds r
    LEFT JOIN billing_provisional_items pi
      ON pi.id = r.provisional_item_id AND pi.tenant_id = r.tenant_id
    WHERE r.id = ? AND r.tenant_id = ?
  `).bind(roundId, tenantId).first<{
    id: number;
    status: string;
    provisional_item_id: number | null;
    bill_status: string | null;
    admission_id: number;
    patient_id: number;
    doctor_id: number;
    rounded_at: string;
    doctor_name_snapshot: string;
    round_fee_snapshot: number;
    entry_source: DoctorRoundSource;
    entered_by: number;
    idempotency_key: string;
  }>();
  if (!round) throw new HTTPException(404, { message: 'Doctor round not found' });
  if (round.status !== 'active') throw new HTTPException(409, { message: 'Doctor round is already cancelled' });
  if (!round.provisional_item_id || round.bill_status !== 'provisional') {
    throw new HTTPException(409, { message: 'Finalized doctor round requires billing reversal' });
  }

  const outboxStatements: D1PreparedStatement[] = [];
  if (env.ENVIRONMENT === 'local_server') {
    outboxStatements.push(
      await buildRoundOutboxStatement(env, tenantId, 'ipd_doctor_round', round.idempotency_key, {
        tenant_id: tenantId,
        admission_id: round.admission_id,
        patient_id: round.patient_id,
        doctor_id: round.doctor_id,
        rounded_at: round.rounded_at,
        doctor_name_snapshot: round.doctor_name_snapshot,
        round_fee_snapshot: round.round_fee_snapshot,
        entry_source: round.entry_source,
        entered_by: round.entered_by,
        idempotency_key: round.idempotency_key,
        status: 'cancelled',
        cancel_reason: reason,
        cancelled_by: userId,
      }),
      await buildRoundOutboxStatement(env, tenantId, 'billing_provisional_doctor_round', round.idempotency_key, {
        tenant_id: tenantId,
        admission_id: round.admission_id,
        patient_id: round.patient_id,
        doctor_id: round.doctor_id,
        doctor_name: round.doctor_name_snapshot,
        item_name: `IPD Round - ${round.doctor_name_snapshot}`,
        unit_price: round.round_fee_snapshot,
        round_idempotency_key: round.idempotency_key,
        item_category: 'doctor_round',
        bill_status: 'cancelled',
        cancel_reason: reason,
        cancelled_by: userId,
      }),
    );
  }

  const batchResults = await env.DB.batch([
    env.DB.prepare(`
      UPDATE ipd_doctor_rounds
      SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?,
        cancelled_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND status = 'active'
    `).bind(reason, userId, roundId, tenantId),
    env.DB.prepare(`
      UPDATE billing_provisional_items
      SET bill_status = 'cancelled', cancel_reason = ?, cancelled_by = ?,
        cancelled_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND bill_status = 'provisional'
    `).bind(reason, userId, round.provisional_item_id, tenantId),
    env.DB.prepare(`
      INSERT INTO audit_logs (
        tenant_id, user_id, action, table_name, record_id, new_value, created_at
      )
      SELECT r.tenant_id, ?, 'CANCEL', 'ipd_doctor_rounds', r.id, ?, datetime('now', '+6 hours')
      FROM ipd_doctor_rounds r
      WHERE r.id = ? AND r.tenant_id = ? AND r.status = 'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM audit_logs al
          WHERE al.tenant_id = r.tenant_id
            AND al.table_name = 'ipd_doctor_rounds'
            AND al.record_id = r.id AND al.action = 'CANCEL'
        )
    `).bind(userId, JSON.stringify({ reason }), roundId, tenantId),
    ...outboxStatements,
  ]);

  const roundCancelled = Number(batchResults[0]?.meta?.changes ?? 0);
  const provisionalCancelled = Number(batchResults[1]?.meta?.changes ?? 0);
  if (roundCancelled !== 1 || provisionalCancelled !== 1) {
    throw new HTTPException(409, { message: 'Doctor round cancellation could not be completed safely' });
  }

  return { success: true };
}

/* ─── Doctor-driven clinical round workflow ────────────────────────────────── */

export async function resolveDoctorIdForUser(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<number | null> {
  const direct = await db.prepare(`
    SELECT id
    FROM doctors
    WHERE user_id = ? AND tenant_id = ? AND is_active = 1
    LIMIT 1
  `).bind(userId, tenantId).first<{ id: number }>();
  if (direct?.id) return Number(direct.id);

  const staffLinked = await db.prepare(`
    SELECT d.id
    FROM staff s
    JOIN doctors d ON d.id = s.doctor_id AND d.tenant_id = s.tenant_id
    WHERE s.user_id = ? AND s.tenant_id = ? AND d.is_active = 1
    LIMIT 1
  `).bind(userId, tenantId).first<{ id: number }>();
  return staffLinked?.id ? Number(staffLinked.id) : null;
}

async function loadDoctorByUserId(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<{ id: number; name: string; ipd_round_fee: number } | null> {
  const direct = await db.prepare(`
    SELECT id, name, ipd_round_fee
    FROM doctors
    WHERE user_id = ? AND tenant_id = ? AND is_active = 1
    LIMIT 1
  `).bind(userId, tenantId).first<{ id: number; name: string; ipd_round_fee: number }>();
  if (direct) return direct;

  return db.prepare(`
    SELECT d.id, d.name, d.ipd_round_fee
    FROM staff s
    JOIN doctors d ON d.id = s.doctor_id AND d.tenant_id = s.tenant_id
    WHERE s.user_id = ? AND s.tenant_id = ? AND d.is_active = 1
    LIMIT 1
  `).bind(userId, tenantId).first<{ id: number; name: string; ipd_round_fee: number }>();
}

async function findRoundForLinking(
  db: D1Database,
  tenantId: string,
  admissionId: number,
  doctorId: number,
  roundDate: string,
): Promise<{
  id: number;
  provisional_item_id: number | null;
  status: string;
  clinical_status: string;
  clinical_note_id: number | null;
  rounded_at: string;
  doctor_name_snapshot: string;
  round_fee_snapshot: number;
  entry_source: DoctorRoundSource;
  entered_by: number;
  idempotency_key: string;
} | null> {
  return db.prepare(`
    SELECT id, provisional_item_id, status, clinical_status, clinical_note_id,
      rounded_at, doctor_name_snapshot, round_fee_snapshot, entry_source,
      entered_by, idempotency_key
    FROM ipd_doctor_rounds
    WHERE tenant_id = ? AND admission_id = ? AND doctor_id = ?
      AND substr(rounded_at, 1, 10) = ?
    ORDER BY rounded_at DESC, id DESC
    LIMIT 1
  `).bind(tenantId, admissionId, doctorId, roundDate).first<{
    id: number;
    provisional_item_id: number | null;
    status: string;
    clinical_status: string;
    clinical_note_id: number | null;
    rounded_at: string;
    doctor_name_snapshot: string;
    round_fee_snapshot: number;
    entry_source: DoctorRoundSource;
    entered_by: number;
    idempotency_key: string;
  }>();
}

async function findClinicalNoteByIdempotencyKey(
  db: D1Database,
  tenantId: string,
  patientId: number,
  idempotencyKey: string,
): Promise<{ id: number; title: string; signed_at: string } | null> {
  return db.prepare(`
    SELECT id, title, signed_at
    FROM clinical_notes
    WHERE tenant_id = ? AND patient_id = ? AND idempotency_key = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(tenantId, patientId, idempotencyKey).first<{
    id: number;
    title: string;
    signed_at: string;
  }>();
}

export async function createDoctorClinicalRound(
  env: Env,
  tenantId: string,
  userId: string,
  input: CreateDoctorClinicalRoundInput,
): Promise<DoctorClinicalRoundResult> {
  const doctor = await loadDoctorByUserId(env.DB, tenantId, userId);
  if (!doctor) throw new HTTPException(403, { message: 'Doctor profile not linked to this user' });

  // 1) Replay protection — if a note for this idempotency key already exists,
  //    return the prior note + linked round. We check this BEFORE any insert.
  const priorNote = await findClinicalNoteByIdempotencyKey(env.DB, tenantId, input.patientId, input.idempotencyKey);
  if (priorNote) {
    const linkedRound = await env.DB.prepare(`
      SELECT id, provisional_item_id, round_fee_snapshot, status, clinical_status
      FROM ipd_doctor_rounds
      WHERE tenant_id = ? AND clinical_note_id = ?
      ORDER BY id DESC LIMIT 1
    `).bind(tenantId, priorNote.id).first<{
      id: number; provisional_item_id: number | null; round_fee_snapshot: number | null;
      status: string; clinical_status: string;
    }>();
    return {
      clinicalNoteId: priorNote.id,
      clinicalNoteTitle: priorNote.title,
      signedAt: priorNote.signed_at,
      roundId: linkedRound?.id ?? null,
      provisionalItemId: linkedRound?.provisional_item_id ?? null,
      fee: linkedRound?.round_fee_snapshot ?? null,
      createdBilling: false,
      createdNote: false,
    };
  }

  const admission = await env.DB.prepare(`
    SELECT id, patient_id, status
    FROM admissions
    WHERE id = ? AND patient_id = ? AND tenant_id = ?
      AND status IN ('admitted', 'critical')
    LIMIT 1
  `).bind(input.admissionId, input.patientId, tenantId).first<{ id: number }>();
  if (!admission) throw new HTTPException(400, { message: 'Active admission not found for this patient' });

  const doctorOnAdmission = await env.DB.prepare(`
    SELECT doctor_id FROM admissions WHERE id = ? AND tenant_id = ?
  `).bind(input.admissionId, tenantId).first<{ doctor_id: number | null }>();
  if (doctorOnAdmission && doctorOnAdmission.doctor_id && doctorOnAdmission.doctor_id !== doctor.id) {
    throw new HTTPException(403, { message: 'This admission is not assigned to you' });
  }

  // 2) Validate the doctor round fee BEFORE inserting the clinical note so a
  //    missing fee does not leave an orphan note behind.
  const doctorFee = Number(doctor.ipd_round_fee ?? 0);
  if (input.createBillingRound && (!Number.isInteger(doctorFee) || doctorFee <= 0)) {
    throw new HTTPException(400, {
      message: 'Doctor IPD round fee is not configured; cannot create billing round',
    });
  }

  const roundedAt = normalizeRoundDateTime(input.roundDate, input.roundTime);
  const noteTitle = (input.title?.trim() || `IPD Round Note · ${input.roundDate} ${input.roundTime}`).slice(0, 500);
  const composedContent = [
    input.subjective ? `Subjective: ${input.subjective}` : null,
    input.objective ? `Objective: ${input.objective}` : null,
    input.assessment ? `Assessment: ${input.assessment}` : null,
    input.plan ? `Plan: ${input.plan}` : null,
    input.roundSummary ? `Summary: ${input.roundSummary}` : null,
  ].filter(Boolean).join('\n\n');

  const auditPayload = JSON.stringify({
    admission_id: input.admissionId,
    patient_id: input.patientId,
    doctor_id: doctor.id,
    patient_condition: input.patientCondition,
    create_billing: Boolean(input.createBillingRound),
    round_summary: input.roundSummary ?? null,
    idempotency_key: input.idempotencyKey,
  });

  // Resolve billing first. If a later clinical write fails, the valid billing
  // event remains unlinked and can be documented safely on retry.
  let roundId: number | null = null;
  let provisionalItemId: number | null = null;
  let fee: number | null = null;
  let createdBilling = false;
  let linkStatus: 'signed' | 'documented' | null = null;
  let linkedRoundPayload: Record<string, unknown> | null = null;
  const signedAt = new Date().toISOString();
  const existingRound = await findRoundForLinking(
    env.DB,
    tenantId,
    input.admissionId,
    doctor.id,
    input.roundDate,
  );

  if (input.createBillingRound) {
    if (existingRound && existingRound.status === 'active') {
      if (existingRound.clinical_note_id) {
        throw new HTTPException(409, {
          message: 'Existing billing round for today already linked to a different clinical note',
        });
      }
      roundId = existingRound.id;
      provisionalItemId = existingRound.provisional_item_id;
      fee = Number(existingRound.round_fee_snapshot ?? doctorFee);
      linkStatus = 'signed';
      linkedRoundPayload = {
        tenant_id: tenantId,
        admission_id: input.admissionId,
        patient_id: input.patientId,
        doctor_id: doctor.id,
        rounded_at: existingRound.rounded_at,
        doctor_name_snapshot: existingRound.doctor_name_snapshot,
        round_fee_snapshot: Number(existingRound.round_fee_snapshot ?? doctorFee),
        entry_source: existingRound.entry_source,
        entered_by: existingRound.entered_by,
        idempotency_key: existingRound.idempotency_key,
        status: 'active',
      };
    } else {
      const billingResult = await createIpdDoctorRound(env, tenantId, userId, {
        admissionId: input.admissionId,
        patientId: input.patientId,
        doctorId: doctor.id,
        roundDate: input.roundDate,
        roundTime: input.roundTime,
        entrySource: 'doctor_dashboard',
        idempotencyKey: `doc:${input.idempotencyKey}`,
      });
      roundId = billingResult.roundId;
      provisionalItemId = billingResult.provisionalItemId;
      fee = billingResult.fee;
      createdBilling = billingResult.created;
      linkStatus = 'signed';
      linkedRoundPayload = {
        tenant_id: tenantId,
        admission_id: input.admissionId,
        patient_id: input.patientId,
        doctor_id: doctor.id,
        rounded_at: roundedAt,
        doctor_name_snapshot: doctor.name,
        round_fee_snapshot: Number(fee ?? doctorFee),
        entry_source: 'doctor_dashboard',
        entered_by: userId,
        idempotency_key: `doc:${input.idempotencyKey}`,
        status: 'active',
      };
    }
  } else if (existingRound && existingRound.status === 'active' && !existingRound.clinical_note_id) {
    roundId = existingRound.id;
    provisionalItemId = existingRound.provisional_item_id;
    linkStatus = 'documented';
    linkedRoundPayload = {
      tenant_id: tenantId,
      admission_id: input.admissionId,
      patient_id: input.patientId,
      doctor_id: doctor.id,
      rounded_at: existingRound.rounded_at,
      doctor_name_snapshot: existingRound.doctor_name_snapshot,
      round_fee_snapshot: Number(existingRound.round_fee_snapshot ?? doctorFee),
      entry_source: existingRound.entry_source,
      entered_by: existingRound.entered_by,
      idempotency_key: existingRound.idempotency_key,
      status: 'active',
    };
  }

  const noteInsert = env.DB.prepare(`
    INSERT INTO clinical_notes (
      tenant_id, patient_id, note_type, title, idempotency_key, content,
      subjective, objective, assessment, plan,
      performer_id, is_signed, signed_by, signed_at,
      is_active, created_by, created_at, updated_at
    ) VALUES (?, ?, 'round', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now', '+6 hours'), 1, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    input.patientId,
    noteTitle,
    input.idempotencyKey,
    composedContent,
    input.subjective ?? null,
    input.objective ?? null,
    input.assessment ?? null,
    input.plan ?? null,
    doctor.id,
    userId,
    userId,
  );

  const clinicalNoteIdSql = `(
    SELECT id FROM clinical_notes
    WHERE tenant_id = ? AND patient_id = ? AND idempotency_key = ?
  )`;
  const clinicalStatements: D1PreparedStatement[] = [noteInsert];
  if (roundId && linkStatus) {
    clinicalStatements.push(env.DB.prepare(`
      UPDATE ipd_doctor_rounds
      SET clinical_note_id = ${clinicalNoteIdSql}, clinical_status = ?,
          signed_by = ?, signed_at = datetime('now', '+6 hours'),
          round_summary = ?, patient_condition = ?,
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND status = 'active' AND clinical_note_id IS NULL
    `).bind(
      tenantId,
      input.patientId,
      input.idempotencyKey,
      linkStatus,
      userId,
      input.roundSummary ?? null,
      input.patientCondition,
      roundId,
      tenantId,
    ));
  }
  clinicalStatements.push(env.DB.prepare(`
    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, new_value, created_at)
    VALUES (?, ?, 'SIGN', 'clinical_notes', ${clinicalNoteIdSql}, ?, datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    userId,
    tenantId,
    input.patientId,
    input.idempotencyKey,
    auditPayload,
  ));
  if (env.ENVIRONMENT === 'local_server' && linkedRoundPayload && linkStatus) {
    const roundKey = String(linkedRoundPayload.idempotency_key ?? '');
    clinicalStatements.push(await buildRoundOutboxStatement(
      env,
      tenantId,
      'ipd_doctor_round',
      roundKey,
      {
        ...linkedRoundPayload,
        clinical_status: linkStatus,
        signed_by: userId,
        signed_at: signedAt,
        round_summary: input.roundSummary ?? null,
        patient_condition: input.patientCondition,
        clinical_note_idempotency_key: input.idempotencyKey,
      },
    ));
  }

  const batchResults = await env.DB.batch(clinicalStatements);
  let clinicalNoteId = Number(batchResults[0]?.meta?.last_row_id ?? 0);
  if (!clinicalNoteId) {
    const createdNote = await findClinicalNoteByIdempotencyKey(
      env.DB,
      tenantId,
      input.patientId,
      input.idempotencyKey,
    );
    if (!createdNote) throw new HTTPException(500, { message: 'Clinical round note was not persisted' });
    clinicalNoteId = createdNote.id;
  }

  return {
    clinicalNoteId,
    clinicalNoteTitle: noteTitle,
    signedAt,
    roundId,
    provisionalItemId,
    fee,
    createdBilling,
    createdNote: true,
  };
}
