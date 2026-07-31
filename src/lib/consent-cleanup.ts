/**
 * Consent Expiry Cleanup Service
 *
 * Handles lazy + batch cleanup of expired consents.
 * Expired consents get is_active=0, expired_at=now.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface CleanupResult {
  cleaned: number;
  timestamp: string;
}

export interface ConsentExpiryStats {
  active: number;
  expired: number;
  revoked: number;
  auto_granted: number;
  total: number;
}

/**
 * Batch-expire all consents past their expiry time.
 * Safe to call repeatedly — idempotent (only touches is_active=1 + past expires_at).
 */
export async function cleanupExpiredConsents(db: D1Database): Promise<CleanupResult> {
  const result = await db.prepare(`
    UPDATE health_record_consents
    SET is_active = 0, expired_at = datetime('now')
    WHERE is_active = 1 AND expires_at < datetime('now') AND expired_at IS NULL
  `).run();

  return {
    cleaned: result.meta.changes ?? 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get consent statistics for a tenant (admin dashboard).
 */
export async function getConsentExpiryStats(
  db: D1Database,
  tenantId?: string | number,
): Promise<ConsentExpiryStats> {
  const tenantFilter = tenantId ? 'WHERE granting_tenant_id = ?' : '';
  const bindings = tenantId ? [String(tenantId)] : [];

  const row = await db.prepare(`
    SELECT
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN expired_at IS NOT NULL THEN 1 ELSE 0 END) AS expired,
      SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked,
      SUM(CASE WHEN auto_granted = 1 THEN 1 ELSE 0 END) AS auto_granted,
      COUNT(*) AS total
    FROM health_record_consents
    ${tenantFilter}
  `).bind(...bindings).first<{
    active: number;
    expired: number;
    revoked: number;
    auto_granted: number;
    total: number;
  }>();

  if (!row) return { active: 0, expired: 0, revoked: 0, auto_granted: 0, total: 0 };

  return {
    active: row.active ?? 0,
    expired: row.expired ?? 0,
    revoked: row.revoked ?? 0,
    auto_granted: row.auto_granted ?? 0,
    total: row.total ?? 0,
  };
}

export async function runScheduledCleanup(
  db: D1Database,
): Promise<CleanupResult & { stats: ConsentExpiryStats }> {
  const cleanup = await cleanupExpiredConsents(db);
  const stats = await getConsentExpiryStats(db);
  return {
    ...cleanup,
    stats,
  };
}
