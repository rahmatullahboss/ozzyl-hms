import { useState } from 'react';
import { AlertTriangle, Clock, History, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { formatCurrency, formatDateTime } from '../../lib/format';
import type { PendingApprovalDateWindow } from '../../lib/pendingApprovalDateWindow';
import ApprovalDetailDrawer, {
  type ApprovalRejectPayload,
  type ApprovalReturnPayload,
} from '../admin/ApprovalDetailDrawer';

export type PendingReviewRole = 'hospital_admin' | 'md' | 'director';
type PendingMode = 'selected' | 'past';

interface PendingRequestApiItem {
  id: number;
  approval_key?: string | null;
  approval_source?: string | null;
  entity_id?: number | null;
  type: string;
  entity_no?: string | null;
  requested_by?: number | null;
  requested_by_name?: string | null;
  reviewed_by_name?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  approval_amount?: number | null;
  approval_risk?: string | null;
  status?: string | null;
  approval_revision?: number | null;
  approval_count?: number | null;
  required_approvals?: number | null;
  approval_stage?: string | null;
  current_user_approved?: boolean | null;
  can_current_user_approve?: boolean | null;
  approval_blocked_reason?: string | null;
  execution_status?: string | null;
  execution_error?: string | null;
  evidence_status?: string | null;
  policy_reason?: string | null;
  assigned_role?: string | null;
  info_request_status?: string | null;
  info_requested_at?: string | null;
  info_requested_by?: number | null;
  info_request_note?: string | null;
  info_missing_items?: string[] | null;
  info_submitted_at?: string | null;
  info_submitted_by?: number | null;
  info_response_note?: string | null;
  request_data?: Record<string, unknown> | null;
  cash_hold?: {
    id: number;
    amount: number;
    status: string;
    counter_session_id?: number | null;
    held_at?: string | null;
    consumed_at?: string | null;
    released_at?: string | null;
    credit_note_id?: number | null;
  } | null;
  refund_review?: Record<string, unknown> | null;
  events?: Array<{
    action?: string;
    actor_name?: string | null;
    actor_id?: number | null;
    notes?: string | null;
    created_at?: string | null;
  }>;
}

interface PendingRequestsResponse {
  data?: PendingRequestApiItem[];
  pagination?: { total?: number };
}

interface PendingRequestDetailResponse {
  data?: PendingRequestApiItem;
}

interface PendingRequestsSectionProps {
  role: PendingReviewRole;
  window: PendingApprovalDateWindow;
  limit?: number;
}

interface ReviewVariables {
  id: number;
  action: 'approve' | 'reject';
  notes: string;
  cashResolution?: 'open_dispute' | 'cash_returned';
  cashReturnedAcknowledged?: boolean;
  idempotencyKey?: string;
}

interface RequestInfoVariables {
  id: number;
  notes: string;
  missingItems?: string[];
}

const fullPagePathByRole: Record<PendingReviewRole, string> = {
  hospital_admin: 'action/pending-approvals',
  md: 'md/pending-approvals',
  director: 'director/pending-approvals',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function requestAmount(item: PendingRequestApiItem): number {
  const data = item.request_data ?? {};
  const candidate = item.approval_amount
    ?? data.requestedRefundAmount
    ?? data.cashRefundAmount
    ?? data.amount
    ?? data.totalAmount
    ?? 0;
  const amount = Number(candidate);
  return Number.isFinite(amount) ? amount : 0;
}

function requestReason(item: PendingRequestApiItem): string {
  const data = item.request_data ?? {};
  return firstText(data.reason, data.creditReason, data.note, data.remarks) ?? '-';
}

function requestReference(item: PendingRequestApiItem): string {
  return item.entity_no || item.approval_key || `Approval #${item.id}`;
}

function requestPatient(item: PendingRequestApiItem): string | undefined {
  const data = item.request_data ?? {};
  const oldValue = asRecord(data.oldValue);
  return firstText(data.patientName, oldValue.patientName);
}

function isSyntheticExpense(item: PendingRequestApiItem | null | undefined): boolean {
  const data = item?.request_data ?? {};
  return item?.approval_source === 'expenses'
    || data.source === 'expenses'
    || String(item?.approval_key ?? '').startsWith('expenses:');
}

function humanize(value: unknown): string {
  return String(value ?? '').replace(/_/g, ' ').trim();
}

function mapDetailToDrawer(item: PendingRequestApiItem) {
  const requestData = asRecord(item.request_data);
  const refundReview = asRecord(item.refund_review);
  const bill = asRecord(refundReview.bill);
  const oldValue = asRecord(requestData.oldValue);
  const newValue = asRecord(requestData.newValue);
  const amount = requestAmount(item);
  const cashHold = item.cash_hold ? {
    id: Number(item.cash_hold.id),
    amount: Number(item.cash_hold.amount ?? 0),
    status: String(item.cash_hold.status ?? ''),
    counterSessionId: Number(item.cash_hold.counter_session_id ?? 0),
    heldAt: item.cash_hold.held_at ?? null,
    consumedAt: item.cash_hold.consumed_at ?? null,
    releasedAt: item.cash_hold.released_at ?? null,
    creditNoteId: item.cash_hold.credit_note_id == null ? null : Number(item.cash_hold.credit_note_id),
  } : null;

  return {
    id: String(item.id),
    source: firstText(item.approval_source, requestData.source),
    type: String(item.type ?? '').replace('bill_cancel', 'bill_cancellation'),
    requestedBy: firstText(item.requested_by_name, requestData.requesterName, `User #${item.requested_by ?? '-'}`) ?? '-',
    department: firstText(requestData.department, requestData.sourceDepartment, item.type === 'refund' ? 'Billing / Cash Control' : undefined, '-') ?? '-',
    amount,
    amountLabel: formatCurrency(amount),
    reason: requestReason(item),
    submittedAt: item.created_at,
    reviewedAt: item.reviewed_at ?? undefined,
    reviewedBy: item.reviewed_by_name ?? undefined,
    risk: item.approval_risk ?? 'low',
    status: item.status ?? 'pending',
    invoiceId: firstText(bill.invoice_no, item.entity_no, requestData.invoiceNo),
    patientName: firstText(bill.patient_name, requestData.patientName),
    originalAmount: firstNumber(requestData.originalAmount, oldValue.total, oldValue.totalAmount),
    reference: `Approval #${item.id}`,
    referenceLabel: requestReference(item),
    context: firstText(requestData.context, requestData.refundKind ? humanize(requestData.refundKind) : undefined),
    attachmentUrl: firstText(requestData.attachmentUrl, requestData.receiptUrl, requestData.documentUrl),
    requestData,
    oldValue,
    newValue,
    timeline: (item.events ?? []).map((event) => ({
      label: event.notes ? `${humanize(event.action || 'event')}: ${event.notes}` : humanize(event.action || 'event'),
      at: event.created_at ?? undefined,
      by: firstText(event.actor_name, event.actor_id != null ? `User #${event.actor_id}` : undefined),
    })),
    isActionable: item.can_current_user_approve ?? ['pending', 'partially_approved'].includes(String(item.status ?? 'pending')),
    policyReason: item.policy_reason ?? undefined,
    evidenceStatus: item.evidence_status ?? 'not_required',
    assignedRole: item.assigned_role ?? undefined,
    executionStatus: item.execution_status ?? undefined,
    executionError: item.execution_error ?? null,
    infoRequestStatus: item.info_request_status ?? 'not_requested',
    infoRequestedAt: item.info_requested_at ?? null,
    infoRequestedBy: item.info_requested_by ?? null,
    infoRequestNote: item.info_request_note ?? null,
    infoMissingItems: item.info_missing_items ?? [],
    infoSubmittedAt: item.info_submitted_at ?? null,
    infoSubmittedBy: item.info_submitted_by ?? null,
    infoResponseNote: item.info_response_note ?? null,
    approvalRevision: Number(item.approval_revision ?? requestData.approvalRevision ?? 1),
    approvalCount: Number(item.approval_count ?? 0),
    requiredApprovals: Number(item.required_approvals ?? 2),
    approvalStage: item.approval_stage ?? undefined,
    currentUserApproved: Boolean(item.current_user_approved),
    canCurrentUserApprove: item.can_current_user_approve ?? undefined,
    approvalBlockedReason: item.approval_blocked_reason ?? null,
    cashHold,
    refundReview: item.refund_review ?? null,
  };
}

export default function PendingRequestsSection({ role, window, limit = 6 }: PendingRequestsSectionProps) {
  const { t } = useTranslation('dashboard');
  const { slug = '' } = useParams<{ slug: string }>();
  const [mode, setMode] = useState<PendingMode>('selected');
  const [selectedItem, setSelectedItem] = useState<PendingRequestApiItem | null>(null);
  const selectedId = selectedItem?.id ?? null;

  const params = new URLSearchParams({ status: 'pending', page: '1', limit: String(limit) });
  if (mode === 'past') {
    params.set('createdBefore', window.from);
  } else {
    params.set('createdFrom', window.from);
    params.set('createdTo', window.to);
  }

  const query = useApiQuery<PendingRequestsResponse>(
    ['pending-requests', role, mode, window.from, window.to, limit],
    `/api/approvals?${params.toString()}`,
  );
  const rows = Array.isArray(query.data?.data) ? query.data.data : [];
  const selectedListItem = selectedItem;
  const selectedIsExpense = isSyntheticExpense(selectedListItem);
  const detailQuery = useApiQuery<PendingRequestDetailResponse>(
    ['pending-request-detail', selectedId],
    selectedId != null && !selectedIsExpense ? `/api/approvals/${selectedId}` : '/api/approvals/0',
    { enabled: selectedId != null && !selectedIsExpense },
  );
  const reviewMutation = useApiMutation<unknown, ReviewVariables>(
    'put',
    (variables) => `/api/approvals/${variables.id}/review`,
  );
  const expenseReviewMutation = useApiMutation<unknown, ReviewVariables>(
    'post',
    (variables) => variables.action === 'approve'
      ? `/api/expenses/${variables.id}/approve`
      : `/api/expenses/${variables.id}/reject`,
  );
  const requestInfoMutation = useApiMutation<unknown, RequestInfoVariables>(
    'post',
    (variables) => `/api/approvals/${variables.id}/request-info`,
  );

  const total = query.data?.pagination?.total ?? rows.length;
  const fullPagePath = `/h/${slug}/${fullPagePathByRole[role]}`;
  const detailItem = selectedIsExpense
    ? selectedListItem
    : detailQuery.data?.data && !Array.isArray(detailQuery.data.data)
      ? detailQuery.data.data
      : null;
  const drawerApproval = detailItem ? mapDetailToDrawer(detailItem) : null;
  const isSubmitting = reviewMutation.isPending || expenseReviewMutation.isPending || requestInfoMutation.isPending;

  const review = async (
    id: string,
    action: 'approve' | 'reject',
    payload: { notes: string } | ApprovalRejectPayload,
  ) => {
    try {
      if (selectedIsExpense) {
        const expenseId = Number(selectedListItem?.entity_id ?? id);
        await expenseReviewMutation.mutateAsync({ id: expenseId, action, notes: payload.notes });
      } else {
        await reviewMutation.mutateAsync({ id: Number(id), action, ...payload });
      }
      toast.success(action === 'approve'
        ? 'Approval decision saved.'
        : selectedIsExpense
          ? 'Expense request rejected.'
          : 'Request rejected and refund reversal recorded.');
      await query.refetch();
      setSelectedItem(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Approval review failed.');
    }
  };

  const requestInfo = async (id: string, payload: ApprovalReturnPayload) => {
    try {
      await requestInfoMutation.mutateAsync({ id: Number(id), ...payload });
      toast.success('Request returned for correction.');
      await detailQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Information request failed.');
    }
  };

  return (
    <>
      <section className="card p-4 sm:p-5" data-testid="pending-requests-section">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">
              {t('pendingRequests.kicker', { defaultValue: 'Approval worklist' })}
            </p>
            <h2 className="section-title mt-1">
              {mode === 'past'
                ? t('pendingRequests.pastTitle', { defaultValue: 'Past Pending Requests' })
                : t('pendingRequests.title', { defaultValue: 'Pending Requests' })}
            </h2>
            <p className="section-subtitle mt-1">
              {mode === 'past'
                ? t('pendingRequests.pastSubtitle', { defaultValue: `Still-pending requests created before ${window.from}.` })
                : t('pendingRequests.subtitle', { defaultValue: `Still-pending requests created from ${window.from} to ${window.to}.` })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setMode((current) => current === 'past' ? 'selected' : 'past')}
            >
              {mode === 'past' ? <Clock className="h-4 w-4" /> : <History className="h-4 w-4" />}
              {mode === 'past'
                ? t('pendingRequests.selectedButton', { defaultValue: 'Selected Date Requests' })
                : t('pendingRequests.pastButton', { defaultValue: 'Past Pending Requests' })}
            </button>
            <Link className="btn-primary text-xs" to={fullPagePath}>
              <ShieldCheck className="h-4 w-4" />
              {t('pendingRequests.fullPageButton', { defaultValue: 'View Full Pending Review Page' })}
            </Link>
          </div>
        </div>

        {query.isLoading ? (
          <div className="mt-4 space-y-2" aria-label="Loading pending requests">
            {Array.from({ length: 3 }, (_, index) => <div key={index} className="skeleton h-16 rounded-xl" />)}
          </div>
        ) : query.isError ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {t('pendingRequests.error', { defaultValue: 'Unable to load pending requests.' })}
            </div>
            <button type="button" className="mt-2 font-semibold underline" onClick={() => query.refetch()}>
              {t('pendingRequests.retry', { defaultValue: 'Retry' })}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">
            {mode === 'past'
              ? t('pendingRequests.pastEmpty', { defaultValue: 'There are no older pending requests before this period.' })
              : t('pendingRequests.empty', { defaultValue: 'There are no pending requests created in this selected period.' })}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('pendingRequests.total', { defaultValue: '{{count}} pending requests', count: total })}
            </p>
            <div className="hidden grid-cols-[1fr_1.1fr_1.5fr_0.8fr_auto] gap-3 px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] sm:grid">
              <span>Request</span><span>Bill / Requester</span><span>Reason</span><span>Amount</span><span>Action</span>
            </div>
            {rows.map((item) => {
              const approvalKey = item.approval_key || `approval_requests:${item.id}`;
              return (
                <div key={approvalKey} className="grid gap-3 rounded-xl border border-[var(--color-border)] p-3 sm:grid-cols-[1fr_1.1fr_1.5fr_0.8fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--color-text-primary)]">{humanize(item.type)}</p>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">{formatDateTime(item.created_at)} • {item.approval_risk || 'low'} risk</p>
                  </div>
                  <div className="min-w-0 text-xs text-[var(--color-text-muted)]">
                    <p className="truncate font-semibold text-[var(--color-text-primary)]">{requestReference(item)}</p>
                    {requestPatient(item) && <p className="truncate">Patient: {requestPatient(item)}</p>}
                    <p className="truncate">Requester: {item.requested_by_name || `User #${item.requested_by ?? '-'}`}</p>
                  </div>
                  <p className="line-clamp-2 text-xs text-[var(--color-text-secondary)]" title={requestReason(item)}>{requestReason(item)}</p>
                  <div>
                    <p className="font-data text-sm font-bold text-[var(--color-text-primary)]">{formatCurrency(requestAmount(item))}</p>
                    {item.cash_hold?.status && (
                      <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        Cash: {humanize(item.cash_hold.status)}
                      </span>
                    )}
                  </div>
                  <button type="button" className="btn-secondary text-xs" onClick={() => setSelectedItem(item)}>
                    {t('pendingRequests.review', { defaultValue: 'Review' })}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedId != null && !selectedIsExpense && detailQuery.isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" aria-label="Loading approval details">
          <div className="card p-5 text-sm font-medium">Loading full refund review...</div>
        </div>
      )}
      {selectedId != null && !selectedIsExpense && detailQuery.isError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="card max-w-sm p-5 text-sm">
            <div className="font-semibold text-red-700">Unable to load approval details.</div>
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn-primary text-xs" onClick={() => detailQuery.refetch()}>Retry</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setSelectedItem(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      <ApprovalDetailDrawer
        open={selectedId != null && Boolean(drawerApproval)}
        onClose={() => setSelectedItem(null)}
        approval={drawerApproval}
        onApprove={(id, notes) => { void review(id, 'approve', { notes }); }}
        onReject={(id, payload) => { void review(id, 'reject', payload); }}
        onRequestInfo={selectedIsExpense ? undefined : (id, payload) => { void requestInfo(id, payload); }}
        isSubmitting={isSubmitting}
      />
    </>
  );
}
