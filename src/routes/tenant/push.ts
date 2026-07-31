/**
 * Push notification routes — Web Push API (Cloudflare-native).
 *
 * Endpoints:
 *   POST /api/push/subscribe   — register a browser push subscription
 *   DELETE /api/push/unsubscribe — remove a push subscription
 *   POST /api/push/send        — send push to all tenant subscribers (admin only)
 *   GET  /api/push/vapid-key   — return the VAPID public key for the frontend
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sendPushToTenant } from '../../utils/web-push';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { unsubscribePushSchema } from '../../schemas/clinical';
import { getDb } from '../../db';


const push = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Schemas ─────────────────────────────────────────────────────────

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(10),
    auth: z.string().min(10),
  }),
});

const sendSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(500),
  url: z.string().optional(),
  tag: z.string().optional(),
});

// ─── GET /vapid-key — Return VAPID public key for frontend ──────────

push.get('/vapid-key', (c) => {
  const publicKey = c.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    throw new HTTPException(503, { message: 'Push notifications not configured' });
  }
  return c.json({ publicKey });
});

// ─── POST /subscribe — Save push subscription ──────────────────────

push.post('/subscribe', zValidator('json', subscribeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const { endpoint, keys } = c.req.valid('json');

  // Upsert — if the endpoint already exists for this tenant, update keys
  await db.$client.prepare(`
    INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh_key, auth_key)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (tenant_id, endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh_key = excluded.p256dh_key,
      auth_key = excluded.auth_key,
      created_at = datetime('now', '+6 hours')
  `).bind(tenantId, userId, endpoint, keys.p256dh, keys.auth).run();

  return c.json({ ok: true, message: 'Subscribed to push notifications' }, 201);
});

// ─── DELETE /unsubscribe — Remove push subscription ─────────────────

push.delete('/unsubscribe', zValidator('json', unsubscribePushSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { endpoint } = c.req.valid('json');

  await db.$client.prepare(
    'DELETE FROM push_subscriptions WHERE tenant_id = ? AND endpoint = ?'
  ).bind(tenantId, endpoint).run();

  return c.json({ ok: true, message: 'Unsubscribed from push notifications' });
});

// ─── POST /send — Send push notification (admin only) ───────────────

push.post('/send', zValidator('json', sendSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const role = c.get('role');

  // Only admins can send push notifications
  if (role !== 'hospital_admin' && role !== 'super_admin') {
    throw new HTTPException(403, { message: 'Admin access required' });
  }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = c.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    throw new HTTPException(503, { message: 'Push notifications not configured — set VAPID secrets' });
  }

  const payload = c.req.valid('json');

  const result = await sendPushToTenant(
    c.env.DB,
    tenantId,
    {
      title: payload.title,
      body: payload.body,
      url: payload.url,
      tag: payload.tag,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
    },
    {
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT,
    },
  );

  return c.json({
    ok: true,
    sent: result.sent,
    expired: result.expired,
    message: `Sent to ${result.sent} subscribers (${result.expired} expired removed)`,
  });
});

export default push;
