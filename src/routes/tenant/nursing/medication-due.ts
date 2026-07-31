import { Hono } from 'hono';
import type { Env, Variables } from '../../../types';
import { requireTenantId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const medicationDueRoutes = new Hono<NursingEnv>();

medicationDueRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const wardId = c.req.query('ward_id');

  let sql = `
    SELECT
      ma.id AS schedule_id,
      ma.order_id,
      ma.scheduled_time,
      ma.status AS schedule_status,
      mo.medication_name,
      mo.generic_name,
      mo.dose,
      mo.route,
      mo.frequency,
      mo.priority,
      mo.patient_id,
      p.name AS patient_name,
      p.patient_code,
      a.id AS admission_id,
      a.admission_no
    FROM nur_medication_admin ma
    JOIN cln_medication_orders mo ON mo.id = ma.order_id AND mo.tenant_id = ma.tenant_id
    JOIN patients p ON p.id = mo.patient_id AND p.tenant_id = mo.tenant_id
    LEFT JOIN admissions a ON a.patient_id = mo.patient_id AND a.tenant_id = mo.tenant_id AND a.status = 'admitted'
    WHERE ma.tenant_id = ?
      AND ma.status = 'pending'
      AND DATE(ma.scheduled_time) = DATE('now')
      AND mo.status = 'active'
  `;
  const params: (string | number)[] = [tenantId];

  if (wardId) {
    sql += ' AND a.ward_id = ?';
    params.push(wardId);
  }

  sql += ' ORDER BY ms.scheduled_time ASC LIMIT 100';

  try {
    const { results } = await db.$client.prepare(sql).bind(...params).all();

    const now = new Date();
    const enriched = (results || []).map((r: Record<string, unknown>) => {
      const scheduled = new Date(r.scheduled_time as string);
      const diffMinutes = Math.round((scheduled.getTime() - now.getTime()) / 60000);
      return {
        ...r,
        is_overdue: diffMinutes < 0,
        minutes_until_due: diffMinutes,
      };
    });

    const overdue = enriched.filter((r: Record<string, unknown>) => r.is_overdue).length;
    const upcoming = enriched.filter((r: Record<string, unknown>) => !r.is_overdue).length;

    return c.json({ Results: enriched, summary: { overdue, upcoming, total: enriched.length } });
  } catch {
    return c.json({ Results: [], summary: { overdue: 0, upcoming: 0, total: 0 } });
  }
});
