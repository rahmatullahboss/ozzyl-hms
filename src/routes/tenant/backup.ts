import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireTenantId } from '../../lib/context-helpers';
import { createAuditLog } from '../../lib/accounting-helpers';
import type { Env, Variables } from '../../types';

const backupRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const BACKUP_ALLOWED_ROLES = new Set(['hospital_admin', 'director', 'md', 'super_admin']);

async function upsertBackupSetting(env: Env, tenantId: string, key: string, value: string) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO settings (key, value, tenant_id, updated_at) VALUES (?, ?, ?, datetime("now"))',
  ).bind(key, value, tenantId).run();
}

backupRoutes.post('/create', async (c) => {
  const role = c.get('role');
  if (!role || !BACKUP_ALLOWED_ROLES.has(role)) {
    throw new HTTPException(403, { message: 'Forbidden: backup requires admin access' });
  }

  const tenantId = requireTenantId(c);
  const userId = c.get('userId') ?? 'system';
  const requestedAt = new Date().toISOString();
  const manifestKey = `${tenantId}/backup-requests/${requestedAt.replace(/[:.]/g, '-')}.json`;

  const manifest = {
    tenant_id: tenantId,
    requested_at: requestedAt,
    requested_by: userId,
    status: 'requested',
    note: 'Manual backup request recorded. Full database export should run through the configured Cloudflare backup/export workflow, not a synchronous browser request.',
  };

  try {
    await c.env.UPLOADS.put(manifestKey, JSON.stringify(manifest, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });

    await Promise.all([
      upsertBackupSetting(c.env, tenantId, 'backup_last_backup_at', requestedAt),
      upsertBackupSetting(c.env, tenantId, 'backup_last_backup_status', 'requested'),
      upsertBackupSetting(c.env, tenantId, 'backup_last_backup_manifest_key', manifestKey),
    ]);

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'BACKUP_REQUEST',
      'settings',
      0,
      null,
      {
        backup_last_backup_status: 'requested',
        backup_last_backup_manifest_key: manifestKey,
      },
      c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For'),
      c.req.header('User-Agent'),
    );

    return c.json({
      message: 'Backup request recorded',
      backup: {
        requested_at: requestedAt,
        status: 'requested',
        manifest_key: manifestKey,
      },
    });
  } catch (error) {
    await Promise.allSettled([
      upsertBackupSetting(c.env, tenantId, 'backup_last_backup_at', requestedAt),
      upsertBackupSetting(c.env, tenantId, 'backup_last_backup_status', 'failed'),
    ]);
    console.error('[Backup] Manual backup request failed:', error);
    return c.json({ error: 'Failed to record backup request' }, 500);
  }
});

export default backupRoutes;
