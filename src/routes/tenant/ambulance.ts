import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

const ambulance = new Hono<{ Bindings: Env; Variables: Variables }>();
const AMBULANCE_ACCESS_ROLES = ['hospital_admin', 'md', 'director', 'reception', 'receptionist', 'emergency', 'nurse'] as const;

const VEHICLE_TYPES = ['basic','advanced','icu','neonatal','patient_transport'] as const;
const VEHICLE_STATUS = ['available','on_trip','maintenance','out_of_service'] as const;
const TRIP_TYPES = ['emergency_pickup','hospital_transfer','discharge_drop','dead_body','referral','other'] as const;
const TRIP_STATUS = ['dispatched','en_route','arrived','patient_loaded','in_transit','completed','cancelled'] as const;
const URGENCY = ['routine','urgent','emergency'] as const;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

ambulance.use('*', requireRole(...AMBULANCE_ACCESS_ROLES));

async function nextTripNumber(db: ReturnType<typeof getDb>, tenantId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const row = await db.$client.prepare("SELECT COUNT(*) as cnt FROM ambulance_trips WHERE tenant_id = ? AND trip_number LIKE ?").bind(tenantId, `AMB-${today}%`).first<{ cnt: number }>();
  return `AMB-${today}-${String((row?.cnt ?? 0) + 1).padStart(3, '0')}`;
}

// ─── Stats (before /:id) ─────────────────────────────────────────────────────

ambulance.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = new Date().toISOString().split('T')[0];

  const vehicles = await db.$client.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN current_status = 'available' THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN current_status = 'on_trip' THEN 1 ELSE 0 END) as on_trip,
      SUM(CASE WHEN current_status = 'maintenance' THEN 1 ELSE 0 END) as maintenance
    FROM ambulance_vehicles WHERE tenant_id = ? AND is_active = 1
  `).bind(tenantId).first();

  const todayTrips = await db.$client.prepare("SELECT COUNT(*) as cnt FROM ambulance_trips WHERE tenant_id = ? AND date(dispatched_at) = ?").bind(tenantId, today).first<{ cnt: number }>();
  const activeTrips = await db.$client.prepare("SELECT COUNT(*) as cnt FROM ambulance_trips WHERE tenant_id = ? AND status NOT IN ('completed','cancelled')").bind(tenantId).first<{ cnt: number }>();

  return c.json({ vehicles: vehicles ?? {}, today_trips: todayTrips?.cnt ?? 0, active_trips: activeTrips?.cnt ?? 0 });
});

// ─── Vehicles ────────────────────────────────────────────────────────────────

ambulance.get('/vehicles', async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await getDb(c.env.DB).$client.prepare('SELECT * FROM ambulance_vehicles WHERE tenant_id = ? AND is_active = 1 ORDER BY vehicle_number').bind(tenantId).all();
  return c.json({ data: results });
});

ambulance.post('/vehicles', zValidator('json', z.object({
  vehicle_number: z.string().min(1),
  vehicle_type: z.enum(VEHICLE_TYPES).default('basic'),
  make_model: z.string().optional(),
  year: z.number().int().optional(),
  driver_name: z.string().optional(),
  driver_phone: z.string().optional(),
  paramedic_name: z.string().optional(),
  insurance_expiry: z.string().optional(),
  fitness_expiry: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);
  const r = await db.$client.prepare(`
    INSERT INTO ambulance_vehicles (tenant_id, vehicle_number, vehicle_type, make_model, year, driver_name, driver_phone, paramedic_name, insurance_expiry, fitness_expiry)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(tenantId, d.vehicle_number, d.vehicle_type, d.make_model ?? null, d.year ?? null, d.driver_name ?? null, d.driver_phone ?? null, d.paramedic_name ?? null, d.insurance_expiry ?? null, d.fitness_expiry ?? null).run();
  return c.json({ message: 'Vehicle registered', id: r.meta.last_row_id }, 201);
});

ambulance.put('/vehicles/:id', zValidator('json', z.object({
  vehicle_number: z.string().min(1).optional(),
  vehicle_type: z.enum(VEHICLE_TYPES).optional(),
  make_model: z.string().optional(),
  driver_name: z.string().optional(),
  driver_phone: z.string().optional(),
  paramedic_name: z.string().optional(),
  current_status: z.enum(VEHICLE_STATUS).optional(),
  insurance_expiry: z.string().optional(),
  fitness_expiry: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const allowed = ['vehicle_number','vehicle_type','make_model','driver_name','driver_phone','paramedic_name','current_status','insurance_expiry','fitness_expiry'];
  const updates: string[] = []; const params: unknown[] = [];
  for (const k of allowed) { if ((body as Record<string, unknown>)[k] !== undefined) { updates.push(`${k} = ?`); params.push((body as Record<string, unknown>)[k]); } }
  if (!updates.length) throw new HTTPException(400, { message: 'No fields' });
  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE ambulance_vehicles SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: 'Vehicle updated' });
});

ambulance.delete('/vehicles/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const r = await getDb(c.env.DB).$client.prepare('UPDATE ambulance_vehicles SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!r.meta.changes) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ message: 'Vehicle deactivated' });
});

// ─── Trips ───────────────────────────────────────────────────────────────────

ambulance.get('/trips', zValidator('query', z.object({
  status: z.string().optional(), vehicle_id: z.coerce.number().optional(),
  from: z.string().optional(), to: z.string().optional(),
  trip_type: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { status, vehicle_id, from, to, trip_type, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['t.tenant_id = ?']; const params: (string | number)[] = [tenantId];
  if (status) { conds.push('t.status = ?'); params.push(status); }
  if (vehicle_id) { conds.push('t.vehicle_id = ?'); params.push(vehicle_id); }
  if (from) { conds.push('date(t.dispatched_at) >= ?'); params.push(from); }
  if (to) { conds.push('date(t.dispatched_at) <= ?'); params.push(to); }
  if (trip_type) { conds.push('t.trip_type = ?'); params.push(trip_type); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM ambulance_trips t WHERE ${where}`).bind(...params).first<{ cnt: number }>();
  const { results } = await db.$client.prepare(`
    SELECT t.*, v.vehicle_number, v.vehicle_type
    FROM ambulance_trips t LEFT JOIN ambulance_vehicles v ON t.vehicle_id = v.id
    WHERE ${where} ORDER BY t.dispatched_at DESC LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results, pagination: { page, limit, total: total?.cnt ?? 0 } });
});

ambulance.get('/trips/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const db = getDb(c.env.DB);
  const trip = await db.$client.prepare(`
    SELECT t.*, v.vehicle_number, v.vehicle_type, v.driver_name as vehicle_driver
    FROM ambulance_trips t LEFT JOIN ambulance_vehicles v ON t.vehicle_id = v.id
    WHERE t.id = ? AND t.tenant_id = ?
  `).bind(id, tenantId).first();
  if (!trip) throw new HTTPException(404, { message: 'Trip not found' });
  return c.json(trip);
});

ambulance.post('/trips', zValidator('json', z.object({
  vehicle_id: z.number().int().positive(),
  patient_id: z.number().int().positive().optional(),
  patient_name: z.string().optional(),
  trip_type: z.enum(TRIP_TYPES),
  urgency: z.enum(URGENCY).default('routine'),
  pickup_location: z.string().min(1),
  drop_location: z.string().optional(),
  driver_name: z.string().optional(),
  paramedic_name: z.string().optional(),
  condition_at_pickup: z.string().optional(),
  remarks: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  // Verify vehicle exists and is available
  const vehicle = await db.$client.prepare('SELECT current_status FROM ambulance_vehicles WHERE id = ? AND tenant_id = ? AND is_active = 1').bind(d.vehicle_id, tenantId).first<{ current_status: string }>();
  if (!vehicle) throw new HTTPException(404, { message: 'Vehicle not found' });
  if (vehicle.current_status !== 'available') {
    throw new HTTPException(400, { message: `Vehicle is currently "${vehicle.current_status}". Must be available for dispatch.` });
  }

  const tripNum = await nextTripNumber(db, tenantId);

  const r = await db.$client.prepare(`
    INSERT INTO ambulance_trips (tenant_id, trip_number, vehicle_id, patient_id, patient_name, trip_type, urgency, pickup_location, drop_location, driver_name, paramedic_name, condition_at_pickup, remarks, status, dispatched_at, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'dispatched',?,?)
  `).bind(tenantId, tripNum, d.vehicle_id, d.patient_id ?? null, d.patient_name ?? null, d.trip_type, d.urgency, d.pickup_location, d.drop_location ?? null, d.driver_name ?? null, d.paramedic_name ?? null, d.condition_at_pickup ?? null, d.remarks ?? null, now, userId).run();

  // Mark vehicle as on_trip
  await db.$client.prepare("UPDATE ambulance_vehicles SET current_status = 'on_trip' WHERE id = ? AND tenant_id = ?").bind(d.vehicle_id, tenantId).run();

  return c.json({ message: 'Trip dispatched', id: r.meta.last_row_id, trip_number: tripNum }, 201);
});

ambulance.put('/trips/:id/status', zValidator('json', z.object({
  status: z.enum(TRIP_STATUS),
  pickup_time: z.string().optional(),
  drop_time: z.string().optional(),
  distance_km: z.number().optional(),
  fare_amount: z.number().optional(),
  vitals_at_pickup: z.string().optional(),
  treatment_given: z.string().optional(),
  cancelled_reason: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const updates: string[] = ['status = ?'];
  const params: (string | number | null)[] = [body.status];

  if (body.pickup_time) { updates.push('pickup_time = ?'); params.push(body.pickup_time); }
  if (body.drop_time) { updates.push('drop_time = ?'); params.push(body.drop_time); }
  if (body.distance_km) { updates.push('distance_km = ?'); params.push(body.distance_km); }
  if (body.fare_amount) { updates.push('fare_amount = ?'); params.push(body.fare_amount); }
  if (body.vitals_at_pickup) { updates.push('vitals_at_pickup = ?'); params.push(body.vitals_at_pickup); }
  if (body.treatment_given) { updates.push('treatment_given = ?'); params.push(body.treatment_given); }
  if (body.status === 'completed') { updates.push('completed_at = ?'); params.push(now); }
  if (body.status === 'cancelled' && body.cancelled_reason) { updates.push('cancelled_reason = ?'); params.push(body.cancelled_reason); }

  params.push(id, tenantId);
  await db.$client.prepare(`UPDATE ambulance_trips SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();

  // When completed/cancelled, mark vehicle available
  if (body.status === 'completed' || body.status === 'cancelled') {
    const trip = await db.$client.prepare('SELECT vehicle_id FROM ambulance_trips WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<{ vehicle_id: number }>();
    if (trip) {
      await db.$client.prepare("UPDATE ambulance_vehicles SET current_status = 'available' WHERE id = ? AND tenant_id = ?").bind(trip.vehicle_id, tenantId).run();
    }
  }

  return c.json({ message: `Trip ${body.status}` });
});

// ─── Active Trips (live view) ────────────────────────────────────────────────

ambulance.get('/active', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const { results } = await db.$client.prepare(`
    SELECT t.*, v.vehicle_number, v.vehicle_type
    FROM ambulance_trips t LEFT JOIN ambulance_vehicles v ON t.vehicle_id = v.id
    WHERE t.tenant_id = ? AND t.status NOT IN ('completed','cancelled')
    ORDER BY CASE t.urgency WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, t.dispatched_at DESC
  `).bind(tenantId).all();
  return c.json({ data: results });
});

export default ambulance;
