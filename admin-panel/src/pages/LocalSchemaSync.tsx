import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { useToast } from '../components/Toast';

interface Approval {
  id: number;
  filename: string;
  safety: 'destructive';
  content_hash: string;
  sql_content: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
  reviewed_by: string | null;
  reviewed_at: string | null;
  apply_error: string | null;
  detected_at: string;
  applied_at: string | null;
}

interface LogEntry {
  id: number;
  filename: string;
  event: string;
  actor: string | null;
  message: string | null;
  created_at: string;
}

interface Status {
  lastSyncAt: string | null;
  appliedCount: number;
  pendingCount: number;
  dryRun: boolean;
}

export default function LocalSchemaSync() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const status = useQuery({
    queryKey: ['schema-sync-status'],
    queryFn: () => api.localSchema.status(),
    refetchInterval: 30_000,
  });

  const approvals = useQuery({
    queryKey: ['schema-sync-approvals'],
    queryFn: () => api.localSchema.approvals(),
    refetchInterval: 30_000,
  });

  const log = useQuery({
    queryKey: ['schema-sync-log'],
    queryFn: () => api.localSchema.log(50),
    refetchInterval: 30_000,
  });

  const approve = useMutation({
    mutationFn: (filename: string) => api.localSchema.approve(filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema-sync-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['schema-sync-log'] });
      toast('success', 'Migration approved');
    },
    onError: (err: Error) => toast('error', err.message || 'Failed to approve'),
  });

  const reject = useMutation({
    mutationFn: (filename: string) => api.localSchema.reject(filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema-sync-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['schema-sync-log'] });
      toast('success', 'Migration rejected');
    },
    onError: (err: Error) => toast('error', err.message || 'Failed to reject'),
  });

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Local Schema Sync</h1>
        <p className="text-sm text-gray-500">
          Manage schema migrations between cloud and this local server.
        </p>
      </header>

      {status.data && (
        <section className="bg-white rounded border p-4 space-y-2">
          <h2 className="font-semibold">Status</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-gray-500">Last sync</dt>
            <dd>{status.data.lastSyncAt ?? '—'}</dd>
            <dt className="text-gray-500">Applied</dt>
            <dd>{status.data.appliedCount}</dd>
            <dt className="text-gray-500">Pending approvals</dt>
            <dd>{status.data.pendingCount}</dd>
            <dt className="text-gray-500">Dry run</dt>
            <dd>{status.data.dryRun ? 'ON' : 'off'}</dd>
          </dl>
        </section>
      )}

      <section className="bg-white rounded border p-4 space-y-3">
        <h2 className="font-semibold">Pending Destructive Approvals</h2>
        {approvals.isLoading && <div className="text-sm text-gray-500">Loading…</div>}
        {approvals.data && approvals.data.approvals.length === 0 && (
          <div className="text-sm text-gray-500">No pending destructive migrations.</div>
        )}
        {approvals.data?.approvals.map((a) => (
          <article key={a.id} className="border rounded p-3 space-y-2">
            <header className="flex items-center justify-between">
              <code className="text-sm font-mono">{a.filename}</code>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  a.status === 'pending'
                    ? 'bg-red-100 text-red-800'
                    : a.status === 'approved'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {a.status}
              </span>
            </header>
            <details>
              <summary className="cursor-pointer text-sm text-gray-600">SQL preview</summary>
              <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-x-auto">
                {a.sql_content.slice(0, 1000)}
                {a.sql_content.length > 1000 ? '\n... (truncated)' : ''}
              </pre>
            </details>
            {a.apply_error && (
              <div className="text-xs text-red-600">Last error: {a.apply_error}</div>
            )}
            {a.status === 'pending' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => approve.mutate(a.filename)}
                  disabled={approve.isPending}
                  aria-label={`Approve migration ${a.filename}`}
                  className="px-3 py-1 bg-red-600 text-white text-sm rounded disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => reject.mutate(a.filename)}
                  disabled={reject.isPending}
                  aria-label={`Reject migration ${a.filename}`}
                  className="px-3 py-1 bg-gray-200 text-sm rounded disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="bg-white rounded border p-4 space-y-2">
        <h2 className="font-semibold">Apply Log</h2>
        {log.data && log.data.log.length === 0 && (
          <div className="text-sm text-gray-500">No log entries yet.</div>
        )}
        <ul className="divide-y text-sm">
          {log.data?.log.map((entry) => (
            <li key={entry.id} className="py-2 flex gap-3">
              <span className="text-gray-500 font-mono text-xs">{entry.created_at}</span>
              <span className="font-mono text-xs">{entry.filename}</span>
              <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{entry.event}</span>
              <span className="text-xs text-gray-500">by {entry.actor ?? '—'}</span>
              {entry.message && <span className="text-xs text-gray-700">{entry.message}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
