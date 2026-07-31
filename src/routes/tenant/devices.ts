/**
 * Device Tracking Routes — Implants & Medical Devices
 *
 * POST   /api/devices                — add device to patient
 * GET    /api/devices/:patientId     — list patient's devices
 * GET    /api/devices/:patientId/:id — get single device
 * PUT    /api/devices/:patientId/:id — update device
 * POST   /api/devices/:patientId/:id/remove — mark device removed
 * GET    /api/devices/recalls        — list recalled devices in tenant
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

export const DEVICE_TYPES = ['implant', 'prosthetic', 'wearable', 'monitoring', 'other'] as const;
export const DEVICE_STATUSES = ['active', 'removed', 'malfunctioning', 'recalled'] as const;
export const MRI_SAFETY = ['safe', 'conditional', 'unsafe', 'unknown'] as const;

export const addDeviceSchema = z.object({
  patient_id: z.number().int().positive(),
  device_type: z.enum(DEVICE_TYPES),
  device_name: z.string().min(1).max(500),
  manufacturer: z.string().max(300).optional(),
  model_number: z.string().max(200).optional(),
  serial_number: z.string().max(200).optional(),
  lot_number: z.string().max(200).optional(),
  udi: z.string().max(200).optional(),
  body_site: z.string().max(200).optional(),
  implant_date: z.string().optional(),
  reason: z.string().max(1000).optional(),
  implanted_by: z.string().max(200).optional(),
  implanted_by_id: z.string().max(100).optional(),
  facility: z.string().max(300).optional(),
  notes: z.string().max(2000).optional(),
  mri_safe: z.enum(MRI_SAFETY).optional(),
});

export const updateDeviceSchema = addDeviceSchema.partial().omit({ patient_id: true });

const deviceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// POST / — add device
deviceRoutes.post('/', async (c) => {
  const tenantId = requireTenantId(c);
  requireUserId(c);
  const body = await c.req.json();
  const parsed = addDeviceSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid data', details: parsed.error.flatten() }, 400);

  const d = parsed.data;
  const db = getDb(c.env.DB);

  const result = await db.$client.prepare(`
    INSERT INTO patient_devices (tenant_id, patient_id, device_type, device_name, manufacturer, model_number,
      serial_number, lot_number, udi, body_site, implant_date, reason, implanted_by, implanted_by_id, facility, notes, mri_safe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, d.patient_id, d.device_type, d.device_name,
    d.manufacturer ?? null, d.model_number ?? null, d.serial_number ?? null, d.lot_number ?? null,
    d.udi ?? null, d.body_site ?? null, d.implant_date ?? null, d.reason ?? null,
    d.implanted_by ?? null, d.implanted_by_id ?? null, d.facility ?? null,
    d.notes ?? null, d.mri_safe ?? 'unknown',
  ).run();

  return c.json({ success: true, id: result.meta?.last_row_id }, 201);
});

// GET /:patientId — list patient devices
deviceRoutes.get('/:patientId', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  const status = c.req.query('status');
  const db = getDb(c.env.DB);

  let query = 'SELECT * FROM patient_devices WHERE tenant_id = ? AND patient_id = ?';
  const params: (string | number)[] = [tenantId, patientId];

  if (status && DEVICE_STATUSES.includes(status as any)) {
    query += ' AND status = ?';
    params.push(status);
  }
  query += ' ORDER BY implant_date DESC, created_at DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ devices: results ?? [] });
});

// GET /:patientId/:id — single device
deviceRoutes.get('/:patientId/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const device = await db.$client.prepare(
    'SELECT * FROM patient_devices WHERE id = ? AND tenant_id = ? AND patient_id = ?'
  ).bind(id, tenantId, patientId).first();

  if (!device) return c.json({ error: 'Device not found' }, 404);
  return c.json({ device });
});

// PUT /:patientId/:id — update device
deviceRoutes.put('/:patientId/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateDeviceSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid data', details: parsed.error.flatten() }, 400);

  const d = parsed.data;
  const db = getDb(c.env.DB);

  // Build dynamic UPDATE
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  for (const [key, value] of Object.entries(d)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(value as string | null);
    }
  }
  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
  sets.push("updated_at = datetime('now', '+6 hours')");

  await db.$client.prepare(
    `UPDATE patient_devices SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ? AND patient_id = ?`
  ).bind(...vals, id, tenantId, patientId).run();

  return c.json({ success: true });
});

// POST /:patientId/:id/remove — mark device removed
deviceRoutes.post('/:patientId/:id/remove', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason = (body as any)?.reason ?? 'Removed';
  const db = getDb(c.env.DB);

  await db.$client.prepare(
    `UPDATE patient_devices SET status = 'removed', removal_date = datetime('now', '+6 hours'), notes = COALESCE(notes, '') || ? || ?, updated_at = datetime('now', '+6 hours')
     WHERE id = ? AND tenant_id = ? AND patient_id = ?`
  ).bind('\nRemoval: ', reason, id, tenantId, patientId).run();

  return c.json({ success: true });
});

// GET /recalls — list recalled devices across tenant
deviceRoutes.get('/recalls/list', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const { results } = await db.$client.prepare(
    `SELECT pd.*, p.name as patient_name
     FROM patient_devices pd
     LEFT JOIN patients p ON p.id = pd.patient_id AND p.tenant_id = pd.tenant_id
     WHERE pd.tenant_id = ? AND pd.status = 'recalled'
     ORDER BY pd.updated_at DESC`
  ).bind(tenantId).all();

  return c.json({ recalled_devices: results ?? [] });
});

export default deviceRoutes;
