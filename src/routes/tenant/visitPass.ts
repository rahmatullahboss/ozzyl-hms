import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { redeemVisitPassSchema } from '../../schemas/visitPass';
import { buildPortableHealthSummary } from '../../lib/health-summary';
import { getDb } from '../../db';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import type { Env, Variables } from '../../types';

const visitPassRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

type VisitPassRow = {
  id: number;
  global_user_id: number;
  uhid: string;
  is_active: number;
  expires_at: string;
  redeemed_by_tenant_id: string | null;
  redeemed_by_user_id: number | null;
  revoked_at: string | null;
};

async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function loadVisitPass(db: ReturnType<typeof getDb>, input: {
  token?: string;
  passCode?: string;
}): Promise<VisitPassRow | null> {
  if (input.token) {
    return db.$client.prepare(`
      SELECT id, global_user_id, uhid, is_active, expires_at, redeemed_by_tenant_id, redeemed_by_user_id, revoked_at
      FROM patient_visit_passes WHERE token_hash = ?
    `).bind(await sha256(input.token)).first<VisitPassRow>();
  }

  return db.$client.prepare(`
    SELECT id, global_user_id, uhid, is_active, expires_at, redeemed_by_tenant_id, redeemed_by_user_id, revoked_at
    FROM patient_visit_passes WHERE code_hash = ?
  `).bind(await sha256(input.passCode!)).first<VisitPassRow>();
}

visitPassRoutes.post('/redeem', zValidator('json', redeemVisitPassSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const db = getDb(c.env.DB);
  const { token, pass_code } = c.req.valid('json');

  const pass = await loadVisitPass(db, { token, passCode: pass_code });
  if (!pass) {
    throw new HTTPException(404, { message: 'Visit pass not found' });
  }
  if (!pass.is_active || pass.revoked_at) {
    throw new HTTPException(410, { message: 'Visit pass is no longer active' });
  }
  if (new Date(pass.expires_at) < new Date()) {
    throw new HTTPException(410, { message: 'Visit pass has expired' });
  }
  if (pass.redeemed_by_tenant_id && pass.redeemed_by_tenant_id !== tenantId) {
    throw new HTTPException(409, { message: 'Visit pass already redeemed at another hospital' });
  }

  const linkedPatients = await db.$client.prepare(`
    SELECT p.id, p.tenant_id, p.national_id, p.uhid, t.name AS hospital_name
    FROM patients p
    JOIN tenants t ON t.id = p.tenant_id
    WHERE p.uhid = ?
    ORDER BY t.name ASC, p.id ASC
  `).bind(pass.uhid).all<{
    id: number;
    tenant_id: string;
    national_id: string | null;
    uhid: string;
    hospital_name: string;
  }>();

  const hospitals = [];
  for (const patient of linkedPatients.results ?? []) {
    if (patient.national_id) {
      const existingConsent = await db.$client.prepare(`
        SELECT id FROM health_record_consents
        WHERE national_id = ? AND granting_tenant_id = ? AND granted_to_tenant_id = ?
          AND consent_type = 'view_summary' AND is_active = 1 AND expires_at > datetime('now', '+6 hours')
        LIMIT 1
      `).bind(patient.national_id, patient.tenant_id, tenantId).first<{ id: number }>();

      if (!existingConsent) {
        await db.$client.prepare(`
          INSERT INTO health_record_consents (
            national_id, granting_tenant_id, granting_patient_id, granted_to_tenant_id,
            consent_type, created_by_user_id, expires_at, is_active
          ) VALUES (?, ?, ?, ?, 'view_summary', ?, ?, 1)
        `).bind(
          patient.national_id,
          patient.tenant_id,
          patient.id,
          tenantId,
          userId,
          pass.expires_at,
        ).run();
      }
    }

    const summary = await buildPortableHealthSummary(c.env.DB, patient.tenant_id, patient.id);
    if (!summary) continue;

    await db.$client.prepare(`
      INSERT INTO health_record_access_log
        (national_id, source_tenant_id, accessed_by_tenant_id, access_type, notes)
      VALUES (?, ?, ?, 'token_access', ?)
    `).bind(
      patient.national_id,
      patient.tenant_id,
      tenantId,
      'visit_pass_redeem',
    ).run();

    hospitals.push({
      tenant_id: patient.tenant_id,
      hospital_name: patient.hospital_name,
      summary,
    });
  }

  await db.$client.prepare(`
    UPDATE patient_visit_passes
    SET redeemed_at = COALESCE(redeemed_at, datetime('now', '+6 hours')),
        redeemed_by_tenant_id = COALESCE(redeemed_by_tenant_id, ?),
        redeemed_by_user_id = COALESCE(redeemed_by_user_id, ?)
    WHERE id = ?
  `).bind(tenantId, userId, pass.id).run();

  return c.json({
    redeemed: true,
    scope: 'summary',
    expires_at: pass.expires_at,
    hospitals,
  });
});

export default visitPassRoutes;
