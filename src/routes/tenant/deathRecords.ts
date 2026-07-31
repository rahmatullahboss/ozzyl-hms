import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { createAuditLog } from '../../lib/accounting-helpers';
import { assertNoPendingDischargeBilling } from '../../lib/discharge-billing-guards';

const deathRecords = new Hono<{ Bindings: Env; Variables: Variables }>();

const createDeathSchema = z.object({
  admission_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  date_of_death: z.string().min(1),
  time_of_death: z.string().optional(),
  cause_of_death: z.string().optional(),
  secondary_cause: z.string().optional(),
  manner_of_death: z.enum(['natural', 'accident', 'suicide', 'homicide', 'pending', 'undetermined']).default('natural'),
  death_type_id: z.number().int().positive().optional(),
  certifying_doctor_id: z.number().int().positive().optional(),
  is_mlc: z.boolean().default(false),
  is_medico_legal: z.boolean().optional(),
  is_autopsy_required: z.boolean().default(false),
  next_of_kin_name: z.string().optional(),
  next_of_kin_relation: z.string().optional(),
  next_of_kin_phone: z.string().optional(),
  remarks: z.string().optional(),
});

const updateDeathSchema = z.object({
  cause_of_death: z.string().optional(),
  secondary_cause: z.string().optional(),
  manner_of_death: z.enum(['natural', 'accident', 'suicide', 'homicide', 'pending', 'undetermined']).optional(),
  death_type_id: z.number().int().positive().optional(),
  autopsy_findings: z.string().optional(),
  death_certificate_no: z.string().optional(),
  death_certificate_issued: z.boolean().optional(),
  next_of_kin_notified: z.boolean().optional(),
  remarks: z.string().optional(),
});

// GET /api/death-records — list
deathRecords.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const search = c.req.query('search') || '';
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';

  let sql = `
    SELECT d.*, p.name AS patient_name, p.patient_code, a.admission_no, a.bed_id,
           b.ward_name AS ward, b.bed_number
    FROM death_details d
    LEFT JOIN patients p ON d.patient_id = p.id
    LEFT JOIN admissions a ON d.admission_id = a.id
    LEFT JOIN beds b ON a.bed_id = b.id
    WHERE d.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (search) {
    sql += ` AND (p.name LIKE ? OR p.patient_code LIKE ? OR a.admission_no LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (from) { sql += ' AND d.date_of_death >= ?'; params.push(from); }
  if (to) { sql += ' AND d.date_of_death <= ?'; params.push(to); }

  sql += ' ORDER BY d.date_of_death DESC, d.time_of_death DESC LIMIT 100';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ records: results });
});

// GET /api/death-records/:id — detail
deathRecords.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = c.req.param('id');
  const record = await db.$client.prepare(`
    SELECT d.*, p.name AS patient_name, p.patient_code, p.gender, p.date_of_birth, p.mobile, p.address,
           a.admission_no, a.admission_date, a.provisional_diagnosis,
           b.ward_name, b.bed_number,
           doc.name AS certifying_doctor_name_joined
    FROM death_details d
    LEFT JOIN patients p ON d.patient_id = p.id
    LEFT JOIN admissions a ON d.admission_id = a.id
    LEFT JOIN beds b ON a.bed_id = b.id
    LEFT JOIN doctors doc ON d.certifying_doctor_id = doc.id
    WHERE d.id = ? AND d.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!record) throw new HTTPException(404, { message: 'Death record not found' });
  return c.json({ record });
});

// POST /api/death-records — record death (also discharges the admission as 'expired')
deathRecords.post('/', zValidator('json', createDeathSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['doctor', 'hospital_admin', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to record deaths' });
  }

  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const adm = await db.$client.prepare(
    `SELECT id, bed_id, patient_id, admission_date, status FROM admissions WHERE id = ? AND tenant_id = ?`
  ).bind(data.admission_id, tenantId).first<{ id: number; bed_id: number | null; patient_id: number; admission_date: string | null; status: string }>();

  if (!adm) throw new HTTPException(404, { message: 'Admission not found' });
  if (adm.status === 'discharged') throw new HTTPException(400, { message: 'Patient already discharged' });
  if (Number(adm.patient_id) !== Number(data.patient_id)) {
    throw new HTTPException(400, { message: 'Patient does not match admission' });
  }

  const existing = await db.$client.prepare(
    `SELECT id FROM death_details WHERE admission_id = ? AND tenant_id = ?`
  ).bind(data.admission_id, tenantId).first();
  if (existing) throw new HTTPException(400, { message: 'Death already recorded for this admission' });

  await assertAccountingPeriodOpen(c.env.DB, tenantId, data.date_of_death, 'Death discharge');
  await assertNoPendingDischargeBilling(db.$client, tenantId, adm.id, adm.patient_id, adm.admission_date);

  let doctorName: string | null = null;
  if (data.certifying_doctor_id) {
    const doc = await db.$client.prepare(
      `SELECT name FROM doctors WHERE id = ? AND tenant_id = ?`
    ).bind(data.certifying_doctor_id, tenantId).first<{ name: string }>();
    doctorName = doc?.name ?? null;
  }

  const batchStmts: D1PreparedStatement[] = [
    db.$client.prepare(`
      INSERT INTO death_details (
        tenant_id, admission_id, patient_id, date_of_death, time_of_death,
        cause_of_death, secondary_cause, manner_of_death, place_of_death,
        death_type_id, certifying_doctor_id, certifying_doctor_name, is_mlc, is_medico_legal, is_autopsy_required,
        next_of_kin_name, next_of_kin_relation, next_of_kin_phone, remarks, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'hospital', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, data.admission_id, data.patient_id,
      data.date_of_death, data.time_of_death ?? null,
      data.cause_of_death ?? null, data.secondary_cause ?? null,
      data.manner_of_death,
      data.death_type_id ?? null, data.certifying_doctor_id ?? null, doctorName,
      data.is_mlc ? 1 : 0, (data.is_medico_legal ?? data.is_mlc) ? 1 : 0, data.is_autopsy_required ? 1 : 0,
      data.next_of_kin_name ?? null, data.next_of_kin_relation ?? null,
      data.next_of_kin_phone ?? null, data.remarks ?? null, userId,
    ),
    db.$client.prepare(
      `UPDATE admissions SET status = 'discharged', discharge_date = ?, discharge_type = 'death',
        discharge_condition_id = COALESCE((SELECT id FROM discharge_condition_types WHERE name = 'Expired' AND (tenant_id = ? OR tenant_id = 0) LIMIT 1), discharge_condition_id),
        updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
    ).bind(data.date_of_death, tenantId, data.admission_id, tenantId),
    db.$client.prepare(
      `UPDATE patient_bed_infos SET ended_on = datetime('now', '+6 hours'),
        days = MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1),
        charge_amount = rate_per_day * MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1)
       WHERE tenant_id = ? AND admission_id = ? AND ended_on IS NULL`
    ).bind(tenantId, data.admission_id),
  ];

  if (adm.bed_id) {
    batchStmts.push(
      db.$client.prepare(
        `UPDATE beds SET status = 'cleaning' WHERE id = ? AND tenant_id = ?`
      ).bind(adm.bed_id, tenantId)
    );
  }

  await db.$client.batch(batchStmts);
  await createAuditLog(c.env, tenantId, userId ?? 'system', 'UPDATE', 'death_details', data.admission_id, null, {
    action: 'death_record_discharge',
    admission_id: data.admission_id,
    patient_id: data.patient_id,
    date_of_death: data.date_of_death,
  });

  return c.json({ success: true, message: 'Death recorded and patient discharged' }, 201);
});

// PUT /api/death-records/:id — update death record
deathRecords.put('/:id', zValidator('json', updateDeathSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  const allowedRoles = ['doctor', 'hospital_admin', 'md'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update death records' });
  }

  const id = c.req.param('id');
  const data = c.req.valid('json');

  const sets: string[] = ["updated_at = datetime('now', '+6 hours')"];
  const vals: (string | number | null)[] = [];

  if (data.cause_of_death !== undefined) { sets.push('cause_of_death = ?'); vals.push(data.cause_of_death); }
  if (data.secondary_cause !== undefined) { sets.push('secondary_cause = ?'); vals.push(data.secondary_cause); }
  if (data.manner_of_death !== undefined) { sets.push('manner_of_death = ?'); vals.push(data.manner_of_death); }
  if (data.death_type_id !== undefined) { sets.push('death_type_id = ?'); vals.push(data.death_type_id); }
  if (data.autopsy_findings !== undefined) { sets.push('autopsy_findings = ?'); vals.push(data.autopsy_findings); }
  if (data.death_certificate_no !== undefined) { sets.push('death_certificate_no = ?'); vals.push(data.death_certificate_no); }
  if (data.death_certificate_issued !== undefined) {
    sets.push('death_certificate_issued = ?');
    vals.push(data.death_certificate_issued ? 1 : 0);
    if (data.death_certificate_issued) {
      sets.push("death_certificate_issued_on = datetime('now', '+6 hours')");
    }
  }
  if (data.next_of_kin_notified !== undefined) { sets.push('next_of_kin_notified = ?'); vals.push(data.next_of_kin_notified ? 1 : 0); }
  if (data.remarks !== undefined) { sets.push('remarks = ?'); vals.push(data.remarks); }

  await db.$client.prepare(
    `UPDATE death_details SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals, id, tenantId).run();

  return c.json({ success: true });
});

// GET /api/death-records/:id/certificate — data for printing death certificate
deathRecords.get('/:id/certificate', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const id = c.req.param('id');
  const record = await db.$client.prepare(`
    SELECT d.*, p.name AS patient_name, p.patient_code, p.gender, p.date_of_birth, p.address, p.national_id,
           a.admission_no, a.admission_date, a.provisional_diagnosis,
           b.ward_name, b.bed_number
    FROM death_details d
    LEFT JOIN patients p ON d.patient_id = p.id
    LEFT JOIN admissions a ON d.admission_id = a.id
    LEFT JOIN beds b ON a.bed_id = b.id
    WHERE d.id = ? AND d.tenant_id = ?
  `).bind(id, tenantId).first<Record<string, unknown>>();

  if (!record) throw new HTTPException(404, { message: 'Death record not found' });

  return c.json({ certificate: record });
});

export default deathRecords;
