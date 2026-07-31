import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, RefreshCw, Server, Trash2, WifiOff } from 'lucide-react';
import AdminPageShell from '../../components/admin/AdminPageShell';
import { useOffline } from '../../hooks/useOffline';
import { api } from '../../lib/apiClient';
import {
  getActiveTenantId,
  getAllSyncQueueRowsDecrypted,
  markSyncItemStatusEncrypted,
  removeSyncItemEncrypted,
  type DecryptedSyncQueueRow,
  type SyncQueueStatus,
} from '../../lib/secure-store';

const statusLabels: Record<SyncQueueStatus, string> = {
  queued: 'Queued',
  syncing: 'Syncing',
  synced: 'Synced',
  failed: 'Failed',
  conflict: 'Conflict review',
  poison: 'Blocked review',
};

const statusClasses: Record<SyncQueueStatus, string> = {
  queued: 'bg-amber-50 text-amber-700 border-amber-200',
  syncing: 'bg-blue-50 text-blue-700 border-blue-200',
  synced: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-orange-50 text-orange-700 border-orange-200',
  conflict: 'bg-red-50 text-red-700 border-red-200',
  poison: 'bg-gray-100 text-gray-700 border-gray-200',
};

type LocalOutboxStatus = 'pending' | 'exporting' | 'exported' | 'failed' | 'poison';
type CloudIngestStatus = 'metadata_only' | 'processing' | 'applied' | 'failed';
type CloudPullStatus = 'pending' | 'applied' | 'failed' | 'skipped';

type LocalOutboxRow = {
  id: number;
  entityType: string;
  entityId: string;
  operation: string;
  status: LocalOutboxStatus;
  attempts: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  createdAt?: string | null;
  exportedAt?: string | null;
};

type CloudIngestRow = {
  id: number;
  serverId: string;
  batchId: string;
  entityType: string;
  entityId: string;
  operation: string;
  applyStatus: CloudIngestStatus;
  applyError?: string | null;
  receivedAt?: string | null;
};

type CloudPullRow = {
  tableName: string;
  lastSnapshotId?: string | null;
  lastPulledAt?: string | null;
  rowsReceived: number;
  rowsApplied: number;
  status: CloudPullStatus;
  lastError?: string | null;
  updatedAt?: string | null;
};

type ServerSyncReviewResponse = {
  deploymentMode: 'local_server' | 'cloud';
  localServerId?: string | null;
  generatedAt: string;
  warnings: string[];
  coverage: {
    mode: 'explicit_outbox';
    fullDatabaseReplication: boolean;
    explicitLocalEmitterTypes: string[];
    nonAtomicEmitterTypes: string[];
    partialWritePathCoverageTypes: string[];
    atomicPatientWritePaths: string[];
    durableStagedPatientWritePaths: string[];
    patientWritePathGaps: string[];
    entityIdMappingGaps: string[];
    cloudApplyTypes: string[];
    coreOutboxGaps: string[];
  };
  localOutbox: {
    summary: { total: number; pending: number; exporting: number; exported: number; failed: number; poison: number };
    rows: LocalOutboxRow[];
  };
  cloudIngest: {
    summary: { total: number; metadataOnly: number; processing: number; applied: number; failed: number };
    rows: CloudIngestRow[];
  };
  cloudPull: {
    summary: { total: number; pending: number; applied: number; failed: number; skipped: number };
    rows: CloudPullRow[];
  };
};

function formatBrowserDate(value?: number): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatServerDate(value?: string | null): string {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function summarize(rows: DecryptedSyncQueueRow[]) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + 1;
      summary.byStore[row.store] = (summary.byStore[row.store] ?? 0) + 1;
      const workstation = row.payload.original_workstation_id || 'unknown-browser';
      summary.byWorkstation[workstation] = (summary.byWorkstation[workstation] ?? 0) + 1;
      return summary;
    },
    {
      total: 0,
      byStatus: {} as Partial<Record<SyncQueueStatus, number>>,
      byStore: {} as Record<string, number>,
      byWorkstation: {} as Record<string, number>,
    },
  );
}

function syncStatusClass(status: string): string {
  if (status === 'failed' || status === 'poison') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'pending' || status === 'exporting' || status === 'metadata_only' || status === 'processing') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'applied' || status === 'exported') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-gray-200 bg-gray-100 text-gray-700';
}

export default function OfflineSyncReview() {
  const { isOnline, pendingCount, isSyncing, syncNow } = useOffline();
  const [rows, setRows] = useState<DecryptedSyncQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverSync, setServerSync] = useState<ServerSyncReviewResponse | null>(null);
  const [serverLoading, setServerLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [retryingOutboxId, setRetryingOutboxId] = useState<number | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tenantId = getActiveTenantId();
      setRows(await getAllSyncQueueRowsDecrypted(tenantId));
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Could not read encrypted offline queue');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadServerSync = useCallback(async () => {
    setServerLoading(true);
    setServerError(null);
    try {
      setServerSync(await api.get<ServerSyncReviewResponse>('/api/audit/server-sync?limit=100'));
    } catch (err) {
      setServerSync(null);
      setServerError(err instanceof Error ? err.message : 'Could not load hospital local-server sync state');
    } finally {
      setServerLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadRows(), loadServerSync()]);
  }, [loadRows, loadServerSync]);

  useEffect(() => {
    void loadAll();
    const refresh = () => void loadAll();
    window.addEventListener('hms:sync:queued', refresh);
    window.addEventListener('hms:sync:complete', refresh);
    window.addEventListener('hms:sync:error', refresh);
    window.addEventListener('hms:sync:progress', refresh);
    return () => {
      window.removeEventListener('hms:sync:queued', refresh);
      window.removeEventListener('hms:sync:complete', refresh);
      window.removeEventListener('hms:sync:error', refresh);
      window.removeEventListener('hms:sync:progress', refresh);
    };
  }, [loadAll]);

  const summary = useMemo(() => summarize(rows), [rows]);
  const browserNeedsReview = (summary.byStatus.conflict ?? 0) + (summary.byStatus.poison ?? 0);
  const serverNeedsReview = serverSync
    ? serverSync.localOutbox.summary.failed
      + serverSync.localOutbox.summary.poison
      + serverSync.cloudIngest.summary.failed
      + serverSync.cloudPull.summary.failed
    : 0;

  const retryRow = async (row: DecryptedSyncQueueRow) => {
    await markSyncItemStatusEncrypted(row.id, 'queued');
    window.dispatchEvent(new CustomEvent('hms:sync:queued', { detail: { rowId: row.id, store: row.store } }));
    await loadRows();
  };

  const removeRow = async (row: DecryptedSyncQueueRow) => {
    await removeSyncItemEncrypted(row.id);
    await loadRows();
  };

  const retryServerOutbox = async (row: LocalOutboxRow) => {
    setRetryingOutboxId(row.id);
    try {
      await api.post(`/api/audit/server-sync/outbox/${row.id}/retry`, {});
      await loadServerSync();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not queue server sync retry');
    } finally {
      setRetryingOutboxId(null);
    }
  };

  const summaryCards = (
    <div className="grid gap-4 md:grid-cols-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Browser queue</p>
        <p className="mt-2 text-2xl font-bold text-gray-900">{summary.total}</p>
        <p className="text-xs text-gray-500">Current browser only</p>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Browser pending</p>
        <p className="mt-2 text-2xl font-bold text-amber-800">{pendingCount}</p>
        <p className="text-xs text-amber-700">Queued, failed, or syncing</p>
      </div>
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Needs review</p>
        <p className="mt-2 text-2xl font-bold text-red-800">{browserNeedsReview + serverNeedsReview}</p>
        <p className="text-xs text-red-700">Browser + hospital server sync</p>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Network</p>
        <p className="mt-2 flex items-center gap-2 text-2xl font-bold text-gray-900">
          {isOnline ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <WifiOff className="h-5 w-5 text-red-600" />}
          {isOnline ? 'Online' : 'Offline'}
        </p>
        <p className="text-xs text-gray-500">Browser replay requires connectivity</p>
      </div>
    </div>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void loadAll()}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <RefreshCw className="h-4 w-4" /> Refresh all
      </button>
      <button
        type="button"
        onClick={() => void syncNow().then(loadAll)}
        disabled={!isOnline || isSyncing || pendingCount === 0}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} /> Sync browser queue
      </button>
    </div>
  );

  return (
    <AdminPageShell
      title="Offline Sync Review"
      subtitle="Two separate channels: encrypted browser offline queue, and hospital local-server ↔ cloud periodic sync."
      breadcrumbs={[
        { label: 'Dashboard', path: '/dashboard' },
        { label: 'Audit & Security' },
        { label: 'Offline Sync Review' },
      ]}
      actions={actions}
      summaryCards={summaryCards}
    >
      <div className="space-y-6">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-gray-900"><Server className="h-5 w-5" /> Hospital local server ↔ cloud</h2>
              <p className="text-sm text-gray-500">Server-side push outbox, cloud ingest receipts, and cloud-to-local pull state. No clinical payload body is shown.</p>
            </div>
            {serverSync && (
              <div className="text-right text-xs text-gray-500">
                <p className="font-medium text-gray-700">{serverSync.deploymentMode === 'local_server' ? 'Local-server view' : 'Cloud view'}</p>
                <p>{serverSync.localServerId || 'Server ID not configured'}</p>
              </div>
            )}
          </div>

          {serverError && (
            <div className="m-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div><p className="font-semibold">Server sync review unavailable</p><p>{serverError}</p></div>
            </div>
          )}

          {serverSync?.warnings.map((warning) => (
            <div key={warning} className="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</div>
          ))}

          {serverLoading ? (
            <div className="p-6 text-sm text-gray-500">Loading hospital server sync state…</div>
          ) : serverSync ? (
            <div className="space-y-6 p-4">
              {!serverSync.coverage.fullDatabaseReplication && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">Local-server incremental push coverage is partial</p>
                  <p className="mt-1">This is an explicit outbox, not automatic full-database replication. Currently emitted locally: {serverSync.coverage.explicitLocalEmitterTypes.join(', ') || 'none'}.</p>
                  <p className="mt-1">Emitted after the main write rather than atomically: {serverSync.coverage.nonAtomicEmitterTypes.join(', ') || 'none'}.</p>
                  <p className="mt-1">Entities with only partial write-path coverage: {serverSync.coverage.partialWritePathCoverageTypes.join(', ') || 'none'}.</p>
                  <p className="mt-1">Atomic patient write paths: {serverSync.coverage.atomicPatientWritePaths.join(', ') || 'none'}.</p>
                  <p className="mt-1">Durable staged patient write paths: {serverSync.coverage.durableStagedPatientWritePaths.join(', ') || 'none'}.</p>
                  <p className="mt-1">Patient write paths still missing atomic sync coverage: {serverSync.coverage.patientWritePathGaps.join(', ') || 'none'}.</p>
                  <p className="mt-1">Entities still needing stable local↔cloud ID mapping: {serverSync.coverage.entityIdMappingGaps.join(', ')}.</p>
                  <p className="mt-1">Core write paths still requiring outbox coverage: {serverSync.coverage.coreOutboxGaps.join(', ')}. Unsupported or conflicting payloads remain failed for review instead of being marked synced.</p>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold uppercase text-gray-500">Local push outbox</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">{serverSync.localOutbox.summary.total}</p>
                  <p className="text-xs text-gray-500">{serverSync.localOutbox.summary.failed} failed · {serverSync.localOutbox.summary.poison} blocked</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold uppercase text-gray-500">Cloud ingest</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">{serverSync.cloudIngest.summary.total}</p>
                  <p className="text-xs text-gray-500">{serverSync.cloudIngest.summary.processing} processing · {serverSync.cloudIngest.summary.applied} applied · {serverSync.cloudIngest.summary.failed} failed</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold uppercase text-gray-500">Cloud pull tables</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">{serverSync.cloudPull.summary.total}</p>
                  <p className="text-xs text-gray-500">{serverSync.cloudPull.summary.applied} applied · {serverSync.cloudPull.summary.failed} failed</p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">Local-server push outbox</h3>
                <p className="text-sm text-gray-500">Created on the hospital local server and periodically pushed to cloud.</p>
                {serverSync.localOutbox.rows.length === 0 ? (
                  <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-500">No local-server outbox metadata found on this deployment.</p>
                ) : (
                  <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {serverSync.localOutbox.rows.map((row) => (
                      <div key={row.id} className="flex flex-col gap-3 p-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${syncStatusClass(row.status)}`}>{row.status}</span>
                            <span className="text-sm font-semibold text-gray-900">{row.entityType}</span>
                            <span className="text-xs text-gray-500">{row.entityId}</span>
                          </div>
                          <p className="text-xs text-gray-500">{row.operation} · attempts {row.attempts} · created {formatServerDate(row.createdAt)}</p>
                          {row.lastError && <p className="rounded bg-red-50 px-2 py-1 text-sm text-red-700">{row.lastError}</p>}
                        </div>
                        {serverSync.deploymentMode === 'local_server' && (row.status === 'failed' || row.status === 'poison') && (
                          <button
                            type="button"
                            onClick={() => void retryServerOutbox(row)}
                            disabled={retryingOutboxId === row.id}
                            className="shrink-0 rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                          >
                            {retryingOutboxId === row.id ? 'Queuing…' : 'Queue server retry'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">Cloud ingest receipts</h3>
                <p className="text-sm text-gray-500">What the cloud accepted from each hospital server and whether the mapped write applied.</p>
                {serverSync.cloudIngest.rows.length === 0 ? (
                  <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-500">No cloud ingest receipt metadata found on this deployment.</p>
                ) : (
                  <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {serverSync.cloudIngest.rows.map((row) => (
                      <div key={row.id} className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${syncStatusClass(row.applyStatus)}`}>{row.applyStatus}</span>
                          <span className="text-sm font-semibold text-gray-900">{row.entityType}</span>
                          <span className="text-xs text-gray-500">{row.serverId} · {row.batchId}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{row.entityId} · received {formatServerDate(row.receivedAt)}</p>
                        {row.applyError && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-sm text-red-700">{row.applyError}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">Cloud-to-local pull state</h3>
                <p className="text-sm text-gray-500">Periodic cloud snapshots applied back to the hospital local server.</p>
                {serverSync.cloudPull.rows.length === 0 ? (
                  <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-500">No cloud-pull table state found on this deployment.</p>
                ) : (
                  <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {serverSync.cloudPull.rows.map((row) => (
                      <div key={row.tableName} className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${syncStatusClass(row.status)}`}>{row.status}</span>
                          <span className="text-sm font-semibold text-gray-900">{row.tableName}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{row.rowsApplied}/{row.rowsReceived} rows · last pull {formatServerDate(row.lastPulledAt)}</p>
                        {row.lastError && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-sm text-red-700">{row.lastError}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Encrypted queue unavailable</p>
              <p>{error}</p>
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold text-gray-900"><Cloud className="h-5 w-5" /> Browser offline queue</h2>
              <p className="text-sm text-gray-500">Encrypted queue for this browser/workstation only. It is separate from the hospital local server.</p>
            </div>

            {loading ? (
              <div className="p-6 text-sm text-gray-500">Loading encrypted offline queue…</div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No offline queue items found in this browser.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <div key={row.id} className="p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClasses[row.status]}`}>
                            {statusLabels[row.status]}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{row.store}</span>
                          <span className="text-xs text-gray-500">#{row.id}</span>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{row.payload.local_ref || row.payload.localId}</p>
                          <p className="text-sm text-gray-500">{row.payload.method} {row.payload.url}</p>
                        </div>
                        <dl className="grid gap-2 text-xs text-gray-500 sm:grid-cols-2 lg:grid-cols-4">
                          <div><dt className="font-semibold text-gray-700">Workstation</dt><dd>{row.payload.original_workstation_id || '—'}</dd></div>
                          <div><dt className="font-semibold text-gray-700">User</dt><dd>{row.payload.original_user_id || '—'}</dd></div>
                          <div><dt className="font-semibold text-gray-700">Created</dt><dd>{formatBrowserDate(row.createdAt)}</dd></div>
                          <div><dt className="font-semibold text-gray-700">Attempts</dt><dd>{row.attemptCount}</dd></div>
                        </dl>
                        {row.lastError && (
                          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{row.lastError}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {(row.status === 'failed' || row.status === 'conflict' || row.status === 'poison') && (
                          <button
                            type="button"
                            onClick={() => void retryRow(row)}
                            className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                          >
                            Mark retry
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void removeRow(row)}
                          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          <Trash2 className="h-4 w-4" /> Remove local
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold text-gray-900">Browser status</h3>
              <div className="mt-3 space-y-2 text-sm">
                {Object.entries(statusLabels).map(([status, label]) => (
                  <div key={status} className="flex items-center justify-between">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-semibold text-gray-900">{summary.byStatus[status as SyncQueueStatus] ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold text-gray-900">By workstation</h3>
              <div className="mt-3 space-y-2 text-sm">
                {Object.keys(summary.byWorkstation).length === 0 ? (
                  <p className="text-gray-500">No workstation queue yet.</p>
                ) : Object.entries(summary.byWorkstation).map(([workstation, count]) => (
                  <div key={workstation} className="flex items-center justify-between gap-3">
                    <span className="truncate text-gray-600">{workstation}</span>
                    <span className="font-semibold text-gray-900">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <h3 className="font-semibold">Channel boundary</h3>
              <p className="mt-2">Browser offline mode cannot see another PC while the network is down. In local-server hospitals, all PCs use the hospital server and that server performs the separate periodic cloud synchronization shown above.</p>
            </div>
          </aside>
        </div>
      </div>
    </AdminPageShell>
  );
}
