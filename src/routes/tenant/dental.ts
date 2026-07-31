import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type DentalEnv = { Bindings: Env; Variables: Variables };

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

const chartEntrySchema = z.object({
  PatientId: z.number().int().positive(),
  ToothNumber: z.string().min(1).max(3),
  ToothStatus: z.string().max(50).default('present'),
  ToothCondition: z.string().max(100).optional(),
  ConditionStatus: z.enum(['existing', 'planned', 'inprogress', 'completed']).default('existing'),
  ConditionSecondary: z.string().max(100).optional(),
  SurfaceMesial: z.string().max(50).optional(),
  SurfaceDistal: z.string().max(50).optional(),
  SurfaceBuccal: z.string().max(50).optional(),
  SurfaceLingual: z.string().max(50).optional(),
  SurfaceOcclusal: z.string().max(50).optional(),
  ExistingRestoration: z.string().max(200).optional(),
  PocketDepthMesial: z.number().int().optional(),
  PocketDepthDistal: z.number().int().optional(),
  PocketDepthBuccal: z.number().int().optional(),
  PocketDepthLingual: z.number().int().optional(),
  Mobility: z.number().int().min(0).max(3).default(0),
  Furcation: z.number().int().min(0).max(3).default(0),
  Recession: z.number().int().min(0).default(0),
  RootCanalDone: z.boolean().default(false),
  IsImplant: z.boolean().default(false),
  ClinicalNotes: z.string().max(2000).optional(),
});

const treatmentSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  CdtCode: z.string().min(1).max(10),
  ProcedureName: z.string().min(1).max(300),
  ToothNumber: z.string().optional(),
  ToothSurface: z.string().optional(),
  Quadrant: z.number().int().min(1).max(4).optional(),
  AnesthesiaUsed: z.string().optional(),
  Complications: z.string().optional(),
  Narrative: z.string().max(5000).optional(),
  PerformedDate: z.string(),
  Fee: z.number().min(0).optional(),
  LabRequired: z.boolean().default(false),
  LabType: z.string().optional(),
  LabShade: z.string().optional(),
  FollowupRequired: z.boolean().default(false),
  FollowupDate: z.string().optional(),
  FollowupNotes: z.string().optional(),
  IsMultiVisit: z.boolean().default(false),
  VisitNumber: z.number().int().min(1).default(1),
  TotalPlannedVisits: z.number().int().min(1).default(1),
  NextVisitDate: z.string().optional(),
  NextVisitNotes: z.string().optional(),
  ParentTreatmentId: z.number().int().positive().optional(),
});

const treatmentPlanSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  PlanName: z.string().max(200).optional(),
  PlanPhase: z.number().int().positive().default(1),
  Priority: z.enum(['routine', 'urgent', 'emergency']).default('routine'),
  ClinicalNotes: z.string().max(5000).optional(),
  Items: z.array(z.object({
    CdtCode: z.string().optional(),
    ToothNumber: z.string().optional(),
    ToothSurface: z.string().optional(),
    EstimatedFee: z.number().min(0).optional(),
    ActualFee: z.number().min(0).optional(),
    Priority: z.number().int().min(1).max(5).default(2),
    Status: z.enum(['planned', 'inprogress', 'completed', 'cancelled']).default('planned'),
    Notes: z.string().optional(),
  })).optional(),
});

const perioChartSchema = z.object({
  PatientId: z.number().int().positive(),
  ToothNumber: z.string().min(1).max(3),
  PocketDepthMB: z.number().int().optional(), PocketDepthB: z.number().int().optional(), PocketDepthDB: z.number().int().optional(),
  PocketDepthDL: z.number().int().optional(), PocketDepthL: z.number().int().optional(), PocketDepthML: z.number().int().optional(),
  RecessionMB: z.number().int().optional(), RecessionB: z.number().int().optional(), RecessionDB: z.number().int().optional(),
  RecessionDL: z.number().int().optional(), RecessionL: z.number().int().optional(), RecessionML: z.number().int().optional(),
  BleedingMB: z.boolean().default(false), BleedingB: z.boolean().default(false), BleedingDB: z.boolean().default(false),
  BleedingDL: z.boolean().default(false), BleedingL: z.boolean().default(false), BleedingML: z.boolean().default(false),
  Mobility: z.number().int().min(0).max(3).default(0),
  Furcation: z.number().int().min(0).max(3).default(0),
  PlaqueIndex: z.number().int().min(0).max(3).default(0),
  ClinicalNotes: z.string().max(2000).optional(),
});

const xraySchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  XrayType: z.enum(['periapical', 'bitewing', 'panoramic', 'cephalometric', 'occlusal', 'cbct']),
  XraySeries: z.string().optional(),
  TeethImaged: z.string().optional(),
  ImageCount: z.number().int().positive().optional(),
  Reason: z.string().optional(),
  Findings: z.string().max(5000).optional(),
  InterpretationNotes: z.string().max(5000).optional(),
  RadiationDose: z.number().min(0).optional(),
  TakenDate: z.string(),
  FileName: z.string().optional(),
  FileSize: z.number().optional(),
  MimeType: z.string().optional(),
  AnnotationData: z.string().optional(),
});

const prescriptionSchema = z.object({
  PatientId: z.number().int().positive(),
  TreatmentId: z.number().int().positive().optional(),
  EncounterId: z.number().int().positive().optional(),
  DrugName: z.string().min(1).max(200),
  Dosage: z.string().max(100).optional(),
  Frequency: z.string().max(100).optional(),
  Duration: z.string().max(100).optional(),
  Instructions: z.string().max(1000).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

const dentalRoutes = new Hono<DentalEnv>();

// ─── Tooth Master with Notation ──────────────────────────────────────────────

dentalRoutes.get('/teeth', async (c) => {
  const db = getDb(c.env.DB);
  const { type, notation = 'universal' } = c.req.query();

  let query = 'SELECT * FROM DentalToothMaster WHERE IsActive = 1';
  const params: string[] = [];
  if (type) { query += ' AND ToothType = ?'; params.push(type); }
  query += ' ORDER BY DisplayOrder';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results, Notation: notation });
});

// ─── Condition Types (expanded library) ──────────────────────────────────────

dentalRoutes.get('/condition-types', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { category } = c.req.query();

  let query = `SELECT * FROM DentalConditionType 
    WHERE (tenant_id = ? OR tenant_id = '_global_') AND IsActive = 1`;
  const params: (string | number)[] = [tenantId];

  if (category) { query += ' AND Category = ?'; params.push(category); }
  query += ' ORDER BY Category, ConditionName';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// ─── Procedure Codes ─────────────────────────────────────────────────────────

dentalRoutes.get('/procedure-codes', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { category, search } = c.req.query();

  let query = 'SELECT * FROM DentalProcedureCode WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (category) { query += ' AND Category = ?'; params.push(category); }
  if (search) { query += ' AND (CdtCode LIKE ? OR ProcedureName LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY CdtCode';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// ─── Patient Dental Chart (Enhanced with surfaces + status) ──────────────────

dentalRoutes.get('/chart/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));

  const { results } = await db.$client.prepare(`
    SELECT pdc.*, dtm.ToothName, dtm.ToothType, dtm.Arch, dtm.Quadrant,
           dtm.FdiNumber, dtm.PalmerNotation, dtm.UniversalNumber,
           dc.ColorHex as ConditionColor
    FROM PatientDentalChart pdc
    LEFT JOIN DentalToothMaster dtm ON pdc.ToothNumber = dtm.ToothNumber
    LEFT JOIN DentalConditionType dc ON pdc.ToothCondition = dc.ConditionKey AND dc.IsActive = 1
    WHERE pdc.tenant_id = ? AND pdc.PatientId = ?
    ORDER BY dtm.DisplayOrder
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

dentalRoutes.post('/chart', zValidator('json', chartEntrySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT ChartId FROM PatientDentalChart WHERE tenant_id = ? AND PatientId = ? AND ToothNumber = ?'
  ).bind(tenantId, data.PatientId, data.ToothNumber).first();

  if (existing) {
    await db.$client.prepare(`
      UPDATE PatientDentalChart SET
        ToothStatus = ?, ToothCondition = ?, ConditionStatus = ?, ConditionSecondary = ?,
        SurfaceMesial = ?, SurfaceDistal = ?, SurfaceBuccal = ?, SurfaceLingual = ?, SurfaceOcclusal = ?,
        ExistingRestoration = ?,
        PocketDepthMesial = ?, PocketDepthDistal = ?, PocketDepthBuccal = ?, PocketDepthLingual = ?,
        Mobility = ?, Furcation = ?, Recession = ?,
        RootCanalDone = ?, IsImplant = ?, ClinicalNotes = ?,
        ChartedById = ?, UpdatedAt = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND PatientId = ? AND ToothNumber = ?
    `).bind(
      data.ToothStatus, data.ToothCondition ?? null, data.ConditionStatus, data.ConditionSecondary ?? null,
      data.SurfaceMesial ?? null, data.SurfaceDistal ?? null, data.SurfaceBuccal ?? null,
      data.SurfaceLingual ?? null, data.SurfaceOcclusal ?? null,
      data.ExistingRestoration ?? null,
      data.PocketDepthMesial ?? null, data.PocketDepthDistal ?? null,
      data.PocketDepthBuccal ?? null, data.PocketDepthLingual ?? null,
      data.Mobility, data.Furcation, data.Recession,
      data.RootCanalDone ? 1 : 0, data.IsImplant ? 1 : 0, data.ClinicalNotes ?? null,
      userId, tenantId, data.PatientId, data.ToothNumber,
    ).run();

    return c.json({ Results: { success: true, updated: true } });
  }

  const result = await db.$client.prepare(`
    INSERT INTO PatientDentalChart (
      tenant_id, PatientId, ToothNumber, ToothStatus, ToothCondition, ConditionStatus, ConditionSecondary,
      SurfaceMesial, SurfaceDistal, SurfaceBuccal, SurfaceLingual, SurfaceOcclusal,
      ExistingRestoration,
      PocketDepthMesial, PocketDepthDistal, PocketDepthBuccal, PocketDepthLingual,
      Mobility, Furcation, Recession, RootCanalDone, IsImplant, ClinicalNotes, ChartedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.ToothNumber,
    data.ToothStatus, data.ToothCondition ?? null, data.ConditionStatus, data.ConditionSecondary ?? null,
    data.SurfaceMesial ?? null, data.SurfaceDistal ?? null, data.SurfaceBuccal ?? null,
    data.SurfaceLingual ?? null, data.SurfaceOcclusal ?? null,
    data.ExistingRestoration ?? null,
    data.PocketDepthMesial ?? null, data.PocketDepthDistal ?? null,
    data.PocketDepthBuccal ?? null, data.PocketDepthLingual ?? null,
    data.Mobility, data.Furcation, data.Recession,
    data.RootCanalDone ? 1 : 0, data.IsImplant ? 1 : 0, data.ClinicalNotes ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Chart History (audit trail) ─────────────────────────────────────────────

dentalRoutes.get('/chart-history/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  const { tooth } = c.req.query();

  let query = 'SELECT * FROM DentalChartHistory WHERE tenant_id = ? AND PatientId = ?';
  const params: (string | number)[] = [tenantId, patientId];
  if (tooth) { query += ' AND ToothNumber = ?'; params.push(tooth); }
  query += ' ORDER BY ChangedAt DESC LIMIT 100';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// ─── Treatments (with multi-visit support) ───────────────────────────────────

dentalRoutes.get('/treatments/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  const { limit: lim, multivisit } = c.req.query();

  let query = 'SELECT * FROM DentalTreatment WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId, patientId];

  if (multivisit === 'true') { query += ' AND IsMultiVisit = 1'; }
  else if (multivisit === 'false') { query += ' AND IsMultiVisit = 0'; }

  query += ' ORDER BY PerformedDate DESC LIMIT ?';
  params.push(parseInt(lim || '50'));

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

dentalRoutes.get('/treatments/visits/:parentId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const parentId = Number(c.req.param('parentId'));

  const { results } = await db.$client.prepare(`
    SELECT * FROM DentalTreatment
    WHERE tenant_id = ? AND (ParentTreatmentId = ? OR TreatmentId = ?)
    ORDER BY VisitNumber
  `).bind(tenantId, parentId, parentId).all();

  return c.json({ Results: results });
});

dentalRoutes.post('/treatments', zValidator('json', treatmentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO DentalTreatment (
      tenant_id, PatientId, EncounterId, CdtCode, ProcedureName,
      ToothNumber, ToothSurface, Quadrant, AnesthesiaUsed, Complications, Narrative,
      PerformedById, PerformedDate, Fee, Status,
      LabRequired, LabType, LabShade,
      FollowupRequired, FollowupDate, FollowupNotes,
      IsMultiVisit, VisitNumber, TotalPlannedVisits, NextVisitDate, NextVisitNotes, ParentTreatmentId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null,
    data.CdtCode, data.ProcedureName,
    data.ToothNumber ?? null, data.ToothSurface ?? null,
    data.Quadrant ?? null, data.AnesthesiaUsed ?? null,
    data.Complications ?? null, data.Narrative ?? null,
    userId, data.PerformedDate, data.Fee ?? null,
    data.VisitNumber === data.TotalPlannedVisits ? 'completed' : 'inprogress',
    data.LabRequired ? 1 : 0, data.LabType ?? null, data.LabShade ?? null,
    data.FollowupRequired ? 1 : 0, data.FollowupDate ?? null, data.FollowupNotes ?? null,
    data.IsMultiVisit ? 1 : 0, data.VisitNumber, data.TotalPlannedVisits,
    data.NextVisitDate ?? null, data.NextVisitNotes ?? null, data.ParentTreatmentId ?? null,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

dentalRoutes.delete('/treatments/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT TreatmentId FROM DentalTreatment WHERE tenant_id = ? AND TreatmentId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Treatment not found' });

  await db.$client.prepare(
    "UPDATE DentalTreatment SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND TreatmentId = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ─── Treatment Plans ─────────────────────────────────────────────────────────

dentalRoutes.get('/plans/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));

  const { results } = await db.$client.prepare(`
    SELECT * FROM DentalTreatmentPlan
    WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
    ORDER BY CreatedAt DESC
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

dentalRoutes.get('/plans/detail/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const plan = await db.$client.prepare(
    'SELECT * FROM DentalTreatmentPlan WHERE tenant_id = ? AND PlanId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!plan) throw new HTTPException(404, { message: 'Treatment plan not found' });

  const { results: items } = await db.$client.prepare(`
    SELECT dtpi.*, dt.ProcedureName as LinkedProcedureName
    FROM DentalTreatmentPlanItem dtpi
    LEFT JOIN DentalTreatment dt ON dtpi.LinkedTreatmentId = dt.TreatmentId
    WHERE dtpi.tenant_id = ? AND dtpi.PlanId = ?
    ORDER BY dtpi.Priority, dtpi.PlanItemId
  `).bind(tenantId, id).all();

  return c.json({ Results: { ...plan, items } });
});

dentalRoutes.post('/plans', zValidator('json', treatmentPlanSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const estimatedTotal = data.Items?.reduce((sum, item) => sum + (item.EstimatedFee || 0), 0) || 0;

  const result = await db.$client.prepare(`
    INSERT INTO DentalTreatmentPlan (
      tenant_id, PatientId, EncounterId, PlanName, PlanPhase, Priority,
      EstimatedTotal, ClinicalNotes, CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null,
    data.PlanName ?? null, data.PlanPhase, data.Priority,
    estimatedTotal, data.ClinicalNotes ?? null, userId,
  ).run();

  const planId = result.meta.last_row_id;

  if (data.Items?.length) {
    for (const item of data.Items) {
      await db.$client.prepare(`
        INSERT INTO DentalTreatmentPlanItem (
          tenant_id, PlanId, CdtCode, ToothNumber, ToothSurface,
          EstimatedFee, ActualFee, Priority, Status, Notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId, planId, item.CdtCode ?? null, item.ToothNumber ?? null,
        item.ToothSurface ?? null, item.EstimatedFee ?? null, item.ActualFee ?? null,
        item.Priority, item.Status, item.Notes ?? null,
      ).run();
    }
  }

  return c.json({ Results: { id: planId, estimatedTotal } }, 201);
});

// ─── Periodontal Charting ────────────────────────────────────────────────────

dentalRoutes.get('/perio/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));

  const { results } = await db.$client.prepare(`
    SELECT * FROM PeriodontalCharting
    WHERE tenant_id = ? AND PatientId = ?
    ORDER BY ChartedDate DESC
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

dentalRoutes.post('/perio', zValidator('json', perioChartSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO PeriodontalCharting (
      tenant_id, PatientId, ToothNumber,
      PocketDepthMB, PocketDepthB, PocketDepthDB, PocketDepthDL, PocketDepthL, PocketDepthML,
      RecessionMB, RecessionB, RecessionDB, RecessionDL, RecessionL, RecessionML,
      BleedingMB, BleedingB, BleedingDB, BleedingDL, BleedingL, BleedingML,
      Mobility, Furcation, PlaqueIndex, ClinicalNotes, ChartedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.ToothNumber,
    data.PocketDepthMB ?? null, data.PocketDepthB ?? null, data.PocketDepthDB ?? null,
    data.PocketDepthDL ?? null, data.PocketDepthL ?? null, data.PocketDepthML ?? null,
    data.RecessionMB ?? null, data.RecessionB ?? null, data.RecessionDB ?? null,
    data.RecessionDL ?? null, data.RecessionL ?? null, data.RecessionML ?? null,
    data.BleedingMB ? 1 : 0, data.BleedingB ? 1 : 0, data.BleedingDB ? 1 : 0,
    data.BleedingDL ? 1 : 0, data.BleedingL ? 1 : 0, data.BleedingML ? 1 : 0,
    data.Mobility, data.Furcation, data.PlaqueIndex, data.ClinicalNotes ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── X-rays ──────────────────────────────────────────────────────────────────

dentalRoutes.get('/xrays/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));

  const { results } = await db.$client.prepare(`
    SELECT * FROM DentalXray WHERE tenant_id = ? AND PatientId = ?
    ORDER BY TakenDate DESC
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

dentalRoutes.post('/xrays', zValidator('json', xraySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO DentalXray (
      tenant_id, PatientId, EncounterId, XrayType, XraySeries,
      TeethImaged, ImageCount, Reason, Findings, InterpretationNotes,
      RadiationDose, TakenDate, TakenById,
      FileName, FileSize, MimeType, AnnotationData
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null,
    data.XrayType, data.XraySeries ?? null,
    data.TeethImaged ?? null, data.ImageCount ?? null,
    data.Reason ?? null, data.Findings ?? null,
    data.InterpretationNotes ?? null, data.RadiationDose ?? null,
    data.TakenDate, userId,
    data.FileName ?? null, data.FileSize ?? null, data.MimeType ?? null, data.AnnotationData ?? null,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Dental Prescriptions ────────────────────────────────────────────────────

dentalRoutes.get('/prescriptions/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));

  const { results } = await db.$client.prepare(`
    SELECT dp.*, dt.ProcedureName as LinkedTreatment
    FROM DentalPrescription dp
    LEFT JOIN DentalTreatment dt ON dp.TreatmentId = dt.TreatmentId
    WHERE dp.tenant_id = ? AND dp.PatientId = ?
    ORDER BY dp.PrescribedDate DESC
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

dentalRoutes.post('/prescriptions', zValidator('json', prescriptionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO DentalPrescription (
      tenant_id, PatientId, TreatmentId, EncounterId,
      DrugName, Dosage, Frequency, Duration, Instructions, PrescribedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.TreatmentId ?? null, data.EncounterId ?? null,
    data.DrugName, data.Dosage ?? null, data.Frequency ?? null,
    data.Duration ?? null, data.Instructions ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

dentalRoutes.delete('/prescriptions/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  await db.$client.prepare(
    "UPDATE DentalPrescription SET Status = 'cancelled' WHERE tenant_id = ? AND PrescriptionId = ?"
  ).bind(tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ─── Print / Export Chart ────────────────────────────────────────────────────

dentalRoutes.get('/chart-print/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with db.$client.batch() for dental chart-print stats.
  // Why: Promise.all() sends 4 separate HTTP network requests to Cloudflare D1.
  //      db.$client.batch() sends a single network request.
  const [chartRes, perioRes, xrayRes, treatRes] = await db.$client.batch([
    db.$client.prepare(`
      SELECT pdc.*, dtm.ToothName, dtm.Arch, dtm.Quadrant,
             dc.ConditionName, dc.ColorHex
      FROM PatientDentalChart pdc
      LEFT JOIN DentalToothMaster dtm ON pdc.ToothNumber = dtm.ToothNumber
      LEFT JOIN DentalConditionType dc ON pdc.ToothCondition = dc.ConditionKey
      WHERE pdc.tenant_id = ? AND pdc.PatientId = ?
      ORDER BY dtm.DisplayOrder
    `).bind(tenantId, patientId),
    db.$client.prepare(`
      SELECT * FROM PeriodontalCharting
      WHERE tenant_id = ? AND PatientId = ?
      ORDER BY ChartedDate DESC LIMIT 5
    `).bind(tenantId, patientId),
    db.$client.prepare(`
      SELECT * FROM DentalXray
      WHERE tenant_id = ? AND PatientId = ?
      ORDER BY TakenDate DESC LIMIT 5
    `).bind(tenantId, patientId),
    db.$client.prepare(`
      SELECT * FROM DentalTreatment
      WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
      ORDER BY PerformedDate DESC LIMIT 10
    `).bind(tenantId, patientId),
  ]);

  return c.json({
    Results: {
      chart: chartRes.results,
      perio: perioRes.results,
      xrays: xrayRes.results,
      treatments: treatRes.results,
    }
  });
});

export default dentalRoutes;
