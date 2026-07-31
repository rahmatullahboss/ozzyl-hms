import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type QEnv = { Bindings: Env; Variables: Variables };

// ─── Scoring Algorithms ─────────────────────────────────────────────────────

const answerMapPHQ9GAD7: Record<string, number> = {
  'Not at all': 0, 'Several days': 1, 'More than half the days': 2, 'Nearly every day': 3,
  '0': 0, '1': 1, '2': 2, '3': 3,
};

function calculatePHQ9Score(answers: Record<string, unknown>): { score: number; interpretation: string; riskLevel: string; icd10?: string } {
  let score = 0;
  for (let i = 1; i <= 9; i++) {
    score += answerMapPHQ9GAD7[String(answers[`item${i}`] ?? '')] ?? 0;
  }
  if (score >= 20) return { score, interpretation: 'severe', riskLevel: 'high', icd10: 'F32.3' };
  if (score >= 15) return { score, interpretation: 'moderately_severe', riskLevel: 'high', icd10: 'F32.2' };
  if (score >= 10) return { score, interpretation: 'moderate', riskLevel: 'medium', icd10: 'F32.1' };
  if (score >= 5) return { score, interpretation: 'mild', riskLevel: 'low', icd10: 'F32.9' };
  return { score, interpretation: 'minimal', riskLevel: 'low' };
}

function calculateGAD7Score(answers: Record<string, unknown>): { score: number; interpretation: string; riskLevel: string; icd10?: string } {
  let score = 0;
  for (let i = 1; i <= 7; i++) {
    score += answerMapPHQ9GAD7[String(answers[`item${i}`] ?? '')] ?? 0;
  }
  if (score >= 15) return { score, interpretation: 'severe', riskLevel: 'high', icd10: 'F41.1' };
  if (score >= 10) return { score, interpretation: 'moderate', riskLevel: 'medium', icd10: 'F41.9' };
  if (score >= 5) return { score, interpretation: 'mild', riskLevel: 'low', icd10: 'F41.9' };
  return { score, interpretation: 'minimal', riskLevel: 'low' };
}

function calculateAUDITScore(answers: Record<string, unknown>): { score: number; interpretation: string; riskLevel: string; icd10?: string } {
  const auditMap: Record<string, number> = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
    'Never': 0, 'Monthly or less': 1, '2-4 times a month': 2, '2-3 times a week': 3, '4+ times a week': 4,
  };
  let score = 0;
  for (let i = 1; i <= 10; i++) {
    score += auditMap[String(answers[`item${i}`] ?? '')] ?? 0;
  }
  if (score >= 20) return { score, interpretation: 'possible_dependence', riskLevel: 'high', icd10: 'F10.2' };
  if (score >= 16) return { score, interpretation: 'harmful_use', riskLevel: 'high', icd10: 'F10.1' };
  if (score >= 8) return { score, interpretation: 'hazardous_use', riskLevel: 'medium', icd10: 'F10.9' };
  return { score, interpretation: 'low_risk', riskLevel: 'low' };
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const createResponseSchema = z.object({
  QuestionnaireId: z.number().int().positive(),
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive(),
  LFormsResponse: z.object({}).passthrough(),
  ClinicalNotes: z.string().max(2000).optional(),
  FollowupRequired: z.boolean().optional(),
});

const updateResponseSchema = z.object({
  ClinicalNotes: z.string().max(2000).optional(),
  FollowupRequired: z.boolean().optional(),
  FollowupNotes: z.string().max(1000).optional(),
  DiagnosisCodes: z.array(z.string()).optional(),
  ResponseMode: z.enum(['clinical', 'research', 'self-reported']).optional(),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const questionnaireRoutes = new Hono<QEnv>();

// GET / — list available questionnaires
questionnaireRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { category, specialty } = c.req.query();

  let query = 'SELECT * FROM Questionnaire WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (category) { query += ' AND Category = ?'; params.push(category); }
  if (specialty) { query += ' AND Specialty = ?'; params.push(specialty); }
  query += ' ORDER BY Title';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// GET /common — most-used questionnaires
questionnaireRoutes.get('/common', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(`
    SELECT q.*, COUNT(qr.ResponseId) as UsageCount
    FROM Questionnaire q
    LEFT JOIN QuestionnaireResponse qr ON q.QuestionnaireId = qr.QuestionnaireId AND qr.tenant_id = q.tenant_id
    WHERE q.tenant_id = ? AND q.IsActive = 1
    GROUP BY q.QuestionnaireId
    ORDER BY UsageCount DESC LIMIT 10
  `).bind(tenantId).all();

  return c.json({ Results: results });
});

// GET /:id — questionnaire definition with items & interpretations
questionnaireRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const questionnaire = await db.$client.prepare(
    'SELECT * FROM Questionnaire WHERE tenant_id = ? AND QuestionnaireId = ?'
  ).bind(tenantId, id).first();

  if (!questionnaire) throw new HTTPException(404, { message: 'Questionnaire not found' });

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with db.$client.batch() for questionnaire details.
  // Why: Promise.all() sends 2 separate HTTP network requests to Cloudflare D1.
  //      db.$client.batch() combines them into a single network round-trip.
  const batchResults = await db.$client.batch([
    db.$client.prepare('SELECT * FROM QuestionnaireItem WHERE tenant_id = ? AND QuestionnaireId = ? ORDER BY DisplayOrder').bind(tenantId, id),
    db.$client.prepare('SELECT * FROM QuestionnaireScoreInterpretation WHERE tenant_id = ? AND QuestionnaireId = ? ORDER BY MinScore').bind(tenantId, id),
  ]);

  const items = batchResults[0]?.results || [];
  const interpretations = batchResults[1]?.results || [];

  return c.json({ Results: { questionnaire, items, interpretations } });
});

// GET /patient/:id/responses — patient's responses
questionnaireRoutes.get('/patient/:id/responses', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('id'));
  const { questionnaireId, limit: lim } = c.req.query();

  let query = `
    SELECT qr.*, q.Title as QuestionnaireTitle
    FROM QuestionnaireResponse qr
    LEFT JOIN Questionnaire q ON qr.QuestionnaireId = q.QuestionnaireId AND q.tenant_id = qr.tenant_id
    WHERE qr.tenant_id = ? AND qr.PatientId = ? AND qr.IsActive = 1
  `;
  const params: (string | number)[] = [tenantId, patientId];

  if (questionnaireId) { query += ' AND qr.QuestionnaireId = ?'; params.push(parseInt(questionnaireId)); }
  query += ' ORDER BY qr.ResponseDate DESC';
  if (lim) { query += ' LIMIT ?'; params.push(parseInt(lim)); }

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// POST /responses — submit response with auto-scoring
questionnaireRoutes.post('/responses', zValidator('json', createResponseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const questionnaire = await db.$client.prepare(
    'SELECT QuestionnaireId, QuestionnaireCode, ScoringMethod FROM Questionnaire WHERE tenant_id = ? AND QuestionnaireId = ?'
  ).bind(tenantId, data.QuestionnaireId).first<{ QuestionnaireId: number; QuestionnaireCode: string; ScoringMethod: string }>();

  if (!questionnaire) throw new HTTPException(404, { message: 'Questionnaire not found' });

  let totalScore = 0;
  let scoreInterpretation = 'normal';
  let riskLevel = 'low';
  let suggestedDiagnosis: string | null = null;

  const lformsData = data.LFormsResponse as Record<string, unknown>;

  if (questionnaire.QuestionnaireCode === '44249-1') {
    const r = calculatePHQ9Score(lformsData);
    totalScore = r.score; scoreInterpretation = r.interpretation; riskLevel = r.riskLevel; suggestedDiagnosis = r.icd10 || null;
  } else if (questionnaire.QuestionnaireCode === '44259-0') {
    const r = calculateGAD7Score(lformsData);
    totalScore = r.score; scoreInterpretation = r.interpretation; riskLevel = r.riskLevel; suggestedDiagnosis = r.icd10 || null;
  } else if (questionnaire.QuestionnaireCode === '72133-2') {
    const r = calculateAUDITScore(lformsData);
    totalScore = r.score; scoreInterpretation = r.interpretation; riskLevel = r.riskLevel; suggestedDiagnosis = r.icd10 || null;
  } else {
    for (const key in lformsData) {
      if (typeof lformsData[key] === 'number') totalScore += lformsData[key] as number;
    }
    scoreInterpretation = totalScore > 0 ? 'abnormal' : 'normal';
    riskLevel = totalScore > 5 ? 'medium' : 'low';
  }

  const diagnosisCodes = suggestedDiagnosis ? [suggestedDiagnosis] : [];

  const result = await db.$client.prepare(`
    INSERT INTO QuestionnaireResponse (
      tenant_id, QuestionnaireId, PatientId, EncounterId, ResponseDate, ResponseMode,
      LFormsResponse, TotalScore, ScoreInterpretation, RiskLevel, DiagnosisCodes,
      ClinicalNotes, FollowupRequired, CreatedById
    ) VALUES (?, ?, ?, ?, ?, 'clinical', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.QuestionnaireId, data.PatientId, data.EncounterId, new Date().toISOString(),
    JSON.stringify(lformsData), totalScore, scoreInterpretation, riskLevel,
    JSON.stringify(diagnosisCodes), data.ClinicalNotes ?? null,
    data.FollowupRequired ? 1 : 0, userId,
  ).run();

  return c.json({
    Results: {
      id: result.meta.last_row_id,
      totalScore, scoreInterpretation, riskLevel, suggestedDiagnosis,
    },
  }, 201);
});

// GET /responses/:id — single response
questionnaireRoutes.get('/responses/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const response = await db.$client.prepare(`
    SELECT qr.*, q.Title as QuestionnaireTitle, q.QuestionnaireCode
    FROM QuestionnaireResponse qr
    LEFT JOIN Questionnaire q ON qr.QuestionnaireId = q.QuestionnaireId AND q.tenant_id = qr.tenant_id
    WHERE qr.tenant_id = ? AND qr.ResponseId = ?
  `).bind(tenantId, id).first();

  if (!response) throw new HTTPException(404, { message: 'Response not found' });
  return c.json({ Results: response });
});

// PUT /responses/:id — update response notes/followup
questionnaireRoutes.put('/responses/:id', zValidator('json', updateResponseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT ResponseId FROM QuestionnaireResponse WHERE tenant_id = ? AND ResponseId = ?'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Response not found' });

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (data.ClinicalNotes !== undefined) { updates.push('ClinicalNotes = ?'); params.push(data.ClinicalNotes ?? null); }
  if (data.FollowupRequired !== undefined) { updates.push('FollowupRequired = ?'); params.push(data.FollowupRequired ? 1 : 0); }
  if (data.FollowupNotes !== undefined) { updates.push('FollowupNotes = ?'); params.push(data.FollowupNotes ?? null); }
  if (data.DiagnosisCodes !== undefined) { updates.push('DiagnosisCodes = ?'); params.push(JSON.stringify(data.DiagnosisCodes)); }
  if (data.ResponseMode !== undefined) { updates.push('ResponseMode = ?'); params.push(data.ResponseMode); }

  if (updates.length === 0) return c.json({ Results: { success: true } });

  params.push(tenantId, id);
  await db.$client.prepare(`UPDATE QuestionnaireResponse SET ${updates.join(', ')} WHERE tenant_id = ? AND ResponseId = ?`).bind(...params).run();

  return c.json({ Results: { success: true } });
});

// DELETE /responses/:id — soft delete
questionnaireRoutes.delete('/responses/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT ResponseId FROM QuestionnaireResponse WHERE tenant_id = ? AND ResponseId = ?'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Response not found' });

  await db.$client.prepare(
    "UPDATE QuestionnaireResponse SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND ResponseId = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

export default questionnaireRoutes;
