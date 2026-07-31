import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import {
  PROCEDURE_ORDER_CREATE_ROLES,
  PROCEDURE_PUBLISH_ROLES,
  PROCEDURE_RESULT_ROLES,
} from './lab/_permissions';
import { triggerProcedureResultConsumption } from '../../lib/inventory-consumption-clinical-hook';

type ProcEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createOrderSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive(),
  ProviderId: z.number().int().positive(),
  LabId: z.number().int().positive().optional(),
  DateOrdered: z.string(),
  DateCollected: z.string().optional(),
  OrderPriority: z.enum(['routine', 'stat', 'urgent', 'asap']).default('routine'),
  SpecimenType: z.string().optional(),
  SpecimenLocation: z.string().optional(),
  SpecimenFasting: z.enum(['fasting', 'non-fasting', 'npo']).optional(),
  PatientInstructions: z.string().optional(),
  ClinicalHx: z.string().optional(),
  OrderDiagnosis: z.string().optional(),
  ProcedureOrderType: z.enum(['laboratory_test', 'radiology', 'cardiology', 'referral', 'other']).default('laboratory_test'),
  ProcedureCodes: z.array(z.object({
    ProcedureCode: z.string(),
    ProcedureName: z.string(),
    Diagnoses: z.string().optional(),
    ProcedureType: z.string().optional(),
  })).optional(),
});

const updateOrderSchema = z.object({
  DateOrdered: z.string().optional(),
  DateCollected: z.string().optional(),
  OrderPriority: z.enum(['routine', 'stat', 'urgent', 'asap']).optional(),
  OrderStatus: z.enum(['pending', 'routed', 'complete', 'canceled']).optional(),
  SpecimenType: z.string().optional(),
  SpecimenLocation: z.string().optional(),
  SpecimenFasting: z.enum(['fasting', 'non-fasting', 'npo']).optional(),
  PatientInstructions: z.string().optional(),
  ClinicalHx: z.string().optional(),
  OrderDiagnosis: z.string().optional(),
  ProcedureOrderType: z.enum(['laboratory_test', 'radiology', 'cardiology', 'referral', 'other']).optional(),
});

const createResultSchema = z.object({
  ProcedureOrderId: z.number().int().positive(),
  ProcedureOrderSeq: z.number().int().positive(),
  ProcedureCode: z.string(),
  ProcedureName: z.string().optional(),
  ResultDate: z.string(),
  ResultValue: z.string(),
  ResultUnits: z.string().optional(),
  ResultRange: z.string().optional(),
  ResultAbnormalFlag: z.enum(['H', 'L', 'HH', 'LL', 'A', 'N']).optional(),
  ResultComments: z.string().optional(),
  ResultSource: z.string().optional(),
  LabId: z.number().int().positive().optional(),
});

const createProviderSchema = z.object({
  ProviderName: z.string(),
  ProviderType: z.enum(['laboratory', 'radiology', 'cardiology', 'other']),
  LabDirector: z.string().optional(),
  Phone: z.string().optional(),
  Fax: z.string().optional(),
  Email: z.string().email().optional(),
  AddressLine1: z.string().optional(),
  City: z.string().optional(),
  State: z.string().optional(),
  ZipCode: z.string().optional(),
  NpiNumber: z.string().optional(),
  CliaNumber: z.string().optional(),
  LabType: z.enum(['local', 'reference', 'hospital']).default('local'),
  TransmissionMethod: z.string().optional(),
  AccountNumber: z.string().optional(),
});

// ─── Router ──────────────────────────────────────────────────────────────────

const procedureOrderRoutes = new Hono<ProcEnv>();

// GET / — list procedure orders
procedureOrderRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, status, from, to, limit: lim } = c.req.query();

  let query = `
    SELECT po.*
    FROM ProcedureOrder po
    WHERE po.tenant_id = ? AND po.IsActive = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patientId) { query += ' AND po.PatientId = ?'; params.push(Number(patientId)); }
  if (status) { query += ' AND po.OrderStatus = ?'; params.push(status); }
  if (from) { query += ' AND po.DateOrdered >= ?'; params.push(from); }
  if (to) { query += ' AND po.DateOrdered <= ?'; params.push(to); }
  query += ' ORDER BY po.DateOrdered DESC';
  if (lim) { query += ' LIMIT ?'; params.push(Number(lim)); }

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// GET /:id — single order with codes + results
procedureOrderRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const order = await db.$client
    .prepare('SELECT * FROM ProcedureOrder WHERE tenant_id = ? AND ProcedureOrderId = ?')
    .bind(tenantId, id)
    .first();

  if (!order) throw new HTTPException(404, { message: 'Procedure order not found' });

  const [codes, results] = await Promise.all([
    db.$client.prepare('SELECT * FROM ProcedureOrderCode WHERE tenant_id = ? AND ProcedureOrderId = ? ORDER BY ProcedureOrderSeq')
      .bind(tenantId, id).all(),
    db.$client.prepare('SELECT * FROM ProcedureResult WHERE tenant_id = ? AND ProcedureOrderId = ? ORDER BY ResultDate DESC')
      .bind(tenantId, id).all(),
  ]);

  return c.json({ Results: { order, codes: codes.results, results: results.results } });
});

// POST / — create order
procedureOrderRoutes.post('/', requireRole(...PROCEDURE_ORDER_CREATE_ROLES), zValidator('json', createOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // P0-18: tenant-ownership pre-check on patient + provider
  const patient = await db.$client
    .prepare('SELECT id FROM patients WHERE id = ? AND tenant_id = ?')
    .bind(data.PatientId, tenantId).first<{ id: number }>();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });
  const provider = await db.$client
    .prepare('SELECT id FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(data.ProviderId, tenantId).first<{ id: number }>();
  if (!provider) throw new HTTPException(404, { message: 'Provider not found' });

  const result = await db.$client
    .prepare(`
      INSERT INTO ProcedureOrder (
        tenant_id, PatientId, EncounterId, ProviderId, LabId,
        DateOrdered, DateCollected, OrderPriority, SpecimenType,
        SpecimenLocation, SpecimenFasting, PatientInstructions,
        ClinicalHx, OrderDiagnosis, ProcedureOrderType, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId, data.ProviderId,
      data.LabId ?? null, data.DateOrdered, data.DateCollected ?? null,
      data.OrderPriority, data.SpecimenType ?? null,
      data.SpecimenLocation ?? null, data.SpecimenFasting ?? null,
      data.PatientInstructions ?? null, data.ClinicalHx ?? null,
      data.OrderDiagnosis ?? null, data.ProcedureOrderType, userId,
    )
    .run();

  const orderId = result.meta.last_row_id;

  if (data.ProcedureCodes?.length) {
    for (let i = 0; i < data.ProcedureCodes.length; i++) {
      const pc = data.ProcedureCodes[i];
      await db.$client
        .prepare(`
          INSERT INTO ProcedureOrderCode (
            ProcedureOrderId, ProcedureOrderSeq, tenant_id,
            ProcedureCode, ProcedureName, Diagnoses, ProcedureType
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(orderId, i + 1, tenantId, pc.ProcedureCode, pc.ProcedureName, pc.Diagnoses ?? null, pc.ProcedureType ?? null)
        .run();
    }
  }

  return c.json({ Results: { id: orderId } }, 201);
});

// PUT /:id — update order
procedureOrderRoutes.put('/:id', requireRole(...PROCEDURE_ORDER_CREATE_ROLES), zValidator('json', updateOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client
    .prepare('SELECT ProcedureOrderId FROM ProcedureOrder WHERE tenant_id = ? AND ProcedureOrderId = ? AND IsActive = 1')
    .bind(tenantId, id)
    .first();
  if (!existing) throw new HTTPException(404, { message: 'Procedure order not found' });

  const data = c.req.valid('json');
  const entries = Object.entries(data).filter(([_, v]) => v !== undefined);
  if (entries.length === 0) return c.json({ Results: { id } });

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([_, v]) => v);

  await db.$client
    .prepare(`UPDATE ProcedureOrder SET ${sets}, UpdatedAt = CURRENT_TIMESTAMP WHERE tenant_id = ? AND ProcedureOrderId = ?`)
    .bind(...vals, tenantId, id)
    .run();

  return c.json({ Results: { id } });
});

// DELETE /:id — soft delete
procedureOrderRoutes.delete('/:id', requireRole(...PROCEDURE_PUBLISH_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client
    .prepare('SELECT ProcedureOrderId FROM ProcedureOrder WHERE tenant_id = ? AND ProcedureOrderId = ?')
    .bind(tenantId, id)
    .first();
  if (!existing) throw new HTTPException(404, { message: 'Procedure order not found' });

  await db.$client
    .prepare("UPDATE ProcedureOrder SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND ProcedureOrderId = ?")
    .bind(userId, tenantId, id)
    .run();

  return c.json({ Results: { success: true } });
});

// ─── Results ─────────────────────────────────────────────────────────────────

// POST /results — add result
procedureOrderRoutes.post('/results', requireRole(...PROCEDURE_RESULT_ROLES), zValidator('json', createResultSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const order = await db.$client
    .prepare('SELECT PatientId, EncounterId FROM ProcedureOrder WHERE tenant_id = ? AND ProcedureOrderId = ?')
    .bind(tenantId, data.ProcedureOrderId)
    .first<{ PatientId: number; EncounterId: number }>();

  if (!order) throw new HTTPException(404, { message: 'Procedure order not found' });

  const existing = await db.$client
    .prepare('SELECT ProcedureResultId FROM ProcedureResult WHERE tenant_id = ? AND ProcedureOrderId = ? AND ProcedureOrderSeq = ? AND ProcedureCode = ?')
    .bind(tenantId, data.ProcedureOrderId, data.ProcedureOrderSeq, data.ProcedureCode)
    .first();

  if (existing) {
    await db.$client
      .prepare(`
        UPDATE ProcedureResult SET
          ResultValue = ?, ResultUnits = ?, ResultRange = ?,
          ResultAbnormalFlag = ?, ResultComments = ?, ResultSource = ?,
          LabId = ?, UpdatedAt = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND ProcedureResultId = ?
      `)
      .bind(
        data.ResultValue, data.ResultUnits ?? null, data.ResultRange ?? null,
        data.ResultAbnormalFlag ?? null, data.ResultComments ?? null,
        data.ResultSource ?? null, data.LabId ?? null,
        tenantId, (existing as Record<string, unknown>).ProcedureResultId,
      )
      .run();
    return c.json({ Results: { updated: true } });
  }

  const result = await db.$client
    .prepare(`
      INSERT INTO ProcedureResult (
        tenant_id, ProcedureOrderId, ProcedureOrderSeq, PatientId, EncounterId,
        ProcedureCode, ProcedureName, ResultDate, ResultValue, ResultUnits,
        ResultRange, ResultAbnormalFlag, ResultComments, ResultSource, LabId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.ProcedureOrderId, data.ProcedureOrderSeq,
      order.PatientId, order.EncounterId,
      data.ProcedureCode, data.ProcedureName ?? null,
      data.ResultDate, data.ResultValue, data.ResultUnits ?? null,
      data.ResultRange ?? null, data.ResultAbnormalFlag ?? null,
      data.ResultComments ?? null, data.ResultSource ?? null,
      data.LabId ?? null,
    )
    .run();

  void triggerProcedureResultConsumption(c.env.DB, {
    tenantId,
    userId,
    order: { ProcedureOrderId: data.ProcedureOrderId, PatientId: order.PatientId, EncounterId: order.EncounterId },
    result: { ProcedureCode: data.ProcedureCode, ProcedureName: data.ProcedureName ?? null },
  }).catch((error) => {
    console.error('Procedure consumption trigger failed', { tenantId, procedureOrderId: data.ProcedureOrderId, error });
  });

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// GET /patient/:id/results — patient's results
procedureOrderRoutes.get('/patient/:id/results', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('id'));

  const { results } = await db.$client
    .prepare(`
      SELECT pr.*, po.OrderStatus, po.ProcedureOrderType
      FROM ProcedureResult pr
      LEFT JOIN ProcedureOrder po ON pr.ProcedureOrderId = po.ProcedureOrderId AND po.tenant_id = pr.tenant_id
      WHERE pr.tenant_id = ? AND pr.PatientId = ?
      ORDER BY pr.ResultDate DESC LIMIT 100
    `)
    .bind(tenantId, patientId)
    .all();

  return c.json({ Results: results });
});

// ─── Providers (Labs) ────────────────────────────────────────────────────────

// GET /providers — list
procedureOrderRoutes.get('/providers', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { type } = c.req.query();

  let query = 'SELECT * FROM ProcedureProvider WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];
  if (type) { query += ' AND ProviderType = ?'; params.push(type); }
  query += ' ORDER BY ProviderName';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// POST /providers — add
procedureOrderRoutes.post('/providers', requireRole(...PROCEDURE_PUBLISH_ROLES), zValidator('json', createProviderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO ProcedureProvider (
        tenant_id, ProviderName, ProviderType, LabDirector, Phone, Fax, Email,
        AddressLine1, City, State, ZipCode, NpiNumber, CliaNumber,
        LabType, TransmissionMethod, AccountNumber
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.ProviderName, data.ProviderType,
      data.LabDirector ?? null, data.Phone ?? null, data.Fax ?? null,
      data.Email ?? null, data.AddressLine1 ?? null,
      data.City ?? null, data.State ?? null, data.ZipCode ?? null,
      data.NpiNumber ?? null, data.CliaNumber ?? null,
      data.LabType, data.TransmissionMethod ?? null,
      data.AccountNumber ?? null,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

export default procedureOrderRoutes;
