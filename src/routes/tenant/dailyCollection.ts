import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getTodayGMT6 } from '../../lib/date-utils';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

const dailyCollectionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const REPORT_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;
const FINANCE_REPORT_ROLES = new Set(['hospital_admin', 'md', 'director', 'accountant', 'reception']);
const READY_REPORT_STATUSES = ['completed', 'verified', 'delivered', 'reported', 'ready'];

const collectionNetExpression = `
  CASE
    WHEN transaction_type IN ('CashSales', 'CollectionFromReceivable') THEN amount
    WHEN transaction_type IN ('SalesReturn', 'ReturnDeposit') THEN -amount
    ELSE 0
  END
`;

const localReportDate = (expression: string): string => {
  const valueExpr = expression.includes(',') ? `COALESCE(${expression})` : expression;
  return `CASE
    WHEN ${valueExpr} IS NULL THEN NULL
    WHEN ${valueExpr} LIKE '%Z' OR ${valueExpr} LIKE '%+00:00' OR ${valueExpr} LIKE '%-00:00'
      THEN date(${valueExpr}, '+6 hours')
    ELSE date(${valueExpr})
  END`;
};

const dailyCollectionCashTimestamp = (alias = 'ect'): string => `CASE
  WHEN ${alias}.reference_type IN ('bill', 'bill_payment') THEN COALESCE((
    SELECT strftime('%Y-%m-%dT%H:%M:%S', p.date) || '+06:00'
    FROM payments p
    WHERE p.tenant_id = ${alias}.tenant_id
      AND p.bill_id = CAST(${alias}.reference_id AS INTEGER)
      AND ABS(COALESCE(p.amount, 0) - COALESCE(${alias}.amount, 0)) < 0.01
      AND COALESCE(p.payment_method, 'cash') = COALESCE(${alias}.payment_method, 'cash')
      AND (${alias}.counter_session_id IS NULL OR p.counter_session_id IS NULL OR p.counter_session_id = ${alias}.counter_session_id)
    ORDER BY datetime(COALESCE(p.created_at, p.date)) DESC, p.id DESC
    LIMIT 1
  ), strftime('%Y-%m-%dT%H:%M:%S', ${alias}.created_at, '+6 hours') || '+06:00')
  ELSE strftime('%Y-%m-%dT%H:%M:%S', ${alias}.created_at, '+6 hours') || '+06:00'
END`;

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

const fullyPaidBill = (alias = 'b'): string => `(
  ${alias}.id IS NOT NULL AND (
    COALESCE(${alias}.status, 'open') = 'paid'
    OR (
      COALESCE(${alias}.total, 0) > 0
      AND COALESCE(${alias}.paid, ${alias}.paid_amount, 0) >= COALESCE(${alias}.total, 0)
    )
  )
)`;

const reconciledCommissionAmount = (alias = 'dca'): string => `MAX(
  0,
  (
    CASE
      WHEN COALESCE(${alias}.earned_commission_amount, 0) != 0
        OR COALESCE(${alias}.doctor_waiver_amount, 0) != 0
        OR COALESCE(${alias}.payable_commission_amount, 0) != 0
      THEN COALESCE(${alias}.payable_commission_amount, 0)
      ELSE COALESCE(${alias}.commission_amount, 0)
    END
  )
  - COALESCE(${alias}.reversed_amount, 0)
  - COALESCE(${alias}.clawback_amount, 0)
)`;

dailyCollectionRoutes.use('*', requireRole(...REPORT_ROLES));

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function parseOptionalPositiveInt(value: string | undefined, field: string): number | null | { error: string } {
  if (value === undefined || value === '') return null;
  if (!/^\d+$/.test(value)) return { error: `${field} must be a positive integer` };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return { error: `${field} must be a positive integer` };
  return parsed;
}

// ─── GET /api/reports/daily-collection ────────────────────────────────────────
dailyCollectionRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));
  const { date, start_date, end_date, employee_id, counter_id } = c.req.query();

  const isRange = !!(start_date || end_date);
  const reportDate = date ?? (isRange ? null : getTodayGMT6());
  const rangeStart = start_date ?? (date ?? getTodayGMT6());
  const rangeEnd = end_date ?? (date ?? getTodayGMT6());

  if (date && !isValidIsoDate(date)) {
    return c.json({ error: 'Please provide a valid date in YYYY-MM-DD format' }, 400);
  }
  if (start_date && !isValidIsoDate(start_date)) {
    return c.json({ error: 'start_date must be in YYYY-MM-DD format' }, 400);
  }
  if (end_date && !isValidIsoDate(end_date)) {
    return c.json({ error: 'end_date must be in YYYY-MM-DD format' }, 400);
  }
  if (isRange && rangeStart > rangeEnd) {
    return c.json({ error: 'start_date must be on or before end_date' }, 400);
  }

  const requestedEmployeeId = parseOptionalPositiveInt(employee_id, 'employee_id');
  if (requestedEmployeeId && typeof requestedEmployeeId === 'object') {
    return c.json({ error: requestedEmployeeId.error }, 400);
  }

  const requestedCounterId = parseOptionalPositiveInt(counter_id, 'counter_id');
  if (requestedCounterId && typeof requestedCounterId === 'object') {
    return c.json({ error: requestedCounterId.error }, 400);
  }

  const role = c.get('role') ?? '';
  const currentUserId = Number(c.get('userId'));
  const canViewAllEmployees = FINANCE_REPORT_ROLES.has(role);
  let employeeFilter = requestedEmployeeId;

  if (!canViewAllEmployees) {
    if (!Number.isSafeInteger(currentUserId) || currentUserId <= 0) {
      return c.json({ error: 'Authenticated employee context is required for daily collection reports' }, 403);
    }
    if (employeeFilter !== null && employeeFilter !== currentUserId) {
      return c.json({ error: 'Receptionists can only view their own daily collection report' }, 403);
    }
    employeeFilter = currentUserId;
  }

  const counterFilter = requestedCounterId;

  // Date predicate: single day (=) when only `date` is given, otherwise a range (BETWEEN)
  // using start_date/end_date (or date as both bounds) to support month-to-date summaries.
  const dateParams: string[] = isRange ? [rangeStart, rangeEnd] : [reportDate as string];
  const buildDateFilter = (expression: string): string => {
    const expr = localReportDate(expression);
    return isRange ? `${expr} BETWEEN ? AND ?` : `${expr} = ?`;
  };

  try {
    // Posted accounting events are the finance source of truth. Operational
    // payment rows remain as fallback for legacy/unposted data visibility.
    const ledgerPaymentRow = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(json_extract(payload_json, '$.paymentType'), 'current') = 'current'
          THEN CAST(json_extract(payload_json, '$.amount') AS REAL) ELSE 0 END), 0) as current_collection,
        COALESCE(SUM(CASE WHEN json_extract(payload_json, '$.paymentType') = 'due'
          THEN CAST(json_extract(payload_json, '$.amount') AS REAL) ELSE 0 END), 0) as due_collection,
        COALESCE(SUM(CASE WHEN ${normalizedPaymentMethod("json_extract(payload_json, '$.paymentMethod')")} = 'cash'
          THEN CAST(json_extract(payload_json, '$.amount') AS REAL) ELSE 0 END), 0) as cash_received,
        COALESCE(SUM(CAST(json_extract(payload_json, '$.amount') AS REAL)), 0) as total_received
      FROM accounting_posting_events
      WHERE tenant_id = ?
        AND event_type = 'payment_received'
        AND status = 'posted'
        AND ${buildDateFilter('event_date, created_at')}
        AND (? IS NULL OR CAST(created_by AS INTEGER) = ?)
        AND (? IS NULL OR CAST(json_extract(payload_json, '$.counterId') AS INTEGER) = ?)
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).first<{
      current_collection: number;
      due_collection: number;
      cash_received: number;
      total_received: number;
    }>();

    const paymentRow = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(payment_type, 'current') = 'current' THEN amount ELSE 0 END), 0) as current_collection,
        COALESCE(SUM(CASE WHEN payment_type = 'due' THEN amount ELSE 0 END), 0) as due_collection,
        COALESCE(SUM(CASE WHEN ${normalizedPaymentMethod()} = 'cash' THEN amount ELSE 0 END), 0) as cash_received,
        COALESCE(SUM(amount), 0) as total_received
      FROM payments
      WHERE tenant_id = ? AND ${buildDateFilter('date, created_at')}
        AND (? IS NULL OR received_by = ?)
        AND (? IS NULL OR counter_id = ?)
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).first<{
      current_collection: number;
      due_collection: number;
      cash_received: number;
      total_received: number;
    }>();

    const refundTotalsRow = await db.$client.prepare(`
      WITH refund_totals AS (
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'SalesReturn' THEN ABS(amount) ELSE 0 END), 0) AS total_sales_return,
          COALESCE(SUM(CASE
            WHEN transaction_type = 'SalesReturn'
             AND ${normalizedPaymentMethod()} = 'cash'
            THEN ABS(amount) ELSE 0 END), 0) AS cash_sales_return
        FROM emp_cash_transactions
        WHERE tenant_id = ?
          AND ${buildDateFilter('transaction_date, created_at')}
          AND (? IS NULL OR employee_id = ?)
          AND (? IS NULL OR counter_id = ?)
      )
      SELECT * FROM refund_totals
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).first<{ total_sales_return: number; cash_sales_return: number }>();

    // Use ledger when it covers >= payments (all posted). When payments exceed
    // ledger, fall back to operational data so unposted amounts aren't lost.
    const ledgerTotal = Number(ledgerPaymentRow?.total_received ?? 0);
    const paymentTotal = Number(paymentRow?.total_received ?? 0);
    const useLedgerCollectionSource = ledgerTotal >= paymentTotal && ledgerTotal > 0;
    const grossCollectionSourceRow = useLedgerCollectionSource
      ? ledgerPaymentRow
      : paymentRow;
    const totalSalesReturn = Number(refundTotalsRow?.total_sales_return ?? 0);
    const cashSalesReturn = Number(refundTotalsRow?.cash_sales_return ?? refundTotalsRow?.total_sales_return ?? 0);
    const collectionSourceRow = {
      current_collection: Math.max(0, Number(grossCollectionSourceRow?.current_collection ?? 0) - totalSalesReturn),
      due_collection: Number(grossCollectionSourceRow?.due_collection ?? 0),
      cash_received: Math.max(0, Number(grossCollectionSourceRow?.cash_received ?? 0) - cashSalesReturn),
      total_received: Math.max(0, Number(grossCollectionSourceRow?.total_received ?? 0) - totalSalesReturn),
    };

    const depositCollectionRow = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) as deposit_collection,
        COALESCE(SUM(CASE WHEN transaction_type = 'deposit' AND ${normalizedPaymentMethod('payment_method')} = 'cash' THEN amount ELSE 0 END), 0) as cash_deposit_collection,
        COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN 1 ELSE 0 END), 0) as deposit_count
      FROM billing_deposits
      WHERE tenant_id = ?
        AND COALESCE(is_active, 1) = 1
        AND ${buildDateFilter('created_at')}
        AND (? IS NULL OR created_by = ?)
        AND (? IS NULL OR counter_id = ?)
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).first<{
      deposit_collection: number;
      cash_deposit_collection: number;
      deposit_count: number;
    }>();

    const depositCollection = Number(depositCollectionRow?.deposit_collection ?? 0);
    const cashDepositCollection = Number(depositCollectionRow?.cash_deposit_collection ?? 0);

    // Summary aggregates
    const summaryRow = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'CashSales' THEN amount ELSE 0 END), 0) as total_cash_sales,
        COALESCE(SUM(CASE WHEN transaction_type = 'SalesReturn' THEN amount ELSE 0 END), 0) as total_sales_return,
        COALESCE(SUM(CASE WHEN transaction_type = 'DepositDeduct' THEN amount ELSE 0 END), 0) as total_deposit_deduct,
        COALESCE(SUM(CASE WHEN transaction_type = 'ReturnDeposit' THEN amount ELSE 0 END), 0) as total_deposit_return,
        COALESCE(SUM(CASE WHEN transaction_type = 'CollectionFromReceivable' THEN amount ELSE 0 END), 0) as total_collection_from_receivable,
        COALESCE(SUM(CASE WHEN transaction_type = 'CashDiscountGiven' THEN amount ELSE 0 END), 0) as total_cash_discount_given,
        COALESCE(SUM(CASE WHEN transaction_type = 'CashDiscountReceived' THEN amount ELSE 0 END), 0) as total_cash_discount_received
      FROM emp_cash_transactions
      WHERE tenant_id = ? AND ${buildDateFilter('transaction_date, created_at')}
        AND (? IS NULL OR employee_id = ?)
        AND (? IS NULL OR counter_id = ?)
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).first<{
      total_cash_sales: number;
      total_sales_return: number;
      total_deposit_deduct: number;
      total_deposit_return: number;
      total_collection_from_receivable: number;
      total_cash_discount_given: number;
      total_cash_discount_received: number;
    }>();

    const reportedSalesReturn = totalSalesReturn || Number(summaryRow?.total_sales_return ?? 0);
    const unappliedSalesReturn = Math.max(0, reportedSalesReturn - totalSalesReturn);
    if (unappliedSalesReturn > 0) {
      collectionSourceRow.current_collection = Math.max(0, collectionSourceRow.current_collection - unappliedSalesReturn);
      collectionSourceRow.cash_received = Math.max(0, collectionSourceRow.cash_received - unappliedSalesReturn);
      collectionSourceRow.total_received = Math.max(0, collectionSourceRow.total_received - unappliedSalesReturn);
    }

    const summary = {
      total_cash_sales: collectionSourceRow?.current_collection ?? summaryRow?.total_cash_sales ?? 0,
      total_sales_return: reportedSalesReturn,
      total_deposit_deduct: summaryRow?.total_deposit_deduct ?? 0,
      total_deposit_return: summaryRow?.total_deposit_return ?? 0,
      total_deposit_collection: depositCollection,
      total_collection_from_receivable: collectionSourceRow?.due_collection ?? summaryRow?.total_collection_from_receivable ?? 0,
      total_cash_discount_given: summaryRow?.total_cash_discount_given ?? 0,
      total_cash_discount_received: summaryRow?.total_cash_discount_received ?? 0,
      net_collection: 0,
    };

    summary.net_collection =
      summary.total_cash_sales
      + summary.total_deposit_collection
      - summary.total_deposit_return
      + summary.total_collection_from_receivable;

    const financeSummary = {
      total_received: Number(collectionSourceRow?.total_received ?? 0) + depositCollection,
      cash_received: Number(collectionSourceRow?.cash_received ?? 0) + cashDepositCollection,
      current_collection: collectionSourceRow?.current_collection ?? 0,
      due_collection: collectionSourceRow?.due_collection ?? 0,
      deposit_collection: depositCollection,
      total_returns: summary.total_sales_return + summary.total_deposit_return,
      total_discounts: summary.total_cash_discount_given,
      net_collection:
        Number(collectionSourceRow?.current_collection ?? 0)
        + Number(collectionSourceRow?.due_collection ?? 0)
        + depositCollection,
    };

    const billFallbackRow = await db.$client.prepare(`
      SELECT
        COUNT(*) as bill_count,
        COUNT(DISTINCT patient_id) as patient_count,
        COALESCE(SUM(total), 0) as total_billed,
        COALESCE(SUM(paid), 0) as total_paid,
        COALESCE(SUM(due), 0) as total_due,
        COALESCE(SUM(discount), 0) as total_discount,
        COALESCE(SUM(test_bill), 0) as test_amount,
        COALESCE(SUM(doctor_visit_bill), 0) as doctor_visit_amount,
        COALESCE(SUM(CASE WHEN COALESCE(doctor_visit_bill, 0) > 0 THEN 1 ELSE 0 END), 0) as doctor_visit_count
      FROM bills
      WHERE tenant_id = ?
        AND ${buildDateFilter('created_at, updated_at')}
        AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    `).bind(tenantId, ...dateParams).first<{
      bill_count: number;
      patient_count: number;
      total_billed: number;
      total_paid: number;
      total_due: number;
      total_discount: number;
      test_amount: number;
      doctor_visit_amount: number;
      doctor_visit_count: number;
    }>();

    const serviceCollectionRow = await db.$client.prepare(`
      WITH refunds_by_bill AS (
        SELECT
          cn.bill_id,
          COALESCE(SUM(ABS(ect.amount)), 0) AS refund_amount
        FROM emp_cash_transactions ect
        JOIN billing_credit_notes cn
          ON cn.id = ect.reference_id
         AND cn.tenant_id = ect.tenant_id
        WHERE ect.tenant_id = ?
          AND ect.transaction_type = 'SalesReturn'
          AND ect.reference_type = 'credit_note'
          AND ${buildDateFilter('ect.transaction_date, ect.created_at')}
          AND (? IS NULL OR ect.employee_id = ?)
          AND (? IS NULL OR ect.counter_id = ?)
        GROUP BY cn.bill_id
      ),
      payment_base AS (
        SELECT
          MIN(p.id) AS payment_id,
          p.tenant_id,
          p.bill_id,
          MAX(0, COALESCE(SUM(p.amount), 0) - COALESCE(MAX(rb.refund_amount), 0)) AS amount,
          b.admission_id,
          COALESCE(b.test_bill, 0) AS test_bill,
          COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
          COALESCE(b.admission_bill, 0) AS admission_bill,
          COALESCE(b.operation_bill, 0) AS operation_bill,
          COALESCE(b.medicine_bill, 0) AS medicine_bill
        FROM payments p
        JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
        LEFT JOIN refunds_by_bill rb ON rb.bill_id = p.bill_id
        WHERE p.tenant_id = ? AND ${buildDateFilter('p.date, p.created_at')}
          AND (? IS NULL OR p.received_by = ?)
          AND (? IS NULL OR p.counter_id = ?)
        GROUP BY
          p.tenant_id,
          p.bill_id,
          b.admission_id,
          b.test_bill,
          b.doctor_visit_bill,
          b.admission_bill,
          b.operation_bill,
          b.medicine_bill
      ),
      active_items AS (
        SELECT
          ii.tenant_id,
          ii.bill_id,
          CASE
            WHEN pb.admission_id IS NOT NULL THEN 'IPD'
            WHEN LOWER(TRIM(COALESCE(ii.item_category, ''))) IN ('test', 'lab', 'laboratory', 'diagnostic') THEN 'Lab'
            WHEN LOWER(TRIM(COALESCE(ii.item_category, ''))) IN ('radiology', 'imaging') THEN 'Radiology'
            WHEN LOWER(TRIM(COALESCE(ii.item_category, ''))) IN ('consultation', 'doctor_visit', 'opd', 'visit') THEN 'OPD'
            WHEN LOWER(TRIM(COALESCE(ii.item_category, ''))) IN ('admission', 'ipd', 'bed', 'room', 'ward') THEN 'IPD'
            WHEN LOWER(TRIM(COALESCE(ii.item_category, ''))) IN ('operation', 'ot', 'procedure', 'surgery') THEN 'OT'
            WHEN LOWER(TRIM(COALESCE(ii.item_category, ''))) IN ('medicine', 'pharmacy', 'drug') THEN 'Pharmacy'
            ELSE 'Uncategorized'
          END AS source_label,
          SUM(CASE
            WHEN COALESCE(ii.line_total, 0) > 0 THEN COALESCE(ii.line_total, 0)
            ELSE MAX(0, COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1))
          END) AS line_amount
        FROM invoice_items ii
        JOIN (SELECT DISTINCT tenant_id, bill_id, admission_id FROM payment_base WHERE bill_id IS NOT NULL) pb
          ON pb.tenant_id = ii.tenant_id AND pb.bill_id = ii.bill_id
        WHERE COALESCE(ii.status, 'active') != 'cancelled'
        GROUP BY ii.tenant_id, ii.bill_id, source_label
      ),
      bill_item_totals AS (
        SELECT tenant_id, bill_id, SUM(line_amount) AS allocation_base
        FROM active_items
        GROUP BY tenant_id, bill_id
      ),
      payment_allocations AS (
        SELECT
          pb.payment_id,
          ai.source_label,
          CASE
            WHEN bit.allocation_base > 0 THEN 1.0 * pb.amount * ai.line_amount / bit.allocation_base
            ELSE 0
          END AS allocated_amount
        FROM payment_base pb
        JOIN bill_item_totals bit ON bit.tenant_id = pb.tenant_id AND bit.bill_id = pb.bill_id
        JOIN active_items ai ON ai.tenant_id = pb.tenant_id AND ai.bill_id = pb.bill_id

        UNION ALL

        SELECT
          pb.payment_id,
          CASE
            WHEN pb.admission_id IS NOT NULL THEN 'IPD'
            WHEN pb.test_bill > 0 THEN 'Lab'
            WHEN pb.doctor_visit_bill > 0 THEN 'OPD'
            WHEN pb.admission_bill > 0 THEN 'IPD'
            WHEN pb.operation_bill > 0 THEN 'OT'
            WHEN pb.medicine_bill > 0 THEN 'Pharmacy'
            ELSE 'Uncategorized'
          END AS source_label,
          pb.amount AS allocated_amount
        FROM payment_base pb
        LEFT JOIN bill_item_totals bit ON bit.tenant_id = pb.tenant_id AND bit.bill_id = pb.bill_id
        WHERE COALESCE(bit.allocation_base, 0) <= 0
      )
      SELECT
        ROUND(COALESCE(SUM(CASE WHEN source_label = 'OPD' THEN allocated_amount ELSE 0 END), 0), 2) AS doctor_visit_collection,
        ROUND(COALESCE(SUM(CASE WHEN source_label = 'Lab' THEN allocated_amount ELSE 0 END), 0), 2) AS test_collection,
        ROUND(COALESCE(SUM(CASE WHEN source_label = 'IPD' THEN allocated_amount ELSE 0 END), 0), 2) AS ipd_collection,
        ROUND(COALESCE(SUM(CASE WHEN source_label = 'OT' THEN allocated_amount ELSE 0 END), 0), 2) AS ot_collection,
        ROUND(COALESCE(SUM(CASE WHEN source_label = 'Pharmacy' THEN allocated_amount ELSE 0 END), 0), 2) AS pharmacy_collection,
        ROUND(COALESCE(SUM(CASE WHEN source_label = 'Radiology' THEN allocated_amount ELSE 0 END), 0), 2) AS radiology_collection,
        ROUND(COALESCE(SUM(CASE WHEN source_label = 'Uncategorized' THEN allocated_amount ELSE 0 END), 0), 2) AS uncategorized_collection,
        ROUND(COALESCE(SUM(allocated_amount), 0), 2) AS total_collection
      FROM payment_allocations
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).first<{
      doctor_visit_collection: number;
      test_collection: number;
      ipd_collection: number;
      ot_collection: number;
      pharmacy_collection: number;
      radiology_collection: number;
      uncategorized_collection: number;
      total_collection: number;
    }>();

    if (financeSummary.total_received <= 0 && Number(billFallbackRow?.total_paid ?? 0) > 0) {
      financeSummary.total_received = Number(billFallbackRow?.total_paid ?? 0);
      financeSummary.cash_received = Number(billFallbackRow?.total_paid ?? 0);
      financeSummary.current_collection = Number(billFallbackRow?.total_paid ?? 0);
      financeSummary.net_collection = Number(billFallbackRow?.total_paid ?? 0);
      summary.total_cash_sales = Number(billFallbackRow?.total_paid ?? 0);
      summary.net_collection = Number(billFallbackRow?.total_paid ?? 0);
    }

    const billSummary = {
      invoice_count: Number(billFallbackRow?.bill_count ?? 0),
      patient_count: Number(billFallbackRow?.patient_count ?? 0),
      gross_before_discount: Number(billFallbackRow?.total_billed ?? 0) + Number(billFallbackRow?.total_discount ?? 0),
      discount_amount: Number(billFallbackRow?.total_discount ?? 0),
      final_bill_amount: Number(billFallbackRow?.total_billed ?? 0),
      paid_against_bills: Number(billFallbackRow?.total_paid ?? 0),
      due_remaining: Number(billFallbackRow?.total_due ?? 0),
      doctor_visit_bill_amount: Number(billFallbackRow?.doctor_visit_amount ?? 0),
      test_bill_amount: Number(billFallbackRow?.test_amount ?? 0),
      other_bill_amount: Math.max(0, Number(billFallbackRow?.total_billed ?? 0) - Number(billFallbackRow?.doctor_visit_amount ?? 0) - Number(billFallbackRow?.test_amount ?? 0)),
    };

    const serviceCollectionSummary = {
      doctor_visit_collection: Number(serviceCollectionRow?.doctor_visit_collection ?? 0),
      test_collection: Number(serviceCollectionRow?.test_collection ?? 0),
      ipd_collection: Number(serviceCollectionRow?.ipd_collection ?? 0),
      ot_collection: Number(serviceCollectionRow?.ot_collection ?? 0),
      pharmacy_collection: Number(serviceCollectionRow?.pharmacy_collection ?? 0),
      radiology_collection: Number(serviceCollectionRow?.radiology_collection ?? 0),
      uncategorized_collection: Number(serviceCollectionRow?.uncategorized_collection ?? 0),
      // Backward-compatible alias for older API consumers. New reports must use the explicit label.
      other_collection: Number(serviceCollectionRow?.uncategorized_collection ?? 0),
      total_collection: Number(serviceCollectionRow?.total_collection ?? 0),
    };

    // By employee
    const { results: byEmployee } = await db.$client.prepare(`
      SELECT
        ect.employee_id,
        COALESCE(u.name, s.name, 'Employee #' || ect.employee_id) as employee_name,
        COALESCE(u.username, '') as user_name,
        COALESCE(SUM(CASE WHEN ect.transaction_type = 'CashSales' THEN ect.amount ELSE 0 END), 0) as cash_sales,
        COALESCE(SUM(CASE WHEN ect.transaction_type = 'SalesReturn' THEN ect.amount ELSE 0 END), 0) as sales_return,
        COALESCE(SUM(CASE WHEN ect.transaction_type = 'DepositDeduct' THEN ect.amount ELSE 0 END), 0) as deposit_deduct,
        COALESCE(SUM(CASE WHEN ect.transaction_type = 'ReturnDeposit' THEN ect.amount ELSE 0 END), 0) as deposit_return,
        COALESCE(SUM(CASE WHEN ect.transaction_type = 'CollectionFromReceivable' THEN ect.amount ELSE 0 END), 0) as collection_from_receivable,
        COALESCE(SUM(CASE WHEN ect.transaction_type = 'CashDiscountGiven' THEN ect.amount ELSE 0 END), 0) as cash_discount_given,
        COALESCE(SUM(CASE WHEN ect.transaction_type = 'CashDiscountReceived' THEN ect.amount ELSE 0 END), 0) as cash_discount_received,
        COALESCE(SUM(CASE
          WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable') THEN ect.amount
          WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit') THEN -ect.amount
          ELSE 0
        END), 0) as net
      FROM emp_cash_transactions ect
      LEFT JOIN users u ON u.id = ect.employee_id AND u.tenant_id = ect.tenant_id
      LEFT JOIN staff s ON s.id = ect.employee_id AND s.tenant_id = ect.tenant_id
      WHERE ect.tenant_id = ? AND ${buildDateFilter('ect.transaction_date, ect.created_at')}
        AND (? IS NULL OR ect.employee_id = ?)
        AND (? IS NULL OR ect.counter_id = ?)
      GROUP BY ect.employee_id, employee_name, user_name
      ORDER BY net DESC
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).all();

    const { results: ledgerByPaymentMethod } = await db.$client.prepare(`
      SELECT
        ${normalizedPaymentMethod("json_extract(payload_json, '$.paymentMethod')")} as payment_method,
        COUNT(*) as transaction_count,
        COALESCE(SUM(CAST(json_extract(payload_json, '$.amount') AS REAL)), 0) as gross_amount,
        COALESCE(SUM(CAST(json_extract(payload_json, '$.amount') AS REAL)), 0) as net_amount,
        COALESCE(SUM(CAST(json_extract(payload_json, '$.amount') AS REAL)), 0) as total_amount
      FROM accounting_posting_events
      WHERE tenant_id = ?
        AND event_type = 'payment_received'
        AND status = 'posted'
        AND ${buildDateFilter('event_date, created_at')}
        AND (? IS NULL OR CAST(created_by AS INTEGER) = ?)
        AND (? IS NULL OR CAST(json_extract(payload_json, '$.counterId') AS INTEGER) = ?)
      GROUP BY ${normalizedPaymentMethod("json_extract(payload_json, '$.paymentMethod')")}
      ORDER BY total_amount DESC
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).all();

    // Payment method percentages must use the same source as received money.
    // Posted ledger events are preferred; operational payments are fallback.
    const { results: paymentMethodRows } = await db.$client.prepare(`
      SELECT
        ${normalizedPaymentMethod()} as payment_method,
        COUNT(*) as transaction_count,
        COALESCE(SUM(amount), 0) as gross_amount,
        COALESCE(SUM(amount), 0) as net_amount,
        COALESCE(SUM(amount), 0) as total_amount
      FROM payments
      WHERE tenant_id = ? AND ${buildDateFilter('date, created_at')}
        AND (? IS NULL OR received_by = ?)
        AND (? IS NULL OR counter_id = ?)
      GROUP BY ${normalizedPaymentMethod()}
      ORDER BY total_amount DESC
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).all();
    const { results: refundPaymentMethodRows } = await db.$client.prepare(`
      SELECT
        ${normalizedPaymentMethod()} as payment_method,
        COUNT(*) as transaction_count,
        COALESCE(SUM(ABS(amount)), 0) as refund_amount
      FROM emp_cash_transactions
      WHERE tenant_id = ?
        AND transaction_type = 'SalesReturn'
        AND ${buildDateFilter('transaction_date, created_at')}
        AND (? IS NULL OR employee_id = ?)
        AND (? IS NULL OR counter_id = ?)
      GROUP BY ${normalizedPaymentMethod()}
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).all();
    const { results: depositPaymentMethodRows } = await db.$client.prepare(`
      SELECT
        ${normalizedPaymentMethod()} as payment_method,
        COUNT(*) as transaction_count,
        COALESCE(SUM(amount), 0) as gross_amount,
        COALESCE(SUM(amount), 0) as net_amount,
        COALESCE(SUM(amount), 0) as total_amount
      FROM billing_deposits
      WHERE tenant_id = ?
        AND COALESCE(is_active, 1) = 1
        AND transaction_type = 'deposit'
        AND ${buildDateFilter('created_at')}
        AND (? IS NULL OR created_by = ?)
        AND (? IS NULL OR counter_id = ?)
      GROUP BY ${normalizedPaymentMethod()}
      ORDER BY total_amount DESC
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).all();

    const paymentMethodMap = new Map<string, any>();
    for (const row of (useLedgerCollectionSource ? ledgerByPaymentMethod : paymentMethodRows) ?? []) {
      const key = String((row as any).payment_method ?? 'unknown');
      paymentMethodMap.set(key, { ...(row as any) });
    }
    for (const row of refundPaymentMethodRows ?? []) {
      const key = String((row as any).payment_method ?? 'unknown');
      const existing = paymentMethodMap.get(key) ?? { payment_method: key, transaction_count: 0, gross_amount: 0, net_amount: 0, total_amount: 0 };
      const refundAmount = Number((row as any).refund_amount ?? 0);
      existing.gross_amount = Math.max(0, Number(existing.gross_amount ?? 0) - refundAmount);
      existing.net_amount = Math.max(0, Number(existing.net_amount ?? 0) - refundAmount);
      existing.total_amount = Math.max(0, Number(existing.total_amount ?? 0) - refundAmount);
      paymentMethodMap.set(key, existing);
    }
    for (const row of depositPaymentMethodRows ?? []) {
      const key = String((row as any).payment_method ?? 'unknown');
      const existing = paymentMethodMap.get(key) ?? { payment_method: key, transaction_count: 0, gross_amount: 0, net_amount: 0, total_amount: 0 };
      existing.transaction_count = Number(existing.transaction_count ?? 0) + Number((row as any).transaction_count ?? 0);
      existing.gross_amount = Number(existing.gross_amount ?? 0) + Number((row as any).gross_amount ?? 0);
      existing.net_amount = Number(existing.net_amount ?? 0) + Number((row as any).net_amount ?? 0);
      existing.total_amount = Number(existing.total_amount ?? 0) + Number((row as any).total_amount ?? 0);
      paymentMethodMap.set(key, existing);
    }
    const byPaymentMethod = Array.from(paymentMethodMap.values())
      .filter((row) => (
        Number(row.transaction_count ?? 0) > 0
        || Math.abs(Number(row.gross_amount ?? 0)) > 0
        || Math.abs(Number(row.net_amount ?? 0)) > 0
        || Math.abs(Number(row.total_amount ?? 0)) > 0
      ))
      .sort((a, b) => Number(b.total_amount ?? 0) - Number(a.total_amount ?? 0));

    // 1. Opening Cash Float Query
    const sessionsRow = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(opening_cash), 0) as total_opening_cash
      FROM billing_counter_sessions
      WHERE tenant_id = ?
        AND ${buildDateFilter('opened_at')}
        AND (? IS NULL OR employee_id = ?)
        AND (? IS NULL OR counter_id = ?)
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter
    ).first<{ total_opening_cash: number }>();

    // 2. Cash-basis expenses: paid operating expenses plus doctor payouts.
    // Approved-but-unpaid requests stay in approvals/payables and do not reduce cash-basis income.
    const expensesRowsResult = await db.$client.prepare(`
      SELECT
        category as expense_head,
        COALESCE(SUM(amount), 0) as amount
      FROM expenses
      WHERE tenant_id = ?
        AND COALESCE(status, 'approved') != 'rejected'
        AND (COALESCE(payment_status, 'unpaid') = 'paid' OR cash_movement_id IS NOT NULL)
        AND ${buildDateFilter('date')}
        AND (? IS NULL OR created_by = ?)
        AND (? IS NULL OR counter_session_id IN (
          SELECT id FROM billing_counter_sessions WHERE counter_id = ? AND tenant_id = ?
        ))
      GROUP BY category
      ORDER BY amount DESC
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
      tenantId
    ).all<{ expense_head: string; amount: number }>();

    const payoutRowsResult = await db.$client.prepare(`
      SELECT
        'Doctor payouts' as expense_head,
        COALESCE(SUM(CASE
          WHEN movement_type = 'cash_out'
            AND reference_type IN ('doctor_commission_settlement', 'doctor_payout')
            THEN amount
          WHEN movement_type = 'cash_in'
            AND reference_type = 'doctor_commission_settlement_reversal'
            THEN -amount
          ELSE 0
        END), 0) as amount
      FROM cash_drawer_movements
      WHERE tenant_id = ?
        AND (
          (movement_type = 'cash_out' AND reference_type IN ('doctor_commission_settlement', 'doctor_payout'))
          OR (movement_type = 'cash_in' AND reference_type = 'doctor_commission_settlement_reversal')
        )
        AND ${buildDateFilter('created_at')}
        AND (? IS NULL OR employee_id = ?)
        AND (? IS NULL OR counter_id = ?)
      GROUP BY expense_head
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter
    ).all<{ expense_head: string; amount: number }>();

    const expensesList = [
      ...(expensesRowsResult.results || []),
      ...(payoutRowsResult.results || []),
    ].filter((row) => Number(row.amount ?? 0) !== 0);
    const totalExpense = expensesList.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

    // Physical cash position must use actual drawer movements, not all paid expenses.
    // A bank/mobile expense reduces net income but must not reduce cash in the drawer.
    const physicalCashOutRow = await db.$client.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS physical_cash_out
      FROM cash_drawer_movements
      WHERE tenant_id = ?
        AND movement_type = 'cash_out'
        AND LOWER(TRIM(COALESCE(payment_method, 'cash'))) = 'cash'
        AND reference_type IN (
          'expense',
          'expense_pending',
          'doctor_commission_settlement',
          'doctor_payout'
        )
        AND ${buildDateFilter('created_at')}
        AND (? IS NULL OR employee_id = ?)
        AND (? IS NULL OR counter_id = ?)
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter
    ).first<{ physical_cash_out: number }>();
    const physicalCashOut = Number(physicalCashOutRow?.physical_cash_out ?? 0);

    const detailTimestamp = dailyCollectionCashTimestamp();
    const { results: ledgerDetails } = await db.$client.prepare(`
      SELECT
        ect.id,
        ect.employee_id,
        ect.counter_id,
        ect.transaction_type,
        ect.amount,
        ect.reference_id,
        ect.reference_type,
        ect.payment_method,
        b.invoice_no,
        COALESCE(b.invoice_no, ect.description, '') as description,
        ${collectionNetExpression} as signed_amount,
        ect.transaction_date,
        ${detailTimestamp} AS created_at
      FROM emp_cash_transactions ect
      LEFT JOIN bills b
        ON b.id = ect.reference_id
       AND CAST(b.tenant_id AS TEXT) = CAST(ect.tenant_id AS TEXT)
       AND ect.reference_type IN ('bill', 'bill_payment')
      WHERE ect.tenant_id = ? AND ${buildDateFilter('ect.transaction_date, ect.created_at')}
        AND (? IS NULL OR ect.employee_id = ?)
        AND (? IS NULL OR ect.counter_id = ?)
      ORDER BY ${detailTimestamp} DESC
      LIMIT 500
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
    ).all();

    let details = ledgerDetails ?? [];
    if (details.length === 0) {
      const paymentDetails = await db.$client.prepare(`
      SELECT
        p.id,
        p.received_by as employee_id,
        p.counter_id,
        CASE WHEN p.payment_type = 'due' THEN 'CollectionFromReceivable' ELSE 'CashSales' END as transaction_type,
        p.amount,
        p.bill_id as reference_id,
        'bill_payment' as reference_type,
        p.payment_method,
        b.invoice_no,
        COALESCE(b.invoice_no, p.receipt_no, p.external_transaction_id, p.idempotency_key, '') as description,
        p.amount as signed_amount,
        COALESCE(p.date, p.created_at) as transaction_date,
        COALESCE(
          strftime('%Y-%m-%dT%H:%M:%S', p.date) || '+06:00',
          strftime('%Y-%m-%dT%H:%M:%S', p.created_at, '+6 hours') || '+06:00'
        ) as created_at
      FROM payments p
      LEFT JOIN bills b
        ON b.id = p.bill_id
       AND CAST(b.tenant_id AS TEXT) = CAST(p.tenant_id AS TEXT)
      WHERE p.tenant_id = ? AND ${buildDateFilter('p.date, p.created_at')}
        AND (? IS NULL OR p.received_by = ?)
        AND (? IS NULL OR p.counter_id = ?)
      ORDER BY COALESCE(p.created_at, p.date) DESC
      LIMIT 500
      `).bind(
        tenantId,
        ...dateParams,
        employeeFilter,
        employeeFilter,
        counterFilter,
        counterFilter,
      ).all();
      details = paymentDetails.results ?? [];
    }

    const { results: detailedExpenses } = await db.$client.prepare(`
      SELECT
        e.id,
        e.created_by as employee_id,
        cdm.counter_id,
        'Expense' as transaction_type,
        -e.amount as amount,
        e.id as reference_id,
        'expense' as reference_type,
        COALESCE(NULLIF(TRIM(cdm.payment_method), ''), 'cash') as payment_method,
        NULL as invoice_no,
        COALESCE(e.category || ' - ' || NULLIF(TRIM(e.description), ''), e.category) as description,
        e.category,
        COALESCE(NULLIF(TRIM(e.description), ''), NULLIF(TRIM(e.payee_name), ''), e.category) as line_details,
        CASE
          WHEN e.cash_movement_id IS NOT NULL THEN 'paid'
          WHEN LOWER(TRIM(COALESCE(e.payment_status, ''))) = 'paid' THEN 'paid'
          ELSE COALESCE(NULLIF(TRIM(e.payment_status), ''), 'paid')
        END as line_status,
        -e.amount as signed_amount,
        e.date as transaction_date,
        e.created_at
      FROM expenses e
      LEFT JOIN cash_drawer_movements cdm
        ON cdm.id = e.cash_movement_id
       AND cdm.tenant_id = e.tenant_id
      WHERE e.tenant_id = ?
        AND COALESCE(e.status, 'approved') != 'rejected'
        AND (COALESCE(e.payment_status, 'unpaid') = 'paid' OR e.cash_movement_id IS NOT NULL)
        AND ${buildDateFilter('e.date')}
        AND (? IS NULL OR e.created_by = ?)
        AND (? IS NULL OR e.counter_session_id IN (
          SELECT id FROM billing_counter_sessions WHERE counter_id = ? AND tenant_id = ?
        ))
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
      tenantId
    ).all<any>();

    const { results: detailedPayouts } = await db.$client.prepare(`
      SELECT
        cdm.id,
        cdm.employee_id,
        cdm.counter_id,
        'DoctorPayout' as transaction_type,
        -cdm.amount as amount,
        cdm.reference_id,
        COALESCE(cdm.reference_type, 'doctor_payout') as reference_type,
        COALESCE(NULLIF(TRIM(cdm.payment_method), ''), 'cash') as payment_method,
        NULL as invoice_no,
        COALESCE(NULLIF(TRIM(cdm.description), ''), d.name, 'Doctor payout') as description,
        'Doctor payouts' as category,
        COALESCE(d.name, NULLIF(TRIM(cdm.description), ''), 'Doctor payout') as line_details,
        'paid' as line_status,
        -cdm.amount as signed_amount,
        cdm.created_at as transaction_date,
        cdm.created_at
      FROM cash_drawer_movements cdm
      LEFT JOIN doctor_commission_settlements dcs
        ON CAST(dcs.id AS TEXT) = CAST(cdm.reference_id AS TEXT)
       AND dcs.tenant_id = cdm.tenant_id
       AND cdm.reference_type = 'doctor_commission_settlement'
      LEFT JOIN doctors d ON d.id = dcs.doctor_id AND d.tenant_id = dcs.tenant_id
      WHERE cdm.tenant_id = ?
        AND cdm.movement_type = 'cash_out'
        AND cdm.reference_type IN ('doctor_commission_settlement', 'doctor_payout')
        AND ${buildDateFilter('cdm.created_at')}
        AND (? IS NULL OR cdm.employee_id = ?)
        AND (? IS NULL OR cdm.counter_id = ?)
    `).bind(
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter
    ).all<any>();

    const expenseTransactionDetails = detailedExpenses ?? [];
    const payoutTransactionDetails = detailedPayouts ?? [];
    const expenseDetails = [
      ...expenseTransactionDetails.map((row: any) => ({
        id: `expense-${row.id}`,
        date: row.transaction_date ?? row.created_at,
        category: row.category ?? 'Uncategorized',
        details: row.line_details ?? row.description ?? row.category ?? 'Expense',
        amount: Math.abs(Number(row.amount ?? 0)),
        payment_method: row.payment_method ?? 'cash',
        status: row.line_status ?? 'paid',
        transaction_type: 'expense',
      })),
      ...payoutTransactionDetails.map((row: any) => ({
        id: `payout-${row.id}`,
        date: row.transaction_date ?? row.created_at,
        category: 'Doctor payouts',
        details: row.line_details ?? row.description ?? 'Doctor payout',
        amount: Math.abs(Number(row.amount ?? 0)),
        payment_method: row.payment_method ?? 'cash',
        status: row.line_status ?? 'paid',
        transaction_type: 'doctor_payout',
      })),
    ].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());

    details = [...details, ...expenseTransactionDetails, ...payoutTransactionDetails].sort((a, b) => {
      const dateA = new Date(a.created_at ?? a.transaction_date ?? 0).getTime();
      const dateB = new Date(b.created_at ?? b.transaction_date ?? 0).getTime();
      return dateB - dateA;
    });

    const serviceSummaryRow = await db.$client.prepare(`
      SELECT
        COUNT(DISTINCT CASE WHEN vs.service_type = 'doctor_visit' THEN vs.patient_id END) as total_patients_seen,
        COUNT(DISTINCT CASE WHEN vs.service_type = 'doctor_visit' THEN vs.visit_id END) as doctor_visit_count,
        COALESCE(SUM(CASE WHEN vs.service_type = 'doctor_visit' THEN vs.total_amount ELSE 0 END), 0) as doctor_visit_amount
      FROM visit_services vs
      WHERE vs.tenant_id = ? AND ${buildDateFilter('vs.created_at')}
        AND COALESCE(vs.status, 'pending') NOT IN ('cancelled', 'refunded')
    `).bind(tenantId, ...dateParams).first<{
      total_patients_seen: number;
      doctor_visit_count: number;
      doctor_visit_amount: number;
    }>();

    const appointmentSummaryRow = await db.$client.prepare(`
      SELECT
        COUNT(DISTINCT patient_id) as total_patients_seen,
        COUNT(*) as doctor_visit_count,
        COALESCE(SUM(COALESCE(final_fee, fee, 0)), 0) as doctor_visit_amount
      FROM appointments
      WHERE tenant_id = ? AND appt_date ${isRange ? 'BETWEEN ? AND ?' : '= ?'}
        AND COALESCE(status, 'scheduled') NOT IN ('cancelled', 'no_show')
    `).bind(tenantId, ...dateParams).first<{
      total_patients_seen: number;
      doctor_visit_count: number;
      doctor_visit_amount: number;
    }>();

    const testSummaryRow = await db.$client.prepare(`
      SELECT
        COUNT(loi.id) as test_count,
        COALESCE(SUM(loi.line_total), 0) as test_amount
      FROM lab_orders lo
      JOIN lab_order_items loi ON loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
      LEFT JOIN bills b ON b.id = lo.bill_id AND b.tenant_id = lo.tenant_id
      WHERE lo.tenant_id = ? AND ${buildDateFilter('lo.order_date, b.created_at, lo.created_at')}
        AND COALESCE(loi.status, 'pending') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    `).bind(tenantId, ...dateParams).first<{
      test_count: number;
      test_amount: number;
    }>();

    const invoiceTestSummaryRow = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN COALESCE(ii.quantity, 1) ELSE 0 END), 0) as test_count,
        COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN ii.line_total ELSE 0 END), 0) as test_amount
      FROM invoice_items ii
      JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
      WHERE ii.tenant_id = ?
        AND ${buildDateFilter('ii.created_at, b.created_at')}
        AND ii.item_category = 'test'
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    `).bind(tenantId, ...dateParams).first<{
      test_count: number;
      test_amount: number;
    }>();

    const { results: doctorVisitRows } = await db.$client.prepare(`
      SELECT
        d.id as doctor_id,
        d.name as doctor_name,
        COUNT(DISTINCT CASE WHEN vs.service_type = 'doctor_visit' THEN vs.patient_id END) as patient_count,
        COUNT(DISTINCT CASE WHEN vs.service_type = 'doctor_visit' THEN vs.visit_id END) as doctor_visit_count,
        COALESCE(SUM(CASE WHEN vs.service_type = 'doctor_visit' THEN vs.total_amount ELSE 0 END), 0) as doctor_visit_amount
      FROM visit_services vs
      JOIN doctors d ON d.id = vs.doctor_id AND d.tenant_id = vs.tenant_id
      WHERE vs.tenant_id = ? AND ${buildDateFilter('vs.created_at')}
        AND COALESCE(vs.status, 'pending') NOT IN ('cancelled', 'refunded')
      GROUP BY d.id, d.name
    `).bind(tenantId, ...dateParams).all<{
      doctor_id: number;
      doctor_name: string;
      patient_count: number;
      doctor_visit_count: number;
      doctor_visit_amount: number;
    }>();

    const { results: appointmentDoctorRows } = await db.$client.prepare(`
      SELECT
        d.id as doctor_id,
        d.name as doctor_name,
        COUNT(DISTINCT a.patient_id) as patient_count,
        COUNT(*) as doctor_visit_count,
        COALESCE(SUM(COALESCE(a.final_fee, a.fee, 0)), 0) as doctor_visit_amount
      FROM appointments a
      JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.appt_date ${isRange ? 'BETWEEN ? AND ?' : '= ?'}
        AND COALESCE(a.status, 'scheduled') NOT IN ('cancelled', 'no_show')
      GROUP BY d.id, d.name
    `).bind(tenantId, ...dateParams).all<{
      doctor_id: number;
      doctor_name: string;
      patient_count: number;
      doctor_visit_count: number;
      doctor_visit_amount: number;
    }>();

    const consultationItemPredicate = `
      (
        ii.item_category IN ('consultation', 'doctor_visit', 'opd', 'visit')
        OR lower(COALESCE(ii.description, '')) LIKE '%consult%'
        OR lower(COALESCE(ii.description, '')) LIKE '%doctor%'
      )
    `;
    // Doctor-wise collection must follow actual receipts, not billed amounts.
    // Mixed invoices are allocated proportionally between visit and test bases.
    const { results: doctorPaidServiceRows } = await db.$client.prepare(`
      WITH invoice_service_bases AS (
        SELECT
          ii.tenant_id,
          ii.bill_id,
          COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN MAX(0, COALESCE(ii.line_total, 0)) ELSE 0 END), 0) as test_item_base,
          COALESCE(SUM(CASE WHEN ${consultationItemPredicate} THEN MAX(0, COALESCE(ii.line_total, 0)) ELSE 0 END), 0) as visit_item_base,
          MIN(CASE
            WHEN ${consultationItemPredicate} AND item_doctor.id IS NOT NULL THEN ii.reference_id
            ELSE NULL
          END) as visit_item_doctor_id
        FROM invoice_items ii
        LEFT JOIN doctors item_doctor
          ON item_doctor.id = ii.reference_id
         AND item_doctor.tenant_id = ii.tenant_id
        WHERE ii.tenant_id = ?
          AND COALESCE(ii.status, 'active') != 'cancelled'
        GROUP BY ii.tenant_id, ii.bill_id
      ),
      commission_doctors AS (
        SELECT
          dca.tenant_id,
          dca.bill_id,
          MAX(CASE WHEN dca.source_type = 'consultation_fee' THEN dca.doctor_id END) as visit_commission_doctor_id,
          MAX(CASE WHEN dca.source_type = 'referral' THEN dca.doctor_id END) as referral_doctor_id,
          MAX(CASE WHEN dca.source_type = 'lab_test' THEN dca.doctor_id END) as lab_doctor_id
        FROM doctor_commission_accruals dca
        WHERE dca.tenant_id = ?
          AND dca.bill_id IS NOT NULL
          AND COALESCE(dca.status, 'accrued') != 'cancelled'
        GROUP BY dca.tenant_id, dca.bill_id
      ),
      payment_totals AS (
        SELECT
          p.tenant_id,
          p.bill_id,
          COALESCE(SUM(p.amount), 0) as paid_amount
        FROM payments p
        WHERE p.tenant_id = ?
          AND ${buildDateFilter('p.date, p.created_at')}
          AND (? IS NULL OR p.received_by = ?)
          AND (? IS NULL OR p.counter_id = ?)
        GROUP BY p.tenant_id, p.bill_id
      ),
      paid_bills AS (
        SELECT
          b.tenant_id,
          b.id,
          b.patient_id,
          b.visit_id,
          b.referring_doctor_id,
          b.doctor_visit_bill,
          b.test_bill,
          b.total,
          MIN(pt.paid_amount, COALESCE(b.paid, pt.paid_amount)) as received_amount
        FROM payment_totals pt
        JOIN bills b ON b.id = pt.bill_id AND b.tenant_id = pt.tenant_id
        WHERE COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
          AND pt.paid_amount > 0
        UNION ALL
        SELECT
          b.tenant_id,
          b.id,
          b.patient_id,
          b.visit_id,
          b.referring_doctor_id,
          b.doctor_visit_bill,
          b.test_bill,
          b.total,
          COALESCE(b.paid, 0) as received_amount
        FROM bills b
        WHERE b.tenant_id = ?
          AND ${buildDateFilter('b.created_at, b.updated_at')}
          AND (? IS NULL OR b.created_by = ?)
          AND (? IS NULL OR b.counter_id = ?)
          AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
          AND COALESCE(b.paid, 0) > 0
          AND NOT EXISTS (
            SELECT 1 FROM payments existing_payment
            WHERE existing_payment.tenant_id = b.tenant_id
              AND existing_payment.bill_id = b.id
          )
      ),
      service_bases AS (
        SELECT
          pb.tenant_id,
          pb.id as bill_id,
          pb.received_amount as paid_amount,
          COALESCE(
            cd.visit_commission_doctor_id,
            ib.visit_item_doctor_id,
            v.doctor_id,
            pb.referring_doctor_id
          ) as visit_doctor_id,
          COALESCE(
            pb.referring_doctor_id,
            v.doctor_id,
            cd.referral_doctor_id,
            cd.lab_doctor_id
          ) as test_doctor_id,
          MAX(0, COALESCE(NULLIF(pb.doctor_visit_bill, 0), ib.visit_item_base, 0)) as visit_base,
          MAX(0, COALESCE(NULLIF(pb.test_bill, 0), ib.test_item_base, 0)) as test_base,
          MAX(
            COALESCE(pb.total, 0),
            MAX(0, COALESCE(NULLIF(pb.doctor_visit_bill, 0), ib.visit_item_base, 0))
              + MAX(0, COALESCE(NULLIF(pb.test_bill, 0), ib.test_item_base, 0))
          ) as allocation_base
        FROM paid_bills pb
        LEFT JOIN invoice_service_bases ib ON ib.bill_id = pb.id AND ib.tenant_id = pb.tenant_id
        LEFT JOIN commission_doctors cd ON cd.bill_id = pb.id AND cd.tenant_id = pb.tenant_id
        LEFT JOIN visits v ON v.id = pb.visit_id AND v.tenant_id = pb.tenant_id
      ),
      service_lines AS (
        SELECT
          COALESCE(visit_doctor_id, 0) as doctor_id,
          CASE WHEN allocation_base > 0 THEN 1.0 * paid_amount * visit_base / allocation_base ELSE 0 END as visit_collection_amount,
          0 as test_collection_amount
        FROM service_bases
        WHERE visit_base > 0
        UNION ALL
        SELECT
          COALESCE(test_doctor_id, 0) as doctor_id,
          0 as visit_collection_amount,
          CASE WHEN allocation_base > 0 THEN 1.0 * paid_amount * test_base / allocation_base ELSE 0 END as test_collection_amount
        FROM service_bases
        WHERE test_base > 0
      )
      SELECT
        sl.doctor_id,
        COALESCE(d.name, 'Unassigned / No Doctor') as doctor_name,
        COALESCE(SUM(sl.visit_collection_amount), 0) as visit_collection_amount,
        COALESCE(SUM(sl.test_collection_amount), 0) as test_collection_amount
      FROM service_lines sl
      LEFT JOIN doctors d ON d.id = sl.doctor_id AND d.tenant_id = ?
      GROUP BY sl.doctor_id, doctor_name
      HAVING visit_collection_amount > 0 OR test_collection_amount > 0
    `).bind(
      tenantId,
      tenantId,
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
      tenantId,
      ...dateParams,
      employeeFilter,
      employeeFilter,
      counterFilter,
      counterFilter,
      tenantId,
    ).all<{
      doctor_id: number;
      doctor_name: string;
      visit_collection_amount: number;
      test_collection_amount: number;
    }>();

    const { results: doctorInvoiceVisitRows } = await db.$client.prepare(`
      SELECT
        d.id as doctor_id,
        d.name as doctor_name,
        COUNT(DISTINCT b.patient_id) as patient_count,
        COUNT(DISTINCT COALESCE(b.visit_id, b.id)) as doctor_visit_count,
        COALESCE(SUM(
          CASE
            WHEN ii.id IS NOT NULL THEN ii.line_total
            ELSE COALESCE(b.doctor_visit_bill, 0)
          END
        ), 0) as doctor_visit_amount
      FROM bills b
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN invoice_items ii ON ii.bill_id = b.id
        AND ii.tenant_id = b.tenant_id
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND ${consultationItemPredicate}
      JOIN doctors d ON d.id = COALESCE(v.doctor_id, b.referring_doctor_id) AND d.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND ${buildDateFilter('b.created_at, b.updated_at')}
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND (COALESCE(b.doctor_visit_bill, 0) > 0 OR ii.id IS NOT NULL)
      GROUP BY d.id, d.name
    `).bind(tenantId, ...dateParams).all<{
      doctor_id: number;
      doctor_name: string;
      patient_count: number;
      doctor_visit_count: number;
      doctor_visit_amount: number;
    }>();

    const { results: doctorTestRows } = await db.$client.prepare(`
      SELECT
        d.id as doctor_id,
        d.name as doctor_name,
        COUNT(DISTINCT dca.lab_order_item_id) as test_count,
        COUNT(DISTINCT COALESCE(dca.lab_order_id, loi.lab_order_id)) as test_order_count,
        COALESCE(SUM(COALESCE(loi.line_total, dca.gross_amount, 0)), 0) as test_collection_amount
      FROM doctor_commission_accruals dca
      JOIN doctors d ON d.id = dca.doctor_id AND d.tenant_id = dca.tenant_id
      LEFT JOIN lab_order_items loi ON loi.id = dca.lab_order_item_id AND loi.tenant_id = dca.tenant_id
      LEFT JOIN lab_orders lo ON lo.id = COALESCE(dca.lab_order_id, loi.lab_order_id) AND lo.tenant_id = dca.tenant_id
      LEFT JOIN bills b ON b.id = COALESCE(dca.bill_id, lo.bill_id) AND b.tenant_id = dca.tenant_id
      WHERE dca.tenant_id = ?
        AND ${buildDateFilter('loi.completed_at, loi.verified_at, lo.order_date, b.created_at, dca.accrued_date')}
        AND dca.source_type = 'lab_test'
        AND (dca.lab_order_item_id IS NOT NULL OR dca.lab_order_id IS NOT NULL)
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
      GROUP BY d.id, d.name
    `).bind(tenantId, ...dateParams).all<{
      doctor_id: number;
      doctor_name: string;
      test_count: number;
      test_order_count: number;
      test_collection_amount: number;
    }>();

    const { results: doctorTestFallbackRows } = await db.$client.prepare(`
      SELECT
        d.id as doctor_id,
        d.name as doctor_name,
        COUNT(loi.id) as test_count,
        COUNT(DISTINCT lo.id) as test_order_count,
        COALESCE(SUM(loi.line_total), 0) as test_collection_amount
      FROM lab_orders lo
      JOIN lab_order_items loi ON loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
      LEFT JOIN bills b ON b.id = lo.bill_id AND b.tenant_id = lo.tenant_id
      LEFT JOIN visits v ON v.id = lo.visit_id AND v.tenant_id = lo.tenant_id
      JOIN doctors d ON d.id = COALESCE(b.referring_doctor_id, v.doctor_id) AND d.tenant_id = lo.tenant_id
      WHERE lo.tenant_id = ? AND ${buildDateFilter('loi.completed_at, loi.verified_at, lo.order_date, b.created_at, lo.created_at')}
        AND COALESCE(loi.status, 'pending') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      GROUP BY d.id, d.name
    `).bind(tenantId, ...dateParams).all<{
      doctor_id: number;
      doctor_name: string;
      test_count: number;
      test_order_count: number;
      test_collection_amount: number;
    }>();

    const { results: doctorInvoiceTestRows } = await db.$client.prepare(`
      SELECT
        d.id as doctor_id,
        d.name as doctor_name,
        COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN COALESCE(ii.quantity, 1) ELSE 0 END), 0) as test_count,
        COUNT(DISTINCT b.id) as test_order_count,
        COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN ii.line_total ELSE 0 END), 0) as test_collection_amount
      FROM invoice_items ii
      JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      JOIN doctors d ON d.id = COALESCE(b.referring_doctor_id, v.doctor_id) AND d.tenant_id = b.tenant_id
      WHERE ii.tenant_id = ?
        AND ${buildDateFilter('ii.created_at, b.created_at')}
        AND ii.item_category = 'test'
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      GROUP BY d.id, d.name
    `).bind(tenantId, ...dateParams).all<{
      doctor_id: number;
      doctor_name: string;
      test_count: number;
      test_order_count: number;
      test_collection_amount: number;
    }>();

    const { results: unassignedInvoiceTestRows } = await db.$client.prepare(`
      SELECT
        0 as doctor_id,
        'Unassigned / No Doctor' as doctor_name,
        COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN COALESCE(ii.quantity, 1) ELSE 0 END), 0) as test_count,
        COUNT(DISTINCT b.id) as test_order_count,
        COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN ii.line_total ELSE 0 END), 0) as test_collection_amount
      FROM invoice_items ii
      JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      WHERE ii.tenant_id = ?
        AND ${buildDateFilter('ii.created_at, b.created_at')}
        AND ii.item_category = 'test'
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND COALESCE(b.referring_doctor_id, v.doctor_id) IS NULL
      GROUP BY doctor_id, doctor_name
      HAVING test_count > 0 OR test_collection_amount > 0
    `).bind(tenantId, ...dateParams).all<{
      doctor_id: number;
      doctor_name: string;
      test_count: number;
      test_order_count: number;
      test_collection_amount: number;
    }>();

    const { results: doctorCommissionRows } = await db.$client.prepare(`
      SELECT
        dca.doctor_id,
        d.name as doctor_name,
        COALESCE(SUM(${reconciledCommissionAmount('dca')}), 0) as commission_amount,
        COALESCE(SUM(CASE WHEN dca.source_type = 'consultation_fee' THEN ${reconciledCommissionAmount('dca')} ELSE 0 END), 0) as consultation_commission_amount,
        COALESCE(SUM(CASE WHEN dca.source_type IN ('lab_test', 'referral') THEN ${reconciledCommissionAmount('dca')} ELSE 0 END), 0) as test_commission_amount,
        COALESCE(SUM(CASE WHEN dca.source_type = 'referral' THEN ${reconciledCommissionAmount('dca')} ELSE 0 END), 0) as referral_commission_amount,
        CASE
          WHEN COUNT(DISTINCT CASE
            WHEN dca.source_type IN ('lab_test', 'referral') AND COALESCE(dca.commission_rate_bps, 0) > 0
              THEN dca.commission_rate_bps
            ELSE NULL
          END) = 1
            THEN ROUND(MAX(CASE
              WHEN dca.source_type IN ('lab_test', 'referral') THEN COALESCE(dca.commission_rate_bps, 0)
              ELSE 0
            END) / 100.0, 2)
          WHEN COUNT(DISTINCT CASE
            WHEN dca.source_type IN ('lab_test', 'referral') AND COALESCE(dca.commission_rate_bps, 0) > 0
              THEN dca.commission_rate_bps
            ELSE NULL
          END) = 0 THEN 0
          ELSE NULL
        END as test_commission_percent
      FROM doctor_commission_accruals dca
      JOIN doctors d ON d.id = dca.doctor_id AND d.tenant_id = dca.tenant_id
      LEFT JOIN lab_order_items loi ON loi.id = dca.lab_order_item_id AND loi.tenant_id = dca.tenant_id
      LEFT JOIN lab_orders lo ON lo.id = COALESCE(dca.lab_order_id, loi.lab_order_id) AND lo.tenant_id = dca.tenant_id
      LEFT JOIN bills b ON b.id = COALESCE(dca.bill_id, lo.bill_id) AND b.tenant_id = dca.tenant_id
      WHERE dca.tenant_id = ?
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${fullyPaidBill('b')}
        AND (
          (
            dca.source_type = 'lab_test'
            AND (dca.lab_order_item_id IS NOT NULL OR dca.lab_order_id IS NOT NULL OR dca.bill_id IS NOT NULL)
            AND ${buildDateFilter('loi.completed_at, loi.verified_at, lo.order_date, b.created_at, dca.accrued_date')}
          )
          OR (
            dca.source_type = 'consultation_fee'
            AND dca.bill_id IS NOT NULL
            AND COALESCE(b.paid, b.paid_amount, 0) > 0
            AND ${buildDateFilter('b.created_at, dca.accrued_date')}
          )
          OR (
            dca.source_type = 'referral'
            AND (dca.bill_id IS NOT NULL OR dca.lab_order_id IS NOT NULL OR dca.visit_id IS NOT NULL)
            AND ${buildDateFilter('b.created_at, lo.order_date, dca.accrued_date')}
          )
        )
      GROUP BY dca.doctor_id, d.name
    `).bind(tenantId, ...dateParams, ...dateParams, ...dateParams).all<{
      doctor_id: number;
      doctor_name: string;
      commission_amount: number;
      consultation_commission_amount: number;
      test_commission_amount: number;
      referral_commission_amount: number;
      test_commission_percent: number | null;
    }>();

    const { results: doctorTestInvoiceRows } = await db.$client.prepare(`
      SELECT
        COALESCE(d.id, 0) as doctor_id,
        COALESCE(d.name, NULLIF(b.referred_by_name, ''), 'Unassigned / No Doctor') as doctor_name,
        b.id as bill_id,
        b.invoice_no,
        COALESCE(b.created_at, b.updated_at) as invoice_date,
        p.name as patient_name,
        p.patient_code,
        p.mobile as patient_mobile,
        COALESCE(NULLIF(b.referred_by_name, ''), d.name, 'Unassigned / No Doctor') as reference_name,
        GROUP_CONCAT(COALESCE(NULLIF(ii.description, ''), 'Test'), ', ') as test_names,
        COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN COALESCE(ii.quantity, 1) ELSE 0 END), 0) as test_count,
        COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1) ELSE 0 END), 0) as gross_amount,
        COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN MAX(0, (COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1)) - COALESCE(ii.line_total, 0)) ELSE 0 END), 0) as discount_amount,
        COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN COALESCE(ii.line_total, 0) ELSE 0 END), 0) as test_collection_amount,
        COALESCE(b.paid, 0) as paid_amount,
        MAX(0, COALESCE(b.due, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) as due_amount,
        COALESCE(comm.test_commission_amount, 0) as test_commission_amount,
        CASE
          WHEN COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1) ELSE 0 END), 0) > 0
            THEN ROUND(
              COALESCE(comm.test_commission_amount, 0) * 100.0
              / NULLIF(SUM(CASE WHEN ii.item_category = 'test' THEN COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1) ELSE 0 END), 0),
              2
            )
          ELSE 0
        END as test_commission_percent
      FROM invoice_items ii
      JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN doctors d ON d.id = COALESCE(b.referring_doctor_id, v.doctor_id) AND d.tenant_id = b.tenant_id
      LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      LEFT JOIN (
        SELECT
          dca.doctor_id,
          comm_b.id as bill_id,
          COALESCE(SUM(${reconciledCommissionAmount('dca')}), 0) as test_commission_amount
        FROM doctor_commission_accruals dca
        LEFT JOIN lab_order_items comm_loi ON comm_loi.id = dca.lab_order_item_id AND comm_loi.tenant_id = dca.tenant_id
        LEFT JOIN lab_orders comm_lo_from_item ON comm_lo_from_item.id = comm_loi.lab_order_id AND comm_lo_from_item.tenant_id = dca.tenant_id
        LEFT JOIN lab_orders comm_lo ON comm_lo.id = dca.lab_order_id AND comm_lo.tenant_id = dca.tenant_id
        JOIN bills comm_b ON comm_b.id = COALESCE(dca.bill_id, comm_lo.bill_id, comm_lo_from_item.bill_id) AND comm_b.tenant_id = dca.tenant_id
        WHERE dca.tenant_id = ?
          AND dca.source_type IN ('lab_test', 'referral')
          AND COALESCE(dca.status, 'accrued') != 'cancelled'
        GROUP BY dca.doctor_id, comm_b.id
      ) comm ON comm.doctor_id = d.id AND comm.bill_id = b.id
      WHERE ii.tenant_id = ?
        AND ${buildDateFilter('ii.created_at, b.created_at')}
        AND ii.item_category = 'test'
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${fullyPaidBill('b')}
      GROUP BY COALESCE(d.id, 0), COALESCE(d.name, NULLIF(b.referred_by_name, ''), 'Unassigned / No Doctor'), b.id, b.referred_by_name, comm.test_commission_amount
      HAVING test_count > 0 OR test_collection_amount > 0
      ORDER BY COALESCE(d.name, NULLIF(b.referred_by_name, ''), 'Unassigned / No Doctor') COLLATE NOCASE ASC, COALESCE(b.created_at, b.updated_at) ASC, b.id ASC
    `).bind(tenantId, tenantId, ...dateParams).all<{
      doctor_id: number;
      doctor_name: string;
      bill_id: number;
      invoice_no: string | null;
      invoice_date: string | null;
      patient_name: string | null;
      patient_code: string | null;
      patient_mobile: string | null;
      reference_name: string | null;
      test_names: string | null;
      test_count: number;
      gross_amount: number;
      discount_amount: number;
      test_collection_amount: number;
      paid_amount: number;
      due_amount: number;
      test_commission_amount: number;
      test_commission_percent: number;
    }>();

    const readyStatusSql = READY_REPORT_STATUSES.map((status) => `'${status}'`).join(', ');
    const { results: reportDeliveryQueue } = await db.$client.prepare(`
      SELECT
        lo.id as lab_order_id,
        lo.order_no,
        lo.status as order_status,
        lo.bill_id,
        p.name as patient_name,
        p.patient_code,
        p.mobile as patient_mobile,
        d.id as doctor_id,
        d.name as doctor_name,
        b.invoice_no,
        COALESCE(b.total, 0) as bill_total,
        COALESCE(b.paid, 0) as bill_paid,
        COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) as due_amount,
        COUNT(loi.id) as item_count,
        SUM(CASE WHEN LOWER(COALESCE(loi.status, lo.status, 'pending')) IN (${readyStatusSql}) THEN 1 ELSE 0 END) as ready_count,
        SUM(CASE WHEN LOWER(COALESCE(loi.status, lo.status, 'pending')) = 'delivered' THEN 1 ELSE 0 END) as delivered_count
      FROM lab_orders lo
      LEFT JOIN lab_order_items loi ON loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
      LEFT JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
      LEFT JOIN visits v ON v.id = lo.visit_id AND v.tenant_id = lo.tenant_id
      LEFT JOIN bills b ON b.id = lo.bill_id AND b.tenant_id = lo.tenant_id
      LEFT JOIN doctors d ON d.id = COALESCE(b.referring_doctor_id, v.doctor_id) AND d.tenant_id = lo.tenant_id
      WHERE lo.tenant_id = ? AND ${buildDateFilter('loi.completed_at, loi.verified_at, lo.order_date, b.created_at, lo.created_at')}
      GROUP BY lo.id
      ORDER BY
        CASE WHEN COUNT(loi.id) > 0 AND SUM(CASE WHEN LOWER(COALESCE(loi.status, lo.status, 'pending')) IN (${readyStatusSql}) THEN 1 ELSE 0 END) = COUNT(loi.id) THEN 1 ELSE 0 END ASC,
        lo.created_at DESC,
        lo.id DESC
      LIMIT 100
    `).bind(tenantId, ...dateParams).all<{
      lab_order_id: number;
      order_no: string | null;
      order_status: string | null;
      bill_id: number | null;
      patient_name: string | null;
      patient_code: string | null;
      patient_mobile: string | null;
      doctor_id: number | null;
      doctor_name: string | null;
      invoice_no: string | null;
      bill_total: number;
      bill_paid: number;
      due_amount: number;
      item_count: number;
      ready_count: number;
      delivered_count: number;
    }>();

    const reportDeliverySummary = reportDeliveryQueue.reduce((acc, row) => {
      const itemCount = Number(row.item_count ?? 0);
      const readyCount = Number(row.ready_count ?? 0);
      const deliveredCount = Number(row.delivered_count ?? 0);
      acc.total_orders += 1;
      acc.total_tests += itemCount;
      acc.ready_tests += readyCount;
      acc.delivered_tests += deliveredCount;
      if (itemCount > 0 && readyCount >= itemCount) acc.ready_orders += 1;
      else acc.pending_orders += 1;
      return acc;
    }, {
      total_orders: 0,
      ready_orders: 0,
      pending_orders: 0,
      total_tests: 0,
      ready_tests: 0,
      delivered_tests: 0,
    });

    const doctorMap = new Map<number, {
      doctor_id: number;
      doctor_name: string;
      patient_count: number;
      doctor_visit_count: number;
      doctor_visit_amount: number;
      test_count: number;
      test_order_count: number;
      test_collection_amount: number;
      commission_amount: number;
      consultation_commission_amount: number;
      test_commission_amount: number;
      referral_commission_amount: number;
      test_commission_percent: number | null;
    }>();

    const ensureDoctor = (doctorId: number, doctorName: string) => {
      if (!doctorMap.has(doctorId)) {
        doctorMap.set(doctorId, {
          doctor_id: doctorId,
          doctor_name: doctorName,
          patient_count: 0,
          doctor_visit_count: 0,
          doctor_visit_amount: 0,
          test_count: 0,
          test_order_count: 0,
          test_collection_amount: 0,
          commission_amount: 0,
          consultation_commission_amount: 0,
          test_commission_amount: 0,
          referral_commission_amount: 0,
          test_commission_percent: null,
        });
      }
      return doctorMap.get(doctorId)!;
    };

    for (const row of doctorPaidServiceRows ?? []) {
      const doctorId = Number(row.doctor_id);
      const visitCollection = Number(row.visit_collection_amount ?? 0);
      const testCollection = Number(row.test_collection_amount ?? 0);
      if (!Number.isFinite(doctorId) || (visitCollection <= 0 && testCollection <= 0)) continue;

      const entry = ensureDoctor(doctorId, row.doctor_name);
      entry.doctor_visit_amount += visitCollection;
      entry.test_collection_amount += testCollection;
    }

    const applyVisitMetadata = (row: {
      doctor_id: number;
      doctor_name: string;
      patient_count: number;
      doctor_visit_count: number;
    }) => {
      const doctorId = Number(row.doctor_id);
      const patientCount = Number(row.patient_count ?? 0);
      const visitCount = Number(row.doctor_visit_count ?? 0);
      if (!Number.isFinite(doctorId) || doctorId <= 0 || (patientCount <= 0 && visitCount <= 0)) return;

      const entry = ensureDoctor(doctorId, row.doctor_name);
      if (entry.patient_count === 0) entry.patient_count = patientCount;
      if (entry.doctor_visit_count === 0) entry.doctor_visit_count = visitCount;
    };

    for (const row of doctorVisitRows ?? []) applyVisitMetadata(row);
    for (const row of doctorInvoiceVisitRows ?? []) applyVisitMetadata(row);
    for (const row of appointmentDoctorRows ?? []) applyVisitMetadata(row);

    const applyTestMetadata = (row: {
      doctor_id: number;
      doctor_name: string;
      test_count: number;
      test_order_count: number;
    }) => {
      const doctorId = Number(row.doctor_id);
      const testCount = Number(row.test_count ?? 0);
      const testOrderCount = Number(row.test_order_count ?? 0);
      if (!Number.isFinite(doctorId) || (testCount <= 0 && testOrderCount <= 0)) return;

      const entry = ensureDoctor(doctorId, row.doctor_name);
      if (entry.test_count === 0) entry.test_count = testCount;
      if (entry.test_order_count === 0) entry.test_order_count = testOrderCount;
    };

    for (const row of doctorInvoiceTestRows ?? []) applyTestMetadata(row);
    for (const row of doctorTestFallbackRows ?? []) applyTestMetadata(row);
    for (const row of doctorTestRows ?? []) applyTestMetadata(row);
    for (const row of unassignedInvoiceTestRows ?? []) applyTestMetadata(row);

    for (const row of doctorCommissionRows ?? []) {
      const doctorId = Number(row.doctor_id);
      const commissionAmount = Number(row.commission_amount ?? 0);
      const consultationCommissionAmount = Number(row.consultation_commission_amount ?? 0);
      const testCommissionAmount = Number(row.test_commission_amount ?? 0);
      const referralCommissionAmount = Number(row.referral_commission_amount ?? 0);
      const rawTestCommissionPercent = row.test_commission_percent;
      const testCommissionPercent = rawTestCommissionPercent == null ? null : Number(rawTestCommissionPercent);
      if (!Number.isFinite(doctorId) || doctorId <= 0 || (commissionAmount <= 0 && consultationCommissionAmount <= 0 && testCommissionAmount <= 0 && referralCommissionAmount <= 0)) continue;

      const entry = ensureDoctor(doctorId, row.doctor_name);
      entry.commission_amount = commissionAmount;
      entry.consultation_commission_amount = consultationCommissionAmount;
      entry.test_commission_amount = testCommissionAmount;
      entry.referral_commission_amount = referralCommissionAmount;
      entry.test_commission_percent = testCommissionPercent != null && Number.isFinite(testCommissionPercent)
        ? testCommissionPercent
        : null;
    }

    const doctorSummaries = Array.from(doctorMap.values()).sort((a, b) => (
      (b.doctor_visit_amount + b.test_collection_amount) - (a.doctor_visit_amount + a.test_collection_amount)
    ));

    const { results: invoiceDiscountRows } = await db.$client.prepare(`
      SELECT
        b.id as bill_id,
        b.invoice_no,
        COALESCE(b.created_at, b.updated_at) as created_at,
        b.created_by as employee_id,
        COALESCE(u.name, s.name, CASE WHEN b.created_by IS NOT NULL THEN 'Employee #' || b.created_by ELSE 'Unassigned' END) as employee_name,
        p.name as patient_name,
        COALESCE(SUM(CASE WHEN ii.id IS NOT NULL THEN MAX(0, (COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1)) - COALESCE(ii.line_total, 0)) ELSE 0 END), 0) as line_discount_amount,
        COALESCE(b.discount, 0) as bill_discount_amount
      FROM bills b
      LEFT JOIN invoice_items ii ON ii.bill_id = b.id AND ii.tenant_id = b.tenant_id AND COALESCE(ii.status, 'active') != 'cancelled'
      LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      LEFT JOIN users u ON u.id = b.created_by AND u.tenant_id = b.tenant_id
      LEFT JOIN staff s ON s.id = b.created_by AND s.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND ${buildDateFilter('b.created_at, b.updated_at')}
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      GROUP BY b.id, b.invoice_no, b.created_at, b.updated_at, b.created_by, employee_name, p.name, b.discount
      HAVING line_discount_amount > 0 OR bill_discount_amount > 0
      ORDER BY COALESCE(b.created_at, b.updated_at) DESC, b.id DESC
      LIMIT 500
    `).bind(tenantId, ...dateParams).all<{
      bill_id: number;
      invoice_no: string | null;
      created_at: string | null;
      employee_id: number | null;
      employee_name: string | null;
      patient_name: string | null;
      line_discount_amount: number;
      bill_discount_amount: number;
    }>();

    const discountRows = (invoiceDiscountRows ?? []).map((row) => {
      const amount = Math.max(Number(row.line_discount_amount ?? 0), Number(row.bill_discount_amount ?? 0));
      return {
        source: 'invoice_discount',
        transaction_type: 'InvoiceDiscount',
        reference_type: 'bill',
        reference_id: row.bill_id,
        invoice_no: row.invoice_no,
        description: [row.invoice_no, row.patient_name].filter(Boolean).join(' · ') || `Bill #${row.bill_id}`,
        amount,
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        created_at: row.created_at,
      };
    }).filter((row) => row.amount > 0);

    const invoiceDiscountTotal = discountRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const totalDiscounts = Math.max(Number(summary.total_cash_discount_given ?? 0), invoiceDiscountTotal);
    summary.total_cash_discount_given = totalDiscounts;
    financeSummary.total_discounts = totalDiscounts;

    const employeeRows = (byEmployee ?? []).map((row: any) => ({ ...row }));
    const discountByEmployee = new Map<number, { amount: number; name: string | null }>();
    for (const row of discountRows) {
      const employeeId = Number(row.employee_id ?? 0);
      if (!Number.isFinite(employeeId) || employeeId <= 0) continue;
      const current = discountByEmployee.get(employeeId) ?? { amount: 0, name: row.employee_name ?? null };
      current.amount += Number(row.amount ?? 0);
      if (!current.name && row.employee_name) current.name = row.employee_name;
      discountByEmployee.set(employeeId, current);
    }
    for (const [employeeId, value] of discountByEmployee.entries()) {
      let row = employeeRows.find((item: any) => Number(item.employee_id) === employeeId);
      if (!row) {
        row = { employee_id: employeeId, employee_name: value.name ?? `Employee #${employeeId}`, user_name: '', cash_sales: 0, sales_return: 0, deposit_return: 0, collection_from_receivable: 0, cash_discount_given: 0, cash_discount_received: 0, net: 0 };
        employeeRows.push(row);
      }
      row.employee_name = row.employee_name || value.name || `Employee #${employeeId}`;
      row.cash_discount_given = Math.max(Number(row.cash_discount_given ?? 0), value.amount);
    }

    const patientRegistrationSummaryRow = await db.$client.prepare(`
      SELECT
        COUNT(*) as total_patients,
        COALESCE(SUM(CASE WHEN COALESCE(mobile, guardian_mobile, '') != '' THEN 1 ELSE 0 END), 0) as with_mobile
      FROM patients
      WHERE tenant_id = ? AND ${buildDateFilter('created_at')}
    `).bind(tenantId, ...dateParams).first<{ total_patients: number; with_mobile: number }>();

    const { results: patientRegistrationByGender } = await db.$client.prepare(`
      SELECT COALESCE(NULLIF(TRIM(gender), ''), 'Unknown') as gender, COUNT(*) as count
      FROM patients
      WHERE tenant_id = ? AND ${buildDateFilter('created_at')}
      GROUP BY COALESCE(NULLIF(TRIM(gender), ''), 'Unknown')
      ORDER BY count DESC
    `).bind(tenantId, ...dateParams).all<{ gender: string; count: number }>();

    const { results: patientRegistrationRows } = await db.$client.prepare(`
      SELECT id, patient_code, uhid, name, mobile, guardian_mobile, age, gender, district, upazila, created_at
      FROM patients
      WHERE tenant_id = ? AND ${buildDateFilter('created_at')}
      ORDER BY created_at DESC
      LIMIT 500
    `).bind(tenantId, ...dateParams).all();

    const ipdAdmissionSummaryRow = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN ${buildDateFilter('admission_date')} THEN 1 ELSE 0 END), 0) as new_admissions,
        COALESCE(SUM(CASE WHEN discharge_date IS NOT NULL AND ${buildDateFilter('discharge_date')} THEN 1 ELSE 0 END), 0) as discharges,
        COALESCE(SUM(CASE WHEN COALESCE(status, 'admitted') NOT IN ('discharged', 'cancelled') THEN 1 ELSE 0 END), 0) as running_admitted
      FROM admissions
      WHERE tenant_id = ?
    `).bind(...dateParams, ...dateParams, tenantId).first<{ new_admissions: number; discharges: number; running_admitted: number }>();

    const { results: ipdAdmissionRows } = await db.$client.prepare(`
      SELECT
        a.id,
        a.admission_no,
        a.admission_date,
        a.discharge_date,
        a.status,
        p.name as patient_name,
        p.patient_code,
        d.name as doctor_name,
        beds.ward_name,
        beds.bed_number
      FROM admissions a
      LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      LEFT JOIN beds ON beds.id = a.bed_id AND beds.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
        AND (${buildDateFilter('a.admission_date')} OR (a.discharge_date IS NOT NULL AND ${buildDateFilter('a.discharge_date')}) OR COALESCE(a.status, 'admitted') NOT IN ('discharged', 'cancelled'))
      ORDER BY COALESCE(a.discharge_date, a.admission_date) DESC
      LIMIT 500
    `).bind(tenantId, ...dateParams, ...dateParams).all();

    const { results: serviceItemSalesRows } = await db.$client.prepare(`
      SELECT
        ii.item_category,
        COALESCE(NULLIF(ii.description, ''), 'Service') as description,
        COALESCE(SUM(COALESCE(ii.quantity, 1)), 0) as quantity,
        COALESCE(SUM(COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1)), 0) as gross_amount,
        COALESCE(SUM(MAX(0, (COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1)) - COALESCE(ii.line_total, 0))), 0) as discount_amount,
        COALESCE(SUM(COALESCE(ii.line_total, 0)), 0) as net_amount
      FROM invoice_items ii
      JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
      WHERE ii.tenant_id = ?
        AND ${buildDateFilter('ii.created_at, b.created_at')}
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      GROUP BY ii.item_category, COALESCE(NULLIF(ii.description, ''), 'Service')
      ORDER BY net_amount DESC
      LIMIT 500
    `).bind(tenantId, ...dateParams).all();

    const { results: invoiceSummaryRows } = await db.$client.prepare(`
      SELECT
        b.id,
        b.invoice_no,
        COALESCE(b.created_at, b.updated_at) as invoice_date,
        COALESCE(b.status, 'open') as status,
        p.name as patient_name,
        d.name as doctor_name,
        COALESCE(b.total, 0) as total_amount,
        COALESCE(b.paid, 0) as paid_amount,
        MAX(0, COALESCE(b.due, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) as due_amount,
        CASE
          WHEN COALESCE(b.test_bill, 0) > 0 THEN 'Test Invoice'
          WHEN COALESCE(b.doctor_visit_bill, 0) > 0 THEN 'Visit Invoice'
          ELSE 'Invoice'
        END as source
      FROM bills b
      LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN (
        SELECT
          ii.bill_id,
          ii.tenant_id,
          MIN(ii.reference_id) as doctor_id
        FROM invoice_items ii
        WHERE ii.reference_id IS NOT NULL
          AND COALESCE(ii.status, 'active') != 'cancelled'
          AND ${consultationItemPredicate}
        GROUP BY ii.bill_id, ii.tenant_id
      ) doctor_visit_item_doctors ON doctor_visit_item_doctors.bill_id = b.id AND doctor_visit_item_doctors.tenant_id = b.tenant_id
      LEFT JOIN doctors d ON d.id = COALESCE(b.referring_doctor_id, v.doctor_id, doctor_visit_item_doctors.doctor_id) AND d.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND ${buildDateFilter('b.created_at, b.updated_at')}
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'draft')
      ORDER BY COALESCE(b.created_at, b.updated_at) DESC
      LIMIT 500
    `).bind(tenantId, ...dateParams).all();

    const patientsSeen = Number(serviceSummaryRow?.total_patients_seen ?? 0)
      || Number(appointmentSummaryRow?.total_patients_seen ?? 0)
      || Number(billFallbackRow?.patient_count ?? 0);
    const doctorVisitCount = Number(serviceSummaryRow?.doctor_visit_count ?? 0)
      || Number(appointmentSummaryRow?.doctor_visit_count ?? 0)
      || Number(billFallbackRow?.doctor_visit_count ?? 0);
    const doctorVisitAmount = Number(serviceSummaryRow?.doctor_visit_amount ?? 0)
      || Number(appointmentSummaryRow?.doctor_visit_amount ?? 0)
      || Number(billFallbackRow?.doctor_visit_amount ?? 0);
    const invoiceTestCount = Number(invoiceTestSummaryRow?.test_count ?? 0);
    const labTestCount = Number(testSummaryRow?.test_count ?? 0);
    const testCount = invoiceTestCount > 0 ? invoiceTestCount : labTestCount;
    const testAmount = Number(invoiceTestSummaryRow?.test_amount ?? 0)
      || Number(testSummaryRow?.test_amount ?? 0)
      || Number(billFallbackRow?.test_amount ?? 0);

    const collectionSources = [
      { department: 'Doctor Visit / Consultation', amount: Number(serviceCollectionSummary.doctor_visit_collection ?? 0) },
      { department: 'Diagnostic / Laboratory', amount: Number(serviceCollectionSummary.test_collection ?? 0) },
      { department: 'Admission / IPD', amount: Number(serviceCollectionSummary.ipd_collection ?? 0) },
      { department: 'Operation Theatre / Procedures', amount: Number(serviceCollectionSummary.ot_collection ?? 0) },
      { department: 'Pharmacy / Medicines', amount: Number(serviceCollectionSummary.pharmacy_collection ?? 0) },
      { department: 'Radiology / Imaging', amount: Number(serviceCollectionSummary.radiology_collection ?? 0) },
      { department: 'Uncategorized Services', amount: Number(serviceCollectionSummary.uncategorized_collection ?? 0) },
    ];
    if (depositCollection > 0) {
      collectionSources.push({ department: 'Deposits / Advances', amount: depositCollection });
    }

    const totalPaymentReceived = byPaymentMethod.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);
    const paymentMethodsList = byPaymentMethod.map((row) => {
      const amount = Number(row.total_amount ?? 0);
      const percentage = totalPaymentReceived > 0 ? (amount / totalPaymentReceived) * 100 : 0;
      const rawMethod = String(row.payment_method ?? 'unknown');
      const formatted = rawMethod === 'bkash' ? 'bKash' : rawMethod === 'nagad' ? 'Nagad' : rawMethod.charAt(0).toUpperCase() + rawMethod.slice(1);
      return {
        method: formatted,
        amount,
        percentage
      };
    });

    const expensesListFormatted = expensesList.map(row => ({
      expense_head: row.expense_head,
      amount: Number(row.amount ?? 0)
    }));

    const totalCollection = Number(financeSummary.current_collection ?? 0)
      + Number(financeSummary.due_collection ?? 0)
      + Number(financeSummary.deposit_collection ?? 0);
    const netIncome = totalCollection - totalExpense;
    const openingCash = Number(sessionsRow?.total_opening_cash ?? 0);
    const depositCashReturns = Number(summary.total_deposit_return ?? 0);
    const netCashCollection = Number(financeSummary.cash_received ?? 0) - depositCashReturns;
    const netCashMovement = netCashCollection - physicalCashOut;
    // Do not clamp deficits to zero: a negative drawer balance is an exception that must remain visible.
    const cashInHand = openingCash + netCashMovement;
    const cashClosing = {
      opening_cash: openingCash,
      cash_collection: netCashCollection,
      expense: physicalCashOut,
      accounting_expense: totalExpense,
      net_cash_movement: netCashMovement,
      cash_in_hand: cashInHand,
      handover_amount: cashInHand,
    };

    return c.json({
      date: isRange ? null : reportDate,
      start_date: isRange ? rangeStart : null,
      end_date: isRange ? rangeEnd : null,
      summary: {
        total_bill: Number(billFallbackRow?.total_billed ?? 0),
        total_collection: totalCollection,
        total_deposit: Number(financeSummary.deposit_collection ?? 0),
        total_expense: totalExpense,
        total_due: Number(billFallbackRow?.total_due ?? 0),
        net_income: netIncome,
        net_cash: netCashMovement
      },
      collection_sources: collectionSources,
      payment_methods: paymentMethodsList,
      expenses: expensesListFormatted,
      expense_details: expenseDetails,
      cash_closing: cashClosing,
      // Legacy fields with discounts deleted / sanitized
      finance_summary: {
        total_received: financeSummary.total_received,
        cash_received: financeSummary.cash_received,
        current_collection: financeSummary.current_collection,
        due_collection: financeSummary.due_collection,
        deposit_collection: financeSummary.deposit_collection,
        total_returns: financeSummary.total_returns,
        net_collection: financeSummary.net_collection
      },
      bill_summary: {
        invoice_count: billSummary.invoice_count,
        patient_count: billSummary.patient_count,
        final_bill_amount: billSummary.final_bill_amount,
        paid_against_bills: billSummary.paid_against_bills,
        due_remaining: billSummary.due_remaining,
        doctor_visit_bill_amount: billSummary.doctor_visit_bill_amount,
        test_bill_amount: billSummary.test_bill_amount,
        other_bill_amount: billSummary.other_bill_amount
      },
      service_collection_summary: serviceCollectionSummary,
      service_summary: {
        total_patients_seen: patientsSeen,
        doctor_visit_count: doctorVisitCount,
        doctor_visit_amount: doctorVisitAmount,
        test_count: testCount,
        test_amount: testAmount,
      },
      report_delivery_summary: reportDeliverySummary,
      report_delivery_queue: (reportDeliveryQueue ?? []).map((row) => {
        const itemCount = Number(row.item_count ?? 0);
        const readyCount = Number(row.ready_count ?? 0);
        const dueAmount = Math.max(0, Number(row.due_amount ?? 0));
        return {
          ...row,
          due_amount: dueAmount,
          can_print: itemCount > 0 && readyCount >= itemCount && dueAmount <= 0,
        };
      }),
      doctor_summaries: doctorSummaries,
      doctor_test_invoices: doctorTestInvoiceRows ?? [],
      invoice_summary_rows: invoiceSummaryRows ?? [],
      service_item_sales_rows: serviceItemSalesRows ?? [],
      patient_registration_summary: {
        ...(patientRegistrationSummaryRow ?? { total_patients: 0, with_mobile: 0 }),
        by_gender: patientRegistrationByGender ?? [],
      },
      patient_registration_rows: patientRegistrationRows ?? [],
      ipd_admission_summary: ipdAdmissionSummaryRow ?? { new_admissions: 0, discharges: 0, running_admitted: 0 },
      ipd_admission_rows: ipdAdmissionRows ?? [],
      by_employee: employeeRows.map((r: any) => ({
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        user_name: r.user_name,
        cash_sales: r.cash_sales,
        sales_return: r.sales_return,
        deposit_deduct: r.deposit_deduct,
        deposit_return: r.deposit_return,
        collection_from_receivable: r.collection_from_receivable,
        net: r.net
      })),
      by_payment_method: byPaymentMethod ?? [],
      details: details ?? [],
    });
  } catch (error) {
    console.error('daily collection error:', error);
    throw new HTTPException(500, { message: 'Failed to generate daily collection report' });
  }
});

export default dailyCollectionRoutes;
