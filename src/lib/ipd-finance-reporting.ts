export interface IpdDailyActivityRow {
  billId: number;
  invoiceNo: string | null;
  admissionId: number;
  admissionNo: string | null;
  patientName: string | null;
  patientCode: string | null;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  paymentAmount: number;
  cashAmount: number;
  nonCashAmount: number;
  depositReceivedToday: number;
  totalReceivedToday: number;
  depositApplied: number;
  dueAmount: number;
  status: string | null;
  paymentMethod: string | null;
  serviceNames: string | null;
  itemCount: number;
  occurredAt: string | null;
}

export interface IpdDailySnapshot {
  totalInpatients: number;
  pendingBilling: number;
  chargesAddedToday: number;
  grossBilledToday: number;
  finalBilledToday: number;
  finalBillCountToday: number;
  paymentCollectedToday: number;
  paymentReceiptCountToday: number;
  cashCollectedToday: number;
  nonCashCollectedToday: number;
  depositReceivedToday: number;
  depositReceiptCountToday: number;
  depositCashReceivedToday: number;
  depositNonCashReceivedToday: number;
  totalMoneyReceivedToday: number;
  totalCashReceivedToday: number;
  totalNonCashReceivedToday: number;
  depositAppliedToday: number;
  discountToday: number;
  settledGrossToday: number;
  settledDiscountToday: number;
  settledPaymentAppliedToday: number;
  settledDepositAppliedToday: number;
  settledToday: number;
  settledBillCountToday: number;
  currentProvisionalDue: number;
  highDuePatients: number;
  packagePatients: number;
  todayAdmissions: number;
  todayDischarges: number;
  activity: IpdDailyActivityRow[];
}

interface ScalarRow {
  total?: number | string | null;
  count?: number | string | null;
  gross?: number | string | null;
  net?: number | string | null;
  discount?: number | string | null;
  cash?: number | string | null;
  non_cash?: number | string | null;
  payment_applied?: number | string | null;
  deposit_applied?: number | string | null;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localReportDate(expression: string): string {
  return `CASE
    WHEN ${expression} IS NULL THEN NULL
    WHEN ${expression} LIKE '%Z' OR ${expression} LIKE '%+00:00' OR ${expression} LIKE '%-00:00'
      THEN date(${expression}, '+6 hours')
    ELSE date(${expression})
  END`;
}

function firstRow(result: D1Result<unknown> | undefined): ScalarRow {
  return ((result?.results?.[0] ?? {}) as ScalarRow);
}

export interface IpdReportingPeriod {
  startDate: string;
  endDate: string;
}

export interface IpdActivityPage {
  page: number;
  pageSize: number;
  offset: number;
}

export interface IpdPeriodSnapshot extends IpdDailySnapshot {
  totalActivityRows: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

function ipdActivityCtes(): string {
  return `
    WITH payment_today AS (
      SELECT p.tenant_id, p.bill_id,
        SUM(p.amount) AS payment_amount,
        SUM(CASE WHEN LOWER(TRIM(COALESCE(p.payment_method, 'cash'))) = 'cash' THEN p.amount ELSE 0 END) AS cash_amount,
        SUM(CASE WHEN LOWER(TRIM(COALESCE(p.payment_method, 'cash'))) <> 'cash' THEN p.amount ELSE 0 END) AS non_cash_amount,
        COUNT(*) AS receipt_count,
        GROUP_CONCAT(DISTINCT COALESCE(NULLIF(TRIM(p.payment_method), ''), 'cash')) AS payment_method,
        MAX(COALESCE(p.date, p.created_at)) AS occurred_at
      FROM payments p
      WHERE p.tenant_id = ?
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} >= date(?)
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} <= date(?)
      GROUP BY p.tenant_id, p.bill_id
    ), deposit_received_today AS (
      SELECT d.tenant_id, a.id AS admission_id,
        SUM(d.amount) AS deposit_received,
        GROUP_CONCAT(DISTINCT COALESCE(NULLIF(TRIM(d.payment_method), ''), 'cash')) AS payment_method,
        MAX(d.created_at) AS occurred_at
      FROM billing_deposits d
      JOIN admissions a
        ON a.tenant_id = d.tenant_id
       AND a.id = d.admission_id
       AND a.patient_id = d.patient_id
      WHERE d.tenant_id = ?
        AND d.is_active = 1
        AND d.transaction_type = 'deposit'
        AND d.admission_id IS NOT NULL
        AND ${localReportDate('d.created_at')} >= date(?)
        AND ${localReportDate('d.created_at')} <= date(?)
      GROUP BY d.tenant_id, a.id
    ), deposit_received_by_bill AS (
      SELECT received.tenant_id, received.admission_id, MAX(b.id) AS bill_id,
        received.deposit_received,
        received.payment_method,
        received.occurred_at
      FROM deposit_received_today received
      JOIN bills b
        ON b.tenant_id = received.tenant_id
       AND b.admission_id = received.admission_id
       AND b.status <> 'cancelled'
       AND ${localReportDate('b.created_at')} <= date(?)
      GROUP BY received.tenant_id, received.admission_id,
        received.deposit_received, received.payment_method, received.occurred_at
    ), deposit_today AS (
      SELECT d.tenant_id, d.reference_bill_id AS bill_id,
        SUM(d.amount) AS deposit_applied
      FROM billing_deposits d
      WHERE d.tenant_id = ?
        AND d.is_active = 1
        AND d.transaction_type = 'adjustment'
        AND ${localReportDate('d.created_at')} >= date(?)
        AND ${localReportDate('d.created_at')} <= date(?)
      GROUP BY d.tenant_id, d.reference_bill_id
    ), activity_bills AS (
      SELECT b.*
      FROM bills b
      LEFT JOIN payment_today pay ON pay.bill_id = b.id AND pay.tenant_id = b.tenant_id
      LEFT JOIN deposit_received_by_bill received ON received.bill_id = b.id AND received.tenant_id = b.tenant_id
      LEFT JOIN deposit_today dep ON dep.bill_id = b.id AND dep.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND b.admission_id IS NOT NULL
        AND b.status <> 'cancelled'
        AND (
          (${localReportDate('b.created_at')} >= date(?) AND ${localReportDate('b.created_at')} <= date(?))
          OR pay.bill_id IS NOT NULL
          OR received.bill_id IS NOT NULL
          OR dep.bill_id IS NOT NULL
        )
    ), item_summary AS (
      SELECT ii.tenant_id, ii.bill_id,
        COUNT(*) AS item_count,
        GROUP_CONCAT(ii.description, ', ') AS service_names
      FROM invoice_items ii
      JOIN activity_bills activity ON activity.id = ii.bill_id AND activity.tenant_id = ii.tenant_id
      WHERE COALESCE(ii.status, 'active') <> 'cancelled'
      GROUP BY ii.tenant_id, ii.bill_id
    ), invoice_activity AS (
      SELECT
        b.id AS bill_id,
        b.invoice_no,
        b.admission_id,
        a.admission_no,
        pt.name AS patient_name,
        pt.patient_code,
        COALESCE(NULLIF(b.subtotal, 0), b.total + b.discount) AS gross_amount,
        COALESCE(b.discount, 0) AS discount_amount,
        COALESCE(b.total, 0) AS net_amount,
        COALESCE(pay.payment_amount, 0) AS payment_amount,
        COALESCE(pay.cash_amount, 0) AS cash_amount,
        COALESCE(pay.non_cash_amount, 0) AS non_cash_amount,
        COALESCE(received.deposit_received, 0) AS deposit_received_today,
        COALESCE(pay.payment_amount, 0) + COALESCE(received.deposit_received, 0) AS total_received_today,
        COALESCE(dep.deposit_applied, 0) AS deposit_applied,
        COALESCE(b.due, 0) AS due_amount,
        b.status,
        COALESCE(pay.payment_method, received.payment_method) AS payment_method,
        items.service_names,
        COALESCE(items.item_count, 0) AS item_count,
        COALESCE(pay.occurred_at, received.occurred_at, b.created_at) AS occurred_at
      FROM activity_bills b
      JOIN admissions a ON a.id = b.admission_id AND a.tenant_id = b.tenant_id
      LEFT JOIN patients pt ON pt.id = b.patient_id AND pt.tenant_id = b.tenant_id
      LEFT JOIN payment_today pay ON pay.bill_id = b.id AND pay.tenant_id = b.tenant_id
      LEFT JOIN deposit_received_by_bill received ON received.bill_id = b.id AND received.tenant_id = b.tenant_id
      LEFT JOIN deposit_today dep ON dep.bill_id = b.id AND dep.tenant_id = b.tenant_id
      LEFT JOIN item_summary items ON items.bill_id = b.id AND items.tenant_id = b.tenant_id
    ), deposit_only_activity AS (
      SELECT
        NULL AS bill_id,
        NULL AS invoice_no,
        received.admission_id,
        a.admission_no,
        pt.name AS patient_name,
        pt.patient_code,
        0 AS gross_amount,
        0 AS discount_amount,
        0 AS net_amount,
        0 AS payment_amount,
        0 AS cash_amount,
        0 AS non_cash_amount,
        received.deposit_received AS deposit_received_today,
        received.deposit_received AS total_received_today,
        0 AS deposit_applied,
        0 AS due_amount,
        'deposit_received' AS status,
        received.payment_method,
        NULL AS service_names,
        0 AS item_count,
        received.occurred_at
      FROM deposit_received_today received
      JOIN admissions a
        ON a.id = received.admission_id
       AND a.tenant_id = received.tenant_id
      LEFT JOIN patients pt
        ON pt.id = a.patient_id
       AND pt.tenant_id = a.tenant_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM bills existing
        WHERE existing.tenant_id = received.tenant_id
          AND existing.admission_id = received.admission_id
          AND existing.status <> 'cancelled'
      )
    )
  `;
}

function ipdActivityBindings(
  tenantId: string,
  startDate: string,
  endDate: string,
): Array<string | number> {
  return [
    tenantId, startDate, endDate,
    tenantId, startDate, endDate,
    endDate,
    tenantId, startDate, endDate,
    tenantId, startDate, endDate,
  ];
}

/**
 * Canonical IPD finance snapshot for an inclusive reporting period.
 * Event totals use the selected period. Operational balances use the selected end date.
 */
export async function getIpdPeriodSnapshot(
  db: D1Database,
  tenantId: string,
  period: IpdReportingPeriod,
  page: IpdActivityPage,
): Promise<IpdPeriodSnapshot> {
  const { startDate, endDate } = period;
  const activityBindings = ipdActivityBindings(tenantId, startDate, endDate);
  const results = await db.batch([
    db.prepare(`
      /* ipd_as_of_inpatients */
      SELECT COUNT(*) AS count
      FROM admissions a
      WHERE a.tenant_id = ?
        AND COALESCE(a.status, 'admitted') <> 'cancelled'
        AND ${localReportDate('a.admission_date')} <= date(?)
        AND (a.discharge_date IS NULL OR ${localReportDate('a.discharge_date')} > date(?))
    `).bind(tenantId, endDate, endDate),
    db.prepare(`
      /* ipd_as_of_pending_billing */
      SELECT COUNT(DISTINCT a.id) AS count
      FROM admissions a
      JOIN billing_provisional_items bp
        ON bp.admission_id = a.id AND bp.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
        AND COALESCE(a.status, 'admitted') <> 'cancelled'
        AND ${localReportDate('a.admission_date')} <= date(?)
        AND (a.discharge_date IS NULL OR ${localReportDate('a.discharge_date')} > date(?))
        AND ${localReportDate('bp.created_at')} <= date(?)
        AND (bp.cancelled_at IS NULL OR ${localReportDate('bp.cancelled_at')} > date(?))
        AND NOT EXISTS (
          SELECT 1 FROM bills finalized
          WHERE finalized.tenant_id = bp.tenant_id
            AND finalized.id = bp.billed_bill_id
            AND ${localReportDate('finalized.created_at')} <= date(?)
            AND (
              finalized.status <> 'cancelled'
              OR (
                finalized.cancelled_at IS NOT NULL
                AND ${localReportDate('finalized.cancelled_at')} > date(?)
              )
            )
        )
    `).bind(tenantId, endDate, endDate, endDate, endDate, endDate, endDate),
    db.prepare(`
      /* ipd_period_charges */
      SELECT COALESCE(SUM(bp.total_amount), 0) AS total, COUNT(*) AS count
      FROM billing_provisional_items bp
      WHERE bp.tenant_id = ?
        AND bp.admission_id IS NOT NULL
        AND ${localReportDate('bp.created_at')} >= date(?)
        AND ${localReportDate('bp.created_at')} <= date(?)
        AND (bp.cancelled_at IS NULL OR ${localReportDate('bp.cancelled_at')} > date(?))
    `).bind(tenantId, startDate, endDate, endDate),
    db.prepare(`
      /* ipd_period_final_bills */
      SELECT
        COALESCE(SUM(COALESCE(NULLIF(b.subtotal, 0), b.total + b.discount)), 0) AS gross,
        COALESCE(SUM(b.total), 0) AS net,
        COALESCE(SUM(b.discount), 0) AS discount,
        COUNT(*) AS count
      FROM bills b
      WHERE b.tenant_id = ?
        AND b.admission_id IS NOT NULL
        AND b.status <> 'cancelled'
        AND ${localReportDate('b.created_at')} >= date(?)
        AND ${localReportDate('b.created_at')} <= date(?)
    `).bind(tenantId, startDate, endDate),
    db.prepare(`
      /* ipd_period_payments */
      SELECT
        COALESCE(SUM(p.amount), 0) AS total,
        COALESCE(SUM(CASE WHEN LOWER(TRIM(COALESCE(p.payment_method, 'cash'))) = 'cash' THEN p.amount ELSE 0 END), 0) AS cash,
        COALESCE(SUM(CASE WHEN LOWER(TRIM(COALESCE(p.payment_method, 'cash'))) <> 'cash' THEN p.amount ELSE 0 END), 0) AS non_cash,
        COUNT(*) AS count
      FROM bills b
      JOIN payments p ON p.bill_id = b.id AND p.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND b.admission_id IS NOT NULL
        AND b.status <> 'cancelled'
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} >= date(?)
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} <= date(?)
    `).bind(tenantId, startDate, endDate),
    db.prepare(`
      /* ipd_period_deposits_received */
      SELECT
        COALESCE(SUM(d.amount), 0) AS total,
        COALESCE(SUM(CASE WHEN LOWER(TRIM(COALESCE(d.payment_method, 'cash'))) = 'cash' THEN d.amount ELSE 0 END), 0) AS cash,
        COALESCE(SUM(CASE WHEN LOWER(TRIM(COALESCE(d.payment_method, 'cash'))) <> 'cash' THEN d.amount ELSE 0 END), 0) AS non_cash,
        COUNT(*) AS count
      FROM billing_deposits d
      WHERE d.tenant_id = ?
        AND d.is_active = 1
        AND d.transaction_type = 'deposit'
        AND d.admission_id IS NOT NULL
        AND ${localReportDate('d.created_at')} >= date(?)
        AND ${localReportDate('d.created_at')} <= date(?)
    `).bind(tenantId, startDate, endDate),
    db.prepare(`
      /* ipd_period_deposits_applied */
      SELECT COALESCE(SUM(d.amount), 0) AS total, COUNT(*) AS count
      FROM billing_deposits d
      JOIN bills b ON b.id = d.reference_bill_id AND b.tenant_id = d.tenant_id
      WHERE d.tenant_id = ?
        AND b.admission_id IS NOT NULL
        AND b.status <> 'cancelled'
        AND d.is_active = 1
        AND d.transaction_type = 'adjustment'
        AND ${localReportDate('d.created_at')} >= date(?)
        AND ${localReportDate('d.created_at')} <= date(?)
    `).bind(tenantId, startDate, endDate),
    db.prepare(`
      WITH settled_bill_ids AS (
        SELECT DISTINCT b.id
        FROM bills b
        WHERE b.tenant_id = ?
          AND b.admission_id IS NOT NULL
          AND b.status = 'paid'
          AND (
            EXISTS (
              SELECT 1 FROM payments p
              WHERE p.tenant_id = b.tenant_id
                AND p.bill_id = b.id
                AND ${localReportDate('COALESCE(p.date, p.created_at)')} >= date(?)
                AND ${localReportDate('COALESCE(p.date, p.created_at)')} <= date(?)
            )
            OR EXISTS (
              SELECT 1 FROM billing_deposits d
              WHERE d.tenant_id = b.tenant_id
                AND d.reference_bill_id = b.id
                AND d.is_active = 1
                AND d.transaction_type = 'adjustment'
                AND ${localReportDate('d.created_at')} >= date(?)
                AND ${localReportDate('d.created_at')} <= date(?)
            )
          )
      )
      SELECT
        COALESCE(SUM(COALESCE(NULLIF(b.subtotal, 0), b.total + b.discount)), 0) AS gross,
        COALESCE(SUM(b.discount), 0) AS discount,
        COALESCE(SUM(b.total), 0) AS total,
        COALESCE((
          SELECT SUM(p.amount)
          FROM payments p
          JOIN settled_bill_ids paid_bill ON paid_bill.id = p.bill_id
          WHERE p.tenant_id = ?
        ), 0) AS payment_applied,
        COALESCE((
          SELECT SUM(d.amount)
          FROM billing_deposits d
          JOIN settled_bill_ids deposit_bill ON deposit_bill.id = d.reference_bill_id
          WHERE d.tenant_id = ?
            AND d.is_active = 1
            AND d.transaction_type = 'adjustment'
        ), 0) AS deposit_applied,
        COUNT(*) AS count
      FROM settled_bill_ids s
      JOIN bills b ON b.id = s.id AND b.tenant_id = ?
    `).bind(tenantId, startDate, endDate, startDate, endDate, tenantId, tenantId, tenantId),
    db.prepare(`
      /* ipd_as_of_provisional_due */
      WITH active_charge AS (
        SELECT a.id AS admission_id, a.patient_id, COALESCE(SUM(bp.total_amount), 0) AS charges
        FROM admissions a
        JOIN billing_provisional_items bp
          ON bp.admission_id = a.id AND bp.tenant_id = a.tenant_id
        WHERE a.tenant_id = ?
          AND COALESCE(a.status, 'admitted') <> 'cancelled'
          AND ${localReportDate('a.admission_date')} <= date(?)
          AND (a.discharge_date IS NULL OR ${localReportDate('a.discharge_date')} > date(?))
          AND ${localReportDate('bp.created_at')} <= date(?)
          AND (bp.cancelled_at IS NULL OR ${localReportDate('bp.cancelled_at')} > date(?))
          AND NOT EXISTS (
            SELECT 1 FROM bills finalized
            WHERE finalized.tenant_id = bp.tenant_id
              AND finalized.id = bp.billed_bill_id
              AND ${localReportDate('finalized.created_at')} <= date(?)
              AND (
                finalized.status <> 'cancelled'
                OR (
                  finalized.cancelled_at IS NOT NULL
                  AND ${localReportDate('finalized.cancelled_at')} > date(?)
                )
              )
          )
        GROUP BY a.id, a.patient_id
      ), deposit_balance AS (
        SELECT d.patient_id,
          COALESCE(SUM(CASE WHEN d.transaction_type = 'deposit' THEN d.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN d.transaction_type IN ('refund', 'adjustment') THEN d.amount ELSE 0 END), 0) AS balance
        FROM billing_deposits d
        WHERE d.tenant_id = ?
          AND d.is_active = 1
          AND ${localReportDate('d.created_at')} <= date(?)
        GROUP BY d.patient_id
      ), due_by_admission AS (
        SELECT ac.admission_id,
          MAX(0, ac.charges - COALESCE(db.balance, 0)) AS due
        FROM active_charge ac
        LEFT JOIN deposit_balance db ON db.patient_id = ac.patient_id
      )
      SELECT COALESCE(SUM(due), 0) AS total,
        COALESCE(SUM(CASE WHEN due > 10000 THEN 1 ELSE 0 END), 0) AS count
      FROM due_by_admission
    `).bind(tenantId, endDate, endDate, endDate, endDate, endDate, endDate, tenantId, endDate),
    db.prepare(`
      /* ipd_as_of_package_patients */
      SELECT COUNT(*) AS count
      FROM admissions a
      WHERE a.tenant_id = ?
        AND a.package_id IS NOT NULL
        AND COALESCE(a.status, 'admitted') <> 'cancelled'
        AND ${localReportDate('a.admission_date')} <= date(?)
        AND (a.discharge_date IS NULL OR ${localReportDate('a.discharge_date')} > date(?))
    `).bind(tenantId, endDate, endDate),
    db.prepare(`
      /* ipd_period_admissions */
      SELECT COUNT(*) AS count
      FROM admissions a
      WHERE a.tenant_id = ?
        AND COALESCE(a.status, 'admitted') <> 'cancelled'
        AND ${localReportDate('a.admission_date')} >= date(?)
        AND ${localReportDate('a.admission_date')} <= date(?)
    `).bind(tenantId, startDate, endDate),
    db.prepare(`
      /* ipd_period_discharges */
      SELECT COUNT(*) AS count
      FROM admissions a
      WHERE a.tenant_id = ?
        AND a.discharge_date IS NOT NULL
        AND ${localReportDate('a.discharge_date')} >= date(?)
        AND ${localReportDate('a.discharge_date')} <= date(?)
    `).bind(tenantId, startDate, endDate),
    db.prepare(`
      ${ipdActivityCtes()}
      /* ipd_activity_count */
      SELECT COUNT(*) AS count FROM (
        SELECT bill_id, admission_id FROM invoice_activity
        UNION ALL
        SELECT bill_id, admission_id FROM deposit_only_activity
      ) activity_rows
    `).bind(...activityBindings),
    db.prepare(`
      ${ipdActivityCtes()}
      /* ipd_activity_details */
      SELECT * FROM invoice_activity
      UNION ALL
      SELECT * FROM deposit_only_activity
      ORDER BY occurred_at DESC, admission_id DESC, bill_id DESC
      LIMIT ? OFFSET ?
    `).bind(...activityBindings, page.pageSize, page.offset),
  ]);

  const finalBills = firstRow(results[3]);
  const payment = firstRow(results[4]);
  const depositReceived = firstRow(results[5]);
  const depositApplied = firstRow(results[6]);
  const settled = firstRow(results[7]);
  const due = firstRow(results[8]);
  const totalActivityRows = numberValue(firstRow(results[12]).count);

  const activity = ((results[13]?.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    billId: numberValue(row.bill_id),
    invoiceNo: row.invoice_no ? String(row.invoice_no) : null,
    admissionId: numberValue(row.admission_id),
    admissionNo: row.admission_no ? String(row.admission_no) : null,
    patientName: row.patient_name ? String(row.patient_name) : null,
    patientCode: row.patient_code ? String(row.patient_code) : null,
    grossAmount: numberValue(row.gross_amount),
    discountAmount: numberValue(row.discount_amount),
    netAmount: numberValue(row.net_amount),
    paymentAmount: numberValue(row.payment_amount),
    cashAmount: numberValue(row.cash_amount),
    nonCashAmount: numberValue(row.non_cash_amount),
    depositReceivedToday: numberValue(row.deposit_received_today),
    totalReceivedToday: numberValue(row.total_received_today),
    depositApplied: numberValue(row.deposit_applied),
    dueAmount: numberValue(row.due_amount),
    status: row.status ? String(row.status) : null,
    paymentMethod: row.payment_method ? String(row.payment_method) : null,
    serviceNames: row.service_names ? String(row.service_names) : null,
    itemCount: numberValue(row.item_count),
    occurredAt: row.occurred_at ? String(row.occurred_at) : null,
  }));

  return {
    totalInpatients: numberValue(firstRow(results[0]).count),
    pendingBilling: numberValue(firstRow(results[1]).count),
    chargesAddedToday: numberValue(firstRow(results[2]).total),
    grossBilledToday: numberValue(finalBills.gross),
    finalBilledToday: numberValue(finalBills.net),
    finalBillCountToday: numberValue(finalBills.count),
    paymentCollectedToday: numberValue(payment.total),
    paymentReceiptCountToday: numberValue(payment.count),
    cashCollectedToday: numberValue(payment.cash),
    nonCashCollectedToday: numberValue(payment.non_cash),
    depositReceivedToday: numberValue(depositReceived.total),
    depositReceiptCountToday: numberValue(depositReceived.count),
    depositCashReceivedToday: numberValue(depositReceived.cash),
    depositNonCashReceivedToday: numberValue(depositReceived.non_cash),
    totalMoneyReceivedToday: numberValue(payment.total) + numberValue(depositReceived.total),
    totalCashReceivedToday: numberValue(payment.cash) + numberValue(depositReceived.cash),
    totalNonCashReceivedToday: numberValue(payment.non_cash) + numberValue(depositReceived.non_cash),
    depositAppliedToday: numberValue(depositApplied.total),
    discountToday: numberValue(finalBills.discount),
    settledGrossToday: numberValue(settled.gross),
    settledDiscountToday: numberValue(settled.discount),
    settledPaymentAppliedToday: numberValue(settled.payment_applied),
    settledDepositAppliedToday: numberValue(settled.deposit_applied),
    settledToday: numberValue(settled.total),
    settledBillCountToday: numberValue(settled.count),
    currentProvisionalDue: numberValue(due.total),
    highDuePatients: numberValue(due.count),
    packagePatients: numberValue(firstRow(results[9]).count),
    todayAdmissions: numberValue(firstRow(results[10]).count),
    todayDischarges: numberValue(firstRow(results[11]).count),
    activity,
    totalActivityRows,
    page: page.page,
    pageSize: page.pageSize,
    hasNextPage: page.offset + activity.length < totalActivityRows,
  };
}

/** Backward-compatible single-day wrapper used by older callers. */
export async function getIpdDailySnapshot(
  db: D1Database,
  tenantId: string,
  reportDate: string,
): Promise<IpdDailySnapshot> {
  return getIpdPeriodSnapshot(
    db,
    tenantId,
    { startDate: reportDate, endDate: reportDate },
    { page: 1, pageSize: 20, offset: 0 },
  );
}

export interface IpdCollectionBreakdownPage {
  page: number;
  pageSize: number;
  offset: number;
}

export interface IpdCollectionBreakdownRow {
  id: string;
  occurredAt: string;
  sourceType: string;
  sourceLabel: string;
  referenceNo: string | null;
  counterName: string | null;
  userName: string | null;
  amount: number;
  status: string | null;
  paymentMethod: string | null;
  grossAmount: number | null;
  discountAmount: number | null;
  netAmount: number | null;
  paidAmount: number | null;
  dueAmount: number | null;
  billId: number | null;
  invoiceNo: string | null;
  patientName: string | null;
  patientCode: string | null;
  discountReference: string | null;
  discountReason: string | null;
  serviceNames: string | null;
  itemCount: number | null;
  itemName: string | null;
  itemCode: string | null;
  unitName: string | null;
  availableQuantity: number | null;
  reorderLevel: number | null;
  storeName: string | null;
  batchNo: string | null;
  expiryDate: string | null;
  qcStatus: string | null;
  consumedQuantity: number | null;
}

export interface IpdCollectionBreakdown {
  sources: Array<{ label: string; amount: number; count: number; direction?: 'in' | 'out' }>;
  rows: IpdCollectionBreakdownRow[];
  totalRows: number;
  total: number;
}

/** Returns payment-event rows for admission-linked invoices only. */
export async function getIpdCollectionBreakdown(
  db: D1Database,
  tenantId: string,
  startDate: string,
  endDate: string,
  page: IpdCollectionBreakdownPage,
  includeDetails = true,
): Promise<IpdCollectionBreakdown> {
  const results = await db.batch([
    db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) AS total, COUNT(*) AS row_count
      FROM bills b
      JOIN payments p ON p.bill_id = b.id AND p.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND b.admission_id IS NOT NULL
        AND b.status <> 'cancelled'
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} >= date(?)
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} <= date(?)
    `).bind(tenantId, startDate, endDate),
    ...(includeDetails ? [db.prepare(`
      WITH relevant_bills AS (
        SELECT DISTINCT b.tenant_id, b.id
        FROM bills b
        JOIN payments p ON p.bill_id = b.id AND p.tenant_id = b.tenant_id
        WHERE b.tenant_id = ?
          AND b.admission_id IS NOT NULL
          AND b.status <> 'cancelled'
          AND ${localReportDate('COALESCE(p.date, p.created_at)')} >= date(?)
          AND ${localReportDate('COALESCE(p.date, p.created_at)')} <= date(?)
      ), item_summary AS (
        SELECT ii.tenant_id, ii.bill_id,
          COUNT(*) AS item_count,
          GROUP_CONCAT(ii.description, ', ') AS service_names
        FROM invoice_items ii
        JOIN relevant_bills relevant ON relevant.id = ii.bill_id AND relevant.tenant_id = ii.tenant_id
        WHERE COALESCE(ii.status, 'active') <> 'cancelled'
        GROUP BY ii.tenant_id, ii.bill_id
      )
      SELECT
        'ipd-payment-' || p.id AS id,
        COALESCE(p.date, p.created_at) AS occurred_at,
        'ipd_collection' AS source_type,
        'Admission/IPD collection' AS source_label,
        COALESCE(NULLIF(TRIM(p.receipt_no), ''), NULLIF(TRIM(b.invoice_no), ''), 'PAY-' || p.id) AS reference_no,
        NULL AS counter_name,
        NULL AS user_name,
        COALESCE(p.amount, 0) AS amount,
        b.status,
        p.payment_method,
        b.id AS bill_id,
        COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id) AS invoice_no,
        pt.name AS patient_name,
        pt.patient_code,
        b.discount_by_name AS discount_reference,
        b.discount_reason,
        items.service_names,
        COALESCE(items.item_count, 0) AS item_count,
        COALESCE(NULLIF(b.subtotal, 0), b.total + b.discount) AS gross_amount,
        COALESCE(b.discount, 0) AS discount_amount,
        COALESCE(b.total, 0) AS net_amount,
        COALESCE(p.amount, 0) AS paid_amount,
        COALESCE(b.due, 0) AS due_amount
      FROM bills b
      JOIN payments p ON p.bill_id = b.id AND p.tenant_id = b.tenant_id
      LEFT JOIN patients pt ON pt.id = b.patient_id AND pt.tenant_id = b.tenant_id
      LEFT JOIN item_summary items ON items.bill_id = b.id AND items.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND b.admission_id IS NOT NULL
        AND b.status <> 'cancelled'
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} >= date(?)
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} <= date(?)
      ORDER BY COALESCE(p.date, p.created_at) DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, startDate, endDate, tenantId, startDate, endDate, page.pageSize, page.offset)] : []),
  ]);

  const summaryResult = results[0];
  const detailResult = includeDetails ? results[1] : undefined;
  const summary = (summaryResult.results?.[0] ?? {}) as Record<string, unknown>;
  const total = numberValue(summary.total);
  const totalRows = numberValue(summary.row_count);
  const rows = ((detailResult?.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ''),
    occurredAt: String(row.occurred_at ?? ''),
    sourceType: String(row.source_type ?? 'ipd_collection'),
    sourceLabel: String(row.source_label ?? 'Admission/IPD collection'),
    referenceNo: row.reference_no ? String(row.reference_no) : null,
    counterName: row.counter_name ? String(row.counter_name) : null,
    userName: row.user_name ? String(row.user_name) : null,
    amount: numberValue(row.amount),
    status: row.status ? String(row.status) : null,
    paymentMethod: row.payment_method ? String(row.payment_method) : null,
    grossAmount: numberValue(row.gross_amount),
    discountAmount: numberValue(row.discount_amount),
    netAmount: numberValue(row.net_amount),
    paidAmount: numberValue(row.paid_amount),
    dueAmount: numberValue(row.due_amount),
    billId: numberValue(row.bill_id),
    invoiceNo: row.invoice_no ? String(row.invoice_no) : null,
    patientName: row.patient_name ? String(row.patient_name) : null,
    patientCode: row.patient_code ? String(row.patient_code) : null,
    discountReference: row.discount_reference ? String(row.discount_reference) : null,
    discountReason: row.discount_reason ? String(row.discount_reason) : null,
    serviceNames: row.service_names ? String(row.service_names) : null,
    itemCount: numberValue(row.item_count),
    itemName: null,
    itemCode: null,
    unitName: null,
    availableQuantity: null,
    reorderLevel: null,
    storeName: null,
    batchNo: null,
    expiryDate: null,
    qcStatus: null,
    consumedQuantity: null,
  }));

  return {
    sources: totalRows > 0 ? [{ label: 'Admission/IPD collection', amount: total, count: totalRows, direction: 'in' }] : [],
    rows,
    totalRows,
    total,
  };
}
