import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Users, Search, Plus, Eye, Pencil, Download, Filter, RefreshCw, Merge, User } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { getRoleBasePath } from '../lib/handover';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6 } from '../lib/date-utils';

interface Patient {
  id: number;
  name: string;
  patient_code?: string;
  uhid?: string | null;
  father_husband: string;
  address: string;
  mobile: string;
  guardian_mobile: string;
  age?: number;
  gender?: string;
  created_at: string;
}

interface PatientSearchResult {
  id: number;
  name: string;
  patient_code: string;
  mobile: string;
}

interface PatientsResponse {
  patients: Patient[];
  total: number;
}

function parsePatientDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ─── Merge Modal ──────────────────────────────────────────────────────────────

function PatientSearchInput({ label, selected, onSelect, onClear }: {
  label: string;
  selected: PatientSearchResult | null;
  onSelect: (p: PatientSearchResult) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientSearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.get<{ patients: PatientSearchResult[] }>(`/api/patients?search=${encodeURIComponent(query)}`)
        .then(r => setResults(r.patients ?? []))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  if (selected) {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>
        <div className="flex items-center justify-between p-2.5 rounded-lg border border-[var(--color-primary)] bg-blue-50 dark:bg-blue-900/20">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-[var(--color-primary)]" />
            <div>
              <p className="text-sm font-medium">{selected.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{selected.patient_code} · {selected.mobile}</p>
            </div>
          </div>
          <button type="button" onClick={onClear} className="text-xs text-[var(--color-text-muted)] hover:text-red-500">
            {t('changeSelection', { defaultValue: 'Change' })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('searchByNameIdOrMobile', { defaultValue: 'Search by name, patient ID, or mobile' })}
          className="input pl-9 w-full"
        />
        {results.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {results.map(p => (
              <button key={p.id} type="button"
                onClick={() => { onSelect(p); setQuery(''); setResults([]); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--color-bg-secondary)] text-left">
                <User className="w-4 h-4 text-[var(--color-text-muted)]" />
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{p.patient_code} · {p.mobile}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MergeModal({ onClose, onMerged }: { onClose: () => void; onMerged: () => void }) {
  const { t } = useTranslation(['patients', 'common']);
  const [duplicate, setDuplicate] = useState<PatientSearchResult | null>(null);
  const [original, setOriginal]   = useState<PatientSearchResult | null>(null);

  const mergeMutation = useApiMutation<{ message: string; tables_updated: Record<string, number> }, unknown>(
    'put',
    duplicate ? `/api/patients/${duplicate.id}/merge?original_id=${original?.id}` : '/api/patients/0/merge',
    {
      onSuccess: (data) => {
        toast.success(data.message);
        onMerged();
        onClose();
      },
      onError: (err) => {
        toast.error(err.message || t('mergeFailed', { defaultValue: 'Merge failed' }));
      },
    },
  );

  const handleMerge = () => {
    if (!duplicate || !original) return;
    if (duplicate.id === original.id) {
      toast.error(t('cannotMergeSame', { defaultValue: 'Cannot merge a patient with themselves' }));
      return;
    }
    const confirmed = window.confirm(t('confirmMergePatients', {
      duplicate: duplicate.name,
      original: original.name,
      defaultValue: 'Merge "{{duplicate}}" into "{{original}}"? This will move all records and cannot be easily undone.',
    }));
    if (!confirmed) return;
    mergeMutation.mutate({});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="p-5 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('mergePatients', { defaultValue: 'Merge patients' })}</h2>
          <p className="text-sm text-[var(--color-text-muted)]">{t('mergeDescription', { defaultValue: 'Move all records from the duplicate patient to the original patient.' })}</p>
        </div>
        <div className="p-5 space-y-4">
          <PatientSearchInput
            label={t('duplicatePatient', { defaultValue: 'Duplicate patient (will be deactivated)' })}
            selected={duplicate}
            onSelect={setDuplicate}
            onClear={() => setDuplicate(null)}
          />

          {duplicate && (
            <div className="flex items-center justify-center">
              <Merge className="w-5 h-5 text-[var(--color-text-muted)] rotate-90" />
            </div>
          )}

          <PatientSearchInput
            label={t('originalPatient', { defaultValue: 'Original patient (keep this record)' })}
            selected={original}
            onSelect={setOriginal}
            onClear={() => setOriginal(null)}
          />

          {duplicate && original && duplicate.id === original.id && (
            <p className="text-sm text-red-500 font-medium">{t('cannotMergeSame', { defaultValue: 'Cannot merge a patient with themselves' })}</p>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common:cancel')}</button>
            <button
              onClick={handleMerge}
              disabled={!duplicate || !original || duplicate.id === original.id || mergeMutation.isPending}
              className="btn-primary flex-1 bg-amber-600 hover:bg-amber-700 border-amber-700">
              {mergeMutation.isPending ? t('merging', { defaultValue: 'Merging...' }) : t('mergeConfirm', { defaultValue: 'Merge records' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PatientList({ role = 'hospital_admin' }: { role?: string }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showMerge, setShowMerge] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 20;
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(['patients', 'common']);
  const queryClient = useQueryClient();

  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = getRoleBasePath(slug, role);

  // Helper to get YYYY-MM-DD in local timezone for reliable date comparison
  const toLocalDateStr = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const formatPatientDate = (value?: string | null) => {
    const date = parsePatientDate(value);
    return date ? date.toLocaleDateString(i18n.language === 'bn' ? 'bn-BD' : 'en-GB') : '—';
  };
  const todayStr = toLocalDateStr(new Date());

  const filters = useMemo(() => ({ search: debouncedSearch, page, perPage }), [debouncedSearch, page, perPage]);

  const { data, isLoading: loading } = useApiQuery<PatientsResponse>(
    queryKeys.patients.list(filters),
    `/api/patients?search=${encodeURIComponent(debouncedSearch)}&page=${page}&perPage=${perPage}`,
  );

  const patients = data?.patients ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(1);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setDebouncedSearch(v), 350);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
  };

  return (
    <DashboardLayout role={role}>
      {showMerge && (
        <MergeModal
          onClose={() => setShowMerge(false)}
          onMerged={handleRefresh}
        />
      )}
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Page Header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title')}</h1>
            <nav className="text-sm text-[var(--color-text-muted)] mt-1">
              <span>{t('dashboard', { ns: 'dashboard', defaultValue: 'Dashboard' })}</span> <span className="mx-1.5">›</span> <span className="text-[var(--color-text-secondary)]">{t('title')}</span>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleRefresh} className="btn-ghost" title={t('refresh', { ns: 'common', defaultValue: 'Refresh' })}><RefreshCw className="w-4 h-4" /></button>
            <button onClick={() => setShowMerge(true)} className="btn-secondary">
              <Merge className="w-4 h-4" />
              <span className="hidden sm:inline">{t('mergePatients', { defaultValue: 'Merge' })}</span>
            </button>
            <button onClick={() => {
              if (!window.confirm(t('confirmExport', { defaultValue: 'Export patient list as CSV?' }))) return;
              const rows = [['ID', 'Name', 'Age', 'Gender', 'Phone', 'Date']];
              patients.forEach(p => rows.push([String(p.id), p.name, String(p.age ?? ''), p.gender ?? '', p.mobile, p.created_at]));
              const csv = rows.map(r => r.map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `patients-${getTodayGMT6()}.csv`; a.click();
              URL.revokeObjectURL(url);
            }} className="btn-secondary">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">{t('export', { ns: 'common', defaultValue: 'Export' })}</span>
            </button>
            <button onClick={() => navigate(`${basePath}/patients/new`)} className="btn-primary">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('newPatient')}</span>
            </button>
          </div>
        </div>

        {/* ── Summary chips ── */}
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-primary">{t('total', { ns: 'common' })}: {total.toLocaleString()}</span>
          <span className="badge badge-info">{t('today', { defaultValue: 'Today' })}: {loading ? '…' : patients.filter(p => {
            const date = parsePatientDate(p.created_at);
            return date ? toLocalDateStr(date) === todayStr : false;
          }).length}</span>
        </div>

        {/* ── Search & Filter ── */}
        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('searchByMobileNameOrId', { ns: 'patients', defaultValue: 'Search by mobile, name, or patient ID' })}
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="input pl-9"
            />
          </div>
          <button className="btn-secondary"><Filter className="w-4 h-4" /> {t('filter', { ns: 'common', defaultValue: 'Filter' })}</button>
        </div>

        {/* ── Table / Card List ── */}
        <div className="card overflow-hidden">

          {/* Mobile card list — visible on small screens */}
          <div className="sm:hidden divide-y divide-[var(--color-border)]">
            {loading
              ? [...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-4">
                    <div className="skeleton w-10 h-10 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-4 w-32" />
                      <div className="skeleton h-3 w-20" />
                    </div>
                    <div className="skeleton h-3 w-14" />
                  </div>
                ))
              : patients.length === 0 ? (
                  <div className="py-16 flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
                    <Users className="w-10 h-10 opacity-30" />
                    <p className="font-medium">{t('noPatients', { defaultValue: 'No patients found' })}</p>
                    <button onClick={() => navigate(`${basePath}/patients/new`)} className="btn-primary">
                      <Plus className="w-4 h-4" /> {t('addFirst', { defaultValue: 'Add first patient' })}
                    </button>
                  </div>
                )
              : patients.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[var(--color-border-light)] transition-colors"
                    onClick={() => navigate(`${basePath}/patients/${p.id}`)}
                  >
                    <div className={`mobile-card-avatar shrink-0 ${
                      p.gender === 'Female'
                        ? 'bg-pink-50 text-pink-600'
                        : 'bg-blue-50 text-blue-600'
                    }`}>
                      {p.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-text-muted)] font-data">
                        <span className="font-mono bg-[var(--color-bg-secondary)] px-1 rounded">
                          {p.patient_code || `P-${String(p.id).padStart(4, '0')}`}
                        </span>
                        {p.age ? <span>{p.age}y</span> : null}
                        {p.gender ? <span className="capitalize">{p.gender}</span> : null}
                      </div>
                      {p.uhid && (
                        <p className="text-[10px] text-[var(--color-primary)] font-medium truncate">UHID: {p.uhid}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {formatPatientDate(p.created_at)}
                      </p>
                      <div className="flex gap-1 justify-end mt-1">
                        <button onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/patients/${p.id}`); }} className="btn-ghost p-1" title={t('viewPatient', { defaultValue: 'View patient' })}><Eye className="w-3.5 h-3.5" /></button>
                        <button onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/patients/new?edit=${p.id}`); }} className="btn-ghost p-1" title={t('editPatient', { defaultValue: 'Edit patient' })}><Pencil className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  </div>
                ))
            }
          </div>

          {/* Desktop table — hidden on mobile */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('patientId')}</th>
                  <th>{t('name', { ns: 'common' })}</th>
                  <th>{t('age')} / {t('gender')}</th>
                  <th>{t('phone', { ns: 'common' })}</th>
                  <th>{t('date', { ns: 'common' })}</th>
                  <th>{t('actions', { ns: 'common' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(7)].map((_, j) => (
                        <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : patients.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
                        <Users className="w-10 h-10 opacity-30" />
                        <p className="font-medium">{t('noPatients', { defaultValue: 'No patients found' })}</p>
                        <button onClick={() => navigate(`${basePath}/patients/new`)} className="btn-primary">
                          <Plus className="w-4 h-4" /> {t('addFirst', { defaultValue: 'Add first patient' })}
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  patients.map((p, idx) => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors"
                      onClick={() => navigate(`${basePath}/patients/${p.id}`)}
                    >
                      <td className="text-[var(--color-text-muted)]">{(page - 1) * perPage + idx + 1}</td>
                      <td className="font-data font-medium text-[var(--color-primary-dark)]">
                        <div className="flex flex-col">
                          <span>{p.patient_code || `P-${String(p.id).padStart(4, '0')}`}</span>
                          {p.uhid && (
                            <span className="text-[9px] text-[var(--color-text-muted)] font-normal">UHID: {p.uhid}</span>
                          )}
                        </div>
                      </td>
                      <td className="font-medium">{p.name}</td>
                      <td className="text-[var(--color-text-secondary)]">
                        {p.age ? `${p.age}` : '—'}{p.gender ? ` / ${p.gender[0]}` : ''}
                      </td>
                      <td className="font-data text-sm">{p.mobile}</td>
                      <td className="text-sm text-[var(--color-text-muted)]">
                        {formatPatientDate(p.created_at)}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => navigate(`${basePath}/patients/${p.id}`)}
                            className="btn-ghost p-1.5" title={t('viewPatient', { defaultValue: 'View patient' })}
                          ><Eye className="w-4 h-4" /></button>
                          <button
                            onClick={() => navigate(`${basePath}/patients/new?edit=${p.id}`)}
                            className="btn-ghost p-1.5" title={t('editPatient', { defaultValue: 'Edit patient' })}
                          ><Pencil className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && patients.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
              <span className="text-sm text-[var(--color-text-muted)]">
                {t('showing', { defaultValue: 'Showing' })} {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} {t('of', { defaultValue: 'of' })} {total.toLocaleString()} {t('patientsList', { defaultValue: 'patients' })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="btn-ghost text-sm disabled:opacity-40"
                >← {t('prev', { ns: 'common', defaultValue: 'Prev' })}</button>
                {[...Array(Math.min(5, totalPages))].map((_, i) => {
                  const pg = i + 1;
                  return (
                    <button key={pg} onClick={() => setPage(pg)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                        pg === page ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                      }`}>
                      {pg}
                    </button>
                  );
                })}
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="btn-ghost text-sm disabled:opacity-40"
                >{t('next', { ns: 'common', defaultValue: 'Next' })} →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
