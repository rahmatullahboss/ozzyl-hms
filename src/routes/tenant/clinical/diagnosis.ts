import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createDiagnosisSchema } from '../../../schemas/clinical-assessments';
import { clinicalReviewSchema } from '../../../schemas/clinical-review';

type ClinicalEnv = { Bindings: Env; Variables: Variables };

export const diagnosisRoutes = new Hono<ClinicalEnv>();

// ─── ICD-11 search ──────────────────────────────────────────────────────────

diagnosisRoutes.get('/icd11/search', async (c) => {
  const db = getDb(c.env.DB);
  const q = c.req.query('q');
  
  if (!q || q.length < 2) {
    throw new HTTPException(400, { message: 'Search query must be at least 2 characters' });
  }

  const escaped = q.replace(/[\\%_]/g, '\\$&');
  const pattern = `%${escaped}%`;
  const { results } = await db.$client
    .prepare("SELECT id, code, title, is_bd_subset FROM catalog_icd11_mms WHERE (code LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\') AND is_active = 1 ORDER BY is_bd_subset DESC LIMIT 50")
    .bind(pattern, pattern)
    .all();

  return c.json({ Results: results });
});

// ─── ICD-10 search ──────────────────────────────────────────────────────────

diagnosisRoutes.get('/icd10/search', async (c) => {
  const db = getDb(c.env.DB);
  const q = c.req.query('q');
  if (!q || q.length < 2) {
    throw new HTTPException(400, { message: 'Search query must be at least 2 characters' });
  }

  const escaped = q.replace(/[\\%_]/g, '\\$&');
  const pattern = `%${escaped}%`;
  const { results } = await db.$client
    .prepare("SELECT ICD10ID, ICD10Code, DiseaseName FROM ICD10Diseases WHERE (ICD10Code LIKE ? ESCAPE '\\' OR DiseaseName LIKE ? ESCAPE '\\') AND IsActive = 1 LIMIT 50")
    .bind(pattern, pattern)
    .all();

  return c.json({ Results: results });
});

// ─── List diagnoses for a patient/visit ─────────────────────────────────────

diagnosisRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  const visitId = c.req.query('visitId');

  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  let query = 'SELECT * FROM ClinicalDiagnosis WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId, Number(patientId)];

  if (visitId) {
    query += ' AND PatientVisitId = ?';
    params.push(Number(visitId));
  }

  query += ' ORDER BY CreatedOn DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// ─── Add diagnosis ──────────────────────────────────────────────────────────

diagnosisRoutes.post('/', zValidator('json', createDiagnosisSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  let icd11Title = data.icd11_title ?? null;

  if (data.icd11_code) {
    const icd11 = await db.$client
      .prepare('SELECT code, title FROM catalog_icd11_mms WHERE code = ? AND is_active = 1')
      .bind(data.icd11_code)
      .first<{ code: string; title: string }>();

    if (!icd11) {
      throw new HTTPException(400, { message: 'Unknown or inactive ICD-11 code' });
    }

    icd11Title = icd11.title;
  }

  const result = await db.$client
    .prepare(`
      INSERT INTO ClinicalDiagnosis (
        tenant_id, PatientId, PatientVisitId, ICD10ID, ICD10Code,
        ICD10Description, icd11_code, icd11_title, DiagnosisType, Notes, CreatedBy, source,
        review_status, reviewed_by, reviewed_at, review_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, data.PatientId, data.PatientVisitId ?? null,
      data.ICD10ID ?? null, data.ICD10Code ?? null,
      data.ICD10Description ?? null, data.icd11_code ?? null, icd11Title,
      data.DiagnosisType, data.Notes ?? null, userId, 'clinician',
      'verified', userId, new Date().toISOString(), null,
    )
    .run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

diagnosisRoutes.put('/:id/review', zValidator('json', clinicalReviewSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  const data = c.req.valid('json');
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid DiagnosisId' });

  const existing = await db.$client
    .prepare('SELECT DiagnosisId FROM ClinicalDiagnosis WHERE DiagnosisId = ? AND tenant_id = ? AND IsActive = 1')
    .bind(id, tenantId)
    .first();
  if (!existing) throw new HTTPException(404, { message: 'Diagnosis not found' });

  await db.$client
    .prepare("UPDATE ClinicalDiagnosis SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ?, ModifiedBy = ?, ModifiedOn = datetime('now', '+6 hours') WHERE DiagnosisId = ? AND tenant_id = ?")
    .bind(data.status, userId, data.notes ?? null, userId, id, tenantId)
    .run();

  return c.json({ Results: { success: true, status: data.status } });
});

// ─── Remove diagnosis (soft delete) ─────────────────────────────────────────

diagnosisRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid DiagnosisId' });

  const existing = await db.$client
    .prepare('SELECT DiagnosisId FROM ClinicalDiagnosis WHERE DiagnosisId = ? AND tenant_id = ? AND IsActive = 1')
    .bind(id, tenantId)
    .first();
  if (!existing) throw new HTTPException(404, { message: 'Diagnosis not found' });

  await db.$client
    .prepare("UPDATE ClinicalDiagnosis SET IsActive = 0, ModifiedBy = ?, ModifiedOn = datetime('now', '+6 hours') WHERE DiagnosisId = ? AND tenant_id = ?")
    .bind(userId, id, tenantId)
    .run();

  return c.json({ Results: true });
});
