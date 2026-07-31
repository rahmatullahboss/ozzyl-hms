import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const mlc = new Hono<{ Bindings: Env; Variables: Variables }>();

const CASE_TYPES = ['accident','assault','poisoning','burns','sexual_assault','suicide_attempt','snake_bite','dog_bite','industrial','drowning','hanging','firearm','stabbing','other'] as const;
const NATURE_OF_INJURY = ['simple','grievous','dangerous','fatal'] as const;
const MLC_STATUS = ['active','discharged','referred','absconded','expired','closed'] as const;

// ─── Auto MLC Number ─────────────────────────────────────────────────────────

async function nextMlcNumber(db: ReturnType<typeof getDb>, tenantId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const row = await db.$client.prepare(
    "SELECT COUNT(*) as cnt FROM mlc_cases WHERE tenant_id = ? AND mlc_number LIKE ?"
  ).bind(tenantId, `MLC-${today}%`).first<{ cnt: number }>();
  const seq = (row?.cnt ?? 0) + 1;
  return `MLC-${today}-${String(seq).padStart(3, '0')}`;
}

// ─── List MLC Cases ──────────────────────────────────────────────────────────

mlc.get('/', zValidator('query', z.object({
  case_type: z.string().optional(), status: z.string().optional(),
  from: z.string().optional(), to: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { case_type, status, from, to, search, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['m.tenant_id = ?'];
  const params: (string | number)[] = [tenantId];
  if (case_type) { conds.push('m.case_type = ?'); params.push(case_type); }
  if (status) { conds.push('m.status = ?'); params.push(status); }
  if (from) { conds.push('m.case_date >= ?'); params.push(from); }
  if (to) { conds.push('m.case_date <= ?'); params.push(to); }
  if (search) { conds.push('(m.mlc_number LIKE ? OR p.name LIKE ? OR m.fir_number LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM mlc_cases m LEFT JOIN patients p ON m.patient_id = p.id WHERE ${where}`).bind(...params).first<{ cnt: number }>();

  const { results } = await db.$client.prepare(`
    SELECT m.*, p.name as patient_name, p.patient_code, p.gender, p.age, p.mobile as patient_phone
    FROM mlc_cases m
    LEFT JOIN patients p ON m.patient_id = p.id
    WHERE ${where}
    ORDER BY m.case_date DESC, m.id DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results, pagination: { page, limit, total: total?.cnt ?? 0 } });
});

// ─── Stats (MUST be before /:id) ─────────────────────────────────────────────

mlc.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const stats = await db.$client.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired
    FROM mlc_cases WHERE tenant_id = ?
  `).bind(tenantId).first();

  const { results: byType } = await db.$client.prepare(`
    SELECT case_type, COUNT(*) as count FROM mlc_cases
    WHERE tenant_id = ? GROUP BY case_type ORDER BY count DESC
  `).bind(tenantId).all();

  return c.json({ stats, byType });
});

// ─── Get Single MLC ──────────────────────────────────────────────────────────

mlc.get('/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const db = getDb(c.env.DB);

  const mlcCase = await db.$client.prepare(`
    SELECT m.*, p.name as patient_name, p.patient_code, p.gender, p.age, p.mobile as patient_phone, p.address as patient_address
    FROM mlc_cases m LEFT JOIN patients p ON m.patient_id = p.id
    WHERE m.id = ? AND m.tenant_id = ?
  `).bind(id, tenantId).first();
  if (!mlcCase) throw new HTTPException(404, { message: 'MLC case not found' });

  const { results: injuries } = await db.$client.prepare(
    'SELECT * FROM mlc_injuries WHERE mlc_id = ? AND tenant_id = ? ORDER BY injury_number'
  ).bind(id, tenantId).all();

  const { results: notes } = await db.$client.prepare(
    'SELECT * FROM mlc_notes WHERE mlc_id = ? AND tenant_id = ? ORDER BY noted_at DESC'
  ).bind(id, tenantId).all();

  return c.json({ ...mlcCase, injuries: injuries ?? [], notes: notes ?? [] });
});

// ─── Create MLC ──────────────────────────────────────────────────────────────

mlc.post('/', zValidator('json', z.object({
  patient_id: z.number().int().positive(),
  er_patient_id: z.number().int().positive().optional(),
  admission_id: z.number().int().positive().optional(),
  case_type: z.enum(CASE_TYPES),
  case_date: z.string().min(1), case_time: z.string().optional(),
  brought_by: z.string().optional(), mode_of_arrival: z.string().optional(),
  police_station: z.string().optional(), fir_number: z.string().optional(),
  police_officer_name: z.string().optional(), police_officer_rank: z.string().optional(),
  informant_name: z.string().optional(), informant_relation: z.string().optional(),
  informant_address: z.string().optional(), informant_phone: z.string().optional(),
  incident_place: z.string().optional(), incident_date: z.string().optional(),
  incident_time: z.string().optional(), incident_description: z.string().optional(),
  general_condition: z.enum(['conscious','semiconscious','unconscious','dead']).optional(),
  injury_description: z.string().optional(), injury_type: z.string().optional(),
  injury_site: z.string().optional(), alcohol_smell: z.boolean().default(false),
  substance_suspected: z.string().optional(), clothes_condition: z.string().optional(),
  provisional_opinion: z.string().optional(),
  nature_of_injury: z.enum(NATURE_OF_INJURY).optional(),
  examining_doctor_id: z.number().int().positive().optional(),
  examining_doctor_name: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  const mlcNumber = await nextMlcNumber(db, tenantId);

  const r = await db.$client.prepare(`
    INSERT INTO mlc_cases (
      tenant_id, mlc_number, patient_id, er_patient_id, admission_id,
      case_type, case_date, case_time, brought_by, mode_of_arrival,
      police_station, fir_number, police_officer_name, police_officer_rank,
      informant_name, informant_relation, informant_address, informant_phone,
      incident_place, incident_date, incident_time, incident_description,
      general_condition, injury_description, injury_type, injury_site,
      alcohol_smell, substance_suspected, clothes_condition,
      provisional_opinion, nature_of_injury,
      examining_doctor_id, examining_doctor_name, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    tenantId, mlcNumber, d.patient_id, d.er_patient_id ?? null, d.admission_id ?? null,
    d.case_type, d.case_date, d.case_time ?? null, d.brought_by ?? null, d.mode_of_arrival ?? null,
    d.police_station ?? null, d.fir_number ?? null, d.police_officer_name ?? null, d.police_officer_rank ?? null,
    d.informant_name ?? null, d.informant_relation ?? null, d.informant_address ?? null, d.informant_phone ?? null,
    d.incident_place ?? null, d.incident_date ?? null, d.incident_time ?? null, d.incident_description ?? null,
    d.general_condition ?? null, d.injury_description ?? null, d.injury_type ?? null, d.injury_site ?? null,
    d.alcohol_smell ? 1 : 0, d.substance_suspected ?? null, d.clothes_condition ?? null,
    d.provisional_opinion ?? null, d.nature_of_injury ?? null,
    d.examining_doctor_id ?? null, d.examining_doctor_name ?? null, userId,
  ).run();

  return c.json({ message: 'MLC case registered', id: r.meta.last_row_id, mlc_number: mlcNumber }, 201);
});

// ─── Update MLC ──────────────────────────────────────────────────────────────

mlc.put('/:id/status', zValidator('json', z.object({
  status: z.enum(MLC_STATUS),
  outcome: z.string().optional(),
  discharge_date: z.string().optional(),
  referred_to: z.string().optional(),
  final_opinion: z.string().optional(),
  cause_of_injury: z.string().optional(),
  nature_of_injury: z.enum(NATURE_OF_INJURY).optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const updates: string[] = ['status = ?', 'updated_at = datetime(\'now\')'];
  const params: (string | number | null)[] = [body.status];
  if (body.outcome) { updates.push('outcome = ?'); params.push(body.outcome); }
  if (body.discharge_date) { updates.push('discharge_date = ?'); params.push(body.discharge_date); }
  if (body.referred_to) { updates.push('referred_to = ?'); params.push(body.referred_to); }
  if (body.final_opinion) { updates.push('final_opinion = ?'); params.push(body.final_opinion); }
  if (body.cause_of_injury) { updates.push('cause_of_injury = ?'); params.push(body.cause_of_injury); }
  if (body.nature_of_injury) { updates.push('nature_of_injury = ?'); params.push(body.nature_of_injury); }

  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE mlc_cases SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: `MLC status → ${body.status}` });
});

// ─── Add Injury Detail ───────────────────────────────────────────────────────

mlc.post('/:id/injuries', zValidator('json', z.object({
  body_part: z.string().min(1),
  injury_type: z.string().optional(),
  size_cm: z.string().optional(),
  depth: z.string().optional(),
  weapon_used: z.string().optional(),
  age_of_injury: z.string().optional(),
  description: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const mlcId = Number(c.req.param('id'));
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  // Get next injury number
  const cnt = await db.$client.prepare('SELECT COUNT(*) as c FROM mlc_injuries WHERE mlc_id = ? AND tenant_id = ?').bind(mlcId, tenantId).first<{ c: number }>();
  const injuryNumber = (cnt?.c ?? 0) + 1;

  const r = await db.$client.prepare(`
    INSERT INTO mlc_injuries (tenant_id, mlc_id, injury_number, body_part, injury_type, size_cm, depth, weapon_used, age_of_injury, description)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(tenantId, mlcId, injuryNumber, d.body_part, d.injury_type ?? null, d.size_cm ?? null, d.depth ?? null, d.weapon_used ?? null, d.age_of_injury ?? null, d.description ?? null).run();

  return c.json({ message: 'Injury recorded', id: r.meta.last_row_id, injury_number: injuryNumber }, 201);
});

// ─── Add Note ────────────────────────────────────────────────────────────────

mlc.post('/:id/notes', zValidator('json', z.object({
  note_type: z.enum(['progress','police_visit','court_order','sample_sent','opinion_given','discharge','other']).default('progress'),
  note_text: z.string().min(1),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const mlcId = Number(c.req.param('id'));
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  const r = await db.$client.prepare(`
    INSERT INTO mlc_notes (tenant_id, mlc_id, note_type, note_text, noted_by)
    VALUES (?,?,?,?,?)
  `).bind(tenantId, mlcId, d.note_type, d.note_text, userId).run();

  return c.json({ message: 'Note added', id: r.meta.last_row_id }, 201);
});

export default mlc;
