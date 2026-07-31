/**
 * In-App Notification routes
 *
 * GET    /api/inbox                — List notifications for current user (paginated)
 * GET    /api/inbox/unread-count   — Get unread count (for badge)
 * PATCH  /api/inbox/:id/read      — Mark single notification as read
 * PATCH  /api/inbox/read-all      — Mark all notifications as read
 * DELETE /api/inbox/:id           — Delete a notification
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';


const inboxRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const UNREAD_COUNT_TIMEOUT_MS = 1500;

function summarizeD1Error(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function withReadFallback<T>(
  operation: () => Promise<T>,
  fallback: T,
  label: string,
  timeoutMs = UNREAD_COUNT_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation(),
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn(`${label} unavailable:`, summarizeD1Error(error));
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// ─── GET / — List notifications (newest first, paginated) ─────────────────────
inboxRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const limit = Math.min(Number(c.req.query('limit')) || 20, 50);
  const offset = Number(c.req.query('offset')) || 0;
  const unreadOnly = c.req.query('unread') === '1';

  let sql = `
    SELECT id, type, title, message, is_read, link, created_at
    FROM notifications
    WHERE tenant_id = ? AND (user_id = ? OR user_id IS NULL)
  `;
  const params: (string | number)[] = [tenantId, Number(userId)];

  if (unreadOnly) {
    sql += ' AND is_read = 0';
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  return c.json({ notifications: results ?? [] });
});

// ─── GET /unread-count — Badge count ──────────────────────────────────────────
inboxRoutes.get('/unread-count', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const row: { count: number; stale?: boolean } | null = await withReadFallback(
    () => db.$client.prepare(`
      SELECT COUNT(*) as count FROM notifications
      WHERE tenant_id = ? AND (user_id = ? OR user_id IS NULL) AND is_read = 0
    `).bind(tenantId, Number(userId)).first<{ count: number }>(),
    { count: 0, stale: true } as { count: number; stale?: boolean },
    'inbox unread-count',
  );

  return c.json({ count: row?.count ?? 0, stale: Boolean(row?.stale) });
});

// ─── PATCH /:id/read — Mark single as read ────────────────────────────────────
inboxRoutes.patch('/:id/read', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');

  const result = await db.$client.prepare(`
    UPDATE notifications SET is_read = 1
    WHERE id = ? AND tenant_id = ? AND (user_id = ? OR user_id IS NULL)
  `).bind(id, tenantId, Number(userId)).run();

  if (!result.meta.changes) {
    throw new HTTPException(404, { message: 'Notification not found' });
  }

  return c.json({ success: true });
});

// ─── PATCH /read-all — Mark all as read ───────────────────────────────────────
inboxRoutes.patch('/read-all', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  await db.$client.prepare(`
    UPDATE notifications SET is_read = 1
    WHERE tenant_id = ? AND (user_id = ? OR user_id IS NULL) AND is_read = 0
  `).bind(tenantId, Number(userId)).run();

  return c.json({ success: true });
});

// ─── DELETE /:id — Delete notification ────────────────────────────────────────
inboxRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');

  const result = await db.$client.prepare(`
    DELETE FROM notifications
    WHERE id = ? AND tenant_id = ? AND (user_id = ? OR user_id IS NULL)
  `).bind(id, tenantId, Number(userId)).run();

  if (!result.meta.changes) {
    throw new HTTPException(404, { message: 'Notification not found' });
  }

  return c.json({ success: true });
});

export default inboxRoutes;
