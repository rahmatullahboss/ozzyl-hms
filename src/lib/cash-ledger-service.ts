export type CashSourceType =
  | 'emp_cash_transaction'
  | 'drawer_movement'
  | 'counter_handover'
  | 'cash_custody_transfer'
  | 'expense'
  | 'doctor_payout'
  | 'bank_deposit_request'
  | 'bank_transaction';

export type CashLocationType =
  | 'drawer'
  | 'in_transit'
  | 'admin_custody'
  | 'counter_custody'
  | 'bank_deposit_pending'
  | 'bank'
  | 'expense'
  | 'payout'
  | 'refund'
  | 'disputed'
  | 'unknown';

export type CashLedgerEvent = {
  id: string;
  sourceType: CashSourceType;
  sourceId: string;
  sourceNo: string | null;
  eventType: string;
  status: string;
  cashStatus: string;
  movementDirection: 'in' | 'out' | 'transfer' | 'neutral';
  amount: number;
  expectedAmount: number | null;
  receivedAmount: number | null;
  dueAmount: number | null;
  varianceAmount: number | null;
  paymentMethod: string;
  fromUserId: number | null;
  fromUserName: string | null;
  toUserId: number | null;
  toUserName: string | null;
  counterSessionId: number | null;
  counterId: number | null;
  counterName: string | null;
  currentLocationType: CashLocationType;
  currentLocationLabel: string;
  accountingVoucherId: number | null;
  accountingPostingStatus: string | null;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
  receivedAt: string | null;
};

export type CashLedgerFilters = {
  date?: string;
  from?: string;
  to?: string;
  sessionId?: number;
  status?: string;
  sourceType?: string;
  limit?: number;
  includeResolved?: boolean;
};

export type CashLedgerReconciliationCheck = {
  key: string;
  label: string;
  status: 'pass' | 'warning' | 'fail';
  expectedAmount?: number;
  actualAmount?: number;
  details: string;
};

export type CashLedgerReconciliationReport = {
  status: 'pass' | 'warning' | 'fail';
  generatedAt: string;
  overview: CashLedgerOverview;
  balances: Array<{ key: string; label: string; amount: number }>;
  exceptions: CashLedgerEvent[];
  checks: CashLedgerReconciliationCheck[];
};

export type CashLedgerShadowCoverageRow = {
  key: string;
  label: string;
  status: 'pass' | 'warning' | 'fail' | 'blocked';
  sourceAvailable: boolean;
  sourceCount: number;
  sourceAmount: number;
  shadowCount: number;
  shadowAmount: number;
  differenceCount: number;
  differenceAmount: number;
  details: string;
};

export type CashLedgerShadowReconciliationReport = {
  status: 'pass' | 'warning' | 'fail';
  generatedAt: string;
  rows: CashLedgerShadowCoverageRow[];
  blockedFlows: Array<{ key: string; label: string; reason: string }>;
};

export type CashLedgerBackfillDryRunRow = {
  key: string;
  label: string;
  eventType: string;
  sourceTable: string;
  status: 'ready' | 'warning' | 'fail';
  sourceAvailable: boolean;
  sourceCount: number;
  sourceAmount: number;
  existingShadowCount: number;
  existingShadowAmount: number;
  missingCount: number;
  missingAmount: number;
  duplicateRisk: boolean;
  details: string;
};

export type CashLedgerShadowIssue = {
  id: number;
  tenantId: string;
  sourceType: string;
  sourceId: string;
  eventType: string;
  idempotencyKey: string | null;
  issueMessage: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type CashLedgerBackfillDryRunReport = {
  status: 'ready' | 'warning' | 'fail';
  generatedAt: string;
  rows: CashLedgerBackfillDryRunRow[];
  totals: {
    sourceCount: number;
    sourceAmount: number;
    existingShadowCount: number;
    existingShadowAmount: number;
    missingCount: number;
    missingAmount: number;
  };
  blockedFlows: Array<{ key: string; label: string; reason: string }>;
};

export type CashLedgerReadinessCheck = {
  key: string;
  label: string;
  status: 'pass' | 'warning' | 'fail';
  details: string;
};

export type CashLedgerReadinessReport = {
  status: 'ready' | 'attention' | 'action_required';
  ready: boolean;
  generatedAt: string;
  checks: CashLedgerReadinessCheck[];
  pendingItems: Array<{ key: string; label: string; reason: string }>;
};

export type CashLedgerOverview = {
  date: string | null;
  activeDrawerCash: number;
  pendingTransferCash: number;
  adminCustodyCash: number;
  counterCustodyCash: number;
  bankDepositPendingCash: number;
  bankedCash: number;
  disputedCash: number;
  refundedCash: number;
  expensePaidCash: number;
  payoutPaidCash: number;
  unclassifiedCashOut: number;
  totalCashAccountedFor: number;
  eventCount: number;
  unresolvedCount: number;
};

const ADMIN_ROLES = new Set(['hospital_admin', 'md', 'director', 'accountant']);
const CASH_IN_TYPES = new Set(['CashSales', 'CollectionFromReceivable', 'CashDiscountReceived']);
const CASH_OUT_TYPES = new Set(['SalesReturn', 'ReturnDeposit', 'CashDiscountGiven']);
const UNRESOLVED_STATUSES = new Set(['pending', 'partial', 'disputed', 'approved']);

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function s(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function i(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampLimit(limit?: number): number {
  const parsed = Number(limit ?? 250);
  if (!Number.isFinite(parsed)) return 250;
  return Math.min(Math.max(Math.floor(parsed), 1), 1000);
}

function dateFilter(alias: string, filters: CashLedgerFilters, params: Array<string | number>): string {
  const column = alias ? `${alias}.created_at` : 'created_at';
  if (filters.date) {
    params.push(filters.date);
    return ` AND date(${column}, '+6 hours') = date(?)`;
  }
  let clause = '';
  if (filters.from) {
    params.push(filters.from);
    clause += ` AND ${column} >= ?`;
  }
  if (filters.to) {
    params.push(`${filters.to} 23:59:59`);
    clause += ` AND ${column} <= ?`;
  }
  return clause;
}

function transactionEventType(type: string): { eventType: string; cashStatus: string; direction: 'in' | 'out' | 'neutral'; location: CashLocationType } {
  if (CASH_IN_TYPES.has(type)) {
    return { eventType: type === 'CollectionFromReceivable' ? 'PATIENT_DUE_COLLECTION' : 'PATIENT_COLLECTION', cashStatus: 'IN_DRAWER', direction: 'in', location: 'drawer' };
  }
  if (CASH_OUT_TYPES.has(type)) {
    return { eventType: 'PATIENT_REFUND_PAID', cashStatus: 'REFUNDED', direction: 'out', location: 'refund' };
  }
  return { eventType: type || 'PATIENT_CASH_EVENT', cashStatus: 'UNKNOWN_REQUIRES_REVIEW', direction: 'neutral', location: 'unknown' };
}

function locationLabel(type: CashLocationType, fallback?: string | null): string {
  if (fallback) return fallback;
  switch (type) {
    case 'drawer': return 'Counter drawer';
    case 'in_transit': return 'In transit / pending receive';
    case 'admin_custody': return 'Admin/MD/Accountant custody';
    case 'counter_custody': return 'Counter custody';
    case 'bank_deposit_pending': return 'Bank deposit pending';
    case 'bank': return 'Bank';
    case 'expense': return 'Expense paid';
    case 'payout': return 'Payout paid';
    case 'refund': return 'Refund paid';
    case 'disputed': return 'Disputed / short cash';
    default: return 'Unknown / needs review';
  }
}


async function loadActiveDrawerCash(db: D1Database, tenantId: string): Promise<number> {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(
      COALESCE(s.opening_cash, 0)
      + COALESCE(ect.cash_in, 0)
      - COALESCE(ect.cash_out, 0)
      + COALESCE(cdm.manual_cash_in, 0)
      - COALESCE(cdm.manual_cash_out, 0)
      - COALESCE(cdm.cash_drop_total, 0)
    ), 0) AS active_drawer_cash
    FROM billing_counter_sessions s
    LEFT JOIN (
      SELECT
        tenant_id,
        counter_session_id,
        SUM(CASE
          WHEN COALESCE(payment_method, 'cash') = 'cash'
           AND transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
          THEN amount ELSE 0 END) AS cash_in,
        SUM(CASE
          WHEN COALESCE(payment_method, 'cash') = 'cash'
           AND transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
          THEN amount ELSE 0 END) AS cash_out
      FROM emp_cash_transactions
      WHERE tenant_id = ?
      GROUP BY tenant_id, counter_session_id
    ) ect
      ON ect.tenant_id = s.tenant_id
     AND ect.counter_session_id = s.id
    LEFT JOIN (
      SELECT
        tenant_id,
        counter_session_id,
        SUM(CASE WHEN movement_type = 'cash_in' THEN amount ELSE 0 END) AS manual_cash_in,
        SUM(CASE WHEN movement_type = 'cash_out' THEN amount ELSE 0 END) AS manual_cash_out,
        SUM(CASE WHEN movement_type = 'cash_drop' THEN amount ELSE 0 END) AS cash_drop_total
      FROM cash_drawer_movements
      WHERE tenant_id = ?
        AND movement_type IN ('cash_in', 'cash_out', 'cash_drop')
      GROUP BY tenant_id, counter_session_id
    ) cdm
      ON cdm.tenant_id = s.tenant_id
     AND cdm.counter_session_id = s.id
    WHERE s.tenant_id = ?
      AND s.status = 'active'
  `).bind(tenantId, tenantId, tenantId).first<{ active_drawer_cash: number }>();

  return n(row?.active_drawer_cash);
}

function sortEvents(events: CashLedgerEvent[]): CashLedgerEvent[] {
  return events.sort((a, b) => {
    const dateDiff = Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '');
    if (Number.isFinite(dateDiff) && dateDiff !== 0) return dateDiff;
    return b.id.localeCompare(a.id);
  });
}

export async function loadCashLedgerEvents(
  db: D1Database,
  tenantId: string,
  filters: CashLedgerFilters = {},
): Promise<CashLedgerEvent[]> {
  const limit = clampLimit(filters.limit);
  const events: CashLedgerEvent[] = [];

  if (!filters.sourceType || filters.sourceType === 'emp_cash_transaction') {
    const empCashCreatedAt = "datetime(COALESCE(ect.transaction_date, ect.created_at), '+6 hours')";
    const params: Array<string | number> = [tenantId];
    let where = `ect.tenant_id = ? AND COALESCE(ect.payment_method, 'cash') = 'cash'`;
    if (filters.sessionId) {
      where += ' AND ect.counter_session_id = ?';
      params.push(filters.sessionId);
    }
    let temporalClause = dateFilter('ect', filters, params);
    temporalClause = filters.date
      ? ` AND date(${empCashCreatedAt}) = date(?)`
      : temporalClause.replace(/ect\.created_at/g, empCashCreatedAt);
    where += temporalClause;
    const rows = await db.prepare(`
      SELECT ect.id, ect.employee_id, ect.counter_id, ect.counter_session_id, ect.transaction_type, ect.amount,
             ect.reference_id, ect.reference_type, ect.payment_method, ect.description,
             ${empCashCreatedAt} AS created_at,
             u.name AS employee_name, bc.counter_name, ape.status AS accounting_posting_status,
             av.id AS accounting_voucher_id
      FROM emp_cash_transactions ect
      LEFT JOIN users u ON u.id = ect.employee_id AND u.tenant_id = ect.tenant_id
      LEFT JOIN billing_counters bc ON bc.id = ect.counter_id AND bc.tenant_id = ect.tenant_id
      LEFT JOIN accounting_posting_events ape ON ape.tenant_id = ect.tenant_id AND ape.source_type = ect.reference_type AND CAST(ape.source_id AS TEXT) = CAST(ect.reference_id AS TEXT)
      LEFT JOIN accounting_vouchers av ON av.tenant_id = ect.tenant_id AND av.source_type = ape.source_type AND CAST(av.source_id AS TEXT) = CAST(ape.source_id AS TEXT)
      WHERE ${where}
      ORDER BY ${empCashCreatedAt} DESC, ect.id DESC
      LIMIT ?
    `).bind(...params, limit).all<Record<string, unknown>>();

    for (const row of rows.results ?? []) {
      const transactionType = String(row.transaction_type ?? '');
      const mapped = transactionEventType(transactionType);
      events.push({
        id: `emp_cash_transaction:${row.id}`,
        sourceType: 'emp_cash_transaction',
        sourceId: String(row.id),
        sourceNo: s(row.reference_id),
        eventType: mapped.eventType,
        status: 'posted',
        cashStatus: mapped.cashStatus,
        movementDirection: mapped.direction,
        amount: n(row.amount),
        expectedAmount: null,
        receivedAmount: null,
        dueAmount: null,
        varianceAmount: null,
        paymentMethod: String(row.payment_method ?? 'cash'),
        fromUserId: mapped.direction === 'out' ? i(row.employee_id) : null,
        fromUserName: mapped.direction === 'out' ? s(row.employee_name) : null,
        toUserId: mapped.direction === 'in' ? i(row.employee_id) : null,
        toUserName: mapped.direction === 'in' ? s(row.employee_name) : null,
        counterSessionId: i(row.counter_session_id),
        counterId: i(row.counter_id),
        counterName: s(row.counter_name),
        currentLocationType: mapped.location,
        currentLocationLabel: locationLabel(mapped.location, s(row.counter_name)),
        accountingVoucherId: i(row.accounting_voucher_id),
        accountingPostingStatus: s(row.accounting_posting_status),
        referenceType: s(row.reference_type),
        referenceId: s(row.reference_id),
        note: s(row.description),
        createdAt: String(row.created_at ?? ''),
        receivedAt: null,
      });
    }
  }

  if (!filters.sourceType || filters.sourceType === 'drawer_movement') {
    const params: Array<string | number> = [tenantId];
    let where = "m.tenant_id = ? AND (m.reference_type IS NULL OR m.reference_type NOT IN ('cash_custody_transfer','accepted_cash_transfer','expense','doctor_commission_settlement','bank_deposit_request','billing_handover'))";
    if (filters.sessionId) {
      where += ' AND m.counter_session_id = ?';
      params.push(filters.sessionId);
    }
    where += dateFilter('m', filters, params);
    const rows = await db.prepare(`
      SELECT m.id, m.counter_session_id, m.counter_id, m.employee_id, m.movement_type, m.amount,
             m.payment_method, m.reference_type, m.reference_id, m.description, m.created_by, m.created_at,
             u.name AS employee_name, bc.counter_name
      FROM cash_drawer_movements m
      LEFT JOIN users u ON u.id = m.employee_id AND u.tenant_id = m.tenant_id
      LEFT JOIN billing_counters bc ON bc.id = m.counter_id AND bc.tenant_id = m.tenant_id
      WHERE ${where}
      ORDER BY datetime(m.created_at) DESC, m.id DESC
      LIMIT ?
    `).bind(...params, limit).all<Record<string, unknown>>();

    for (const row of rows.results ?? []) {
      const movementType = String(row.movement_type ?? '');
      const direction: 'in' | 'out' | 'neutral' = movementType === 'cash_in' || movementType === 'opening' ? 'in' : movementType === 'cash_out' || movementType === 'cash_drop' ? 'out' : 'neutral';
      const currentLocationType: CashLocationType = direction === 'in' ? 'drawer' : direction === 'out' ? 'unknown' : 'drawer';
      events.push({
        id: `drawer_movement:${row.id}`,
        sourceType: 'drawer_movement',
        sourceId: String(row.id),
        sourceNo: s(row.reference_id),
        eventType: movementType === 'opening' ? 'DRAWER_OPENING' : `DRAWER_${movementType.toUpperCase()}`,
        status: 'posted',
        cashStatus: currentLocationType === 'unknown' ? 'UNKNOWN_REQUIRES_REVIEW' : 'IN_DRAWER',
        movementDirection: direction,
        amount: n(row.amount),
        expectedAmount: null,
        receivedAmount: null,
        dueAmount: null,
        varianceAmount: null,
        paymentMethod: String(row.payment_method ?? 'cash'),
        fromUserId: direction === 'out' ? i(row.employee_id) : null,
        fromUserName: direction === 'out' ? s(row.employee_name) : null,
        toUserId: direction === 'in' ? i(row.employee_id) : null,
        toUserName: direction === 'in' ? s(row.employee_name) : null,
        counterSessionId: i(row.counter_session_id),
        counterId: i(row.counter_id),
        counterName: s(row.counter_name),
        currentLocationType,
        currentLocationLabel: locationLabel(currentLocationType, s(row.counter_name)),
        accountingVoucherId: null,
        accountingPostingStatus: null,
        referenceType: s(row.reference_type),
        referenceId: s(row.reference_id),
        note: s(row.description),
        createdAt: String(row.created_at ?? ''),
        receivedAt: null,
      });
    }
  }

  if (!filters.sourceType || filters.sourceType === 'cash_custody_transfer') {
    const params: Array<string | number> = [tenantId];
    let where = 't.tenant_id = ?';
    if (filters.status && filters.status !== 'all') {
      where += ' AND t.status = ?';
      params.push(filters.status);
    }
    if (filters.sessionId) {
      where += ' AND t.counter_session_id = ?';
      params.push(filters.sessionId);
    }
    if (!filters.includeResolved && !filters.date && !filters.from && !filters.to) {
      where += " AND t.status IN ('pending','partial','disputed','received')";
    }
    where += dateFilter('t', filters, params);
    const rows = await db.prepare(`
      SELECT t.id, t.transfer_no, t.counter_session_id, t.counter_id, t.transfer_by, t.transfer_to,
             t.amount, t.received_amount, t.due_amount, t.status, t.destination_type, t.custody_label,
             t.note, t.receiver_note, t.accounting_voucher_id, t.created_at, t.received_at,
             from_user.name AS from_user_name, to_user.name AS to_user_name, to_user.role AS to_user_role,
             bc.counter_name, ape.status AS accounting_posting_status
      FROM billing_counter_cash_transfers t
      LEFT JOIN users from_user ON from_user.id = t.transfer_by AND from_user.tenant_id = t.tenant_id
      LEFT JOIN users to_user ON to_user.id = t.transfer_to AND to_user.tenant_id = t.tenant_id
      LEFT JOIN billing_counters bc ON bc.id = t.counter_id AND bc.tenant_id = t.tenant_id
      LEFT JOIN accounting_posting_events ape ON ape.tenant_id = t.tenant_id AND ape.source_type = 'cash_custody_transfer' AND CAST(ape.source_id AS TEXT) = CAST(t.id AS TEXT)
      WHERE ${where}
      ORDER BY datetime(t.created_at) DESC, t.id DESC
      LIMIT ?
    `).bind(...params, limit).all<Record<string, unknown>>();

    for (const row of rows.results ?? []) {
      const status = String(row.status ?? 'pending');
      const destinationType = String(row.destination_type ?? 'admin_custody');
      const receiverRole = String(row.to_user_role ?? '');
      let currentLocationType: CashLocationType = 'in_transit';
      let cashStatus = status === 'received' ? 'RECEIVED' : 'PENDING_RECEIVE';
      if (status === 'disputed') {
        currentLocationType = 'disputed';
        cashStatus = 'DISPUTED';
      } else if (status === 'received') {
        if (destinationType === 'counter_session' || !ADMIN_ROLES.has(receiverRole)) {
          currentLocationType = 'counter_custody';
          cashStatus = 'COUNTER_CUSTODY';
        } else {
          currentLocationType = 'admin_custody';
          cashStatus = 'ADMIN_CUSTODY';
        }
      } else if (status === 'cancelled') {
        currentLocationType = 'unknown';
        cashStatus = 'CANCELLED';
      }
      events.push({
        id: `cash_custody_transfer:${row.id}`,
        sourceType: 'cash_custody_transfer',
        sourceId: String(row.id),
        sourceNo: s(row.transfer_no),
        eventType: 'CASH_TRANSFER',
        status,
        cashStatus,
        movementDirection: 'transfer',
        amount: n(row.amount),
        expectedAmount: n(row.amount),
        receivedAmount: n(row.received_amount),
        dueAmount: n(row.due_amount),
        varianceAmount: n(row.due_amount),
        paymentMethod: 'cash',
        fromUserId: i(row.transfer_by),
        fromUserName: s(row.from_user_name),
        toUserId: i(row.transfer_to),
        toUserName: s(row.to_user_name),
        counterSessionId: i(row.counter_session_id),
        counterId: i(row.counter_id),
        counterName: s(row.counter_name),
        currentLocationType,
        currentLocationLabel: locationLabel(currentLocationType, s(row.custody_label)),
        accountingVoucherId: i(row.accounting_voucher_id),
        accountingPostingStatus: s(row.accounting_posting_status),
        referenceType: 'cash_custody_transfer',
        referenceId: String(row.id),
        note: s(row.receiver_note) ?? s(row.note),
        createdAt: String(row.created_at ?? ''),
        receivedAt: s(row.received_at),
      });
    }
  }

  if (!filters.sourceType || filters.sourceType === 'counter_handover') {
    const params: Array<string | number> = [tenantId];
    let where = "h.tenant_id = ? AND h.handover_type = 'counter'";
    if (filters.status && filters.status !== 'all') {
      where += ' AND h.status = ?';
      params.push(filters.status);
    }
    if (filters.sessionId) {
      where += ' AND h.counter_session_id = ?';
      params.push(filters.sessionId);
    }
    if (!filters.includeResolved && !filters.date && !filters.from && !filters.to) {
      where += " AND h.status IN ('pending','partial','received','disputed')";
    }
    where += dateFilter('h', filters, params);
    const rows = await db.prepare(`
      SELECT h.id, h.counter_session_id, h.handover_by, h.handover_to, h.handover_amount, h.due_amount,
             h.status, h.remarks, h.received_by, h.received_at, h.received_remarks, h.created_at,
             from_user.name AS from_user_name, to_user.name AS to_user_name, to_user.role AS to_user_role,
             s.counter_id, bc.counter_name
      FROM billing_handovers h
      LEFT JOIN users from_user ON from_user.id = h.handover_by AND from_user.tenant_id = h.tenant_id
      LEFT JOIN users to_user ON to_user.id = h.handover_to AND to_user.tenant_id = h.tenant_id
      LEFT JOIN billing_counter_sessions s ON s.id = h.counter_session_id AND s.tenant_id = h.tenant_id
      LEFT JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = h.tenant_id
      WHERE ${where}
      ORDER BY datetime(h.created_at) DESC, h.id DESC
      LIMIT ?
    `).bind(...params, limit).all<Record<string, unknown>>();

    for (const row of rows.results ?? []) {
      const status = String(row.status ?? 'pending');
      const receiverRole = String(row.to_user_role ?? '');
      let currentLocationType: CashLocationType = 'in_transit';
      let cashStatus = 'PENDING_RECEIVE';
      if (status === 'disputed') {
        currentLocationType = 'disputed';
        cashStatus = 'DISPUTED';
      } else if (status === 'received') {
        currentLocationType = ADMIN_ROLES.has(receiverRole) ? 'admin_custody' : 'counter_custody';
        cashStatus = ADMIN_ROLES.has(receiverRole) ? 'ADMIN_CUSTODY' : 'COUNTER_CUSTODY';
      }
      events.push({
        id: `counter_handover:${row.id}`,
        sourceType: 'counter_handover',
        sourceId: String(row.id),
        sourceNo: null,
        eventType: 'SHIFT_HANDOVER',
        status,
        cashStatus,
        movementDirection: 'transfer',
        amount: n(row.handover_amount),
        expectedAmount: n(row.handover_amount),
        receivedAmount: status === 'received' ? n(row.handover_amount) - n(row.due_amount) : null,
        dueAmount: n(row.due_amount),
        varianceAmount: n(row.due_amount),
        paymentMethod: 'cash',
        fromUserId: i(row.handover_by),
        fromUserName: s(row.from_user_name),
        toUserId: i(row.handover_to),
        toUserName: s(row.to_user_name),
        counterSessionId: i(row.counter_session_id),
        counterId: i(row.counter_id),
        counterName: s(row.counter_name),
        currentLocationType,
        currentLocationLabel: locationLabel(currentLocationType, s(row.to_user_name)),
        accountingVoucherId: null,
        accountingPostingStatus: null,
        referenceType: 'billing_handover',
        referenceId: String(row.id),
        note: s(row.received_remarks) ?? s(row.remarks),
        createdAt: String(row.created_at ?? ''),
        receivedAt: s(row.received_at),
      });
    }
  }

  if (!filters.sourceType || filters.sourceType === 'expense') {
    const params: Array<string | number> = [tenantId];
    let where = "e.tenant_id = ? AND COALESCE(e.payment_status, 'paid') = 'paid' AND COALESCE(e.approval_status, e.status, 'approved') = 'approved'";
    if (filters.sessionId) {
      where += ' AND e.counter_session_id = ?';
      params.push(filters.sessionId);
    }
    where += dateFilter('e', filters, params).replace(/e\.created_at/g, 'COALESCE(e.executed_at, e.date, e.created_at)');
    const rows = await db.prepare(`
      SELECT e.id, e.amount, e.category, e.description, e.counter_session_id, e.cash_movement_id,
             e.created_by, e.executed_by, e.date, COALESCE(e.executed_at, e.created_at) AS created_at,
             u.name AS user_name, m.counter_id, bc.counter_name, ape.status AS accounting_posting_status
      FROM expenses e
      LEFT JOIN users u ON u.id = COALESCE(e.executed_by, e.created_by) AND u.tenant_id = e.tenant_id
      LEFT JOIN cash_drawer_movements m ON m.id = e.cash_movement_id AND m.tenant_id = e.tenant_id
      LEFT JOIN billing_counters bc ON bc.id = m.counter_id AND bc.tenant_id = e.tenant_id
      LEFT JOIN accounting_posting_events ape ON ape.tenant_id = e.tenant_id AND ape.source_type = 'direct_expense' AND CAST(ape.source_id AS TEXT) = CAST(e.id AS TEXT)
      WHERE ${where}
      ORDER BY datetime(COALESCE(e.executed_at, e.date, e.created_at)) DESC, e.id DESC
      LIMIT ?
    `).bind(...params, limit).all<Record<string, unknown>>();
    for (const row of rows.results ?? []) {
      events.push({
        id: `expense:${row.id}`,
        sourceType: 'expense',
        sourceId: String(row.id),
        sourceNo: null,
        eventType: 'EXPENSE_PAID',
        status: 'paid',
        cashStatus: 'EXPENSE_PAID',
        movementDirection: 'out',
        amount: n(row.amount),
        expectedAmount: null,
        receivedAmount: null,
        dueAmount: null,
        varianceAmount: null,
        paymentMethod: 'cash',
        fromUserId: i(row.executed_by) ?? i(row.created_by),
        fromUserName: s(row.user_name),
        toUserId: null,
        toUserName: null,
        counterSessionId: i(row.counter_session_id),
        counterId: i(row.counter_id),
        counterName: s(row.counter_name),
        currentLocationType: 'expense',
        currentLocationLabel: locationLabel('expense', s(row.category)),
        accountingVoucherId: null,
        accountingPostingStatus: s(row.accounting_posting_status),
        referenceType: 'expense',
        referenceId: String(row.id),
        note: s(row.description),
        createdAt: String(row.created_at ?? row.date ?? ''),
        receivedAt: null,
      });
    }
  }

  if (!filters.sourceType || filters.sourceType === 'doctor_payout') {
    const params: Array<string | number> = [tenantId];
    let where = "s.tenant_id = ? AND COALESCE(s.payment_mode, 'cash') = 'cash' AND s.reversed_at IS NULL";
    where += dateFilter('s', filters, params).replace(/s\.created_at/g, 'COALESCE(s.settlement_date, s.created_at)');
    const rows = await db.prepare(`
      SELECT s.id, s.total_amount, s.payment_mode, s.reference_no, s.notes, s.settlement_date, s.created_at,
             s.created_by, s.voucher_id, d.name AS doctor_name, u.name AS created_by_name
      FROM doctor_commission_settlements s
      LEFT JOIN doctors d ON d.id = s.doctor_id AND d.tenant_id = s.tenant_id
      LEFT JOIN users u ON u.id = s.created_by AND u.tenant_id = s.tenant_id
      WHERE ${where}
      ORDER BY datetime(COALESCE(s.settlement_date, s.created_at)) DESC, s.id DESC
      LIMIT ?
    `).bind(...params, limit).all<Record<string, unknown>>();
    for (const row of rows.results ?? []) {
      events.push({
        id: `doctor_payout:${row.id}`,
        sourceType: 'doctor_payout',
        sourceId: String(row.id),
        sourceNo: s(row.reference_no),
        eventType: 'DOCTOR_PAYOUT_PAID',
        status: 'paid',
        cashStatus: 'PAYOUT_PAID',
        movementDirection: 'out',
        amount: n(row.total_amount),
        expectedAmount: null,
        receivedAmount: null,
        dueAmount: null,
        varianceAmount: null,
        paymentMethod: String(row.payment_mode ?? 'cash'),
        fromUserId: i(row.created_by),
        fromUserName: s(row.created_by_name),
        toUserId: null,
        toUserName: s(row.doctor_name),
        counterSessionId: null,
        counterId: null,
        counterName: null,
        currentLocationType: 'payout',
        currentLocationLabel: locationLabel('payout', s(row.doctor_name)),
        accountingVoucherId: i(row.voucher_id),
        accountingPostingStatus: null,
        referenceType: 'doctor_commission_settlement',
        referenceId: String(row.id),
        note: s(row.notes),
        createdAt: String(row.created_at ?? row.settlement_date ?? ''),
        receivedAt: null,
      });
    }
  }

  if (!filters.sourceType || filters.sourceType === 'bank_deposit_request') {
    const params: Array<string | number> = [tenantId];
    let where = 'bdr.tenant_id = ?';
    if (filters.status && filters.status !== 'all') {
      where += ' AND bdr.status = ?';
      params.push(filters.status);
    }
    if (filters.sessionId) {
      where += ' AND bdr.counter_session_id = ?';
      params.push(filters.sessionId);
    }
    if (!filters.includeResolved && !filters.date && !filters.from && !filters.to) {
      where += " AND bdr.status IN ('pending','approved','resolved')";
    }
    where += dateFilter('bdr', filters, params);
    const rows = await db.prepare(`
      SELECT bdr.id, bdr.request_no, bdr.counter_session_id, bdr.counter_id, bdr.requested_by,
             bdr.requested_amount, bdr.proposed_bank_name, bdr.request_note, bdr.status,
             bdr.bank_transaction_id, bdr.confirmed_bank_name, bdr.confirmed_reference_no, bdr.confirmed_date,
             bdr.confirmed_by, bdr.confirmed_at, bdr.resolution_type, bdr.created_at,
             u.name AS requested_by_name, cu.name AS confirmed_by_name, bc.counter_name
      FROM bank_deposit_requests bdr
      LEFT JOIN users u ON u.id = bdr.requested_by AND u.tenant_id = bdr.tenant_id
      LEFT JOIN users cu ON cu.id = bdr.confirmed_by AND cu.tenant_id = bdr.tenant_id
      LEFT JOIN billing_counters bc ON bc.id = bdr.counter_id AND bc.tenant_id = bdr.tenant_id
      WHERE ${where}
      ORDER BY datetime(bdr.created_at) DESC, bdr.id DESC
      LIMIT ?
    `).bind(...params, limit).all<Record<string, unknown>>();
    for (const row of rows.results ?? []) {
      const status = String(row.status ?? 'pending');
      const deposited = String(row.resolution_type ?? '') === 'deposited' || Number(row.bank_transaction_id ?? 0) > 0;
      const currentLocationType: CashLocationType = deposited ? 'bank' : 'bank_deposit_pending';
      events.push({
        id: `bank_deposit_request:${row.id}`,
        sourceType: 'bank_deposit_request',
        sourceId: String(row.id),
        sourceNo: s(row.request_no),
        eventType: deposited ? 'BANK_DEPOSIT_CONFIRMED' : 'BANK_DEPOSIT_REQUESTED',
        status,
        cashStatus: deposited ? 'BANKED' : 'BANK_DEPOSIT_PENDING',
        movementDirection: 'transfer',
        amount: n(row.requested_amount),
        expectedAmount: n(row.requested_amount),
        receivedAmount: deposited ? n(row.requested_amount) : null,
        dueAmount: deposited ? 0 : n(row.requested_amount),
        varianceAmount: null,
        paymentMethod: 'cash',
        fromUserId: i(row.requested_by),
        fromUserName: s(row.requested_by_name),
        toUserId: i(row.confirmed_by),
        toUserName: s(row.confirmed_by_name),
        counterSessionId: i(row.counter_session_id),
        counterId: i(row.counter_id),
        counterName: s(row.counter_name),
        currentLocationType,
        currentLocationLabel: locationLabel(currentLocationType, s(row.confirmed_bank_name) ?? s(row.proposed_bank_name)),
        accountingVoucherId: null,
        accountingPostingStatus: null,
        referenceType: 'bank_deposit_request',
        referenceId: String(row.id),
        note: s(row.request_note) ?? s(row.confirmed_reference_no),
        createdAt: String(row.created_at ?? row.confirmed_date ?? ''),
        receivedAt: s(row.confirmed_at),
      });
    }
  }

  const filtered = events.filter((event) => {
    if (filters.status && filters.status !== 'all' && event.status !== filters.status && event.cashStatus !== filters.status) return false;
    return true;
  });
  return sortEvents(filtered).slice(0, limit);
}

export async function loadCashLedgerOverview(
  db: D1Database,
  tenantId: string,
  filters: CashLedgerFilters = {},
): Promise<CashLedgerOverview> {
  const events = await loadCashLedgerEvents(db, tenantId, { ...filters, includeResolved: true, limit: filters.limit ?? 1000 });
  const activeDrawerCash = await loadActiveDrawerCash(db, tenantId);
  const overview: CashLedgerOverview = {
    date: filters.date ?? null,
    activeDrawerCash,
    pendingTransferCash: 0,
    adminCustodyCash: 0,
    counterCustodyCash: 0,
    bankDepositPendingCash: 0,
    bankedCash: 0,
    disputedCash: 0,
    refundedCash: 0,
    expensePaidCash: 0,
    payoutPaidCash: 0,
    unclassifiedCashOut: 0,
    totalCashAccountedFor: 0,
    eventCount: events.length,
    unresolvedCount: 0,
  };

  for (const event of events) {
    const amount = n(event.amount);
    const due = n(event.dueAmount ?? amount);
    const received = n(event.receivedAmount ?? 0);
    if (UNRESOLVED_STATUSES.has(event.status) || ['PENDING_RECEIVE', 'IN_TRANSIT', 'DISPUTED', 'BANK_DEPOSIT_PENDING'].includes(event.cashStatus)) {
      overview.unresolvedCount += 1;
    }
    switch (event.currentLocationType) {
      case 'drawer':
        // Current drawer balance is calculated from active counter sessions to avoid
        // double-counting collections that were later transferred or paid out.
        break;
      case 'in_transit':
        overview.pendingTransferCash += due;
        break;
      case 'admin_custody':
        overview.adminCustodyCash += received || amount;
        break;
      case 'counter_custody':
        overview.counterCustodyCash += received || amount;
        break;
      case 'bank_deposit_pending':
        overview.bankDepositPendingCash += due;
        break;
      case 'bank':
        overview.bankedCash += received || amount;
        break;
      case 'disputed':
        overview.disputedCash += due || amount;
        if (received > 0) overview.adminCustodyCash += received;
        break;
      case 'refund':
        overview.refundedCash += amount;
        break;
      case 'expense':
        overview.expensePaidCash += amount;
        break;
      case 'payout':
        overview.payoutPaidCash += amount;
        break;
      default:
        if (event.movementDirection === 'out') overview.unclassifiedCashOut += amount;
        break;
    }
  }

  overview.activeDrawerCash = n(overview.activeDrawerCash);
  overview.pendingTransferCash = n(overview.pendingTransferCash);
  overview.adminCustodyCash = n(overview.adminCustodyCash);
  overview.counterCustodyCash = n(overview.counterCustodyCash);
  overview.bankDepositPendingCash = n(overview.bankDepositPendingCash);
  overview.bankedCash = n(overview.bankedCash);
  overview.disputedCash = n(overview.disputedCash);
  overview.refundedCash = n(overview.refundedCash);
  overview.expensePaidCash = n(overview.expensePaidCash);
  overview.payoutPaidCash = n(overview.payoutPaidCash);
  overview.unclassifiedCashOut = n(overview.unclassifiedCashOut);
  overview.totalCashAccountedFor = n(
    overview.activeDrawerCash
    + overview.pendingTransferCash
    + overview.adminCustodyCash
    + overview.counterCustodyCash
    + overview.bankDepositPendingCash
    + overview.bankedCash
    + overview.disputedCash
    + overview.expensePaidCash
    + overview.payoutPaidCash
    + overview.refundedCash,
  );
  return overview;
}

export async function loadCashLedgerBalances(
  db: D1Database,
  tenantId: string,
  filters: CashLedgerFilters = {},
) {
  const overview = await loadCashLedgerOverview(db, tenantId, filters);
  return [
    { key: 'active_drawer_cash', label: 'Active drawer cash', amount: overview.activeDrawerCash },
    { key: 'pending_transfer_cash', label: 'Pending / in-transit cash', amount: overview.pendingTransferCash },
    { key: 'admin_custody_cash', label: 'Admin custody cash', amount: overview.adminCustodyCash },
    { key: 'counter_custody_cash', label: 'Counter custody cash', amount: overview.counterCustodyCash },
    { key: 'bank_deposit_pending_cash', label: 'Bank deposit pending', amount: overview.bankDepositPendingCash },
    { key: 'banked_cash', label: 'Banked cash', amount: overview.bankedCash },
    { key: 'disputed_cash', label: 'Disputed / short cash', amount: overview.disputedCash },
    { key: 'expense_paid_cash', label: 'Expense paid cash', amount: overview.expensePaidCash },
    { key: 'payout_paid_cash', label: 'Payout paid cash', amount: overview.payoutPaidCash },
    { key: 'refunded_cash', label: 'Refunded cash', amount: overview.refundedCash },
    { key: 'unclassified_cash_out', label: 'Unclassified cash out', amount: overview.unclassifiedCashOut },
  ];
}

export async function loadCashLedgerExceptions(
  db: D1Database,
  tenantId: string,
  filters: CashLedgerFilters = {},
) {
  const events = await loadCashLedgerEvents(db, tenantId, { ...filters, includeResolved: true, limit: filters.limit ?? 1000 });
  return events.filter((event) => (
    event.currentLocationType === 'in_transit'
    || event.currentLocationType === 'disputed'
    || event.currentLocationType === 'unknown'
    || event.cashStatus === 'BANK_DEPOSIT_PENDING'
    || n(event.dueAmount) > 0
  ));
}

function reconciliationStatus(checks: CashLedgerReconciliationCheck[]): 'pass' | 'warning' | 'fail' {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warning')) return 'warning';
  return 'pass';
}

export async function loadCashLedgerReconciliation(
  db: D1Database,
  tenantId: string,
  filters: CashLedgerFilters = {},
): Promise<CashLedgerReconciliationReport> {
  const [overview, balances, exceptions] = await Promise.all([
    loadCashLedgerOverview(db, tenantId, filters),
    loadCashLedgerBalances(db, tenantId, filters),
    loadCashLedgerExceptions(db, tenantId, filters),
  ]);

  const expectedPendingExceptions = n(
    overview.pendingTransferCash
    + overview.bankDepositPendingCash
    + overview.disputedCash,
  );
  const actualPendingExceptions = n(exceptions.reduce((sum, event) => {
    if (event.currentLocationType === 'in_transit' || event.currentLocationType === 'bank_deposit_pending' || event.currentLocationType === 'disputed') {
      return sum + n(event.dueAmount ?? event.amount);
    }
    return sum;
  }, 0));

  const checks: CashLedgerReconciliationCheck[] = [
    {
      key: 'active_drawer_non_negative',
      label: 'Active drawer cash is non-negative',
      status: overview.activeDrawerCash >= 0 ? 'pass' : 'fail',
      actualAmount: overview.activeDrawerCash,
      details: overview.activeDrawerCash >= 0
        ? 'Active drawer cash is valid.'
        : 'Active drawer cash is negative. Counter session movement math needs investigation.',
    },
    {
      key: 'total_accounted_non_negative',
      label: 'Total accounted cash is non-negative',
      status: overview.totalCashAccountedFor >= 0 ? 'pass' : 'fail',
      actualAmount: overview.totalCashAccountedFor,
      details: overview.totalCashAccountedFor >= 0
        ? 'Total accounted cash is valid.'
        : 'Total accounted cash is negative. Ledger source mapping is inconsistent.',
    },
    {
      key: 'no_unclassified_cash_out',
      label: 'No unclassified cash out',
      status: overview.unclassifiedCashOut === 0 ? 'pass' : 'fail',
      actualAmount: overview.unclassifiedCashOut,
      details: overview.unclassifiedCashOut === 0
        ? 'Every cash-out row is mapped to a known source category.'
        : 'There are cash-out rows that are not mapped to refund, expense, payout, transfer, or deposit.',
    },
    {
      key: 'no_disputed_cash',
      label: 'No disputed or short cash',
      status: overview.disputedCash === 0 ? 'pass' : 'warning',
      actualAmount: overview.disputedCash,
      details: overview.disputedCash === 0
        ? 'No disputed/short cash currently detected.'
        : 'Disputed or short cash exists and should be reviewed by admin/accounting.',
    },
    {
      key: 'pending_exceptions_match',
      label: 'Pending cash equals exception trail',
      status: expectedPendingExceptions === actualPendingExceptions ? 'pass' : 'fail',
      expectedAmount: expectedPendingExceptions,
      actualAmount: actualPendingExceptions,
      details: expectedPendingExceptions === actualPendingExceptions
        ? 'Pending/in-transit cash has a matching exception trail.'
        : 'Pending cash buckets and exception trail do not match. This can hide or double-count cash.',
    },
  ];

  return {
    status: reconciliationStatus(checks),
    generatedAt: new Date().toISOString(),
    overview,
    balances,
    exceptions,
    checks,
  };
}

type ShadowSummary = { available: boolean; count: number; amount: number; error?: string };
type ShadowFlowDefinition = {
  key: string;
  label: string;
  sourceSql: string;
  sourceColumn?: string;
  shadowEventType: string;
};

function shadowTemporalFilter(column: string, filters: CashLedgerFilters, params: Array<string | number>): string {
  if (filters.date) {
    params.push(filters.date);
    return ` AND date(${column}, '+6 hours') = date(?)`;
  }
  let clause = '';
  if (filters.from) {
    params.push(filters.from);
    clause += ` AND ${column} >= ?`;
  }
  if (filters.to) {
    params.push(`${filters.to} 23:59:59`);
    clause += ` AND ${column} <= ?`;
  }
  return clause;
}

async function loadSummaryRow(db: D1Database, sql: string, params: Array<string | number>): Promise<ShadowSummary> {
  try {
    const row = await db.prepare(sql).bind(...params).first<{ count: number; amount: number }>();
    return { available: true, count: Number(row?.count ?? 0), amount: n(row?.amount ?? 0) };
  } catch (error) {
    return {
      available: false,
      count: 0,
      amount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadShadowEntrySummary(
  db: D1Database,
  tenantId: string,
  eventType: string,
  filters: CashLedgerFilters,
): Promise<ShadowSummary> {
  const params: Array<string | number> = [tenantId, eventType];
  const dateClause = shadowTemporalFilter('occurred_at', filters, params);
  return loadSummaryRow(db, `
    SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
    FROM cash_ledger_entries
    WHERE tenant_id = ? AND event_type = ?${dateClause}
  `, params);
}

const SHADOW_FLOW_DEFINITIONS: ShadowFlowDefinition[] = [
  {
    key: 'cash_transfer_requested',
    label: 'Cash custody transfer requested',
    shadowEventType: 'CASH_CUSTODY_TRANSFER_REQUESTED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM billing_counter_cash_transfers WHERE tenant_id = ?`,
  },
  {
    key: 'expense_paid',
    label: 'Expense paid from drawer',
    shadowEventType: 'EXPENSE_PAID',
    sourceColumn: 'COALESCE(executed_at, created_at)',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM expenses WHERE tenant_id = ? AND COALESCE(payment_status, 'paid') = 'paid'`,
  },
  {
    key: 'doctor_payout_paid',
    label: 'Doctor payout paid',
    shadowEventType: 'DOCTOR_PAYOUT_PAID',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN COALESCE(s.net_paid_amount, 0) > 0 THEN s.net_paid_amount ELSE s.total_amount END), 0) AS amount FROM doctor_commission_settlements s WHERE s.tenant_id = ? AND COALESCE(s.payment_method, s.payment_mode, 'cash') = 'cash' AND s.reversed_at IS NULL`,
  },
  {
    key: 'patient_deposit_received',
    label: 'Patient deposit received',
    shadowEventType: 'PATIENT_DEPOSIT_RECEIVED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM billing_deposits WHERE tenant_id = ? AND transaction_type = 'deposit' AND COALESCE(payment_method, 'cash') = 'cash'`,
  },
  {
    key: 'patient_deposit_refunded',
    label: 'Patient deposit refunded',
    shadowEventType: 'PATIENT_DEPOSIT_REFUNDED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM billing_deposits WHERE tenant_id = ? AND transaction_type = 'refund' AND COALESCE(payment_method, 'cash') = 'cash'`,
  },
  {
    key: 'bill_payment_received',
    label: 'Billing counter payment received',
    shadowEventType: 'BILL_PAYMENT_RECEIVED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM cash_ledger_entries WHERE tenant_id = ? AND event_type = 'BILL_PAYMENT_RECEIVED'`,
  },
  {
    key: 'appointment_payment_received',
    label: 'Appointment payment received',
    shadowEventType: 'APPOINTMENT_PAYMENT_RECEIVED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM cash_ledger_entries WHERE tenant_id = ? AND event_type = 'APPOINTMENT_PAYMENT_RECEIVED'`,
  },
  {
    key: 'ipd_payment_received',
    label: 'IPD payment received',
    shadowEventType: 'IPD_PAYMENT_RECEIVED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM cash_ledger_entries WHERE tenant_id = ? AND event_type = 'IPD_PAYMENT_RECEIVED'`,
  },
  {
    key: 'receivable_collection_received',
    label: 'Settlement / due collection received',
    shadowEventType: 'RECEIVABLE_COLLECTION_RECEIVED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(paid_amount), 0) AS amount FROM billing_settlements WHERE tenant_id = ? AND paid_amount > 0 AND is_active = 1`,
  },
];

export async function loadCashLedgerShadowReconciliation(
  db: D1Database,
  tenantId: string,
  filters: CashLedgerFilters = {},
): Promise<CashLedgerShadowReconciliationReport> {
  const rows: CashLedgerShadowCoverageRow[] = [];
  for (const flow of SHADOW_FLOW_DEFINITIONS) {
    const sourceParams: Array<string | number> = [tenantId];
    const sourceSql = `${flow.sourceSql}${flow.sourceColumn ? shadowTemporalFilter(flow.sourceColumn, filters, sourceParams) : ''}`;
    const [source, shadow] = await Promise.all([
      loadSummaryRow(db, sourceSql, sourceParams),
      loadShadowEntrySummary(db, tenantId, flow.shadowEventType, filters),
    ]);

    const differenceAmount = n(source.amount - shadow.amount);
    const differenceCount = source.count - shadow.count;
    const matching = source.available && shadow.available && differenceAmount === 0 && differenceCount === 0;
    const status: CashLedgerShadowCoverageRow['status'] = !source.available || !shadow.available
      ? 'fail'
      : matching
        ? 'pass'
        : 'warning';
    rows.push({
      key: flow.key,
      label: flow.label,
      status,
      sourceAvailable: source.available && shadow.available,
      sourceCount: source.count,
      sourceAmount: source.amount,
      shadowCount: shadow.count,
      shadowAmount: shadow.amount,
      differenceCount,
      differenceAmount,
      details: status === 'pass'
        ? 'Source and shadow ledger totals match for this flow.'
        : status === 'fail'
          ? `Unable to compare this flow. ${source.error ?? shadow.error ?? ''}`.trim()
          : 'Source and shadow ledger totals do not match yet. This is expected until shadow-write has run long enough and historical backfill is complete.',
    });
  }

  const blockedFlows = [
    {
      key: 'pharmacy_payment',
      label: 'Pharmacy payment',
      reason: 'Inspected pharmacy fulfilment writes pharmacy_sales and stock movement, but not active drawer cash movement. Needs pharmacy cash-drawer source-of-truth decision before IN_DRAWER shadow-write.',
    },
    {
      key: 'gateway_payment',
      label: 'Gateway payment',
      reason: 'Gateway payment flow has no active counter session/counter custody mapping. Needs gateway custody/bank settlement mapping before shadow-write as drawer cash.',
    },
  ];

  const status = rows.some((row) => row.status === 'fail')
    ? 'fail'
    : rows.some((row) => row.status === 'warning')
      ? 'warning'
      : 'pass';

  return {
    status,
    generatedAt: new Date().toISOString(),
    rows,
    blockedFlows,
  };
}

type BackfillFlowDefinition = ShadowFlowDefinition & {
  sourceTable: string;
};

const BACKFILL_DRY_RUN_FLOWS: BackfillFlowDefinition[] = [
  {
    key: 'cash_transfer_requested',
    label: 'Cash custody transfer requested',
    sourceTable: 'billing_counter_cash_transfers',
    shadowEventType: 'CASH_CUSTODY_TRANSFER_REQUESTED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM billing_counter_cash_transfers WHERE tenant_id = ?`,
  },
  {
    key: 'expense_paid',
    label: 'Expense paid from drawer',
    sourceTable: 'expenses',
    shadowEventType: 'EXPENSE_PAID',
    sourceColumn: 'COALESCE(executed_at, created_at)',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM expenses WHERE tenant_id = ? AND COALESCE(payment_status, 'paid') = 'paid'`,
  },
  {
    key: 'doctor_payout_paid',
    label: 'Doctor payout paid',
    sourceTable: 'doctor_commission_settlements',
    shadowEventType: 'DOCTOR_PAYOUT_PAID',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN COALESCE(s.net_paid_amount, 0) > 0 THEN s.net_paid_amount ELSE s.total_amount END), 0) AS amount FROM doctor_commission_settlements s WHERE s.tenant_id = ? AND COALESCE(s.payment_method, s.payment_mode, 'cash') = 'cash' AND s.reversed_at IS NULL`,
  },
  {
    key: 'patient_deposit_received',
    label: 'Patient deposit received',
    sourceTable: 'billing_deposits',
    shadowEventType: 'PATIENT_DEPOSIT_RECEIVED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM billing_deposits WHERE tenant_id = ? AND transaction_type = 'deposit' AND COALESCE(payment_method, 'cash') = 'cash'`,
  },
  {
    key: 'patient_deposit_refunded',
    label: 'Patient deposit refunded',
    sourceTable: 'billing_deposits',
    shadowEventType: 'PATIENT_DEPOSIT_REFUNDED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM billing_deposits WHERE tenant_id = ? AND transaction_type = 'refund' AND COALESCE(payment_method, 'cash') = 'cash'`,
  },
  {
    key: 'bill_payment_received',
    label: 'Billing counter payment received',
    sourceTable: 'emp_cash_transactions',
    shadowEventType: 'BILL_PAYMENT_RECEIVED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM emp_cash_transactions WHERE tenant_id = ? AND transaction_type = 'CashSales' AND reference_type = 'bill' AND description LIKE 'Invoice payment %'`,
  },
  {
    key: 'appointment_payment_received',
    label: 'Appointment payment received',
    sourceTable: 'emp_cash_transactions',
    shadowEventType: 'APPOINTMENT_PAYMENT_RECEIVED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM emp_cash_transactions WHERE tenant_id = ? AND transaction_type = 'CashSales' AND reference_type = 'bill' AND description LIKE 'Appointment consultation payment %'`,
  },
  {
    key: 'ipd_payment_received',
    label: 'IPD payment received',
    sourceTable: 'emp_cash_transactions',
    shadowEventType: 'IPD_PAYMENT_RECEIVED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM emp_cash_transactions WHERE tenant_id = ? AND transaction_type = 'CashSales' AND reference_type = 'bill' AND description LIKE 'Discharge bill payment %'`,
  },
  {
    key: 'receivable_collection_received',
    label: 'Settlement / due collection received',
    sourceTable: 'billing_settlements',
    shadowEventType: 'RECEIVABLE_COLLECTION_RECEIVED',
    sourceColumn: 'created_at',
    sourceSql: `SELECT COUNT(*) AS count, COALESCE(SUM(paid_amount), 0) AS amount FROM billing_settlements WHERE tenant_id = ? AND paid_amount > 0 AND is_active = 1`,
  },
];

export async function loadCashLedgerBackfillDryRun(
  db: D1Database,
  tenantId: string,
  filters: CashLedgerFilters = {},
): Promise<CashLedgerBackfillDryRunReport> {
  const rows: CashLedgerBackfillDryRunRow[] = [];
  for (const flow of BACKFILL_DRY_RUN_FLOWS) {
    const sourceParams: Array<string | number> = [tenantId];
    const sourceSql = `${flow.sourceSql}${flow.sourceColumn ? shadowTemporalFilter(flow.sourceColumn, filters, sourceParams) : ''}`;
    const [source, shadow] = await Promise.all([
      loadSummaryRow(db, sourceSql, sourceParams),
      loadShadowEntrySummary(db, tenantId, flow.shadowEventType, filters),
    ]);

    const missingCount = Math.max(0, source.count - shadow.count);
    const missingAmount = Math.max(0, n(source.amount - shadow.amount));
    const duplicateRisk = shadow.count > source.count || shadow.amount > source.amount;
    const status: CashLedgerBackfillDryRunRow['status'] = !source.available || !shadow.available
      ? 'fail'
      : missingCount > 0 || missingAmount > 0 || duplicateRisk
        ? 'warning'
        : 'ready';

    rows.push({
      key: flow.key,
      label: flow.label,
      eventType: flow.shadowEventType,
      sourceTable: flow.sourceTable,
      status,
      sourceAvailable: source.available && shadow.available,
      sourceCount: source.count,
      sourceAmount: source.amount,
      existingShadowCount: shadow.count,
      existingShadowAmount: shadow.amount,
      missingCount,
      missingAmount,
      duplicateRisk,
      details: status === 'ready'
        ? 'No backfill required for this flow in the selected range.'
        : status === 'fail'
          ? `Cannot calculate dry-run for this flow. ${source.error ?? shadow.error ?? ''}`.trim()
          : duplicateRisk
            ? 'Existing shadow ledger appears higher than source. Review idempotency keys before any backfill write.'
            : 'Historical source rows appear missing from cash_ledger_entries. Backfill can be planned after reviewing this row.',
    });
  }

  const totals = rows.reduce((acc, row) => ({
    sourceCount: acc.sourceCount + row.sourceCount,
    sourceAmount: n(acc.sourceAmount + row.sourceAmount),
    existingShadowCount: acc.existingShadowCount + row.existingShadowCount,
    existingShadowAmount: n(acc.existingShadowAmount + row.existingShadowAmount),
    missingCount: acc.missingCount + row.missingCount,
    missingAmount: n(acc.missingAmount + row.missingAmount),
  }), {
    sourceCount: 0,
    sourceAmount: 0,
    existingShadowCount: 0,
    existingShadowAmount: 0,
    missingCount: 0,
    missingAmount: 0,
  });

  const blockedFlows = [
    {
      key: 'pharmacy_payment',
      label: 'Pharmacy payment',
      reason: 'Backfill dry-run is blocked because pharmacy cash collection is not mapped to active drawer custody in the inspected source flow.',
    },
    {
      key: 'gateway_payment',
      label: 'Gateway payment',
      reason: 'Backfill dry-run is blocked because gateway payment custody/bank settlement source of truth is not finalized.',
    },
  ];

  const status = rows.some((row) => row.status === 'fail')
    ? 'fail'
    : rows.some((row) => row.status === 'warning')
      ? 'warning'
      : 'ready';

  return {
    status,
    generatedAt: new Date().toISOString(),
    rows,
    totals,
    blockedFlows,
  };
}


function parseCashLedgerJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function loadCashLedgerShadowIssues(
  db: D1Database,
  tenantId: string,
  filters: CashLedgerFilters = {},
): Promise<CashLedgerShadowIssue[]> {
  const params: Array<string | number> = [tenantId];
  const dateClause = shadowTemporalFilter('created_at', filters, params);
  const limit = Math.min(Math.max(Number(filters.limit ?? 100), 1), 500);
  params.push(limit);
  const rows = await db.prepare(`
    SELECT id, tenant_id, source_type, source_id, event_type, idempotency_key, issue_message, payload_json, created_at
    FROM cash_ledger_shadow_issues
    WHERE tenant_id = ?${dateClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(...params).all<Record<string, unknown>>();

  return (rows.results ?? []).map((row) => ({
    id: Number(row.id),
    tenantId: String(row.tenant_id ?? ''),
    sourceType: String(row.source_type ?? ''),
    sourceId: String(row.source_id ?? ''),
    eventType: String(row.event_type ?? ''),
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    issueMessage: String(row.issue_message ?? ''),
    payload: parseCashLedgerJson(row.payload_json),
    createdAt: String(row.created_at ?? ''),
  }));
}


function mergeReadinessPendingItems(...groups: Array<Array<{ key: string; label: string; reason: string }>>): Array<{ key: string; label: string; reason: string }> {
  const map = new Map<string, { key: string; label: string; reason: string }>();
  for (const group of groups) {
    for (const item of group) map.set(item.key, item);
  }
  return Array.from(map.values());
}

export async function loadCashLedgerReadiness(
  db: D1Database,
  tenantId: string,
  filters: CashLedgerFilters = {},
): Promise<CashLedgerReadinessReport> {
  const [shadow, historical, logRows] = await Promise.all([
    loadCashLedgerShadowReconciliation(db, tenantId, filters),
    loadCashLedgerBackfillDryRun(db, tenantId, filters),
    loadCashLedgerShadowIssues(db, tenantId, { ...filters, limit: filters.limit ?? 50 }),
  ]);

  const pendingItems = mergeReadinessPendingItems(shadow.blockedFlows, historical.blockedFlows);
  const checks: CashLedgerReadinessCheck[] = [
    {
      key: 'shadow_reconciliation',
      label: 'Shadow reconciliation',
      status: shadow.status === 'pass' ? 'pass' : shadow.status === 'fail' ? 'fail' : 'warning',
      details: shadow.status === 'pass' ? 'Source and shadow totals match.' : 'Source and shadow totals still need review.',
    },
    {
      key: 'historical_report',
      label: 'Historical dry-run',
      status: historical.status === 'ready' ? 'pass' : historical.status === 'fail' ? 'fail' : 'warning',
      details: historical.status === 'ready' ? 'No missing historical rows found for the selected range.' : `${historical.totals.missingCount} rows / ${historical.totals.missingAmount} amount still need review.`,
    },
    {
      key: 'shadow_log',
      label: 'Shadow write log',
      status: logRows.length === 0 ? 'pass' : 'warning',
      details: logRows.length === 0 ? 'No shadow write issues found for the selected range.' : `${logRows.length} shadow write issues found for review.`,
    },
    {
      key: 'pending_items',
      label: 'Pending flow decisions',
      status: pendingItems.length === 0 ? 'pass' : 'warning',
      details: pendingItems.length === 0 ? 'No pending flow decisions remain.' : `${pendingItems.length} flow decisions remain before source-of-truth migration.`,
    },
  ];

  const status = checks.some((check) => check.status === 'fail')
    ? 'action_required'
    : checks.some((check) => check.status === 'warning')
      ? 'attention'
      : 'ready';

  return {
    status,
    ready: status === 'ready',
    generatedAt: new Date().toISOString(),
    checks,
    pendingItems,
  };
}
