import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, CheckCircle, Trash2, Search, ClipboardList } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

interface Problem {
  id: number;
  patient_id: number;
  description: string;
  icd10_code?: string;
  severity?: 'mild' | 'moderate' | 'severe';
  status: 'active' | 'resolved' | 'inactive';
  beg_date?: string;
  end_date?: string;
  comments?: string;
  created_at: string;
}

interface ProblemsResponse {
  problems?: Problem[];
}

interface IcdResult {
  code: string;
  description: string;
}

interface IcdSearchResponse {
  results?: IcdResult[];
}

const SEVERITY_STYLES: Record<string, string> = {
  mild: 'bg-green-100 text-green-700',
  moderate: 'bg-amber-100 text-amber-700',
  severe: 'bg-red-100 text-red-700',
};

export default function ProblemListPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation(['clinical', 'common']);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'active' | 'resolved' | 'all'>('active');

  // ICD search state
  const [icdQuery, setIcdQuery] = useState('');
  const [icdResults, setIcdResults] = useState<IcdResult[]>([]);
  const [icdSearching, setIcdSearching] = useState(false);
  const [showIcdDropdown, setShowIcdDropdown] = useState(false);
  const icdDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const icdInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    description: '',
    icd10_code: '',
    severity: 'moderate' as 'mild' | 'moderate' | 'severe',
    beg_date: new Date().toISOString().split('T')[0],
    comments: '',
  });

  const fetchProblems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ProblemsResponse>(`/api/clinical/problems?patientId=${patientId}`);
      setProblems(data.problems || []);
    } catch {
      toast.error(t('toast.problemLoadFailed', { defaultValue: 'Failed to load problems' }));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) fetchProblems();
  }, [fetchProblems, patientId]);

  // ICD-10 autocomplete search
  const handleIcdSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setIcdResults([]);
      setShowIcdDropdown(false);
      return;
    }
    setIcdSearching(true);
    try {
      const data = await apiFetch<IcdSearchResponse>(`/api/clinical/diagnosis/search?q=${encodeURIComponent(query)}`);
      setIcdResults(data.results || []);
      setShowIcdDropdown(true);
    } catch {
      // silent fail
    } finally {
      setIcdSearching(false);
    }
  }, []);

  const onIcdInputChange = (value: string) => {
    setIcdQuery(value);
    setForm({ ...form, icd10_code: '' }); // clear selection when typing
    if (icdDebounceRef.current) clearTimeout(icdDebounceRef.current);
    icdDebounceRef.current = setTimeout(() => handleIcdSearch(value), 300);
  };

  const selectIcd = (result: IcdResult) => {
    setForm({ ...form, icd10_code: result.code, description: form.description || result.description });
    setIcdQuery(`${result.code} - ${result.description}`);
    setShowIcdDropdown(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) {
      toast.error(t('toast.descriptionRequired', { defaultValue: 'Description is required' }));
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/clinical/problems', {
        method: 'POST',
        body: { patient_id: Number(patientId), ...form, status: 'active' },
      });
      toast.success(t('toast.problemAdded', { defaultValue: 'Problem added' }));
      setShowAdd(false);
      setForm({ description: '', icd10_code: '', severity: 'moderate', beg_date: new Date().toISOString().split('T')[0], comments: '' });
      setIcdQuery('');
      fetchProblems();
    } catch {
      toast.error(t('toast.problemAddFailed', { defaultValue: 'Failed to add problem' }));
    } finally {
      setSaving(false);
    }
  };

  const handleResolve = async (id: number) => {
    try {
      await apiFetch(`/api/clinical/problems/${id}/resolve`, { method: 'PUT', body: {} });
      toast.success(t('toast.problemResolved', { defaultValue: 'Problem resolved' }));
      fetchProblems();
    } catch {
      toast.error(t('toast.problemResolveFailed', { defaultValue: 'Failed to resolve problem' }));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('problemList.confirmDelete', { defaultValue: 'Delete this problem?' }))) return;
    try {
      await apiFetch(`/api/clinical/problems/${id}`, { method: 'DELETE' });
      toast.success(t('toast.problemDeleted', { defaultValue: 'Problem deleted' }));
      fetchProblems();
    } catch {
      toast.error(t('toast.problemDeleteFailed', { defaultValue: 'Failed to delete problem' }));
    }
  };

  const filteredProblems = statusFilter === 'all'
    ? problems
    : problems.filter(p => p.status === statusFilter);

  const activeCount = problems.filter(p => p.status === 'active').length;
  const resolvedCount = problems.filter(p => p.status === 'resolved').length;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="section-title flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-[var(--color-primary)]" />
          {t('problems.title', { defaultValue: 'Problem List' })}
          {activeCount > 0 && (
            <span className="badge bg-blue-100 text-blue-700 ml-1">{activeCount} {t('problems.active', { defaultValue: 'active' })}</span>
          )}
        </h3>
        <div className="flex gap-2">
          <button onClick={fetchProblems} className="btn-ghost" title={t('common.refresh', { defaultValue: 'Refresh' })} aria-label={t('common.refresh', { defaultValue: 'Refresh' })}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('problems.add', { defaultValue: 'Add Problem' })}
          </button>
        </div>
      </div>

      {/* Status Filter */}
      <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        {(['active', 'resolved', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize ${
              statusFilter === s
                ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            {t(`problems.status${s.charAt(0).toUpperCase()}${s.slice(1)}`, { defaultValue: s })}
            {s === 'active' && activeCount > 0 && ` (${activeCount})`}
            {s === 'resolved' && resolvedCount > 0 && ` (${resolvedCount})`}
          </button>
        ))}
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-3">{t('problems.new', { defaultValue: 'Add New Problem' })}</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <label className="label">{t('problems.icd10', { defaultValue: 'ICD-10 Code' })}</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                  ref={icdInputRef}
                  type="text"
                  value={icdQuery}
                  onChange={e => onIcdInputChange(e.target.value)}
                  onFocus={() => { if (icdResults.length > 0) setShowIcdDropdown(true); }}
                  onBlur={() => { setTimeout(() => setShowIcdDropdown(false), 200); }}
                  className="input pl-9"
                  placeholder={t('problems.icd10Placeholder', { defaultValue: 'Search ICD-10...' })}
                />
                {icdSearching && <div className="absolute right-2.5 top-2.5 w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />}
              </div>
              {showIcdDropdown && icdResults.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {icdResults.map(r => (
                    <button
                      key={r.code}
                      type="button"
                      onMouseDown={() => selectIcd(r)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm border-b border-gray-100 dark:border-gray-700 last:border-0"
                    >
                      <span className="font-mono font-medium text-[var(--color-primary)]">{r.code}</span>
                      <span className="text-[var(--color-text-muted)] ml-2">{r.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="label">{t('problems.description', { defaultValue: 'Description' })} *</label>
              <input
                type="text"
                required
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="input"
                placeholder={t('placeholders.problemDescription', { defaultValue: 'Problem description' })}
              />
            </div>
            <div>
              <label className="label">{t('problems.severity', { defaultValue: 'Severity' })}</label>
              <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value as 'mild' | 'moderate' | 'severe' })} className="input">
                <option value="mild">{t('problems.mild', { defaultValue: 'Mild' })}</option>
                <option value="moderate">{t('problems.moderate', { defaultValue: 'Moderate' })}</option>
                <option value="severe">{t('problems.severe', { defaultValue: 'Severe' })}</option>
              </select>
            </div>
            <div>
              <label className="label">{t('problems.onsetDate', { defaultValue: 'Onset Date' })}</label>
              <input type="date" value={form.beg_date} onChange={e => setForm({ ...form, beg_date: e.target.value })} className="input" />
            </div>
            <div className="md:col-span-2">
              <label className="label">{t('problems.comments', { defaultValue: 'Comments' })}</label>
              <input type="text" value={form.comments} onChange={e => setForm({ ...form, comments: e.target.value })} className="input" placeholder={t('placeholders.additionalNotes', { defaultValue: 'Additional notes...' })} />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => { setShowAdd(false); setIcdQuery(''); }} className="btn-ghost">{t('common.cancel', { defaultValue: 'Cancel' })}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving', { defaultValue: 'Saving...' }) : t('problems.save', { defaultValue: 'Save Problem' })}</button>
            </div>
          </form>
        </div>
      )}

      {/* Problems Table */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t('problems.description', { defaultValue: 'Description' })}</th>
              <th>{t('problems.icd10', { defaultValue: 'ICD-10' })}</th>
              <th>{t('problems.severity', { defaultValue: 'Severity' })}</th>
              <th>{t('problems.status', { defaultValue: 'Status' })}</th>
              <th>{t('problems.onsetDate', { defaultValue: 'Onset' })}</th>
              <th className="text-right">{t('common.actions', { defaultValue: 'Actions' })}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-4 text-gray-500">{t('common.loading', { defaultValue: 'Loading...' })}</td></tr>
            ) : filteredProblems.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-500">{t('problems.none', { defaultValue: 'No problems recorded' })}</td></tr>
            ) : (
              filteredProblems.map(p => (
                <tr key={p.id}>
                  <td className="font-medium">
                    {p.description}
                    {p.comments && <div className="text-xs text-gray-500 font-normal mt-0.5">{p.comments}</div>}
                  </td>
                  <td className="font-mono text-xs">{p.icd10_code || '\u2014'}</td>
                  <td>
                    <span className={`badge ${SEVERITY_STYLES[p.severity || 'moderate']}`}>
                      {t(`problems.${p.severity}`, { defaultValue: p.severity || 'moderate' })}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${
                      p.status === 'active' ? 'bg-blue-100 text-blue-700' :
                      p.status === 'resolved' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="text-xs text-[var(--color-text-muted)]">
                    {p.beg_date ? new Date(p.beg_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014'}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {p.status === 'active' && (
                        <button
                          onClick={() => handleResolve(p.id)}
                          className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded"
                          title={t('problems.resolve', { defaultValue: 'Resolve' })}
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="text-red-500 hover:bg-red-50 p-1.5 rounded"
                        title={t('common.delete', { defaultValue: 'Delete' })}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
