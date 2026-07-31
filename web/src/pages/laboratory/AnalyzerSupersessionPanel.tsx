import { useState } from 'react';
import { GitBranchPlus, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/apiClient';

export interface AnalyzerSupersessionSource {
  id: number;
  state_version: number;
  disposition: string;
  lab_order_item_id?: number | null;
  patient_id?: number | null;
  qc_state: string;
  validation_state: string;
  successor_id?: number | null;
  successor_disposition?: string | null;
  applied_retraction_request_id?: number | null;
}

export interface AnalyzerSupersessionTarget {
  id: number;
  lab_order_id: number;
  lab_test_id: number;
  specimen_id?: number | null;
  status?: string | null;
  patient_id?: number | null;
  order_no?: string | null;
  test_name?: string | null;
  test_code?: string | null;
  patient_name?: string | null;
  patient_code?: string | null;
}

export function canCreateAnalyzerSupersession(role: string): boolean {
  const normalized = String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ['pathologist', 'lab_supervisor'].includes(normalized);
}

export function canRematchAcceptedAnalyzerEvidence(
  source: Pick<AnalyzerSupersessionSource, 'disposition' | 'applied_retraction_request_id'>,
): boolean {
  return source.disposition !== 'accepted' || source.applied_retraction_request_id != null;
}

export function analyzerSupersessionTargetsUrl(inboxId: number, search: string): string {
  const q = search.trim();
  return `/api/lab-machines/inbox/${inboxId}/targets${q ? `?q=${encodeURIComponent(q)}` : ''}`;
}

export function supersessionRequiresQcOverride(
  source: Pick<AnalyzerSupersessionSource, 'qc_state'>,
): boolean {
  return !['pass', 'override'].includes(source.qc_state);
}

export function supersessionRequiresValidationOverride(
  source: Pick<AnalyzerSupersessionSource, 'patient_id' | 'validation_state'>,
  target: Pick<AnalyzerSupersessionTarget, 'patient_id'> | null,
): boolean {
  if (!['pass', 'override'].includes(source.validation_state)) return true;
  if (!target || source.patient_id == null || target.patient_id == null) return true;
  return Number(source.patient_id) !== Number(target.patient_id);
}

export function buildAnalyzerSupersessionPayload(input: {
  source: Pick<AnalyzerSupersessionSource, 'state_version'>;
  targetLabOrderItemId: number;
  reason: string;
  qcOverrideReason?: string;
  validationOverrideReason?: string;
}) {
  const payload: {
    expectedVersion: number;
    targetLabOrderItemId: number;
    reason: string;
    qcOverrideReason?: string;
    validationOverrideReason?: string;
  } = {
    expectedVersion: Number(input.source.state_version),
    targetLabOrderItemId: Number(input.targetLabOrderItemId),
    reason: input.reason.trim(),
  };
  const qcOverrideReason = String(input.qcOverrideReason ?? '').trim();
  const validationOverrideReason = String(input.validationOverrideReason ?? '').trim();
  if (qcOverrideReason) payload.qcOverrideReason = qcOverrideReason;
  if (validationOverrideReason) payload.validationOverrideReason = validationOverrideReason;
  return payload;
}

export default function AnalyzerSupersessionPanel({
  sourceEvidence,
  role,
  onCreated,
}: {
  sourceEvidence: AnalyzerSupersessionSource;
  role: string;
  onCreated: (inboxId: number) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [targets, setTargets] = useState<AnalyzerSupersessionTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [qcOverrideReason, setQcOverrideReason] = useState('');
  const [validationOverrideReason, setValidationOverrideReason] = useState('');
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!canCreateAnalyzerSupersession(role)) return null;

  if (sourceEvidence.successor_id != null) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-3 text-sm text-blue-800 dark:text-blue-200">
        A superseding review already exists: inbox #{sourceEvidence.successor_id}
        {sourceEvidence.successor_disposition ? ` (${sourceEvidence.successor_disposition.replace(/_/g, ' ')})` : ''}.
      </div>
    );
  }

  const selectedTarget = targets.find(target => target.id === selectedTargetId) ?? null;
  const qcOverrideRequired = supersessionRequiresQcOverride(sourceEvidence);
  const validationOverrideRequired = supersessionRequiresValidationOverride(sourceEvidence, selectedTarget);

  const loadTargets = async () => {
    setSearching(true);
    try {
      const response = await api.get<{ data?: AnalyzerSupersessionTarget[] }>(
        analyzerSupersessionTargetsUrl(sourceEvidence.id, search),
      );
      const nextTargets = response.data ?? [];
      setTargets(nextTargets);
      if (nextTargets.length === 1) setSelectedTargetId(nextTargets[0].id);
      else if (!nextTargets.some(target => target.id === selectedTargetId)) setSelectedTargetId(null);
    } catch (error: any) {
      toast.error(error.message || 'Could not load supersession targets');
    } finally {
      setSearching(false);
    }
  };

  const createSupersession = async () => {
    if (!selectedTargetId) {
      toast.error('Select a target laboratory order item');
      return;
    }
    if (reason.trim().length < 10) {
      toast.error('Enter a clear supersession reason');
      return;
    }
    if (qcOverrideRequired && qcOverrideReason.trim().length < 10) {
      toast.error('Document the QC override reason');
      return;
    }
    if (validationOverrideRequired && validationOverrideReason.trim().length < 10) {
      toast.error('Document the validation override reason');
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post<{
        result?: { inboxId?: number };
      }>(`/api/lab-machines/inbox/${sourceEvidence.id}/supersede`, buildAnalyzerSupersessionPayload({
        source: sourceEvidence,
        targetLabOrderItemId: selectedTargetId,
        reason,
        qcOverrideReason,
        validationOverrideReason,
      }));
      const inboxId = Number(response.result?.inboxId);
      toast.success('Superseding analyzer review created');
      if (Number.isInteger(inboxId) && inboxId > 0) await onCreated(inboxId);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create superseding review');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold flex items-center gap-2"><GitBranchPlus className="w-4 h-4" />Correct or rematch this evidence</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            The original row remains immutable. A different reviewer must accept the new row.
          </p>
        </div>
        <button
          className="btn-secondary text-xs"
          onClick={async () => {
            const nextOpen = !open;
            setOpen(nextOpen);
            if (nextOpen && targets.length === 0) await loadTargets();
          }}
        >{open ? 'Close' : 'Create superseding review'}</button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-[var(--color-border)] pt-3">
          {sourceEvidence.disposition === 'accepted' && !canRematchAcceptedAnalyzerEvidence(sourceEvidence) && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              Accepted evidence can only create a correction on its current order item. Moving it to another patient requires an applied result retraction.
            </div>
          )}

          {sourceEvidence.disposition === 'accepted' && canRematchAcceptedAnalyzerEvidence(sourceEvidence) && (
            <div className="rounded-lg bg-green-50 dark:bg-green-950/20 p-3 text-xs text-green-800 dark:text-green-200 flex gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              The published result was formally retracted. A same-test corrected/rematched review may now target the verified order item.
            </div>
          )}

          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search order, patient, test, or order-item ID"
            />
            <button className="btn-secondary" disabled={searching} onClick={loadTargets}>
              {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </div>

          <div className="space-y-2 max-h-56 overflow-auto">
            {targets.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">No compatible target order items found.</p>
            ) : targets.map(target => (
              <label key={target.id} className={`block rounded-xl border p-3 cursor-pointer ${selectedTargetId === target.id ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)]'}`}>
                <div className="flex gap-3">
                  <input
                    type="radio"
                    name={`supersession-target-${sourceEvidence.id}`}
                    checked={selectedTargetId === target.id}
                    onChange={() => setSelectedTargetId(target.id)}
                  />
                  <div className="min-w-0">
                    <p className="font-medium">{target.patient_name || target.patient_code || `Patient #${target.patient_id ?? '—'}`} · {target.test_name || target.test_code || 'Lab test'}</p>
                    <p className="text-xs text-[var(--color-text-secondary)]">{target.order_no || `Order #${target.lab_order_id}`} · item #{target.id} · {target.status || 'pending'}</p>
                  </div>
                </div>
              </label>
            ))}
          </div>

          <textarea
            className="input min-h-[80px]"
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="Required: explain why a new immutable review row is needed"
          />

          {qcOverrideRequired && (
            <textarea
              className="input min-h-[72px]"
              value={qcOverrideReason}
              onChange={event => setQcOverrideReason(event.target.value)}
              placeholder={`Required QC override: source QC state is ${sourceEvidence.qc_state}`}
            />
          )}

          {validationOverrideRequired && (
            <textarea
              className="input min-h-[72px]"
              value={validationOverrideReason}
              onChange={event => setValidationOverrideReason(event.target.value)}
              placeholder="Required validation override: document patient/result verification"
            />
          )}

          <div className="flex justify-end">
            <button className="btn-primary" disabled={submitting || !selectedTargetId} onClick={createSupersession}>
              <GitBranchPlus className="w-4 h-4" />
              {submitting ? 'Creating…' : 'Create review row'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
