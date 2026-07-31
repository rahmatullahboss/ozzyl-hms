import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

function escapeHtml(unsafe: unknown): string {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const printTemplates = new Hono<{ Bindings: Env; Variables: Variables }>();

const TEMPLATE_TYPES = ['prescription','bill','lab_report','discharge','patient_card','birth_certificate','death_certificate','appointment_slip','admission_card','referral_letter'] as const;
const PAPER_SIZES = ['a4','a5','letter','legal','thermal_80mm','thermal_58mm','custom'] as const;

// ─── List templates ──────────────────────────────────────────────────────────

printTemplates.get('/', zValidator('query', z.object({
  type: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { type } = c.req.valid('query');
  const db = getDb(c.env.DB);

  let query = 'SELECT * FROM print_templates WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (type) { query += ' AND template_type = ?'; params.push(type); }
  query += ' ORDER BY is_default DESC, template_name';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ data: results ?? [] });
});

// ─── Get default template for a type ─────────────────────────────────────────

printTemplates.get('/default/:type', async (c) => {
  const tenantId = requireTenantId(c);
  const type = c.req.param('type');
  const db = getDb(c.env.DB);

  // Try default first, then any active
  let tpl = await db.$client.prepare(
    'SELECT * FROM print_templates WHERE tenant_id = ? AND template_type = ? AND is_default = 1 AND is_active = 1'
  ).bind(tenantId, type).first();

  if (!tpl) {
    tpl = await db.$client.prepare(
      'SELECT * FROM print_templates WHERE tenant_id = ? AND template_type = ? AND is_active = 1 LIMIT 1'
    ).bind(tenantId, type).first();
  }

  // Return system default if no custom template
  if (!tpl) {
    return c.json({ data: getSystemDefault(type), is_system_default: true });
  }

  return c.json({ data: tpl, is_system_default: false });
});

// ─── Get single template ─────────────────────────────────────────────────────

printTemplates.get('/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const db = getDb(c.env.DB);
  const tpl = await db.$client.prepare('SELECT * FROM print_templates WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!tpl) throw new HTTPException(404, { message: 'Template not found' });
  return c.json({ data: tpl });
});

// ─── Create template ─────────────────────────────────────────────────────────

printTemplates.post('/', zValidator('json', z.object({
  template_type: z.enum(TEMPLATE_TYPES),
  template_name: z.string().min(1),
  hospital_name: z.string().optional(),
  hospital_name_bn: z.string().optional(),
  hospital_address: z.string().optional(),
  hospital_phone: z.string().optional(),
  hospital_email: z.string().optional(),
  hospital_website: z.string().optional(),
  logo_url: z.string().optional(),
  header_html: z.string().optional(),
  paper_size: z.enum(PAPER_SIZES).default('a4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margin_top_mm: z.number().int().min(0).default(10),
  margin_bottom_mm: z.number().int().min(0).default(10),
  margin_left_mm: z.number().int().min(0).default(10),
  margin_right_mm: z.number().int().min(0).default(10),
  body_html: z.string().optional(),
  footer_html: z.string().optional(),
  css_overrides: z.string().optional(),
  show_logo: z.boolean().default(true),
  show_hospital_name: z.boolean().default(true),
  show_watermark: z.boolean().default(false),
  watermark_text: z.string().optional(),
  font_family: z.string().default('Figtree, Noto Sans Bengali'),
  font_size_px: z.number().int().min(8).max(24).default(12),
  is_default: z.boolean().default(false),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');
  const db = getDb(c.env.DB);

  // If setting as default, unset existing default for this type
  if (d.is_default) {
    await db.$client.prepare('UPDATE print_templates SET is_default = 0 WHERE tenant_id = ? AND template_type = ?').bind(tenantId, d.template_type).run();
  }

  const r = await db.$client.prepare(`
    INSERT INTO print_templates (
      tenant_id, template_type, template_name, hospital_name, hospital_name_bn,
      hospital_address, hospital_phone, hospital_email, hospital_website, logo_url,
      header_html, paper_size, orientation, margin_top_mm, margin_bottom_mm,
      margin_left_mm, margin_right_mm, body_html, footer_html, css_overrides,
      show_logo, show_hospital_name, show_watermark, watermark_text,
      font_family, font_size_px, is_default, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    tenantId, d.template_type, d.template_name, d.hospital_name ?? null, d.hospital_name_bn ?? null,
    d.hospital_address ?? null, d.hospital_phone ?? null, d.hospital_email ?? null, d.hospital_website ?? null, d.logo_url ?? null,
    d.header_html ?? null, d.paper_size, d.orientation, d.margin_top_mm, d.margin_bottom_mm,
    d.margin_left_mm, d.margin_right_mm, d.body_html ?? null, d.footer_html ?? null, d.css_overrides ?? null,
    d.show_logo ? 1 : 0, d.show_hospital_name ? 1 : 0, d.show_watermark ? 1 : 0, d.watermark_text ?? null,
    d.font_family, d.font_size_px, d.is_default ? 1 : 0, userId,
  ).run();

  return c.json({ message: 'Template created', id: r.meta.last_row_id }, 201);
});

// ─── Update template ─────────────────────────────────────────────────────────

printTemplates.put('/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();
  const db = getDb(c.env.DB);

  const existing = await db.$client.prepare('SELECT id, template_type FROM print_templates WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<{ id: number; template_type: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Template not found' });

  // If setting as default, unset others
  if (body.is_default) {
    await db.$client.prepare('UPDATE print_templates SET is_default = 0 WHERE tenant_id = ? AND template_type = ?').bind(tenantId, existing.template_type).run();
  }

  const allowed = ['template_name','hospital_name','hospital_name_bn','hospital_address','hospital_phone','hospital_email','hospital_website','logo_url','header_html','paper_size','orientation','margin_top_mm','margin_bottom_mm','margin_left_mm','margin_right_mm','body_html','footer_html','css_overrides','show_logo','show_hospital_name','show_watermark','watermark_text','font_family','font_size_px','is_default'];
  const updates: string[] = ['updated_at = datetime(\'now\')']; const params: unknown[] = [];
  for (const k of allowed) {
    if (body[k] !== undefined) {
      const val = typeof body[k] === 'boolean' ? (body[k] ? 1 : 0) : body[k];
      updates.push(`${k} = ?`); params.push(val);
    }
  }
  params.push(id, tenantId);

  await db.$client.prepare(`UPDATE print_templates SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  return c.json({ message: 'Template updated' });
});

// ─── Delete (soft) ───────────────────────────────────────────────────────────

printTemplates.delete('/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const r = await getDb(c.env.DB).$client.prepare('UPDATE print_templates SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!r.meta.changes) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ message: 'Template deleted' });
});

// ─── Preview: Render template with sample data ───────────────────────────────

printTemplates.get('/:id/preview', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const db = getDb(c.env.DB);

  const tpl = await db.$client.prepare('SELECT * FROM print_templates WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Record<string, unknown>>();
  if (!tpl) throw new HTTPException(404, { message: 'Template not found' });

  const html = renderTemplate(tpl, getSampleData(String(tpl.template_type)));
  return c.html(html);
});

// ─── Render endpoint: use template to render actual data ─────────────────────

printTemplates.post('/render', zValidator('json', z.object({
  template_type: z.enum(TEMPLATE_TYPES),
  template_id: z.number().int().positive().optional(),
  data: z.record(z.unknown()),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { template_type, template_id, data } = c.req.valid('json');
  const db = getDb(c.env.DB);

  let tpl: Record<string, unknown> | null;
  if (template_id) {
    tpl = await db.$client.prepare('SELECT * FROM print_templates WHERE id = ? AND tenant_id = ?').bind(template_id, tenantId).first();
  } else {
    tpl = await db.$client.prepare('SELECT * FROM print_templates WHERE tenant_id = ? AND template_type = ? AND is_default = 1 AND is_active = 1').bind(tenantId, template_type).first();
    if (!tpl) tpl = getSystemDefault(template_type) as Record<string, unknown>;
  }

  if (!tpl) throw new HTTPException(404, { message: 'No template found' });

  const html = renderTemplate(tpl, data);
  return c.html(html);
});

// ─── Helper: Render HTML from template + data ────────────────────────────────

function renderTemplate(tpl: Record<string, unknown>, data: Record<string, unknown>): string {
  const replaceVars = (text: string) => {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(data[key] ?? ''));
  };

  const hospitalName = escapeHtml(tpl.hospital_name ?? data.hospital_name ?? 'Hospital');
  const hospitalNameBn = tpl.hospital_name_bn ? escapeHtml(tpl.hospital_name_bn) : '';
  const logoUrl = escapeHtml(tpl.logo_url ?? '');
  const showLogo = tpl.show_logo;
  const showName = tpl.show_hospital_name;

  const headerHtml = tpl.header_html ? replaceVars(String(tpl.header_html)) : `
    <div style="text-align:center;border-bottom:2px solid #0891b2;padding-bottom:12px;margin-bottom:16px;">
      ${showLogo && logoUrl ? `<img src="${logoUrl}" alt="Logo" style="height:50px;margin-bottom:8px;">` : ''}
      ${showName ? `<h1 style="margin:0;font-size:22px;color:#0891b2;">${hospitalName}</h1>` : ''}
      ${hospitalNameBn ? `<p style="margin:2px 0;font-size:16px;">${hospitalNameBn}</p>` : ''}
      ${tpl.hospital_address ? `<p style="margin:2px 0;font-size:11px;color:#666;">${escapeHtml(tpl.hospital_address)}</p>` : ''}
      ${tpl.hospital_phone ? `<p style="margin:2px 0;font-size:11px;color:#666;">Phone: ${escapeHtml(tpl.hospital_phone)}${tpl.hospital_email ? ` | Email: ${escapeHtml(tpl.hospital_email)}` : ''}</p>` : ''}
    </div>
  `;

  // For bodyHtml and footerHtml, we assume they contain actual HTML formatting templates.
  // We use replaceVars to escape any dynamic values within the template HTML,
  // but we do not escape the template's own HTML tags.
  const bodyHtml = tpl.body_html ? replaceVars(String(tpl.body_html)) : `<div>${escapeHtml(JSON.stringify(data, null, 2))}</div>`;
  const footerHtml = tpl.footer_html ? replaceVars(String(tpl.footer_html)) : '<div style="text-align:center;font-size:10px;color:#999;border-top:1px solid #ddd;padding-top:8px;margin-top:20px;">Powered by Ozzyl Health</div>';
  const watermark = tpl.show_watermark && tpl.watermark_text ? `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-45deg);font-size:80px;color:rgba(0,0,0,0.04);pointer-events:none;z-index:-1;">${escapeHtml(tpl.watermark_text)}</div>` : '';

  const margins = `${tpl.margin_top_mm ?? 10}mm ${tpl.margin_right_mm ?? 10}mm ${tpl.margin_bottom_mm ?? 10}mm ${tpl.margin_left_mm ?? 10}mm`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: ${tpl.paper_size === 'a5' ? 'A5' : tpl.paper_size === 'letter' ? 'letter' : 'A4'} ${tpl.orientation ?? 'portrait'}; margin: ${margins}; }
  * { box-sizing: border-box; }
  body { font-family: ${tpl.font_family ?? 'Figtree, Noto Sans Bengali'}; font-size: ${tpl.font_size_px ?? 12}px; color: #1a1a1a; margin: 0; padding: 20px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border: 1px solid #ddd; text-align: left; font-size: 11px; }
  th { background: #f5f5f5; font-weight: 600; }
  @media print { body { padding: 0; } }
  ${tpl.css_overrides ?? ''}
</style>
</head><body>
${watermark}${headerHtml}${bodyHtml}${footerHtml}
<script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
</body></html>`;
}

// ─── System defaults ─────────────────────────────────────────────────────────

function getSystemDefault(type: string): Record<string, unknown> {
  return {
    template_type: type,
    template_name: `System Default (${type})`,
    hospital_name: 'Hospital Name',
    paper_size: 'a5',
    orientation: 'portrait',
    margin_top_mm: 10, margin_bottom_mm: 10, margin_left_mm: 10, margin_right_mm: 10,
    show_logo: 1, show_hospital_name: 1, show_watermark: 0,
    font_family: 'Figtree, Noto Sans Bengali', font_size_px: 12,
    is_default: 1,
  };
}

function getSampleData(type: string): Record<string, unknown> {
  const base = { hospital_name: 'Ozzyl General Hospital', date: '2025-04-07' };
  if (type === 'prescription') return { ...base, patient_name: 'Rahim Uddin', patient_code: 'P001', age: '45y', gender: 'Male', doctor_name: 'Dr. Ahmed', rx_no: 'RX-0001', medications: 'Sample medication list' };
  if (type === 'bill') return { ...base, patient_name: 'Rahim Uddin', invoice_no: 'INV-001', total: '৳5,000', paid: '৳3,000', due: '৳2,000' };
  if (type === 'lab_report') return { ...base, patient_name: 'Rahim Uddin', test_name: 'CBC', result: 'Normal', reference: '4.5-5.5' };
  return base;
}

export default printTemplates;
