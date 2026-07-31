import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { assertLabReportNotRetracted } from '../../lib/lis-retraction-guards';
import { createSmsProvider } from '../../lib/sms';

function escapeHtml(unsafe: unknown): string {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const labNotifications = new Hono<{ Bindings: Env; Variables: Variables }>();

labNotifications.use('*', requireRole('laboratory', 'lab', 'lab_tech', 'hospital_admin', 'director'));

// ═══════════════════════════════════════════════════════════════════════════════
// SMS NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

const smsSchema = z.object({
  message: z.string().optional(),
  phone: z.string().optional(),
});

labNotifications.post('/orders/:id/sms', zValidator('json', smsSchema.optional()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const orderId = Number(c.req.param('id'));

  // Get order + patient
  const order = await db.$client.prepare(`
    SELECT lo.*, p.name as patient_name, p.mobile as patient_phone
    FROM lab_orders lo
    JOIN patients p ON lo.patient_id = p.id
    WHERE lo.id = ? AND lo.tenant_id = ?
  `).bind(orderId, tenantId).first<{ id: number; patient_name: string; patient_phone: string | null }>();
  if (!order) throw new HTTPException(404, { message: 'Lab order not found' });

  const phone = c.req.valid('json')?.phone ?? order.patient_phone;
  if (!phone) throw new HTTPException(400, { message: 'Patient phone not available' });

  // Get report results summary
  const report = await db.$client.prepare(`
    SELECT * FROM lab_reports WHERE lab_order_id = ? AND tenant_id = ?
  `).bind(orderId, tenantId).first<{
    id: number;
    report_status?: string | null;
    retracted_at?: string | null;
    retraction_reason?: string | null;
  }>();

  let resultsSummary = '';
  if (report) {
    assertLabReportNotRetracted(report, 'sent by SMS');
    const results = await db.$client.prepare(`
      SELECT lr.result_value, lr.abnormal_flag, ltc.name as test_name
      FROM lab_results lr
      JOIN lab_test_catalog ltc ON lr.lab_test_id = ltc.id
      WHERE lr.lab_report_id = ?
    `).bind(report.id).all<{ result_value: string; abnormal_flag: string; test_name: string }>();
    resultsSummary = results.results.map(r => `${r.test_name}: ${r.result_value} (${r.abnormal_flag})`).join(', ');
  }

  // Build SMS message
  const customMsg = c.req.valid('json')?.message;
  const smsText = customMsg || `Dear ${order.patient_name}, your lab results are ready. ${resultsSummary.substring(0, 200)}`;

  // Send SMS via the shared provider abstraction. Disabled/stub modes fail closed
  // so a report is never marked delivered when no real message was sent.
  let sent = false;
  let error: string | null = null;

  try {
    const result = await createSmsProvider(c.env).sendSMS(phone, smsText);
    sent = result.success;
    error = result.error ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : 'SMS send failed';
  }

  if (sent && report) {
    await db.$client.prepare(`
      UPDATE lab_reports SET delivered_via = 'sms', delivered_at = datetime('now', '+6 hours')
      WHERE id = ?
    `).bind(report.id).run();
  }

  return c.json({ sent, phone, message: smsText, error });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

const emailSchema = z.object({
  email: z.string().email().optional(),
  subject: z.string().optional(),
  sendPdf: z.boolean().default(true),
});

labNotifications.post('/orders/:id/email', zValidator('json', emailSchema.optional()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const orderId = Number(c.req.param('id'));

  const order = await db.$client.prepare(`
    SELECT lo.*, p.name as patient_name, p.email as patient_email, p.mobile as patient_phone
    FROM lab_orders lo
    JOIN patients p ON lo.patient_id = p.id
    WHERE lo.id = ? AND lo.tenant_id = ?
  `).bind(orderId, tenantId).first<{ id: number; patient_name: string; patient_email: string | null }>();
  if (!order) throw new HTTPException(404, { message: 'Lab order not found' });

  const email = c.req.valid('json')?.email ?? order.patient_email;
  if (!email) throw new HTTPException(400, { message: 'Patient email not available' });

  // Get report
  const report = await db.$client.prepare(`
    SELECT * FROM lab_reports WHERE lab_order_id = ? AND tenant_id = ?
  `).bind(orderId, tenantId).first<{
    id: number;
    report_status?: string | null;
    retracted_at?: string | null;
    retraction_reason?: string | null;
  }>();
  if (report) assertLabReportNotRetracted(report, 'sent by email');

  // Build email HTML
  const subject = c.req.valid('json')?.subject || `Lab Results - ${order.patient_name}`;
  const html = `
    <h2>Lab Results Report</h2>
    <p>Dear ${escapeHtml(order.patient_name)},</p>
    <p>Your lab results are ready. Please find the details below:</p>
    <p>Order #${escapeHtml(orderId)}</p>
    <p>For detailed results, please contact the laboratory or visit our portal.</p>
    <p>Thank you,<br/>Your Hospital Lab Team</p>
  `;

  // Send via Resend if configured
  let sent = false;
  const resendKey = c.env.RESEND_API_KEY;
  const fromEmail = c.env.RESEND_FROM_EMAIL || 'noreply@yourhospital.com';

  if (resendKey) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: email,
          subject,
          html,
        }),
      });
      sent = resp.ok;
    } catch (e) {
      console.error('Email send failed:', e);
    }
  } else {
    console.log(`[EMAIL-STUB] To: ${email}, Subject: ${subject}`);
    sent = true;
  }

  if (sent && report) {
    await db.$client.prepare(`
      UPDATE lab_reports SET delivered_via = 'email', delivered_at = datetime('now', '+6 hours')
      WHERE id = ?
    `).bind(report.id).run();
  }

  return c.json({ sent, email, subject });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SMS TEMPLATE CRUD
// ═══════════════════════════════════════════════════════════════════════════════

labNotifications.get('/templates', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const rows = await db.$client.prepare(`
    SELECT * FROM lab_sms_templates WHERE tenant_id = ? AND is_active = 1
  `).bind(tenantId).all();

  return c.json({ data: rows.results });
});

labNotifications.post('/templates', zValidator('json', z.object({
  template_name: z.string().min(1),
  template_text: z.string().min(1),
  template_type: z.enum(['sms', 'email']).default('sms'),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_sms_templates (template_name, template_text, template_type, tenant_id)
    VALUES (?, ?, ?, ?)
  `).bind(data.template_name, data.template_text, data.template_type, tenantId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Template created' }, 201);
});

labNotifications.delete('/templates/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  await db.$client.prepare(`
    UPDATE lab_sms_templates SET is_active = 0 WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).run();

  return c.json({ message: 'Template deactivated' });
});

export default labNotifications;
