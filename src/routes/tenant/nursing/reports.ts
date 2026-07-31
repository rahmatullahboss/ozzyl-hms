import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../types';
import { requireTenantId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const nursingReportsRoutes = new Hono<NursingEnv>();

// GET /api/nursing/reports/daily — Daily nursing report
nursingReportsRoutes.get(
  '/daily',
  zValidator('query', z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { date } = c.req.valid('query');

    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;

    // Replaced Promise.all() with db.$client.batch() for nursing daily report stats.
    // Why: Promise.all() sends 6 separate HTTP network requests to Cloudflare D1.
    // Impact: Eliminates 5 network round-trips, significantly reducing latency.
    const batchResults = await db.$client.batch([
      db.$client.prepare(
        `SELECT COUNT(*) as count FROM patient_vitals WHERE tenant_id = ? AND recorded_at BETWEEN ? AND ?`
      ).bind(tenantId, start, end),
      db.$client.prepare(
        `SELECT COUNT(*) as count FROM nur_medication_admin WHERE tenant_id = ? AND status = 'given' AND created_at BETWEEN ? AND ?`
      ).bind(tenantId, start, end),
      db.$client.prepare(
        `SELECT COUNT(*) as count FROM nur_medication_admin WHERE tenant_id = ? AND status IN ('missed', 'refused', 'withheld') AND created_at BETWEEN ? AND ?`
      ).bind(tenantId, start, end),
      db.$client.prepare(
        `SELECT COUNT(*) as count FROM nur_notes WHERE tenant_id = ? AND is_active = 1 AND created_at BETWEEN ? AND ?`
      ).bind(tenantId, start, end),
      db.$client.prepare(
        `SELECT COUNT(*) as count FROM nur_orders WHERE tenant_id = ? AND status = 'acknowledged' AND created_at BETWEEN ? AND ?`
      ).bind(tenantId, start, end),
      db.$client.prepare(
        `SELECT COUNT(*) as count FROM nur_ward_billing_requests WHERE tenant_id = ? AND created_at BETWEEN ? AND ?`
      ).bind(tenantId, start, end),
    ]);

    const vitals = batchResults[0]?.results?.[0] as { count: number } | undefined;
    const medsGiven = batchResults[1]?.results?.[0] as { count: number } | undefined;
    const medsMissed = batchResults[2]?.results?.[0] as { count: number } | undefined;
    const notes = batchResults[3]?.results?.[0] as { count: number } | undefined;
    const orders = batchResults[4]?.results?.[0] as { count: number } | undefined;
    const services = batchResults[5]?.results?.[0] as { count: number } | undefined;

    return c.json({
      Results: {
        vitals_count: vitals?.count ?? 0,
        medications_given: medsGiven?.count ?? 0,
        medications_missed: medsMissed?.count ?? 0,
        notes_count: notes?.count ?? 0,
        orders_acknowledged: orders?.count ?? 0,
        services_added: services?.count ?? 0,
      },
    });
  }
);

// GET /api/nursing/reports/missed-doses — Missed dose report
nursingReportsRoutes.get(
  '/missed-doses',
  zValidator('query', z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { from, to } = c.req.valid('query');

    const start = `${from} 00:00:00`;
    const end = `${to} 23:59:59`;

    const { results } = await db.$client.prepare(`
      SELECT
        ma.id,
        p.name AS patient_name,
        ma.drug_name AS medicine,
        ma.reason,
        ma.created_at AS time
      FROM nur_medication_admin ma
      JOIN patients p ON p.id = ma.patient_id AND p.tenant_id = ma.tenant_id
      WHERE ma.tenant_id = ?
        AND ma.status IN ('missed', 'refused', 'withheld')
        AND ma.created_at BETWEEN ? AND ?
      ORDER BY ma.created_at DESC
      LIMIT 200
    `).bind(tenantId, start, end).all();

    return c.json({ Results: results });
  }
);

// GET /api/nursing/reports/workload — Nurse workload report
nursingReportsRoutes.get(
  '/workload',
  zValidator('query', z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { date } = c.req.valid('query');

    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;

    const { results } = await db.$client.prepare(`
      SELECT
        u.id AS nurse_id,
        COALESCE(u.name, u.username) AS nurse_name,
        COUNT(DISTINCT n.id) AS tasks_completed,
        COUNT(DISTINCT n.patient_id) AS patients_assigned
      FROM users u
      LEFT JOIN nur_notes n ON n.created_by = u.id AND n.tenant_id = ? AND n.is_active = 1 AND n.created_at BETWEEN ? AND ?
      WHERE u.tenant_id = ? AND u.role IN ('nurse', 'ward_nurse', 'nursing_supervisor')
      GROUP BY u.id, u.name, u.username
      HAVING tasks_completed > 0 OR patients_assigned > 0
      ORDER BY patients_assigned DESC
      LIMIT 50
    `).bind(tenantId, start, end, tenantId).all();

    return c.json({ Results: results });
  }
);
