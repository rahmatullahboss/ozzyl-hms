import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type PsychEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const mseSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  Appearance: z.string().optional(),
  Behavior: z.string().optional(),
  PsychomotorActivity: z.string().optional(),
  SpeechRate: z.string().optional(),
  SpeechVolume: z.string().optional(),
  SpeechQuantity: z.string().optional(),
  Mood: z.string().optional(),
  MoodDescription: z.string().optional(),
  Affect: z.string().optional(),
  AffectNotes: z.string().optional(),
  ThoughtProcess: z.string().optional(),
  ThoughtProcessNotes: z.string().optional(),
  SuicidalIdeation: z.boolean().default(false),
  SuicidalPlan: z.boolean().default(false),
  SuicidalIntent: z.boolean().default(false),
  HomicidalIdeation: z.boolean().default(false),
  Delusions: z.boolean().default(false),
  DelusionsType: z.string().optional(),
  Hallucinations: z.boolean().default(false),
  HallucinationsType: z.string().optional(),
  Alertness: z.string().optional(),
  Orientation: z.string().optional(),
  Memory: z.string().optional(),
  Attention: z.string().optional(),
  Insight: z.string().optional(),
  Judgment: z.string().optional(),
  SuicideRisk: z.enum(['low', 'moderate', 'high', 'imminent']),
  ViolenceRisk: z.enum(['low', 'moderate', 'high', 'imminent']),
  SelfHarmRisk: z.string().optional(),
  RiskFactors: z.string().max(2000).optional(),
  ProtectiveFactors: z.string().max(2000).optional(),
  ClinicalNotes: z.string().max(5000).optional(),
});

const suicideRiskSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  WishToBeDead: z.boolean().default(false),
  ActiveSuicidalIdeation: z.boolean().default(false),
  ActiveIdeationWithPlan: z.boolean().default(false),
  ActiveIdeationWithIntent: z.boolean().default(false),
  ActualAttempt: z.boolean().default(false),
  ActualAttemptCount: z.number().int().min(0).default(0),
  RecentIdeation: z.boolean().default(false),
  RecentAttempt: z.boolean().default(false),
  OverallRisk: z.enum(['low', 'moderate', 'high', 'imminent']),
  RiskLevel: z.number().int().min(0).max(10),
  SafetyPlanCreated: z.boolean().default(false),
  Disposition: z.enum(['routine-followup', 'urgent-appointment', 'er-referral', 'hospitalization']),
  DispositionNotes: z.string().max(2000).optional(),
});

const therapyNoteSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  SessionDate: z.string(),
  SessionType: z.enum(['individual', 'couples', 'family', 'group']),
  SessionNumber: z.number().int().positive().optional(),
  Duration: z.number().int().positive(),
  Modality: z.string().optional(),
  ChiefComplaint: z.string().max(2000).optional(),
  SubjectiveNotes: z.string().max(5000).optional(),
  ObjectiveNotes: z.string().max(5000).optional(),
  AssessmentNotes: z.string().max(5000).optional(),
  PlanNotes: z.string().max(5000).optional(),
  PatientEngagement: z.enum(['excellent', 'good', 'fair', 'poor']),
  ProgressTowardsGoals: z.enum(['significant', 'moderate', 'minimal', 'none']),
  SessionSuicideRisk: z.enum(['low', 'moderate', 'high']),
  HomeworkAssigned: z.string().max(2000).optional(),
  NextSessionDate: z.string().optional(),
});

const evaluationSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  EvaluationType: z.enum(['initial', 'comprehensive', 'emergency', 'forensic']),
  ReferralSource: z.string().optional(),
  HPI: z.string().max(10000),
  PsychiatricHistory: z.string().max(5000).optional(),
  MedicalHistory: z.string().max(5000).optional(),
  FamilyPsychiatricHistory: z.string().max(5000).optional(),
  SocialHistory: z.string().max(5000).optional(),
  PrimaryDiagnosis: z.string(),
  PrimaryDiagnosisName: z.string(),
  SecondaryDiagnoses: z.array(z.string()).optional(),
  GAFScore: z.number().int().min(0).max(100).optional(),
  MedicationRecommendations: z.array(z.string()).optional(),
  TherapyRecommendations: z.array(z.string()).optional(),
  FollowupPlan: z.string().max(2000).optional(),
});

const medicationSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  MedicationName: z.string().min(1),
  MedicationClass: z.string().optional(),
  Dose: z.string().min(1),
  Frequency: z.string().min(1),
  Route: z.string().default('oral'),
  Indication: z.string().optional(),
  TargetSymptoms: z.array(z.string()).optional(),
  IsControlled: z.boolean().default(false),
  ControlledSchedule: z.enum(['C-II', 'C-III', 'C-IV', 'C-V']).optional(),
});

const safetyPlanSchema = z.object({
  PatientId: z.number().int().positive(),
  AssessmentId: z.number().int().positive().optional(),
  WarningSigns: z.array(z.string()),
  CopingStrategies: z.array(z.string()),
  SocialContacts: z.array(z.string()),
  FamilySupport: z.array(z.string()),
  FriendsSupport: z.array(z.string()),
  TherapistName: z.string().optional(),
  TherapistPhone: z.string().optional(),
  CrisisLine: z.string().default('988'),
  EmergencyContact: z.string(),
  EmergencyContactPhone: z.string(),
  MeansRestrictionPlan: z.string().max(2000).optional(),
  PatientCommitment: z.string().max(2000).optional(),
  ReviewDate: z.string().optional(),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const psychiatryRoutes = new Hono<PsychEnv>();

// ═══════════════════════════════════════════════════════════════════
// Mental Status Examination
// ═══════════════════════════════════════════════════════════════════

psychiatryRoutes.get('/mse/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  const { limit: lim } = c.req.query();

  const { results } = await db.$client.prepare(`
    SELECT * FROM MentalStatusExam
    WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
    ORDER BY ExamDate DESC LIMIT ?
  `).bind(tenantId, patientId, parseInt(lim || '20')).all();

  return c.json({ Results: results });
});

psychiatryRoutes.post('/mse', zValidator('json', mseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO MentalStatusExam (
      tenant_id, PatientId, EncounterId, ExamDate,
      Appearance, Behavior, PsychomotorActivity,
      SpeechRate, SpeechVolume, SpeechQuantity,
      Mood, MoodDescription, Affect, AffectNotes,
      ThoughtProcess, ThoughtProcessNotes,
      SuicidalIdeation, SuicidalPlan, SuicidalIntent, HomicidalIdeation,
      Delusions, DelusionsType, Hallucinations, HallucinationsType,
      Alertness, Orientation, Memory, Attention,
      Insight, Judgment,
      SuicideRisk, ViolenceRisk, SelfHarmRisk,
      RiskFactors, ProtectiveFactors, ClinicalNotes,
      PerformedById, PerformedDate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null, now,
    data.Appearance ?? null, data.Behavior ?? null, data.PsychomotorActivity ?? null,
    data.SpeechRate ?? null, data.SpeechVolume ?? null, data.SpeechQuantity ?? null,
    data.Mood ?? null, data.MoodDescription ?? null, data.Affect ?? null, data.AffectNotes ?? null,
    data.ThoughtProcess ?? null, data.ThoughtProcessNotes ?? null,
    data.SuicidalIdeation ? 1 : 0, data.SuicidalPlan ? 1 : 0,
    data.SuicidalIntent ? 1 : 0, data.HomicidalIdeation ? 1 : 0,
    data.Delusions ? 1 : 0, data.DelusionsType ?? null,
    data.Hallucinations ? 1 : 0, data.HallucinationsType ?? null,
    data.Alertness ?? null, data.Orientation ?? null, data.Memory ?? null, data.Attention ?? null,
    data.Insight ?? null, data.Judgment ?? null,
    data.SuicideRisk, data.ViolenceRisk, data.SelfHarmRisk ?? null,
    data.RiskFactors ?? null, data.ProtectiveFactors ?? null, data.ClinicalNotes ?? null,
    userId, now,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// Suicide Risk Assessment (C-SSRS)
// ═══════════════════════════════════════════════════════════════════

psychiatryRoutes.get('/suicide-risk/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));

  const { results } = await db.$client.prepare(`
    SELECT * FROM SuicideRiskAssessment
    WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
    ORDER BY AssessmentDate DESC
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

psychiatryRoutes.post('/suicide-risk', zValidator('json', suicideRiskSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO SuicideRiskAssessment (
      tenant_id, PatientId, EncounterId, AssessmentDate,
      WishToBeDead, ActiveSuicidalIdeation, ActiveIdeationWithPlan, ActiveIdeationWithIntent,
      ActualAttempt, ActualAttemptCount, RecentIdeation, RecentAttempt,
      OverallRisk, RiskLevel, SafetyPlanCreated, Disposition, DispositionNotes,
      AssessedById, AssessedDate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null, now,
    data.WishToBeDead ? 1 : 0, data.ActiveSuicidalIdeation ? 1 : 0,
    data.ActiveIdeationWithPlan ? 1 : 0, data.ActiveIdeationWithIntent ? 1 : 0,
    data.ActualAttempt ? 1 : 0, data.ActualAttemptCount,
    data.RecentIdeation ? 1 : 0, data.RecentAttempt ? 1 : 0,
    data.OverallRisk, data.RiskLevel, data.SafetyPlanCreated ? 1 : 0,
    data.Disposition, data.DispositionNotes ?? null,
    userId, now,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// Therapy Session Notes
// ═══════════════════════════════════════════════════════════════════

psychiatryRoutes.get('/therapy-notes/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  const { limit: lim } = c.req.query();

  const { results } = await db.$client.prepare(`
    SELECT * FROM TherapySessionNote
    WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
    ORDER BY SessionDate DESC LIMIT ?
  `).bind(tenantId, patientId, parseInt(lim || '20')).all();

  return c.json({ Results: results });
});

psychiatryRoutes.post('/therapy-notes', zValidator('json', therapyNoteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO TherapySessionNote (
      tenant_id, PatientId, EncounterId, SessionDate, SessionType, SessionNumber,
      Duration, Modality, ChiefComplaint,
      SubjectiveNotes, ObjectiveNotes, AssessmentNotes, PlanNotes,
      PatientEngagement, ProgressTowardsGoals, SessionSuicideRisk,
      HomeworkAssigned, NextSessionDate, TherapistId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null,
    data.SessionDate, data.SessionType, data.SessionNumber ?? null,
    data.Duration, data.Modality ?? null, data.ChiefComplaint ?? null,
    data.SubjectiveNotes ?? null, data.ObjectiveNotes ?? null,
    data.AssessmentNotes ?? null, data.PlanNotes ?? null,
    data.PatientEngagement, data.ProgressTowardsGoals, data.SessionSuicideRisk,
    data.HomeworkAssigned ?? null, data.NextSessionDate ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// Psychiatric Evaluations
// ═══════════════════════════════════════════════════════════════════

psychiatryRoutes.get('/evaluations/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));

  const { results } = await db.$client.prepare(`
    SELECT * FROM PsychiatricEvaluation
    WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
    ORDER BY EvaluationDate DESC
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

psychiatryRoutes.post('/evaluations', zValidator('json', evaluationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO PsychiatricEvaluation (
      tenant_id, PatientId, EncounterId, EvaluationDate, EvaluationType,
      ReferralSource, HPI, PsychiatricHistory, MedicalHistory,
      FamilyPsychiatricHistory, SocialHistory,
      PrimaryDiagnosis, PrimaryDiagnosisName, SecondaryDiagnoses,
      GAFScore, MedicationRecommendations, TherapyRecommendations,
      FollowupPlan, EvaluatorId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null, now, data.EvaluationType,
    data.ReferralSource ?? null, data.HPI,
    data.PsychiatricHistory ?? null, data.MedicalHistory ?? null,
    data.FamilyPsychiatricHistory ?? null, data.SocialHistory ?? null,
    data.PrimaryDiagnosis, data.PrimaryDiagnosisName,
    data.SecondaryDiagnoses ? JSON.stringify(data.SecondaryDiagnoses) : null,
    data.GAFScore ?? null,
    data.MedicationRecommendations ? JSON.stringify(data.MedicationRecommendations) : null,
    data.TherapyRecommendations ? JSON.stringify(data.TherapyRecommendations) : null,
    data.FollowupPlan ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// Psychiatric Medications
// ═══════════════════════════════════════════════════════════════════

psychiatryRoutes.get('/medications/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  const { status } = c.req.query();

  let query = 'SELECT * FROM PsychiatricMedication WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId, patientId];

  if (status === 'active') { query += ' AND StopDate IS NULL'; }
  query += ' ORDER BY PrescribedDate DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

psychiatryRoutes.post('/medications', zValidator('json', medicationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  const result = await db.$client.prepare(`
    INSERT INTO PsychiatricMedication (
      tenant_id, PatientId, EncounterId, MedicationName, MedicationClass,
      Dose, Frequency, Route, Indication, TargetSymptoms,
      IsControlled, ControlledSchedule, PrescribedById, PrescribedDate, StartDate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null,
    data.MedicationName, data.MedicationClass ?? null,
    data.Dose, data.Frequency, data.Route,
    data.Indication ?? null,
    data.TargetSymptoms ? JSON.stringify(data.TargetSymptoms) : null,
    data.IsControlled ? 1 : 0, data.ControlledSchedule ?? null,
    userId, now, now,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /medications/:id/stop — stop medication
psychiatryRoutes.put('/medications/:id/stop', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const existing = await db.$client.prepare(
    'SELECT MedicationId FROM PsychiatricMedication WHERE tenant_id = ? AND MedicationId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Medication not found' });

  await db.$client.prepare(`
    UPDATE PsychiatricMedication SET StopDate = datetime('now', '+6 hours'), StopReason = ?
    WHERE tenant_id = ? AND MedicationId = ?
  `).bind((body.StopReason as string) ?? null, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ═══════════════════════════════════════════════════════════════════
// Safety Plans
// ═══════════════════════════════════════════════════════════════════

psychiatryRoutes.get('/safety-plan/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));

  const plan = await db.$client.prepare(`
    SELECT * FROM SafetyPlan
    WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
    ORDER BY CreatedDate DESC LIMIT 1
  `).bind(tenantId, patientId).first();

  return c.json({ Results: plan || null });
});

psychiatryRoutes.post('/safety-plan', zValidator('json', safetyPlanSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  // Deactivate existing safety plans
  await db.$client.prepare(
    'UPDATE SafetyPlan SET IsActive = 0 WHERE tenant_id = ? AND PatientId = ?'
  ).bind(tenantId, data.PatientId).run();

  const result = await db.$client.prepare(`
    INSERT INTO SafetyPlan (
      tenant_id, PatientId, AssessmentId,
      WarningSigns, CopingStrategies, SocialContacts,
      FamilySupport, FriendsSupport,
      TherapistName, TherapistPhone, CrisisLine,
      EmergencyContact, EmergencyContactPhone,
      MeansRestrictionPlan, PatientCommitment, ReviewDate,
      CreatedById, CreatedDate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.AssessmentId ?? null,
    JSON.stringify(data.WarningSigns), JSON.stringify(data.CopingStrategies),
    JSON.stringify(data.SocialContacts), JSON.stringify(data.FamilySupport),
    JSON.stringify(data.FriendsSupport),
    data.TherapistName ?? null, data.TherapistPhone ?? null, data.CrisisLine,
    data.EmergencyContact, data.EmergencyContactPhone,
    data.MeansRestrictionPlan ?? null, data.PatientCommitment ?? null,
    data.ReviewDate ?? null, userId, now,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

export default psychiatryRoutes;
