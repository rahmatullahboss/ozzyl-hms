import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { getNextSequence } from '../../lib/sequence';
import { getNextInvoiceNumber } from '../../lib/invoice-sequence';
import { getActiveFiscalYear, getNextFiscalInvoiceNo } from '../../lib/fiscal-year';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { assertStrictFinancialBoundaryDisabledOrSupported } from '../../lib/canonical/strict-financial-boundaries';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { isFinancialBatchAssertionError } from '../../lib/canonical/financial-batch-assertion';
import { prepareIpdDischargeLegacyStatements } from '../../lib/canonical/ipd-discharge-billing-finalization';
import { buildIpdDischargeBillingProjection } from '../../lib/canonical/live-ipd-discharge-billing';
import { finalizeIpdDischargeBilling } from '../../lib/canonical/commands/finalize-ipd-discharge-billing';
import { requireRole } from '../../middleware/rbac';
import { getDb } from '../../db';
import { calculateBillCategoryTotals } from '../../lib/billing-category-totals';
import { calculateBillPaymentState } from '../../lib/billing-payment-state';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getPatientDepositBalance } from '../../lib/patient-deposits';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import { recordBillFinalizationSideEffects } from '../../lib/billing-finalization';
import { getPendingDischargeBilling } from '../../lib/discharge-billing-guards';
import { calculateAdmissionPackageBilling, loadBedChargePolicy, recalculateBedCharge } from '../../lib/bed-charges';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../lib/accounting-posting';
import { shadowCreateCashLedgerEntry } from '../../lib/cash-ledger-writer';
import { splitDiscountAllocation } from '../../lib/discount_allocation';
import { createDoctorPayableAccrualsForProvisionalItems } from '../../lib/provisional-doctor-payables';
import { buildInvoiceSearchTerms, escapeLikeWildcards } from '../../lib/invoice-search';
import { getIpdPeriodSnapshot } from '../../lib/ipd-finance-reporting';
import { resolveExecutiveDashboardPeriod } from '../../lib/executive-dashboard-period';
import { normalizeLegacyAdmissionInstantUtc } from '../../lib/admission-time';
import {
  loadPatientOutstandingFinancialClearance,
  minorToMajor,
} from '../../lib/ipd-discharge-financial-clearance';
import {
  CREDIT_DISCHARGE_APPROVAL_KIND,
  CREDIT_DISCHARGE_APPROVAL_STORAGE_TYPE,
} from '../../lib/credit-discharge-approval';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  readMutationIdempotencyReplay,
  reserveMutationIdempotencyKey,
} from '../../lib/request-idempotency';


function isCashPaymentMethod(value: unknown): boolean {
  const normalized = String(value ?? 'cash').trim().toLowerCase();
  return normalized === '' || normalized === 'cash' || normalized === 'cash payment';
}

function isIpdCanonicalConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/canonical inpatient encounter|deposit|settlement|idempotency|constraint failed|already completed|invoice total/i.test(message)) {
      return true;
    }
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function shadowWriteIpdBillPaymentCollection(params: {
  db: D1Database;
  tenantId: string;
  billId: number;
  invoiceNo: string;
  receiptNo: string;
  admissionId: number;
  patientId: number;
  amount: number;
  paymentMethod: string;
  userId: string | number;
  counterSessionId: number;
  counterId: number;
}) {
  if (!isCashPaymentMethod(params.paymentMethod)) return;
  await shadowCreateCashLedgerEntry(params.db, {
    tenantId: params.tenantId,
    sourceType: 'ipd_payment',
    sourceId: params.receiptNo,
    sourceNo: params.receiptNo,
    eventType: 'IPD_PAYMENT_RECEIVED',
    movementDirection: 'in',
    cashStatus: 'IN_DRAWER',
    status: 'posted',
    amount: params.amount,
    expectedAmount: params.amount,
    receivedAmount: params.amount,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: params.patientId,
    toUserId: Number(params.userId),
    counterSessionId: params.counterSessionId,
    counterId: params.counterId,
    currentLocationType: 'drawer',
    currentLocationLabel: `Counter session #${params.counterSessionId}`,
    referenceType: 'ipd_bill',
    referenceId: params.billId,
    note: `IPD bill payment ${params.receiptNo} for ${params.invoiceNo}`,
    metadata: {
      invoiceNo: params.invoiceNo,
      receiptNo: params.receiptNo,
      admissionId: params.admissionId,
      patientId: params.patientId,
      billId: params.billId,
      shadowSource: 'ipd_discharge_bill',
    },
    idempotencyKey: `cash-ledger:ipd-payment:${params.receiptNo}:received`,
    createdBy: Number(params.userId),
    occurredAt: new Date().toISOString(),
  });
}

// ─── IPD Ledger Entry Helper ────────────────────────────────────────────────
async function createIpdLedgerEntry(
  db: ReturnType<typeof getDb>,
  params: {
    tenantId: string;
    admissionId: number;
    patientId: number;
    entryType: string;
    category: string | null;
    description: string;
    debitAmount: number;
    creditAmount: number;
    paymentId?: number | null;
    billId?: number | null;
    depositId?: number | null;
    creditNoteId?: number | null;
    counterSessionId?: number | null;
    createdBy?: string | number | null;
    approvedBy?: string | number | null;
    remarks?: string | null;
  },
): Promise<void> {
  await db.$client.prepare(`
    INSERT INTO ipd_ledger_entries
      (tenant_id, admission_id, patient_id, entry_type, category, description,
       debit_amount, credit_amount, payment_id, bill_id, deposit_id, credit_note_id,
       counter_session_id, created_by, approved_by, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    params.tenantId, params.admissionId, params.patientId, params.entryType,
    params.category ?? null, params.description,
    params.debitAmount, params.creditAmount,
    params.paymentId ?? null, params.billId ?? null,
    params.depositId ?? null, params.creditNoteId ?? null,
    params.counterSessionId ?? null,
    params.createdBy ?? null, params.approvedBy ?? null,
    params.remarks ?? null,
  ).run();
}


const ipBilling = new Hono<{ Bindings: Env; Variables: Variables }>();

const IP_BILLING_ROLES = ['reception', 'hospital_admin', 'md', 'director', 'accountant'] as const;

type IpBillingServiceItem = {
  id: number;
  item_name: string;
  price: number;
  service_department_id?: number | null;
  department_name?: string | null;
  allow_discount?: number | null;
  allow_multiple_qty?: number | null;
};

function inferIpBillingCategory(item: IpBillingServiceItem): string {
  const haystack = `${item.department_name ?? ''} ${item.item_name ?? ''}`.toLowerCase();
  if (/(lab|test|pathology|radiology|x-?ray|ultra|usg|ct|mri|cbc|blood|urine)/.test(haystack)) return 'test';
  if (/(doctor|consult|opd|visit|follow)/.test(haystack)) return 'doctor_visit';
  if (/(pharmacy|medicine|drug)/.test(haystack)) return 'medicine';
  if (/(operation|surgery|ot|procedure)/.test(haystack)) return 'operation';
  if (/(admission|bed|ward|cabin|room|ipd)/.test(haystack)) return 'admission';
  return 'service';
}

function assertDiscountReferralNameForHighDiscount(subtotal: number, discount: number, discountByName?: string | null) {
  if (discount <= 0) return;
  if (!discountByName?.trim()) {
    throw new HTTPException(400, { message: 'Discount referred by name is required when discount is applied.' });
  }
}

function getDischargeInvoiceItemCategory(category: string | null | undefined): string {
  switch (category) {
    case 'test':
    case 'doctor_visit':
    case 'doctor_round':
    case 'procedure':
    case 'operation':
    case 'medicine':
    case 'admission':
    case 'other':
      return category;
    case 'bed_charge':
      return 'admission';
    default:
      return 'other';
  }
}

function logDischargeBillFailure(error: unknown, context: Record<string, unknown>): void {
  const errorInfo = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack?.split('\n').slice(0, 6) }
    : { message: String(error) };
  console.error('[ipBilling.dischargeBill] failed', JSON.stringify({
    event: 'ipd_discharge_bill_failure',
    ...context,
    error: errorInfo,
    timestamp: new Date().toISOString(),
  }));
}

async function loadIpBillingServiceItem(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  serviceItemId: number,
): Promise<IpBillingServiceItem | null> {
  const tenantItem = await db.$client.prepare(`
    SELECT
      si.id,
      si.item_name,
      si.price,
      si.service_department_id,
      sd.department_name,
      si.allow_discount,
      si.allow_multiple_qty
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON sd.id = si.service_department_id
     AND sd.tenant_id = si.tenant_id
    WHERE si.id = ?
      AND si.tenant_id = ?
      AND (si.is_active IS NULL OR si.is_active = 1)
      AND (si.service_department_id IS NULL OR (sd.id IS NOT NULL AND COALESCE(sd.is_active, 1) = 1))
  `).bind(serviceItemId, tenantId).first<IpBillingServiceItem>();
  if (tenantItem) return tenantItem;

  return db.$client.prepare(`
    SELECT
      si.id,
      si.item_name,
      si.price,
      si.service_department_id,
      sd.department_name,
      si.allow_discount,
      si.allow_multiple_qty
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON sd.id = si.service_department_id
     AND sd.tenant_id = si.tenant_id
    WHERE si.id = ?
      AND si.tenant_id = '0'
      AND (si.is_active IS NULL OR si.is_active = 1)
      AND (si.service_department_id IS NULL OR (sd.id IS NOT NULL AND COALESCE(sd.is_active, 1) = 1))
  `).bind(serviceItemId).first<IpBillingServiceItem>();
}

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post IP discharge billing accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

// ─── GET /patients — list IP patients with billing summary (used by frontend) ─
ipBilling.get('/patients', requireRole(...IP_BILLING_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const search = c.req.query('search');
  const billingStatus = c.req.query('billing_status');

  const params: (string | number)[] = [tenantId, tenantId];
  const bedChargePolicy = await loadBedChargePolicy(db.$client, tenantId);

  // Use separate simpler queries to avoid subquery failures when optional
  // billing/deposit tables have not been created yet.
  // Fetch provisional totals separately (provisional items + bed charges)
  let provTotals: Map<number, number> = new Map();
  try {
    // Get provisional item totals
    const { results: provRows } = await db.$client.prepare(
      `SELECT admission_id, SUM(total_amount) as total
       FROM billing_provisional_items
       WHERE tenant_id = ? AND bill_status = 'provisional' AND is_active = 1
       GROUP BY admission_id`
    ).bind(tenantId).all<any>();
    for (const r of provRows) provTotals.set(r.admission_id, (provTotals.get(r.admission_id) ?? 0) + r.total);

    // Get current unbilled bed charges and calculate them the same way as the detail endpoint.
    const { results: bedRows } = await db.$client.prepare(
      `SELECT admission_id, rate_per_day, started_on, ended_on
       FROM patient_bed_infos
       WHERE tenant_id = ? AND is_billed = 0`
    ).bind(tenantId).all<any>();
    for (const r of bedRows) {
      const { chargeAmount } = recalculateBedCharge(
        Number(r.rate_per_day || 0),
        r.started_on,
        r.ended_on || undefined,
        bedChargePolicy,
      );
      provTotals.set(r.admission_id, (provTotals.get(r.admission_id) ?? 0) + chargeAmount);
    }
  } catch { /* table may not exist yet */ }

  // Fetch deposit totals by patient_id
  let depositTotals: Map<number, number> = new Map();
  try {
    const { results: depRows } = await db.$client.prepare(
      `SELECT patient_id,
        COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0) as balance
      FROM billing_deposits WHERE tenant_id = ? AND is_active = 1 GROUP BY patient_id`
    ).bind(tenantId).all<any>();
    for (const r of depRows) depositTotals.set(r.patient_id, r.balance);
  } catch { /* deposits table may not exist yet */ }

  let sql = `
    SELECT
      a.id as admission_id, a.admission_no as admission_number,
      a.patient_id, COALESCE(p.name, 'Unknown Patient') as patient_name, p.patient_code, p.date_of_birth,
      p.address AS patient_address,
      b.ward_name, b.bed_number, d.name as doctor_name,
      a.admission_date as admitted_date,
      a.created_at as admission_created_at,
      0 as total_charges,
      0 as total_paid,
      0 as balance,
      'pending' as billing_status
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    LEFT JOIN (
      SELECT tenant_id, patient_id, MAX(invoice_no) AS invoice_no
      FROM bills
      WHERE tenant_id = ?
      GROUP BY tenant_id, patient_id
    ) inv ON inv.tenant_id = a.tenant_id AND inv.patient_id = a.patient_id
    WHERE a.tenant_id = ? AND a.status IN ('admitted','critical')
  `;
  if (search) {
    const safe = escapeLikeWildcards(search);
    const invoiceTerms = buildInvoiceSearchTerms(safe);
    sql += ` AND (
      p.name LIKE ? ESCAPE '\\'
      OR p.patient_code LIKE ? ESCAPE '\\'
      OR p.mobile LIKE ? ESCAPE '\\'
      OR a.admission_no LIKE ? ESCAPE '\\'
      OR b.ward_name LIKE ? ESCAPE '\\'
      OR b.bed_number LIKE ? ESCAPE '\\'
      OR inv.invoice_no LIKE ? ESCAPE '\\'
      OR inv.invoice_no LIKE ? ESCAPE '\\'
      OR inv.invoice_no LIKE ? ESCAPE '\\'
    )`;
    params.push(
      `%${safe}%`, `%${safe}%`, `%${safe}%`, `%${safe}%`, `%${safe}%`, `%${safe}%`,
      invoiceTerms.original, invoiceTerms.normalized, invoiceTerms.padded,
    );
  }
  sql += ' ORDER BY a.created_at DESC';

  let results: any[] = [];
  try {
    const queryResult = await db.$client.prepare(sql).bind(...params).all();
    results = queryResult.results as any[];
  } catch (e) {
    console.error('[ipBilling/patients] query error:', e);
    const fallbackParams: (string | number)[] = [tenantId];
    let fallbackSql = `
      SELECT
        a.id as admission_id, a.admission_no as admission_number,
        a.patient_id, 'Unknown Patient' as patient_name, NULL as patient_code, NULL as date_of_birth,
        NULL as patient_address,
        NULL as ward_name, NULL as bed_number, NULL as doctor_name,
        a.admission_date as admitted_date,
        a.created_at as admission_created_at,
        0 as total_charges,
        0 as total_paid,
        0 as balance,
        'pending' as billing_status
      FROM admissions a
      WHERE a.tenant_id = ? AND a.status = 'admitted'
    `;
    if (search) {
      fallbackSql += ' AND a.admission_no LIKE ?';
      fallbackParams.push(`%${search}%`);
    }
    fallbackSql += ' ORDER BY a.created_at DESC';

    try {
      const fallbackResult = await db.$client.prepare(fallbackSql).bind(...fallbackParams).all();
      results = fallbackResult.results as any[];
    } catch (fallbackError) {
      console.error('[ipBilling/patients] fallback query error:', fallbackError);
      return c.json({ data: [] });
    }
  }

  // Merge provisional charge and deposit totals into results (enrich in JS, not in SQL).
  // Do not subtract patient-level historical payments here; admitted IP rows show
  // current unbilled admission charges, so older OPD/discharge payments would
  // incorrectly inflate the patient's credit balance.
  for (const row of results) {
    // Handle both field names: admission_id (aliased) and id (raw from mock fallback)
    const rowId = (row as any).admission_id ?? (row as any).id;
    const charges = provTotals.get(rowId as number) ?? 0;
    const deposit = depositTotals.get(row.patient_id as number) ?? 0;
    row.total_charges = charges;
    row.total_paid = 0;
    row.deposit_balance = deposit;
    const legacyAdmissionDate = row.admitted_date ?? row.admission_date;
    if (legacyAdmissionDate) {
      try {
        row.admitted_at_utc = normalizeLegacyAdmissionInstantUtc({
          admissionDate: String(legacyAdmissionDate),
          createdAt: row.admission_created_at ?? row.created_at ?? null,
          naiveSemantics: 'infer',
        });
      } catch {
        row.admitted_at_utc = null;
      }
    } else {
      row.admitted_at_utc = null;
    }
    row.balance = charges - deposit;
    if (charges - deposit <= 0 && charges > 0) row.billing_status = 'settled';
    else if (deposit > 0) row.billing_status = 'partial';
    else row.billing_status = 'pending';
  }

  const filtered = billingStatus ? results.filter((r: any) => r.billing_status === billingStatus) : results;
  return c.json({ data: filtered });
});

// ─── GET /stats — canonical period-aware IPD finance and operational snapshot ─
ipBilling.get('/stats', requireRole(...IP_BILLING_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const from = c.req.query('from')?.trim();
  const to = c.req.query('to')?.trim();
  const usesFromTo = Boolean(from || to);
  const period = resolveExecutiveDashboardPeriod({
    preset: usesFromTo ? 'custom' : c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: usesFromTo ? from : c.req.query('startDate'),
    endDate: usesFromTo ? to : c.req.query('endDate'),
  });

  const parsePositiveInteger = (value: string | undefined, fallback: number, maximum: number): number | null => {
    if (value === undefined || value.trim() === '') return fallback;
    if (!/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) return null;
    return parsed;
  };
  const page = parsePositiveInteger(c.req.query('page'), 1, 1_000_000);
  const pageSize = parsePositiveInteger(c.req.query('pageSize'), 20, 200);

  if (!period || page === null || pageSize === null) {
    return c.json({ error: 'Invalid reporting period or pagination.' }, 400);
  }

  try {
    const snapshot = await getIpdPeriodSnapshot(
      c.env.DB,
      tenantId,
      { startDate: period.startDate, endDate: period.endDate },
      { page, pageSize, offset: (page - 1) * pageSize },
    );
    const activity = snapshot.activity;
    return c.json({
      period,
      page: snapshot.page,
      pageSize: snapshot.pageSize,
      totalActivityRows: snapshot.totalActivityRows,
      hasNextPage: snapshot.hasNextPage,
      total_inpatients: snapshot.totalInpatients,
      pending_billing: snapshot.pendingBilling,
      charges_added_today: snapshot.chargesAddedToday,
      gross_billed_today: snapshot.grossBilledToday,
      final_billed_today: snapshot.finalBilledToday,
      final_bill_count_today: snapshot.finalBillCountToday,
      payment_collected_today: snapshot.paymentCollectedToday,
      payment_receipt_count_today: snapshot.paymentReceiptCountToday,
      cash_collected_today: snapshot.cashCollectedToday,
      non_cash_collected_today: snapshot.nonCashCollectedToday,
      deposit_received_today: snapshot.depositReceivedToday,
      deposit_receipt_count_today: snapshot.depositReceiptCountToday,
      deposit_cash_received_today: snapshot.depositCashReceivedToday,
      deposit_non_cash_received_today: snapshot.depositNonCashReceivedToday,
      total_money_received_today: snapshot.totalMoneyReceivedToday,
      total_cash_received_today: snapshot.totalCashReceivedToday,
      total_non_cash_received_today: snapshot.totalNonCashReceivedToday,
      deposit_applied_today: snapshot.depositAppliedToday,
      discount_today: snapshot.discountToday,
      settled_gross_today: snapshot.settledGrossToday,
      settled_discount_today: snapshot.settledDiscountToday,
      settled_payment_applied_today: snapshot.settledPaymentAppliedToday,
      settled_deposit_applied_today: snapshot.settledDepositAppliedToday,
      settled_today: snapshot.settledToday,
      settled_bill_count_today: snapshot.settledBillCountToday,
      current_provisional_due: snapshot.currentProvisionalDue,
      high_due_patients: snapshot.highDuePatients,
      package_patients: snapshot.packagePatients,
      today_admissions: snapshot.todayAdmissions,
      today_discharges: snapshot.todayDischarges,
      activity,
      // Backward-compatible aliases used by older dashboard clients.
      today_activity: activity,
      total_charges_today: snapshot.chargesAddedToday,
    });
  } catch (error) {
    console.error('[ipBilling/stats] failed to build IPD finance snapshot', error);
    return c.json({
      period,
      page,
      pageSize,
      totalActivityRows: 0,
      hasNextPage: false,
      total_inpatients: 0,
      pending_billing: 0,
      charges_added_today: 0,
      gross_billed_today: 0,
      final_billed_today: 0,
      final_bill_count_today: 0,
      payment_collected_today: 0,
      payment_receipt_count_today: 0,
      cash_collected_today: 0,
      non_cash_collected_today: 0,
      deposit_received_today: 0,
      deposit_receipt_count_today: 0,
      deposit_cash_received_today: 0,
      deposit_non_cash_received_today: 0,
      total_money_received_today: 0,
      total_cash_received_today: 0,
      total_non_cash_received_today: 0,
      deposit_applied_today: 0,
      discount_today: 0,
      settled_gross_today: 0,
      settled_discount_today: 0,
      settled_payment_applied_today: 0,
      settled_deposit_applied_today: 0,
      settled_today: 0,
      settled_bill_count_today: 0,
      current_provisional_due: 0,
      high_due_patients: 0,
      package_patients: 0,
      today_admissions: 0,
      today_discharges: 0,
      activity: [],
      today_activity: [],
      total_charges_today: 0,
    });
  }
});

// ─── GET /admitted — list admitted patients for IP billing ────────────────────

ipBilling.get('/admitted', requireRole(...IP_BILLING_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const search = c.req.query('search');

  let sql = `
    SELECT a.*, p.name as patient_name, p.patient_code, p.mobile,
      b.ward_name, b.bed_number, d.name as doctor_name
    FROM admissions a
    JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.status IN ('admitted','critical')
  `;
  const params: (string | number)[] = [tenantId];
  if (search) {
    sql += ' AND (p.name LIKE ? OR p.patient_code LIKE ? OR p.mobile LIKE ? OR a.admission_no LIKE ? OR b.ward_name LIKE ? OR b.bed_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY a.created_at DESC';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ patients: results });
});

// ─── GET /pending/:admissionId — pending charges for an admission ────────────

ipBilling.get('/pending/:admissionId', requireRole(...IP_BILLING_ROLES), async (c) => {
  try {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const admissionId = parseInt(c.req.param('admissionId'));
  if (isNaN(admissionId)) return c.json({ error: 'Invalid admission ID' }, 400);

  // Get admission details including billing_mode and package_id
  const admission = await db.$client.prepare(`
    SELECT billing_mode, package_id, patient_id, admission_date FROM admissions WHERE id = ? AND tenant_id = ?
  `).bind(admissionId, tenantId).first<{
    billing_mode: string;
    package_id: number;
    patient_id: number;
    admission_date: string | null;
  }>();

  const bedChargePolicy = await loadBedChargePolicy(db.$client, tenantId);

  if (!admission) {
    return c.json({
      items: [],
      bed_charges: { segments: [], bed_total: 0 },
      package: null,
      deposit_history: [],
      summary: { provisional_total: 0, bed_total: 0, grand_total: 0, deposit_balance: 0, deposit_total: 0, deposit_used: 0, net_payable: 0, pending_service_amount: 0 },
    });
  }

  // Get package details if admission has a package
  let packageInfo: any = null;
  let packageItems: any[] = [];
  if (admission?.package_id) {
    packageInfo = await db.$client.prepare(`
      SELECT id, package_name, package_code, description, total_price, discount_percent,
             included_bed_days, extra_bed_rate, package_type
      FROM billing_packages WHERE id = ? AND tenant_id = ?
    `).bind(admission.package_id, tenantId).first();

    if (packageInfo) {
      const { results: pkgItems } = await db.$client.prepare(`
        SELECT id, item_name, quantity, price, service_item_id
        FROM billing_package_items WHERE package_id = ? AND tenant_id = ?
        ORDER BY id ASC
      `).bind(admission.package_id, tenantId).all();
      packageItems = pkgItems as any[];
    }
  }

  // Get provisional items
  const { results: items } = await db.$client.prepare(`
    SELECT * FROM billing_provisional_items
    WHERE tenant_id = ? AND admission_id = ? AND bill_status = 'provisional' AND is_active = 1
    ORDER BY created_at ASC
  `).bind(tenantId, admissionId).all();

  // Calculate bed charges from patient_bed_infos history
  const { results: bedInfos } = await db.$client.prepare(`
    SELECT * FROM patient_bed_infos
    WHERE tenant_id = ? AND admission_id = ? AND is_billed = 0
    ORDER BY started_on ASC
  `).bind(tenantId, admissionId).all();

  const provisionalTotal = (items as any[]).reduce((sum, i: any) => sum + (i.total_amount || 0), 0);
  const admissionBilling = calculateAdmissionPackageBilling({
    packageInfo: packageInfo ? {
      totalPrice: Number(packageInfo.total_price ?? 0),
      packageType: packageInfo.package_type,
      includedBedDays: Number(packageInfo.included_bed_days ?? 0),
      extraBedRate: Number(packageInfo.extra_bed_rate ?? 0),
    } : null,
    provisionalTotal,
    bedChargePolicy,
    beds: (bedInfos as any[]).map((bed) => ({
      id: bed.id,
      ratePerDay: Number(bed.rate_per_day || 0),
      startedOn: bed.started_on,
      endedOn: bed.ended_on || undefined,
      data: {
        id: bed.id,
        bed_id: bed.bed_id,
        ward_name: bed.ward_name,
        bed_number: bed.bed_number,
        bed_type: bed.bed_type,
        rate_per_day: bed.rate_per_day,
        started_on: bed.started_on,
        ended_on: bed.ended_on,
      },
    })),
  });
  const bedChargeSegments = admissionBilling.bedChargeSegments;
  const bedTotal = admissionBilling.bedTotal;

  // Get deposit breakdown
  const deposit = await db.$client.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) as total_deposits,
      COALESCE(SUM(CASE WHEN transaction_type = 'refund' THEN amount ELSE 0 END), 0) as total_refunds,
      COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0) as total_adjustments
    FROM billing_deposits WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
  `).bind(tenantId, admission.patient_id).first<{ total_deposits: number; total_refunds: number; total_adjustments: number }>();

  const totalDeposits = deposit?.total_deposits || 0;
  const totalRefunds = deposit?.total_refunds || 0;
  const totalAdjustments = deposit?.total_adjustments || 0;
  const depositBalance = totalDeposits - totalRefunds - totalAdjustments;

  const { results: depositHistoryRows } = await db.$client.prepare(`
    SELECT transaction_type, remarks, amount, payment_method, deposit_receipt_no, created_by, created_at
    FROM billing_deposits
    WHERE tenant_id = ?
      AND patient_id = ?
      AND is_active = 1
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(tenantId, admission.patient_id).all<{
    transaction_type: string;
    remarks: string | null;
    amount: number;
    payment_method: string | null;
    deposit_receipt_no: string | null;
    created_by: number | null;
    created_at: string | null;
  }>();
  const [financialClearance, dischargeBilling] = await Promise.all([
    loadPatientOutstandingFinancialClearance({
      db: c.env.DB,
      tenantId: String(tenantId),
      patientId: Number(admission.patient_id),
    }),
    getPendingDischargeBilling(
      c.env.DB,
      String(tenantId),
      admissionId,
      Number(admission.patient_id),
      admission.admission_date ?? null,
      { includeProvisional: false },
    ),
  ]);

  return c.json({
    items,
    bed_charges: {
      segments: bedChargeSegments,
      bed_total: bedTotal,
    },
    package: packageInfo ? {
      id: packageInfo.id,
      package_name: packageInfo.package_name,
      package_code: packageInfo.package_code,
      description: packageInfo.description,
      total_price: packageInfo.total_price,
      included_bed_days: packageInfo.included_bed_days,
      extra_bed_rate: packageInfo.extra_bed_rate,
      package_type: packageInfo.package_type,
      items: packageItems.map((i: any) => ({
        id: i.id,
        item_name: i.item_name,
        quantity: i.quantity,
        price: i.price,
      })),
    } : null,
    deposit_history: depositHistoryRows.map((entry) => ({
      type: entry.transaction_type,
      description: entry.remarks || entry.transaction_type,
      amount: entry.amount,
      payment_method: entry.payment_method,
      receipt_no: entry.deposit_receipt_no,
      created_by: entry.created_by,
      created_at: entry.created_at,
    })),
    financial_clearance: {
      authority_mode: financialClearance.authorityMode,
      currency_code: financialClearance.currencyCode,
      total_outstanding: minorToMajor(financialClearance.totalOutstandingMinor),
      invoice_count: financialClearance.invoiceCount,
      inline_settlement_supported: financialClearance.inlineSettlementSupported,
      invoices: financialClearance.invoices.map((invoice) => ({
        invoice_number: invoice.invoiceNumber,
        issued_at: invoice.issuedAtUtc,
        currency_code: invoice.currencyCode,
        total: minorToMajor(invoice.totalMinor),
        paid: minorToMajor(invoice.paidMinor),
        credited: minorToMajor(invoice.creditedMinor),
        due: minorToMajor(invoice.dueMinor),
        legacy_bill_id: invoice.legacyBillId,
        canonical_invoice_public_id: invoice.canonicalInvoicePublicId,
        admission_id: invoice.admissionId,
        visit_id: invoice.visitId,
        source_label: invoice.sourceLabel,
        categories: invoice.categories.map((category) => ({
          code: category.code,
          label: category.label,
          amount: minorToMajor(category.amountMinor),
        })),
      })),
    },
    summary: {
      provisional_total: provisionalTotal,
      package_total: admissionBilling.packageTotal,
      bed_total: bedTotal,
      grand_total: admissionBilling.grandTotal,
      deposit_balance: depositBalance,
      deposit_total: totalDeposits,
      deposit_used: totalRefunds + totalAdjustments,
      net_payable: Math.max(0, admissionBilling.grandTotal - depositBalance),
      pending_service_amount: dischargeBilling.pendingServiceAmount,
    },
  });
  } catch (err: any) {
    console.error('IPD pending billing error:', err);
    return c.json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});

// ─── GET /timeline/:patientId — billing timeline for a patient ──────────────
ipBilling.get('/timeline/:patientId', requireRole(...IP_BILLING_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));
  if (isNaN(patientId)) return c.json({ error: 'Invalid patient ID' }, 400);

  const { results } = await db.$client.prepare(`
    SELECT 'charge' AS type, item_name AS description, item_category AS category,
           total_amount AS amount, created_at, created_by, NULL AS payment_method, NULL AS receipt_no
    FROM billing_provisional_items
    WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
    UNION ALL
    SELECT 'payment' AS type, 'Payment received' AS description, 'payment' AS category,
           p.amount, COALESCE(p.date, p.created_at) AS created_at, p.received_by AS created_by,
           p.payment_method, p.receipt_no
    FROM payments p
    JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
    WHERE p.tenant_id = ? AND b.patient_id = ?
    UNION ALL
    SELECT CASE WHEN d.transaction_type = 'deposit' THEN 'deposit' ELSE d.transaction_type END AS type,
           COALESCE(d.remarks, d.transaction_type) AS description, 'deposit' AS category,
           d.amount, d.created_at, d.created_by, d.payment_method, d.deposit_receipt_no AS receipt_no
    FROM billing_deposits d
    WHERE d.tenant_id = ? AND d.patient_id = ? AND d.is_active = 1
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(tenantId, patientId, tenantId, patientId, tenantId, patientId).all();

  return c.json({ timeline: results });
});

// HTML escape function to prevent XSS
function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── GET /:admissionId/print — print data for running bill ───────────────────
ipBilling.get('/:admissionId/print', requireRole(...IP_BILLING_ROLES), async (c) => {
  try {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const admissionId = parseInt(c.req.param('admissionId'));
  if (isNaN(admissionId)) return c.json({ error: 'Invalid admission ID' }, 400);
  const bedChargePolicy = await loadBedChargePolicy(db.$client, tenantId);

  // Get admission with patient info
  const admission = await db.$client.prepare(`
    SELECT
      a.id, a.admission_no, a.admission_date, a.admission_type, a.status, a.package_id,
      a.provisional_diagnosis, a.doctor_id AS attending_doctor_id,
      p.id AS patient_id, p.name AS patient_name, p.patient_code, p.mobile AS patient_phone, p.address AS patient_address,
      d.name AS doctor_name,
      b.ward_name, b.bed_number, b.bed_type
    FROM admissions a
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
    WHERE a.id = ? AND a.tenant_id = ?
  `).bind(admissionId, tenantId).first();

  if (!admission) throw new HTTPException(404, { message: 'Admission not found' });

  // Get provisional items
  const { results: items } = await db.$client.prepare(`
    SELECT * FROM billing_provisional_items
    WHERE tenant_id = ? AND admission_id = ? AND bill_status = 'provisional' AND is_active = 1
    ORDER BY created_at ASC
  `).bind(tenantId, admissionId).all();

  // Calculate bed charges from patient_bed_infos history
  const { results: bedInfos } = await db.$client.prepare(`
    SELECT * FROM patient_bed_infos
    WHERE tenant_id = ? AND admission_id = ? AND is_billed = 0
    ORDER BY started_on ASC
  `).bind(tenantId, admissionId).all();

  const provisionalTotal = (items as any[]).reduce((sum, i: any) => sum + (i.total_amount || 0), 0);
  let packageInfo: any = null;
  if ((admission as any).package_id) {
    packageInfo = await db.$client.prepare(`
      SELECT id, package_name, package_code, description, total_price, discount_percent,
             included_bed_days, extra_bed_rate, package_type
      FROM billing_packages WHERE id = ? AND tenant_id = ?
    `).bind((admission as any).package_id, tenantId).first();
  }
  const admissionBilling = calculateAdmissionPackageBilling({
    packageInfo: packageInfo ? {
      totalPrice: Number(packageInfo.total_price ?? 0),
      packageType: packageInfo.package_type,
      includedBedDays: Number(packageInfo.included_bed_days ?? 0),
      extraBedRate: Number(packageInfo.extra_bed_rate ?? 0),
    } : null,
    provisionalTotal,
    bedChargePolicy,
    beds: (bedInfos as any[]).map((bed) => ({
      id: bed.id,
      ratePerDay: Number(bed.rate_per_day || 0),
      startedOn: bed.started_on,
      endedOn: bed.ended_on || undefined,
      data: {
        id: bed.id,
        ward_name: bed.ward_name,
        bed_number: bed.bed_number,
        bed_type: bed.bed_type,
        rate_per_day: bed.rate_per_day,
        started_on: bed.started_on,
        ended_on: bed.ended_on,
      },
    })),
  });
  const bedChargeSegments = admissionBilling.bedChargeSegments;
  const bedTotal = admissionBilling.bedTotal;

  // Get deposit balance
  const deposit = await db.$client.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0) as balance
    FROM billing_deposits WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
  `).bind(tenantId, (admission as any).patient_id).first<{ balance: number }>();

  // Get hospital name
  const setting = await db.$client.prepare(
    `SELECT value FROM settings WHERE tenant_id = ? AND key = 'hospital_name'`
  ).bind(tenantId).first<{ value: string }>();

  const hospitalName = setting?.value ?? 'Hospital';
  const admissionData = admission as any;
  const grandTotal = admissionBilling.grandTotal;
  const depositBalance = deposit?.balance || 0;
  const netPayable = Math.max(0, grandTotal - depositBalance);

  // Format date helper
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  const fmtDateTime = (d: string) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
  const fmtTaka = (n: number) => `৳${Number(n || 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  // Build item rows
  let itemRows = '';
  let idx = 1;
  for (const item of items as any[]) {
    itemRows += `<tr>
      <td>${idx++}</td>
      <td>${fmtDateTime(item.created_at)}</td>
      <td><span class="badge">${escapeHtml(item.item_category)}</span></td>
      <td>${escapeHtml(item.item_name)}</td>
      <td class="text-right">${item.quantity}</td>
      <td class="text-right">${fmtTaka(item.unit_price)}</td>
      <td class="text-right">${item.discount_percent || 0}%</td>
      <td class="text-right font-bold">${fmtTaka(item.total_amount)}</td>
    </tr>`;
  }

  if (packageInfo && admissionBilling.packageTotal > 0) {
    itemRows += `<tr>
      <td>${idx++}</td>
      <td>${fmtDateTime(admissionData.admission_date)}</td>
      <td><span class="badge">admission_package</span></td>
      <td>Package: ${escapeHtml(packageInfo.package_name)}</td>
      <td class="text-right">1</td>
      <td class="text-right">${fmtTaka(admissionBilling.packageTotal)}</td>
      <td class="text-right">0%</td>
      <td class="text-right font-bold">${fmtTaka(admissionBilling.packageTotal)}</td>
    </tr>`;
  }

  // Build bed charge rows
  for (const bed of bedChargeSegments) {
    const startedOn = typeof bed.started_on === 'string' ? bed.started_on : '';
    const wardName = typeof bed.ward_name === 'string' ? bed.ward_name : '';
    const bedNumber = typeof bed.bed_number === 'string' ? bed.bed_number : '';
    const bedType = typeof bed.bed_type === 'string' ? bed.bed_type : '';
    const ratePerDay = Number(bed.rate_per_day ?? 0);
    itemRows += `<tr class="bed-row">
      <td>${idx++}</td>
      <td>${fmtDateTime(startedOn)}</td>
      <td><span class="badge badge-warning">bed_charge</span></td>
      <td>${escapeHtml(wardName) || 'Ward'} — Bed ${escapeHtml(bedNumber)} (${escapeHtml(bedType)})</td>
      <td class="text-right">${bed.days} days</td>
      <td class="text-right">${fmtTaka(ratePerDay)}/day</td>
      <td class="text-right">0%</td>
      <td class="text-right font-bold">${fmtTaka(Number(bed.charge_amount ?? bed.amount ?? 0))}</td>
    </tr>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Running Bill - ${escapeHtml(admissionData.patient_name)}</title>
<style>
  @page { size: A5; margin: 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 12.5px; line-height: 1.48; color: #222; padding: 8px; }
  .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 10px; }
  .header h1 { font-size: 18px; margin: 0; }
  .header p { font-size: 11.5px; color: #555; margin: 2px 0; }
  .title { text-align: center; font-size: 15px; font-weight: bold; margin: 10px 0; text-transform: uppercase; background: #f3f4f6; padding: 6px; border: 1px solid #ddd; }
  .patient-info { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; font-size: 12px; }
  .patient-info div strong { display: inline-block; width: 92px; }
  .financial-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
  .financial-card { border: 1px solid #ddd; border-radius: 6px; padding: 8px; text-align: center; }
  .financial-card .label { font-size: 10.5px; color: #555; text-transform: uppercase; }
  .financial-card .value { font-size: 16px; font-weight: bold; margin-top: 2px; }
  .financial-card .value.green { color: #059669; }
  .financial-card .value.blue { color: #2563eb; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11.5px; }
  th { background: #f3f4f6; padding: 6px 4px; text-align: left; font-weight: 700; border-bottom: 2px solid #ddd; }
  td { padding: 5px 4px; border-bottom: 1px solid #eee; }
  .text-right { text-align: right; }
  .font-bold { font-weight: bold; }
  .bed-row { background: #fef3c7; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 10px; font-weight: 700; background: #dbeafe; color: #1e40af; }
  .badge-warning { background: #fef3c7; color: #92400e; }
  .totals { border-top: 2px solid #333; padding-top: 8px; }
  .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12.5px; }
  .totals-row.grand { font-size: 15px; font-weight: bold; border-top: 1px solid #999; padding-top: 6px; margin-top: 3px; }
  .footer { text-align: center; font-size: 10.5px; color: #777; margin-top: 15px; border-top: 1px solid #ddd; padding-top: 5px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
  <div class="header">
    <h1>${escapeHtml(hospitalName)}</h1>
    <p>IPD Provisional Billing — Running Bill</p>
  </div>
  <div class="title">Running Bill / রানিং বিল</div>
  <div class="patient-info">
    <div><strong>Patient:</strong> ${escapeHtml(admissionData.patient_name) || '-'}</div>
    <div><strong>Patient ID:</strong> ${escapeHtml(admissionData.patient_code) || '-'}</div>
    <div><strong>Admission:</strong> ${escapeHtml(admissionData.admission_no) || '-'}</div>
    <div><strong>Admitted:</strong> ${fmtDate(admissionData.admission_date)}</div>
    <div><strong>Ward/Bed:</strong> ${escapeHtml(admissionData.ward_name) || '-'} — ${escapeHtml(admissionData.bed_number) || '-'} (${escapeHtml(admissionData.bed_type) || '-'})</div>
    <div><strong>Doctor:</strong> ${escapeHtml(admissionData.doctor_name) || '-'}</div>
    ${admissionData.patient_phone ? `<div><strong>Phone:</strong> ${escapeHtml(admissionData.patient_phone)}</div>` : ''}
    ${admissionData.provisional_diagnosis ? `<div><strong>Diagnosis:</strong> ${escapeHtml(admissionData.provisional_diagnosis)}</div>` : ''}
  </div>
  <div class="financial-summary">
    <div class="financial-card">
      <div class="label">Advance Deposit</div>
      <div class="value green">${fmtTaka(depositBalance)}</div>
    </div>
    <div class="financial-card">
      <div class="label">Total Charges</div>
      <div class="value blue">${fmtTaka(grandTotal)}</div>
    </div>
    <div class="financial-card">
      <div class="label">Current Balance</div>
      <div class="value green">${fmtTaka(depositBalance - grandTotal)}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Date & Time</th>
        <th>Category</th>
        <th>Item</th>
        <th class="text-right">Qty</th>
        <th class="text-right">Price</th>
        <th class="text-right">Disc</th>
        <th class="text-right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>
  <div class="totals">
    <div class="totals-row"><span>Provisional Total:</span><span>${fmtTaka(provisionalTotal)}</span></div>
    ${admissionBilling.packageTotal > 0 ? `<div class="totals-row"><span>Package Charges:</span><span>${fmtTaka(admissionBilling.packageTotal)}</span></div>` : ''}
    <div class="totals-row"><span>Bed Charges:</span><span>${fmtTaka(bedTotal)}</span></div>
    <div class="totals-row grand"><span>Grand Total:</span><span>${fmtTaka(grandTotal)}</span></div>
    <div class="totals-row"><span>Deposit Balance:</span><span>${fmtTaka(depositBalance)}</span></div>
    <div class="totals-row grand"><span>Net Payable:</span><span>${fmtTaka(netPayable)}</span></div>
  </div>
  <div class="footer">
    Admission ID: ${admissionData.id} | Status: ${admissionData.status} | Generated: ${new Date().toLocaleString()}
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print()},500)};</script>
</body></html>`;

  return c.html(html);
  } catch (err) {
    console.error('[ipBilling/print] Error:', err);
    throw err;
  }
});


// ─── DELETE /pending/:admissionId/bed-charges/:bedInfoId — remove auto bed charge ──

ipBilling.delete('/pending/:admissionId/bed-charges/:bedInfoId', requireRole(...IP_BILLING_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const admissionId = Number(c.req.param('admissionId'));
  const bedInfoId = Number(c.req.param('bedInfoId'));

  if (!Number.isInteger(admissionId) || admissionId <= 0) {
    throw new HTTPException(400, { message: 'Invalid admission ID' });
  }
  if (!Number.isInteger(bedInfoId) || bedInfoId <= 0) {
    throw new HTTPException(400, { message: 'Invalid bed charge ID' });
  }

  const bedInfo = await db.$client.prepare(`
    SELECT id, admission_id, patient_id, bed_id, days, charge_amount, is_billed
    FROM patient_bed_infos
    WHERE id = ? AND admission_id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(bedInfoId, admissionId, tenantId).first<{
    id: number;
    admission_id: number;
    patient_id: number;
    bed_id: number;
    days: number | null;
    charge_amount: number | null;
    is_billed: number | null;
  }>();

  if (!bedInfo) throw new HTTPException(404, { message: 'Bed charge not found' });
  if (Number(bedInfo.is_billed ?? 0) === 1) {
    throw new HTTPException(409, { message: 'Bed charge is already billed or removed' });
  }

  await db.$client.batch([
    db.$client.prepare(`
      UPDATE patient_bed_infos
      SET is_billed = 1,
          billed_bill_id = NULL,
          charge_amount = 0
      WHERE id = ? AND admission_id = ? AND tenant_id = ? AND is_billed = 0
    `).bind(bedInfoId, admissionId, tenantId),
    db.$client.prepare(`
      INSERT INTO bed_charge_logs (tenant_id, patient_bed_info_id, admission_id, bed_id, old_days, new_days, old_amount, new_amount, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      bedInfoId,
      admissionId,
      bedInfo.bed_id,
      Number(bedInfo.days ?? 0),
      Number(bedInfo.days ?? 0),
      Number(bedInfo.charge_amount ?? 0),
      0,
      'Removed from IPD running bill',
      userId,
    ),
  ]);

  await createAuditLog(c.env, tenantId, userId, 'DELETE', 'patient_bed_infos', bedInfoId, {
    admission_id: admissionId,
    charge_amount: Number(bedInfo.charge_amount ?? 0),
  }, {
    admission_id: admissionId,
    charge_amount: 0,
    removed_from_running_bill: true,
  });

  return c.json({ success: true, message: 'Auto bed charge removed from running bill' });
});

// ─── POST /provisional — add provisional charge ─────────────────────────────

ipBilling.post('/provisional', requireRole(...IP_BILLING_ROLES), zValidator('json', z.object({
  patient_id: z.number().int().positive(),
  admission_id: z.number().int().positive().optional(),
  visit_id: z.number().int().positive().optional(),
  service_item_id: z.number().int().positive().optional(),
  item_category: z.string().min(1).optional(),
  item_name: z.string().min(1).optional(),
  department: z.string().optional(),
  unit_price: z.number().min(0).optional(),
  quantity: z.number().int().positive().default(1),
  discount_percent: z.number().min(0).max(100).default(0),
  doctor_id: z.number().int().positive().optional(),
  doctor_name: z.string().optional(),
  reference_id: z.number().int().positive().optional(),
}).refine((data) => Boolean(data.service_item_id ?? data.reference_id), {
  message: 'service_item_id is required so IP billing uses catalog pricing',
  path: ['service_item_id'],
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const serviceItemId = Number(data.service_item_id ?? data.reference_id);
  const serviceItem = await loadIpBillingServiceItem(db, tenantId, serviceItemId);
  if (!serviceItem) throw new HTTPException(400, { message: 'Invalid service item' });

  if (data.admission_id) {
    const admission = await db.$client.prepare(
      `SELECT patient_id, status FROM admissions WHERE id = ? AND tenant_id = ?`
    ).bind(data.admission_id, tenantId).first<{ patient_id: number; status: string }>();
    if (!admission) throw new HTTPException(404, { message: 'Admission not found' });
    if (Number(admission.patient_id) !== Number(data.patient_id)) {
      throw new HTTPException(400, { message: 'patient_id does not match admission_id' });
    }
    if (!['admitted', 'critical', 'transferred'].includes(String(admission.status))) {
      throw new HTTPException(409, { message: 'Cannot add IPD provisional charge to an inactive admission' });
    }
  }
  if (data.quantity > 1 && Number(serviceItem.allow_multiple_qty ?? 1) !== 1) {
    throw new HTTPException(400, { message: `${serviceItem.item_name} does not allow multiple quantity` });
  }
  if (data.discount_percent > 0 && Number(serviceItem.allow_discount ?? 1) !== 1) {
    throw new HTTPException(400, { message: `${serviceItem.item_name} does not allow discount` });
  }

  const unitPrice = Number(serviceItem.price ?? 0);
  const discountAmt = Math.round((unitPrice * data.quantity * (data.discount_percent / 100)) * 100) / 100;
  const totalAmt = Math.max(0, Math.round((unitPrice * data.quantity - discountAmt) * 100) / 100);
  const itemCategory = data.item_category ?? inferIpBillingCategory(serviceItem);

  const result = await db.$client.prepare(`
    INSERT INTO billing_provisional_items (tenant_id, patient_id, admission_id, visit_id, item_category, item_name, department,
      unit_price, quantity, discount_percent, discount_amount, total_amount, doctor_id, doctor_name, reference_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.patient_id, data.admission_id || null, data.visit_id || null, itemCategory, serviceItem.item_name,
    data.department || serviceItem.department_name || null, unitPrice, data.quantity, data.discount_percent, discountAmt, totalAmt,
    data.doctor_id || null, data.doctor_name || null, serviceItemId, userId).run();

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'billing_provisional_items', Number(result.meta.last_row_id), null, {
    patient_id: data.patient_id,
    admission_id: data.admission_id,
    item_name: serviceItem.item_name,
    total_amount: totalAmt,
  });

  // Create IPD ledger entry for the provisional charge
  if (data.admission_id) {
    try {
      await createIpdLedgerEntry(db, {
        tenantId, admissionId: data.admission_id, patientId: data.patient_id,
        entryType: 'charge', category: itemCategory, description: serviceItem.item_name,
        debitAmount: totalAmt, creditAmount: 0,
        createdBy: userId,
      });
    } catch (ledgerErr) {
      console.error('[ipBilling] Failed to create ledger entry for provisional charge:', ledgerErr);
    }
  }

  return c.json({ id: result.meta.last_row_id, total_amount: totalAmt, message: 'Provisional charge added' }, 201);
});

// ─── POST /discharge-bill — finalize discharge bill ──────────────────────────

ipBilling.post('/discharge-bill', requireRole(...IP_BILLING_ROLES), zValidator('json', z.object({
  admission_id: z.number().int().positive(),
  discount_percent: z.number().min(0).max(100).default(0),
  discount_amount: z.number().min(0).optional(),
  discount_by_name: z.string().trim().max(200).optional(),
  reason_code: z.string().trim().default('normal_hospital_discount'),
  deposit_deducted: z.number().min(0).default(0),
  payment_mode: z.string().default('cash'),
  payment_reference: z.string().trim().max(200).optional(),
  paid_amount: z.number().min(0).default(0),
  discharge_condition_id: z.number().int().positive().optional(),
  discharge_type: z.string().optional(),
  remarks: z.string().optional(),
  confirm_excess_deposit_refund: z.boolean().default(false),
  refund_note: z.string().trim().max(500).optional(),
  discharge_mode: z.enum(['settled', 'credit_pending']).default('settled'),
  credit_reason: z.string().trim().max(500).optional(),
  expected_payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected payment date must be YYYY-MM-DD').optional(),
  confirm_credit_discharge: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'ipd-discharge.billing.finalize');
  const isCreditDischarge = data.discharge_mode === 'credit_pending';
  const mutationType = 'ipd_discharge_bill';
  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ ...data, idempotencyKey: undefined })
    : null;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId: String(tenantId),
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different IPD discharge request',
      conflictMessage: 'IPD discharge request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
  }

  if (isCreditDischarge && !data.credit_reason?.trim()) {
    throw new HTTPException(400, { message: 'Credit discharge reason is required.' });
  }
  if (isCreditDischarge && !data.expected_payment_date) {
    throw new HTTPException(400, { message: 'Expected payment date is required for credit discharge.' });
  }
  if (isCreditDischarge && !data.confirm_credit_discharge) {
    throw new HTTPException(400, { message: 'Credit discharge acknowledgement is required.' });
  }

  const activeCounterSession = await loadActiveBillingCounterSession(c.env.DB, String(tenantId), String(userId), {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeCounterSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before creating discharge bills.' });
  }
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, String(tenantId), today, 'IP discharge bill creation');
  const bedChargePolicy = await loadBedChargePolicy(db.$client, String(tenantId));

  const admission = await db.$client.prepare(
    "SELECT * FROM admissions WHERE id = ? AND tenant_id = ? AND status IN ('admitted', 'critical')"
  ).bind(data.admission_id, tenantId).first<any>();
  if (!admission) throw new HTTPException(404, { message: 'Active admission not found' });

  const admissionDate = admission.admission_date ?? admission.admitted_at ?? null;
  const blockingBilling = await getPendingDischargeBilling(
    c.env.DB,
    String(tenantId),
    data.admission_id,
    Number(admission.patient_id),
    admissionDate,
    { includeProvisional: false },
  );
  if (blockingBilling.pendingServiceAmount > 0) {
    throw new HTTPException(409, {
      message: `Cannot discharge while pending visit services remain (amount ${blockingBilling.pendingServiceAmount}). Bill, cancel, or resolve those services first.`,
    });
  }

  const externalFinancialClearance = await loadPatientOutstandingFinancialClearance({
    db: c.env.DB,
    tenantId: String(tenantId),
    patientId: Number(admission.patient_id),
  });
  const externalOutstandingAmount = minorToMajor(externalFinancialClearance.totalOutstandingMinor);
  if (!isCreditDischarge && externalFinancialClearance.totalOutstandingMinor > 0) {
    throw new HTTPException(409, {
      message: `Patient has ৳${externalOutstandingAmount.toLocaleString('en-BD')} outstanding in other invoices. Collect the due or use credit discharge with higher-authority approval.`,
    });
  }

  // Get provisional items
  const { results: provItems } = await db.$client.prepare(
    "SELECT * FROM billing_provisional_items WHERE tenant_id = ? AND admission_id = ? AND bill_status = 'provisional' AND is_active = 1"
  ).bind(tenantId, data.admission_id).all<any>();

  let packageInfo: any = null;
  if (admission.package_id) {
    packageInfo = await db.$client.prepare(`
      SELECT id, package_name, package_code, description, total_price, discount_percent,
             included_bed_days, extra_bed_rate, package_type
      FROM billing_packages WHERE id = ? AND tenant_id = ?
    `).bind(admission.package_id, tenantId).first();
  }

  // Get unbilled bed charge segments
  const { results: bedInfos } = await db.$client.prepare(`
    SELECT * FROM patient_bed_infos
    WHERE tenant_id = ? AND admission_id = ? AND is_billed = 0
    ORDER BY started_on ASC
  `).bind(tenantId, data.admission_id).all<any>();

  const provTotal = provItems.reduce((sum, i) => sum + (i.total_amount || 0), 0);
  const admissionBilling = calculateAdmissionPackageBilling({
    packageInfo: packageInfo ? {
      totalPrice: Number(packageInfo.total_price ?? 0),
      packageType: packageInfo.package_type,
      includedBedDays: Number(packageInfo.included_bed_days ?? 0),
      extraBedRate: Number(packageInfo.extra_bed_rate ?? 0),
    } : null,
    provisionalTotal: provTotal,
    bedChargePolicy,
    beds: bedInfos.map((bed) => ({
      id: bed.id,
      ratePerDay: Number(bed.rate_per_day || 0),
      startedOn: bed.started_on,
      endedOn: bed.ended_on || undefined,
      data: bed,
    })),
  });
  const bedTotal = admissionBilling.bedTotal;
  const bedChargeSegments = admissionBilling.bedChargeSegments;
  const packageTotal = admissionBilling.packageTotal;
  const subtotal = admissionBilling.grandTotal;
  const requestedDiscountAmount = Math.max(0, Number(data.discount_amount ?? 0) || 0);
  const percentDiscountAmount = Math.round(subtotal * (data.discount_percent / 100) * 100) / 100;
  const discountAmt = Math.min(subtotal, Math.round((requestedDiscountAmount > 0 ? requestedDiscountAmount : percentDiscountAmount) * 100) / 100);
  const totalAmt = Math.max(0, Math.round((subtotal - discountAmt) * 100) / 100);
  assertDiscountReferralNameForHighDiscount(subtotal, discountAmt, data.discount_by_name);
  const highDiscountApprovedBy = subtotal > 0 && discountAmt > 0 && (discountAmt / subtotal) * 100 > 20 ? userId : null;

  // Check deposit balance upfront
  const depositBalance = await getPatientDepositBalance(c.env.DB, tenantId, Number(admission.patient_id));
  const requestedDeposit = Math.min(depositBalance, data.deposit_deducted);
  const refundAmount = requestedDeposit > totalAmt ? Math.round((requestedDeposit - totalAmt) * 100) / 100 : 0;
  const depositAdjustment = Math.min(requestedDeposit, totalAmt);
  const refundNote = data.refund_note?.trim() || '';

  if (refundAmount > 0 && subtotal <= 0) {
    throw new HTTPException(409, {
      message: `Cannot discharge with a deposit refund of ৳${refundAmount} because no billable charge was added. Add the missing charge first, then complete discharge.`,
    });
  }
  if (refundAmount > 0 && (!data.confirm_excess_deposit_refund || !refundNote)) {
    throw new HTTPException(409, {
      message: `Excess deposit refund of ৳${refundAmount} requires explicit confirmation and a refund note before discharge.`,
    });
  }

  const paymentState = calculateBillPaymentState({
    total: totalAmt,
    paidAmount: data.paid_amount,
    depositDeducted: depositAdjustment,
  });
  if (depositAdjustment > 0 && depositAdjustment > depositBalance) {
    throw new HTTPException(400, { message: `Insufficient deposit balance (available: ${depositBalance})` });
  }
  const currentDischargeDueMinor = Math.round(paymentState.due * 100);
  const totalOutstandingMinor = externalFinancialClearance.totalOutstandingMinor + currentDischargeDueMinor;
  const totalOutstandingAmount = minorToMajor(totalOutstandingMinor);
  if (!isCreditDischarge && currentDischargeDueMinor > 0) {
    throw new HTTPException(409, {
      message: `Current discharge bill still has ৳${paymentState.due.toLocaleString('en-BD')} due. Collect the amount or use credit discharge with higher-authority approval.`,
    });
  }
  if (isCreditDischarge && totalOutstandingMinor <= 0) {
    throw new HTTPException(400, { message: 'Credit discharge requires an outstanding balance.' });
  }
  const billStatus = paymentState.status;
  const categoryTotals = calculateBillCategoryTotals([
    ...provItems.map((item) => ({ category: item.item_category, amount: Number(item.total_amount ?? 0) })),
    { category: 'admission', amount: packageTotal },
    { category: 'bed_charge', amount: bedTotal },
  ]);

  let idempotencyReserved = false;
  if (data.idempotencyKey && requestHash) {
    const replay = await reserveMutationIdempotencyKey(c.env.DB, {
      tenantId: String(tenantId),
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      createdBy: userId,
      mismatchMessage: 'Idempotency key was already used for a different IPD discharge request',
      conflictMessage: 'IPD discharge request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
    idempotencyReserved = true;
  }

  try {
  const activeFy = await getActiveFiscalYear(c.env.DB, String(tenantId), today);
  let invoiceNo: string;
  let fiscalYearId: number | null = null;
  const invoiceCode = 'BL';

  if (activeFy) {
    invoiceNo = await getNextFiscalInvoiceNo(c.env.DB, String(tenantId), activeFy.id, invoiceCode);
    fiscalYearId = activeFy.id;
  } else {
    invoiceNo = await getNextInvoiceNumber(c.env.DB, String(tenantId), 'ipd');
    console.warn(`[ipBilling] No active fiscal year for tenant ${tenantId}; falling back to legacy sequence`);
  }
  const dischargeOccurredAtUtc = new Date().toISOString();

  const patientSnapshot = isCreditDischarge
    ? await db.$client.prepare(`
        SELECT name, patient_code, mobile
        FROM patients
        WHERE tenant_id = ? AND id = ?
        LIMIT 1
      `).bind(tenantId, admission.patient_id).first<{
        name: string | null;
        patient_code: string | null;
        mobile: string | null;
      }>()
    : null;
  const creditRequestData = isCreditDischarge
    ? JSON.stringify({
        version: 1,
        approvalKind: CREDIT_DISCHARGE_APPROVAL_KIND,
        actionState: 'executed_pending_review',
        patientId: Number(admission.patient_id),
        patientName: patientSnapshot?.name ?? null,
        patientCode: patientSnapshot?.patient_code ?? null,
        patientMobile: patientSnapshot?.mobile ?? null,
        admissionId: Number(admission.id),
        admissionNo: admission.admission_no ?? null,
        currentInvoiceNo: invoiceNo,
        currentDischargeDueMinor,
        externalOutstandingMinor: externalFinancialClearance.totalOutstandingMinor,
        totalDueMinor: totalOutstandingMinor,
        currencyCode: externalFinancialClearance.currencyCode || 'BDT',
        externalInvoices: externalFinancialClearance.invoices.map((invoice) => ({
          invoiceNumber: invoice.invoiceNumber,
          issuedAtUtc: invoice.issuedAtUtc,
          legacyBillId: invoice.legacyBillId,
          canonicalInvoicePublicId: invoice.canonicalInvoicePublicId,
          sourceLabel: invoice.sourceLabel,
          dueMinor: invoice.dueMinor,
          categories: invoice.categories,
        })),
        creditReason: data.credit_reason!.trim(),
        expectedPaymentDate: data.expected_payment_date,
        requesterAcknowledged: data.confirm_credit_discharge,
        requestedBy: Number(userId),
        requesterRole: c.get('role') ?? null,
        counterId: Number(activeCounterSession.counter_id),
        counterSessionId: Number(activeCounterSession.id),
      })
    : null;

  const billIdLookupSql = `(SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? ORDER BY id DESC LIMIT 1)`;

  const nonCriticalBatchIndexes = new Set<number>();
  const batchStmts: any[] = [
    db.$client.prepare(`INSERT INTO bills (patient_id, visit_id, admission_id, invoice_no, fiscal_year_id, invoice_code, subtotal, test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill, discount, discount_by_name, total, paid, due, status, is_insurance_billing, co_payment_amount, tenant_id, created_by, counter_id, counter_session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      admission.patient_id, admission.visit_id || null, admission.id, invoiceNo, fiscalYearId, invoiceCode, subtotal,
      categoryTotals.testBill, categoryTotals.doctorVisitBill, categoryTotals.admissionBill,
      categoryTotals.operationBill, categoryTotals.medicineBill,
      discountAmt, data.discount_by_name?.trim() || null, totalAmt, paymentState.paid, paymentState.due, billStatus,
      0, 0, tenantId, userId, activeCounterSession.counter_id, activeCounterSession.id,
    ),
  ];

  if (discountAmt > 0) {
    const split = splitDiscountAllocation({
      billGrossAmount: subtotal,
      totalDiscount: discountAmt,
      discountReason: data.reason_code,
      referenceName: data.discount_by_name,
      note: data.remarks,
    });
    for (const row of split.allocations) {
      batchStmts.push(
        db.$client.prepare(`
          INSERT INTO bill_discount_allocations
            (tenant_id, bill_id, allocation_type, discount_reason, doctor_id, amount, percent, reference_name, note, created_by)
          VALUES (?, ${billIdLookupSql}, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          tenantId,
          tenantId,
          invoiceNo,
          row.allocationType,
          row.discountReason,
          row.doctorId,
          row.amount,
          row.percent,
          row.referenceName,
          row.note,
          userId,
        ),
      );
    }
  }

  let depositAdjustmentReceiptNo: string | null = null;
  let paymentReceiptNo: string | null = null;

  // Convert provisional items to invoice items
  for (const item of provItems) {
    batchStmts.push(
      db.$client.prepare(`
        INSERT INTO invoice_items (bill_id, item_category, description, quantity, unit_price, line_total, reference_id, tenant_id)
        VALUES (${billIdLookupSql}, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        invoiceNo,
        getDischargeInvoiceItemCategory(item.item_category),
        item.item_name,
        item.quantity,
        item.unit_price,
        item.total_amount,
        item.reference_id,
        tenantId,
      )
    );
    batchStmts.push(
      db.$client.prepare(`
        UPDATE billing_provisional_items
        SET bill_status = 'finalized', billed_bill_id = ${billIdLookupSql}
        WHERE id = ? AND tenant_id = ? AND patient_id = ? AND admission_id = ?
          AND item_category = ? AND item_name = ? AND quantity = ? AND unit_price = ?
          AND COALESCE(discount_amount, 0) = ? AND total_amount = ?
          AND bill_status = 'provisional' AND is_active = 1
      `).bind(
        tenantId,
        invoiceNo,
        item.id,
        tenantId,
        admission.patient_id,
        data.admission_id,
        item.item_category,
        item.item_name,
        item.quantity,
        item.unit_price,
        Number(item.discount_amount ?? 0),
        item.total_amount,
      )
    );
  }

  if (packageInfo && packageTotal > 0) {
    batchStmts.push(
      db.$client.prepare(`
        INSERT INTO invoice_items (bill_id, item_category, description, quantity, unit_price, line_total, reference_id, tenant_id)
        VALUES (${billIdLookupSql}, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        invoiceNo,
        'admission',
        `Package: ${packageInfo.package_name}`,
        1,
        packageTotal,
        packageTotal,
        packageInfo.id,
        tenantId,
      )
    );
  }

  // Add bed charge invoice items and mark bed infos as billed
  for (const bed of bedChargeSegments) {
    batchStmts.push(
      db.$client.prepare(`
        INSERT INTO invoice_items (bill_id, item_category, description, quantity, unit_price, line_total, reference_id, tenant_id)
        VALUES (${billIdLookupSql}, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        invoiceNo,
        getDischargeInvoiceItemCategory('bed_charge'),
        `${bed.ward_name || ''} - Bed ${bed.bed_number || ''} (${bed.bed_type || ''})`,
        Math.max(1, Number(bed.chargeable_days ?? bed.days ?? 1)),
        Number(bed.amount ?? 0) > 0 ? Number(bed.amount ?? 0) / Math.max(1, Number(bed.chargeable_days ?? bed.days ?? 1)) : 0,
        bed.amount,
        bed.id,
        tenantId,
      )
    );
    batchStmts.push(
      db.$client.prepare(`
        UPDATE patient_bed_infos SET is_billed = 1, billed_bill_id = ${billIdLookupSql},
          ended_on = COALESCE(ended_on, datetime('now', '+6 hours')),
          days = CASE WHEN ended_on IS NULL THEN ? ELSE days END,
          charge_amount = CASE WHEN ended_on IS NULL THEN ? ELSE charge_amount END
        WHERE id = ? AND tenant_id = ? AND admission_id = ? AND bed_id = ?
          AND is_billed = 0 AND rate_per_day = ? AND started_on = ?
          AND COALESCE(ended_on, '') = COALESCE(?, '')
      `).bind(
        tenantId,
        invoiceNo,
        bed.days,
        bed.amount,
        bed.id,
        tenantId,
        data.admission_id,
        bed.bed_id,
        Number(bed.rate_per_day ?? 0),
        bed.started_on,
        bed.ended_on ?? null,
      )
    );
  }

  // Deduct deposit if used
  if (paymentState.depositDeducted > 0) {
    const receiptNo = await getNextSequence(c.env.DB, String(tenantId), 'deposit_adj', 'DAD');
    depositAdjustmentReceiptNo = receiptNo;
    batchStmts.push(
      db.$client.prepare(`
        INSERT INTO billing_deposits (tenant_id, patient_id, deposit_receipt_no, amount, transaction_type, reference_bill_id, remarks, created_by, counter_id, counter_session_id)
        VALUES (?, ?, ?, ?, 'adjustment', ${billIdLookupSql}, 'Discharge bill deduction', ?, ?, ?)
      `).bind(
        tenantId, admission.patient_id, receiptNo, paymentState.depositDeducted, tenantId, invoiceNo, userId,
        activeCounterSession.counter_id, activeCounterSession.id
      )
    );
  }

  // Refund excess deposit if deposit > total (with race-condition guard)
  let refundReceiptNo: string | null = null;
  if (refundAmount > 0) {
    refundReceiptNo = await getNextSequence(c.env.DB, String(tenantId), 'deposit_refund', 'DRF');
    const refundIdLookup = '(SELECT id FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ? LIMIT 1)';
    // Conditional INSERT: only insert if sufficient balance exists (prevents negative deposit)
    batchStmts.push(
      db.$client.prepare(`
        INSERT INTO billing_deposits (tenant_id, patient_id, deposit_receipt_no, amount, transaction_type, remarks, created_by, counter_id, counter_session_id)
        SELECT ?, ?, ?, ?, 'refund', ?, ?, ?, ?
        WHERE (
          SELECT
            COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0)
          FROM billing_deposits
          WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ) >= ?
      `).bind(
        tenantId, admission.patient_id, refundReceiptNo, refundAmount,
        refundNote || 'Discharge refund - excess deposit', userId,
        activeCounterSession.counter_id, activeCounterSession.id,
        tenantId, admission.patient_id, refundAmount
      )
    );
    // Counter cash out for refund
    batchStmts.push(
      db.$client.prepare(`
        INSERT INTO emp_cash_transactions (tenant_id, employee_id, counter_id, counter_session_id, transaction_type, amount, reference_id, reference_type, payment_method, description)
        SELECT ?, ?, ?, ?, 'ReturnDeposit', ?, ${refundIdLookup}, 'deposit_refund', 'cash', ?
        WHERE EXISTS (SELECT 1 FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ?)
      `).bind(
        tenantId, Number(userId), activeCounterSession.counter_id, activeCounterSession.id,
        refundAmount, tenantId, refundReceiptNo,
        `Discharge refund ${refundReceiptNo}${refundNote ? ` - ${refundNote}` : ''}`,
        tenantId, refundReceiptNo
      )
    );
  }

  if (paymentState.paid > 0) {
    const receiptNo = await getNextSequence(c.env.DB, String(tenantId), 'receipt', 'RCP');
    paymentReceiptNo = receiptNo;
    batchStmts.push(
      db.$client.prepare(`
        INSERT INTO payments (bill_id, amount, payment_type, receipt_no, received_by, payment_method, counter_id, counter_session_id, tenant_id, date)
        VALUES (${billIdLookupSql}, ?, 'current', ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
      `).bind(
        tenantId, invoiceNo, paymentState.paid, receiptNo, userId, data.payment_mode,
        activeCounterSession.counter_id, activeCounterSession.id, tenantId
      )
    );
    batchStmts.push(
      db.$client.prepare(`
        INSERT INTO emp_cash_transactions
          (tenant_id, employee_id, counter_id, counter_session_id, transaction_type, amount, reference_id, reference_type, payment_method, description)
        VALUES (?, ?, ?, ?, 'CashSales', ?, ${billIdLookupSql}, 'bill', ?, ?)
      `).bind(
        tenantId, userId, activeCounterSession.counter_id, activeCounterSession.id,
        paymentState.paid, tenantId, invoiceNo, data.payment_mode, `Discharge bill payment ${receiptNo}`
      )
    );
  }

  let approvalInsertBatchIndex: number | null = null;
  if (isCreditDischarge && creditRequestData) {
    approvalInsertBatchIndex = batchStmts.length;
    const approvalRequestLookupSql = `(
      SELECT id
      FROM approval_requests
      WHERE tenant_id = ?
        AND type = ?
        AND json_extract(request_data, '$.approvalKind') = ?
        AND entity_id = ?
        AND status = 'pending'
      ORDER BY id DESC
      LIMIT 1
    )`;
    batchStmts.push(
      db.$client.prepare(`
        INSERT INTO approval_requests (
          tenant_id, type, entity_id, entity_no, requested_by, request_data,
          status, execution_status
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'not_required')
      `).bind(
        tenantId,
        CREDIT_DISCHARGE_APPROVAL_STORAGE_TYPE,
        data.admission_id,
        admission.admission_no ?? `ADM-${data.admission_id}`,
        userId,
        creditRequestData,
      ),
      db.$client.prepare(`
        INSERT INTO approval_events (
          tenant_id, approval_request_id, action, actor_id, old_status,
          new_status, notes, metadata
        ) VALUES (?, ${approvalRequestLookupSql}, 'created', ?, NULL, 'pending', ?, ?)
      `).bind(
        tenantId,
        tenantId,
        CREDIT_DISCHARGE_APPROVAL_STORAGE_TYPE,
        CREDIT_DISCHARGE_APPROVAL_KIND,
        data.admission_id,
        userId,
        data.credit_reason!.trim(),
        JSON.stringify({
          actionState: 'executed_pending_review',
          totalDueMinor: totalOutstandingMinor,
          invoiceNo,
        }),
      ),
      db.$client.prepare(`
        INSERT INTO notifications (tenant_id, user_id, type, title, message, link)
        SELECT ?, u.id, 'credit_discharge_approval', ?, ?, '/admin/approvals'
        FROM users u
        WHERE u.tenant_id = ?
          AND COALESCE(u.is_active, 1) = 1
          AND u.role IN ('hospital_admin', 'manager', 'director', 'md', 'accountant')
          AND u.id != ?
      `).bind(
        tenantId,
        `Credit discharge approval: ${admission.admission_no ?? `ADM-${data.admission_id}`}`,
        `${patientSnapshot?.name ?? `Patient #${admission.patient_id}`} was discharged with ৳${totalOutstandingAmount.toLocaleString('en-BD')} outstanding. Review required.`,
        tenantId,
        Number(userId),
      ),
    );
    nonCriticalBatchIndexes.add(approvalInsertBatchIndex + 2);
  }

  // Update admission status with discharge metadata
  const dischargeConditionClause = data.discharge_condition_id ? ', discharge_condition_id = ?' : '';
  const dischargeTypeClause = data.discharge_type ? ', discharge_type = ?' : '';
  const dischargeConditionParam = data.discharge_condition_id ? [data.discharge_condition_id] : [];
  const dischargeTypeParam = data.discharge_type ? [data.discharge_type] : [];
  const dischargeFinancialStatus = isCreditDischarge ? 'credit_pending' : 'paid';
  batchStmts.push(
    db.$client.prepare(`
      UPDATE admissions SET status = 'discharged', discharge_date = datetime('now', '+6 hours'), bill_status_on_discharge = '${dischargeFinancialStatus}', updated_at = datetime('now', '+6 hours')${dischargeConditionClause}${dischargeTypeClause} WHERE id = ? AND tenant_id = ? AND status IN ('admitted', 'critical') AND patient_id = ?
    `).bind(...dischargeConditionParam, ...dischargeTypeParam, data.admission_id, tenantId, admission.patient_id)
  );

  // Move bed to post-discharge cleaning and close any remaining open bed infos
  if (admission.bed_id) {
    batchStmts.push(
      db.$client.prepare("UPDATE beds SET status = 'cleaning' WHERE id = ? AND tenant_id = ?").bind(admission.bed_id, tenantId)
    );
    nonCriticalBatchIndexes.add(batchStmts.length);
    batchStmts.push(
      db.$client.prepare(`
        UPDATE patient_bed_infos SET ended_on = datetime('now', '+6 hours'),
          days = MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1),
          charge_amount = rate_per_day * MAX(1, CAST((julianday(datetime('now', '+6 hours')) - julianday(started_on)) AS INTEGER) + 1)
        WHERE tenant_id = ? AND admission_id = ? AND bed_id = ? AND ended_on IS NULL
      `).bind(tenantId, data.admission_id, admission.bed_id)
    );
  }

  const preparedLegacy = prepareIpdDischargeLegacyStatements(db.$client, {
    tenantId: String(tenantId),
    operationKey: `ipd-discharge:${invoiceNo}`,
    statements: batchStmts,
    critical: batchStmts
      .map((_, statementIndex) => ({ statementIndex, stepKey: `legacy-step-${statementIndex + 1}`, expectedChanges: 1 }))
      .filter((entry) => !nonCriticalBatchIndexes.has(entry.statementIndex)),
  });

  let financialExecution: Awaited<ReturnType<typeof executeStrictFinancialMutation>> | null = null;
  try {
    financialExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'ipd-discharge.billing.finalize',
      legacyStatements: preparedLegacy.statements,
      canonical: async (execution) => {
        const projection = await buildIpdDischargeBillingProjection({
          tenantId: String(tenantId),
          patientId: Number(admission.patient_id),
          admissionId: Number(data.admission_id),
          invoiceNo,
          issuedAtUtc: dischargeOccurredAtUtc,
          businessDate: today,
          dischargeMode: data.discharge_mode,
          finalTotal: totalAmt,
          globalDiscount: discountAmt,
          provisionalItems: provItems.map((item) => ({
            id: Number(item.id),
            patientId: Number(item.patient_id),
            category: String(item.item_category || 'provisional'),
            description: String(item.item_name),
            department: item.department ?? null,
            quantity: Number(item.quantity || 1),
            unitPrice: Number(item.unit_price || 0),
            discountAmount: Number(item.discount_amount ?? 0),
            totalAmount: Number(item.total_amount ?? 0),
            doctorId: item.doctor_id == null ? null : Number(item.doctor_id),
            doctorName: item.doctor_name ?? null,
            referenceId: item.reference_id == null ? null : Number(item.reference_id),
          })),
          package: packageInfo && packageTotal > 0 ? {
            packageId: Number(packageInfo.id),
            name: `Package: ${packageInfo.package_name}`,
            amount: packageTotal,
          } : null,
          bedSegments: bedChargeSegments.map((bed) => ({
            patientBedInfoId: Number(bed.id),
            bedId: Number(bed.bed_id),
            description: `${bed.ward_name || ''} - Bed ${bed.bed_number || ''} (${bed.bed_type || ''})`,
            amount: Number(bed.amount ?? 0),
          })),
          requestedDepositAmount: requestedDeposit,
          depositAppliedAmount: paymentState.depositDeducted,
          depositRefundAmount: refundAmount,
          paymentAmount: paymentState.paid,
          paymentMethod: data.payment_mode,
          receiptNo: paymentReceiptNo,
          depositAdjustmentNo: depositAdjustmentReceiptNo,
          refundReceiptNo,
          externalTransactionId: data.payment_reference?.trim() || null,
          collectorId: Number(userId),
          counterId: Number(activeCounterSession.counter_id),
          counterSessionId: Number(activeCounterSession.id),
        });
        return finalizeIpdDischargeBilling(c.env.DB, projection, execution);
      },
    });
  } catch (error) {
    logDischargeBillFailure(error, {
      stage: 'main_batch',
      tenantId,
      userId,
      admissionId: data.admission_id,
      patientId: admission.patient_id,
      invoiceNo,
      subtotal,
      discount: discountAmt,
      total: totalAmt,
      billStatus,
      provisionalItemCount: provItems.length,
      bedChargeSegmentCount: bedChargeSegments.length,
      depositDeducted: paymentState.depositDeducted,
      paid: paymentState.paid,
      refundAmount,
    });
    if (isFinancialBatchAssertionError(error) || isIpdCanonicalConflict(error)) {
      throw new HTTPException(409, {
        message: 'IPD discharge billing changed concurrently or canonical authority is unavailable. Refresh and try again.',
      });
    }
    throw error;
  }
  if (!financialExecution) throw new Error('IPD discharge financial execution did not complete');
  const batchResults = financialExecution.mode === 'strict'
    ? []
    : financialExecution.result as D1Result[];
  const billResultIndex = preparedLegacy.resultIndexByOriginalIndex[0];
  let billId = Number((batchResults[billResultIndex] as any)?.meta?.last_row_id ?? 0);
  if (!Number.isFinite(billId) || billId <= 0) {
    const bill = await db.$client.prepare(
      'SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? ORDER BY id DESC LIMIT 1'
    ).bind(tenantId, invoiceNo).first<{ id: number }>();
    billId = Number(bill?.id ?? 0);
  }
  if (!Number.isFinite(billId) || billId <= 0) {
    throw new HTTPException(500, { message: 'Discharge bill was created but bill id could not be resolved' });
  }

  let approvalRequestId: number | null = null;
  if (isCreditDischarge) {
    if (approvalInsertBatchIndex !== null && financialExecution.mode !== 'strict') {
      const approvalResultIndex = preparedLegacy.resultIndexByOriginalIndex[approvalInsertBatchIndex];
      const insertedId = Number((batchResults[approvalResultIndex] as any)?.meta?.last_row_id ?? 0);
      approvalRequestId = Number.isFinite(insertedId) && insertedId > 0 ? insertedId : null;
    }

    if (!approvalRequestId) {
      try {
        const approvalRequest = await db.$client.prepare(`
          SELECT id FROM approval_requests
          WHERE tenant_id = ?
            AND type = ?
            AND json_extract(request_data, '$.approvalKind') = ?
            AND entity_id = ?
          ORDER BY id DESC LIMIT 1
        `).bind(
          tenantId,
          CREDIT_DISCHARGE_APPROVAL_STORAGE_TYPE,
          CREDIT_DISCHARGE_APPROVAL_KIND,
          data.admission_id,
        ).first<{ id: number }>();
        approvalRequestId = Number(approvalRequest?.id ?? 0) || null;
      } catch (error) {
        console.warn('[ipBilling] Credit discharge committed but approval id lookup failed', {
          tenantId,
          admissionId: data.admission_id,
          invoiceNo,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!approvalRequestId) {
      console.warn('[ipBilling] Credit discharge committed without a resolvable approval request id', {
        tenantId,
        admissionId: data.admission_id,
        invoiceNo,
      });
    }
  }

  try {
    await createDoctorPayableAccrualsForProvisionalItems({
      db: c.env.DB,
      tenantId,
      userId,
      billId,
      items: provItems,
    });
  } catch (error) {
    console.warn('[ipBilling] Doctor payable accrual failed after bill commit', {
      tenantId,
      userId,
      billId,
      admissionId: data.admission_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Verify refund was actually inserted (race condition guard may have prevented it)
  let actualRefundAmount = 0;
  if (refundReceiptNo && refundAmount > 0) {
    const refundRow = await db.$client.prepare(
      `SELECT amount FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ? AND transaction_type = 'refund'`
    ).bind(tenantId, refundReceiptNo).first<{ amount: number }>();
    actualRefundAmount = Number(refundRow?.amount ?? 0);
    if (actualRefundAmount === 0) {
      console.warn(`[ipBilling] Discharge refund ${refundReceiptNo} was not inserted (race condition guard prevented it)`);
    }
  }

  const dischargePostCommitContext = {
    tenantId,
    userId,
    admissionId: data.admission_id,
    patientId: admission.patient_id,
    billId,
    invoiceNo,
  };
  let queuedAccounting = false;

  if (totalAmt > 0 || discountAmt > 0) {
    try {
      await recordBillFinalizationSideEffects(c.env.DB, {
        tenantId,
        userId,
        patientId: admission.patient_id,
        visitId: admission.visit_id || null,
        billId,
        invoiceNo,
        referringDoctorId: null,
        billDate: today,
        subtotal,
        discount: discountAmt,
        total: totalAmt,
        categoryTotals,
        counterId: Number(activeCounterSession.counter_id),
        counterSessionId: Number(activeCounterSession.id),
        skipBillAccountingEvent: financialExecution.mode === 'strict',
        extraPayload: {
          admissionId: data.admission_id,
          discountAllocations: discountAmt > 0
            ? splitDiscountAllocation({
              billGrossAmount: subtotal,
              totalDiscount: discountAmt,
              discountReason: data.reason_code,
              referenceName: data.discount_by_name,
              note: data.remarks,
            }).allocations.map((allocation) => ({ allocationType: allocation.allocationType, amount: allocation.amount }))
            : [],
        },
        items: [
          ...provItems.map((item) => ({
            itemCategory: item.item_category,
            description: item.item_name ?? null,
            lineTotal: Number(item.total_amount ?? 0),
            referenceId: item.reference_id ?? null,
          })),
          ...bedChargeSegments.map((bed) => ({
            itemCategory: 'bed_charge',
            description: `${bed.ward_name || ''} - Bed ${bed.bed_number || ''} (${bed.bed_type || ''})`,
            lineTotal: Number(bed.amount ?? 0),
            referenceId: bed.id ?? null,
          })),
        ],
      });
      queuedAccounting = true;
    } catch (error) {
      logDischargeBillFailure(error, {
        ...dischargePostCommitContext,
        stage: 'bill_finalization_side_effects',
      });
      // The main discharge bill batch has already committed. Do not return a
      // false 500 to the UI for downstream accounting/event side-effects.
      console.warn('[ipBilling] Discharge bill committed; bill finalization side-effect failed and was logged for follow-up.');
    }
  }

  if (paymentReceiptNo && paymentState.paid > 0 && financialExecution.mode !== 'strict') {
    try {
      await recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'payment',
        sourceId: paymentReceiptNo,
        eventType: ACCOUNTING_EVENT_TYPES.paymentReceived,
        eventDate: today,
        createdBy: userId,
        payload: {
          billId,
          receiptNo: paymentReceiptNo,
          patientId: admission.patient_id,
          amount: paymentState.paid,
          paymentMethod: data.payment_mode,
          paymentType: 'current',
          counterId: activeCounterSession.counter_id,
          counterSessionId: activeCounterSession.id,
        },
      });
      queuedAccounting = true;
    } catch (error) {
      logDischargeBillFailure(error, {
        ...dischargePostCommitContext,
        stage: 'payment_accounting_event',
        receiptNo: paymentReceiptNo,
      });
      console.warn('[ipBilling] Discharge bill committed; payment accounting event failed and was logged for follow-up.');
    }

    try {
      await shadowWriteIpdBillPaymentCollection({
        db: c.env.DB,
        tenantId,
        billId,
        invoiceNo,
        receiptNo: paymentReceiptNo,
        admissionId: data.admission_id,
        patientId: Number(admission.patient_id),
        amount: paymentState.paid,
        paymentMethod: data.payment_mode,
        userId,
        counterSessionId: Number(activeCounterSession.id),
        counterId: Number(activeCounterSession.counter_id),
      });
    } catch (error) {
      logDischargeBillFailure(error, {
        ...dischargePostCommitContext,
        stage: 'payment_shadow_collection',
        receiptNo: paymentReceiptNo,
      });
      console.warn('[ipBilling] Discharge bill committed; payment shadow collection failed and was logged for follow-up.');
    }
  }

  if (depositAdjustmentReceiptNo && paymentState.depositDeducted > 0 && financialExecution.mode !== 'strict') {
    try {
      await recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'patient_deposit_adjustment',
        sourceId: depositAdjustmentReceiptNo,
        eventType: ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
        eventDate: today,
        createdBy: userId,
        payload: {
          billId,
          receiptNo: depositAdjustmentReceiptNo,
          patientId: admission.patient_id,
          amount: paymentState.depositDeducted,
          counterId: activeCounterSession.counter_id,
          counterSessionId: activeCounterSession.id,
        },
      });
      queuedAccounting = true;
    } catch (error) {
      logDischargeBillFailure(error, {
        ...dischargePostCommitContext,
        stage: 'deposit_adjustment_accounting_event',
        receiptNo: depositAdjustmentReceiptNo,
      });
      console.warn('[ipBilling] Discharge bill committed; deposit adjustment accounting event failed and was logged for follow-up.');
    }
  }

  if (refundReceiptNo && actualRefundAmount > 0 && financialExecution.mode !== 'strict') {
    try {
      await recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'patient_deposit_refund',
        sourceId: refundReceiptNo,
        eventType: ACCOUNTING_EVENT_TYPES.patientDepositRefunded,
        eventDate: today,
        createdBy: userId,
        payload: {
          receiptNo: refundReceiptNo,
          patientId: admission.patient_id,
          amount: actualRefundAmount,
          paymentMethod: 'cash',
          counterId: activeCounterSession.counter_id,
          counterSessionId: activeCounterSession.id,
          refundNote,
        },
      });
      queuedAccounting = true;
    } catch (error) {
      logDischargeBillFailure(error, {
        ...dischargePostCommitContext,
        stage: 'deposit_refund_accounting_event',
        receiptNo: refundReceiptNo,
      });
      console.warn('[ipBilling] Discharge bill committed; deposit refund accounting event failed and was logged for follow-up.');
    }
  }

  if (queuedAccounting) {
    try {
      queueAccountingPosting(c, tenantId);
    } catch (error) {
      logDischargeBillFailure(error, {
        ...dischargePostCommitContext,
        stage: 'queue_accounting_posting',
      });
      console.warn('[ipBilling] Discharge bill committed; accounting queue trigger failed and was logged for follow-up.');
    }
  }

  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'bills', Number(billId), null, {
    action: 'discharge_bill',
    invoiceNo,
    admissionId: data.admission_id,
    total: totalAmt,
    paid: paymentState.paid,
    depositDeducted: paymentState.depositDeducted,
    depositRefunded: actualRefundAmount,
    refundNote: actualRefundAmount > 0 ? refundNote : null,
    due: paymentState.due,
    status: billStatus,
    counterId: activeCounterSession.counter_id,
    counterSessionId: activeCounterSession.id,
  });

  // ─── Create IPD Ledger Entries (batch for atomicity) ───────────────────────
  try {
    const ledgerStmts: any[] = [];
    const ledgerInsertSql = `
      INSERT INTO ipd_ledger_entries
        (tenant_id, admission_id, patient_id, entry_type, category, description,
         debit_amount, credit_amount, payment_id, bill_id, deposit_id, credit_note_id,
         counter_session_id, created_by, approved_by, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // 1. Link existing provisional charge ledger rows to the finalized bill.
    // The charge row is created when the provisional item is added; inserting it
    // again here would double count the admission-wise IPD ledger.
    for (const item of provItems) {
      ledgerStmts.push(
        db.$client.prepare(`
          UPDATE ipd_ledger_entries
          SET bill_id = ?
          WHERE tenant_id = ?
            AND admission_id = ?
            AND patient_id = ?
            AND entry_type = 'charge'
            AND category = ?
            AND description = ?
            AND ROUND(debit_amount, 2) = ROUND(?, 2)
            AND COALESCE(credit_amount, 0) = 0
            AND bill_id IS NULL
        `).bind(
          billId,
          tenantId,
          data.admission_id,
          admission.patient_id,
          item.item_category,
          item.item_name ?? 'Charge',
          Number(item.total_amount ?? 0),
        ),
      );
    }
    // 2. Charge entries for bed charges, which are created only at finalization.
    for (const bed of bedChargeSegments) {
      ledgerStmts.push(
        db.$client.prepare(ledgerInsertSql).bind(
          tenantId, data.admission_id, admission.patient_id, 'charge', 'bed_charge',
          `${bed.ward_name || ''} - Bed ${bed.bed_number || ''} (${bed.bed_type || ''})`,
          Number(bed.amount ?? 0), 0,
          null, billId, null, null, null, userId, null, null,
        ),
      );
    }
    // 3. Discount entry
    if (discountAmt > 0) {
      const discountLabel = requestedDiscountAmount > 0
        ? `Discount amount${data.discount_by_name ? ' - ' + data.discount_by_name : ''}`
        : `Discount ${data.discount_percent}%${data.discount_by_name ? ' - ' + data.discount_by_name : ''}`;
      ledgerStmts.push(
        db.$client.prepare(ledgerInsertSql).bind(
          tenantId, data.admission_id, admission.patient_id, 'discount', 'discount',
          discountLabel,
          0, discountAmt,
          null, billId, null, null, null, userId, highDiscountApprovedBy, null,
        ),
      );
    }
    // 4. Payment entry
    if (paymentState.paid > 0) {
      ledgerStmts.push(
        db.$client.prepare(ledgerInsertSql).bind(
          tenantId, data.admission_id, admission.patient_id, 'payment', 'payment',
          `Payment via ${data.payment_mode}${paymentReceiptNo ? ' (' + paymentReceiptNo + ')' : ''}`,
          0, paymentState.paid,
          null, billId, null, null, activeCounterSession.id, userId, null, null,
        ),
      );
    }
    // 5. Deposit deduction entry
    if (paymentState.depositDeducted > 0) {
      ledgerStmts.push(
        db.$client.prepare(ledgerInsertSql).bind(
          tenantId, data.admission_id, admission.patient_id, 'deposit_deduction', 'deposit',
          `Deposit deducted${depositAdjustmentReceiptNo ? ' (' + depositAdjustmentReceiptNo + ')' : ''}`,
          0, paymentState.depositDeducted,
          null, billId, null, null, activeCounterSession.id, userId, null, null,
        ),
      );
    }
    // 6. Deposit refund entry
    if (actualRefundAmount > 0) {
      ledgerStmts.push(
        db.$client.prepare(ledgerInsertSql).bind(
          tenantId, data.admission_id, admission.patient_id, 'deposit_refund', 'deposit',
          `Deposit refund${refundReceiptNo ? ' (' + refundReceiptNo + ')' : ''}${refundNote ? ' - ' + refundNote : ''}`,
          actualRefundAmount, 0,
          null, null, null, null, activeCounterSession.id, userId, null, null,
        ),
      );
    }

    // Execute all ledger entries in a single batch for atomicity
    if (ledgerStmts.length > 0) {
      await db.$client.batch(ledgerStmts);
    }
  } catch (ledgerErr) {
    console.error('[ipBilling] Failed to create ledger entries:', ledgerErr);
    // Non-blocking: ledger entries are supplementary
  }

  const responseBody = {
    bill_id: billId,
    invoice_no: invoiceNo,
    total_amount: totalAmt,
    paid_amount: paymentState.paid,
    deposit_deducted: paymentState.depositDeducted,
    deposit_refunded: actualRefundAmount,
    refund_receipt_no: actualRefundAmount > 0 ? refundReceiptNo : null,
    due_amount: paymentState.due,
    status: billStatus,
    bed_total: bedTotal,
    provisional_total: provTotal,
    discharge_mode: data.discharge_mode,
    approval_request_id: approvalRequestId,
    credit_approval_status: isCreditDischarge ? 'pending' : null,
    total_outstanding: isCreditDischarge ? totalOutstandingAmount : 0,
    message: isCreditDischarge
      ? `Patient discharged with ৳${totalOutstandingAmount.toLocaleString('en-BD')} outstanding. Higher-authority approval is pending.`
      : actualRefundAmount > 0
        ? `Discharge bill created. ৳${actualRefundAmount} refunded from deposit.`
        : 'Discharge bill created',
  };

  if (data.idempotencyKey && requestHash) {
    await completeMutationIdempotencyKey(c.env.DB, {
      tenantId: String(tenantId),
      mutationType,
      idempotencyKey: data.idempotencyKey,
      sourceId: billId,
      responseBody,
    }).catch((completionError) => {
      console.error('[ipBilling] Discharge committed but idempotency completion failed:', completionError);
    });
  }

  return c.json(responseBody, 201);
  } catch (error) {
    if (idempotencyReserved && data.idempotencyKey) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId: String(tenantId),
        mutationType,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => {
        console.error('[ipBilling] Failed to mark discharge idempotency key failed:', markError);
      });
    }
    throw error;
  }
});

// ─── GET /ledger/:admissionId — unified patient ledger for an admission ──────
ipBilling.get('/ledger/:admissionId', requireRole(...IP_BILLING_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const admissionId = parseInt(c.req.param('admissionId'));
  if (isNaN(admissionId)) return c.json({ error: 'Invalid admission ID' }, 400);

  // Check if ledger table exists
  let hasLedgerTable = false;
  try {
    await db.$client.prepare("SELECT 1 FROM ipd_ledger_entries LIMIT 1").all();
    hasLedgerTable = true;
  } catch { hasLedgerTable = false; }

  if (!hasLedgerTable) {
    // Fallback: build ledger from existing sources (same as timeline but with debit/credit)
    const admission = await db.$client.prepare(
      'SELECT patient_id, admission_date, discharge_date FROM admissions WHERE id = ? AND tenant_id = ?'
    ).bind(admissionId, tenantId).first<{ patient_id: number; admission_date: string | null; discharge_date: string | null }>();
    if (!admission) return c.json({ error: 'Admission not found' }, 404);

    const { results: charges } = await db.$client.prepare(`
      SELECT 'charge' AS entry_type, item_category AS category, item_name AS description,
             total_amount AS debit_amount, 0 AS credit_amount, created_at, created_by
      FROM billing_provisional_items
      WHERE tenant_id = ? AND admission_id = ? AND is_active = 1
    `).bind(tenantId, admissionId).all();

    const { results: bedCharges } = await db.$client.prepare(`
      SELECT 'charge' AS entry_type, 'bed_charge' AS category,
             ward_name || ' - Bed ' || bed_number AS description,
             rate_per_day * MAX(1, COALESCE(days, 1)) AS debit_amount, 0 AS credit_amount,
             started_on AS created_at, NULL AS created_by
      FROM patient_bed_infos WHERE tenant_id = ? AND admission_id = ?
    `).bind(tenantId, admissionId).all();

    // Scope payments to this admission: only bills that have provisional items for this admission
    const { results: payments } = await db.$client.prepare(`
      SELECT 'payment' AS entry_type, 'payment' AS category,
             'Payment - ' || p.payment_method AS description,
             0 AS debit_amount, p.amount AS credit_amount,
             COALESCE(p.date, p.created_at) AS created_at, p.received_by AS created_by
      FROM payments p
      WHERE p.tenant_id = ? AND p.bill_id IN (
        SELECT DISTINCT billed_bill_id FROM billing_provisional_items
        WHERE tenant_id = ? AND admission_id = ? AND billed_bill_id IS NOT NULL AND is_active = 1
      )
    `).bind(tenantId, tenantId, admissionId).all();

    // Scope deposits to admission date range to avoid mixing with other admissions
    const dateFilter = admission.admission_date
      ? `AND d.created_at >= ? ${admission.discharge_date ? 'AND d.created_at <= ?' : ''}`
      : '';
    const dateParams = [tenantId, admission.patient_id];
    if (admission.admission_date) dateParams.push(admission.admission_date);
    if (admission.discharge_date) dateParams.push(admission.discharge_date);

    const { results: deposits } = await db.$client.prepare(`
      SELECT CASE WHEN d.transaction_type = 'deposit' THEN 'deposit_deduction' ELSE d.transaction_type END AS entry_type,
             'deposit' AS category, COALESCE(d.remarks, d.transaction_type) AS description,
             CASE WHEN d.transaction_type = 'deposit' THEN 0 ELSE d.amount END AS debit_amount,
             CASE WHEN d.transaction_type = 'deposit' THEN d.amount ELSE 0 END AS credit_amount,
             d.created_at, d.created_by
      FROM billing_deposits d WHERE d.tenant_id = ? AND d.patient_id = ? AND d.is_active = 1 ${dateFilter}
    `).bind(...dateParams).all();

    const allEntries = [...(charges as any[]), ...(bedCharges as any[]), ...(payments as any[]), ...(deposits as any[])]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    let runningBalance = 0;
    const ledger = allEntries.reverse().map((e: any) => {
      runningBalance += (e.debit_amount || 0) - (e.credit_amount || 0);
      return { ...e, running_balance: runningBalance };
    }).reverse();

    return c.json({ ledger, source: 'computed' });
  }

  // Use ipd_ledger_entries table
  // Verify admission exists first
  const admissionCheck = await db.$client.prepare(
    'SELECT id FROM admissions WHERE id = ? AND tenant_id = ?'
  ).bind(admissionId, tenantId).first();
  if (!admissionCheck) return c.json({ error: 'Admission not found' }, 404);

  const { results } = await db.$client.prepare(`
    SELECT id, admission_id, patient_id, entry_type, category, description,
           debit_amount, credit_amount, payment_id, bill_id, deposit_id,
           counter_session_id, created_by, approved_by, created_at, remarks
    FROM ipd_ledger_entries
    WHERE tenant_id = ? AND admission_id = ?
    ORDER BY created_at ASC, id ASC
  `).bind(tenantId, admissionId).all();

  let runningBalance = 0;
  const ledger = (results as any[]).map((e: any) => {
    runningBalance += (e.debit_amount || 0) - (e.credit_amount || 0);
    return { ...e, running_balance: runningBalance };
  });

  return c.json({ ledger, source: 'ledger' });
});

// ─── GET /:admissionId/discharge-clearance — printable discharge clearance ──
ipBilling.get('/:admissionId/discharge-clearance', requireRole(...IP_BILLING_ROLES), async (c) => {
  try {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const admissionId = parseInt(c.req.param('admissionId'));
    if (isNaN(admissionId)) return c.json({ error: 'Invalid admission ID' }, 400);

    const admission = await db.$client.prepare(`
      SELECT
        a.id, a.admission_no, a.admission_date, a.discharge_date, a.status,
        a.billing_mode, a.package_id, a.discharge_type, a.discharge_condition_id,
        p.id AS patient_id, p.name AS patient_name, p.patient_code, p.mobile AS patient_phone, p.address AS patient_address,
        d.name AS doctor_name,
        b.ward_name, b.bed_number, b.bed_type
      FROM admissions a
      LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?
    `).bind(admissionId, tenantId).first();

    if (!admission) throw new HTTPException(404, { message: 'Admission not found' });
    const adm = admission as any;

    // Get the discharge bill
    const bill = await db.$client.prepare(`
      SELECT * FROM bills b
      WHERE b.patient_id = ? AND b.tenant_id = ? AND b.admission_bill > 0
        AND (
          b.admission_id = ?
          OR b.id IN (
            SELECT billed_bill_id FROM billing_provisional_items
            WHERE tenant_id = ? AND admission_id = ? AND billed_bill_id IS NOT NULL
          )
          OR b.id IN (
            SELECT billed_bill_id FROM patient_bed_infos
            WHERE tenant_id = ? AND admission_id = ? AND billed_bill_id IS NOT NULL
          )
        )
      ORDER BY created_at DESC LIMIT 1
    `).bind(adm.patient_id, tenantId, admissionId, tenantId, admissionId, tenantId, admissionId).first<any>();

    // Get bill items
    let billItems: any[] = [];
    if (bill) {
      const { results } = await db.$client.prepare(`
        SELECT * FROM invoice_items WHERE bill_id = ? AND tenant_id = ? ORDER BY id ASC
      `).bind(bill.id, tenantId).all();
      billItems = results as any[];
    }

    // Get payments
    let billPayments: any[] = [];
    if (bill) {
      const { results } = await db.$client.prepare(`
        SELECT * FROM payments WHERE bill_id = ? AND tenant_id = ? ORDER BY created_at ASC
      `).bind(bill.id, tenantId).all();
      billPayments = results as any[];
    }

    // Get deposit balance
    const deposit = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) as total_deposits,
        COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0) as total_used
      FROM billing_deposits WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
    `).bind(tenantId, adm.patient_id).first<{ total_deposits: number; total_used: number }>();

    // Get hospital name
    const setting = await db.$client.prepare(
      `SELECT value FROM settings WHERE tenant_id = ? AND key = 'hospital_name'`
    ).bind(tenantId).first<{ value: string }>();

    const hospitalName = setting?.value ?? 'Hospital';
    const fmtTaka = (n: number) => `৳${Number(n || 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
    const fmtDateTime = (d: string) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

    const escapeHtml = (str: string | null | undefined): string => {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    // Build item rows
    let itemRows = '';
    let idx = 1;
    for (const item of billItems) {
      itemRows += `<tr>
        <td>${idx++}</td>
        <td><span class="badge">${escapeHtml(item.item_category)}</span></td>
        <td>${escapeHtml(item.description)}</td>
        <td class="text-right">${item.quantity}</td>
        <td class="text-right">${fmtTaka(item.unit_price)}</td>
        <td class="text-right font-bold">${fmtTaka(item.line_total)}</td>
      </tr>`;
    }

    // Build payment rows
    let paymentRows = '';
    for (const p of billPayments) {
      paymentRows += `<tr>
        <td>${fmtDateTime(p.created_at)}</td>
        <td>${escapeHtml(p.payment_method)}</td>
        <td>${escapeHtml(p.receipt_no)}</td>
        <td class="text-right font-bold">${fmtTaka(p.amount)}</td>
      </tr>`;
    }

    const grandTotal = bill?.total ?? 0;
    const discount = bill?.discount ?? 0;
    const paidAmount = bill?.paid ?? 0;
    const dueAmount = bill?.due ?? 0;
    const depositBalance = (deposit?.total_deposits ?? 0) - (deposit?.total_used ?? 0);

    const admissionDateStr = adm.admission_date ? fmtDate(adm.admission_date) : '-';
    const dischargeDateStr = adm.discharge_date ? fmtDateTime(adm.discharge_date) : '-';
    const stayDays = adm.admission_date && adm.discharge_date
      ? Math.max(1, Math.floor((new Date(adm.discharge_date).getTime() - new Date(adm.admission_date).getTime()) / 86400000) + 1)
      : '-';

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Discharge Clearance - ${escapeHtml(adm.patient_name)}</title>
<style>
  @page { size: A5; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 11px; line-height: 1.5; color: #333; padding: 10px; }
  .header { text-align: center; border-bottom: 2px solid #059669; padding-bottom: 8px; margin-bottom: 10px; }
  .header h1 { font-size: 16px; margin: 0; color: #059669; }
  .header p { font-size: 10px; color: #666; margin: 2px 0; }
  .title { text-align: center; font-size: 13px; font-weight: bold; margin: 10px 0; text-transform: uppercase; background: #ecfdf5; padding: 5px; border: 1px solid #059669; color: #059669; }
  .section { margin-bottom: 10px; }
  .section-title { font-size: 11px; font-weight: bold; color: #059669; border-bottom: 1px solid #d1fae5; padding-bottom: 3px; margin-bottom: 5px; }
  .patient-info { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 10px; font-size: 10px; }
  .patient-info div strong { display: inline-block; width: 100px; }
  .financial-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
  .financial-card { border: 1px solid #ddd; border-radius: 6px; padding: 8px; text-align: center; }
  .financial-card .label { font-size: 9px; color: #666; text-transform: uppercase; }
  .financial-card .value { font-size: 14px; font-weight: bold; margin-top: 2px; }
  .financial-card .value.green { color: #059669; }
  .financial-card .value.red { color: #dc2626; }
  .financial-card .value.blue { color: #2563eb; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10px; }
  th { background: #f3f4f6; padding: 5px 4px; text-align: left; font-weight: 600; border-bottom: 2px solid #ddd; }
  td { padding: 4px; border-bottom: 1px solid #eee; }
  .text-right { text-align: right; }
  .font-bold { font-weight: bold; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 9px; font-weight: 600; background: #dbeafe; color: #1e40af; }
  .totals { border-top: 2px solid #333; padding-top: 8px; }
  .totals-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
  .totals-row.grand { font-size: 13px; font-weight: bold; border-top: 1px solid #999; padding-top: 5px; margin-top: 3px; }
  .clearance-box { border: 2px solid #059669; border-radius: 8px; padding: 10px; text-align: center; margin: 12px 0; background: #ecfdf5; }
  .clearance-box .check { font-size: 24px; color: #059669; }
  .clearance-box p { font-size: 12px; font-weight: bold; color: #059669; }
  .signature-area { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
  .signature-box { text-align: center; }
  .signature-box .line { border-top: 1px solid #333; margin-top: 40px; padding-top: 5px; font-size: 10px; }
  .footer { text-align: center; font-size: 9px; color: #999; margin-top: 15px; border-top: 1px solid #ddd; padding-top: 5px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
  <div class="header">
    <h1>${escapeHtml(hospitalName)}</h1>
    <p>Discharge Clearance Slip</p>
  </div>
  <div class="title">Discharge Clearance / ডিসচার্জ ক্লিয়ারেন্স</div>

  <div class="patient-info">
    <div><strong>Patient:</strong> ${escapeHtml(adm.patient_name) || '-'}</div>
    <div><strong>Patient ID:</strong> ${escapeHtml(adm.patient_code) || '-'}</div>
    <div><strong>Admission:</strong> ${escapeHtml(adm.admission_no) || '-'}</div>
    <div><strong>Admitted:</strong> ${admissionDateStr}</div>
    <div><strong>Discharged:</strong> ${dischargeDateStr}</div>
    <div><strong>Stay:</strong> ${stayDays} days</div>
    <div><strong>Ward/Bed:</strong> ${escapeHtml(adm.ward_name) || '-'} — ${escapeHtml(adm.bed_number) || '-'} (${escapeHtml(adm.bed_type) || '-'})</div>
    <div><strong>Doctor:</strong> ${escapeHtml(adm.doctor_name) || '-'}</div>
    ${adm.patient_phone ? `<div><strong>Phone:</strong> ${escapeHtml(adm.patient_phone)}</div>` : ''}
  </div>

  <div class="financial-summary">
    <div class="financial-card">
      <div class="label">Total Bill</div>
      <div class="value blue">${fmtTaka(grandTotal)}</div>
    </div>
    <div class="financial-card">
      <div class="label">Paid</div>
      <div class="value green">${fmtTaka(paidAmount)}</div>
    </div>
    <div class="financial-card">
      <div class="label">Due</div>
      <div class="value ${dueAmount > 0 ? 'red' : 'green'}">${fmtTaka(dueAmount)}</div>
    </div>
  </div>

  ${billItems.length > 0 ? `
  <div class="section">
    <div class="section-title">Bill Details</div>
    <table>
      <thead><tr><th>#</th><th>Category</th><th>Item</th><th class="text-right">Qty</th><th class="text-right">Rate</th><th class="text-right">Total</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
  </div>
  ` : ''}

  <div class="totals">
    <div class="totals-row"><span>Subtotal:</span><span>${fmtTaka(grandTotal + discount)}</span></div>
    ${discount > 0 ? `<div class="totals-row"><span>Discount:</span><span>-${fmtTaka(discount)}</span></div>` : ''}
    <div class="totals-row grand"><span>Net Total:</span><span>${fmtTaka(grandTotal)}</span></div>
    <div class="totals-row"><span>Paid Amount:</span><span>${fmtTaka(paidAmount)}</span></div>
    ${depositBalance > 0 ? `<div class="totals-row"><span>Deposit Balance:</span><span>${fmtTaka(depositBalance)}</span></div>` : ''}
    ${dueAmount > 0 ? `<div class="totals-row grand" style="color:#dc2626"><span>Due Amount:</span><span>${fmtTaka(dueAmount)}</span></div>` : ''}
    ${dueAmount <= 0 && depositBalance <= 0 ? `<div class="totals-row grand" style="color:#059669"><span>Status:</span><span>Fully Settled</span></div>` : ''}
  </div>

  <div class="clearance-box">
    <div class="check">✓</div>
    <p>Patient Discharge Clearance ${dueAmount <= 0 ? '(All Dues Cleared)' : '(Pending Dues)'}</p>
  </div>

  <div class="signature-area">
    <div class="signature-box">
      <div class="line">Patient / Guardian Signature</div>
    </div>
    <div class="signature-box">
      <div class="line">Authorized Signature</div>
    </div>
  </div>

  <div class="footer">
    Admission: ${adm.id} | Status: ${adm.status} | Clearance Generated: ${new Date().toLocaleString()}
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print()},500)};</script>
</body></html>`;

    return c.html(html);
  } catch (err) {
    console.error('[ipBilling/discharge-clearance] Error:', err);
    throw err;
  }
});

export default ipBilling;
