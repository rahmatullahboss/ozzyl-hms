import { useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw, ShieldAlert, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/apiClient';

export interface AnalyzerRetractionSource {
  id: number;
  state_version: number;
  disposition: string;
  existing_result_status?: string | null;
  retraction_request_id?: number | null;
  retraction_status?: string | null;
  retraction_state_version?: number | null;
  retraction_reason_code?: string | null;
  retraction_reason?: string | null;
  retraction_notes?: string | null;
  retraction_requested_by?: number | null;
  retraction_reviewed_by?: number | null;
  retraction_review_notes?: string | null;
  applied_retraction_request_id?: number | null;
}

const RETRACTION_REASONS = [
  ['wrong_patient', 'Wrong patient'],
  ['wrong_order', 'Wrong laboratory order'],
  ['wrong_specimen', 'Wrong specimen'],
  ['invalid_result', 'Invalid clinical result'],
  ['duplicate_result', 'Duplicate result'],
  ['analyzer_error', 'Analyzer error'],
  ['other', 'Other'],
] as const;

export function canManageAnalyzerRetraction(role: string): boolean {
  const normalized = String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ['pathologist', 'lab_supervisor', 'hospital_admin', 'md'].includes(normalized);
}

export function isAnalyzerRetractionApplied(
  source: Pick<AnalyzerRetractionSource, 'retraction_status' | 'applied_retraction_request_id'>,
): boolean {
  return source.retraction_status === 'applied' || source.applied_retraction_request_id != null;
}

export function shouldShowAnalyzerRetractionRequestForm(
  source: Pick<AnalyzerRetractionSource, 'disposition' | 'existing_result_status' | 'retraction_status'>,
): boolean {
  return source.disposition === 'accepted'
    && source.existing_result_status !== 'retracted'
    && (source.retraction_status == null || source.retraction_status === 'rejected');
}

export function buildAnalyzerRetractionRequestPayload(input: {
  source: Pick<AnalyzerRetractionSource, 'state_version'>;
  reasonCode: string;
  reason: string;
  notes?: string;
}) {
  const payload: {
    expectedInboxVersion: number;
    reasonCode: string;
    reason: string;
    notes?: string;
  } = {
    expectedInboxVersion: Number(input.source.state_version),
    reasonCode: input.reasonCode.trim(),
    reason: input.reason.trim(),
  };
  const notes = String(input.notes ?? '').trim();
  if (notes) payload.notes = notes;
  return payload;
}

export function buildAnalyzerRetractionReviewPayload(input: {
  requestVersion: number;
  reviewNotes: string;
}) {
  return {
    expectedVersion: Number(input.requestVersion),
    reviewNotes: input.reviewNotes.trim(),
  };
}

export default function AnalyzerRetractionPanel({
  sourceEvidence,
  role,
  onChanged,
}: {
  sourceEvidence: AnalyzerRetractionSource;
  role: string;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState('wrong_order');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [pending, setPending] = useState<'request' | 'approve' | 'reject' | null>(null);

  if (!canManageAnalyzerRetraction(role)) return null;

  const applied = isAnalyzerRetractionApplied(sourceEvidence);
  const requestStatus = sourceEvidence.retraction_status ?? null;
  const canRequest = shouldShowAnalyzerRetractionRequestForm(sourceEvidence);
  const awaitingReview = requestStatus === 'requested' && sourceEvidence.retraction_request_id != null;

  const requestRetraction = async () => {
    if (reason.trim().length < 10) {
      toast.error('Enter a clear clinical retraction reason');
      return;
    }
    setPending('request');
    try {
      await api.post(`/api/lab-machines/inbox/${sourceEvidence.id}/retraction-requests`, buildAnalyzerRetractionRequestPayload({
        source: sourceEvidence,
        reasonCode,
        reason,
        notes,
      }));
      toast.success('Result retraction requested');
      await onChanged();
    } catch (error: any) {
      toast.error(error.message || 'Failed to request result retraction');
    } finally {
      setPending(null);
    }
  };

  const reviewRetraction = async (decision: 'approve' | 'reject') => {
    if (sourceEvidence.retraction_request_id == null || sourceEvidence.retraction_state_version == null) {
      toast.error('Retraction request evidence is incomplete');
      return;
    }
    if (reviewNotes.trim().length < 10) {
      toast.error('Document the independent review evidence');
      return;
    }
    setPending(decision);
    try {
      const endpoint = decision === 'approve'
        ? `/api/lab-machines/retraction-requests/${sourceEvidence.retraction_request_id}/approve`
        : `/api/lab-machines/retraction-requests/${sourceEvidence.retraction_request_id}/reject`;
      await api.post(
        endpoint,
        buildAnalyzerRetractionReviewPayload({
          requestVersion: sourceEvidence.retraction_state_version,
          reviewNotes,
        }),
      );
      toast.success(decision === 'approve' ? 'Result retraction applied' : 'Result retraction rejected');
      await onChanged();
    } catch (error: any) {
      toast.error(error.message || `Failed to ${decision} result retraction`);
    } finally {
      setPending(null);
    }
  };

  if (applied) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/20 p-4 space-y-2 text-red-900 dark:text-red-100">
        <p className="font-semibold flex items-center gap-2"><ShieldAlert className="w-4 h-4" />Published result withdrawn</p>
        <p className="text-sm">{sourceEvidence.retraction_reason || 'This accepted result was formally retracted.'}</p>
        <p className="text-xs">
          The original evidence remains immutable. A corrected/rematched review may now be created, and patient/clinician notification is queued.
        </p>
      </div>
    );
  }

  if (awaitingReview) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
        <div>
          <p className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Retraction awaiting independent review</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            A different governance reviewer must approve or reject this request.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 p-3 text-sm">
          <p className="font-medium">{sourceEvidence.retraction_reason_code?.replace(/_/g, ' ') || 'Retraction request'}</p>
          <p>{sourceEvidence.retraction_reason || 'No reason recorded.'}</p>
          {sourceEvidence.retraction_notes ? <p className="text-xs mt-1 text-[var(--color-text-secondary)]">{sourceEvidence.retraction_notes}</p> : null}
        </div>
        <textarea
          className="input min-h-[82px]"
          value={reviewNotes}
          onChange={event => setReviewNotes(event.target.value)}
          placeholder="Required: document independent patient, specimen, analyzer, and report verification"
        />
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-secondary text-red-600" disabled={pending != null} onClick={() => reviewRetraction('reject')}>
            <XCircle className="w-4 h-4" />{pending === 'reject' ? 'Rejecting…' : 'Reject request'}
          </button>
          <button className="btn-primary" disabled={pending != null} onClick={() => reviewRetraction('approve')}>
            <CheckCircle2 className="w-4 h-4" />{pending === 'approve' ? 'Applying…' : 'Approve and withdraw'}
          </button>
        </div>
      </div>
    );
  }

  if (!canRequest) {
    if (requestStatus === 'rejected') {
      return (
        <div className="rounded-xl border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-secondary)]">
          The previous retraction request was rejected. A new request may be opened after new clinical evidence is available.
        </div>
      );
    }
    return null;
  }

  return (
    <div className="rounded-xl border border-red-200 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold flex items-center gap-2"><RotateCcw className="w-4 h-4" />Request published-result withdrawal</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            Use only for wrong patient/order/specimen, invalid result, duplicate, or analyzer error. A different governance reviewer must approve.
          </p>
        </div>
        <button className="btn-secondary text-xs" onClick={() => setOpen(value => !value)}>
          {open ? 'Close' : 'Request retraction'}
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-[var(--color-border)] pt-3">
          <select className="input" value={reasonCode} onChange={event => setReasonCode(event.target.value)}>
            {RETRACTION_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <textarea
            className="input min-h-[88px]"
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="Required: explain why the published result is clinically unsafe or attached to the wrong record"
          />
          <textarea
            className="input min-h-[72px]"
            value={notes}
            onChange={event => setNotes(event.target.value)}
            placeholder="Optional supporting evidence, calls made, specimen/analyzer checks"
          />
          <div className="rounded-lg bg-red-50 dark:bg-red-950/20 p-3 text-xs text-red-800 dark:text-red-200 flex gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            Approval withdraws the canonical result/report, creates an immutable audit entry, and queues patient/clinician notification.
          </div>
          <div className="flex justify-end">
            <button className="btn-secondary text-red-600" disabled={pending != null} onClick={requestRetraction}>
              <RotateCcw className="w-4 h-4" />{pending === 'request' ? 'Requesting…' : 'Submit retraction request'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
