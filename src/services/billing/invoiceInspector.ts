import {
  buildInvoiceInspectorResponse,
  type InvoiceInspectorAuditEvent,
  type InvoiceInspectorCompensation,
  type InvoiceInspectorDeposit,
  type InvoiceInspectorDiscountAllocation,
  type InvoiceInspectorItem,
  type InvoiceInspectorPayment,
  type InvoiceInspectorResponse,
} from './invoiceInspectorContract';
import {
  commissionReasonLabel,
  resolveCommissionReasonCode,
} from '../dashboard/doctorReportingContract';
import { readInvoiceForConsumer } from '../../lib/canonical/financial-read-consumer-adapters';
import type { FinancialReadDatabase } from '../../lib/canonical/financial-read-provider';

export class InvoiceInspectorNotFoundError extends Error {
  constructor() {
    super('Bill not found');
    this.name = 'InvoiceInspectorNotFoundError';
  }
}

interface InvoiceInspectorSummaryRow {
  bill_id: number | string;
  invoice_no: string | null;
  status: string | null;
  bill_type?: string | null;
  patient_id?: number | string | null;
  patient_name?: string | null;
  patient_code?: string | null;
  created_at?: string | null;
  gross_amount?: number | string | null;
  discount_amount?: number | string | null;
  net_amount?: number | string | null;
  paid_amount?: number | string | null;
  deposit_applied_amount?: number | string | null;
  due_amount?: number | string | null;
  referred_by_type?: string | null;
  referred_by_name?: string | null;
  discount_reason?: string | null;
  discount_reference?: string | null;
}

interface InvoiceInspectorReadOptions {
  db: D1Database;
  tenantId: string;
  billId: number;
  includePatientIdentity: boolean;
  financialReadEvidence?: {
    observedAtUtc: string;
    latencyBudgetMs: number;
    buildSha: string;
    now?: () => number;
  };
}

interface OptionalSectionResult<T> {
  rows: T[];
  warning?: string;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

async function readOptionalRows<T>(
  warning: string,
  query: () => Promise<{ results?: T[] }>,
): Promise<OptionalSectionResult<T>> {
  try {
    const result = await query();
    return { rows: result.results ?? [] };
  } catch {
    return { rows: [], warning };
  }
}

function mapItem(row: Record<string, unknown>): InvoiceInspectorItem {
  return {
    id: (row.id as number | string | undefined) ?? '',
    category: String(row.category ?? 'other'),
    description: String(row.description ?? ''),
    quantity: Number(row.quantity ?? 0),
    rate: Number(row.rate ?? 0),
    lineTotal: Number(row.line_total ?? 0),
    orderingDoctorName: nullableText(row.ordering_doctor_name),
    referringDoctorName: nullableText(row.referring_doctor_name),
    performingDoctorName: nullableText(row.performing_doctor_name),
    verifyingDoctorName: nullableText(row.verifying_doctor_name),
    status: nullableText(row.status),
  };
}

function mapPayment(row: Record<string, unknown>): InvoiceInspectorPayment {
  return {
    id: (row.id as number | string | undefined) ?? '',
    amount: Number(row.amount ?? 0),
    receiptNo: nullableText(row.receipt_no),
    method: nullableText(row.method),
    paymentType: nullableText(row.payment_type),
    collectorName: nullableText(row.collector_name),
    counterName: nullableText(row.counter_name),
    paidAt: nullableText(row.paid_at),
    status: nullableText(row.status),
  };
}

function mapDeposit(row: Record<string, unknown>): InvoiceInspectorDeposit {
  return {
    id: (row.id as number | string | undefined) ?? '',
    amount: Number(row.amount ?? 0),
    adjustmentType: String(row.adjustment_type ?? 'unknown'),
    referenceNo: nullableText(row.reference_no),
    paymentMethod: nullableText(row.payment_method),
    occurredAt: nullableText(row.occurred_at),
    status: nullableText(row.status),
  };
}

function mapDiscount(row: Record<string, unknown>): InvoiceInspectorDiscountAllocation {
  return {
    id: (row.id as number | string | undefined) ?? '',
    amount: Number(row.amount ?? 0),
    referenceName: nullableText(row.reference_name),
    reason: nullableText(row.reason),
    sourceType: nullableText(row.source_type),
    funderType: nullableText(row.funder_type),
    doctorId: nullableNumber(row.doctor_id),
    doctorName: nullableText(row.doctor_name),
    status: nullableText(row.status),
  };
}

function mapCompensation(row: Record<string, unknown>): InvoiceInspectorCompensation {
  const adjustmentAmount = Number(row.adjustment_amount ?? 0);
  const reasonCode = resolveCommissionReasonCode({
    storedReasonCode: row.reason_code,
    ruleId: row.rule_id,
    status: row.status,
    eligibleBaseAmount: row.eligible_base_amount,
    waiverAmount: row.waiver_amount,
    adjustmentAmount,
    payableAmount: row.payable_amount,
  });
  return {
    id: (row.id as number | string | undefined) ?? '',
    doctorId: nullableNumber(row.doctor_id),
    doctorName: nullableText(row.doctor_name),
    sourceType: String(row.source_type ?? 'other'),
    incentiveType: nullableText(row.incentive_type),
    ruleId: (row.rule_id as number | string | null | undefined) ?? null,
    ruleVersion: nullableNumber(row.rule_version),
    grossAmount: Number(row.gross_amount ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    performerReserveAmount: Number(row.performer_reserve_amount ?? 0),
    eligibleBaseAmount: Number(row.eligible_base_amount ?? 0),
    rateLabel: nullableText(row.rate_label),
    earnedAmount: Number(row.earned_amount ?? 0),
    waiverAmount: Number(row.waiver_amount ?? 0),
    adjustmentAmount,
    payableAmount: Number(row.payable_amount ?? 0),
    paidAmount: Number(row.paid_amount ?? 0),
    outstandingAmount: Number(row.outstanding_amount ?? 0),
    status: String(row.status ?? 'unknown'),
    reasonCode,
    reasonLabel: nullableText(row.reason_label) ?? commissionReasonLabel(reasonCode),
    settlementNo: nullableText(row.settlement_no),
  };
}

function mapAudit(row: Record<string, unknown>): InvoiceInspectorAuditEvent {
  return {
    id: (row.id as number | string | undefined) ?? '',
    occurredAt: nullableText(row.occurred_at),
    eventType: nullableText(row.event_type),
    actorName: nullableText(row.actor_name),
    referenceNo: nullableText(row.reference_no),
    status: nullableText(row.status),
    description: nullableText(row.description),
  };
}

export async function readInvoiceInspector({
  db,
  tenantId,
  billId,
  includePatientIdentity,
  financialReadEvidence,
}: InvoiceInspectorReadOptions): Promise<InvoiceInspectorResponse> {
  const now = financialReadEvidence?.now ?? Date.now;
  const legacyReadStartedAt = now();
  const summary = await db.prepare(`
    /* invoice_inspector:summary */
    WITH target AS (SELECT ? AS tenant_id, ? AS bill_id),
    deposit_totals AS (
      SELECT
        COALESCE(SUM(CASE
          WHEN transaction_type = 'adjustment' AND COALESCE(is_active, 1) = 1
            THEN COALESCE(amount, 0)
          ELSE 0
        END), 0) AS deposit_applied_amount
      FROM billing_deposits, target
      WHERE billing_deposits.tenant_id = target.tenant_id
        AND billing_deposits.reference_bill_id = target.bill_id
    )
    SELECT
      b.id AS bill_id,
      COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id) AS invoice_no,
      COALESCE(b.status, 'open') AS status,
      CASE
        WHEN b.admission_id IS NOT NULL THEN 'ipd'
        WHEN b.visit_id IS NOT NULL THEN 'opd'
        ELSE 'general'
      END AS bill_type,
      p.id AS patient_id,
      p.name AS patient_name,
      p.patient_code AS patient_code,
      b.created_at AS created_at,
      ROUND(COALESCE(b.total, 0) + COALESCE(b.discount, 0), 2) AS gross_amount,
      ROUND(COALESCE(b.discount, 0), 2) AS discount_amount,
      ROUND(COALESCE(b.total, 0), 2) AS net_amount,
      ROUND(COALESCE(b.paid, 0), 2) AS paid_amount,
      ROUND(COALESCE(dt.deposit_applied_amount, 0), 2) AS deposit_applied_amount,
      ROUND(CASE
        WHEN b.due IS NOT NULL THEN MAX(0, b.due)
        ELSE MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0) - COALESCE(dt.deposit_applied_amount, 0))
      END, 2) AS due_amount,
      COALESCE(NULLIF(TRIM(b.referred_by_type), ''), 'self') AS referred_by_type,
      COALESCE(NULLIF(TRIM(rd.name), ''), NULLIF(TRIM(rh.name), ''), NULLIF(TRIM(b.referred_by_name), '')) AS referred_by_name,
      NULLIF(TRIM(b.discount_reason), '') AS discount_reason,
      NULLIF(TRIM(b.discount_by_name), '') AS discount_reference
    FROM target
    JOIN bills b ON b.tenant_id = target.tenant_id AND b.id = target.bill_id
    LEFT JOIN patients p ON p.tenant_id = b.tenant_id AND p.id = b.patient_id
    LEFT JOIN doctors rd ON rd.tenant_id = b.tenant_id AND rd.id = b.referring_doctor_id
    LEFT JOIN referral_hospitals rh ON rh.tenant_id = b.tenant_id AND rh.id = b.referred_by_hospital_id
    CROSS JOIN deposit_totals dt
  `).bind(tenantId, billId).first<InvoiceInspectorSummaryRow>();

  if (!summary) throw new InvoiceInspectorNotFoundError();

  const [itemsResult, paymentsResult, depositsResult, discountsResult, compensationResult, auditResult] = await Promise.all([
    readOptionalRows('Invoice item source is unavailable.', () => db.prepare(`
      /* invoice_inspector:items */
      WITH target AS (SELECT ? AS tenant_id, ? AS bill_id),
      performer AS (
        SELECT
          tenant_id,
          lab_order_item_id,
          MAX(CASE WHEN LOWER(COALESCE(incentive_type, '')) = 'performer' THEN doctor_id END) AS doctor_id
        FROM doctor_commission_accruals, target
        WHERE doctor_commission_accruals.tenant_id = target.tenant_id
          AND doctor_commission_accruals.bill_id = target.bill_id
          AND COALESCE(doctor_commission_accruals.status, 'accrued') != 'cancelled'
        GROUP BY tenant_id, lab_order_item_id
      )
      SELECT
        ii.id,
        COALESCE(NULLIF(TRIM(ii.item_category), ''), 'other') AS category,
        COALESCE(NULLIF(TRIM(ii.description), ''), 'Invoice item #' || ii.id) AS description,
        COALESCE(ii.quantity, 1) AS quantity,
        COALESCE(ii.unit_price, 0) AS rate,
        COALESCE(ii.line_total, 0) AS line_total,
        NULLIF(TRIM(od.name), '') AS ordering_doctor_name,
        NULLIF(TRIM(rd.name), '') AS referring_doctor_name,
        NULLIF(TRIM(pd.name), '') AS performing_doctor_name,
        NULLIF(TRIM(vu.name), '') AS verifying_doctor_name,
        COALESCE(NULLIF(TRIM(loi.result_status), ''), NULLIF(TRIM(loi.status), ''), NULLIF(TRIM(ii.status), ''), 'active') AS status
      FROM target
      JOIN invoice_items ii ON ii.tenant_id = target.tenant_id AND ii.bill_id = target.bill_id
      JOIN bills b ON b.tenant_id = ii.tenant_id AND b.id = ii.bill_id
      LEFT JOIN visits v ON v.tenant_id = b.tenant_id AND v.id = b.visit_id
      LEFT JOIN lab_order_items loi ON loi.tenant_id = ii.tenant_id AND loi.id = ii.reference_id AND LOWER(ii.item_category) = 'test'
      LEFT JOIN lab_orders lo ON lo.tenant_id = loi.tenant_id AND lo.id = loi.lab_order_id
      LEFT JOIN doctors od ON od.tenant_id = ii.tenant_id AND od.id = COALESCE(lo.ordering_clinician_doctor_id, v.doctor_id)
      LEFT JOIN doctors rd ON rd.tenant_id = ii.tenant_id AND rd.id = COALESCE(b.referring_doctor_id, v.doctor_id)
      LEFT JOIN performer pf ON pf.tenant_id = ii.tenant_id AND pf.lab_order_item_id = loi.id
      LEFT JOIN doctors pd ON pd.tenant_id = ii.tenant_id AND pd.id = pf.doctor_id
      LEFT JOIN users vu ON vu.tenant_id = ii.tenant_id AND vu.id = loi.verified_by
      ORDER BY ii.id ASC
    `).bind(tenantId, billId).all<Record<string, unknown>>()),
    readOptionalRows('Payment source is unavailable.', () => db.prepare(`
      /* invoice_inspector:payments */
      WITH target AS (SELECT ? AS tenant_id, ? AS bill_id)
      SELECT
        p.id,
        p.receipt_no,
        COALESCE(NULLIF(TRIM(p.payment_method), ''), 'unknown') AS method,
        NULLIF(TRIM(p.payment_type), '') AS payment_type,
        COALESCE(p.amount, 0) AS amount,
        COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(u.name), '')) AS collector_name,
        NULLIF(TRIM(bc.counter_name), '') AS counter_name,
        p.date AS paid_at,
        'posted' AS status
      FROM target
      JOIN payments p ON p.tenant_id = target.tenant_id AND p.bill_id = target.bill_id
      LEFT JOIN staff s ON s.tenant_id = p.tenant_id AND s.id = p.received_by
      LEFT JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.received_by
      LEFT JOIN billing_counters bc ON bc.tenant_id = p.tenant_id AND bc.id = p.counter_id
      ORDER BY p.date DESC, p.id DESC
    `).bind(tenantId, billId).all<Record<string, unknown>>()),
    readOptionalRows('Deposit adjustment source is unavailable.', () => db.prepare(`
      /* invoice_inspector:deposits */
      WITH target AS (SELECT ? AS tenant_id, ? AS bill_id)
      SELECT
        bd.id,
        COALESCE(bd.amount, 0) AS amount,
        CASE
          WHEN LOWER(COALESCE(bd.transaction_type, '')) = 'adjustment' THEN 'applied'
          ELSE LOWER(COALESCE(bd.transaction_type, 'unknown'))
        END AS adjustment_type,
        COALESCE(NULLIF(TRIM(bd.deposit_receipt_no), ''), 'DAD-' || bd.id) AS reference_no,
        NULLIF(TRIM(bd.payment_method), '') AS payment_method,
        bd.created_at AS occurred_at,
        CASE WHEN COALESCE(bd.is_active, 1) = 1 THEN 'active' ELSE 'inactive' END AS status
      FROM target
      JOIN billing_deposits bd
        ON bd.tenant_id = target.tenant_id
       AND bd.reference_bill_id = target.bill_id
      WHERE bd.transaction_type IN ('adjustment', 'refund')
      ORDER BY bd.created_at DESC, bd.id DESC
    `).bind(tenantId, billId).all<Record<string, unknown>>()),
    readOptionalRows('Discount allocation source is unavailable.', () => db.prepare(`
      /* invoice_inspector:discounts */
      WITH target AS (SELECT ? AS tenant_id, ? AS bill_id)
      SELECT
        da.id,
        COALESCE(da.amount, 0) AS amount,
        NULLIF(TRIM(da.reference_name), '') AS reference_name,
        COALESCE(NULLIF(TRIM(da.discount_reason), ''), 'normal_hospital_discount') AS reason,
        COALESCE(NULLIF(TRIM(da.allocation_type), ''), 'unallocated') AS source_type,
        CASE
          WHEN da.doctor_id IS NOT NULL THEN 'doctor'
          WHEN LOWER(COALESCE(da.allocation_type, '')) LIKE '%patient%' THEN 'patient'
          ELSE 'hospital'
        END AS funder_type,
        da.doctor_id,
        NULLIF(TRIM(d.name), '') AS doctor_name,
        COALESCE(NULLIF(TRIM(da.approval_status), ''), 'recorded') AS status
      FROM target
      JOIN bill_discount_allocations da
        ON da.tenant_id = target.tenant_id
       AND da.bill_id = target.bill_id
      LEFT JOIN doctors d ON d.tenant_id = da.tenant_id AND d.id = da.doctor_id
      ORDER BY da.created_at ASC, da.id ASC
    `).bind(tenantId, billId).all<Record<string, unknown>>()),
    readOptionalRows('Doctor compensation source is unavailable.', () => db.prepare(`
      /* invoice_inspector:compensation */
      WITH target AS (SELECT ? AS tenant_id, ? AS bill_id)
      SELECT
        a.id,
        a.doctor_id,
        NULLIF(TRIM(d.name), '') AS doctor_name,
        COALESCE(NULLIF(TRIM(a.source_type), ''), 'other') AS source_type,
        NULLIF(TRIM(a.incentive_type), '') AS incentive_type,
        a.commission_rule_id AS rule_id,
        a.commission_rule_version_snapshot AS rule_version,
        COALESCE(a.gross_amount, 0) AS gross_amount,
        MAX(0, COALESCE(a.gross_amount, 0) - COALESCE(a.commission_base_amount, 0) - COALESCE(a.performer_reserve_amount, 0)) AS discount_amount,
        COALESCE(a.performer_reserve_amount, 0) AS performer_reserve_amount,
        COALESCE(a.commission_base_amount, 0) AS eligible_base_amount,
        CASE
          WHEN COALESCE(a.commission_rate_bps, 0) > 0 THEN printf('%.2f%%', a.commission_rate_bps / 100.0)
          WHEN COALESCE(a.commission_flat_amount, 0) > 0 THEN printf('Flat BDT %.2f', a.commission_flat_amount / 100.0)
          ELSE NULL
        END AS rate_label,
        COALESCE(a.earned_commission_amount, a.commission_amount, 0) AS earned_amount,
        COALESCE(a.doctor_waiver_amount, 0) AS waiver_amount,
        COALESCE(a.payable_commission_amount, a.commission_amount, 0)
          - (COALESCE(a.earned_commission_amount, a.commission_amount, 0) - COALESCE(a.doctor_waiver_amount, 0)) AS adjustment_amount,
        COALESCE(a.payable_commission_amount, a.commission_amount, 0) AS payable_amount,
        COALESCE(a.paid_amount, 0) AS paid_amount,
        COALESCE(a.balance_amount, 0) AS outstanding_amount,
        a.commission_reason_code AS reason_code,
        NULL AS reason_label,
        NULLIF(TRIM(s.reference_no), '') AS settlement_no,
        COALESCE(NULLIF(TRIM(a.status), ''), 'accrued') AS status
      FROM target
      JOIN doctor_commission_accruals a
        ON a.tenant_id = target.tenant_id
       AND a.bill_id = target.bill_id
      LEFT JOIN doctors d ON d.tenant_id = a.tenant_id AND d.id = a.doctor_id
      LEFT JOIN doctor_commission_settlements s ON s.tenant_id = a.tenant_id AND s.id = a.settlement_id
      ORDER BY a.created_at ASC, a.id ASC
    `).bind(tenantId, billId).all<Record<string, unknown>>()),
    readOptionalRows('Audit source is unavailable.', () => db.prepare(`
      /* invoice_inspector:audit */
      WITH target AS (SELECT ? AS tenant_id, ? AS bill_id),
      events AS (
        SELECT
          'audit:' || al.id AS id,
          al.created_at AS occurred_at,
          LOWER(COALESCE(al.action, 'event')) AS event_type,
          NULLIF(TRIM(u.name), '') AS actor_name,
          COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id) AS reference_no,
          COALESCE(NULLIF(TRIM(b.status), ''), 'open') AS status,
          COALESCE(NULLIF(TRIM(al.action), ''), 'Invoice event') AS description
        FROM target
        JOIN bills b ON b.tenant_id = target.tenant_id AND b.id = target.bill_id
        JOIN audit_logs al ON al.tenant_id = b.tenant_id AND al.table_name = 'bills' AND al.record_id = b.id
        LEFT JOIN users u ON u.tenant_id = al.tenant_id AND u.id = al.user_id

        UNION ALL

        SELECT
          'payment:' || p.id,
          p.date,
          'payment',
          COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(u.name), '')),
          COALESCE(NULLIF(TRIM(p.receipt_no), ''), 'PAY-' || p.id),
          'posted',
          'Payment collected'
        FROM target
        JOIN payments p ON p.tenant_id = target.tenant_id AND p.bill_id = target.bill_id
        LEFT JOIN staff s ON s.tenant_id = p.tenant_id AND s.id = p.received_by
        LEFT JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.received_by

        UNION ALL

        SELECT
          'deposit:' || bd.id,
          bd.created_at,
          LOWER(COALESCE(bd.transaction_type, 'deposit_adjustment')),
          NULLIF(TRIM(u.name), ''),
          COALESCE(NULLIF(TRIM(bd.deposit_receipt_no), ''), 'DAD-' || bd.id),
          CASE WHEN COALESCE(bd.is_active, 1) = 1 THEN 'active' ELSE 'inactive' END,
          'Deposit adjustment'
        FROM target
        JOIN billing_deposits bd
          ON bd.tenant_id = target.tenant_id
         AND bd.reference_bill_id = target.bill_id
        LEFT JOIN users u ON u.tenant_id = bd.tenant_id AND u.id = bd.created_by

        UNION ALL

        SELECT
          'bill:' || b.id,
          COALESCE(b.cancelled_at, b.created_at),
          CASE WHEN b.cancelled_at IS NOT NULL THEN 'cancelled' ELSE 'create' END,
          COALESCE(NULLIF(TRIM(cu.name), ''), NULLIF(TRIM(cr.name), '')),
          COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id),
          COALESCE(NULLIF(TRIM(b.status), ''), 'open'),
          CASE WHEN b.cancelled_at IS NOT NULL THEN COALESCE(NULLIF(TRIM(b.cancel_reason), ''), 'Invoice cancelled') ELSE 'Invoice created' END
        FROM target
        JOIN bills b ON b.tenant_id = target.tenant_id AND b.id = target.bill_id
        LEFT JOIN users cu ON cu.tenant_id = b.tenant_id AND cu.id = b.cancelled_by
        LEFT JOIN users cr ON cr.tenant_id = b.tenant_id AND cr.id = b.created_by
      )
      SELECT * FROM events
      ORDER BY occurred_at DESC, id DESC
    `).bind(tenantId, billId).all<Record<string, unknown>>()),
  ]);

  const financialInvoice = financialReadEvidence
    ? await readInvoiceForConsumer(db as unknown as FinancialReadDatabase, {
        tenantId,
        consumerKind: 'billing_detail',
        invoiceNumber: String(summary.invoice_no),
        observedAtUtc: financialReadEvidence.observedAtUtc,
        elapsedMs: Math.max(0, Math.round(now() - legacyReadStartedAt)),
        latencyBudgetMs: financialReadEvidence.latencyBudgetMs,
        buildSha: financialReadEvidence.buildSha,
      })
    : null;

  const warnings = [
    itemsResult.warning,
    paymentsResult.warning,
    depositsResult.warning,
    discountsResult.warning,
    compensationResult.warning,
    auditResult.warning,
  ].filter((warning): warning is string => Boolean(warning));

  const patientIdentityRedacted = !includePatientIdentity && summary.patient_id !== null && summary.patient_id !== undefined;
  const depositAppliedAmount = Number(summary.deposit_applied_amount ?? 0);
  const selectedInvoiceProjection = financialInvoice?.projection ?? null;
  const selectedNetAmount = selectedInvoiceProjection == null
    ? Number(summary.net_amount ?? 0)
    : selectedInvoiceProjection.totalMinor / 100;
  const selectedSettledAmount = selectedInvoiceProjection == null
    ? Number(summary.paid_amount ?? 0) + depositAppliedAmount
    : selectedInvoiceProjection.paidMinor / 100;
  const selectedCashPaidAmount = Math.max(0, selectedSettledAmount - depositAppliedAmount);
  const selectedDueAmount = selectedInvoiceProjection == null
    ? Number(summary.due_amount ?? 0)
    : selectedInvoiceProjection.dueMinor / 100;
  const summaryInput: Record<string, unknown> & { billId: unknown; invoiceNo: unknown; status: unknown } = {
    billId: summary.bill_id,
    invoiceNo: summary.invoice_no,
    status: summary.status,
    billType: summary.bill_type ?? null,
    patientId: includePatientIdentity ? summary.patient_id ?? null : null,
    patientName: includePatientIdentity ? summary.patient_name ?? null : null,
    createdAt: summary.created_at ?? null,
    grossAmount: summary.gross_amount ?? 0,
    discountAmount: summary.discount_amount ?? 0,
    netAmount: selectedNetAmount,
    paidAmount: selectedCashPaidAmount,
    depositAppliedAmount,
    dueAmount: selectedDueAmount,
    patientIdentityRedacted,
    referredByType: summary.referred_by_type ?? null,
    referredByName: summary.referred_by_name ?? null,
    discountReason: summary.discount_reason ?? null,
    discountReference: summary.discount_reference ?? null,
  };
  if (includePatientIdentity) summaryInput.patientCode = summary.patient_code ?? null;

  return buildInvoiceInspectorResponse({
    summary: summaryInput,
    items: itemsResult.rows.map(mapItem),
    payments: paymentsResult.rows.map(mapPayment),
    deposits: depositsResult.rows.map(mapDeposit),
    discounts: discountsResult.rows.map(mapDiscount),
    compensation: compensationResult.rows.map(mapCompensation),
    audit: auditResult.rows.map(mapAudit),
    warnings,
    actions: {
      fullBillingUrl: `/api/billing/${billId}`,
      printUrl: `/api/pdf/bill/${billId}`,
      pdfUrl: `/api/pdf/bill/${billId}`,
    },
  });
}
