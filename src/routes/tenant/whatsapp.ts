/**
 * WhatsApp Business API integration for appointment reminders & notifications
 *
 * Uses Meta WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
 * Requires: Phone Number ID, Business Account ID, Access Token (from Meta Business)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const wa = new Hono<{ Bindings: Env; Variables: Variables }>();

const WHATSAPP_API = 'https://graph.facebook.com/v21.0';
const TEMPLATE_TYPES = ['appointment','lab_result','prescription','discharge','billing','general','follow_up'] as const;

// ─── Helper: Send WhatsApp message via Cloud API ─────────────────────────────

async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode: string,
  parameters: string[],
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/[^0-9+]/g, ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: parameters.length > 0 ? [{
            type: 'body',
            parameters: parameters.map(p => ({ type: 'text', text: p })),
          }] : undefined,
        },
      }),
    });

    const data = await res.json() as { messages?: { id: string }[]; error?: { message: string } };

    if (data.messages?.[0]?.id) {
      return { success: true, messageId: data.messages[0].id };
    }
    return { success: false, error: data.error?.message ?? 'Unknown error' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Format phone for WhatsApp (Bangladesh: 01xxx → +88001xxx)
function formatPhone(phone: string): string {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('01') && cleaned.length === 11) cleaned = '+880' + cleaned;
  else if (cleaned.startsWith('880')) cleaned = '+' + cleaned;
  else if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

// ─── Config ──────────────────────────────────────────────────────────────────

wa.get('/config', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const config = await db.$client.prepare('SELECT id, tenant_id, phone_number_id, business_account_id, default_template_name, default_language, is_active, created_at FROM whatsapp_config WHERE tenant_id = ?').bind(tenantId).first();
  return c.json({ data: config ?? null });
});

wa.post('/config', zValidator('json', z.object({
  phone_number_id: z.string().min(1),
  business_account_id: z.string().optional(),
  access_token: z.string().min(1),
  default_template_name: z.string().default('appointment_reminder'),
  default_language: z.string().default('en'),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  await db.$client.prepare(`
    INSERT INTO whatsapp_config (tenant_id, phone_number_id, business_account_id, access_token_encrypted, default_template_name, default_language)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET phone_number_id = ?, business_account_id = ?, access_token_encrypted = ?, default_template_name = ?, default_language = ?, updated_at = datetime('now', '+6 hours')
  `).bind(tenantId, d.phone_number_id, d.business_account_id ?? null, d.access_token, d.default_template_name, d.default_language, d.phone_number_id, d.business_account_id ?? null, d.access_token, d.default_template_name, d.default_language).run();

  return c.json({ message: 'WhatsApp config saved' }, 201);
});

// ─── Templates ───────────────────────────────────────────────────────────────

wa.get('/templates', async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await getDb(c.env.DB).$client.prepare('SELECT * FROM whatsapp_templates WHERE tenant_id = ? AND is_active = 1 ORDER BY template_type').bind(tenantId).all();
  return c.json({ data: results ?? [] });
});

wa.post('/templates', zValidator('json', z.object({
  template_name: z.string().min(1),
  template_type: z.enum(TEMPLATE_TYPES).default('appointment'),
  language: z.string().default('en'),
  body_text: z.string().min(1),
  header_text: z.string().optional(),
  footer_text: z.string().optional(),
  meta_template_id: z.string().optional(),
  status: z.enum(['draft','pending_approval','approved']).default('draft'),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);
  const r = await db.$client.prepare(`
    INSERT INTO whatsapp_templates (tenant_id, template_name, template_type, language, body_text, header_text, footer_text, meta_template_id, status)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(tenantId, d.template_name, d.template_type, d.language, d.body_text, d.header_text ?? null, d.footer_text ?? null, d.meta_template_id ?? null, d.status).run();
  return c.json({ message: 'Template created', id: r.meta.last_row_id }, 201);
});

// ─── Stats (before /:id) ─────────────────────────────────────────────────────

wa.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = new Date().toISOString().split('T')[0];

  const stats = await db.$client.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as read_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN date(created_at) = ? THEN 1 ELSE 0 END) as today_count
    FROM whatsapp_messages WHERE tenant_id = ?
  `).bind(today, tenantId).first();

  return c.json(stats ?? {});
});

// ─── Send Message ────────────────────────────────────────────────────────────

// POST /send — Send WhatsApp message to a patient
wa.post('/send', zValidator('json', z.object({
  patient_id: z.number().int().positive().optional(),
  appointment_id: z.number().int().positive().optional(),
  phone: z.string().min(1),
  recipient_name: z.string().optional(),
  template_name: z.string().min(1),
  parameters: z.array(z.string()).default([]),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  // Get WhatsApp config
  const config = await db.$client.prepare('SELECT * FROM whatsapp_config WHERE tenant_id = ? AND is_active = 1').bind(tenantId).first<{ phone_number_id: string; access_token_encrypted: string; default_language: string }>();
  if (!config) throw new HTTPException(400, { message: 'WhatsApp not configured. Set up in Settings → WhatsApp.' });

  const formattedPhone = formatPhone(d.phone);

  // Get template language
  const template = await db.$client.prepare('SELECT language FROM whatsapp_templates WHERE tenant_id = ? AND template_name = ? AND is_active = 1').bind(tenantId, d.template_name).first<{ language: string }>();
  const lang = template?.language ?? config.default_language ?? 'en';

  // Log as queued
  const logResult = await db.$client.prepare(`
    INSERT INTO whatsapp_messages (tenant_id, recipient_phone, recipient_name, patient_id, appointment_id, template_name, message_type, message_body, status)
    VALUES (?,?,?,?,?,?,'template',?,?)
  `).bind(tenantId, formattedPhone, d.recipient_name ?? null, d.patient_id ?? null, d.appointment_id ?? null, d.template_name, d.parameters.join(', '), 'queued').run();
  const msgId = logResult.meta.last_row_id;

  // Send via WhatsApp Cloud API
  const result = await sendWhatsAppMessage(config.phone_number_id, config.access_token_encrypted, formattedPhone, d.template_name, lang, d.parameters);

  if (result.success) {
    await db.$client.prepare("UPDATE whatsapp_messages SET status = 'sent', wa_message_id = ?, sent_at = datetime('now', '+6 hours') WHERE id = ?").bind(result.messageId, msgId).run();
    return c.json({ message: 'WhatsApp sent', wa_message_id: result.messageId });
  } else {
    await db.$client.prepare("UPDATE whatsapp_messages SET status = 'failed', error_message = ? WHERE id = ?").bind(result.error, msgId).run();
    return c.json({ message: 'Failed to send', error: result.error }, 500);
  }
});

// POST /send-appointment-reminder — Convenience: send reminder for an appointment
wa.post('/send-appointment-reminder', zValidator('json', z.object({
  appointment_id: z.number().int().positive(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { appointment_id } = c.req.valid('json');
  const db = getDb(c.env.DB);

  // Get appointment + patient details
  const appt = await db.$client.prepare(`
    SELECT a.id, a.appointment_date, a.time_slot, a.status,
           p.id as patient_id, p.name as patient_name, p.mobile as patient_phone,
           d.name as doctor_name
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id
    LEFT JOIN doctors d ON a.doctor_id = d.id
    WHERE a.id = ? AND a.tenant_id = ?
  `).bind(appointment_id, tenantId).first<Record<string, unknown>>();

  if (!appt) throw new HTTPException(404, { message: 'Appointment not found' });
  if (!appt.patient_phone) throw new HTTPException(400, { message: 'Patient has no phone number' });

  // Get config
  const config = await db.$client.prepare('SELECT * FROM whatsapp_config WHERE tenant_id = ? AND is_active = 1').bind(tenantId).first<{ phone_number_id: string; access_token_encrypted: string; default_template_name: string; default_language: string }>();
  if (!config) throw new HTTPException(400, { message: 'WhatsApp not configured' });

  const templateName = config.default_template_name || 'appointment_reminder';
  const parameters = [
    String(appt.patient_name ?? 'Patient'),
    String(appt.appointment_date ?? ''),
    String(appt.time_slot ?? ''),
    String(appt.doctor_name ?? 'Doctor'),
  ];

  const formattedPhone = formatPhone(String(appt.patient_phone));

  // Log
  const logResult = await db.$client.prepare(`
    INSERT INTO whatsapp_messages (tenant_id, recipient_phone, recipient_name, patient_id, appointment_id, template_name, message_type, message_body, status)
    VALUES (?,?,?,?,?,?,'template',?,?)
  `).bind(tenantId, formattedPhone, appt.patient_name, appt.patient_id, appointment_id, templateName, parameters.join(' | '), 'queued').run();
  const msgId = logResult.meta.last_row_id;

  // Send
  const result = await sendWhatsAppMessage(config.phone_number_id, config.access_token_encrypted, formattedPhone, templateName, config.default_language, parameters);

  if (result.success) {
    await db.$client.prepare("UPDATE whatsapp_messages SET status = 'sent', wa_message_id = ?, sent_at = datetime('now', '+6 hours') WHERE id = ?").bind(result.messageId, msgId).run();
    return c.json({ message: `Reminder sent to ${appt.patient_name}`, wa_message_id: result.messageId });
  } else {
    await db.$client.prepare("UPDATE whatsapp_messages SET status = 'failed', error_message = ? WHERE id = ?").bind(result.error, msgId).run();
    return c.json({ message: 'Failed', error: result.error }, 500);
  }
});

// POST /send-bulk — Send reminders for all upcoming appointments
wa.post('/send-bulk', zValidator('json', z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  days_before: z.number().int().min(0).max(7).default(1),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { date } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const config = await db.$client.prepare('SELECT * FROM whatsapp_config WHERE tenant_id = ? AND is_active = 1').bind(tenantId).first<{ phone_number_id: string; access_token_encrypted: string; default_template_name: string; default_language: string }>();
  if (!config) throw new HTTPException(400, { message: 'WhatsApp not configured' });

  // Get appointments for the target date
  const { results: appointments } = await db.$client.prepare(`
    SELECT a.id, a.appointment_date, a.time_slot,
           p.id as patient_id, p.name as patient_name, p.mobile as patient_phone,
           d.name as doctor_name
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id
    LEFT JOIN doctors d ON a.doctor_id = d.id
    WHERE a.tenant_id = ? AND a.appointment_date = ? AND a.status = 'scheduled'
      AND p.mobile IS NOT NULL AND p.mobile != ''
  `).bind(tenantId, date).all<Record<string, unknown>>();

  if (!appointments || appointments.length === 0) {
    return c.json({ message: 'No appointments found for this date', sent: 0, failed: 0 });
  }

  let sent = 0, failed = 0;
  const templateName = config.default_template_name || 'appointment_reminder';

  for (const appt of appointments) {
    const phone = formatPhone(String(appt.patient_phone));
    const params = [String(appt.patient_name), String(appt.appointment_date), String(appt.time_slot ?? ''), String(appt.doctor_name ?? 'Doctor')];

    const logResult = await db.$client.prepare(`
      INSERT INTO whatsapp_messages (tenant_id, recipient_phone, recipient_name, patient_id, appointment_id, template_name, message_type, message_body, status)
      VALUES (?,?,?,?,?,?,'template',?,'queued')
    `).bind(tenantId, phone, appt.patient_name, appt.patient_id, appt.id, templateName, params.join(' | ')).run();

    const result = await sendWhatsAppMessage(config.phone_number_id, config.access_token_encrypted, phone, templateName, config.default_language, params);

    if (result.success) {
      await db.$client.prepare("UPDATE whatsapp_messages SET status = 'sent', wa_message_id = ?, sent_at = datetime('now', '+6 hours') WHERE id = ?").bind(result.messageId, logResult.meta.last_row_id).run();
      sent++;
    } else {
      await db.$client.prepare("UPDATE whatsapp_messages SET status = 'failed', error_message = ? WHERE id = ?").bind(result.error, logResult.meta.last_row_id).run();
      failed++;
    }
  }

  return c.json({ message: `Bulk reminders: ${sent} sent, ${failed} failed`, sent, failed });
});

// ─── Message Log ─────────────────────────────────────────────────────────────

wa.get('/messages', zValidator('query', z.object({
  status: z.string().optional(), patient_id: z.coerce.number().optional(),
  from: z.string().optional(), to: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { status, patient_id, from, to, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  const conds: string[] = ['tenant_id = ?']; const params: (string | number)[] = [tenantId];
  if (status) { conds.push('status = ?'); params.push(status); }
  if (patient_id) { conds.push('patient_id = ?'); params.push(patient_id); }
  if (from) { conds.push('date(created_at) >= ?'); params.push(from); }
  if (to) { conds.push('date(created_at) <= ?'); params.push(to); }
  const where = conds.join(' AND ');

  const total = await db.$client.prepare(`SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE ${where}`).bind(...params).first<{ cnt: number }>();
  const { results } = await db.$client.prepare(`SELECT * FROM whatsapp_messages WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();

  return c.json({ data: results ?? [], pagination: { page, limit, total: total?.cnt ?? 0 } });
});

// ─── Webhook (for delivery status updates from WhatsApp) ─────────────────────

wa.post('/webhook', async (c) => {
  const db = getDb(c.env.DB);
  const body = await c.req.json<Record<string, unknown>>();

  // WhatsApp webhook payload structure
  const entries = (body.entry as Array<Record<string, unknown>>) ?? [];
  for (const entry of entries) {
    const changes = (entry.changes as Array<Record<string, unknown>>) ?? [];
    for (const change of changes) {
      const value = change.value as Record<string, unknown>;
      const statuses = (value?.statuses as Array<{ id: string; status: string; timestamp: string }>) ?? [];

      for (const status of statuses) {
        const waId = status.id;
        const now = new Date(Number(status.timestamp) * 1000).toISOString();

        if (status.status === 'delivered') {
          await db.$client.prepare("UPDATE whatsapp_messages SET status = 'delivered', delivered_at = ? WHERE wa_message_id = ?").bind(now, waId).run();
        } else if (status.status === 'read') {
          await db.$client.prepare("UPDATE whatsapp_messages SET status = 'read', read_at = ? WHERE wa_message_id = ?").bind(now, waId).run();
        } else if (status.status === 'failed') {
          await db.$client.prepare("UPDATE whatsapp_messages SET status = 'failed' WHERE wa_message_id = ?").bind(waId).run();
        }
      }
    }
  }

  return c.json({ success: true });
});

// Webhook verification (GET for Meta webhook setup)
wa.get('/webhook', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  // For now accept any token — in production, verify against config
  if (mode === 'subscribe' && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return c.json({ error: 'Verification failed' }, 403);
});

export default wa;
