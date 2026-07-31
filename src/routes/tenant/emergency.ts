import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getNextSequence } from '../../lib/sequence';
import { getDb } from '../../db';
import { createAuditLog } from '../../lib/accounting-helpers';
import { buildLocalSyncPatientCreateOutboxStatement } from '../../lib/local-sync-outbox';
import { buildLocalSyncPatientPayload } from '../../lib/local-sync-patient-payload';
import {
  getRequiredEmergencyAdmission,
  isEmergencyPatientProfileIncomplete,
  type EmergencyActiveAdmission,
  type EmergencyPatientProfileProjection,
} from '../../lib/emergency-admission-flow';
import {
  resolveActiveAdmissionsForLegacyPatients,
  type ActiveAdmissionProviderProjection,
} from '../../lib/canonical/admission-bed-provider';


const emergency = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createERPatientSchema = z.object({
  patient_id: z.number().int().positive().optional(),
  visit_id: z.number().int().positive().optional(),
  first_name: z.string().min(1),
  middle_name: z.string().optional(),
  last_name: z.string().min(1),
  gender: z.string().optional(),
  age: z.string().optional(),
  date_of_birth: z.string().optional(),
  contact_no: z.string().optional(),
  care_of_person_contact: z.string().optional(),
  address: z.string().optional(),
  referred_by: z.string().optional(),
  referred_to: z.string().optional(),
  case_type: z.string().optional(),
  condition_on_arrival: z.string().optional(),
  brought_by: z.string().optional(),
  relation_with_patient: z.string().optional(),
  mode_of_arrival_id: z.number().int().positive().optional(),
  care_of_person: z.string().optional(),
  performer_id: z.number().int().positive().optional(),
  performer_name: z.string().optional(),
  is_police_case: z.boolean().default(false),
  is_existing_patient: z.boolean().default(false),
  ward_no: z.number().int().positive().optional(),
  visit_datetime: z.string().optional(),
  patient_cases: z.object({
    main_case: z.number().optional(),
    sub_case: z.number().optional(),
    other_case_details: z.string().optional(),
    biting_site: z.number().optional(),
    datetime_of_bite: z.string().optional(),
    biting_animal: z.number().optional(),
    first_aid: z.number().optional(),
    first_aid_others: z.string().optional(),
    biting_animal_others: z.string().optional(),
    biting_site_others: z.string().optional(),
    biting_address: z.string().optional(),
    biting_animal_name: z.string().optional(),
  }).optional(),
});

const triageSchema = z.object({
  triage_code: z.enum(['red', 'yellow', 'green']),
});

const finalizeSchema = z.object({
  finalized_status: z.enum(['admitted', 'discharged', 'lama', 'dor', 'transferred', 'death']),
  finalized_remarks: z.string().optional(),
});

const dischargeSummarySchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive(),
  discharge_type: z.string().optional(),
  chief_complaints: z.string().optional(),
  treatment_in_er: z.string().optional(),
  investigations: z.string().optional(),
  advice_on_discharge: z.string().optional(),
  on_examination: z.string().optional(),
  provisional_diagnosis: z.string().optional(),
  doctor_name: z.string().optional(),
  medical_officer: z.string().optional(),
});

const updateERPatientSchema = createERPatientSchema
  .omit({ is_existing_patient: true })
  .partial();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function nextERNumber(db: D1Database, tenantId: string): Promise<string> {
  // ✅ Use sequence-based ER number (no more MAX(id) race condition)
  return getNextSequence(db, tenantId, 'er_patient', 'ER');
}

function escapeLike(value: string): string {
  return value.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function getDateFilter(selectedCase: number): string {
  const date = new Date();
  date.setDate(date.getDate() + selectedCase);
  return date.toISOString().split('T')[0];
}

function legacyPatientId(value: unknown): number | null {
  const patientId = Number(value);
  return Number.isSafeInteger(patientId) && patientId > 0 ? patientId : null;
}

function emergencyActiveAdmission(
  projection: ActiveAdmissionProviderProjection | undefined,
): EmergencyActiveAdmission | null {
  if (!projection) return null;
  return {
    id: projection.legacyAdmissionId,
    admission_no: projection.admissionNumber,
    admission_public_id: projection.admissionPublicId,
    mode: projection.mode,
  };
}

// ─── GET / — list ER patients ─────────────────────────────────────────────────

emergency.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const status = c.req.query('status') || 'all';
  const search = c.req.query('search');
  const days = parseInt(c.req.query('days') || '0');
  const dateFilter = getDateFilter(-Math.abs(days));

  let sql = `
    SELECT e.*, p.name as patient_name, p.patient_code,
           p.gender as patient_gender, p.mobile as patient_mobile,
           p.address as patient_address, p.date_of_birth as patient_date_of_birth,
           m.name as mode_of_arrival_name
    FROM er_patients e
    LEFT JOIN patients p ON p.id = e.patient_id AND p.tenant_id = e.tenant_id
    LEFT JOIN er_mode_of_arrival m ON m.id = e.mode_of_arrival_id AND m.tenant_id = e.tenant_id
    WHERE e.tenant_id = ? AND e.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (status !== 'all') {
    if (['admitted', 'discharged', 'lama', 'dor', 'transferred', 'death'].includes(status)) {
      sql += ` AND e.er_status = 'finalized' AND e.finalized_status = ?`;
      params.push(status);
    } else {
      sql += ` AND e.er_status = ?`;
      params.push(status);
    }
  }

  if (days > 0) {
    sql += ` AND DATE(e.visit_datetime) >= ?`;
    params.push(dateFilter);
  }

  if (search) {
    sql += ` AND (e.er_patient_number LIKE ? ESCAPE '\\' OR e.first_name LIKE ? ESCAPE '\\' OR e.last_name LIKE ? ESCAPE '\\' OR e.contact_no LIKE ? ESCAPE '\\')`;
    const escaped = escapeLike(search);
    const term = `%${escaped}%`;
    params.push(term, term, term, term);
  }

  sql += ` ORDER BY
    CASE e.triage_code WHEN 'red' THEN 1 WHEN 'yellow' THEN 2 WHEN 'green' THEN 3 ELSE 4 END,
    e.created_at DESC
    LIMIT 100`;

  const { results } = await db.$client.prepare(sql).bind(...params).all<Record<string, unknown>>();
  const patientIds = results
    .map((row) => legacyPatientId(row.patient_id))
    .filter((patientId): patientId is number => patientId != null);
  const activeAdmissions = await resolveActiveAdmissionsForLegacyPatients(
    c.env.DB,
    tenantId,
    patientIds,
  );
  const erPatients = results.map((row) => {
    const patientId = legacyPatientId(row.patient_id);
    const activeAdmission = patientId == null
      ? null
      : emergencyActiveAdmission(activeAdmissions.get(patientId));
    return {
      ...row,
      active_admission_id: activeAdmission?.id ?? null,
      active_admission_public_id: activeAdmission?.admission_public_id ?? null,
      active_admission_no: activeAdmission?.admission_no ?? null,
      active_admission_provider_mode: activeAdmission?.mode ?? null,
      profile_incomplete: isEmergencyPatientProfileIncomplete(row as EmergencyPatientProfileProjection),
    };
  });
  return c.json({ er_patients: erPatients, total: erPatients.length });
});

// ─── GET /stats — ER dashboard KPIs ──────────────────────────────────────────

emergency.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = new Date().toISOString().split('T')[0];

  // Replaced Promise.all() with db.$client.batch() for ER dashboard KPIs.
  // Why: Promise.all() sends 7 separate HTTP network requests to Cloudflare D1.
  const batchResults = await db.$client.batch([
    db.$client.prepare(`SELECT COUNT(*) as cnt FROM er_patients WHERE tenant_id = ? AND er_status = 'new' AND is_active = 1`)
      .bind(tenantId),
    db.$client.prepare(`SELECT COUNT(*) as cnt FROM er_patients WHERE tenant_id = ? AND er_status = 'triaged' AND is_active = 1`)
      .bind(tenantId),
    db.$client.prepare(`SELECT COUNT(*) as cnt FROM er_patients WHERE tenant_id = ? AND finalized_status = 'admitted' AND is_active = 1`)
      .bind(tenantId),
    db.$client.prepare(`SELECT COUNT(*) as cnt FROM er_patients WHERE tenant_id = ? AND finalized_status = 'discharged' AND is_active = 1 AND DATE(finalized_on) = ?`)
      .bind(tenantId, today),
    db.$client.prepare(`SELECT COUNT(*) as cnt FROM er_patients WHERE tenant_id = ? AND finalized_status = 'lama' AND is_active = 1`)
      .bind(tenantId),
    db.$client.prepare(`SELECT COUNT(*) as cnt FROM er_patients WHERE tenant_id = ? AND is_active = 1 AND DATE(visit_datetime) = ?`)
      .bind(tenantId, today),
    db.$client.prepare(
      `SELECT triage_code, COUNT(*) as cnt FROM er_patients
       WHERE tenant_id = ? AND er_status = 'triaged' AND is_active = 1
       GROUP BY triage_code`
    ).bind(tenantId)
  ]);

  const newCount = batchResults[0]?.results?.[0] as { cnt: number } | undefined;
  const triagedCount = batchResults[1]?.results?.[0] as { cnt: number } | undefined;
  const admittedCount = batchResults[2]?.results?.[0] as { cnt: number } | undefined;
  const dischargedCount = batchResults[3]?.results?.[0] as { cnt: number } | undefined;
  const lamaCount = batchResults[4]?.results?.[0] as { cnt: number } | undefined;
  const totalToday = batchResults[5]?.results?.[0] as { cnt: number } | undefined;
  const triageDist = batchResults[6]?.results ?? [];

  return c.json({
    new_patients: newCount?.cnt ?? 0,
    triaged_patients: triagedCount?.cnt ?? 0,
    admitted_today: admittedCount?.cnt ?? 0,
    discharged_today: dischargedCount?.cnt ?? 0,
    lama_count: lamaCount?.cnt ?? 0,
    total_today: totalToday?.cnt ?? 0,
    triage_distribution: triageDist,
  });
});

// ─── GET /modes-of-arrival — lookup data ─────────────────────────────────────

emergency.get('/modes-of-arrival', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM er_mode_of_arrival WHERE tenant_id = ? AND is_active = 1 ORDER BY name'
  ).bind(tenantId).all();
  return c.json({ modes: results });
});

// ─── POST /modes-of-arrival — seed modes for tenant ──────────────────────────

emergency.post('/modes-of-arrival/seed', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const defaultModes = ['Ambulance', 'Walk-in', 'Police', 'Referred', 'Brought by Others', 'Self'];

  const existing = await db.$client.prepare(
    'SELECT COUNT(*) as cnt FROM er_mode_of_arrival WHERE tenant_id = ?'
  ).bind(tenantId).first<{ cnt: number }>();

  if ((existing?.cnt ?? 0) > 0) {
    return c.json({ message: 'Modes already seeded' });
  }

  const stmts = defaultModes.map(name =>
    db.$client.prepare('INSERT INTO er_mode_of_arrival (tenant_id, name) VALUES (?, ?)').bind(tenantId, name)
  );
  await db.$client.batch(stmts);

  return c.json({ message: 'Seeded default modes of arrival', count: defaultModes.length }, 201);
});

// ─── GET /search-patients — search existing patients for ER registration ─────

emergency.get('/search-patients', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const search = c.req.query('q') || '';

  if (search.length < 2) {
    return c.json({ patients: [], total: 0 });
  }

  const escaped = escapeLike(search);
  const term = `%${escaped}%`;
  const { results } = await db.$client.prepare(`
    SELECT id, name, patient_code, gender, mobile, address, date_of_birth
    FROM patients
    WHERE tenant_id = ? AND (name LIKE ? ESCAPE '\\' OR mobile LIKE ? ESCAPE '\\' OR patient_code LIKE ? ESCAPE '\\')
    ORDER BY id DESC LIMIT 20
  `).bind(tenantId, term, term, term).all();

  return c.json({ patients: results, total: results.length });
});

// ─── GET /:id — single ER patient with cases + discharge summary ─────────────

emergency.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));

  const patient = await db.$client.prepare(`
    SELECT e.*, p.name as patient_name, p.patient_code,
           p.gender as patient_gender, p.mobile as patient_mobile,
           p.address as patient_address, p.date_of_birth as patient_date_of_birth,
           m.name as mode_of_arrival_name
    FROM er_patients e
    LEFT JOIN patients p ON p.id = e.patient_id AND p.tenant_id = e.tenant_id
    LEFT JOIN er_mode_of_arrival m ON m.id = e.mode_of_arrival_id AND m.tenant_id = e.tenant_id
    WHERE e.id = ? AND e.tenant_id = ?
  `).bind(id, tenantId).first<Record<string, unknown>>();

  if (!patient) throw new HTTPException(404, { message: 'ER patient not found' });

  const patientId = legacyPatientId(patient.patient_id);
  const activeAdmissions = patientId == null
    ? new Map<number, ActiveAdmissionProviderProjection>()
    : await resolveActiveAdmissionsForLegacyPatients(c.env.DB, tenantId, [patientId]);
  const activeAdmission = patientId == null
    ? null
    : emergencyActiveAdmission(activeAdmissions.get(patientId));

  // Get patient cases
  const cases = await db.$client.prepare(
    'SELECT * FROM er_patient_cases WHERE er_patient_id = ? AND tenant_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).bind(id, tenantId).first();

  // Get discharge summary if exists
  const patientAny = patient as any;
  const dischargeSummary = patientAny.discharge_summary_id
    ? await db.$client.prepare(
        'SELECT * FROM er_discharge_summaries WHERE id = ? AND tenant_id = ?'
      ).bind(patientAny.discharge_summary_id, tenantId).first()
    : null;

  return c.json({
    er_patient: {
      ...patient,
      active_admission_id: activeAdmission?.id ?? null,
      active_admission_public_id: activeAdmission?.admission_public_id ?? null,
      active_admission_no: activeAdmission?.admission_no ?? null,
      active_admission_provider_mode: activeAdmission?.mode ?? null,
      profile_incomplete: isEmergencyPatientProfileIncomplete(patient as EmergencyPatientProfileProjection),
      patient_cases: cases || null,
      discharge_summary: dischargeSummary,
    },
  });
});

// ─── POST / — register new ER patient ────────────────────────────────────────

emergency.post('/', zValidator('json', createERPatientSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  try {
    const erNumber = await nextERNumber(c.env.DB, tenantId);

    let patientId = data.patient_id || null;
    let visitId = data.visit_id || null;

    // If new patient (not existing), create the patient and its local-sync
    // outbox row in the same D1 batch. The sequence-backed patient code is
    // used to resolve the generated numeric ID without a MAX(id) race.
    if (!data.is_existing_patient && !patientId) {
      const patientCode = await getNextSequence(c.env.DB, tenantId, 'patient', 'P');
      const patientName = `${data.first_name} ${data.last_name}`.trim();
      const patientPayload = buildLocalSyncPatientPayload({
        tenantId,
        name: patientName,
        fatherHusband: '',
        address: data.address || '',
        mobile: data.contact_no || null,
        patientCode,
        dateOfBirth: data.date_of_birth || null,
        gender: data.gender?.toLowerCase() || null,
      });
      const patientInsertStatement = db.$client.prepare(`
        INSERT INTO patients (tenant_id, patient_code, name, father_husband, gender, mobile, address, date_of_birth, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        patientCode,
        patientName,
        '',
        data.gender?.toLowerCase() || null,
        data.contact_no || '',
        data.address || '',
        data.date_of_birth || null,
        now,
      );
      const patientStatements: D1PreparedStatement[] = [patientInsertStatement];
      const patientOutboxStatement = await buildLocalSyncPatientCreateOutboxStatement(c.env, {
        tenantId,
        patientCode,
        payload: patientPayload,
      });
      if (patientOutboxStatement) patientStatements.push(patientOutboxStatement);
      const [patientInsertResult] = await c.env.DB.batch(patientStatements);

      let createdPatientId = Number(patientInsertResult?.meta?.last_row_id ?? 0);
      if (!Number.isInteger(createdPatientId) || createdPatientId <= 0) {
        const createdPatient = await db.$client.prepare(`
          SELECT id
          FROM patients
          WHERE tenant_id = ? AND patient_code = ?
          LIMIT 1
        `).bind(tenantId, patientCode).first<{ id: number }>();
        createdPatientId = Number(createdPatient?.id ?? 0);
      }
      if (!Number.isInteger(createdPatientId) || createdPatientId <= 0) {
        throw new HTTPException(500, { message: 'Emergency patient registration linkage failed' });
      }
      patientId = createdPatientId;
    }

    // Create visit record for emergency
    if (!visitId && patientId) {
      const vResult = await db.$client.prepare(`
        INSERT INTO visits (tenant_id, patient_id, visit_date, visit_type, status, created_at)
        VALUES (?, ?, ?, 'emergency', 'initiated', ?)
      `).bind(tenantId, patientId, now.split('T')[0], now).run();
      visitId = vResult.meta.last_row_id as number;
    }

    // Create ER patient record
    const erResult = await db.$client.prepare(`
      INSERT INTO er_patients (
        tenant_id, er_patient_number, patient_id, visit_id, visit_datetime,
        first_name, middle_name, last_name, gender, age, date_of_birth,
        contact_no, care_of_person_contact, address, referred_by, referred_to,
        case_type, condition_on_arrival, brought_by, relation_with_patient,
        mode_of_arrival_id, care_of_person, er_status, performer_id, performer_name,
        is_police_case, is_existing_patient, ward_no, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, erNumber, patientId, visitId,
      data.visit_datetime || now,
      data.first_name, data.middle_name || null, data.last_name,
      data.gender || null, data.age || null, data.date_of_birth || null,
      data.contact_no || null, data.care_of_person_contact || null,
      data.address || null, data.referred_by || null, data.referred_to || null,
      data.case_type || null, data.condition_on_arrival || null,
      data.brought_by || null, data.relation_with_patient || null,
      data.mode_of_arrival_id || null, data.care_of_person || null,
      data.performer_id || null, data.performer_name || null,
      data.is_police_case ? 1 : 0, data.is_existing_patient ? 1 : 0,
      data.ward_no || null, userId
    ).run();

    const erPatientId = erResult.meta.last_row_id as number;

    // Create patient cases if provided
    if (data.patient_cases) {
      const pc = data.patient_cases;
      await db.$client.prepare(`
        INSERT INTO er_patient_cases (
          tenant_id, er_patient_id, main_case, sub_case, other_case_details,
          biting_site, datetime_of_bite, biting_animal, first_aid,
          first_aid_others, biting_animal_others, biting_site_others,
          biting_address, biting_animal_name, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId, erPatientId,
        pc.main_case || null, pc.sub_case || null, pc.other_case_details || null,
        pc.biting_site || null, pc.datetime_of_bite || null,
        pc.biting_animal || null, pc.first_aid || null,
        pc.first_aid_others || null, pc.biting_animal_others || null,
        pc.biting_site_others || null, pc.biting_address || null,
        pc.biting_animal_name || null, userId
      ).run();
    }

    return c.json({
      id: erPatientId,
      er_patient_number: erNumber,
      patient_id: patientId,
      visit_id: visitId,
    }, 201);
  } catch (err) {
    console.error('[EMERGENCY_POST]', err instanceof Error ? err.message : err);
    throw new HTTPException(500, { message: `ER registration failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
  }
});

// ─── PUT /:id/triage — assign triage code ────────────────────────────────────

emergency.put('/:id/triage', zValidator('json', triageSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  const { triage_code } = c.req.valid('json');
  const now = new Date().toISOString();

  const existing = await db.$client.prepare(
    'SELECT id FROM er_patients WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'ER patient not found' });

  await db.$client.prepare(`
    UPDATE er_patients SET
      triage_code = ?, er_status = 'triaged',
      triaged_by = ?, triaged_on = ?,
      updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(triage_code, userId, now, now, id, tenantId).run();

  return c.json({ success: true, triage_code });
});

// ─── PUT /:id/undo-triage — revert to new ───────────────────────────────────

emergency.put('/:id/undo-triage', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  const now = new Date().toISOString();

  const existing = await db.$client.prepare(
    `SELECT id FROM er_patients WHERE id = ? AND tenant_id = ? AND er_status = 'triaged'`
  ).bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Triaged ER patient not found' });

  await db.$client.prepare(`
    UPDATE er_patients SET
      er_status = 'new', triage_code = NULL,
      triaged_by = NULL, triaged_on = NULL,
      updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(now, id, tenantId).run();

  return c.json({ success: true, message: 'Triage undone' });
});

// ─── PUT /:id/finalize — admit/discharge/transfer/lama/death/dor ─────────────

emergency.put('/:id/finalize', zValidator('json', finalizeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  const { finalized_status, finalized_remarks } = c.req.valid('json');
  const now = new Date().toISOString();

  const existing = await db.$client.prepare(
    'SELECT id, patient_id, er_status, finalized_status FROM er_patients WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{
    id: number;
    patient_id: number | null;
    er_status: string;
    finalized_status: string | null;
  }>();

  if (!existing) throw new HTTPException(404, { message: 'ER patient not found' });

  let activeAdmission: EmergencyActiveAdmission | null = null;
  if (finalized_status === 'admitted') {
    const patientId = legacyPatientId(existing.patient_id);
    if (patientId == null) {
      throw new HTTPException(409, { message: 'Emergency case is not linked to a patient record' });
    }
    const activeAdmissions = await resolveActiveAdmissionsForLegacyPatients(
      c.env.DB,
      tenantId,
      [patientId],
    );
    activeAdmission = emergencyActiveAdmission(activeAdmissions.get(patientId));
  }
  const requiredAdmission = getRequiredEmergencyAdmission(finalized_status, activeAdmission);

  await db.$client.prepare(`
    UPDATE er_patients SET
      er_status = 'finalized',
      finalized_status = ?, finalized_remarks = ?,
      finalized_by = ?, finalized_on = ?,
      updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(finalized_status, finalized_remarks || null, userId, now, now, id, tenantId).run();

  await createAuditLog(c.env, tenantId, userId, 'UPDATE_STATUS', 'er_patients', id, {
    er_status: existing.er_status,
    finalized_status: existing.finalized_status,
  }, {
    er_status: 'finalized',
    finalized_status,
    admission_id: requiredAdmission?.id ?? null,
    admission_public_id: requiredAdmission?.admission_public_id ?? null,
    admission_no: requiredAdmission?.admission_no ?? null,
    admission_provider_mode: requiredAdmission?.mode ?? null,
  });

  return c.json({
    success: true,
    finalized_status,
    admission_id: requiredAdmission?.id ?? null,
    admission_public_id: requiredAdmission?.admission_public_id ?? null,
    admission_no: requiredAdmission?.admission_no ?? null,
    admission_provider_mode: requiredAdmission?.mode ?? null,
  });
});

// ─── POST /discharge-summary — create ER discharge summary ──────────────────

emergency.post('/discharge-summary', zValidator('json', dischargeSummarySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO er_discharge_summaries (
      tenant_id, patient_id, visit_id, discharge_type, chief_complaints,
      treatment_in_er, investigations, advice_on_discharge, on_examination,
      provisional_diagnosis, doctor_name, medical_officer, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id,
    data.discharge_type || null, data.chief_complaints || null,
    data.treatment_in_er || null, data.investigations || null,
    data.advice_on_discharge || null, data.on_examination || null,
    data.provisional_diagnosis || null, data.doctor_name || null,
    data.medical_officer || null, userId
  ).run();

  const summaryId = result.meta.last_row_id as number;

  // Update ER patient with discharge summary and finalize
  await db.$client.prepare(`
    UPDATE er_patients SET
      discharge_summary_id = ?,
      er_status = 'finalized', finalized_status = 'discharged',
      finalized_by = ?, finalized_on = ?, updated_at = ?
    WHERE patient_id = ? AND visit_id = ? AND tenant_id = ? AND er_status != 'finalized'
  `).bind(summaryId, userId, now, now, data.patient_id, data.visit_id, tenantId).run();

  return c.json({ id: summaryId, message: 'Discharge summary created' }, 201);
});

// ─── PUT /:id — general update (Zod validated) ──────────────────────────────

emergency.put('/:id', zValidator('json', updateERPatientSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  const existing = await db.$client.prepare(
    'SELECT id FROM er_patients WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'ER patient not found' });

  const allowedFields = [
    'first_name', 'middle_name', 'last_name', 'gender', 'age',
    'date_of_birth', 'contact_no', 'care_of_person_contact', 'address',
    'referred_by', 'referred_to', 'case_type', 'condition_on_arrival',
    'brought_by', 'relation_with_patient', 'mode_of_arrival_id',
    'care_of_person', 'performer_id', 'performer_name',
    'is_police_case', 'ward_no',
  ];

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const dataRecord = data as Record<string, unknown>;

  for (const field of allowedFields) {
    if (dataRecord[field] !== undefined) {
      sets.push(`${field} = ?`);
      vals.push(dataRecord[field] as string | number | null);
    }
  }

  if (sets.length === 0) return c.json({ message: 'No fields to update' }, 400);

  sets.push('updated_at = ?');
  vals.push(now, id, tenantId);

  await db.$client.prepare(
    `UPDATE er_patients SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  return c.json({ success: true });
});

export default emergency;
