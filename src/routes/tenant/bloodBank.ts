import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const bloodBank = new Hono<{ Bindings: Env; Variables: Variables }>();

const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'] as const;
const COMPONENTS = ['whole_blood','packed_rbc','ffp','platelets','cryoprecipitate','plasma'] as const;

// ─── Donors ──────────────────────────────────────────────────────────────────

bloodBank.get('/donors', zValidator('query', z.object({
  search: z.string().optional(), blood_group: z.string().optional(),
  eligible: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { search, blood_group, eligible, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['tenant_id = ?', 'is_active = 1'];
  const params: (string | number)[] = [tenantId];
  if (search) { conds.push('(donor_name LIKE ? OR phone LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (blood_group) { conds.push('blood_group = ?'); params.push(blood_group); }
  if (eligible === 'true') { conds.push('is_eligible = 1'); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM blood_donors WHERE ${where}`).bind(...params).first<{cnt:number}>();
  const { results } = await db.$client.prepare(`SELECT * FROM blood_donors WHERE ${where} ORDER BY donor_name LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();
  return c.json({ data: results, pagination: { page, limit, total: total?.cnt ?? 0 } });
});

bloodBank.post('/donors', zValidator('json', z.object({
  donor_name: z.string().min(1), blood_group: z.enum(BLOOD_GROUPS),
  donor_type: z.enum(['voluntary','replacement','autologous','directed']).default('voluntary'),
  gender: z.enum(['Male','Female','Other']).optional(), age: z.number().int().optional(),
  phone: z.string().optional(), address: z.string().optional(), national_id: z.string().optional(),
  weight_kg: z.number().optional(), hemoglobin: z.number().optional(),
  patient_id: z.number().int().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  if (d.patient_id !== undefined) {
    const patient = await db.$client.prepare(
      'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
    ).bind(d.patient_id, tenantId).first<{ id: number }>();
    if (!patient) {
      throw new HTTPException(400, { message: 'Linked patient not found for this hospital' });
    }
  }

  const r = await db.$client.prepare(`
    INSERT INTO blood_donors (tenant_id, donor_name, blood_group, donor_type, gender, age, phone, address, national_id, weight_kg, hemoglobin, patient_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(tenantId, d.donor_name, d.blood_group, d.donor_type, d.gender??null, d.age??null, d.phone??null, d.address??null, d.national_id??null, d.weight_kg??null, d.hemoglobin??null, d.patient_id??null, userId).run();
  return c.json({ message: 'Donor registered', id: r.meta.last_row_id }, 201);
});

bloodBank.put('/donors/:id', zValidator('json', z.object({
  donor_name: z.string().min(1).optional(),
  blood_group: z.enum(BLOOD_GROUPS).optional(),
  donor_type: z.enum(['voluntary','replacement','autologous','directed']).optional(),
  gender: z.enum(['Male','Female','Other']).optional(),
  age: z.number().int().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  weight_kg: z.number().optional(),
  hemoglobin: z.number().optional(),
  is_eligible: z.number().int().min(0).max(1).optional(),
  deferral_reason: z.string().optional(),
  deferral_until: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const allowed = ['donor_name','blood_group','donor_type','gender','age','phone','address','weight_kg','hemoglobin','is_eligible','deferral_reason','deferral_until'];
  const updates: string[] = []; const params: unknown[] = [];
  for (const k of allowed) { if ((body as Record<string, unknown>)[k] !== undefined) { updates.push(`${k} = ?`); params.push((body as Record<string, unknown>)[k]); } }
  if (!updates.length) throw new HTTPException(400, { message: 'No fields to update' });
  const existing = await db.$client.prepare(
    'SELECT id FROM blood_donors WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first<{ id: number }>();
  if (!existing) throw new HTTPException(404, { message: 'Donor not found' });
  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE blood_donors SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: 'Donor updated' });
});

// ─── Donations (Blood Collection) ────────────────────────────────────────────

bloodBank.get('/donations', zValidator('query', z.object({
  blood_group: z.string().optional(), status: z.string().optional(),
  component: z.string().optional(), from: z.string().optional(), to: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { blood_group, status, component, from, to, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['d.tenant_id = ?'];
  const params: (string|number)[] = [tenantId];
  if (blood_group) { conds.push('d.blood_group = ?'); params.push(blood_group); }
  if (status) { conds.push('d.status = ?'); params.push(status); }
  if (component) { conds.push('d.component = ?'); params.push(component); }
  if (from) { conds.push('d.collection_date >= ?'); params.push(from); }
  if (to) { conds.push('d.collection_date <= ?'); params.push(to); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM blood_donations d WHERE ${where}`).bind(...params).first<{cnt:number}>();
  const { results } = await db.$client.prepare(`
    SELECT d.*, dn.donor_name FROM blood_donations d
    LEFT JOIN blood_donors dn ON d.donor_id = dn.id
    WHERE ${where} ORDER BY d.collection_date DESC LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();
  return c.json({ data: results, pagination: { page, limit, total: total?.cnt ?? 0 } });
});

bloodBank.post('/donations', zValidator('json', z.object({
  donor_id: z.number().int().positive(),
  bag_number: z.string().min(1), blood_group: z.enum(BLOOD_GROUPS),
  component: z.enum(COMPONENTS).default('whole_blood'),
  volume_ml: z.number().int().default(450),
  collection_date: z.string().min(1), expiry_date: z.string().min(1),
  collection_site: z.string().optional(), hemoglobin_level: z.number().optional(),
  blood_pressure: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  // Check donor eligibility
  const donor = await db.$client.prepare(
    'SELECT is_eligible, deferral_until, last_donation_date, weight_kg, hemoglobin FROM blood_donors WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(d.donor_id, tenantId).first<{ is_eligible: number; deferral_until: string | null; last_donation_date: string | null; weight_kg: number | null; hemoglobin: number | null }>();
  if (!donor) throw new HTTPException(404, { message: 'Donor not found' });
  if (!donor.is_eligible) {
    const msg = donor.deferral_until ? `Donor deferred until ${donor.deferral_until}` : 'Donor is currently deferred';
    throw new HTTPException(400, { message: msg });
  }

  // 56-day (8 week) donation interval check
  if (donor.last_donation_date) {
    const lastDonation = new Date(donor.last_donation_date);
    const minNextDate = new Date(lastDonation.getTime() + 56 * 86400000);
    if (new Date(d.collection_date) < minNextDate) {
      throw new HTTPException(400, { message: `Donor must wait 56 days between donations. Eligible after ${minNextDate.toISOString().split('T')[0]}` });
    }
  }

  // Weight check (minimum 50 kg for whole blood)
  if (donor.weight_kg && donor.weight_kg < 50) {
    throw new HTTPException(400, { message: `Donor weight ${donor.weight_kg}kg is below minimum 50kg requirement` });
  }

  // Hemoglobin check (minimum 12.5 g/dL)
  if (donor.hemoglobin && donor.hemoglobin < 12.5) {
    throw new HTTPException(400, { message: `Donor hemoglobin ${donor.hemoglobin} g/dL is below minimum 12.5 g/dL` });
  }

  const r = await db.$client.prepare(`
    INSERT INTO blood_donations (tenant_id, donor_id, bag_number, blood_group, component, volume_ml, collection_date, expiry_date, collection_site, hemoglobin_level, blood_pressure, collected_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(tenantId, d.donor_id, d.bag_number, d.blood_group, d.component, d.volume_ml, d.collection_date, d.expiry_date, d.collection_site??null, d.hemoglobin_level??null, d.blood_pressure??null, userId).run();

  // Update donor's last donation + count
  await db.$client.prepare('UPDATE blood_donors SET last_donation_date = ?, total_donations = total_donations + 1 WHERE id = ? AND tenant_id = ?').bind(d.collection_date, d.donor_id, tenantId).run();

  return c.json({ message: 'Donation recorded', id: r.meta.last_row_id }, 201);
});

// Update screening results
bloodBank.put('/donations/:id/screening', zValidator('json', z.object({
  hiv_result: z.enum(['pending','negative','positive','indeterminate']).optional(),
  hbsag_result: z.enum(['pending','negative','positive','indeterminate']).optional(),
  hcv_result: z.enum(['pending','negative','positive','indeterminate']).optional(),
  vdrl_result: z.enum(['pending','negative','positive','indeterminate']).optional(),
  malaria_result: z.enum(['pending','negative','positive','indeterminate']).optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);

  const updates: string[] = []; const params: (string|number)[] = [];
  for (const [k, v] of Object.entries(body)) { if (v !== undefined) { updates.push(`${k} = ?`); params.push(v); } }
  if (!updates.length) throw new HTTPException(400, { message: 'No results provided' });

  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE blood_donations SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();

  // Auto-determine screening_status
  const unit = await db.$client.prepare('SELECT * FROM blood_donations WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Record<string,string>>();
  if (unit) {
    const tests = ['hiv_result','hbsag_result','hcv_result','vdrl_result','malaria_result'];
    const anyPositive = tests.some(t => unit[t] === 'positive');
    const allDone = tests.every(t => unit[t] !== 'pending');
    if (anyPositive) {
      await db.$client.prepare("UPDATE blood_donations SET screening_status = 'failed', status = 'discarded' WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
    } else if (allDone) {
      await db.$client.prepare("UPDATE blood_donations SET screening_status = 'passed' WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
    }
  }

  return c.json({ message: 'Screening results updated' });
});

// Update donation status
bloodBank.put('/donations/:id/status', zValidator('json', z.object({
  status: z.enum(['in_stock','reserved','cross_matched','issued','expired','discarded','quarantine']),
  remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const { status, remarks } = c.req.valid('json');
  const db = getDb(c.env.DB);
  await db.$client.prepare('UPDATE blood_donations SET status = ?, remarks = COALESCE(?, remarks) WHERE id = ? AND tenant_id = ?').bind(status, remarks??null, id, tenantId).run();
  return c.json({ message: `Unit status → ${status}` });
});

// ─── Cross-Match ─────────────────────────────────────────────────────────────

bloodBank.get('/cross-match', zValidator('query', z.object({
  patient_id: z.coerce.number().optional(), status: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { patient_id, status, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['cm.tenant_id = ?']; const params: (string|number)[] = [tenantId];
  if (patient_id) { conds.push('cm.patient_id = ?'); params.push(patient_id); }
  if (status) { conds.push('cm.status = ?'); params.push(status); }
  const where = conds.join(' AND ');

  const { results } = await db.$client.prepare(`
    SELECT cm.*, p.name as patient_name, p.patient_code, d.bag_number
    FROM blood_cross_match cm
    LEFT JOIN patients p ON cm.patient_id = p.id
    LEFT JOIN blood_donations d ON cm.donation_id = d.id
    WHERE ${where} ORDER BY cm.created_at DESC LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();
  return c.json({ data: results });
});

bloodBank.post('/cross-match', zValidator('json', z.object({
  patient_id: z.number().int().positive(),
  patient_blood_group: z.enum(BLOOD_GROUPS),
  requested_component: z.enum(COMPONENTS).default('packed_rbc'),
  units_requested: z.number().int().min(1).default(1),
  urgency: z.enum(['routine','urgent','emergency']).default('routine'),
  indication: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  const r = await db.$client.prepare(`
    INSERT INTO blood_cross_match (tenant_id, patient_id, patient_blood_group, requested_component, units_requested, urgency, indication, requested_by)
    VALUES (?,?,?,?,?,?,?,?)
  `).bind(tenantId, d.patient_id, d.patient_blood_group, d.requested_component, d.units_requested, d.urgency, d.indication??null, userId).run();
  return c.json({ message: 'Cross-match request created', id: r.meta.last_row_id }, 201);
});

// Match a compatible unit to a cross-match request
bloodBank.put('/cross-match/:id/match', zValidator('json', z.object({
  donation_id: z.number().int().positive(),
  compatibility_result: z.enum(['compatible','incompatible']),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const { donation_id, compatibility_result } = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  // Verify cross-match request exists and get patient blood group
  const xmatch = await db.$client.prepare('SELECT patient_blood_group FROM blood_cross_match WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<{ patient_blood_group: string }>();
  if (!xmatch) throw new HTTPException(404, { message: 'Cross-match request not found' });

  // Verify donation unit exists, is screened, and check ABO compatibility
  const unit = await db.$client.prepare("SELECT blood_group, screening_status, status FROM blood_donations WHERE id = ? AND tenant_id = ?").bind(donation_id, tenantId).first<{ blood_group: string; screening_status: string; status: string }>();
  if (!unit) throw new HTTPException(404, { message: 'Blood unit not found' });
  if (unit.screening_status !== 'passed') throw new HTTPException(400, { message: 'Blood unit has not passed screening' });
  if (unit.status !== 'in_stock' && unit.status !== 'reserved') throw new HTTPException(400, { message: `Unit status is "${unit.status}", must be in_stock or reserved` });

  // ABO compatibility check
  const canReceiveFrom: Record<string, string[]> = {
    'O-': ['O-'], 'O+': ['O-','O+'], 'A-': ['O-','A-'], 'A+': ['O-','O+','A-','A+'],
    'B-': ['O-','B-'], 'B+': ['O-','O+','B-','B+'], 'AB-': ['O-','A-','B-','AB-'],
    'AB+': ['O-','O+','A-','A+','B-','B+','AB-','AB+'],
  };
  const compatible = canReceiveFrom[xmatch.patient_blood_group]?.includes(unit.blood_group) ?? false;
  if (compatibility_result === 'compatible' && !compatible) {
    throw new HTTPException(400, { message: `ABO incompatible: Patient ${xmatch.patient_blood_group} cannot receive ${unit.blood_group}` });
  }

  await db.$client.prepare(`
    UPDATE blood_cross_match SET donation_id = ?, compatibility_result = ?, tested_at = ?, tested_by = ?,
    status = CASE WHEN ? = 'compatible' THEN 'matched' ELSE 'pending' END
    WHERE id = ? AND tenant_id = ?
  `).bind(donation_id, compatibility_result, now, userId, compatibility_result, id, tenantId).run();

  if (compatibility_result === 'compatible') {
    await db.$client.prepare("UPDATE blood_donations SET status = 'cross_matched' WHERE id = ? AND tenant_id = ?").bind(donation_id, tenantId).run();
  }
  return c.json({ message: `Cross-match result: ${compatibility_result}` });
});

// ─── Transfusions ────────────────────────────────────────────────────────────

bloodBank.get('/transfusions', zValidator('query', z.object({
  patient_id: z.coerce.number().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { patient_id, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['t.tenant_id = ?']; const params: (string|number)[] = [tenantId];
  if (patient_id) { conds.push('t.patient_id = ?'); params.push(patient_id); }
  const where = conds.join(' AND ');

  const { results } = await db.$client.prepare(`
    SELECT t.*, p.name as patient_name FROM blood_transfusions t
    LEFT JOIN patients p ON t.patient_id = p.id
    WHERE ${where} ORDER BY t.issued_at DESC LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();
  return c.json({ data: results });
});

bloodBank.post('/transfusions', zValidator('json', z.object({
  patient_id: z.number().int().positive(),
  cross_match_id: z.number().int().positive().optional(),
  donation_id: z.number().int().positive(),
  bag_number: z.string().min(1), blood_group: z.enum(BLOOD_GROUPS),
  component: z.enum(COMPONENTS), volume_ml: z.number().int().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const r = await db.$client.prepare(`
    INSERT INTO blood_transfusions (tenant_id, patient_id, cross_match_id, donation_id, bag_number, blood_group, component, volume_ml, issued_at, issued_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(tenantId, d.patient_id, d.cross_match_id??null, d.donation_id, d.bag_number, d.blood_group, d.component, d.volume_ml??null, now, userId).run();

  // Mark donation as issued, cross-match as issued
  await db.$client.prepare("UPDATE blood_donations SET status = 'issued' WHERE id = ? AND tenant_id = ?").bind(d.donation_id, tenantId).run();
  if (d.cross_match_id) {
    await db.$client.prepare("UPDATE blood_cross_match SET status = 'issued' WHERE id = ? AND tenant_id = ?").bind(d.cross_match_id, tenantId).run();
  }

  return c.json({ message: 'Transfusion recorded', id: r.meta.last_row_id }, 201);
});

// Update transfusion (start, complete, reaction)
bloodBank.put('/transfusions/:id', zValidator('json', z.object({
  status: z.enum(['issued','in_progress','completed','reaction_stopped','returned']).optional(),
  transfusion_start: z.string().optional(), transfusion_end: z.string().optional(),
  vital_signs_pre: z.string().optional(), vital_signs_post: z.string().optional(),
  reaction_type: z.enum(['none','mild','moderate','severe','fatal']).optional(),
  reaction_details: z.string().optional(), remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const allowed = ['status','transfusion_start','transfusion_end','vital_signs_pre','vital_signs_post','reaction_type','reaction_details','remarks'];
  const updates: string[] = []; const params: unknown[] = [];
  for (const k of allowed) { if ((body as Record<string,unknown>)[k] !== undefined) { updates.push(`${k} = ?`); params.push((body as Record<string,unknown>)[k]); } }
  if (!updates.length) throw new HTTPException(400, { message: 'No fields' });
  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE blood_transfusions SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: 'Transfusion updated' });
});

// ─── Stock Summary ───────────────────────────────────────────────────────────

bloodBank.get('/stock', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = new Date().toISOString().split('T')[0];

  const { results } = await db.$client.prepare(`
    SELECT blood_group, component,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'in_stock' AND screening_status = 'passed' AND expiry_date >= ? THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved,
      SUM(CASE WHEN status = 'cross_matched' THEN 1 ELSE 0 END) as cross_matched,
      SUM(CASE WHEN expiry_date < ? AND status = 'in_stock' THEN 1 ELSE 0 END) as expired,
      SUM(CASE WHEN screening_status = 'pending' THEN 1 ELSE 0 END) as pending_screening
    FROM blood_donations WHERE tenant_id = ?
    GROUP BY blood_group, component
    ORDER BY blood_group, component
  `).bind(today, today, tenantId).all();

  // Overall totals
  const totals = await db.$client.prepare(`
    SELECT
      COUNT(*) as total_units,
      SUM(CASE WHEN status = 'in_stock' AND screening_status = 'passed' AND expiry_date >= ? THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN expiry_date < ? AND status = 'in_stock' THEN 1 ELSE 0 END) as expired_count,
      SUM(CASE WHEN screening_status = 'pending' THEN 1 ELSE 0 END) as pending_screening
    FROM blood_donations WHERE tenant_id = ?
  `).bind(today, today, tenantId).first();

  return c.json({ stock: results, totals });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

bloodBank.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = new Date().toISOString().split('T')[0];

  const donors = await db.$client.prepare('SELECT COUNT(*) as cnt FROM blood_donors WHERE tenant_id = ? AND is_active = 1').bind(tenantId).first<{cnt:number}>();
  const available = await db.$client.prepare("SELECT COUNT(*) as cnt FROM blood_donations WHERE tenant_id = ? AND status = 'in_stock' AND screening_status = 'passed' AND expiry_date >= ?").bind(tenantId, today).first<{cnt:number}>();
  const pendingXmatch = await db.$client.prepare("SELECT COUNT(*) as cnt FROM blood_cross_match WHERE tenant_id = ? AND status = 'pending'").bind(tenantId).first<{cnt:number}>();
  const todayTransfusions = await db.$client.prepare("SELECT COUNT(*) as cnt FROM blood_transfusions WHERE tenant_id = ? AND date(issued_at) = ?").bind(tenantId, today).first<{cnt:number}>();
  const expiringSoon = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM blood_donations WHERE tenant_id = ? AND status = 'in_stock' AND expiry_date BETWEEN ? AND date(?, '+7 days')`).bind(tenantId, today, today).first<{cnt:number}>();

  return c.json({
    total_donors: donors?.cnt ?? 0,
    available_units: available?.cnt ?? 0,
    pending_cross_match: pendingXmatch?.cnt ?? 0,
    today_transfusions: todayTransfusions?.cnt ?? 0,
    expiring_soon: expiringSoon?.cnt ?? 0,
  });
});

// ─── Compatible Blood Groups (lookup helper) ─────────────────────────────────

bloodBank.get('/compatible/:bloodGroup', (c) => {
  const bg = c.req.param('bloodGroup');
  const compatibility: Record<string, string[]> = {
    'O-': ['O-'], 'O+': ['O-','O+'], 'A-': ['O-','A-'], 'A+': ['O-','O+','A-','A+'],
    'B-': ['O-','B-'], 'B+': ['O-','O+','B-','B+'], 'AB-': ['O-','A-','B-','AB-'],
    'AB+': ['O-','O+','A-','A+','B-','B+','AB-','AB+'],
  };
  return c.json({ blood_group: bg, can_receive_from: compatibility[bg] ?? [], is_universal_donor: bg === 'O-', is_universal_recipient: bg === 'AB+' });
});

export default bloodBank;
