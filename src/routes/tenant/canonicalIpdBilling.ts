import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import {
  CanonicalIpdAdmissionNotFoundError,
  listCanonicalIpdAdmissionSummaries,
  projectCanonicalIpdAdmission,
  type CanonicalIpdProjectionDatabase,
} from '../../lib/canonical/ipd-projection';

const canonicalIpdBilling = new Hono<{ Bindings: Env; Variables: Variables }>();
const IPD_SHADOW_ROLES = ['reception', 'hospital_admin', 'md', 'director', 'accountant'] as const;
const SHADOW_FLAG_KEY = 'canonical_ipd_shadow_enabled';

function enabled(value: string | null | undefined): boolean {
  return ['true', '1', 'on', 'enabled'].includes(value?.trim().toLowerCase() ?? '');
}

async function assertShadowEnabled(db: CanonicalIpdProjectionDatabase, tenantId: string): Promise<void> {
  const setting = await db.prepare(`
    SELECT value FROM settings
    WHERE tenant_id=? AND key=?
    ORDER BY id DESC LIMIT 1
  `).bind(tenantId, SHADOW_FLAG_KEY).first<{ value: string }>();
  if (!enabled(setting?.value)) throw new HTTPException(404, { message: 'Not found' });
}

function booleanQuery(value: string | undefined): boolean {
  return ['true', '1', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

canonicalIpdBilling.use('*', requireRole(...IPD_SHADOW_ROLES));

canonicalIpdBilling.get('/admissions', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB as unknown as CanonicalIpdProjectionDatabase;
  await assertShadowEnabled(db, tenantId);
  const data = await listCanonicalIpdAdmissionSummaries(db, {
    tenantId,
    includeCompleted: booleanQuery(c.req.query('include_completed')),
    includeLegacyComparison: c.req.query('include_legacy') !== 'false',
  });
  return c.json({ data, shadow: true, authority: 'canonical_projection' });
});

canonicalIpdBilling.get('/admissions/:admissionId', async (c) => {
  const tenantId = requireTenantId(c);
  const legacyAdmissionId = Number(c.req.param('admissionId'));
  if (!Number.isSafeInteger(legacyAdmissionId) || legacyAdmissionId <= 0) {
    throw new HTTPException(400, { message: 'Invalid admission ID' });
  }
  const db = c.env.DB as unknown as CanonicalIpdProjectionDatabase;
  await assertShadowEnabled(db, tenantId);
  try {
    const data = await projectCanonicalIpdAdmission(db, {
      tenantId,
      legacyAdmissionId,
      includeLegacyComparison: c.req.query('include_legacy') !== 'false',
    });
    return c.json({ data, shadow: true, authority: 'canonical_projection' });
  } catch (error) {
    if (error instanceof CanonicalIpdAdmissionNotFoundError) {
      throw new HTTPException(404, { message: 'Canonical IPD admission not found' });
    }
    throw error;
  }
});

export default canonicalIpdBilling;
