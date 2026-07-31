export type ActiveBillingCounterSession = {
  id: number;
  counter_id: number;
  counter_name: string;
  counter_code: string | null;
  counter_type: string;
  opening_cash: number;
  opened_at: string;
  workstation_id?: string | null;
  heartbeat_at?: string | null;
  variance_approval_status?: string | null;
};

export const STALE_SESSION_HOURS = 24;
export const BILLING_WORKSTATION_HEADER = 'X-HMS-Workstation-ID';

export const COUNTER_LOCKED_VARIANCE_PENDING_MESSAGE = 'Counter is locked pending variance approval.';

type BillingCounterSessionOptions = {
  workstationId?: string | null;
  requireCurrentWorkstation?: boolean;
  /**
   * Read-only screens may need to show a locked counter session. Cash-affecting
   * mutations should leave this false so pending variance approval blocks the
   * session from being used as an active cash drawer.
   */
  allowPendingVarianceApproval?: boolean;
};

export function isMissingBillingWorkstationColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /no such column: (s\.)?(workstation_id|heartbeat_at)|no column named (workstation_id|heartbeat_at)|D1_ERROR.*(workstation_id|heartbeat_at)/i.test(message);
}

function isMissingBillingVarianceColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /no such column: (s\.)?variance_approval_status|no column named variance_approval_status|D1_ERROR.*variance_approval_status/i.test(message);
}

export function sanitizeBillingWorkstationId(value?: string | null): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9._:-]{8,128}$/.test(trimmed) ? trimmed : null;
}

export function getBillingWorkstationId(requestLike: { req?: { header?: (name: string) => string | undefined } }): string | null {
  return sanitizeBillingWorkstationId(requestLike.req?.header?.(BILLING_WORKSTATION_HEADER));
}

export async function autoCloseStaleCounterSessions(
  d1: D1Database,
  tenantId: string,
  staleHours: number = STALE_SESSION_HOURS,
): Promise<number> {
  let refundHoldGuard = '';
  try {
    await d1.prepare('SELECT id FROM billing_refund_cash_holds WHERE tenant_id = ? LIMIT 1').bind(tenantId).first();
    refundHoldGuard = `
      AND NOT EXISTS (
        SELECT 1
        FROM billing_refund_cash_holds h
        WHERE h.tenant_id = billing_counter_sessions.tenant_id
          AND h.counter_session_id = billing_counter_sessions.id
          AND h.status = 'held'
      )`;
  } catch {
    // Rolling deployments may briefly run against a tenant before migration 0421.
  }

  const result = await d1.prepare(`
    UPDATE billing_counter_sessions
    SET status = 'closed',
        closed_at = datetime('now', '+6 hours'),
        closed_by = COALESCE(closed_by, employee_id),
        remarks = COALESCE(remarks, '') || ' | Auto-closed: stale active session (> ' || ? || 'h without activity)',
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND status = 'active'
      AND COALESCE(variance_approval_status, '') != 'pending'
      AND datetime(opened_at) < datetime('now', '+6 hours', '-' || ? || ' hours')${refundHoldGuard}
  `).bind(staleHours, tenantId, staleHours).run();
  return Number(result?.meta?.changes ?? 0);
}

export async function loadActiveBillingCounterSession(
  d1: D1Database,
  tenantId: string,
  userId: string,
  options: BillingCounterSessionOptions = {},
): Promise<ActiveBillingCounterSession | null> {
  const workstationId = sanitizeBillingWorkstationId(options.workstationId);
  let legacyWorkstationSchema = false;
  let includeWorkstationColumns = true;
  let includeVarianceColumn = true;
  let session: ActiveBillingCounterSession | null;

  while (true) {
    try {
      session = await selectActiveBillingCounterSession(
        d1,
        tenantId,
        userId,
        includeWorkstationColumns,
        includeVarianceColumn,
      );
      break;
    } catch (error) {
      if (includeWorkstationColumns && isMissingBillingWorkstationColumnError(error)) {
        includeWorkstationColumns = false;
        legacyWorkstationSchema = true;
        continue;
      }
      if (includeVarianceColumn && isMissingBillingVarianceColumnError(error)) {
        includeVarianceColumn = false;
        continue;
      }
      throw error;
    }
  }

  if (!session) return null;

  // High-variance close keeps the row status as active for SQLite CHECK
  // compatibility, but operationally the drawer must be locked until a
  // supervisor approves or rejects the variance. Returning null here makes all
  // cash-affecting routes that depend on the active-session gate fail closed.
  if (session.variance_approval_status === 'pending' && !options.allowPendingVarianceApproval) {
    return null;
  }

  if (legacyWorkstationSchema) {
    return {
      ...session,
      workstation_id: null,
      heartbeat_at: null,
    };
  }

  const ownerWorkstation = sanitizeBillingWorkstationId(session.workstation_id);
  if (!workstationId) {
    return options.requireCurrentWorkstation && ownerWorkstation ? null : session;
  }

  await d1.prepare(`
    UPDATE billing_counter_sessions
    SET workstation_id = ?,
        heartbeat_at = datetime('now', '+6 hours'),
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND id = ?
      AND status = 'active'
  `).bind(workstationId, tenantId, session.id).run();

  return {
    ...session,
    workstation_id: workstationId,
    heartbeat_at: new Date().toISOString(),
  };
}

async function selectActiveBillingCounterSession(
  d1: D1Database,
  tenantId: string,
  userId: string,
  includeWorkstationColumns: boolean,
  includeVarianceColumn: boolean,
): Promise<ActiveBillingCounterSession | null> {
  return d1.prepare(`
    SELECT
      s.id,
      s.counter_id,
      c.counter_name,
      c.counter_code,
      s.counter_type,
      s.opening_cash,
      s.opened_at${includeVarianceColumn ? `,
      s.variance_approval_status` : ''}${includeWorkstationColumns ? `,
      s.workstation_id,
      s.heartbeat_at` : ''}
    FROM billing_counter_sessions s
    JOIN billing_counters c
      ON c.id = s.counter_id
     AND c.tenant_id = s.tenant_id
     AND (c.is_active = 1 OR c.is_active IS NULL)
    WHERE s.tenant_id = ?
      AND s.employee_id = ?
      AND s.status = 'active'
    ORDER BY s.opened_at DESC
    LIMIT 1
  `).bind(tenantId, userId).first<ActiveBillingCounterSession>();
}

export async function calculateBillingCounterSessionCashSummary(
  d1: D1Database,
  tenantId: string,
  sessionId: number,
): Promise<{
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  manualCashIn: number;
  manualCashOut: number;
  cashDrop: number;
  heldRefundCash: number;
  availableCash: number;
  appointmentCash: number;
  testCash: number;
  discountTotal: number;
  freeAppointmentCount: number;
  doctorPayableTotal: number;
  commissionPayableTotal: number;
}> {
  const row = await d1.prepare(`
    SELECT
      COALESCE(s.opening_cash, 0) as opening_cash,
      COALESCE(ect.cash_in, 0) as cash_in,
      COALESCE(ect.cash_out, 0) as cash_out,
      COALESCE(cdm.manual_cash_in, 0) as manual_cash_in,
      COALESCE(cdm.manual_cash_out, 0) as manual_cash_out,
      COALESCE(cdm.cash_drop_total, 0) as cash_drop_total,
      COALESCE((
        SELECT SUM(ect2.amount)
        FROM emp_cash_transactions ect2
        JOIN bills b ON b.id = ect2.reference_id AND b.tenant_id = ect2.tenant_id
        WHERE ect2.tenant_id = s.tenant_id
          AND ect2.counter_session_id = s.id
          AND ect2.payment_method = 'cash'
          AND ect2.transaction_type = 'CashSales'
          AND COALESCE(b.doctor_visit_bill, 0) > 0
          AND COALESCE(b.test_bill, 0) = 0
      ), 0) as appointment_cash,
      COALESCE((
        SELECT SUM(ect3.amount)
        FROM emp_cash_transactions ect3
        JOIN bills b ON b.id = ect3.reference_id AND b.tenant_id = ect3.tenant_id
        WHERE ect3.tenant_id = s.tenant_id
          AND ect3.counter_session_id = s.id
          AND ect3.payment_method = 'cash'
          AND ect3.transaction_type = 'CashSales'
          AND COALESCE(b.test_bill, 0) > 0
      ), 0) as test_cash,
      COALESCE((SELECT SUM(discount) FROM bills b WHERE b.tenant_id = s.tenant_id AND b.counter_session_id = s.id), 0) as total_discount,
      COALESCE((SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = s.tenant_id AND a.billing_status = 'no_charge' AND date(a.updated_at) = date(s.opened_at)), 0) as free_appointment_count,
      COALESCE((
        SELECT SUM(commission_amount)
        FROM doctor_commission_accruals dca
        WHERE dca.tenant_id = s.tenant_id
          AND dca.source_type = 'consultation_fee'
          AND dca.status = 'accrued'
          AND date(dca.accrued_date) = date(s.opened_at)
      ), 0) as doctor_payable_total,
      COALESCE((
        SELECT SUM(commission_amount)
        FROM doctor_commission_accruals dca
        WHERE dca.tenant_id = s.tenant_id
          AND dca.source_type != 'consultation_fee'
          AND dca.status = 'accrued'
          AND date(dca.accrued_date) = date(s.opened_at)
      ), 0) as commission_payable_total
    FROM billing_counter_sessions s
    LEFT JOIN (
      SELECT
        tenant_id,
        counter_session_id,
        SUM(CASE
          WHEN payment_method = 'cash'
           AND transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
          THEN amount ELSE 0 END) as cash_in,
        SUM(CASE
          WHEN payment_method = 'cash'
           AND transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
          THEN amount ELSE 0 END) as cash_out
      FROM emp_cash_transactions
      WHERE tenant_id = ?
        AND counter_session_id = ?
      GROUP BY tenant_id, counter_session_id
    ) ect
      ON ect.counter_session_id = s.id
     AND ect.tenant_id = s.tenant_id
    LEFT JOIN (
      SELECT
        tenant_id,
        counter_session_id,
        SUM(CASE WHEN movement_type = 'cash_in' THEN amount ELSE 0 END) as manual_cash_in,
        SUM(CASE WHEN movement_type = 'cash_out' THEN amount ELSE 0 END) as manual_cash_out,
        SUM(CASE WHEN movement_type = 'cash_drop' THEN amount ELSE 0 END) as cash_drop_total
      FROM cash_drawer_movements
      WHERE tenant_id = ?
        AND counter_session_id = ?
        AND movement_type IN ('cash_in', 'cash_out', 'cash_drop')
      GROUP BY tenant_id, counter_session_id
    ) cdm
      ON cdm.counter_session_id = s.id
     AND cdm.tenant_id = s.tenant_id
    WHERE s.tenant_id = ?
      AND s.id = ?
  `).bind(tenantId, sessionId, tenantId, sessionId, tenantId, sessionId).first<{
    opening_cash: number;
    cash_in: number;
    cash_out: number;
    manual_cash_in: number;
    manual_cash_out: number;
    cash_drop_total: number;
    appointment_cash: number;
    test_cash: number;
    total_discount: number;
    free_appointment_count: number;
    doctor_payable_total: number;
    commission_payable_total: number;
  }>();

  let heldRefundCash = 0;
  try {
    const held = await d1.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM billing_refund_cash_holds
      WHERE tenant_id = ?
        AND counter_session_id = ?
        AND status = 'held'
    `).bind(tenantId, sessionId).first<{ amount?: number | null }>();
    heldRefundCash = Number(held?.amount ?? 0);
  } catch {
    // Rolling deployments may briefly run against a tenant before migration 0421.
  }

  const openingCash = Number(row?.opening_cash ?? 0);
  const cashIn = Number(row?.cash_in ?? 0);
  const cashOut = Number(row?.cash_out ?? 0);
  const manualCashIn = Number(row?.manual_cash_in ?? 0);
  const manualCashOut = Number(row?.manual_cash_out ?? 0);
  const cashDrop = Number(row?.cash_drop_total ?? 0);
  const expectedCash = openingCash + cashIn - cashOut + manualCashIn - manualCashOut - cashDrop;
  return {
    cashIn,
    cashOut,
    expectedCash,
    manualCashIn,
    manualCashOut,
    cashDrop,
    heldRefundCash,
    availableCash: expectedCash - heldRefundCash,
    appointmentCash: Number(row?.appointment_cash ?? 0),
    testCash: Number(row?.test_cash ?? 0),
    discountTotal: Number(row?.total_discount ?? 0),
    freeAppointmentCount: Number(row?.free_appointment_count ?? 0),
    doctorPayableTotal: Number(row?.doctor_payable_total ?? 0),
    commissionPayableTotal: Number(row?.commission_payable_total ?? 0),
  };
}
