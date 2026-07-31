import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

type QEnv = { Bindings: Env; Variables: Variables };
const kpiRoutes = new Hono<QEnv>();

kpiRoutes.use('/*', requireRole('hospital_admin', 'md', 'director'));

/** GET /dashboard — Compute all quality KPIs in real-time */
kpiRoutes.get('/dashboard', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from_date, to_date } = c.req.query();
  const fromDate = from_date || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const toDate = to_date || new Date().toISOString().split('T')[0];

  // 1. ALOS (Average Length of Stay)
  const alos = await db.$client.prepare(`
    SELECT AVG(CAST((julianday(COALESCE(discharge_date, datetime('now', '+6 hours'))) - julianday(admission_date)) AS REAL)) as avg_los,
           COUNT(*) as total_discharges
    FROM admissions
    WHERE tenant_id = ? AND admission_date >= ? AND admission_date <= ?
      AND status IN ('discharged', 'completed')
  `).bind(tenantId, fromDate, toDate).first() as any;

  // 2. Bed Occupancy Rate
  const beds = await db.$client.prepare(`
    SELECT COUNT(*) as total_beds,
           SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied
    FROM beds WHERE tenant_id = ? AND is_active = 1
  `).bind(tenantId).first() as any;

  // 3. Readmission Rate (within 30 days)
  const readmissions = await db.$client.prepare(`
    SELECT COUNT(DISTINCT a2.id) as readmit_count,
           (SELECT COUNT(*) FROM admissions WHERE tenant_id = ? AND discharge_date >= ? AND discharge_date <= ?) as total_discharges
    FROM admissions a1
    JOIN admissions a2 ON a1.patient_id = a2.patient_id AND a2.id != a1.id
      AND a2.admission_date BETWEEN a1.discharge_date AND date(a1.discharge_date, '+30 days')
    WHERE a1.tenant_id = ? AND a1.discharge_date >= ? AND a1.discharge_date <= ?
  `).bind(tenantId, fromDate, toDate, tenantId, fromDate, toDate).first() as any;

  // 4. OPD vs IPD Patient Volume
  const patientVolume = await db.$client.prepare(`
    SELECT visit_type, COUNT(*) as count
    FROM visits WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?
    GROUP BY visit_type
  `).bind(tenantId, fromDate, toDate).all();

  // 5. Revenue Summary
  const revenue = await db.$client.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as total_billed,
           COALESCE(SUM(paid_amount), 0) as total_collected,
           COALESCE(SUM(total_amount - paid_amount), 0) as outstanding
    FROM billing WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?
  `).bind(tenantId, fromDate, toDate).first() as any;

  // 6. Lab TAT (Average turnaround time)
  const labTat = await db.$client.prepare(`
    SELECT AVG(CAST((julianday(loi.completed_at) - julianday(lo.created_at)) * 24 * 60 AS REAL)) as avg_tat_minutes,
           COUNT(*) as completed_tests
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    WHERE lo.tenant_id = ? AND loi.completed_at IS NOT NULL
      AND lo.created_at >= ? AND lo.created_at <= ?
  `).bind(tenantId, fromDate, toDate).first() as any;

  // 7. Pharmacy Stock Alerts
  const lowStock = await db.$client.prepare(`
    SELECT COUNT(*) as low_stock_items
    FROM pharmacy_items pi
    LEFT JOIN (SELECT item_id, SUM(available_qty) as total_qty FROM pharmacy_stock WHERE tenant_id = ? GROUP BY item_id) ps ON pi.id = ps.item_id
    WHERE pi.tenant_id = ? AND pi.is_active = 1
      AND COALESCE(ps.total_qty, 0) <= pi.reorder_level
  `).bind(tenantId, tenantId).first() as any;

  // 8. Emergency Volume
  const emergencyVolume = await db.$client.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN triage_category IN ('red', 'critical') THEN 1 ELSE 0 END) as critical
    FROM emergency_visits WHERE tenant_id = ? AND arrival_time >= ? AND arrival_time <= ?
  `).bind(tenantId, fromDate, toDate).first().catch(() => ({ total: 0, critical: 0 })) as any;

  // 9. Staff on Duty
  const staffOnDuty = await db.$client.prepare(`
    SELECT COUNT(DISTINCT employee_id) as on_duty
    FROM duty_roster WHERE tenant_id = ? AND shift_date = date('now', '+6 hours')
  `).bind(tenantId).first().catch(() => ({ on_duty: 0 })) as any;

  // 10. Patient Satisfaction (from questionnaires if available)
  const satisfaction = await db.$client.prepare(`
    SELECT AVG(CAST(score AS REAL)) as avg_score, COUNT(*) as responses
    FROM questionnaire_responses
    WHERE tenant_id = ? AND questionnaire_type = 'patient_satisfaction'
      AND created_at >= ? AND created_at <= ?
  `).bind(tenantId, fromDate, toDate).first().catch(() => ({ avg_score: null, responses: 0 })) as any;

  const opdCount = (patientVolume.results || []).find((r: any) => r.visit_type === 'opd') as any;
  const ipdCount = (patientVolume.results || []).find((r: any) => r.visit_type === 'ipd') as any;

  const totalBeds = beds?.total_beds || 0;
  const occupiedBeds = beds?.occupied || 0;
  const totalDischarges = readmissions?.total_discharges || 0;

  return c.json({
    period: { from: fromDate, to: toDate },
    kpis: {
      alos: { value: Math.round((alos?.avg_los || 0) * 10) / 10, unit: 'days', discharges: alos?.total_discharges || 0 },
      bed_occupancy: { value: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0, unit: 'percent', total_beds: totalBeds, occupied: occupiedBeds },
      readmission_rate: { value: totalDischarges > 0 ? Math.round(((readmissions?.readmit_count || 0) / totalDischarges) * 100 * 10) / 10 : 0, unit: 'percent', readmissions: readmissions?.readmit_count || 0 },
      opd_volume: { value: opdCount?.count || 0, unit: 'count' },
      ipd_volume: { value: ipdCount?.count || 0, unit: 'count' },
      revenue: { billed: revenue?.total_billed || 0, collected: revenue?.total_collected || 0, outstanding: revenue?.outstanding || 0, unit: 'bdt' },
      lab_tat: { value: Math.round(labTat?.avg_tat_minutes || 0), unit: 'minutes', completed: labTat?.completed_tests || 0 },
      low_stock_alerts: { value: lowStock?.low_stock_items || 0, unit: 'count' },
      emergency: { total: emergencyVolume?.total || 0, critical: emergencyVolume?.critical || 0 },
      staff_on_duty: { value: staffOnDuty?.on_duty || 0, unit: 'count' },
      patient_satisfaction: { value: satisfaction?.avg_score ? Math.round(satisfaction.avg_score * 10) / 10 : null, responses: satisfaction?.responses || 0, unit: 'score_out_of_5' },
    },
  });
});

/** GET /trends — Historical KPI trends for charting */
kpiRoutes.get('/trends', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { metric, days } = c.req.query();
  const numDays = parseInt(days || '30');

  // Use snapshots if available, else compute from raw data
  if (metric) {
    const { results } = await db.$client.prepare(
      `SELECT snapshot_date, metric_value, department FROM quality_kpi_snapshots
       WHERE tenant_id = ? AND metric_name = ?
       AND snapshot_date >= date('now', '-' || ? || ' days')
       ORDER BY snapshot_date ASC`,
    ).bind(tenantId, metric, numDays).all();
    return c.json({ metric, data: results });
  }

  // Default: daily patient volume for trend
  const { results } = await db.$client.prepare(`
    SELECT date(created_at) as date,
           SUM(CASE WHEN visit_type = 'opd' THEN 1 ELSE 0 END) as opd,
           SUM(CASE WHEN visit_type = 'ipd' THEN 1 ELSE 0 END) as ipd,
           COUNT(*) as total
    FROM visits WHERE tenant_id = ? AND created_at >= date('now', '-' || ? || ' days')
    GROUP BY date(created_at) ORDER BY date ASC
  `).bind(tenantId, numDays).all();

  return c.json({ metric: 'patient_volume', data: results });
});

/** POST /snapshot — Save a KPI snapshot (for cron job use) */
kpiRoutes.post('/snapshot', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = await c.req.json() as any;

  await db.$client.prepare(`
    INSERT INTO quality_kpi_snapshots (snapshot_date, metric_name, metric_value, metric_unit, department, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, snapshot_date, metric_name, department) DO UPDATE SET metric_value = excluded.metric_value
  `).bind(
    data.snapshot_date || new Date().toISOString().split('T')[0],
    data.metric_name, data.metric_value, data.metric_unit ?? null,
    data.department ?? null, tenantId,
  ).run();

  return c.json({ message: 'Snapshot saved' });
});

export default kpiRoutes;
