import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import {
  createPHQ9Schema,
  createGAD7Schema,
  createSOAPSchema,
  createTreatmentPlanSchema,
  createSocialHistorySchema,
  scorePHQ9,
  scoreGAD7,
} from '../../../schemas/clinical-assessments';

type ClinicalEnv = { Bindings: Env; Variables: Variables };

export const assessmentRoutes = new Hono<ClinicalEnv>();

// ─── PHQ-9 Depression Screening ─────────────────────────────────────────────

assessmentRoutes.get('/phq9', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormPHQ9 WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

assessmentRoutes.post('/phq9', zValidator('json', createPHQ9Schema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const { total, severity, isFlagged } = scorePHQ9(data);

  const result = await db.$client
    .prepare(`
      INSERT INTO FormPHQ9 (
        tenant_id, PatientId, EncounterId,
        InterestScore, HopelessScore, SleepScore, FatigueScore,
        AppetiteScore, FailureScore, FocusScore, PsychomotorScore,
        SuicideScore, TotalScore, SeverityLevel, IsFlagged,
        Difficulty, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.InterestScore, data.HopelessScore, data.SleepScore, data.FatigueScore,
      data.AppetiteScore, data.FailureScore, data.FocusScore, data.PsychomotorScore,
      data.SuicideScore, total, severity, isFlagged,
      data.Difficulty ?? null, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id, TotalScore: total, SeverityLevel: severity, IsFlagged: isFlagged } }, 201);
});

assessmentRoutes.get('/phq9/trend', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT PHQ9Id, TotalScore, SeverityLevel, IsFlagged, CreatedAt FROM FormPHQ9 WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt ASC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

// ─── GAD-7 Anxiety Screening ────────────────────────────────────────────────

assessmentRoutes.get('/gad7', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormGAD7 WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

assessmentRoutes.post('/gad7', zValidator('json', createGAD7Schema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const { total, severity, isFlagged } = scoreGAD7(data);

  const result = await db.$client
    .prepare(`
      INSERT INTO FormGAD7 (
        tenant_id, PatientId, EncounterId,
        NervousScore, ControlWorryScore, WorryScore, RelaxScore,
        RestlessScore, IrritableScore, FearScore,
        TotalScore, SeverityLevel, IsFlagged,
        Difficulty, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.NervousScore, data.ControlWorryScore, data.WorryScore, data.RelaxScore,
      data.RestlessScore, data.IrritableScore, data.FearScore,
      total, severity, isFlagged,
      data.Difficulty ?? null, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id, TotalScore: total, SeverityLevel: severity, IsFlagged: isFlagged } }, 201);
});

assessmentRoutes.get('/gad7/trend', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT GAD7Id, TotalScore, SeverityLevel, IsFlagged, CreatedAt FROM FormGAD7 WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt ASC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

// ─── SOAP Notes ─────────────────────────────────────────────────────────────

assessmentRoutes.get('/soap', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormSOAP WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

assessmentRoutes.post('/soap', zValidator('json', createSOAPSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormSOAP (
        tenant_id, PatientId, EncounterId,
        ChiefComplaint, Subjective, Objective, Assessment, Plan,
        CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.ChiefComplaint ?? null, data.Subjective ?? null,
      data.Objective ?? null, data.Assessment ?? null, data.Plan ?? null,
      userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Treatment Plan ─────────────────────────────────────────────────────────

assessmentRoutes.get('/treatment-plan', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM FormTreatmentPlan WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

assessmentRoutes.post('/treatment-plan', zValidator('json', createTreatmentPlanSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormTreatmentPlan (
        tenant_id, PatientId, EncounterId,
        ClientName, ClientNumber, Provider, AdmitDate,
        PresentingIssues, PatientHistory, Medications,
        AnyOtherRelevantInformation, Diagnosis,
        TreatmentReceived, RecommendationForFollowUp,
        CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.ClientName ?? null, data.ClientNumber ?? null,
      data.Provider ?? null, data.AdmitDate ?? null,
      data.PresentingIssues ?? null, data.PatientHistory ?? null,
      data.Medications ?? null, data.AnyOtherRelevantInformation ?? null,
      data.Diagnosis ?? null, data.TreatmentReceived ?? null,
      data.RecommendationForFollowUp ?? null, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Enhanced Social History ────────────────────────────────────────────────

assessmentRoutes.get('/social-history', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const row = await db.$client
    .prepare('SELECT * FROM CLN_SocialHistoryEnhanced WHERE tenant_id = ? AND PatientId = ? ORDER BY SocialHistoryId DESC LIMIT 1')
    .bind(tenantId, Number(patientId))
    .first();

  return c.json({ Results: row ?? null });
});

assessmentRoutes.get('/social-history/history', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare('SELECT * FROM CLN_SocialHistoryEnhanced WHERE tenant_id = ? AND PatientId = ? ORDER BY SocialHistoryId DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

assessmentRoutes.post('/social-history', zValidator('json', createSocialHistorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO CLN_SocialHistoryEnhanced (
        tenant_id, PatientId, EncounterId,
        SmokingStatus, SmokingPacksPerDay, SmokingQuitDate, TobaccoType,
        AlcoholUse, AlcoholUnitsPerWeek, RecreationalDrugs, DrugTypes,
        ExercisePatterns, SleepPatterns, CaffeineUse, SeatbeltUse,
        HazardousActivities, FamilyHistoryMother, FamilyHistoryFather,
        FamilyHistorySiblings, FamilyHistoryOffspring, Notes, CreatedById
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.SmokingStatus ?? null, data.SmokingPacksPerDay ?? null,
      data.SmokingQuitDate ?? null, data.TobaccoType ?? null,
      data.AlcoholUse ?? null, data.AlcoholUnitsPerWeek ?? null,
      data.RecreationalDrugs ?? null, data.DrugTypes ?? null,
      data.ExercisePatterns ?? null, data.SleepPatterns ?? null,
      data.CaffeineUse ?? null, data.SeatbeltUse ?? null,
      data.HazardousActivities ?? null, data.FamilyHistoryMother ?? null,
      data.FamilyHistoryFather ?? null, data.FamilyHistorySiblings ?? null,
      data.FamilyHistoryOffspring ?? null, data.Notes ?? null, userId,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});
