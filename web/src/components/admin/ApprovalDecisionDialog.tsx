import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeftRight, Banknote, ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ApprovalDecisionDialogMode = 'return' | 'reject';
export type ApprovalCashResolution = 'open_dispute' | 'cash_returned';

export type ApprovalDecisionDialogPayload =
  | {
      mode: 'return';
      notes: string;
      missingItems: string[];
    }
  | {
      mode: 'reject';
      notes: string;
      cashResolution: ApprovalCashResolution;
      cashReturnedAcknowledged: boolean;
      idempotencyKey: string;
    };

interface ApprovalDecisionDialogProps {
  open: boolean;
  mode: ApprovalDecisionDialogMode;
  approvalId: string;
  approvalRevision: number;
  approvalCount: number;
  requiredApprovals: number;
  executedRefund: boolean;
  cashReturnEligible?: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (payload: ApprovalDecisionDialogPayload) => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function parseMissingItems(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

export default function ApprovalDecisionDialog({
  open,
  mode,
  approvalId,
  approvalRevision,
  approvalCount,
  requiredApprovals,
  executedRefund,
  cashReturnEligible = false,
  isSubmitting = false,
  onClose,
  onConfirm,
}: ApprovalDecisionDialogProps) {
  const { t } = useTranslation('adminPages');
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [notes, setNotes] = useState('');
  const [missingItems, setMissingItems] = useState('');
  const [cashResolution, setCashResolution] = useState<ApprovalCashResolution>('open_dispute');
  const [cashReturnedAcknowledged, setCashReturnedAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setNotes('');
    setMissingItems('');
    setCashResolution('open_dispute');
    setCashReturnedAcknowledged(false);
  }, [approvalId, approvalRevision, mode, open]);

  if (!open) return null;

  const nextRevision = approvalRevision + 1;
  const returnMode = mode === 'return';
  const title = returnMode
    ? t('pendingApprovals.reviewUx.dialog.returnTitle', { defaultValue: 'Return for correction' })
    : executedRefund
      ? t('pendingApprovals.reviewUx.dialog.rejectRefundTitle', { defaultValue: 'Reject & reverse refund' })
      : t('pendingApprovals.reviewUx.dialog.rejectTitle', { defaultValue: 'Reject request' });
  const submitLabel = returnMode
    ? t('pendingApprovals.reviewUx.dialog.returnSubmit', { defaultValue: `Return and start revision ${nextRevision}`, revision: nextRevision })
    : executedRefund
      ? t('pendingApprovals.reviewUx.dialog.rejectReverseSubmit', { defaultValue: 'Reject and reverse refund' })
      : t('pendingApprovals.reviewUx.dialog.rejectSubmit', { defaultValue: 'Reject request' });
  const submitDisabled = isSubmitting
    || notes.trim().length === 0
    || (mode === 'reject' && cashResolution === 'cash_returned' && !cashReturnedAcknowledged);
  const idempotencyKey = `refund-reject:${approvalId}:r${approvalRevision}`;
  const isDirty = notes.trim().length > 0
    || missingItems.trim().length > 0
    || cashResolution !== 'open_dispute'
    || cashReturnedAcknowledged;

  const submit = () => {
    if (submitDisabled) return;
    if (returnMode) {
      onConfirm({
        mode: 'return',
        notes: notes.trim(),
        missingItems: parseMissingItems(missingItems),
      });
      return;
    }
    onConfirm({
      mode: 'reject',
      notes: notes.trim(),
      cashResolution,
      cashReturnedAcknowledged,
      idempotencyKey,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[1px] sm:items-center sm:p-4" role="presentation">
      <button
        type="button"
        aria-label={t('pendingApprovals.reviewUx.dialog.closeBackdrop', { defaultValue: 'Close decision dialog backdrop' })}
        className="absolute inset-0 cursor-default"
        onClick={() => { if (!isDirty) onClose(); }}
      />
      <section
        ref={dialogRef}
        data-approval-decision-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-10 flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {t('pendingApprovals.reviewUx.dialog.header', {
                defaultValue: `Approval #${approvalId} · Revision ${approvalRevision}`,
                id: approvalId,
                revision: approvalRevision,
              })}
            </p>
            <h2 id={titleId} className="mt-1 text-xl font-bold text-slate-950">{title}</h2>
            <p id={descriptionId} className="mt-1 text-sm text-slate-600">
              {t('pendingApprovals.reviewUx.dialog.description', { defaultValue: 'Review the consequences before confirming this controlled decision.' })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('pendingApprovals.reviewUx.dialog.close', { defaultValue: 'Close decision dialog' })}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="overflow-y-auto px-4 py-4 sm:px-5">
          {returnMode ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <div className="flex gap-3">
                  <ArrowLeftRight className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-bold">
                      {t('pendingApprovals.reviewUx.dialog.currentApprovalSuperseded', {
                        defaultValue: `Current ${approvalCount}/${requiredApprovals} approval will be superseded.`,
                        count: approvalCount,
                        required: requiredApprovals,
                      })}
                    </p>
                    <p className="mt-1">
                      {t('pendingApprovals.reviewUx.dialog.revisionReset', {
                        defaultValue: `Revision ${nextRevision} will restart at 0/${requiredApprovals}. Previous decisions remain visible in the audit history.`,
                        revision: nextRevision,
                        required: requiredApprovals,
                      })}
                    </p>
                  </div>
                </div>
              </div>
              {executedRefund && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                  <div className="flex gap-3">
                    <Banknote className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-bold">
                        {t('pendingApprovals.reviewUx.dialog.financialStateUnchangedTitle', { defaultValue: 'Financial state does not roll back on return.' })}
                      </p>
                      <p className="mt-1">
                        {t('pendingApprovals.reviewUx.dialog.financialStateUnchangedDescription', { defaultValue: 'The completed refund remains financially recorded while the requester supplies corrections for the next review revision.' })}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label htmlFor={`${titleId}-notes`} className="text-sm font-semibold text-slate-800">
                  {t('pendingApprovals.reviewUx.dialog.correctionReason', { defaultValue: 'Correction reason' })}
                </label>
                <textarea
                  ref={firstFieldRef}
                  id={`${titleId}-notes`}
                  rows={4}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={t('pendingApprovals.reviewUx.dialog.correctionReasonPlaceholder', { defaultValue: 'Explain exactly what must be corrected before review resumes.' })}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label htmlFor={`${titleId}-missing`} className="text-sm font-semibold text-slate-800">
                  {t('pendingApprovals.reviewUx.dialog.requiredCorrections', { defaultValue: 'Required corrections or evidence' })}
                </label>
                <textarea
                  id={`${titleId}-missing`}
                  rows={3}
                  value={missingItems}
                  onChange={(event) => setMissingItems(event.target.value)}
                  placeholder={t('pendingApprovals.reviewUx.dialog.requiredCorrectionsPlaceholder', { defaultValue: 'One item per line, for example: Corrected receipt' })}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <p className="mt-1 text-xs text-slate-500">
                  {t('pendingApprovals.reviewUx.dialog.requiredCorrectionsHelp', { defaultValue: 'These items will be shown to the requester as a structured correction checklist.' })}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {executedRefund && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950">
                  <div className="flex gap-3">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-bold">
                        {t('pendingApprovals.reviewUx.dialog.financialReversalTitle', { defaultValue: 'The refund will be financially reversed.' })}
                      </p>
                      <p className="mt-1">
                        {t('pendingApprovals.reviewUx.dialog.financialReversalDescription', { defaultValue: 'Invoice, credit note, commission and canonical records will be reconciled. Physical cash must be resolved separately below.' })}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor={`${titleId}-notes`} className="text-sm font-semibold text-slate-800">
                  {t('pendingApprovals.reviewUx.dialog.rejectionReason', { defaultValue: 'Rejection reason' })}
                </label>
                <textarea
                  ref={firstFieldRef}
                  id={`${titleId}-notes`}
                  rows={4}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={t('pendingApprovals.reviewUx.dialog.rejectionReasonPlaceholder', { defaultValue: 'State the evidence and reason for rejecting this request.' })}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {executedRefund && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-slate-800">
                    {t('pendingApprovals.reviewUx.dialog.cashResolution', { defaultValue: 'Physical cash resolution' })}
                  </legend>
                  <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-slate-300 p-3 transition has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                    <input
                      type="radio"
                      name={`${titleId}-cash-resolution`}
                      value="open_dispute"
                      checked={cashResolution === 'open_dispute'}
                      onChange={() => {
                        setCashResolution('open_dispute');
                        setCashReturnedAcknowledged(false);
                      }}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        {t('pendingApprovals.reviewUx.dialog.openDispute', { defaultValue: 'Open cash-recovery dispute' })}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-600">
                        {t('pendingApprovals.reviewUx.dialog.openDisputeDescription', { defaultValue: 'Default and safest option. No second cash-out is created; the amount remains a tracked recovery receivable.' })}
                      </span>
                    </span>
                  </label>
                  <label className={`flex min-h-14 items-start gap-3 rounded-xl border p-3 transition ${cashReturnEligible ? 'cursor-pointer border-slate-300 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50' : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'}`}>
                    <input
                      type="radio"
                      name={`${titleId}-cash-resolution`}
                      value="cash_returned"
                      checked={cashResolution === 'cash_returned'}
                      disabled={!cashReturnEligible}
                      onChange={() => setCashResolution('cash_returned')}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">
                        {t('pendingApprovals.reviewUx.dialog.cashReturned', { defaultValue: 'Cash already returned' })}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-600">
                        {t('pendingApprovals.reviewUx.dialog.cashReturnedDescription', { defaultValue: 'Available only when the original source counter session is eligible to receive and verify the returned cash.' })}
                      </span>
                    </span>
                  </label>
                  {cashResolution === 'cash_returned' && (
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                      <input
                        type="checkbox"
                        checked={cashReturnedAcknowledged}
                        onChange={(event) => setCashReturnedAcknowledged(event.target.checked)}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        {t('pendingApprovals.reviewUx.dialog.cashAcknowledgement', { defaultValue: 'I confirm the physical cash was received and verified at the eligible source counter.' })}
                      </span>
                    </label>
                  )}
                </fieldset>
              )}

              {!executedRefund && (
                <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>
                    {t('pendingApprovals.reviewUx.dialog.terminalRejection', { defaultValue: 'This decision is terminal for the current request. The reason will remain in the audit history.' })}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onClick={onClose}
          >
            {t('pendingApprovals.reviewUx.actions.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            disabled={submitDisabled}
            className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${returnMode ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-600' : 'bg-red-600 hover:bg-red-700 focus:ring-red-600'}`}
            onClick={submit}
          >
            {isSubmitting ? t('pendingApprovals.reviewUx.actions.saving', { defaultValue: 'Saving…' }) : submitLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
