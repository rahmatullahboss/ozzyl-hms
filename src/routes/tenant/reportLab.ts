import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireTenantId } from '../../lib/context-helpers';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { calculateGrossProfit } from '../../lib/lab-finance';


const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format, use YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format, use YYYY-MM-DD').optional(),
});

const dateRangeWithLimitSchema = dateRangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const trendSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

const reportLab = new Hono<{ Bindings: Env; Variables: Variables }>();

reportLab.use('*', requireRole('laboratory', 'lab', 'lab_tech', 'doctor', 'md', 'hospital_admin', 'director', 'accountant'));

function n(value: unknown): number {
  return Number(value ?? 0) || 0;
}

// ─── Tests by Category ───────────────────────────────────────────────────────

reportLab.get('/by-category', zValidator('query', dateRangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.valid('query');

  let sql = `
    SELECT
      COALESCE(ltc.category, 'Uncategorized') as category,
      COUNT(loi.id) as test_count,
      SUM(loi.line_total) as revenue,
      SUM(CASE WHEN loi.status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN loi.status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    WHERE lo.tenant_id = ?
      AND COALESCE(loi.status, 'pending') != 'cancelled'
  `;
  const params: (string | number)[] = [tenantId];

  if (startDate) { sql += ' AND lo.order_date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND lo.order_date <= ?'; params.push(endDate); }

  sql += ' GROUP BY category ORDER BY test_count DESC';
  const { results } = await db.$client.prepare(sql).bind(...params).all();

  const totalTests = results.reduce((s: number, r: any) => s + r.test_count, 0);
  const totalRevenue = results.reduce((s: number, r: any) => s + (r.revenue || 0), 0);

  const data = results.map((r: any) => ({
    category_name: r.category,
    category: r.category,
    total_orders: n(r.test_count),
    testCount: n(r.test_count),
    completed_orders: n(r.completed),
    completed: n(r.completed),
    pending_orders: n(r.pending),
    pending: n(r.pending),
    total_revenue: n(r.revenue),
    revenue: n(r.revenue),
    percentage: totalTests > 0 ? parseFloat(((n(r.test_count) / totalTests) * 100).toFixed(1)) : 0,
  }));

  return c.json({
    data,
    categories: data.map((r: any) => ({
      category: r.category,
      testCount: r.testCount,
      revenue: r.revenue,
      completed: r.completed,
      pending: r.pending,
      percentage: r.percentage,
    })),
    totalTests,
    totalRevenue,
  });
});

// ─── Turn-Around Time (TAT) ──────────────────────────────────────────────────

reportLab.get('/tat', zValidator('query', dateRangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.valid('query');

  let sql = `
    SELECT
      ltc.name as test_name,
      ltc.category,
      COUNT(loi.id) as test_count,
      AVG(
        CASE WHEN loi.completed_at IS NOT NULL
          THEN (julianday(loi.completed_at) - julianday(lo.created_at)) * 24
          ELSE NULL
        END
      ) as avg_hours,
      MIN(
        CASE WHEN loi.completed_at IS NOT NULL
          THEN (julianday(loi.completed_at) - julianday(lo.created_at)) * 24
          ELSE NULL
        END
      ) as min_hours,
      MAX(
        CASE WHEN loi.completed_at IS NOT NULL
          THEN (julianday(loi.completed_at) - julianday(lo.created_at)) * 24
          ELSE NULL
        END
      ) as max_hours
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    WHERE lo.tenant_id = ? AND loi.status = 'completed'
  `;
  const params: (string | number)[] = [tenantId];
  if (startDate) { sql += ' AND lo.order_date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND lo.order_date <= ?'; params.push(endDate); }
  sql += ' GROUP BY ltc.id ORDER BY avg_hours DESC';

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  const data = results.map((r: any) => ({
    test_name: r.test_name,
    testName: r.test_name,
    category: r.category,
    order_count: n(r.test_count),
    testCount: n(r.test_count),
    avg_tat_hours: r.avg_hours != null ? parseFloat(Number(r.avg_hours).toFixed(1)) : null,
    avgHours: r.avg_hours != null ? parseFloat(Number(r.avg_hours).toFixed(1)) : null,
    min_tat_hours: r.min_hours != null ? parseFloat(Number(r.min_hours).toFixed(1)) : null,
    minHours: r.min_hours != null ? parseFloat(Number(r.min_hours).toFixed(1)) : null,
    max_tat_hours: r.max_hours != null ? parseFloat(Number(r.max_hours).toFixed(1)) : null,
    maxHours: r.max_hours != null ? parseFloat(Number(r.max_hours).toFixed(1)) : null,
  }));

  return c.json({
    data,
    tests: data.map((r: any) => ({
      testName: r.test_name,
      category: r.category,
      testCount: r.testCount,
      avgHours: r.avgHours,
      minHours: r.minHours,
      maxHours: r.maxHours,
    })),
  });
});

// ─── Top Ordered Tests ───────────────────────────────────────────────────────

reportLab.get('/top-tests', zValidator('query', dateRangeWithLimitSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate, limit } = c.req.valid('query');

  let sql = `
    SELECT
      ltc.name as test_name,
      ltc.code as test_code,
      ltc.category,
      COUNT(loi.id) as order_count,
      SUM(loi.line_total) as revenue
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    WHERE lo.tenant_id = ?
      AND COALESCE(loi.status, 'pending') != 'cancelled'
  `;
  const params: (string | number)[] = [tenantId];
  if (startDate) { sql += ' AND lo.order_date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND lo.order_date <= ?'; params.push(endDate); }
  sql += ` GROUP BY ltc.id ORDER BY order_count DESC LIMIT ?`;
  params.push(limit);

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  const data = results.map((r: any) => ({
    test_name: r.test_name,
    testName: r.test_name,
    test_code: r.test_code,
    testCode: r.test_code,
    category: r.category,
    total_orders: n(r.order_count),
    orderCount: n(r.order_count),
    total_revenue: n(r.revenue),
    revenue: n(r.revenue),
  }));

  return c.json({
    data,
    tests: data.map((r: any) => ({
      testName: r.test_name,
      testCode: r.test_code,
      category: r.category,
      orderCount: r.orderCount,
      revenue: r.revenue,
    })),
  });
});

// ─── Pending vs Completed Trend ──────────────────────────────────────────────

reportLab.get('/trend', zValidator('query', trendSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { days } = c.req.valid('query');

  const sql = `
    SELECT
      lo.order_date as date,
      COUNT(loi.id) as total,
      SUM(CASE WHEN loi.status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN loi.status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    WHERE lo.tenant_id = ?
      AND COALESCE(loi.status, 'pending') != 'cancelled'
      AND lo.order_date >= date('now', '-' || ? || ' days')
    GROUP BY lo.order_date ORDER BY lo.order_date ASC
  `;

  const { results } = await db.$client.prepare(sql).bind(tenantId, days).all();

  const data = results.map((r: any) => ({
    order_date: r.date,
    date: r.date,
    total_orders: n(r.total),
    total: n(r.total),
    completed_orders: n(r.completed),
    completed: n(r.completed),
    pending_orders: n(r.pending),
    pending: n(r.pending),
  }));

  return c.json({
    data,
    trend: data.map((r: any) => ({
      date: r.date,
      total: r.total,
      completed: r.completed,
      pending: r.pending,
    })),
  });
});

// ─── Lab Test Profitability ─────────────────────────────────────────────────

reportLab.get('/profitability', zValidator('query', dateRangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.valid('query');

  let sql = `
    SELECT
      ltc.id as lab_test_id,
      ltc.name as test_name,
      ltc.code as test_code,
      COALESCE(ltc.category, 'Uncategorized') as category,
      COUNT(loi.id) as total_tests,
      COALESCE(SUM(loi.line_total), 0) as revenue,
      COALESCE(SUM(COALESCE((
        SELECT SUM(ici.Quantity * COALESCE(ici.CostPrice, 0))
        FROM InventoryConsumption ic
        JOIN InventoryConsumptionItem ici ON ici.ConsumptionId = ic.ConsumptionId
        WHERE ic.tenant_id = lo.tenant_id
          AND ic.IssueType = 'lab_consumption'
          AND ic.BillingReferenceId = loi.id
        ), (
        SELECT SUM(m.quantity * COALESCE(m.unit_cost, s.purchase_price, lc.unit_price, 0))
        FROM lab_consumable_movements m
        LEFT JOIN lab_consumable_stock s ON s.id = m.stock_id
        LEFT JOIN lab_consumables lc ON lc.id = m.consumable_id
        WHERE m.tenant_id = lo.tenant_id
          AND m.movement_type = 'usage_out'
          AND m.reference_type = 'lab_order_item'
          AND m.reference_id = loi.id
        ), 0)), 0) as consumable_cost,
      COALESCE(SUM(COALESCE((
        SELECT SUM(a.commission_amount)
        FROM doctor_commission_accruals a
        WHERE a.tenant_id = lo.tenant_id
          AND a.lab_order_item_id = loi.id
          AND a.source_type = 'lab_test'
          AND a.status != 'cancelled'
      ), 0)), 0) as doctor_commission
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    WHERE lo.tenant_id = ?
      AND COALESCE(loi.status, 'pending') != 'cancelled'
  `;
  const params: (string | number)[] = [tenantId];
  if (startDate) { sql += ' AND lo.order_date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND lo.order_date <= ?'; params.push(endDate); }
  sql += ' GROUP BY ltc.id ORDER BY revenue DESC';

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  const data = results.map((r: any) => {
    const revenue = n(r.revenue);
    const consumableCost = n(r.consumable_cost);
    const doctorCommission = n(r.doctor_commission);
    const profit = calculateGrossProfit({ revenue, consumableCost, doctorCommission });

    return {
      labTestId: n(r.lab_test_id),
      lab_test_id: n(r.lab_test_id),
      testName: r.test_name,
      test_name: r.test_name,
      testCode: r.test_code,
      test_code: r.test_code,
      category: r.category,
      totalTests: n(r.total_tests),
      total_tests: n(r.total_tests),
      revenue,
      total_revenue: revenue,
      consumableCost,
      consumable_cost: consumableCost,
      doctorCommission,
      doctor_commission: doctorCommission,
      grossProfit: profit.grossProfit,
      gross_profit: profit.grossProfit,
      marginPercent: profit.marginPercent,
      margin_percent: profit.marginPercent,
    };
  });

  const totals = data.reduce((acc, row) => {
    acc.totalTests += row.totalTests;
    acc.revenue += row.revenue;
    acc.consumableCost += row.consumableCost;
    acc.doctorCommission += row.doctorCommission;
    acc.grossProfit += row.grossProfit;
    return acc;
  }, { totalTests: 0, revenue: 0, consumableCost: 0, doctorCommission: 0, grossProfit: 0 });

  return c.json({ data, totals });
});

// ─── Doctor-Wise Lab Finance Summary ────────────────────────────────────────

reportLab.get('/doctor-summary', zValidator('query', dateRangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.valid('query');
  const params: (string | number)[] = [tenantId, tenantId];
  let labDateFilter = '';
  if (startDate) { labDateFilter += ' AND lo.order_date >= ?'; params.push(startDate); }
  if (endDate) { labDateFilter += ' AND lo.order_date <= ?'; params.push(endDate); }

  params.push(tenantId);
  let visitDateFilter = '';
  if (startDate) { visitDateFilter += " AND COALESCE(v.visit_date, date(v.created_at)) >= ?"; params.push(startDate); }
  if (endDate) { visitDateFilter += " AND COALESCE(v.visit_date, date(v.created_at)) <= ?"; params.push(endDate); }

  params.push(tenantId);
  let consultationDateFilter = '';
  if (startDate) { consultationDateFilter += " AND COALESCE(b.bill_date, date(b.created_at)) >= ?"; params.push(startDate); }
  if (endDate) { consultationDateFilter += " AND COALESCE(b.bill_date, date(b.created_at)) <= ?"; params.push(endDate); }

  const sql = `
    WITH doctor_base AS (
      SELECT id, name, specialty
      FROM doctors
      WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1
    ),
    lab_summary AS (
      SELECT
        v.doctor_id,
        COUNT(loi.id) as lab_test_count,
        COALESCE(SUM(loi.line_total), 0) as lab_revenue,
        COALESCE(SUM(COALESCE((
          SELECT SUM(ici.Quantity * COALESCE(ici.CostPrice, 0))
          FROM InventoryConsumption ic
          JOIN InventoryConsumptionItem ici ON ici.ConsumptionId = ic.ConsumptionId
          WHERE ic.tenant_id = lo.tenant_id
            AND ic.IssueType = 'lab_consumption'
            AND ic.BillingReferenceId = loi.id
          ), (
          SELECT SUM(m.quantity * COALESCE(m.unit_cost, s.purchase_price, lc.unit_price, 0))
          FROM lab_consumable_movements m
          LEFT JOIN lab_consumable_stock s ON s.id = m.stock_id
          LEFT JOIN lab_consumables lc ON lc.id = m.consumable_id
          WHERE m.tenant_id = lo.tenant_id
            AND m.movement_type = 'usage_out'
            AND m.reference_type = 'lab_order_item'
            AND m.reference_id = loi.id
          ), 0)), 0) as consumable_cost,
        COALESCE(SUM(COALESCE((
          SELECT SUM(a.commission_amount)
          FROM doctor_commission_accruals a
          WHERE a.tenant_id = lo.tenant_id
            AND a.lab_order_item_id = loi.id
            AND a.source_type = 'lab_test'
            AND a.status != 'cancelled'
        ), 0)), 0) as test_commission
      FROM lab_orders lo
      JOIN visits v ON v.id = lo.visit_id AND v.tenant_id = lo.tenant_id
      JOIN lab_order_items loi ON loi.lab_order_id = lo.id
      WHERE lo.tenant_id = ?
        AND COALESCE(loi.status, 'pending') != 'cancelled'${labDateFilter}
      GROUP BY v.doctor_id
    ),
    visit_summary AS (
      SELECT doctor_id, COUNT(*) as visit_count
      FROM visits v
      WHERE v.tenant_id = ?${visitDateFilter}
      GROUP BY doctor_id
    ),
    consultation_summary AS (
      SELECT
        v.doctor_id,
        COALESCE(SUM(ii.line_total), 0) as consultation_fee_revenue
      FROM bills b
      JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      JOIN invoice_items ii ON ii.bill_id = b.id AND ii.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?${consultationDateFilter}
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND (
          ii.item_category IN ('consultation','doctor_visit','opd','visit')
          OR lower(ii.description) LIKE '%consult%'
          OR lower(ii.description) LIKE '%doctor%'
        )
      GROUP BY v.doctor_id
    )
    SELECT
      db.id as doctor_id,
      db.name as doctor_name,
      db.specialty as specialty,
      COALESCE(vs.visit_count, 0) as visit_count,
      COALESCE(ls.lab_test_count, 0) as lab_test_count,
      COALESCE(ls.lab_revenue, 0) as lab_revenue,
      COALESCE(ls.consumable_cost, 0) as consumable_cost,
      COALESCE(ls.test_commission, 0) as test_commission,
      COALESCE(cs.consultation_fee_revenue, 0) as consultation_fee_revenue
    FROM doctor_base db
    LEFT JOIN lab_summary ls ON ls.doctor_id = db.id
    LEFT JOIN visit_summary vs ON vs.doctor_id = db.id
    LEFT JOIN consultation_summary cs ON cs.doctor_id = db.id
    WHERE COALESCE(vs.visit_count, 0) > 0
       OR COALESCE(ls.lab_test_count, 0) > 0
       OR COALESCE(cs.consultation_fee_revenue, 0) > 0
    ORDER BY lab_revenue DESC, consultation_fee_revenue DESC
  `;

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  const data = results.map((r: any) => {
    const revenue = n(r.lab_revenue);
    const consumableCost = n(r.consumable_cost);
    const doctorCommission = n(r.test_commission);
    const profit = calculateGrossProfit({ revenue, consumableCost, doctorCommission });

    return {
      doctorId: n(r.doctor_id),
      doctor_id: n(r.doctor_id),
      doctorName: r.doctor_name,
      doctor_name: r.doctor_name,
      specialty: r.specialty,
      visitCount: n(r.visit_count),
      visit_count: n(r.visit_count),
      labTestCount: n(r.lab_test_count),
      lab_test_count: n(r.lab_test_count),
      consultationFeeRevenue: n(r.consultation_fee_revenue),
      consultation_fee_revenue: n(r.consultation_fee_revenue),
      labRevenue: revenue,
      lab_revenue: revenue,
      consumableCost,
      consumable_cost: consumableCost,
      testCommission: doctorCommission,
      test_commission: doctorCommission,
      grossProfit: profit.grossProfit,
      gross_profit: profit.grossProfit,
      marginPercent: profit.marginPercent,
      margin_percent: profit.marginPercent,
    };
  });

  return c.json({ data });
});

export default reportLab;
