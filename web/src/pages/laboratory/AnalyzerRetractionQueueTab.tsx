import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import EmptyState from '../../components/dashboard/EmptyState';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { api } from '../../lib/apiClient';
import { buildAnalyzerRetractionReviewPayload } from './AnalyzerRetractionPanel';
import AnalyzerRetractionNotificationMonitor from './AnalyzerRetractionNotificationMonitor';

export interface AnalyzerRetractionQueueRow {
  id: number;
  lis_analyzer_inbox_id: number;
  lab_result_id: number;
  lab_report_id: number;
  lab_order_item_id: number;
  lab_order_id: number;
  patient_id?: number | null;
  reason_code: string;
  reason: string;
  notes?: string | null;
  status: string;
  state_version: number;
  requested_by: number;
  requester_role: string;
  reviewed_by?: number | null;
  review_notes?: string | null;
  created_at?: string | null;
  can_review: number;
  patient_name?: string | null;
  patient_code?: string | null;
  order_no?: string | null;
  test_name?: string | null;
  test_code?: string | null;
  result_value?: string | null;
  units?: string | null;
  result_status?: string | null;
}

export function canViewAnalyzerRetractionQueue(role: string): boolean {
  const normalized = String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ['pathologist', 'lab_supervisor', 'hospital_admin', 'md'].includes(normalized);
}

export function analyzerRetractionQueueUrl(input: {
  machineId: number;
  status: string;
  search: string;
}): string {
  const params = [
    `machineId=${encodeURIComponent(String(input.machineId))}`,
    `status=${encodeURIComponent(input.status)}`,
  ];
  const search = input.search.trim();
  if (search) params.push(`q=${encodeURIComponent(search)}`);
  return `/api/lab-machines/retraction-requests?${params.join('&')}`;
}

export function retractionRequestLabel(
  row: Pick<AnalyzerRetractionQueueRow, 'id' | 'patient_name' | 'patient_code' | 'test_name' | 'test_code' | 'order_no'>,
): string {
  const patient = row.patient_name || row.patient_code;
  const test = row.test_name || row.test_code;
  if (!patient && !test && !row.order_no) return `Retraction #${row.id}`;
  return [patient || `Retraction #${row.id}`, test, row.order_no].filter(Boolean).join(' · ');
}

export function retractionStatusBadge(status: string): string {
  if (status === 'requested' || status === 'applying') return 'badge-warning';
  if (status === 'applied') return 'badge-danger';
  return 'badge-secondary';
}

export default function AnalyzerRetractionQueueTab({ machineId, role }: { machineId: number; role: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('requested');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);

  const allowed = canViewAnalyzerRetractionQueue(role);
  const url = analyzerRetractionQueueUrl({ machineId, status, search });
  const queryKey = ['labMachines', 'retractionRequests', machineId, status, search] as const;
  const { data: raw, isLoading, isError, refetch } = useApiQuery<{ data?: AnalyzerRetractionQueueRow[] }>(
    queryKey,
    url,
    { enabled: allowed },
  );
  const rows = raw?.data ?? [];
  const selected = rows.find(row => row.id === selectedId) ?? null;

  if (!allowed) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-200">
        Result retraction review requires a pathologist, laboratory supervisor, hospital administrator, or MD.
      </div>
    );
  }

  const refresh = async () => {
    setSelectedId(null);
    setReviewNotes('');
    await queryClient.invalidateQueries({ queryKey: ['labMachines', 'retractionRequests'] });
    await refetch();
  };

  const review = async (row: AnalyzerRetractionQueueRow, decision: 'approve' | 'reject') => {
    if (!row.can_review) {
      toast.error('The requester cannot review their own request');
      return;
    }
    if (reviewNotes.trim().length < 10) {
      toast.error('Document the independent review evidence');
      return;
    }
    setPending(decision);
    try {
      const endpoint = decision === 'approve'
        ? `/api/lab-machines/retraction-requests/${row.id}/approve`
        : `/api/lab-machines/retraction-requests/${row.id}/reject`;
      await api.post(endpoint, buildAnalyzerRetractionReviewPayload({
        requestVersion: row.state_version,
        reviewNotes,
      }));
      toast.success(decision === 'approve' ? 'Result retraction applied' : 'Result retraction rejected');
      await refresh();
    } catch (error: any) {
      toast.error(error.message || `Failed to ${decision} retraction request`);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-800 dark:text-red-200 flex gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        Approval withdraws a published result, creates immutable audit evidence, and queues patient/clinician notification. Verify patient, specimen, analyzer source, and report before acting.
      </div>

      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" value={status} onChange={event => { setStatus(event.target.value); setSelectedId(null); }}>
          <option value="requested">requested</option>
          <option value="applying">applying</option>
          <option value="applied">applied</option>
          <option value="rejected">rejected</option>
          <option value="all">all</option>
        </select>
        <input
          className="input min-w-[220px] flex-1"
          value={search}
          onChange={event => { setSearch(event.target.value); setSelectedId(null); }}
          placeholder="Search patient, order, test, or reason"
        />
        <button className="btn-ghost p-2" onClick={() => refetch()} title="Refresh retraction queue">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Patient / test</th><th>Published result</th><th>Reason</th><th>Status</th><th>Requested</th></tr></thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, index) => <tr key={index}>{Array.from({ length: 5 }).map((__, cell) => <td key={cell}><div className="skeleton h-4 rounded" /></td>)}</tr>)
              ) : isError ? (
                <tr><td colSpan={5} className="text-center py-8"><button className="btn-primary" onClick={() => refetch()}><RefreshCw className="w-4 h-4" />Retry</button></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5}><EmptyState icon={<Inbox className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No retraction requests" description="No accepted-result retraction matches these filters." /></td></tr>
              ) : rows.map(row => (
                <tr
                  key={row.id}
                  className={`cursor-pointer ${selectedId === row.id ? 'bg-[var(--color-primary)]/5' : 'hover:bg-[var(--color-border-light)]'}`}
                  onClick={() => { setSelectedId(row.id); setReviewNotes(''); }}
                >
                  <td><p className="font-medium">{retractionRequestLabel(row)}</p><p className="text-xs text-[var(--color-text-secondary)]">Inbox #{row.lis_analyzer_inbox_id} · report #{row.lab_report_id}</p></td>
                  <td className="font-data">{row.result_value ?? '—'} {row.units ?? ''}</td>
                  <td><p className="font-medium">{row.reason_code.replace(/_/g, ' ')}</p><p className="text-xs max-w-xs truncate">{row.reason}</p></td>
                  <td><span className={`badge ${retractionStatusBadge(row.status)}`}>{row.status}</span></td>
                  <td className="font-data text-xs whitespace-nowrap">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold flex items-center gap-2"><RotateCcw className="w-4 h-4" />{retractionRequestLabel(selected)}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">Requested by user #{selected.requested_by} · {selected.requester_role.replace(/_/g, ' ')}</p>
            </div>
            <span className={`badge ${retractionStatusBadge(selected.status)}`}>{selected.status}</span>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] p-3 text-sm space-y-1">
            <p className="font-medium">{selected.reason_code.replace(/_/g, ' ')}</p>
            <p>{selected.reason}</p>
            {selected.notes ? <p className="text-xs text-[var(--color-text-secondary)]">{selected.notes}</p> : null}
          </div>

          {selected.status === 'requested' && (
            <>
              {!selected.can_review && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200">
                  The requester cannot review their own request. Another governance reviewer must open this queue.
                </div>
              )}
              <textarea
                className="input min-h-[88px]"
                value={reviewNotes}
                onChange={event => setReviewNotes(event.target.value)}
                disabled={!selected.can_review}
                placeholder="Required: independent verification notes"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn-secondary text-red-600" disabled={!selected.can_review || pending != null} onClick={() => review(selected, 'reject')}>
                  <XCircle className="w-4 h-4" />{pending === 'reject' ? 'Rejecting…' : 'Reject request'}
                </button>
                <button className="btn-primary" disabled={!selected.can_review || pending != null} onClick={() => review(selected, 'approve')}>
                  <CheckCircle2 className="w-4 h-4" />{pending === 'approve' ? 'Applying…' : 'Approve and withdraw'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <AnalyzerRetractionNotificationMonitor machineId={machineId} />
    </div>
  );
}
