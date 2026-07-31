import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env } from '../../types';
import { recordHospitalLinkAudit } from '../../lib/portal-consent-audit';

/**
 * Patient Hospital Link Routes
 *
 * Flutter-compatible endpoints:
 *   POST /api/v1/patients/link-hospital  { hospitalId }
 *   DELETE /api/v1/patients/link-hospital/:hospitalId
 *
 * These wrap the same hospital_links table as /api/hospital-links
 */
const patientHospitalLinkRoutes = new Hono<{ Bindings: Env }>();

// ─── Auth helper ──────────────────────────────────────────────────────
async function getPatientId(c: any): Promise<number> {
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;
  if (!token) throw new HTTPException(401, { message: 'Authentication required' });
  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }
  if (decoded.scope !== 'global') throw new HTTPException(403, { message: 'Invalid token scope' });
  return parseInt(decoded.userId, 10);
}

const linkSchema = z.object({
  hospitalId: z.string().min(1),
});

// ─── POST /api/v1/patients/link-hospital ──────────────────────────────
patientHospitalLinkRoutes.post('/', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid data', details: parsed.error.flatten() }, 400);

  const { hospitalId } = parsed.data;
  const db = c.env.DB;

  // Get hospital name
  const hospital = await db.prepare(
    'SELECT name FROM tenants WHERE id = ? AND is_published = 1',
  ).bind(hospitalId).first<{ name: string }>();

  if (!hospital) return c.json({ error: 'Hospital not found' }, 404);

  // Check if already linked
  const existing = await db.prepare(
    'SELECT id, status FROM hospital_links WHERE patient_id = ? AND tenant_id = ?',
  ).bind(patientId, hospitalId).first() as any;

  if (existing) {
    if (existing.status === 'active') {
      return c.json({ already_connected: true, link_id: existing.id });
    }
    // Re-activate
    await db.prepare(
      'UPDATE hospital_links SET status = ?, linked_at = datetime("now") WHERE id = ?',
    ).bind('active', existing.id).run();
    return c.json({ success: true, link_id: existing.id, reactivated: true });
  }

  // Create new link
  const result = await db.prepare(
    'INSERT INTO hospital_links (patient_id, tenant_id, hospital_name) VALUES (?, ?, ?)',
  ).bind(patientId, hospitalId, hospital.name).run();

  return c.json({ success: true, link_id: result.meta.last_row_id }, 201);
});

// ─── DELETE /api/v1/patients/link-hospital/:hospitalId ────────────────
patientHospitalLinkRoutes.delete('/:hospitalId', async (c) => {
  const patientId = await getPatientId(c);
  const hospitalId = c.req.param('hospitalId');
  const db = c.env.DB;

  await db.prepare(
    'UPDATE hospital_links SET status = ? WHERE patient_id = ? AND tenant_id = ?',
  ).bind('revoked', patientId, hospitalId).run();

  return c.json({ success: true });
});

export default patientHospitalLinkRoutes;
