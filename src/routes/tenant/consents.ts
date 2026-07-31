import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getPagination, paginationMeta } from '../../lib/pagination';
import { getDb } from '../../db';
import { requireRole, CLINICAL_ROLES } from '../../middleware/rbac';

function escapeHtml(unsafe: unknown): string {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type CEnv = { Bindings: Env; Variables: Variables };
const consentRoutes = new Hono<CEnv>();

// ─── Schemas ────────────────────────────────────────────────────────────────

const createConsentSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  admission_id: z.number().int().positive().optional(),
  template_id: z.number().int().positive().optional(),
  consent_type: z.enum(['admission', 'surgical', 'procedure', 'blood', 'anesthesia', 'research', 'discharge', 'other']),
  title: z.string().min(1),
  procedure_name: z.string().optional(),
  procedure_date: z.string().optional(),
  doctor_id: z.number().int().positive().optional(),
  doctor_name: z.string().optional(),
  risks_explained: z.boolean().default(false),
  alternatives_explained: z.boolean().default(false),
  questions_answered: z.boolean().default(false),
  notes: z.string().optional(),
});

const signConsentSchema = z.object({
  patient_signature: z.string().min(1),
  witness_name: z.string().optional(),
  witness_signature: z.string().optional(),
  guardian_name: z.string().optional(),
  guardian_relationship: z.string().optional(),
  guardian_signature: z.string().optional(),
});

const revokeConsentSchema = z.object({
  reason: z.string().min(1),
});

// ─── Auto-clone seeds ───────────────────────────────────────────────────────

async function ensureSeeds(db: ReturnType<typeof getDb>, tenantId: string) {
  const existing = await db.$client.prepare(
    'SELECT COUNT(*) as c FROM consent_templates WHERE tenant_id = ?',
  ).bind(tenantId).first<{ c: number }>();
  if (existing && existing.c > 0) return;

  const seeds = await db.$client.prepare(
    "SELECT * FROM consent_templates WHERE tenant_id = '__seed__'",
  ).all();
  for (const s of (seeds.results || []) as any[]) {
    await db.$client.prepare(`
      INSERT OR IGNORE INTO consent_templates (code, title, category, body_html, requires_witness, requires_guardian, language, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(s.code, s.title, s.category, s.body_html, s.requires_witness, s.requires_guardian ?? 0, s.language, tenantId).run();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSENT TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

consentRoutes.get('/templates', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  await ensureSeeds(db, tenantId);
  const { results } = await db.$client.prepare(
    'SELECT * FROM consent_templates WHERE tenant_id = ? AND is_active = 1 ORDER BY category, title',
  ).bind(tenantId).all();
  return c.json({ data: results });
});

consentRoutes.post('/templates', requireRole('hospital_admin'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = await c.req.json() as any;

  const result = await db.$client.prepare(`
    INSERT INTO consent_templates (code, title, category, body_html, requires_witness, requires_guardian, language, tenant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(data.code, data.title, data.category, data.body_html ?? null,
    data.requires_witness ? 1 : 0, data.requires_guardian ? 1 : 0,
    data.language ?? 'bn', tenantId, userId).run();
  return c.json({ id: result.meta.last_row_id, message: 'Template created' }, 201);
});

// ═══════════════════════════════════════════════════════════════════════════
// PATIENT CONSENTS
// ═══════════════════════════════════════════════════════════════════════════

consentRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patient_id, status, visit_id } = c.req.query();
  const { page, limit, offset } = getPagination(c);

  let where = 'WHERE pc.tenant_id = ? AND pc.is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (patient_id) { where += ' AND pc.patient_id = ?'; params.push(patient_id); }
  if (status) { where += ' AND pc.status = ?'; params.push(status); }
  if (visit_id) { where += ' AND pc.visit_id = ?'; params.push(visit_id); }

  const countResult = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM patient_consents pc ${where}`,
  ).bind(...params).first<{ total: number }>();

  const { results } = await db.$client.prepare(`
    SELECT pc.*, p.name as patient_name, p.patient_code
    FROM patient_consents pc
    JOIN patients p ON pc.patient_id = p.id
    ${where} ORDER BY pc.created_at DESC LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results, meta: paginationMeta(page, limit, countResult?.total ?? 0) });
});

consentRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const consent = await db.$client.prepare(`
    SELECT pc.*, p.name as patient_name, p.patient_code, p.date_of_birth as dob, p.gender,
           ct.body_html as template_body, ct.requires_witness, ct.requires_guardian
    FROM patient_consents pc
    JOIN patients p ON pc.patient_id = p.id
    LEFT JOIN consent_templates ct ON pc.template_id = ct.id
    WHERE pc.id = ? AND pc.tenant_id = ?
  `).bind(c.req.param('id'), tenantId).first();
  if (!consent) throw new HTTPException(404, { message: 'Consent not found' });
  return c.json({ data: consent });
});

consentRoutes.post('/', requireRole(...CLINICAL_ROLES), zValidator('json', createConsentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO patient_consents (patient_id, visit_id, admission_id, template_id, consent_type, title,
      procedure_name, procedure_date, doctor_id, doctor_name, risks_explained, alternatives_explained,
      questions_answered, notes, status, tenant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    data.patient_id, data.visit_id ?? null, data.admission_id ?? null,
    data.template_id ?? null, data.consent_type, data.title,
    data.procedure_name ?? null, data.procedure_date ?? null,
    data.doctor_id ?? null, data.doctor_name ?? null,
    data.risks_explained ? 1 : 0, data.alternatives_explained ? 1 : 0,
    data.questions_answered ? 1 : 0, data.notes ?? null, tenantId, userId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Consent form created' }, 201);
});

/** POST /:id/sign — Record patient/witness/guardian signatures */
consentRoutes.post('/:id/sign', requireRole(...CLINICAL_ROLES), zValidator('json', signConsentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    "SELECT id, status FROM patient_consents WHERE id = ? AND tenant_id = ? AND status = 'pending'",
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Consent not found or already signed' });

  await db.$client.prepare(`
    UPDATE patient_consents SET
      patient_signature = ?, patient_signed_at = datetime('now', '+6 hours'),
      witness_name = ?, witness_signature = ?, witness_signed_at = CASE WHEN ? IS NOT NULL THEN datetime('now', '+6 hours') ELSE NULL END,
      guardian_name = ?, guardian_relationship = ?, guardian_signature = ?,
      guardian_signed_at = CASE WHEN ? IS NOT NULL THEN datetime('now', '+6 hours') ELSE NULL END,
      status = 'signed'
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.patient_signature,
    data.witness_name ?? null, data.witness_signature ?? null, data.witness_signature ?? null,
    data.guardian_name ?? null, data.guardian_relationship ?? null, data.guardian_signature ?? null, data.guardian_signature ?? null,
    id, tenantId,
  ).run();

  return c.json({ message: 'Consent signed successfully' });
});

/** POST /:id/revoke — Revoke a signed consent */
consentRoutes.post('/:id/revoke', requireRole(...CLINICAL_ROLES), zValidator('json', revokeConsentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  await db.$client.prepare(
    "UPDATE patient_consents SET status = 'revoked', revoked_at = datetime('now', '+6 hours'), revoked_reason = ? WHERE id = ? AND tenant_id = ?",
  ).bind(data.reason, c.req.param('id'), tenantId).run();

  return c.json({ message: 'Consent revoked' });
});

/** GET /:id/print — Printable consent form HTML */
consentRoutes.get('/:id/print', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const autoprint = c.req.query('autoprint') === '1';

  const consent = await db.$client.prepare(`
    SELECT pc.*, p.name as patient_name, p.patient_code, p.date_of_birth as dob, p.gender, p.national_id as nid,
           ct.body_html, ct.title as template_title
    FROM patient_consents pc
    JOIN patients p ON pc.patient_id = p.id
    LEFT JOIN consent_templates ct ON pc.template_id = ct.id
    WHERE pc.id = ? AND pc.tenant_id = ?
  `).bind(c.req.param('id'), tenantId).first() as any;
  if (!consent) throw new HTTPException(404, { message: 'Consent not found' });

  const tenant = await db.$client.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first() as any;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Consent - ${escapeHtml(consent.title)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: 'Segoe UI', sans-serif; font-size: 12px; line-height: 1.6; }
  .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 15px; }
  .header h1 { font-size: 16px; margin: 0; }
  .header p { font-size: 10px; color: #666; margin: 2px 0; }
  .title { text-align: center; font-size: 14px; font-weight: bold; margin: 15px 0; text-transform: uppercase; border: 1px solid #333; padding: 5px; }
  .patient-info { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 15px; font-size: 11px; }
  .patient-info div strong { display: inline-block; width: 120px; }
  .consent-body { border: 1px solid #ddd; padding: 15px; margin: 15px 0; min-height: 150px; }
  .checklist { margin: 10px 0; }
  .checklist div { margin: 3px 0; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 40px; }
  .sig-box { border-top: 1px solid #333; padding-top: 5px; text-align: center; min-height: 60px; }
  .sig-box .label { font-size: 10px; color: #666; }
  .sig-box .name { font-weight: bold; }
  .footer { text-align: center; font-size: 9px; color: #999; margin-top: 20px; border-top: 1px solid #ddd; padding-top: 5px; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style></head><body>
  <div class="header">
    <h1>${escapeHtml(tenant?.name || 'Hospital')}</h1>
    <p>${escapeHtml(tenant?.address || '')}</p>
  </div>
  <div class="title">${escapeHtml(consent.title)}</div>
  <div class="patient-info">
    <div><strong>Patient Name:</strong> ${escapeHtml(consent.patient_name)}</div>
    <div><strong>Patient ID:</strong> ${escapeHtml(consent.patient_code)}</div>
    <div><strong>Date of Birth:</strong> ${escapeHtml(consent.dob || 'N/A')}</div>
    <div><strong>Gender:</strong> ${escapeHtml(consent.gender || 'N/A')}</div>
    ${consent.procedure_name ? `<div><strong>Procedure:</strong> ${escapeHtml(consent.procedure_name)}</div>` : ''}
    ${consent.doctor_name ? `<div><strong>Doctor:</strong> ${escapeHtml(consent.doctor_name)}</div>` : ''}
    <div><strong>Date:</strong> ${escapeHtml(consent.procedure_date || new Date().toISOString().split('T')[0])}</div>
  </div>
  <div class="consent-body">${consent.body_html || consent.notes ? (consent.body_html || escapeHtml(consent.notes)) : '<p>Consent details as discussed with the patient.</p>'}</div>
  <div class="checklist">
    <div>${consent.risks_explained ? '☑' : '☐'} Risks and complications explained</div>
    <div>${consent.alternatives_explained ? '☑' : '☐'} Alternative treatments discussed</div>
    <div>${consent.questions_answered ? '☑' : '☐'} Patient's questions answered</div>
  </div>
  <div class="signatures">
    <div class="sig-box">
      ${consent.patient_signature ? '<div style="font-style:italic;">[Signed Digitally]</div>' : '<div style="height:40px;"></div>'}
      <div class="name">${escapeHtml(consent.patient_name)}</div>
      <div class="label">Patient Signature</div>
      ${consent.patient_signed_at ? `<div class="label">${escapeHtml(consent.patient_signed_at)}</div>` : ''}
    </div>
    <div class="sig-box">
      ${consent.witness_signature ? '<div style="font-style:italic;">[Signed]</div>' : '<div style="height:40px;"></div>'}
      <div class="name">${escapeHtml(consent.witness_name || '________________')}</div>
      <div class="label">Witness Signature</div>
    </div>
    ${consent.guardian_name ? `
    <div class="sig-box">
      ${consent.guardian_signature ? '<div style="font-style:italic;">[Signed]</div>' : '<div style="height:40px;"></div>'}
      <div class="name">${escapeHtml(consent.guardian_name)} (${escapeHtml(consent.guardian_relationship || 'Guardian')})</div>
      <div class="label">Guardian Signature</div>
    </div>` : ''}
    <div class="sig-box">
      <div style="height:40px;"></div>
      <div class="name">${escapeHtml(consent.doctor_name || '________________')}</div>
      <div class="label">Doctor Signature</div>
    </div>
  </div>
  <div class="footer">Form ID: ${escapeHtml(consent.id)} | Status: ${escapeHtml(consent.status)} | Generated: ${escapeHtml(new Date().toLocaleString())}</div>
  ${autoprint ? '<script>window.onload=function(){setTimeout(function(){window.print()},500)};</script>' : ''}
</body></html>`;

  return c.html(html);
});

/** GET /patient/:patientId/check — Quick check if required consents are signed for a visit */
consentRoutes.get('/patient/:patientId/check', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  const visitId = c.req.query('visit_id');

  let where = 'WHERE tenant_id = ? AND patient_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId, patientId];
  if (visitId) { where += ' AND visit_id = ?'; params.push(visitId); }

  const { results } = await db.$client.prepare(
    `SELECT id, consent_type, title, status, patient_signed_at FROM patient_consents ${where} ORDER BY created_at DESC`,
  ).bind(...params).all();

  const signed = (results || []).filter((r: any) => r.status === 'signed').length;
  const pending = (results || []).filter((r: any) => r.status === 'pending').length;

  return c.json({ total: (results || []).length, signed, pending, consents: results });
});

export default consentRoutes;
