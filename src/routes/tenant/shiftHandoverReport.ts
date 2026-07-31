import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getTodayGMT6 } from '../../lib/date-utils';

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
const REPORT_ROLES = ['admin', 'hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;
const SUPERVISOR_ROLES = new Set(['admin', 'hospital_admin', 'md', 'director', 'accountant']);
const isSupervisorRole = (role: string): boolean => SUPERVISOR_ROLES.has(role);

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const count = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

const parsePositiveInt = (value: string | undefined, field: string): number | null => {
  if (value == null || value.trim() === '') return null;
  if (!/^\d+$/.test(value.trim())) throw new HTTPException(400, { message: `${field} must be a positive integer` });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new HTTPException(400, { message: `${field} must be a positive integer` });
  return parsed;
};

function localReportDate(expression: string): string {
  return `CASE
    WHEN ${expression} IS NULL THEN NULL
    WHEN ${expression} LIKE '%Z' OR ${expression} LIKE '%+00:00' OR ${expression} LIKE '%-00:00'
      THEN date(${expression}, '+6 hours')
    ELSE date(${expression})
  END`;
}

const denominationNotes = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

function parseDenominationSnapshot(raw: string | null | undefined): Array<{ note: number; count: number; total: number }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return denominationNotes.map((note) => {
      const countValue = Number(parsed[`note${note}`] ?? 0);
      const count = Number.isFinite(countValue) ? Math.max(0, Math.round(countValue)) : 0;
      return { note, count, total: count * note };
    }).filter((row) => row.count > 0);
  } catch {
    return [];
  }
}

function parseSettlementSnapshot(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const amount = n(value);
      if (amount > 0) normalized[key] = amount;
    }
    return normalized;
  } catch {
    return {};
  }
}

type SessionRow = {
  id: number;
  tenant_id?: string;
  counter_id: number;
  employee_id: number;
  opening_cash?: number;
  closing_cash_declared?: number | null;
  opening_denominations?: string | null;
  closing_denominations?: string | null;
  non_cash_settlement_json?: string | null;
  non_cash_remarks?: string | null;
  expected_cash?: number | null;
  variance?: number | null;
  status?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  counter_name?: string | null;
  counter_code?: string | null;
  cashier_name?: string | null;
};

type ShiftHandoverReport = {
  session: {
    sessionId: number;
    status: string;
    counterId: number;
    counterName: string;
    counterCode: string | null;
    cashierId: number;
    cashierName: string;
    openedAt: string | null;
    closedAt: string | null;
    openingCash: number;
  };
  activity: Record<string, number>;
  finance: Record<string, number>;
  paymentMethods: Array<{ paymentMethod: string; transactionCount: number; totalAmount: number }>;
  settlement: {
    paymentMethods: Array<{ paymentMethod: string; transactionCount: number; systemAmount: number; declaredAmount: number | null; difference: number | null }>;
    nonCashRemarks: string | null;
  };
  handover: {
    handoverToName: string | null;
    handoverAmount: number;
    handoverDue: number;
    receiverName: string | null;
    receivedAmount: number | null;
    receiverVariance: number | null;
    status: string | null;
    remarks: string | null;
  };
  denominations: Array<{ note: number; count: number; total: number }>;
  expenses: Array<{ id: number; category: string; amount: number; description: unknown; status: unknown }>;
  transfers: Array<{ id: number; transferNo: unknown; amount: number; status: unknown; receiverName: unknown }>;
  exceptions: {
    cancelledBills: Array<{ id: number; invoiceNo: string | null; patientName: string | null; total: number; reason: unknown; cancelledAt: unknown; cancelledByName: unknown }>;
    refundedBills: Array<{ id: number; creditNoteNo: string | null; invoiceNo: string | null; patientName: string | null; refundAmount: number; reason: unknown; createdAt: unknown; createdByName: unknown }>;
    discountedBills: Array<{ id: number; invoiceNo: string | null; patientName: string | null; total: number; discount: number; discountPercent: number; reason: unknown; referredBy: unknown; approvedByName: unknown }>;
    dueBills: Array<{ id: number; invoiceNo: string | null; patientName: string | null; total: number; paid: number; due: number; status: unknown }>;
    editedBills: Array<{ id: number; billId: number; invoiceNo: string | null; versionNumber: number; total: number; discount: number; reason: unknown; editedByName: unknown; createdAt: unknown }>;
    approvalRequests: Array<{ id: number; type: string; entityId: number; entityNo: unknown; status: string; requestedByName: unknown; reviewedByName: unknown; reviewNotes: unknown; createdAt: unknown }>;
    manualMovements: Array<{ id: number; movementType: string; amount: number; referenceType: unknown; description: unknown; createdByName: unknown; createdAt: unknown }>;
  };
  audit: {
    reportNo: string;
    generatedAt: string;
    generatedBy: number;
    scope: string;
  };
};

type SnapshotRow = {
  id: number;
  report_no: string;
  status: string;
  snapshot_json: string;
  snapshot_hash: string;
  finalized_at?: string | null;
  accepted_by?: number | null;
  accepted_at?: string | null;
};

type SnapshotListRow = SnapshotRow & {
  session_id: number;
  generated_by?: number | null;
  generated_at?: string | null;
  cashier_id?: number | null;
  cashier_name?: string | null;
  accepted_by_name?: string | null;
};

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadSession(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string, userId: number, sessionId: number | null): Promise<SessionRow | null> {
  if (sessionId) {
    return c.env.DB.prepare(`
      SELECT s.id, s.tenant_id, s.counter_id, s.employee_id, s.opening_cash,
             s.closing_cash_declared, s.opening_denominations, s.closing_denominations, s.non_cash_settlement_json, s.non_cash_remarks, s.expected_cash, s.variance,
             s.status, s.opened_at, s.closed_at,
             bc.counter_name, bc.counter_code, u.name as cashier_name
      FROM billing_counter_sessions s
      LEFT JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = s.tenant_id
      LEFT JOIN users u ON u.id = s.employee_id AND u.tenant_id = s.tenant_id
      WHERE s.tenant_id = ? AND s.id = ?
      LIMIT 1
    `).bind(tenantId, sessionId).first<SessionRow>();
  }

  return c.env.DB.prepare(`
    SELECT s.id, s.tenant_id, s.counter_id, s.employee_id, s.opening_cash,
           s.closing_cash_declared, s.opening_denominations, s.closing_denominations, s.non_cash_settlement_json, s.non_cash_remarks, s.expected_cash, s.variance,
           s.status, s.opened_at, s.closed_at,
           bc.counter_name, bc.counter_code, u.name as cashier_name
    FROM billing_counter_sessions s
    LEFT JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = s.tenant_id
    LEFT JOIN users u ON u.id = s.employee_id AND u.tenant_id = s.tenant_id
    WHERE s.tenant_id = ? AND s.employee_id = ? AND s.status = 'active'
    ORDER BY s.opened_at DESC, s.id DESC
    LIMIT 1
  `).bind(tenantId, userId).first<SessionRow>();
}

async function loadFinalSnapshot(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string, sessionId: number): Promise<SnapshotRow | null> {
  return c.env.DB.prepare(`
    SELECT id, report_no, status, snapshot_json, snapshot_hash, finalized_at, accepted_by, accepted_at
    FROM shift_handover_reports
    WHERE tenant_id = ?
      AND session_id = ?
      AND status IN ('finalized', 'accepted')
    ORDER BY id DESC
    LIMIT 1
  `).bind(tenantId, sessionId).first<SnapshotRow>();
}

function parseSnapshot(snapshot: SnapshotRow): ShiftHandoverReport {
  try {
    const parsed = JSON.parse(snapshot.snapshot_json) as ShiftHandoverReport;
    if (!parsed?.session?.sessionId || !parsed?.audit?.reportNo) throw new Error('Invalid snapshot payload');
    return parsed;
  } catch {
    throw new HTTPException(500, { message: 'Stored shift handover snapshot is corrupted' });
  }
}

function snapshotResponse(snapshot: SnapshotRow) {
  const report = parseSnapshot(snapshot);
  return {
    report,
    snapshot: {
      id: Number(snapshot.id),
      reportNo: snapshot.report_no,
      status: snapshot.status,
      hash: snapshot.snapshot_hash,
      finalizedAt: snapshot.finalized_at ?? null,
      acceptedBy: snapshot.accepted_by ?? null,
      acceptedAt: snapshot.accepted_at ?? null,
    },
  };
}

function snapshotListItem(snapshot: SnapshotListRow) {
  const report = parseSnapshot(snapshot);
  return {
    id: Number(snapshot.id),
    sessionId: Number(snapshot.session_id ?? report.session.sessionId),
    reportNo: snapshot.report_no,
    status: snapshot.status,
    hash: snapshot.snapshot_hash,
    cashierId: Number(snapshot.cashier_id ?? report.session.cashierId),
    cashierName: snapshot.cashier_name ?? report.session.cashierName,
    counterName: report.session.counterName,
    openedAt: report.session.openedAt,
    closedAt: report.session.closedAt,
    generatedBy: snapshot.generated_by ?? report.audit.generatedBy,
    generatedAt: snapshot.generated_at ?? report.audit.generatedAt,
    finalizedAt: snapshot.finalized_at ?? null,
    acceptedBy: snapshot.accepted_by ?? null,
    acceptedByName: snapshot.accepted_by_name ?? null,
    acceptedAt: snapshot.accepted_at ?? null,
    expectedCash: report.finance.expectedCash,
    countedCash: report.finance.countedCash,
    variance: report.finance.variance,
    totalReceived: report.finance.totalReceived,
  };
}

function ensureCanAccessReport(role: string, userId: number, cashierId: number): void {
  if (!isSupervisorRole(role) && Number(cashierId) !== userId) {
    throw new HTTPException(403, { message: 'Receptionists can only view their own shift handover report' });
  }
}

function isMissingHandoverVerificationColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /no such column: h\.(receiver_counted_amount|receiver_variance)|no such column: (receiver_counted_amount|receiver_variance)|D1_ERROR.*(receiver_counted_amount|receiver_variance)/i.test(message);
}

async function buildLiveReport(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string, userId: number, role: string, session: SessionRow): Promise<ShiftHandoverReport> {
  ensureCanAccessReport(role, userId, Number(session.employee_id));

  const startAt = session.opened_at ?? '';
  const endAt = session.closed_at ?? null;
  const reportDate = (startAt || new Date().toISOString()).slice(0, 10);
  const reportNo = `SHR-${reportDate.replace(/-/g, '')}-${session.id}`;

  const cashRow = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'CashSales' THEN amount ELSE 0 END), 0) as total_cash_sales,
      COALESCE(SUM(CASE WHEN transaction_type = 'SalesReturn' THEN amount ELSE 0 END), 0) as total_sales_return,
      COALESCE(SUM(CASE WHEN transaction_type = 'CollectionFromReceivable' THEN amount ELSE 0 END), 0) as total_collection_from_receivable,
      COALESCE(SUM(CASE WHEN transaction_type = 'CashDiscountGiven' THEN amount ELSE 0 END), 0) as total_cash_discount_given,
      COALESCE(SUM(CASE WHEN COALESCE(payment_method, 'cash') = 'cash' THEN amount ELSE 0 END), 0) as cash_received,
      COALESCE(SUM(CASE WHEN transaction_type IN ('CashSales', 'CollectionFromReceivable') THEN amount ELSE 0 END), 0) as total_received
    FROM emp_cash_transactions
    WHERE tenant_id = ? AND counter_session_id = ?
  `).bind(tenantId, session.id).first<Record<string, unknown>>();

  const billRow = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as invoice_count,
      COUNT(DISTINCT patient_id) as patient_count,
      COALESCE(SUM(CASE WHEN COALESCE(doctor_visit_bill, 0) > 0 THEN 1 ELSE 0 END), 0) as doctor_visit_count,
      COALESCE(SUM(doctor_visit_bill), 0) as doctor_visit_amount,
      COALESCE(SUM(test_bill), 0) as test_amount,
      COALESCE(SUM(due), 0) as total_due
    FROM bills
    WHERE tenant_id = ?
      AND counter_session_id = ?
      AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
  `).bind(tenantId, session.id).first<Record<string, unknown>>();

  const testRow = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN ii.item_category = 'test' THEN COALESCE(ii.quantity, 1) ELSE 0 END), 0) as test_count,
      COUNT(DISTINCT CASE WHEN ii.item_category = 'test' THEN b.id END) as test_order_count
    FROM invoice_items ii
    JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
    WHERE ii.tenant_id = ?
      AND b.counter_session_id = ?
      AND COALESCE(ii.status, 'active') != 'cancelled'
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
  `).bind(tenantId, session.id).first<Record<string, unknown>>();

  const appointmentRow = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as serial_created,
      COALESCE(SUM(CASE WHEN status IN ('completed', 'seen', 'consulted') THEN 1 ELSE 0 END), 0) as doctor_seen,
      COALESCE(SUM(CASE WHEN status IN ('cancelled', 'no_show') THEN 1 ELSE 0 END), 0) as cancelled,
      COALESCE(SUM(CASE WHEN status IN ('scheduled', 'waiting', 'checked_in') THEN 1 ELSE 0 END), 0) as waiting
    FROM appointments
    WHERE tenant_id = ?
      AND created_by = ?
      AND datetime(created_at) >= datetime(?)
      AND (? IS NULL OR datetime(created_at) <= datetime(?))
  `).bind(tenantId, session.employee_id, startAt, endAt, endAt).first<Record<string, unknown>>();

  const movementRow = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN movement_type = 'cash_out' AND reference_type IN ('doctor_commission_settlement','doctor_payout') THEN amount ELSE 0 END), 0) as doctor_payout,
      COALESCE(SUM(CASE WHEN movement_type = 'cash_out' AND reference_type IN ('expense','petty_cash_expense') THEN amount ELSE 0 END), 0) as petty_expense,
      COALESCE(SUM(CASE WHEN movement_type = 'cash_drop' AND reference_type IN ('cash_custody_transfer','cash_transfer','counter_cash_transfer','billing_counter_cash_transfer') THEN amount ELSE 0 END), 0) as transfer_out,
      COALESCE(SUM(CASE WHEN movement_type = 'cash_drop' AND reference_type = 'bank_deposit' THEN amount ELSE 0 END), 0) as bank_deposit,
      COALESCE(SUM(CASE WHEN movement_type = 'cash_in' AND reference_type = 'accepted_cash_transfer' THEN amount ELSE 0 END), 0) as accepted_transfer_in
    FROM cash_drawer_movements
    WHERE tenant_id = ? AND counter_session_id = ?
  `).bind(tenantId, session.id).first<Record<string, unknown>>();

  const { results: paymentMethodRows } = await c.env.DB.prepare(`
    SELECT
      LOWER(TRIM(COALESCE(payment_method, 'cash'))) as payment_method,
      COUNT(*) as transaction_count,
      COALESCE(SUM(amount), 0) as total_amount
    FROM payments
    WHERE tenant_id = ? AND counter_session_id = ?
    GROUP BY LOWER(TRIM(COALESCE(payment_method, 'cash')))
    ORDER BY total_amount DESC
  `).bind(tenantId, session.id).all<Record<string, unknown>>();

  const { results: expenseRows } = await c.env.DB.prepare(`
    SELECT id, category, amount, description, status
    FROM expenses
    WHERE tenant_id = ? AND counter_session_id = ?
    ORDER BY id DESC
    LIMIT 50
  `).bind(tenantId, session.id).all<Record<string, unknown>>();

  const { results: transferRows } = await c.env.DB.prepare(`
    SELECT t.id, t.transfer_no, t.amount, t.status, u.name as transfer_to_name
    FROM billing_counter_cash_transfers t
    LEFT JOIN users u ON u.id = t.transfer_to AND u.tenant_id = t.tenant_id
    WHERE t.tenant_id = ? AND t.counter_session_id = ?
    ORDER BY t.created_at DESC
    LIMIT 50
  `).bind(tenantId, session.id).all<Record<string, unknown>>();

  let handoverRow: Record<string, unknown> | null = null;
  try {
    handoverRow = await c.env.DB.prepare(`
      SELECT h.handover_amount, h.due_amount,
             h.receiver_counted_amount AS received_amount,
             h.receiver_variance,
             h.status, h.remarks,
             receiver.name as handover_to_name,
             counted.name as received_by_name
      FROM billing_handovers h
      LEFT JOIN users receiver ON receiver.id = h.handover_to AND receiver.tenant_id = h.tenant_id
      LEFT JOIN users counted ON counted.id = h.received_by AND counted.tenant_id = h.tenant_id
      WHERE h.tenant_id = ? AND h.counter_session_id = ?
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT 1
    `).bind(tenantId, session.id).first<Record<string, unknown>>();
  } catch (error) {
    if (!isMissingHandoverVerificationColumnError(error)) throw error;
    handoverRow = await c.env.DB.prepare(`
      SELECT h.handover_amount, h.due_amount,
             NULL AS received_amount,
             NULL AS receiver_variance,
             h.status, h.remarks,
             receiver.name as handover_to_name,
             counted.name as received_by_name
      FROM billing_handovers h
      LEFT JOIN users receiver ON receiver.id = h.handover_to AND receiver.tenant_id = h.tenant_id
      LEFT JOIN users counted ON counted.id = h.received_by AND counted.tenant_id = h.tenant_id
      WHERE h.tenant_id = ? AND h.counter_session_id = ?
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT 1
    `).bind(tenantId, session.id).first<Record<string, unknown>>();
  }

  const { results: cancelledBillRows } = await c.env.DB.prepare(`
    SELECT b.id, b.invoice_no, b.total, b.cancel_reason, b.cancelled_at,
           p.name as patient_name,
           u.name as cancelled_by_name
    FROM bills b
    LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
    LEFT JOIN users u ON u.id = b.cancelled_by AND u.tenant_id = b.tenant_id
    WHERE b.tenant_id = ?
      AND b.counter_session_id = ?
      AND (COALESCE(b.status, '') = 'cancelled' OR b.cancelled_at IS NOT NULL OR b.cancel_reason IS NOT NULL)
    ORDER BY COALESCE(b.cancelled_at, b.created_at) DESC, b.id DESC
    LIMIT 50
  `).bind(tenantId, session.id).all<Record<string, unknown>>();

  const { results: refundedBillRows } = await c.env.DB.prepare(`
    SELECT cn.id, cn.credit_note_no, b.invoice_no, cn.refund_amount, cn.reason, cn.created_at,
           p.name as patient_name,
           u.name as created_by_name
    FROM billing_credit_notes cn
    JOIN bills b ON b.id = cn.bill_id AND b.tenant_id = cn.tenant_id
    LEFT JOIN patients p ON p.id = cn.patient_id AND p.tenant_id = cn.tenant_id
    LEFT JOIN users u ON u.id = cn.created_by AND u.tenant_id = cn.tenant_id
    WHERE cn.tenant_id = ?
      AND b.counter_session_id = ?
      AND COALESCE(cn.is_active, 1) = 1
    ORDER BY cn.created_at DESC, cn.id DESC
    LIMIT 50
  `).bind(tenantId, session.id).all<Record<string, unknown>>();

  const { results: discountedBillRows } = await c.env.DB.prepare(`
    SELECT b.id, b.invoice_no, b.total, b.discount, b.discount_reason, b.discount_by_name,
           p.name as patient_name,
           u.name as approved_by_name
    FROM bills b
    LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
    LEFT JOIN users u ON u.id = b.approved_by AND u.tenant_id = b.tenant_id
    WHERE b.tenant_id = ?
      AND b.counter_session_id = ?
      AND COALESCE(b.discount, 0) > 0
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    ORDER BY b.discount DESC, b.id DESC
    LIMIT 50
  `).bind(tenantId, session.id).all<Record<string, unknown>>();

  const { results: dueBillRows } = await c.env.DB.prepare(`
    SELECT b.id, b.invoice_no, b.total, b.paid, b.due, b.status,
           p.name as patient_name
    FROM bills b
    LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
    WHERE b.tenant_id = ?
      AND b.counter_session_id = ?
      AND COALESCE(b.due, 0) > 0
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    ORDER BY b.due DESC, b.id DESC
    LIMIT 50
  `).bind(tenantId, session.id).all<Record<string, unknown>>();

  const { results: editedBillRows } = await c.env.DB.prepare(`
    SELECT bv.id, bv.bill_id, b.invoice_no, bv.version_number, bv.total, bv.discount, bv.edit_reason, bv.created_at,
           u.name as edited_by_name
    FROM bill_versions bv
    JOIN bills b ON b.id = bv.bill_id AND b.tenant_id = bv.tenant_id
    LEFT JOIN users u ON u.id = bv.edited_by AND u.tenant_id = bv.tenant_id
    WHERE bv.tenant_id = ?
      AND b.counter_session_id = ?
    ORDER BY bv.created_at DESC, bv.id DESC
    LIMIT 50
  `).bind(tenantId, session.id).all<Record<string, unknown>>();

  const { results: approvalRequestRows } = await c.env.DB.prepare(`
    SELECT ar.id, ar.type, ar.entity_id, ar.entity_no, ar.status, ar.review_notes, ar.created_at,
           requester.name as requested_by_name,
           reviewer.name as reviewed_by_name
    FROM approval_requests ar
    LEFT JOIN bills b ON b.id = ar.entity_id AND b.tenant_id = ar.tenant_id
    LEFT JOIN users requester ON requester.id = ar.requested_by AND requester.tenant_id = ar.tenant_id
    LEFT JOIN users reviewer ON reviewer.id = ar.reviewed_by AND reviewer.tenant_id = ar.tenant_id
    WHERE ar.tenant_id = ?
      AND ar.type IN ('bill_edit', 'bill_cancel', 'discount', 'refund')
      AND (b.counter_session_id = ? OR (ar.requested_by = ? AND datetime(ar.created_at) >= datetime(?) AND (? IS NULL OR datetime(ar.created_at) <= datetime(?))))
    ORDER BY ar.created_at DESC, ar.id DESC
    LIMIT 50
  `).bind(tenantId, session.id, session.employee_id, startAt, endAt, endAt).all<Record<string, unknown>>();

  const { results: manualMovementRows } = await c.env.DB.prepare(`
    SELECT m.id, m.movement_type, m.amount, m.reference_type, m.description, m.created_at,
           u.name as created_by_name
    FROM cash_drawer_movements m
    LEFT JOIN users u ON u.id = m.created_by AND u.tenant_id = m.tenant_id
    WHERE m.tenant_id = ?
      AND m.counter_session_id = ?
      AND (
        m.reference_type IN ('manual_cash_in','manual_cash_out','manual_adjustment','cash_adjustment')
        OR LOWER(COALESCE(m.description, '')) LIKE '%manual%'
      )
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 50
  `).bind(tenantId, session.id).all<Record<string, unknown>>();

  const openingCash = n(session.opening_cash);
  const cashReceived = n(cashRow?.cash_received ?? cashRow?.total_received);
  const totalReceived = n(cashRow?.total_received ?? cashReceived);
  const refund = n(cashRow?.total_sales_return);
  const dueCollection = n(cashRow?.total_collection_from_receivable);
  const discount = n(cashRow?.total_cash_discount_given);
  const doctorPayout = n(movementRow?.doctor_payout);
  const pettyExpense = n(movementRow?.petty_expense);
  const transferOut = n(movementRow?.transfer_out);
  const bankDeposit = n(movementRow?.bank_deposit);
  const acceptedTransferIn = n(movementRow?.accepted_transfer_in);
  const computedExpectedCash = n(openingCash + cashReceived + acceptedTransferIn - refund - doctorPayout - pettyExpense - transferOut - bankDeposit);
  const expectedCash = session.expected_cash == null ? computedExpectedCash : n(session.expected_cash);
  const countedCash = session.closing_cash_declared == null ? expectedCash : n(session.closing_cash_declared);
  const variance = session.variance == null ? n(countedCash - expectedCash) : n(session.variance);
  const settlementSnapshot = parseSettlementSnapshot(session.non_cash_settlement_json ?? null);
  const settlementRows = (paymentMethodRows ?? []).map((row) => {
    const paymentMethod = String(row.payment_method ?? 'cash');
    const systemAmount = n(row.total_amount);
    const declaredAmount = paymentMethod === 'cash' ? null : (settlementSnapshot[paymentMethod] ?? null);
    return {
      paymentMethod,
      transactionCount: count(row.transaction_count),
      systemAmount,
      declaredAmount,
      difference: declaredAmount == null ? null : n(declaredAmount - systemAmount),
    };
  });
  const handoverAmount = n(handoverRow?.handover_amount);
  const handoverDue = n(handoverRow?.due_amount);
  const receivedAmount = handoverRow?.received_amount == null ? null : n(handoverRow.received_amount);
  const handoverVariance = receivedAmount == null ? null : n(receivedAmount - (handoverAmount - handoverDue));

  return {
    session: {
      sessionId: Number(session.id),
      status: session.status ?? 'active',
      counterId: Number(session.counter_id),
      counterName: session.counter_name ?? `Counter #${session.counter_id}`,
      counterCode: session.counter_code ?? null,
      cashierId: Number(session.employee_id),
      cashierName: session.cashier_name ?? `User #${session.employee_id}`,
      openedAt: startAt || null,
      closedAt: endAt,
      openingCash,
    },
    activity: {
      serialCreated: count(appointmentRow?.serial_created),
      doctorSeen: count(appointmentRow?.doctor_seen) || count(billRow?.doctor_visit_count),
      serialCancelled: count(appointmentRow?.cancelled),
      serialWaiting: count(appointmentRow?.waiting),
      invoiceCount: count(billRow?.invoice_count),
      patientsSeen: count(billRow?.patient_count),
      doctorVisits: count(billRow?.doctor_visit_count),
      testOrders: count(testRow?.test_order_count),
      testItems: count(testRow?.test_count),
    },
    finance: {
      totalReceived,
      cashReceived,
      dueCollection,
      doctorVisitCollection: n(billRow?.doctor_visit_amount),
      testCollection: n(billRow?.test_amount),
      refund,
      discount,
      doctorPayout,
      pettyExpense,
      transferOut,
      bankDeposit,
      acceptedTransferIn,
      totalDue: n(billRow?.total_due),
      expectedCash,
      countedCash,
      variance,
    },
    paymentMethods: (paymentMethodRows ?? []).map((row) => ({
      paymentMethod: String(row.payment_method ?? 'cash'),
      transactionCount: count(row.transaction_count),
      totalAmount: n(row.total_amount),
    })),
    settlement: {
      paymentMethods: settlementRows,
      nonCashRemarks: session.non_cash_remarks == null ? null : String(session.non_cash_remarks),
    },
    handover: {
      handoverToName: handoverRow?.handover_to_name == null ? null : String(handoverRow.handover_to_name),
      handoverAmount,
      handoverDue,
      receiverName: handoverRow?.received_by_name == null ? null : String(handoverRow.received_by_name),
      receivedAmount,
      receiverVariance: handoverVariance,
      status: handoverRow?.status == null ? null : String(handoverRow.status),
      remarks: handoverRow?.remarks == null ? null : String(handoverRow.remarks),
    },
    denominations: parseDenominationSnapshot(session.closing_denominations ?? session.opening_denominations ?? null),
    expenses: (expenseRows ?? []).map((row) => ({
      id: Number(row.id),
      category: String(row.category ?? ''),
      amount: n(row.amount),
      description: row.description ?? null,
      status: row.status ?? null,
    })),
    transfers: (transferRows ?? []).map((row) => ({
      id: Number(row.id),
      transferNo: row.transfer_no ?? null,
      amount: n(row.amount),
      status: row.status ?? null,
      receiverName: row.transfer_to_name ?? null,
    })),
    exceptions: {
      cancelledBills: (cancelledBillRows ?? []).map((row) => ({
        id: Number(row.id),
        invoiceNo: row.invoice_no == null ? null : String(row.invoice_no),
        patientName: row.patient_name == null ? null : String(row.patient_name),
        total: n(row.total),
        reason: row.cancel_reason ?? null,
        cancelledAt: row.cancelled_at ?? null,
        cancelledByName: row.cancelled_by_name ?? null,
      })),
      refundedBills: (refundedBillRows ?? []).map((row) => ({
        id: Number(row.id),
        creditNoteNo: row.credit_note_no == null ? null : String(row.credit_note_no),
        invoiceNo: row.invoice_no == null ? null : String(row.invoice_no),
        patientName: row.patient_name == null ? null : String(row.patient_name),
        refundAmount: n(row.refund_amount),
        reason: row.reason ?? null,
        createdAt: row.created_at ?? null,
        createdByName: row.created_by_name ?? null,
      })),
      discountedBills: (discountedBillRows ?? []).map((row) => {
        const total = n(row.total);
        const discountAmount = n(row.discount);
        return {
          id: Number(row.id),
          invoiceNo: row.invoice_no == null ? null : String(row.invoice_no),
          patientName: row.patient_name == null ? null : String(row.patient_name),
          total,
          discount: discountAmount,
          discountPercent: total > 0 ? n((discountAmount / total) * 100) : 0,
          reason: row.discount_reason ?? null,
          referredBy: row.discount_by_name ?? null,
          approvedByName: row.approved_by_name ?? null,
        };
      }),
      dueBills: (dueBillRows ?? []).map((row) => ({
        id: Number(row.id),
        invoiceNo: row.invoice_no == null ? null : String(row.invoice_no),
        patientName: row.patient_name == null ? null : String(row.patient_name),
        total: n(row.total),
        paid: n(row.paid),
        due: n(row.due),
        status: row.status ?? null,
      })),
      editedBills: (editedBillRows ?? []).map((row) => ({
        id: Number(row.id),
        billId: Number(row.bill_id),
        invoiceNo: row.invoice_no == null ? null : String(row.invoice_no),
        versionNumber: count(row.version_number),
        total: n(row.total),
        discount: n(row.discount),
        reason: row.edit_reason ?? null,
        editedByName: row.edited_by_name ?? null,
        createdAt: row.created_at ?? null,
      })),
      approvalRequests: (approvalRequestRows ?? []).map((row) => ({
        id: Number(row.id),
        type: String(row.type ?? ''),
        entityId: Number(row.entity_id ?? 0),
        entityNo: row.entity_no ?? null,
        status: String(row.status ?? ''),
        requestedByName: row.requested_by_name ?? null,
        reviewedByName: row.reviewed_by_name ?? null,
        reviewNotes: row.review_notes ?? null,
        createdAt: row.created_at ?? null,
      })),
      manualMovements: (manualMovementRows ?? []).map((row) => ({
        id: Number(row.id),
        movementType: String(row.movement_type ?? ''),
        amount: n(row.amount),
        referenceType: row.reference_type ?? null,
        description: row.description ?? null,
        createdByName: row.created_by_name ?? null,
        createdAt: row.created_at ?? null,
      })),
    },
    audit: {
      reportNo,
      generatedAt: new Date().toISOString(),
      generatedBy: userId,
      scope: isSupervisorRole(role) ? 'supervisor' : 'own_shift',
    },
  };
}

routes.use('*', requireRole(...REPORT_ROLES));

routes.get('/history', async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = Number(requireUserId(c));
  const role = c.get('role') ?? '';
  const status = c.req.query('status');
  const limitRaw = Number(c.req.query('limit') ?? 25);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.round(limitRaw))) : 25;
  const filters: string[] = ["r.tenant_id = ?", "r.status IN ('finalized', 'accepted')"];
  const params: Array<string | number> = [tenantId];

  if (status && ['finalized', 'accepted'].includes(status)) {
    filters.push('r.status = ?');
    params.push(status);
  }

  if (!isSupervisorRole(role)) {
    filters.push('s.employee_id = ?');
    params.push(userId);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT r.id, r.session_id, r.report_no, r.status, r.snapshot_json, r.snapshot_hash,
           r.generated_by, r.generated_at, r.finalized_at, r.accepted_by, r.accepted_at,
           s.employee_id AS cashier_id,
           cashier.name AS cashier_name,
           accepter.name AS accepted_by_name
    FROM shift_handover_reports r
    JOIN billing_counter_sessions s ON s.id = r.session_id AND s.tenant_id = r.tenant_id
    LEFT JOIN users cashier ON cashier.id = s.employee_id AND cashier.tenant_id = r.tenant_id
    LEFT JOIN users accepter ON accepter.id = r.accepted_by AND accepter.tenant_id = r.tenant_id
    WHERE ${filters.join(' AND ')}
    ORDER BY COALESCE(r.finalized_at, r.generated_at, r.created_at) DESC, r.id DESC
    LIMIT ?
  `).bind(...params, limit).all<SnapshotListRow>();

  return c.json({ reports: (results ?? []).map(snapshotListItem) });
});

routes.get('/', async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = Number(requireUserId(c));
  const role = c.get('role') ?? '';
  const sessionId = parsePositiveInt(c.req.query('sessionId'), 'sessionId');
  const from = c.req.query('from') || c.req.query('dateFrom') || getTodayGMT6();
  const to = c.req.query('to') || c.req.query('dateTo') || from;

  if (!sessionId) {
    const supervisor = isSupervisorRole(role);
    const limitRaw = Number(c.req.query('limit') ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.round(limitRaw))) : 50;
    const { results: sessions } = await c.env.DB.prepare(`
      SELECT s.id, s.tenant_id, s.counter_id, s.employee_id, s.opening_cash,
             s.closing_cash_declared, s.opening_denominations, s.closing_denominations, s.non_cash_settlement_json, s.non_cash_remarks, s.expected_cash, s.variance,
             s.status, s.opened_at, s.closed_at,
             bc.counter_name, bc.counter_code, u.name as cashier_name
      FROM billing_counter_sessions s
      LEFT JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = s.tenant_id
      LEFT JOIN users u ON u.id = s.employee_id AND u.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?
        AND (
          ${localReportDate('COALESCE(s.opened_at, s.created_at)')} BETWEEN ? AND ?
          OR (s.closed_at IS NOT NULL AND ${localReportDate('s.closed_at')} BETWEEN ? AND ?)
        )
        ${supervisor ? '' : 'AND s.employee_id = ?'}
      ORDER BY COALESCE(s.closed_at, s.opened_at, s.id) DESC, s.id DESC
      LIMIT ?
    `).bind(...(supervisor ? [tenantId, from, to, from, to] : [tenantId, from, to, from, to, userId]), limit).all<SessionRow>();
    if ((sessions ?? []).length > 0) {
      const reports = [];
      for (const session of sessions ?? []) {
        reports.push(await buildLiveReport(c, tenantId, userId, role, session));
      }
      return c.json({ report: reports[0], reports });
    }
  }

  if (sessionId) {
    const snapshot = await loadFinalSnapshot(c, tenantId, sessionId);
    if (snapshot) {
      const body = snapshotResponse(snapshot);
      ensureCanAccessReport(role, userId, Number(body.report.session.cashierId));
      return c.json(body);
    }
  }

  const session = await loadSession(c, tenantId, userId, sessionId);
  if (!session) throw new HTTPException(404, { message: 'Counter session not found' });
  const report = await buildLiveReport(c, tenantId, userId, role, session);
  return c.json({ report });
});

routes.post('/sessions/:sessionId/finalize', async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = Number(requireUserId(c));
  const role = c.get('role') ?? '';
  const sessionId = parsePositiveInt(c.req.param('sessionId'), 'sessionId');
  if (!sessionId) throw new HTTPException(400, { message: 'sessionId is required' });

  const existing = await loadFinalSnapshot(c, tenantId, sessionId);
  if (existing) {
    const body = snapshotResponse(existing);
    ensureCanAccessReport(role, userId, Number(body.report.session.cashierId));
    return c.json(body, 200);
  }

  const session = await loadSession(c, tenantId, userId, sessionId);
  if (!session) throw new HTTPException(404, { message: 'Counter session not found' });
  const report = await buildLiveReport(c, tenantId, userId, role, session);
  const snapshotJson = JSON.stringify(report);
  const snapshotHash = await sha256Hex(snapshotJson);

  const insert = await c.env.DB.prepare(`
    INSERT INTO shift_handover_reports
      (tenant_id, session_id, report_no, snapshot_json, snapshot_hash, status, generated_by, finalized_by, finalized_at)
    VALUES (?, ?, ?, ?, ?, 'finalized', ?, ?, datetime('now', '+6 hours'))
  `).bind(tenantId, sessionId, report.audit.reportNo, snapshotJson, snapshotHash, userId, userId).run();
  const reportId = Number(insert.meta.last_row_id ?? 0);

  void createAuditLog(c.env, tenantId, String(userId), 'CREATE', 'shift_handover_reports', reportId, null, {
    sessionId,
    reportNo: report.audit.reportNo,
    snapshotHash,
    status: 'finalized',
  });

  return c.json({
    report,
    snapshot: {
      id: reportId,
      reportNo: report.audit.reportNo,
      status: 'finalized',
      hash: snapshotHash,
      finalizedAt: null,
      acceptedBy: null,
      acceptedAt: null,
    },
  }, 201);
});


routes.post('/sessions/:sessionId/accept', async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = Number(requireUserId(c));
  const role = c.get('role') ?? '';
  const sessionId = parsePositiveInt(c.req.param('sessionId'), 'sessionId');
  if (!sessionId) throw new HTTPException(400, { message: 'sessionId is required' });
  if (!isSupervisorRole(role)) throw new HTTPException(403, { message: 'Only supervisors can accept shift handover reports' });

  const existing = await loadFinalSnapshot(c, tenantId, sessionId);
  if (!existing) throw new HTTPException(404, { message: 'Finalized shift handover report not found' });
  if (existing.status === 'accepted') return c.json(snapshotResponse(existing));

  await c.env.DB.prepare(`
    UPDATE shift_handover_reports
    SET status = 'accepted',
        accepted_by = ?,
        accepted_at = datetime('now', '+6 hours'),
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND session_id = ?
      AND status = 'finalized'
  `).bind(userId, tenantId, sessionId).run();

  void createAuditLog(c.env, tenantId, String(userId), 'APPROVE', 'shift_handover_reports', Number(existing.id), {
    status: existing.status,
  }, {
    status: 'accepted',
    sessionId,
  });

  const accepted = await loadFinalSnapshot(c, tenantId, sessionId);
  if (!accepted) throw new HTTPException(500, { message: 'Accepted shift handover report could not be reloaded' });
  return c.json(snapshotResponse(accepted));
});

export default routes;
