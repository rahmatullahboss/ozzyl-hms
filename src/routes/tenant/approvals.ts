import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { Env, Variables } from '../../types';
import { requireRole, resolveUserPermissions } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import { d1WithRetry } from '../../lib/d1-retry';
import { requireTenantId } from '../../lib/context-helpers';
import { getTodayGMT6 } from '../../lib/date-utils';
import { getNextSequence } from '../../lib/sequence';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import {
  createApprovalRequestSchema,
  reviewApprovalSchema,
  requestInfoApprovalSchema,
  submitInfoApprovalSchema,
  approvalQuerySchema,
  bulkReviewApprovalSchema,
} from '../../schemas/approval';
import { cancelItemCommissions, cancelLabItemCommissions } from '../../lib/lab-finance';
import {
  cancelLabOrderItemsForBill,
  cancelLabOrderItemsForInvoiceItems,
  loadLabOrderItemIdsForInvoiceItems,
} from '../../lib/lab-cancellation';
import { cancelRadiologyRequisitionsForInvoiceItems } from '../../lib/radiology-cancellation';
import { assertNoPaidPerformerReserves } from '../../lib/diagnostic-performer-reserve';
import { logServerError } from '../../lib/server-error-logging';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import {
  calculateProportionalRefundAllocation,
  calculateRefundFinancialImpact,
  calculateRefundSelection,
  tryCalculateRefundFinancialImpact,
  loadRefundAllocationItems,
  loadRefundableInvoiceItems,
  validateRefundAllocation,
  type RefundAllocatedItem,
  type RefundAllocationInput,
  type RefundCalculation,
} from '../../lib/billing-refund';
import {
  applyRefundCommissionImpact,
  buildRefundCommissionImpactStatements,
  buildTransitionRefundCommissionReservationStatements,
  loadRefundCommissionReservationPreview,
  previewRefundCommissionImpact,
  type RefundCommissionImpactPreview,
} from '../../lib/billing-refund-commission';
import {
  getCounterAvailableCash,
  loadHeldRefundCashHold,
  loadRefundCashHold,
  loadRefundCashHoldByIdempotencyKey,
  prepareCreateRefundHold,
  shadowRefundReserveConsumed,
} from '../../lib/billing-refund-cash-hold';
import {
  completeRefundDisputeWriteoff,
  loadRefundCashDispute,
  loadRefundCashDisputeByHold,
  prepareAttachRefundDisputeCashOut,
  prepareCreateRefundDispute,
  prepareCreateRefundDisputeCashOut,
  prepareMarkRefundHoldDisputed,
  prepareRefundDisputeOpenedAccountingEvent,
  shadowRefundDisputeOpened,
  shadowRefundDisputeWrittenOff,
} from '../../lib/billing-refund-dispute';
import { createIdempotencyRequestHash } from '../../lib/request-idempotency';
import {
  isRefundBatchAssertionError,
  prepareClearRefundBatchAssertions,
  prepareRefundBatchAssertion,
} from '../../lib/billing-refund-batch-guard';
import {
  CREDIT_DISCHARGE_APPROVAL_KIND,
  CREDIT_DISCHARGE_APPROVAL_STORAGE_TYPE,
  publicApprovalType,
} from '../../lib/credit-discharge-approval';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
} from '../../lib/accounting-posting';
import { loadApprovalOperationalSummary } from '../../services/actionCenter/approvalSummary';
import {
  executeReceivableWriteOffApproval,
  rejectReceivableWriteOffApproval,
  ReceivableWriteOffExecutionConflictError,
  ReceivableWriteOffExecutionError,
} from '../../services/actionCenter/collections/writeOffExecution';
import { assertStrictFinancialBoundaryDisabledOrSupported } from '../../lib/canonical/strict-financial-boundaries';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { cancelUnpaidInvoice } from '../../lib/canonical/commands/cancel-invoice';
import { resolveLiveUnpaidInvoiceCancellationProjection } from '../../lib/canonical/live-unpaid-invoice-cancellation';
import { resolveLiveCreditNoteProjection } from '../../lib/canonical/live-credit-note-projection';
import { resolveLiveCreditNoteCashRefundFunding } from '../../lib/canonical/live-credit-note-cash-refund';
import { issueCreditNoteWithCashRefund } from '../../lib/canonical/commands/issue-credit-note-cash-refund';
import { createDeterministicSourceId } from '../../lib/canonical/source-mapping';
import { executePaymentVoidReversal } from '../../lib/payment-void-execution';
import {
  buildExecutedRefundRequestData,
  isExecutedPendingApproval,
  loadEligibleExecutedRefundCashReturnSessions,
  reverseExecutedRefund,
} from '../../lib/executed-refund';
import {
  ApprovalPolicyError,
  approvalStage,
  isTwoPersonApproverRole,
  recordApprovalDecision,
  returnApprovalForCorrection,
} from '../../services/approvals/two-person-policy';
// zod schemas are imported from ../../schemas/approval

const approvals = new Hono<{ Bindings: Env; Variables: Variables }>();

const APPROVAL_REVIEW_ROLES = ['hospital_admin', 'md', 'director', 'manager', 'accountant'] as const;
const APPROVAL_REQUEST_ROLES = [...APPROVAL_REVIEW_ROLES, 'reception', 'receptionist'] as const;
// `refund` is included as a guarded legacy alias because older reception builds
// created payment correction requests with type=refund and entity_no=RCP-....
// executeApprovalSideEffect still no-ops non-payment refund approvals.
const EXECUTABLE_APPROVAL_TYPES = new Set(['bill_cancel', 'payment_void', 'refund']);
const HELD_REFUND_KINDS = new Set(['item_partial_refund', 'amount_partial_refund', 'bill_refund']);
type ApprovalEventAction = 'created' | 'approved' | 'rejected' | 'request_info' | 'info_submitted' | 'bulk_approved' | 'bulk_rejected' | 'execution_started' | 'execution_succeeded' | 'execution_failed';

const APPROVAL_TYPE_ALIASES: Record<string, string> = {
  bill_cancellation: 'bill_cancel',
  discount_approval: 'discount',
  cash_closing: 'cash_handover',
  cash_transfer_handover: 'cash_handover',
  shift_handover: 'cash_handover',
};
const BULK_APPROVE_ALLOWED_TYPES = new Set(['bill_edit', 'discount']);
const APPROVAL_NOTE_REQUIRED_TYPES = new Set([
  'bill_cancel',
  'payment_void',
  'refund',
  'cash_handover',
  'cash_variance',
  'stock_adjustment',
  'doctor_payout',
  'manual_adjustment',
  'credit_note',
  'credit_discharge',
  'receivable_write_off',
  'expense',
]);

function parseRequestData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function refundHoldConflictMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/insufficient counter cash for refund hold|CHECK constraint failed:\s*amount > 0/i.test(message)) {
    return 'Available counter cash changed before the refund could be held. Refresh and try again.';
  }
  if (/refund hold requires active originating counter session/i.test(message)) {
    return 'The originating billing counter session is no longer active on this workstation.';
  }
  if (/uq_refund_hold_bill_held|unique constraint failed: billing_refund_cash_holds\.tenant_id, billing_refund_cash_holds\.bill_id/i.test(message)) {
    return 'A pending refund request already holds cash for this bill.';
  }
  return null;
}

function isHeldRefundCanonicalConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current ?? '');
    if (
      /canonical invoice mapping not found/i.test(message)
      || /insufficient canonical payment funding/i.test(message)
      || /canonical payment (?:receipt|allocation|tender attribution) authority changed/i.test(message)
      || /canonical invoice (?:not found|is not posted|adjustment projection is inconsistent)/i.test(message)
      || /cash refund exceeds canonical invoice paid balance/i.test(message)
      || /credit note exceeds refundable invoice balance/i.test(message)
      || /paid performer reserve or compensation settlement blocks credit refund/i.test(message)
    ) {
      return true;
    }
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function canonicalApprovalType(type: unknown): string {
  const raw = String(type ?? '').trim();
  return APPROVAL_TYPE_ALIASES[raw] ?? raw;
}

function canonicalApprovalRequestType(request: any): string {
  const requestData = parseRequestData(request?.request_data ?? request?.requestData);
  return publicApprovalType(canonicalApprovalType(request?.type), requestData);
}

function approvalTypeFilterCandidates(type: string): string[] {
  const canonical = canonicalApprovalType(type);
  if (canonical === 'bill_cancel') return ['bill_cancel', 'bill_cancellation'];
  if (canonical === 'discount') return ['discount', 'discount_approval'];
  if (canonical === 'cash_handover') return ['cash_handover', 'cash_closing', 'cash_transfer_handover', 'shift_handover'];
  if (canonical === CREDIT_DISCHARGE_APPROVAL_KIND) {
    return [CREDIT_DISCHARGE_APPROVAL_STORAGE_TYPE, CREDIT_DISCHARGE_APPROVAL_KIND];
  }
  return [canonical];
}

type ApprovalCreatedWindow = {
  createdFrom?: string;
  createdTo?: string;
  createdBefore?: string;
};

function approvalDateStart(date: string): string {
  return `${date} 00:00:00`;
}

function approvalDateAfter(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)} 00:00:00`;
}

function approvalCreatedAtMatchesWindow(value: unknown, window: ApprovalCreatedWindow): boolean {
  if (!window.createdFrom && !window.createdTo && !window.createdBefore) return true;
  if (!value) return false;
  const timestamp = String(value).length === 10 ? `${value} 00:00:00` : String(value);
  if (window.createdBefore) return timestamp < approvalDateStart(window.createdBefore);
  if (window.createdFrom && timestamp < approvalDateStart(window.createdFrom)) return false;
  if (window.createdTo && timestamp >= approvalDateAfter(window.createdTo)) return false;
  return true;
}

function approvalCreatedWindowSql(
  dateExpression: string,
  window: ApprovalCreatedWindow,
): { sql: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];

  if (window.createdBefore) {
    clauses.push(`${dateExpression} < ?`);
    params.push(approvalDateStart(window.createdBefore));
  } else {
    if (window.createdFrom) {
      clauses.push(`${dateExpression} >= ?`);
      params.push(approvalDateStart(window.createdFrom));
    }
    if (window.createdTo) {
      clauses.push(`${dateExpression} < ?`);
      params.push(approvalDateAfter(window.createdTo));
    }
  }

  return {
    sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '',
    params,
  };
}

function approvalWorklistTimestamp(row: { created_at?: unknown; reviewed_at?: unknown }): number {
  const value = row.created_at ?? row.reviewed_at;
  if (!value) return 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortApprovalWorklist<T extends { created_at?: unknown; reviewed_at?: unknown; id?: unknown }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byDate = approvalWorklistTimestamp(b) - approvalWorklistTimestamp(a);
    if (byDate !== 0) return byDate;
    return Number(b.id ?? 0) - Number(a.id ?? 0);
  });
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
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

function isHighRiskApproval(request: any): boolean {
  const type = canonicalApprovalRequestType(request);
  const requestData = parseRequestData(request?.request_data);
  const variance = firstFiniteNumber(requestData.variance, requestData.cashVariance, requestData.receiverVariance, requestData.receiver_variance);
  return (type === 'cash_handover' && variance !== undefined && variance !== 0) || Math.abs(approvalAmount(request)) >= 10000;
}

function approvalRequiresApprovalNote(request: any, action: string): boolean {
  if (action !== 'approve') return false;
  const type = canonicalApprovalRequestType(request);
  return APPROVAL_NOTE_REQUIRED_TYPES.has(type) || isHighRiskApproval(request);
}

function approvalRisk(request: any): 'low' | 'medium' | 'high' {
  if (isHighRiskApproval(request)) return 'high';
  return Math.abs(approvalAmount(request)) >= 3000 ? 'medium' : 'low';
}

function isBulkApproveAllowed(request: any): boolean {
  const type = canonicalApprovalRequestType(request);
  return BULK_APPROVE_ALLOWED_TYPES.has(type) && !isHighRiskApproval(request);
}

function isExecutedPendingPaymentVoid(request: any): boolean {
  return canonicalApprovalRequestType(request) === 'payment_void'
    && isExecutedPendingApproval({ ...request, type: 'payment_void' });
}

function isExecutedPendingRefund(request: any): boolean {
  return canonicalApprovalRequestType(request) === 'refund'
    && isExecutedPendingApproval({ ...request, type: 'refund' });
}

function approvalRequiresExecution(request: any): boolean {
  const type = canonicalApprovalRequestType(request);
  if (isExecutedPendingApproval({ ...request, type })) return false;
  if (EXECUTABLE_APPROVAL_TYPES.has(type)) return true;
  const requestData = parseRequestData(request?.request_data);
  return type === 'manual_adjustment' && requestData.kind === 'refund_dispute_writeoff';
}

function approvalInitialExecutionStatus(type: string): 'pending' | 'not_required' {
  return EXECUTABLE_APPROVAL_TYPES.has(canonicalApprovalType(type)) ? 'pending' : 'not_required';
}

function receivableWriteOffReviewError(error: unknown): { status: 400 | 409 | 500; message: string } {
  if (error instanceof HTTPException) {
    return {
      status: error.status >= 400 && error.status < 500 ? error.status as 400 | 409 : 500,
      message: error.message,
    };
  }
  if (error instanceof ReceivableWriteOffExecutionConflictError) {
    return { status: 409, message: error.message };
  }
  if (error instanceof ReceivableWriteOffExecutionError || error instanceof RangeError) {
    return { status: 409, message: error.message };
  }
  return {
    status: 500,
    message: error instanceof Error ? error.message : 'Receivable write-off review failed',
  };
}

type ApprovalEvidenceStatus = 'not_required' | 'provided' | 'missing';
type ApprovalRiskLevel = 'low' | 'medium' | 'high';

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
];

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
    && firstFiniteNumber(requestData.variance, requestData.receiverVariance, requestData.receiver_variance) !== undefined
    && Boolean(requestData.receivedAt || requestData.received_at || requestData.receivedBy || requestData.received_by);
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

function approvalEvidenceStatus(request: any): ApprovalEvidenceStatus {
  if (!approvalEvidenceRequired(request)) return 'not_required';
  const requestData = parseRequestData(request?.request_data);
  if (canonicalApprovalRequestType(request) === 'cash_handover' && hasSystemCashHandoverEvidence(requestData)) {
    return 'provided';
  }
  return hasApprovalEvidence(requestData) ? 'provided' : 'missing';
}

function approvalAssignedRole(request: any): string {
  const type = canonicalApprovalRequestType(request);
  const risk = approvalRisk(request);
  if (risk === 'high') return 'hospital_admin';
  if (type === 'expense' || type === 'refund' || type === 'doctor_payout' || type === 'credit_note') return 'accountant';
  if (type === 'discount') return 'manager';
  if (type === 'cash_handover') return 'hospital_admin';
  return 'manager';
}

function approvalPolicyReason(request: any): string {
  const type = canonicalApprovalRequestType(request);
  const amount = Math.abs(approvalAmount(request));
  const requestData = parseRequestData(request?.request_data);
  const variance = firstFiniteNumber(requestData.variance, requestData.cashVariance, requestData.receiverVariance, requestData.receiver_variance);

  if (type === 'cash_handover' && variance !== undefined && variance !== 0) return 'Cash variance requires admin verification';
  if (type === 'cash_handover') return 'Cash handover requires final admin verification';
  if (type === 'payment_void') return 'Payment void requires audited reversal approval';
  if (type === 'refund') return 'Refund requires maker-checker approval';
  if (type === 'expense') return 'Expense requires receipt and accounts approval';
  if (type === 'stock_adjustment') return 'Stock adjustment requires inventory review';
  if (type === 'doctor_payout') return 'Doctor payout requires accounts review';
  if (type === 'manual_adjustment') return 'Manual adjustment is a high-control action';
  if (type === 'credit_note') return 'Credit note requires refund/write-off approval';
  if (type === 'bill_cancel') return 'Bill cancellation requires financial audit review';
  if (amount >= 10000) return 'Amount is above high-risk approval threshold';
  if (amount >= 3000) return 'Amount is above medium-risk approval threshold';
  return 'Standard approval policy matched';
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

function enrichApprovalRow<T extends Record<string, any>>(item: T): T & {
  approval_amount: number;
  approval_risk: ApprovalRiskLevel;
  bulk_approve_allowed: boolean;
  approval_note_required: boolean;
  evidence_required: boolean;
  evidence_status: ApprovalEvidenceStatus;
  policy_reason: string;
  sla_minutes: number;
  sla_due_at: string | null;
  assigned_role: string;
  execution_status: string;
  execution_attempts: number;
  approval_count: number;
  required_approvals: number;
  remaining_approvals: number;
  approval_stage: string;
} {
  const requestData = parseRequestData(item.request_data);
  const normalized = {
    ...item,
    type: publicApprovalType(canonicalApprovalType(item.type), requestData),
    request_data: requestData,
  };
  const stage = approvalStage(
    String(normalized.status ?? 'pending'),
    Number(normalized.approval_count ?? 0),
    Number(normalized.required_approvals ?? 2),
  );
  return {
    ...normalized,
    status: stage.status,
    approval_amount: approvalAmount(normalized),
    approval_risk: approvalRisk(normalized),
    bulk_approve_allowed: isBulkApproveAllowed(normalized),
    approval_note_required: approvalRequiresApprovalNote(normalized, 'approve'),
    evidence_required: approvalEvidenceRequired(normalized),
    evidence_status: approvalEvidenceStatus(normalized),
    policy_reason: approvalPolicyReason(normalized),
    sla_minutes: approvalSlaMinutes(normalized),
    sla_due_at: approvalSlaDueAt(normalized),
    assigned_role: approvalAssignedRole(normalized),
    execution_status: normalized.execution_status ?? approvalInitialExecutionStatus(normalized.type),
    execution_attempts: Number(normalized.execution_attempts ?? 0),
    approval_count: stage.approvalCount,
    required_approvals: stage.requiredApprovals,
    remaining_approvals: stage.remainingApprovals,
    approval_stage: stage.label,
  } as T & {
    approval_amount: number;
    approval_risk: ApprovalRiskLevel;
    bulk_approve_allowed: boolean;
    approval_note_required: boolean;
    evidence_required: boolean;
    evidence_status: ApprovalEvidenceStatus;
    policy_reason: string;
    sla_minutes: number;
    sla_due_at: string | null;
    assigned_role: string;
    execution_status: string;
    execution_attempts: number;
    approval_count: number;
    required_approvals: number;
    remaining_approvals: number;
    approval_stage: string;
  };
}

function approvalSearchMatches(request: any, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const requestData = parseRequestData(request?.request_data);
  const haystack = [
    request?.id,
    request?.entity_id,
    request?.entity_no,
    request?.approval_source,
    canonicalApprovalRequestType(request),
    requestData.reason,
    requestData.note,
    requestData.remarks,
    requestData.patientName,
    requestData.doctorName,
    requestData.requestedBy,
    requestData.requesterName,
    requestData.cashierName,
    requestData.receiverName,
    requestData.department,
    requestData.sourceDepartment,
    requestData.referenceNo,
    requestData.expenseNo,
    requestData.category,
    requestData.payeeName,
    requestData.invoiceNo,
    requestData.receiptNo,
    requestData.billNo,
    requestData.handoverNo,
  ].filter((value) => value !== undefined && value !== null).join(' ').toLowerCase();
  return haystack.includes(q);
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

function approvalAgeMinutes(request: any): number {
  const createdAt = request?.created_at;
  if (!createdAt) return 0;
  const parsed = new Date(String(createdAt)).getTime();
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round((Date.now() - parsed) / 60000));
}

function isApprovalDecisionBlocked(request: any): boolean {
  return String(request?.execution_status ?? '') === 'failed'
    || request?.info_request_status === 'requested';
}

function isApprovalActionable(request: any): boolean {
  return ['pending', 'partially_approved'].includes(String(request?.status))
    && !isApprovalDecisionBlocked(request);
}

type ApprovalQueueFilter = 'high' | 'sla_breached' | 'due_soon' | 'blocked' | 'missing_evidence' | 'info_requested';

function approvalQueueFilterMatches(request: any, filter?: ApprovalQueueFilter): boolean {
  if (!filter) return true;
  if (filter === 'high') return request?.approval_risk === 'high' || isHighRiskApproval(request);
  if (filter === 'sla_breached') return isApprovalSlaBreached(request);
  if (filter === 'due_soon') return isApprovalDueSoon(request);
  if (filter === 'blocked') return isApprovalDecisionBlocked(request);
  if (filter === 'missing_evidence') return request?.evidence_status === 'missing';
  if (filter === 'info_requested') return request?.info_request_status === 'requested';
  return true;
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

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function isHeldRefundKind(value: unknown): boolean {
  return HELD_REFUND_KINDS.has(String(value ?? ''));
}

function readAmountBasedRefund(requestData: Record<string, unknown>): number {
  const rawAmount = Number(requestData.requestedRefundAmount);
  if (!Number.isFinite(rawAmount)) throw new Error('Refund amount must be a valid number');
  const amount = roundMoney(rawAmount);
  if (amount <= 0) throw new Error('Refund amount must be greater than zero');
  return amount;
}

function allocationInputsFromRequest(requestData: Record<string, unknown>): RefundAllocationInput[] {
  if (!Array.isArray(requestData.items)) return [];
  return requestData.items.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const invoiceItemId = Number(item.invoiceItemId ?? item.invoice_item_id);
    const allocatedRefundAmount = Number(item.allocatedRefundAmount ?? item.allocated_refund_amount);
    if (!Number.isInteger(invoiceItemId) || invoiceItemId <= 0 || !Number.isFinite(allocatedRefundAmount)) return [];
    return [{
      invoiceItemId,
      allocatedRefundAmount,
      allocationSource: item.allocationSource === 'auto' ? 'auto' as const : 'requester_adjusted' as const,
    }];
  });
}

async function resolveAmountRefundAllocation(
  db: Env['DB'],
  input: {
    tenantId: string;
    billId: number;
    requestData: Record<string, unknown>;
    excludeApprovalRequestId?: number;
  },
): Promise<{ totalRefund: number; items: RefundAllocatedItem[] }> {
  const totalRefund = readAmountBasedRefund(input.requestData);
  const allocationItems = await loadRefundAllocationItems(db, input.tenantId, input.billId, {
    excludeApprovalRequestId: input.excludeApprovalRequestId,
  });
  const supplied = allocationInputsFromRequest(input.requestData);
  if (supplied.length > 0) {
    return validateRefundAllocation(allocationItems, totalRefund, supplied);
  }
  const items = calculateProportionalRefundAllocation(allocationItems, totalRefund)
    .filter((item) => item.allocatedRefundAmount > 0);
  return { totalRefund, items };
}

function refundAllocationRequestItems(items: RefundAllocatedItem[]): Array<Record<string, unknown>> {
  return items.map((item) => ({
    invoiceItemId: item.invoiceItemId,
    description: item.description,
    itemCategory: item.itemCategory,
    lineIndex: item.lineIndex,
    referenceId: item.referenceId,
    refundableAmount: item.refundableBalance,
    allocatedRefundAmount: item.allocatedRefundAmount,
    allocationSource: item.allocationSource,
  }));
}

function storedAmountRefundAllocations(requestData: Record<string, unknown>): RefundAllocatedItem[] {
  if (!Array.isArray(requestData.items)) return [];
  return requestData.items.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const invoiceItemId = Number(item.invoiceItemId);
    const allocatedRefundAmount = Number(item.allocatedRefundAmount);
    const refundableBalance = Number(item.refundableAmount ?? item.refundableBalance);
    const lineIndex = Number(item.lineIndex);
    if (!Number.isInteger(invoiceItemId) || invoiceItemId <= 0
      || !Number.isFinite(allocatedRefundAmount) || allocatedRefundAmount <= 0
      || !Number.isFinite(refundableBalance) || refundableBalance <= 0
      || !Number.isInteger(lineIndex) || lineIndex <= 0) return [];
    return [{
      invoiceItemId,
      description: String(item.description ?? `Invoice item #${invoiceItemId}`),
      itemCategory: String(item.itemCategory ?? 'other'),
      lineAmount: refundableBalance,
      approvedCreditAmount: 0,
      pendingAllocatedAmount: 0,
      refundableBalance,
      referenceId: item.referenceId == null ? null : Number(item.referenceId),
      lineIndex,
      allocatedRefundAmount: roundMoney(allocatedRefundAmount),
      allocationSource: item.allocationSource === 'requester_adjusted' ? 'requester_adjusted' as const : 'auto' as const,
    }];
  });
}

async function recordApprovalEvent(
  db: Env['DB'],
  tenantId: string,
  approvalRequestId: number,
  action: ApprovalEventAction,
  actorId: string | number | null | undefined,
  oldStatus: string | null,
  newStatus: string | null,
  notes?: string | null,
  metadata?: Record<string, unknown>,
) {
  await d1WithRetry(
    () => db.prepare(`
      INSERT INTO approval_events
        (tenant_id, approval_request_id, action, actor_id, old_status, new_status, notes, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      approvalRequestId,
      action,
      actorId != null ? Number(actorId) : null,
      oldStatus,
      newStatus,
      notes || null,
      metadata ? JSON.stringify(metadata) : null,
    ).run(),
    { label: `approval event ${action} #${approvalRequestId}` },
  );
}

type ApprovalInfoRequestStatus = 'not_requested' | 'requested' | 'submitted';

type ApprovalInfoState = {
  info_request_status: ApprovalInfoRequestStatus;
  info_requested_at: string | null;
  info_requested_by: number | null;
  info_request_note: string | null;
  info_missing_items: string[];
  info_submitted_at: string | null;
  info_submitted_by: number | null;
  info_response_note: string | null;
};

const EMPTY_INFO_STATE: ApprovalInfoState = {
  info_request_status: 'not_requested',
  info_requested_at: null,
  info_requested_by: null,
  info_request_note: null,
  info_missing_items: [],
  info_submitted_at: null,
  info_submitted_by: null,
  info_response_note: null,
};

function normalizeMissingItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 20);
}

function deriveApprovalInfoState(events: any[]): ApprovalInfoState {
  let latestRequest: any | null = null;
  let latestRequestOrder = -1;
  let latestSubmission: any | null = null;
  let latestSubmissionOrder = -1;
  events.forEach((event, index) => {
    if (event.action === 'request_info') {
      latestRequest = event;
      latestRequestOrder = index;
    }
    if (event.action === 'info_submitted') {
      latestSubmission = event;
      latestSubmissionOrder = index;
    }
  });
  if (!latestRequest) return { ...EMPTY_INFO_STATE };
  const requestMetadata = parseRequestData(latestRequest.metadata);
  const submittedAfterRequest = latestSubmission && latestSubmissionOrder > latestRequestOrder;
  return {
    info_request_status: submittedAfterRequest ? 'submitted' : 'requested',
    info_requested_at: latestRequest.created_at ?? null,
    info_requested_by: latestRequest.actor_id != null ? Number(latestRequest.actor_id) : null,
    info_request_note: latestRequest.notes ?? null,
    info_missing_items: normalizeMissingItems(requestMetadata.missingItems),
    info_submitted_at: submittedAfterRequest ? latestSubmission.created_at ?? null : null,
    info_submitted_by: submittedAfterRequest && latestSubmission.actor_id != null ? Number(latestSubmission.actor_id) : null,
    info_response_note: submittedAfterRequest ? latestSubmission.notes ?? null : null,
  };
}

async function loadApprovalInfoStates(db: Env['DB'], tenantId: string, approvalIds: Array<number | string | null | undefined>): Promise<Map<number, ApprovalInfoState>> {
  const ids = Array.from(new Set(approvalIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
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
    { label: 'approval info request states' },
  );
  const grouped = new Map<number, any[]>();
  for (const event of results ?? []) {
    const approvalId = Number((event as any).approval_request_id);
    if (!grouped.has(approvalId)) grouped.set(approvalId, []);
    grouped.get(approvalId)!.push(event);
  }
  for (const id of ids) {
    states.set(id, deriveApprovalInfoState(grouped.get(id) ?? []));
  }
  return states;
}

function appendInfoState<T extends Record<string, any>>(row: T, infoStates: Map<number, ApprovalInfoState>): T & ApprovalInfoState {
  return { ...row, ...(infoStates.get(Number(row.id)) ?? EMPTY_INFO_STATE) } as T & ApprovalInfoState;
}

type SourceApprovalDecisionState = {
  approvalCount: number;
  currentUserApproved: boolean;
};

async function loadSourceApprovalDecisionStates(
  db: Env['DB'],
  tenantId: string,
  approvalSource: string,
  approvalIds: Array<number | string | null | undefined>,
  currentUserId: number,
): Promise<Map<number, SourceApprovalDecisionState>> {
  const ids = Array.from(new Set(
    approvalIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0),
  ));
  const states = new Map<number, SourceApprovalDecisionState>();
  if (ids.length === 0) return states;

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await d1WithRetry(
    () => db.prepare(`
      SELECT approval_request_id, approver_id
      FROM approval_decisions
      WHERE tenant_id = ?
        AND approval_source = ?
        AND approval_revision = 1
        AND decision = 'approve'
        AND superseded_at IS NULL
        AND approval_request_id IN (${placeholders})
      ORDER BY approval_request_id ASC, id ASC
    `).bind(tenantId, approvalSource, ...ids).all(),
    { label: `approval decision states for ${approvalSource}` },
  );

  for (const id of ids) states.set(id, { approvalCount: 0, currentUserApproved: false });
  for (const decision of results ?? []) {
    const approvalId = Number((decision as any).approval_request_id);
    const state = states.get(approvalId);
    if (!state) continue;
    state.approvalCount += 1;
    if (Number((decision as any).approver_id) === currentUserId) state.currentUserApproved = true;
  }
  return states;
}

function mergeSubmittedInfoIntoRequestData(requestData: Record<string, unknown>, submission: any): Record<string, unknown> {
  const next = { ...requestData };
  if (submission.notes?.trim()) next.infoResponseNote = submission.notes.trim();
  if (submission.missingItems?.length) next.infoMissingItems = submission.missingItems;
  if (submission.attachmentUrl?.trim()) next.attachmentUrl = submission.attachmentUrl.trim();
  if (submission.receiptUrl?.trim()) next.receiptUrl = submission.receiptUrl.trim();
  if (submission.documentUrl?.trim()) next.documentUrl = submission.documentUrl.trim();
  if (submission.evidenceUrl?.trim()) next.evidenceUrl = submission.evidenceUrl.trim();
  if (submission.evidence && Object.keys(submission.evidence).length > 0) {
    next.evidence = { ...(parseRequestData(next.evidence)), ...submission.evidence };
  }
  return next;
}

async function loadUserDisplayNames(db: Env['DB'], tenantId: string, ids: Array<string | number | null | undefined>) {
  const uniqueIds = Array.from(new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) return new Map<number, string>();
  const placeholders = uniqueIds.map(() => '?').join(',');
  const { results } = await d1WithRetry(
    () => db.prepare(`
      SELECT id, name, email, role
      FROM users
      WHERE id IN (${placeholders})
        AND tenant_id = ?
    `).bind(...uniqueIds, tenantId).all(),
    { label: 'approval user display names' },
  );
  const map = new Map<number, string>();
  for (const row of results ?? []) {
    const user = row as any;
    const label = [user.name, user.role].filter(Boolean).join(' • ') || user.email || `User #${user.id}`;
    map.set(Number(user.id), label);
  }
  return map;
}

type ApprovalRefundCashHoldView = {
  id: number;
  amount: number;
  status: string;
  counter_session_id: number;
  cash_return_eligible: boolean;
  held_at: string | null;
  consumed_at: string | null;
  released_at: string | null;
  credit_note_id: number | null;
};

async function loadRefundCashHoldsForApprovals(
  db: Env['DB'],
  tenantId: string,
  approvalIds: Array<string | number | null | undefined>,
): Promise<Map<number, ApprovalRefundCashHoldView>> {
  const ids = Array.from(new Set(approvalIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  try {
    const { results } = await d1WithRetry(
      () => db.prepare(`
        SELECT id, approval_request_id, amount, status, counter_id, counter_session_id,
               employee_id, held_at, consumed_at, released_at, credit_note_id
        FROM billing_refund_cash_holds
        WHERE tenant_id = ? AND approval_request_id IN (${placeholders})
      `).bind(tenantId, ...ids).all(),
      { label: 'approval refund cash holds' },
    );
    const holds = (results ?? []).map((row) => row as any);
    const eligibleSessions = await loadEligibleExecutedRefundCashReturnSessions(
      db,
      tenantId,
      holds
        .filter((hold) => String(hold.status ?? '') === 'consumed')
        .map((hold) => ({
          counterSessionId: Number(hold.counter_session_id ?? 0),
          counterId: Number(hold.counter_id ?? 0),
          employeeId: Number(hold.employee_id ?? 0),
        })),
    );
    const map = new Map<number, ApprovalRefundCashHoldView>();
    for (const hold of holds) {
      const counterId = Number(hold.counter_id ?? 0);
      const counterSessionId = Number(hold.counter_session_id ?? 0);
      const employeeId = Number(hold.employee_id ?? 0);
      const eligibleSession = eligibleSessions.get(counterSessionId);
      map.set(Number(hold.approval_request_id), {
        id: Number(hold.id),
        amount: Number(hold.amount ?? 0),
        status: String(hold.status ?? ''),
        counter_session_id: counterSessionId,
        cash_return_eligible: String(hold.status ?? '') === 'consumed'
          && eligibleSession?.counterId === counterId
          && eligibleSession.employeeId === employeeId,
        held_at: hold.held_at ?? null,
        consumed_at: hold.consumed_at ?? null,
        released_at: hold.released_at ?? null,
        credit_note_id: hold.credit_note_id == null ? null : Number(hold.credit_note_id),
      });
    }
    return map;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table: billing_refund_cash_holds|D1_ERROR.*billing_refund_cash_holds/i.test(message)) return new Map();
    throw error;
  }
}

function toExpenseApproval(row: any) {
  const amount = Number(row.amount ?? 0);
  const receiptStatus = row.receipt_status ?? (row.receipt_key ? 'uploaded' : 'not_uploaded');
  const expenseNo = row.expense_no || `EXP-${row.id}`;
  const createdBy = Number(row.created_by ?? 0);
  return {
    id: Number(row.id),
    approval_key: `expenses:${row.id}`,
    approval_source: 'expenses',
    type: 'expense',
    entity_id: Number(row.id),
    entity_no: expenseNo,
    requested_by: createdBy,
    requested_by_name: row.created_by_name || undefined,
    reviewed_by: row.approved_by ?? null,
    reviewed_by_name: row.approved_by_name || undefined,
    status: String(row.approval_status ?? row.status ?? 'pending'),
    created_at: row.created_at || row.date,
    reviewed_at: row.approved_at ?? null,
    updated_at: row.updated_at ?? row.approved_at ?? null,
    request_data: {
      source: 'expenses',
      sourceModule: 'Expense Management',
      expenseId: Number(row.id),
      expenseNo,
      amount,
      category: row.category ?? null,
      payeeName: row.payee_name ?? row.payeeName ?? null,
      requestedBy: row.created_by_name ?? (createdBy ? `User #${createdBy}` : undefined),
      department: 'Cash & Finance',
      reason: row.description || row.category || 'Expense approval',
      description: row.description ?? null,
      date: row.date ?? null,
      receiptStatus,
      paymentStatus: row.payment_status ?? 'unpaid',
      cashAlreadyMoved: row.payment_status === 'paid',
      recoveryStatus: row.recovery_status ?? 'not_required',
      recoveryAmount: Number(row.recovery_amount ?? 0),
      recoveryNote: row.recovery_note ?? null,
      attachmentUrl: row.receipt_url ?? null,
      referenceNo: expenseNo,
    },
    approval_amount: amount,
    approval_risk: amount >= 10000 ? 'high' : amount >= 3000 ? 'medium' : 'low',
    bulk_approve_allowed: false,
    approval_note_required: amount >= 3000 || receiptStatus === 'not_uploaded' || receiptStatus === 'rejected',
    execution_status: 'not_required',
    execution_attempts: 0,
  };
}

async function loadExpenseApprovalRows(
  db: Env['DB'],
  tenantId: string,
  status: string = 'pending',
  reviewedDate?: string,
  createdWindow: ApprovalCreatedWindow = {},
) {
  const statusFilter = status === 'all' ? "IN ('pending', 'approved', 'rejected')" : '= ?';
  const params: unknown[] = status === 'all' ? [tenantId] : [tenantId, status];
  const reviewedDateCondition = reviewedDate
    ? " AND COALESCE(e.approval_status, e.status) IN ('approved', 'rejected') AND substr(e.approved_at, 1, 10) = ?"
    : '';
  if (reviewedDate) params.push(reviewedDate);
  const expenseCreatedWindow = approvalCreatedWindowSql(
    "COALESCE(e.created_at, e.date || ' 00:00:00')",
    createdWindow,
  );
  params.push(...expenseCreatedWindow.params);
  const { results } = await d1WithRetry(
    () => db.prepare(`
      SELECT
        e.*,
        COALESCE(e.receipt_status, CASE WHEN e.receipt_key IS NULL THEN 'not_uploaded' ELSE 'uploaded' END) AS receipt_status,
        u_creator.name AS created_by_name,
        u_approver.name AS approved_by_name
      FROM expenses e
      LEFT JOIN users u_creator ON e.created_by = u_creator.id
      LEFT JOIN users u_approver ON e.approved_by = u_approver.id
      WHERE e.tenant_id = ?
        AND COALESCE(e.approval_status, e.status) ${statusFilter}
        ${reviewedDateCondition}
        ${expenseCreatedWindow.sql}
      ORDER BY COALESCE(e.approved_at, e.created_at, e.date) DESC, e.id DESC
      ${reviewedDate ? '' : 'LIMIT 500'}
    `).bind(...params).all(),
    { label: `approval center expenses ${status}` },
  );
  return (results ?? [])
    .map(toExpenseApproval)
    .filter((row) => approvalCreatedAtMatchesWindow(row.created_at, createdWindow));
}

async function markApprovalExecutionStarted(db: Env['DB'], tenantId: string, approvalRequestId: number, actorId: string | number) {
  const result = await d1WithRetry(
    () => db.prepare(`
      UPDATE approval_requests
      SET execution_status = 'processing',
          execution_started_at = datetime('now', '+6 hours'),
          execution_error = NULL,
          execution_attempts = COALESCE(execution_attempts, 0) + 1,
          locked_by = ?,
          locked_at = datetime('now', '+6 hours')
      WHERE id = ?
        AND tenant_id = ?
        AND status = 'approved'
        AND COALESCE(approval_count, 0) >= COALESCE(required_approvals, 2)
        AND COALESCE(execution_status, 'not_required') IN ('not_required', 'pending', 'failed')
    `).bind(actorId, approvalRequestId, tenantId).run(),
    { label: `approval execution start #${approvalRequestId}` },
  );
  return Number(result.meta?.changes ?? 0) === 1;
}

async function markApprovalExecutionSucceeded(db: Env['DB'], tenantId: string, approvalRequestId: number) {
  await d1WithRetry(
    () => db.prepare(`
      UPDATE approval_requests
      SET execution_status = 'succeeded',
          execution_completed_at = datetime('now', '+6 hours'),
          execution_error = NULL,
          locked_by = NULL,
          locked_at = NULL
      WHERE id = ? AND tenant_id = ?
    `).bind(approvalRequestId, tenantId).run(),
    { label: `approval execution succeeded #${approvalRequestId}` },
  );
}

async function markApprovalExecutionFailed(db: Env['DB'], tenantId: string, approvalRequestId: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await d1WithRetry(
    () => db.prepare(`
      UPDATE approval_requests
      SET execution_status = 'failed',
          execution_completed_at = datetime('now', '+6 hours'),
          execution_error = ?,
          locked_by = NULL,
          locked_at = NULL
      WHERE id = ? AND tenant_id = ?
    `).bind(message.slice(0, 1000), approvalRequestId, tenantId).run(),
    { label: `approval execution failed #${approvalRequestId}` },
  );
  return message;
}

type FinalHandoverApprovalStatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

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
  db: Env['DB'],
  tenantId: string,
  status: FinalHandoverApprovalStatusFilter = 'pending',
  reviewedDate?: string,
  createdWindow: ApprovalCreatedWindow = {},
) {
  const conditions = [`h.tenant_id = ?`, `h.handover_type = 'counter'`];
  const params: unknown[] = [tenantId];
  const discrepancyExpression = `ROUND(CASE WHEN h.receiver_counted_amount IS NOT NULL THEN h.receiver_counted_amount - (h.handover_amount - COALESCE(h.due_amount, 0)) ELSE COALESCE(h.receiver_variance, 0) END, 2)`;
  const missingReceiverEvidenceExpression = `(h.received_by IS NULL OR h.receiver_counted_amount IS NULL)`;
  const pendingCondition = `(h.status IN ('receiver_verified', 'disputed') AND COALESCE(h.admin_verification_status, 'pending_admin') = 'pending_admin' AND (h.status = 'disputed' OR ${discrepancyExpression} != 0 OR ${missingReceiverEvidenceExpression}))`;
  const approvedCondition = `(h.status = 'received' AND (h.admin_verification_status = 'verified' OR (h.admin_verification_status IS NULL AND ${discrepancyExpression} = 0 AND NOT ${missingReceiverEvidenceExpression})))`;
  const rejectedCondition = `(h.admin_verification_status = 'rejected')`;

  if (status === 'pending') {
    conditions.push(pendingCondition);
  } else if (status === 'approved') {
    conditions.push(approvedCondition);
  } else if (status === 'rejected') {
    conditions.push(rejectedCondition);
  } else {
    conditions.push(`(${pendingCondition} OR ${approvedCondition} OR ${rejectedCondition})`);
  }

  if (reviewedDate) {
    conditions.push("h.admin_verification_status IN ('verified', 'rejected')");
    conditions.push('substr(h.admin_verified_at, 1, 10) = ?');
    params.push(reviewedDate);
  }

  const handoverCreatedWindow = approvalCreatedWindowSql('h.created_at', createdWindow);
  if (handoverCreatedWindow.sql) {
    conditions.push(handoverCreatedWindow.sql.replace(/^ AND /, ''));
    params.push(...handoverCreatedWindow.params);
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
        h.created_at,
        by_user.name AS handover_by_name,
        to_user.name AS handover_to_name,
        receiver_user.name AS received_by_name,
        admin_user.name AS admin_verified_by_name
      FROM billing_handovers h
      LEFT JOIN users by_user ON by_user.id = h.handover_by AND by_user.tenant_id = h.tenant_id
      LEFT JOIN users to_user ON to_user.id = h.handover_to AND to_user.tenant_id = h.tenant_id
      LEFT JOIN users receiver_user ON receiver_user.id = h.received_by AND receiver_user.tenant_id = h.tenant_id
      LEFT JOIN users admin_user ON admin_user.id = h.admin_verified_by AND admin_user.tenant_id = h.tenant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(h.admin_verified_at, h.created_at) DESC, h.id DESC
    `).bind(...params).all(),
    { label: 'loadFinalHandoverRows' },
  );
  return ((results ?? []) as any[])
    .filter((row) => finalHandoverMatchesStatus(row, status))
    .filter((row) => approvalCreatedAtMatchesWindow(row.created_at, createdWindow));
}

function toFinalHandoverApproval(row: any) {
  const expectedAmount = roundMoney(Math.max(0, Number(row.handover_amount || 0) - Number(row.due_amount || 0)));
  const countedAmount = roundMoney(Number(row.receiver_counted_amount ?? expectedAmount));
  const variance = row.receiver_counted_amount !== null && row.receiver_counted_amount !== undefined
    ? roundMoney(countedAmount - expectedAmount)
    : roundMoney(Number(row.receiver_variance ?? 0));
  const adminStatus = row.admin_verification_status == null ? null : String(row.admin_verification_status);
  const autoCompleted = String(row.status ?? '') === 'received' && adminStatus === null && variance === 0;
  const status = adminStatus === 'verified' || autoCompleted ? 'approved' : adminStatus === 'rejected' ? 'rejected' : 'pending';
  const requestedByName = row.handover_by_name || (row.handover_by != null ? `User #${row.handover_by}` : undefined);
  const handoverToName = row.handover_to_name || (row.handover_to != null ? `User #${row.handover_to}` : undefined);
  const receiverName = row.received_by_name || (row.received_by != null ? `User #${row.received_by}` : undefined);
  const adminName = row.admin_verified_by_name || (row.admin_verified_by != null ? `User #${row.admin_verified_by}` : undefined);
  const reason = status === 'approved'
    ? autoCompleted
      ? 'Cash handover completed with no variance; admin approval was not required'
      : 'Cash handover admin final verification completed'
    : status === 'rejected'
      ? 'Cash handover rejected for receiver recount'
      : 'Cash variance/dispute requires admin decision';

  return {
    id: Number(row.id),
    tenant_id: row.tenant_id,
    approval_key: `billing_handovers:${row.id}`,
    approval_source: 'billing_handovers',
    type: 'cash_handover',
    entity_id: Number(row.id),
    entity_no: `HANDOVER-${row.id}`,
    requested_by: row.handover_by ?? null,
    requested_by_name: requestedByName,
    reviewed_by: status === 'pending' || autoCompleted ? null : row.admin_verified_by ?? null,
    reviewed_by_name: status === 'pending' ? null : autoCompleted ? receiverName : adminName,
    request_data: {
      amount: countedAmount,
      expectedAmount,
      countedAmount,
      variance,
      dueAmount: Number(row.due_amount || 0),
      handoverType: row.handover_type ?? null,
      handoverTo: row.handover_to ?? null,
      handoverToName,
      receivedBy: row.received_by ?? null,
      receivedAt: row.received_at ?? null,
      requestedBy: requestedByName,
      requesterName: requestedByName,
      cashierName: requestedByName,
      receiverName,
      toUserName: handoverToName || receiverName,
      reviewedBy: autoCompleted ? receiverName : adminName,
      approvalRequired: !autoCompleted,
      decisionType: autoCompleted ? 'auto_completed' : status === 'pending' ? 'admin_review_pending' : `admin_${status}`,
      department: 'Cash Control',
      reason,
    },
    status,
    created_at: row.created_at ?? null,
    reviewed_at: status === 'pending' ? null : autoCompleted ? row.received_at ?? row.created_at ?? null : row.admin_verified_at ?? null,
  };
}

async function loadPendingFinalHandoverRows(db: Env['DB'], tenantId: string) {
  return loadFinalHandoverRows(db, tenantId, 'pending');
}

/** Result of a bill-cancel approval side effect. Returned so the review endpoint can tell the admin what happened. */
export type BillCancelSideEffectResult =
  | { kind: 'cancelled' }
  | {
      kind: 'converted_to_credit_note';
      creditNoteId: number;
      creditNoteNo: string;
      totalRefund: number;
      requestTimeApprovalId?: number;
      requestTimeCashHoldId?: number;
      executedRequestData?: Record<string, unknown>;
    }
  | { kind: 'refund_dispute_written_off'; disputeId: number; amount: number; accountingSourceEventKey: string }
  | {
      kind: 'receivable_write_off_executed';
      adjustmentPublicId: string;
      newDueMinor: number;
      currencyCode: string;
      collectionStatus: string;
    };

/**
 * Create a draft credit note covering every non-cancelled invoice item on the bill.
 * Used by `executeBillCancellationApproval` to auto-convert a bill_cancel request
 * for a paid bill, so the admin doesn't have to do it manually.
 *
 * The credit note is left in `pending` state so the admin can review and approve it
 * (which is where the actual cash refund / receivable reduction happens). This keeps
 * the "auto-convert" semantics narrow: the original bill_cancel request is satisfied,
 * and the next step (credit note approval) is a visible, audit-logged admin action.
 */
async function createCreditNoteFromBillCancel(
  env: Env,
  tenantId: string,
  userId: string,
  billId: number,
  reason: string,
  sourceLabel = 'bill-cancel approval',
  initialStatus = 'pending',
): Promise<{ creditNoteId: number; creditNoteNo: string; totalRefund: number }> {
  const bill = await d1WithRetry(
    () => env.DB.prepare(
      `SELECT id, patient_id, status FROM bills WHERE id = ? AND tenant_id = ?`,
    ).bind(billId, tenantId).first<{ id: number; patient_id: number; status: string }>(),
    { label: `createCreditNoteFromBillCancel: fetch bill #${billId}` },
  );
  if (!bill) throw new HTTPException(404, { message: `Bill #${billId} not found` });
  if (String(bill.status).toLowerCase() === 'cancelled') {
    throw new HTTPException(409, { message: 'Bill already cancelled' });
  }

  const { results: items } = await d1WithRetry(
    () => env.DB.prepare(`
      SELECT id, description, unit_price, line_total, quantity
      FROM invoice_items
      WHERE bill_id = ? AND tenant_id = ?
        AND COALESCE(status, '') != 'cancelled'
    `).bind(billId, tenantId).all<{
      id: number; description: string; unit_price: number; line_total: number; quantity: number;
    }>(),
    { label: `createCreditNoteFromBillCancel: items #${billId}` },
  );
  if (items.length === 0) {
    throw new HTTPException(409, { message: 'No returnable items on this bill' });
  }

  let totalRefund = 0;
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    const refundableUnit = Number(item.line_total || 0) > 0
      ? Number(item.line_total) / qty
      : Number(item.unit_price || 0);
    totalRefund += Math.round(refundableUnit * qty * 100) / 100;
  }
  totalRefund = roundMoney(totalRefund);

  const cnNo = await getNextSequence(env.DB, tenantId, 'credit_note', 'CN');
  const creditNoteIdLookup = '(SELECT id FROM billing_credit_notes WHERE tenant_id = ? AND credit_note_no = ? LIMIT 1)';
  const enrichedReason = `[Auto from ${sourceLabel}] ${reason}`.slice(0, 500);

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(`
      INSERT INTO billing_credit_notes
        (tenant_id, credit_note_no, bill_id, patient_id, reason, total_amount, refund_amount, payment_mode, remarks, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(tenantId, cnNo, billId, bill.patient_id, enrichedReason, totalRefund, totalRefund, enrichedReason, initialStatus, userId),
  ];

  for (const item of items) {
    const qty = Number(item.quantity || 1);
    const refundableUnit = Number(item.line_total || 0) > 0
      ? Number(item.line_total) / qty
      : Number(item.unit_price || 0);
    const itemTotal = Math.round(refundableUnit * qty * 100) / 100;
    stmts.push(
      env.DB.prepare(`
        INSERT INTO billing_credit_note_items
          (tenant_id, credit_note_id, invoice_item_id, item_name, unit_price, return_quantity, total_amount, remarks)
        VALUES (?, ${creditNoteIdLookup}, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        tenantId,
        cnNo,
        item.id,
        item.description,
        refundableUnit,
        qty,
        itemTotal,
        `Auto-created from ${sourceLabel}`,
      ),
    );
  }

  stmts.push(
    env.DB.prepare(`
      INSERT INTO audit_logs (
        tenant_id, user_id, action, table_name, record_id,
        old_value, new_value, ip_address, user_agent, created_at
      )
      VALUES (?, ?, 'CREATE', 'billing_credit_notes', ${creditNoteIdLookup}, NULL, ?, NULL, NULL, datetime('now', '+6 hours'))
    `).bind(
      tenantId,
      userId,
      tenantId,
      cnNo,
      JSON.stringify({
        action: 'credit_note_auto_created',
        source: sourceLabel,
        creditNoteNo: cnNo,
        billId,
        totalRefund,
        status: initialStatus,
      }),
    ),
  );

  const batchResults = await d1WithRetry(() => env.DB.batch(stmts), {
    label: `createCreditNoteFromBillCancel: batch #${billId}`,
  });
  let creditNoteId = Number((batchResults[0] as any)?.meta?.last_row_id ?? 0);
  if (!creditNoteId) {
    const row = await d1WithRetry(
      () => env.DB.prepare(
        'SELECT id FROM billing_credit_notes WHERE tenant_id = ? AND credit_note_no = ? LIMIT 1',
      ).bind(tenantId, cnNo).first<{ id: number }>(),
      { label: `createCreditNoteFromBillCancel: lookup id #${cnNo}` },
    );
    creditNoteId = Number(row?.id ?? 0);
  }

  return { creditNoteId, creditNoteNo: cnNo, totalRefund };
}

async function completeHeldRefundClinicalSideEffects(
  env: Env,
  input: {
    tenantId: string;
    userId: string;
    billId: number;
    invoiceItemIds: number[];
    reason: string;
  },
): Promise<void> {
  await cancelLabOrderItemsForInvoiceItems(env.DB, {
    tenantId: input.tenantId,
    userId: input.userId,
    invoiceItemIds: input.invoiceItemIds,
    reason: input.reason,
  });
  await cancelRadiologyRequisitionsForInvoiceItems(env.DB, {
    tenantId: input.tenantId,
    userId: input.userId,
    billId: input.billId,
    invoiceItemIds: input.invoiceItemIds,
    reason: input.reason,
  });

  if (input.invoiceItemIds.length === 0) return;
  const placeholders = input.invoiceItemIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT item_category
    FROM invoice_items
    WHERE tenant_id = ?
      AND bill_id = ?
      AND id IN (${placeholders})
  `).bind(input.tenantId, input.billId, ...input.invoiceItemIds).all<{
    item_category: string | null;
  }>();

  const labOrderItemIds = await loadLabOrderItemIdsForInvoiceItems(env.DB, {
    tenantId: input.tenantId,
    invoiceItemIds: input.invoiceItemIds,
  });
  await cancelLabItemCommissions(
    env.DB,
    input.tenantId,
    input.billId,
    labOrderItemIds,
    input.reason,
    input.userId,
  );

  const commissionSourceTypes = Array.from(new Set((results ?? []).flatMap((item) => (
    item.item_category === 'doctor_visit' ? ['consultation_fee'] : []
  ))));
  if (commissionSourceTypes.length > 0) {
    await cancelItemCommissions(
      env.DB,
      input.tenantId,
      input.billId,
      commissionSourceTypes,
      input.reason,
      input.userId,
    );
  }
}

type RequestTimeRefundExecution = {
  idempotencyKey: string;
  requestHash: string;
  entityNo: string | null;
  requesterId: number;
  requestData: Record<string, unknown>;
  bill: any;
  calculation: RefundCalculation;
  amountAllocation: RefundAllocatedItem[];
  commissionImpact: RefundCommissionImpactPreview;
  counterId: number;
  counterSessionId: number;
};

async function executeHeldRefundApproval(
  env: Env,
  request: any,
  tenantId: string,
  userId: string,
  reason: string,
  options: { requestTime?: RequestTimeRefundExecution } = {},
): Promise<BillCancelSideEffectResult> {
  const requestTime = options.requestTime;
  const approvalRequestId = requestTime ? 0 : Number(request.id);
  const sourceReference = requestTime ? requestTime.idempotencyKey : String(approvalRequestId);
  const requestData = requestTime ? { ...requestTime.requestData } : parseRequestData(request.request_data);
  const refundKind = String(requestData.refundKind ?? '');
  const isAmountBasedRefund = refundKind === 'amount_partial_refund';
  const billId = Number(request.entity_id);
  const hold = requestTime
    ? {
        id: 0,
        approvalRequestId: 0,
        billId,
        patientId: Number(requestTime.bill.patient_id),
        amount: Number(requestData.cashRefundAmount ?? 0),
        paymentMethod: 'cash' as const,
        employeeId: requestTime.requesterId,
        counterId: requestTime.counterId,
        counterSessionId: requestTime.counterSessionId,
        status: 'held' as const,
        creditNoteId: null,
        idempotencyKey: requestTime.idempotencyKey,
        heldAt: null,
        consumedAt: null,
        releasedAt: null,
        custodyUserId: null,
        releaseStatus: 'not_applicable' as const,
        releaseCounterSessionId: null,
        releaseCashMovementId: null,
        releaseCreditedAt: null,
      }
    : await loadRefundCashHold(env.DB, tenantId, approvalRequestId);
  if (!hold) {
    throw new HTTPException(409, { message: 'This refund request does not have a cash hold.' });
  }

  const selectedInvoiceItemIds = (Array.isArray(requestData.items) ? requestData.items : [])
    .map((item: any) => Number(item.invoiceItemId))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!requestTime && hold.status === 'released') {
    throw new HTTPException(409, { message: 'This refund cash hold was already released.' });
  }
  if (!requestTime && hold.status === 'consumed') {
    if (!hold.creditNoteId) {
      throw new HTTPException(409, { message: 'Consumed refund hold is missing its credit note reference.' });
    }
    if (!isAmountBasedRefund) {
      await completeHeldRefundClinicalSideEffects(env, {
        tenantId,
        userId,
        billId,
        invoiceItemIds: selectedInvoiceItemIds,
        reason,
      });
    }
    const existingCreditNote = await env.DB.prepare(`
      SELECT id, credit_note_no, COALESCE(refund_amount, total_amount, 0) AS total_refund
      FROM billing_credit_notes
      WHERE tenant_id = ? AND id = ? AND status = 'approved'
      LIMIT 1
    `).bind(tenantId, hold.creditNoteId).first<{ id: number; credit_note_no: string; total_refund: number }>();
    if (!existingCreditNote) {
      throw new HTTPException(409, { message: 'Approved credit note for this consumed hold was not found.' });
    }
    if (isAmountBasedRefund) {
      const storedAllocations = storedAmountRefundAllocations(requestData);
      if (storedAllocations.length > 0) {
        await applyRefundCommissionImpact(env.DB, {
          tenantId,
          billId,
          allocations: storedAllocations,
          creditNoteId: Number(existingCreditNote.id),
          creditNoteNo: String(existingCreditNote.credit_note_no),
          userId,
          eventDate: getTodayGMT6(),
          reason,
        });
      }
    }
    return {
      kind: 'converted_to_credit_note',
      creditNoteId: Number(existingCreditNote.id),
      creditNoteNo: String(existingCreditNote.credit_note_no),
      totalRefund: roundMoney(Number(existingCreditNote.total_refund ?? hold.amount)),
    };
  }

  const bill = requestTime?.bill ?? await d1WithRetry(
    () => env.DB.prepare(`
      SELECT id, patient_id, invoice_no, status, total, paid, due,
             test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill
      FROM bills
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `).bind(tenantId, billId).first<any>(),
    { label: `executeHeldRefundApproval: bill #${billId}` },
  );
  if (!bill) throw new HTTPException(404, { message: 'Associated bill not found' });
  if (!['paid', 'partially_paid', 'final'].includes(String(bill.status ?? ''))) {
    throw new HTTPException(409, { message: `Refund approval requires a finalized bill. Current status: ${bill.status}` });
  }

  let calculation: RefundCalculation | undefined = requestTime?.calculation;
  let amountAllocation: RefundAllocatedItem[] = requestTime?.amountAllocation ?? [];
  let commissionImpact: RefundCommissionImpactPreview = requestTime?.commissionImpact ?? {
    rows: [],
    totalReversal: 0,
    blocked: false,
    blockedReasons: [],
  };
  let commissionReservation: Awaited<ReturnType<typeof loadRefundCommissionReservationPreview>> = null;
  if (requestTime) {
    if (isAmountBasedRefund) {
      requestData.allocationMode = 'auto_proportional_adjustable';
      requestData.allocationVersion = 1;
      requestData.items = refundAllocationRequestItems(amountAllocation);
    }
  } else if (isAmountBasedRefund) {
    try {
      const resolved = await resolveAmountRefundAllocation(env.DB, {
        tenantId,
        billId,
        requestData,
        excludeApprovalRequestId: approvalRequestId,
      });
      calculation = { items: [], totalRefund: resolved.totalRefund };
      amountAllocation = resolved.items;
      requestData.allocationMode = 'auto_proportional_adjustable';
      requestData.allocationVersion = 1;
      requestData.items = refundAllocationRequestItems(amountAllocation);
      commissionReservation = await loadRefundCommissionReservationPreview(
        env.DB,
        tenantId,
        approvalRequestId,
      );
      commissionImpact = commissionReservation?.status === 'held'
        ? commissionReservation
        : await previewRefundCommissionImpact(env.DB, {
          tenantId,
          billId,
          allocations: amountAllocation,
        });
      if (commissionImpact.blocked) {
        throw new Error(commissionImpact.blockedReasons.join('; '));
      }
    } catch (error) {
      throw new HTTPException(409, {
        message: error instanceof Error ? error.message : 'Refund amount allocation is no longer valid',
      });
    }
  } else {
    const refundableItems = await loadRefundableInvoiceItems(env.DB, tenantId, billId, {
      excludeApprovalRequestId: approvalRequestId,
    });
    const rawSelections = Array.isArray(requestData.items) ? requestData.items : [];
    try {
      calculation = calculateRefundSelection(
        refundableItems,
        rawSelections.map((item: any) => ({
          invoiceItemId: Number(item.invoiceItemId),
          returnQuantity: Number(item.returnQuantity),
        })),
      );
    } catch (error) {
      throw new HTTPException(409, {
        message: error instanceof Error ? error.message : 'Refund items are no longer eligible',
      });
    }
  }

  if (!calculation) {
    throw new HTTPException(409, { message: 'Refund calculation could not be resolved.' });
  }
  const originalTotal = roundMoney(Number(bill.total ?? 0));
  const originalPaid = roundMoney(Number(bill.paid ?? 0));
  const totalRefund = roundMoney(calculation.totalRefund);
  if (isAmountBasedRefund && totalRefund >= originalTotal) {
    throw new HTTPException(409, {
      message: 'Amount-based partial refunds must remain below the current bill total. Reject this request and use the full refund flow.',
    });
  }
  if (totalRefund <= 0 || totalRefund > originalTotal) {
    throw new HTTPException(409, { message: 'Bill no longer has enough refundable value for this credit.' });
  }
  if (requestData.requestedRefundAmount != null
    && roundMoney(Number(requestData.requestedRefundAmount)) !== totalRefund) {
    throw new HTTPException(409, {
      message: 'The selected refund value changed after submission; reject the request and submit a new one.',
    });
  }

  const financialImpact = calculateRefundFinancialImpact({
    originalTotal,
    originalPaid,
    totalCredit: totalRefund,
  });
  const { newTotal, newPaid, newDue, cashRefund, receivableReduction } = financialImpact;
  if (cashRefund <= 0) {
    throw new HTTPException(409, {
      message: 'The selected adjustment no longer produces a cash refund; reject it and use the bill-adjustment workflow.',
    });
  }
  if (roundMoney(hold.amount) !== cashRefund) {
    throw new HTTPException(409, {
      message: 'The cash hold amount no longer matches the cash portion of this refund; reject the request and submit a new one.',
    });
  }

  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(env.DB, tenantId, today, isAmountBasedRefund ? 'Amount refund approval' : 'Item refund approval');

  const nextStatus = newTotal <= 0
    ? 'cancelled'
    : newPaid >= newTotal
      ? 'paid'
      : newPaid > 0
        ? 'partially_paid'
        : 'open';
  const creditNoteNo = await getNextSequence(env.DB, tenantId, 'credit_note', 'CN');
  const sourceLabel = isAmountBasedRefund
    ? `manual amount refund ${requestTime ? 'request' : 'approval'} #${sourceReference}`
    : `refund ${requestTime ? 'request' : 'approval'} #${sourceReference}`;
  const creditNoteIdLookup = '(SELECT id FROM billing_credit_notes WHERE tenant_id = ? AND credit_note_no = ? LIMIT 1)';
  const sourceEventKey = createPostingEventKey(
    'credit_note',
    creditNoteNo,
    ACCOUNTING_EVENT_TYPES.creditNoteIssued,
  );

  const categoryTotals = {
    testBill: 0,
    doctorVisitBill: 0,
    admissionBill: 0,
    operationBill: 0,
    medicineBill: 0,
  };
  for (const item of calculation.items) {
    if (item.itemCategory === 'test') categoryTotals.testBill += item.refundAmount;
    else if (item.itemCategory === 'doctor_visit') categoryTotals.doctorVisitBill += item.refundAmount;
    else if (item.itemCategory === 'admission') categoryTotals.admissionBill += item.refundAmount;
    else if (item.itemCategory === 'operation') categoryTotals.operationBill += item.refundAmount;
    else if (item.itemCategory === 'medicine') categoryTotals.medicineBill += item.refundAmount;
  }
  for (const item of amountAllocation) {
    if (item.itemCategory === 'test') categoryTotals.testBill += item.allocatedRefundAmount;
    else if (item.itemCategory === 'doctor_visit') categoryTotals.doctorVisitBill += item.allocatedRefundAmount;
    else if (item.itemCategory === 'admission') categoryTotals.admissionBill += item.allocatedRefundAmount;
    else if (item.itemCategory === 'operation') categoryTotals.operationBill += item.allocatedRefundAmount;
    else if (item.itemCategory === 'medicine') categoryTotals.medicineBill += item.allocatedRefundAmount;
  }
  categoryTotals.testBill = roundMoney(categoryTotals.testBill);
  categoryTotals.doctorVisitBill = roundMoney(categoryTotals.doctorVisitBill);
  categoryTotals.admissionBill = roundMoney(categoryTotals.admissionBill);
  categoryTotals.operationBill = roundMoney(categoryTotals.operationBill);
  categoryTotals.medicineBill = roundMoney(categoryTotals.medicineBill);
  const nextCategoryTotals = {
    testBill: roundMoney(Math.max(0, Number(bill.test_bill ?? 0) - categoryTotals.testBill)),
    doctorVisitBill: roundMoney(Math.max(0, Number(bill.doctor_visit_bill ?? 0) - categoryTotals.doctorVisitBill)),
    admissionBill: roundMoney(Math.max(0, Number(bill.admission_bill ?? 0) - categoryTotals.admissionBill)),
    operationBill: roundMoney(Math.max(0, Number(bill.operation_bill ?? 0) - categoryTotals.operationBill)),
    medicineBill: roundMoney(Math.max(0, Number(bill.medicine_bill ?? 0) - categoryTotals.medicineBill)),
  };

  const executedRequestData = requestTime ? buildExecutedRefundRequestData({
    requestData,
    refundRequestIdempotencyKey: requestTime.idempotencyKey,
    refundRequestHash: requestTime.requestHash,
    totalRefund,
    cashRefund,
    receivableReduction,
    counterId: requestTime.counterId,
    counterSessionId: requestTime.counterSessionId,
    creditNoteNo,
    originalBill: {
      total: originalTotal,
      paid: originalPaid,
      due: Number(bill.due ?? Math.max(0, originalTotal - originalPaid)),
      status: String(bill.status ?? 'paid'),
      testBill: Number(bill.test_bill ?? 0),
      doctorVisitBill: Number(bill.doctor_visit_bill ?? 0),
      admissionBill: Number(bill.admission_bill ?? 0),
      operationBill: Number(bill.operation_bill ?? 0),
      medicineBill: Number(bill.medicine_bill ?? 0),
    },
    refundedBill: {
      total: newTotal,
      paid: newPaid,
      due: newDue,
      status: nextStatus,
      testBill: nextCategoryTotals.testBill,
      doctorVisitBill: nextCategoryTotals.doctorVisitBill,
      admissionBill: nextCategoryTotals.admissionBill,
      operationBill: nextCategoryTotals.operationBill,
      medicineBill: nextCategoryTotals.medicineBill,
    },
  }) : null;
  if (executedRequestData && isAmountBasedRefund) {
    executedRequestData.commissionReservationStatus = commissionImpact.totalReversal > 0 ? 'consumed' : 'not_applicable';
    executedRequestData.commissionReservedAmount = commissionImpact.totalReversal;
    executedRequestData.commissionImpactRows = commissionImpact.rows
      .filter((row) => row.reversalAmount > 0)
      .map((row) => ({
        accrualId: row.accrualId,
        billId,
        oldCommissionBaseAmount: row.oldCommissionBaseAmount,
        oldEarnedCommissionAmount: row.oldEarnedCommissionAmount,
        oldDoctorWaiverAmount: row.oldEarnedCommissionAmount - row.oldPayableCommissionAmount,
        oldPayableCommissionAmount: row.oldPayableCommissionAmount,
        oldBalanceAmount: Math.max(0, row.oldPayableCommissionAmount - row.paidAmount),
        newCommissionBaseAmount: row.newCommissionBaseAmount,
        newEarnedCommissionAmount: row.newEarnedCommissionAmount,
        newDoctorWaiverAmount: row.newDoctorWaiverAmount,
        newPayableCommissionAmount: row.newPayableCommissionAmount,
        newBalanceAmount: row.newBalanceAmount,
        paidAmount: row.paidAmount,
        reversalAmount: row.reversalAmount,
      }));
  }

  const financialOperationKey = `refund-financial:${sourceReference}`;
  const requestTimeStatements: D1PreparedStatement[] = requestTime && executedRequestData ? [
    env.DB.prepare(`
      INSERT INTO approval_requests (
        tenant_id, type, entity_id, entity_no, requested_by,
        request_data, status, execution_status, approval_revision
      ) VALUES (?, 'refund', ?, ?, ?, ?, 'pending', 'succeeded', 1)
    `).bind(
      tenantId,
      billId,
      requestTime.entityNo || bill.invoice_no || null,
      requestTime.requesterId,
      JSON.stringify(executedRequestData),
    ),
    prepareCreateRefundHold(env.DB, {
      tenantId,
      approvalRequestIdLookupSql: `
        SELECT id
        FROM approval_requests
        WHERE tenant_id = ?
          AND type = 'refund'
          AND json_extract(request_data, '$.refundRequestIdempotencyKey') = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      approvalLookupBindings: [tenantId, requestTime.idempotencyKey],
      billId,
      patientId: Number(bill.patient_id),
      amount: cashRefund,
      employeeId: requestTime.requesterId,
      counterId: requestTime.counterId,
      counterSessionId: requestTime.counterSessionId,
      idempotencyKey: requestTime.idempotencyKey,
    }),
  ] : [];
  const holdResolutionColumn = requestTime ? 'idempotency_key' : 'id';
  const holdResolutionValue: string | number = requestTime ? requestTime.idempotencyKey : hold.id;
  const approvalMetadataId = requestTime ? null : approvalRequestId;
  const holdMetadataId = requestTime ? null : hold.id;
  const statements: D1PreparedStatement[] = [
    ...requestTimeStatements,
    env.DB.prepare(`
      INSERT INTO billing_credit_notes (
        tenant_id, credit_note_no, bill_id, patient_id, reason,
        total_amount, refund_amount, payment_mode, remarks, status,
        created_by, approved_by, approved_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, 'approved', ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
    `).bind(
      tenantId,
      creditNoteNo,
      billId,
      Number(bill.patient_id),
      reason,
      totalRefund,
      totalRefund,
      `[Auto from ${sourceLabel}] ${reason}`.slice(0, 500),
      userId,
      userId,
    ),
    prepareRefundBatchAssertion(env.DB, {
      tenantId,
      operationKey: financialOperationKey,
      stepKey: 'credit-note',
      expectedChanges: 1,
    }),
  ];

  for (const item of calculation.items) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO billing_credit_note_items (
          tenant_id, credit_note_id, invoice_item_id, item_name,
          unit_price, return_quantity, total_amount, remarks
        ) VALUES (?, ${creditNoteIdLookup}, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        tenantId,
        creditNoteNo,
        item.invoiceItemId,
        item.description,
        item.refundableUnitAmount,
        item.returnQuantity,
        item.refundAmount,
        `Approved from refund request #${approvalRequestId}`,
      ),
      prepareRefundBatchAssertion(env.DB, {
        tenantId,
        operationKey: financialOperationKey,
        stepKey: `credit-item:${item.invoiceItemId}`,
        expectedChanges: 1,
      }),
    );
  }
  for (const item of amountAllocation) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO billing_credit_note_items (
          tenant_id, credit_note_id, invoice_item_id, item_name,
          unit_price, return_quantity, total_amount, remarks
        ) VALUES (?, ${creditNoteIdLookup}, ?, ?, ?, 0, ?, ?)
      `).bind(
        tenantId,
        tenantId,
        creditNoteNo,
        item.invoiceItemId,
        item.description,
        item.allocatedRefundAmount,
        item.allocatedRefundAmount,
        `Amount allocation from refund request #${approvalRequestId} (${item.allocationSource})`,
      ),
      prepareRefundBatchAssertion(env.DB, {
        tenantId,
        operationKey: financialOperationKey,
        stepKey: `credit-item:${item.invoiceItemId}`,
        expectedChanges: 1,
      }),
    );
  }

  statements.push(
    env.DB.prepare(`
      UPDATE bills
      SET total = ?, paid = ?, due = ?, status = ?,
          test_bill = ?, doctor_visit_bill = ?, admission_bill = ?,
          operation_bill = ?, medicine_bill = ?
      WHERE tenant_id = ? AND id = ?
    `).bind(
      newTotal,
      newPaid,
      newDue,
      nextStatus,
      nextCategoryTotals.testBill,
      nextCategoryTotals.doctorVisitBill,
      nextCategoryTotals.admissionBill,
      nextCategoryTotals.operationBill,
      nextCategoryTotals.medicineBill,
      tenantId,
      billId,
    ),
    prepareRefundBatchAssertion(env.DB, {
      tenantId,
      operationKey: financialOperationKey,
      stepKey: 'bill',
      expectedChanges: 1,
    }),
    env.DB.prepare(`
      INSERT INTO income (date, source, amount, description, bill_id, tenant_id, created_by)
      VALUES (?, 'other', ?, ?, ?, ?, ?)
    `).bind(today, -totalRefund, `Credit note ${creditNoteNo} — ${sourceLabel}`, billId, tenantId, userId),
    prepareRefundBatchAssertion(env.DB, {
      tenantId,
      operationKey: financialOperationKey,
      stepKey: 'income',
      expectedChanges: 1,
    }),
    env.DB.prepare(`
      INSERT INTO emp_cash_transactions (
        tenant_id, employee_id, counter_id, counter_session_id,
        transaction_type, amount, reference_id, reference_type,
        payment_method, description
      ) VALUES (?, ?, ?, ?, 'SalesReturn', ?, ${creditNoteIdLookup}, 'credit_note', 'cash', ?)
    `).bind(
      tenantId,
      hold.employeeId,
      hold.counterId,
      hold.counterSessionId,
      cashRefund,
      tenantId,
      creditNoteNo,
      `Credit note ${creditNoteNo} from refund #${sourceReference}`,
    ),
    prepareRefundBatchAssertion(env.DB, {
      tenantId,
      operationKey: financialOperationKey,
      stepKey: 'cash-return',
      expectedChanges: 1,
    }),
    env.DB.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events (
        tenant_id, source_event_key, source_type, source_id,
        event_type, event_date, payload_json, created_by
      ) VALUES (?, ?, 'credit_note', ${creditNoteIdLookup}, ?, ?, ?, ?)
    `).bind(
      tenantId,
      sourceEventKey,
      tenantId,
      creditNoteNo,
      ACCOUNTING_EVENT_TYPES.creditNoteIssued,
      today,
      JSON.stringify({
        creditNoteNo,
        billId,
        patientId: Number(bill.patient_id),
        total: totalRefund,
        cashRefund,
        receivableReduction,
        paymentMethod: 'cash',
        approvalRequestId: approvalMetadataId,
        refundRequestIdempotencyKey: requestTime?.idempotencyKey ?? null,
        refundCashHoldId: holdMetadataId,
        ...categoryTotals,
      }),
      userId,
    ),
    prepareRefundBatchAssertion(env.DB, {
      tenantId,
      operationKey: financialOperationKey,
      stepKey: 'accounting',
      expectedChanges: 1,
    }),
    env.DB.prepare(`
      UPDATE billing_refund_cash_holds
      SET status = 'consumed',
          credit_note_id = ${creditNoteIdLookup},
          consumed_at = datetime('now', '+6 hours'),
          resolved_by = ?,
          resolution_reason = 'Refund approved',
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND ${holdResolutionColumn} = ? AND status = 'held'
    `).bind(
      tenantId,
      creditNoteNo,
      userId,
      tenantId,
      holdResolutionValue,
    ),
    prepareRefundBatchAssertion(env.DB, {
      tenantId,
      operationKey: financialOperationKey,
      stepKey: 'cash-hold',
      expectedChanges: 1,
    }),
    env.DB.prepare(`
      INSERT INTO audit_logs (
        tenant_id, user_id, action, table_name, record_id,
        old_value, new_value, ip_address, user_agent, created_at
      ) VALUES (?, ?, 'APPROVE', 'billing_credit_notes', ${creditNoteIdLookup}, ?, ?, NULL, NULL, datetime('now', '+6 hours'))
    `).bind(
      tenantId,
      userId,
      tenantId,
      creditNoteNo,
      JSON.stringify({
        status: requestTime ? 'requesting' : 'pending_approval',
        approvalRequestId: approvalMetadataId,
        refundRequestIdempotencyKey: requestTime?.idempotencyKey ?? null,
        cashHoldId: holdMetadataId,
      }),
      JSON.stringify({
        status: 'approved',
        approvalRequestId: approvalMetadataId,
        refundRequestIdempotencyKey: requestTime?.idempotencyKey ?? null,
        cashHoldId: holdMetadataId,
        totalRefund,
        newTotal,
        newPaid,
        newDue,
      }),
    ),
    prepareRefundBatchAssertion(env.DB, {
      tenantId,
      operationKey: financialOperationKey,
      stepKey: 'audit',
      expectedChanges: 1,
    }),
  );

  if (isAmountBasedRefund) {
    const commissionOperationKey = `refund-${requestTime ? 'request' : 'approval'}:${sourceReference}`;
    const heldCommissionReservation = !requestTime && commissionReservation?.status === 'held'
      ? commissionReservation
      : null;
    if (heldCommissionReservation) {
      requestData.commissionReservationStatus = 'consumed';
      requestData.commissionReservedAmount = heldCommissionReservation.totalReversal;
      statements.push(...buildTransitionRefundCommissionReservationStatements(env.DB, {
        tenantId,
        approvalRequestId,
        fromStatus: 'held',
        toStatus: 'consumed',
        userId,
        reason: `Refund approved with credit note ${creditNoteNo}`,
        expectedChanges: heldCommissionReservation.rows.filter((row) => row.reversalAmount > 0).length,
        operationKey: commissionOperationKey,
      }));
    } else {
      const commissionStatements = await buildRefundCommissionImpactStatements(env.DB, {
        tenantId,
        billId,
        allocations: amountAllocation,
        creditNoteId: null,
        creditNoteNo,
        userId,
        eventDate: today,
        reason,
      }, commissionImpact);
      statements.push(...commissionStatements);
    }
    if (!requestTime) {
      statements.push(
        env.DB.prepare(`
          UPDATE approval_requests
          SET request_data = ?
          WHERE tenant_id = ? AND id = ?
        `).bind(JSON.stringify(requestData), tenantId, approvalRequestId),
        prepareRefundBatchAssertion(env.DB, {
          tenantId,
          operationKey: financialOperationKey,
          stepKey: 'request-data',
          expectedChanges: 1,
        }),
      );
    }
    if (heldCommissionReservation) {
      statements.push(prepareClearRefundBatchAssertions(env.DB, tenantId, commissionOperationKey));
    }
  }
  statements.push(prepareClearRefundBatchAssertions(env.DB, tenantId, financialOperationKey));

  const issuedAtUtc = new Date().toISOString();
  let creditNoteId = 0;
  let requestTimeApprovalId = 0;
  let requestTimeCashHoldId = 0;
  try {
    const financialExecution = await executeStrictFinancialMutation({
      db: env.DB,
      tenantId,
      boundary: 'credit-note.cash-refund',
      legacyStatements: statements,
      canonical: async (options) => {
        const canonicalInput = await resolveLiveCreditNoteProjection(env.DB, {
          tenantId,
          creditNoteNo,
          billId,
          billInvoiceNo: String(bill.invoice_no ?? bill.id),
          reason,
          issuedAtUtc,
          cashRefund: 0,
          lines: [
            ...calculation.items.map((item) => ({
              invoiceItemId: Number(item.invoiceItemId),
              amount: Number(item.refundAmount),
              reason: `Approved from refund request #${sourceReference}`,
            })),
            ...amountAllocation.map((item) => ({
              invoiceItemId: Number(item.invoiceItemId),
              amount: Number(item.allocatedRefundAmount),
              reason: `Amount allocation from refund request #${sourceReference}`,
            })),
          ],
        });
        const funding = await resolveLiveCreditNoteCashRefundFunding(env.DB, {
          tenantId,
          creditNoteNo,
          billId,
          billInvoiceNo: String(bill.invoice_no ?? bill.id),
          cashRefund,
          refundedAtUtc: issuedAtUtc,
        });
        return issueCreditNoteWithCashRefund(env.DB, {
          ...canonicalInput,
          idempotencyKey: `legacy_live_held_credit_note_cash_refund:${sourceReference}`,
          refundPublicId: funding.refundPublicId,
          cashRefundMinor: funding.amountMinor,
          payoutMethodCode: 'cash',
          legacyCounterId: Number(hold.counterId),
          legacyCounterSessionId: Number(hold.counterSessionId),
          refundSourceEvidenceSha256: funding.sourceEvidenceSha256,
          receiptSlices: funding.receiptSlices,
          allocationSlices: funding.allocationSlices,
          tenderAttributions: funding.tenderAttributions,
          cashRefundEventPublicId: await createDeterministicSourceId(
            'outevt',
            tenantId,
            'legacy_live_held_credit_note_cash_refund_accounting',
            sourceReference,
          ),
          cashCustodyEventPublicId: await createDeterministicSourceId(
            'outevt',
            tenantId,
            'legacy_live_held_credit_note_cash_refund_custody',
            sourceReference,
          ),
        }, options);
      },
    });
    if (financialExecution.mode === 'legacy' || financialExecution.mode === 'shadow') {
      const creditNoteResultIndex = requestTimeStatements.length;
      creditNoteId = Number((financialExecution.result[creditNoteResultIndex] as any)?.meta?.last_row_id ?? 0);
      if (requestTime) {
        requestTimeApprovalId = Number((financialExecution.result[0] as any)?.meta?.last_row_id ?? 0);
        requestTimeCashHoldId = Number((financialExecution.result[1] as any)?.meta?.last_row_id ?? 0);
      }
    }
  } catch (error) {
    if (isRefundBatchAssertionError(error)) {
      throw new HTTPException(409, {
        message: 'Refund approval could not reconcile the bill, cash hold, accounting, and commission atomically. Refresh and try again.',
      });
    }
    if (isHeldRefundCanonicalConflict(error)) {
      throw new HTTPException(409, {
        message: 'Cash refund payment authority is no longer available. Refresh and try again.',
      });
    }
    throw error;
  }
  if (!creditNoteId) {
    const creditNoteRow = await env.DB.prepare(
      'SELECT id FROM billing_credit_notes WHERE tenant_id = ? AND credit_note_no = ? LIMIT 1',
    ).bind(tenantId, creditNoteNo).first<{ id: number }>();
    creditNoteId = Number(creditNoteRow?.id ?? 0);
  }
  if (!creditNoteId) {
    throw new HTTPException(409, {
      message: 'Approved credit note could not be resolved after the refund commit.',
    });
  }

  const committedHold = requestTime
    ? await loadRefundCashHoldByIdempotencyKey(env.DB, tenantId, requestTime.idempotencyKey)
    : hold;
  if (committedHold) {
    await shadowRefundReserveConsumed(env.DB, tenantId, committedHold, Number(userId));
  }

  if (!isAmountBasedRefund) {
    await completeHeldRefundClinicalSideEffects(env, {
      tenantId,
      userId,
      billId,
      invoiceItemIds: selectedInvoiceItemIds,
      reason,
    });
  }

  return {
    kind: 'converted_to_credit_note',
    creditNoteId,
    creditNoteNo,
    totalRefund,
    ...(requestTime ? {
      requestTimeApprovalId,
      requestTimeCashHoldId,
      executedRequestData: executedRequestData ?? undefined,
    } : {}),
  };
}

async function executeBillCancellationApproval(env: Env, tenantId: string, userId: string, billId: number, reason: string): Promise<BillCancelSideEffectResult> {
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(env.DB, tenantId, today, 'Bill cancellation approval');
  const bill = await d1WithRetry(
    () => env.DB.prepare(`
      SELECT id, invoice_no, patient_id, visit_id, status, paid, total, discount,
             test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill
      FROM bills
      WHERE id = ? AND tenant_id = ?
    `).bind(billId, tenantId).first<any>(),
    { label: `executeBillCancellation: fetch bill #${billId}` },
  );
  if (!bill) throw new HTTPException(404, { message: 'Bill not found' });
  if (String(bill.status).toLowerCase() === 'cancelled') throw new HTTPException(409, { message: 'Bill already cancelled' });
  await assertNoPaidPerformerReserves(env.DB, tenantId, { billId });
  const paymentTotal = await d1WithRetry(
    () => env.DB.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS paid_total
      FROM payments
      WHERE tenant_id = ? AND bill_id = ? AND COALESCE(amount, 0) > 0
    `).bind(tenantId, billId).first<{ paid_total?: number | null }>(),
    { label: `executeBillCancellation: sum payments #${billId}` },
  );
  const hasPayments = Number(bill.paid ?? 0) > 0 || Number(paymentTotal?.paid_total ?? 0) > 0;

  if (hasPayments) {
    // Auto-convert: instead of cancelling (which is wrong for a paid bill),
    // create a pending credit note covering all non-cancelled items. The
    // admin can review and approve the credit note next, which performs the
    // actual refund / receivable write-off.
    const { creditNoteId, creditNoteNo, totalRefund } = await createCreditNoteFromBillCancel(
      env, tenantId, userId, billId, reason,
    );
    void createAuditLog(env, tenantId, userId, 'APPROVED_CONVERT_TO_CREDIT_NOTE', 'bills', billId, { status: bill.status, total: bill.total }, { reason, creditNoteId, creditNoteNo, totalRefund });
    return { kind: 'converted_to_credit_note', creditNoteId, creditNoteNo, totalRefund };
  }

  const commissionRows = await d1WithRetry(
    () => env.DB.prepare(`
      SELECT id, doctor_id, patient_id, visit_id, bill_id, source_type,
             gross_amount, commission_amount
      FROM doctor_commission_accruals
      WHERE tenant_id = ? AND bill_id = ? AND status = 'accrued'
      ORDER BY id
    `).bind(tenantId, billId).all<{
      id: number;
      doctor_id: number;
      patient_id: number | null;
      visit_id: number | null;
      bill_id: number | null;
      source_type: string;
      gross_amount: number;
      commission_amount: number;
    }>(),
    { label: `executeBillCancellation: commissions #${billId}` },
  );
  const cancelledAtUtc = new Date().toISOString();
  const cancellationAssertionKey = `bill-cancellation-assert:${billId}:${cancelledAtUtc}`;
  const commissionAssertionKey = `bill-cancellation-commission-assert:${billId}:${cancelledAtUtc}`;
  const legacyStatements: D1PreparedStatement[] = [
    env.DB.prepare(`
      UPDATE bills
      SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now', '+6 hours'), cancel_reason = ?
      WHERE id = ? AND tenant_id = ? AND status <> 'cancelled' AND COALESCE(paid, 0) = 0
    `).bind(userId, reason, billId, tenantId),
    env.DB.prepare(`
      INSERT INTO bills_idempotency_keys (tenant_id, idempotency_key, status, created_by)
      VALUES (?, CASE WHEN changes() = 1 THEN ? ELSE NULL END, 'completed', ?)
    `).bind(tenantId, cancellationAssertionKey, Number(userId)),
    env.DB.prepare(`
      UPDATE invoice_items
      SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now', '+6 hours'), cancel_reason = ?
      WHERE bill_id = ? AND tenant_id = ? AND status <> 'cancelled'
    `).bind(userId, reason, billId, tenantId),
    env.DB.prepare(`
      UPDATE diagnostic_performer_reserves
      SET status = 'cancelled', cancelled_at = datetime('now', '+6 hours'), cancelled_by = ?,
          cancel_reason = ?, updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND bill_id = ? AND status = 'reserved'
    `).bind(userId, reason, tenantId, billId),
    env.DB.prepare(`
      UPDATE doctor_commission_accruals
      SET status = 'cancelled', notes = COALESCE(notes, '') || ' | Cancelled: ' || ?
      WHERE tenant_id = ? AND bill_id = ? AND status = 'accrued'
    `).bind(reason, tenantId, billId),
    env.DB.prepare(`
      INSERT INTO bills_idempotency_keys (tenant_id, idempotency_key, status, created_by)
      VALUES (?, CASE WHEN changes() = ? THEN ? ELSE NULL END, 'completed', ?)
    `).bind(
      tenantId,
      (commissionRows.results ?? []).length,
      commissionAssertionKey,
      Number(userId),
    ),
  ];
  for (const row of commissionRows.results ?? []) {
    legacyStatements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events (
        tenant_id, source_event_key, source_type, source_id,
        event_type, event_date, payload_json, created_by
      ) VALUES (?, ?, 'doctor_commission_accrual', ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      createPostingEventKey('doctor_commission_accrual', row.id, ACCOUNTING_EVENT_TYPES.commissionCancelled),
      row.id,
      ACCOUNTING_EVENT_TYPES.commissionCancelled,
      today,
      JSON.stringify({
        accrualId: row.id,
        doctorId: row.doctor_id,
        patientId: row.patient_id,
        visitId: row.visit_id,
        billId: row.bill_id,
        commissionSourceType: row.source_type,
        grossAmount: row.gross_amount,
        amount: row.commission_amount,
        reason,
      }),
      Number(userId),
    ));
  }
  legacyStatements.push(
    env.DB.prepare(`
      INSERT INTO income (date, source, amount, description, bill_id, tenant_id, created_by)
      VALUES (?, 'other', ?, ?, ?, ?, ?)
    `).bind(
      today,
      -Math.abs(Number(bill.total ?? 0)),
      `Bill cancellation approval: ${reason}`,
      billId,
      tenantId,
      userId,
    ),
    env.DB.prepare(`
      DELETE FROM bills_idempotency_keys
      WHERE tenant_id = ? AND idempotency_key IN (?, ?)
    `).bind(tenantId, cancellationAssertionKey, commissionAssertionKey),
  );

  try {
    await d1WithRetry(
      () => executeStrictFinancialMutation({
        db: env.DB,
        tenantId,
        boundary: 'bill.cancel.unpaid',
        legacyStatements,
        canonical: async (options) => {
          const canonicalInput = await resolveLiveUnpaidInvoiceCancellationProjection(env.DB, {
            tenantId,
            legacyBillId: billId,
            invoiceNumber: String(bill.invoice_no),
            totalAmount: Number(bill.total ?? 0),
            paidAmount: Number(bill.paid ?? 0),
            reasonCode: 'approved_unpaid_bill_cancellation',
            cancelledAtUtc,
          });
          return cancelUnpaidInvoice(env.DB, canonicalInput, options);
        },
      }),
      { label: `executeBillCancellation: strict financial mutation #${billId}` },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/bills_idempotency_keys\.idempotency_key/i.test(message)) {
      throw new HTTPException(409, { message: 'Bill financial state changed before cancellation. Refresh and try again.' });
    }
    throw error;
  }

  await cancelLabOrderItemsForBill(env.DB, { tenantId, userId, billId, reason });
  void createAuditLog(env, tenantId, userId, 'APPROVED_CANCEL', 'bills', billId, { status: bill.status, total: bill.total }, { reason });
  return { kind: 'cancelled' };
}

async function executePaymentVoidApproval(env: Env, tenantId: string, userId: string, paymentId: number, reason: string): Promise<void> {
  const result = await executePaymentVoidReversal(env, {
    tenantId,
    paymentId,
    actorUserId: Number(userId),
    reason,
  });

  void createAuditLog(env, tenantId, userId, 'APPROVED_PAYMENT_REVERSAL', 'payments', paymentId, null, {
    reason,
    reversalReceiptNo: result.reversalReceiptNo,
    newPaid: result.newPaid,
    due: result.due,
    status: result.status,
    originalReceivedBy: result.originalReceivedBy,
    executionMode: result.executionMode,
  });
}

async function executeRefundDisputeWriteoffApproval(
  env: Env,
  request: any,
  tenantId: string,
  userId: string,
  reason: string,
): Promise<BillCancelSideEffectResult> {
  const requestData = parseRequestData(request.request_data);
  const disputeId = Number(requestData.refundDisputeId ?? request.entity_id);
  if (!Number.isInteger(disputeId) || disputeId <= 0) {
    throw new HTTPException(409, { message: 'Refund dispute write-off approval is missing a valid dispute ID.' });
  }
  const dispute = await loadRefundCashDispute(env.DB, tenantId, disputeId);
  if (!dispute) throw new HTTPException(404, { message: 'Refund cash dispute not found.' });
  if (dispute.settlementReferenceId !== Number(request.id)) {
    throw new HTTPException(409, { message: 'Refund cash dispute is not linked to this write-off approval.' });
  }

  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(env.DB, tenantId, today, 'Refund dispute write-off approval');
  const writtenOff = await completeRefundDisputeWriteoff(env.DB, {
    tenantId,
    disputeId,
    approvalRequestId: Number(request.id),
    approvedBy: Number(userId),
    eventDate: today,
  });
  const accountingSourceEventKey = createPostingEventKey(
    'refund_cash_dispute_written_off',
    writtenOff.id,
    ACCOUNTING_EVENT_TYPES.manualJournal,
  );
  await shadowRefundDisputeWrittenOff(env.DB, writtenOff, Number(userId));
  void createAuditLog(env, tenantId, userId, 'APPROVE', 'billing_refund_cash_disputes', disputeId, dispute, {
    status: writtenOff.status,
    amount: writtenOff.amount,
    approvalRequestId: Number(request.id),
    accountingSourceEventKey,
    reason,
  });
  return {
    kind: 'refund_dispute_written_off',
    disputeId: writtenOff.id,
    amount: writtenOff.amount,
    accountingSourceEventKey,
  };
}

async function executeApprovalSideEffect(env: Env, request: any, tenantId: string, userId: string, notes?: string): Promise<BillCancelSideEffectResult | null> {
  const requestData = parseRequestData(request.request_data);
  const reason = String(notes || requestData.reason || 'Approved correction').trim();
  const type = canonicalApprovalRequestType(request);
  if (type === 'bill_cancel') {
    return await executeBillCancellationApproval(env, tenantId, userId, Number(request.entity_id), reason);
  }
  if (type === 'payment_void') {
    await executePaymentVoidApproval(env, tenantId, userId, Number(request.entity_id), reason);
    return null;
  }
  if (type === 'refund') {
    const structuredRefundKind = String(requestData.refundKind ?? '');
    if (isHeldRefundKind(structuredRefundKind)) {
      return await executeHeldRefundApproval(env, request, tenantId, userId, reason);
    }

    const oldValue = requestData.oldValue && typeof requestData.oldValue === 'object'
      ? requestData.oldValue as Record<string, unknown>
      : {};
    const newValue = requestData.newValue && typeof requestData.newValue === 'object'
      ? requestData.newValue as Record<string, unknown>
      : {};
    const entityNo = String(request.entity_no ?? '');
    const receiptNo = String(oldValue.receiptNo ?? oldValue.receipt_no ?? '');
    const requestedStatus = String(newValue.status ?? '');
    const refundKind = String(oldValue.refundKind ?? newValue.refundKind ?? '');
    const isBillRefund = refundKind === 'bill_refund' || requestedStatus === 'refund_requested';
    if (isBillRefund) {
      const result = await createCreditNoteFromBillCancel(
        env,
        tenantId,
        userId,
        Number(request.entity_id),
        reason,
        'refund request approval',
        'ready_for_payout',
      );
      return { kind: "converted_to_credit_note", creditNoteId: result.creditNoteId, creditNoteNo: result.creditNoteNo, totalRefund: result.totalRefund };
    }
    const isLegacyPaymentVoid = /^RCP-/i.test(entityNo)
      || /^RCP-/i.test(receiptNo)
      || requestedStatus === 'payment_reversal_requested'
      || requestedStatus === 'payment_void_requested';
    if (isLegacyPaymentVoid) {
      await executePaymentVoidApproval(env, tenantId, userId, Number(request.entity_id), reason);
    }
  }
  if (type === 'manual_adjustment' && requestData.kind === 'refund_dispute_writeoff') {
    return await executeRefundDisputeWriteoffApproval(env, request, tenantId, userId, reason);
  }
  return null;
}

// POST / — Create approval request. Reception can submit requests, but review/list stays admin-only.
approvals.post('/', requireRole(...APPROVAL_REQUEST_ROLES), async (c) => {
  const body = await c.req.json();
  const parsed = createApprovalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { entityId, entityNo, requestData } = parsed.data;
  const type = canonicalApprovalType(parsed.data.type);
  if (type === 'receivable_write_off') {
    return c.json({
      error: 'Create receivable write-off requests from the Action Center collection workflow.',
    }, 400);
  }
  const storageType = type === CREDIT_DISCHARGE_APPROVAL_KIND
    ? CREDIT_DISCHARGE_APPROVAL_STORAGE_TYPE
    : type;
  const storedRequestData = type === CREDIT_DISCHARGE_APPROVAL_KIND
    ? { ...requestData, approvalKind: CREDIT_DISCHARGE_APPROVAL_KIND }
    : requestData;
  const executionStatus = approvalInitialExecutionStatus(type);
  const userId = c.get('userId');
  const tenantId = requireTenantId(c);
  const db = c.env.DB;

  if (type === 'payment_void') {
    const idempotencyKey = parsed.data.idempotencyKey!;
    const requestHash = await createIdempotencyRequestHash({
      type,
      entityId,
      entityNo: entityNo || null,
      requestData,
    });

    const existingRequest = await d1WithRetry(
      () => db.prepare(`
        SELECT *
        FROM approval_requests
        WHERE tenant_id = ?
          AND type = 'payment_void'
          AND entity_id = ?
          AND json_extract(request_data, '$.paymentVoidIdempotencyKey') = ?
        ORDER BY id DESC
        LIMIT 1
      `).bind(tenantId, entityId, idempotencyKey).first<any>(),
      { label: 'POST /: payment void idempotency replay' },
    );
    if (existingRequest) {
      const existingData = parseRequestData(existingRequest.request_data);
      if (String(existingData.paymentVoidRequestHash ?? '') !== requestHash) {
        return c.json({ error: 'Idempotency key was already used for a different payment void request' }, 409);
      }
      return c.json({
        data: {
          ...existingRequest,
          request_data: existingData,
        },
        executed: true,
        idempotent: true,
        reversal: {
          receiptNo: existingData.reversalReceiptNo ?? null,
          amount: Number(existingData.originalAmount ?? requestData.amount ?? 0),
          billPaidAfter: Number(existingData.billPaidAfter ?? 0),
          billDueAfter: Number(existingData.billDueAfter ?? 0),
          billStatusAfter: String(existingData.billStatusAfter ?? 'open'),
        },
      }, 201);
    }

    const duplicate = await d1WithRetry(
      () => db.prepare(`
        SELECT id
        FROM approval_requests
        WHERE tenant_id = ? AND type = 'payment_void' AND entity_id = ?
          AND status IN ('pending', 'partially_approved')
        LIMIT 1
      `).bind(tenantId, entityId).first<{ id: number }>(),
      { label: 'POST /: duplicate pending payment void check' },
    );
    if (duplicate) return c.json({ error: 'Pending approval already exists for this payment' }, 409);

    let canonicalRequestData: Record<string, unknown> | null = null;
    const execution = await executePaymentVoidReversal(c.env, {
      tenantId,
      paymentId: entityId,
      actorUserId: Number(userId),
      reason: String(requestData.reason),
      cashOnly: true,
      additionalAuthoritativeStatements: (context) => {
        canonicalRequestData = {
          ...requestData,
          executionMode: 'executed_pending',
          financialState: 'reversed_pending_review',
          disputeStatus: 'not_required',
          paymentVoidIdempotencyKey: idempotencyKey,
          paymentVoidRequestHash: requestHash,
          originalPaymentId: context.paymentId,
          originalReceiptNo: context.originalReceiptNo,
          originalAmount: context.originalAmount,
          paymentMethod: context.paymentMethod,
          originalReceivedBy: context.originalReceivedBy,
          billId: context.billId,
          reversalReceiptNo: context.reversalReceiptNo,
          counterId: context.counterId,
          counterSessionId: context.counterSessionId,
          billPaidAfter: context.newPaid,
          billDueAfter: context.due,
          billStatusAfter: context.status,
          reversedAtUtc: context.reversedAtUtc,
        };
        return [db.prepare(`
          INSERT INTO approval_requests (
            tenant_id, type, entity_id, entity_no, requested_by,
            request_data, status, execution_status
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `).bind(
          tenantId,
          'payment_void',
          entityId,
          entityNo || context.originalReceiptNo || null,
          userId,
          JSON.stringify(canonicalRequestData),
          'succeeded',
        )];
      },
    });

    if (!canonicalRequestData) {
      throw new Error('Payment void approval data was not prepared');
    }
    let approvalId = Number((execution.authoritativeResults?.[0] as any)?.meta?.last_row_id ?? 0);
    if (approvalId <= 0) {
      const createdApproval = await db.prepare(`
        SELECT id
        FROM approval_requests
        WHERE tenant_id = ?
          AND type = 'payment_void'
          AND entity_id = ?
          AND json_extract(request_data, '$.paymentVoidIdempotencyKey') = ?
        ORDER BY id DESC
        LIMIT 1
      `).bind(tenantId, entityId, idempotencyKey).first<{ id: number }>();
      approvalId = Number(createdApproval?.id ?? 0);
    }
    if (approvalId <= 0) {
      throw new Error('Payment void request could not be verified after financial reversal');
    }

    const data = {
      id: approvalId,
      tenant_id: tenantId,
      type: 'payment_void',
      entity_id: entityId,
      entity_no: entityNo || execution.originalReceiptNo || null,
      requested_by: userId,
      request_data: canonicalRequestData,
      status: 'pending',
      execution_status: 'succeeded',
    };

    await recordApprovalEvent(db, tenantId, approvalId, 'created', userId, null, 'pending', null, {
      type,
      entityId,
      entityNo,
      executionMode: 'executed_pending',
      reversalReceiptNo: execution.reversalReceiptNo,
    });
    await recordApprovalEvent(db, tenantId, approvalId, 'execution_succeeded', userId, 'pending', 'pending', String(requestData.reason), {
      type,
      entityId,
      reversalReceiptNo: execution.reversalReceiptNo,
      billDueAfter: execution.due,
      executionMode: execution.executionMode,
    });
    void createAuditLog(c.env, tenantId, String(userId), 'CREATE', 'approval_requests', approvalId, null, {
      action: 'executed_payment_void_created',
      type,
      entityId,
      entityNo,
      reversalReceiptNo: execution.reversalReceiptNo,
      billDueAfter: execution.due,
      originalReceivedBy: execution.originalReceivedBy,
      executionMode: execution.executionMode,
    });

    return c.json({
      data,
      executed: true,
      reversal: {
        receiptNo: execution.reversalReceiptNo,
        amount: execution.originalAmount,
        billPaidAfter: execution.newPaid,
        billDueAfter: execution.due,
        billStatusAfter: execution.status,
      },
    }, 201);
  }

  const refundKind = type === 'refund' ? String(requestData.refundKind ?? '') : '';
  if (isHeldRefundKind(refundKind)) {
    const idempotencyKey = parsed.data.idempotencyKey!;
    const requestHash = await createIdempotencyRequestHash({
      type,
      entityId,
      entityNo: entityNo || null,
      requestData,
    });

    const existingHold = await loadRefundCashHoldByIdempotencyKey(db, tenantId, idempotencyKey);
    if (existingHold) {
      const existingRequest = await d1WithRetry(
        () => db.prepare('SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ? LIMIT 1')
          .bind(existingHold.approvalRequestId, tenantId)
          .first<any>(),
        { label: 'POST /: refund idempotency replay' },
      );
      const existingData = parseRequestData(existingRequest?.request_data);
      if (!existingRequest || String(existingData.refundRequestHash ?? '') !== requestHash) {
        return c.json({ error: 'Idempotency key was already used for a different refund request' }, 409);
      }
      return c.json({
        data: existingRequest,
        cashHold: {
          id: existingHold.id,
          amount: existingHold.amount,
          status: existingHold.status,
          counterSessionId: existingHold.counterSessionId,
        },
        idempotent: true,
      }, 201);
    }

    const existing = await d1WithRetry(
      () => db.prepare(
        `SELECT id FROM approval_requests WHERE tenant_id = ? AND type = 'refund' AND entity_id = ? AND status = 'pending' LIMIT 1`,
      ).bind(tenantId, entityId).first(),
      { label: 'POST /: duplicate pending refund check' },
    );
    if (existing) return c.json({ error: 'Pending approval already exists for this item' }, 409);

    const bill = await d1WithRetry(
      () => db.prepare(`
        SELECT id, patient_id, invoice_no, status, paid, due, total,
               test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill
        FROM bills
        WHERE tenant_id = ? AND id = ?
        LIMIT 1
      `).bind(tenantId, entityId).first<any>(),
      { label: `POST /: refund bill #${entityId}` },
    );
    if (!bill) return c.json({ error: 'Bill not found' }, 404);
    if (!['paid', 'partially_paid', 'final'].includes(String(bill.status ?? ''))) {
      return c.json({ error: 'Refund requests require a paid or finalized bill' }, 409);
    }

    const isAmountBasedRefund = refundKind === 'amount_partial_refund';
    let calculation: RefundCalculation;
    let amountAllocation: RefundAllocatedItem[] = [];
    if (isAmountBasedRefund) {
      try {
        calculation = { items: [], totalRefund: readAmountBasedRefund(requestData) };
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Invalid refund amount' }, 400);
      }
    } else {
      const refundableItems = await loadRefundableInvoiceItems(db, tenantId, entityId);
      const rawSelections = Array.isArray(requestData.items) ? requestData.items : [];
      const selections = refundKind === 'bill_refund' && rawSelections.length === 0
        ? refundableItems.filter((item) => item.eligible && item.availableQuantity > 0).map((item) => ({
          invoiceItemId: item.invoiceItemId,
          returnQuantity: item.availableQuantity,
        }))
        : rawSelections.map((item: any) => ({
          invoiceItemId: Number(item.invoiceItemId),
          returnQuantity: Number(item.returnQuantity),
        }));

      try {
        calculation = calculateRefundSelection(refundableItems, selections);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Invalid refund selection' }, 409);
      }
    }
    const currentBillTotal = roundMoney(Number(bill.total ?? 0));
    if (isAmountBasedRefund && calculation.totalRefund >= currentBillTotal) {
      return c.json({ error: 'Amount-based partial refunds must be less than the current bill total. Use the full refund flow for the entire bill.' }, 409);
    }
    if (calculation.totalRefund <= 0 || calculation.totalRefund > currentBillTotal) {
      return c.json({ error: 'Bill no longer has enough refundable value for this credit' }, 409);
    }
    const financialImpact = calculateRefundFinancialImpact({
      originalTotal: Number(bill.total ?? 0),
      originalPaid: Number(bill.paid ?? 0),
      totalCredit: calculation.totalRefund,
    });
    if (financialImpact.cashRefund <= 0) {
      return c.json({
        error: 'The selected adjustment only reduces unpaid receivable and does not produce a cash refund. Use the bill-adjustment workflow.',
      }, 409);
    }

    if (isAmountBasedRefund) {
      try {
        const resolved = await resolveAmountRefundAllocation(db, {
          tenantId,
          billId: entityId,
          requestData,
        });
        amountAllocation = resolved.items;
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Invalid refund amount allocation' }, 400);
      }
    }

    let commissionReservationImpact: RefundCommissionImpactPreview = {
      rows: [],
      totalReversal: 0,
      blocked: false,
      blockedReasons: [],
    };
    if (isAmountBasedRefund) {
      commissionReservationImpact = await previewRefundCommissionImpact(db, {
        tenantId,
        billId: entityId,
        allocations: amountAllocation,
      });
      if (commissionReservationImpact.blocked) {
        return c.json({
          error: `Refund cannot be requested because commission was already paid: ${commissionReservationImpact.blockedReasons.join('; ')}`,
        }, 409);
      }
    }

    const activeSession = await loadActiveBillingCounterSession(db, tenantId, String(userId), {
      workstationId: getBillingWorkstationId(c),
      requireCurrentWorkstation: true,
    });
    if (!activeSession) {
      return c.json({ error: 'Activate a billing counter on this workstation before requesting a cash refund.' }, 409);
    }

    const cash = await getCounterAvailableCash(db, tenantId, activeSession.id);
    if (cash.availableCash < financialImpact.cashRefund) {
      return c.json({ error: 'Available counter cash is lower than the cash portion of this refund.' }, 409);
    }

    const canonicalItems = calculation.items.map((item) => ({
      invoiceItemId: item.invoiceItemId,
      returnQuantity: item.returnQuantity,
      description: item.description,
      calculatedAmount: item.refundAmount,
    }));
    const canonicalRequestData: Record<string, unknown> = {
      ...requestData,
      refundKind,
      paymentMethod: 'cash',
      requestedRefundAmount: calculation.totalRefund,
      cashRefundAmount: financialImpact.cashRefund,
      receivableReduction: financialImpact.receivableReduction,
      refundRequestIdempotencyKey: idempotencyKey,
      refundRequestHash: requestHash,
      cashHoldStatus: 'held',
      counterId: activeSession.counter_id,
      counterSessionId: activeSession.id,
    };
    if (isAmountBasedRefund) {
      canonicalRequestData.allocationMode = 'auto_proportional_adjustable';
      canonicalRequestData.allocationVersion = 1;
      canonicalRequestData.items = refundAllocationRequestItems(amountAllocation);
      canonicalRequestData.commissionReservationStatus = commissionReservationImpact.totalReversal > 0
        ? 'held'
        : 'not_applicable';
      canonicalRequestData.commissionReservedAmount = commissionReservationImpact.totalReversal;
    } else {
      canonicalRequestData.items = canonicalItems;
    }

    const requestShell = {
      tenant_id: tenantId,
      type: 'refund',
      entity_id: entityId,
      entity_no: entityNo || bill.invoice_no || null,
      requested_by: userId,
      request_data: canonicalRequestData,
      status: 'pending',
      execution_status: 'succeeded',
      approval_revision: 1,
    };

    let refundResult: BillCancelSideEffectResult;
    try {
      refundResult = await executeHeldRefundApproval(
        c.env,
        requestShell,
        tenantId,
        String(userId),
        String(requestData.reason),
        {
          requestTime: {
            idempotencyKey,
            requestHash,
            entityNo: entityNo || bill.invoice_no || null,
            requesterId: Number(userId),
            requestData: canonicalRequestData,
            bill,
            calculation,
            amountAllocation,
            commissionImpact: commissionReservationImpact,
            counterId: Number(activeSession.counter_id),
            counterSessionId: Number(activeSession.id),
          },
        },
      );
    } catch (error) {
      const conflictMessage = refundHoldConflictMessage(error);
      if (conflictMessage) return c.json({ error: conflictMessage }, 409);
      throw error;
    }
    if (refundResult.kind !== 'converted_to_credit_note') {
      throw new Error('Refund execution did not create an approved credit note');
    }

    const [createdApproval, createdHold] = await Promise.all([
      db.prepare(`
        SELECT id, request_data, execution_status, approval_revision
        FROM approval_requests
        WHERE tenant_id = ?
          AND type = 'refund'
          AND json_extract(request_data, '$.refundRequestIdempotencyKey') = ?
        ORDER BY id DESC
        LIMIT 1
      `).bind(tenantId, idempotencyKey).first<any>(),
      loadRefundCashHoldByIdempotencyKey(db, tenantId, idempotencyKey),
    ]);
    const approvalId = Number(createdApproval?.id ?? refundResult.requestTimeApprovalId ?? 0);
    const holdId = Number(createdHold?.id ?? refundResult.requestTimeCashHoldId ?? 0);
    if (approvalId <= 0 || holdId <= 0) {
      throw new Error('Executed refund request and consumed cash hold could not be verified');
    }
    const executedRequestData = parseRequestData(
      createdApproval?.request_data ?? refundResult.executedRequestData,
    );

    await recordApprovalEvent(db, tenantId, approvalId, 'created', userId, null, 'pending', null, {
      type,
      entityId,
      entityNo,
      cashHoldId: holdId,
      totalCredit: calculation.totalRefund,
      cashRefund: financialImpact.cashRefund,
      executionMode: 'executed_pending',
    });
    await recordApprovalEvent(db, tenantId, approvalId, 'execution_succeeded', userId, 'pending', 'pending', String(requestData.reason), {
      type,
      entityId,
      creditNoteId: refundResult.creditNoteId,
      creditNoteNo: refundResult.creditNoteNo,
      totalRefund: refundResult.totalRefund,
      executionMode: 'executed_pending',
    });
    void createAuditLog(c.env, tenantId, String(userId), 'CREATE', 'approval_requests', approvalId, null, {
      action: 'executed_refund_created',
      type,
      entityId,
      entityNo,
      refundAmount: calculation.totalRefund,
      cashRefund: financialImpact.cashRefund,
      cashHoldId: holdId,
      creditNoteId: refundResult.creditNoteId,
      creditNoteNo: refundResult.creditNoteNo,
      executionMode: 'executed_pending',
    });

    const data = {
      id: approvalId,
      ...requestShell,
      request_data: executedRequestData,
      execution_status: String(createdApproval?.execution_status ?? 'succeeded'),
      approval_revision: Number(createdApproval?.approval_revision ?? 1),
    };
    return c.json({
      data,
      executed: true,
      cashHold: {
        id: holdId,
        amount: financialImpact.cashRefund,
        status: String(createdHold?.status ?? 'consumed'),
        counterSessionId: activeSession.id,
        availableCash: cash.availableCash - financialImpact.cashRefund,
      },
      refund: {
        creditNoteId: refundResult.creditNoteId,
        creditNoteNo: refundResult.creditNoteNo,
        totalRefund: refundResult.totalRefund,
        cashRefund: financialImpact.cashRefund,
        receivableReduction: financialImpact.receivableReduction,
      },
    }, 201);
  }

  // Check for duplicate pending request. Credit discharge shares the production-safe
  // manual_adjustment storage type, so its marker must be part of the identity.
  const duplicateSql = type === CREDIT_DISCHARGE_APPROVAL_KIND
    ? `SELECT id FROM approval_requests
       WHERE tenant_id = ? AND type = ?
         AND json_extract(request_data, '$.approvalKind') = ?
         AND entity_id = ? AND status = 'pending' LIMIT 1`
    : `SELECT id FROM approval_requests
       WHERE tenant_id = ? AND type = ? AND entity_id = ? AND status = 'pending' LIMIT 1`;
  const duplicateBindings = type === CREDIT_DISCHARGE_APPROVAL_KIND
    ? [tenantId, storageType, CREDIT_DISCHARGE_APPROVAL_KIND, entityId]
    : [tenantId, storageType, entityId];
  const existing = await d1WithRetry(
    () => db.prepare(duplicateSql).bind(...duplicateBindings).first(),
    { label: 'POST /: duplicate-pending-check' },
  );

  if (existing) {
    return c.json({ error: 'Pending approval already exists for this item' }, 409);
  }

  const result = await d1WithRetry(
    () => db
      .prepare(
        `INSERT INTO approval_requests (tenant_id, type, entity_id, entity_no, requested_by, request_data, status, execution_status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .bind(tenantId, storageType, entityId, entityNo || null, userId, JSON.stringify(storedRequestData), executionStatus)
      .run(),
    { label: 'POST /: insert' },
  );

  const created = await d1WithRetry(
    () => db
      .prepare(`SELECT * FROM approval_requests WHERE id = ?`)
      .bind(result.meta.last_row_id)
      .first(),
    { label: 'POST /: read-created' },
  );

  const storedData = created ?? {
    id: result.meta.last_row_id,
    tenant_id: tenantId,
    type: storageType,
    entity_id: entityId,
    entity_no: entityNo || null,
    requested_by: userId,
    request_data: storedRequestData,
    status: 'pending',
    execution_status: executionStatus,
  };
  const data = {
    ...storedData,
    type,
    request_data: parseRequestData((storedData as any).request_data),
  };

  await recordApprovalEvent(db, tenantId, Number(result.meta.last_row_id), 'created', userId, null, 'pending', null, { type, entityId, entityNo });
  void createAuditLog(c.env, tenantId!, userId!, 'CREATE', 'approval_requests', Number(result.meta.last_row_id), null, { type, entityId, entityNo, requestData: storedRequestData });

  return c.json({ data }, 201);
});

// GET /counts — Get pending counts per type
approvals.get('/counts', requireRole(...APPROVAL_REVIEW_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;

  try {
    const { results } = await d1WithRetry(
      () => db
        .prepare(
          `SELECT type, request_data FROM approval_requests WHERE tenant_id = ? AND status = ?`
        )
        .bind(tenantId, 'pending')
        .all(),
      { label: 'GET /counts' },
    );

    const result: Record<string, number> = {};
    for (const row of results as any[]) {
      const type = canonicalApprovalRequestType(row);
      result[type] = (result[type] || 0) + 1;
    }

    const handovers = await loadPendingFinalHandoverRows(db, tenantId);
    if (handovers.length > 0) {
      result.cash_handover = (result.cash_handover || 0) + handovers.length;
    }
    const pendingExpenseApprovals = await loadExpenseApprovalRows(db, tenantId, 'pending');
    if (pendingExpenseApprovals.length > 0) {
      result.expense = (result.expense || 0) + pendingExpenseApprovals.length;
    }
    return c.json({ data: result });
  } catch (error) {
    logServerError({
      request: c.req.raw,
      status: 500,
      environment: c.env.ENVIRONMENT,
      source: 'onError',
      error,
      message: 'approvals /counts failed',
      tenantId,
      userId: c.get('userId'),
      requestId: c.req.header('x-request-id') ?? c.req.header('x-correlation-id') ?? c.req.header('cf-ray') ?? undefined,
      tags: ['approvals_counts_failed', 'd1_query_failed'],
    });
    return c.json({
      error: 'Failed to load approval counts',
      detail: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// GET /summary — Enterprise approval center KPI summary
approvals.get('/summary', requireRole(...APPROVAL_REVIEW_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  try {
    const data = await loadApprovalOperationalSummary(c.env.DB, tenantId);
    return c.json({ data });
  } catch (error) {
    logServerError({
      request: c.req.raw,
      status: 500,
      environment: c.env.ENVIRONMENT,
      source: 'onError',
      error,
      message: 'approvals /summary failed',
      tenantId,
      userId: c.get('userId'),
      requestId: c.req.header('x-request-id') ?? c.req.header('x-correlation-id') ?? c.req.header('cf-ray') ?? undefined,
      tags: ['approvals_summary_failed', 'd1_query_failed'],
    });
    return c.json({
      error: 'Failed to load approval summary',
      detail: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// GET / — List approval requests
approvals.get('/', requireRole(...APPROVAL_REVIEW_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const query = approvalQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: query.error.flatten() }, 400);
  }

  const {
    type: rawType,
    status,
    page,
    limit,
    search,
    executionStatus,
    queueFilter,
    reviewedDate,
    createdFrom,
    createdTo,
    createdBefore,
  } = query.data;
  const type = rawType ? canonicalApprovalType(rawType) : undefined;
  const searchTerm = search?.trim() || undefined;
  const offset = (page - 1) * limit;
  const createdWindow = { createdFrom, createdTo, createdBefore };

  let whereClause = 'WHERE tenant_id = ?';
  const params: unknown[] = [tenantId];

  if (status !== 'all') {
    if (status === 'pending') {
      whereClause += ' AND status IN (?, ?)';
      params.push('pending', 'partially_approved');
    } else {
      whereClause += ' AND status = ?';
      params.push(status);
    }
  }

  if (type) {
    const typeCandidates = approvalTypeFilterCandidates(type);
    whereClause += ` AND type IN (${typeCandidates.map(() => '?').join(',')})`;
    params.push(...typeCandidates);
  }

  if (executionStatus) {
    whereClause += " AND COALESCE(execution_status, 'not_required') = ?";
    params.push(executionStatus);
  }

  const reviewedDateValue = reviewedDate === 'today' ? getTodayGMT6() : undefined;
  if (reviewedDateValue) {
    whereClause += " AND status IN ('approved', 'rejected') AND substr(reviewed_at, 1, 10) = ?";
    params.push(reviewedDateValue);
  }

  const canonicalCreatedWindow = approvalCreatedWindowSql('created_at', createdWindow);
  whereClause += canonicalCreatedWindow.sql;
  params.push(...canonicalCreatedWindow.params);

  try {
    const includeHandoverRows = !executionStatus && (!type || type === 'cash_handover');
    const includeExpenseRows = !executionStatus && (!type || type === 'expense');
    const handoverRows = includeHandoverRows
      ? await loadFinalHandoverRows(db, tenantId, status, reviewedDateValue, createdWindow)
      : [];
    const requiresTypeAliasPostFilter = type === CREDIT_DISCHARGE_APPROVAL_KIND
      || type === CREDIT_DISCHARGE_APPROVAL_STORAGE_TYPE;
    const requiresPostFilter = Boolean(searchTerm || queueFilter || reviewedDateValue || requiresTypeAliasPostFilter);
    const shouldHydrateForMerge = requiresPostFilter || includeHandoverRows || includeExpenseRows;
    const hydratedLimit = offset + limit + handoverRows.length;
    const countResult = !requiresPostFilter
      ? await d1WithRetry(
        () => db
          .prepare(`SELECT COUNT(*) as total FROM approval_requests ${whereClause}`)
          .bind(...params)
          .first(),
        { label: 'GET /: count' },
      )
      : null;

    let total = Number((countResult as any)?.total ?? (countResult as any)?.count ?? 0);
    const expenseRows = includeExpenseRows
      ? await loadExpenseApprovalRows(db, tenantId, status, reviewedDateValue, createdWindow)
      : [];

    const { results } = await d1WithRetry(
      () => db
        .prepare(
          requiresPostFilter
            ? `SELECT * FROM approval_requests ${whereClause} ORDER BY created_at DESC, id DESC`
            : shouldHydrateForMerge
              ? `SELECT * FROM approval_requests ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ?`
              : `SELECT * FROM approval_requests ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
        )
        .bind(...(requiresPostFilter ? params : shouldHydrateForMerge ? [...params, hydratedLimit] : [...params, limit, offset]))
        .all(),
      { label: 'GET /: list' },
    );

    const rawApprovalRows = (results ?? []) as any[];
    const approvalIds = rawApprovalRows.map((item: any) => Number(item.id)).filter((id: number) => Number.isInteger(id) && id > 0);
    const currentUserId = Number(c.get('userId'));
    const currentUserRole = String(c.get('role') ?? '');
    const currentUserCanApproveControlled = isTwoPersonApproverRole(currentUserRole);
    const includesReceivableWriteOff = rawApprovalRows.some((item) => canonicalApprovalRequestType(item) === 'receivable_write_off');
    const currentUserPermissions = includesReceivableWriteOff
      ? await resolveUserPermissions(db, tenantId, currentUserRole, String(currentUserId))
      : [];
    const currentUserCanApproveReceivableWriteOff = currentUserPermissions.includes('*')
      || currentUserPermissions.includes('receivables.write_off.approve');
    const [handoverDecisionStates, expenseDecisionStates] = await Promise.all([
      loadSourceApprovalDecisionStates(
        db,
        tenantId,
        'billing_handovers',
        handoverRows.map((item: any) => item.id),
        currentUserId,
      ),
      loadSourceApprovalDecisionStates(
        db,
        tenantId,
        'expenses',
        expenseRows.map((item: any) => item.id),
        currentUserId,
      ),
    ]);
    const currentUserDecisionIds = new Set<number>();
    if (approvalIds.length > 0 && Number.isFinite(currentUserId) && currentUserId > 0) {
      const decisionPlaceholders = approvalIds.map(() => '?').join(',');
      const { results: currentUserDecisions } = await d1WithRetry(
        () => db.prepare(`
          SELECT approval_request_id, approval_revision, superseded_at
          FROM approval_decisions
          WHERE tenant_id = ?
            AND approval_source = 'approval_requests'
            AND approver_id = ?
            AND decision = 'approve'
            AND approval_request_id IN (${decisionPlaceholders})
        `).bind(tenantId, currentUserId, ...approvalIds).all(),
        { label: 'GET /: current reviewer decisions' },
      );
      const currentRevisionByRequestId = new Map(
        rawApprovalRows.map((row: any) => [
          Number(row.id),
          Math.max(1, Number(row.approval_revision ?? 1)),
        ]),
      );
      for (const decision of currentUserDecisions ?? []) {
        const approvalRequestId = Number((decision as any).approval_request_id);
        const decisionRevision = Math.max(1, Number((decision as any).approval_revision ?? 1));
        if ((decision as any).superseded_at != null) continue;
        if (decisionRevision !== currentRevisionByRequestId.get(approvalRequestId)) continue;
        currentUserDecisionIds.add(approvalRequestId);
      }
    }
    const [infoStates, refundCashHolds] = await Promise.all([
      loadApprovalInfoStates(db, tenantId, approvalIds),
      loadRefundCashHoldsForApprovals(db, tenantId, approvalIds),
    ]);
    const userNames = await loadUserDisplayNames(db, tenantId, rawApprovalRows.flatMap((item: any) => [item.requested_by, item.reviewed_by]));
    const approvalRows = rawApprovalRows.map((item: any) => {
      const enriched = appendInfoState(enrichApprovalRow(item), infoStates);
      const requestedByName = userNames.get(Number(item.requested_by));
      const reviewedByName = userNames.get(Number(item.reviewed_by));
      const currentUserApproved = currentUserDecisionIds.has(Number(item.id));
      const isRequester = Number(item.requested_by) === currentUserId;
      const isOpen = ['pending', 'partially_approved'].includes(String(item.status));
      const executionFailed = String(enriched.execution_status ?? '') === 'failed';
      const infoRequested = String(enriched.info_request_status ?? '') === 'requested';
      const isReceivableWriteOff = canonicalApprovalRequestType(item) === 'receivable_write_off';
      const isReceivableWriteOffRetry = isReceivableWriteOff
        && String(item.status) === 'approved'
        && executionFailed;
      const canApproveType = currentUserCanApproveControlled
        && (!isReceivableWriteOff || currentUserCanApproveReceivableWriteOff);
      const canCurrentUserApprove = canApproveType
        && (isOpen || isReceivableWriteOffRetry)
        && !isRequester
        && (!currentUserApproved || isReceivableWriteOffRetry)
        && (!executionFailed || isReceivableWriteOffRetry)
        && !infoRequested;
      const approvalBlockedReason = !canApproveType
        ? (isReceivableWriteOff && !currentUserCanApproveReceivableWriteOff
          ? 'Missing permission: receivables.write_off.approve'
          : 'Your role cannot approve controlled requests')
        : isRequester
          ? 'You cannot approve your own request'
          : currentUserApproved && !isReceivableWriteOffRetry
            ? 'You already approved this request'
            : executionFailed && !isReceivableWriteOffRetry
              ? 'Execution failed and requires retry or investigation'
              : infoRequested
                ? 'Requested information is still pending'
                : isOpen || isReceivableWriteOffRetry
                  ? null
                  : 'This approval request is already closed';
      return {
        ...enriched,
        approval_key: item.approval_key ?? `approval_requests:${item.id}`,
        approval_source: item.approval_source ?? 'approval_requests',
        requested_by_name: requestedByName,
        reviewed_by_name: reviewedByName,
        current_user_approved: currentUserApproved,
        can_current_user_approve: canCurrentUserApprove,
        approval_blocked_reason: approvalBlockedReason,
        cash_hold: refundCashHolds.get(Number(item.id)) ?? null,
      };
    });
    const enrichSyntheticApproval = (
      item: any,
      decisionStates: Map<number, SourceApprovalDecisionState>,
    ) => {
      const decisionState = decisionStates.get(Number(item.id)) ?? {
        approvalCount: 0,
        currentUserApproved: false,
      };
      const approvalCount = Math.min(2, Math.max(0, decisionState.approvalCount));
      const status = String(item.status) === 'pending' && approvalCount > 0
        ? 'partially_approved'
        : String(item.status ?? 'pending');
      const enriched = enrichApprovalRow({
        ...item,
        status,
        approval_count: approvalCount,
        required_approvals: 2,
      });
      const requestData = parseRequestData(enriched.request_data);
      const isRequester = Number(enriched.requested_by) === currentUserId;
      const isCustodyActor = String(enriched.approval_source) === 'billing_handovers'
        && [requestData.handoverTo, requestData.receivedBy]
          .some((id) => Number(id) === currentUserId);
      const isOpen = ['pending', 'partially_approved'].includes(String(enriched.status));
      const canCurrentUserApprove = currentUserCanApproveControlled
        && isOpen
        && !isRequester
        && !isCustodyActor
        && !decisionState.currentUserApproved;
      const approvalBlockedReason = !currentUserCanApproveControlled
        ? 'Your role cannot approve controlled requests'
        : isRequester
          ? 'You cannot approve your own request'
          : isCustodyActor
            ? 'Cash sender or receiver cannot approve their own handover'
            : decisionState.currentUserApproved
              ? 'You already approved this request'
              : isOpen
                ? null
                : 'This approval request is already closed';
      return {
        ...enriched,
        current_user_approved: decisionState.currentUserApproved,
        can_current_user_approve: canCurrentUserApprove,
        approval_blocked_reason: approvalBlockedReason,
      };
    };
    const handoverApprovals = handoverRows.map((handover) => {
      const item = toFinalHandoverApproval(handover);
      return {
        ...enrichSyntheticApproval(item, handoverDecisionStates),
        bulk_approve_allowed: false,
        approval_note_required: true,
      };
    });
    const enrichedExpenseRows = expenseRows.map((item) => (
      enrichSyntheticApproval(item, expenseDecisionStates)
    ));
    const reviewedToday = reviewedDateValue ?? getTodayGMT6();
    const combined = sortApprovalWorklist([...approvalRows, ...handoverApprovals, ...enrichedExpenseRows])
      .filter((item) => !type || canonicalApprovalRequestType(item) === type)
      .filter((item) => !searchTerm || approvalSearchMatches(item, searchTerm))
      .filter((item) => approvalQueueFilterMatches(item, queueFilter))
      .filter((item) => reviewedDate !== 'today' || (isActualApprovalDecision(item) && localDate(item.reviewed_at ?? item.updated_at) === reviewedToday));
    total = requiresPostFilter ? combined.length : total + handoverRows.length + enrichedExpenseRows.length;
    const data = combined.slice(offset, offset + limit);

    return c.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('approvals GET / failed', { tenantId, query: query.data, error: String(error) });
    return c.json({
      error: 'Failed to load approval requests',
      detail: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// GET /handovers/:id/events — Structured receiver/admin trail for a cash handover
approvals.get('/handovers/:id/events', requireRole(...APPROVAL_REVIEW_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid handover ID' }, 400);
  }

  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const handover = await d1WithRetry(
    () => db.prepare(`
      SELECT id
      FROM billing_handovers
      WHERE id = ? AND tenant_id = ? AND handover_type = 'counter'
      LIMIT 1
    `).bind(id, tenantId).first(),
    { label: `GET /handovers/:id/events: handover exists #${id}` },
  );
  if (!handover) {
    return c.json({ error: 'Cash handover not found' }, 404);
  }

  const { results } = await d1WithRetry(
    () => db.prepare(`
      SELECT id, handover_id, event_type, actor_user_id, actor_role,
             counted_amount, expected_amount, variance, decision, remarks,
             workstation_id, created_at
      FROM cash_handover_verification_events
      WHERE tenant_id = ? AND handover_id = ?
      ORDER BY created_at ASC, id ASC
    `).bind(tenantId, id).all(),
    { label: `GET /handovers/:id/events: list #${id}` },
  );
  const actorNames = await loadUserDisplayNames(db, tenantId, (results ?? []).map((event: any) => event.actor_user_id));
  const statusForEvent = (eventType: string): string | null => {
    if (eventType === 'receiver_disputed') return 'pending';
    if (eventType === 'receiver_verified') return 'completed';
    if (eventType === 'admin_final_verification') return 'approved';
    if (eventType === 'admin_rejected') return 'rejected';
    return null;
  };
  const data = (results ?? []).map((event: any) => ({
    id: event.id,
    approval_request_id: id,
    action: event.event_type,
    actor_id: event.actor_user_id,
    actor_name: actorNames.get(Number(event.actor_user_id)),
    old_status: null,
    new_status: statusForEvent(String(event.event_type)),
    notes: event.remarks ?? null,
    metadata: {
      actorRole: event.actor_role ?? null,
      countedAmount: Number(event.counted_amount ?? 0),
      expectedAmount: Number(event.expected_amount ?? 0),
      variance: Number(event.variance ?? 0),
      decision: event.decision ?? null,
      workstationId: event.workstation_id ?? null,
    },
    created_at: event.created_at,
  }));

  return c.json({ data });
});

// GET /:id — Complete approval detail for dashboard-native review
approvals.get('/:id', requireRole(...APPROVAL_REVIEW_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid approval ID' }, 400);
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const request = await d1WithRetry(
    () => db.prepare('SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ? LIMIT 1')
      .bind(id, tenantId).first<any>(),
    { label: `GET /:id: approval #${id}` },
  );
  if (!request) return c.json({ error: 'Approval request not found' }, 404);

  const requestData = parseRequestData(request.request_data);
  const type = canonicalApprovalRequestType(request);
  const currentUserId = Number(c.get('userId'));
  const names = await loadUserDisplayNames(db, tenantId, [request.requested_by, request.reviewed_by]);
  const enriched = enrichApprovalRow(request);
  const isOpen = ['pending', 'partially_approved'].includes(String(request.status));
  const isRequester = Number(request.requested_by) === currentUserId;
  const currentDecision = await db.prepare(`
    SELECT id FROM approval_decisions
    WHERE tenant_id = ?
      AND approval_source = 'approval_requests'
      AND approval_request_id = ?
      AND approval_revision = ?
      AND approver_id = ?
      AND decision = 'approve'
      AND superseded_at IS NULL
    LIMIT 1
  `).bind(
    tenantId,
    id,
    Math.max(1, Number(request.approval_revision ?? 1)),
    currentUserId,
  ).first<{ id: number }>();
  const canCurrentUserApprove = isTwoPersonApproverRole(String(c.get('role') ?? ''))
    && isOpen
    && !isRequester
    && !currentDecision
    && String(request.execution_status ?? '') !== 'failed';

  const hold = type === 'refund' ? await loadRefundCashHold(db, tenantId, id) : null;
  const dispute = hold ? await loadRefundCashDisputeByHold(db, tenantId, hold.id) : null;
  let refundReview: Record<string, unknown> | null = null;
  if (type === 'refund') {
    const billId = Number(request.entity_id);
    const bill = await db.prepare(`
      SELECT b.id, b.invoice_no, b.patient_id, b.status, b.total, b.paid, b.due,
             b.discount, b.test_bill, b.doctor_visit_bill, b.admission_bill,
             b.operation_bill, b.medicine_bill, p.name AS patient_name,
             p.patient_code
      FROM bills b
      LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      WHERE b.tenant_id = ? AND b.id = ?
      LIMIT 1
    `).bind(tenantId, billId).first<any>();
    const latestPayment = await db.prepare(`
      SELECT id, amount, payment_method, payment_type, receipt_no, counter_id, counter_session_id, date
      FROM payments
      WHERE tenant_id = ? AND bill_id = ?
      ORDER BY id DESC LIMIT 1
    `).bind(tenantId, billId).first<any>();
    let allocations: RefundAllocatedItem[] = [];
    let allocationError: string | null = null;
    let commissionPreview: RefundCommissionImpactPreview = {
      rows: [], totalReversal: 0, blocked: false, blockedReasons: [],
    };
    if (String(requestData.refundKind) === 'amount_partial_refund') {
      try {
        allocations = storedAmountRefundAllocations(requestData);
        if (allocations.length === 0) {
          allocations = (await resolveAmountRefundAllocation(db, {
            tenantId,
            billId,
            requestData,
            excludeApprovalRequestId: id,
          })).items;
        }
        const reservationPreview = await loadRefundCommissionReservationPreview(db, tenantId, id);
        commissionPreview = reservationPreview ?? await previewRefundCommissionImpact(db, { tenantId, billId, allocations });
      } catch (error) {
        allocationError = error instanceof Error ? error.message : String(error);
      }
    }
    const categoryReduction = allocations.reduce((totals, item) => {
      if (item.itemCategory === 'test') totals.testBill += item.allocatedRefundAmount;
      else if (item.itemCategory === 'doctor_visit') totals.doctorVisitBill += item.allocatedRefundAmount;
      else if (item.itemCategory === 'admission') totals.admissionBill += item.allocatedRefundAmount;
      else if (item.itemCategory === 'operation') totals.operationBill += item.allocatedRefundAmount;
      else if (item.itemCategory === 'medicine') totals.medicineBill += item.allocatedRefundAmount;
      return totals;
    }, { testBill: 0, doctorVisitBill: 0, admissionBill: 0, operationBill: 0, medicineBill: 0 });
    const requestedRefund = roundMoney(Number(requestData.requestedRefundAmount ?? 0));
    const financialImpact = bill ? tryCalculateRefundFinancialImpact({
      originalTotal: Number(bill.total ?? 0),
      originalPaid: Number(bill.paid ?? 0),
      totalCredit: requestedRefund,
    }) : null;
    refundReview = {
      reason: String(requestData.reason ?? '-'),
      bill,
      latestPayment,
      allocationMode: requestData.allocationMode ?? 'auto_proportional_adjustable',
      allocationVersion: requestData.allocationVersion ?? 1,
      allocationError,
      allocations,
      cashHold: hold,
      dispute,
      collectionImpact: bill && financialImpact ? {
        before: {
          total: Number(bill.total ?? 0), paid: Number(bill.paid ?? 0), due: Number(bill.due ?? 0),
          testBill: Number(bill.test_bill ?? 0), doctorVisitBill: Number(bill.doctor_visit_bill ?? 0),
          admissionBill: Number(bill.admission_bill ?? 0), operationBill: Number(bill.operation_bill ?? 0),
          medicineBill: Number(bill.medicine_bill ?? 0),
        },
        reduction: categoryReduction,
        after: {
          total: financialImpact.newTotal, paid: financialImpact.newPaid, due: financialImpact.newDue,
          testBill: roundMoney(Math.max(0, Number(bill.test_bill ?? 0) - categoryReduction.testBill)),
          doctorVisitBill: roundMoney(Math.max(0, Number(bill.doctor_visit_bill ?? 0) - categoryReduction.doctorVisitBill)),
          admissionBill: roundMoney(Math.max(0, Number(bill.admission_bill ?? 0) - categoryReduction.admissionBill)),
          operationBill: roundMoney(Math.max(0, Number(bill.operation_bill ?? 0) - categoryReduction.operationBill)),
          medicineBill: roundMoney(Math.max(0, Number(bill.medicine_bill ?? 0) - categoryReduction.medicineBill)),
        },
      } : null,
      commissionImpact: commissionPreview,
    };
  }

  const { results: eventRows } = await db.prepare(`
    SELECT id, action, actor_id, old_status, new_status, notes, metadata, created_at
    FROM approval_events
    WHERE tenant_id = ? AND approval_request_id = ?
    ORDER BY created_at ASC, id ASC
  `).bind(tenantId, id).all<any>();
  const eventNames = await loadUserDisplayNames(db, tenantId, (eventRows ?? []).map((event) => event.actor_id));

  return c.json({
    data: {
      ...enriched,
      approval_key: `approval_requests:${id}`,
      requested_by_name: names.get(Number(request.requested_by)),
      reviewed_by_name: names.get(Number(request.reviewed_by)),
      current_user_approved: Boolean(currentDecision),
      can_current_user_approve: canCurrentUserApprove,
      approval_blocked_reason: canCurrentUserApprove ? null
        : isRequester ? 'You cannot approve your own request'
          : currentDecision ? 'You already approved this request'
            : !isOpen ? 'This approval request is already closed'
              : 'Your role cannot approve this controlled request',
      cash_hold: hold,
      dispute,
      refund_review: refundReview,
      events: (eventRows ?? []).map((event) => ({
        ...event,
        actor_name: eventNames.get(Number(event.actor_id)),
        metadata: parseRequestData(event.metadata),
      })),
    },
  });
});

// GET /:id/events — Structured event trail for an approval request
approvals.get('/:id/events', requireRole(...APPROVAL_REVIEW_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid approval ID' }, 400);
  }

  const tenantId = requireTenantId(c);
  const db = c.env.DB;

  const request = await d1WithRetry(
    () => db
      .prepare(`SELECT id FROM approval_requests WHERE id = ? AND tenant_id = ? LIMIT 1`)
      .bind(id, tenantId)
      .first(),
    { label: `GET /:id/events: approval exists #${id}` },
  );

  if (!request) {
    return c.json({ error: 'Approval request not found' }, 404);
  }

  const { results } = await d1WithRetry(
    () => db.prepare(`
      SELECT id, approval_request_id, action, actor_id, old_status, new_status, notes, metadata, created_at
      FROM approval_events
      WHERE tenant_id = ? AND approval_request_id = ?
      ORDER BY created_at ASC, id ASC
    `).bind(tenantId, id).all(),
    { label: `GET /:id/events: list #${id}` },
  );

  const actorNames = await loadUserDisplayNames(db, tenantId, (results ?? []).map((event: any) => event.actor_id));
  const data = (results ?? []).map((event: any) => ({
    ...event,
    actor_name: actorNames.get(Number(event.actor_id)),
    metadata: parseRequestData(event.metadata),
  }));

  return c.json({ data });
});

// POST /:id/request-info — Ask requester for more proof without changing approval status
approvals.post('/:id/request-info', requireRole(...APPROVAL_REVIEW_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id) || id <= 0) {
    return c.json({ error: 'Invalid approval ID' }, 400);
  }

  const body = await c.req.json();
  const parsed = requestInfoApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { notes, missingItems } = parsed.data;
  const userId = Number(c.get('userId'));
  if (!Number.isFinite(userId) || userId <= 0) {
    return c.json({ error: 'Unauthenticated' }, 401);
  }
  const tenantId = requireTenantId(c);
  const db = c.env.DB;

  const request = await d1WithRetry(
    () => db.prepare('SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first(),
    { label: `POST /:id/request-info: fetch #${id}` },
  );

  if (!request) {
    return c.json({ error: 'Approval request not found' }, 404);
  }
  if (!['pending', 'partially_approved'].includes(String((request as any).status))) {
    return c.json({ error: 'Only pending requests can ask for more information' }, 409);
  }
  if (String((request as any).requested_by) === String(userId)) {
    return c.json({ error: 'Cannot request information on your own request' }, 403);
  }

  const enriched = enrichApprovalRow(request as any);
  const storedRevision = Number((request as any).approval_revision);
  const hasRevisionPolicy = Number.isInteger(storedRevision) && storedRevision > 0;

  // Rolling-schema compatibility: historical databases and lightweight route
  // fixtures created before migration 0540 retain the non-revision event path.
  // Migrated databases always use the atomic revision reset below.
  if (!hasRevisionPolicy) {
    await recordApprovalEvent(db, tenantId, id, 'request_info', userId, 'pending', 'pending', notes, {
      missingItems: missingItems ?? [],
      evidenceStatus: enriched.evidence_status,
      policyReason: enriched.policy_reason,
    });

    void createAuditLog(c.env, tenantId!, String(userId), 'UPDATE', 'approval_requests', id, request, {
      status: 'pending',
      notes,
      missingItems: missingItems ?? [],
    });

    return c.json({
      data: {
        id,
        status: 'pending',
        requestInfoRequested: true,
      },
    });
  }

  const requestData = parseRequestData((request as any).request_data);
  const isExecutedRefund = canonicalApprovalRequestType(request as any) === 'refund'
    && requestData.executionMode === 'executed_pending'
    && String((request as any).execution_status ?? '') === 'succeeded';
  const nextRequestData = isExecutedRefund
    ? { ...requestData, financialState: 'refunded_correction_required' }
    : requestData;
  const expectedRevision = storedRevision + 1;
  const eventMetadata = {
    missingItems: missingItems ?? [],
    evidenceStatus: enriched.evidence_status,
    policyReason: enriched.policy_reason,
    previousRevision: storedRevision,
    approvalRevision: expectedRevision,
  };

  let revisionResult;
  try {
    revisionResult = await returnApprovalForCorrection(db, {
      tenantId,
      approvalRequestId: id,
      actorId: userId,
      reason: notes,
      missingItems: missingItems ?? [],
      requestDataJson: JSON.stringify(nextRequestData),
      event: {
        notes,
        metadataJson: JSON.stringify(eventMetadata),
      },
    });
  } catch (error) {
    if (error instanceof ApprovalPolicyError) {
      if (error.code === 'APPROVAL_NOT_FOUND') return c.json({ error: error.message }, 404);
      if (error.code === 'SELF_APPROVAL_BLOCKED') return c.json({ error: error.message }, 403);
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }

  void createAuditLog(c.env, tenantId!, String(userId), 'UPDATE', 'approval_requests', id, request, {
    status: 'pending',
    notes,
    missingItems: missingItems ?? [],
    previousRevision: revisionResult.previousRevision,
    approvalRevision: revisionResult.approvalRevision,
    approvalCount: revisionResult.approvalCount,
  });

  return c.json({
    data: {
      id,
      status: 'pending',
      requestInfoRequested: true,
      approvalRevision: revisionResult.approvalRevision,
      approvalCount: revisionResult.approvalCount,
      requiredApprovals: revisionResult.requiredApprovals,
    },
  });
});

// POST /:id/submit-info — Requester adds notes or proof after reviewer asks for information
approvals.post('/:id/submit-info', requireRole(...APPROVAL_REQUEST_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid approval ID' }, 400);

  const parsed = submitInfoApprovalSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const userId = Number(c.get('userId'));
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ error: 'Unauthenticated' }, 401);

  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const request = await d1WithRetry(
    () => db.prepare('SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first(),
    { label: `POST /:id/submit-info: fetch #${id}` },
  );
  if (!request) return c.json({ error: 'Approval request not found' }, 404);
  if ((request as any).status !== 'pending') return c.json({ error: 'Only pending requests can receive submitted information' }, 409);

  const role = String(c.get('role') ?? '');
  const requesterOwnsRequest = String((request as any).requested_by) === String(userId);
  const reviewerRole = (APPROVAL_REVIEW_ROLES as readonly string[]).includes(role);
  if (!requesterOwnsRequest && !reviewerRole) return c.json({ error: 'Only the requester or an approval reviewer can submit information' }, 403);

  const nextRequestData = mergeSubmittedInfoIntoRequestData(parseRequestData((request as any).request_data), parsed.data);
  await d1WithRetry(
    () => db.prepare("UPDATE approval_requests SET request_data = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'").bind(JSON.stringify(nextRequestData), id, tenantId).run(),
    { label: `POST /:id/submit-info: update #${id}` },
  );

  await recordApprovalEvent(db, tenantId, id, 'info_submitted', userId, 'pending', 'pending', parsed.data.notes ?? null, {
    missingItems: parsed.data.missingItems ?? [],
    evidenceKeys: Object.keys(parsed.data.evidence ?? {}),
    hasEvidence: Boolean(parsed.data.attachmentUrl || parsed.data.receiptUrl || parsed.data.documentUrl || parsed.data.evidenceUrl || (parsed.data.evidence && Object.keys(parsed.data.evidence).length > 0)),
  });

  void createAuditLog(c.env, tenantId!, String(userId), 'UPDATE', 'approval_requests', id, request, { status: 'pending', infoSubmitted: true });
  return c.json({ data: { id, status: 'pending', infoSubmitted: true } });
});

// POST /bulk-review — Approve or reject multiple requests at once
approvals.post('/bulk-review', requireRole(...APPROVAL_REVIEW_ROLES), async (c) => {
  const body = await c.req.json();
  const parsed = bulkReviewApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { ids, action, notes } = parsed.data;
  const userId = Number(c.get('userId'));
  if (!Number.isFinite(userId) || userId <= 0) {
    return c.json({ error: 'Unauthenticated' }, 401);
  }
  const actorRole = String(c.get('role') ?? '');
  const tenantId = requireTenantId(c);
  const db = c.env.DB;

  // Validate all IDs are positive integers
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: `Invalid approval ID: ${id}` }, 400);
    }
  }

  // Cap at 100 to prevent runaway operations
  if (ids.length > 100) {
    return c.json({ error: 'Cannot review more than 100 approvals at once' }, 400);
  }

  // Fetch full request rows because executable approvals need type/entity/request_data.
  const placeholders = ids.map(() => '?').join(',');
  const { results: requests } = await d1WithRetry(
    () => db
      .prepare(
        `SELECT * FROM approval_requests WHERE id IN (${placeholders}) AND tenant_id = ?`
      )
      .bind(...ids, tenantId)
      .all(),
    { label: 'POST /bulk-review: fetch' },
  );

  // Validate: all IDs must exist
  if (requests.length !== ids.length) {
    return c.json({ error: 'One or more approval requests not found' }, 404);
  }

  // Validate: all must be pending
  const nonPending = requests.filter((r: any) => !['pending', 'partially_approved'].includes(String(r.status)));
  if (nonPending.length > 0) {
    return c.json(
      {
        error: `${nonPending.length} request(s) have already been reviewed`,
        alreadyReviewedIds: nonPending.map((r: any) => r.id),
      },
      409
    );
  }

  // Validate: none can be self-requested (separation of duties)
  const selfRequested = requests.filter((r: any) => String(r.requested_by) === String(userId));
  if (selfRequested.length > 0) {
    return c.json(
      {
        error: `Cannot review your own request(s): ${selfRequested.map((r: any) => r.id).join(', ')}`,
        selfRequestedIds: selfRequested.map((r: any) => r.id),
      },
      403
    );
  }

  const unsafeForBulk = action === 'approve'
    ? requests.filter((request: any) => !isBulkApproveAllowed(request))
    : requests.filter((request: any) => isExecutedPendingPaymentVoid(request));
  if (unsafeForBulk.length > 0) {
    return c.json(
      {
        error: 'One or more approval requests require individual review and cannot be bulk-reviewed',
        unsafeIds: unsafeForBulk.map((request: any) => request.id),
        unsafeTypes: Array.from(new Set(unsafeForBulk.map((request: any) => canonicalApprovalRequestType(request)))),
      },
      400,
    );
  }

  const auditAction = action === 'approve' ? 'BULK_APPROVE' : 'BULK_REJECT';
  const rejectStmt = db.prepare(`
    UPDATE approval_requests
    SET status = 'rejected',
        reviewed_by = ?,
        reviewed_at = datetime('now', '+6 hours'),
        review_notes = ?
    WHERE id = ?
      AND tenant_id = ?
      AND status IN ('pending', 'partially_approved')
      AND COALESCE(execution_status, 'not_required') != 'processing'
  `);

  const requestById = new Map((requests as any[]).map((request) => [Number(request.id), request]));
  let successCount = 0;
  let partiallyApproved = 0;
  let fullyApproved = 0;
  const failedIds: number[] = [];

  for (const id of ids) {
    const request = requestById.get(id);
    if (!request) {
      failedIds.push(id);
      continue;
    }

    try {
      if (action === 'approve') {
        const decision = await recordApprovalDecision(db, {
          tenantId,
          approvalRequestId: id,
          actorId: userId,
          actorRole,
          notes,
        });
        await recordApprovalEvent(
          db,
          tenantId,
          id,
          'bulk_approved',
          userId,
          String(request.status ?? 'pending'),
          decision.status,
          notes || null,
          {
            decisionId: decision.decisionId,
            approvalCount: decision.approvalCount,
            requiredApprovals: decision.requiredApprovals,
            remainingApprovals: decision.remainingApprovals,
            evidenceStatus: approvalEvidenceStatus(request),
          },
        );
        successCount++;
        if (decision.becameFullyApproved) fullyApproved++;
        else partiallyApproved++;
        continue;
      }

      const updateResult = await d1WithRetry(
        () => rejectStmt.bind(userId, notes || null, id, tenantId).run(),
        { label: `POST /bulk-review: reject #${id}` },
      );
      if (Number(updateResult.meta?.changes ?? 0) !== 1) {
        failedIds.push(id);
        continue;
      }
      await recordApprovalEvent(
        db,
        tenantId,
        id,
        'bulk_rejected',
        userId,
        String(request.status ?? 'pending'),
        'rejected',
        notes || null,
      );
      successCount++;
    } catch (error) {
      if (!(error instanceof ApprovalPolicyError)) {
        console.error(`Failed to review approval ${id}:`, error);
      }
      failedIds.push(id);
    }
  }

  const responseStatus = action === 'reject'
    ? 'rejected'
    : fullyApproved > 0 && partiallyApproved > 0
      ? 'mixed'
      : fullyApproved > 0
        ? 'approved'
        : 'partially_approved';

  void createAuditLog(
    c.env,
    tenantId,
    String(userId),
    auditAction,
    'approval_requests',
    0,
    null,
    {
      reviewedIds: ids,
      count: successCount,
      failedIds,
      action: responseStatus,
      partiallyApproved,
      fullyApproved,
      notes,
    },
  );

  return c.json({
    data: {
      requested: ids.length,
      succeeded: successCount,
      failed: failedIds.length,
      failedIds,
      status: responseStatus,
      partiallyApproved,
      fullyApproved,
      conversions: [],
    },
  });
});

// PUT /:id/review — Record one of two distinct approvals, or reject.
approvals.put('/:id/review', requireRole(...APPROVAL_REVIEW_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id) || id <= 0) {
    return c.json({ error: 'Invalid approval ID' }, 400);
  }
  const body = await c.req.json();
  const parsed = reviewApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const {
    action,
    notes,
    cashResolution,
    cashReturnedAcknowledged,
    idempotencyKey,
  } = parsed.data;
  const userId = Number(c.get('userId'));
  if (!Number.isFinite(userId) || userId <= 0) {
    return c.json({ error: 'Unauthenticated' }, 401);
  }
  const actorRole = String(c.get('role') ?? '');
  const tenantId = requireTenantId(c);
  const db = c.env.DB;

  const request = await d1WithRetry(
    () => db
      .prepare(`SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ?`)
      .bind(id, tenantId)
      .first(),
    { label: `PUT /:id/review: fetch #${id}` },
  );

  if (!request) {
    return c.json({ error: 'Approval request not found' }, 404);
  }

  const oldStatus = String((request as any).status ?? 'pending');
  const requestData = parseRequestData((request as any).request_data);
  const canonicalType = canonicalApprovalRequestType(request);
  const executionStatus = String((request as any).execution_status ?? 'not_required');
  if (canonicalType === 'receivable_write_off') {
    const permissions = await resolveUserPermissions(db, tenantId, actorRole, String(userId));
    if (!permissions.includes('*') && !permissions.includes('receivables.write_off.approve')) {
      return c.json({ error: 'Missing permission: receivables.write_off.approve' }, 403);
    }
  }
  const isReceivableWriteOffExecutionResume = action === 'approve'
    && canonicalType === 'receivable_write_off'
    && oldStatus === 'approved'
    && ['failed', 'succeeded'].includes(executionStatus);
  const isExecutedRefundRejectionReplay = action === 'reject'
    && canonicalType === 'refund'
    && oldStatus === 'rejected'
    && requestData.executionMode === 'executed_pending'
    && executionStatus === 'succeeded';
  if (isExecutedRefundRejectionReplay) {
    const storedKey = String(requestData.rejectionIdempotencyKey ?? '');
    const storedResolution = String(requestData.cashResolution ?? 'open_dispute');
    const storedAcknowledged = requestData.cashReturnedAcknowledged === true;
    if (!idempotencyKey) {
      return c.json({ error: 'Idempotency key is required for executed refund rejection' }, 400);
    }
    if (
      storedKey !== idempotencyKey
      || storedResolution !== cashResolution
      || storedAcknowledged !== (cashReturnedAcknowledged === true)
    ) {
      return c.json({ error: 'Executed refund rejection conflicts with the committed result' }, 409);
    }
    return c.json({
      data: {
        id,
        status: 'rejected',
        executionStatus: 'succeeded',
        replayed: true,
        cashResolution: storedResolution,
        cashHoldStatus: requestData.cashHoldStatus,
        disputeStatus: requestData.disputeStatus,
        financialState: requestData.financialState,
        canonicalRefundPublicId: requestData.canonicalRefundPublicId,
        canonicalReversalPublicId: requestData.canonicalReversalPublicId,
      },
    });
  }
  if (!['pending', 'partially_approved'].includes(oldStatus) && !isReceivableWriteOffExecutionResume) {
    return c.json({ error: 'This request has already been reviewed' }, 409);
  }

  if (String((request as any).requested_by) === String(userId)) {
    return c.json({ error: 'Cannot approve your own request' }, 403);
  }

  if (approvalRequiresApprovalNote(request, action) && !notes?.trim()) {
    return c.json({ error: 'Approval notes are required for this high-risk approval type' }, 400);
  }

  if (canonicalType === 'receivable_write_off' && action === 'reject') {
    try {
      const rejection = await rejectReceivableWriteOffApproval({
        db,
        tenantId,
        approvalId: id,
        approverId: userId,
        reviewNotes: notes || '',
      });
      void createAuditLog(c.env, tenantId, String(userId), 'REJECT', 'approval_requests', id, request, {
        operation: 'receivable_write_off_rejected',
        status: 'rejected',
        notes,
        collectionStatus: rejection.collectionStatus,
      });
      return c.json({
        data: {
          id,
          status: 'rejected',
          collectionStatus: rejection.collectionStatus,
        },
      });
    } catch (error) {
      const failure = receivableWriteOffReviewError(error);
      return c.json({ error: 'Receivable write-off rejection failed', detail: failure.message }, failure.status);
    }
  }

  if (isReceivableWriteOffExecutionResume) {
    try {
      const executed = await executeReceivableWriteOffApproval({
        db,
        tenantId,
        approvalId: id,
        approverId: userId,
        reviewNotes: notes || '',
      });
      const sideEffect: BillCancelSideEffectResult = {
        kind: 'receivable_write_off_executed',
        ...executed,
      };
      void createAuditLog(
        c.env,
        tenantId,
        String(userId),
        'PROCESS',
        'approval_requests',
        id,
        request,
        {
          operation: executionStatus === 'succeeded'
            ? 'receivable_write_off_replayed'
            : 'receivable_write_off_retried',
          status: 'approved',
          notes,
          sideEffect,
        },
      );
      return c.json({ data: { id, status: 'approved', sideEffect } });
    } catch (error) {
      const failure = receivableWriteOffReviewError(error);
      return c.json({ error: 'Approval execution failed', detail: failure.message }, failure.status);
    }
  }

  const refundKind = canonicalType === 'refund'
    ? String(requestData.refundKind ?? '')
    : '';
  const isHeldRefund = isHeldRefundKind(refundKind);

  if (action === 'approve') {
    if (canonicalType === 'bill_cancel') {
      await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'bill.cancel.unpaid');
    } else if (canonicalType === 'payment_void') {
      await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'payment.reverse');
    } else if (canonicalType === 'refund') {
      const oldValue = requestData.oldValue && typeof requestData.oldValue === 'object'
        ? requestData.oldValue as Record<string, unknown>
        : {};
      const newValue = requestData.newValue && typeof requestData.newValue === 'object'
        ? requestData.newValue as Record<string, unknown>
        : {};
      const entityNo = String((request as any).entity_no ?? '');
      const receiptNo = String(oldValue.receiptNo ?? oldValue.receipt_no ?? '');
      const requestedStatus = String(newValue.status ?? '');
      const isLegacyPaymentVoid = /^RCP-/i.test(entityNo)
        || /^RCP-/i.test(receiptNo)
        || requestedStatus === 'payment_reversal_requested'
        || requestedStatus === 'payment_void_requested';
      if (isHeldRefund) {
        await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'credit-note.cash-refund');
      } else if (isLegacyPaymentVoid) {
        await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'payment.reverse');
      } else {
        await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'credit-note.approve');
      }
    }
  }

  if (canonicalType === 'credit_discharge') {
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const financialStatus = action === 'approve' ? 'credit_approved' : 'credit_rejected';
    const reviewAction = action === 'approve' ? 'approved' : 'rejected';
    const admissionId = Number((request as any).entity_id);
    const requesterId = Number((request as any).requested_by);
    const totalDueMinor = Number(requestData.totalDueMinor ?? 0);
    const totalDue = Number.isFinite(totalDueMinor) ? Math.max(0, totalDueMinor) / 100 : 0;
    const results = await d1WithRetry(
      () => db.batch([
        db.prepare(`
          UPDATE approval_requests
          SET status = ?,
              reviewed_by = ?,
              reviewed_at = datetime('now', '+6 hours'),
              review_notes = ?
          WHERE id = ? AND tenant_id = ? AND status = 'pending'
        `).bind(newStatus, userId, notes || null, id, tenantId),
        db.prepare(`
          UPDATE admissions
          SET bill_status_on_discharge = ?,
              updated_at = datetime('now', '+6 hours')
          WHERE id = ?
            AND tenant_id = ?
            AND status = 'discharged'
            AND bill_status_on_discharge = 'credit_pending'
        `).bind(financialStatus, admissionId, tenantId),
        db.prepare(`
          INSERT INTO approval_events (
            tenant_id, approval_request_id, action, actor_id, old_status,
            new_status, notes, metadata
          ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
        `).bind(
          tenantId,
          id,
          reviewAction,
          userId,
          newStatus,
          notes || null,
          JSON.stringify({
            admissionId,
            financialStatus,
            clinicalStatus: 'discharged',
            totalDueMinor,
          }),
        ),
        db.prepare(`
          INSERT INTO notifications (tenant_id, user_id, type, title, message, link)
          SELECT ?, ?, 'credit_discharge_reviewed', ?, ?, '/reception/dashboard'
          WHERE ? > 0
        `).bind(
          tenantId,
          requesterId,
          `Credit discharge ${newStatus}`,
          `Credit discharge for ${(request as any).entity_no ?? `admission #${admissionId}`} was ${newStatus}. Outstanding amount: ৳${totalDue.toLocaleString('en-BD')}.`,
          requesterId,
        ),
      ]),
      { label: `PUT /:id/review: credit discharge #${id}` },
    );

    if (Number((results[0] as any)?.meta?.changes ?? 0) !== 1) {
      return c.json({ error: 'This request has already been reviewed' }, 409);
    }
    if (Number((results[1] as any)?.meta?.changes ?? 0) !== 1) {
      return c.json({
        error: 'Credit discharge financial status is no longer pending. Refresh the request.',
      }, 409);
    }

    void createAuditLog(c.env, tenantId, String(userId), action === 'approve' ? 'APPROVE' : 'REJECT', 'approval_requests', id, request, {
      status: newStatus,
      financialStatus,
      admissionId,
      notes,
    });

    return c.json({
      data: {
        id,
        status: newStatus,
        financialStatus,
        clinicalStatus: 'discharged',
      },
    });
  }

  if (action === 'reject' && isExecutedPendingPaymentVoid(request)) {
    const paymentId = Number(requestData.originalPaymentId ?? (request as any).entity_id);
    const billId = Number(requestData.billId);
    const originalAmount = roundMoney(Number(requestData.originalAmount ?? 0));
    const originalReceivedBy = Number(requestData.originalReceivedBy ?? (request as any).requested_by);
    const reversalReceiptNo = String(requestData.reversalReceiptNo ?? '').trim();
    const paymentMethod = String(requestData.paymentMethod ?? 'cash').trim().toLowerCase();
    if (!Number.isInteger(paymentId) || paymentId <= 0
      || !Number.isInteger(billId) || billId <= 0
      || !Number.isInteger(originalReceivedBy) || originalReceivedBy <= 0
      || originalAmount <= 0
      || !reversalReceiptNo) {
      return c.json({ error: 'Executed payment void is missing accountable reversal evidence' }, 409);
    }

    requestData.financialState = 'reversed_disputed';
    requestData.disputeStatus = 'open';
    requestData.disputeReason = notes || 'Payment void rejected';
    const results = await d1WithRetry(
      () => db.batch([
        db.prepare(`
          UPDATE approval_requests
          SET status = 'rejected',
              execution_status = 'succeeded',
              reviewed_by = ?,
              reviewed_at = datetime('now', '+6 hours'),
              review_notes = ?,
              request_data = ?
          WHERE id = ?
            AND tenant_id = ?
            AND status IN ('pending', 'partially_approved')
            AND execution_status = 'succeeded'
        `).bind(userId, notes || null, JSON.stringify(requestData), id, tenantId),
        db.prepare(`
          INSERT INTO billing_payment_void_disputes (
            tenant_id, approval_request_id, payment_id, bill_id,
            reversal_payment_id, reversal_receipt_no, requester_user_id,
            accountable_employee_id, counter_id, counter_session_id,
            amount, payment_method, status, rejection_reason, rejected_by
          ) VALUES (
            ?, ?, ?, ?,
            (SELECT id FROM payments WHERE tenant_id = ? AND external_transaction_id = ? AND receipt_no = ? LIMIT 1),
            ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?
          )
          ON CONFLICT(tenant_id, approval_request_id) DO NOTHING
        `).bind(
          tenantId,
          id,
          paymentId,
          billId,
          tenantId,
          `reverse-payment-${paymentId}`,
          reversalReceiptNo,
          reversalReceiptNo,
          Number((request as any).requested_by),
          originalReceivedBy,
          requestData.counterId == null ? null : Number(requestData.counterId),
          requestData.counterSessionId == null ? null : Number(requestData.counterSessionId),
          originalAmount,
          paymentMethod,
          notes || 'Payment void rejected',
          userId,
        ),
      ]),
      { label: `PUT /:id/review: reject executed payment void #${id}` },
    );
    if (Number((results[0] as any)?.meta?.changes ?? 0) !== 1) {
      return c.json({ error: 'This payment void request has already been reviewed' }, 409);
    }
    const disputeId = Number((results[1] as any)?.meta?.last_row_id ?? 0);

    await recordApprovalEvent(db, tenantId, id, 'rejected', userId, oldStatus, 'rejected', notes || null, {
      executionMode: 'executed_pending',
      financialState: 'reversed_disputed',
      disputeId: disputeId || null,
      disputeStatus: 'open',
      paymentId,
      billId,
      accountableEmployeeId: originalReceivedBy,
    });
    void createAuditLog(c.env, tenantId, String(userId), 'REJECT', 'approval_requests', id, request, {
      action: 'executed_payment_void_rejected',
      status: 'rejected',
      notes,
      financialState: 'reversed_disputed',
      disputeId: disputeId || null,
      paymentId,
      billId,
      accountableEmployeeId: originalReceivedBy,
    });

    return c.json({
      data: {
        id,
        status: 'rejected',
        executionStatus: 'succeeded',
        dispute: {
          id: disputeId || null,
          amount: originalAmount,
          status: 'open',
          accountableEmployeeId: originalReceivedBy,
        },
      },
    });
  }

  if (action === 'reject' && isExecutedPendingRefund(request)) {
    if (!idempotencyKey) {
      return c.json({ error: 'Idempotency key is required for executed refund rejection' }, 400);
    }
    try {
      const reversal = await reverseExecutedRefund({
        db,
        tenantId,
        request: request as Record<string, unknown>,
        reviewerId: userId,
        reason: notes || 'Executed refund rejected',
        cashResolution,
        cashReturnedAcknowledged,
        idempotencyKey,
      });
      await recordApprovalEvent(db, tenantId, id, 'rejected', userId, oldStatus, 'rejected', notes || null, {
        executionMode: 'executed_pending',
        executionStatus: 'succeeded',
        financialState: reversal.financialState,
        cashResolution: reversal.cashResolution,
        cashHoldStatus: reversal.cashHoldStatus,
        disputeStatus: reversal.disputeStatus,
        canonicalRefundPublicId: reversal.canonicalRefundPublicId,
        canonicalReversalPublicId: reversal.canonicalReversalPublicId,
        financialExecutionMode: reversal.executionMode,
      });
      void createAuditLog(c.env, tenantId, String(userId), 'REJECT', 'approval_requests', id, request, {
        action: 'executed_refund_rejected',
        status: 'rejected',
        notes,
        ...reversal,
      });
      return c.json({
        data: {
          id,
          status: 'rejected',
          executionStatus: 'succeeded',
          ...reversal,
        },
      });
    } catch (error) {
      const status = Number((error as { status?: number })?.status ?? 409);
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Executed refund rejection failed', detail: message }, status as 409);
    }
  }

  if (action === 'reject' && isHeldRefund) {
    const hold = await loadHeldRefundCashHold(db, tenantId, id);
    if (!hold) {
      return c.json({ error: 'This refund request does not have an active cash hold.' }, 409);
    }
    const disputeInput = {
      tenantId,
      holdId: hold.id,
      approvalRequestId: id,
      billId: hold.billId,
      requesterUserId: Number(request.requested_by),
      amount: hold.amount,
      requesterCounterId: hold.counterId,
      requesterCounterSessionId: hold.counterSessionId,
      requesterEmployeeId: hold.employeeId,
      custodyUserId: hold.custodyUserId,
      rejectedBy: userId,
      reason: notes || 'Refund request rejected',
    };
    const disputeAccountingEventKey = createPostingEventKey(
      'refund_cash_dispute_opened',
      `hold:${hold.id}`,
      ACCOUNTING_EVENT_TYPES.manualJournal,
    );
    const disputeAccountingStatement = await prepareRefundDisputeOpenedAccountingEvent(db, {
      ...disputeInput,
      eventDate: getTodayGMT6(),
    });
    const commissionReservation = await loadRefundCommissionReservationPreview(db, tenantId, id);
    const commissionOperationKey = `refund-rejection:${id}`;
    const reservedCommissionRows = commissionReservation?.status === 'held'
      ? commissionReservation.rows.filter((row) => row.reversalAmount > 0)
      : [];
    requestData.commissionReservationStatus = reservedCommissionRows.length > 0
      ? 'disputed'
      : requestData.commissionReservationStatus ?? 'not_applicable';
    const commissionTransitionStatements = reservedCommissionRows.length > 0
      ? [
        ...buildTransitionRefundCommissionReservationStatements(db, {
          tenantId,
          approvalRequestId: id,
          fromStatus: 'held',
          toStatus: 'disputed',
          userId,
          reason: notes || 'Refund request rejected',
          expectedChanges: reservedCommissionRows.length,
          operationKey: commissionOperationKey,
        }),
        prepareClearRefundBatchAssertions(db, tenantId, commissionOperationKey),
      ]
      : [];
    const rejectionOperationKey = `refund-rejection-core:${id}`;
    const rejectionStatements = [
      db.prepare(`
        UPDATE approval_requests
        SET status = 'rejected',
            reviewed_by = ?,
            reviewed_at = datetime('now', '+6 hours'),
            review_notes = ?,
            request_data = ?
        WHERE id = ?
          AND tenant_id = ?
          AND status IN ('pending', 'partially_approved')
          AND COALESCE(execution_status, 'not_required') NOT IN ('processing', 'succeeded')
      `).bind(userId, notes || null, JSON.stringify(requestData), id, tenantId),
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey: rejectionOperationKey,
        stepKey: 'approval',
        expectedChanges: 1,
      }),
      prepareCreateRefundDispute(db, disputeInput),
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey: rejectionOperationKey,
        stepKey: 'dispute',
        expectedChanges: 1,
      }),
      prepareCreateRefundDisputeCashOut(db, disputeInput),
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey: rejectionOperationKey,
        stepKey: 'cash-out',
        expectedChanges: 1,
      }),
      prepareAttachRefundDisputeCashOut(db, disputeInput),
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey: rejectionOperationKey,
        stepKey: 'dispute-cash-link',
        expectedChanges: 1,
      }),
      disputeAccountingStatement,
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey: rejectionOperationKey,
        stepKey: 'accounting',
        expectedChanges: 1,
      }),
      prepareMarkRefundHoldDisputed(db, disputeInput),
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey: rejectionOperationKey,
        stepKey: 'cash-hold',
        expectedChanges: 1,
      }),
      prepareClearRefundBatchAssertions(db, tenantId, rejectionOperationKey),
      ...commissionTransitionStatements,
    ];
    try {
      await d1WithRetry(
        () => db.batch(rejectionStatements),
        { label: `PUT /:id/review: reject refund and open dispute #${id}` },
      );
    } catch (error) {
      if (isRefundBatchAssertionError(error)) {
        return c.json({ error: 'Refund rejection could not reconcile the cash and commission holds atomically. Refresh and try again.' }, 409);
      }
      throw error;
    }

    const [disputedHold, dispute] = await Promise.all([
      loadRefundCashHold(db, tenantId, id),
      loadRefundCashDisputeByHold(db, tenantId, hold.id),
    ]);
    if (!disputedHold || disputedHold.status !== 'disputed' || !dispute || dispute.status !== 'open') {
      return c.json({ error: 'Refund disputed cash could not be verified' }, 409);
    }
    await shadowRefundDisputeOpened(db, dispute, Number(userId));

    await recordApprovalEvent(
      db,
      tenantId,
      id,
      'rejected',
      userId,
      oldStatus,
      'rejected',
      notes || null,
      {
        cashHoldId: disputedHold.id,
        heldAmount: disputedHold.amount,
        cashHoldStatus: disputedHold.status,
        disputeId: dispute.id,
        disputeStatus: dispute.status,
        requesterUserId: dispute.requesterUserId,
      },
    );
    void createAuditLog(c.env, tenantId, String(userId), 'REJECT', 'approval_requests', id, request, {
      status: 'rejected',
      notes,
      cashHoldId: hold.id,
      cashHoldStatus: 'disputed',
      disputeId: dispute.id,
      requesterUserId: dispute.requesterUserId,
    });

    return c.json({
      data: {
        id,
        status: 'rejected',
        cashHold: {
          id: disputedHold.id,
          amount: disputedHold.amount,
          status: 'disputed',
        },
        dispute: {
          id: dispute.id,
          amount: dispute.amount,
          status: dispute.status,
          requesterUserId: dispute.requesterUserId,
        },
      },
    });
  }

  if (action === 'reject'
    && canonicalType === 'manual_adjustment'
    && requestData.kind === 'refund_dispute_writeoff') {
    const disputeId = Number(requestData.refundDisputeId ?? (request as any).entity_id);
    if (!Number.isInteger(disputeId) || disputeId <= 0) {
      return c.json({ error: 'Refund dispute write-off approval is missing a valid dispute ID' }, 409);
    }
    const results = await d1WithRetry(
      () => db.batch([
        db.prepare(`
          UPDATE approval_requests
          SET status = 'rejected',
              reviewed_by = ?,
              reviewed_at = datetime('now', '+6 hours'),
              review_notes = ?
          WHERE id = ?
            AND tenant_id = ?
            AND status IN ('pending', 'partially_approved')
            AND COALESCE(execution_status, 'not_required') != 'processing'
        `).bind(userId, notes || null, id, tenantId),
        db.prepare(`
          UPDATE billing_refund_cash_disputes
          SET status = 'open',
              settlement_method = NULL,
              settlement_reference_type = NULL,
              settlement_reference_id = NULL,
              settlement_idempotency_key = NULL,
              updated_at = datetime('now', '+6 hours')
          WHERE tenant_id = ?
            AND id = ?
            AND status = 'writeoff_pending'
            AND settlement_reference_type = 'approval_request'
            AND settlement_reference_id = ?
            AND EXISTS (
              SELECT 1 FROM approval_requests approval
              WHERE approval.tenant_id = billing_refund_cash_disputes.tenant_id
                AND approval.id = ?
                AND approval.status = 'rejected'
            )
        `).bind(tenantId, disputeId, id, id),
      ]),
      { label: `PUT /:id/review: reject refund dispute write-off #${id}` },
    );
    if (Number((results[0] as any)?.meta?.changes ?? 0) !== 1
      || Number((results[1] as any)?.meta?.changes ?? 0) !== 1) {
      return c.json({ error: 'Refund dispute write-off rejection could not be completed' }, 409);
    }
    await recordApprovalEvent(db, tenantId, id, 'rejected', userId, oldStatus, 'rejected', notes || null, {
      kind: 'refund_dispute_writeoff',
      refundDisputeId: disputeId,
      disputeStatus: 'open',
    });
    void createAuditLog(c.env, tenantId, String(userId), 'REJECT', 'approval_requests', id, request, {
      status: 'rejected',
      notes,
      refundDisputeId: disputeId,
      disputeStatus: 'open',
    });
    return c.json({ data: { id, status: 'rejected', refundDisputeId: disputeId, disputeStatus: 'open' } });
  }

  if (action === 'reject') {
    const updateResult = await d1WithRetry(
      () => db.prepare(`
        UPDATE approval_requests
        SET status = 'rejected',
            reviewed_by = ?,
            reviewed_at = datetime('now', '+6 hours'),
            review_notes = ?
        WHERE id = ?
          AND tenant_id = ?
          AND status IN ('pending', 'partially_approved')
          AND COALESCE(execution_status, 'not_required') != 'processing'
      `).bind(userId, notes || null, id, tenantId).run(),
      { label: `PUT /:id/review: reject #${id}` },
    );
    if (Number(updateResult.meta?.changes ?? 0) !== 1) {
      return c.json({ error: 'This request has already been reviewed' }, 409);
    }
    await recordApprovalEvent(db, tenantId, id, 'rejected', userId, oldStatus, 'rejected', notes || null);
    void createAuditLog(c.env, tenantId, String(userId), 'REJECT', 'approval_requests', id, request, { status: 'rejected', notes });
    return c.json({ data: { id, status: 'rejected' } });
  }

  let decision;
  try {
    decision = await recordApprovalDecision(db, {
      tenantId,
      approvalRequestId: id,
      actorId: userId,
      actorRole,
      notes,
    });
  } catch (error) {
    if (error instanceof ApprovalPolicyError) {
      if (error.code === 'APPROVAL_NOT_FOUND') return c.json({ error: error.message }, 404);
      if (error.code === 'SELF_APPROVAL_BLOCKED' || error.code === 'UNAUTHORIZED_APPROVER') {
        return c.json({ error: error.message }, 403);
      }
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }

  const decisionMetadata = {
    decisionId: decision.decisionId,
    approvalRevision: decision.approvalRevision,
    approvalCount: decision.approvalCount,
    requiredApprovals: decision.requiredApprovals,
    remainingApprovals: decision.remainingApprovals,
    evidenceStatus: approvalEvidenceStatus(request),
  };
  await recordApprovalEvent(
    db,
    tenantId,
    id,
    'approved',
    userId,
    oldStatus,
    decision.status,
    notes || null,
    decisionMetadata,
  );

  if (!decision.becameFullyApproved) {
    void createAuditLog(c.env, tenantId, String(userId), 'APPROVE', 'approval_requests', id, request, {
      status: decision.status,
      notes,
      ...decisionMetadata,
    });
    return c.json({
      data: {
        id,
        status: decision.status,
        approvalRevision: decision.approvalRevision,
        approvalCount: decision.approvalCount,
        requiredApprovals: decision.requiredApprovals,
        remainingApprovals: decision.remainingApprovals,
        approvalStage: decision.label,
      },
    });
  }

  if (canonicalType === 'receivable_write_off') {
    try {
      const executed = await executeReceivableWriteOffApproval({
        db,
        tenantId,
        approvalId: id,
        approverId: userId,
        reviewNotes: notes || '',
      });
      const sideEffect: BillCancelSideEffectResult = {
        kind: 'receivable_write_off_executed',
        ...executed,
      };
      void createAuditLog(c.env, tenantId, String(userId), 'APPROVE', 'approval_requests', id, request, {
        operation: 'receivable_write_off_executed',
        status: 'approved',
        notes,
        sideEffect,
        ...decisionMetadata,
      });
      return c.json({
        data: {
          id,
          status: 'approved',
          approvalRevision: decision.approvalRevision,
          approvalCount: decision.approvalCount,
          requiredApprovals: decision.requiredApprovals,
          remainingApprovals: decision.remainingApprovals,
          approvalStage: decision.label,
          sideEffect,
        },
      });
    } catch (error) {
      const failure = receivableWriteOffReviewError(error);
      return c.json({ error: 'Approval execution failed', detail: failure.message }, failure.status);
    }
  }

  if (isExecutedPendingRefund(request)) {
    requestData.financialState = 'approved_refund';
    requestData.disputeStatus = 'not_required';
    requestData.approvedAt = new Date().toISOString();
    const updateResult = await d1WithRetry(
      () => db.prepare(`
        UPDATE approval_requests
        SET reviewed_by = ?,
            reviewed_at = datetime('now', '+6 hours'),
            review_notes = ?,
            request_data = ?
        WHERE id = ?
          AND tenant_id = ?
          AND status = 'approved'
          AND execution_status = 'succeeded'
      `).bind(userId, notes || null, JSON.stringify(requestData), id, tenantId).run(),
      { label: `PUT /:id/review: finalize executed refund #${id}` },
    );
    if (Number(updateResult.meta?.changes ?? 0) !== 1) {
      return c.json({ error: 'Executed refund review could not be finalized' }, 409);
    }
    void createAuditLog(c.env, tenantId, String(userId), 'APPROVE', 'approval_requests', id, request, {
      action: 'executed_refund_approved',
      status: 'approved',
      notes,
      financialState: 'approved_refund',
      creditNoteNo: requestData.creditNoteNo ?? null,
      ...decisionMetadata,
    });
    return c.json({
      data: {
        id,
        status: 'approved',
        executionStatus: 'succeeded',
        financialState: 'approved_refund',
        approvalRevision: decision.approvalRevision,
        approvalCount: decision.approvalCount,
        requiredApprovals: decision.requiredApprovals,
        remainingApprovals: decision.remainingApprovals,
        approvalStage: decision.label,
      },
    });
  }

  if (isExecutedPendingPaymentVoid(request)) {
    requestData.financialState = 'approved_reversal';
    requestData.disputeStatus = 'not_required';
    requestData.approvedAt = new Date().toISOString();
    const updateResult = await d1WithRetry(
      () => db.prepare(`
        UPDATE approval_requests
        SET reviewed_by = ?,
            reviewed_at = datetime('now', '+6 hours'),
            review_notes = ?,
            request_data = ?
        WHERE id = ?
          AND tenant_id = ?
          AND status = 'approved'
          AND execution_status = 'succeeded'
      `).bind(userId, notes || null, JSON.stringify(requestData), id, tenantId).run(),
      { label: `PUT /:id/review: finalize executed payment void #${id}` },
    );
    if (Number(updateResult.meta?.changes ?? 0) !== 1) {
      return c.json({ error: 'Executed payment void review could not be finalized' }, 409);
    }
    void createAuditLog(c.env, tenantId, String(userId), 'APPROVE', 'approval_requests', id, request, {
      action: 'executed_payment_void_approved',
      status: 'approved',
      notes,
      financialState: 'approved_reversal',
      reversalReceiptNo: requestData.reversalReceiptNo ?? null,
      ...decisionMetadata,
    });
    return c.json({
      data: {
        id,
        status: 'approved',
        executionStatus: 'succeeded',
        financialState: 'approved_reversal',
        approvalRevision: decision.approvalRevision,
        approvalCount: decision.approvalCount,
        requiredApprovals: decision.requiredApprovals,
        remainingApprovals: decision.remainingApprovals,
        approvalStage: decision.label,
      },
    });
  }

  let sideEffect: BillCancelSideEffectResult | null = null;
  const requiresExecution = approvalRequiresExecution(request);
  if (requiresExecution) {
    const locked = await markApprovalExecutionStarted(db, tenantId, id, userId);
    if (!locked) {
      return c.json({ error: 'Approval execution is already in progress or completed' }, 409);
    }
    await recordApprovalEvent(db, tenantId, id, 'execution_started', userId, 'approved', 'approved', notes || null, {
      type: canonicalApprovalType((request as any).type),
      entityId: (request as any).entity_id,
      ...decisionMetadata,
    });
    try {
      sideEffect = await executeApprovalSideEffect(c.env, request, tenantId, String(userId), notes);
      await markApprovalExecutionSucceeded(db, tenantId, id);
      await recordApprovalEvent(db, tenantId, id, 'execution_succeeded', userId, 'approved', 'approved', notes || null, sideEffect ? { sideEffect, ...decisionMetadata } : decisionMetadata);
    } catch (error) {
      const message = await markApprovalExecutionFailed(db, tenantId, id, error);
      await recordApprovalEvent(db, tenantId, id, 'execution_failed', userId, 'approved', 'approved', message, {
        type: canonicalApprovalType((request as any).type),
        entityId: (request as any).entity_id,
        ...decisionMetadata,
      });
      const status = error instanceof HTTPException ? error.status : 500;
      return c.json({ error: 'Approval execution failed', detail: message }, status);
    }
  }

  await d1WithRetry(
    () => db.prepare(
      requiresExecution
        ? `UPDATE approval_requests SET reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ? WHERE id = ? AND tenant_id = ? AND status = 'approved' AND execution_status = 'succeeded'`
        : `UPDATE approval_requests SET reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ? WHERE id = ? AND tenant_id = ? AND status = 'approved' AND COALESCE(execution_status, 'not_required') != 'processing'`,
    ).bind(userId, notes || null, id, tenantId).run(),
    { label: `PUT /:id/review: finalize metadata #${id}` },
  );

  void createAuditLog(c.env, tenantId, String(userId), 'APPROVE', 'approval_requests', id, request, {
    status: 'approved',
    notes,
    sideEffect,
    ...decisionMetadata,
  });

  return c.json({
    data: {
      id,
      status: 'approved',
      approvalRevision: decision.approvalRevision,
      approvalCount: decision.approvalCount,
      requiredApprovals: decision.requiredApprovals,
      remainingApprovals: decision.remainingApprovals,
      approvalStage: decision.label,
      ...(sideEffect ? { sideEffect } : {}),
    },
  });
});

export default approvals;
