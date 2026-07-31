import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type FSEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const createTransactionSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  VisitDate: z.string(),
  ProviderId: z.number().int().positive(),
  PlaceOfService: z.string().max(10).default('11'),
  VisitType: z.string().max(50).optional(),
  DiagnosisCodes: z.array(z.string()).optional(),
  PrimaryDiagnosis: z.string().optional(),
  LineItems: z.array(z.object({
    ServiceCode: z.string().min(1),
    ServiceName: z.string().min(1),
    ServiceModifier1: z.string().optional(),
    ServiceModifier2: z.string().optional(),
    Units: z.number().positive().default(1),
    UnitPrice: z.number().min(0),
    DiagnosisPointers: z.string().optional(),
  })).min(1),
});

const updateStatusSchema = z.object({
  BillingStatus: z.enum(['pending', 'billed', 'paid', 'adjusted', 'cancelled']),
  BillingDate: z.string().optional(),
});

const createBillingCodeSchema = z.object({
  Code: z.string().min(1).max(20),
  CodeType: z.enum(['CPT', 'HCPCS', 'ICD10']),
  Description: z.string().min(1).max(500),
  DefaultFee: z.number().min(0).optional(),
  Category: z.string().max(100).optional(),
});

const createContraceptionSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  ProductId: z.number().int().positive(),
  AdministrationDate: z.string(),
  LotNumber: z.string().optional(),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const feeSheetRoutes = new Hono<FSEnv>();

// GET / — list fee sheet transactions
feeSheetRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, status, startDate, endDate, limit: lim } = c.req.query();

  let query = 'SELECT * FROM FeeSheetTransaction WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (patientId) { query += ' AND PatientId = ?'; params.push(Number(patientId)); }
  if (status) { query += ' AND BillingStatus = ?'; params.push(status); }
  if (startDate) { query += ' AND VisitDate >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND VisitDate <= ?'; params.push(endDate); }
  query += ' ORDER BY VisitDate DESC';
  if (lim) { query += ' LIMIT ?'; params.push(parseInt(lim)); }

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// GET /:id — single transaction with line items
feeSheetRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const transaction = await db.$client.prepare(
    'SELECT * FROM FeeSheetTransaction WHERE tenant_id = ? AND TransactionId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!transaction) throw new HTTPException(404, { message: 'Transaction not found' });

  const { results: lineItems } = await db.$client.prepare(
    'SELECT * FROM FeeSheetLineItem WHERE tenant_id = ? AND TransactionId = ? ORDER BY LineSequence'
  ).bind(tenantId, id).all();

  return c.json({ Results: { ...transaction, lineItems } });
});

// POST / — create fee sheet transaction
feeSheetRoutes.post('/', zValidator('json', createTransactionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const totalCharges = data.LineItems.reduce((sum, item) => sum + (item.UnitPrice * item.Units), 0);

  const result = await db.$client.prepare(`
    INSERT INTO FeeSheetTransaction (
      tenant_id, PatientId, EncounterId, VisitDate, ProviderId,
      PlaceOfService, VisitType, DiagnosisCodes, PrimaryDiagnosis,
      TotalCharges, CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null,
    data.VisitDate, data.ProviderId, data.PlaceOfService,
    data.VisitType ?? null,
    data.DiagnosisCodes ? JSON.stringify(data.DiagnosisCodes) : null,
    data.PrimaryDiagnosis ?? null, totalCharges, userId,
  ).run();

  const txId = result.meta.last_row_id;

  for (let i = 0; i < data.LineItems.length; i++) {
    const item = data.LineItems[i];
    const totalPrice = item.UnitPrice * item.Units;
    await db.$client.prepare(`
      INSERT INTO FeeSheetLineItem (
        tenant_id, TransactionId, LineSequence, ServiceCode, ServiceName,
        ServiceModifier1, ServiceModifier2, Units, UnitPrice, TotalPrice, DiagnosisPointers
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, txId, i + 1, item.ServiceCode, item.ServiceName,
      item.ServiceModifier1 ?? null, item.ServiceModifier2 ?? null,
      item.Units, item.UnitPrice, totalPrice, item.DiagnosisPointers ?? null,
    ).run();
  }

  return c.json({ Results: { id: txId, totalCharges } }, 201);
});

// PUT /:id/status — update billing status
feeSheetRoutes.put('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT TransactionId FROM FeeSheetTransaction WHERE tenant_id = ? AND TransactionId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Transaction not found' });

  const updates = ['BillingStatus = ?', 'UpdatedAt = CURRENT_TIMESTAMP'];
  const params: (string | number | null)[] = [data.BillingStatus];
  if (data.BillingDate) { updates.push('BillingDate = ?'); params.push(data.BillingDate); }
  params.push(tenantId, id);

  await db.$client.prepare(
    `UPDATE FeeSheetTransaction SET ${updates.join(', ')} WHERE tenant_id = ? AND TransactionId = ?`
  ).bind(...params).run();

  return c.json({ Results: { success: true } });
});

// DELETE /:id — soft delete transaction
feeSheetRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT TransactionId FROM FeeSheetTransaction WHERE tenant_id = ? AND TransactionId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Transaction not found' });

  await db.$client.prepare(
    "UPDATE FeeSheetTransaction SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND TransactionId = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ─── Billing Codes ──────────────────────────────────────────────────────────

// GET /codes — list billing codes
feeSheetRoutes.get('/codes/list', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { codeType, category, search } = c.req.query();

  let query = 'SELECT * FROM BillingCodeSet WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (codeType) { query += ' AND CodeType = ?'; params.push(codeType); }
  if (category) { query += ' AND Category = ?'; params.push(category); }
  if (search) { query += ' AND (Code LIKE ? OR Description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY Code';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// POST /codes — create billing code
feeSheetRoutes.post('/codes', zValidator('json', createBillingCodeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT CodeId FROM BillingCodeSet WHERE tenant_id = ? AND Code = ?'
  ).bind(tenantId, data.Code).first();
  if (existing) throw new HTTPException(400, { message: 'Billing code already exists' });

  const result = await db.$client.prepare(`
    INSERT INTO BillingCodeSet (tenant_id, Code, CodeType, Description, DefaultFee, Category)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.Code, data.CodeType, data.Description, data.DefaultFee ?? null, data.Category ?? null).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Contraception ──────────────────────────────────────────────────────────

// GET /contraception/products — list products
feeSheetRoutes.get('/contraception/products', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(
    'SELECT * FROM ContraceptionProduct WHERE tenant_id = ? AND IsActive = 1 ORDER BY ProductName'
  ).bind(tenantId).all();

  return c.json({ Results: results });
});

// POST /contraception/administer — record administration
feeSheetRoutes.post('/contraception/administer', zValidator('json', createContraceptionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO ContraceptionAdministration (
      tenant_id, PatientId, EncounterId, ProductId, AdministrationDate, LotNumber, AdministeredById
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null,
    data.ProductId, data.AdministrationDate, data.LotNumber ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

export default feeSheetRoutes;
