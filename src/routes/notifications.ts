import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env } from '../types';

const VALID_PLATFORMS = ['ios', 'android', 'web'] as const;

const registerSchema = z.object({
  device_id: z.string().min(1).max(255),
  platform: z.enum(VALID_PLATFORMS),
  push_token: z.string().min(1).max(512).optional(),
});

const sendSchema = z.object({
  patient_id: z.number().int().positive(),
  category: z.enum([
    'medication_reminder',
    'appointment',
    'streak_at_risk',
    'daily_checkin',
    'ai_insight',
    'health_tip',
  ]),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(500),
  data: z.record(z.string(), z.any()).optional(),
});

const notificationRoutes = new Hono<{ Bindings: Env }>();

async function getPatientId(c: any): Promise<number> {
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  if (decoded.scope !== 'global') {
    throw new HTTPException(403, { message: 'Invalid token scope' });
  }

  return parseInt(decoded.userId, 10);
}

notificationRoutes.post('/register', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid registration data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const db = c.env.DB;

  await db.prepare(`
    INSERT INTO user_devices (patient_id, device_id, platform, push_token, last_seen_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(patient_id, device_id) DO UPDATE SET
      platform = excluded.platform,
      push_token = excluded.push_token,
      last_seen_at = datetime('now')
  `).bind(patientId, d.device_id, d.platform, d.push_token ?? null).run();

  return c.json({ success: true });
});

notificationRoutes.post('/send', async (c) => {
  const body = await c.req.json();
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid send data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const db = c.env.DB;

  const devices = await db.prepare(
    'SELECT push_token, platform FROM user_devices WHERE patient_id = ? AND push_token IS NOT NULL',
  ).bind(d.patient_id).all();

  const tokens = (devices.results || []) as Array<{ push_token: string; platform: string }>;

  if (tokens.length === 0) {
    return c.json({ success: true, sent: 0, message: 'No registered devices with push tokens' });
  }

  return c.json({
    success: true,
    sent: tokens.length,
    tokens: tokens.map((t) => ({ platform: t.platform, token_preview: t.push_token.slice(0, 10) + '...' })),
    category: d.category,
    title: d.title,
    body: d.body,
  });
});

notificationRoutes.get('/devices', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;

  const rows = await db.prepare(
    'SELECT id, device_id, platform, push_token IS NOT NULL as has_token, last_seen_at, created_at FROM user_devices WHERE patient_id = ? ORDER BY last_seen_at DESC',
  ).bind(patientId).all();

  return c.json({ devices: rows.results || [] });
});

export default notificationRoutes;
