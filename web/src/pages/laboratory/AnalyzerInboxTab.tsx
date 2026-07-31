import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Inbox,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import EmptyState from '../../components/dashboard/EmptyState';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { api } from '../../lib/apiClient';
import AnalyzerRetractionPanel from './AnalyzerRetractionPanel';
import AnalyzerSupersessionPanel from './AnalyzerSupersessionPanel';

export interface AnalyzerInboxRow {
  id: number;
  state_version: number;
  disposition: string;
  disposition_reason?: string | null;
  match_state: string;
  qc_state: string;
  validation_state: string;
  critical_flag: number;
  raw_value?: string | null;
  raw_units?: string | null;
  raw_reference_range?: string | null;
  normalized_value?: string | null;
  normalized_units?: string | null;
  selected_reference_range?: string | null;
  normalized_interpretation?: string | null;
  normalized_result_status?: string | null;
  machine_test_code?: string | null;
  machine_test_name?: string | null;
  machine_name?: string | null;
  patient_id?: number | null;
  patient_name?: string | null;
  patient_code?: string | null;
  order_no?: string | null;
  lab_order_item_id?: number | null;
  test_name?: string | null;
  test_code?: string | null;
  protocol?: string | null;
  ingestion_status?: string | null;
  created_at?: string | null;
}

interface AnalyzerInboxDetail extends AnalyzerInboxRow {
  existing_result?: string | null;
  existing_result_status?: string | null;
  source_message_id?: string | null;
  delivery_id?: string | null;
  payload_sha256?: string | null;
  candidate_metadata?: unknown;
  validation_details?: unknown;
  qc_details?: unknown;
  source_payload?: unknown;
  successor_id?: number | null;
  successor_disposition?: string | null;
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

interface AnalyzerInboxResponse {
  data?: AnalyzerInboxRow[];
  summary?: Record<string, { total: number; critical: number }>;
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

const DISPOSITIONS = [
  'review_required',
  'acceptance_eligible',
  'qc_blocked',
  'validation_blocked',
  'unmatched',
  'ambiguous',
  'quarantined',
  'accepted',
  'rejected',
  'all',
];

export function analyzerInboxListUrl(input: {
  machineId: number;
  disposition: string;
  critical: string;
  search: string;
  page?: number;
}): string {
  const parts = [
    `machineId=${encodeURIComponent(String(input.machineId))}`,
    `disposition=${encodeURIComponent(input.disposition)}`,
    `critical=${encodeURIComponent(input.critical)}`,
  ];
  const search = input.search.trim();
  if (search) parts.push(`q=${encodeURIComponent(search)}`);
  if (Number.isInteger(input.page) && Number(input.page) > 1) {
    parts.push(`page=${Number(input.page)}`);
  }
  parts.push('limit=50');
  return `/api/lab-machines/inbox?${parts.join('&')}`;
}

export function canFinalizeAnalyzerInbox(role: string): boolean {
  const normalized = String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ['pathologist', 'lab_supervisor', 'hospital_admin', 'md'].includes(normalized);
}

export function canAcceptAnalyzerInbox(
  row: Pick<AnalyzerInboxRow, 'disposition' | 'match_state' | 'qc_state' | 'validation_state'>,
): boolean {
  return ['review_required', 'acceptance_eligible'].includes(row.disposition)
    && row.match_state === 'exact'
    && ['pass', 'override'].includes(row.qc_state)
    && ['pass', 'override'].includes(row.validation_state);
}

export function analyzerInboxStatusBadge(status: string): string {
  if (['critical', 'qc_blocked', 'validation_blocked', 'quarantined', 'rejected'].includes(status)) {
    return 'badge-danger';
  }
  if (['review_required', 'acceptance_eligible', 'ambiguous', 'unmatched'].includes(status)) {
    return 'badge-warning';
  }
  if (status === 'accepted' || status === 'pass' || status === 'override') return 'badge-success';
  return 'badge-secondary';
}

export function analyzerInboxResultLabel(
  row: Pick<AnalyzerInboxRow, 'id' | 'patient_name' | 'patient_code' | 'test_name' | 'test_code' | 'normalized_value' | 'normalized_units'>,
): string {
  const patient = row.patient_name || row.patient_code || `Inbox #${row.id}`;
  const test = row.test_name || row.test_code || 'Analyzer result';
  const value = row.normalized_value == null || row.normalized_value === ''
    ? 'No value'
    : `${row.normalized_value}${row.normalized_units ? ` ${row.normalized_units}` : ''}`;
  return `${patient} · ${test} · ${value}`;
}

function pretty(value: unknown): string {
  if (value == null) return 'No additional evidence';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function summaryTotal(
  summary: AnalyzerInboxResponse['summary'],
  dispositions: string[],
): number {
  return dispositions.reduce((total, disposition) => total + Number(summary?.[disposition]?.total ?? 0), 0);
}

export default function AnalyzerInboxTab({ machineId, role }: { machineId: number; role: string }) {
  const queryClient = useQueryClient();
  const [disposition, setDisposition] = useState('review_required');
  const [critical, setCritical] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AnalyzerInboxDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionPending, setActionPending] = useState<'accept' | 'reject' | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const listUrl = analyzerInboxListUrl({ machineId, disposition, critical, search, page });
  const queryKey = ['labMachines', 'analyzerInbox', machineId, disposition, critical, search, page] as const;
  const { data: raw, isLoading, isError, refetch } = useApiQuery<AnalyzerInboxResponse>(queryKey, listUrl);
  const rows = raw?.data ?? [];
  const summary = raw?.summary ?? {};
  const pagination = raw?.pagination ?? { page, limit: 50, total: rows.length, totalPages: 1 };
  const reviewer = canFinalizeAnalyzerInbox(role);

  const clearSelection = () => {
    setSelectedId(null);
    setDetail(null);
    setRejectionReason('');
  };

  const refresh = async () => {
    clearSelection();
    await queryClient.invalidateQueries({ queryKey: ['labMachines', 'analyzerInbox'] });
    await refetch();
  };

  const toggleDetail = async (row: AnalyzerInboxRow) => {
    if (selectedId === row.id) {
      clearSelection();
      return;
    }
    setSelectedId(row.id);
    setDetail(null);
    setRejectionReason('');
    setDetailLoading(true);
    try {
      const response = await api.get<{ data?: AnalyzerInboxDetail }>(`/api/lab-machines/inbox/${row.id}`);
      setDetail(response.data ?? (response as unknown as AnalyzerInboxDetail));
    } catch (error: any) {
      toast.error(error.message || 'Could not load analyzer evidence');
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const accept = async (row: AnalyzerInboxRow) => {
    if (!canAcceptAnalyzerInbox(row)) {
      toast.error('This result is not eligible for acceptance');
      return;
    }
    if (!confirm(`Accept ${analyzerInboxResultLabel(row)}?`)) return;
    setActionPending('accept');
    try {
      await api.post(`/api/lab-machines/inbox/${row.id}/accept`, {
        expectedVersion: row.state_version,
      });
      toast.success('Analyzer result accepted');
      await refresh();
    } catch (error: any) {
      toast.error(error.message || 'Failed to accept analyzer result');
    } finally {
      setActionPending(null);
    }
  };

  const reject = async (row: AnalyzerInboxRow) => {
    const reason = rejectionReason.trim();
    if (reason.length < 5) {
      toast.error('Enter a clear rejection reason');
      return;
    }
    setActionPending('reject');
    try {
      await api.post(`/api/lab-machines/inbox/${row.id}/reject`, {
        expectedVersion: row.state_version,
        reason,
      });
      toast.success('Analyzer result rejected');
      await refresh();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject analyzer result');
    } finally {
      setActionPending(null);
    }
  };

  const selected = detail ?? rows.find(row => row.id === selectedId);
  const openReviews = summaryTotal(summary, ['review_required', 'acceptance_eligible']);
  const blocked = summaryTotal(summary, ['qc_blocked', 'validation_blocked', 'quarantined']);
  const unmatched = summaryTotal(summary, ['unmatched', 'ambiguous']);
  const criticalCount = Object.values(summary).reduce((total, item) => total + Number(item.critical ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="card p-3"><p className="text-xs text-[var(--color-text-secondary)]">Awaiting review</p><p className="font-semibold font-data text-lg">{openReviews}</p></div>
        <div className="card p-3"><p className="text-xs text-[var(--color-text-secondary)]">Blocked</p><p className="font-semibold font-data text-lg">{blocked}</p></div>
        <div className="card p-3"><p className="text-xs text-[var(--color-text-secondary)]">Unmatched</p><p className="font-semibold font-data text-lg">{unmatched}</p></div>
        <div className="card p-3"><p className="text-xs text-[var(--color-text-secondary)]">Critical evidence</p><p className="font-semibold font-data text-lg text-red-600">{criticalCount}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={disposition} onChange={event => { setDisposition(event.target.value); setPage(1); clearSelection(); }}>
          {DISPOSITIONS.map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="input w-auto" value={critical} onChange={event => { setCritical(event.target.value); setPage(1); clearSelection(); }}>
          <option value="all">all criticality</option>
          <option value="true">critical only</option>
          <option value="false">non-critical</option>
        </select>
        <input
          className="input min-w-[220px] flex-1"
          placeholder="Search patient, order, barcode, or test"
          value={search}
          onChange={event => { setSearch(event.target.value); setPage(1); clearSelection(); }}
        />
        <button onClick={() => refetch()} className="btn-ghost p-2" title="Refresh analyzer inbox">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {!reviewer && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          You can inspect analyzer evidence. Final accept or reject decisions require a pathologist, lab supervisor, hospital administrator, or MD.
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th></th><th>Patient / test</th><th>Result</th><th>Gates</th><th>Disposition</th><th>Received</th></tr></thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <tr key={index}>{Array.from({ length: 6 }).map((__, cell) => <td key={cell}><div className="skeleton h-4 rounded" /></td>)}</tr>
                ))
              ) : isError ? (
                <tr><td colSpan={6} className="text-center py-8"><button className="btn-primary" onClick={() => refetch()}><RefreshCw className="w-4 h-4" />Retry</button></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6}><EmptyState icon={<Inbox className="w-8 h-8 text-[var(--color-text-muted)]" />} title="Analyzer inbox is clear" description="No staged analyzer evidence matches these filters." /></td></tr>
              ) : rows.map(row => (
                <tr key={row.id} className="cursor-pointer hover:bg-[var(--color-border-light)]" onClick={() => toggleDetail(row)}>
                  <td className="w-8">{selectedId === row.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                  <td>
                    <div className="font-medium">{row.patient_name || row.patient_code || `Inbox #${row.id}`}</div>
                    <div className="text-xs text-[var(--color-text-secondary)]">{row.test_name || row.machine_test_name || row.test_code || row.machine_test_code || 'Unknown test'} · {row.order_no || `Item #${row.lab_order_item_id ?? '—'}`}</div>
                  </td>
                  <td>
                    <div className="font-data font-medium">{row.normalized_value ?? '—'} {row.normalized_units ?? ''}</div>
                    <div className="text-xs text-[var(--color-text-secondary)]">raw: {row.raw_value ?? '—'} {row.raw_units ?? ''}</div>
                  </td>
                  <td className="space-y-1">
                    <div><span className={`badge ${analyzerInboxStatusBadge(row.match_state)}`}>{row.match_state}</span></div>
                    <div className="flex gap-1"><span className={`badge ${analyzerInboxStatusBadge(row.qc_state)}`}>QC {row.qc_state}</span><span className={`badge ${analyzerInboxStatusBadge(row.validation_state)}`}>VAL {row.validation_state}</span></div>
                  </td>
                  <td><span className={`badge ${analyzerInboxStatusBadge(row.critical_flag ? 'critical' : row.disposition)}`}>{row.critical_flag ? 'critical · ' : ''}{row.disposition.replace(/_/g, ' ')}</span></td>
                  <td className="font-data text-xs whitespace-nowrap">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3">
            <p className="text-xs text-[var(--color-text-secondary)]">
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} results
            </p>
            <div className="flex gap-2">
              <button
                className="btn-secondary text-xs"
                disabled={page <= 1}
                onClick={() => { clearSelection(); setPage(current => Math.max(1, current - 1)); }}
              >Previous</button>
              <button
                className="btn-secondary text-xs"
                disabled={page >= pagination.totalPages}
                onClick={() => { clearSelection(); setPage(current => Math.min(pagination.totalPages, current + 1)); }}
              >Next</button>
            </div>
          </div>
        )}
      </div>

      {selectedId && (
        <div className="card p-4 space-y-4">
          {detailLoading || !selected ? <div className="skeleton h-40 rounded-xl" /> : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{analyzerInboxResultLabel(selected)}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">Inbox #{selected.id} · version {selected.state_version} · {selected.protocol?.toUpperCase() || 'ANALYZER'}</p>
                </div>
                {selected.critical_flag ? <span className="badge badge-danger"><AlertTriangle className="w-3 h-3" />Critical</span> : null}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
                <div className="rounded-xl border border-[var(--color-border)] p-3"><p className="text-xs text-[var(--color-text-secondary)]">Raw evidence</p><p className="font-data font-medium">{selected.raw_value ?? '—'} {selected.raw_units ?? ''}</p></div>
                <div className="rounded-xl border border-[var(--color-border)] p-3"><p className="text-xs text-[var(--color-text-secondary)]">Normalized</p><p className="font-data font-medium">{selected.normalized_value ?? '—'} {selected.normalized_units ?? ''}</p></div>
                <div className="rounded-xl border border-[var(--color-border)] p-3"><p className="text-xs text-[var(--color-text-secondary)]">Analyzer range</p><p className="font-data font-medium">{selected.raw_reference_range ?? '—'}</p></div>
                <div className="rounded-xl border border-[var(--color-border)] p-3"><p className="text-xs text-[var(--color-text-secondary)]">Selected range</p><p className="font-data font-medium">{selected.selected_reference_range ?? '—'}</p></div>
                <div className="rounded-xl border border-[var(--color-border)] p-3"><p className="text-xs text-[var(--color-text-secondary)]">QC gate</p><p className="font-medium">{selected.qc_state}</p></div>
                <div className="rounded-xl border border-[var(--color-border)] p-3"><p className="text-xs text-[var(--color-text-secondary)]">Validation gate</p><p className="font-medium">{selected.validation_state}</p></div>
              </div>

              {detail && (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                  <div><p className="text-xs font-semibold uppercase mb-1">QC evidence</p><pre className="bg-[var(--color-border-light)] rounded-xl p-3 text-xs overflow-auto max-h-48">{pretty(detail.qc_details)}</pre></div>
                  <div><p className="text-xs font-semibold uppercase mb-1">Validation evidence</p><pre className="bg-[var(--color-border-light)] rounded-xl p-3 text-xs overflow-auto max-h-48">{pretty(detail.validation_details)}</pre></div>
                  <div><p className="text-xs font-semibold uppercase mb-1">Match evidence</p><pre className="bg-[var(--color-border-light)] rounded-xl p-3 text-xs overflow-auto max-h-48">{pretty(detail.candidate_metadata)}</pre></div>
                </div>
              )}

              {detail && (
                <AnalyzerRetractionPanel
                  sourceEvidence={detail}
                  role={role}
                  onChanged={async () => refresh()}
                />
              )}

              {detail && (
                <AnalyzerSupersessionPanel
                  sourceEvidence={detail}
                  role={role}
                  onCreated={async () => refresh()}
                />
              )}

              {reviewer && !['accepted', 'rejected'].includes(selected.disposition) && (
                <div className="border-t border-[var(--color-border)] pt-4 space-y-3">
                  <textarea
                    className="input min-h-[88px]"
                    placeholder="Required when rejecting: explain the patient, specimen, QC, or mapping issue"
                    value={rejectionReason}
                    onChange={event => setRejectionReason(event.target.value)}
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <button className="btn-secondary text-red-600" disabled={actionPending != null} onClick={() => reject(selected)}>
                      <XCircle className="w-4 h-4" />{actionPending === 'reject' ? 'Rejecting…' : 'Reject result'}
                    </button>
                    <button className="btn-primary" disabled={actionPending != null || !canAcceptAnalyzerInbox(selected)} onClick={() => accept(selected)}>
                      <CheckCircle2 className="w-4 h-4" />{actionPending === 'accept' ? 'Accepting…' : 'Accept result'}
                    </button>
                  </div>
                  {!canAcceptAnalyzerInbox(selected) && <p className="text-xs text-amber-700 text-right">Acceptance remains disabled until exact matching, QC, and validation gates pass.</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
