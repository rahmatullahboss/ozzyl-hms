import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router';
import { Check, X, Eye, ListChecks, AlertTriangle, Clock, CheckCircle2, X as ClearIcon, Search, History, ShieldCheck, Banknote } from 'lucide-react';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatCurrency, formatDateTime } from '../../lib/format';
import DashboardLayout from '../../components/DashboardLayout';
import ActionCenterShell from '../../components/action-center/ActionCenterShell';
import KPICard from '../../components/dashboard/KPICard';
import ApprovalDetailDrawer, {
  type ApprovalRejectPayload,
  type ApprovalReturnPayload,
} from '../../components/admin/ApprovalDetailDrawer';
import ApprovalCockpit from '../../components/admin/ApprovalCockpit';
import BulkActionsBar, { BulkCheckbox, type BulkAction } from '../../components/admin/BulkActionsBar';

interface ApprovalTimelineItem {
  label: string;
  at?: string;
  by?: string;
  tone?: 'neutral' | 'success' | 'danger' | 'warning';
}

interface ApprovalRefundCashHold {
  id: number;
  amount: number;
  status: string;
  counterSessionId: number;
  cashReturnEligible?: boolean;
  heldAt?: string | null;
  consumedAt?: string | null;
  releasedAt?: string | null;
  creditNoteId?: number | null;
}

interface Approval {
  id: string;
  approvalKey?: string;
  numericId: number;
  entityId?: number;
  source?: string;
  type: string;
  requestedBy: string;
  department: string;
  amount: number;
  amountLabel?: string;
  reason: string;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  risk: string;
  status: string;
  invoiceId?: string;
  patientName?: string;
  originalAmount?: number;
  discountPercent?: number;
  reference?: string;
  referenceLabel?: string;
  context?: string;
  attachmentUrl?: string;
  expectedAmount?: number;
  countedAmount?: number;
  variance?: number;
  cashierName?: string;
  receiverName?: string;
  requestData?: Record<string, unknown>;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  timeline?: ApprovalTimelineItem[];
  isActionable?: boolean;
  bulkApproveAllowed?: boolean;
  approvalNoteRequired?: boolean;
  executionStatus?: string;
  executionAttempts?: number;
  executionError?: string | null;
  policyReason?: string;
  evidenceRequired?: boolean;
  evidenceStatus?: 'not_required' | 'provided' | 'missing' | string;
  slaDueAt?: string | null;
  slaMinutes?: number;
  assignedRole?: string;
  previousRequests?: { approved: number; rejected: number; totalAmount: number };
  infoRequestStatus?: string;
  infoRequestedAt?: string | null;
  infoRequestedBy?: number | null;
  infoRequestNote?: string | null;
  infoMissingItems?: string[];
  infoSubmittedAt?: string | null;
  infoSubmittedBy?: number | null;
  infoResponseNote?: string | null;
  cashHold?: ApprovalRefundCashHold | null;
  approvalRevision?: number;
  approvalCount?: number;
  requiredApprovals?: number;
  remainingApprovals?: number;
  approvalStage?: string;
  currentUserApproved?: boolean;
  canCurrentUserApprove?: boolean;
  approvalBlockedReason?: string | null;
}

interface ApprovalSummary {
  totalPending: number;
  highPriority: number;
  olderThan24h: number;
  todayApproved: number;
  cashHandoverPending?: number;
  expensePending?: number;
  missingEvidence?: number;
  executionFailed?: number;
  infoRequested?: number;
  infoSubmitted?: number;
  rejectedToday?: number;
  dueSoon?: number;
  blocked?: number;
  actionable?: number;
  totalPendingAmount?: number;
  averageAgeMinutes?: number;
  oldestPendingMinutes?: number;
  oldestPendingAt?: string | null;
  pendingByType?: Record<string, number>;
}

interface ApprovalsData {
  approvals?: Approval[];
  summary?: ApprovalSummary;
  data?: ApprovalApiItem[];
  pagination?: { total: number; page?: number; limit?: number; totalPages?: number };
}

interface ApprovalSummaryResponse {
  data?: ApprovalSummary;
  summary?: ApprovalSummary;
}

interface ApprovalEventApiItem {
  id: number;
  action: string;
  actor_id?: number | string | null;
  actor_name?: string | null;
  old_status?: string | null;
  new_status?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
}

interface ApprovalEventsResponse {
  data?: ApprovalEventApiItem[];
}

type KpiFilter = 'high' | 'stale' | 'due_soon' | 'blocked' | 'missing_evidence' | 'execution_failed' | 'info_requested' | 'reviewed_today' | null;
type StatusView = 'pending' | 'approved' | 'rejected' | 'all';

interface ApprovalApiItem {
  id: number;
  approval_key?: string | null;
  approval_source?: string | null;
  type: string;
  entity_id: number;
  entity_no?: string | null;
  requested_by: number;
  requested_by_name?: string | null;
  reviewed_by?: number | string | null;
  reviewed_by_name?: string | null;
  request_data?: Record<string, unknown>;
  status: string;
  created_at: string;
  reviewed_at?: string | null;
  updated_at?: string | null;
  approval_amount?: number;
  approval_risk?: 'low' | 'medium' | 'high';
  bulk_approve_allowed?: boolean;
  approval_note_required?: boolean;
  evidence_required?: boolean;
  evidence_status?: 'not_required' | 'provided' | 'missing' | string | null;
  policy_reason?: string | null;
  sla_minutes?: number | null;
  sla_due_at?: string | null;
  assigned_role?: string | null;
  execution_status?: string | null;
  execution_attempts?: number | null;
  execution_error?: string | null;
  approval_revision?: number | null;
  approval_count?: number | null;
  required_approvals?: number | null;
  remaining_approvals?: number | null;
  approval_stage?: string | null;
  current_user_approved?: boolean | null;
  can_current_user_approve?: boolean | null;
  approval_blocked_reason?: string | null;
  info_request_status?: string | null;
  info_requested_at?: string | null;
  info_requested_by?: number | null;
  info_request_note?: string | null;
  info_missing_items?: string[] | null;
  info_submitted_at?: string | null;
  info_submitted_by?: number | null;
  info_response_note?: string | null;
  cash_hold?: {
    id: number;
    amount: number;
    status: string;
    counter_session_id: number;
    cash_return_eligible?: boolean;
    held_at?: string | null;
    consumed_at?: string | null;
    released_at?: string | null;
    credit_note_id?: number | null;
  } | null;
}

interface ReviewSideEffect {
  kind: 'cancelled' | 'converted_to_credit_note';
  creditNoteId?: number;
  creditNoteNo?: string;
  totalRefund?: number;
}

interface ReviewVariables {
  id: string;
  type?: string;
  source?: string;
  action: 'approve' | 'reject';
  notes: string;
  decision?: 'approve' | 'reject';
  remarks?: string;
  cashResolution?: 'open_dispute' | 'cash_returned';
  cashReturnedAcknowledged?: boolean;
  idempotencyKey?: string;
}

interface BulkReviewVariables {
  ids: number[];
  action: 'approve' | 'reject';
  notes?: string;
}

interface RequestInfoVariables {
  id: string;
  type?: string;
  notes: string;
  missingItems?: string[];
}

const TYPE_TABS = ['All', 'Discount', 'Refund', 'Expense', 'Bill Cancel', 'Payment Void', 'Credit Discharge', 'Cash Handover', 'Stock Adjustment', 'Doctor Payout', 'Credit Note', 'Manual Adj'] as const;
type TypeTab = (typeof TYPE_TABS)[number];

const TYPE_TAB_LABELS: Record<TypeTab, string> = {
  All: 'All',
  Discount: 'Discount',
  Refund: 'Refund',
  Expense: 'Expense',
  'Bill Cancel': 'Bill Cancel',
  'Payment Void': 'Payment Void',
  'Credit Discharge': 'Credit Discharge',
  'Cash Handover': 'Cash Handover',
  'Stock Adjustment': 'Stock Adjustment',
  'Doctor Payout': 'Doctor Payout',
  'Credit Note': 'Credit Note',
  'Manual Adj': 'Manual Adjustment',
};

const TYPE_TAB_KEYS: Record<TypeTab, string> = {
  All: 'all',
  Discount: 'discount',
  Refund: 'refund',
  Expense: 'expense',
  'Bill Cancel': 'billCancel',
  'Payment Void': 'paymentVoid',
  'Credit Discharge': 'creditDischarge',
  'Cash Handover': 'cashHandover',
  'Stock Adjustment': 'stockAdjustment',
  'Doctor Payout': 'doctorPayout',
  'Credit Note': 'creditNote',
  'Manual Adj': 'manualAdjustment',
};

const TYPE_MAP: Record<Exclude<TypeTab, 'All'>, string> = {
  Discount: 'discount',
  Refund: 'refund',
  Expense: 'expense',
  'Bill Cancel': 'bill_cancellation',
  'Payment Void': 'payment_void',
  'Credit Discharge': 'credit_discharge',
  'Cash Handover': 'cash_handover',
  'Stock Adjustment': 'stock_adjustment',
  'Doctor Payout': 'doctor_payout',
  'Credit Note': 'credit_note',
  'Manual Adj': 'manual_adjustment',
};

const STATUS_TABS: Array<{ id: StatusView; label: string; icon: typeof ListChecks }> = [
  { id: 'pending', label: 'Pending', icon: ListChecks },
  { id: 'approved', label: 'Approved', icon: CheckCircle2 },
  { id: 'rejected', label: 'Rejected', icon: X },
  { id: 'all', label: 'All History', icon: History },
];

const RISK_BADGE: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  high: 'bg-red-50 text-red-700 ring-1 ring-red-100',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  partially_approved: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
  approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  rejected: 'bg-red-50 text-red-700 ring-1 ring-red-100',
};

function isOpenApproval(approval: Pick<Approval, 'status'>): boolean {
  return approval.status === 'pending' || approval.status === 'partially_approved';
}

function approvalStatusLabel(approval: Pick<Approval, 'status' | 'approvalStage'>): string {
  return approval.approvalStage ?? (approval.status === 'approved'
    ? 'Fully Approved (2/2)'
    : approval.status === 'partially_approved'
      ? 'Partially Approved (1/2)'
      : approval.status === 'pending'
        ? 'Pending (0/2)'
        : humanizeKey(approval.status));
}

const TYPE_BADGE: Record<string, string> = {
  discount: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
  refund: 'bg-purple-50 text-purple-700 ring-1 ring-purple-100',
  expense: 'bg-orange-50 text-orange-700 ring-1 ring-orange-100',
  bill_cancellation: 'bg-red-50 text-red-700 ring-1 ring-red-100',
  payment_void: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  credit_discharge: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100',
  cash_handover: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  stock_adjustment: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
  doctor_payout: 'bg-teal-50 text-teal-700 ring-1 ring-teal-100',
  credit_note: 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100',
  manual_adjustment: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100',
};

function humanizeKey(value: string): string {
  return value.replace(/_/g, ' ');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeApprovalType(type: string): string {
  if (type === 'bill_cancel') return 'bill_cancellation';
  if (type === 'cash_closing' || type === 'cash_transfer_handover' || type === 'shift_handover') return 'cash_handover';
  return type;
}

function formatAmountWithCurrency(amount: number, currencyCode: unknown): string {
  const currency = typeof currencyCode === 'string' && /^[A-Z]{3}$/.test(currencyCode)
    ? currencyCode
    : 'BDT';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function getApprovalAmount(type: string, requestData: Record<string, unknown>): number {
  if (type === 'credit_discharge') {
    const totalDueMinor = firstFiniteNumber(requestData.totalDueMinor);
    if (totalDueMinor != null) return totalDueMinor / 100;
  }
  if (type === 'receivable_write_off') {
    const amountMinor = firstFiniteNumber(requestData.amountMinor);
    if (amountMinor != null) return amountMinor / 100;
  }
  const oldValue = asRecord(requestData.oldValue);
  const newValue = asRecord(requestData.newValue);
  return firstFiniteNumber(
    requestData.amount,
    requestData.totalAmount,
    requestData.total_amount,
    requestData.refundAmount,
    requestData.refund_amount,
    requestData.requestedRefundAmount,
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

function getApprovalReference(item: ApprovalApiItem, requestData: Record<string, unknown>): string {
  return firstText(
    item.entity_no,
    requestData.referenceNo,
    requestData.invoiceNo,
    requestData.invoice_no,
    requestData.receiptNo,
    requestData.receipt_no,
    requestData.billNo,
    requestData.bill_no,
    requestData.handoverNo,
    requestData.handover_no,
    requestData.cashHandoverNo,
    requestData.cash_handover_no,
    requestData.documentNo,
  ) ?? `Approval #${item.id}`;
}

function getApprovalContext(type: string, requestData: Record<string, unknown>): string {
  if (type === 'receivable_write_off') {
    const sourceEvidence = asRecord(requestData.sourceEvidence);
    const invoiceNumber = firstText(sourceEvidence.invoiceNumber, requestData.invoiceNumber);
    const liveDueMinor = firstFiniteNumber(requestData.liveDueMinorAtRequest, sourceEvidence.dueMinor);
    const currencyCode = firstText(requestData.currencyCode) ?? 'BDT';
    const authorityMode = firstText(requestData.authorityModeAtRequest);
    return [
      invoiceNumber ? `Invoice ${invoiceNumber}` : undefined,
      liveDueMinor != null ? `Live due ${formatAmountWithCurrency(liveDueMinor / 100, currencyCode)}` : undefined,
      authorityMode ? `${humanizeKey(authorityMode)} authority` : undefined,
    ].filter(Boolean).join(' • ') || 'Controlled receivable write-off';
  }
  if (type === 'cash_handover') {
    return firstText(
      requestData.context,
      requestData.cashierName && requestData.receiverName ? `${requestData.cashierName} → ${requestData.receiverName}` : undefined,
      requestData.cashierName,
      'Cash close / handover',
    ) ?? 'Cash close / handover';
  }
  return firstText(
    requestData.context,
    requestData.patientName,
    requestData.doctorName,
    requestData.serviceName,
    requestData.itemName,
    requestData.sourceModule,
    requestData.module,
  ) ?? '-';
}

function getAmountLabel(type: string, amount: number, requestData: Record<string, unknown>): string {
  if (type === 'receivable_write_off') {
    return formatAmountWithCurrency(amount, requestData.currencyCode);
  }
  if (type !== 'cash_handover') return formatCurrency(amount);
  const expected = firstFiniteNumber(requestData.expectedAmount, requestData.expected_amount, requestData.oldValue && asRecord(requestData.oldValue).expectedAmount);
  const counted = firstFiniteNumber(requestData.countedAmount, requestData.counted_amount, requestData.actualAmount, requestData.actual_amount);
  const variance = firstFiniteNumber(requestData.variance, requestData.cashVariance, counted != null && expected != null ? counted - expected : undefined);
  const parts = [];
  if (expected != null) parts.push(`Expected ${formatCurrency(expected)}`);
  if (counted != null) parts.push(`Counted ${formatCurrency(counted)}`);
  if (variance != null) parts.push(`Variance ${formatCurrency(variance)}`);
  return parts.length ? parts.join(' • ') : formatCurrency(amount);
}

const QUICK_APPROVAL_BLOCKED_TYPES = new Set(['cash_handover', 'bill_cancellation', 'payment_void', 'credit_discharge', 'receivable_write_off', 'refund', 'expense', 'stock_adjustment', 'doctor_payout', 'credit_note', 'manual_adjustment']);

function isQuickApprovalEligible(approval: Approval): boolean {
  return isOpenApproval(approval)
    && approval.isActionable !== false
    && approval.canCurrentUserApprove !== false
    && !approval.approvalNoteRequired
    && approval.risk !== 'high'
    && approval.executionStatus !== 'failed'
    && approval.infoRequestStatus !== 'requested'
    && !QUICK_APPROVAL_BLOCKED_TYPES.has(approval.type);
}

function approvalSlaDueTime(approval: Approval): number {
  if (approval.slaDueAt) {
    const due = new Date(approval.slaDueAt).getTime();
    if (Number.isFinite(due)) return due;
  }
  const submitted = new Date(approval.submittedAt).getTime();
  return Number.isFinite(submitted) ? submitted + 24 * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
}

function isSlaBreached(approval: Approval): boolean {
  return isOpenApproval(approval) && approvalSlaDueTime(approval) < Date.now();
}

function isDueSoon(approval: Approval): boolean {
  const due = approvalSlaDueTime(approval);
  return isOpenApproval(approval) && due >= Date.now() && due - Date.now() <= 2 * 60 * 60 * 1000;
}

function relativeSlaLabel(approval: Approval): string {
  const due = approvalSlaDueTime(approval);
  if (!Number.isFinite(due)) return 'No SLA';
  const diff = due - Date.now();
  const minutes = Math.max(1, Math.round(Math.abs(diff) / 60000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const label = hours > 0 ? String(hours) + 'h ' + String(remainder) + 'm' : String(minutes) + 'm';
  return diff < 0 ? 'Overdue ' + label : 'Due in ' + label;
}

function formatDurationMinutes(minutes?: number): string {
  if (!minutes || minutes <= 0) return '0m';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.round(minutes % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function isDecisionBlocked(approval: Approval): boolean {
  return approval.executionStatus === 'failed'
    || approval.infoRequestStatus === 'requested'
    || approval.canCurrentUserApprove === false;
}

function activeFilterLabel(filter: KpiFilter): string {
  if (filter === 'high') return 'high-priority requests';
  if (filter === 'stale') return 'SLA-breached requests';
  if (filter === 'due_soon') return 'requests due within 2 hours';
  if (filter === 'blocked') return 'decision-blocked requests';
  if (filter === 'missing_evidence') return 'requests with missing evidence';
  if (filter === 'execution_failed') return 'failed execution requests';
  if (filter === 'info_requested') return 'requests waiting for information';
  return 'all requests';
}

function getApprovalTypeLabel(type: string): string {
  const match = TYPE_TABS.find((tab) => tab !== 'All' && TYPE_MAP[tab as Exclude<TypeTab, 'All'>] === type) as TypeTab | undefined;
  return match ? TYPE_TAB_LABELS[match] : humanizeKey(type);
}

function percentOf(value: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function quickApprovalBlockReason(approval: Approval): string | null {
  if (approval.approvalBlockedReason) return approval.approvalBlockedReason;
  if (approval.infoRequestStatus === 'requested') return 'Needs info';
  if (approval.executionStatus === 'failed') return 'Execution failed';
  if (approval.risk === 'high') return 'High risk';
  if (approval.approvalNoteRequired) return 'Note required';
  if (QUICK_APPROVAL_BLOCKED_TYPES.has(approval.type)) return 'Individual review';
  return null;
}

function approvalUrgencyScore(approval: Approval): number {
  if (approval.executionStatus === 'failed') return 1000;
  if (approval.infoRequestStatus === 'requested') return 950;
  if (isSlaBreached(approval)) return 900;
  if (approval.evidenceStatus === 'missing') return 800;
  if (approval.risk === 'high') return 700;
  if (isDueSoon(approval)) return 600;
  if (approval.type === 'cash_handover') return 500;
  if (approval.risk === 'medium') return 300;
  return 100;
}

function compareApprovalUrgency(a: Approval, b: Approval): number {
  const scoreDiff = approvalUrgencyScore(b) - approvalUrgencyScore(a);
  if (scoreDiff !== 0) return scoreDiff;
  return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
}

function isSyntheticCashHandover(approval?: Approval | null): boolean {
  return approval?.type === 'cash_handover' && approval.source === 'billing_handovers';
}

function getReviewTargetId(approval: Approval, fallbackId: string): string {
  if (isSyntheticCashHandover(approval)) return approval.entityId != null ? String(approval.entityId) : fallbackId;
  if (Number.isInteger(approval.numericId) && approval.numericId > 0) return String(approval.numericId);
  const referenceId = approval.reference?.match(/^Approval #(\d+)$/)?.[1];
  return referenceId ?? fallbackId;
}

function getApprovalEventId(approval?: Approval | null): number | string | undefined {
  if (!approval) return undefined;
  if (Number.isInteger(approval.numericId) && approval.numericId > 0) return approval.numericId;
  return approval.reference?.match(/^Approval #(\d+)$/)?.[1];
}

function buildTimeline(item: ApprovalApiItem, status: string, requestData: Record<string, unknown>): ApprovalTimelineItem[] {
  const timeline: ApprovalTimelineItem[] = [
    { label: 'Requested', at: item.created_at, by: firstText(requestData.requestedBy, requestData.requesterName, item.requested_by_name, `User #${item.requested_by}`), tone: 'neutral' },
  ];
  if (status !== 'pending') {
    timeline.push({
      label: status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : humanizeKey(status),
      at: item.reviewed_at ?? item.updated_at ?? undefined,
      by: firstText(requestData.reviewedBy, item.reviewed_by_name, item.reviewed_by, item.reviewed_by != null ? `User #${item.reviewed_by}` : undefined),
      tone: status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : 'neutral',
    });
  }
  return timeline;
}

function eventToTimelineItem(event: ApprovalEventApiItem): ApprovalTimelineItem {
  const nextStatus = String(event.new_status ?? '').toLowerCase();
  const action = event.action === 'created' ? 'Requested' : humanizeKey(event.action);
  const metadata = asRecord(event.metadata);
  const expectedAmount = firstFiniteNumber(metadata.expectedAmount, metadata.expected_amount);
  const countedAmount = firstFiniteNumber(metadata.countedAmount, metadata.counted_amount);
  const variance = firstFiniteNumber(metadata.variance);
  const cashDetail = expectedAmount != null || countedAmount != null || variance != null
    ? [
        expectedAmount != null ? `Expected ${formatCurrency(expectedAmount)}` : null,
        countedAmount != null ? `Counted ${formatCurrency(countedAmount)}` : null,
        variance != null ? `Variance ${formatCurrency(variance)}` : null,
      ].filter(Boolean).join(' • ')
    : null;
  const details = [event.notes, cashDetail].filter(Boolean).join(' • ');
  const actorName = firstText(event.actor_name, event.actor_id != null ? `User #${event.actor_id}` : undefined);
  const actorRole = firstText(metadata.actorRole, metadata.actor_role);
  return {
    label: details ? `${action}: ${details}` : action,
    at: event.created_at ?? undefined,
    by: [actorName, actorRole].filter(Boolean).join(' • ') || undefined,
    tone: nextStatus === 'approved' || nextStatus === 'completed'
      ? 'success'
      : nextStatus === 'rejected'
        ? 'danger'
        : nextStatus === 'pending'
          ? 'warning'
          : 'neutral',
  };
}

function isApprovalSummary(value: unknown): value is ApprovalSummary {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as ApprovalSummary).totalPending === 'number';
}

function buildApprovalSummary(approvals: Approval[], totalFallback: number): ApprovalSummary {
  return {
    totalPending: totalFallback,
    highPriority: approvals.filter((item) => isOpenApproval(item) && item.risk === 'high').length,
    olderThan24h: approvals.filter((item) => isOpenApproval(item) && isSlaBreached(item)).length,
    dueSoon: approvals.filter((item) => isOpenApproval(item) && isDueSoon(item)).length,
    todayApproved: approvals.filter((item) => item.status === 'approved').length,
    cashHandoverPending: approvals.filter((item) => item.type === 'cash_handover' && isOpenApproval(item)).length,
    missingEvidence: approvals.filter((item) => isOpenApproval(item) && item.evidenceStatus === 'missing').length,
    executionFailed: approvals.filter((item) => isOpenApproval(item) && item.executionStatus === 'failed').length,
    infoRequested: approvals.filter((item) => item.infoRequestStatus === 'requested').length,
    infoSubmitted: approvals.filter((item) => item.infoRequestStatus === 'submitted').length,
    rejectedToday: approvals.filter((item) => item.status === 'rejected').length,
    blocked: approvals.filter((item) => isOpenApproval(item) && isDecisionBlocked(item)).length,
    actionable: approvals.filter((item) => isOpenApproval(item) && !isDecisionBlocked(item)).length,
    totalPendingAmount: approvals.filter((item) => isOpenApproval(item)).reduce((sum, item) => sum + Math.abs(item.amount), 0),
  };
}

function ApprovalMobileCardList({ approvals, onOpen }: { approvals: Approval[]; onOpen: (approval: Approval) => void }) {
  return (
    <div className="space-y-3 md:hidden">
      {approvals.map((approval) => (
        <button key={approval.approvalKey ?? approval.id} type="button" onClick={() => onOpen(approval)} className="w-full rounded-2xl border border-[var(--color-border)] bg-white p-4 text-left shadow-sm dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${TYPE_BADGE[approval.type] ?? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}`}>{humanizeKey(approval.type)}</span>
              <p className="mt-2 truncate text-base font-semibold text-[var(--color-text-primary)]">{approval.referenceLabel ?? approval.id} - {humanizeKey(approval.type)}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{approval.context || approval.reason}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-data text-sm font-bold text-[var(--color-text-primary)]">Amt {formatCurrency(approval.amount)}</p>
              <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${STATUS_BADGE[approval.status] ?? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}`}>{approvalStatusLabel(approval)}</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[var(--color-surface-muted)] p-3 text-xs">
            <div><span className="text-[var(--color-text-muted)]">By</span><p className="truncate font-medium text-[var(--color-text-primary)]">{approval.requestedBy}</p></div>
            <div><span className="text-[var(--color-text-muted)]">Submitted</span><p className="truncate font-medium text-[var(--color-text-primary)]">{formatDateTime(approval.submittedAt)}</p></div>
          </div>
        </button>
      ))}
    </div>
  );
}

type PendingApprovalsRole = 'hospital_admin' | 'md' | 'director';

export interface PendingApprovalsProps {
  embedded?: boolean;
  role?: PendingApprovalsRole;
}

export default function PendingApprovals({ embedded = false, role = 'hospital_admin' }: PendingApprovalsProps) {
  const { t } = useTranslation('adminPages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TypeTab | null;
  const isValidTab = (val: string | null): val is TypeTab => val !== null && TYPE_TABS.includes(val as TypeTab);
  const [activeTab, setActiveTabRaw] = useState<TypeTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'All';
    }
    return isValidTab(tabParam) ? tabParam : 'All';
  });
  const [statusView, setStatusView] = useState<StatusView>('pending');
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [lastPendingSummary, setLastPendingSummary] = useState<ApprovalSummary | null>(null);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const invalidateApprovalWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingApprovals() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.counts() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingApprovalsSummary() }),
      queryClient.invalidateQueries({ queryKey: ['billing'] }),
      queryClient.invalidateQueries({ queryKey: ['cashOperations'] }),
      queryClient.invalidateQueries({ queryKey: ['patients'] }),
      queryClient.invalidateQueries({ queryKey: ['action-center', 'exceptions'] }),
    ]);
  };


  const setActiveTab = (tab: TypeTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
    setSelectedIds(new Set());
    setPage(1);
  };

  const setStatus = (status: StatusView) => {
    setStatusView(status);
    setSelectedIds(new Set());
    setKpiFilter(null);
    setPage(1);
  };

  const selectedType = activeTab === 'All' ? undefined : TYPE_MAP[activeTab as keyof typeof TYPE_MAP];
  const listParams = new URLSearchParams({ status: statusView, limit: '50', page: String(page) });
  if (selectedType) listParams.set('type', selectedType);
  if (kpiFilter === 'execution_failed') listParams.set('executionStatus', 'failed');
  const serverQueueFilter = kpiFilter === 'high'
    ? 'high'
    : kpiFilter === 'stale'
      ? 'sla_breached'
      : kpiFilter === 'due_soon'
        ? 'due_soon'
        : kpiFilter === 'blocked'
          ? 'blocked'
          : kpiFilter === 'missing_evidence'
            ? 'missing_evidence'
            : kpiFilter === 'info_requested'
              ? 'info_requested'
              : undefined;
  if (serverQueueFilter) listParams.set('queueFilter', serverQueueFilter);
  if (kpiFilter === 'reviewed_today') listParams.set('reviewedDate', 'today');
  if (searchTerm.trim()) listParams.set('search', searchTerm.trim());
  const listUrl = `/api/approvals?${listParams.toString()}`;
  const queryKeySuffix = `${statusView}:${page}:${searchTerm.trim()}${kpiFilter ? `:${kpiFilter}` : ''}`;
  const listQueryKey = queryKeys.approvals.list(selectedType, queryKeySuffix);

  const { data, isLoading } = useApiQuery<ApprovalsData>(listQueryKey, listUrl);
  const { data: summaryData } = useApiQuery<ApprovalSummaryResponse>(queryKeys.admin.pendingApprovalsSummary(), '/api/approvals/summary');
  const selectedApprovalEventId = getApprovalEventId(selectedApproval);
  const selectedHandoverEventId = isSyntheticCashHandover(selectedApproval) ? selectedApproval?.entityId : undefined;
  const selectedApprovalEventUrl = selectedHandoverEventId
    ? `/api/approvals/handovers/${selectedHandoverEventId}/events`
    : selectedApproval?.source !== 'expenses' && selectedApprovalEventId
      ? `/api/approvals/${selectedApprovalEventId}/events`
      : '/api/approvals/0/events';
  const selectedApprovalHasEvents = Boolean(selectedHandoverEventId || (selectedApproval?.source !== 'expenses' && selectedApprovalEventId));
  const { data: eventData } = useApiQuery<ApprovalEventsResponse>(
    ['approvals', 'events', selectedApproval?.approvalKey ?? selectedApprovalEventId ?? selectedHandoverEventId],
    selectedApprovalEventUrl,
    { enabled: drawerOpen && selectedApprovalHasEvents },
  );

  const mappedApprovals: Approval[] = (data?.data ?? []).map((item) => {
    const requestData = asRecord(item.request_data);
    const oldValue = asRecord(requestData.oldValue);
    const newValue = asRecord(requestData.newValue);
    const type = normalizeApprovalType(item.type);
    const amount = firstFiniteNumber(item.approval_amount) ?? getApprovalAmount(type, requestData);
    const expectedAmount = firstFiniteNumber(requestData.expectedAmount, requestData.expected_amount);
    const countedAmount = firstFiniteNumber(requestData.countedAmount, requestData.counted_amount, requestData.actualAmount, requestData.actual_amount);
    const variance = firstFiniteNumber(requestData.variance, requestData.cashVariance, countedAmount != null && expectedAmount != null ? countedAmount - expectedAmount : undefined);
    const referenceLabel = getApprovalReference(item, requestData);
    const context = getApprovalContext(type, requestData);
    const executionStatus = item.execution_status ?? (type === 'bill_cancellation' || type === 'payment_void' || type === 'refund' || type === 'receivable_write_off' ? 'pending' : 'not_required');
    return {
      id: String(item.id),
      approvalKey: firstText(item.approval_key, item.approval_source ? `${item.approval_source}:${item.id}` : undefined),
      numericId: item.id,
      entityId: item.entity_id,
      source: firstText(item.approval_source, requestData.source),
      type,
      requestedBy: String(firstText(requestData.requestedBy, requestData.requesterName, requestData.cashierName, item.requested_by_name, `User #${item.requested_by}`)),
      department: String(firstText(
        requestData.department,
        requestData.sourceDepartment,
        type === 'cash_handover' ? 'Cash Control' : undefined,
        type === 'credit_discharge' ? 'IPD Billing' : undefined,
        type === 'receivable_write_off' ? 'Collections' : undefined,
        '-',
      )),
      amount,
      amountLabel: getAmountLabel(type, amount, requestData),
      reason: String(firstText(requestData.creditReason, requestData.reason, requestData.note, requestData.remarks, '-')),
      submittedAt: item.created_at,
      reviewedAt: item.reviewed_at ?? item.updated_at ?? undefined,
      reviewedBy: firstText(requestData.reviewedBy, item.reviewed_by_name, item.reviewed_by, item.reviewed_by != null ? `User #${item.reviewed_by}` : undefined),
      risk: item.approval_risk ?? (type === 'cash_handover' && variance && variance !== 0 ? 'high' : amount >= 10000 ? 'high' : amount >= 3000 ? 'medium' : 'low'),
      status: item.status,
      invoiceId: firstText(item.entity_no, requestData.invoiceNo, requestData.invoice_no, requestData.billNo, requestData.receiptNo),
      patientName: firstText(requestData.patientName),
      originalAmount: firstFiniteNumber(requestData.originalAmount, oldValue.totalAmount, oldValue.total_amount),
      discountPercent: firstFiniteNumber(requestData.discountPercent, requestData.discount_percent),
      reference: `Approval #${item.id}`,
      referenceLabel,
      context,
      attachmentUrl: firstText(requestData.attachmentUrl, requestData.receiptUrl, requestData.documentUrl),
      expectedAmount,
      countedAmount,
      variance,
      cashierName: firstText(requestData.cashierName, requestData.fromUserName),
      receiverName: firstText(requestData.receiverName, requestData.toUserName),
      requestData,
      oldValue,
      newValue,
      timeline: buildTimeline(item, item.status, requestData),
      isActionable: item.can_current_user_approve ?? ((item.status === 'pending' || item.status === 'partially_approved') && executionStatus !== 'processing'),
      bulkApproveAllowed: item.bulk_approve_allowed,
      approvalNoteRequired: item.approval_note_required,
      executionStatus,
      executionAttempts: Number(item.execution_attempts ?? 0),
      executionError: item.execution_error ?? null,
      policyReason: firstText(item.policy_reason, requestData.policyReason, requestData.policy_reason),
      evidenceRequired: Boolean(item.evidence_required ?? requestData.evidenceRequired ?? requestData.evidence_required ?? false),
      evidenceStatus: firstText(item.evidence_status, requestData.evidenceStatus, requestData.evidence_status) ?? 'not_required',
      slaDueAt: firstText(item.sla_due_at, requestData.slaDueAt, requestData.sla_due_at) ?? null,
      slaMinutes: firstFiniteNumber(item.sla_minutes, requestData.slaMinutes, requestData.sla_minutes),
      assignedRole: firstText(item.assigned_role, requestData.assignedRole, requestData.assigned_role),
      infoRequestStatus: firstText(item.info_request_status, requestData.infoRequestStatus, requestData.info_request_status) ?? 'not_requested',
      infoRequestedAt: firstText(item.info_requested_at, requestData.infoRequestedAt, requestData.info_requested_at) ?? null,
      infoRequestedBy: firstFiniteNumber(item.info_requested_by, requestData.infoRequestedBy, requestData.info_requested_by) ?? null,
      infoRequestNote: firstText(item.info_request_note, requestData.infoRequestNote, requestData.info_request_note) ?? null,
      infoMissingItems: Array.isArray(item.info_missing_items) ? item.info_missing_items.map(String) : [],
      infoSubmittedAt: firstText(item.info_submitted_at, requestData.infoSubmittedAt, requestData.info_submitted_at) ?? null,
      infoSubmittedBy: firstFiniteNumber(item.info_submitted_by, requestData.infoSubmittedBy, requestData.info_submitted_by) ?? null,
      infoResponseNote: firstText(item.info_response_note, requestData.infoResponseNote, requestData.info_response_note) ?? null,
      approvalRevision: Number(item.approval_revision ?? requestData.approvalRevision ?? 1),
      approvalCount: Number(item.approval_count ?? (item.status === 'approved' ? 2 : 0)),
      requiredApprovals: Number(item.required_approvals ?? 2),
      remainingApprovals: Number(item.remaining_approvals ?? (item.status === 'approved' ? 0 : 2)),
      approvalStage: firstText(item.approval_stage) ?? (item.status === 'approved' ? 'Fully Approved (2/2)' : item.status === 'partially_approved' ? 'Partially Approved (1/2)' : 'Pending (0/2)'),
      currentUserApproved: Boolean(item.current_user_approved),
      canCurrentUserApprove: item.can_current_user_approve ?? undefined,
      approvalBlockedReason: item.approval_blocked_reason ?? null,
      cashHold: item.cash_hold ? {
        id: Number(item.cash_hold.id),
        amount: Number(item.cash_hold.amount ?? 0),
        status: String(item.cash_hold.status ?? ''),
        counterSessionId: Number(item.cash_hold.counter_session_id ?? 0),
        cashReturnEligible: item.cash_hold.cash_return_eligible === true,
        heldAt: item.cash_hold.held_at ?? null,
        consumedAt: item.cash_hold.consumed_at ?? null,
        releasedAt: item.cash_hold.released_at ?? null,
        creditNoteId: item.cash_hold.credit_note_id == null ? null : Number(item.cash_hold.credit_note_id),
      } : null,
    };
  });

  const approvals = data?.approvals ?? mappedApprovals;
  const normalizedApprovals = approvals.map((approval) => ({
    ...approval,
    approvalKey: approval.approvalKey ?? `${approval.source ?? 'approval'}:${approval.id}`,
    type: normalizeApprovalType(approval.type),
    referenceLabel: approval.referenceLabel ?? approval.invoiceId ?? approval.reference,
    context: approval.context ?? approval.patientName ?? '-',
    amountLabel: approval.amountLabel ?? formatCurrency(approval.amount),
    requestData: approval.requestData ?? {},
    oldValue: approval.oldValue ?? {},
    newValue: approval.newValue ?? {},
    executionStatus: approval.executionStatus ?? 'not_required',
    executionAttempts: approval.executionAttempts ?? 0,
    executionError: approval.executionError ?? null,
    evidenceRequired: approval.evidenceRequired ?? approval.evidenceStatus === 'missing',
    evidenceStatus: approval.evidenceStatus ?? 'not_required',
    policyReason: approval.policyReason ?? 'Standard approval policy matched',
    slaDueAt: approval.slaDueAt ?? null,
    assignedRole: approval.assignedRole ?? '-',
    infoRequestStatus: approval.infoRequestStatus ?? 'not_requested',
    infoRequestedAt: approval.infoRequestedAt ?? null,
    infoRequestedBy: approval.infoRequestedBy ?? null,
    infoRequestNote: approval.infoRequestNote ?? null,
    infoMissingItems: approval.infoMissingItems ?? [],
    infoSubmittedAt: approval.infoSubmittedAt ?? null,
    infoSubmittedBy: approval.infoSubmittedBy ?? null,
    infoResponseNote: approval.infoResponseNote ?? null,
    approvalRevision: approval.approvalRevision ?? Number(approval.requestData?.approvalRevision ?? 1),
    approvalCount: approval.approvalCount ?? (approval.status === 'approved' ? 2 : 0),
    requiredApprovals: approval.requiredApprovals ?? 2,
    remainingApprovals: approval.remainingApprovals ?? (approval.status === 'approved' ? 0 : 2),
    approvalStage: approval.approvalStage ?? (approval.status === 'approved' ? 'Fully Approved (2/2)' : approval.status === 'partially_approved' ? 'Partially Approved (1/2)' : 'Pending (0/2)'),
    currentUserApproved: approval.currentUserApproved ?? false,
    canCurrentUserApprove: approval.canCurrentUserApprove,
    approvalBlockedReason: approval.approvalBlockedReason ?? null,
    isActionable: approval.isActionable ?? (isOpenApproval(approval) && approval.canCurrentUserApprove !== false),
  }));

  const backendSummary = isApprovalSummary(summaryData?.data) ? summaryData.data : isApprovalSummary(summaryData?.summary) ? summaryData.summary : undefined;
  const activeSummary = backendSummary ?? data?.summary ?? buildApprovalSummary(normalizedApprovals, data?.pagination?.total ?? normalizedApprovals.length);

  useEffect(() => {
    if (!isLoading && statusView === 'pending') {
      setLastPendingSummary(activeSummary);
    }
  }, [activeSummary.highPriority, activeSummary.olderThan24h, activeSummary.todayApproved, activeSummary.totalPending, activeSummary.cashHandoverPending, activeSummary.missingEvidence, activeSummary.executionFailed, isLoading, statusView]);

  const summary = statusView !== 'pending' && lastPendingSummary
    ? { ...lastPendingSummary, todayApproved: statusView === 'approved' ? activeSummary.todayApproved : lastPendingSummary.todayApproved }
    : activeSummary;

  const afterTypeFilter = activeTab === 'All'
    ? normalizedApprovals
    : normalizedApprovals.filter((a) => a.type === TYPE_MAP[activeTab as keyof typeof TYPE_MAP]);

  const afterSearchFilter = searchTerm.trim()
    ? afterTypeFilter.filter((approval) => {
        const haystack = [approval.id, approval.type, approval.requestedBy, approval.department, approval.referenceLabel, approval.context, approval.reason, approval.patientName, approval.status].join(' ').toLowerCase();
        return haystack.includes(searchTerm.trim().toLowerCase());
      })
    : afterTypeFilter;

  const filteredBase = kpiFilter === 'high'
    ? afterSearchFilter.filter((a) => a.risk === 'high')
    : kpiFilter === 'stale'
      ? afterSearchFilter.filter((a) => isSlaBreached(a))
      : kpiFilter === 'missing_evidence'
        ? afterSearchFilter.filter((a) => a.evidenceStatus === 'missing')
        : kpiFilter === 'execution_failed'
          ? afterSearchFilter.filter((a) => a.executionStatus === 'failed')
          : kpiFilter === 'info_requested'
            ? afterSearchFilter.filter((a) => a.infoRequestStatus === 'requested')
            : kpiFilter === 'due_soon'
              ? afterSearchFilter.filter((a) => isDueSoon(a))
              : kpiFilter === 'blocked'
                ? afterSearchFilter.filter((a) => isDecisionBlocked(a))
                : afterSearchFilter;
  const filtered = filteredBase.slice().sort(compareApprovalUrgency);
  const pagination = data?.pagination;
  const pageLimit = pagination?.limit ?? 50;
  const totalPages = Math.max(1, pagination?.totalPages ?? (Math.ceil((pagination?.total ?? 0) / pageLimit) || 1));

  const bulkSafeTypes = new Set(['bill_edit', 'discount']);
  const actionableFiltered = filtered.filter((approval) => approval.isActionable && (approval.bulkApproveAllowed ?? (bulkSafeTypes.has(approval.type) && approval.risk !== 'high')));

  const handleReviewSuccess = async (response?: { data?: { id?: number; status?: string; approvalCount?: number; requiredApprovals?: number; remainingApprovals?: number; sideEffect?: ReviewSideEffect } }) => {
    await invalidateApprovalWorkspace();
    setDrawerOpen(false);
    setSelectedApproval(null);
    const sideEffect = response?.data?.sideEffect;
    if (sideEffect?.kind === 'converted_to_credit_note' && sideEffect.creditNoteNo) {
      toast.success(t('pendingApprovals.toast.convertedToCreditNote', { defaultValue: `Bill has payments — credit note ${sideEffect.creditNoteNo} created for review.`, creditNoteNo: sideEffect.creditNoteNo }));
    } else if (response?.data?.status === 'partially_approved') {
      toast.success(`Approval recorded (${response.data.approvalCount ?? 1}/${response.data.requiredApprovals ?? 2}). One more distinct approver is required.`);
    } else {
      toast.success(t('pendingApprovals.toast.approvalUpdated'));
    }
  };
  const handleReviewError = (error: Error) => toast.error(error.message || t('pendingApprovals.toast.updateFailed'));

  const approvalReviewMutation = useApiMutation<{ data: { id: number; status: string; approvalCount?: number; requiredApprovals?: number; remainingApprovals?: number; sideEffect?: ReviewSideEffect } }, ReviewVariables>(
    'put',
    (variables) => `/api/approvals/${variables.id}/review`,
    { onSuccess: handleReviewSuccess, onError: handleReviewError },
  );
  const handoverReviewMutation = useApiMutation<{ data?: { id?: number; status?: string; sideEffect?: ReviewSideEffect } }, ReviewVariables>(
    'post',
    (variables) => `/api/billing-counter/handovers/${variables.id}/admin-verify`,
    { onSuccess: handleReviewSuccess, onError: handleReviewError },
  );
  const requestInfoMutation = useApiMutation<{ data?: { id?: number; status?: string; requestInfoRequested?: boolean } }, RequestInfoVariables>(
    'post',
    (variables) => `/api/approvals/${variables.id}/request-info`,
    {
      onSuccess: async () => {
        await invalidateApprovalWorkspace();
        setDrawerOpen(false);
        setSelectedApproval(null);
        toast.success('Information request sent');
      },
      onError: handleReviewError,
    },
  );
  const isReviewSubmitting = approvalReviewMutation.isPending || handoverReviewMutation.isPending || requestInfoMutation.isPending;

  const expenseReviewMutation = useApiMutation<unknown, ReviewVariables>(
    'post',
    (variables) => variables.action === 'approve' ? `/api/expenses/${variables.id}/approve` : `/api/expenses/${variables.id}/reject`,
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingApprovals() });
        await queryClient.invalidateQueries({ queryKey: queryKeys.approvals.counts() });
        await queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingApprovalsSummary() });
        setDrawerOpen(false);
        setSelectedApproval(null);
        toast.success(t('pendingApprovals.toast.approvalUpdated'));
      },
      onError: (error) => toast.error(error.message || t('pendingApprovals.toast.updateFailed')),
    },
  );

  const handleRowClick = (approval: Approval) => {
    setSelectedApproval(approval);
    setDrawerOpen(true);
  };

  const submitReviewDecision = (variables: ReviewVariables) => {
    if (variables.type === 'cash_handover' && variables.source === 'billing_handovers') {
      handoverReviewMutation.mutate(variables);
    } else {
      approvalReviewMutation.mutate(variables);
    }
  };

  const handleApprove = (id: string, note: string, approvalOverride?: Approval) => {
    const approval = approvalOverride ?? selectedApproval;
    if (approval?.requestData?.source === 'expenses') {
      expenseReviewMutation.mutate({ id: String(approval.entityId ?? id), type: 'expense', action: 'approve', notes: note });
      return;
    }
    const targetId = approval ? getReviewTargetId(approval, id) : id;
    submitReviewDecision({ id: targetId, type: approval?.type, ...(approval?.source ? { source: approval.source } : {}), action: 'approve', notes: note, decision: 'approve', remarks: note });
  };

  const handleReject = (id: string, payload: ApprovalRejectPayload, approvalOverride?: Approval) => {
    const approval = approvalOverride ?? selectedApproval;
    if (approval?.requestData?.source === 'expenses') {
      expenseReviewMutation.mutate({ id: String(approval.entityId ?? id), type: 'expense', action: 'reject', notes: payload.notes });
      return;
    }
    const targetId = approval ? getReviewTargetId(approval, id) : id;
    submitReviewDecision({
      id: targetId,
      type: approval?.type,
      ...(approval?.source ? { source: approval.source } : {}),
      action: 'reject',
      notes: payload.notes,
      decision: 'reject',
      remarks: payload.notes,
      cashResolution: payload.cashResolution,
      cashReturnedAcknowledged: payload.cashReturnedAcknowledged,
      idempotencyKey: payload.idempotencyKey,
    });
  };

  const handleRequestInfo = (id: string, payload: ApprovalReturnPayload) => {
    const approval = selectedApproval;
    const targetId = approval ? getReviewTargetId(approval, id) : id;
    if (isSyntheticCashHandover(approval)) {
      toast.error('Synthetic cash handovers require direct review or rejection for receiver recount.');
      return;
    }
    requestInfoMutation.mutate({
      id: targetId,
      type: approval?.type,
      notes: payload.notes,
      missingItems: payload.missingItems,
    });
  };

  const handleQuickApprove = (approval: Approval) => {
    if (!isQuickApprovalEligible(approval)) {
      handleRowClick(approval);
      return;
    }
    handleApprove(approval.id, '', approval);
  };

  const bulkReviewMutation = useApiMutation<{ data: { requested: number; succeeded: number; failed: number; failedIds: number[]; status: string; partiallyApproved?: number; fullyApproved?: number } }, BulkReviewVariables>(
    'post',
    () => '/api/approvals/bulk-review',
    {
      onSuccess: async (response) => {
        await invalidateApprovalWorkspace();
        setSelectedIds(new Set());
        const { succeeded, failed, partiallyApproved = 0, fullyApproved = 0 } = response.data;
        if (failed === 0 && partiallyApproved > 0 && fullyApproved === 0) {
          toast.success(`${succeeded} first approvals recorded. A second distinct approver is still required.`);
        } else if (failed === 0) {
          toast.success(t('pendingApprovals.toast.approvedRequests', { count: succeeded }));
        } else {
          toast.error(t('pendingApprovals.toast.bulkResult', { succeeded, failed }));
        }
      },
      onError: (error) => toast.error(error.message || t('pendingApprovals.toast.bulkFailed')),
    },
  );

  const handleBulkAction = async (actionId: string) => {
    if (actionId !== 'approve' && actionId !== 'reject') return;
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const notes = actionId === 'reject' ? 'Bulk rejection' : undefined;
    bulkReviewMutation.mutate({ ids, action: actionId, notes });
  };

  const APPROVAL_BULK_ACTIONS: BulkAction[] = [
    { id: 'approve', label: t('pendingApprovals.bulk.approveSelected'), icon: <Check className="w-4 h-4" />, variant: 'primary', confirmMessage: t('pendingApprovals.bulk.approveConfirm') },
    { id: 'reject', label: t('pendingApprovals.bulk.rejectSelected'), icon: <X className="w-4 h-4" />, variant: 'danger', confirmMessage: t('pendingApprovals.bulk.rejectConfirm') },
  ];

  const toggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(actionableFiltered.map((a) => a.numericId)));
    else setSelectedIds(new Set());
  };

  const handleStatusChange = (nextStatus: StatusView) => {
    setStatus(nextStatus);
    setKpiFilter(null);
    setSelectedIds(new Set());
    setPage(1);
  };
  const handleTotalPendingClick = () => {
    setStatus('pending');
    setKpiFilter(null);
    setActiveTab('All');
    setSelectedIds(new Set());
    setPage(1);
  };
  const handleCashHandoverClick = () => {
    setStatus('pending');
    setKpiFilter(null);
    setActiveTab('Cash Handover');
    setSelectedIds(new Set());
    setPage(1);
  };
  const handleHighPriorityClick = () => {
    setStatus('pending');
    setKpiFilter((prev) => (prev === 'high' ? null : 'high'));
  };
  const handleStaleClick = () => {
    setStatus('pending');
    setKpiFilter((prev) => (prev === 'stale' ? null : 'stale'));
  };
  const handleDueSoonClick = () => {
    setStatus('pending');
    setKpiFilter((prev) => (prev === 'due_soon' ? null : 'due_soon'));
  };
  const handleBlockedClick = () => {
    setStatus('pending');
    setKpiFilter((prev) => (prev === 'blocked' ? null : 'blocked'));
  };
  const handleMissingEvidenceClick = () => {
    setStatus('pending');
    setKpiFilter((prev) => (prev === 'missing_evidence' ? null : 'missing_evidence'));
  };
  const handleExecutionFailedClick = () => {
    if (kpiFilter === 'execution_failed') {
      setStatus('pending');
      setKpiFilter(null);
      return;
    }
    setStatus('all');
    setKpiFilter('execution_failed');
  };
  const handleInfoRequestedClick = () => {
    setStatus('pending');
    setKpiFilter((prev) => (prev === 'info_requested' ? null : 'info_requested'));
  };
  const handleTodayApprovedClick = () => {
    if (statusView === 'approved' && kpiFilter === 'reviewed_today') {
      setStatus('pending');
      setKpiFilter(null);
      setPage(1);
      return;
    }
    setStatus('approved');
    setKpiFilter('reviewed_today');
    setPage(1);
  };
  const clearKpiFilter = () => setKpiFilter(null);

  const selectedActionableCount = useMemo(() => Array.from(selectedIds).filter((id) => actionableFiltered.some((a) => a.numericId === id)).length, [selectedIds, actionableFiltered]);
  const pendingApprovalsInView = normalizedApprovals.filter(isOpenApproval);
  const queueBlockedCount = summary.blocked ?? pendingApprovalsInView.filter(isDecisionBlocked).length;
  const queueDueSoonCount = summary.dueSoon ?? pendingApprovalsInView.filter(isDueSoon).length;
  const queueSlaBreachedCount = summary.olderThan24h ?? pendingApprovalsInView.filter(isSlaBreached).length;
  const queueHighPriorityCount = summary.highPriority ?? pendingApprovalsInView.filter((approval) => approval.risk === 'high').length;
  const queuePendingValue = summary.totalPendingAmount ?? pendingApprovalsInView.reduce((sum, approval) => sum + Math.abs(approval.amount), 0);
  const sessionResolvedCount = (summary.todayApproved ?? 0) + (summary.rejectedToday ?? 0);
  const sessionTotalCount = sessionResolvedCount + summary.totalPending;
  const sessionProgress = percentOf(sessionResolvedCount, sessionTotalCount);
  const statusTotal = Math.max(1, summary.totalPending + (summary.todayApproved ?? 0) + (summary.rejectedToday ?? 0));
  const pendingPercent = percentOf(summary.totalPending, statusTotal);
  const approvedPercent = percentOf(summary.todayApproved ?? 0, statusTotal);
  const rejectedPercent = percentOf(summary.rejectedToday ?? 0, statusTotal);
  const pendingByTypeSource = summary.pendingByType ?? pendingApprovalsInView.reduce((acc: Record<string, number>, approval) => {
    acc[approval.type] = (acc[approval.type] ?? 0) + 1;
    return acc;
  }, {});
  const pendingTypeEntries = Object.entries(pendingByTypeSource).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const pendingTypeTotal = Math.max(1, pendingTypeEntries.reduce((sum, [, count]) => sum + count, 0));
  const cockpitTypeBreakdown = pendingTypeEntries.map(([type, count]) => ({ type, label: getApprovalTypeLabel(type), count, percent: percentOf(count, pendingTypeTotal) }));
  const handleTypeDistributionClick = (type: string) => {
    const tab = TYPE_TABS.find((item) => item !== 'All' && TYPE_MAP[item as Exclude<TypeTab, 'All'>] === type) as TypeTab | undefined;
    setStatus('pending');
    setKpiFilter(null);
    setActiveTab(tab ?? 'All');
  };
  const nextPriorityApproval = filtered.find(isOpenApproval);
  const handleOldestFirstClick = () => {
    setStatus('pending');
    setActiveTab('All');
    setKpiFilter(queueSlaBreachedCount > 0 ? 'stale' : queueDueSoonCount > 0 ? 'due_soon' : null);
    setPage(1);
  };
  const eventTimeline = selectedApproval && Array.isArray(eventData?.data) ? eventData.data.filter((event) => typeof event.action === 'string').map(eventToTimelineItem) : [];
  const drawerApproval = selectedApproval && eventTimeline.length > 0
    ? { ...selectedApproval, timeline: eventTimeline }
    : selectedApproval;
  const headerActions = (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={handleOldestFirstClick} className="btn-secondary text-sm">
        <Clock className="h-4 w-4" />
        {t('pendingApprovals.reviewOldestFirst', { defaultValue: 'Review oldest first' })}
      </button>
      {statusView !== 'pending' && (
        <button type="button" onClick={handleTotalPendingClick} className="btn-secondary text-sm">
          <ClearIcon className="h-4 w-4" />
          {t('pendingApprovals.backToPending', { defaultValue: 'Back to pending' })}
        </button>
      )}
    </div>
  );

  const content = (
    <>
      <div className={`${embedded ? '' : 'p-6'} space-y-6`}>
        {!embedded && (
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--color-primary)]">{t('pendingApprovals.kicker', { defaultValue: 'Action Center' })}</p>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('pendingApprovals.title', { defaultValue: 'Approval Center' })}</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {t('pendingApprovals.subtitle', { defaultValue: 'Manage pending approvals, evidence, SLA breaches, cash handovers, exceptions, and reviewed history from one audited workspace.' })}
              </p>
            </div>
            {headerActions}
          </div>
        )}

        <ApprovalCockpit
          totalPending={summary.totalPending}
          todayApproved={summary.todayApproved ?? 0}
          rejectedToday={summary.rejectedToday ?? 0}
          pendingPercent={pendingPercent}
          approvedPercent={approvedPercent}
          rejectedPercent={rejectedPercent}
          pendingValueLabel={formatCurrency(queuePendingValue)}
          highRiskCount={queueHighPriorityCount}
          typeBreakdown={cockpitTypeBreakdown}
          sessionProgress={sessionProgress}
          resolvedCount={sessionResolvedCount}
          remainingCount={summary.totalPending}
          nextActionLabel={nextPriorityApproval ? `${getApprovalTypeLabel(nextPriorityApproval.type)} • ${relativeSlaLabel(nextPriorityApproval)}` : 'No pending review'}
          onReviewQueue={handleOldestFirstClick}
          onTypeSelect={handleTypeDistributionClick}
        />

        {summary && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4">
            <KPICard title={t('pendingApprovals.summary.totalPending')} value={summary.totalPending} icon={<ListChecks className="h-6 w-6" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" onClick={handleTotalPendingClick} active={statusView === 'pending' && kpiFilter === null} index={0} />
            <KPICard title={t('pendingApprovals.summary.highPriority')} value={summary.highPriority} icon={<AlertTriangle className="h-6 w-6" />} iconBg="bg-red-50 text-red-600" onClick={handleHighPriorityClick} active={kpiFilter === 'high'} index={1} />
            <KPICard title={t('pendingApprovals.summary.blocked', { defaultValue: 'Decision Blocked' })} value={summary.blocked ?? queueBlockedCount} icon={<AlertTriangle className="h-6 w-6" />} iconBg="bg-amber-50 text-amber-700" onClick={handleBlockedClick} active={kpiFilter === 'blocked'} index={2} />
            <KPICard title={t('pendingApprovals.summary.cashHandover', { defaultValue: 'Cash Variance / Disputes' })} value={summary.cashHandoverPending ?? normalizedApprovals.filter((item) => item.type === 'cash_handover' && item.status === 'pending').length} icon={<Banknote className="h-6 w-6" />} iconBg="bg-emerald-50 text-emerald-600" onClick={handleCashHandoverClick} active={activeTab === 'Cash Handover'} index={3} />
            <KPICard title={t('pendingApprovals.summary.todayApproved')} value={summary.todayApproved} icon={<CheckCircle2 className="h-6 w-6" />} iconBg="bg-emerald-50 text-emerald-600" onClick={handleTodayApprovedClick} active={statusView === 'approved' && kpiFilter === 'reviewed_today'} index={4} />
          </div>
        )}

        <div className="card space-y-4 border border-[var(--color-border)]">
          <div className="flex flex-wrap gap-2">
            {STATUS_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-label={`Status: ${label}`}
                onClick={() => handleStatusChange(id)}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${statusView === id ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary)]'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={searchTerm}
                onChange={(event) => { setSearchTerm(event.target.value); setPage(1); }}
                placeholder={t('pendingApprovals.searchPlaceholder', { defaultValue: 'Search request, invoice, patient, cashier, reason...' })}
                className="w-full rounded-xl border border-[var(--color-border)] bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-light)]"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleStaleClick} className={`btn-secondary text-sm ${kpiFilter === 'stale' ? 'ring-2 ring-[var(--color-primary)]' : ''}`}>SLA breached ({queueSlaBreachedCount})</button>
              <button type="button" onClick={handleDueSoonClick} className={`btn-secondary text-sm ${kpiFilter === 'due_soon' ? 'ring-2 ring-[var(--color-primary)]' : ''}`}>Due soon ({queueDueSoonCount})</button>
              <button type="button" onClick={handleMissingEvidenceClick} className={`btn-secondary text-sm ${kpiFilter === 'missing_evidence' ? 'ring-2 ring-[var(--color-primary)]' : ''}`}>Missing evidence ({summary.missingEvidence ?? 0})</button>
              <button type="button" onClick={handleExecutionFailedClick} className={`btn-secondary text-sm ${kpiFilter === 'execution_failed' ? 'ring-2 ring-[var(--color-primary)]' : ''}`}>Failed execution ({summary.executionFailed ?? 0})</button>
              <button type="button" onClick={handleInfoRequestedClick} className={`btn-secondary text-sm ${kpiFilter === 'info_requested' ? 'ring-2 ring-[var(--color-primary)]' : ''}`}>Needs info ({summary.infoRequested ?? 0})</button>
              {(searchTerm || kpiFilter || activeTab !== 'All') && (
                <button type="button" onClick={() => { setSearchTerm(''); setKpiFilter(null); setActiveTab('All'); setPage(1); }} className="btn-secondary text-sm">
                  <ClearIcon className="h-4 w-4" /> Clear filters
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-1 flex-wrap">
            {TYPE_TABS.map((tab) => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary)]'}`}>
                {t(`pendingApprovals.tabs.${TYPE_TAB_KEYS[tab]}`, { defaultValue: TYPE_TAB_LABELS[tab] })}
              </button>
            ))}
          </div>
        </div>

        {kpiFilter && statusView === 'pending' && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-primary)] bg-[var(--color-primary-light)] px-3 py-2 text-sm text-[var(--color-primary)]">
            <span className="font-medium">
              {t('pendingApprovals.filter.activeGeneric', { defaultValue: `Showing only ${activeFilterLabel(kpiFilter)}` })}
            </span>
            <button type="button" onClick={clearKpiFilter} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium hover:bg-white/50">
              <ClearIcon className="h-3.5 w-3.5" />
              {t('pendingApprovals.filter.clear', { defaultValue: 'Clear filter' })}
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="card py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
              <ListChecks className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">{t('pendingApprovals.emptyTitle', { defaultValue: 'No approvals in this view' })}</h2>
            <div className="sr-only">{t('pendingApprovals.empty')}</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-text-muted)]">
              {t('pendingApprovals.emptyHelp', { defaultValue: 'Try clearing filters, switching status, or reviewing another approval type.' })}
            </p>
            {(searchTerm || kpiFilter || activeTab !== 'All') && (
              <button type="button" onClick={() => { setSearchTerm(''); setKpiFilter(null); setActiveTab('All'); setPage(1); }} className="btn-secondary mx-auto mt-4 text-sm">
                <ClearIcon className="h-4 w-4" /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="card overflow-hidden border border-[var(--color-border)] p-0 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[var(--color-border)] bg-white px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('pendingApprovals.worklist.title', { defaultValue: 'Approval worklist' })}</h2>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {filtered.length} {t('pendingApprovals.worklist.results', { defaultValue: 'results in this priority-sorted view' })} • {selectedActionableCount} {t('pendingApprovals.worklist.chosen', { defaultValue: 'chosen for safe batch action' })}
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary-light)] px-3 py-1 text-xs font-semibold text-[var(--color-primary)]">
                <ShieldCheck className="h-3.5 w-3.5" />
                {t('pendingApprovals.worklist.auditReady', { defaultValue: 'Audit-ready decision trail' })}
              </div>
            </div>
            <ApprovalMobileCardList approvals={filtered} onOpen={handleRowClick} />
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1320px]">
                <thead className="sticky top-0 z-10 bg-[var(--color-surface-muted)]">
                  <tr>
                    <th className="py-3 px-2 w-10">
                      {statusView === 'pending' && (
                        <BulkCheckbox checked={actionableFiltered.length > 0 && actionableFiltered.every((a) => selectedIds.has(a.numericId))} indeterminate={selectedIds.size > 0 && selectedActionableCount < actionableFiltered.length} onChange={toggleAll} />
                      )}
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApprovals.table.requestId')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApprovals.table.type')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">Reference / Context</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApprovals.table.requestedBy')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApprovals.table.department')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApprovals.table.amount')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">Policy / Evidence</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApprovals.table.reason')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApprovals.table.submittedAt')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApprovals.table.risk')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApprovals.table.status')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApprovals.table.actions', { defaultValue: 'Actions' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((approval) => {
                    const isBulkSafe = statusView === 'pending' && approval.isActionable && (approval.bulkApproveAllowed ?? (bulkSafeTypes.has(approval.type) && approval.risk !== 'high'));
                    const quickApprovalAllowed = isQuickApprovalEligible(approval);
                    const quickBlockReason = quickApprovalBlockReason(approval);
                    return (
                      <tr key={approval.approvalKey ?? approval.id} className={`border-t border-[var(--color-border)] transition-colors ${selectedIds.has(approval.numericId) ? 'bg-[var(--color-primary-light)]/50' : 'hover:bg-[var(--color-primary-light)]/40'}`}>
                        <td className="py-3 px-2" onClick={(e) => e.stopPropagation()}>{isBulkSafe && <BulkCheckbox checked={selectedIds.has(approval.numericId)} onChange={() => toggleRow(approval.numericId)} />}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-[var(--color-text-primary)] cursor-pointer" onClick={() => handleRowClick(approval)}>{approval.id}</td>
                        <td className="py-3 px-4 text-sm cursor-pointer" onClick={() => handleRowClick(approval)}>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${TYPE_BADGE[approval.type] ?? 'bg-slate-100 text-[var(--color-text-secondary)] ring-1 ring-slate-200'}`}>{t(`pendingApprovals.typeLabels.${approval.type}`, { defaultValue: TYPE_TAB_LABELS[TYPE_TABS.find((tab) => tab !== 'All' && TYPE_MAP[tab as Exclude<TypeTab, 'All'>] === approval.type) as TypeTab] ?? humanizeKey(approval.type) })}</span>
                        </td>
                        <td className="py-3 px-4 text-sm cursor-pointer" onClick={() => handleRowClick(approval)}>
                          <div className="font-medium text-[var(--color-text-primary)]">{approval.referenceLabel ?? '-'}</div>
                          <div className="max-w-[240px] truncate text-xs text-[var(--color-text-muted)]">{approval.context}</div>
                        </td>
                        <td className="py-3 px-4 text-sm text-[var(--color-text-secondary)] cursor-pointer" onClick={() => handleRowClick(approval)}>{approval.requestedBy}</td>
                        <td className="py-3 px-4 text-sm text-[var(--color-text-secondary)] cursor-pointer" onClick={() => handleRowClick(approval)}>{approval.department}</td>
                        <td className="py-3 px-4 text-sm text-right font-medium cursor-pointer" onClick={() => handleRowClick(approval)}>{approval.amountLabel}</td>
                        <td className="py-3 px-4 text-sm cursor-pointer" onClick={() => handleRowClick(approval)}>
                          <div className="max-w-[260px] truncate font-medium text-[var(--color-text-primary)]">{approval.policyReason}</div>
                          <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${approval.evidenceStatus === 'missing' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-100' : approval.evidenceStatus === 'provided' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'}`}>
                            {approval.evidenceStatus === 'missing' ? 'Missing evidence — warning' : approval.evidenceStatus === 'provided' ? 'Evidence provided' : 'Evidence not required'}
                          </div>
                          {approval.infoRequestStatus === 'requested' && <div className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-100">Needs info</div>}
                          {approval.infoRequestStatus === 'submitted' && <div className="mt-1 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-100">Info submitted</div>}
                        </td>
                        <td className="py-3 px-4 text-sm text-[var(--color-text-secondary)] max-w-[220px] truncate cursor-pointer" onClick={() => handleRowClick(approval)}>{approval.reason}</td>
                        <td className="py-3 px-4 text-sm text-[var(--color-text-muted)] cursor-pointer" onClick={() => handleRowClick(approval)}>
                          <div>{formatDateTime(approval.submittedAt)}</div>
                          {isOpenApproval(approval) && <div className={`mt-1 text-xs font-medium ${isSlaBreached(approval) ? 'text-red-600' : 'text-[var(--color-text-muted)]'}`}>{relativeSlaLabel(approval)}</div>}
                        </td>
                        <td className="py-3 px-4 text-sm cursor-pointer" onClick={() => handleRowClick(approval)}><span className={`px-2 py-1 rounded-full text-xs font-medium ${RISK_BADGE[approval.risk] ?? 'bg-slate-100 text-[var(--color-text-secondary)] ring-1 ring-slate-200'}`}>{t(`pendingApprovals.riskLabels.${approval.risk}`, { defaultValue: approval.risk })}</span></td>
                        <td className="py-3 px-4 text-sm cursor-pointer" onClick={() => handleRowClick(approval)}>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[approval.status] ?? 'bg-slate-100 text-[var(--color-text-secondary)] ring-1 ring-slate-200'}`}>{approvalStatusLabel(approval)}</span>
                          {approval.executionStatus === 'failed' && <div className="mt-1 text-xs font-semibold text-red-600">Execution failed</div>}
                          {isOpenApproval(approval) && isDecisionBlocked(approval) && <div className="mt-1 max-w-[220px] text-xs font-semibold text-amber-700">{approval.approvalBlockedReason ?? 'Safety review needed'}</div>}
                        </td>
                        <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center justify-end gap-2">
                            <button type="button" aria-label={`Review approval ${approval.id}`} onClick={() => handleRowClick(approval)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">
                              <Eye className="h-3.5 w-3.5" />
                              {t('pendingApprovals.actions.review', { defaultValue: 'Review' })}
                            </button>
                            {isOpenApproval(approval) && (
                              <button type="button" aria-label={`Quick approve approval ${approval.id}`} onClick={() => handleQuickApprove(approval)} disabled={isReviewSubmitting || !quickApprovalAllowed} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${quickApprovalAllowed ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-700'}`}>
                                <Check className="h-3.5 w-3.5" />
                                {quickApprovalAllowed ? t('pendingApprovals.actions.quickApprove', { defaultValue: 'Quick approve' }) : quickBlockReason ? `Review: ${quickBlockReason}` : t('pendingApprovals.actions.reviewRequired', { defaultValue: 'Review required' })}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {pagination && pagination.total > pageLimit && (
          <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-text-secondary)] sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing page {page} of {totalPages} • {pagination.total} total approvals
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>Previous</button>
              <button type="button" className="btn-secondary text-sm" disabled={page >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>Next</button>
            </div>
          </div>
        )}
      </div>

      <ApprovalDetailDrawer open={drawerOpen} onClose={() => { setDrawerOpen(false); setSelectedApproval(null); }} approval={drawerApproval} onApprove={handleApprove} onReject={handleReject} onRequestInfo={handleRequestInfo} isSubmitting={isReviewSubmitting} />

      {statusView === 'pending' && <BulkActionsBar selectedCount={selectedActionableCount} onClearSelection={() => setSelectedIds(new Set())} actions={APPROVAL_BULK_ACTIONS} onAction={handleBulkAction} />}
    </>
  );

  if (embedded) {
    return (
      <ActionCenterShell
        activeSection="approvals"
        title={t('pendingApprovals.title', { defaultValue: 'Approvals' })}
        description={t('pendingApprovals.subtitle', { defaultValue: 'Review evidence, SLA, exceptions, and decision history from one audited approval workspace.' })}
        primaryAction={headerActions}
      >
        {content}
      </ActionCenterShell>
    );
  }

  return <DashboardLayout role={role}>{content}</DashboardLayout>;
}
