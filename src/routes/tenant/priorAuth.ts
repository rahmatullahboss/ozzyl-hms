import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type PAEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const createPriorAuthSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive(),
  RequestType: z.enum(['medication', 'procedure', 'imaging', 'durable_equipment', 'other']),
  Priority: z.enum(['routine', 'urgent', 'expedited']).default('routine'),
  ServiceCode: z.string().min(1).max(20),
  ServiceDescription: z.string().max(500),
  ServiceDate: z.string().optional(),
  DiagnosisCodes: z.array(z.string()),
  OrderingProviderId: z.number().int().positive(),
  InsuranceId: z.number().int().positive().optional(),
  ClinicalNotes: z.string().max(5000).optional(),
  Items: z.array(z.object({
    ServiceCode: z.string(),
    ServiceDescription: z.string(),
    Quantity: z.number().int().positive().optional(),
    UnitPrice: z.number().positive().optional(),
  })).optional(),
});

const updateStatusSchema = z.object({
  AuthStatus: z.enum(['pending', 'approved', 'denied', 'pending_info', 'cancelled']),
  AuthNumber: z.string().max(50).optional(),
  AuthDate: z.string().optional(),
  AuthStartDate: z.string().optional(),
  AuthEndDate: z.string().optional(),
  AuthQuantity: z.number().int().positive().optional(),
  ApprovedAmount: z.number().positive().optional(),
  DenialCode: z.string().max(20).optional(),
  DenialReason: z.string().max(1000).optional(),
});

const createCommunicationSchema = z.object({
  CommunicationType: z.enum(['phone', 'fax', 'email', 'portal', 'mail']),
  Direction: z.enum(['inbound', 'outbound']),
  ContactName: z.string().max(255).optional(),
  ContactPhone: z.string().max(20).optional(),
  ContactOrganization: z.string().max(255).optional(),
  Subject: z.string().max(500).optional(),
  Notes: z.string().max(2000).optional(),
  FollowupRequired: z.boolean().optional(),
  FollowupDate: z.string().optional(),
});

const createFromTemplateSchema = z.object({
  TemplateId: z.number().int().positive(),
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive(),
  OrderingProviderId: z.number().int().positive(),
  InsuranceId: z.number().int().positive().optional(),
  ClinicalNotes: z.string().max(5000).optional(),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const priorAuthRoutes = new Hono<PAEnv>();

// GET / — list authorizations
priorAuthRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, status, type, limit: lim } = c.req.query();

  let query = `
    SELECT pa.*, p.name as PatientName, d.name as ProviderName
    FROM PriorAuthorization pa
    LEFT JOIN patients p ON pa.PatientId = p.id AND p.tenant_id = pa.tenant_id
    LEFT JOIN doctors d ON pa.OrderingProviderId = d.id AND d.tenant_id = pa.tenant_id
    WHERE pa.tenant_id = ? AND pa.IsActive = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patientId) { query += ' AND pa.PatientId = ?'; params.push(Number(patientId)); }
  if (status) { query += ' AND pa.AuthStatus = ?'; params.push(status); }
  if (type) { query += ' AND pa.RequestType = ?'; params.push(type); }
  query += ' ORDER BY pa.RequestDate DESC';
  if (lim) { query += ' LIMIT ?'; params.push(parseInt(lim)); }

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// GET /templates — list templates
priorAuthRoutes.get('/templates', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { type } = c.req.query();

  let query = 'SELECT * FROM PriorAuthorizationTemplate WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];
  if (type) { query += ' AND RequestType = ?'; params.push(type); }
  query += ' ORDER BY TemplateName';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// GET /:id — single authorization with items + communications
priorAuthRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const auth = await db.$client.prepare(
    'SELECT * FROM PriorAuthorization WHERE tenant_id = ? AND AuthId = ?'
  ).bind(tenantId, id).first();

  if (!auth) throw new HTTPException(404, { message: 'Prior authorization not found' });

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with db.$client.batch() for prior auth details.
  // Why: Promise.all() sends 2 separate HTTP network requests to Cloudflare D1.
  //      db.$client.batch() combines them into a single network round-trip.
  const [itemsResult, communicationsResult] = await db.$client.batch([
    db.$client.prepare('SELECT * FROM PriorAuthorizationItem WHERE tenant_id = ? AND AuthId = ?').bind(tenantId, id),
    db.$client.prepare('SELECT * FROM PriorAuthorizationCommunication WHERE tenant_id = ? AND AuthId = ? ORDER BY CommunicationDate DESC').bind(tenantId, id),
  ]);

  return c.json({ Results: { auth, items: itemsResult?.results || [], communications: communicationsResult?.results || [] } });
});

// POST / — create authorization request
priorAuthRoutes.post('/', zValidator('json', createPriorAuthSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO PriorAuthorization (
      tenant_id, PatientId, EncounterId, RequestDate, RequestType, Priority,
      ServiceCode, ServiceDescription, ServiceDate, DiagnosisCodes,
      OrderingProviderId, InsuranceId, ClinicalNotes, SubmittedById, SubmittedDate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId, now,
    data.RequestType, data.Priority,
    data.ServiceCode, data.ServiceDescription, data.ServiceDate ?? null,
    JSON.stringify(data.DiagnosisCodes),
    data.OrderingProviderId, data.InsuranceId ?? null,
    data.ClinicalNotes ?? null, userId, now,
  ).run();

  const authId = result.meta.last_row_id;

  if (data.Items?.length) {
    for (let i = 0; i < data.Items.length; i++) {
      const item = data.Items[i];
      await db.$client.prepare(`
        INSERT INTO PriorAuthorizationItem (tenant_id, AuthId, ItemSequence, ServiceCode, ServiceDescription, Quantity, UnitPrice)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(tenantId, authId, i + 1, item.ServiceCode, item.ServiceDescription, item.Quantity ?? 1, item.UnitPrice ?? 0).run();
    }
  }

  return c.json({ Results: { id: authId } }, 201);
});

// PUT /:id/status — update authorization status
priorAuthRoutes.put('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT AuthId FROM PriorAuthorization WHERE tenant_id = ? AND AuthId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Prior authorization not found' });

  const updates = ['AuthStatus = ?', 'ReviewedById = ?', 'ReviewedDate = ?', 'UpdatedAt = CURRENT_TIMESTAMP'];
  const params: (string | number | null)[] = [data.AuthStatus, userId, new Date().toISOString()];

  if (data.AuthNumber) { updates.push('AuthNumber = ?'); params.push(data.AuthNumber); }
  if (data.AuthDate) { updates.push('AuthDate = ?'); params.push(data.AuthDate); }
  if (data.AuthStartDate) { updates.push('AuthStartDate = ?'); params.push(data.AuthStartDate); }
  if (data.AuthEndDate) { updates.push('AuthEndDate = ?'); params.push(data.AuthEndDate); }
  if (data.AuthQuantity) { updates.push('AuthQuantity = ?'); params.push(data.AuthQuantity); }
  if (data.ApprovedAmount !== undefined) { updates.push('ApprovedAmount = ?'); params.push(data.ApprovedAmount); }
  if (data.DenialCode) { updates.push('DenialCode = ?'); params.push(data.DenialCode); }
  if (data.DenialReason) { updates.push('DenialReason = ?'); params.push(data.DenialReason); }

  params.push(tenantId, id);
  await db.$client.prepare(`UPDATE PriorAuthorization SET ${updates.join(', ')} WHERE tenant_id = ? AND AuthId = ?`).bind(...params).run();

  return c.json({ Results: { success: true } });
});

// DELETE /:id — soft delete
priorAuthRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT AuthId FROM PriorAuthorization WHERE tenant_id = ? AND AuthId = ?'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Prior authorization not found' });

  await db.$client.prepare(
    "UPDATE PriorAuthorization SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND AuthId = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// POST /:id/communication — add communication log
priorAuthRoutes.post('/:id/communication', zValidator('json', createCommunicationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const authId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT AuthId FROM PriorAuthorization WHERE tenant_id = ? AND AuthId = ? AND IsActive = 1'
  ).bind(tenantId, authId).first();
  if (!existing) throw new HTTPException(404, { message: 'Prior authorization not found' });

  const result = await db.$client.prepare(`
    INSERT INTO PriorAuthorizationCommunication (
      tenant_id, AuthId, CommunicationType, CommunicationDate, Direction,
      ContactName, ContactPhone, ContactOrganization, Subject, Notes,
      FollowupRequired, FollowupDate, CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, authId, data.CommunicationType, new Date().toISOString(), data.Direction,
    data.ContactName ?? null, data.ContactPhone ?? null, data.ContactOrganization ?? null,
    data.Subject ?? null, data.Notes ?? null,
    data.FollowupRequired ? 1 : 0, data.FollowupDate ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// POST /from-template — create from template
priorAuthRoutes.post('/from-template', zValidator('json', createFromTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const template = await db.$client.prepare(
    'SELECT * FROM PriorAuthorizationTemplate WHERE tenant_id = ? AND TemplateId = ? AND IsActive = 1'
  ).bind(tenantId, data.TemplateId).first<Record<string, unknown>>();

  if (!template) throw new HTTPException(404, { message: 'Template not found' });

  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO PriorAuthorization (
      tenant_id, PatientId, EncounterId, RequestDate, RequestType, Priority,
      ServiceCode, ServiceDescription, OrderingProviderId, InsuranceId,
      ClinicalNotes, SubmittedById, SubmittedDate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId, now,
    String(template.RequestType), String(template.DefaultPriority ?? 'routine'),
    String(template.ServiceCode ?? ''), String(template.ServiceDescription ?? ''),
    data.OrderingProviderId, data.InsuranceId ?? null,
    data.ClinicalNotes ?? null, userId, now,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

export default priorAuthRoutes;
