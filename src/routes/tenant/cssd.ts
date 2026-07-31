import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { hasPermission } from '../../lib/ipd-ot-rbac';

const cssd = new Hono<{ Bindings: Env; Variables: Variables }>();

const CYCLE_TYPES = ['gravity','prevacuum','flash','eto','plasma','dry_heat'] as const;
const INDICATOR_RESULTS = ['pending','pass','fail','not_applicable'] as const;

async function nextCycleNumber(db: ReturnType<typeof getDb>, tenantId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const row = await db.$client.prepare("SELECT COUNT(*) as cnt FROM cssd_sterilization_cycles WHERE tenant_id = ? AND cycle_number LIKE ?").bind(tenantId, `CYC-${today}%`).first<{ cnt: number }>();
  return `CYC-${today}-${String((row?.cnt ?? 0) + 1).padStart(3, '0')}`;
}

// ─── Instrument Sets ─────────────────────────────────────────────────────────

cssd.get('/sets', async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await getDb(c.env.DB).$client.prepare('SELECT * FROM cssd_instrument_sets WHERE tenant_id = ? AND is_active = 1 ORDER BY set_name').bind(tenantId).all();
  return c.json({ data: results });
});

cssd.post('/sets', zValidator('json', z.object({
  set_name: z.string().min(1), set_code: z.string().optional(),
  department: z.string().optional(), item_count: z.number().int().default(0),
  description: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const r = await getDb(c.env.DB).$client.prepare(
    'INSERT INTO cssd_instrument_sets (tenant_id, set_name, set_code, department, item_count, description) VALUES (?,?,?,?,?,?)'
  ).bind(tenantId, d.set_name, d.set_code ?? null, d.department ?? null, d.item_count, d.description ?? null).run();
  return c.json({ message: 'Set created', id: r.meta.last_row_id }, 201);
});

cssd.put('/sets/:id', zValidator('json', z.object({
  set_name: z.string().min(1).optional(),
  set_code: z.string().optional(),
  department: z.string().optional(),
  item_count: z.number().int().min(0).optional(),
  description: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const allowed = ['set_name','set_code','department','item_count','description'];
  const updates: string[] = []; const params: unknown[] = [];
  for (const k of allowed) { if ((body as Record<string, unknown>)[k] !== undefined) { updates.push(`${k} = ?`); params.push((body as Record<string, unknown>)[k]); } }
  if (!updates.length) throw new HTTPException(400, { message: 'No fields' });
  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE cssd_instrument_sets SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: 'Set updated' });
});

cssd.delete('/sets/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const r = await getDb(c.env.DB).$client.prepare('UPDATE cssd_instrument_sets SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!r.meta.changes) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ message: 'Set deactivated' });
});

// ─── Stats (before /:id routes) ──────────────────────────────────────────────

cssd.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = new Date().toISOString().split('T')[0];

  const sets = await db.$client.prepare('SELECT COUNT(*) as cnt FROM cssd_instrument_sets WHERE tenant_id = ? AND is_active = 1').bind(tenantId).first<{ cnt: number }>();
  const todayCycles = await db.$client.prepare("SELECT COUNT(*) as cnt FROM cssd_sterilization_cycles WHERE tenant_id = ? AND date(start_time) = ?").bind(tenantId, today).first<{ cnt: number }>();
  const sterileReady = await db.$client.prepare("SELECT COUNT(*) as cnt FROM cssd_cycle_items WHERE tenant_id = ? AND status = 'sterilized' AND used = 0 AND (expiry_date IS NULL OR expiry_date >= ?)").bind(tenantId, today).first<{ cnt: number }>();
  const failedToday = await db.$client.prepare("SELECT COUNT(*) as cnt FROM cssd_sterilization_cycles WHERE tenant_id = ? AND date(start_time) = ? AND status = 'failed'").bind(tenantId, today).first<{ cnt: number }>();
  const pendingCollection = await db.$client.prepare("SELECT COUNT(*) as cnt FROM cssd_collection_log WHERE tenant_id = ? AND date(received_at) = ?").bind(tenantId, today).first<{ cnt: number }>();

  return c.json({ total_sets: sets?.cnt ?? 0, today_cycles: todayCycles?.cnt ?? 0, sterile_ready: sterileReady?.cnt ?? 0, failed_today: failedToday?.cnt ?? 0, pending_collection: pendingCollection?.cnt ?? 0 });
});

// ─── Sterilization Cycles ────────────────────────────────────────────────────

cssd.get('/cycles', zValidator('query', z.object({
  from: z.string().optional(), to: z.string().optional(), status: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { from, to, status, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['tenant_id = ?']; const params: (string | number)[] = [tenantId];
  if (from) { conds.push('start_time >= ?'); params.push(from); }
  if (to) { conds.push('start_time <= ?'); params.push(`${to}T23:59:59`); }
  if (status) { conds.push('status = ?'); params.push(status); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM cssd_sterilization_cycles WHERE ${where}`).bind(...params).first<{ cnt: number }>();
  const { results } = await db.$client.prepare(`SELECT * FROM cssd_sterilization_cycles WHERE ${where} ORDER BY start_time DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();

  return c.json({ data: results, pagination: { page, limit, total: total?.cnt ?? 0 } });
});

// GET /cycles/:id — single cycle with its items
cssd.get('/cycles/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const db = getDb(c.env.DB);

  const cycle = await db.$client.prepare('SELECT * FROM cssd_sterilization_cycles WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!cycle) throw new HTTPException(404, { message: 'Cycle not found' });

  const { results: items } = await db.$client.prepare(`
    SELECT ci.*, s.set_name, s.set_code FROM cssd_cycle_items ci
    JOIN cssd_instrument_sets s ON ci.instrument_set_id = s.id
    WHERE ci.cycle_id = ? AND ci.tenant_id = ?
  `).bind(id, tenantId).all();

  return c.json({ ...cycle, items: items ?? [] });
});

cssd.post('/cycles', zValidator('json', z.object({
  autoclave_id: z.string().optional(),
  cycle_type: z.enum(CYCLE_TYPES).default('gravity'),
  temperature_celsius: z.number().optional(),
  pressure_psi: z.number().optional(),
  duration_minutes: z.number().int().optional(),
  start_time: z.string().min(1),
  operator_name: z.string().optional(),
  instrument_set_ids: z.array(z.number().int().positive()).min(1),
  remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role') as string | undefined;
  // P0-26/P0-28: permission-gate cycle start on the local catalog.
  if (!hasPermission(role, 'cssd.cycle.start')) {
    throw new HTTPException(403, { message: 'Not authorized to start CSSD cycles' });
  }
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  const cycleNumber = await nextCycleNumber(db, tenantId);

  const r = await db.$client.prepare(`
    INSERT INTO cssd_sterilization_cycles (tenant_id, cycle_number, autoclave_id, cycle_type, temperature_celsius, pressure_psi, duration_minutes, start_time, operator_id, operator_name, remarks)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).bind(tenantId, cycleNumber, d.autoclave_id ?? null, d.cycle_type, d.temperature_celsius ?? null, d.pressure_psi ?? null, d.duration_minutes ?? null, d.start_time, userId, d.operator_name ?? null, d.remarks ?? null).run();

  const cycleId = r.meta.last_row_id;
  const expiryDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  // Add instrument sets to cycle
  const stmts = d.instrument_set_ids.map(setId =>
    db.$client.prepare('INSERT INTO cssd_cycle_items (tenant_id, cycle_id, instrument_set_id, expiry_date) VALUES (?,?,?,?)').bind(tenantId, cycleId, setId, expiryDate)
  );
  if (stmts.length > 0) { await db.$client.batch(stmts); }

  return c.json({ message: 'Cycle started', id: cycleId, cycle_number: cycleNumber }, 201);
});

// Complete or fail cycle
cssd.put('/cycles/:id/complete', zValidator('json', z.object({
  status: z.enum(['completed', 'failed', 'cancelled']),
  end_time: z.string().optional(),
  biological_indicator: z.enum(INDICATOR_RESULTS).optional(),
  chemical_indicator: z.enum(INDICATOR_RESULTS).optional(),
  failure_reason: z.string().optional(),
  // P0-28: explicit indicator-passed gate on cycle release.
  indicator_passed: z.boolean().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role') as string | undefined;
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  // P0-26/P0-28: permission-gate the cycle complete + release path. The
  // "release" semantics (marking items sterile for downstream issue) are
  // restricted to clinical roles via cssd.cycle.release.
  const isRelease = body.status === 'completed';
  const neededPerm = isRelease ? 'cssd.cycle.release' : 'cssd.cycle.complete';
  if (!hasPermission(role, neededPerm)) {
    throw new HTTPException(403, { message: `Not authorized to ${isRelease ? 'release' : 'complete'} CSSD cycles` });
  }

  // P0-28: require indicator_passed=true before a cycle can be released as
  // completed. Cycles with no/failed indicators stay incomplete.
  const indicatorPassed = body.indicator_passed === true ? 1 : 0;
  if (isRelease && indicatorPassed !== 1) {
    throw new HTTPException(400, { message: 'Cannot release cycle: biological/chemical indicator must be passed' });
  }

  await db.$client.prepare(`
    UPDATE cssd_sterilization_cycles
       SET status = ?, end_time = ?,
           biological_indicator = COALESCE(?, biological_indicator),
           chemical_indicator = COALESCE(?, chemical_indicator),
           failure_reason = ?,
           indicator_passed = CASE WHEN ? = 1 THEN 1 ELSE indicator_passed END,
           indicator_checked_by = CASE WHEN ? = 1 THEN ? ELSE indicator_checked_by END,
           indicator_checked_at = CASE WHEN ? = 1 THEN ? ELSE indicator_checked_at END
     WHERE id = ? AND tenant_id = ?
  `).bind(
    body.status,
    body.end_time ?? now,
    body.biological_indicator ?? null,
    body.chemical_indicator ?? null,
    body.failure_reason ?? null,
    indicatorPassed, indicatorPassed, userId, indicatorPassed, now,
    id, tenantId,
  ).run();

  // If failed, mark all items as failed
  if (body.status === 'failed') {
    await db.$client.prepare("UPDATE cssd_cycle_items SET status = 'failed' WHERE cycle_id = ? AND tenant_id = ?").bind(id, tenantId).run();
  }

  return c.json({ message: `Cycle ${body.status}` });
});

// ─── Cycle Items — Issue to department ───────────────────────────────────────

cssd.put('/items/:id/issue', zValidator('json', z.object({
  issued_to: z.string().min(1),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role') as string | undefined;
  // P0-26/P0-28: gate sterile-pack issue on cssd.sterile.issue.
  if (!hasPermission(role, 'cssd.sterile.issue')) {
    throw new HTTPException(403, { message: 'Not authorized to issue sterile packs' });
  }
  const id = Number(c.req.param('id'));
  const { issued_to } = c.req.valid('json');
  const now = new Date().toISOString();
  const db = getDb(c.env.DB);

  // P0-28: refuse to issue packs whose cycle has not passed the
  // biological/chemical indicator.
  const cycleIndicator = await db.$client.prepare(
    `SELECT c.indicator_passed
       FROM cssd_cycle_items ci
       JOIN cssd_sterilization_cycles c ON c.id = ci.cycle_id AND c.tenant_id = ci.tenant_id
      WHERE ci.id = ? AND ci.tenant_id = ?`
  ).bind(id, tenantId).first<{ indicator_passed: number | null }>();
  if (!cycleIndicator) throw new HTTPException(404, { message: 'Sterile item not found' });
  if (cycleIndicator.indicator_passed !== 1) {
    throw new HTTPException(409, { message: 'Cannot issue: cycle indicator has not passed' });
  }

  await db.$client.prepare('UPDATE cssd_cycle_items SET issued_to = ?, issued_at = ?, issued_by = ? WHERE id = ? AND tenant_id = ?').bind(issued_to, now, userId, id, tenantId).run();
  return c.json({ message: `Issued to ${issued_to}` });
});

// Mark as used (needs re-sterilization)
cssd.put('/items/:id/used', async (c) => {
  const tenantId = requireTenantId(c);
  const role = c.get('role') as string | undefined;
  // P0-26/P0-28: gate receiving used sets on cssd.used.receive.
  if (!hasPermission(role, 'cssd.used.receive')) {
    throw new HTTPException(403, { message: 'Not authorized to receive used CSSD items' });
  }
  const id = Number(c.req.param('id'));
  await getDb(c.env.DB).$client.prepare('UPDATE cssd_cycle_items SET used = 1 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ message: 'Marked as used' });
});

// ─── Sterile Inventory (available packs) ─────────────────────────────────────

cssd.get('/inventory', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = new Date().toISOString().split('T')[0];

  const { results } = await db.$client.prepare(`
    SELECT ci.id, ci.pack_number, ci.status, ci.expiry_date, ci.issued_to, ci.issued_at, ci.used,
           s.set_name, s.set_code, s.department,
           c.cycle_number, c.cycle_type, c.start_time as sterilized_at
    FROM cssd_cycle_items ci
    JOIN cssd_sterilization_cycles c ON ci.cycle_id = c.id
    JOIN cssd_instrument_sets s ON ci.instrument_set_id = s.id
    WHERE ci.tenant_id = ? AND ci.status = 'sterilized' AND ci.used = 0
      AND (ci.expiry_date IS NULL OR ci.expiry_date >= ?)
    ORDER BY ci.expiry_date ASC, s.set_name
  `).bind(tenantId, today).all();

  return c.json({ data: results });
});

// ─── Collection Log ──────────────────────────────────────────────────────────

cssd.get('/collections', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const { results } = await db.$client.prepare(`
    SELECT cl.*, s.set_name FROM cssd_collection_log cl
    LEFT JOIN cssd_instrument_sets s ON cl.instrument_set_id = s.id
    WHERE cl.tenant_id = ? ORDER BY cl.received_at DESC LIMIT 100
  `).bind(tenantId).all();
  return c.json({ data: results });
});

cssd.post('/collections', zValidator('json', z.object({
  instrument_set_id: z.number().int().positive().optional(),
  received_from: z.string().min(1),
  condition: z.enum(['dirty', 'contaminated', 'damaged']).default('dirty'),
  item_count: z.number().int().optional(),
  remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  const r = await db.$client.prepare(
    'INSERT INTO cssd_collection_log (tenant_id, instrument_set_id, received_from, received_by, condition, item_count, remarks) VALUES (?,?,?,?,?,?,?)'
  ).bind(tenantId, d.instrument_set_id ?? null, d.received_from, userId, d.condition, d.item_count ?? null, d.remarks ?? null).run();

  return c.json({ message: 'Collection logged', id: r.meta.last_row_id }, 201);
});

export default cssd;
