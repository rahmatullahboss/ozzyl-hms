import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { api } from '../lib/apiClient';

interface SafetyOverrideAuditEntry {
  id: number;
  prescription_id?: number | null;
  patient_id: number;
  patient_name?: string | null;
  patient_code?: string | null;
  medication_name?: string | null;
  generic_name?: string | null;
  check_type?: string | null;
  warning_count?: number | null;
  override_reason?: string | null;
  checked_by?: number | null;
  checked_by_name?: string | null;
  checked_at?: string | null;
}

interface SafetyOverrideAuditResponse {
  overrides: SafetyOverrideAuditEntry[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function buildOverrideAuditUrl(filters: { patientId: string; prescriptionId: string; checkedBy: string; page: number }) {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('limit', '20');
  if (filters.patientId.trim()) params.set('patientId', filters.patientId.trim());
  if (filters.prescriptionId.trim()) params.set('prescriptionId', filters.prescriptionId.trim());
  if (filters.checkedBy.trim()) params.set('checkedBy', filters.checkedBy.trim());
  return `/api/e-prescribing/safety-overrides?${params.toString()}`;
}

export default function SafetyOverrideAuditPage() {
  const [patientId, setPatientId] = useState('');
  const [prescriptionId, setPrescriptionId] = useState('');
  const [checkedBy, setCheckedBy] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SafetyOverrideAuditResponse>({ overrides: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const url = useMemo(() => buildOverrideAuditUrl({ patientId, prescriptionId, checkedBy, page }), [checkedBy, page, patientId, prescriptionId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<SafetyOverrideAuditResponse>(url)
      .then((result) => {
        if (!cancelled) setData({ overrides: result.overrides ?? [], pagination: result.pagination });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load safety override audit');
          setData({ overrides: [] });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshKey, url]);

  const pagination = data.pagination;
  const totalOverrides = pagination?.total ?? data.overrides.length;
  const totalWarnings = data.overrides.reduce((sum, entry) => sum + Number(entry.warning_count ?? 0), 0);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setRefreshKey((value) => value + 1);
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <ShieldAlert className="h-4 w-4" />
            Clinical governance
          </div>
          <h1 className="mt-1 text-2xl font-bold text-[var(--color-text)]">Safety Override Audit</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Review prescription safety warnings that were overridden, including the clinical reason and responsible user.
          </p>
        </div>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)} className="btn-ghost self-start md:self-auto">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Total overrides</div>
          <div className="mt-1 text-2xl font-bold">{totalOverrides}</div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Warning count</div>
          <div className="mt-1 text-2xl font-bold">{totalWarnings}</div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Current page</div>
          <div className="mt-1 text-2xl font-bold">{pagination?.page ?? page}</div>
        </div>
      </div>

      <form onSubmit={applyFilters} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">
            Patient ID
            <input className="input mt-1" value={patientId} onChange={(event) => setPatientId(event.target.value)} inputMode="numeric" />
          </label>
          <label className="text-xs font-medium text-[var(--color-text-muted)]">
            Prescription ID
            <input className="input mt-1" value={prescriptionId} onChange={(event) => setPrescriptionId(event.target.value)} inputMode="numeric" />
          </label>
          <label className="text-xs font-medium text-[var(--color-text-muted)]">
            Checked by user ID
            <input className="input mt-1" value={checkedBy} onChange={(event) => setCheckedBy(event.target.value)} inputMode="numeric" />
          </label>
          <div className="flex items-end">
            <button type="submit" className="btn-primary w-full">
              <Search className="h-4 w-4" />
              Apply filters
            </button>
          </div>
        </div>
      </form>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold">Override entries</div>
        {loading ? (
          <div className="p-6 text-sm text-[var(--color-text-muted)]">Loading safety override audit…</div>
        ) : data.overrides.length === 0 ? (
          <div className="p-6 text-sm text-[var(--color-text-muted)]">No safety overrides found for the selected filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--color-border)] text-sm">
              <thead className="bg-[var(--color-bg)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Medication</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Warnings</th>
                  <th className="px-4 py-3">Checked by</th>
                  <th className="px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.overrides.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold">{entry.patient_name || `Patient #${entry.patient_id}`}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{entry.patient_code || `ID ${entry.patient_id}`}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium">{entry.medication_name || 'Medication safety warning'}</div>
                      {entry.generic_name && <div className="text-xs text-[var(--color-text-muted)]">{entry.generic_name}</div>}
                    </td>
                    <td className="max-w-md px-4 py-3 align-top text-[var(--color-text)]">{entry.override_reason || 'No reason recorded'}</td>
                    <td className="px-4 py-3 align-top">{entry.warning_count ?? 0}</td>
                    <td className="px-4 py-3 align-top">{entry.checked_by_name || (entry.checked_by ? `User #${entry.checked_by}` : '—')}</td>
                    <td className="px-4 py-3 align-top text-xs text-[var(--color-text-muted)]">{formatDateTime(entry.checked_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-[var(--color-text-muted)]">
        <span>Page {pagination?.page ?? page}{pagination?.totalPages ? ` of ${pagination.totalPages}` : ''}</span>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost text-xs" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <button type="button" className="btn-ghost text-xs" disabled={!pagination?.hasMore || loading} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
