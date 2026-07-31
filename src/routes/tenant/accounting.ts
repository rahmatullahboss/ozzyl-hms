import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { getTodayGMT6 } from '../../lib/date-utils';
import { requireRole } from '../../middleware/rbac';
import { backfillAccountingPostingEvents } from '../../lib/accounting-backfill';
import { runAccountingInvariantChecks } from '../../lib/accounting-invariants';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../lib/accounting-posting';
import {
  getGlBreakdown,
  getGlIncomeExpenseTotals,
  getGlMonthlyIncomeExpense,
} from '../../lib/accounting-reporting';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';


const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post vendor payment accounting event:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function dashboardQuery<T>(task: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(task);
}

dashboardRoutes.get('/audit-checks', requireRole('hospital_admin', 'md', 'director', 'accountant'), async (c) => {
  const tenantId = requireTenantId(c);
  const report = await runAccountingInvariantChecks(c.env.DB, tenantId);
  return c.json(report, report.ok ? 200 : 409);
});

const vendorPaymentSchema = z.object({
  vendor_id: z.number().int().positive(),
  goods_receipt_id: z.number().int().positive().optional(),
  payment_date: z.string().min(1),
  paid_amount: z.number().positive(),
  payment_mode: z.enum(['cash', 'bank', 'cheque', 'card', 'mobile_banking', 'other']).default('cash'),
  receiver_account_id: z.number().int().positive().optional(),
  remarks: z.string().max(1000).optional(),
});

const postingProcessSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
});

dashboardRoutes.post(
  '/posting-events/process',
  requireRole('hospital_admin', 'md', 'director', 'accountant'),
  zValidator('json', postingProcessSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    const data = c.req.valid('json');
    const results = await postPendingAccountingEvents(c.env.DB, tenantId, data.limit);
    const audit = await runAccountingInvariantChecks(c.env.DB, tenantId);

    return c.json({
      processed: results.length,
      posted: results.filter((result) => result.posted).length,
      skipped: results.filter((result) => !result.posted).length,
      results,
      audit,
    }, audit.ok ? 200 : 409);
  }
);

dashboardRoutes.post(
  '/posting-events/backfill',
  requireRole('hospital_admin', 'md', 'director', 'accountant'),
  zValidator('json', postingProcessSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const data = c.req.valid('json');
    const backfilled = await backfillAccountingPostingEvents(c.env.DB, tenantId, userId);
    const results = await postPendingAccountingEvents(c.env.DB, tenantId, data.limit);
    const audit = await runAccountingInvariantChecks(c.env.DB, tenantId);

    return c.json({
      backfilled,
      processed: results.length,
      posted: results.filter((result) => result.posted).length,
      skipped: results.filter((result) => !result.posted).length,
      results,
      audit,
    }, audit.ok ? 200 : 409);
  }
);

dashboardRoutes.get('/vendor-payments', requireRole('hospital_admin', 'director', 'accountant'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const vendorId = c.req.query('vendor_id');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  const conditions = ['tenant_id = ?', "status = 'posted'"];
  const params: (string | number)[] = [tenantId];
  if (vendorId) {
    conditions.push('vendor_id = ?');
    params.push(Number(vendorId));
  }
  const where = conditions.join(' AND ');

  const [countResult, payments] = await Promise.all([
    db.$client.prepare(`SELECT COUNT(*) as total FROM accounting_vendor_payments WHERE ${where}`).bind(...params).first<{ total: number }>(),
    db.$client.prepare(`
      SELECT * FROM accounting_vendor_payments
      WHERE ${where}
      ORDER BY payment_date DESC, id DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all(),
  ]);

  return c.json({ data: payments.results, pagination: { page, limit, total: countResult?.total || 0 } });
});

dashboardRoutes.get('/vendor-ledger/:vendorId', requireRole('hospital_admin', 'director', 'accountant'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const vendorId = Number(c.req.param('vendorId'));
  if (!vendorId) throw new HTTPException(400, { message: 'Invalid vendor ID' });

  const vendor = await db.$client.prepare(
    'SELECT VendorId, VendorName, CreditPeriod FROM InventoryVendor WHERE VendorId = ? AND tenant_id = ? AND IsActive = 1'
  ).bind(vendorId, tenantId).first();
  if (!vendor) throw new HTTPException(404, { message: 'Vendor not found' });

  const [goodsReceipts, payments] = await Promise.all([
    db.$client.prepare(`
      SELECT GoodsReceiptId, GRNumber, GRDate, TotalAmount, PaidAmount, PaymentStatus
      FROM InventoryGoodsReceipt
      WHERE tenant_id = ? AND VendorId = ?
      ORDER BY GRDate DESC, GoodsReceiptId DESC
      LIMIT 100
    `).bind(tenantId, vendorId).all(),
    db.$client.prepare(`
      SELECT *
      FROM accounting_vendor_payments
      WHERE tenant_id = ? AND vendor_id = ? AND status = 'posted'
      ORDER BY payment_date DESC, id DESC
      LIMIT 100
    `).bind(tenantId, vendorId).all(),
  ]);

  const grTotal = (goodsReceipts.results as any[]).reduce((sum, row) => sum + Number(row.TotalAmount || 0), 0);
  const paidTotal = (payments.results as any[]).reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);

  return c.json({
    vendor,
    goods_receipts: goodsReceipts.results,
    payments: payments.results,
    summary: { total_billed: grTotal, total_paid: paidTotal, balance: grTotal - paidTotal },
  });
});

dashboardRoutes.post('/vendor-payments', requireRole('hospital_admin', 'director', 'accountant'), zValidator('json', vendorPaymentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  await assertAccountingPeriodOpen(c.env.DB, tenantId, data.payment_date, 'Vendor payment posting');

  const vendor = await db.$client.prepare(
    'SELECT VendorId, VendorName FROM InventoryVendor WHERE VendorId = ? AND tenant_id = ? AND IsActive = 1'
  ).bind(data.vendor_id, tenantId).first<{ VendorId: number; VendorName: string }>();
  if (!vendor) throw new HTTPException(400, { message: 'Vendor not found' });

  let totalAmount = data.paid_amount;
  let paidBefore = 0;
  if (data.goods_receipt_id) {
    const gr = await db.$client.prepare(`
      SELECT GoodsReceiptId, TotalAmount, PaidAmount
      FROM InventoryGoodsReceipt
      WHERE GoodsReceiptId = ? AND VendorId = ? AND tenant_id = ?
    `).bind(data.goods_receipt_id, data.vendor_id, tenantId).first<{ GoodsReceiptId: number; TotalAmount: number; PaidAmount: number | null }>();
    if (!gr) throw new HTTPException(400, { message: 'Goods receipt not found for this vendor' });
    totalAmount = Number(gr.TotalAmount || data.paid_amount);
    paidBefore = Number(gr.PaidAmount || 0);
  }

  const remainingAmount = Math.max(0, totalAmount - paidBefore - data.paid_amount);
  const referenceNo = data.goods_receipt_id ? `GR-${data.goods_receipt_id}` : `VENDOR-${data.vendor_id}`;

  const expenseResult = await db.$client.prepare(`
    INSERT INTO expenses (
      date, category, amount, description, status, approved_by, approved_at,
      tenant_id, created_by, source_type, source_id, reference_no
    ) VALUES (?, 'vendor_payment', ?, ?, 'approved', ?, datetime('now', '+6 hours'), ?, ?, 'vendor_payment', ?, ?)
  `).bind(
    data.payment_date,
    data.paid_amount,
    data.remarks || `Vendor payment to ${vendor.VendorName}`,
    userId,
    tenantId,
    userId,
    data.goods_receipt_id || data.vendor_id,
    referenceNo,
  ).run();

  const paymentResult = await db.$client.prepare(`
    INSERT INTO accounting_vendor_payments (
      tenant_id, vendor_id, vendor_name, goods_receipt_id, payment_date, total_amount,
      paid_amount, remaining_amount, payment_mode, receiver_account_id, expense_id,
      remarks, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    data.vendor_id,
    vendor.VendorName,
    data.goods_receipt_id || null,
    data.payment_date,
    totalAmount,
    data.paid_amount,
    remainingAmount,
    data.payment_mode,
    data.receiver_account_id || null,
    expenseResult.meta.last_row_id,
    data.remarks || null,
    userId,
  ).run();

  if (data.goods_receipt_id) {
    await db.$client.prepare(`
      UPDATE InventoryGoodsReceipt
      SET PaidAmount = COALESCE(PaidAmount, 0) + ?,
          PaymentStatus = CASE WHEN COALESCE(PaidAmount, 0) + ? >= TotalAmount THEN 'paid' ELSE 'partial' END,
          ModifiedBy = ?, ModifiedOn = datetime('now', '+6 hours')
      WHERE GoodsReceiptId = ? AND VendorId = ? AND tenant_id = ?
    `).bind(data.paid_amount, data.paid_amount, userId, data.goods_receipt_id, data.vendor_id, tenantId).run();
  }

  const paymentId = Number(paymentResult.meta.last_row_id);
  await recordAccountingPostingEvent(c.env.DB, {
    tenantId,
    sourceType: 'vendor_payment',
    sourceId: paymentId,
    eventType: ACCOUNTING_EVENT_TYPES.supplierPayment,
    eventDate: data.payment_date,
    createdBy: userId,
    payload: {
      paymentId,
      vendorId: data.vendor_id,
      supplierId: data.vendor_id,
      goodsReceiptId: data.goods_receipt_id ?? null,
      amount: data.paid_amount,
      paymentMethod: data.payment_mode,
      referenceNo,
    },
  });
  queueAccountingPosting(c, tenantId);

  return c.json({
    id: paymentId,
    expense_id: expenseResult.meta.last_row_id,
    remaining_amount: remainingAmount,
    message: 'Vendor payment posted',
  }, 201);
});

dashboardRoutes.get('/summary', async (c) => {
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();
  const monthStart = today.substring(0, 7) + '-01';

  try {
    const [
      todayTotals,
      mtdTotals,
      collectionRow,
      handoverRow,
      dueRow,
      advanceRow,
      refundRow,
      discountRow,
      doctorPayableRow,
      supplierPayableRow,
      postingRow,
    ] = await Promise.all([
      dashboardQuery(() => getGlIncomeExpenseTotals(c.env.DB, tenantId, today, today)),
      dashboardQuery(() => getGlIncomeExpenseTotals(c.env.DB, tenantId, monthStart, today)),
      dashboardQuery(() => c.env.DB.prepare(`
        SELECT COALESCE(SUM(
          CASE
            WHEN transaction_type IN ('SalesReturn', 'ReturnDeposit', 'Refund') THEN -ABS(amount)
            ELSE ABS(amount)
          END
        ), 0) AS today_collection_total
        FROM emp_cash_transactions
        WHERE tenant_id = ?
          AND date(transaction_date) = date(?)
      `).bind(tenantId, today).first<{ today_collection_total: number }>()),
      dashboardQuery(() => c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'partial' THEN COALESCE(due_amount, 0) ELSE handover_amount END), 0) AS pending_handover_amount,
          COUNT(*) AS pending_handover_count
        FROM billing_handovers
        WHERE tenant_id = ?
          AND handover_type = 'counter'
          AND status IN ('pending', 'partial')
      `).bind(tenantId).first<{ pending_handover_amount: number; pending_handover_count: number }>()),
      dashboardQuery(() => c.env.DB.prepare(`
        SELECT COALESCE(SUM(
          CASE
            WHEN COALESCE(NULLIF(total, 0), total_amount, 0) - COALESCE(NULLIF(paid, 0), paid_amount, 0) > 0
              THEN COALESCE(NULLIF(total, 0), total_amount, 0) - COALESCE(NULLIF(paid, 0), paid_amount, 0)
            ELSE 0
          END
        ), 0) AS patient_due_total
        FROM bills
        WHERE tenant_id = ?
          AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      `).bind(tenantId).first<{ patient_due_total: number }>()),
      dashboardQuery(() => c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0)
          AS patient_advance_total
        FROM billing_deposits
        WHERE tenant_id = ?
          AND is_active = 1
      `).bind(tenantId).first<{ patient_advance_total: number }>()),
      dashboardQuery(() => c.env.DB.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS refund_today_total
        FROM (
          SELECT COALESCE(total_amount, 0) AS amount, created_at AS refund_date
          FROM billing_credit_notes
          WHERE tenant_id = ? AND is_active = 1
          UNION ALL
          SELECT COALESCE(amount, 0) AS amount, created_at AS refund_date
          FROM billing_deposits
          WHERE tenant_id = ? AND is_active = 1 AND transaction_type = 'refund'
          UNION ALL
          SELECT COALESCE(total_return_amount, 0) AS amount, created_at AS refund_date
          FROM pharmacy_returns
          WHERE tenant_id = ?
        )
        WHERE date(refund_date) = date(?)
      `).bind(tenantId, tenantId, tenantId, today).first<{ refund_today_total: number }>()),
      dashboardQuery(() => c.env.DB.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS discount_today_total
        FROM (
          SELECT COALESCE(discount, 0) AS amount, created_at AS discount_date
          FROM bills
          WHERE tenant_id = ? AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
          UNION ALL
          SELECT COALESCE(discount_amount, 0) AS amount, created_at AS discount_date
          FROM billing_settlements
          WHERE tenant_id = ? AND is_active = 1
        )
        WHERE amount > 0
          AND date(discount_date) = date(?)
      `).bind(tenantId, tenantId, today).first<{ discount_today_total: number }>()),
      dashboardQuery(() => c.env.DB.prepare(`
        SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0) AS doctor_payable_total
        FROM accounting_journal_lines jl
        JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
        JOIN accounting_account_mappings m ON m.tenant_id = jl.tenant_id AND m.account_id = jl.account_id
        WHERE jl.tenant_id = ?
          AND v.status = 'verified'
          AND m.mapping_key = 'doctor_commission_payable'
          AND m.is_active = 1
      `).bind(tenantId).first<{ doctor_payable_total: number }>()),
      dashboardQuery(() => c.env.DB.prepare(`
        SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0) AS supplier_payable_total
        FROM accounting_journal_lines jl
        JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
        JOIN accounting_account_mappings m ON m.tenant_id = jl.tenant_id AND m.account_id = jl.account_id
        WHERE jl.tenant_id = ?
          AND v.status = 'verified'
          AND m.mapping_key = 'accounts_payable'
          AND m.is_active = 1
      `).bind(tenantId).first<{ supplier_payable_total: number }>()),
      dashboardQuery(() => c.env.DB.prepare(`
        SELECT COUNT(*) AS pending_posting_events
        FROM accounting_posting_events
        WHERE tenant_id = ?
          AND status = 'pending'
      `).bind(tenantId).first<{ pending_posting_events: number }>()),
    ]);

    return c.json({
      today: {
        income: todayTotals.income,
        expense: todayTotals.expense,
        profit: todayTotals.profit
      },
      mtd: {
        income: mtdTotals.income,
        expense: mtdTotals.expense,
        profit: mtdTotals.profit
      },
      operations: {
        todayCollection: roundMoney(collectionRow?.today_collection_total ?? 0),
        pendingHandoverAmount: roundMoney(handoverRow?.pending_handover_amount ?? 0),
        pendingHandoverCount: Number(handoverRow?.pending_handover_count ?? 0),
        patientDue: roundMoney(dueRow?.patient_due_total ?? 0),
        patientAdvance: roundMoney(advanceRow?.patient_advance_total ?? 0),
        todayRefunds: roundMoney(refundRow?.refund_today_total ?? 0),
        todayDiscounts: roundMoney(discountRow?.discount_today_total ?? 0),
        doctorPayable: roundMoney(doctorPayableRow?.doctor_payable_total ?? 0),
        supplierPayable: roundMoney(supplierPayableRow?.supplier_payable_total ?? 0),
        pendingPostingEvents: Number(postingRow?.pending_posting_events ?? 0),
      },
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return c.json({ error: 'Failed to fetch dashboard data' }, 500);
  }
});

dashboardRoutes.get('/mtd', async (c) => {
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();
  const monthStart = today.substring(0, 7) + '-01';

  try {
    const totals = await getGlIncomeExpenseTotals(c.env.DB, tenantId, monthStart, today);

    return c.json({
      income: totals.income,
      expense: totals.expense,
      profit: totals.profit,
      month: today.substring(0, 7)
    });
  } catch (error) {
    console.error('MTD error:', error);
    return c.json({ error: 'Failed to fetch MTD data' }, 500);
  }
});

dashboardRoutes.get('/trends', async (c) => {
  const tenantId = requireTenantId(c);

  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const startDate = `${sixMonthsAgo.toISOString().slice(0, 7)}-01`;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endExclusive = tomorrow.toISOString().split('T')[0];
    const trends = await getGlMonthlyIncomeExpense(c.env.DB, tenantId, startDate, endExclusive);

    return c.json({ trends });
  } catch (error) {
    console.error('Trends error:', error);
    return c.json({ error: 'Failed to fetch trends' }, 500);
  }
});

dashboardRoutes.get('/income-breakdown', async (c) => {
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();
  const monthStart = today.substring(0, 7) + '-01';

  try {
    const rows = await getGlBreakdown(c.env.DB, tenantId, monthStart, today, 'revenue');
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    const breakdown = rows.map(r => ({
      source: r.name,
      amount: r.amount,
      percentage: total > 0 ? (r.amount / total * 100).toFixed(1) : '0'
    }));

    return c.json({ breakdown, total });
  } catch (error) {
    console.error('Income breakdown error:', error);
    return c.json({ error: 'Failed to fetch income breakdown' }, 500);
  }
});

dashboardRoutes.get('/expense-breakdown', async (c) => {
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();
  const monthStart = today.substring(0, 7) + '-01';

  try {
    const rows = await getGlBreakdown(c.env.DB, tenantId, monthStart, today, 'expense');
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    const breakdown = rows.map(r => ({
      category: r.name,
      amount: r.amount,
      percentage: total > 0 ? (r.amount / total * 100).toFixed(1) : '0'
    }));

    return c.json({ breakdown, total });
  } catch (error) {
    console.error('Expense breakdown error:', error);
    return c.json({ error: 'Failed to fetch expense breakdown' }, 500);
  }
});

export default dashboardRoutes;
