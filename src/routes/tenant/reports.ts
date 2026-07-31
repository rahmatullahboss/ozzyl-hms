import { Hono, type Context } from 'hono';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import {
  getGlBreakdown,
  getGlIncomeExpenseTotals,
  getGlMonthlyIncomeExpense,
} from '../../lib/accounting-reporting';
import { requireRole } from '../../middleware/rbac';


type ReportsEnv = {
  Bindings: {
    DB: D1Database;
    KV: KVNamespace;
    UPLOADS: R2Bucket;
    ENVIRONMENT: string;
  };
  Variables: {
    tenantId: string;
    userId: string;
    role: string;
  };
};

const reportsRoutes = new Hono<ReportsEnv>();
const REPORT_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

function roundMoney(value: number): number {
  const numeric = Number(value || 0);
  const sign = numeric < 0 ? -1 : 1;
  const absolute = Math.abs(numeric);
  return sign * Number(`${Math.round(Number(`${absolute}e2`))}e-2`);
}

function lastDayOfMonth(targetMonth: string): string {
  const [year, month] = targetMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${targetMonth}-${String(lastDay).padStart(2, '0')}`;
}

reportsRoutes.use('*', requireRole(...REPORT_ROLES));

reportsRoutes.get('/pl', async (c) => {
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.query();

  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400);
  }
  if (startDate > endDate) {
    return c.json({ error: 'startDate must be on or before endDate' }, 400);
  }

  try {
    const [incomeRows, expenseRows, totals] = await Promise.all([
      getGlBreakdown(c.env.DB, tenantId, startDate, endDate, 'revenue'),
      getGlBreakdown(c.env.DB, tenantId, startDate, endDate, 'expense'),
      getGlIncomeExpenseTotals(c.env.DB, tenantId, startDate, endDate),
    ]);

    return c.json({
      period: { startDate, endDate },
      income: {
        items: incomeRows.map(row => ({ source: row.name, total: row.amount })),
        total: totals.income
      },
      expenses: {
        items: expenseRows.map(row => ({ category: row.name, total: row.amount })),
        total: totals.expense
      },
      netProfit: totals.profit,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating P&L:', error);
    return c.json({ error: 'Failed to generate P&L report' }, 500);
  }
});

reportsRoutes.get('/income-by-source', async (c) => {
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.query();

  try {
    const rows = await getGlBreakdown(c.env.DB, tenantId, startDate || '1970-01-01', endDate || '2099-12-31', 'revenue');
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    const breakdown = rows.map(r => ({
      source: r.name,
      amount: r.amount,
      count: r.count,
      percentage: total > 0 ? (r.amount / total * 100).toFixed(1) : '0'
    }));

    return c.json({ breakdown, total });
  } catch (error) {
    console.error('Error generating income report:', error);
    return c.json({ error: 'Failed to generate income report' }, 500);
  }
});

reportsRoutes.get('/expense-by-category', async (c) => {
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.query();

  try {
    const rows = await getGlBreakdown(c.env.DB, tenantId, startDate || '1970-01-01', endDate || '2099-12-31', 'expense');
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    const breakdown = rows.map(r => ({
      category: r.name,
      amount: r.amount,
      count: r.count,
      percentage: total > 0 ? (r.amount / total * 100).toFixed(1) : '0'
    }));

    return c.json({ breakdown, total });
  } catch (error) {
    console.error('Error generating expense report:', error);
    return c.json({ error: 'Failed to generate expense report' }, 500);
  }
});

reportsRoutes.get('/monthly', async (c) => {
  const tenantId = requireTenantId(c);
  const { year } = c.req.query();
  const targetYear = year || new Date().getFullYear().toString();

  try {
    const start = `${targetYear}-01-01`;
    const endExclusive = `${parseInt(targetYear, 10) + 1}-01-01`;
    const postedRows = await getGlMonthlyIncomeExpense(c.env.DB, tenantId, start, endExclusive);
    const rowsByMonth = new Map(postedRows.map(row => [row.month, row]));
    const monthlyData = Array.from({ length: 12 }, (_, index) => {
      const month = `${targetYear}-${String(index + 1).padStart(2, '0')}`;
      return rowsByMonth.get(month) ?? { month, income: 0, expense: 0, profit: 0 };
    });

    const yearlyTotal = monthlyData.reduce((sum, m) => sum + m.income, 0);
    const yearlyExpense = monthlyData.reduce((sum, m) => sum + m.expense, 0);

    return c.json({
      year: targetYear,
      monthly: monthlyData,
      summary: {
        totalIncome: yearlyTotal,
        totalExpense: yearlyExpense,
        netProfit: yearlyTotal - yearlyExpense
      }
    });
  } catch (error) {
    console.error('Error generating monthly report:', error);
    return c.json({ error: 'Failed to generate monthly report' }, 500);
  }
});

// ─── Advanced Reporting Endpoints ─────────────────────────────────────────────

reportsRoutes.get('/bed-occupancy', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const total = await db.$client.prepare(
      `SELECT COUNT(*) as total FROM beds WHERE tenant_id = ?`
    ).bind(tenantId).first<{ total: number }>();

    const occupied = await db.$client.prepare(
      `SELECT COUNT(*) as occupied FROM beds WHERE tenant_id = ? AND status = 'occupied'`
    ).bind(tenantId).first<{ occupied: number }>();

    const byWard = await db.$client.prepare(`
      SELECT ward_name as ward, COUNT(*) as total,
        SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied
      FROM beds WHERE tenant_id = ?
      GROUP BY ward_name ORDER BY ward_name
    `).bind(tenantId).all<{ ward: string; total: number; occupied: number }>();

    const totalBeds = total?.total ?? 0;
    const occupiedBeds = occupied?.occupied ?? 0;
    const rate = totalBeds > 0 ? ((occupiedBeds / totalBeds) * 100).toFixed(1) : '0';

    return c.json({
      totalBeds,
      occupiedBeds,
      availableBeds: totalBeds - occupiedBeds,
      occupancyRate: parseFloat(rate),
      byWard: byWard.results.map(w => ({
        ward: w.ward,
        total: w.total,
        occupied: w.occupied,
        available: w.total - w.occupied,
        rate: w.total > 0 ? parseFloat(((w.occupied / w.total) * 100).toFixed(1)) : 0,
      })),
    });
  } catch (error) {
    console.error('Error generating bed occupancy:', error);
    return c.json({ error: 'Failed to generate bed occupancy report' }, 500);
  }
});

reportsRoutes.get('/avg-length-of-stay', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.query();
  try {
    let query = `
      SELECT
        'General' as department,
        COUNT(*) as total_admissions,
        AVG(julianday(COALESCE(a.discharge_date, date('now', '+6 hours'))) - julianday(a.admission_date)) as avg_days
      FROM admissions a
      WHERE a.tenant_id = ?
    `;
    const params: (string | number)[] = [tenantId];

    if (startDate) { query += ' AND a.admission_date >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND a.admission_date <= ?'; params.push(endDate); }

    query += ' GROUP BY department ORDER BY avg_days DESC';

    const result = await db.$client.prepare(query).bind(...params)
      .all<{ department: string; total_admissions: number; avg_days: number }>();

    const overall = result.results.reduce((acc, r) => ({
      admissions: acc.admissions + r.total_admissions,
      totalDays: acc.totalDays + r.avg_days * r.total_admissions,
    }), { admissions: 0, totalDays: 0 });

    return c.json({
      overallAvgDays: overall.admissions > 0
        ? parseFloat((overall.totalDays / overall.admissions).toFixed(1))
        : 0,
      totalAdmissions: overall.admissions,
      byDepartment: result.results.map(r => ({
        department: r.department,
        totalAdmissions: r.total_admissions,
        avgDays: parseFloat((r.avg_days ?? 0).toFixed(1)),
      })),
    });
  } catch (error) {
    console.error('Error generating ALOS:', error);
    return c.json({ error: 'Failed to generate average length of stay report' }, 500);
  }
});

reportsRoutes.get('/refunds', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate, sourceType } = c.req.query();
  const patientIdRaw = c.req.query('patientId') ?? c.req.query('patient_id');
  const validSourceTypes = new Set(['credit_note', 'deposit_refund', 'pharmacy_return']);

  if (startDate && endDate && startDate > endDate) {
    return c.json({ error: 'startDate must be on or before endDate' }, 400);
  }
  if (sourceType && !validSourceTypes.has(sourceType)) {
    return c.json({ error: 'Invalid refund sourceType' }, 400);
  }
  const patientId = patientIdRaw ? Number(patientIdRaw) : null;
  if (patientIdRaw && (!Number.isInteger(patientId) || Number(patientId) <= 0)) {
    return c.json({ error: 'patientId must be a positive integer' }, 400);
  }

  try {
    let whereSql = '1 = 1';
    const params: (string | number)[] = [tenantId, tenantId, tenantId];

    if (startDate) { whereSql += ' AND date(refund_date) >= date(?)'; params.push(startDate); }
    if (endDate) { whereSql += ' AND date(refund_date) <= date(?)'; params.push(endDate); }
    if (patientId) { whereSql += ' AND patient_id = ?'; params.push(patientId); }
    if (sourceType) { whereSql += ' AND source_type = ?'; params.push(sourceType); }

    const refundSql = `
      WITH refund_rows AS (
        SELECT
          'credit_note' as source_type,
          cn.id as source_id,
          cn.credit_note_no as refund_no,
          cn.created_at as refund_date,
          cn.patient_id,
          p.name as patient_name,
          p.patient_code,
          b.invoice_no,
          cn.reason,
          COALESCE(cn.refund_amount, cn.total_amount, 0) as amount,
          COALESCE((
            SELECT SUM(ect.amount)
            FROM emp_cash_transactions ect
            WHERE ect.tenant_id = cn.tenant_id
              AND ect.reference_type = 'credit_note'
              AND ect.reference_id = cn.id
              AND ect.transaction_type = 'SalesReturn'
          ), 0) as cash_amount,
          cn.payment_mode as payment_method
        FROM billing_credit_notes cn
        LEFT JOIN patients p
          ON p.id = cn.patient_id
          AND p.tenant_id = cn.tenant_id
        LEFT JOIN bills b
          ON b.id = cn.bill_id
          AND b.tenant_id = cn.tenant_id
        WHERE cn.tenant_id = ?
          AND cn.is_active = 1

        UNION ALL

        SELECT
          'deposit_refund' as source_type,
          d.id as source_id,
          d.deposit_receipt_no as refund_no,
          d.created_at as refund_date,
          d.patient_id,
          p.name as patient_name,
          p.patient_code,
          NULL as invoice_no,
          d.remarks as reason,
          COALESCE(d.amount, 0) as amount,
          COALESCE((
            SELECT SUM(ect.amount)
            FROM emp_cash_transactions ect
            WHERE ect.tenant_id = d.tenant_id
              AND ect.reference_type = 'deposit_refund'
              AND ect.reference_id = d.id
              AND ect.transaction_type = 'ReturnDeposit'
          ), 0) as cash_amount,
          d.payment_method
        FROM billing_deposits d
        LEFT JOIN patients p
          ON p.id = d.patient_id
          AND p.tenant_id = d.tenant_id
        WHERE d.tenant_id = ?
          AND d.is_active = 1
          AND d.transaction_type = 'refund'

        UNION ALL

        SELECT
          'pharmacy_return' as source_type,
          pr.id as source_id,
          pr.return_no as refund_no,
          pr.created_at as refund_date,
          pr.patient_id,
          p.name as patient_name,
          p.patient_code,
          ps.invoice_no,
          pr.remarks as reason,
          COALESCE(pr.total_return_amount, 0) as amount,
          COALESCE((
            SELECT SUM(ect.amount)
            FROM emp_cash_transactions ect
            WHERE ect.tenant_id = pr.tenant_id
              AND ect.reference_type = 'pharmacy_return'
              AND ect.reference_id = pr.id
              AND ect.transaction_type = 'SalesReturn'
          ), 0) as cash_amount,
          pr.payment_method
        FROM pharmacy_returns pr
        LEFT JOIN pharmacy_sales ps
          ON ps.id = pr.sale_invoice_id
          AND ps.tenant_id = pr.tenant_id
        LEFT JOIN patients p
          ON p.id = pr.patient_id
          AND p.tenant_id = pr.tenant_id
        WHERE pr.tenant_id = ?
      )
      SELECT *
      FROM refund_rows
      WHERE ${whereSql}
      ORDER BY refund_date DESC, source_id DESC
    `;

    let cashWhereSql = `
      ect.tenant_id = ?
      AND ect.transaction_type IN ('SalesReturn', 'ReturnDeposit')
    `;
    const cashParams: (string | number)[] = [tenantId];
    if (startDate) { cashWhereSql += ' AND date(ect.transaction_date) >= date(?)'; cashParams.push(startDate); }
    if (endDate) { cashWhereSql += ' AND date(ect.transaction_date) <= date(?)'; cashParams.push(endDate); }
    if (sourceType) { cashWhereSql += ' AND ect.reference_type = ?'; cashParams.push(sourceType); }

    // Replaced Promise.all() with db.$client.batch() for refund reporting.
    // Why: Promise.all() sends 2 separate HTTP network requests to Cloudflare D1.
    const batchRefundResults = await db.$client.batch([
      db.$client.prepare(refundSql).bind(...params),
      db.$client.prepare(`
        SELECT
          COALESCE(SUM(ect.amount), 0) as total_cash_refunds,
          COALESCE(SUM(CASE WHEN ect.transaction_type = 'SalesReturn' THEN ect.amount ELSE 0 END), 0) as sales_return_total,
          COALESCE(SUM(CASE WHEN ect.transaction_type = 'ReturnDeposit' THEN ect.amount ELSE 0 END), 0) as deposit_return_total
        FROM emp_cash_transactions ect
        WHERE ${cashWhereSql}
      `).bind(...cashParams),
    ]);

    const refundResult = { results: batchRefundResults[0]?.results || [] } as any;
    const cashSummary = batchRefundResults[1]?.results?.[0] as {
        total_cash_refunds?: number | null;
        sales_return_total?: number | null;
        deposit_return_total?: number | null;
      } | undefined;

    const refunds = (refundResult.results ?? []).map((row: any) => ({
      sourceType: row.source_type,
      sourceId: row.source_id,
      refundNo: row.refund_no,
      refundDate: row.refund_date,
      patientId: row.patient_id,
      patientName: row.patient_name,
      patientCode: row.patient_code,
      invoiceNo: row.invoice_no,
      reason: row.reason,
      amount: roundMoney(Number(row.amount ?? 0)),
      cashAmount: roundMoney(Number(row.cash_amount ?? 0)),
      paymentMethod: row.payment_method,
    }));

    const bySourceType = refunds.reduce((acc: Record<string, { count: number; amount: number; cashAmount: number }>, row: any) => {
      const current = acc[row.sourceType] ?? { count: 0, amount: 0, cashAmount: 0 };
      current.count += 1;
      current.amount = roundMoney(current.amount + row.amount);
      current.cashAmount = roundMoney(current.cashAmount + row.cashAmount);
      acc[row.sourceType] = current;
      return acc;
    }, {});
    const totalRefundAmount = roundMoney(refunds.reduce((sum: number, row: any) => sum + row.amount, 0));
    const cashRefundAmount = roundMoney(refunds.reduce((sum: number, row: any) => sum + row.cashAmount, 0));
    const cashLedgerRefundTotal = roundMoney(Number(cashSummary?.total_cash_refunds ?? 0));

    return c.json({
      period: {
        startDate: startDate ?? null,
        endDate: endDate ?? null,
      },
      refunds,
      summary: {
        totalRefunds: refunds.length,
        totalRefundAmount,
        cashRefundAmount,
        cashLedgerRefundTotal,
        cashLedgerDifference: roundMoney(cashRefundAmount - cashLedgerRefundTotal),
        salesReturnLedgerTotal: roundMoney(Number(cashSummary?.sales_return_total ?? 0)),
        depositReturnLedgerTotal: roundMoney(Number(cashSummary?.deposit_return_total ?? 0)),
        bySourceType,
      },
    });
  } catch (error) {
    console.error('Error generating refund report:', error);
    return c.json({ error: 'Failed to generate refund report' }, 500);
  }
});

reportsRoutes.get('/discounts', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate, sourceType } = c.req.query();
  const patientIdRaw = c.req.query('patientId') ?? c.req.query('patient_id');
  const validSourceTypes = new Set(['bill_discount', 'settlement_discount']);

  if (startDate && endDate && startDate > endDate) {
    return c.json({ error: 'startDate must be on or before endDate' }, 400);
  }
  if (sourceType && !validSourceTypes.has(sourceType)) {
    return c.json({ error: 'Invalid discount sourceType' }, 400);
  }
  const patientId = patientIdRaw ? Number(patientIdRaw) : null;
  if (patientIdRaw && (!Number.isInteger(patientId) || Number(patientId) <= 0)) {
    return c.json({ error: 'patientId must be a positive integer' }, 400);
  }

  try {
    let whereSql = '1 = 1';
    const params: (string | number)[] = [tenantId, tenantId];
    if (startDate) { whereSql += ' AND date(discount_date) >= date(?)'; params.push(startDate); }
    if (endDate) { whereSql += ' AND date(discount_date) <= date(?)'; params.push(endDate); }
    if (patientId) { whereSql += ' AND patient_id = ?'; params.push(patientId); }
    if (sourceType) { whereSql += ' AND source_type = ?'; params.push(sourceType); }

    const discountSql = `
      WITH discount_rows AS (
        SELECT
          'bill_discount' as source_type,
          b.id as source_id,
          b.invoice_no as document_no,
          b.created_at as discount_date,
          b.patient_id,
          p.name as patient_name,
          p.patient_code,
          b.invoice_no,
          COALESCE(NULLIF(TRIM(b.remarks), ''), 'Invoice discount') as reason,
          COALESCE(b.discount, 0) as amount,
          b.created_by
        FROM bills b
        LEFT JOIN patients p
          ON p.id = b.patient_id
          AND p.tenant_id = b.tenant_id
        WHERE b.tenant_id = ?
          AND COALESCE(b.status, '') NOT IN ('cancelled', 'refunded', 'draft')
          AND COALESCE(b.discount, 0) > 0

        UNION ALL

        SELECT
          'settlement_discount' as source_type,
          s.id as source_id,
          s.settlement_receipt_no as document_no,
          s.created_at as discount_date,
          s.patient_id,
          p.name as patient_name,
          p.patient_code,
          NULL as invoice_no,
          COALESCE(NULLIF(TRIM(s.remarks), ''), 'Settlement discount') as reason,
          COALESCE(s.discount_amount, 0) as amount,
          s.created_by
        FROM billing_settlements s
        LEFT JOIN patients p
          ON p.id = s.patient_id
          AND p.tenant_id = s.tenant_id
        WHERE s.tenant_id = ?
          AND s.is_active = 1
          AND COALESCE(s.discount_amount, 0) > 0
      )
      SELECT *
      FROM discount_rows
      WHERE ${whereSql}
      ORDER BY discount_date DESC, source_id DESC
    `;

    let postingWhereSql = `
      ape.tenant_id = ?
      AND ape.event_type IN ('bill_created', 'settlement_discount')
    `;
    const postingParams: (string | number)[] = [tenantId];
    if (startDate) { postingWhereSql += ' AND date(ape.event_date) >= date(?)'; postingParams.push(startDate); }
    if (endDate) { postingWhereSql += ' AND date(ape.event_date) <= date(?)'; postingParams.push(endDate); }
    if (patientId) {
      postingWhereSql += " AND CAST(json_extract(ape.payload_json, '$.patientId') AS INTEGER) = ?";
      postingParams.push(patientId);
    }
    if (sourceType === 'bill_discount') {
      postingWhereSql += " AND ape.event_type = 'bill_created'";
    } else if (sourceType === 'settlement_discount') {
      postingWhereSql += " AND ape.event_type = 'settlement_discount'";
    }

    let cashDiscountWhereSql = `
      ect.tenant_id = ?
      AND ect.transaction_type = 'CashDiscountGiven'
    `;
    const cashDiscountParams: (string | number)[] = [tenantId];
    if (sourceType === 'bill_discount') {
      cashDiscountWhereSql += ' AND 1 = 0';
    } else {
      cashDiscountWhereSql += " AND COALESCE(ect.reference_type, '') = 'settlement'";
      if (startDate) { cashDiscountWhereSql += ' AND date(ect.transaction_date) >= date(?)'; cashDiscountParams.push(startDate); }
      if (endDate) { cashDiscountWhereSql += ' AND date(ect.transaction_date) <= date(?)'; cashDiscountParams.push(endDate); }
    }

    // Replaced Promise.all() with db.$client.batch() for discounts reporting.
    // Why: Promise.all() sends 3 separate HTTP network requests to Cloudflare D1.
    const batchResults = await db.$client.batch([
      db.$client.prepare(discountSql).bind(...params),
      db.$client.prepare(`
        SELECT
          COALESCE(SUM(CASE
            WHEN ape.event_type = 'bill_created' THEN COALESCE(json_extract(ape.payload_json, '$.discount'), 0)
            WHEN ape.event_type = 'settlement_discount' THEN COALESCE(json_extract(ape.payload_json, '$.amount'), 0)
            ELSE 0
          END), 0) as total_posted_discount
        FROM accounting_posting_events ape
        WHERE ${postingWhereSql}
      `).bind(...postingParams),
      db.$client.prepare(`
        SELECT COALESCE(SUM(ect.amount), 0) as cash_discount_given_total
        FROM emp_cash_transactions ect
        WHERE ${cashDiscountWhereSql}
      `).bind(...cashDiscountParams),
    ]);

    const discountResult = { results: batchResults[0]?.results || [] } as any;
    const postingSummary = batchResults[1]?.results?.[0] as { total_posted_discount?: number | null } | undefined;
    const cashDiscountSummary = batchResults[2]?.results?.[0] as { cash_discount_given_total?: number | null } | undefined;

    const discounts = (discountResult.results ?? []).map((row: any) => ({
      sourceType: row.source_type,
      sourceId: row.source_id,
      documentNo: row.document_no,
      discountDate: row.discount_date,
      patientId: row.patient_id,
      patientName: row.patient_name,
      patientCode: row.patient_code,
      invoiceNo: row.invoice_no,
      reason: row.reason,
      amount: roundMoney(Number(row.amount ?? 0)),
      createdBy: row.created_by,
    }));

    const bySourceType = discounts.reduce((acc: Record<string, { count: number; amount: number }>, row: any) => {
      const current = acc[row.sourceType] ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount = roundMoney(current.amount + row.amount);
      acc[row.sourceType] = current;
      return acc;
    }, {});
    const totalDiscountAmount = roundMoney(discounts.reduce((sum: number, row: any) => sum + row.amount, 0));
    const postingEventDiscountTotal = roundMoney(Number(postingSummary?.total_posted_discount ?? 0));

    return c.json({
      period: {
        startDate: startDate ?? null,
        endDate: endDate ?? null,
      },
      discounts,
      summary: {
        totalDiscounts: discounts.length,
        totalDiscountAmount,
        postingEventDiscountTotal,
        postingEventDifference: roundMoney(totalDiscountAmount - postingEventDiscountTotal),
        cashDiscountGivenTotal: roundMoney(Number(cashDiscountSummary?.cash_discount_given_total ?? 0)),
        bySourceType,
      },
    });
  } catch (error) {
    console.error('Error generating discount report:', error);
    return c.json({ error: 'Failed to generate discount report' }, 500);
  }
});

reportsRoutes.get('/daily-discount', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.query();

  if (startDate && endDate && startDate > endDate) {
    return c.json({ error: 'startDate must be on or before endDate' }, 400);
  }

  try {
    let whereSql = 'bda.tenant_id = ?';
    const params: (string | number)[] = [tenantId];
    if (startDate) {
      whereSql += ' AND date(bda.created_at) >= date(?)';
      params.push(startDate);
    }
    if (endDate) {
      whereSql += ' AND date(bda.created_at) <= date(?)';
      params.push(endDate);
    }

    const discountSql = `
      SELECT
        b.invoice_no,
        p.name as patient_name,
        bda.created_at,
        COALESCE(ii.item_category, bda.allocation_type) as service,
        COALESCE(b.total + b.discount, 0) as gross_amount,
        bda.amount as discount_amount,
        COALESCE(bda.percent, CASE WHEN (b.total + b.discount) > 0 THEN (bda.amount * 100.0 / (b.total + b.discount)) ELSE 0 END) as discount_percent,
        bda.discount_reason as reason,
        u_app.name as approved_by,
        COALESCE(d.name, bda.reference_name) as given_by,
        u_cre.name as user,
        bc.counter_name as counter
      FROM bill_discount_allocations bda
      JOIN bills b ON bda.bill_id = b.id AND b.tenant_id = bda.tenant_id
      LEFT JOIN patients p ON b.patient_id = p.id AND p.tenant_id = b.tenant_id
      LEFT JOIN invoice_items ii ON bda.bill_item_id = ii.id AND ii.tenant_id = bda.tenant_id
      LEFT JOIN users u_app ON bda.approved_by = u_app.id AND u_app.tenant_id = bda.tenant_id
      LEFT JOIN users u_cre ON bda.created_by = u_cre.id AND u_cre.tenant_id = bda.tenant_id
      LEFT JOIN doctors d ON bda.doctor_id = d.id AND d.tenant_id = bda.tenant_id
      LEFT JOIN billing_counter_sessions bcs ON b.counter_session_id = bcs.id AND bcs.tenant_id = b.tenant_id
      LEFT JOIN billing_counters bc ON bcs.counter_id = bc.id AND bc.tenant_id = bcs.tenant_id
      WHERE ${whereSql}
      ORDER BY bda.created_at DESC, bda.id DESC
    `;

    const { results } = await db.$client.prepare(discountSql).bind(...params).all<any>();

    const items = results || [];
    const totalDiscountGiven = items.reduce((sum: number, item: any) => sum + Number(item.discount_amount ?? 0), 0);
    const discountedBillsCount = new Set(items.map((item: any) => item.invoice_no).filter(Boolean)).size;
    const averageDiscount = discountedBillsCount > 0 ? totalDiscountGiven / discountedBillsCount : 0;

    return c.json({
      items,
      summary: {
        total_discount_given: roundMoney(totalDiscountGiven),
        discounted_bills_count: discountedBillsCount,
        average_discount: roundMoney(averageDiscount)
      }
    });
  } catch (error) {
    console.error('Error generating daily discount report:', error);
    return c.json({ error: 'Failed to generate daily discount report' }, 500);
  }
});

reportsRoutes.get('/department-revenue', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.query();
  if (startDate && endDate && startDate > endDate) {
    return c.json({ error: 'startDate must be on or before endDate' }, 400);
  }
  try {
    let query = `
      WITH filtered_bills AS (
        SELECT b.*
        FROM bills b
        WHERE b.tenant_id = ?
          AND COALESCE(b.status, '') NOT IN ('cancelled', 'refunded', 'draft')
    `;
    const params: (string | number)[] = [tenantId];

    if (startDate) { query += ' AND date(b.created_at) >= date(?)'; params.push(startDate); }
    if (endDate) { query += ' AND date(b.created_at) <= date(?)'; params.push(endDate); }

    query += `
      ),
      active_invoice_items AS (
        SELECT
          ii.bill_id,
          ii.tenant_id,
          ii.item_category,
          ii.line_total,
          ii.reference_id
        FROM invoice_items ii
        JOIN filtered_bills b
          ON b.id = ii.bill_id
          AND b.tenant_id = ii.tenant_id
        WHERE ii.tenant_id = ?
          AND COALESCE(ii.status, 'active') = 'active'
      ),
      bill_item_totals AS (
        SELECT
          bill_id,
          tenant_id,
          COALESCE(SUM(COALESCE(line_total, 0)), 0) as bill_item_total
        FROM active_invoice_items
        GROUP BY bill_id, tenant_id
      ),
      department_lines AS (
        SELECT
          COALESCE(
            NULLIF(TRIM(sd.department_name), ''),
            CASE
              WHEN LOWER(COALESCE(ii.item_category, '')) IN ('test', 'lab', 'laboratory') THEN 'Laboratory'
              WHEN LOWER(COALESCE(ii.item_category, '')) IN ('radiology', 'scan', 'imaging') THEN 'Radiology'
              WHEN LOWER(COALESCE(ii.item_category, '')) IN ('doctor_visit', 'consultation') THEN 'OPD'
              WHEN LOWER(COALESCE(ii.item_category, '')) IN ('operation', 'procedure', 'surgery', 'ot') THEN 'Operation Theatre'
              WHEN LOWER(COALESCE(ii.item_category, '')) IN ('medicine', 'pharmacy') THEN 'Pharmacy'
              WHEN LOWER(COALESCE(ii.item_category, '')) = 'admission' THEN 'IPD'
              WHEN v.visit_type IS NOT NULL AND TRIM(v.visit_type) <> '' THEN v.visit_type
              ELSE 'General'
            END
          ) as department,
          b.id as bill_id,
          b.patient_id,
          COALESCE(ii.line_total, 0) as revenue,
          CASE
            WHEN COALESCE(bit.bill_item_total, 0) > 0
              THEN COALESCE(b.discount, 0) * COALESCE(ii.line_total, 0) / bit.bill_item_total
            ELSE 0
          END as discount_amount
        FROM active_invoice_items ii
        JOIN filtered_bills b
          ON b.id = ii.bill_id
          AND b.tenant_id = ii.tenant_id
        LEFT JOIN bill_item_totals bit
          ON bit.bill_id = b.id
          AND bit.tenant_id = b.tenant_id
        LEFT JOIN billing_service_items si
          ON si.id = ii.reference_id
          AND si.tenant_id = ii.tenant_id
        LEFT JOIN billing_service_departments sd
          ON sd.id = si.service_department_id
          AND sd.tenant_id = si.tenant_id
        LEFT JOIN visits v
          ON b.visit_id = v.id
          AND v.tenant_id = b.tenant_id

        UNION ALL

        SELECT
          CASE
            WHEN v.visit_type IS NOT NULL AND TRIM(v.visit_type) <> '' THEN v.visit_type
            ELSE 'General'
          END as department,
          b.id as bill_id,
          b.patient_id,
          COALESCE(NULLIF(b.total, 0), b.total_amount, 0) as revenue,
          COALESCE(b.discount, 0) as discount_amount
        FROM filtered_bills b
        LEFT JOIN visits v
          ON b.visit_id = v.id
          AND v.tenant_id = b.tenant_id
        WHERE NOT EXISTS (
          SELECT 1
          FROM active_invoice_items ii
          WHERE ii.bill_id = b.id
            AND ii.tenant_id = b.tenant_id
        )
      )
      SELECT
        department,
        COUNT(DISTINCT bill_id) as bill_count,
        COALESCE(SUM(revenue), 0) as revenue,
        COALESCE(SUM(discount_amount), 0) as discount_amount,
        COALESCE(SUM(revenue + discount_amount), 0) as gross_revenue,
        COUNT(DISTINCT patient_id) as patient_count
      FROM department_lines
      GROUP BY department
      ORDER BY revenue DESC
    `;
    params.push(tenantId);

    const result = await db.$client.prepare(query).bind(...params)
      .all<{
        department: string;
        bill_count: number;
        revenue: number;
        discount_amount: number;
        gross_revenue: number;
        patient_count: number;
      }>();

    const totalRevenue = roundMoney(result.results.reduce((s, r) => s + Number(r.revenue ?? 0), 0));
    const totalDiscount = roundMoney(result.results.reduce((s, r) => s + Number(r.discount_amount ?? 0), 0));
    const totalGrossRevenue = roundMoney(result.results.reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0));
    const glRevenue = (await getGlIncomeExpenseTotals(
      c.env.DB,
      tenantId,
      startDate || '1970-01-01',
      endDate || '2099-12-31',
    )).income;

    return c.json({
      totalRevenue,
      summary: {
        totalRevenue,
        totalDiscount,
        totalGrossRevenue,
        glRevenue,
        glDifference: roundMoney(totalGrossRevenue - glRevenue),
      },
      byDepartment: result.results.map(r => ({
        department: r.department,
        revenue: roundMoney(r.revenue),
        discountAmount: roundMoney(r.discount_amount),
        grossRevenue: roundMoney(r.gross_revenue),
        billCount: r.bill_count,
        patientCount: r.patient_count,
        percentage: totalRevenue > 0 ? parseFloat(((Number(r.revenue ?? 0) / totalRevenue) * 100).toFixed(1)) : 0,
      })),
    });
  } catch (error) {
    console.error('Error generating department revenue:', error);
    return c.json({ error: 'Failed to generate department revenue report' }, 500);
  }
});

reportsRoutes.get('/doctor-performance', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.query();
  if (startDate && endDate && startDate > endDate) {
    return c.json({ error: 'startDate must be on or before endDate' }, 400);
  }
  try {
    const cteQuery = `
      WITH performance_stats AS (
        SELECT
          v.doctor_id,
          COUNT(DISTINCT v.id) as visit_count,
          COUNT(DISTINCT v.patient_id) as unique_patients,
          COALESCE(SUM(CASE
            WHEN b.id IS NOT NULL AND COALESCE(b.status, '') NOT IN ('cancelled', 'refunded', 'draft')
              THEN COALESCE(NULLIF(b.total, 0), b.total_amount, 0)
            ELSE 0
          END), 0) as revenue
        FROM visits v
        LEFT JOIN bills b ON b.visit_id = v.id AND b.tenant_id = v.tenant_id
        WHERE v.tenant_id = ?
          AND v.doctor_id IS NOT NULL
          ${startDate ? 'AND v.visit_date >= ?' : ''}
          ${endDate ? 'AND v.visit_date <= ?' : ''}
        GROUP BY v.doctor_id
      ),
      commission_stats AS (
        SELECT
          dca.doctor_id,
          COALESCE(SUM(CASE WHEN dca.source_type = 'consultation_fee' THEN dca.commission_amount ELSE 0 END), 0) as consultation_fees,
          COALESCE(SUM(CASE WHEN dca.source_type = 'lab_test' THEN dca.commission_amount ELSE 0 END), 0) as lab_test_commissions,
          COALESCE(SUM(CASE WHEN dca.source_type = 'referral' THEN dca.commission_amount ELSE 0 END), 0) as referral_commissions,
          COALESCE(SUM(dca.commission_amount), 0) as total_commissions
        FROM doctor_commission_accruals dca
        WHERE dca.tenant_id = ?
          AND COALESCE(dca.status, 'accrued') <> 'cancelled'
          ${startDate ? 'AND dca.accrued_date >= ?' : ''}
          ${endDate ? 'AND dca.accrued_date <= ?' : ''}
        GROUP BY dca.doctor_id
      ),
      consultation_bill_links AS (
        SELECT DISTINCT dca.tenant_id, dca.doctor_id, dca.bill_id
        FROM doctor_commission_accruals dca
        WHERE dca.tenant_id = ?
          AND dca.source_type = 'consultation_fee'
          AND dca.bill_id IS NOT NULL
          AND COALESCE(dca.status, 'accrued') <> 'cancelled'
          ${startDate ? 'AND dca.accrued_date >= ?' : ''}
          ${endDate ? 'AND dca.accrued_date <= ?' : ''}
      ),
      consultation_invoice_totals AS (
        SELECT
          ii.tenant_id,
          ii.bill_id,
          COALESCE(SUM(ii.line_total), 0) as consultation_item_total
        FROM invoice_items ii
        WHERE ii.tenant_id = ?
          AND COALESCE(ii.status, 'active') <> 'cancelled'
          AND LOWER(COALESCE(ii.item_category, '')) IN ('consultation', 'doctor_visit', 'opd', 'visit')
        GROUP BY ii.tenant_id, ii.bill_id
      ),
      consultation_revenue_stats AS (
        SELECT
          cbl.doctor_id,
          COALESCE(SUM(CASE
            WHEN b.id IS NOT NULL
              AND COALESCE(b.status, '') NOT IN ('cancelled', 'refunded', 'draft')
              AND (v.id IS NULL OR v.doctor_id != cbl.doctor_id)
            THEN COALESCE(NULLIF(b.doctor_visit_bill, 0), cit.consultation_item_total, 0)
            ELSE 0
          END), 0) as unlinked_consultation_revenue
        FROM consultation_bill_links cbl
        LEFT JOIN bills b ON b.id = cbl.bill_id AND b.tenant_id = cbl.tenant_id
        LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
        LEFT JOIN consultation_invoice_totals cit ON cit.bill_id = b.id AND cit.tenant_id = b.tenant_id
        GROUP BY cbl.doctor_id
      ),
      referral_lab_bills AS (
        SELECT DISTINCT dca.tenant_id, dca.doctor_id, dca.bill_id
        FROM doctor_commission_accruals dca
        WHERE dca.tenant_id = ?
          AND dca.source_type = 'referral'
          AND dca.bill_id IS NOT NULL
          AND COALESCE(dca.status, 'accrued') <> 'cancelled'
          ${startDate ? 'AND dca.accrued_date >= ?' : ''}
          ${endDate ? 'AND dca.accrued_date <= ?' : ''}
      ),
      referral_lab_revenue_stats AS (
        SELECT
          rlb.doctor_id,
          COALESCE(SUM(CASE
            WHEN b.id IS NOT NULL
              AND COALESCE(b.status, '') NOT IN ('cancelled', 'refunded', 'draft')
              AND (v.id IS NULL OR v.doctor_id != rlb.doctor_id)
            THEN COALESCE(NULLIF(b.total, 0), b.total_amount, 0)
            ELSE 0
          END), 0) as referral_lab_revenue
        FROM referral_lab_bills rlb
        LEFT JOIN bills b ON b.id = rlb.bill_id AND b.tenant_id = rlb.tenant_id
        LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
        GROUP BY rlb.doctor_id
      ),
      test_stats AS (
        SELECT
          v.doctor_id,
          COUNT(loi.id) as test_count,
          COALESCE(SUM(loi.line_total), 0) as test_revenue
        FROM visits v
        JOIN lab_orders lo ON lo.visit_id = v.id AND lo.tenant_id = v.tenant_id
        JOIN lab_order_items loi ON loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
        WHERE v.tenant_id = ?
          AND v.doctor_id IS NOT NULL
          AND COALESCE(loi.status, 'pending') <> 'cancelled'
          ${startDate ? 'AND lo.order_date >= ?' : ''}
          ${endDate ? 'AND lo.order_date <= ?' : ''}
        GROUP BY v.doctor_id
      )
      SELECT
        d.id, d.name, d.specialty,
        COALESCE(p.visit_count, 0) as visit_count,
        COALESCE(p.unique_patients, 0) as unique_patients,
        COALESCE(p.revenue, 0) as total_revenue,
        COALESCE(c.consultation_fees, 0) as consultation_fees,
        COALESCE(c.lab_test_commissions, 0) as lab_test_commissions,
        COALESCE(c.referral_commissions, 0) as referral_commissions,
        COALESCE(c.total_commissions, 0) as total_commissions,
        COALESCE(cr.unlinked_consultation_revenue, 0) as unlinked_consultation_revenue,
        COALESCE(r.referral_lab_revenue, 0) as referral_lab_revenue,
        COALESCE(t.test_count, 0) as test_count,
        COALESCE(t.test_revenue, 0) as test_revenue
      FROM doctors d
      LEFT JOIN performance_stats p ON p.doctor_id = d.id
      LEFT JOIN commission_stats c ON c.doctor_id = d.id
      LEFT JOIN consultation_revenue_stats cr ON cr.doctor_id = d.id
      LEFT JOIN referral_lab_revenue_stats r ON r.doctor_id = d.id
      LEFT JOIN test_stats t ON t.doctor_id = d.id
      WHERE d.tenant_id = ?
        AND (
          d.is_active = 1
          OR d.is_active IS NULL
          OR COALESCE(p.visit_count, 0) > 0
          OR ABS(COALESCE(p.revenue, 0)) >= 0.01
          OR ABS(COALESCE(c.total_commissions, 0)) >= 0.01
          OR ABS(COALESCE(cr.unlinked_consultation_revenue, 0)) >= 0.01
          OR ABS(COALESCE(r.referral_lab_revenue, 0)) >= 0.01
          OR ABS(COALESCE(t.test_revenue, 0)) >= 0.01
        )
      ORDER BY (
        COALESCE(p.revenue, 0)
        + COALESCE(cr.unlinked_consultation_revenue, 0)
        + COALESCE(t.test_revenue, 0)
        + COALESCE(r.referral_lab_revenue, 0)
        - COALESCE(c.total_commissions, 0)
      ) DESC
    `;

    const cteParams: (string | number)[] = [];
    const pushDateScopedTenant = () => {
      cteParams.push(tenantId);
      if (startDate) cteParams.push(startDate);
      if (endDate) cteParams.push(endDate);
    };
    pushDateScopedTenant();
    pushDateScopedTenant();
    pushDateScopedTenant();
    cteParams.push(tenantId);
    pushDateScopedTenant();
    pushDateScopedTenant();
    cteParams.push(tenantId);

    const result = await db.$client.prepare(cteQuery).bind(...cteParams).all<{
      id: number; name: string; specialty: string;
      visit_count: number; unique_patients: number; total_revenue: number;
      consultation_fees: number; lab_test_commissions: number; referral_commissions: number; total_commissions: number;
      unlinked_consultation_revenue: number;
      referral_lab_revenue: number;
      test_count: number;
      test_revenue: number;
    }>();

    const doctors = result.results.map(d => {
      const unlinkedConsultationRevenue = roundMoney(d.unlinked_consultation_revenue);
      const revenue = roundMoney(Number(d.total_revenue ?? 0) + unlinkedConsultationRevenue);
      const consultationFees = roundMoney(d.consultation_fees);
      const labTestCommissions = roundMoney(d.lab_test_commissions);
      const referralCommissions = roundMoney(d.referral_commissions);
      const totalCommissions = roundMoney(d.total_commissions);
      const referralLabRevenue = roundMoney(d.referral_lab_revenue);
      const testCount = Number(d.test_count ?? 0);
      const testRevenue = roundMoney(d.test_revenue);
      const hospitalRevenue = roundMoney(revenue + testRevenue + referralLabRevenue - totalCommissions);
      const netHospitalIncome = hospitalRevenue;
      return {
        id: d.id,
        name: d.name,
        specialty: d.specialty,
        visitCount: d.visit_count,
        uniquePatients: d.unique_patients,
        revenue,
        consultationFees,
        labTestCommissions,
        referralCommissions,
        totalCommissions,
        unlinkedConsultationRevenue,
        referralLabRevenue,
        testCount,
        testRevenue,
        hospitalRevenue,
        netHospitalIncome,
        avgRevenuePerVisit: d.visit_count > 0
          ? parseFloat((revenue / d.visit_count).toFixed(0))
          : 0,
      };
    });
    const summary = doctors.reduce((acc, doctor) => ({
      totalDoctors: acc.totalDoctors + 1,
      totalVisits: acc.totalVisits + Number(doctor.visitCount ?? 0),
      totalRevenue: roundMoney(acc.totalRevenue + doctor.revenue),
      totalCommissions: roundMoney(acc.totalCommissions + doctor.totalCommissions),
      totalReferralLabRevenue: roundMoney(acc.totalReferralLabRevenue + doctor.referralLabRevenue),
      totalTestCount: acc.totalTestCount + Number(doctor.testCount ?? 0),
      totalTestRevenue: roundMoney(acc.totalTestRevenue + doctor.testRevenue),
      totalHospitalRevenue: roundMoney(acc.totalHospitalRevenue + doctor.hospitalRevenue),
      totalNetHospitalIncome: roundMoney(acc.totalNetHospitalIncome + doctor.netHospitalIncome),
    }), {
      totalDoctors: 0,
      totalVisits: 0,
      totalRevenue: 0,
      totalCommissions: 0,
      totalReferralLabRevenue: 0,
      totalTestCount: 0,
      totalTestRevenue: 0,
      totalHospitalRevenue: 0,
      totalNetHospitalIncome: 0,
    });

    return c.json({
      doctors,
      summary,
    });
  } catch (error) {
    console.error('Error generating doctor performance:', error);
    return c.json({ error: 'Failed to generate doctor performance report' }, 500);
  }
});

reportsRoutes.get('/monthly-summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { month } = c.req.query(); // format: YYYY-MM
  const targetMonth = month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const monthStart = `${targetMonth}-01`;
  const nextMonth = (() => {
    const [y, m] = targetMonth.split('-').map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  })();

  try {
    const monthEnd = lastDayOfMonth(targetMonth);
    const financialTotals = await getGlIncomeExpenseTotals(c.env.DB, tenantId, monthStart, monthEnd);
    // Keep operational counters batched while finance totals come from verified GL vouchers.
    const batchResults = await db.$client.batch([
      db.$client.prepare(`SELECT COUNT(*) as new_patients FROM patients WHERE tenant_id = ? AND created_at >= ? AND created_at < ?`)
        .bind(tenantId, monthStart, nextMonth),

      db.$client.prepare(`SELECT COUNT(*) as total FROM visits WHERE tenant_id = ? AND visit_date >= ? AND visit_date < ?`)
        .bind(tenantId, monthStart, nextMonth),

      db.$client.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'discharged' THEN 1 ELSE 0 END) as discharged FROM admissions WHERE tenant_id = ? AND admission_date >= ? AND admission_date < ?`)
        .bind(tenantId, monthStart, nextMonth),

      db.$client.prepare(`SELECT COALESCE(icd10_description, visit_type) as diagnosis, COUNT(*) as cnt FROM visits WHERE tenant_id = ? AND visit_date >= ? AND visit_date < ? AND (icd10_description IS NOT NULL OR visit_type IS NOT NULL) GROUP BY diagnosis ORDER BY cnt DESC LIMIT 10`)
        .bind(tenantId, monthStart, nextMonth),
    ]);

    const [
      patientsBatch,
      visitsBatch,
      admissionsBatch,
      diagnosesBatch
    ] = batchResults;

    const patients = patientsBatch.results[0] as { new_patients: number } | undefined;
    const visits = visitsBatch.results[0] as { total: number } | undefined;
    const admissions = admissionsBatch.results[0] as { total: number; discharged: number } | undefined;
    const diagnoses = diagnosesBatch as { results: { diagnosis: string; cnt: number }[] };

    const totalRevenue = financialTotals.income;
    const totalExpenses = financialTotals.expense;

    return c.json({
      month: targetMonth,
      financial: {
        revenue: totalRevenue,
        expenses: totalExpenses,
        netProfit: totalRevenue - totalExpenses,
        profitMargin: totalRevenue > 0 ? parseFloat(((totalRevenue - totalExpenses) / totalRevenue * 100).toFixed(1)) : 0,
      },
      operations: {
        newPatients: patients?.new_patients ?? 0,
        totalVisits: visits?.total ?? 0,
        newAdmissions: admissions?.total ?? 0,
        discharges: admissions?.discharged ?? 0,
      },
      topDiagnoses: diagnoses.results.map(d => ({
        diagnosis: d.diagnosis,
        count: d.cnt,
      })),
    });
  } catch (error) {
    console.error('Error generating monthly summary:', error);
    return c.json({ error: 'Failed to generate monthly summary' }, 500);
  }
});

const trialBalanceHandler = async (c: Context<ReportsEnv>) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const query = c.req.query();
  const fiscalYearId = query.fiscalYearId;
  const requestedAsOfDate = query.asOfDate || query.endDate || query.to;

  try {
    const fyId = fiscalYearId
      ? parseInt(fiscalYearId)
      : (await db.$client.prepare(
          `SELECT id FROM fiscal_years WHERE tenant_id = ? AND is_active = 1 LIMIT 1`
        ).bind(tenantId).first<{ id: number }>())?.id;

    if (!fyId) return c.json({ error: 'No active fiscal year found' }, 400);

    const fy = await db.$client.prepare(
      `SELECT * FROM fiscal_years WHERE id = ? AND tenant_id = ?`
    ).bind(fyId, tenantId).first<{ start_date: string; end_date: string; fiscal_year_name: string }>();

    if (!fy) return c.json({ error: 'Fiscal year not found' }, 404);

    const asOfDate = requestedAsOfDate || fy.end_date;
    if (asOfDate < fy.start_date || asOfDate > fy.end_date) {
      return c.json({
        error: `As-of date must be within fiscal year ${fy.fiscal_year_name} (${fy.start_date} to ${fy.end_date})`,
      }, 400);
    }

    const accountsResult = await db.$client.prepare(`
      SELECT a.id, a.code, a.name, a.type, a.is_active,
        COALESCE(SUM(CASE WHEN v.id IS NOT NULL THEN jl.debit_amount ELSE 0 END), 0) as total_debit,
        COALESCE(SUM(CASE WHEN v.id IS NOT NULL THEN jl.credit_amount ELSE 0 END), 0) as total_credit
      FROM chart_of_accounts a
      LEFT JOIN accounting_journal_lines jl ON jl.account_id = a.id AND jl.tenant_id = a.tenant_id
      LEFT JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
        AND v.status = 'verified' AND v.entry_date >= ? AND v.entry_date <= ?
      WHERE a.tenant_id = ?
      GROUP BY a.id
      HAVING a.is_active = 1
        OR COALESCE(SUM(CASE WHEN v.id IS NOT NULL THEN jl.debit_amount ELSE 0 END), 0) != 0
        OR COALESCE(SUM(CASE WHEN v.id IS NOT NULL THEN jl.credit_amount ELSE 0 END), 0) != 0
      ORDER BY a.code
    `).bind(fy.start_date, asOfDate, tenantId).all<{
      id: number; code: string; name: string; type: string;
      is_active: number | boolean | null;
      total_debit: number; total_credit: number;
    }>();

    const accounts = accountsResult.results.map(a => ({
      code: a.code,
      name: a.name,
      type: a.type,
      isActive: !!a.is_active,
      debit: roundMoney(a.total_debit),
      credit: roundMoney(a.total_credit),
    }));

    const totals = accounts.reduce((acc, a) => ({
      totalDebit: roundMoney(acc.totalDebit + a.debit),
      totalCredit: roundMoney(acc.totalCredit + a.credit),
    }), { totalDebit: 0, totalCredit: 0 });
    const difference = roundMoney(totals.totalDebit - totals.totalCredit);

    return c.json({
      fiscalYear: fy.fiscal_year_name,
      asOfDate,
      accounts,
      totals: {
        ...totals,
        difference,
        isBalanced: Math.abs(difference) < 0.01,
      },
    });
  } catch (error) {
    console.error('Error generating trial balance:', error);
    return c.json({ error: 'Failed to generate trial balance' }, 500);
  }
};

reportsRoutes.get('/trail-balance', trialBalanceHandler);
reportsRoutes.get('/trial-balance', trialBalanceHandler);

reportsRoutes.get('/balance-sheet', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const query = c.req.query();
  const fiscalYearId = query.fiscalYearId;
  const requestedAsOfDate = query.asOfDate || query.endDate || query.to;

  try {
    const fyId = fiscalYearId
      ? parseInt(fiscalYearId)
      : (await db.$client.prepare(
          `SELECT id FROM fiscal_years WHERE tenant_id = ? AND is_active = 1 LIMIT 1`
        ).bind(tenantId).first<{ id: number }>())?.id;

    if (!fyId) return c.json({ error: 'No active fiscal year found' }, 400);

    const fy = await db.$client.prepare(
      `SELECT * FROM fiscal_years WHERE id = ? AND tenant_id = ?`
    ).bind(fyId, tenantId).first<{ start_date: string; end_date: string; fiscal_year_name: string }>();

    if (!fy) return c.json({ error: 'Fiscal year not found' }, 404);

    const asOfDate = requestedAsOfDate || fy.end_date;
    if (asOfDate < fy.start_date || asOfDate > fy.end_date) {
      return c.json({
        error: `As-of date must be within fiscal year ${fy.fiscal_year_name} (${fy.start_date} to ${fy.end_date})`,
      }, 400);
    }

    type BalanceSheetItem = {
      code?: string;
      name: string;
      amount: number;
      isActive?: boolean;
    };

    const getAccountTotals = async (type: string): Promise<BalanceSheetItem[]> => {
      const result = await db.$client.prepare(`
        SELECT a.code, a.name, a.is_active,
          CASE
            WHEN a.type IN ('asset', 'expense') THEN COALESCE(SUM(CASE WHEN v.id IS NOT NULL THEN jl.debit_amount - jl.credit_amount ELSE 0 END), 0)
            ELSE COALESCE(SUM(CASE WHEN v.id IS NOT NULL THEN jl.credit_amount - jl.debit_amount ELSE 0 END), 0)
          END as amount
        FROM chart_of_accounts a
        LEFT JOIN accounting_journal_lines jl ON jl.account_id = a.id AND jl.tenant_id = a.tenant_id
        LEFT JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
          AND v.status = 'verified' AND v.entry_date >= ? AND v.entry_date <= ?
        WHERE a.tenant_id = ? AND a.type = ?
        GROUP BY a.id
        HAVING a.is_active = 1
          OR ABS(
            CASE
              WHEN a.type IN ('asset', 'expense') THEN COALESCE(SUM(CASE WHEN v.id IS NOT NULL THEN jl.debit_amount - jl.credit_amount ELSE 0 END), 0)
              ELSE COALESCE(SUM(CASE WHEN v.id IS NOT NULL THEN jl.credit_amount - jl.debit_amount ELSE 0 END), 0)
            END
          ) >= 0.01
        ORDER BY a.code
      `).bind(fy.start_date, asOfDate, tenantId, type).all<{
        code: string | null;
        name: string;
        is_active: number | boolean | null;
        amount: number;
      }>();
      return result.results
        .map(r => ({
          code: r.code || undefined,
          name: r.name,
          amount: roundMoney(r.amount),
          isActive: !!r.is_active,
        }))
        .filter(r => r.isActive || Math.abs(r.amount) >= 0.01);
    };

    const [assets, liabilities, equity, currentEarnings] = await Promise.all([
      getAccountTotals('asset'),
      getAccountTotals('liability'),
      getAccountTotals('equity'),
      getGlIncomeExpenseTotals(c.env.DB, tenantId, fy.start_date, asOfDate),
    ]);
    const equityItems: BalanceSheetItem[] = [...equity];
    if (Math.abs(currentEarnings.profit) >= 0.01) {
      equityItems.push({ name: 'Current Year Earnings', amount: currentEarnings.profit });
    }

    const assetTotal = roundMoney(assets.reduce((s, a) => s + a.amount, 0));
    const liabilityTotal = roundMoney(liabilities.reduce((s, a) => s + a.amount, 0));
    const equityTotal = roundMoney(equityItems.reduce((s, a) => s + a.amount, 0));
    const balanceDifference = roundMoney(assetTotal - liabilityTotal - equityTotal);

    return c.json({
      fiscalYear: fy.fiscal_year_name,
      asOfDate,
      assets: { items: assets, total: assetTotal },
      liabilities: { items: liabilities, total: liabilityTotal },
      equity: { items: equityItems, total: equityTotal },
      totals: {
        assets: assetTotal,
        liabilitiesAndEquity: roundMoney(liabilityTotal + equityTotal),
        difference: balanceDifference,
        isBalanced: Math.abs(balanceDifference) < 0.01,
      },
    });
  } catch (error) {
    console.error('Error generating balance sheet:', error);
    return c.json({ error: 'Failed to generate balance sheet' }, 500);
  }
});

reportsRoutes.get('/cash-flow', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { fiscalYearId } = c.req.query();

  try {
    const fyId = fiscalYearId
      ? parseInt(fiscalYearId)
      : (await db.$client.prepare(
          `SELECT id FROM fiscal_years WHERE tenant_id = ? AND is_active = 1 LIMIT 1`
        ).bind(tenantId).first<{ id: number }>())?.id;

    if (!fyId) return c.json({ error: 'No active fiscal year found' }, 400);

    const fy = await db.$client.prepare(
      `SELECT * FROM fiscal_years WHERE id = ? AND tenant_id = ?`
    ).bind(fyId, tenantId).first<{ start_date: string; end_date: string; fiscal_year_name: string }>();

    const cashAtStart = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) as balance
      FROM accounting_journal_lines jl
      JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
      JOIN accounting_account_mappings m ON m.tenant_id = jl.tenant_id AND m.account_id = jl.account_id
      WHERE jl.tenant_id = ?
        AND v.status = 'verified'
        AND v.entry_date < ?
        AND m.mapping_key IN (
          'cash', 'bank', 'card_clearing', 'bkash_wallet', 'nagad_wallet',
          'rocket_wallet', 'bank_transfer_clearing', 'cheque_clearing',
          'other_payment_clearing'
        )
        AND m.is_active = 1
    `).bind(tenantId, fy!.start_date).first<{ balance: number }>();

    const movement = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(jl.debit_amount), 0) as receipts,
        COALESCE(SUM(jl.credit_amount), 0) as payments
      FROM accounting_journal_lines jl
      JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
      JOIN accounting_account_mappings m ON m.tenant_id = jl.tenant_id AND m.account_id = jl.account_id
      WHERE jl.tenant_id = ?
        AND v.status = 'verified'
        AND v.entry_date >= ? AND v.entry_date <= ?
        AND m.mapping_key IN (
          'cash', 'bank', 'card_clearing', 'bkash_wallet', 'nagad_wallet',
          'rocket_wallet', 'bank_transfer_clearing', 'cheque_clearing',
          'other_payment_clearing'
        )
        AND m.is_active = 1
    `).bind(tenantId, fy!.start_date, fy!.end_date).first<{ receipts: number; payments: number }>();

    const opening = cashAtStart?.balance ?? 0;
    const income = movement?.receipts ?? 0;
    const expenses = movement?.payments ?? 0;
    const netCash = income - expenses;
    const closing = opening + netCash;

    return c.json({
      fiscalYear: fy!.fiscal_year_name,
      openingBalance: opening,
      operating: { inflows: income, outflows: expenses },
      investing: { inflows: 0, outflows: 0 },
      financing: { inflows: 0, outflows: 0 },
      closingBalance: closing,
    });
  } catch (error) {
    console.error('Error generating cash flow:', error);
    return c.json({ error: 'Failed to generate cash flow statement' }, 500);
  }
});

reportsRoutes.get('/day-book', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.query();

  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400);
  }

  try {
    const result = await db.$client.prepare(`
      SELECT
        v.voucher_number as voucherNumber,
        v.entry_date as date,
        COALESCE(v.description, '-') as description,
        vt.name as voucherType,
        COALESCE(SUM(jl.debit_amount), 0) as debit,
        COALESCE(SUM(jl.credit_amount), 0) as credit,
        u.name as createdBy
      FROM accounting_vouchers v
      JOIN accounting_journal_lines jl ON jl.voucher_id = v.id AND jl.tenant_id = v.tenant_id
      LEFT JOIN voucher_types vt ON vt.id = v.voucher_type_id AND vt.tenant_id = v.tenant_id
      LEFT JOIN users u ON CAST(u.id AS TEXT) = v.created_by
      WHERE v.tenant_id = ? AND v.status = 'verified' AND v.entry_date >= ? AND v.entry_date <= ?
      GROUP BY v.id
      ORDER BY v.entry_date DESC, v.id DESC
    `).bind(tenantId, startDate, endDate).all<{
      voucherNumber: string; date: string; description: string;
      voucherType: string; debit: number; credit: number; createdBy: string;
    }>();

    const totalDebit = result.results.reduce((s, r) => s + r.debit, 0);
    const totalCredit = result.results.reduce((s, r) => s + r.credit, 0);

    return c.json({
      date: startDate === endDate ? startDate : `${startDate} to ${endDate}`,
      vouchers: result.results.map(r => ({
        voucherNumber: r.voucherNumber,
        voucherType: r.voucherType || 'Journal Voucher',
        description: r.description,
        debit: r.debit,
        credit: r.credit,
        createdBy: r.createdBy || 'System',
      })),
      totalDebit,
      totalCredit,
    });
  } catch (error) {
    console.error('Error generating day book:', error);
    return c.json({ error: 'Failed to generate day book' }, 500);
  }
});

reportsRoutes.get('/cash-book', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.query();

  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400);
  }

  try {
    const cashLedger = await db.$client.prepare(`
      SELECT account_id as id
      FROM accounting_account_mappings
      WHERE tenant_id = ? AND mapping_key = 'cash' AND is_active = 1
      LIMIT 1
    `).bind(tenantId).first<{ id: number }>();

    const openingResult = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) as balance
      FROM accounting_journal_lines jl
      JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
      WHERE jl.account_id = ? AND jl.tenant_id = ? AND v.status = 'verified' AND v.entry_date < ?
    `).bind(cashLedger?.id, tenantId, startDate).first<{ balance: number }>();

    const transactionsResult = await db.$client.prepare(`
      SELECT
        v.entry_date as date,
        COALESCE(v.description, '-') as description,
        COALESCE(v.voucher_number, '-') as reference,
        COALESCE(SUM(jl.debit_amount), 0) as receipt,
        COALESCE(SUM(jl.credit_amount), 0) as payment
      FROM accounting_journal_lines jl
      JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
      WHERE jl.tenant_id = ? AND v.status = 'verified'
        AND v.entry_date >= ? AND v.entry_date <= ?
        AND jl.account_id = ?
      GROUP BY v.id
      ORDER BY v.entry_date ASC
    `).bind(tenantId, startDate, endDate, cashLedger?.id)
      .all<{ date: string; description: string; reference: string; receipt: number; payment: number }>();

    let runningBalance = openingResult?.balance ?? 0;
    const transactions = transactionsResult.results.map(t => {
      runningBalance += t.receipt - t.payment;
      return { ...t, balance: runningBalance };
    });

    const totalReceipts = transactions.reduce((s, t) => s + t.receipt, 0);
    const totalPayments = transactions.reduce((s, t) => s + t.payment, 0);

    return c.json({
      startDate,
      endDate,
      cash: {
        opening: openingResult?.balance ?? 0,
        receipts: totalReceipts,
        payments: totalPayments,
        closing: runningBalance,
        transactions,
      },
      bank: { accounts: [] },
    });
  } catch (error) {
    console.error('Error generating cash book:', error);
    return c.json({ error: 'Failed to generate cash book' }, 500);
  }
});

reportsRoutes.get('/ledger', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const query = c.req.query();
  const ledgerId = query.ledgerId || query.accountId || query.account_id;
  const startDate = query.startDate || query.from || query.start_date || '1970-01-01';
  const endDate = query.endDate || query.to || query.end_date || '2099-12-31';

  if (!ledgerId) return c.json({ error: 'ledgerId is required' }, 400);

  try {
    const account = await db.$client.prepare(`
      SELECT id, code, name, type FROM chart_of_accounts WHERE id = ? AND tenant_id = ?
    `).bind(ledgerId, tenantId).first<{ id: number; code: string; name: string; type: string }>();

    if (!account) return c.json({ error: 'Account not found' }, 404);

    const openingResult = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) as opening
      FROM accounting_journal_lines jl
      JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
      WHERE jl.account_id = ? AND jl.tenant_id = ? AND v.status = 'verified' AND v.entry_date < ?
    `).bind(ledgerId, tenantId, startDate).first<{ opening: number }>();

    const transactionsResult = await db.$client.prepare(`
      SELECT
        v.entry_date as date,
        COALESCE(v.voucher_number, '-') as voucherNumber,
        COALESCE(v.description, '-') as description,
        jl.debit_amount as debit,
        jl.credit_amount as credit
      FROM accounting_journal_lines jl
      JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
      WHERE jl.tenant_id = ? AND v.status = 'verified'
        AND jl.account_id = ?
        AND v.entry_date >= ? AND v.entry_date <= ?
      ORDER BY v.entry_date ASC, v.id ASC, jl.line_no ASC
    `).bind(tenantId, ledgerId, startDate, endDate)
      .all<{ date: string; voucherNumber: string; description: string; debit: number; credit: number }>();

    let runningBalance = roundMoney(openingResult?.opening ?? 0);
    let totalDebit = 0;
    let totalCredit = 0;
    const transactions = transactionsResult.results.map(t => {
      const debit = roundMoney(t.debit);
      const credit = roundMoney(t.credit);
      totalDebit = roundMoney(totalDebit + debit);
      totalCredit = roundMoney(totalCredit + credit);
      runningBalance = roundMoney(runningBalance + debit - credit);
      return { ...t, debit, credit, balance: runningBalance };
    });

    return c.json({
      accountId: account.id,
      ledgerName: account.name,
      ledgerCode: account.code,
      ledgerType: account.type,
      startDate,
      endDate,
      opening: roundMoney(openingResult?.opening ?? 0),
      transactions,
      closing: runningBalance,
      summary: {
        totalDebit,
        totalCredit,
        transactionCount: transactions.length,
      },
    });
  } catch (error) {
    console.error('Error generating ledger report:', error);
    return c.json({ error: 'Failed to generate ledger report' }, 500);
  }
});

// Bank Reconciliation Report
// GET /api/reports/bank-reconciliation?fiscalYearId=1&bankAccountId=5
reportsRoutes.get('/bank-reconciliation', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { fiscalYearId, bankAccountId } = c.req.query();

  if (!bankAccountId) {
    return c.json({ error: 'bankAccountId is required' }, 400);
  }

  try {
    const accId = parseInt(bankAccountId);
    const fyId = fiscalYearId
      ? parseInt(fiscalYearId)
      : (await db.$client.prepare(
          'SELECT id FROM fiscal_years WHERE tenant_id = ? AND is_active = 1 LIMIT 1'
        ).bind(tenantId).first<{ id: number }>())?.id;

    if (!fyId) return c.json({ error: 'No active fiscal year' }, 400);

    const fy = await db.$client.prepare(
      'SELECT * FROM fiscal_years WHERE id = ? AND tenant_id = ?'
    ).bind(fyId, tenantId).first<{ start_date: string; end_date: string; fiscal_year_name: string }>();

    const entries = await db.$client.prepare(`
      SELECT v.entry_date as date, v.voucher_number, v.description,
        SUM(jl.debit_amount) as deposits,
        SUM(jl.credit_amount) as withdrawals
      FROM accounting_journal_lines jl
      JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
      WHERE jl.tenant_id = ? AND v.status = 'verified'
        AND v.entry_date >= ? AND v.entry_date <= ?
        AND jl.account_id = ?
      GROUP BY v.id
      ORDER BY v.entry_date
    `).bind(tenantId, fy!.start_date, fy!.end_date, accId)
      .all<{ date: string; voucher_number: string; description: string; deposits: number; withdrawals: number }>();

    const openingBalanceResult = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) as balance
      FROM accounting_journal_lines jl
      JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
      WHERE jl.tenant_id = ? AND jl.account_id = ? AND v.status = 'verified' AND v.entry_date < ?
    `).bind(tenantId, accId, fy!.start_date).first<{ balance: number }>();

    let runningBalance = openingBalanceResult?.balance ?? 0;
    const transactions = entries.results.map(e => {
      runningBalance += e.deposits - e.withdrawals;
      return { ...e, balance: runningBalance };
    });

    const totalDeposits = entries.results.reduce((s, e) => s + e.deposits, 0);
    const totalWithdrawals = entries.results.reduce((s, e) => s + e.withdrawals, 0);

    return c.json({
      fiscalYear: fy!.fiscal_year_name,
      accountId: accId,
      bookBalance: runningBalance,
      transactions,
      summary: {
        openingBalance: openingBalanceResult?.balance ?? 0,
        totalDeposits,
        totalWithdrawals,
        closingBalance: runningBalance,
      },
    });
  } catch (error) {
    console.error('Error generating bank reconciliation:', error);
    return c.json({ error: 'Failed to generate bank reconciliation' }, 500);
  }
});

// Group Statement Report - shows all accounts under a ledger group
// GET /api/reports/group-statement?ledgerGroupId=1&fiscalYearId=1
reportsRoutes.get('/group-statement', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { ledgerGroupId, fiscalYearId } = c.req.query();

  if (!ledgerGroupId) return c.json({ error: 'ledgerGroupId is required' }, 400);

  try {
    const fyId = fiscalYearId
      ? parseInt(fiscalYearId)
      : (await db.$client.prepare(
          'SELECT id FROM fiscal_years WHERE tenant_id = ? AND is_active = 1 LIMIT 1'
        ).bind(tenantId).first<{ id: number }>())?.id;

    if (!fyId) return c.json({ error: 'No active fiscal year' }, 400);

    const fy = await db.$client.prepare(
      'SELECT start_date, end_date, fiscal_year_name FROM fiscal_years WHERE id = ? AND tenant_id = ?'
    ).bind(fyId, tenantId).first<{ start_date: string; end_date: string; fiscal_year_name: string }>();

    const accountsResult = await db.$client.prepare(`
      SELECT a.id, a.code, a.name, a.type,
        COALESCE(SUM(CASE WHEN v.id IS NOT NULL THEN jl.debit_amount ELSE 0 END), 0) as total_debit,
        COALESCE(SUM(CASE WHEN v.id IS NOT NULL THEN jl.credit_amount ELSE 0 END), 0) as total_credit
      FROM chart_of_accounts a
      LEFT JOIN accounting_journal_lines jl ON jl.account_id = a.id AND jl.tenant_id = a.tenant_id
      LEFT JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
        AND v.status = 'verified' AND v.entry_date >= ? AND v.entry_date <= ?
      WHERE a.tenant_id = ? AND a.is_active = 1 AND (a.parent_id = ? OR a.id = ?)
      GROUP BY a.id
      ORDER BY a.code
    `).bind(fy!.start_date, fy!.end_date, tenantId, ledgerGroupId, ledgerGroupId)
      .all<{ id: number; code: string; name: string; type: string; total_debit: number; total_credit: number }>();

    const accountsWithNet = accountsResult.results.map(a => ({
      ...a,
      netBalance: a.type === 'asset' || a.type === 'expense'
        ? a.total_debit - a.total_credit
        : a.total_credit - a.total_debit,
    }));

    const totals = accountsWithNet.reduce((acc, a) => ({
      totalDebit: acc.totalDebit + a.total_debit,
      totalCredit: acc.totalCredit + a.total_credit,
      totalNet: acc.totalNet + a.netBalance,
    }), { totalDebit: 0, totalCredit: 0, totalNet: 0 });

    return c.json({
      fiscalYear: fy!.fiscal_year_name,
      groupId: ledgerGroupId,
      accounts: accountsWithNet,
      totals,
    });
  } catch (error) {
    console.error('Error generating group statement:', error);
    return c.json({ error: 'Failed to generate group statement' }, 500);
  }
});

export default reportsRoutes;
