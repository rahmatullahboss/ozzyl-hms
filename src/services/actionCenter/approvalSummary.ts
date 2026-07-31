import type { D1Database } from '@cloudflare/workers-types';
import { d1WithRetry } from '../../lib/d1-retry';
import { getTodayGMT6 } from '../../lib/date-utils';
import { publicApprovalType } from '../../lib/credit-discharge-approval';

export interface ApprovalOperationalSummary {
  totalPending: number;
  highPriority: number;
  olderThan24h: number;
  dueSoon: number;
  todayApproved: number;
  rejectedToday: number;
  cashHandoverPending: number;
  expensePending: number;
  missingEvidence: number;
  executionFailed: number;
  infoRequested: number;
  infoSubmitted: number;
  blocked: number;
  actionable: number;
  totalPendingAmount: number;
  averageAgeMinutes: number;
  oldestPendingMinutes: number;
  oldestPendingAt: string | null;
  pendingByType: Record<string, number>;
}

const APPROVAL_TYPE_ALIASES: Record<string, string> = {
  bill_cancellation: 'bill_cancel',
  discount_approval: 'discount',
  cash_closing: 'cash_handover',
  cash_transfer_handover: 'cash_handover',
  shift_handover: 'cash_handover',
};

const EXECUTABLE_APPROVAL_TYPES = new Set(['bill_cancel', 'payment_void', 'refund']);
const EVIDENCE_REQUIRED_TYPES = new Set([
  'refund',
  'payment_void',
  'cash_handover',
  'expense',
  'stock_adjustment',
  'doctor_payout',
  'manual_adjustment',
  'credit_note',
]);
const EVIDENCE_FIELD_KEYS = [
  'attachmentUrl',
  'attachment_url',
  'receiptUrl',
  'receipt_url',
  'documentUrl',
  'document_url',
  'evidenceUrl',
  'evidence_url',
  'voucherUrl',
  'voucher_url',
  'receiptPhotoUrl',
  'receipt_photo_url',
  'denominationSnapshotUrl',
  'denomination_snapshot_url',
  'supportingDocumentUrl',
  'supporting_document_url',
  'attachments',
  'evidence',
] as const;

type ApprovalInfoState = {
  info_request_status: 'none' | 'requested' | 'submitted';
};

const EMPTY_INFO_STATE: ApprovalInfoState = { info_request_status: 'none' };

type FinalHandoverApprovalStatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

function parseRequestData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function canonicalApprovalType(type: unknown): string {
  const raw = String(type ?? '').trim();
  return APPROVAL_TYPE_ALIASES[raw] ?? raw;
}

function canonicalApprovalRequestType(request: any): string {
  const requestData = parseRequestData(request?.request_data ?? request?.requestData);
  return publicApprovalType(canonicalApprovalType(request?.type), requestData);
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function approvalAmount(request: any): number {
  const requestData = parseRequestData(request?.request_data);
  if (canonicalApprovalRequestType(request) === 'credit_discharge') {
    const totalDueMinor = firstFiniteNumber(requestData.totalDueMinor);
    if (totalDueMinor !== undefined) return totalDueMinor / 100;
  }
  const oldValue = parseRequestData(requestData.oldValue);
  const newValue = parseRequestData(requestData.newValue);
  return firstFiniteNumber(
    requestData.amount,
    requestData.totalAmount,
    requestData.total_amount,
    requestData.refundAmount,
    requestData.refund_amount,
    requestData.expectedAmount,
    requestData.countedAmount,
    requestData.paidAmount,
    requestData.dueAmount,
    requestData.variance,
    oldValue.amount,
    oldValue.totalAmount,
    oldValue.total_amount,
    oldValue.refundAmount,
    oldValue.paidAmount,
    newValue.amount,
    newValue.totalAmount,
    newValue.refundAmount,
  ) ?? 0;
}

function isHighRiskApproval(request: any): boolean {
  const type = canonicalApprovalRequestType(request);
  const requestData = parseRequestData(request?.request_data);
  const variance = firstFiniteNumber(
    requestData.variance,
    requestData.cashVariance,
    requestData.receiverVariance,
    requestData.receiver_variance,
  );
  return (type === 'cash_handover' && variance !== undefined && variance !== 0)
    || Math.abs(approvalAmount(request)) >= 10000;
}

function hasApprovalEvidence(requestData: Record<string, unknown>): boolean {
  return EVIDENCE_FIELD_KEYS.some((key) => {
    const value = requestData[key];
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
  });
}

function hasSystemCashHandoverEvidence(requestData: Record<string, unknown>): boolean {
  return firstFiniteNumber(requestData.expectedAmount, requestData.expected_amount) !== undefined
    && firstFiniteNumber(requestData.countedAmount, requestData.counted_amount) !== undefined
    && firstFiniteNumber(
      requestData.variance,
      requestData.receiverVariance,
      requestData.receiver_variance,
    ) !== undefined
    && Boolean(
      requestData.receivedAt
      || requestData.received_at
      || requestData.receivedBy
      || requestData.received_by,
    );
}

function approvalEvidenceRequired(request: any): boolean {
  const type = canonicalApprovalRequestType(request);
  const requestData = parseRequestData(request?.request_data);
  const discountPercent = firstFiniteNumber(
    requestData.discountPercent,
    requestData.discount_percent,
    parseRequestData(requestData.newValue).discountPercent,
    parseRequestData(requestData.newValue).discount_percent,
  );
  if (EVIDENCE_REQUIRED_TYPES.has(type)) return true;
  if (type === 'bill_cancel' && isHighRiskApproval(request)) return true;
  if (type === 'discount' && (isHighRiskApproval(request) || Number(discountPercent ?? 0) >= 10)) return true;
  return false;
}

function approvalEvidenceStatus(request: any): 'not_required' | 'provided' | 'missing' {
  if (!approvalEvidenceRequired(request)) return 'not_required';
  const requestData = parseRequestData(request?.request_data);
  if (canonicalApprovalRequestType(request) === 'cash_handover' && hasSystemCashHandoverEvidence(requestData)) {
    return 'provided';
  }
  return hasApprovalEvidence(requestData) ? 'provided' : 'missing';
}

function approvalInitialExecutionStatus(type: string): 'pending' | 'not_required' {
  return EXECUTABLE_APPROVAL_TYPES.has(canonicalApprovalType(type)) ? 'pending' : 'not_required';
}

function approvalRisk(request: any): 'low' | 'medium' | 'high' {
  if (isHighRiskApproval(request)) return 'high';
  return Math.abs(approvalAmount(request)) >= 3000 ? 'medium' : 'low';
}

function approvalSlaMinutes(request: any): number {
  const type = canonicalApprovalRequestType(request);
  if (String(request?.execution_status ?? '') === 'failed') return 0;
  if (type === 'cash_handover') return 120;
  if (type === 'payment_void' || type === 'refund' || type === 'bill_cancel') return 240;
  const risk = approvalRisk(request);
  if (risk === 'high') return 240;
  if (risk === 'medium') return 720;
  return 1440;
}

function approvalSlaDueAt(request: any): string | null {
  const createdAt = request?.created_at;
  if (!createdAt) return null;
  const parsed = new Date(String(createdAt));
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setMinutes(parsed.getMinutes() + approvalSlaMinutes(request));
  return parsed.toISOString();
}

function approvalAgeMinutes(request: any): number {
  const createdAt = request?.created_at;
  if (!createdAt) return 0;
  const parsed = new Date(String(createdAt)).getTime();
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round((Date.now() - parsed) / 60000));
}

function isApprovalSlaBreached(request: any): boolean {
  const dueAt = approvalSlaDueAt(request);
  if (!dueAt) return false;
  const parsed = new Date(dueAt).getTime();
  return Number.isFinite(parsed) && parsed < Date.now();
}

function isApprovalDueSoon(request: any): boolean {
  const dueAt = approvalSlaDueAt(request);
  if (!dueAt) return false;
  const parsed = new Date(dueAt).getTime();
  if (!Number.isFinite(parsed)) return false;
  const diff = parsed - Date.now();
  return diff >= 0 && diff <= 2 * 60 * 60 * 1000;
}

function isApprovalDecisionBlocked(request: any): boolean {
  return request?.evidence_status === 'missing'
    || String(request?.execution_status ?? '') === 'failed'
    || request?.info_request_status === 'requested';
}

function isApprovalActionable(request: any): boolean {
  return request?.status === 'pending' && !isApprovalDecisionBlocked(request);
}

function isActualApprovalDecision(request: any): boolean {
  const requestData = parseRequestData(request?.request_data);
  return !(request?.approval_source === 'billing_handovers' && requestData.approvalRequired === false);
}

function localDate(value: unknown): string | null {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeSummaryApprovalRow<T extends Record<string, any>>(row: T): T & {
  type: string;
  request_data: Record<string, unknown>;
  approval_amount: number;
  evidence_status: 'not_required' | 'provided' | 'missing';
  execution_status: string;
} {
  const requestData = parseRequestData(row.request_data);
  const normalized = {
    ...row,
    type: publicApprovalType(canonicalApprovalType(row.type), requestData),
    request_data: requestData,
  };
  return {
    ...normalized,
    approval_amount: approvalAmount(normalized),
    evidence_status: approvalEvidenceStatus(normalized),
    execution_status: normalized.execution_status ?? approvalInitialExecutionStatus(normalized.type),
  };
}

function deriveApprovalInfoState(events: any[]): ApprovalInfoState {
  let latestRequestIndex = -1;
  let latestSubmissionIndex = -1;
  events.forEach((event, index) => {
    if (event.action === 'request_info') latestRequestIndex = index;
    if (event.action === 'info_submitted') latestSubmissionIndex = index;
  });
  if (latestRequestIndex < 0) return EMPTY_INFO_STATE;
  return {
    info_request_status: latestSubmissionIndex > latestRequestIndex ? 'submitted' : 'requested',
  };
}

async function loadApprovalInfoStates(
  db: D1Database,
  tenantId: string,
  approvalIds: Array<number | string | null | undefined>,
): Promise<Map<number, ApprovalInfoState>> {
  const ids = Array.from(new Set(
    approvalIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0),
  ));
  const states = new Map<number, ApprovalInfoState>();
  if (ids.length === 0) return states;
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await d1WithRetry(
    () => db.prepare(`
      SELECT id, approval_request_id, action, actor_id, notes, metadata, created_at
      FROM approval_events
      WHERE tenant_id = ?
        AND approval_request_id IN (${placeholders})
        AND action IN ('request_info', 'info_submitted')
      ORDER BY approval_request_id ASC, created_at ASC, id ASC
    `).bind(tenantId, ...ids).all(),
    { label: 'approval operational summary info states' },
  );
  const grouped = new Map<number, any[]>();
  for (const event of results ?? []) {
    const approvalId = Number((event as any).approval_request_id);
    if (!grouped.has(approvalId)) grouped.set(approvalId, []);
    grouped.get(approvalId)!.push(event);
  }
  for (const id of ids) states.set(id, deriveApprovalInfoState(grouped.get(id) ?? []));
  return states;
}

function appendInfoState<T extends Record<string, any>>(
  row: T,
  states: Map<number, ApprovalInfoState>,
): T & ApprovalInfoState {
  return { ...row, ...(states.get(Number(row.id)) ?? EMPTY_INFO_STATE) };
}

function toExpenseApproval(row: any) {
  const amount = Number(row.amount ?? 0);
  const receiptStatus = row.receipt_status ?? (row.receipt_key ? 'uploaded' : 'not_uploaded');
  return {
    id: Number(row.id),
    approval_source: 'expenses',
    type: 'expense',
    requested_by: Number(row.created_by ?? 0),
    status: String(row.approval_status ?? row.status ?? 'pending'),
    created_at: row.created_at || row.date,
    reviewed_at: row.approved_at ?? null,
    execution_status: 'not_required',
    request_data: {
      amount,
      reason: row.description || row.category || 'Expense approval',
      attachmentUrl: row.receipt_url ?? null,
      receiptStatus,
    },
  };
}

async function loadExpenseApprovalRows(
  db: D1Database,
  tenantId: string,
  status: string = 'pending',
  reviewedDate?: string,
) {
  const statusFilter = status === 'all' ? "IN ('pending', 'approved', 'rejected')" : '= ?';
  const params: unknown[] = status === 'all' ? [tenantId] : [tenantId, status];
  const reviewedDateCondition = reviewedDate
    ? " AND COALESCE(e.approval_status, e.status) IN ('approved', 'rejected') AND substr(e.approved_at, 1, 10) = ?"
    : '';
  if (reviewedDate) params.push(reviewedDate);
  const { results } = await d1WithRetry(
    () => db.prepare(`
      SELECT
        e.*,
        COALESCE(e.receipt_status, CASE WHEN e.receipt_key IS NULL THEN 'not_uploaded' ELSE 'uploaded' END) AS receipt_status
      FROM expenses e
      WHERE e.tenant_id = ?
        AND COALESCE(e.approval_status, e.status) ${statusFilter}
        ${reviewedDateCondition}
      ORDER BY COALESCE(e.approved_at, e.created_at, e.date) DESC, e.id DESC
      ${reviewedDate ? '' : 'LIMIT 500'}
    `).bind(...params).all(),
    { label: `approval operational summary expenses ${status}` },
  );
  return (results ?? []).map(toExpenseApproval);
}

function finalHandoverVariance(row: any): number {
  const expectedAmount = Math.max(0, Number(row.handover_amount || 0) - Number(row.due_amount || 0));
  if (row.receiver_counted_amount !== null && row.receiver_counted_amount !== undefined) {
    return roundMoney(Number(row.receiver_counted_amount) - expectedAmount);
  }
  return roundMoney(Number(row.receiver_variance ?? 0));
}

function hasFinalHandoverReceiverEvidence(row: any): boolean {
  return row.received_by !== null
    && row.received_by !== undefined
    && row.receiver_counted_amount !== null
    && row.receiver_counted_amount !== undefined;
}

function finalHandoverMatchesStatus(row: any, status: FinalHandoverApprovalStatusFilter): boolean {
  const handoverStatus = String(row.status ?? '');
  const adminStatus = row.admin_verification_status == null ? null : String(row.admin_verification_status);
  const variance = finalHandoverVariance(row);
  const hasReceiverEvidence = hasFinalHandoverReceiverEvidence(row);
  const pending = ['receiver_verified', 'disputed'].includes(handoverStatus)
    && (adminStatus ?? 'pending_admin') === 'pending_admin'
    && (handoverStatus === 'disputed' || variance !== 0 || !hasReceiverEvidence);
  const approved = handoverStatus === 'received'
    && (adminStatus === 'verified' || (adminStatus === null && variance === 0 && hasReceiverEvidence));
  const rejected = adminStatus === 'rejected';
  if (status === 'pending') return pending;
  if (status === 'approved') return approved;
  if (status === 'rejected') return rejected;
  return pending || approved || rejected;
}

async function loadFinalHandoverRows(
  db: D1Database,
  tenantId: string,
  status: FinalHandoverApprovalStatusFilter = 'pending',
  reviewedDate?: string,
) {
  const conditions = [`h.tenant_id = ?`, `h.handover_type = 'counter'`];
  const params: unknown[] = [tenantId];
  const discrepancyExpression = `ROUND(CASE WHEN h.receiver_counted_amount IS NOT NULL THEN h.receiver_counted_amount - (h.handover_amount - COALESCE(h.due_amount, 0)) ELSE COALESCE(h.receiver_variance, 0) END, 2)`;
  const missingReceiverEvidenceExpression = `(h.received_by IS NULL OR h.receiver_counted_amount IS NULL)`;
  const pendingCondition = `(h.status IN ('receiver_verified', 'disputed') AND COALESCE(h.admin_verification_status, 'pending_admin') = 'pending_admin' AND (h.status = 'disputed' OR ${discrepancyExpression} != 0 OR ${missingReceiverEvidenceExpression}))`;
  const approvedCondition = `(h.status = 'received' AND (h.admin_verification_status = 'verified' OR (h.admin_verification_status IS NULL AND ${discrepancyExpression} = 0 AND NOT ${missingReceiverEvidenceExpression})))`;
  const rejectedCondition = `(h.admin_verification_status = 'rejected')`;
  if (status === 'pending') conditions.push(pendingCondition);
  else if (status === 'approved') conditions.push(approvedCondition);
  else if (status === 'rejected') conditions.push(rejectedCondition);
  else conditions.push(`(${pendingCondition} OR ${approvedCondition} OR ${rejectedCondition})`);
  if (reviewedDate) {
    conditions.push("h.admin_verification_status IN ('verified', 'rejected')");
    conditions.push('substr(h.admin_verified_at, 1, 10) = ?');
    params.push(reviewedDate);
  }
  const { results } = await d1WithRetry(
    () => db.prepare(`
      SELECT
        h.id,
        h.tenant_id,
        h.handover_type,
        h.handover_amount,
        h.due_amount,
        h.handover_by,
        h.handover_to,
        h.received_by,
        h.received_at,
        h.receiver_counted_amount,
        h.receiver_variance,
        h.admin_verification_status,
        h.admin_verified_by,
        h.admin_verified_at,
        h.created_at
      FROM billing_handovers h
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(h.admin_verified_at, h.created_at) DESC, h.id DESC
    `).bind(...params).all(),
    { label: 'approval operational summary handovers' },
  );
  return ((results ?? []) as any[]).filter((row) => finalHandoverMatchesStatus(row, status));
}

function toFinalHandoverApproval(row: any) {
  const expectedAmount = roundMoney(
    Math.max(0, Number(row.handover_amount || 0) - Number(row.due_amount || 0)),
  );
  const countedAmount = roundMoney(Number(row.receiver_counted_amount ?? expectedAmount));
  const variance = row.receiver_counted_amount !== null && row.receiver_counted_amount !== undefined
    ? roundMoney(countedAmount - expectedAmount)
    : roundMoney(Number(row.receiver_variance ?? 0));
  const adminStatus = row.admin_verification_status == null ? null : String(row.admin_verification_status);
  const autoCompleted = String(row.status ?? '') === 'received' && adminStatus === null && variance === 0;
  const status = adminStatus === 'verified' || autoCompleted
    ? 'approved'
    : adminStatus === 'rejected'
      ? 'rejected'
      : 'pending';
  return {
    id: Number(row.id),
    approval_source: 'billing_handovers',
    type: 'cash_handover',
    status,
    created_at: row.created_at ?? null,
    reviewed_at: status === 'pending'
      ? null
      : autoCompleted
        ? row.received_at ?? row.created_at ?? null
        : row.admin_verified_at ?? null,
    request_data: {
      amount: countedAmount,
      expectedAmount,
      countedAmount,
      variance,
      receivedBy: row.received_by ?? null,
      receivedAt: row.received_at ?? null,
      approvalRequired: !autoCompleted,
    },
  };
}

export async function loadApprovalOperationalSummary(
  db: D1Database,
  tenantId: string,
): Promise<ApprovalOperationalSummary> {
  const [{ results: pendingRows }, { results: failedExecutionRows }] = await Promise.all([
    d1WithRetry(
      () => db.prepare(`
        SELECT *
        FROM approval_requests
        WHERE tenant_id = ? AND status = ?
        ORDER BY created_at DESC, id DESC
      `).bind(tenantId, 'pending').all(),
      { label: 'approval operational summary pending approvals' },
    ),
    d1WithRetry(
      () => db.prepare(`
        SELECT id
        FROM approval_requests
        WHERE tenant_id = ?
          AND execution_status = ?
      `).bind(tenantId, 'failed').all<{ id: number }>(),
      { label: 'approval operational summary failed executions' },
    ),
  ]);

  const handoverApprovals = (await loadFinalHandoverRows(db, tenantId, 'pending'))
    .map(toFinalHandoverApproval);
  const expenseApprovals = await loadExpenseApprovalRows(db, tenantId, 'pending');
  const infoStates = await loadApprovalInfoStates(
    db,
    tenantId,
    (pendingRows ?? []).map((row: any) => row.id),
  );
  const pending = [
    ...(pendingRows ?? []).map((row: any) => appendInfoState(normalizeSummaryApprovalRow(row), infoStates)),
    ...handoverApprovals.map((row) => normalizeSummaryApprovalRow(row)),
    ...expenseApprovals.map((row) => normalizeSummaryApprovalRow(row)),
  ];
  const today = getTodayGMT6();

  const { results: reviewedRows } = await d1WithRetry(
    () => db.prepare(`
      SELECT status, reviewed_at, execution_status
      FROM approval_requests
      WHERE tenant_id = ?
        AND status IN ('approved', 'rejected')
        AND substr(reviewed_at, 1, 10) = ?
    `).bind(tenantId, today).all(),
    { label: 'approval operational summary reviewed approvals today' },
  );
  const reviewedHandoverApprovals = (await loadFinalHandoverRows(db, tenantId, 'all', today))
    .map(toFinalHandoverApproval)
    .filter((row) => row.status === 'approved' || row.status === 'rejected');
  const reviewedExpenseApprovals = (await loadExpenseApprovalRows(db, tenantId, 'all', today))
    .filter((row) => row.status === 'approved' || row.status === 'rejected');
  const todayReviewed = [
    ...(reviewedRows ?? []),
    ...reviewedHandoverApprovals,
    ...reviewedExpenseApprovals,
  ].filter((row: any) => isActualApprovalDecision(row) && localDate(row.reviewed_at) === today);

  const pendingAges = pending.map(approvalAgeMinutes);
  const oldestPendingMinutes = pendingAges.length > 0 ? Math.max(...pendingAges) : 0;
  const averageAgeMinutes = pendingAges.length > 0
    ? Math.round(pendingAges.reduce((sum, age) => sum + age, 0) / pendingAges.length)
    : 0;
  const oldestPendingRow = pending.reduce((oldest: any | null, row: any) => {
    if (!oldest) return row;
    return approvalAgeMinutes(row) > approvalAgeMinutes(oldest) ? row : oldest;
  }, null);
  const pendingByType = pending.reduce((acc: Record<string, number>, row: any) => {
    const key = canonicalApprovalRequestType(row) || 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    totalPending: pending.length,
    highPriority: pending.filter(isHighRiskApproval).length,
    olderThan24h: pending.filter(isApprovalSlaBreached).length,
    dueSoon: pending.filter(isApprovalDueSoon).length,
    todayApproved: todayReviewed.filter((row: any) => row.status === 'approved').length,
    rejectedToday: todayReviewed.filter((row: any) => row.status === 'rejected').length,
    cashHandoverPending: pending.filter((row: any) => canonicalApprovalRequestType(row) === 'cash_handover').length,
    expensePending: expenseApprovals.length,
    missingEvidence: pending.filter((row: any) => row.evidence_status === 'missing').length,
    executionFailed: failedExecutionRows.length,
    infoRequested: pending.filter((row: any) => row.info_request_status === 'requested').length,
    infoSubmitted: pending.filter((row: any) => row.info_request_status === 'submitted').length,
    blocked: pending.filter(isApprovalDecisionBlocked).length,
    actionable: pending.filter(isApprovalActionable).length,
    totalPendingAmount: roundMoney(
      pending.reduce((sum: number, row: any) => sum + Math.abs(approvalAmount(row)), 0),
    ),
    averageAgeMinutes,
    oldestPendingMinutes,
    oldestPendingAt: oldestPendingRow?.created_at ?? null,
    pendingByType,
  };
}
