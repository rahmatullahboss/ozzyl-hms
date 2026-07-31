import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getTodayGMT6 } from '../../lib/date-utils';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';


const billingReports = new Hono<{ Bindings: Env; Variables: Variables }>();
const REPORT_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;
const FINANCE_REPORT_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;


function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}


function parseDate(value: string | undefined, label: string): string {
  if (!value) throw new HTTPException(400, { message: `${label} is required` });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HTTPException(400, { message: `${label} must be YYYY-MM-DD` });
  return value;
}


function parseOptionalInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}


const localReportDate = (field: string): string => `date(${field}, '+6 hours')`;


const normalizedPaymentMethod = (field = 'payment_method'): string => `
  CASE
    WHEN LOWER(TRIM(COALESCE(${field}, ''))) IN ('cash', 'cash payment') THEN 'cash'
    WHEN LOWER(TRIM(COALESCE(${field}, ''))) IN ('bkash', 'b-kash', 'b kash') THEN 'bkash'
    WHEN LOWER(TRIM(COALESCE(${field}, ''))) = 'nagad' THEN 'nagad'
    WHEN LOWER(TRIM(COALESCE(${field}, ''))) = 'rocket' THEN 'rocket'
    WHEN LOWER(TRIM(COALESCE(${field}, ''))) IN ('card', 'debit_card', 'credit_card') THEN 'card'
    WHEN LOWER(TRIM(COALESCE(${field}, ''))) IN ('bank', 'bank_transfer', 'bank transfer') THEN 'bank_transfer'
    WHEN LOWER(TRIM(COALESCE(${field}, ''))) = 'cheque' THEN 'cheque'
    WHEN TRIM(COALESCE(${field}, '')) = '' THEN 'unknown'
    ELSE LOWER(TRIM(COALESCE(${field}, 'unknown')))
  END
`;


billingReports.use('*', requireRole(...REPORT_ROLES));


// ─── GET /handover/receive — handover receive report ────────────────────────

billingReports.get('/handover/receive', requireRole(...FINANCE_REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');

  const { results } = await db.$client.prepare(`
    SELECT
      h.id,
      h.handover_type,
      h.handover_amount,
      h.due_amount,
      h.status,
      h.created_at,
      s1.name as handover_by_name,
      s2.name as handover_to_name,
      s3.name as received_by_name
    FROM billing_handovers h
    LEFT JOIN staff s1 ON h.handover_by = s1.id
    LEFT JOIN staff s2 ON h.handover_to = s2.id
    LEFT JOIN staff s3 ON h.received_by = s3.id
    WHERE h.tenant_id = ?
      AND date(h.created_at) BETWEEN ? AND ?
      AND h.status = 'received'
    ORDER BY h.created_at DESC
  `).bind(tenantId, startDate, endDate).all();

  const summary = await db.$client.prepare(`
    SELECT
      COUNT(*) as total_handovers,
      COALESCE(SUM(handover_amount), 0) as total_amount,
      COALESCE(SUM(due_amount), 0) as total_due
    FROM billing_handovers
    WHERE tenant_id = ?
      AND date(created_at) BETWEEN ? AND ?
      AND status = 'received'
  `).bind(tenantId, startDate, endDate).first();

  return c.json({
    handovers: results,
    summary: {
      total_handovers: Number(summary?.total_handovers ?? 0),
      total_amount: roundMoney(Number(summary?.total_amount ?? 0)),
      total_due: roundMoney(Number(summary?.total_due ?? 0)),
    },
  });
});


// ─── GET /handover/detail — handover detail report ──────────────────────────

billingReports.get('/handover/detail', requireRole(...FINANCE_REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');
  const employeeId = parseOptionalInt(c.req.query('employee_id'));

  let sql = `
    SELECT
      h.id,
      h.handover_type,
      h.handover_amount,
      h.due_amount,
      h.status,
      h.remarks,
      h.created_at,
      s1.name as handover_by_name,
      s2.name as handover_to_name,
      s3.name as received_by_name
    FROM billing_handovers h
    LEFT JOIN staff s1 ON h.handover_by = s1.id
    LEFT JOIN staff s2 ON h.handover_to = s2.id
    LEFT JOIN staff s3 ON h.received_by = s3.id
    WHERE h.tenant_id = ?
      AND date(h.created_at) BETWEEN ? AND ?
  `;
  const params: (string | number)[] = [tenantId, startDate, endDate];

  if (employeeId) {
    sql += ' AND (h.handover_by = ? OR h.handover_to = ?)';
    params.push(employeeId, employeeId);
  }

  sql += ' ORDER BY h.created_at DESC';

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  return c.json({ handovers: results });
});


// ─── GET /handover/summary — handover summary report ────────────────────────

billingReports.get('/handover/summary', requireRole(...FINANCE_REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');

  const { results } = await db.$client.prepare(`
    SELECT
      h.handover_by as employee_id,
      s.name as employee_name,
      COUNT(*) as total_handovers,
      COALESCE(SUM(h.handover_amount), 0) as total_amount,
      COALESCE(SUM(h.due_amount), 0) as total_due,
      SUM(CASE WHEN h.status = 'received' THEN 1 ELSE 0 END) as received_count,
      SUM(CASE WHEN h.status = 'pending' THEN 1 ELSE 0 END) as pending_count,
      SUM(CASE WHEN h.status = 'verified' THEN 1 ELSE 0 END) as verified_count
    FROM billing_handovers h
    LEFT JOIN staff s ON h.handover_by = s.id
    WHERE h.tenant_id = ?
      AND date(h.created_at) BETWEEN ? AND ?
    GROUP BY h.handover_by, s.name
    ORDER BY total_amount DESC
  `).bind(tenantId, startDate, endDate).all();

  return c.json({ summary: results });
});


// ─── GET /discount/scheme-wise — scheme wise discount report ────────────────

billingReports.get('/discount/scheme-wise', requireRole(...FINANCE_REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');

  const { results } = await db.$client.prepare(`
    SELECT
      COALESCE(b.discount_reason, 'No Reason') as discount_reason,
      COUNT(*) as bill_count,
      COALESCE(SUM(b.discount), 0) as total_discount,
      COALESCE(SUM(b.total), 0) as total_amount,
      COALESCE(SUM(b.paid), 0) as total_paid
    FROM bills b
    WHERE b.tenant_id = ?
      AND date(b.created_at) BETWEEN ? AND ?
      AND COALESCE(b.discount, 0) > 0
      AND COALESCE(b.status, 'active') != 'cancelled'
    GROUP BY b.discount_reason
    ORDER BY total_discount DESC
  `).bind(tenantId, startDate, endDate).all();

  const summary = await db.$client.prepare(`
    SELECT
      COUNT(*) as total_bills,
      COALESCE(SUM(discount), 0) as total_discount
    FROM bills
    WHERE tenant_id = ?
      AND date(created_at) BETWEEN ? AND ?
      AND COALESCE(discount, 0) > 0
      AND COALESCE(status, 'active') != 'cancelled'
  `).bind(tenantId, startDate, endDate).first();

  return c.json({
    discounts: results,
    summary: {
      total_bills: Number(summary?.total_bills ?? 0),
      total_discount: roundMoney(Number(summary?.total_discount ?? 0)),
    },
  });
});


// ─── GET /discount/department-wise — department wise discount report ─────────

billingReports.get('/discount/department-wise', requireRole(...FINANCE_REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');

  const { results } = await db.$client.prepare(`
    SELECT
      COALESCE(ii.item_category, 'Unknown') as department,
      COUNT(*) as item_count,
      COALESCE(SUM(ii.line_total), 0) as total_amount
    FROM invoice_items ii
    JOIN bills b ON ii.bill_id = b.id AND b.tenant_id = ii.tenant_id
    WHERE ii.tenant_id = ?
      AND date(ii.created_at) BETWEEN ? AND ?
      AND COALESCE(b.status, 'active') != 'cancelled'
    GROUP BY ii.item_category
    ORDER BY total_amount DESC
  `).bind(tenantId, startDate, endDate).all();

  return c.json({ departments: results });
});


// ─── GET /discount/item-level — item level discount report ──────────────────

billingReports.get('/discount/item-level', requireRole(...FINANCE_REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');

  const { results } = await db.$client.prepare(`
    SELECT
      ii.description as item_name,
      ii.item_category as service_department,
      COUNT(*) as item_count,
      COALESCE(SUM(ii.line_total), 0) as total_amount,
      COALESCE(SUM(ii.quantity), 0) as total_quantity
    FROM invoice_items ii
    JOIN bills b ON ii.bill_id = b.id AND b.tenant_id = ii.tenant_id
    WHERE ii.tenant_id = ?
      AND date(ii.created_at) BETWEEN ? AND ?
      AND COALESCE(b.status, 'active') != 'cancelled'
    GROUP BY ii.description, ii.item_category
    ORDER BY total_amount DESC
    LIMIT 100
  `).bind(tenantId, startDate, endDate).all();

  return c.json({ items: results });
});


// ─── GET /daily-sales — daily sales report ──────────────────────────────────

billingReports.get('/daily-sales', requireRole(...REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const counterId = parseOptionalInt(c.req.query('counter_id'));
  const createdBy = parseOptionalInt(c.req.query('created_by'));

  let invoiceSql = `
    SELECT
      b.id,
      b.invoice_no,
      b.total as total_amount,
      b.discount,
      b.paid as paid_amount,
      b.due,
      b.status,
      b.created_at,
      p.name as patient_name,
      p.patient_code,
      s.name as created_by_name
    FROM bills b
    LEFT JOIN patients p ON b.patient_id = p.id AND p.tenant_id = b.tenant_id
    LEFT JOIN staff s ON b.created_by = s.id
    WHERE b.tenant_id = ?
      AND ${localReportDate('b.created_at')} = ?
      AND COALESCE(b.status, 'active') != 'cancelled'
  `;
  const invoiceParams: (string | number)[] = [tenantId, date];

  if (counterId) {
    invoiceSql += ' AND b.counter_id = ?';
    invoiceParams.push(counterId);
  }
  if (createdBy) {
    invoiceSql += ' AND b.created_by = ?';
    invoiceParams.push(createdBy);
  }

  invoiceSql += ' ORDER BY b.created_at DESC';

  const invoices = await db.$client.prepare(invoiceSql).bind(...invoiceParams).all();


  const settlementSql = `
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'settlement' THEN amount ELSE 0 END), 0) as total_settlement,
      COALESCE(SUM(CASE WHEN transaction_type = 'refund' THEN amount ELSE 0 END), 0) as total_refund,
      COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0) as total_adjustment
    FROM billing_deposits
    WHERE tenant_id = ?
      AND ${localReportDate('created_at')} = ?
      AND is_active = 1
  `;
  const settlements = await db.$client.prepare(settlementSql).bind(tenantId, date).first();


  let userCollectionSql = `
    SELECT
      ect.employee_id,
      s.name as employee_name,
      COALESCE(SUM(CASE
        WHEN ect.payment_method = 'cash'
         AND ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
        THEN ect.amount ELSE 0 END), 0) as cash_in,
      COALESCE(SUM(CASE
        WHEN ect.payment_method = 'cash'
         AND ect.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
        THEN ect.amount ELSE 0 END), 0) as cash_out,
      COALESCE(SUM(CASE WHEN ect.payment_method = 'cash' THEN
        CASE
          WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN ect.amount
          WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven') THEN -ect.amount
          ELSE 0
        END
      ELSE 0 END), 0) as net_cash
    FROM emp_cash_transactions ect
    LEFT JOIN staff s ON ect.employee_id = s.id
    WHERE ect.tenant_id = ?
      AND ${localReportDate('ect.transaction_date')} = ?
  `;
  const userCollectionParams: (string | number)[] = [tenantId, date];

  if (createdBy) {
    userCollectionSql += ' AND ect.employee_id = ?';
    userCollectionParams.push(createdBy);
  }

  userCollectionSql += ' GROUP BY ect.employee_id, s.name ORDER BY net_cash DESC';

  const userCollections = await db.$client.prepare(userCollectionSql).bind(...userCollectionParams).all();


  let summarySql = `
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'CashSales' THEN amount ELSE 0 END), 0) as total_cash_sales,
      COALESCE(SUM(CASE WHEN transaction_type = 'SalesReturn' THEN amount ELSE 0 END), 0) as total_sales_return,
      COALESCE(SUM(CASE WHEN transaction_type = 'DepositDeduct' THEN amount ELSE 0 END), 0) as total_deposit_deduct,
      COALESCE(SUM(CASE WHEN transaction_type = 'ReturnDeposit' THEN amount ELSE 0 END), 0) as total_deposit_return,
      COALESCE(SUM(CASE WHEN transaction_type = 'CollectionFromReceivable' THEN amount ELSE 0 END), 0) as total_collection_from_receivable,
      COALESCE(SUM(CASE WHEN transaction_type = 'CashDiscountGiven' THEN amount ELSE 0 END), 0) as total_cash_discount_given,
      COALESCE(SUM(CASE WHEN transaction_type = 'CashDiscountReceived' THEN amount ELSE 0 END), 0) as total_cash_discount_received
    FROM emp_cash_transactions
    WHERE tenant_id = ?
      AND ${localReportDate('transaction_date')} = ?
  `;
  const summaryParams: (string | number)[] = [tenantId, date];
  if (createdBy) {
    summarySql += ' AND employee_id = ?';
    summaryParams.push(createdBy);
  }

  const summary = await db.$client.prepare(summarySql).bind(...summaryParams).first();

  return c.json({
    date,
    invoices,
    settlements: {
      total_settlement: roundMoney(Number(settlements?.total_settlement ?? 0)),
      total_refund: roundMoney(Number(settlements?.total_refund ?? 0)),
      total_adjustment: roundMoney(Number(settlements?.total_adjustment ?? 0)),
    },
    user_collections: userCollections,
    summary: {
      total_cash_sales: roundMoney(Number(summary?.total_cash_sales ?? 0)),
      total_sales_return: roundMoney(Number(summary?.total_sales_return ?? 0)),
      total_deposit_deduct: roundMoney(Number(summary?.total_deposit_deduct ?? 0)),
      total_deposit_return: roundMoney(Number(summary?.total_deposit_return ?? 0)),
      total_collection_from_receivable: roundMoney(Number(summary?.total_collection_from_receivable ?? 0)),
      total_cash_discount_given: roundMoney(Number(summary?.total_cash_discount_given ?? 0)),
      total_cash_discount_received: roundMoney(Number(summary?.total_cash_discount_received ?? 0)),
    },
  });
});


// ─── GET /sales-daybook — sales daybook report ──────────────────────────────

billingReports.get('/sales-daybook', requireRole(...REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');

  const { results } = await db.$client.prepare(`
    SELECT
      ${localReportDate('b.created_at')} as bill_date,
      COUNT(*) as total_bills,
      COALESCE(SUM(b.total), 0) as total_amount,
      COALESCE(SUM(b.discount), 0) as total_discount,
      COALESCE(SUM(b.paid), 0) as total_paid,
      COALESCE(SUM(b.due), 0) as total_due
    FROM bills b
    WHERE b.tenant_id = ?
      AND date(b.created_at) BETWEEN ? AND ?
      AND COALESCE(b.status, 'active') != 'cancelled'
    GROUP BY bill_date
    ORDER BY bill_date DESC
  `).bind(tenantId, startDate, endDate).all();

  return c.json({ daybook: results });
});


// ─── GET /department-sales-daybook — department sales daybook ────────────────

billingReports.get('/department-sales-daybook', requireRole(...REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');

  const { results } = await db.$client.prepare(`
    SELECT
      ii.item_category as service_department,
      ${localReportDate('ii.created_at')} as bill_date,
      COUNT(*) as item_count,
      COALESCE(SUM(ii.line_total), 0) as total_amount,
      COALESCE(SUM(ii.quantity), 0) as total_quantity
    FROM invoice_items ii
    JOIN bills b ON ii.bill_id = b.id AND b.tenant_id = ii.tenant_id
    WHERE ii.tenant_id = ?
      AND date(ii.created_at) BETWEEN ? AND ?
      AND COALESCE(b.status, 'active') != 'cancelled'
    GROUP BY ii.item_category, bill_date
    ORDER BY bill_date DESC, total_amount DESC
  `).bind(tenantId, startDate, endDate).all();

  return c.json({ departments: results });
});


// ─── GET /doctor-income-summary — doctor wise income summary OP-IP ──────────

billingReports.get('/doctor-income-summary', requireRole(...REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');
  const doctorId = parseOptionalInt(c.req.query('doctor_id'));

  let sql = `
    SELECT
      d.id as doctor_id,
      d.name as doctor_name,
      d.specialization,
      COUNT(DISTINCT b.id) as total_bills,
      COALESCE(SUM(b.total), 0) as total_revenue,
      COALESCE(SUM(b.paid), 0) as total_collected,
      COALESCE(SUM(b.due), 0) as total_due,
      COALESCE(SUM(dca.commission_amount), 0) as total_commission
    FROM bills b
    JOIN invoice_items ii ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
    JOIN doctors d ON ii.doctor_id = d.id
    LEFT JOIN doctor_commission_accruals dca ON dca.tenant_id = b.tenant_id
      AND dca.source_id = b.id
      AND dca.status = 'accrued'
    WHERE b.tenant_id = ?
      AND date(b.created_at) BETWEEN ? AND ?
      AND COALESCE(b.status, 'active') != 'cancelled'
      AND ii.doctor_id IS NOT NULL
  `;
  const params: (string | number)[] = [tenantId, startDate, endDate];

  if (doctorId) {
    sql += ' AND d.id = ?';
    params.push(doctorId);
  }

  sql += ' GROUP BY d.id, d.name, d.specialization ORDER BY total_revenue DESC';

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  return c.json({ doctors: results });
});


// ─── GET /item-summary — item summary report ────────────────────────────────

billingReports.get('/item-summary', requireRole(...REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');

  const { results } = await db.$client.prepare(`
    SELECT
      ii.description as item_name,
      ii.item_category as service_department,
      COUNT(*) as item_count,
      COALESCE(SUM(ii.quantity), 0) as total_quantity,
      COALESCE(SUM(ii.line_total), 0) as total_amount,
      COALESCE(SUM(ii.line_total), 0) as net_amount
    FROM invoice_items ii
    JOIN bills b ON ii.bill_id = b.id AND b.tenant_id = ii.tenant_id
    WHERE ii.tenant_id = ?
      AND date(ii.created_at) BETWEEN ? AND ?
      AND COALESCE(b.status, 'active') != 'cancelled'
    GROUP BY ii.description, ii.item_category
    ORDER BY total_amount DESC
    LIMIT 200
  `).bind(tenantId, startDate, endDate).all();

  return c.json({ items: results });
});


// ─── GET /user-cash-collection — user wise cash collection report ────────────

billingReports.get('/user-cash-collection', requireRole(...FINANCE_REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');
  const userId = parseOptionalInt(c.req.query('user_id'));

  let sql = `
    SELECT
      ect.employee_id,
      s.name as employee_name,
      COUNT(*) as transaction_count,
      COALESCE(SUM(CASE
        WHEN ect.payment_method = 'cash'
         AND ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
        THEN ect.amount ELSE 0 END), 0) as cash_in,
      COALESCE(SUM(CASE
        WHEN ect.payment_method = 'cash'
         AND ect.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
        THEN ect.amount ELSE 0 END), 0) as cash_out,
      COALESCE(SUM(CASE WHEN ect.payment_method = 'cash' THEN
        CASE
          WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN ect.amount
          WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven') THEN -ect.amount
          ELSE 0
        END
      ELSE 0 END), 0) as net_cash
    FROM emp_cash_transactions ect
    LEFT JOIN staff s ON ect.employee_id = s.id
    WHERE ect.tenant_id = ?
      AND date(ect.transaction_date) BETWEEN ? AND ?
  `;
  const params: (string | number)[] = [tenantId, startDate, endDate];

  if (userId) {
    sql += ' AND ect.employee_id = ?';
    params.push(userId);
  }

  sql += ' GROUP BY ect.employee_id, s.name ORDER BY net_cash DESC';

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  return c.json({ users: results });
});


// ─── GET /payment-mode — payment mode wise report ───────────────────────────

billingReports.get('/payment-mode', requireRole(...REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const startDate = parseDate(c.req.query('start_date'), 'start_date');
  const endDate = parseDate(c.req.query('end_date'), 'end_date');

  const { results } = await db.$client.prepare(`
    SELECT
      ${normalizedPaymentMethod()} as payment_mode,
      COUNT(*) as transaction_count,
      COALESCE(SUM(amount), 0) as total_amount
    FROM payments
    WHERE tenant_id = ?
      AND date(created_at, '+6 hours') BETWEEN ? AND ?
    GROUP BY payment_mode
    ORDER BY total_amount DESC
  `).bind(tenantId, startDate, endDate).all();

  return c.json({ payment_modes: results });
});


// ─── GET /denomination — cash denomination report ────────────────────────────

billingReports.get('/denomination', requireRole(...FINANCE_REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const userId = parseOptionalInt(c.req.query('user_id'));

  let sql = `
    SELECT
      ect.employee_id,
      s.name as employee_name,
      COALESCE(SUM(CASE WHEN ect.payment_method = 'cash' THEN
        CASE
          WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN ect.amount
          WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven') THEN -ect.amount
          ELSE 0
        END
      ELSE 0 END), 0) as net_cash
    FROM emp_cash_transactions ect
    LEFT JOIN staff s ON ect.employee_id = s.id
    WHERE ect.tenant_id = ?
      AND ${localReportDate('ect.transaction_date')} = ?
  `;
  const params: (string | number)[] = [tenantId, date];

  if (userId) {
    sql += ' AND ect.employee_id = ?';
    params.push(userId);
  }

  sql += ' GROUP BY ect.employee_id, s.name ORDER BY net_cash DESC';

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  return c.json({ date, denominations: results });
});


export default billingReports;
