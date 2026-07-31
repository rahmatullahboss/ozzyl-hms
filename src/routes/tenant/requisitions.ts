import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type ReqEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const createRequisitionSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  RecipientType: z.enum(['laboratory', 'radiology', 'pathology', 'external_lab', 'hospital']).default('laboratory'),
  RecipientId: z.number().int().positive().optional(),
  RecipientName: z.string().optional(),
  Priority: z.enum(['routine', 'urgent', 'stat', 'asap']).default('routine'),
  CollectionDate: z.string().optional(),
  ClinicalIndications: z.string().max(2000).optional(),
  ClinicalNotes: z.string().max(5000).optional(),
  DiagnosisCodes: z.array(z.string()).optional(),
  PrimaryDiagnosisCode: z.string().optional(),
  SpecimenType: z.string().optional(),
  SpecimenSource: z.string().optional(),
  SpecimenContainer: z.string().optional(),
  Items: z.array(z.object({
    TestCode: z.string().min(1),
    TestName: z.string().min(1),
    TestType: z.enum(['lab_test', 'radiology', 'procedure', 'panel', 'culture']).default('lab_test'),
    TestCategory: z.string().optional(),
    SpecimenType: z.string().optional(),
    ContainerType: z.string().optional(),
    DiagnosisCodes: z.array(z.string()).optional(),
    OrderComments: z.string().optional(),
  })).min(1),
});

const updateStatusSchema = z.object({
  Status: z.enum([
    'draft', 'pending', 'sample-collected', 'in-transit',
    'received-by-lab', 'in-progress', 'preliminary',
    'completed', 'verified', 'cancelled', 'rejected',
  ]),
  CancelReason: z.string().max(500).optional(),
});

const createRecipientSchema = z.object({
  RecipientCode: z.string().max(20).optional(),
  RecipientType: z.enum(['laboratory', 'radiology', 'pathology', 'reference_lab', 'hospital', 'clinic']),
  RecipientName: z.string().min(1).max(200),
  ContactPerson: z.string().optional(),
  Phone: z.string().optional(),
  Fax: z.string().optional(),
  Email: z.string().email().optional(),
  AddressLine1: z.string().optional(),
  City: z.string().optional(),
  State: z.string().optional(),
  ZipCode: z.string().optional(),
  TransmissionMethod: z.enum(['electronic', 'fax', 'print', 'email', 'hand-delivered']).default('electronic'),
  TurnaroundTimeHours: z.number().int().positive().optional(),
  IsDefault: z.boolean().default(false),
});

const specimenSchema = z.object({
  RequisitionItemId: z.number().int().positive().optional(),
  SpecimenCode: z.string().min(1).max(50),
  SpecimenType: z.string().min(1),
  CollectionDate: z.string(),
  CollectionTime: z.string().optional(),
  CollectorName: z.string().optional(),
  Volume: z.string().optional(),
  Quality: z.string().optional(),
  ContainerType: z.string().optional(),
  TransportCondition: z.string().optional(),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const requisitionRoutes = new Hono<ReqEnv>();

// GET / — list requisitions
requisitionRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, status, priority, fromDate, toDate, limit: lim, offset: off } = c.req.query();

  let query = 'SELECT * FROM Requisition WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (patientId) { query += ' AND PatientId = ?'; params.push(Number(patientId)); }
  if (status) { query += ' AND Status = ?'; params.push(status); }
  if (priority) { query += ' AND Priority = ?'; params.push(priority); }
  if (fromDate) { query += ' AND OrderDate >= ?'; params.push(fromDate); }
  if (toDate) { query += ' AND OrderDate <= ?'; params.push(toDate); }

  query += ' ORDER BY OrderDate DESC';
  const limit = parseInt(lim || '50');
  const offset = parseInt(off || '0');
  query += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// GET /:id — single requisition with items and specimens
requisitionRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const requisition = await db.$client.prepare(
    'SELECT * FROM Requisition WHERE tenant_id = ? AND RequisitionId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!requisition) throw new HTTPException(404, { message: 'Requisition not found' });

  // Replaced Promise.all() with db.$client.batch() for requisition fetching.
  // Why: Promise.all() sends 2 separate HTTP network requests to Cloudflare D1.
  const results = await db.$client.batch([
    db.$client.prepare(
      'SELECT * FROM RequisitionItem WHERE tenant_id = ? AND RequisitionId = ? ORDER BY ItemSequence'
    ).bind(tenantId, id),
    db.$client.prepare(
      'SELECT * FROM RequisitionSpecimen WHERE tenant_id = ? AND RequisitionId = ? ORDER BY CollectionDate DESC'
    ).bind(tenantId, id),
  ]);

  const items = results[0]?.results || [];
  const specimens = results[1]?.results || [];

  return c.json({ Results: { ...requisition, items, specimens } });
});

// POST / — create requisition
requisitionRoutes.post('/', zValidator('json', createRequisitionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Generate requisition number
  const year = new Date().getFullYear();
  const countResult = await db.$client.prepare(
    "SELECT COUNT(*) as count FROM Requisition WHERE tenant_id = ? AND RequisitionNumber LIKE ?"
  ).bind(tenantId, `REQ-${year}-%`).first<{ count: number }>();
  const seq = (countResult?.count || 0) + 1;
  const requisitionNumber = `REQ-${year}-${String(seq).padStart(5, '0')}`;

  const result = await db.$client.prepare(`
    INSERT INTO Requisition (
      tenant_id, RequisitionNumber, PatientId, EncounterId,
      OrderedById, RecipientType, RecipientId, RecipientName,
      Priority, CollectionDate, ClinicalIndications, ClinicalNotes,
      DiagnosisCodes, PrimaryDiagnosisCode,
      SpecimenType, SpecimenSource, SpecimenContainer,
      CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, requisitionNumber, data.PatientId, data.EncounterId ?? null,
    userId, data.RecipientType, data.RecipientId ?? null, data.RecipientName ?? null,
    data.Priority, data.CollectionDate ?? null,
    data.ClinicalIndications ?? null, data.ClinicalNotes ?? null,
    data.DiagnosisCodes ? JSON.stringify(data.DiagnosisCodes) : null,
    data.PrimaryDiagnosisCode ?? null,
    data.SpecimenType ?? null, data.SpecimenSource ?? null, data.SpecimenContainer ?? null,
    userId,
  ).run();

  const reqId = result.meta.last_row_id;

  for (let i = 0; i < data.Items.length; i++) {
    const item = data.Items[i];
    await db.$client.prepare(`
      INSERT INTO RequisitionItem (
        tenant_id, RequisitionId, ItemSequence, TestCode, TestName,
        TestType, TestCategory, SpecimenType, ContainerType,
        DiagnosisCodes, OrderComments, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, reqId, i + 1, item.TestCode, item.TestName,
      item.TestType, item.TestCategory ?? null,
      item.SpecimenType ?? null, item.ContainerType ?? null,
      item.DiagnosisCodes ? JSON.stringify(item.DiagnosisCodes) : null,
      item.OrderComments ?? null, userId,
    ).run();
  }

  return c.json({ Results: { id: reqId, requisitionNumber } }, 201);
});

// PUT /:id/status — update requisition status
requisitionRoutes.put('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT RequisitionId FROM Requisition WHERE tenant_id = ? AND RequisitionId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Requisition not found' });

  const updates = ['Status = ?'];
  const params: (string | number | null)[] = [data.Status];

  if (data.Status === 'cancelled') {
    updates.push("CancelledAt = datetime('now', '+6 hours')", 'CancelledById = ?', 'CancelReason = ?');
    params.push(userId, data.CancelReason ?? null);
  }

  params.push(tenantId, id);
  await db.$client.prepare(
    `UPDATE Requisition SET ${updates.join(', ')} WHERE tenant_id = ? AND RequisitionId = ?`
  ).bind(...params).run();

  return c.json({ Results: { success: true } });
});

// POST /:id/specimen — record specimen collection
requisitionRoutes.post('/:id/specimen', zValidator('json', specimenSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const reqId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT RequisitionId FROM Requisition WHERE tenant_id = ? AND RequisitionId = ? AND IsActive = 1'
  ).bind(tenantId, reqId).first();
  if (!existing) throw new HTTPException(404, { message: 'Requisition not found' });

  const result = await db.$client.prepare(`
    INSERT INTO RequisitionSpecimen (
      tenant_id, RequisitionId, RequisitionItemId, SpecimenCode,
      SpecimenType, CollectionDate, CollectionTime, CollectorName,
      Volume, Quality, ContainerType, TransportCondition, ProcessingStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'collected')
  `).bind(
    tenantId, reqId, data.RequisitionItemId ?? null,
    data.SpecimenCode, data.SpecimenType,
    data.CollectionDate, data.CollectionTime ?? null, data.CollectorName ?? null,
    data.Volume ?? null, data.Quality ?? null,
    data.ContainerType ?? null, data.TransportCondition ?? null,
  ).run();

  // Auto-update requisition status to sample-collected
  await db.$client.prepare(
    "UPDATE Requisition SET Status = 'sample-collected' WHERE tenant_id = ? AND RequisitionId = ? AND Status IN ('draft', 'pending')"
  ).bind(tenantId, reqId).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Recipients ─────────────────────────────────────────────────────────────

requisitionRoutes.get('/recipients/list', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { type } = c.req.query();

  let query = 'SELECT * FROM RequisitionRecipient WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];
  if (type) { query += ' AND RecipientType = ?'; params.push(type); }
  query += ' ORDER BY IsDefault DESC, RecipientName';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

requisitionRoutes.post('/recipients', zValidator('json', createRecipientSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO RequisitionRecipient (
      tenant_id, RecipientCode, RecipientType, RecipientName,
      ContactPerson, Phone, Fax, Email,
      AddressLine1, City, State, ZipCode,
      TransmissionMethod, TurnaroundTimeHours, IsDefault, CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.RecipientCode ?? null, data.RecipientType, data.RecipientName,
    data.ContactPerson ?? null, data.Phone ?? null, data.Fax ?? null, data.Email ?? null,
    data.AddressLine1 ?? null, data.City ?? null, data.State ?? null, data.ZipCode ?? null,
    data.TransmissionMethod, data.TurnaroundTimeHours ?? null,
    data.IsDefault ? 1 : 0, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// DELETE /:id — soft delete requisition
requisitionRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT RequisitionId FROM Requisition WHERE tenant_id = ? AND RequisitionId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Requisition not found' });

  await db.$client.prepare(
    "UPDATE Requisition SET IsActive = 0, CancelledAt = datetime('now', '+6 hours'), CancelledById = ? WHERE tenant_id = ? AND RequisitionId = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

export default requisitionRoutes;
