import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileSignature, Loader2, LockKeyhole, Plus, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/apiClient';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

export interface SignedEncounterSummary {
  id: number;
  visit_id?: number | null;
  appointment_id?: number | null;
  encounter_type: string;
  status: string;
  start_time: string;
  end_time?: string | null;
  chief_complaint?: string | null;
  signed_at?: string | null;
  signed_by?: number | null;
  snapshot_hash?: string | null;
  signature_version?: number | null;
  addendum_count?: number | null;
}

interface SignedEncounterPanelProps {
  encounter: SignedEncounterSummary;
  role: string;
  formatDateTime: (value?: string | null) => string;
}

type RawRecord = Record<string, unknown>;

interface EncounterAddendum {
  id: number;
  author_id: number;
  reason: string;
  content: string;
  addendum_hash: string;
  previous_snapshot_hash: string;
  created_at: string;
}

interface EncounterDetail extends SignedEncounterSummary {
  signed_snapshot?: string | null;
  order_refs_json?: string | null;
  addenda?: EncounterAddendum[];
}

function safeParseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function displayHash(hash?: string | null): string {
  if (!hash) return '—';
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function SignedEncounterPanel({ encounter, role, formatDateTime }: SignedEncounterPanelProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const detailKey = ['signed-encounter', encounter.id] as const;
  const detailQuery = useApiQuery<{ Results?: EncounterDetail }>(
    detailKey,
    `/api/clinical/encounters/${encounter.id}`,
    { enabled: expanded },
  );
  const detail = detailQuery.data?.Results;
  const snapshot = useMemo(
    () => safeParseJson<RawRecord>(detail?.signed_snapshot, {}),
    [detail?.signed_snapshot],
  );
  const orderRefs = useMemo(
    () => safeParseJson<Array<RawRecord>>(detail?.order_refs_json, []),
    [detail?.order_refs_json],
  );
  const canAddAddendum = ['doctor', 'hospital_admin', 'md'].includes(role);

  const submitAddendum = async () => {
    if (reason.trim().length < 3 || content.trim().length < 3) {
      toast.error('Addendum reason and correction must each contain at least 3 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/clinical/encounters/${encounter.id}/addenda`, {
        reason: reason.trim(),
        content: content.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: detailKey });
      setReason('');
      setContent('');
      toast.success('Encounter addendum appended');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to append encounter addendum');
    } finally {
      setSubmitting(false);
    }
  };

  const soap = (snapshot.soap ?? null) as RawRecord | null;
  const codedDiagnosis = (snapshot.codedDiagnosis ?? null) as RawRecord | null;
  const prescription = (snapshot.prescription ?? null) as RawRecord | null;
  const snapshotOrders = Array.isArray(snapshot.clinicalOrders)
    ? snapshot.clinicalOrders as RawRecord[]
    : orderRefs;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3" data-testid={`signed-encounter-${encounter.id}`}>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FileSignature className="h-4 w-4 text-emerald-700" />
            <p className="font-medium capitalize text-[var(--color-text)]">
              {encounter.encounter_type.replace(/_/g, ' ')}
            </p>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
              Signed v{encounter.signature_version ?? 1}
            </span>
            {(encounter.addendum_count ?? 0) > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                {encounter.addendum_count} addendum{encounter.addendum_count === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {encounter.chief_complaint && (
            <p className="mt-1 line-clamp-1 text-sm text-[var(--color-text-secondary)]">
              {encounter.chief_complaint}
            </p>
          )}
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Signed {formatDateTime(encounter.signed_at ?? encounter.end_time ?? encounter.start_time)} · Hash {displayHash(encounter.snapshot_hash)}
          </p>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-emerald-200 pt-3">
          {detailQuery.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading signed record…
            </div>
          ) : detail ? (
            <>
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-white/70 p-3 text-xs text-emerald-900">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Original snapshot is immutable. Corrections are appended below and never replace the signed content.</span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {soap && (
                  <div className="rounded-lg bg-[var(--color-bg)] p-3">
                    <p className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">SOAP</p>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{String(soap.assessment ?? soap.subjective ?? soap.chiefComplaint ?? 'Clinical note recorded')}</p>
                  </div>
                )}
                {codedDiagnosis && (
                  <div className="rounded-lg bg-[var(--color-bg)] p-3">
                    <p className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">Coded diagnosis</p>
                    <p className="mt-1 text-sm">
                      <span className="font-mono font-semibold">{String(codedDiagnosis.code ?? '')}</span>{' '}
                      {String(codedDiagnosis.description ?? '')}
                    </p>
                  </div>
                )}
                {prescription && (
                  <div className="rounded-lg bg-[var(--color-bg)] p-3">
                    <p className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">Prescription</p>
                    <p className="mt-1 text-sm">{String(prescription.rxNo ?? `Prescription #${String(prescription.id ?? '')}`)} · {String(prescription.status ?? '')}</p>
                  </div>
                )}
                <div className="rounded-lg bg-[var(--color-bg)] p-3">
                  <p className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">Clinical orders</p>
                  <p className="mt-1 text-sm">{snapshotOrders.length} linked order{snapshotOrders.length === 1 ? '' : 's'}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-700" />
                  <p className="text-xs font-semibold text-[var(--color-text)]">Append-only addenda</p>
                </div>
                {(detail.addenda ?? []).length === 0 ? (
                  <p className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">No corrections recorded.</p>
                ) : (
                  (detail.addenda ?? []).map((addendum) => (
                    <div key={addendum.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-amber-900">{addendum.reason}</p>
                        <span className="text-[10px] text-amber-700">{formatDateTime(addendum.created_at)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-amber-950">{addendum.content}</p>
                      <p className="mt-1 text-[10px] text-amber-700">Hash {displayHash(addendum.addendum_hash)}</p>
                    </div>
                  ))
                )}
              </div>

              {canAddAddendum && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 space-y-2">
                  <p className="text-xs font-semibold">Add correction / clarification</p>
                  <input
                    className="input w-full"
                    aria-label={`Addendum reason for encounter ${encounter.id}`}
                    placeholder="Reason for addendum"
                    value={reason}
                    disabled={submitting}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <textarea
                    className="input min-h-20 w-full"
                    aria-label={`Addendum content for encounter ${encounter.id}`}
                    placeholder="Correction or clarification. The original record will remain unchanged."
                    value={content}
                    disabled={submitting}
                    onChange={(event) => setContent(event.target.value)}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={submitAddendum}
                      disabled={submitting || reason.trim().length < 3 || content.trim().length < 3}
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Append addendum
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-red-700">Signed encounter details could not be loaded.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default SignedEncounterPanel;
