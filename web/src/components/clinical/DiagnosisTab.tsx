import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Search, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatDisplayDate } from '../../lib/date-utils';

interface Diagnosis {
  id: number;
  patient_id: number;
  icd10_code: string;
  description: string;
  diagnosis_type: 'primary' | 'secondary' | 'admitting' | 'discharge';
  created_at: string;
}

interface ICD10Search {
  code: string;
  description: string;
}

export default function DiagnosisTab({ patientId }: { patientId: number }) {
  const { t } = useTranslation(['clinical']);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ICD10Search[]>([]);
  const [searching, setSearching] = useState(false);

  const [form, setForm] = useState({
    icd10_code: '',
    description: '',
    diagnosis_type: 'primary' as const,
  });

  const fetchDiagnoses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ diagnoses?: Diagnosis[] }>(`/api/clinical/diagnosis?patientId=${patientId}`);
      setDiagnoses(data.diagnoses || []);
    } catch {
      toast.error(t('toast.diagnosisLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) fetchDiagnoses();
  }, [fetchDiagnoses, patientId]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        setSearching(true);
        try {
          const data = await apiFetch<{ results?: ICD10Search[] }>(`/api/clinical/diagnosis/icd10/search?q=${searchQuery}`);
          setSearchResults(data.results || []);
        } catch {
          console.error(t('toast.icd10SearchFailed'));
        } finally {
          setSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  const selectICD10 = (item: ICD10Search) => {
    setForm({ ...form, icd10_code: item.code, description: item.description });
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.icd10_code || !form.description) {
      toast.error(t('toast.codeAndDescriptionRequired'));
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/clinical/diagnosis', {
        method: 'POST',
        body: { patient_id: patientId, ...form },
      });
      toast.success(t('toast.diagnosisAdded'));
      setShowAdd(false);
      setForm({ icd10_code: '', description: '', diagnosis_type: 'primary' });
      fetchDiagnoses();
    } catch (err) {
      toast.error(t('toast.diagnosisAddFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('diagnosis.confirmDelete'))) return;
    try {
      await apiFetch(`/api/clinical/diagnosis/${id}`, { method: 'DELETE' });
      toast.success(t('toast.diagnosisDeleted'));
      fetchDiagnoses();
    } catch {
      toast.error(t('toast.diagnosisDeleteFailed'));
    }
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'primary': return 'bg-indigo-100 text-indigo-700';
      case 'admitting': return 'bg-amber-100 text-amber-700';
      case 'discharge': return 'bg-teal-100 text-teal-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('diagnosis.current')}</h2>
        <div className="flex gap-2">
          <button onClick={fetchDiagnoses} className="btn-ghost" title={t('common.refresh')} aria-label={t('common.refresh')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('diagnosis.add')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10 mb-4">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-3">{t('diagnosis.new')}</h3>
          <div className="mb-4 relative">
            <label className="label">{t('diagnosis.searchIcd10')}</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={t('diagnosis.searchPlaceholder')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="input pl-9"
              />
              {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">{t('common.loading')}</span>}
            </div>
            {searchResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {searchResults.map((res, i) => (
                  <div
                    key={i}
                    className="p-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer flex justify-between items-center border-b border-gray-100 dark:border-gray-800 last:border-0"
                    onClick={() => selectICD10(res)}
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">{res.code}</span>
                    <span className="text-sm text-gray-600 dark:text-gray-400 text-right">{res.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">{t('diagnosis.icd10Code')} {t('common.required')}</label>
              <input type="text" required value={form.icd10_code} onChange={e => setForm({ ...form, icd10_code: e.target.value })} className="input" />
            </div>
            <div className="md:col-span-2">
              <label className="label">{t('problems.description')} {t('common.required')}</label>
              <input type="text" required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">{t('diagnosis.type')}</label>
              <select value={form.diagnosis_type} onChange={e => setForm({ ...form, diagnosis_type: e.target.value as any })} className="input">
                <option value="primary">{t('diagnosis.primary')}</option>
                <option value="secondary">{t('diagnosis.secondary')}</option>
                <option value="admitting">{t('diagnosis.admitting')}</option>
                <option value="discharge">{t('diagnosis.discharge')}</option>
              </select>
            </div>
            <div className="md:col-span-3 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">{t('common.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('diagnosis.save')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t('diagnosis.icd10Code')}</th>
              <th>{t('problems.description')}</th>
              <th>{t('diagnosis.type')}</th>
              <th>{t('diagnosis.date')}</th>
              <th className="text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-4 text-gray-500">{t('common.loading')}</td></tr>
            ) : diagnoses.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-500">{t('diagnosis.none')}</td></tr>
            ) : (
              diagnoses.map(d => (
                <tr key={d.id}>
                  <td className="font-semibold text-gray-900 dark:text-white">{d.icd10_code}</td>
                  <td>{d.description}</td>
                  <td>
                    <span className={`badge ${getTypeBadgeColor(d.diagnosis_type)} capitalize`}>
                      {t(`diagnosis.${d.diagnosis_type}`) || d.diagnosis_type}
                    </span>
                  </td>
                  <td>{formatDisplayDate(d.created_at)}</td>
                  <td className="text-right">
                    <button onClick={() => handleDelete(d.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded" title={t('common.delete')}>
                      <Trash2 className="w-4 h-4" />
                    </button>
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
