import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const REPORT_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;

app.use('*', async (c, next) => {
  const role = c.get('role');
  if (!role || !REPORT_ROLES.includes(role as any)) {
    throw new HTTPException(403, { message: 'Not authorized for IPD reports' });
  }
  return next();
});

function getDateRange(c: any): { from: string; to: string } {
  const from = c.req.query('from') || new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10);
  const to = c.req.query('to') || new Date().toISOString().substring(0, 10);
  return { from, to };
}

function getPagination(c: any): { page: number; perPage: number; offset: number } {
  const parsedPage = parseInt(c.req.query('page') || '1', 10);
  const parsedPerPage = parseInt(c.req.query('perPage') || '20', 10);
  const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
  const perPage = Number.isFinite(parsedPerPage) ? Math.min(100, Math.max(1, parsedPerPage)) : 20;
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
}

// ─── GET /admissions — Admission report ─────────────────────────────────────

app.get('/admissions', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from, to } = getDateRange(c);
  const { page, perPage, offset } = getPagination(c);

  const countRow = await db.$client.prepare(`
    SELECT COUNT(*) as total
    FROM admissions a
    WHERE a.tenant_id = ?
      AND date(a.admission_date) BETWEEN ? AND ?
  `).bind(tenantId, from, to).first();

  const total = Number(countRow?.total ?? 0);

  const { results } = await db.$client.prepare(`
    SELECT
      a.id,
      a.admission_no,
      a.admission_type,
      a.is_emergency,
      a.admission_date,
      a.status,
      a.department,
      p.name AS patient_name,
      p.patient_code,
      b.ward_name,
      b.bed_number,
      b.bed_type,
      d.name AS doctor_name
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    WHERE a.tenant_id = ?
      AND date(a.admission_date) BETWEEN ? AND ?
    ORDER BY a.admission_date DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, from, to, perPage, offset).all();

  const summaryRow = await db.$client.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_emergency = 1 THEN 1 ELSE 0 END) as emergency_count,
      SUM(CASE WHEN is_emergency = 0 OR is_emergency IS NULL THEN 1 ELSE 0 END) as planned_count
    FROM admissions
    WHERE tenant_id = ?
      AND date(admission_date) BETWEEN ? AND ?
  `).bind(tenantId, from, to).first();

  return c.json({
    data: results,
    pagination: { page, perPage, total },
    summary: {
      total: Number(summaryRow?.total ?? 0),
      emergency: Number(summaryRow?.emergency_count ?? 0),
      planned: Number(summaryRow?.planned_count ?? 0),
    },
  });
});

// ─── GET /discharges — Discharge report ─────────────────────────────────────

app.get('/discharges', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from, to } = getDateRange(c);
  const { page, perPage, offset } = getPagination(c);

  const countRow = await db.$client.prepare(`
    SELECT COUNT(*) as total
    FROM admissions a
    WHERE a.tenant_id = ?
      AND a.status = 'discharged'
      AND date(a.discharge_date) BETWEEN ? AND ?
  `).bind(tenantId, from, to).first();

  const total = Number(countRow?.total ?? 0);

  const { results } = await db.$client.prepare(`
    SELECT
      a.id,
      a.admission_no,
      a.admission_type,
      a.admission_date,
      a.discharge_date,
      a.department,
      p.name AS patient_name,
      p.patient_code,
      b.ward_name,
      b.bed_number,
      d.name AS doctor_name,
      CAST(julianday(a.discharge_date) - julianday(a.admission_date) AS INTEGER) AS stay_days
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    WHERE a.tenant_id = ?
      AND a.status = 'discharged'
      AND date(a.discharge_date) BETWEEN ? AND ?
    ORDER BY a.discharge_date DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, from, to, perPage, offset).all();

  const summaryRow = await db.$client.prepare(`
    SELECT
      COUNT(*) as total_discharges,
      ROUND(AVG(CAST(julianday(discharge_date) - julianday(admission_date) AS REAL)), 1) AS avg_stay_days
    FROM admissions
    WHERE tenant_id = ?
      AND status = 'discharged'
      AND date(discharge_date) BETWEEN ? AND ?
  `).bind(tenantId, from, to).first();

  return c.json({
    data: results,
    pagination: { page, perPage, total },
    summary: {
      total: Number(summaryRow?.total_discharges ?? 0),
      avg_stay: Number(summaryRow?.avg_stay_days ?? 0),
    },
  });
});

// ─── GET /transfers — Bed transfer report ───────────────────────────────────

app.get('/transfers', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from, to } = getDateRange(c);
  const { page, perPage, offset } = getPagination(c);

  const countRow = await db.$client.prepare(`
    SELECT COUNT(*) as total
    FROM patient_bed_infos pbi
    WHERE pbi.tenant_id = ?
      AND date(pbi.started_on) BETWEEN ? AND ?
  `).bind(tenantId, from, to).first();

  const total = Number(countRow?.total ?? 0);

  const { results } = await db.$client.prepare(`
    SELECT
      pbi.id,
      pbi.patient_id,
      pbi.admission_id,
      pbi.ward_name,
      pbi.bed_number,
      pbi.bed_type,
      pbi.rate_per_day,
      pbi.started_on AS check_in,
      pbi.ended_on AS check_out,
      pbi.days,
      p.name AS patient_name,
      p.patient_code,
      a.admission_no
    FROM patient_bed_infos pbi
    LEFT JOIN patients p ON pbi.patient_id = p.id AND p.tenant_id = pbi.tenant_id
    LEFT JOIN admissions a ON pbi.admission_id = a.id AND a.tenant_id = pbi.tenant_id
    WHERE pbi.tenant_id = ?
      AND date(pbi.started_on) BETWEEN ? AND ?
    ORDER BY pbi.started_on DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, from, to, perPage, offset).all();

  return c.json({
    data: results,
    pagination: { page, perPage, total },
  });
});

// ─── GET /revenue — IPD revenue report ──────────────────────────────────────

app.get('/revenue', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from, to } = getDateRange(c);

  const canonicalChargeSource = `
    SELECT
      admission_id,
      COALESCE(item_category, 'service') AS type,
      total_amount AS amount,
      created_at
    FROM billing_provisional_items
    WHERE tenant_id = ?
      AND admission_id IS NOT NULL
      AND is_active = 1
      AND COALESCE(bill_status, 'provisional') != 'cancelled'
      AND date(created_at) BETWEEN ? AND ?
    UNION ALL
    SELECT
      admission_id,
      'bed_charge' AS type,
      charge_amount AS amount,
      COALESCE(ended_on, started_on, created_at) AS created_at
    FROM patient_bed_infos
    WHERE tenant_id = ?
      AND COALESCE(charge_amount, 0) > 0
      AND date(COALESCE(ended_on, started_on, created_at)) BETWEEN ? AND ?
  `;

  const chargeParams = [tenantId, from, to, tenantId, from, to];

  const byChargeType = await db.$client.prepare(`
    SELECT
      type,
      COUNT(*) as count,
      COALESCE(SUM(amount), 0) as amount
    FROM (${canonicalChargeSource}) charges
    GROUP BY type
    ORDER BY amount DESC
  `).bind(...chargeParams).all();

  const byWard = await db.$client.prepare(`
    SELECT
      COALESCE(b.ward_name, a.department, 'Unassigned') AS ward_name,
      COALESCE(SUM(charges.amount), 0) as amount
    FROM (${canonicalChargeSource}) charges
    JOIN admissions a ON charges.admission_id = a.id AND a.tenant_id = ?
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    GROUP BY COALESCE(b.ward_name, a.department, 'Unassigned')
    ORDER BY amount DESC
  `).bind(...chargeParams, tenantId).all();

  const dailyTrend = await db.$client.prepare(`
    SELECT
      date(created_at) as charge_date,
      COALESCE(SUM(amount), 0) as daily_amount,
      COUNT(*) as charge_count
    FROM (${canonicalChargeSource}) charges
    GROUP BY date(created_at)
    ORDER BY charge_date ASC
  `).bind(...chargeParams).all();

  const totalRow = await db.$client.prepare(`
    SELECT
      COUNT(*) as total_charges,
      COALESCE(SUM(amount), 0) as total_revenue
    FROM (${canonicalChargeSource}) charges
  `).bind(...chargeParams).first();

  return c.json({
    total_revenue: Number(totalRow?.total_revenue ?? 0),
    by_type: byChargeType.results,
    by_ward: byWard.results,
    daily: dailyTrend.results,
  });
});

// ─── GET /ward-patients — Ward-wise patient count ───────────────────────────

app.get('/ward-patients', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(`
    SELECT
      b.ward_name,
      COUNT(*) as total_beds,
      SUM(CASE WHEN b.status = 'occupied' THEN 1 ELSE 0 END) as occupied_beds
    FROM beds b
    WHERE b.tenant_id = ?
    GROUP BY b.ward_name
    ORDER BY b.ward_name
  `).bind(tenantId).all();

  const wards = (results as any[]).map((row: any) => {
    const total = Number(row.total_beds ?? 0);
    const occupied = Number(row.occupied_beds ?? 0);
    return {
      ward_name: row.ward_name,
      total_beds: total,
      occupied,
      available: total - occupied,
      occupancy_pct: total > 0 ? Math.round((occupied / total) * 100) : 0,
    };
  });

  return c.json({ wards });
});

export default app;
