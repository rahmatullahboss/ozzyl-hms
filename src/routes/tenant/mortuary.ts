import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const mortuary = new Hono<{ Bindings: Env; Variables: Variables }>();

const PRESERVATION = ['refrigeration','embalming','none'] as const;
const STATUS = ['received','preserved','awaiting_noc','awaiting_postmortem','ready_for_handover','handed_over','transferred'] as const;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

async function nextRecordNumber(db: ReturnType<typeof getDb>, tenantId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const row = await db.$client.prepare("SELECT COUNT(*) as cnt FROM mortuary_records WHERE tenant_id = ? AND record_number LIKE ?").bind(tenantId, `MOR-${today}%`).first<{ cnt: number }>();
  return `MOR-${today}-${String((row?.cnt ?? 0) + 1).padStart(3, '0')}`;
}

// ─── Stats (before /:id) ─────────────────────────────────────────────────────

mortuary.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const stats = await db.$client.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('received','preserved','awaiting_noc','awaiting_postmortem','ready_for_handover') THEN 1 ELSE 0 END) as currently_held,
      SUM(CASE WHEN status = 'handed_over' THEN 1 ELSE 0 END) as handed_over,
      SUM(CASE WHEN is_mlc = 1 THEN 1 ELSE 0 END) as mlc_cases,
      SUM(CASE WHEN postmortem_required = 1 AND postmortem_done = 0 THEN 1 ELSE 0 END) as pending_postmortem,
      SUM(CASE WHEN status = 'awaiting_noc' THEN 1 ELSE 0 END) as awaiting_noc
    FROM mortuary_records WHERE tenant_id = ?
  `).bind(tenantId).first();

  return c.json(stats ?? {});
});

// ─── List ────────────────────────────────────────────────────────────────────

mortuary.get('/', zValidator('query', z.object({
  status: z.string().optional(), is_mlc: z.string().optional(),
  from: z.string().optional(), to: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { status, is_mlc, from, to, search, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['tenant_id = ?']; const params: (string | number)[] = [tenantId];
  if (status) { conds.push('status = ?'); params.push(status); }
  if (is_mlc === 'true') { conds.push('is_mlc = 1'); }
  if (from) { conds.push('date_of_death >= ?'); params.push(from); }
  if (to) { conds.push('date_of_death <= ?'); params.push(to); }
  if (search) { conds.push('(deceased_name LIKE ? OR record_number LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM mortuary_records WHERE ${where}`).bind(...params).first<{ cnt: number }>();
  const { results } = await db.$client.prepare(`SELECT * FROM mortuary_records WHERE ${where} ORDER BY received_at DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();

  return c.json({ data: results, pagination: { page, limit, total: total?.cnt ?? 0 } });
});

// ─── Detail ──────────────────────────────────────────────────────────────────

mortuary.get('/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const db = getDb(c.env.DB);
  const record = await db.$client.prepare('SELECT * FROM mortuary_records WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!record) throw new HTTPException(404, { message: 'Record not found' });
  return c.json(record);
});

// ─── Create ──────────────────────────────────────────────────────────────────

mortuary.post('/', zValidator('json', z.object({
  patient_id: z.number().int().positive().optional(),
  deceased_name: z.string().min(1),
  age: z.number().int().optional(),
  gender: z.enum(['Male','Female','Other']).optional(),
  national_id: z.string().optional(),
  date_of_death: z.string().regex(dateRegex, 'Must be YYYY-MM-DD'),
  time_of_death: z.string().optional(),
  cause_of_death: z.string().optional(),
  place_of_death: z.string().optional(),
  brought_from: z.string().optional(),
  admission_id: z.number().int().positive().optional(),
  mlc_id: z.number().int().positive().optional(),
  is_mlc: z.boolean().default(false),
  storage_unit: z.string().optional(),
  preservation_type: z.enum(PRESERVATION).default('refrigeration'),
  police_station: z.string().optional(),
  postmortem_required: z.boolean().default(false),
  remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const recNum = await nextRecordNumber(db, tenantId);

  const r = await db.$client.prepare(`
    INSERT INTO mortuary_records (
      tenant_id, record_number, patient_id, deceased_name, age, gender, national_id,
      date_of_death, time_of_death, cause_of_death, place_of_death, brought_from,
      admission_id, mlc_id, is_mlc, storage_unit, preservation_type,
      police_station, postmortem_required, remarks, received_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    tenantId, recNum, d.patient_id ?? null, d.deceased_name, d.age ?? null, d.gender ?? null, d.national_id ?? null,
    d.date_of_death, d.time_of_death ?? null, d.cause_of_death ?? null, d.place_of_death ?? null, d.brought_from ?? null,
    d.admission_id ?? null, d.mlc_id ?? null, d.is_mlc ? 1 : 0, d.storage_unit ?? null, d.preservation_type,
    d.police_station ?? null, d.postmortem_required ? 1 : 0, d.remarks ?? null, now, userId,
  ).run();

  return c.json({ message: 'Record created', id: r.meta.last_row_id, record_number: recNum }, 201);
});

// ─── Update Status ───────────────────────────────────────────────────────────

mortuary.put('/:id/status', zValidator('json', z.object({
  status: z.enum(STATUS),
  remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const { status, remarks } = c.req.valid('json');
  const now = new Date().toISOString();
  const db = getDb(c.env.DB);

  const updates = ['status = ?', 'updated_at = ?'];
  const params: (string | number | null)[] = [status, now];
  if (remarks) { updates.push('remarks = ?'); params.push(remarks); }
  params.push(id, tenantId);

  await db.$client.prepare(`UPDATE mortuary_records SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: `Status → ${status}` });
});

// ─── Handover ────────────────────────────────────────────────────────────────

mortuary.put('/:id/handover', zValidator('json', z.object({
  handover_to: z.string().min(1),
  handover_relation: z.string().optional(),
  handover_id_type: z.string().optional(),
  handover_id_number: z.string().optional(),
  handover_phone: z.string().optional(),
  handover_witnessed_by: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const time = now.split('T')[1]?.substring(0, 5);

  // Verify record exists and is ready for handover
  const record = await db.$client.prepare('SELECT status, is_mlc, police_noc_received, postmortem_required, postmortem_done FROM mortuary_records WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<{ status: string; is_mlc: number; police_noc_received: number; postmortem_required: number; postmortem_done: number }>();
  if (!record) throw new HTTPException(404, { message: 'Record not found' });
  if (record.status === 'handed_over') throw new HTTPException(400, { message: 'Body already handed over' });

  // MLC cases require police NOC before handover
  if (record.is_mlc && !record.police_noc_received) {
    throw new HTTPException(400, { message: 'MLC case: Police NOC must be received before handover' });
  }
  // If post-mortem required, must be completed
  if (record.postmortem_required && !record.postmortem_done) {
    throw new HTTPException(400, { message: 'Post-mortem must be completed before handover' });
  }

  await db.$client.prepare(`
    UPDATE mortuary_records SET
      status = 'handed_over', handover_to = ?, handover_relation = ?, handover_id_type = ?,
      handover_id_number = ?, handover_phone = ?, handover_date = ?, handover_time = ?,
      handover_witnessed_by = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(d.handover_to, d.handover_relation ?? null, d.handover_id_type ?? null, d.handover_id_number ?? null, d.handover_phone ?? null, today, time, d.handover_witnessed_by ?? null, now, id, tenantId).run();

  return c.json({ message: 'Body handed over' });
});

// ─── Post-mortem Update ──────────────────────────────────────────────────────

mortuary.put('/:id/postmortem', zValidator('json', z.object({
  postmortem_done: z.boolean(),
  postmortem_date: z.string().optional(),
  postmortem_findings: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  await db.$client.prepare(`
    UPDATE mortuary_records SET postmortem_done = ?, postmortem_date = ?, postmortem_findings = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(d.postmortem_done ? 1 : 0, d.postmortem_date ?? null, d.postmortem_findings ?? null, id, tenantId).run();

  return c.json({ message: 'Post-mortem updated' });
});

// ─── Police NOC ──────────────────────────────────────────────────────────────

mortuary.put('/:id/noc', zValidator('json', z.object({
  police_noc_received: z.boolean(),
  police_noc_date: z.string().optional(),
  police_station: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  await db.$client.prepare(`
    UPDATE mortuary_records SET police_noc_received = ?, police_noc_date = ?, police_station = COALESCE(?, police_station), updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(d.police_noc_received ? 1 : 0, d.police_noc_date ?? null, d.police_station ?? null, id, tenantId).run();

  return c.json({ message: 'NOC status updated' });
});

export default mortuary;
