import { useState } from 'react';
import { AlertTriangle, BellRing, RefreshCw, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import EmptyState from '../../components/dashboard/EmptyState';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { api } from '../../lib/apiClient';

export interface AnalyzerRetractionNotificationOutboxRow {
  id: number;
  retraction_request_id: number;
  status: string;
  attempt_count: number;
  last_error?: string | null;
  next_attempt_at?: string | null;
  sent_at?: string | null;
  manual_retry_count?: number | null;
  last_manual_retry_by?: number | null;
  last_manual_retry_reason?: string | null;
  last_manual_retry_at?: string | null;
  lab_report_id?: number | null;
  lab_order_id?: number | null;
  patient_id?: number | null;
  patient_name?: string | null;
  patient_code?: string | null;
  order_no?: string | null;
  reason_code?: string | null;
  reason?: string | null;
  delivery_total: number;
  delivery_sent: number;
  delivery_failed: number;
  delivery_active: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AnalyzerRetractionNotificationDeliveryRow {
  id: number;
  outbox_id: number;
  channel: string;
  recipient_type: string;
  recipient_id: number;
  status: string;
  attempt_count: number;
  processing_started_at?: string | null;
  next_attempt_at?: string | null;
  provider_message_id?: string | null;
  last_error?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface AnalyzerRetractionNotificationResponse {
  data?: AnalyzerRetractionNotificationOutboxRow[];
  deliveries?: AnalyzerRetractionNotificationDeliveryRow[];
}

export function analyzerRetractionNotificationOutboxUrl(input: {
  machineId: number;
  status: string;
}): string {
  return `/api/lab-machines/retraction-notification-outbox?machineId=${encodeURIComponent(String(input.machineId))}&status=${encodeURIComponent(input.status)}&includeDeliveries=true`;
}

export function canRetryAnalyzerRetractionNotification(
  row: Pick<AnalyzerRetractionNotificationOutboxRow, 'status' | 'delivery_failed'>,
): boolean {
  return row.status === 'failed' && Number(row.delivery_failed) > 0;
}

export function notificationDeliveryStatusBadge(status: string): string {
  if (status === 'sent') return 'badge-success';
  if (status === 'failed') return 'badge-danger';
  if (status === 'processing') return 'badge-warning';
  return 'badge-secondary';
}

function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function AnalyzerRetractionNotificationMonitor({ machineId }: { machineId: number }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('failed');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [retryReason, setRetryReason] = useState('');
  const [retrying, setRetrying] = useState(false);
  const url = analyzerRetractionNotificationOutboxUrl({ machineId, status });
  const queryKey = ['labMachines', 'retractionNotificationOutbox', machineId, status] as const;
  const { data: raw, isLoading, isError, refetch } = useApiQuery<AnalyzerRetractionNotificationResponse>(
    queryKey,
    url,
  );
  const rows = raw?.data ?? [];
  const deliveries = raw?.deliveries ?? [];
  const selected = rows.find(row => row.id === selectedId) ?? null;
  const selectedDeliveries = selected
    ? deliveries.filter(delivery => Number(delivery.outbox_id) === Number(selected.id))
    : [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['labMachines', 'retractionNotificationOutbox'] });
    await refetch();
  };

  const retry = async () => {
    if (!selected || !canRetryAnalyzerRetractionNotification(selected)) {
      toast.error('No recoverable recipient delivery exists');
      return;
    }
    if (retryReason.trim().length < 10) {
      toast.error('Document why this delivery is now safe to retry');
      return;
    }

    setRetrying(true);
    try {
      await api.post(
        `/api/lab-machines/retraction-notification-outbox/${selected.id}/retry`,
        { reason: retryReason.trim() },
      );
      toast.success('Retraction notification retry queued');
      setRetryReason('');
      setSelectedId(null);
      await refresh();
    } catch (error: any) {
      toast.error(error.message || 'Failed to queue notification retry');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-[var(--color-border)] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <BellRing className="w-4 h-4" />Retraction notification delivery
          </h3>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            Review patient, ordering clinician, and laboratory-governance delivery evidence. Retry only reviewed transient failures.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            className="input w-auto"
            value={status}
            onChange={event => {
              setStatus(event.target.value);
              setSelectedId(null);
              setRetryReason('');
            }}
          >
            <option value="failed">failed</option>
            <option value="pending">pending</option>
            <option value="processing">processing</option>
            <option value="sent">sent</option>
            <option value="all">all</option>
          </select>
          <button className="btn-ghost p-2" onClick={() => refresh()} title="Refresh notification delivery">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Patient / order</th>
                <th>Delivery</th>
                <th>Status</th>
                <th>Last error</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <tr key={index}>{Array.from({ length: 5 }).map((__, cell) => <td key={cell}><div className="skeleton h-4 rounded" /></td>)}</tr>
                ))
              ) : isError ? (
                <tr><td colSpan={5} className="text-center py-8"><button className="btn-primary" onClick={() => refetch()}><RefreshCw className="w-4 h-4" />Retry</button></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5}><EmptyState icon={<BellRing className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No delivery events" description="No retraction notification events match this status." /></td></tr>
              ) : rows.map(row => (
                <tr
                  key={row.id}
                  className={`cursor-pointer ${selectedId === row.id ? 'bg-[var(--color-primary)]/5' : 'hover:bg-[var(--color-border-light)]'}`}
                  onClick={() => {
                    setSelectedId(row.id);
                    setRetryReason('');
                  }}
                >
                  <td>
                    <p className="font-medium">{row.patient_name || row.patient_code || `Patient #${row.patient_id ?? '—'}`}</p>
                    <p className="text-xs text-[var(--color-text-secondary)]">{row.order_no || `Order #${row.lab_order_id ?? '—'}`} · outbox #{row.id}</p>
                  </td>
                  <td className="text-sm">
                    <span className="font-medium">{row.delivery_sent}/{row.delivery_total} sent</span>
                    {Number(row.delivery_failed) > 0 ? <span className="text-red-600"> · {row.delivery_failed} failed</span> : null}
                    {Number(row.delivery_active) > 0 ? <span className="text-amber-600"> · {row.delivery_active} active</span> : null}
                  </td>
                  <td><span className={`badge ${notificationDeliveryStatusBadge(row.status)}`}>{row.status}</span></td>
                  <td className="max-w-xs"><p className="truncate text-xs text-red-600">{row.last_error || '—'}</p></td>
                  <td className="text-xs whitespace-nowrap">{dateLabel(row.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="card p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Delivery evidence · outbox #{selected.id}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {selected.reason_code?.replace(/_/g, ' ') || 'result retraction'} · {selected.reason || 'No reason recorded'}
              </p>
            </div>
            <span className={`badge ${notificationDeliveryStatusBadge(selected.status)}`}>{selected.status}</span>
          </div>

          <div className="space-y-2">
            {selectedDeliveries.length === 0 ? (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-800 dark:text-red-200 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                No recoverable recipient delivery exists. Review recipient configuration; do not retry blindly.
              </div>
            ) : selectedDeliveries.map(delivery => (
              <div key={delivery.id} className="rounded-xl border border-[var(--color-border)] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{delivery.channel} · {delivery.recipient_type} #{delivery.recipient_id}</p>
                  <span className={`badge ${notificationDeliveryStatusBadge(delivery.status)}`}>{delivery.status}</span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">Attempts: {delivery.attempt_count} · sent: {dateLabel(delivery.sent_at)} · next: {dateLabel(delivery.next_attempt_at)}</p>
                {delivery.last_error ? <p className="text-xs text-red-600 mt-1">{delivery.last_error}</p> : null}
              </div>
            ))}
          </div>

          {selected.status === 'failed' && (
            <div className="border-t border-[var(--color-border)] pt-3 space-y-3">
              <textarea
                className="input min-h-[82px]"
                value={retryReason}
                onChange={event => setRetryReason(event.target.value)}
                disabled={!canRetryAnalyzerRetractionNotification(selected)}
                placeholder="Required: incident review, recovered dependency, and why retry is safe"
              />
              {!canRetryAnalyzerRetractionNotification(selected) ? (
                <p className="text-xs text-red-600">No recoverable recipient delivery exists. Correct recipient/configuration evidence instead.</p>
              ) : null}
              <div className="flex justify-end">
                <button
                  className="btn-secondary text-amber-700"
                  disabled={retrying || !canRetryAnalyzerRetractionNotification(selected)}
                  onClick={retry}
                >
                  <RotateCcw className="w-4 h-4" />{retrying ? 'Queuing…' : 'Queue reviewed retry'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
