import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import {
  createPainMapSchema, createPhysicalExamSchema,
  createAftercarePlanSchema, createTransferSummarySchema,
  createClinicalInstructionsSchema, createObservationSchema,
  createDictationSchema, updateDictationSchema,
  createClinicNoteSchema, updateClinicNoteSchema,
  createFunctionalCognitiveSchema, updateFunctionalCognitiveSchema,
} from '../../../schemas/clinical-assessments';

type ClinicalEnv = { Bindings: Env; Variables: Variables };

export const clinicalFormsRoutes = new Hono<ClinicalEnv>();

// ─── Pain Map (CRUD) ──────────────────────────────────────────────────────────

clinicalFormsRoutes.get('/pain-map', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormPainMap WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

clinicalFormsRoutes.post('/pain-map', zValidator('json', createPainMapSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormPainMap (
        tenant_id, PatientId, EncounterId, PainData, CreatedById
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.PainData, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

clinicalFormsRoutes.put('/pain-map/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid PainMapId' });
  }

  const existing = await db.$client
    .prepare('SELECT PainMapId FROM FormPainMap WHERE tenant_id = ? AND PainMapId = ?')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Pain map not found' });
  }

  const body = await c.req.json();
  const entries = Object.entries(body).filter(([_, v]) => v !== undefined);
  if (entries.length === 0) return c.json({ Results: { id: Number(id) } });

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([_, v]) => v);

  await db.$client
    .prepare(`UPDATE FormPainMap SET ${sets}, UpdatedAt = CURRENT_TIMESTAMP WHERE tenant_id = ? AND PainMapId = ?`)
    .bind(...vals, tenantId, Number(id))
    .run();

  return c.json({ Results: { id: Number(id) } });
});

clinicalFormsRoutes.delete('/pain-map/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid PainMapId' });
  }

  const existing = await db.$client
    .prepare('SELECT PainMapId FROM FormPainMap WHERE tenant_id = ? AND PainMapId = ?')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Pain map not found' });
  }

  await db.$client
    .prepare('DELETE FROM FormPainMap WHERE tenant_id = ? AND PainMapId = ?')
    .bind(tenantId, Number(id))
    .run();

  return c.json({ Results: { success: true } });
});

// ─── Physical Exam ────────────────────────────────────────────────────────────

clinicalFormsRoutes.get('/physical-exam/lines', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client
    .prepare(
      `SELECT * FROM PhysicalExamLine
       WHERE (tenant_id = ? OR tenant_id = '0') AND IsActive = 1
       ORDER BY SortOrder`,
    )
    .bind(tenantId)
    .all();

  return c.json({ Results: results });
});

clinicalFormsRoutes.get('/physical-exam', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare(
      `SELECT * FROM FormPhysicalExam
       WHERE tenant_id = ? AND PatientId = ? AND IsDeleted = 0
       ORDER BY CreatedAt DESC`,
    )
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

clinicalFormsRoutes.post('/physical-exam', zValidator('json', createPhysicalExamSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormPhysicalExam (
        tenant_id, PatientId, EncounterId, TemplateId,
        ExamFindings, AbnormalFindings, DiagnosisCodes, GeneralNotes,
        CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.TemplateId ?? null, data.ExamFindings,
      data.AbnormalFindings ?? null, data.DiagnosisCodes ?? null,
      data.GeneralNotes ?? null, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

clinicalFormsRoutes.put('/physical-exam/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid PhysicalExamId' });
  }

  const existing = await db.$client
    .prepare('SELECT PhysicalExamId FROM FormPhysicalExam WHERE tenant_id = ? AND PhysicalExamId = ? AND IsDeleted = 0')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Physical exam not found' });
  }

  const body = await c.req.json();
  const entries = Object.entries(body).filter(([_, v]) => v !== undefined);
  if (entries.length === 0) return c.json({ Results: { id: Number(id) } });

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([_, v]) => v);

  await db.$client
    .prepare(`UPDATE FormPhysicalExam SET ${sets}, UpdatedAt = CURRENT_TIMESTAMP WHERE tenant_id = ? AND PhysicalExamId = ?`)
    .bind(...vals, tenantId, Number(id))
    .run();

  return c.json({ Results: { id: Number(id) } });
});

clinicalFormsRoutes.delete('/physical-exam/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid PhysicalExamId' });
  }

  const existing = await db.$client
    .prepare('SELECT PhysicalExamId FROM FormPhysicalExam WHERE tenant_id = ? AND PhysicalExamId = ? AND IsDeleted = 0')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Physical exam not found' });
  }

  await db.$client
    .prepare('UPDATE FormPhysicalExam SET IsDeleted = 1, UpdatedAt = CURRENT_TIMESTAMP WHERE tenant_id = ? AND PhysicalExamId = ?')
    .bind(tenantId, Number(id))
    .run();

  return c.json({ Results: { success: true } });
});

// ─── Aftercare Plan ───────────────────────────────────────────────────────────

clinicalFormsRoutes.get('/aftercare-plan', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormAftercarePlan WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

clinicalFormsRoutes.post('/aftercare-plan', zValidator('json', createAftercarePlanSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormAftercarePlan (
        tenant_id, PatientId, EncounterId,
        ClientName, Provider, AdmitDate, DischargedDate,
        GoalAAcuteIntoxication, GoalAAcuteIntoxicationI, GoalAAcuteIntoxicationII,
        GoalBEmotionalBehavioralConditions, GoalBEmotionalBehavioralConditionsI,
        GoalCRelapsePotential, GoalCRelapsePotentialI,
        CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.ClientName ?? null, data.Provider ?? null,
      data.AdmitDate ?? null, data.DischargedDate ?? null,
      data.GoalAAcuteIntoxication ?? null,
      data.GoalAAcuteIntoxicationI ?? null,
      data.GoalAAcuteIntoxicationII ?? null,
      data.GoalBEmotionalBehavioralConditions ?? null,
      data.GoalBEmotionalBehavioralConditionsI ?? null,
      data.GoalCRelapsePotential ?? null,
      data.GoalCRelapsePotentialI ?? null,
      userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Transfer Summary ─────────────────────────────────────────────────────────

clinicalFormsRoutes.get('/transfer-summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormTransferSummary WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

clinicalFormsRoutes.post('/transfer-summary', zValidator('json', createTransferSummarySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormTransferSummary (
        tenant_id, PatientId, EncounterId,
        ClientName, Provider, TransferTo, TransferDate,
        StatusOfAdmission, Diagnosis, InterventionProvided,
        OverallStatusOfDischarge, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.ClientName ?? null, data.Provider ?? null,
      data.TransferTo ?? null, data.TransferDate ?? null,
      data.StatusOfAdmission ?? null, data.Diagnosis ?? null,
      data.InterventionProvided ?? null,
      data.OverallStatusOfDischarge ?? null, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Clinical Instructions ────────────────────────────────────────────────────

clinicalFormsRoutes.get('/clinical-instructions', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormClinicalInstructions WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

clinicalFormsRoutes.post('/clinical-instructions', zValidator('json', createClinicalInstructionsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormClinicalInstructions (
        tenant_id, PatientId, EncounterId,
        Instruction, Activity, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.Instruction, data.Activity ?? 1, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Observation (CRUD) ──────────────────────────────────────────────────────

clinicalFormsRoutes.get('/observation', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormObservation WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

clinicalFormsRoutes.post('/observation', zValidator('json', createObservationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormObservation (
        tenant_id, PatientId, EncounterId,
        ObservationDate, Code, Observation, ObValue, ObUnit,
        Description, CodeType, TableCode, ObCode, ObType,
        ObStatus, ResultStatus, ObReasonStatus, ObReasonCode,
        ObReasonText, ObDocumentationOfTable, ObDocumentationOfTableId,
        ParentObservationId, QuestionnaireResponseId,
        Category, DateEnd, Activity, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.ObservationDate ?? null, data.Code ?? null,
      data.Observation ?? null, data.ObValue ?? null,
      data.ObUnit ?? null, data.Description ?? null,
      data.CodeType ?? null, data.TableCode ?? null,
      data.ObCode ?? null, data.ObType ?? null,
      data.ObStatus ?? null, data.ResultStatus ?? null,
      data.ObReasonStatus ?? null, data.ObReasonCode ?? null,
      data.ObReasonText ?? null, data.ObDocumentationOfTable ?? null,
      data.ObDocumentationOfTableId ?? null,
      data.ParentObservationId ?? null,
      data.QuestionnaireResponseId ?? null,
      data.Category ?? null, data.DateEnd ?? null,
      data.Activity ?? 1, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

clinicalFormsRoutes.put('/observation/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid ObservationId' });
  }

  const existing = await db.$client
    .prepare('SELECT ObservationId FROM FormObservation WHERE tenant_id = ? AND ObservationId = ?')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Observation not found' });
  }

  const body = await c.req.json();
  const entries = Object.entries(body).filter(([_, v]) => v !== undefined);
  if (entries.length === 0) return c.json({ Results: { id: Number(id) } });

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([_, v]) => v);

  await db.$client
    .prepare(`UPDATE FormObservation SET ${sets} WHERE tenant_id = ? AND ObservationId = ?`)
    .bind(...vals, tenantId, Number(id))
    .run();

  return c.json({ Results: { id: Number(id) } });
});

clinicalFormsRoutes.delete('/observation/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid ObservationId' });
  }

  const existing = await db.$client
    .prepare('SELECT ObservationId FROM FormObservation WHERE tenant_id = ? AND ObservationId = ?')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Observation not found' });
  }

  await db.$client
    .prepare('DELETE FROM FormObservation WHERE tenant_id = ? AND ObservationId = ?')
    .bind(tenantId, Number(id))
    .run();

  return c.json({ Results: { success: true } });
});

// ─── Dictation (CRUD) ────────────────────────────────────────────────────────

clinicalFormsRoutes.get('/dictation', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormDictation WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

clinicalFormsRoutes.post('/dictation', zValidator('json', createDictationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormDictation (
        tenant_id, PatientId, EncounterId,
        Dictation, AdditionalNotes, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.Dictation ?? null, data.AdditionalNotes ?? null,
      userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

clinicalFormsRoutes.put('/dictation/:id', zValidator('json', updateDictationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid DictationId' });
  }

  const existing = await db.$client
    .prepare('SELECT DictationId FROM FormDictation WHERE tenant_id = ? AND DictationId = ?')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Dictation not found' });
  }

  const data = c.req.valid('json');
  const entries = Object.entries(data).filter(([_, v]) => v !== undefined);
  if (entries.length === 0) return c.json({ Results: { id: Number(id) } });

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([_, v]) => v);

  await db.$client
    .prepare(`UPDATE FormDictation SET ${sets}, UpdatedAt = CURRENT_TIMESTAMP WHERE tenant_id = ? AND DictationId = ?`)
    .bind(...vals, tenantId, Number(id))
    .run();

  return c.json({ Results: { id: Number(id) } });
});

clinicalFormsRoutes.delete('/dictation/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid DictationId' });
  }

  const existing = await db.$client
    .prepare('SELECT DictationId FROM FormDictation WHERE tenant_id = ? AND DictationId = ?')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Dictation not found' });
  }

  await db.$client
    .prepare('DELETE FROM FormDictation WHERE tenant_id = ? AND DictationId = ?')
    .bind(tenantId, Number(id))
    .run();

  return c.json({ Results: { success: true } });
});

// ─── Clinic Note (CRUD) ──────────────────────────────────────────────────────

clinicalFormsRoutes.get('/clinic-note', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormClinicNote WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

clinicalFormsRoutes.post('/clinic-note', zValidator('json', createClinicNoteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormClinicNote (
        tenant_id, PatientId, EncounterId,
        History, Examination, Plan,
        FollowupRequired, FollowupTiming, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.History ?? null, data.Examination ?? null,
      data.Plan ?? null, data.FollowupRequired ?? 0,
      data.FollowupTiming ?? null, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

clinicalFormsRoutes.put('/clinic-note/:id', zValidator('json', updateClinicNoteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid ClinicNoteId' });
  }

  const existing = await db.$client
    .prepare('SELECT ClinicNoteId FROM FormClinicNote WHERE tenant_id = ? AND ClinicNoteId = ?')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Clinic note not found' });
  }

  const data = c.req.valid('json');
  const entries = Object.entries(data).filter(([_, v]) => v !== undefined);
  if (entries.length === 0) return c.json({ Results: { id: Number(id) } });

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([_, v]) => v);

  await db.$client
    .prepare(`UPDATE FormClinicNote SET ${sets}, UpdatedAt = CURRENT_TIMESTAMP WHERE tenant_id = ? AND ClinicNoteId = ?`)
    .bind(...vals, tenantId, Number(id))
    .run();

  return c.json({ Results: { id: Number(id) } });
});

clinicalFormsRoutes.delete('/clinic-note/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid ClinicNoteId' });
  }

  const existing = await db.$client
    .prepare('SELECT ClinicNoteId FROM FormClinicNote WHERE tenant_id = ? AND ClinicNoteId = ?')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Clinic note not found' });
  }

  await db.$client
    .prepare('DELETE FROM FormClinicNote WHERE tenant_id = ? AND ClinicNoteId = ?')
    .bind(tenantId, Number(id))
    .run();

  return c.json({ Results: { success: true } });
});

// ─── Functional / Cognitive Status (CRUD) ────────────────────────────────────

clinicalFormsRoutes.get('/functional-cognitive-status', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormFunctionalCognitiveStatus WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

clinicalFormsRoutes.post('/functional-cognitive-status', zValidator('json', createFunctionalCognitiveSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormFunctionalCognitiveStatus (
        tenant_id, PatientId, EncounterId,
        Code, CodeText, StatusDate, IsCognitive,
        Description, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.Code ?? null, data.CodeText ?? null,
      data.StatusDate ?? null, data.IsCognitive ?? 0,
      data.Description ?? null, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

clinicalFormsRoutes.put('/functional-cognitive-status/:id', zValidator('json', updateFunctionalCognitiveSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid StatusId' });
  }

  const existing = await db.$client
    .prepare('SELECT StatusId FROM FormFunctionalCognitiveStatus WHERE tenant_id = ? AND StatusId = ?')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Status record not found' });
  }

  const data = c.req.valid('json');
  const entries = Object.entries(data).filter(([_, v]) => v !== undefined);
  if (entries.length === 0) return c.json({ Results: { id: Number(id) } });

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([_, v]) => v);

  await db.$client
    .prepare(`UPDATE FormFunctionalCognitiveStatus SET ${sets}, UpdatedAt = CURRENT_TIMESTAMP WHERE tenant_id = ? AND StatusId = ?`)
    .bind(...vals, tenantId, Number(id))
    .run();

  return c.json({ Results: { id: Number(id) } });
});

clinicalFormsRoutes.delete('/functional-cognitive-status/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!id || isNaN(Number(id))) {
    throw new HTTPException(400, { message: 'Invalid StatusId' });
  }

  const existing = await db.$client
    .prepare('SELECT StatusId FROM FormFunctionalCognitiveStatus WHERE tenant_id = ? AND StatusId = ?')
    .bind(tenantId, Number(id))
    .first();
  if (!existing) {
    throw new HTTPException(404, { message: 'Status record not found' });
  }

  await db.$client
    .prepare('DELETE FROM FormFunctionalCognitiveStatus WHERE tenant_id = ? AND StatusId = ?')
    .bind(tenantId, Number(id))
    .run();

  return c.json({ Results: { success: true } });
});
