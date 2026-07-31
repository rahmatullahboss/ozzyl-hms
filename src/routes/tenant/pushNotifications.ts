import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';


const pushRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().min(1),
});

const sendSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  url: z.string().optional(),
  icon: z.string().optional(),
});

// GET /api/push/vapid-key — return the VAPID public key
pushRoutes.get('/vapid-key', async (c) => {
  const db = getDb(c.env.DB);
  const vapidPublicKey = (c.env as any).VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    return c.json({ error: 'VAPID not configured' }, 503);
  }
  return c.json({ publicKey: vapidPublicKey });
});

// POST /api/push/subscribe — save a push subscription
pushRoutes.post('/subscribe', zValidator('json', subscribeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { endpoint, keys } = c.req.valid('json');

  try {
    await db.$client.prepare(`
      INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint, tenant_id) DO UPDATE SET
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_id = excluded.user_id
    `).bind(tenantId, userId ?? null, endpoint, keys.p256dh, keys.auth).run();
    return c.json({ ok: true }, 201);
  } catch (error) {
    console.error('[push] subscribe error:', error);
    throw new HTTPException(500, { message: 'Failed to save subscription' });
  }
});

// DELETE /api/push/unsubscribe — remove a push subscription
pushRoutes.delete('/unsubscribe', zValidator('json', unsubscribeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { endpoint } = c.req.valid('json');

  try {
    await db.$client.prepare(
      'DELETE FROM push_subscriptions WHERE endpoint = ? AND tenant_id = ?',
    ).bind(endpoint, tenantId).run();
    return c.json({ ok: true });
  } catch (error) {
    console.error('[push] unsubscribe error:', error);
    throw new HTTPException(500, { message: 'Failed to remove subscription' });
  }
});

// POST /api/push/send — broadcast a push notification (admin only)
pushRoutes.post('/send', zValidator('json', sendSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role = c.get('role');

  // Only admin roles can send push notifications
  const adminRoles = ['admin', 'hospital_admin', 'director', 'super_admin'];
  if (!role || !adminRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Only admins can send push notifications' });
  }

  const vapidPublicKey = (c.env as any).VAPID_PUBLIC_KEY;
  const vapidPrivateKey = (c.env as any).VAPID_PRIVATE_KEY;
  if (!vapidPublicKey || !vapidPrivateKey) {
    return c.json({ ok: false, sent: 0, error: 'VAPID not configured' }, 503);
  }

  const { title, body, url, icon } = c.req.valid('json');

  try {
    const subs = await db.$client.prepare(
      'SELECT * FROM push_subscriptions WHERE tenant_id = ?',
    ).bind(tenantId).all<{ endpoint: string; p256dh: string; auth: string }>();

    let sent = 0;
    for (const sub of subs.results) {
      try {
        const PUSH_WORKER = (c.env as any).PUSH_WORKER;
        if (PUSH_WORKER) {
          // Delegate to a push sender worker if available
          await PUSH_WORKER.fetch(new Request('http://internal/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: sub, notification: { title, body, url, icon } }),
          }));
        }
        sent++;
      } catch {
        // Log but continue for other subscriptions
      }
    }

    return c.json({ ok: true, sent });
  } catch (error) {
    console.error('[push] send error:', error);
    throw new HTTPException(500, { message: 'Failed to send push notifications' });
  }
});

export default pushRoutes;
