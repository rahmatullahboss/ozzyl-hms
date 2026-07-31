import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import {
  calculateBillingCounterSessionCashSummary,
  getBillingWorkstationId,
  loadActiveBillingCounterSession,
} from '../../lib/billing-counter-session';
import { getTodayGMT6 } from '../../lib/date-utils';
import { ACCOUNTING_EVENT_TYPES, recordAndPostAccountingEvent } from '../../lib/accounting-posting';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  readMutationIdempotencyReplay,
  reserveMutationIdempotencyKey,
} from '../../lib/request-idempotency';
import { receptionDoctorPayoutSchema, receptionPerformerReservePayoutSchema } from '../../schemas/commission';
import { shadowCreateCashLedgerEntry } from '../../lib/cash-ledger-writer';
import { executeLiveCompensationSettlement } from '../../lib/canonical/live-compensation-settlement';
import { executeLiveCancelledCompensationSettlementReversal } from '../../lib/canonical/live-compensation-settlement-reversal';
import { resolvePayoutLineAmounts } from '../../lib/performer-payout-overrides';

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
const ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;
const REVERSAL_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;
const MUTATION_TYPE = 'reception_doctor_payout';
const PERFORMER_RESERVE_MUTATION_TYPE = 'reception_performer_reserve_payout';
const PERFORMER_RESERVE_REVERSAL_MUTATION_TYPE = 'reception_performer_reserve_payout_reversal';
const reversePerformerSettlementSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
});
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

const paidBill = (alias = 'b') => `(
  ${alias}.id IS NOT NULL AND (
    COALESCE(${alias}.status, 'open') = 'paid'
    OR (COALESCE(${alias}.total, 0) > 0 AND COALESCE(${alias}.paid, 0) >= COALESCE(${alias}.total, 0))
  )
)`;

const effectivePayableCommission = (alias = 'a') => `MAX(0, CASE
  WHEN COALESCE(${alias}.earned_commission_amount, 0) != 0
    OR COALESCE(${alias}.doctor_waiver_amount, 0) != 0
    OR COALESCE(${alias}.payable_commission_amount, 0) != 0
  THEN COALESCE(${alias}.payable_commission_amount, 0)
  ELSE COALESCE(${alias}.commission_amount, 0)
END)`;

type PerformerReservePayoutRow = {
  reserve_id: number;
  bill_id: number;
  invoice_item_id: number;
  patient_id: number | null;
  visit_id: number | null;
  billing_service_item_id: number;
  diagnostic_kind: 'lab' | 'radiology';
  lab_test_id: number | null;
  radiology_imaging_item_id: number | null;
  test_name: string;
  net_unit_service_amount: number;
  payout_maximum_amount: number;
  reserved_amount: number;
  rule_rate_type: 'flat' | 'percent';
  rule_rate_value: number;
  canonical_source_key: string | null;
  status: string;
  bill_is_paid: number;
  item_status: string;
};

type UnassignedPerformerReserveRow = {
  reserve_id: number;
  billing_service_item_id: number;
  diagnostic_kind: 'lab' | 'radiology';
  test_code: string | null;
  test_name: string;
  reserved_at: string;
  net_unit_service_amount: number;
  payout_maximum_amount: number;
  reserved_amount: number;
  rule_rate_type: 'flat' | 'percent';
  rule_rate_value: number;
  patient_id: number | null;
  patient_name: string | null;
  patient_code: string | null;
  bill_id: number;
  invoice_no: string | null;
  bill_is_paid: number;
};

type Row = {
  id: number;
  doctor_id: number;
  doctor_name: string;
  doctor_specialization: string | null;
  doctor_department: string | null;
  doctor_registration_number: string | null;
  doctor_user_id: number | null;
  doctor_is_active: number | null;
  patient_id: number | null;
  patient_name: string | null;
  patient_code: string | null;
  bill_id: number | null;
  invoice_no: string | null;
  source_type: string;
  canonical_source_key: string | null;
  gross_amount: number;
  commission_amount: number;
  payable_amount: number;
  status: string;
  accrued_date: string | null;
  notes: string | null;
  bill_is_paid: number;
};

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function label(sourceType: string): string {
  if (sourceType === 'consultation_fee') return 'Consultation fee';
  if (sourceType === 'lab_test') return 'Lab/USG doctor fee';
  if (sourceType === 'referral') return 'Test referral';
  if (sourceType === 'ipd_round') return 'IPD doctor round';
  if (sourceType === 'procedure') return 'Procedure doctor fee';
  return sourceType.replace(/_/g, ' ');
}

function normalizeIds(ids: number[]): number[] {
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

async function shadowWriteDoctorPayout(params: {
  db: D1Database;
  tenantId: string;
  settlementId: number;
  settlementNo: string;
  doctorId: number;
  doctorName: string;
  amount: number;
  userId: string | number;
  counterSessionId: number;
  counterId: number;
  referenceNo?: string | null;
  accrualIds: number[];
  voucherId?: number | null;
}) {
  await shadowCreateCashLedgerEntry(params.db, {
    tenantId: params.tenantId,
    sourceType: 'doctor_commission_settlement',
    sourceId: params.settlementId,
    sourceNo: params.settlementNo,
    eventType: 'DOCTOR_PAYOUT_PAID',
    movementDirection: 'out',
    cashStatus: 'PAYOUT_PAID',
    status: 'posted',
    amount: params.amount,
    expectedAmount: params.amount,
    receivedAmount: 0,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: Number(params.userId),
    toUserId: params.doctorId,
    counterSessionId: params.counterSessionId,
    counterId: params.counterId,
    currentLocationType: 'payout',
    currentLocationLabel: params.doctorName,
    accountingVoucherId: params.voucherId ?? null,
    accountingPostingStatus: params.voucherId ? 'posted' : 'not_posted',
    referenceType: 'doctor_commission_settlement',
    referenceId: params.settlementId,
    note: `Doctor payout - ${params.doctorName}`,
    metadata: {
      settlementNo: params.settlementNo,
      doctorId: params.doctorId,
      doctorName: params.doctorName,
      referenceNo: params.referenceNo ?? null,
      accrualIds: params.accrualIds,
      shadowSource: 'doctor_commission_settlements',
    },
    idempotencyKey: `cash-ledger:doctor-payout:${params.settlementId}:paid`,
    createdBy: Number(params.userId),
    occurredAt: new Date().toISOString(),
    postedAt: params.voucherId ? new Date().toISOString() : null,
  });
}

async function nextDoctorPayoutSettlementNo(db: D1Database, tenantId: string, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const prefix = `DPS-${year}-`;
  const row = await db.prepare(`
    SELECT settlement_no
    FROM doctor_commission_settlements
    WHERE tenant_id = ? AND settlement_no LIKE ?
    ORDER BY settlement_no DESC
    LIMIT 1
  `).bind(tenantId, `${prefix}%`).first<{ settlement_no: string | null }>();
  const next = row?.settlement_no ? Number(row.settlement_no.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(Number.isFinite(next) && next > 0 ? next : 1).padStart(6, '0')}`;
}

routes.get('/payables', requireRole(...ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const doctorId = c.req.query('doctorId');
  const from = c.req.query('from');
  const to = c.req.query('to');
  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to))) {
    throw new HTTPException(400, { message: 'Dates must use YYYY-MM-DD format' });
  }
  if (from && to && from > to) {
    throw new HTTPException(400, { message: 'From date cannot be after To date' });
  }
  const payableSql = effectivePayableCommission('a');
  const filters = ['a.tenant_id = ?', "a.status IN ('accrued', 'approved')", paidBill('b'), `${payableSql} > 0`];
  const params: Array<string | number> = [tenantId];
  if (doctorId) { filters.push('a.doctor_id = ?'); params.push(Number(doctorId)); }
  if (from) { filters.push('date(a.accrued_date) >= date(?)'); params.push(from); }
  if (to) { filters.push('date(a.accrued_date) <= date(?)'); params.push(to); }

  const { results } = await c.env.DB.prepare(`
    SELECT a.id, a.doctor_id, d.name AS doctor_name, d.specialty AS doctor_specialization,
           a.patient_id, p.name AS patient_name, p.patient_code,
           a.bill_id, b.invoice_no, a.source_type, a.gross_amount, a.commission_amount,
           ${payableSql} AS payable_amount,
           a.status, a.accrued_date, a.notes,
           CASE WHEN ${paidBill('b')} THEN 1 ELSE 0 END AS bill_is_paid
    FROM doctor_commission_accruals a
    JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN bills b ON b.id = a.bill_id AND b.tenant_id = a.tenant_id
    WHERE ${filters.join(' AND ')}
    ORDER BY d.name ASC, a.accrued_date ASC, a.id ASC
  `).bind(...params).all<Row>();

  const groups = new Map<number, any>();
  for (const row of results ?? []) {
    const group = groups.get(row.doctor_id) ?? {
      doctorId: row.doctor_id,
      doctorName: row.doctor_name,
      doctorSpecialization: row.doctor_specialization,
      eligibleItemCount: 0,
      grossAmount: 0,
      consultationCommission: 0,
      testCommission: 0,
      referralCommission: 0,
      otherCommission: 0,
      previouslyPaidAmount: 0,
      payableAmount: 0,
      sourceTotals: {},
      items: [],
      accruals: [],
    };
    const payable = amount(row.payable_amount);
    if (payable <= 0) continue;
    const gross = amount(row.gross_amount);
    const sourceLabel = label(row.source_type);
    group.eligibleItemCount += 1;
    group.grossAmount = amount(group.grossAmount + gross);
    group.payableAmount = amount(group.payableAmount + payable);
    if (row.source_type === 'consultation_fee') group.consultationCommission = amount(group.consultationCommission + payable);
    else if (row.source_type === 'lab_test') group.testCommission = amount(group.testCommission + payable);
    else if (row.source_type === 'referral') group.referralCommission = amount((group.referralCommission ?? 0) + payable);
    else group.otherCommission = amount(group.otherCommission + payable);
    group.sourceTotals[sourceLabel] = amount((group.sourceTotals[sourceLabel] ?? 0) + payable);
    const item = {
      accrualId: row.id,
      id: row.id,
      serviceDate: row.accrued_date,
      sourceType: row.source_type,
      serviceName: sourceLabel,
      sourceLabel,
      patientId: row.patient_id,
      patientName: row.patient_name,
      patientCode: row.patient_code,
      billId: row.bill_id,
      invoiceNo: row.invoice_no,
      grossAmount: gross,
      commissionAmount: payable,
      payableAmount: payable,
      status: 'pending',
      notes: row.notes,
    };
    group.items.push(item);
    group.accruals.push(item);
    group.outstandingCount = group.eligibleItemCount;
    groups.set(row.doctor_id, group);
  }

  const doctors = Array.from(groups.values()).sort((a, b) => b.payableAmount - a.payableAmount || a.doctorName.localeCompare(b.doctorName));
  return c.json({
    doctors,
    summary: {
      doctorCount: doctors.length,
      outstandingCount: doctors.reduce((sum, row) => sum + row.eligibleItemCount, 0),
      payableAmount: amount(doctors.reduce((sum, row) => sum + row.payableAmount, 0)),
    },
  });
});

routes.get('/unassigned-performer-reserves', requireRole(...ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const from = c.req.query('from');
  const to = c.req.query('to');
  const serviceItemId = Number(c.req.query('serviceItemId') ?? 0);
  const includeWaitingPayment = c.req.query('includeWaitingPayment') === 'true';

  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to))) {
    throw new HTTPException(400, { message: 'Dates must use YYYY-MM-DD format' });
  }
  if (from && to && from > to) {
    throw new HTTPException(400, { message: 'From date cannot be after To date' });
  }
  if (c.req.query('serviceItemId') && (!Number.isInteger(serviceItemId) || serviceItemId <= 0)) {
    throw new HTTPException(400, { message: 'Invalid service item' });
  }

  const filters = ["r.tenant_id = ?", "r.status = 'reserved'", "COALESCE(ii.status, 'active') = 'active'"];
  const params: Array<string | number> = [tenantId];
  if (from) { filters.push('date(r.reserved_at) >= date(?)'); params.push(from); }
  if (to) { filters.push('date(r.reserved_at) <= date(?)'); params.push(to); }
  if (serviceItemId > 0) { filters.push('r.billing_service_item_id = ?'); params.push(serviceItemId); }

  const { results } = await c.env.DB.prepare(`
    SELECT
      r.id AS reserve_id,
      r.billing_service_item_id,
      r.diagnostic_kind,
      r.test_code,
      r.test_name,
      r.reserved_at,
      r.net_unit_service_amount,
      MAX(
        COALESCE(ii.unit_price, 0),
        COALESCE(r.unit_service_amount, 0),
        COALESCE(r.net_unit_service_amount, 0),
        COALESCE(r.reserved_amount, 0)
      ) AS payout_maximum_amount,
      r.reserved_amount,
      r.rule_rate_type,
      r.rule_rate_value,
      r.patient_id,
      p.name AS patient_name,
      p.patient_code,
      r.bill_id,
      b.invoice_no,
      CASE WHEN ${paidBill('b')} THEN 1 ELSE 0 END AS bill_is_paid
    FROM diagnostic_performer_reserves r
    JOIN bills b ON b.id = r.bill_id AND b.tenant_id = r.tenant_id
    JOIN invoice_items ii ON ii.id = r.invoice_item_id AND ii.tenant_id = r.tenant_id
    LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
    WHERE ${filters.join(' AND ')}
    ORDER BY r.billing_service_item_id ASC, r.reserved_at ASC, r.id ASC
  `).bind(...params).all<UnassignedPerformerReserveRow>();

  const groups = new Map<number, any>();
  for (const row of results ?? []) {
    const serviceId = Number(row.billing_service_item_id);
    const paid = Number(row.bill_is_paid ?? 0) === 1;
    const reservedAmount = amount(row.reserved_amount);
    const group = groups.get(serviceId) ?? {
      billingServiceItemId: serviceId,
      testCode: row.test_code ?? null,
      testName: row.test_name,
      diagnosticKind: row.diagnostic_kind,
      eligibleQuantity: 0,
      waitingPaymentQuantity: 0,
      eligibleAmount: 0,
      waitingPaymentAmount: 0,
      rateSummary: row.rule_rate_type === 'percent'
        ? `${amount(row.rule_rate_value) / 100}%`
        : `৳${amount(row.rule_rate_value)}/unit`,
      reserves: [],
    };

    if (paid) {
      group.eligibleQuantity += 1;
      group.eligibleAmount = amount(group.eligibleAmount + reservedAmount);
    } else {
      group.waitingPaymentQuantity += 1;
      group.waitingPaymentAmount = amount(group.waitingPaymentAmount + reservedAmount);
    }

    if (paid || includeWaitingPayment) {
      group.reserves.push({
        reserveId: Number(row.reserve_id),
        serviceDate: row.reserved_at,
        patientId: row.patient_id == null ? null : Number(row.patient_id),
        patientName: row.patient_name ?? null,
        patientCode: row.patient_code ?? null,
        billId: Number(row.bill_id),
        invoiceNo: row.invoice_no,
        netUnitServiceAmount: amount(row.net_unit_service_amount),
        payoutMaximumAmount: amount(row.payout_maximum_amount),
        reservedAmount,
        billIsPaid: paid,
      });
    }
    groups.set(serviceId, group);
  }

  const grouped = Array.from(groups.values()).sort((a, b) => (
    b.eligibleAmount - a.eligibleAmount || String(a.testName).localeCompare(String(b.testName))
  ));
  return c.json({
    groups: grouped,
    summary: {
      testCount: grouped.length,
      eligibleQuantity: grouped.reduce((sum, group) => sum + group.eligibleQuantity, 0),
      waitingPaymentQuantity: grouped.reduce((sum, group) => sum + group.waitingPaymentQuantity, 0),
      eligibleAmount: amount(grouped.reduce((sum, group) => sum + group.eligibleAmount, 0)),
      waitingPaymentAmount: amount(grouped.reduce((sum, group) => sum + group.waitingPaymentAmount, 0)),
    },
  });
});

routes.get('/performer-reserve-reconciliation', requireRole(...ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const from = c.req.query('from');
  const to = c.req.query('to');
  const serviceItemId = Number(c.req.query('serviceItemId') ?? 0);

  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to))) {
    throw new HTTPException(400, { message: 'Dates must use YYYY-MM-DD format' });
  }
  if (from && to && from > to) {
    throw new HTTPException(400, { message: 'From date cannot be after To date' });
  }
  if (c.req.query('serviceItemId') && (!Number.isInteger(serviceItemId) || serviceItemId <= 0)) {
    throw new HTTPException(400, { message: 'Invalid service item' });
  }

  const filters = ["r.tenant_id = ?", "r.status IN ('reserved', 'paid', 'cancelled', 'reversed')"];
  const params: Array<string | number> = [tenantId];
  if (from) { filters.push('date(r.reserved_at) >= date(?)'); params.push(from); }
  if (to) { filters.push('date(r.reserved_at) <= date(?)'); params.push(to); }
  if (serviceItemId > 0) { filters.push('r.billing_service_item_id = ?'); params.push(serviceItemId); }

  const { results } = await c.env.DB.prepare(`
    SELECT
      r.billing_service_item_id,
      r.test_code,
      r.test_name,
      r.diagnostic_kind,
      r.status,
      COUNT(*) AS quantity,
      COALESCE(SUM(r.reserved_amount), 0) AS reserve_amount,
      SUM(CASE WHEN r.status = 'reserved' AND ${paidBill('b')} THEN 1 ELSE 0 END) AS eligible_quantity,
      COALESCE(SUM(CASE WHEN r.status = 'reserved' AND ${paidBill('b')} THEN r.reserved_amount ELSE 0 END), 0) AS eligible_amount,
      SUM(CASE WHEN r.status = 'reserved' AND NOT ${paidBill('b')} THEN 1 ELSE 0 END) AS waiting_quantity,
      COALESCE(SUM(CASE WHEN r.status = 'reserved' AND NOT ${paidBill('b')} THEN r.reserved_amount ELSE 0 END), 0) AS waiting_amount
    FROM diagnostic_performer_reserves r
    JOIN bills b ON b.id = r.bill_id AND b.tenant_id = r.tenant_id
    WHERE ${filters.join(' AND ')}
    GROUP BY r.billing_service_item_id, r.test_code, r.test_name, r.diagnostic_kind, r.status
    ORDER BY r.test_name ASC, r.status ASC
  `).bind(...params).all<{
    billing_service_item_id: number;
    test_code: string | null;
    test_name: string;
    diagnostic_kind: 'lab' | 'radiology';
    status: 'reserved' | 'paid' | 'cancelled' | 'reversed';
    quantity: number;
    reserve_amount: number;
    eligible_quantity: number;
    eligible_amount: number;
    waiting_quantity: number;
    waiting_amount: number;
  }>();

  const summary = {
    reservedQuantity: 0,
    reservedAmount: 0,
    eligibleReservedQuantity: 0,
    eligibleReservedAmount: 0,
    waitingPaymentQuantity: 0,
    waitingPaymentAmount: 0,
    paidQuantity: 0,
    paidAmount: 0,
    cancelledQuantity: 0,
    cancelledAmount: 0,
    reversedQuantity: 0,
    reversedAmount: 0,
  };
  const byTestMap = new Map<number, any>();

  for (const row of results ?? []) {
    const serviceId = Number(row.billing_service_item_id);
    const quantity = Number(row.quantity ?? 0);
    const reserveAmount = amount(row.reserve_amount);
    const test = byTestMap.get(serviceId) ?? {
      billingServiceItemId: serviceId,
      testCode: row.test_code ?? null,
      testName: row.test_name,
      diagnosticKind: row.diagnostic_kind,
      reservedQuantity: 0,
      reservedAmount: 0,
      eligibleReservedQuantity: 0,
      eligibleReservedAmount: 0,
      waitingPaymentQuantity: 0,
      waitingPaymentAmount: 0,
      paidQuantity: 0,
      paidAmount: 0,
      cancelledQuantity: 0,
      cancelledAmount: 0,
      reversedQuantity: 0,
      reversedAmount: 0,
    };

    if (row.status === 'reserved') {
      const eligibleQuantity = Number(row.eligible_quantity ?? 0);
      const eligibleAmount = amount(row.eligible_amount);
      const waitingQuantity = Number(row.waiting_quantity ?? 0);
      const waitingAmount = amount(row.waiting_amount);
      summary.reservedQuantity += quantity;
      summary.reservedAmount = amount(summary.reservedAmount + reserveAmount);
      summary.eligibleReservedQuantity += eligibleQuantity;
      summary.eligibleReservedAmount = amount(summary.eligibleReservedAmount + eligibleAmount);
      summary.waitingPaymentQuantity += waitingQuantity;
      summary.waitingPaymentAmount = amount(summary.waitingPaymentAmount + waitingAmount);
      test.reservedQuantity += quantity;
      test.reservedAmount = amount(test.reservedAmount + reserveAmount);
      test.eligibleReservedQuantity += eligibleQuantity;
      test.eligibleReservedAmount = amount(test.eligibleReservedAmount + eligibleAmount);
      test.waitingPaymentQuantity += waitingQuantity;
      test.waitingPaymentAmount = amount(test.waitingPaymentAmount + waitingAmount);
    } else if (row.status === 'paid') {
      summary.paidQuantity += quantity;
      summary.paidAmount = amount(summary.paidAmount + reserveAmount);
      test.paidQuantity += quantity;
      test.paidAmount = amount(test.paidAmount + reserveAmount);
    } else if (row.status === 'cancelled') {
      summary.cancelledQuantity += quantity;
      summary.cancelledAmount = amount(summary.cancelledAmount + reserveAmount);
      test.cancelledQuantity += quantity;
      test.cancelledAmount = amount(test.cancelledAmount + reserveAmount);
    } else {
      summary.reversedQuantity += quantity;
      summary.reversedAmount = amount(summary.reversedAmount + reserveAmount);
      test.reversedQuantity += quantity;
      test.reversedAmount = amount(test.reversedAmount + reserveAmount);
    }
    byTestMap.set(serviceId, test);
  }

  return c.json({
    summary,
    byTest: Array.from(byTestMap.values()).sort((a, b) => a.testName.localeCompare(b.testName)),
  });
});

routes.post('/settlements/:id/reverse', requireRole(...REVERSAL_ROLES), zValidator('json', reversePerformerSettlementSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const settlementId = Number(c.req.param('id'));
  const data = c.req.valid('json');
  if (!Number.isInteger(settlementId) || settlementId <= 0) {
    throw new HTTPException(400, { message: 'Invalid settlement' });
  }

  const normalizedPayload = { settlementId, reason: data.reason };
  const requestHash = await createIdempotencyRequestHash(normalizedPayload);
  let idempotencyReserved = false;
  const replay = await readMutationIdempotencyReplay(c.env.DB, {
    tenantId,
    mutationType: PERFORMER_RESERVE_REVERSAL_MUTATION_TYPE,
    idempotencyKey: data.idempotencyKey,
    requestHash,
    mismatchMessage: 'Idempotency key was already used for a different performer payout reversal',
    conflictMessage: 'Performer payout reversal is already being processed. Please retry shortly.',
  });
  if (replay) return c.json({ ...replay.responseBody, idempotent: true });

  const reservedRequest = await reserveMutationIdempotencyKey(c.env.DB, {
    tenantId,
    mutationType: PERFORMER_RESERVE_REVERSAL_MUTATION_TYPE,
    idempotencyKey: data.idempotencyKey,
    requestHash,
    createdBy: userId,
    mismatchMessage: 'Idempotency key was already used for a different performer payout reversal',
    conflictMessage: 'Performer payout reversal is already being processed. Please retry shortly.',
  });
  if (reservedRequest) return c.json({ ...reservedRequest.responseBody, idempotent: true });
  idempotencyReserved = true;

  try {
    const activeSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
      workstationId: getBillingWorkstationId(c),
      requireCurrentWorkstation: true,
    });
    if (!activeSession) {
      throw new HTTPException(400, {
        message: 'Open an active billing counter on this workstation before collecting performer payout reversal cash.',
      });
    }

    const settlement = await c.env.DB.prepare(`
      SELECT
        s.id,
        s.settlement_no,
        s.idempotency_key,
        s.total_amount,
        s.net_paid_amount,
        s.doctor_id,
        d.name AS doctor_name,
        s.counter_session_id,
        s.counter_id,
        COALESCE(s.accounting_voucher_id, s.voucher_id) AS original_voucher_id,
        COUNT(r.id) AS reserve_count,
        COALESCE(SUM(r.reserved_amount), 0) AS reserve_amount
      FROM doctor_commission_settlements s
      JOIN doctors d ON d.id = s.doctor_id AND d.tenant_id = s.tenant_id
      JOIN diagnostic_performer_reserves r
        ON r.tenant_id = s.tenant_id
       AND r.settlement_id = s.id
       AND r.status = 'paid'
      WHERE s.tenant_id = ? AND s.id = ? AND s.reversed_at IS NULL
      GROUP BY s.id, s.settlement_no, s.idempotency_key, s.total_amount, s.net_paid_amount,
               s.doctor_id, d.name, s.counter_session_id, s.counter_id,
               s.accounting_voucher_id, s.voucher_id
      LIMIT 1
    `).bind(tenantId, settlementId).first<{
      id: number;
      settlement_no: string | null;
      idempotency_key: string | null;
      total_amount: number;
      net_paid_amount: number;
      doctor_id: number;
      doctor_name: string;
      counter_session_id: number | null;
      counter_id: number | null;
      original_voucher_id: number | null;
      reserve_count: number;
      reserve_amount: number;
    }>();
    if (!settlement?.id) {
      throw new HTTPException(409, { message: 'This performer payout is already reversed or has no paid reserve items' });
    }
    const originalVoucherId = Number(settlement.original_voucher_id ?? 0);
    if (!Number.isInteger(originalVoucherId) || originalVoucherId <= 0) {
      throw new HTTPException(409, { message: 'Original accounting voucher is missing; resolve accounting before reversal' });
    }

    const { results: originalLines } = await c.env.DB.prepare(`
      SELECT account_id, debit_amount, credit_amount, memo
      FROM accounting_journal_lines
      WHERE tenant_id = ? AND voucher_id = ?
      ORDER BY line_no ASC, id ASC
    `).bind(tenantId, originalVoucherId).all<{
      account_id: number;
      debit_amount: number;
      credit_amount: number;
      memo: string | null;
    }>();
    if ((originalLines ?? []).length < 2) {
      throw new HTTPException(409, { message: 'Original accounting voucher lines are incomplete' });
    }

    const grossReserveAmount = amount(settlement.reserve_amount);
    const reversalCashAmount = amount(
      Number(settlement.net_paid_amount ?? 0) > 0
        ? settlement.net_paid_amount
        : settlement.total_amount,
    );
    const reserveCount = Number(settlement.reserve_count ?? 0);
    if (grossReserveAmount <= 0 || reversalCashAmount <= 0 || reserveCount <= 0) {
      throw new HTTPException(409, { message: 'No paid performer reserve amount is available to reverse' });
    }
    const date = getTodayGMT6();
    const reversedAtUtc = new Date().toISOString();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, date, 'Performer payout reversal');

    const reversalReferenceType = 'doctor_commission_settlement_reversal';
    const reversalDescription = `Performer payout reversal - ${settlement.doctor_name}: ${data.reason}`;
    const legacyStatements = [
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount,
           payment_method, reference_type, reference_id, description, created_by)
        SELECT ?, ?, ?, ?, 'cash_in', ?, 'cash', ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM cash_drawer_movements
          WHERE tenant_id = ? AND reference_type = ? AND reference_id = ?
        )
      `).bind(
        tenantId,
        Number(activeSession.id),
        Number(activeSession.counter_id),
        userId,
        reversalCashAmount,
        reversalReferenceType,
        settlementId,
        reversalDescription,
        userId,
        tenantId,
        reversalReferenceType,
        settlementId,
      ),
      c.env.DB.prepare(`
        UPDATE doctor_commission_accruals
        SET status = 'cancelled',
            notes = TRIM(COALESCE(notes, '') || ' Reversed: ' || ?),
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND settlement_id = ?
          AND performer_reserve_id IS NOT NULL
          AND status = 'paid'
      `).bind(data.reason, tenantId, settlementId),
      c.env.DB.prepare(`
        UPDATE diagnostic_performer_reserves
        SET status = 'reversed',
            reversed_at = datetime('now', '+6 hours'),
            reversed_by = ?,
            cancel_reason = ?,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ? AND settlement_id = ? AND status = 'paid'
      `).bind(userId, data.reason, tenantId, settlementId),
      c.env.DB.prepare(`
        UPDATE doctor_commission_settlements
        SET reversed_at = datetime('now', '+6 hours'),
            reversed_by = ?,
            reversal_reason = ?,
            notes = TRIM(COALESCE(notes, '') || ' [REVERSED ' || datetime('now', '+6 hours') || ': ' || ? || ']')
        WHERE tenant_id = ? AND id = ? AND reversed_at IS NULL
      `).bind(userId, data.reason, data.reason, tenantId, settlementId),
      c.env.DB.prepare(`
        INSERT INTO doctor_commission_settlement_items
          (tenant_id, settlement_id, accrual_id, doctor_id, source_type, gross_amount, commission_amount)
        SELECT NULL, s.id, -1, s.doctor_id, 'performer_reserve_reversal_guard', 0, 0
        FROM doctor_commission_settlements s
        WHERE s.tenant_id = ? AND s.id = ?
          AND (
            (SELECT COUNT(*) FROM diagnostic_performer_reserves r
             WHERE r.tenant_id = ? AND r.settlement_id = s.id AND r.status = 'reversed') <> ?
            OR ROUND(COALESCE((SELECT SUM(r.reserved_amount)
               FROM diagnostic_performer_reserves r
               WHERE r.tenant_id = ? AND r.settlement_id = s.id AND r.status = 'reversed'), 0), 2) <> ?
            OR (SELECT COUNT(*) FROM doctor_commission_accruals a
               WHERE a.tenant_id = ? AND a.settlement_id = s.id
                 AND a.performer_reserve_id IS NOT NULL AND a.status = 'cancelled') <> ?
            OR (SELECT COUNT(*) FROM cash_drawer_movements m
               WHERE m.tenant_id = ? AND m.reference_type = ? AND m.reference_id = ?) <> 1
          )
      `).bind(
        tenantId,
        settlementId,
        tenantId,
        reserveCount,
        tenantId,
        grossReserveAmount,
        tenantId,
        reserveCount,
        tenantId,
        reversalReferenceType,
        settlementId,
      ),
    ];
    await executeLiveCancelledCompensationSettlementReversal(c.env.DB, {
      tenantId,
      legacyStatements,
      settlementSourceId: settlement.idempotency_key?.trim() || String(settlement.id),
      reversalSourceId: data.idempotencyKey,
      reasonCode: 'performer_payout_cancelled',
      reversedAtUtc,
      businessDate: date,
    });

    const reversalLines = (originalLines ?? []).map((line) => ({
      accountId: Number(line.account_id),
      debit: amount(line.credit_amount),
      credit: amount(line.debit_amount),
      memo: `Reverse ${line.memo ?? `voucher ${originalVoucherId}`}`,
    }));
    const accountingResult = await recordAndPostAccountingEvent(c.env.DB, {
      tenantId,
      sourceType: 'doctor_commission_settlement_reversal',
      sourceId: `${settlementId}:${data.idempotencyKey}`,
      eventType: ACCOUNTING_EVENT_TYPES.manualJournal,
      eventDate: date,
      createdBy: userId,
      payload: {
        lines: reversalLines,
        reversalOfVoucherId: originalVoucherId,
        settlementId,
        amount: reversalCashAmount,
        reason: data.reason,
      },
    });

    if (accountingResult.voucherId) {
      await c.env.DB.prepare(`
        UPDATE doctor_commission_settlements
        SET reversal_voucher_id = ?
        WHERE tenant_id = ? AND id = ? AND reversed_at IS NOT NULL
      `).bind(accountingResult.voucherId, tenantId, settlementId).run();
    }

    await shadowCreateCashLedgerEntry(c.env.DB, {
      tenantId,
      sourceType: 'doctor_commission_settlement_reversal',
      sourceId: settlementId,
      sourceNo: settlement.settlement_no ?? `DPS-${settlementId}`,
      eventType: 'DOCTOR_PAYOUT_REVERSED',
      movementDirection: 'in',
      cashStatus: 'PAYOUT_REVERSED',
      status: 'posted',
      amount: reversalCashAmount,
      expectedAmount: reversalCashAmount,
      receivedAmount: reversalCashAmount,
      dueAmount: 0,
      paymentMethod: 'cash',
      fromUserId: Number(settlement.doctor_id),
      toUserId: Number(userId),
      counterSessionId: Number(activeSession.id),
      counterId: Number(activeSession.counter_id),
      currentLocationType: 'counter',
      currentLocationLabel: activeSession.counter_name || `Counter #${activeSession.counter_id}`,
      accountingVoucherId: accountingResult.voucherId ?? null,
      accountingPostingStatus: accountingResult.voucherId ? 'posted' : 'not_posted',
      referenceType: 'doctor_commission_settlement_reversal',
      referenceId: settlementId,
      note: reversalDescription,
      metadata: {
        settlementId,
        originalVoucherId,
        reversalVoucherId: accountingResult.voucherId ?? null,
        reason: data.reason,
      },
      idempotencyKey: `cash-ledger:doctor-payout:${settlementId}:reversed`,
      createdBy: Number(userId),
      occurredAt: new Date().toISOString(),
      postedAt: accountingResult.voucherId ? new Date().toISOString() : null,
    });

    await createAuditLog(c.env, tenantId, userId, 'PAYMENT', 'doctor_commission_settlements', settlementId, null, {
      action: 'performer_payout_reversed',
      settlementId,
      settlementNo: settlement.settlement_no,
      doctorId: settlement.doctor_id,
      doctorName: settlement.doctor_name,
      reserveCount,
      amount: reversalCashAmount,
      grossReserveAmount,
      originalVoucherId,
      reversalVoucherId: accountingResult.voucherId ?? null,
      originalCounterSessionId: settlement.counter_session_id ?? null,
      originalCounterId: settlement.counter_id ?? null,
      reversalCounterSessionId: activeSession.id,
      reversalCounterId: activeSession.counter_id,
      reason: data.reason,
    });

    const responseBody = {
      success: true,
      message: 'Performer payout reversed',
      settlementId,
      settlementNo: settlement.settlement_no,
      amount: reversalCashAmount,
      reserveCount,
      reversalVoucherId: accountingResult.voucherId ?? null,
    };
    await completeMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType: PERFORMER_RESERVE_REVERSAL_MUTATION_TYPE,
      idempotencyKey: data.idempotencyKey,
      sourceId: settlementId,
      responseBody,
    });
    return c.json(responseBody);
  } catch (error) {
    if (idempotencyReserved) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType: PERFORMER_RESERVE_REVERSAL_MUTATION_TYPE,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => console.error('Failed to mark performer payout reversal idempotency failed:', markError));
    }
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/UNIQUE constraint|constraint failed|FOREIGN KEY|NOT NULL/i.test(message)) {
      throw new HTTPException(409, { message: 'Performer payout reversal could not be completed because the settlement changed. Refresh and try again.' });
    }
    throw error;
  }
});

routes.post('/sessions/:id/pay-reserves', requireRole(...ROLES), zValidator('json', receptionPerformerReservePayoutSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(c.req.param('id'));
  const data = c.req.valid('json');
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw new HTTPException(400, { message: 'Invalid counter session' });
  }

  const reserveIds = normalizeIds(data.reserveIds);
  const normalizedPayload = {
    doctorId: data.doctorId,
    reserveIds,
    lineOverrides: [...data.lineOverrides].sort((a, b) => a.lineId - b.lineId),
    receiverType: data.receiverType,
    receiverName: data.receiverName,
    receiverReference: data.receiverReference?.trim() || null,
    paymentMethod: data.paymentMethod,
    adjustments: data.adjustments,
    adjustmentReason: data.adjustmentReason?.trim() || null,
    note: data.note?.trim() || null,
    sessionId,
  };
  const requestHash = await createIdempotencyRequestHash(normalizedPayload);
  let idempotencyReserved = false;

  const replay = await readMutationIdempotencyReplay(c.env.DB, {
    tenantId,
    mutationType: PERFORMER_RESERVE_MUTATION_TYPE,
    idempotencyKey: data.idempotencyKey,
    requestHash,
    mismatchMessage: 'Idempotency key was already used for a different performer reserve payout',
    conflictMessage: 'Performer reserve payout is already being processed. Please retry shortly.',
  });
  if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);

  const reservedRequest = await reserveMutationIdempotencyKey(c.env.DB, {
    tenantId,
    mutationType: PERFORMER_RESERVE_MUTATION_TYPE,
    idempotencyKey: data.idempotencyKey,
    requestHash,
    createdBy: userId,
    mismatchMessage: 'Idempotency key was already used for a different performer reserve payout',
    conflictMessage: 'Performer reserve payout is already being processed. Please retry shortly.',
  });
  if (reservedRequest) return c.json({ ...reservedRequest.responseBody, idempotent: true }, 201);
  idempotencyReserved = true;

  try {
    const activeSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
      workstationId: getBillingWorkstationId(c),
      requireCurrentWorkstation: true,
    });
    if (!activeSession || Number(activeSession.id) !== sessionId) {
      throw new HTTPException(404, { message: 'Active counter session not found for this workstation' });
    }

    const doctor = await c.env.DB.prepare(`
      SELECT id, name, specialty, department, bmdc_reg_no, user_id, is_active
      FROM doctors
      WHERE tenant_id = ? AND id = ? AND COALESCE(is_active, 1) = 1
      LIMIT 1
    `).bind(tenantId, data.doctorId).first<{
      id: number;
      name: string;
      specialty: string | null;
      department: string | null;
      bmdc_reg_no: string | null;
      user_id: number | null;
      is_active: number | null;
    }>();
    if (!doctor?.id) throw new HTTPException(404, { message: 'Active doctor not found' });

    const placeholders = reserveIds.map(() => '?').join(',');
    const { results: rows } = await c.env.DB.prepare(`
      SELECT
        r.id AS reserve_id,
        r.bill_id,
        r.invoice_item_id,
        r.patient_id,
        r.visit_id,
        r.billing_service_item_id,
        r.diagnostic_kind,
        r.lab_test_id,
        r.radiology_imaging_item_id,
        r.test_name,
        r.net_unit_service_amount,
        MAX(
          COALESCE(ii.unit_price, 0),
          COALESCE(r.unit_service_amount, 0),
          COALESCE(r.net_unit_service_amount, 0),
          COALESCE(r.reserved_amount, 0)
        ) AS payout_maximum_amount,
        r.reserved_amount,
        r.rule_rate_type,
        r.rule_rate_value,
        r.canonical_source_key,
        r.status,
        CASE WHEN ${paidBill('b')} THEN 1 ELSE 0 END AS bill_is_paid,
        COALESCE(ii.status, 'active') AS item_status
      FROM diagnostic_performer_reserves r
      JOIN bills b ON b.id = r.bill_id AND b.tenant_id = r.tenant_id
      JOIN invoice_items ii ON ii.id = r.invoice_item_id AND ii.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.id IN (${placeholders})
      ORDER BY r.id ASC
    `).bind(tenantId, ...reserveIds).all<PerformerReservePayoutRow>();

    if ((rows ?? []).length !== reserveIds.length) {
      throw new HTTPException(409, { message: 'Selected performer reserves changed. Refresh and try again.' });
    }
    if ((rows ?? []).some((row) => row.status !== 'reserved' || row.item_status !== 'active')) {
      throw new HTTPException(409, { message: 'Only active unassigned performer reserves can be paid' });
    }
    if ((rows ?? []).some((row) => Number(row.bill_is_paid ?? 0) !== 1)) {
      throw new HTTPException(409, { message: 'Linked bill must be fully paid before performer payout' });
    }

    let payoutLines: ReturnType<typeof resolvePayoutLineAmounts>;
    try {
      payoutLines = resolvePayoutLineAmounts(
        (rows ?? []).map((row) => ({
          lineId: Number(row.reserve_id),
          calculatedAmount: amount(row.reserved_amount),
          maximumAmount: amount(row.payout_maximum_amount),
        })),
        data.lineOverrides,
      );
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : 'Invalid performer payout override' });
    }
    const payoutLineById = new Map(payoutLines.map((line) => [line.lineId, line]));
    const calculatedReserveAmount = amount(payoutLines.reduce((sum, line) => sum + line.calculatedAmount, 0));
    const grossReserveAmount = amount(payoutLines.reduce((sum, line) => sum + line.finalAmount, 0));
    const grossServiceAmount = amount((rows ?? []).reduce((sum, row) => sum + amount(row.net_unit_service_amount), 0));
    const advanceDeduction = amount(data.adjustments.advanceDeduction);
    const otherAdjustment = amount(data.adjustments.otherAdjustment);
    const roundingAdjustment = amount(data.adjustments.roundingAdjustment);
    const netPaidAmount = amount(grossReserveAmount - advanceDeduction + otherAdjustment + roundingAdjustment);
    if (netPaidAmount <= 0) throw new HTTPException(400, { message: 'Payout amount must be positive' });

    const drawer = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, sessionId);
    if (netPaidAmount > amount(drawer.expectedCash)) {
      throw new HTTPException(400, { message: `Available drawer cash is ${amount(drawer.expectedCash).toFixed(2)}` });
    }

    const date = getTodayGMT6();
    const settledAtUtc = new Date().toISOString();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, date, 'Performer reserve payout from reception counter');
    const settlementNo = await nextDoctorPayoutSettlementNo(c.env.DB, tenantId);
    const referenceNo = settlementNo;
    const note = data.note?.trim() || data.adjustmentReason?.trim() || null;
    const receiverReference = data.receiverReference?.trim() || null;

    const settlementInsert = c.env.DB.prepare(`
      INSERT INTO doctor_commission_settlements
        (tenant_id, doctor_id, settlement_date, total_amount, payment_mode, reference_no, settlement_no,
         gross_commission_amount, advance_deduction, other_adjustment, rounding_adjustment, net_paid_amount,
         receiver_type, receiver_name, receiver_reference, payment_method, counter_session_id, counter_id,
         idempotency_key, notes, created_by)
      VALUES (?, ?, ?, ?, 'cash', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      data.doctorId,
      date,
      netPaidAmount,
      referenceNo,
      settlementNo,
      grossReserveAmount,
      advanceDeduction,
      otherAdjustment,
      roundingAdjustment,
      netPaidAmount,
      data.receiverType,
      data.receiverName,
      receiverReference,
      sessionId,
      activeSession.counter_id,
      data.idempotencyKey,
      note,
      userId,
    );

    const accrualInserts = (rows ?? []).map((row) => {
      const payoutLine = payoutLineById.get(Number(row.reserve_id));
      if (!payoutLine) throw new HTTPException(409, { message: 'Selected performer reserves changed. Refresh and try again.' });
      const payoutAccrualSourceKey = `performer-reserve-payout:${row.canonical_source_key ?? row.reserve_id}`;
      const accrualNote = payoutLine.overrideReason
        ? `Performer reserve payout for ${row.test_name}; override: ${payoutLine.overrideReason}`
        : `Performer reserve payout for ${row.test_name}`;
      return c.env.DB.prepare(`
        INSERT INTO doctor_commission_accruals
          (tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_test_id, canonical_source_key,
           source_type, incentive_type, gross_amount, commission_base_amount, performer_reserve_amount,
           performer_reserve_id, commission_rate_bps, commission_flat_amount, commission_amount,
           earned_commission_amount, payable_commission_amount, paid_amount, balance_amount,
           settlement_id, status, accrued_date, paid_date, notes, created_by)
        SELECT ?, ?, r.patient_id, r.visit_id, r.bill_id, r.lab_test_id, ?,
               'lab_test', 'performer', r.net_unit_service_amount, r.net_unit_service_amount, r.reserved_amount,
               r.id,
               CASE WHEN r.rule_rate_type = 'percent' THEN CAST(r.rule_rate_value AS INTEGER) ELSE 0 END,
               CASE WHEN r.rule_rate_type = 'flat' THEN r.rule_rate_value ELSE 0 END,
               ?, ?, ?, ?, 0,
               s.id, 'paid', ?, ?, ?, ?
        FROM diagnostic_performer_reserves r
        JOIN doctor_commission_settlements s
          ON s.tenant_id = r.tenant_id AND s.idempotency_key = ?
        WHERE r.tenant_id = ? AND r.id = ? AND r.status = 'reserved'
      `).bind(
        tenantId,
        data.doctorId,
        payoutAccrualSourceKey,
        payoutLine.finalAmount,
        payoutLine.finalAmount,
        payoutLine.finalAmount,
        payoutLine.finalAmount,
        date,
        date,
        accrualNote,
        userId,
        data.idempotencyKey,
        tenantId,
        row.reserve_id,
      );
    });

    const settlementItemInserts = (rows ?? []).map((row) => {
      const payoutLine = payoutLineById.get(Number(row.reserve_id));
      if (!payoutLine) throw new HTTPException(409, { message: 'Selected performer reserves changed. Refresh and try again.' });
      return c.env.DB.prepare(`
        INSERT INTO doctor_commission_settlement_items
          (tenant_id, settlement_id, accrual_id, doctor_id, source_type, bill_id, patient_id,
           service_date, gross_amount, commission_amount, calculated_commission_amount,
           override_amount, override_reason, overridden_by, overridden_at)
        SELECT a.tenant_id, a.settlement_id, a.id, a.doctor_id, a.source_type, a.bill_id, a.patient_id,
               a.accrued_date, a.gross_amount, ?, ?, ?, ?, ?,
               CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', '+6 hours') END
        FROM doctor_commission_accruals a
        JOIN doctor_commission_settlements s
          ON s.id = a.settlement_id AND s.tenant_id = a.tenant_id
        WHERE a.tenant_id = ?
          AND a.doctor_id = ?
          AND a.performer_reserve_id = ?
          AND s.idempotency_key = ?
      `).bind(
        payoutLine.finalAmount,
        payoutLine.calculatedAmount,
        payoutLine.overrideReason ? payoutLine.finalAmount : null,
        payoutLine.overrideReason,
        payoutLine.overrideReason ? userId : null,
        payoutLine.overrideReason,
        tenantId,
        data.doctorId,
        row.reserve_id,
        data.idempotencyKey,
      );
    });

    const reserveUpdate = c.env.DB.prepare(`
      UPDATE diagnostic_performer_reserves
      SET status = 'paid',
          assigned_doctor_id = ?,
          commission_accrual_id = (
            SELECT a.id
            FROM doctor_commission_accruals a
            WHERE a.tenant_id = diagnostic_performer_reserves.tenant_id
              AND a.performer_reserve_id = diagnostic_performer_reserves.id
            LIMIT 1
          ),
          settlement_id = (
            SELECT s.id FROM doctor_commission_settlements s
            WHERE s.tenant_id = ? AND s.idempotency_key = ? LIMIT 1
          ),
          paid_at = datetime('now', '+6 hours'),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND id IN (${placeholders}) AND status = 'reserved'
    `).bind(data.doctorId, tenantId, data.idempotencyKey, tenantId, ...reserveIds);

    const transitionGuard = c.env.DB.prepare(`
      INSERT INTO doctor_commission_settlement_items
        (tenant_id, settlement_id, accrual_id, doctor_id, source_type, gross_amount, commission_amount)
      SELECT NULL, s.id, -1, s.doctor_id, 'performer_reserve_transition_guard', 0, 0
      FROM doctor_commission_settlements s
      WHERE s.tenant_id = ? AND s.idempotency_key = ?
        AND (
          (SELECT COUNT(*) FROM doctor_commission_accruals a
           WHERE a.tenant_id = ? AND a.performer_reserve_id IN (${placeholders})
             AND a.settlement_id = s.id AND a.status = 'paid') <> ?
          OR
          (SELECT COUNT(*) FROM diagnostic_performer_reserves r
           WHERE r.tenant_id = ? AND r.id IN (${placeholders})
             AND r.settlement_id = s.id AND r.status = 'paid') <> ?
          OR ROUND(COALESCE((SELECT SUM(a.commission_amount)
             FROM doctor_commission_accruals a
             WHERE a.tenant_id = ? AND a.performer_reserve_id IN (${placeholders})
               AND a.settlement_id = s.id), 0), 2) <> ?
        )
    `).bind(
      tenantId,
      data.idempotencyKey,
      tenantId,
      ...reserveIds,
      reserveIds.length,
      tenantId,
      ...reserveIds,
      reserveIds.length,
      tenantId,
      ...reserveIds,
      grossReserveAmount,
    );

    const legacyStatements = [
      settlementInsert,
      ...accrualInserts,
      ...settlementItemInserts,
      reserveUpdate,
      transitionGuard,
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount,
           payment_method, reference_type, reference_id, description, created_by)
        SELECT ?, ?, ?, ?, 'cash_out', ?, 'cash', 'doctor_commission_settlement', s.id, ?, ?
        FROM doctor_commission_settlements s
        WHERE s.tenant_id = ? AND s.idempotency_key = ?
      `).bind(
        tenantId,
        sessionId,
        activeSession.counter_id,
        userId,
        netPaidAmount,
        `Performer reserve payout - ${doctor.name}`,
        userId,
        tenantId,
        data.idempotencyKey,
      ),
      c.env.DB.prepare(`
        UPDATE doctor_commission_settlements
        SET cash_movement_id = (
          SELECT m.id FROM cash_drawer_movements m
          WHERE m.tenant_id = doctor_commission_settlements.tenant_id
            AND m.reference_type = 'doctor_commission_settlement'
            AND m.reference_id = CAST(doctor_commission_settlements.id AS TEXT)
            AND m.movement_type = 'cash_out'
          ORDER BY m.id DESC LIMIT 1
        )
        WHERE tenant_id = ? AND idempotency_key = ? AND cash_movement_id IS NULL
      `).bind(tenantId, data.idempotencyKey),
    ];

    await executeLiveCompensationSettlement(c.env.DB, {
      tenantId,
      legacyStatements,
      settlementSourceId: data.idempotencyKey,
      settlementNumber: settlementNo,
      practitioner: {
        doctorId: data.doctorId,
        displayName: doctor.name,
        specialty: doctor.specialty,
        department: doctor.department,
        registrationNumber: doctor.bmdc_reg_no,
        userId: doctor.user_id,
        isActive: Number(doctor.is_active ?? 1) === 1,
      },
      paymentMethod: 'cash',
      grossAmount: grossReserveAmount,
      netPaidAmount,
      settledAtUtc,
      businessDate: date,
      accruals: (rows ?? []).map((row) => {
        const payoutLine = payoutLineById.get(Number(row.reserve_id));
        if (!payoutLine) throw new HTTPException(409, { message: 'Selected performer reserves changed. Refresh and try again.' });
        return {
          sourceType: 'legacy_diagnostic_performer_reserve' as const,
          sourcePublicId: row.canonical_source_key?.trim() || String(row.reserve_id),
          expectedPayableAmount: payoutLine.calculatedAmount,
          settlementPayableAmount: payoutLine.finalAmount,
          overrideReason: payoutLine.overrideReason,
          legacyAccrualSourcePublicId: `performer-reserve-payout:${row.canonical_source_key ?? row.reserve_id}`,
        };
      }),
    });

    const settlement = await c.env.DB.prepare(`
      SELECT id
      FROM doctor_commission_settlements
      WHERE tenant_id = ? AND idempotency_key = ?
      LIMIT 1
    `).bind(tenantId, data.idempotencyKey).first<{ id: number }>();
    const settlementId = Number(settlement?.id ?? 0);
    if (!Number.isInteger(settlementId) || settlementId <= 0) {
      throw new HTTPException(500, { message: 'Performer reserve payout failed to allocate settlement id' });
    }

    const { results: accrualRows } = await c.env.DB.prepare(`
      SELECT id FROM doctor_commission_accruals
      WHERE tenant_id = ? AND performer_reserve_id IN (${placeholders}) AND settlement_id = ?
      ORDER BY id ASC
    `).bind(tenantId, ...reserveIds, settlementId).all<{ id: number }>();
    const accrualIds = (accrualRows ?? []).map((row) => Number(row.id));

    const postResult = await recordAndPostAccountingEvent(c.env.DB, {
      tenantId,
      sourceType: 'doctor_commission_settlement',
      sourceId: settlementId,
      eventType: ACCOUNTING_EVENT_TYPES.commissionSettled,
      eventDate: date,
      createdBy: userId,
      payload: {
        settlementId,
        settlementNo,
        doctorId: data.doctorId,
        reserveIds,
        accrualIds,
        amount: netPaidAmount,
        paymentMethod: 'cash',
        referenceNo,
        counterSessionId: sessionId,
      },
    });

    if (postResult.voucherId) {
      await c.env.DB.prepare(`
        UPDATE doctor_commission_settlements
        SET voucher_id = ?, accounting_voucher_id = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(postResult.voucherId, postResult.voucherId, settlementId, tenantId).run();
    }

    await shadowWriteDoctorPayout({
      db: c.env.DB,
      tenantId,
      settlementId,
      settlementNo,
      doctorId: data.doctorId,
      doctorName: doctor.name,
      amount: netPaidAmount,
      userId,
      counterSessionId: sessionId,
      counterId: activeSession.counter_id,
      referenceNo,
      accrualIds,
      voucherId: postResult.voucherId ?? null,
    });

    await createAuditLog(c.env, tenantId, userId, 'PAYMENT', 'diagnostic_performer_reserves', settlementId, null, {
      settlementId,
      settlementNo,
      doctorId: data.doctorId,
      doctorName: doctor.name,
      reserveIds,
      accrualIds,
      quantity: reserveIds.length,
      grossServiceAmount,
      calculatedReserveAmount,
      grossReserveAmount,
      payoutOverrides: payoutLines.filter((line) => line.overrideReason).map((line) => ({
        reserveId: line.lineId,
        calculatedAmount: line.calculatedAmount,
        finalAmount: line.finalAmount,
        differenceAmount: line.differenceAmount,
        reason: line.overrideReason,
      })),
      netPaidAmount,
      counterSessionId: sessionId,
      referenceNo,
    });

    const responseBody = {
      success: true,
      message: 'Performer reserve payout recorded',
      settlement: {
        id: settlementId,
        settlementId,
        settlementNo,
        doctorId: data.doctorId,
        doctorName: doctor.name,
        grossAmount: grossServiceAmount,
        grossCommissionAmount: grossReserveAmount,
        advanceDeduction,
        otherAdjustment,
        roundingAdjustment,
        netPaidAmount,
        receiverType: data.receiverType,
        receiverName: data.receiverName,
        receiverReference,
        paymentMethod: 'cash',
        referenceNo,
        paidCount: reserveIds.length,
      },
      settlementId,
      voucherId: postResult.voucherId ?? null,
      amount: netPaidAmount,
      doctorId: data.doctorId,
      doctorName: doctor.name,
      paidCount: reserveIds.length,
      reserveIds,
      referenceNo,
    };

    await completeMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType: PERFORMER_RESERVE_MUTATION_TYPE,
      idempotencyKey: data.idempotencyKey,
      sourceId: settlementId,
      responseBody,
    });
    return c.json(responseBody, 201);
  } catch (error) {
    if (idempotencyReserved) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType: PERFORMER_RESERVE_MUTATION_TYPE,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => {
        console.error('Failed to mark performer reserve payout idempotency failed:', markError);
      });
    }
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/UNIQUE constraint|constraint failed|FOREIGN KEY|NOT NULL/i.test(message)) {
      throw new HTTPException(409, { message: 'Performer reserve payout could not be completed because selected reserves changed. Refresh and try again.' });
    }
    throw error;
  }
});

routes.post('/sessions/:id/pay', requireRole(...ROLES), zValidator('json', receptionDoctorPayoutSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(c.req.param('id'));
  const data = c.req.valid('json');
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new HTTPException(400, { message: 'Invalid counter session' });

  const ids = normalizeIds(data.accrualIds);
  const note = data.note?.trim() || data.notes?.trim() || null;
  const normalizedPayload = {
    accrualIds: ids,
    lineOverrides: [...data.lineOverrides].sort((a, b) => a.lineId - b.lineId),
    receiverType: data.receiverType,
    receiverName: data.receiverName,
    receiverReference: data.receiverReference?.trim() || null,
    paymentMethod: data.paymentMethod,
    adjustments: data.adjustments,
    adjustmentReason: data.adjustmentReason?.trim() || null,
    note,
    attachmentKey: data.attachmentKey?.trim() || null,
    sessionId,
  };
  const requestHash = await createIdempotencyRequestHash(normalizedPayload);
  let idempotencyReserved = false;

  const replay = await readMutationIdempotencyReplay(c.env.DB, {
    tenantId,
    mutationType: MUTATION_TYPE,
    idempotencyKey: data.idempotencyKey,
    requestHash,
    mismatchMessage: 'Idempotency key was already used for a different doctor payout request',
    conflictMessage: 'Doctor payout is already being processed. Please retry shortly.',
  });
  if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);

  const reserved = await reserveMutationIdempotencyKey(c.env.DB, {
    tenantId,
    mutationType: MUTATION_TYPE,
    idempotencyKey: data.idempotencyKey,
    requestHash,
    createdBy: userId,
    mismatchMessage: 'Idempotency key was already used for a different doctor payout request',
    conflictMessage: 'Doctor payout is already being processed. Please retry shortly.',
  });
  if (reserved) return c.json({ ...reserved.responseBody, idempotent: true }, 201);
  idempotencyReserved = true;

  try {
    const activeSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
      workstationId: getBillingWorkstationId(c),
      requireCurrentWorkstation: true,
    });
    if (!activeSession || Number(activeSession.id) !== sessionId) {
      throw new HTTPException(404, { message: 'Active counter session not found for this workstation' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const payableSql = effectivePayableCommission('a');
    const { results: rows } = await c.env.DB.prepare(`
      SELECT a.id, a.doctor_id, d.name AS doctor_name, d.specialty AS doctor_specialization,
             d.department AS doctor_department, d.bmdc_reg_no AS doctor_registration_number,
             d.user_id AS doctor_user_id, d.is_active AS doctor_is_active,
             a.patient_id, p.name AS patient_name, p.patient_code,
             a.bill_id, b.invoice_no, a.source_type, a.canonical_source_key,
             a.gross_amount, a.commission_amount,
             ${payableSql} AS payable_amount,
             a.status, a.accrued_date, a.notes,
             CASE WHEN ${paidBill('b')} THEN 1 ELSE 0 END AS bill_is_paid
      FROM doctor_commission_accruals a
      JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      LEFT JOIN bills b ON b.id = a.bill_id AND b.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.id IN (${placeholders})
    `).bind(tenantId, ...ids).all<Row>();

    if ((rows ?? []).length !== ids.length) throw new HTTPException(409, { message: 'Selected payables changed. Refresh and try again.' });
    const doctorIds = new Set((rows ?? []).map((row) => Number(row.doctor_id)));
    if (doctorIds.size !== 1) throw new HTTPException(400, { message: 'Selected items do not belong to one doctor' });
    const doctorId = Number((rows ?? [])[0]?.doctor_id ?? data.doctorId ?? 0);
    if (data.doctorId && doctorId !== data.doctorId) throw new HTTPException(400, { message: 'Selected items do not belong to this doctor' });
    if ((rows ?? []).some((row) => !['accrued', 'approved'].includes(String(row.status)))) throw new HTTPException(409, { message: 'Only pending/approved payables can be paid' });
    if ((rows ?? []).some((row) => Number(row.bill_is_paid ?? 0) !== 1)) throw new HTTPException(409, { message: 'Linked bill must be fully paid before doctor payout' });
    if ((rows ?? []).some((row) => amount(row.payable_amount) <= 0)) {
      throw new HTTPException(409, { message: 'One or more selected payables no longer have a positive balance. Refresh and try again.' });
    }

    let payoutLines: ReturnType<typeof resolvePayoutLineAmounts>;
    try {
      payoutLines = resolvePayoutLineAmounts(
        (rows ?? []).map((row) => ({
          lineId: Number(row.id),
          calculatedAmount: amount(row.payable_amount),
          maximumAmount: amount(row.gross_amount),
        })),
        data.lineOverrides,
      );
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : 'Invalid doctor payout override' });
    }
    const payoutLineById = new Map(payoutLines.map((line) => [line.lineId, line]));
    const calculatedCommissionAmount = amount(payoutLines.reduce((sum, line) => sum + line.calculatedAmount, 0));
    const grossCommissionAmount = amount(payoutLines.reduce((sum, line) => sum + line.finalAmount, 0));
    const grossAmount = amount((rows ?? []).reduce((sum, row) => sum + amount(row.gross_amount), 0));
    const advanceDeduction = amount(data.adjustments.advanceDeduction);
    const otherAdjustment = amount(data.adjustments.otherAdjustment);
    const roundingAdjustment = amount(data.adjustments.roundingAdjustment);
    const preRecoveryNetAmount = amount(
      grossCommissionAmount - advanceDeduction + otherAdjustment + roundingAdjustment,
    );
    if (preRecoveryNetAmount <= 0) throw new HTTPException(400, { message: 'Payout amount must be positive' });

    // Reception payouts are daily cash settlements. Earlier recoveries remain outstanding
    // in the doctor settlement ledger and must not be deducted from today's payout.
    const clawbackDeduction = 0;
    const netPaidAmount = preRecoveryNetAmount;

    const drawer = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, sessionId);
    if (netPaidAmount > amount(drawer.expectedCash)) {
      throw new HTTPException(400, { message: `Available drawer cash is ${amount(drawer.expectedCash).toFixed(2)}` });
    }

    const date = getTodayGMT6();
    const settledAtUtc = new Date().toISOString();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, date, 'Doctor payout from reception counter');
    const doctorName = rows?.[0]?.doctor_name ?? `Doctor #${doctorId}`;
    const settlementNo = data.referenceNo?.trim() || await nextDoctorPayoutSettlementNo(c.env.DB, tenantId);
    const referenceNo = data.referenceNo?.trim() || settlementNo;
    const receiverReference = data.receiverReference?.trim() || null;
    const attachmentKey = data.attachmentKey?.trim() || null;
    const adjustmentNote = data.adjustmentReason?.trim() || null;

    const settlementInsert = c.env.DB.prepare(`
      INSERT INTO doctor_commission_settlements
        (tenant_id, doctor_id, settlement_date, total_amount, payment_mode, reference_no, settlement_no,
         gross_commission_amount, advance_deduction, other_adjustment, rounding_adjustment, net_paid_amount,
         receiver_type, receiver_name, receiver_reference, payment_method, counter_session_id, counter_id,
         attachment_key, idempotency_key, notes, created_by)
      VALUES (?, ?, ?, ?, 'cash', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      doctorId,
      date,
      netPaidAmount,
      referenceNo,
      settlementNo,
      grossCommissionAmount,
      advanceDeduction,
      otherAdjustment,
      roundingAdjustment,
      netPaidAmount,
      data.receiverType,
      data.receiverName,
      receiverReference,
      sessionId,
      activeSession.counter_id,
      attachmentKey,
      data.idempotencyKey,
      note || adjustmentNote,
      userId,
    );

    const settlementItemInserts = (rows ?? []).map((row) => {
      const payoutLine = payoutLineById.get(Number(row.id));
      if (!payoutLine) throw new HTTPException(409, { message: 'Selected payables changed. Refresh and try again.' });
      return c.env.DB.prepare(`
        INSERT INTO doctor_commission_settlement_items
          (tenant_id, settlement_id, accrual_id, doctor_id, source_type, bill_id, patient_id,
           service_date, gross_amount, commission_amount, calculated_commission_amount,
           override_amount, override_reason, overridden_by, overridden_at)
        SELECT ?, s.id, a.id, a.doctor_id, a.source_type, a.bill_id, a.patient_id, a.accrued_date,
               COALESCE(a.gross_amount, 0), ?, ?, ?, ?, ?,
               CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', '+6 hours') END
        FROM doctor_commission_settlements s
        JOIN doctor_commission_accruals a
          ON a.tenant_id = s.tenant_id
         AND a.doctor_id = ?
         AND a.id = ?
         AND a.status IN ('accrued', 'approved')
        LEFT JOIN bills b ON b.id = a.bill_id AND b.tenant_id = a.tenant_id
        WHERE s.tenant_id = ?
          AND s.idempotency_key = ?
          AND ${paidBill('b')}
      `).bind(
        tenantId,
        payoutLine.finalAmount,
        payoutLine.calculatedAmount,
        payoutLine.overrideReason ? payoutLine.finalAmount : null,
        payoutLine.overrideReason,
        payoutLine.overrideReason ? userId : null,
        payoutLine.overrideReason,
        doctorId,
        row.id,
        tenantId,
        data.idempotencyKey,
      );
    });

    const accrualPaidUpdates = (rows ?? []).map((row) => {
      const payoutLine = payoutLineById.get(Number(row.id));
      if (!payoutLine) throw new HTTPException(409, { message: 'Selected payables changed. Refresh and try again.' });
      const overrideNote = payoutLine.overrideReason
        ? `Payout override ${payoutLine.calculatedAmount} -> ${payoutLine.finalAmount}: ${payoutLine.overrideReason}`
        : null;
      return c.env.DB.prepare(`
        UPDATE doctor_commission_accruals
        SET status = 'paid',
            paid_date = ?,
            paid_amount = ?,
            balance_amount = 0,
            settlement_id = (
              SELECT s.id FROM doctor_commission_settlements s WHERE s.tenant_id = ? AND s.idempotency_key = ? LIMIT 1
            ),
            notes = CASE
              WHEN ? IS NOT NULL THEN TRIM(COALESCE(notes, '') || ' ' || ?)
              ELSE COALESCE(?, notes)
            END,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ? AND doctor_id = ? AND id = ? AND status IN ('accrued', 'approved')
      `).bind(
        date,
        payoutLine.finalAmount,
        tenantId,
        data.idempotencyKey,
        overrideNote,
        overrideNote,
        note,
        tenantId,
        doctorId,
        row.id,
      );
    });


    const transitionGuard = c.env.DB.prepare(`
      INSERT INTO doctor_commission_settlement_items
        (tenant_id, settlement_id, accrual_id, doctor_id, source_type, gross_amount, commission_amount)
      SELECT NULL, s.id, -1, s.doctor_id, 'transition_guard', 0, 0
      FROM doctor_commission_settlements s
      WHERE s.tenant_id = ?
        AND s.idempotency_key = ?
        AND (
          (SELECT COUNT(*)
             FROM doctor_commission_settlement_items si
            WHERE si.tenant_id = ?
              AND si.settlement_id = s.id) <> ?
          OR
          (SELECT COUNT(*)
             FROM doctor_commission_accruals a
            WHERE a.tenant_id = ?
              AND a.doctor_id = ?
              AND a.id IN (${placeholders})
              AND a.status = 'paid'
              AND a.settlement_id = s.id) <> ?
          OR
          ROUND(COALESCE((
            SELECT SUM(si.commission_amount)
            FROM doctor_commission_settlement_items si
            WHERE si.tenant_id = ?
              AND si.settlement_id = s.id
          ), 0), 2) <> ?
        )
    `).bind(
      tenantId,
      data.idempotencyKey,
      tenantId,
      ids.length,
      tenantId,
      doctorId,
      ...ids,
      ids.length,
      tenantId,
      grossCommissionAmount,
    );

    const legacyStatements = [
      settlementInsert,
      ...settlementItemInserts,
      ...accrualPaidUpdates,
      transitionGuard,
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
        SELECT ?, ?, ?, ?, 'cash_out', ?, 'cash', 'doctor_commission_settlement', s.id, ?, ?
        FROM doctor_commission_settlements s
        WHERE s.tenant_id = ? AND s.idempotency_key = ?
      `).bind(
        tenantId,
        sessionId,
        activeSession.counter_id,
        userId,
        netPaidAmount,
        `Doctor payout - ${doctorName}`,
        userId,
        tenantId,
        data.idempotencyKey,
      ),
      c.env.DB.prepare(`
        UPDATE doctor_commission_settlements
        SET cash_movement_id = (
          SELECT m.id
          FROM cash_drawer_movements m
          WHERE m.tenant_id = doctor_commission_settlements.tenant_id
            AND m.reference_type = 'doctor_commission_settlement'
            AND m.reference_id = CAST(doctor_commission_settlements.id AS TEXT)
            AND m.movement_type = 'cash_out'
          ORDER BY m.id DESC
          LIMIT 1
        )
        WHERE tenant_id = ?
          AND idempotency_key = ?
          AND cash_movement_id IS NULL
      `).bind(tenantId, data.idempotencyKey),
    ];

    const doctorRow = (rows ?? [])[0];
    await executeLiveCompensationSettlement(c.env.DB, {
      tenantId,
      legacyStatements,
      settlementSourceId: data.idempotencyKey,
      settlementNumber: settlementNo,
      practitioner: {
        doctorId,
        displayName: doctorName,
        specialty: doctorRow?.doctor_specialization ?? null,
        department: doctorRow?.doctor_department ?? null,
        registrationNumber: doctorRow?.doctor_registration_number ?? null,
        userId: doctorRow?.doctor_user_id ?? null,
        isActive: Number(doctorRow?.doctor_is_active ?? 1) === 1,
      },
      paymentMethod: 'cash',
      grossAmount: grossCommissionAmount,
      netPaidAmount,
      settledAtUtc,
      businessDate: date,
      accruals: (rows ?? []).map((row) => {
        const payoutLine = payoutLineById.get(Number(row.id));
        if (!payoutLine) throw new HTTPException(409, { message: 'Selected payables changed. Refresh and try again.' });
        return {
          sourceType: 'legacy_doctor_commission_accrual' as const,
          sourcePublicId: row.canonical_source_key?.trim() || String(row.id),
          expectedPayableAmount: payoutLine.calculatedAmount,
          settlementPayableAmount: payoutLine.finalAmount,
          overrideReason: payoutLine.overrideReason,
        };
      }),
    });

    const settlement = await c.env.DB.prepare(`
      SELECT id
      FROM doctor_commission_settlements
      WHERE tenant_id = ? AND idempotency_key = ?
      LIMIT 1
    `).bind(tenantId, data.idempotencyKey).first<{ id: number }>();
    const settlementId = Number(settlement?.id ?? 0);
    if (!Number.isInteger(settlementId) || settlementId <= 0) {
      throw new HTTPException(500, { message: 'Doctor payout settlement failed to allocate id' });
    }
    const postResult = await recordAndPostAccountingEvent(c.env.DB, {
      tenantId,
      sourceType: 'doctor_commission_settlement',
      sourceId: settlementId,
      eventType: ACCOUNTING_EVENT_TYPES.commissionSettled,
      eventDate: date,
      createdBy: userId,
      payload: {
        settlementId,
        settlementNo,
        doctorId,
        accrualIds: ids,
        amount: netPaidAmount,
        grossCommissionAmount,
        advanceDeduction,
        clawbackDeduction,
        otherAdjustment,
        roundingAdjustment,
        netPaidAmount,
        paymentMethod: 'cash',
        referenceNo,
        counterSessionId: sessionId,
      },
    });

    if (postResult.voucherId) {
      await c.env.DB.prepare('UPDATE doctor_commission_settlements SET voucher_id = ?, accounting_voucher_id = ? WHERE id = ? AND tenant_id = ?')
        .bind(postResult.voucherId, postResult.voucherId, settlementId, tenantId).run();
    }

    await shadowWriteDoctorPayout({
      db: c.env.DB,
      tenantId,
      settlementId,
      settlementNo,
      doctorId,
      doctorName,
      amount: netPaidAmount,
      userId,
      counterSessionId: sessionId,
      counterId: activeSession.counter_id,
      referenceNo,
      accrualIds: ids,
      voucherId: postResult.voucherId ?? null,
    });

    await createAuditLog(c.env, tenantId, userId, 'PAYMENT', 'doctor_commission_settlements', settlementId, null, {
      settlementId,
      settlementNo,
      doctorId,
      doctorName,
      grossAmount,
      calculatedCommissionAmount,
      grossCommissionAmount,
      clawbackDeduction,
      clawbackApplications: [],
      payoutOverrides: payoutLines.filter((line) => line.overrideReason).map((line) => ({
        accrualId: line.lineId,
        calculatedAmount: line.calculatedAmount,
        finalAmount: line.finalAmount,
        differenceAmount: line.differenceAmount,
        reason: line.overrideReason,
      })),
      netPaidAmount,
      accrualIds: ids,
      counterSessionId: sessionId,
      referenceNo,
    });

    const responseBody = {
      success: true,
      message: 'Doctor payout recorded',
      settlement: {
        id: settlementId,
        settlementId,
        settlementNo,
        doctorId,
        doctorName,
        grossAmount,
        grossCommissionAmount,
        advanceDeduction,
        clawbackDeduction,
        otherAdjustment,
        roundingAdjustment,
        netPaidAmount,
        receiverType: data.receiverType,
        receiverName: data.receiverName,
        receiverReference,
        paymentMethod: 'cash',
        referenceNo,
        paidCount: ids.length,
      },
      settlementId,
      clawbackApplications: [],
      voucherId: postResult.voucherId ?? null,
      amount: netPaidAmount,
      doctorId,
      doctorName,
      paidCount: ids.length,
      referenceNo,
    };
    await completeMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType: MUTATION_TYPE,
      idempotencyKey: data.idempotencyKey,
      sourceId: settlementId,
      responseBody,
    });

    return c.json(responseBody, 201);
  } catch (error) {
    if (idempotencyReserved) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType: MUTATION_TYPE,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => {
        console.error('Failed to mark doctor payout idempotency failed:', markError);
      });
    }
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/UNIQUE constraint|constraint failed|FOREIGN KEY|NOT NULL/i.test(message)) {
      throw new HTTPException(409, { message: 'Doctor payout could not be completed because selected payables changed. Refresh and try again.' });
    }
    throw error;
  }
});

export default routes;
