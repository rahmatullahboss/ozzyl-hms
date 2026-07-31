import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { getPagination, paginationMeta } from '../../lib/pagination';

const agingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const AGING_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

agingRoutes.use('*', requireRole(...AGING_ROLES));

// ─── GET /report — Aging summary with buckets ───────────────────────────────

agingRoutes.get('/report', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const row = await db.$client.prepare(`
      SELECT
        COUNT(*) as total_bills,
        COALESCE(SUM(due), 0) as total_due,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) <= 30 THEN due ELSE 0 END), 0) as current_due,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 30 AND julianday('now') - julianday(created_at) <= 60 THEN due ELSE 0 END), 0) as days_30_due,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 60 AND julianday('now') - julianday(created_at) <= 90 THEN due ELSE 0 END), 0) as days_60_due,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 90 AND julianday('now') - julianday(created_at) <= 120 THEN due ELSE 0 END), 0) as days_90_due,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 120 THEN due ELSE 0 END), 0) as days_120_plus_due
      FROM bills
      WHERE tenant_id = ? AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft', 'paid')
        AND COALESCE(due, 0) > 0
    `).bind(tenantId).first<{
      total_bills: number;
      total_due: number;
      current_due: number;
      days_30_due: number;
      days_60_due: number;
      days_90_due: number;
      days_120_plus_due: number;
    }>();

    return c.json({
      total_bills: Number(row?.total_bills ?? 0),
      total_due: Number(row?.total_due ?? 0),
      current_due: Number(row?.current_due ?? 0),
      days_30_due: Number(row?.days_30_due ?? 0),
      days_60_due: Number(row?.days_60_due ?? 0),
      days_90_due: Number(row?.days_90_due ?? 0),
      days_120_plus_due: Number(row?.days_120_plus_due ?? 0),
    });
  } catch (error) {
    console.error('billing aging report error:', error);
    throw new HTTPException(500, { message: 'Failed to generate aging report' });
  }
});

// ─── GET /patients — Patient-wise aging details (paginated) ─────────────────

agingRoutes.get('/patients', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, offset } = getPagination(c);

  try {
    const countResult = await db.$client.prepare(`
      SELECT COUNT(DISTINCT patient_id) as total
      FROM bills
      WHERE tenant_id = ? AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft', 'paid')
        AND COALESCE(due, 0) > 0
    `).bind(tenantId).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const { results } = await db.$client.prepare(`
      SELECT
        b.patient_id,
        p.name as patient_name,
        p.patient_code,
        COUNT(*) as total_bills,
        COALESCE(SUM(b.due), 0) as total_due,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(b.created_at) <= 30 THEN b.due ELSE 0 END), 0) as current_due,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(b.created_at) > 30 AND julianday('now') - julianday(b.created_at) <= 60 THEN b.due ELSE 0 END), 0) as days_30_due,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(b.created_at) > 60 AND julianday('now') - julianday(b.created_at) <= 90 THEN b.due ELSE 0 END), 0) as days_60_due,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(b.created_at) > 90 AND julianday('now') - julianday(b.created_at) <= 120 THEN b.due ELSE 0 END), 0) as days_90_due,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(b.created_at) > 120 THEN b.due ELSE 0 END), 0) as days_120_plus_due
      FROM bills b
      LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      WHERE b.tenant_id = ? AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft', 'paid')
        AND COALESCE(b.due, 0) > 0
      GROUP BY b.patient_id
      ORDER BY total_due DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, limit, offset).all<{
      patient_id: number;
      patient_name: string | null;
      patient_code: string | null;
      total_bills: number;
      total_due: number;
      current_due: number;
      days_30_due: number;
      days_60_due: number;
      days_90_due: number;
      days_120_plus_due: number;
    }>();

    return c.json({
      patients: results,
      meta: paginationMeta(page, limit, total),
    });
  } catch (error) {
    console.error('billing aging patients error:', error);
    throw new HTTPException(500, { message: 'Failed to generate patient aging report' });
  }
});

export default agingRoutes;
