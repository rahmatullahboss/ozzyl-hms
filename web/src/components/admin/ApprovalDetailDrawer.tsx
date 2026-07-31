import { type ReactNode, useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, FileText, History, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DetailDrawer, { DrawerField, DrawerSection } from './DetailDrawer';
import ApprovalDecisionDialog, {
  type ApprovalDecisionDialogMode,
  type ApprovalDecisionDialogPayload,
} from './ApprovalDecisionDialog';
import { formatCurrency, formatDateTime } from '../../lib/format';

interface ApprovalTimelineItem {
  label: string;
  at?: string;
  by?: string;
  tone?: 'neutral' | 'success' | 'danger' | 'warning';
}

interface RefundReviewData {
  reason?: string;
  bill?: {
    id?: number;
    invoice_no?: string | null;
    patient_id?: number | null;
    patient_name?: string | null;
    patient_code?: string | null;
    status?: string | null;
    total?: number;
    paid?: number;
    due?: number;
  } | null;
  latestPayment?: Record<string, unknown> | null;
  allocationMode?: string;
  allocationError?: string | null;
  allocations?: Array<{
    invoiceItemId: number;
    description: string;
    itemCategory: string;
    refundableBalance: number;
    allocatedRefundAmount: number;
    allocationSource: string;
  }>;
  collectionImpact?: {
    before?: Record<string, number>;
    reduction?: Record<string, number>;
    after?: Record<string, number>;
  } | null;
  commissionImpact?: {
    totalReversal?: number;
    blocked?: boolean;
    blockedReasons?: string[];
    rows?: Array<{
      accrualId: number;
      doctorName: string;
      itemDescription: string;
      oldCommissionBaseAmount: number;
      newCommissionBaseAmount: number;
      oldPayableCommissionAmount: number;
      newPayableCommissionAmount: number;
      reversalAmount: number;
      paidAmount: number;
      blockedReason?: string | null;
    }>;
  } | null;
  dispute?: {
    id?: number;
    amount?: number;
    status?: string;
    requesterUserId?: number;
    rejectionReason?: string;
  } | null;
}

export type ApprovalRejectPayload = {
  notes: string;
  cashResolution?: 'open_dispute' | 'cash_returned';
  cashReturnedAcknowledged?: boolean;
  idempotencyKey?: string;
};

export type ApprovalReturnPayload = {
  notes: string;
  missingItems: string[];
};

interface ApprovalDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  approval: {
    id: string;
    type: string;
    source?: string;
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
    oldValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
    requestData?: Record<string, unknown>;
    timeline?: ApprovalTimelineItem[];
    isActionable?: boolean;
    policyReason?: string;
    evidenceRequired?: boolean;
    evidenceStatus?: string;
    slaDueAt?: string | null;
    slaMinutes?: number;
    assignedRole?: string;
    executionStatus?: string;
    executionError?: string | null;
    infoRequestStatus?: string;
    infoRequestedAt?: string | null;
    infoRequestedBy?: number | null;
    infoRequestNote?: string | null;
    infoMissingItems?: string[];
    infoSubmittedAt?: string | null;
    infoSubmittedBy?: number | null;
    infoResponseNote?: string | null;
    previousRequests?: { approved: number; rejected: number; totalAmount: number };
    approvalRevision?: number;
    approvalCount?: number;
    requiredApprovals?: number;
    remainingApprovals?: number;
    approvalStage?: string;
    currentUserApproved?: boolean;
    canCurrentUserApprove?: boolean;
    approvalBlockedReason?: string | null;
    cashHold?: {
      id: number;
      amount: number;
      status: 'held' | 'consumed' | 'released' | 'disputed' | 'settled' | string;
      counterSessionId: number;
      cashReturnEligible?: boolean;
      heldAt?: string | null;
      consumedAt?: string | null;
      releasedAt?: string | null;
      creditNoteId?: number | null;
    } | null;
    refundReview?: RefundReviewData | null;
  } | null;
  onApprove?: (id: string, note: string) => void;
  onReject?: (id: string, payload: ApprovalRejectPayload) => void;
  onRequestInfo?: (id: string, payload: ApprovalReturnPayload) => void;
  isSubmitting?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  discount: 'Discount Request',
  refund: 'Refund Request',
  expense: 'Expense Approval',
  bill_cancellation: 'Bill Cancellation',
  payment_void: 'Payment Void',
  cash_handover: 'Cash Handover',
  stock_adjustment: 'Stock Adjustment',
  doctor_payout: 'Doctor Payout',
  credit_note: 'Credit Note',
  credit_discharge: 'Credit Discharge',
  receivable_write_off: 'Receivable Write-off Request',
  manual_adjustment: 'Manual Adjustment',
};

const RISK_COLORS: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  high: 'bg-red-50 text-red-700 ring-1 ring-red-100',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  partially_approved: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
  approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  rejected: 'bg-red-50 text-red-700 ring-1 ring-red-100',
};

const NOTE_REQUIRED_APPROVAL_TYPES = new Set([
  'bill_cancel',
  'bill_cancellation',
  'payment_void',
  'refund',
  'cash_handover',
  'stock_adjustment',
  'doctor_payout',
  'manual_adjustment',
  'credit_note',
  'credit_discharge',
  'receivable_write_off',
  'expense',
]);

function isNonEmptyRecord(value?: Record<string, unknown>): value is Record<string, unknown> {
  return !!value && Object.keys(value).length > 0;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function KeyValueGrid({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="grid gap-2">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{key.replace(/_/g, ' ')}</div>
          <div className="mt-1 break-words text-sm font-medium text-[var(--color-text-primary)]">{formatValue(value)}</div>
        </div>
      ))}
    </div>
  );
}

type RefundItemView = {
  invoiceItemId: number;
  description: string;
  returnQuantity: number;
  calculatedAmount: number | null;
};

type CreditDischargeInvoiceView = {
  invoiceNumber: string;
  sourceLabel: string;
  dueAmount: number;
  categories: Array<{ label: string; amount: number }>;
};

function minorToMajorAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const minor = Number(value);
  return Number.isFinite(minor) ? minor / 100 : null;
}

function formatApiCurrency(amountMinor: unknown, currencyCode: unknown): string {
  const amount = minorToMajorAmount(amountMinor);
  const currency = typeof currencyCode === 'string' && /^[A-Z]{3}$/.test(currencyCode)
    ? currencyCode
    : 'BDT';
  if (amount === null) return '-';
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

function formatAuthorityMode(value: unknown): string {
  const mode = String(value ?? '').trim().toLowerCase();
  if (mode === 'legacy') return 'Legacy authority';
  if (mode === 'shadow') return 'Shadow authority';
  if (mode === 'canonical') return 'Canonical authority';
  return mode ? `${mode} authority` : '-';
}

function formatExpectedPaymentDate(value: unknown): string {
  if (!value) return '-';
  const text = String(value);
  const parsed = new Date(`${text.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function creditDischargeInvoicesFromRequest(requestData?: Record<string, unknown>): CreditDischargeInvoiceView[] {
  const rawInvoices = requestData?.externalInvoices;
  if (!Array.isArray(rawInvoices)) return [];
  return rawInvoices.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const invoice = raw as Record<string, unknown>;
    const dueAmount = minorToMajorAmount(invoice.dueMinor) ?? 0;
    const rawCategories = Array.isArray(invoice.categories) ? invoice.categories : [];
    return [{
      invoiceNumber: String(invoice.invoiceNumber ?? 'Invoice'),
      sourceLabel: String(invoice.sourceLabel ?? 'Other invoice'),
      dueAmount,
      categories: rawCategories.flatMap((rawCategory) => {
        if (!rawCategory || typeof rawCategory !== 'object') return [];
        const category = rawCategory as Record<string, unknown>;
        return [{
          label: String(category.label ?? 'Other'),
          amount: minorToMajorAmount(category.amountMinor) ?? 0,
        }];
      }),
    }];
  });
}

function refundItemsFromRequest(requestData?: Record<string, unknown>): RefundItemView[] {
  const rawItems = requestData?.items;
  if (!Array.isArray(rawItems)) return [];
  return rawItems.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const invoiceItemId = Number(item.invoiceItemId ?? item.invoice_item_id ?? 0);
    const returnQuantity = Number(item.returnQuantity ?? item.return_quantity ?? 0);
    if (!Number.isInteger(invoiceItemId) || invoiceItemId <= 0 || !Number.isInteger(returnQuantity) || returnQuantity <= 0) return [];
    const amount = Number(item.calculatedAmount ?? item.calculated_amount ?? item.refundAmount ?? item.refund_amount);
    return [{
      invoiceItemId,
      description: String(item.description ?? item.itemName ?? item.item_name ?? `Invoice item #${invoiceItemId}`),
      returnQuantity,
      calculatedAmount: Number.isFinite(amount) ? amount : null,
    }];
  });
}

function cashHoldStatusLabel(status: string): string {
  if (status === 'held') return 'Pending approval — cash held';
  if (status === 'consumed') return 'Refund paid — cash movement recorded';
  if (status === 'released') return 'Cash hold released';
  if (status === 'disputed') return 'Refund rejected — cash remains disputed';
  if (status === 'settled') return 'Disputed cash settled';
  return status || 'Cash hold unavailable';
}

function decisionRecommendation(approval: NonNullable<ApprovalDetailDrawerProps['approval']>): string {
  if (approval.executionStatus === 'failed') return 'Retry or investigate the failed execution before making a new decision.';
  if (approval.infoRequestStatus === 'requested') return 'Waiting for requested information before approval.';
  if (approval.infoRequestStatus === 'submitted') return 'Requester submitted information. Review the response before deciding.';
  if (approval.approvalBlockedReason) return approval.approvalBlockedReason;
  if (approval.type === 'credit_discharge') {
    return 'The patient has already been discharged. Review only the financial exception; this decision will not readmit the patient or reverse the bed release.';
  }
  if (approval.evidenceStatus === 'missing') return 'Supporting evidence is missing. This is a warning, not an approval blocker.';
  if (approval.risk === 'high') return 'Review checklist and approve only with a clear note.';
  return 'Ready for standard review.';
}

function refundCollectionReduction(collectionImpact: RefundReviewData['collectionImpact']): number {
  if (!collectionImpact) return 0;
  const explicitReduction = Number(collectionImpact.reduction?.total);
  if (Number.isFinite(explicitReduction) && explicitReduction > 0) return explicitReduction;
  const before = Number(collectionImpact.before?.total ?? 0);
  const after = Number(collectionImpact.after?.total ?? 0);
  return Math.max(0, before - after);
}

function refundCashStateDetail(status: string): string | null {
  if (status === 'held') return 'Cash will not be deducted again on approval.';
  if (status === 'consumed') return 'The refund cash movement is already recorded; approval will not deduct it again.';
  if (status === 'released') return 'The reserved amount is available in the originating counter again.';
  if (status === 'disputed') return 'This amount remains outside available cash until recovery or an authorized write-off.';
  if (status === 'settled') return 'The disputed amount has been settled through recovery or an authorized write-off.';
  return null;
}

function CompactRefundMetric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
}) {
  const toneClass = tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-800'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-[var(--color-border)] bg-white text-[var(--color-text-primary)]';

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 font-data text-base font-bold">{value}</div>
      {detail && <div className="mt-0.5 space-y-0.5 text-xs opacity-80">{detail}</div>}
    </div>
  );
}

function ApprovalProgress({
  revision,
  count,
  required,
  currentUserApproved,
}: {
  revision: number;
  count: number;
  required: number;
  currentUserApproved?: boolean;
}) {
  const { t } = useTranslation('adminPages');
  const normalizedCount = Math.min(Math.max(count, 0), required);
  const percentage = required > 0 ? (normalizedCount / required) * 100 : 0;
  const firstRecorded = normalizedCount >= 1;
  const finalRecorded = normalizedCount >= required;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('pendingApprovals.reviewUx.governanceReview', { defaultValue: 'Governance review' })}
          </div>
          <div className="mt-1 text-sm font-bold text-slate-950">
            {t('pendingApprovals.reviewUx.revision', { defaultValue: `Revision ${revision}`, revision })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 ring-1 ring-blue-100">
            {t('pendingApprovals.reviewUx.approvalProgress', { defaultValue: `${normalizedCount}/${required} approvals`, count: normalizedCount, required })}
          </span>
          {currentUserApproved && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
              {t('pendingApprovals.reviewUx.currentUserApproved', { defaultValue: 'You approved this revision' })}
            </span>
          )}
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={`Approval progress ${normalizedCount} of ${required}`}
        aria-valuemin={0}
        aria-valuemax={required}
        aria-valuenow={normalizedCount}
        className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${percentage}%` }} />
      </div>
      {required === 2 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${firstRecorded ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            {firstRecorded
              ? t('pendingApprovals.reviewUx.firstApprovalRecorded', { defaultValue: 'First approval recorded' })
              : t('pendingApprovals.reviewUx.firstApprovalPending', { defaultValue: 'First approval pending' })}
          </div>
          <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${finalRecorded ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            {finalRecorded
              ? t('pendingApprovals.reviewUx.finalApprovalRecorded', { defaultValue: 'Final approval recorded' })
              : t('pendingApprovals.reviewUx.finalApprovalPending', { defaultValue: 'Final approval pending' })}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          {finalRecorded
            ? t('pendingApprovals.reviewUx.approvalRecorded', { defaultValue: 'Approval recorded' })
            : t('pendingApprovals.reviewUx.approvalPending', { defaultValue: 'Approval pending' })}
        </div>
      )}
    </section>
  );
}

function RefundApprovalCompactBody({
  approval,
  refundItems,
  refundCashHold,
  refundReview,
  approvalBlocked,
  blockedGuidance,
}: {
  approval: NonNullable<ApprovalDetailDrawerProps['approval']>;
  refundItems: RefundItemView[];
  refundCashHold: NonNullable<NonNullable<ApprovalDetailDrawerProps['approval']>['cashHold']> | null;
  refundReview: RefundReviewData | null;
  approvalBlocked: boolean;
  blockedGuidance: string;
}) {
  const { t } = useTranslation('adminPages');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const allocations = refundReview?.allocations ?? [];
  const collectionImpact = refundReview?.collectionImpact ?? null;
  const commissionImpact = refundReview?.commissionImpact ?? null;
  const collectionReduction = refundCollectionReduction(collectionImpact);
  const collectionAfter = Number(collectionImpact?.after?.total ?? 0);
  const commissionReduction = Number(commissionImpact?.totalReversal ?? 0);
  const patient = refundReview?.bill?.patient_name ?? approval.patientName ?? '-';
  const invoice = refundReview?.bill?.invoice_no ?? approval.invoiceId ?? approval.referenceLabel ?? approval.reference ?? '-';
  const detailsId = `refund-review-details-${approval.id}`;
  const cashStateDetail = refundCashHold ? refundCashStateDetail(refundCashHold.status) : null;
  const commissionBlockReason = commissionImpact?.blocked
    ? (commissionImpact.blockedReasons ?? []).filter(Boolean).join('; ') || 'Commission has already been paid.'
    : '';
  const criticalWarning = refundReview?.allocationError
    || commissionBlockReason
    || approval.executionError
    || (approvalBlocked ? blockedGuidance : '')
    || (approval.evidenceStatus === 'missing' ? 'Supporting evidence is missing. This is a warning, not an approval blocker.' : '');
  const warningIsBlocking = Boolean(refundReview?.allocationError || commissionImpact?.blocked || approval.executionError || approvalBlocked);
  const requestData = approval.requestData ?? {};
  const executedPending = requestData.executionMode === 'executed_pending' && approval.executionStatus === 'succeeded';
  const approvalRevision = Math.max(1, Number(approval.approvalRevision ?? requestData.approvalRevision ?? 1));
  const approvalCount = Math.max(0, Number(approval.approvalCount ?? 0));
  const requiredApprovals = Math.max(1, Number(approval.requiredApprovals ?? 2));

  return (
    <div className="space-y-3">
      {executedPending && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950 shadow-sm">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-bold">
                {t('pendingApprovals.reviewUx.executedRefundTitle', { defaultValue: 'Refund completed — awaiting review' })}
              </div>
              <p className="mt-1 text-sm text-blue-900">
                {t('pendingApprovals.reviewUx.executedRefundDescription', { defaultValue: 'The financial refund is already recorded. Approval decisions provide post-facto governance review and will not pay the refund again.' })}
              </p>
            </div>
          </div>
        </section>
      )}

      <ApprovalProgress
        revision={approvalRevision}
        count={approvalCount}
        required={requiredApprovals}
        currentUserApproved={approval.currentUserApproved}
      />

      <section className="rounded-xl border border-[var(--color-border)] bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[approval.status] ?? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}`}>
                {approval.approvalStage ?? approval.status}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RISK_COLORS[approval.risk] ?? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}`}>
                {approval.risk} risk
              </span>
            </div>
            <div className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">{patient}</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              <span>{invoice}</span>
              <span> • Requested by </span>
              <span>{approval.requestedBy}</span>
              <span> • {approval.department}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Refund amount</div>
            <div className="font-data text-xl font-bold text-red-700">{approval.amountLabel ?? formatCurrency(approval.amount)}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{formatDateTime(approval.submittedAt)}</div>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-[var(--color-surface-muted)] px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Reason</div>
        <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{approval.reason}</p>
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        <CompactRefundMetric
          label="Cash state"
          value={refundCashHold ? cashHoldStatusLabel(refundCashHold.status) : 'No cash hold'}
          detail={refundCashHold ? (
            <>
              <div>{formatCurrency(refundCashHold.amount)}</div>
              {cashStateDetail && <div>{cashStateDetail}</div>}
            </>
          ) : undefined}
          tone={refundCashHold?.status === 'disputed'
            ? 'danger'
            : refundCashHold?.status === 'held'
              ? 'warning'
              : refundCashHold
                ? 'success'
                : 'neutral'}
        />
        <CompactRefundMetric
          label="Collection reduction"
          value={collectionImpact ? `-${formatCurrency(collectionReduction)}` : 'Not available'}
          detail={collectionImpact?.after ? <div>After: {formatCurrency(collectionAfter)}</div> : undefined}
          tone={collectionImpact ? 'danger' : 'neutral'}
        />
        <CompactRefundMetric
          label="Doctor commission"
          value={commissionImpact ? `-${formatCurrency(commissionReduction)}` : 'Not available'}
          detail={commissionImpact ? <div>{commissionImpact.blocked ? 'Approval blocked' : 'Reserved / reversed with refund'}</div> : undefined}
          tone={commissionImpact?.blocked ? 'danger' : commissionImpact ? 'warning' : 'neutral'}
        />
      </div>

      {criticalWarning && (
        <div className={`flex gap-2 rounded-lg border p-3 text-sm font-medium ${warningIsBlocking ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{criticalWarning}</span>
        </div>
      )}

      <button
        type="button"
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        onClick={() => setDetailsOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]"
      >
        <span>{detailsOpen ? 'Hide details' : 'More details'}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
      </button>

      <div id={detailsId} hidden={!detailsOpen} className="space-y-3">
        {detailsOpen && (
          <>
        <DrawerSection title="Bill and hold details">
          <div className="grid grid-cols-2 gap-2">
            {refundReview?.bill && <DrawerField label="Bill Total" value={formatCurrency(Number(refundReview.bill.total ?? 0))} />}
            {refundReview?.bill && <DrawerField label="Paid" value={formatCurrency(Number(refundReview.bill.paid ?? 0))} />}
            {refundReview?.bill && <DrawerField label="Due" value={formatCurrency(Number(refundReview.bill.due ?? 0))} />}
            {refundReview?.allocationMode && <DrawerField label="Allocation mode" value={refundReview.allocationMode.replace(/_/g, ' ')} />}
            {refundReview?.allocationError && <DrawerField label="Allocation error" value={refundReview.allocationError} />}
          </div>
          {(refundCashHold || refundReview?.dispute?.id != null) && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">
              {refundCashHold && <span>Counter session #{refundCashHold.counterSessionId}</span>}
              {refundCashHold && <span>Hold #{refundCashHold.id}</span>}
              {refundCashHold?.creditNoteId != null && <span>Credit note #{refundCashHold.creditNoteId}</span>}
              {refundReview?.dispute?.id != null && <span>Dispute #{refundReview.dispute.id}</span>}
            </div>
          )}
        </DrawerSection>

        {allocations.length > 0 && (
          <DrawerSection title="Item allocation">
            <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-white">
              {allocations.map((item) => (
                <div key={item.invoiceItemId} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-[var(--color-text-primary)]">{item.description}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      Item #{item.invoiceItemId} • {item.itemCategory.replace(/_/g, ' ')} • Balance {formatCurrency(item.refundableBalance)}
                    </div>
                  </div>
                  <div className="font-data font-bold text-red-700">-{formatCurrency(item.allocatedRefundAmount)}</div>
                </div>
              ))}
            </div>
          </DrawerSection>
        )}

        {allocations.length === 0 && refundItems.length > 0 && (
          <DrawerSection title="Item allocation">
            <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-white">
              {refundItems.map((item) => (
                <div key={`${item.invoiceItemId}-${item.returnQuantity}`} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-[var(--color-text-primary)]">{item.description}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">Item #{item.invoiceItemId} • Quantity {item.returnQuantity}</div>
                  </div>
                  {item.calculatedAmount != null && <div className="font-data font-semibold">{formatCurrency(item.calculatedAmount)}</div>}
                </div>
              ))}
            </div>
          </DrawerSection>
        )}

        {(commissionImpact?.rows ?? []).length > 0 && (
          <DrawerSection title="Doctor commission breakdown">
            <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-white">
              {(commissionImpact?.rows ?? []).map((row) => (
                <div key={row.accrualId} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-[var(--color-text-primary)]">{row.doctorName}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {row.itemDescription} • Payable {formatCurrency(row.oldPayableCommissionAmount)} → {formatCurrency(row.newPayableCommissionAmount)}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      Base {formatCurrency(row.oldCommissionBaseAmount)} → {formatCurrency(row.newCommissionBaseAmount)}
                    </div>
                  </div>
                  <div className="font-data font-bold text-red-700">-{formatCurrency(row.reversalAmount)}</div>
                </div>
              ))}
            </div>
          </DrawerSection>
        )}

        {collectionImpact?.before && collectionImpact?.after && (
          <DrawerSection title="Collection before / after">
            <div className="grid grid-cols-2 gap-2">
              <DrawerField label="Before total" value={formatCurrency(Number(collectionImpact.before.total ?? 0))} />
              <DrawerField label="After total" value={formatCurrency(Number(collectionImpact.after.total ?? 0))} />
              {collectionImpact.before.testBill != null && <DrawerField label="Before test collection" value={formatCurrency(Number(collectionImpact.before.testBill))} />}
              {collectionImpact.after.testBill != null && <DrawerField label="After test collection" value={formatCurrency(Number(collectionImpact.after.testBill))} />}
            </div>
          </DrawerSection>
        )}

        <DrawerSection title="Policy and approval">
          <div className="grid grid-cols-2 gap-2">
            <DrawerField label="Approval progress" value={approval.approvalStage ?? `${approval.approvalCount ?? 0}/${approval.requiredApprovals ?? 1}`} />
            <DrawerField label="Policy" value={approval.policyReason ?? 'Standard approval policy matched'} />
            <DrawerField label="Evidence" value={approval.evidenceStatus === 'missing' ? 'Missing' : approval.evidenceStatus === 'provided' ? 'Provided' : 'Not required'} />
            <DrawerField label="Assigned role" value={approval.assignedRole ?? '-'} />
            {approval.slaDueAt && <DrawerField label="SLA due" value={formatDateTime(approval.slaDueAt)} />}
            {approval.executionStatus && <DrawerField label="Execution" value={approval.executionStatus} />}
            {approval.executionError && <DrawerField label="Execution error" value={approval.executionError} />}
          </div>
        </DrawerSection>

        {approval.infoRequestStatus && approval.infoRequestStatus !== 'not_requested' && (
          <DrawerSection title="Information request history">
            <div className="grid grid-cols-2 gap-2">
              <DrawerField label="Status" value={approval.infoRequestStatus === 'requested' ? 'Needs info' : 'Info submitted'} />
              {approval.infoRequestedAt && <DrawerField label="Requested at" value={formatDateTime(approval.infoRequestedAt)} />}
              {approval.infoRequestedBy != null && <DrawerField label="Requested by" value={`User #${approval.infoRequestedBy}`} />}
              {approval.infoSubmittedAt && <DrawerField label="Submitted at" value={formatDateTime(approval.infoSubmittedAt)} />}
              {approval.infoSubmittedBy != null && <DrawerField label="Submitted by" value={`User #${approval.infoSubmittedBy}`} />}
              {approval.infoRequestNote && <DrawerField label="Request note" value={approval.infoRequestNote} />}
              {approval.infoResponseNote && <DrawerField label="Response note" value={approval.infoResponseNote} />}
            </div>
            {approval.infoMissingItems && approval.infoMissingItems.length > 0 && (
              <div className="mt-2 text-xs text-amber-800">Missing: {approval.infoMissingItems.join(', ')}</div>
            )}
          </DrawerSection>
        )}

        {approval.previousRequests && (
          <DrawerSection title="Previous requests by this user">
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="font-medium text-emerald-600">{approval.previousRequests.approved} approved</span>
              <span className="font-medium text-red-600">{approval.previousRequests.rejected} rejected</span>
              <span className="text-[var(--color-text-muted)]">{formatCurrency(approval.previousRequests.totalAmount)} total</span>
            </div>
          </DrawerSection>
        )}

        {approval.timeline && approval.timeline.length > 0 && (
          <DrawerSection title="Timeline / Audit Trail">
            <div className="space-y-2">
              {approval.timeline.map((item, index) => (
                <div key={`${item.label}-${index}`} className="flex gap-2 rounded-lg border border-[var(--color-border)] bg-white p-2.5 text-sm">
                  <History className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                  <div>
                    <div className="font-semibold text-[var(--color-text-primary)]">{item.label}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{item.at ? formatDateTime(item.at) : 'Time not recorded'}{item.by ? ` • ${item.by}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </DrawerSection>
        )}

        {(isNonEmptyRecord(approval.oldValue) || isNonEmptyRecord(approval.newValue)) && (
          <DrawerSection title="Before / After Values">
            <div className="grid gap-3 md:grid-cols-2">
              {isNonEmptyRecord(approval.oldValue) && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Before</h4>
                  <KeyValueGrid data={approval.oldValue} />
                </div>
              )}
              {isNonEmptyRecord(approval.newValue) && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">After</h4>
                  <KeyValueGrid data={approval.newValue} />
                </div>
              )}
            </div>
          </DrawerSection>
        )}

        {approval.attachmentUrl && (
          <DrawerSection title="Supporting Document">
            <a href={approval.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-[var(--color-primary)] hover:underline">
              <FileText className="h-4 w-4" /> View Uploaded Document
            </a>
          </DrawerSection>
        )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ApprovalDetailDrawer({ open, onClose, approval, onApprove, onReject, onRequestInfo, isSubmitting = false }: ApprovalDetailDrawerProps) {
  const { t } = useTranslation('adminPages');
  const [note, setNote] = useState('');
  const [action, setAction] = useState<'approve' | null>(null);
  const [decisionMode, setDecisionMode] = useState<ApprovalDecisionDialogMode | null>(null);

  useEffect(() => {
    setNote('');
    setAction(null);
    setDecisionMode(null);
  }, [approval?.id]);

  if (!approval) return null;

  const isOpenApproval = approval.status === 'pending' || approval.status === 'partially_approved';
  const isRefundApproval = approval.type === 'refund';
  const requestData = approval.requestData ?? {};
  const isExecutedRefund = isRefundApproval
    && requestData.executionMode === 'executed_pending'
    && approval.executionStatus === 'succeeded';
  const approvalRevision = Math.max(1, Number(approval.approvalRevision ?? requestData.approvalRevision ?? 1));
  const approvalCount = Math.max(0, Number(approval.approvalCount ?? 0));
  const requiredApprovals = Math.max(1, Number(approval.requiredApprovals ?? 2));
  const cashReturnEligible = approval.cashHold?.cashReturnEligible === true;
  const isReceivableWriteOff = approval.type === 'receivable_write_off';
  const isReceivableWriteOffRetry = isReceivableWriteOff
    && approval.status === 'approved'
    && approval.executionStatus === 'failed';
  const isActionable = approval.isActionable ?? ((isOpenApproval || isReceivableWriteOffRetry) && approval.canCurrentUserApprove !== false);
  const approvalNoteRequired = NOTE_REQUIRED_APPROVAL_TYPES.has(approval.type) || approval.risk === 'high';
  const approvalBlocked = (!isReceivableWriteOffRetry && approval.executionStatus === 'failed')
    || approval.infoRequestStatus === 'requested'
    || approval.canCurrentUserApprove === false;
  const isSyntheticHandover = approval.type === 'cash_handover' && approval.source === 'billing_handovers';
  const canRequestInfo = !isSyntheticHandover && !isReceivableWriteOffRetry && Boolean(onRequestInfo);
  const blockedGuidance = approval.approvalBlockedReason
    ?? 'Approval is blocked until the highlighted issue is resolved. Return it for correction or reject it.';
  const refundItems = isRefundApproval ? refundItemsFromRequest(approval.requestData) : [];
  const refundCashHold = isRefundApproval ? approval.cashHold ?? null : null;
  const refundReview = isRefundApproval ? approval.refundReview ?? null : null;
  const isCreditDischarge = approval.type === 'credit_discharge';
  const creditRequestData = isCreditDischarge ? approval.requestData ?? {} : {};
  const creditCurrentDue = minorToMajorAmount(creditRequestData.currentDischargeDueMinor) ?? 0;
  const creditExternalDue = minorToMajorAmount(creditRequestData.externalOutstandingMinor) ?? 0;
  const creditTotalDue = minorToMajorAmount(creditRequestData.totalDueMinor) ?? approval.amount;
  const creditInvoices = isCreditDischarge ? creditDischargeInvoicesFromRequest(creditRequestData) : [];
  const creditFinancialState = approval.status === 'approved'
    ? 'Financial: Credit approved'
    : approval.status === 'rejected'
      ? 'Financial: Credit rejected / follow-up required'
      : 'Financial: Approval pending';
  const writeOffRequestData = isReceivableWriteOff ? approval.requestData ?? {} : {};
  const writeOffSourceEvidence = isReceivableWriteOff && writeOffRequestData.sourceEvidence && typeof writeOffRequestData.sourceEvidence === 'object'
    ? writeOffRequestData.sourceEvidence as Record<string, unknown>
    : {};
  const writeOffEvidenceUrls = Array.isArray(writeOffRequestData.evidenceUrls)
    ? writeOffRequestData.evidenceUrls.map(String).filter(Boolean)
    : [];

  const approveLabel = isReceivableWriteOffRetry
    ? t('pendingApprovals.reviewUx.actions.retryExecution', { defaultValue: 'Retry execution' })
    : requiredApprovals <= 1
      ? t('pendingApprovals.reviewUx.actions.approve', { defaultValue: 'Approve' })
      : approvalCount === 0
        ? t('pendingApprovals.reviewUx.actions.recordFirst', { defaultValue: 'Record first approval' })
        : t('pendingApprovals.reviewUx.actions.giveFinal', { defaultValue: 'Give final approval' });
  const rejectLabel = isExecutedRefund
    ? t('pendingApprovals.reviewUx.actions.rejectReverseRefund', { defaultValue: 'Reject & reverse refund' })
    : t('pendingApprovals.reviewUx.actions.reject', { defaultValue: 'Reject' });

  const handleApproveSubmit = () => {
    if (approvalNoteRequired && !note.trim()) return;
    onApprove?.(approval.id, note.trim());
  };

  const handleDecisionConfirm = (payload: ApprovalDecisionDialogPayload) => {
    setDecisionMode(null);
    if (payload.mode === 'return') {
      onRequestInfo?.(approval.id, {
        notes: payload.notes,
        missingItems: payload.missingItems,
      });
      return;
    }
    onReject?.(approval.id, {
      notes: payload.notes,
      cashResolution: payload.cashResolution,
      cashReturnedAcknowledged: payload.cashReturnedAcknowledged,
      idempotencyKey: payload.idempotencyKey,
    });
  };

  const footer = !isActionable ? (
    <div className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-600">
      <ShieldCheck className="h-4 w-4" /> Read-only history
    </div>
  ) : action === 'approve' ? (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={() => { setAction(null); setNote(''); }}
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
      >
        {t('pendingApprovals.reviewUx.actions.cancel', { defaultValue: 'Cancel' })}
      </button>
      <button
        type="button"
        onClick={handleApproveSubmit}
        disabled={isSubmitting || approvalBlocked || (approvalNoteRequired && !note.trim())}
        className="btn-primary min-h-11 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Check className="h-4 w-4" /> {isSubmitting
          ? t('pendingApprovals.reviewUx.actions.saving', { defaultValue: 'Saving…' })
          : t('pendingApprovals.reviewUx.actions.confirm', { defaultValue: `Confirm ${approveLabel.toLowerCase()}`, action: approveLabel.toLowerCase() })}
      </button>
    </div>
  ) : (
    <div className="grid gap-2 sm:grid-cols-3">
      <button
        type="button"
        onClick={() => setAction('approve')}
        disabled={isSubmitting || approvalBlocked}
        className="btn-primary min-h-11 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Check className="h-4 w-4" /> {approveLabel}
      </button>
      {canRequestInfo && (
        <button
          type="button"
          onClick={() => setDecisionMode('return')}
          disabled={isSubmitting}
          className="btn-secondary min-h-11 text-sm text-amber-700 border-amber-200 hover:bg-amber-50"
        >
          <MessageSquare className="h-4 w-4" /> {t('pendingApprovals.reviewUx.actions.returnForCorrection', { defaultValue: 'Return for correction' })}
        </button>
      )}
      {!isReceivableWriteOffRetry && (
        <button
          type="button"
          onClick={() => setDecisionMode('reject')}
          disabled={isSubmitting}
          className="btn-secondary min-h-11 text-sm text-red-600 border-red-200 hover:bg-red-50"
        >
          <X className="h-4 w-4" /> {rejectLabel}
        </button>
      )}
    </div>
  );

  return (
    <>
      <DetailDrawer
        title={`${TYPE_LABELS[approval.type] ?? 'Approval'} #${approval.id}`}
        subtitle={approval.referenceLabel ?? approval.status}
        open={open}
        onClose={onClose}
        width="lg"
        footer={footer}
      >
      <div className={isRefundApproval ? 'space-y-3' : 'space-y-4'}>
        {isRefundApproval ? (
          <RefundApprovalCompactBody
            key={approval.id}
            approval={approval}
            refundItems={refundItems}
            refundCashHold={refundCashHold}
            refundReview={refundReview}
            approvalBlocked={approvalBlocked}
            blockedGuidance={blockedGuidance}
          />
        ) : (
          <>
        <div className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${RISK_COLORS[approval.risk] ?? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}`}>{approval.risk.toUpperCase()}</span>
                {approval.evidenceStatus === 'missing' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-100">Missing evidence — warning</span>}
                {approval.executionStatus === 'failed' && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-100">Execution failed</span>}
                {approval.infoRequestStatus === 'requested' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-100">Needs info</span>}
              </div>
              <h3 className="mt-3 text-lg font-bold text-[var(--color-text-primary)]">{TYPE_LABELS[approval.type] ?? 'Approval'} • {approval.referenceLabel ?? approval.reference ?? approval.id}</h3>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{approval.amountLabel ?? formatCurrency(approval.amount)} • Requested by {approval.requestedBy} • {approval.department}</p>
            </div>
            <div className="rounded-xl bg-[var(--color-surface-muted)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)]">
              {decisionRecommendation(approval)}
            </div>
          </div>
        </div>

        <DrawerSection title="Decision Checklist">
          <div className="grid gap-2 md:grid-cols-2">
            <DrawerField label="Evidence" value={approval.evidenceStatus === 'missing' ? <span className="font-semibold text-amber-700">Missing — warning only</span> : <span className="font-semibold text-emerald-700">OK</span>} />
            <DrawerField label="Approval Progress" value={approval.approvalStage ?? `${approval.approvalCount ?? 0}/${approval.requiredApprovals ?? 2}`} />
            <DrawerField label="Approval Note" value={approvalNoteRequired ? 'Required' : 'Optional'} />
            <DrawerField label="Execution" value={approval.executionStatus === 'failed' ? <span className="font-semibold text-red-700">Failed</span> : 'No blocker'} />
            <DrawerField label="Policy" value={approval.policyReason ?? 'Standard approval policy matched'} />
          </div>
          {approvalBlocked && (
            <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {blockedGuidance}
            </div>
          )}
        </DrawerSection>

        <DrawerSection title="Request Summary">
          <div className="grid grid-cols-2 gap-2">
            <DrawerField label="Request ID" value={approval.id} />
            <DrawerField label="Reference" value={approval.referenceLabel ?? approval.reference ?? '-'} />
            <DrawerField label="Type" value={<span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-100">{TYPE_LABELS[approval.type] ?? approval.type}</span>} />
            <DrawerField label="Status" value={<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[approval.status] ?? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}`}>{approval.approvalStage ?? approval.status}</span>} />
            <DrawerField label="Risk" value={<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLORS[approval.risk] ?? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}`}>{approval.risk}</span>} />
            <DrawerField label="Submitted" value={formatDateTime(approval.submittedAt)} />
          </div>
        </DrawerSection>

        {isReceivableWriteOff && (
          <DrawerSection title="Write-off Review Evidence">
            <div className="space-y-3">
              <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">This request does not reduce the receivable until two independent approvals are recorded.</div>
                  <div className="mt-1 text-xs">The requester cannot approve it. Final execution revalidates authority mode, invoice mapping, live due, currency, and terminal state.</div>
                </div>
              </div>
              {isReceivableWriteOffRetry && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="font-semibold">Execution recovery</div>
                  <div className="mt-1">Retry uses the approved amount and the same idempotency key; it does not create a new approval or silently reduce the amount.</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <DrawerField label="Requested Write-off" value={<span className="font-data font-bold text-red-700">{formatApiCurrency(writeOffRequestData.amountMinor, writeOffRequestData.currencyCode)}</span>} />
                <DrawerField label="Live Due at Request" value={<span className="font-data font-bold">{formatApiCurrency(writeOffRequestData.liveDueMinorAtRequest ?? writeOffSourceEvidence.dueMinor, writeOffRequestData.currencyCode)}</span>} />
                <DrawerField label="Authority" value={formatAuthorityMode(writeOffRequestData.authorityModeAtRequest)} />
                <DrawerField label="Invoice" value={String(writeOffSourceEvidence.invoiceNumber ?? approval.referenceLabel ?? '-')} />
                <DrawerField label="Source Key" value={String(writeOffSourceEvidence.sourceKey ?? '-')} />
                <DrawerField label="Patient ID" value={writeOffSourceEvidence.patientId == null ? '-' : String(writeOffSourceEvidence.patientId)} />
                <DrawerField label="Financial Status" value={String(writeOffSourceEvidence.financialStatus ?? '-')} />
                <DrawerField label="Reason Code" value={String(writeOffRequestData.reasonCode ?? '-').replace(/_/g, ' ')} />
              </div>
              {writeOffEvidenceUrls.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Supporting evidence</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {writeOffEvidenceUrls.map((url, index) => (
                      <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-primary)]">
                        Evidence {index + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DrawerSection>
        )}

        {isCreditDischarge && (
          <DrawerSection title="Credit Discharge Review">
            <div className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
                  Clinical: Discharged
                </div>
                <div className={`rounded-xl border p-3 text-sm font-bold ${approval.status === 'approved' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : approval.status === 'rejected' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                  {creditFinancialState}
                </div>
              </div>

              <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">The patient has already been discharged.</div>
                  <div className="mt-1 text-xs">Approve or reject only the credit exception. Neither decision will readmit the patient or reverse the released bed.</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <DrawerField label="Patient" value={String(creditRequestData.patientName ?? approval.patientName ?? '-')} />
                <DrawerField label="Patient Code" value={String(creditRequestData.patientCode ?? '-')} />
                <DrawerField label="Mobile" value={String(creditRequestData.patientMobile ?? '-')} />
                <DrawerField label="Admission" value={String(creditRequestData.admissionNo ?? approval.referenceLabel ?? '-')} />
                <DrawerField label="Current Invoice" value={String(creditRequestData.currentInvoiceNo ?? '-')} />
                <DrawerField label="Expected Payment" value={formatExpectedPaymentDate(creditRequestData.expectedPaymentDate)} />
                <DrawerField label="Current Discharge Due" value={formatCurrency(creditCurrentDue)} />
                <DrawerField label="Other Invoice Due" value={formatCurrency(creditExternalDue)} />
                <DrawerField label="Total Outstanding" value={<span className="text-lg font-bold text-red-700">{formatCurrency(creditTotalDue)}</span>} />
                <DrawerField label="Requester Role" value={String(creditRequestData.requesterRole ?? '-')} />
                <DrawerField label="Counter" value={creditRequestData.counterId == null ? '-' : `#${String(creditRequestData.counterId)}`} />
                <DrawerField label="Counter Session" value={creditRequestData.counterSessionId == null ? '-' : `#${String(creditRequestData.counterSessionId)}`} />
                <DrawerField label="Requester Acknowledged" value={creditRequestData.requesterAcknowledged === true ? 'Yes' : 'No'} />
              </div>

              {creditInvoices.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Outstanding invoice evidence</h4>
                  {creditInvoices.map((invoice) => (
                    <div key={`${invoice.invoiceNumber}-${invoice.sourceLabel}`} className="rounded-xl border border-[var(--color-border)] bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-data text-sm font-bold text-[var(--color-text-primary)]">{invoice.invoiceNumber}</div>
                          <div className="mt-1 text-xs text-[var(--color-text-muted)]">{invoice.sourceLabel}</div>
                        </div>
                        <div className="font-data text-sm font-bold text-red-700">{formatCurrency(invoice.dueAmount)}</div>
                      </div>
                      {invoice.categories.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {invoice.categories.map((category) => (
                            <span key={`${invoice.invoiceNumber}-${category.label}-${category.amount}`} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
                              {category.label}: {formatCurrency(category.amount)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-xl bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-secondary)]">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Credit reason</div>
                <div className="mt-1">{String(creditRequestData.creditReason ?? approval.reason)}</div>
              </div>
            </div>
          </DrawerSection>
        )}

        <DrawerSection title="Financial / Cash Context">
          <div className="grid grid-cols-2 gap-2">
            <DrawerField label="Amount" value={<span className="text-lg font-bold">{approval.amountLabel ?? formatCurrency(approval.amount)}</span>} />
            {approval.originalAmount != null && <DrawerField label="Original Amount" value={formatCurrency(approval.originalAmount)} />}
            {approval.discountPercent != null && <DrawerField label="Discount %" value={`${approval.discountPercent}%`} />}
            {approval.expectedAmount != null && <DrawerField label="Expected Cash" value={formatCurrency(approval.expectedAmount)} />}
            {approval.countedAmount != null && <DrawerField label="Counted Cash" value={formatCurrency(approval.countedAmount)} />}
            {approval.variance != null && <DrawerField label="Variance" value={formatCurrency(approval.variance)} />}
          </div>
        </DrawerSection>

        <DrawerSection title="Operational Context">
          <div className="grid grid-cols-2 gap-2">
            <DrawerField label="Requested By" value={approval.requestedBy} />
            <DrawerField label="Department" value={approval.department} />
            {approval.context && <DrawerField label="Context" value={approval.context} />}
            {approval.invoiceId && <DrawerField label="Invoice / Bill" value={approval.invoiceId} />}
            {approval.patientName && <DrawerField label="Patient" value={approval.patientName} />}
            {approval.cashierName && <DrawerField label="Cashier" value={approval.cashierName} />}
            {approval.receiverName && <DrawerField label="Receiver" value={approval.receiverName} />}
            {approval.reviewedBy && <DrawerField label="Reviewed By" value={approval.reviewedBy} />}
            {approval.reviewedAt && <DrawerField label="Reviewed At" value={formatDateTime(approval.reviewedAt)} />}
          </div>
        </DrawerSection>

        <DrawerSection title="Policy & Evidence">
          <div className="grid grid-cols-2 gap-2">
            <DrawerField label="Policy Trigger" value={approval.policyReason ?? 'Standard approval policy matched'} />
            <DrawerField label="Assigned Role" value={approval.assignedRole ?? '-'} />
            <DrawerField label="Evidence" value={approval.evidenceStatus === 'missing' ? 'Missing evidence' : approval.evidenceStatus === 'provided' ? 'Evidence provided' : 'Not required'} />
            <DrawerField label="SLA Due" value={approval.slaDueAt ? formatDateTime(approval.slaDueAt) : '-'} />
            {approval.executionStatus && <DrawerField label="Execution" value={approval.executionStatus} />}
            {approval.executionError && <DrawerField label="Execution Error" value={approval.executionError} />}
          </div>
          {approval.evidenceStatus === 'missing' && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
              Supporting evidence is missing. This is a warning, not an approval blocker. An authorized distinct approver may proceed after reviewing the available request details.
            </div>
          )}
        </DrawerSection>

        {approval.infoRequestStatus && approval.infoRequestStatus !== 'not_requested' && (
          <DrawerSection title="Information Request">
            <div className="grid grid-cols-2 gap-2">
              <DrawerField label="Info Status" value={approval.infoRequestStatus === 'requested' ? 'Needs info' : 'Info submitted'} />
              {approval.infoRequestedAt && <DrawerField label="Requested At" value={formatDateTime(approval.infoRequestedAt)} />}
              {approval.infoRequestedBy != null && <DrawerField label="Requested By" value={`User #${approval.infoRequestedBy}`} />}
              {approval.infoSubmittedAt && <DrawerField label="Submitted At" value={formatDateTime(approval.infoSubmittedAt)} />}
              {approval.infoSubmittedBy != null && <DrawerField label="Submitted By" value={`User #${approval.infoSubmittedBy}`} />}
              {approval.infoRequestNote && <DrawerField label="Request Note" value={approval.infoRequestNote} />}
              {approval.infoResponseNote && <DrawerField label="Response Note" value={approval.infoResponseNote} />}
            </div>
            {approval.infoMissingItems && approval.infoMissingItems.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <div className="font-semibold">Missing items</div>
                <ul className="mt-1 list-disc pl-5">
                  {approval.infoMissingItems.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
          </DrawerSection>
        )}

        <DrawerSection title="Reason">
          <p className="rounded-lg bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-secondary)]">{approval.reason}</p>
        </DrawerSection>

        {(isNonEmptyRecord(approval.oldValue) || isNonEmptyRecord(approval.newValue)) && (
          <DrawerSection title="Before / After Values">
            <div className="grid gap-3 md:grid-cols-2">
              {isNonEmptyRecord(approval.oldValue) && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Before</h4>
                  <KeyValueGrid data={approval.oldValue} />
                </div>
              )}
              {isNonEmptyRecord(approval.newValue) && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">After</h4>
                  <KeyValueGrid data={approval.newValue} />
                </div>
              )}
            </div>
          </DrawerSection>
        )}

        {approval.attachmentUrl && (
          <DrawerSection title="Supporting Document">
            <a href={approval.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-[var(--color-primary)] hover:underline">
              <FileText className="w-4 h-4" /> View Uploaded Document
            </a>
          </DrawerSection>
        )}

        {approval.timeline && approval.timeline.length > 0 && (
          <DrawerSection title="Timeline / Audit Trail">
            <div className="space-y-2">
              {approval.timeline.map((item, index) => (
                <div key={`${item.label}-${index}`} className="flex gap-3 rounded-lg border border-[var(--color-border)] bg-white p-3 text-sm">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)]"><History className="h-4 w-4" /></div>
                  <div>
                    <div className="font-semibold text-[var(--color-text-primary)]">{item.label}</div>
                    <div className="text-[var(--color-text-muted)]">{item.at ? formatDateTime(item.at) : 'Time not recorded'}{item.by ? ` • ${item.by}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </DrawerSection>
        )}

        {approval.previousRequests && (
          <DrawerSection title="Previous Requests by This User">
            <div className="flex gap-4 text-sm">
              <span className="font-medium text-emerald-600">{approval.previousRequests.approved} approved</span>
              <span className="font-medium text-red-600">{approval.previousRequests.rejected} rejected</span>
              <span className="text-[var(--color-text-muted)]">{formatCurrency(approval.previousRequests.totalAmount)} total</span>
            </div>
          </DrawerSection>
        )}
          </>
        )}

        {action === 'approve' && isActionable && (
          <DrawerSection title={approveLabel}>
            <label htmlFor={`approval-note-${approval.id}`} className="text-sm font-semibold text-slate-800">
              {approvalNoteRequired
                ? t('pendingApprovals.reviewUx.approvalNoteRequired', { defaultValue: 'Approval note (required)' })
                : t('pendingApprovals.reviewUx.approvalNoteOptional', { defaultValue: 'Approval note (optional)' })}
            </label>
            <textarea
              id={`approval-note-${approval.id}`}
              aria-label={t('pendingApprovals.reviewUx.approvalNote', { defaultValue: 'Approval note' })}
              className="mt-2 w-full resize-none rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              rows={3}
              placeholder={approvalNoteRequired
                ? t('pendingApprovals.reviewUx.approvalNotePlaceholderRequired', { defaultValue: 'Record the evidence reviewed and reason for approval.' })
                : t('pendingApprovals.reviewUx.approvalNotePlaceholderOptional', { defaultValue: 'Add an optional review note.' })}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <p className="mt-2 text-xs text-slate-500">
              {t('pendingApprovals.reviewUx.reviewOnlyExplanation', { defaultValue: 'This records a governance decision only. Executed financial actions are not repeated by approval.' })}
            </p>
          </DrawerSection>
        )}
      </div>
      </DetailDrawer>

      <ApprovalDecisionDialog
        open={open && decisionMode !== null}
        mode={decisionMode ?? 'reject'}
        approvalId={approval.id}
        approvalRevision={approvalRevision}
        approvalCount={approvalCount}
        requiredApprovals={requiredApprovals}
        executedRefund={isExecutedRefund}
        cashReturnEligible={cashReturnEligible}
        isSubmitting={isSubmitting}
        onClose={() => setDecisionMode(null)}
        onConfirm={handleDecisionConfirm}
      />
    </>
  );
}
