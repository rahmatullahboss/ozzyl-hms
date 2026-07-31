import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { unmergeSchema } from '../../schemas/mpi';
import { requireRole } from '../../middleware/rbac';
import {
  applyMerge,
  countReferenceRows,
  previewMerge,
  rollbackMerge,
} from '../../lib/mpi-merge';
import { recordMergeAudit } from '../../lib/portal-consent-audit';

const duplicates = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Find Duplicates ─────────────────────────────────────────────────────────

// GET /api/patient-duplicates/scan — Find potential duplicate patients
duplicates.get('/scan', zValidator('query', z.object({
  method: z.enum(['phone', 'nid', 'name_dob', 'auto']).default('auto'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { method, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;
  const db = getDb(c.env.DB);

  let query = '';

  if (method === 'phone' || method === 'auto') {
    query = `
      SELECT p1.id as id1, p1.name as name1, p1.patient_code as code1, p1.mobile as phone1,
             p2.id as id2, p2.name as name2, p2.patient_code as code2, p2.mobile as phone2,
             'phone' as match_type, 100 as confidence
      FROM patients p1
      JOIN patients p2 ON p1.mobile = p2.mobile AND p1.tenant_id = p2.tenant_id AND p1.id < p2.id
      WHERE p1.tenant_id = ? AND p1.mobile IS NOT NULL AND p1.mobile != ''
      ORDER BY p1.mobile
      LIMIT ? OFFSET ?
    `;
  } else if (method === 'nid') {
    query = `
      SELECT p1.id as id1, p1.name as name1, p1.patient_code as code1, p1.national_id as nid1,
             p2.id as id2, p2.name as name2, p2.patient_code as code2, p2.national_id as nid2,
             'nid' as match_type, 100 as confidence
      FROM patients p1
      JOIN patients p2 ON p1.national_id = p2.national_id AND p1.tenant_id = p2.tenant_id AND p1.id < p2.id
      WHERE p1.tenant_id = ? AND p1.national_id IS NOT NULL AND p1.national_id != ''
      ORDER BY p1.national_id
      LIMIT ? OFFSET ?
    `;
  } else if (method === 'name_dob') {
    query = `
      SELECT p1.id as id1, p1.name as name1, p1.patient_code as code1, p1.date_of_birth as dob1,
             p2.id as id2, p2.name as name2, p2.patient_code as code2, p2.date_of_birth as dob2,
             'name_dob' as match_type, 90 as confidence
      FROM patients p1
      JOIN patients p2 ON LOWER(p1.name) = LOWER(p2.name) AND p1.date_of_birth = p2.date_of_birth
        AND p1.tenant_id = p2.tenant_id AND p1.id < p2.id
      WHERE p1.tenant_id = ? AND p1.date_of_birth IS NOT NULL
      ORDER BY p1.name
      LIMIT ? OFFSET ?
    `;
  }

  if (!query) return c.json({ data: [], pagination: { page, limit, total: 0 } });

  const { results } = await db.$client.prepare(query).bind(tenantId, limit, offset).all();
  return c.json({ data: results ?? [], pagination: { page, limit, total: (results ?? []).length } });
});

// ─── Compare Two Patients ────────────────────────────────────────────────────

duplicates.get('/compare', zValidator('query', z.object({
  id1: z.coerce.number().int().positive(),
  id2: z.coerce.number().int().positive(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const { id1, id2 } = c.req.valid('query');
  const db = getDb(c.env.DB);

  const [p1, p2] = await Promise.all([
    db.$client.prepare('SELECT * FROM patients WHERE id = ? AND tenant_id = ?').bind(id1, tenantId).first(),
    db.$client.prepare('SELECT * FROM patients WHERE id = ? AND tenant_id = ?').bind(id2, tenantId).first(),
  ]);

  if (!p1 || !p2) throw new HTTPException(404, { message: 'One or both patients not found' });

  const countRecords = async (patientId: number) => {
    const rows = await countReferenceRows(c.env.DB, tenantId, patientId);
    return Object.fromEntries(rows.map((row) => [row.table, row.count]));
  };

  const [records1, records2] = await Promise.all([countRecords(id1), countRecords(id2)]);

  return c.json({
    patient1: { ...p1, record_counts: records1, total_records: Object.values(records1).reduce((s, v) => s + v, 0) },
    patient2: { ...p2, record_counts: records2, total_records: Object.values(records2).reduce((s, v) => s + v, 0) },
  });
});

// ─── Merge Preview (P0-10 fix/portal-consent) ────────────────────────────────
//
// Returns a frozen diff + a one-time confirmation token. Apply requires
// the token and runs the merge inside a single D1 batch (transactional
// boundary). Idempotent: same request body returns the same preview.

const previewMergeSchema = z.object({
  primary_id: z.number().int().positive(),
  secondary_id: z.number().int().positive(),
  merge_reason: z.string().min(1).max(500),
});

duplicates.post('/preview-merge', requireRole('hospital_admin', 'md', 'super_admin'),
  zValidator('json', previewMergeSchema), async (c) => {
    const tenantId = requireTenantId(c);
    const userId = Number(requireUserId(c));
    const { primary_id, secondary_id, merge_reason } = c.req.valid('json');

    try {
      const preview = await previewMerge(c.env.DB, {
        tenantId,
        userId,
        primaryPatientId: primary_id,
        secondaryPatientId: secondary_id,
        mergeReason: merge_reason,
        ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? undefined,
        userAgent: c.req.header('User-Agent') ?? undefined,
      });
      return c.json({ ...preview, status: 'preview_ready' });
    } catch (err: any) {
      await recordMergeAudit(c.env.DB, {
        tenantId,
        action: 'apply_failed',
        primaryPatientId: primary_id,
        secondaryPatientId: secondary_id,
        actorUserId: userId,
        payload: { stage: 'preview', error: err?.message ?? 'unknown' },
      });
      throw new HTTPException(400, { message: err?.message ?? 'Preview failed' });
    }
  });

// ─── Merge Apply (P0-10 fix/portal-consent) ──────────────────────────────────
//
// Requires the confirmation_token returned from /preview-merge. Runs the
// full merge in a single D1 batch; idempotent on token replay.

const applyMergeSchema = z.object({
  confirmation_token: z.string().min(8),
});

duplicates.post('/apply-merge', requireRole('hospital_admin', 'md', 'super_admin'),
  zValidator('json', applyMergeSchema), async (c) => {
    const tenantId = requireTenantId(c);
    const userId = Number(requireUserId(c));
    const { confirmation_token } = c.req.valid('json');

    try {
      const result = await applyMerge(c.env.DB, {
        tenantId,
        userId,
        confirmationToken: confirmation_token,
        ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? undefined,
        userAgent: c.req.header('User-Agent') ?? undefined,
      });
      return c.json(result, 201);
    } catch (err: any) {
      throw new HTTPException(400, { message: err?.message ?? 'Apply failed' });
    }
  });

// ─── Merge Patients (P0-10 fix/portal-consent) ───────────────────────────────
//
// Backwards-compatible immediate merge. Internally calls preview+apply
// back-to-back (no human confirmation token required) so existing callers
// continue to work, but it is now transactional and audited.

duplicates.post('/merge', requireRole('hospital_admin', 'md', 'super_admin'), zValidator('json', z.object({
  primary_id: z.number().int().positive(),
  secondary_id: z.number().int().positive(),
  merge_reason: z.string().min(1),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const { primary_id, secondary_id, merge_reason } = c.req.valid('json');

  if (primary_id === secondary_id) {
    throw new HTTPException(400, { message: 'Cannot merge patient with itself' });
  }

  try {
    const preview = await previewMerge(c.env.DB, {
      tenantId,
      userId,
      primaryPatientId: primary_id,
      secondaryPatientId: secondary_id,
      mergeReason: merge_reason,
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? undefined,
      userAgent: c.req.header('User-Agent') ?? undefined,
    });
    const result = await applyMerge(c.env.DB, {
      tenantId,
      userId,
      confirmationToken: preview.confirmation_token,
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? undefined,
      userAgent: c.req.header('User-Agent') ?? undefined,
    });

    return c.json({
      message: `Patient #${secondary_id} merged into #${primary_id}`,
      tables_updated: Object.fromEntries(result.rows_moved.map((r) => [r.table, r.count])),
      total_records_moved: result.total_rows_moved,
      merge_log_id: result.merge_log_id,
      outcome: result.outcome,
    });
  } catch (err: any) {
    const message = err?.message ?? 'Merge failed';
    const status = /patient .*not found/i.test(message) ? 404 : 400;
    throw new HTTPException(status, { message });
  }
});

// ─── Merge History ───────────────────────────────────────────────────────────

duplicates.get('/history', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const { results } = await db.$client.prepare(`
    SELECT ml.*, p.name as primary_name, p.patient_code as primary_code
    FROM patient_merge_log ml
    LEFT JOIN patients p ON ml.primary_patient_id = p.id
    WHERE ml.tenant_id = ?
    ORDER BY ml.merged_at DESC LIMIT 50
  `).bind(tenantId).all();

  return c.json({ data: results ?? [] });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

duplicates.get('/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const phoneDups = await db.$client.prepare(`
    SELECT COUNT(*) as cnt FROM (
      SELECT mobile FROM patients WHERE tenant_id = ? AND mobile IS NOT NULL AND mobile != ''
      GROUP BY mobile HAVING COUNT(*) > 1
    )
  `).bind(tenantId).first<{ cnt: number }>();

  const nidDups = await db.$client.prepare(`
    SELECT COUNT(*) as cnt FROM (
      SELECT national_id FROM patients WHERE tenant_id = ? AND national_id IS NOT NULL AND national_id != ''
      GROUP BY national_id HAVING COUNT(*) > 1
    )
  `).bind(tenantId).first<{ cnt: number }>();

  const totalMerges = await db.$client.prepare('SELECT COUNT(*) as cnt FROM patient_merge_log WHERE tenant_id = ?').bind(tenantId).first<{ cnt: number }>();

  return c.json({ duplicate_phones: phoneDups?.cnt ?? 0, duplicate_nids: nidDups?.cnt ?? 0, total_merges: totalMerges?.cnt ?? 0 });
});

// ─── Unmerge (Reverse a Previous Merge) ─────────────────────────────────────

duplicates.post('/unmerge', requireRole('hospital_admin', 'md', 'super_admin'), zValidator('json', unmergeSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const { merge_log_id, unmerge_reason } = c.req.valid('json');

  try {
    const result = await rollbackMerge(c.env.DB, tenantId, merge_log_id, userId, unmerge_reason,
      c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? undefined,
      c.req.header('User-Agent') ?? undefined,
    );
    return c.json({
      message: `Merge #${merge_log_id} reversed`,
      tables_reverted: result.tables_reverted,
      total_records_moved_back: Object.values(result.tables_reverted).reduce((s, v) => s + v, 0),
    });
  } catch (err: any) {
    await recordMergeAudit(c.env.DB, {
      tenantId,
      action: 'unmerge_failed',
      mergeLogId: merge_log_id,
      actorUserId: userId,
      payload: { error: err?.message ?? 'unknown' },
    });
    const status = err?.message === 'Merge log not found' ? 404 : 400;
    throw new HTTPException(status, { message: err?.message ?? 'Unmerge failed' });
  }
});

// ─── Audit history (for compliance) ─────────────────────────────────────────

duplicates.get('/audit', requireRole('hospital_admin', 'md', 'super_admin'), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const { results } = await db.$client.prepare(`
    SELECT * FROM patient_merge_audit
    WHERE tenant_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).bind(tenantId, limit).all();
  return c.json({ data: results ?? [] });
});

export default duplicates;
