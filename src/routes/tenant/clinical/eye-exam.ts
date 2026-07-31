import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';

type EyeEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createEyeExamSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().optional(),
  ExamDate: z.string(),
  ChiefComplaint: z.string().optional(),
  HPI: z.string().optional(),
  ReviewOfSystems: z.string().optional(),
});

const createAcuitySchema = z.object({
  EyeExamId: z.number().int().positive(),
  PatientId: z.number().int().positive(),
  SCODVA: z.string().optional(), SCOSVA: z.string().optional(),
  PHODVA: z.string().optional(), PHOSVA: z.string().optional(),
  CTLODVA: z.string().optional(), CTLOSVA: z.string().optional(),
  SCNEARODVA: z.string().optional(), SCNEAROSVA: z.string().optional(),
  MRNEARODVA: z.string().optional(), MRNEAROSVA: z.string().optional(),
  GLAREODVA: z.string().optional(), GLAREOSVA: z.string().optional(),
  GLARECOMMENTS: z.string().optional(),
});

const createRefractionSchema = z.object({
  EyeExamId: z.number().int().positive(),
  PatientId: z.number().int().positive(),
  MRODSPH: z.string().optional(), MRODCYL: z.string().optional(),
  MRODAXIS: z.string().optional(), MRODPRISM: z.string().optional(),
  MRODBASE: z.string().optional(), MRODADD: z.string().optional(),
  MROSSPH: z.string().optional(), MROSCYL: z.string().optional(),
  MROSAXIS: z.string().optional(), MROSPRISM: z.string().optional(),
  MROSBASE: z.string().optional(), MROSADD: z.string().optional(),
  MRODNEARSPHERE: z.string().optional(), MRODNEARCYL: z.string().optional(),
  MRODNEARAXIS: z.string().optional(),
  MROSNEARSPHERE: z.string().optional(), MROSNEARCYL: z.string().optional(),
  MROSNEARAXIS: z.string().optional(),
  VertexDistanceOD: z.string().optional(), VertexDistanceOS: z.string().optional(),
});

const createAntSegSchema = z.object({
  EyeExamId: z.number().int().positive(),
  PatientId: z.number().int().positive(),
  ODSCHIRMER1: z.string().optional(), OSSCHIRMER1: z.string().optional(),
  ODSCHIRMER2: z.string().optional(), OSSCHIRMER2: z.string().optional(),
  ODTBUT: z.string().optional(), OSTBUT: z.string().optional(),
  OSCONJ: z.string().optional(), ODCONJ: z.string().optional(),
  ODCORNEA: z.string().optional(), OSCORNEA: z.string().optional(),
  ODAC: z.string().optional(), OSAC: z.string().optional(),
  ODLENS: z.string().optional(), OSLENS: z.string().optional(),
  ODIRIS: z.string().optional(), OSIRIS: z.string().optional(),
  PUPIL_NORMAL: z.number().optional(),
  ODPUPILSIZE1: z.string().optional(), OSPUPILSIZE1: z.string().optional(),
  ODPUPILREACT: z.string().optional(), OSPUPILREACT: z.string().optional(),
  ODIOPAP: z.string().optional(), OSIOPAP: z.string().optional(),
  ODIOPNCT: z.string().optional(), OSIOPNCT: z.string().optional(),
  IOPTIME: z.string().optional(),
  Comments: z.string().optional(),
});

const createFundusSchema = z.object({
  EyeExamId: z.number().int().positive(),
  PatientId: z.number().int().positive(),
  ODVITREOUS: z.string().optional(), OSVITREOUS: z.string().optional(),
  ODDISC: z.string().optional(), OSDISC: z.string().optional(),
  ODMACULA: z.string().optional(), OSMACULA: z.string().optional(),
  ODVESSELS: z.string().optional(), OSVESSELS: z.string().optional(),
  ODPERIPHERY: z.string().optional(), OSPERIPHERY: z.string().optional(),
  ODCDRatio: z.string().optional(), OSCDRatio: z.string().optional(),
  Comments: z.string().optional(),
});

const createAssessmentSchema = z.object({
  EyeExamId: z.number().int().positive(),
  PatientId: z.number().int().positive(),
  DiagnosisOD: z.string().optional(), DiagnosisOS: z.string().optional(),
  DiagnosisCodeOD: z.string().optional(), DiagnosisCodeOS: z.string().optional(),
  Assessment: z.string().optional(),
  Plan: z.string().optional(),
  FollowupDays: z.number().optional(), FollowupInstructions: z.string().optional(),
  SpectacleRxOD: z.string().optional(), SpectacleRxOS: z.string().optional(),
  SpectacleComments: z.string().optional(),
  ContactLensOD: z.string().optional(), ContactLensOS: z.string().optional(),
  ContactLensComments: z.string().optional(),
  SurgeryRecommended: z.number().optional(),
  SurgeryType: z.string().optional(), SurgeryEye: z.string().optional(),
  SurgeryDate: z.string().optional(),
});

// ─── Router ──────────────────────────────────────────────────────────────────

export const eyeExamRoutes = new Hono<EyeEnv>();

// Helper to build simple insert
function buildInsert(table: string, data: Record<string, unknown>, tenantId: string, extraCols: string[] = [], extraVals: unknown[] = []) {
  const entries = Object.entries(data).filter(([_, v]) => v !== undefined);
  const cols = [...extraCols, ...entries.map(([k]) => k)];
  const placeholders = cols.map(() => '?').join(', ');
  const vals = [...extraVals, ...entries.map(([_, v]) => v ?? null)];
  return { sql: `INSERT INTO ${table} (tenant_id, ${cols.join(', ')}) VALUES (?, ${placeholders})`, vals: [tenantId, ...vals] };
}

// ─── Eye Exam Base ───────────────────────────────────────────────────────────

eyeExamRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId) throw new HTTPException(400, { message: 'patientId required' });

  const { results } = await db.$client
    .prepare('SELECT * FROM FormEyeExam WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1 ORDER BY ExamDate DESC')
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

eyeExamRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const exam = await db.$client
    .prepare('SELECT * FROM FormEyeExam WHERE tenant_id = ? AND EyeExamId = ? AND IsActive = 1')
    .bind(tenantId, id).first();
  if (!exam) throw new HTTPException(404, { message: 'Eye exam not found' });

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with db.$client.batch() for eye exam details.
  // Why: Promise.all() sends 6 separate HTTP network requests to Cloudflare D1.
  //      db.$client.batch() sends a single network request containing all 6 queries.
  // Impact: Eliminates 5 network round-trips, significantly reducing latency and
  //         making the eye exam details load much faster.
  const [acuityRes, refractionRes, externalRes, antsegRes, fundusRes, assessmentRes] = await db.$client.batch([
    db.$client.prepare('SELECT * FROM FormEyeExamAcuity WHERE tenant_id = ? AND EyeExamId = ?').bind(tenantId, id),
    db.$client.prepare('SELECT * FROM FormEyeExamRefraction WHERE tenant_id = ? AND EyeExamId = ?').bind(tenantId, id),
    db.$client.prepare('SELECT * FROM FormEyeExamExternal WHERE tenant_id = ? AND EyeExamId = ?').bind(tenantId, id),
    db.$client.prepare('SELECT * FROM FormEyeExamAntSeg WHERE tenant_id = ? AND EyeExamId = ?').bind(tenantId, id),
    db.$client.prepare('SELECT * FROM FormEyeExamFundus WHERE tenant_id = ? AND EyeExamId = ?').bind(tenantId, id),
    db.$client.prepare('SELECT * FROM FormEyeExamAssessment WHERE tenant_id = ? AND EyeExamId = ? AND IsActive = 1').bind(tenantId, id),
  ]);

  const acuity = acuityRes.results?.[0] ?? null;
  const refraction = refractionRes.results?.[0] ?? null;
  const external = externalRes.results?.[0] ?? null;
  const antseg = antsegRes.results?.[0] ?? null;
  const fundus = fundusRes.results?.[0] ?? null;
  const assessment = assessmentRes.results?.[0] ?? null;

  return c.json({ Results: { exam, acuity, refraction, external, anteriorSegment: antseg, fundus, assessment } });
});

eyeExamRoutes.post('/', zValidator('json', createEyeExamSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client
    .prepare(`
      INSERT INTO FormEyeExam (tenant_id, PatientId, EncounterId, ExamDate, ChiefComplaint, HPI, ReviewOfSystems, CreatedById)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(tenantId, data.PatientId, data.EncounterId ?? null, data.ExamDate, data.ChiefComplaint ?? null, data.HPI ?? null, data.ReviewOfSystems ?? null, userId)
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

eyeExamRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client
    .prepare('SELECT EyeExamId FROM FormEyeExam WHERE tenant_id = ? AND EyeExamId = ? AND IsActive = 1')
    .bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Eye exam not found' });

  await db.$client
    .prepare("UPDATE FormEyeExam SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND EyeExamId = ?")
    .bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

// ─── Sub-sections (acuity, refraction, antseg, fundus, assessment) ───────

eyeExamRoutes.post('/acuity', zValidator('json', createAcuitySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const { sql, vals } = buildInsert('FormEyeExamAcuity', data, tenantId);
  const result = await db.$client.prepare(sql).bind(...vals).run();
  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

eyeExamRoutes.post('/refraction', zValidator('json', createRefractionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const { sql, vals } = buildInsert('FormEyeExamRefraction', data, tenantId);
  const result = await db.$client.prepare(sql).bind(...vals).run();
  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

eyeExamRoutes.post('/anterior-segment', zValidator('json', createAntSegSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const { sql, vals } = buildInsert('FormEyeExamAntSeg', data, tenantId);
  const result = await db.$client.prepare(sql).bind(...vals).run();
  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

eyeExamRoutes.post('/fundus', zValidator('json', createFundusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const { sql, vals } = buildInsert('FormEyeExamFundus', data, tenantId);
  const result = await db.$client.prepare(sql).bind(...vals).run();
  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

eyeExamRoutes.post('/assessment', zValidator('json', createAssessmentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const { sql, vals } = buildInsert('FormEyeExamAssessment', data, tenantId);
  const result = await db.$client.prepare(sql).bind(...vals).run();
  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Preferences ─────────────────────────────────────────────────────────────

eyeExamRoutes.get('/prefs', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const prefs = await db.$client
    .prepare('SELECT * FROM FormEyeExamPrefs WHERE tenant_id = ? AND ProviderId = ?')
    .bind(tenantId, userId).first();

  return c.json({ Results: prefs || { DefaultAcuityMethod: 'SNELLEN', DefaultIOLFormula: 'SRK/T', ShowBiometrics: 1, ShowRefraction: 1, ShowFundus: 1 } });
});

eyeExamRoutes.put('/prefs', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const body = await c.req.json();

  const existing = await db.$client
    .prepare('SELECT PrefsId FROM FormEyeExamPrefs WHERE tenant_id = ? AND ProviderId = ?')
    .bind(tenantId, userId).first();

  if (existing) {
    const entries = Object.entries(body).filter(([_, v]) => v !== undefined);
    if (entries.length === 0) return c.json({ Results: { success: true } });
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    const vals = entries.map(([_, v]) => v);
    await db.$client
      .prepare(`UPDATE FormEyeExamPrefs SET ${sets}, UpdatedAt = CURRENT_TIMESTAMP WHERE tenant_id = ? AND ProviderId = ?`)
      .bind(...vals, tenantId, userId).run();
  } else {
    await db.$client
      .prepare(`
        INSERT INTO FormEyeExamPrefs (tenant_id, ProviderId, DefaultAcuityMethod, DefaultIOLFormula, ShowBiometrics, ShowRefraction, ShowFundus)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(tenantId, userId, body.DefaultAcuityMethod ?? 'SNELLEN', body.DefaultIOLFormula ?? 'SRK/T', body.ShowBiometrics ?? 1, body.ShowRefraction ?? 1, body.ShowFundus ?? 1)
      .run();
  }

  return c.json({ Results: { success: true } });
});
