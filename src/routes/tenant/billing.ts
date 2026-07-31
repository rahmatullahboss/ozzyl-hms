import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { createBillSchema, paymentSchema, editBillSchema } from '../../schemas/billing';
import { paymentReminderSchema } from '../../schemas/cash-monitoring';
import { getNextSequence } from '../../lib/sequence';
import { getNextBillInvoiceNumber } from '../../lib/invoice-sequence';
import { createAuditLog } from '../../lib/accounting-helpers';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { requirePermission } from '../../middleware/rbac';
import { getTodayGMT6 } from '../../lib/date-utils';
import { getPagination, paginationMeta } from '../../lib/pagination';
import { getDb } from '../../db';
import { bills, invoiceItems, auditLogs } from '../../db/schema';
import { sql, eq, and } from 'drizzle-orm';
import { getDiagnosticBillPaidUpdateSql } from '../../lib/diagnostic-billing';
import { formatDoctorName } from '../../lib/doctor-display';
import { getBillCommissionSummary } from '../../lib/lab-finance';
import { calculateBillCategoryTotals } from '../../lib/billing-category-totals';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { normalizeConsultationFee } from '../../lib/doctor-fees';
import { recordBillFinalizationSideEffects } from '../../lib/billing-finalization';
import { buildBillCreationBatch } from '../../lib/billing-create-batch';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../lib/accounting-posting';
import { calculateBillPaymentState, calculatePaymentGuardOutstanding } from '../../lib/billing-payment-state';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import { getPermissionsForRole, isRoleAllowed } from '../../lib/authz';
import { assertDiscountReferralNameForHighDiscount } from '../../lib/discount-policy';
import {
  allocateBillDepositSources,
  type BillingDepositLedgerRow,
} from '../../lib/billing-deposit-allocation';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { projectLegacyBillPaymentHistory } from '../../lib/canonical/legacy-bill-payment-recovery';
import {
  buildLiveInvoiceProjection,
  buildLivePaymentProjection,
} from '../../lib/canonical/live-financial-projection';
import { buildLegacyLiveInvoiceSourceLineId } from '../../lib/canonical/live-invoice-line-identity';
import { issueInvoice } from '../../lib/canonical/commands/issue-invoice';
import { collectPayment, type PaymentTenderType } from '../../lib/canonical/commands/collect-payment';
import { CanonicalStrictFinancialError } from '../../lib/canonical/strict-financial-policy';
import { annotateInvoiceItemsWithRefunds, summarizeRefundApprovalRequests } from '../../lib/invoice-refund-presentation';
import {
  InvoiceInspectorNotFoundError,
  readInvoiceInspector,
} from '../../services/billing/invoiceInspector';


const billingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const BILLING_DISCOUNT_APPROVAL_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string, message: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error(message, error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function assertBillingDiscountAllowed(c: Context<{ Bindings: Env; Variables: Variables }>, amount: number | null | undefined): void {
  if (Number(amount ?? 0) > 0 && !isRoleAllowed(c.get('role'), BILLING_DISCOUNT_APPROVAL_ROLES)) {
    throw new HTTPException(403, { message: 'Billing discounts require approval from an authorized finance/admin role' });
  }
}

function canReadInvoicePatientIdentity(c: Context<{ Bindings: Env; Variables: Variables }>): boolean {
  const role = c.get('role');
  if (role === 'hospital_admin' || role === 'super_admin') return true;
  const permissions = new Set<string>([
    ...getPermissionsForRole(role),
    ...(c.get('permissions') ?? []),
  ]);
  return permissions.has('*') || permissions.has('patients:read');
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function canonicalPaymentTenderType(paymentMethod: string | null | undefined): PaymentTenderType {
  const normalized = String(paymentMethod ?? 'cash').trim().toLowerCase();
  if (normalized === 'cash') return 'cash';
  if (normalized === 'card') return 'card';
  if (['mobile_wallet', 'mobile banking', 'mobile_banking', 'bkash', 'nagad', 'rocket'].includes(normalized)) {
    return 'mobile_wallet';
  }
  if (['bank', 'bank_transfer', 'bank transfer', 'cheque', 'check'].includes(normalized)) return 'bank_transfer';
  if (['gateway', 'online'].includes(normalized)) return 'gateway';
  return 'other';
}

const patientLedgerCte = `
  WITH patient_bills AS (
    SELECT
      id,
      tenant_id,
      patient_id,
      COALESCE(invoice_no, bill_no, 'BILL-' || id) AS invoice_no,
      created_at,
      COALESCE(NULLIF(total, 0), total_amount, 0) AS total_amount
    FROM bills
    WHERE tenant_id = ? AND patient_id = ?
      AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
  ),
  patient_ledger_source AS (
    SELECT
      created_at AS event_date,
      1 AS sort_order,
      'bill' AS source_type,
      id AS source_id,
      invoice_no AS reference_no,
      'Bill ' || invoice_no AS description,
      total_amount AS debit,
      0 AS credit
    FROM patient_bills
    WHERE COALESCE(total_amount, 0) > 0

    UNION ALL

    SELECT
      COALESCE(p.date, b.created_at) AS event_date,
      2 AS sort_order,
      'payment' AS source_type,
      p.id AS source_id,
      COALESCE(p.receipt_no, 'PAY-' || p.id) AS reference_no,
      'Payment ' || COALESCE(p.receipt_no, 'PAY-' || p.id) AS description,
      0 AS debit,
      COALESCE(p.amount, 0) AS credit
    FROM payments p
    JOIN patient_bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
    WHERE COALESCE(p.amount, 0) > 0

    UNION ALL

    SELECT
      d.created_at AS event_date,
      3 AS sort_order,
      'deposit_adjustment' AS source_type,
      d.id AS source_id,
      COALESCE(d.deposit_receipt_no, 'DAD-' || d.id) AS reference_no,
      'Deposit adjustment ' || COALESCE(d.deposit_receipt_no, 'DAD-' || d.id) AS description,
      0 AS debit,
      COALESCE(d.amount, 0) AS credit
    FROM billing_deposits d
    JOIN patient_bills b ON b.id = d.reference_bill_id AND b.tenant_id = d.tenant_id
    WHERE d.transaction_type = 'adjustment'
      AND d.is_active = 1
      AND COALESCE(d.amount, 0) > 0

    UNION ALL

    SELECT
      cn.created_at AS event_date,
      4 AS sort_order,
      'credit_note' AS source_type,
      cn.id AS source_id,
      COALESCE(cn.credit_note_no, 'CN-' || cn.id) AS reference_no,
      'Credit note ' || COALESCE(cn.credit_note_no, 'CN-' || cn.id) AS description,
      0 AS debit,
      COALESCE(cn.total_amount, 0) AS credit
    FROM billing_credit_notes cn
    JOIN patient_bills b ON b.id = cn.bill_id AND b.tenant_id = cn.tenant_id
    WHERE cn.is_active = 1
      AND COALESCE(cn.total_amount, 0) > 0
  )
`;

type ExistingPaymentRow = {
  id: number;
  bill_id: number;
  receipt_no: string;
  amount: number;
  total: number;
  paid: number;
  due?: number | null;
  status: string;
};

type BillItemInput = typeof createBillSchema._type.items[number];

type ResolvedBillItem = BillItemInput & {
  taxAmount: number;
  taxPercent: number;
};

type ServiceCatalogRow = {
  id: number;
  item_name: string;
  price: number;
  department_name?: string | null;
  tax_applicable?: number | null;
  tax_percent?: number | null;
};

type DoctorFeeRow = {
  id: number;
  name: string;
  consultation_fee: number | null;
};

function inferItemCategoryFromCatalog(
  currentCategory: BillItemInput['itemCategory'],
  catalogItem: ServiceCatalogRow,
): BillItemInput['itemCategory'] {
  if (currentCategory !== 'service' && currentCategory !== 'other') return currentCategory;

  const searchable = `${catalogItem.department_name ?? ''} ${catalogItem.item_name ?? ''}`.toLowerCase();
  if (/(lab|test|pathology|radiology|x-?ray|ultra|usg|ct|mri|cbc|blood|urine)/.test(searchable)) return 'test';
  if (/(doctor|consult|opd|visit|follow)/.test(searchable)) return 'doctor_visit';
  if (/(pharmacy|medicine|drug)/.test(searchable)) return 'medicine';
  if (/(operation|surgery|ot|procedure)/.test(searchable)) return 'operation';
  if (/(admission|bed|ward|cabin|room)/.test(searchable)) return 'admission';

  return currentCategory;
}

async function loadDirectBillingDoctor(
  d1: D1Database,
  tenantId: string,
  doctorId: number,
): Promise<DoctorFeeRow | null> {
  const doctor = await d1.prepare(`
    SELECT id, name, consultation_fee
    FROM doctors
    WHERE tenant_id = ?
      AND id = ?
      AND (is_active = 1 OR is_active IS NULL)
  `).bind(tenantId, doctorId).first<DoctorFeeRow>();

  if (!doctor) return null;
  return {
    ...doctor,
    consultation_fee: normalizeConsultationFee(doctor.consultation_fee),
  };
}

async function resolveBillItemsFromCatalog(
  d1: D1Database,
  tenantId: string,
  items: BillItemInput[],
  priceCategoryId?: number,
  referringDoctorId?: number,
): Promise<ResolvedBillItem[]> {
  const serviceItemIds = [...new Set(items.flatMap((item) => item.serviceItemId ? [item.serviceItemId] : []))];
  const uncataloguedItems = items.filter((item) => !item.serviceItemId);
  const manualNonConsultation = uncataloguedItems.find((item) => item.itemCategory !== 'doctor_visit');
  if (manualNonConsultation) {
    throw new HTTPException(400, {
      message: 'Select a billing service item for every non-consultation bill line.',
    });
  }

  let referringDoctor: DoctorFeeRow | null = null;
  if (uncataloguedItems.length > 0) {
    if (!referringDoctorId) {
      throw new HTTPException(400, { message: 'Select a doctor before adding a consultation fee line.' });
    }
    referringDoctor = await loadDirectBillingDoctor(d1, tenantId, referringDoctorId);
    if (!referringDoctor) throw new HTTPException(400, { message: 'Invalid or inactive referring doctor.' });
    if (Number(referringDoctor.consultation_fee ?? 0) <= 0) {
      throw new HTTPException(400, { message: 'Selected doctor has no consultation fee configured.' });
    }
  }

  if (serviceItemIds.length === 0) {
    return items.map((item) => ({
      ...item,
      itemCategory: 'doctor_visit',
      description: `Consultation - ${formatDoctorName(referringDoctor!.name)}`,
      unitPrice: Number(referringDoctor!.consultation_fee ?? 0),
      referenceId: referringDoctor!.id,
      taxAmount: 0,
      taxPercent: 0,
    }));
  }

  const placeholders = serviceItemIds.map(() => '?').join(',');
  const { results: serviceItems } = await d1.prepare(`
    SELECT
      si.id,
      si.item_name,
      si.price,
      si.tax_applicable,
      si.tax_percent,
      sd.department_name
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON sd.id = si.service_department_id
      AND sd.tenant_id = si.tenant_id
    WHERE si.tenant_id = ?
      AND si.id IN (${placeholders})
      AND COALESCE(si.is_active, 1) = 1
      AND (si.service_department_id IS NULL OR (sd.id IS NOT NULL AND COALESCE(sd.is_active, 1) = 1))
  `).bind(tenantId, ...serviceItemIds).all<ServiceCatalogRow>();

  const catalog = new Map<number, ServiceCatalogRow>(
    serviceItems.map((row) => [Number(row.id), {
      id: Number(row.id),
      item_name: String(row.item_name ?? ''),
      price: Number(row.price ?? 0),
      department_name: row.department_name ?? null,
      tax_applicable: row.tax_applicable ?? null,
      tax_percent: row.tax_percent ?? null,
    }]),
  );

  const missing = serviceItemIds.filter((id) => !catalog.has(id));
  if (missing.length > 0) {
    throw new HTTPException(400, {
      message: `Invalid or inactive billing service item: ${missing.join(', ')}`,
    });
  }

  let categoryPrices = new Map<number, number>();
  if (priceCategoryId) {
    const { results: maps } = await d1.prepare(`
      SELECT service_item_id, price
      FROM billing_item_price_category_maps
      WHERE tenant_id = ?
        AND price_category_id = ?
        AND service_item_id IN (${placeholders})
        AND COALESCE(is_active, 1) = 1
    `).bind(tenantId, priceCategoryId, ...serviceItemIds).all<{ service_item_id: number; price: number }>();

    categoryPrices = new Map<number, number>(
      maps.map((row) => [Number(row.service_item_id), Number(row.price)]),
    );
  }

  return items.map((item) => {
    if (!item.serviceItemId) {
      return {
        ...item,
        itemCategory: 'doctor_visit',
        description: `Consultation - ${formatDoctorName(referringDoctor!.name)}`,
        unitPrice: Number(referringDoctor!.consultation_fee ?? 0),
        referenceId: referringDoctor!.id,
        taxAmount: 0,
        taxPercent: 0,
      };
    }

    const catalogItem = catalog.get(item.serviceItemId)!;
    const unitPrice = categoryPrices.get(item.serviceItemId) ?? catalogItem.price;
    const taxable = Number(catalogItem.tax_applicable ?? 0) === 1;
    const taxPercent = taxable ? Number(catalogItem.tax_percent ?? 0) : 0;

    return {
      ...item,
      itemCategory: inferItemCategoryFromCatalog(item.itemCategory, catalogItem),
      description: catalogItem.item_name || item.description,
      unitPrice,
      referenceId: item.referenceId ?? item.serviceItemId,
      taxAmount: 0,
      taxPercent,
    };
  });
}

async function findExistingPaymentByIdempotency(
  d1: D1Database,
  tenantId: string,
  idempotencyKey: string | null,
  externalTransactionId: string | null,
): Promise<ExistingPaymentRow | null> {
  if (!idempotencyKey && !externalTransactionId) return null;

  return d1.prepare(`
    SELECT p.id, p.bill_id, p.receipt_no, p.amount, b.total, b.paid, b.due, b.status
    FROM payments p
    JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
    WHERE p.tenant_id = ?
      AND (
        (? IS NOT NULL AND p.idempotency_key = ?)
        OR (? IS NOT NULL AND p.external_transaction_id = ?)
      )
    LIMIT 1
  `).bind(
    tenantId,
    idempotencyKey,
    idempotencyKey,
    externalTransactionId,
    externalTransactionId,
  ).first<ExistingPaymentRow>();
}

function paymentReplayResponse(payment: ExistingPaymentRow) {
  const total = Number(payment.total ?? 0);
  const paid = Number(payment.paid ?? 0);
  const outstanding = Number(payment.due ?? (total - paid));

  return {
    message: 'Payment already recorded',
    receiptNo: payment.receipt_no,
    paidAmount: paid,
    outstanding: Math.max(0, outstanding),
    status: payment.status,
    idempotent: true,
  };
}

function assertPaymentReplayMatchesRequest(
  payment: ExistingPaymentRow,
  requestedBillId: number,
  requestedAmount: number,
): void {
  const sameBill = Number(payment.bill_id) === Number(requestedBillId);
  const sameAmount = Math.round(Number(payment.amount) * 100) === Math.round(Number(requestedAmount) * 100);

  if (!sameBill || !sameAmount) {
    throw new HTTPException(409, {
      message: 'Idempotency key already belongs to a different payment request',
    });
  }
}

/**
 * GET /api/billing
 * Retrieves a paginated list of bills for the current tenant.
 * Supports filtering by status, date range (from/to), and a search string (patient name, code, or invoice number).
 *
 * @param {string} [status] - Optional bill status to filter by (e.g., 'open', 'paid').
 * @param {string} [from] - Optional start date (YYYY-MM-DD) for filtering.
 * @param {string} [to] - Optional end date (YYYY-MM-DD) for filtering.
 * @param {string} [search] - Optional search query for patient details or invoice number.
 * @param {string} [page=1] - Pagination: current page number.
 * @param {string} [limit=10] - Pagination: number of records per page.
 * @returns {Object} JSON response containing:
 *   - bills: Array of bill records with basic patient details.
 *   - meta: Pagination metadata.
 *
 * @example
 * // GET /api/billing?status=open&page=1&limit=20
 */
billingRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { status, from, to, search } = c.req.query();
  const { page, limit, offset } = getPagination(c);

  try {
    let whereClause = 'WHERE b.tenant_id = ?';
    const params: (string | number)[] = [tenantId];
    const depositAdjustedExpression = `COALESCE((
      SELECT SUM(bd.amount)
      FROM billing_deposits bd
      WHERE bd.tenant_id = b.tenant_id
        AND bd.reference_bill_id = b.id
        AND bd.transaction_type = 'adjustment'
        AND bd.is_active = 1
    ), 0)`;
    const settledAmountExpression = `(COALESCE(b.paid, 0) + ${depositAdjustedExpression})`;
    const calculatedOutstandingExpression = `MAX(0, COALESCE(b.total, 0) - ${settledAmountExpression})`;
    const outstandingExpression = `MIN(MAX(0, COALESCE(b.due, ${calculatedOutstandingExpression})), ${calculatedOutstandingExpression})`;

    if (status) { whereClause += ' AND b.status = ?'; params.push(status); }
    if (from)   { whereClause += ' AND date(b.created_at) >= ?'; params.push(from); }
    if (to)     { whereClause += ' AND date(b.created_at) <= ?'; params.push(to); }
    if (search) { whereClause += ' AND (p.name LIKE ? OR b.invoice_no LIKE ? OR p.patient_code LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    const statsResult = await db.$client.prepare(
      `SELECT COUNT(*) as total, 
              SUM(${settledAmountExpression}) as totalPaid,
              SUM(b.total) as totalAmount 
       FROM bills b JOIN patients p ON b.patient_id = p.id ${whereClause}`
    ).bind(...params).first<{ total: number; totalPaid: number; totalAmount: number }>();
    
    const total = statsResult?.total ?? 0;
    const summary = {
      totalCount: statsResult?.total ?? 0,
      totalPaid: statsResult?.totalPaid ?? 0,
      totalAmount: statsResult?.totalAmount ?? 0,
    };

    const bills = await db.$client.prepare(
      `SELECT b.*, b.total AS total_amount,
              COALESCE(b.paid, 0) AS cash_paid_amount,
              ${depositAdjustedExpression} AS deposit_adjusted,
              ${settledAmountExpression} AS settled_amount,
              ${settledAmountExpression} AS paid_amount,
              ${outstandingExpression} AS outstanding,
              p.name as patient_name, p.patient_code, p.mobile as patient_mobile
       FROM bills b JOIN patients p ON b.patient_id = p.id
       ${whereClause} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all();

    return c.json({ 
      bills: bills.results, 
      meta: paginationMeta(page, limit, total),
      summary
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch bills' });
  }
});

/**
 * GET /api/billing/due
 * Retrieves a list of outstanding (unpaid or partially paid) bills for the current tenant.
 * Calculates the outstanding amount (`total_amount` - `paid_amount`) for each bill.
 *
 * @returns {Object} JSON response containing:
 *   - bills: Array of outstanding bill records with patient details.
 *
 * @example
 * // GET /api/billing/due
 */
billingRoutes.get('/due', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from, to, date, search, startDate, endDate, patient_id: patientIdSnake, patientId: patientIdCamel } = c.req.query();
  const fromDate = from || startDate || date;
  const toDate = to || endDate || date;
  const patientFilter = patientIdSnake || patientIdCamel;

  if (fromDate && toDate && fromDate > toDate) {
    throw new HTTPException(400, { message: 'from date cannot be after to date' });
  }

  let patientId: number | null = null;
  if (patientFilter) {
    const parsedPatientId = Number(patientFilter);
    if (!Number.isInteger(parsedPatientId) || parsedPatientId <= 0) {
      throw new HTTPException(400, { message: 'Invalid patient ID' });
    }
    patientId = parsedPatientId;
  }

  try {
    const totalAmountExpression = `COALESCE(NULLIF(b.total, 0), b.total_amount, 0)`;
    const depositAdjustedExpression = `COALESCE((
      SELECT SUM(bd.amount)
      FROM billing_deposits bd
      WHERE bd.tenant_id = b.tenant_id
        AND bd.reference_bill_id = b.id
        AND bd.transaction_type = 'adjustment'
        AND bd.is_active = 1
    ), 0)`;
    const settledAmountExpression = `(COALESCE(NULLIF(b.paid, 0), b.paid_amount, 0) + ${depositAdjustedExpression})`;
    const calculatedOutstandingExpression = `MAX(0, ${totalAmountExpression} - ${settledAmountExpression})`;
    const dueAmountExpression = `MIN(MAX(0, COALESCE(b.due, ${calculatedOutstandingExpression})), ${calculatedOutstandingExpression})`;
    const whereParts = [
      'b.tenant_id = ?',
      "COALESCE(b.status, 'open') NOT IN ('paid', 'cancelled', 'refunded', 'draft')",
      `(${dueAmountExpression}) > 0`,
    ];
    const params: (string | number)[] = [tenantId];

    if (fromDate) {
      whereParts.push('date(b.created_at) >= date(?)');
      params.push(fromDate);
    }
    if (toDate) {
      whereParts.push('date(b.created_at) <= date(?)');
      params.push(toDate);
    }
    if (patientId) {
      whereParts.push('b.patient_id = ?');
      params.push(patientId);
    }
    if (search?.trim()) {
      whereParts.push('(b.invoice_no LIKE ? OR p.name LIKE ? OR p.patient_code LIKE ?)');
      const like = `%${search.trim()}%`;
      params.push(like, like, like);
    }

    const result = await db.$client.prepare(`
      SELECT
        b.*,
        ${totalAmountExpression} AS total_amount,
        COALESCE(NULLIF(b.paid, 0), b.paid_amount, 0) AS cash_paid_amount,
        ${depositAdjustedExpression} AS deposit_adjusted,
        ${settledAmountExpression} AS settled_amount,
        ${settledAmountExpression} AS paid_amount,
        p.name as patient_name,
        p.patient_code,
        p.mobile as patient_mobile,
        (${dueAmountExpression}) as outstanding
      FROM bills b
      JOIN patients p ON b.patient_id = p.id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY b.created_at DESC
    `).bind(...params).all();
    const bills = result.results ?? [];
    const totalDue = bills.reduce((sum, bill) => sum + Number((bill as { outstanding?: number }).outstanding ?? 0), 0);
    return c.json({
      bills,
      summary: {
        totalBills: bills.length,
        totalDue: Math.round(totalDue * 100) / 100,
      },
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch dues' });
  }
});

/**
 * GET /api/billing/patient/:patientId/ledger
 * Consolidated patient receivable statement: bills debit the patient, while
 * payments, deposit adjustments, and credit notes credit the patient.
 */
billingRoutes.get('/patient/:patientId/ledger', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  const fromDate = c.req.query('from') || c.req.query('start_date') || null;
  const toDate = c.req.query('to') || c.req.query('end_date') || null;

  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient ID' });
  }

  try {
    const patient = await db.$client.prepare(`
      SELECT id, name, patient_code, mobile
      FROM patients
      WHERE id = ? AND tenant_id = ?
      LIMIT 1
    `).bind(patientId, tenantId).first();
    if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

    const opening = fromDate
      ? await db.$client.prepare(`
        ${patientLedgerCte}
        SELECT COALESCE(SUM(debit - credit), 0) AS opening_balance
        FROM patient_ledger_source
        WHERE date(event_date) < date(?)
      `).bind(tenantId, patientId, fromDate).first<{ opening_balance: number }>()
      : { opening_balance: 0 };

    const whereParts: string[] = [];
    const params: (string | number)[] = [tenantId, patientId];
    if (fromDate) {
      whereParts.push('date(event_date) >= date(?)');
      params.push(fromDate);
    }
    if (toDate) {
      whereParts.push('date(event_date) <= date(?)');
      params.push(toDate);
    }

    const transactionsResult = await db.$client.prepare(`
      ${patientLedgerCte}
      SELECT
        event_date,
        source_type,
        source_id,
        reference_no,
        description,
        debit,
        credit
      FROM patient_ledger_source
      ${whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''}
      ORDER BY event_date ASC, sort_order ASC, source_id ASC
    `).bind(...params).all<{
      event_date: string;
      source_type: string;
      source_id: number;
      reference_no: string | null;
      description: string | null;
      debit: number | null;
      credit: number | null;
    }>();

    let runningBalance = roundMoney(Number(opening?.opening_balance ?? 0));
    let totalDebit = 0;
    let totalCredit = 0;
    const transactions = (transactionsResult.results ?? []).map((row) => {
      const debit = roundMoney(Number(row.debit ?? 0));
      const credit = roundMoney(Number(row.credit ?? 0));
      totalDebit = roundMoney(totalDebit + debit);
      totalCredit = roundMoney(totalCredit + credit);
      runningBalance = roundMoney(runningBalance + debit - credit);
      return {
        date: row.event_date,
        sourceType: row.source_type,
        sourceId: row.source_id,
        referenceNo: row.reference_no,
        description: row.description,
        debit,
        credit,
        balance: runningBalance,
      };
    });

    return c.json({
      patient,
      from: fromDate,
      to: toDate,
      opening: roundMoney(Number(opening?.opening_balance ?? 0)),
      transactions,
      closing: runningBalance,
      summary: {
        totalDebit,
        totalCredit,
        transactionCount: transactions.length,
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch patient ledger' });
  }
});

/**
 * GET /api/billing/patient/:patientId
 * Retrieves all bills associated with a specific patient within the current tenant.
 * Calculates the outstanding amount for each bill.
 *
 * @param {string} patientId - The ID of the patient.
 * @returns {Object} JSON response containing:
 *   - bills: Array of bill records for the specified patient.
 *
 * @example
 * // GET /api/billing/patient/123
 */
billingRoutes.get('/patient/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  const depositAdjustedExpression = `COALESCE((
    SELECT SUM(COALESCE(bd.amount, 0))
    FROM billing_deposits bd
    WHERE bd.tenant_id = b.tenant_id
      AND bd.reference_bill_id = b.id
      AND bd.transaction_type = 'adjustment'
      AND COALESCE(bd.is_active, 1) = 1
  ), 0)`;
  const settledAmountExpression = `(COALESCE(b.paid, 0) + ${depositAdjustedExpression})`;
  const calculatedOutstandingExpression = `MAX(0, COALESCE(b.total, 0) - ${settledAmountExpression})`;
  const outstandingExpression = `MIN(MAX(0, COALESCE(b.due, ${calculatedOutstandingExpression})), ${calculatedOutstandingExpression})`;

  try {
    const bills = await db.$client.prepare(`
      SELECT b.*, b.total AS total_amount,
             COALESCE(b.paid, 0) AS cash_paid_amount,
             ${depositAdjustedExpression} AS deposit_adjusted,
             ${settledAmountExpression} AS settled_amount,
             ${settledAmountExpression} AS paid_amount,
             ${outstandingExpression} AS due,
             ${outstandingExpression} AS outstanding
      FROM bills b
      WHERE b.patient_id = ? AND b.tenant_id = ?
      ORDER BY b.created_at DESC
    `).bind(patientId, tenantId).all();
    const normalizedBills = (bills.results ?? []).map((bill: Record<string, unknown>) => ({
      ...bill,
      due: Number(bill.outstanding ?? bill.due ?? 0),
    }));
    return c.json({ bills: normalizedBills });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch patient bills' });
  }
});

/**
 * GET /api/billing/departments
 * Returns billing service departments that have at least one active service item.
 * Used by AdmissionIPD.tsx to populate the department dropdown.
 */
billingRoutes.get('/departments', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const { results } = await db.$client.prepare(
      `SELECT id, department_name, department_code
       FROM billing_service_departments sd
       WHERE sd.tenant_id = ?
         AND COALESCE(sd.is_active, 1) = 1
         AND EXISTS (
           SELECT 1
           FROM billing_service_items si
           WHERE si.tenant_id = sd.tenant_id
             AND si.service_department_id = sd.id
             AND COALESCE(si.is_active, 1) = 1
         )
       ORDER BY department_name`
    ).bind(tenantId).all();
    return c.json({ departments: results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch billing departments' });
  }
});

/**
 * GET /api/billing/:id/inspector
 * Returns a read-only, tenant-scoped invoice evidence envelope for admin drilldowns.
 */
billingRoutes.get('/:id/inspector', requirePermission('billing:read'), async (c) => {
  const tenantId = requireTenantId(c);
  const billId = Number(c.req.param('id'));
  if (!Number.isInteger(billId) || billId <= 0) {
    throw new HTTPException(400, { message: 'Invalid bill ID' });
  }

  try {
    const response = await readInvoiceInspector({
      db: c.env.DB,
      tenantId,
      billId,
      includePatientIdentity: canReadInvoicePatientIdentity(c),
      financialReadEvidence: {
        observedAtUtc: new Date().toISOString(),
        latencyBudgetMs: 250,
        buildSha: c.env.CF_VERSION_METADATA?.id ?? 'local-development',
      },
    });
    return c.json(response);
  } catch (error) {
    if (error instanceof InvoiceInspectorNotFoundError) {
      throw new HTTPException(404, { message: 'Bill not found' });
    }
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch invoice inspector' });
  }
});

/**
 * GET /api/billing/:id
 * Retrieves a single bill by its ID, along with its associated line items and payment records.
 *
 * @param {string} id - The ID of the bill to fetch.
 * @returns {Object} JSON response containing:
 *   - bill: The main bill record with patient details.
 *   - items: Array of `invoice_items` associated with the bill.
 *   - payments: Array of `payments` associated with the bill.
 * @throws {HTTPException} 404 if the bill is not found.
 *
 * @example
 * // GET /api/billing/456
 */
billingRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const depositAdjustedExpression = `COALESCE((
    SELECT SUM(COALESCE(bd.amount, 0))
    FROM billing_deposits bd
    WHERE bd.tenant_id = b.tenant_id
      AND bd.reference_bill_id = b.id
      AND bd.transaction_type = 'adjustment'
      AND COALESCE(bd.is_active, 1) = 1
  ), 0)`;
  const settledAmountExpression = `(COALESCE(b.paid, 0) + ${depositAdjustedExpression})`;
  const calculatedOutstandingExpression = `MAX(0, COALESCE(b.total, 0) - ${settledAmountExpression})`;
  const outstandingExpression = `MIN(MAX(0, COALESCE(b.due, ${calculatedOutstandingExpression})), ${calculatedOutstandingExpression})`;

  try {
    const bill = await db.$client.prepare(`
      SELECT b.*, b.total AS total_amount,
             COALESCE(b.total, 0) + COALESCE(b.discount, 0) AS subtotal,
             COALESCE(b.total, 0) + COALESCE(b.discount, 0) AS gross_amount,
             COALESCE(b.paid, 0) AS cash_paid_amount,
             ${depositAdjustedExpression} AS deposit_adjusted,
             ${settledAmountExpression} AS settled_amount,
             ${settledAmountExpression} AS paid_amount,
             ${outstandingExpression} AS due,
             ${outstandingExpression} AS outstanding,
             p.name as patient_name, p.patient_code, p.mobile, p.address, p.age, p.gender,
             u.name as approved_by_name,
             rh.name AS referred_by_hospital_name,
             d.name AS referred_by_doctor_name,
             a.token_no AS visit_serial,
             a.appt_no,
             a.appt_date,
             a.appt_time,
             a.appointment_type,
             ad.name AS appointment_doctor_name,
             ad.specialty AS appointment_doctor_specialty,
             ad.department AS appointment_doctor_department
      FROM bills b JOIN patients p ON b.patient_id = p.id
      LEFT JOIN users u ON b.approved_by = u.id
      LEFT JOIN referral_hospitals rh ON rh.id = b.referred_by_hospital_id AND rh.tenant_id = b.tenant_id
      LEFT JOIN doctors d ON d.id = b.referring_doctor_id AND d.tenant_id = b.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN (
        SELECT tenant_id, billed_bill_id, MAX(appointment_id) AS appointment_id
        FROM billing_provisional_items
        WHERE billed_bill_id IS NOT NULL
          AND appointment_id IS NOT NULL
        GROUP BY tenant_id, billed_bill_id
      ) bpa ON bpa.billed_bill_id = b.id AND bpa.tenant_id = b.tenant_id
      LEFT JOIN appointments a
        ON a.id = COALESCE(v.appointment_id, bpa.appointment_id)
       AND a.tenant_id = b.tenant_id
      LEFT JOIN doctors ad
        ON ad.id = COALESCE(a.doctor_id, v.doctor_id)
       AND ad.tenant_id = b.tenant_id
      WHERE b.id = ? AND b.tenant_id = ?
    `).bind(id, tenantId).first<Record<string, unknown>>();
    if (!bill) throw new HTTPException(404, { message: 'Bill not found' });
    const billWithAmounts = {
      ...bill,
      due: Number(bill.outstanding ?? bill.due ?? 0),
    };

    const visitSerial = bill.visit_serial ?? null;
    const referredBy = {
      type: (bill.referred_by_type as string | null) ?? 'self',
      name: (bill.referred_by_name as string | null) ?? null,
      hospitalId: (bill.referred_by_hospital_id as number | null) ?? null,
      hospitalName: (bill.referred_by_hospital_name as string | null) ?? null,
      doctorId: (bill.referring_doctor_id as number | null) ?? null,
      doctorName: (bill.referred_by_doctor_name as string | null) ?? null,
    };
    const appointment = bill.appt_no || bill.appointment_doctor_name
      ? {
          number: (bill.appt_no as string | null) ?? null,
          date: (bill.appt_date as string | null) ?? null,
          time: (bill.appt_time as string | null) ?? null,
          doctorName: (bill.appointment_doctor_name as string | null) ?? null,
          appointmentType: (bill.appointment_type as string | null) ?? null,
          specialty: (bill.appointment_doctor_specialty as string | null) ?? null,
          department: (bill.appointment_doctor_department as string | null) ?? null,
        }
      : null;

    const items = await db.$client.prepare(
      'SELECT * FROM invoice_items WHERE bill_id = ? AND tenant_id = ?',
    ).bind(id, tenantId).all<Record<string, unknown>>();
    const refundCreditRows = await db.$client.prepare(`
      SELECT
        cni.invoice_item_id,
        COALESCE(SUM(cni.return_quantity), 0) AS refunded_quantity,
        COALESCE(SUM(cni.total_amount), 0) AS refunded_amount,
        GROUP_CONCAT(DISTINCT cn.credit_note_no) AS credit_note_nos
      FROM billing_credit_note_items cni
      JOIN billing_credit_notes cn
        ON cn.id = cni.credit_note_id
       AND cn.tenant_id = cni.tenant_id
      WHERE cn.tenant_id = ?
        AND cn.bill_id = ?
        AND COALESCE(cn.is_active, 1) = 1
        AND LOWER(COALESCE(cn.status, '')) IN ('approved', 'ready_for_payout', 'paid', 'completed', 'refunded')
      GROUP BY cni.invoice_item_id
    `).bind(tenantId, id).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
    const refundRequestRows = await db.$client.prepare(`
      SELECT id, entity_id, entity_no, status, execution_status, request_data, created_at
      FROM approval_requests
      WHERE tenant_id = ?
        AND type = 'refund'
        AND entity_id = ?
      ORDER BY id DESC
      LIMIT 20
    `).bind(tenantId, id).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
    const refundRequests = summarizeRefundApprovalRequests(refundRequestRows.results ?? []);
    const annotatedItems = annotateInvoiceItemsWithRefunds(
      items.results ?? [],
      refundCreditRows.results ?? [],
      refundRequests,
    );

    const payments = await db.$client.prepare(`
      SELECT p.*, s.name AS received_by_name
      FROM payments p
      LEFT JOIN staff s ON p.received_by = s.id
      WHERE p.bill_id = ? AND p.tenant_id = ?
    `).bind(id, tenantId).all();

    const reagentInventoryAlerts = await db.$client.prepare(`
      SELECT
        e.id,
        e.lab_order_item_id,
        e.lab_test_id,
        e.severity,
        e.reason,
        e.message,
        e.status,
        e.created_at,
        COALESCE(ii.description, 'Lab item #' || e.lab_order_item_id) AS item_description
      FROM lab_inventory_exceptions e
      JOIN invoice_items ii
        ON ii.tenant_id = e.tenant_id
       AND ii.item_category = 'test'
       AND ii.reference_id = e.lab_order_item_id
       AND ii.bill_id = ?
      WHERE e.tenant_id = ?
        AND COALESCE(e.status, 'open') = 'open'
      ORDER BY e.created_at DESC, e.id DESC
    `).bind(id, tenantId).all();

    const depositAdjustments = await db.$client.prepare(`
      SELECT
        id,
        deposit_receipt_no,
        amount,
        transaction_type,
        payment_method,
        remarks,
        created_at
      FROM billing_deposits
      WHERE reference_bill_id = ?
        AND tenant_id = ?
        AND transaction_type = 'adjustment'
        AND is_active = 1
      ORDER BY created_at DESC
    `).bind(id, tenantId).all();

    const depositLedgerRows = depositAdjustments.results.length > 0
      ? await db.$client.prepare(`
          SELECT
            id,
            amount,
            transaction_type,
            deposit_receipt_no,
            payment_method,
            reference_bill_id,
            created_at
          FROM billing_deposits
          WHERE tenant_id = ?
            AND patient_id = ?
            AND COALESCE(is_active, 1) = 1
            AND transaction_type IN ('deposit', 'adjustment', 'refund')
          ORDER BY created_at ASC, id ASC
        `).bind(tenantId, bill.patient_id).all<BillingDepositLedgerRow>()
      : { results: [] as BillingDepositLedgerRow[] };
    const depositAllocations = allocateBillDepositSources(depositLedgerRows.results, id);

    const admission = await db.$client.prepare(`
      WITH bill_admission AS (
        SELECT admission_id
        FROM billing_provisional_items
        WHERE tenant_id = ? AND billed_bill_id = ? AND admission_id IS NOT NULL
        UNION
        SELECT admission_id
        FROM patient_bed_infos
        WHERE tenant_id = ? AND billed_bill_id = ? AND admission_id IS NOT NULL
      )
      SELECT
        a.id,
        a.admission_no,
        a.admission_date,
        a.discharge_date,
        a.status,
        a.admission_type,
        bed.ward_name,
        bed.bed_number,
        bed.bed_type,
        doc.name AS consultant_name,
        COALESCE(a.final_diagnosis, a.provisional_diagnosis) AS diagnosis,
        a.final_diagnosis,
        a.provisional_diagnosis
      FROM bill_admission ba
      JOIN admissions a ON a.id = ba.admission_id AND a.tenant_id = ?
      LEFT JOIN beds bed ON bed.id = a.bed_id AND bed.tenant_id = a.tenant_id
      LEFT JOIN doctors doc ON doc.id = a.doctor_id AND doc.tenant_id = a.tenant_id
      ORDER BY a.id DESC
      LIMIT 1
    `).bind(tenantId, id, tenantId, id, tenantId).first();

    return c.json({
      bill: billWithAmounts,
      items: annotatedItems,
      refund_requests: refundRequests,
      payments: payments.results,
      deposit_adjustments: depositAdjustments.results,
      deposit_allocations: depositAllocations,
      reagent_inventory_alerts: reagentInventoryAlerts.results,
      visitSerial,
      referredBy,
      appointment,
      admission: admission ?? null,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch bill' });
  }
});

/**
 * POST /api/billing
 * Creates a new itemized bill. This process performs an atomic batch operation
 * to insert the main bill record, all invoice items, and a corresponding income record.
 * Generates a unique invoice number and logs an audit event on success.
 *
 * @param {Object} body - Validated bill data (items, discount, patientId, visitId).
 * @returns {Object} JSON response containing:
 *   - message: Success message.
 *   - billId: The ID of the newly created bill.
 *   - invoiceNo: The unique invoice number (e.g., INV-000001).
 *   - total: The calculated total amount after discount.
 * @throws {HTTPException} 500 if the bill creation fails.
 *
 * @example
 * // POST /api/billing
 * // Body: { "patientId": 1, "items": [...], "discount": 10 }
 */
billingRoutes.post('/', zValidator('json', createBillSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  assertBillingDiscountAllowed(c, data.discount);
  const idempotencyKey = (c.req.header('Idempotency-Key') ?? data.idempotencyKey ?? '').toString().trim() || null;

  try {
    const activeSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
      workstationId: getBillingWorkstationId(c),
      requireCurrentWorkstation: true,
    });
    if (!activeSession) {
      throw new HTTPException(409, { message: 'Activate a billing counter before creating bills.' });
    }

    // P0-20: explicit tenant ownership check on the patient. Return 404 on
    // mismatch so we never leak the existence of cross-tenant rows.
    const patientRow = await db.$client.prepare(
      'SELECT id FROM patients WHERE id = ? AND tenant_id = ? LIMIT 1'
    ).bind(data.patientId, tenantId).first<{ id: number }>();
    if (!patientRow) {
      throw new HTTPException(404, { message: 'Patient not found in this tenant' });
    }

    // P0-20: validate that the visit (if supplied) belongs to this tenant
    // and patient before we let it cascade into the bill.
    if (data.visitId) {
      const visitRow = await db.$client.prepare(
        'SELECT id FROM visits WHERE id = ? AND patient_id = ? AND tenant_id = ? LIMIT 1'
      ).bind(data.visitId, data.patientId, tenantId).first<{ id: number }>();
      if (!visitRow) {
        throw new HTTPException(404, { message: 'Visit not found for this patient/tenant' });
      }
    }

    // P0-20: explicit referring-doctor ownership check. We do this
    // BEFORE resolving the catalog so we never silently fall back to a
    // cross-tenant doctor id.
    const referringDoctorId = data.referringDoctorId;
    if (referringDoctorId) {
      const docRow = await db.$client.prepare(
        `SELECT id FROM doctors WHERE id = ? AND tenant_id = ?
           AND (is_active = 1 OR is_active IS NULL) LIMIT 1`
      ).bind(referringDoctorId, tenantId).first<{ id: number }>();
      if (!docRow) {
        throw new HTTPException(404, { message: 'Referring doctor not found in this tenant' });
      }
    }

    // Idempotency: if a key was supplied, look it up first. We DO NOT
    // perform any side effects until the transaction starts.
    if (idempotencyKey) {
      const existing = await c.env.DB.prepare(
        'SELECT response_json, status FROM bills_idempotency_keys WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1'
      ).bind(tenantId, idempotencyKey).first<{ response_json: string | null; status: string }>();
      if (existing?.status === 'completed' && existing.response_json) {
        return c.json({ ...JSON.parse(existing.response_json), idempotent: true }, 201);
      }
      if (existing?.status === 'pending') {
        throw new HTTPException(409, { message: 'A previous request with this Idempotency-Key is still being processed.' });
      }
    }

    const items = await resolveBillItemsFromCatalog(
      c.env.DB,
      tenantId,
      data.items,
      data.priceCategoryId,
      referringDoctorId,
    );
    const today = getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Bill creation');

    // Calculate the subtotal by summing the line totals (quantity * unit price) of all items
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const discount = data.discount;
    if (discount > subtotal) {
      throw new HTTPException(400, { message: 'Discount cannot exceed subtotal' });
    }

    assertDiscountReferralNameForHighDiscount(subtotal, discount, data.discountByName);

    // Distribute bill-level discount proportionally across items for tax calculation
    const discountRatio = subtotal > 0 ? discount / subtotal : 0;
    const resolvedItems = items.map((item) => {
      const gross = item.quantity * item.unitPrice;
      const itemDiscount = Math.round(gross * discountRatio);
      const taxAmount = (item.taxPercent ?? 0) > 0
        ? Math.round(((gross - itemDiscount) * (item.taxPercent ?? 0)) / 100)
        : 0;
      const lineTotal = Math.max(0, gross - itemDiscount + taxAmount);
      return { ...item, gross, itemDiscount, taxAmount, lineTotal };
    });

    const totalDistributed = resolvedItems.reduce((sum, item) => sum + item.itemDiscount, 0);
    const roundingRemainder = discount - totalDistributed;
    if (resolvedItems.length > 0 && roundingRemainder !== 0) {
      const last = resolvedItems[resolvedItems.length - 1];
      last.itemDiscount += roundingRemainder;
      // Recompute tax and lineTotal after discount adjustment
      last.taxAmount = (last.taxPercent ?? 0) > 0
        ? Math.round(((last.gross - last.itemDiscount) * (last.taxPercent ?? 0)) / 100)
        : 0;
      last.lineTotal = Math.max(0, last.gross - last.itemDiscount + last.taxAmount);
    }

    const taxTotal = resolvedItems.reduce((s, i) => s + i.taxAmount, 0);
    const categoryTotals = calculateBillCategoryTotals(
      resolvedItems.map((item) => ({ category: item.itemCategory, amount: item.lineTotal })),
    );

    // Ensure the total amount never falls below zero, even with large discounts
    const total = resolvedItems.reduce((s, i) => s + i.lineTotal, 0);

    const invoiceNo = await getNextBillInvoiceNumber(c.env.DB, tenantId!, categoryTotals);

    // Reserve idempotency key outside the transaction so retries that
    // race the same key can detect the in-flight request.
    if (idempotencyKey) {
      try {
        await c.env.DB.prepare(
          'INSERT INTO bills_idempotency_keys (tenant_id, idempotency_key, status, created_by) VALUES (?, ?, ?, ?)'
        ).bind(tenantId, idempotencyKey, 'pending', String(userId)).run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE|PRIMARY KEY/i.test(msg)) {
          // Another request reserved this key first.
          throw new HTTPException(409, { message: 'Idempotency-Key already in use' });
        }
        throw err;
      }
    }

    // P0-20: header, invoice items, and optional visit-service ledger rows
    // must commit atomically. Cloudflare D1 rejects explicit BEGIN/COMMIT
    // statements from Drizzle transactions, so use D1's native transactional
    // batch API instead.
    const issuedAtUtc = new Date().toISOString();
    const creationBatch = buildBillCreationBatch(c.env.DB, {
      tenantId,
      userId: String(userId),
      patientId: data.patientId,
      visitId: data.visitId ?? null,
      invoiceNo,
      referringDoctorId: referringDoctorId ?? null,
      categoryTotals,
      discount,
      discountReason: data.discountReason ?? null,
      discountByName: data.discountByName?.trim() || null,
      total,
      taxTotal: taxTotal ?? 0,
      counterId: Number(activeSession.counter_id),
      counterSessionId: Number(activeSession.id),
      businessDate: today,
      occurredAtUtc: issuedAtUtc,
      commandIdempotencyKey: idempotencyKey
        ? `billing-create:${idempotencyKey}`
        : `billing-create:${invoiceNo}`,
      items: resolvedItems.map((item, index) => ({
        itemCategory: item.itemCategory,
        description: item.description ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        taxAmount: item.taxAmount ?? 0,
        referenceId: item.referenceId ?? item.serviceItemId ?? null,
        serviceItemId: item.serviceItemId ?? null,
        canonicalSourceKey: data.visitId
          ? `bill-service:${invoiceNo}:${index + 1}`
          : null,
      })),
    });
    const execution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'billing.create',
      legacyStatements: creationBatch,
      canonical: async (options) => issueInvoice(c.env.DB, await buildLiveInvoiceProjection({
        tenantId: String(tenantId),
        patientId: data.patientId,
        invoiceNo,
        currencyCode: 'BDT',
        issuedAtUtc,
        items: resolvedItems.map((item, index) => ({
          sourceLineId: buildLegacyLiveInvoiceSourceLineId({
            lineNumber: index + 1,
            itemCategory: item.itemCategory,
            referenceId: item.referenceId ?? item.serviceItemId ?? null,
          }),
          lineType: 'other_adjustment' as const,
          adjustmentCode: `LEGACY_${String(item.itemCategory).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
          quantity: 1,
          unitAmount: item.gross,
        })),
        discount,
        taxTotal,
      }), options),
    });
    const legacyBatchBill = execution.mode === 'legacy'
      ? execution.result[0] as {
        results?: Array<{ id?: number | string }>;
        meta?: { last_row_id?: number | string };
      } | undefined
      : undefined;
    const batchBillId = Number(
      legacyBatchBill?.results?.[0]?.id ?? legacyBatchBill?.meta?.last_row_id ?? 0,
    );
    const committedBill = batchBillId > 0
      ? null
      : await c.env.DB.prepare(
        'SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? ORDER BY id DESC LIMIT 1',
      ).bind(tenantId, invoiceNo).first<{ id: number }>();
    const billId = batchBillId > 0 ? batchBillId : Number(committedBill?.id ?? 0);
    if (!Number.isInteger(billId) || billId <= 0) {
      throw new Error('D1 bill batch did not return a valid bill ID');
    }

    await recordBillFinalizationSideEffects(c.env.DB, {
      tenantId,
      userId,
      patientId: data.patientId,
      visitId: data.visitId ?? null,
      billId,
      invoiceNo,
      referringDoctorId: referringDoctorId ?? null,
      billDate: today,
      accruedAtUtc: issuedAtUtc,
      subtotal,
      discount,
      total,
      categoryTotals,
      counterId: Number(activeSession.counter_id),
      counterSessionId: Number(activeSession.id),
      items: resolvedItems.map((item, index) => ({
        itemCategory: item.itemCategory,
        description: item.description ?? null,
        lineTotal: item.lineTotal,
        grossLineTotal: item.gross,
        taxAmount: item.taxAmount,
        canonicalSourceLineId: buildLegacyLiveInvoiceSourceLineId({
          lineNumber: index + 1,
          itemCategory: item.itemCategory,
          referenceId: item.referenceId ?? item.serviceItemId ?? null,
        }),
        referenceId: item.referenceId ?? item.serviceItemId ?? null,
      })),
    });

    queueAccountingPosting(c, tenantId, 'Failed to post bill accounting events:');

    void createAuditLog(c.env, tenantId!, userId!, 'CREATE', 'bills', billId, null, { patientId: data.patientId, invoiceNo, total });

    const responseBody = { message: 'Bill created', billId, invoiceNo, total, taxTotal };
    if (idempotencyKey) {
      await c.env.DB.prepare(
        `UPDATE bills_idempotency_keys SET status = 'completed', response_json = ?, updated_at = datetime('now', '+6 hours')
         WHERE tenant_id = ? AND idempotency_key = ?`
      ).bind(JSON.stringify(responseBody), tenantId, idempotencyKey).run();
    }

    return c.json(responseBody, 201);
  } catch (error) {
    if (error instanceof HTTPException || error instanceof CanonicalStrictFinancialError) throw error;
    console.error('[billing.create] unexpected failure', error);
    throw new HTTPException(500, { message: 'Failed to create bill' });
  }
});


/**
 * POST /api/billing/pay
 * Collects a payment for an existing bill.
 * Validates that the bill is not already fully paid and that the payment amount
 * does not exceed the outstanding balance. Updates the bill's paid amount and status,
 * inserts a payment record, and logs an audit event.
 *
 * @param {Object} body - Validated payment data (billId, amount, paymentMethod, type).
 * @returns {Object} JSON response containing:
 *   - message: Success message.
 *   - receiptNo: The generated receipt number.
 *   - paidAmount: The new total amount paid.
 *   - outstanding: The remaining balance.
 *   - status: The new status of the bill ('paid' or 'partially_paid').
 * @throws {HTTPException} 404 if the bill is not found.
 * @throws {HTTPException} 400 if the bill is fully paid or payment exceeds balance.
 *
 * @example
 * // POST /api/billing/pay
 * // Body: { "billId": 123, "amount": 500, "paymentMethod": "cash" }
 */
billingRoutes.post('/pay', zValidator('json', paymentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const idempotencyKey = data.idempotencyKey?.trim() || null;
  const externalTransactionId = data.externalTransactionId?.trim() || null;

  try {
    const existingPayment = await findExistingPaymentByIdempotency(
      c.env.DB,
      tenantId,
      idempotencyKey,
      externalTransactionId,
    );
    if (existingPayment) {
      assertPaymentReplayMatchesRequest(existingPayment, data.billId, data.amount);
      return c.json(paymentReplayResponse(existingPayment));
    }

    const activeSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
      workstationId: getBillingWorkstationId(c),
      requireCurrentWorkstation: true,
    });
    if (!activeSession) {
      throw new HTTPException(409, { message: 'Activate a billing counter before collecting payments.' });
    }
    const today = getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Payment collection');

    const bill = await db.$client.prepare(
      'SELECT id, patient_id, invoice_no, paid, due, total, discount, status, test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill FROM bills WHERE id = ? AND tenant_id = ?',
    ).bind(data.billId, tenantId).first<Record<string, unknown>>() as any;
    if (!bill) throw new HTTPException(404, { message: 'Bill not found' });
    if (bill.status === 'paid') throw new HTTPException(400, { message: 'Bill is already fully paid' });
    if (bill.status === 'cancelled') throw new HTTPException(400, { message: 'Cannot pay a cancelled bill' });
    if (bill.status === 'refunded') throw new HTTPException(400, { message: 'Cannot pay a refunded bill' });
    const hasStoredDue = Number.isFinite(Number(bill.due));
    const snapshotOutstanding = calculatePaymentGuardOutstanding({
      total: hasStoredDue ? Number(bill.due) : Number(bill.total ?? 0),
      paidAmount: hasStoredDue ? 0 : Number(bill.paid ?? 0),
    });
    if (data.amount > snapshotOutstanding) {
      throw new HTTPException(409, {
        message: `Payment amount (${data.amount}) exceeds outstanding balance (${snapshotOutstanding}).`,
      });
    }

    const receiptNo = await getNextSequence(c.env.DB, tenantId, 'receipt', 'RCP');
    const commSummary = await getBillCommissionSummary(c.env.DB, tenantId, data.billId);
    const paidRatio = data.amount / (Number(bill.total) || 1);

    const categories = [
      { key: 'test_bill', source: 'laboratory', commTypes: ['lab_test', 'referral'] },
      { key: 'doctor_visit_bill', source: 'doctor_visit', commTypes: ['consultation_fee'] },
      { key: 'admission_bill', source: 'admission', commTypes: [] },
      { key: 'operation_bill', source: 'operation', commTypes: [] },
      { key: 'medicine_bill', source: 'pharmacy', commTypes: [] },
    ];

    const incomeRows: Array<{ source: string; amount: number; description: string }> = [];
    let allocatedAmount = 0;
    for (const cat of categories) {
      const gross = Number(bill[cat.key] || 0) * paidRatio;
      if (gross <= 0) continue;
      const commission = cat.commTypes.reduce(
        (sum, type) => sum + Number(commSummary.byCategory[type] || 0) * paidRatio,
        0,
      );
      const netIncome = Math.round(gross - commission);
      allocatedAmount += gross;
      if (netIncome > 0) {
        incomeRows.push({
          source: cat.source,
          amount: netIncome,
          description: `Payment ${receiptNo} (${cat.source})`,
        });
      }
    }
    const remainingGross = data.amount - allocatedAmount;
    if (remainingGross > 1) {
      incomeRows.push({ source: 'other', amount: Math.round(remainingGross), description: `Payment ${receiptNo} (Other)` });
    }

    const paymentExistsSql = `EXISTS (
      SELECT 1 FROM payments
      WHERE tenant_id = ? AND bill_id = ? AND receipt_no = ?
    )`;
    const paymentBatch: D1PreparedStatement[] = [
      c.env.DB.prepare(`
        INSERT INTO payments (
          bill_id, amount, payment_type, receipt_no, payment_method, received_by,
          tenant_id, date, idempotency_key, external_transaction_id, counter_id, counter_session_id
        )
        SELECT b.id, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), ?, ?, ?, ?
        FROM bills b
        WHERE b.id = ? AND b.tenant_id = ?
          AND COALESCE(b.status, 'open') NOT IN ('paid', 'cancelled', 'refunded')
          AND ROUND((
            COALESCE(b.total, 0) - COALESCE(b.paid, 0) - COALESCE((
              SELECT SUM(bd.amount)
              FROM billing_deposits bd
              WHERE bd.tenant_id = b.tenant_id
                AND bd.reference_bill_id = b.id
                AND bd.transaction_type = 'adjustment'
                AND COALESCE(bd.is_active, 1) = 1
            ), 0)
          ), 2) >= ?
      `).bind(
        data.amount,
        data.type,
        receiptNo,
        data.paymentMethod ?? null,
        userId,
        tenantId,
        idempotencyKey,
        externalTransactionId,
        Number(activeSession.counter_id),
        Number(activeSession.id),
        data.billId,
        tenantId,
        data.amount,
      ),
      c.env.DB.prepare(`
        UPDATE bills
        SET paid = COALESCE(paid, 0) + ?,
            due = MAX(0, ROUND(COALESCE(total, 0) - (COALESCE(paid, 0) + ?) - COALESCE((
              SELECT SUM(bd.amount)
              FROM billing_deposits bd
              WHERE bd.tenant_id = bills.tenant_id
                AND bd.reference_bill_id = bills.id
                AND bd.transaction_type = 'adjustment'
                AND COALESCE(bd.is_active, 1) = 1
            ), 0), 2)),
            status = CASE
              WHEN ROUND(COALESCE(total, 0) - (COALESCE(paid, 0) + ?) - COALESCE((
                SELECT SUM(bd.amount)
                FROM billing_deposits bd
                WHERE bd.tenant_id = bills.tenant_id
                  AND bd.reference_bill_id = bills.id
                  AND bd.transaction_type = 'adjustment'
                  AND COALESCE(bd.is_active, 1) = 1
              ), 0), 2) <= 0 THEN 'paid'
              ELSE 'partially_paid'
            END,
            updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ? AND ${paymentExistsSql}
      `).bind(
        data.amount,
        data.amount,
        data.amount,
        data.billId,
        tenantId,
        tenantId,
        data.billId,
        receiptNo,
      ),
    ];

    for (const row of incomeRows) {
      paymentBatch.push(c.env.DB.prepare(`
        INSERT INTO income (date, source, amount, description, bill_id, tenant_id)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE ${paymentExistsSql}
      `).bind(
        today,
        row.source,
        row.amount,
        row.description,
        data.billId,
        tenantId,
        tenantId,
        data.billId,
        receiptNo,
      ));
    }

    paymentBatch.push(c.env.DB.prepare(`
      INSERT INTO emp_cash_transactions (
        tenant_id, employee_id, counter_id, counter_session_id, transaction_type,
        amount, reference_id, reference_type, payment_method, description
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, 'bill', ?, ?
      WHERE ${paymentExistsSql}
    `).bind(
      tenantId,
      Number(userId),
      Number(activeSession.counter_id),
      Number(activeSession.id),
      data.type === 'due' ? 'CollectionFromReceivable' : 'CashSales',
      data.amount,
      data.billId,
      data.paymentMethod ?? null,
      `Payment ${receiptNo}`,
      tenantId,
      data.billId,
      receiptNo,
    ));

    // Legacy mode executes this batch directly; strict mode passes the same
    // statements into the canonical command so both authorities commit atomically.
    const paymentExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'billing.payment.collect',
      legacyStatements: paymentBatch,
      canonical: async (options) => {
        if (!options.authoritativeStatements) {
          return projectLegacyBillPaymentHistory(c.env.DB, {
            tenantId: String(tenantId),
            billId: Number(data.billId),
          });
        }
        const mapping = await c.env.DB.prepare(`
          SELECT canonical_public_id
          FROM canonical_source_mappings
          WHERE tenant_id = ? AND entity_type = 'invoice' AND mapping_status = 'mapped'
            AND ((source_type = 'legacy_live_bill' AND source_public_id = ?)
              OR (source_type = 'legacy_bill' AND source_public_id = ?))
          ORDER BY CASE source_type WHEN 'legacy_live_bill' THEN 0 ELSE 1 END
          LIMIT 1
        `).bind(tenantId, String(bill.invoice_no ?? ''), String(bill.id)).first<{ canonical_public_id: string }>();
        if (!mapping?.canonical_public_id) {
          throw new Error('Canonical invoice mapping not found');
        }
        const tenderType = canonicalPaymentTenderType(data.paymentMethod);
        const canonicalInput = await buildLivePaymentProjection({
          tenantId: String(tenantId),
          patientId: Number(bill.patient_id),
          paymentNo: receiptNo,
          receiptNo,
          currencyCode: 'BDT',
          receivedAtUtc: new Date().toISOString(),
          amount: data.amount,
          tenderType,
          methodCode: String(data.paymentMethod ?? tenderType),
          status: 'captured',
          allocations: [{
            sourceAllocationId: `bill:${bill.id}`,
            invoicePublicId: mapping.canonical_public_id,
            amount: data.amount,
          }],
          collectorId: Number(userId),
          counterId: Number(activeSession.counter_id),
          counterSessionId: Number(activeSession.id),
          externalTransactionId,
        });
        return collectPayment(c.env.DB, canonicalInput, options);
      },
    });
    const legacyPaymentInsert = paymentExecution.mode === 'legacy'
      ? paymentExecution.result[0] as { meta?: { changes?: number } } | undefined
      : undefined;
    const batchPaymentInserted = Number(legacyPaymentInsert?.meta?.changes ?? 0) > 0;
    const insertedPayment = batchPaymentInserted
      ? null
      : await c.env.DB.prepare(
        'SELECT id FROM payments WHERE tenant_id = ? AND bill_id = ? AND receipt_no = ? LIMIT 1',
      ).bind(tenantId, data.billId, receiptNo).first<{ id: number }>();
    const paymentInserted = batchPaymentInserted || Boolean(insertedPayment?.id);
    if (!paymentInserted) {
      const current = await c.env.DB.prepare(
        'SELECT status FROM bills WHERE id = ? AND tenant_id = ?',
      ).bind(data.billId, tenantId).first<{ status: string }>();
      if (!current) throw new HTTPException(404, { message: 'Bill not found' });
      if (current.status === 'paid') throw new HTTPException(400, { message: 'Bill is already fully paid' });
      if (current.status === 'cancelled' || current.status === 'refunded') {
        throw new HTTPException(400, { message: `Cannot pay a ${current.status} bill` });
      }
      throw new HTTPException(409, {
        message: `Payment amount (${data.amount}) exceeds outstanding balance. A concurrent payment may have been processed.`,
      });
    }

    const updatedBill = await c.env.DB.prepare(
      'SELECT paid, due, status FROM bills WHERE id = ? AND tenant_id = ?',
    ).bind(data.billId, tenantId).first<{ paid: number; due: number; status: string }>();
    if (!updatedBill) throw new HTTPException(500, { message: 'Payment posted but bill balance could not be reloaded' });
    const previousPaid = Number(bill.paid ?? 0);
    const expectedPaid = Math.min(Number(bill.total ?? previousPaid + data.amount), previousPaid + data.amount);
    const expectedDue = Math.max(0, snapshotOutstanding - data.amount);
    const observedPaid = Number(updatedBill.paid ?? 0);
    const updateObserved = observedPaid > previousPaid;
    const newPaid = updateObserved ? observedPaid : expectedPaid;
    const newDue = updateObserved ? Number(updatedBill.due ?? expectedDue) : expectedDue;
    const status = updateObserved
      ? updatedBill.status
      : expectedDue <= 0 ? 'paid' : 'partially_paid';

    const postCommitTask = (async () => {
      await recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'payment',
        sourceId: receiptNo,
        eventType: ACCOUNTING_EVENT_TYPES.paymentReceived,
        eventDate: today,
        createdBy: userId,
        payload: {
          billId: data.billId,
          receiptNo,
          patientId: bill.patient_id,
          amount: data.amount,
          paymentMethod: data.paymentMethod ?? 'cash',
          paymentType: data.type,
          idempotencyKey,
          externalTransactionId,
          counterId: Number(activeSession.counter_id),
          counterSessionId: Number(activeSession.id),
        },
      });
      queueAccountingPosting(c, tenantId, 'Failed to post payment accounting events:');
      await createAuditLog(
        c.env,
        tenantId,
        userId,
        'PAYMENT',
        'bills',
        data.billId,
        { paidBefore: bill.paid },
        { newPaid, status, receiptNo },
      );
      if (status === 'paid') {
        await Promise.all([
          db.$client.prepare(getDiagnosticBillPaidUpdateSql('lab_orders')).bind(data.billId, tenantId).run(),
          db.$client.prepare(getDiagnosticBillPaidUpdateSql('radiology_requisitions')).bind(data.billId, tenantId).run(),
        ]);
      }
    })().catch((error) => console.error('Payment post-commit side effects failed:', error));
    try {
      c.executionCtx.waitUntil(postCommitTask);
    } catch {
      void postCommitTask;
    }

    return c.json({
      message: 'Payment recorded',
      receiptNo,
      billId: data.billId,
      paidAmount: newPaid,
      outstanding: newDue,
      status,
    });
  } catch (error) {
    if (error instanceof HTTPException || error instanceof CanonicalStrictFinancialError) throw error;

    const existingPayment = await findExistingPaymentByIdempotency(
      c.env.DB,
      tenantId,
      idempotencyKey,
      externalTransactionId,
    );
    if (existingPayment) {
      assertPaymentReplayMatchesRequest(existingPayment, data.billId, data.amount);
      return c.json(paymentReplayResponse(existingPayment));
    }

    throw new HTTPException(500, { message: 'Failed to record payment' });
  }
});

// ─── PUT /api/billing/:id — edit bill (pre-payment only) ─────────────────────

/**
 * PUT /api/billing/:id
 * Allows editing a bill BEFORE any payment has been made.
 * Replaces existing bill items with the new set and recalculates totals.
 *
 * @param {string} id - The ID of the bill to edit.
 * @param {Object} body - Validated data containing items and optional discount.
 * @returns {Object} JSON response indicating success with updated totals.
 * @throws {HTTPException} 404 if bill not found.
 * @throws {HTTPException} 409 if bill already has payments (cannot edit).
 */
billingRoutes.put('/:id', zValidator('json', editBillSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  assertBillingDiscountAllowed(c, data.discount ?? 0);

  try {
    // Verify bill exists and belongs to tenant
    const bill = await db.$client.prepare(
      `SELECT id, status, paid, invoice_no, discount, approved_by FROM bills WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first<{ id: number; status: string; paid: number; invoice_no: string; discount: number; approved_by: number | null }>();

    if (!bill) {
      throw new HTTPException(404, { message: 'Bill not found' });
    }

    // Only allow editing unpaid bills
    if (bill.paid > 0 || bill.status === 'paid') {
      throw new HTTPException(409, { message: 'Cannot edit bill — payment already received. Use credit note instead.' });
    }

    // Calculate new totals
    const subtotal = data.items.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
    const discount = data.discount ?? 0;
    if (discount > subtotal) {
      throw new HTTPException(400, { message: 'Discount cannot exceed subtotal' });
    }
    assertDiscountReferralNameForHighDiscount(subtotal, discount, data.discountByName);

    // Look up tax info for catalog items
    const serviceItemIds = [...new Set(data.items.flatMap((item) => item.serviceItemId ? [item.serviceItemId] : []))];
    let taxInfoMap = new Map<number, { tax_applicable: number | null; tax_percent: number | null }>();
    if (serviceItemIds.length > 0) {
      const placeholders = serviceItemIds.map(() => '?').join(',');
      const { results } = await c.env.DB.prepare(`
        SELECT id, tax_applicable, tax_percent
        FROM billing_service_items
        WHERE tenant_id = ? AND id IN (${placeholders})
      `).bind(tenantId, ...serviceItemIds).all<{ id: number; tax_applicable: number | null; tax_percent: number | null }>();
      taxInfoMap = new Map(results.map((r) => [Number(r.id), { tax_applicable: r.tax_applicable ?? null, tax_percent: r.tax_percent ?? null }]));
    }

    // Distribute bill-level discount proportionally across items for tax calculation
    const discountRatio = subtotal > 0 ? discount / subtotal : 0;
    const resolvedItems = data.items.map((item) => {
      const gross = item.quantity * item.unitPrice;
      const itemDiscount = Math.round(gross * discountRatio);
      const info = item.serviceItemId ? taxInfoMap.get(item.serviceItemId) : undefined;
      const taxable = Number(info?.tax_applicable ?? 0) === 1;
      const taxPercent = taxable ? Number(info?.tax_percent ?? 0) : 0;
      const taxAmount = taxPercent > 0
        ? Math.round(((gross - itemDiscount) * taxPercent) / 100)
        : 0;
      const lineTotal = Math.max(0, gross - itemDiscount + taxAmount);
      return { ...item, gross, itemDiscount, taxAmount, lineTotal };
    });

    const totalDistributed = resolvedItems.reduce((sum, item) => sum + item.itemDiscount, 0);
    const roundingRemainder = discount - totalDistributed;
    if (resolvedItems.length > 0 && roundingRemainder !== 0) {
      const last = resolvedItems[resolvedItems.length - 1];
      last.itemDiscount += roundingRemainder;
      // Recompute tax and lineTotal after discount adjustment
      const lastInfo = last.serviceItemId ? taxInfoMap.get(last.serviceItemId) : undefined;
      const lastTaxable = Number(lastInfo?.tax_applicable ?? 0) === 1;
      const lastTaxPercent = lastTaxable ? Number(lastInfo?.tax_percent ?? 0) : 0;
      last.taxAmount = lastTaxPercent > 0
        ? Math.round(((last.gross - last.itemDiscount) * lastTaxPercent) / 100)
        : 0;
      last.lineTotal = Math.max(0, last.gross - last.itemDiscount + last.taxAmount);
    }

    const taxTotal = resolvedItems.reduce((s, i) => s + i.taxAmount, 0);
    const totalAmount = resolvedItems.reduce((s, i) => s + i.lineTotal, 0);

    // Recompute category totals from edited items
    const categoryTotals = calculateBillCategoryTotals(
      resolvedItems.map((item) => ({ category: item.itemCategory, amount: item.lineTotal })),
    );

    const currentDiscount = bill.discount ?? 0;
    const currentApprovedBy = bill.approved_by;
    // Only update approvedBy when discount increases (from 0 or from a lower value)
    const newApprovedBy = discount > currentDiscount ? Number(userId) : currentApprovedBy;

    // Atomic batch: delete old items, insert new ones, update bill totals
    const batchStmts: any[] = [
      // Delete existing items
      db.delete(invoiceItems)
        .where(and(eq(invoiceItems.billId, Number(id)), eq(invoiceItems.tenantId, tenantId))),

      // Update bill totals
      db.update(bills)
        .set({
          ...categoryTotals,
          total: totalAmount,
          discount: discount,
          discountReason: data.discountReason ?? null,
          discountByName: data.discountByName?.trim() || null,
          approvedBy: newApprovedBy,
          due: totalAmount,
          taxTotal: taxTotal ?? 0,
          updatedAt: sql`datetime('now', '+6 hours')`,
        })
        .where(and(eq(bills.id, Number(id)), eq(bills.tenantId, tenantId))),
    ];

    // Insert new items
    for (const item of resolvedItems) {
      batchStmts.push(
        db.insert(invoiceItems).values({
          billId: Number(id),
          itemCategory: item.itemCategory,
          description: item.description ?? null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          taxAmount: item.taxAmount ?? 0,
          referenceId: item.referenceId ?? item.serviceItemId ?? null,
          tenantId,
        })
      );
    }

    // Audit log
    // Warning: we log audit to Drizzle ORM auditLogs natively
    batchStmts.push(
      db.insert(auditLogs).values({
        tenantId,
        userId: Number(userId),
        action: 'UPDATE',
        tableName: 'bills',
        recordId: Number(id),
        oldValue: JSON.stringify({ invoice_no: bill.invoice_no }),
        newValue: JSON.stringify({ edit: `Bill edited — new total: ${totalAmount}` }),
      })
    );

    await db.batch(batchStmts as any);

    return c.json({
      message: 'Bill updated',
      totalAmount,
      discount,
      taxTotal,
      itemCount: data.items.length,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to edit bill' });
  }
});

/**
 * POST /api/billing/:id/print-count
 * Increments the print_count on a bill to track how many times
 * an invoice has been printed. Used for duplicate print detection.
 */
billingRoutes.post('/:id/print-count', requirePermission('billing:write'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const bill = await db.$client.prepare(
      'SELECT id, print_count FROM bills WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<{ id: number; print_count: number | null }>();
    if (!bill) throw new HTTPException(404, { message: 'Bill not found' });

    await db.$client.prepare(
      'UPDATE bills SET print_count = COALESCE(print_count, 0) + 1 WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).run();

    return c.json({
      message: 'Print count updated',
      print_count: (bill.print_count ?? 0) + 1,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update print count' });
  }
});

// POST /send-reminder — send payment reminder for due bills
billingRoutes.post('/send-reminder', requirePermission('billing:write'), zValidator('json', paymentReminderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { billId, method } = c.req.valid('json');

  const bill = await db.$client.prepare(`
    SELECT b.id, b.total, b.paid, b.patient_id, p.name as patient_name, p.phone, p.email
    FROM bills b
    LEFT JOIN patients p ON p.id = b.patient_id
    WHERE b.id = ? AND b.tenant_id = ?
  `).bind(billId, tenantId).first<any>();

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404);
  }

  const dueAmount = Number(bill.total) - Number(bill.paid);
  if (dueAmount <= 0) {
    return c.json({ error: 'No due amount on this bill' }, 400);
  }

  // Log reminder
  await db.$client.prepare(`
    INSERT INTO payment_reminders (tenant_id, bill_id, patient_id, due_amount, reminder_method, sent_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tenantId, billId, bill.patient_id, dueAmount, method, userId).run();

  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'payment_reminders', billId, null, {
    patientName: bill.patient_name,
    dueAmount,
    method,
  });

  return c.json({
    success: true,
    message: `Payment reminder logged for ${bill.patient_name} — ৳${dueAmount.toLocaleString()} due`,
  });
});

export default billingRoutes;
