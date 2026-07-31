import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, CheckCircle, RefreshCw } from 'lucide-react';
import { authHeader } from '../../utils/auth';

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

export default function ProblemListTab({ patientId }: { patientId: number }) {
  const { t } = useTranslation(['clinical']);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    description: '',
    icd10_code: '',
    severity: 'moderate',
    status: 'active',
    beg_date: new Date().toISOString().split('T')[0],
    comments: '',
  });

  const fetchProblems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/clinical/problems?patientId=${patientId}`, { headers: authHeader() });
      setProblems(data.problems || []);
    } catch {
      toast.error(t('toast.problemLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) fetchProblems();
  }, [fetchProblems, patientId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.post('/api/clinical/problems', {
        patient_id: patientId,
        ...form
      }, { headers: authHeader() });
      toast.success(t('toast.problemAdded'));
      setShowAdd(false);
      setForm({
        description: '', icd10_code: '', severity: 'moderate', status: 'active',
        beg_date: new Date().toISOString().split('T')[0], comments: ''
      });
      fetchProblems();
    } catch (err) {
      toast.error(t('toast.problemAddFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleResolve = async (id: number) => {
    try {
      await axios.put(`/api/clinical/problems/${id}/resolve`, {}, { headers: authHeader() });
      toast.success(t('toast.problemResolved'));
      fetchProblems();
    } catch {
      toast.error(t('toast.problemResolveFailed'));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('problemList.confirmDelete'))) return;
    try {
      await axios.delete(`/api/clinical/problems/${id}`, { headers: authHeader() });
      toast.success(t('toast.problemDeleted'));
      fetchProblems();
    } catch {
      toast.error(t('toast.problemDeleteFailed'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('problems.active')}</h2>
        <div className="flex gap-2">
          <button onClick={fetchProblems} className="btn-ghost" title={t('common.refresh')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('problems.add')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10 mb-4">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-3">{t('problems.new')}</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('problems.description')} {t('common.required')}</label>
              <input type="text" required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="input" placeholder={t('placeholders.problemDescription')} />
            </div>
            <div>
              <label className="label">{t('problems.icd10')}</label>
              <input type="text" value={form.icd10_code} onChange={e => setForm({ ...form, icd10_code: e.target.value })} className="input" placeholder={t('placeholders.icd10Code')} />
            </div>
            <div>
              <label className="label">{t('problems.severity')}</label>
              <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value as any })} className="input">
                <option value="mild">{t('problems.mild')}</option>
                <option value="moderate">{t('problems.moderate')}</option>
                <option value="severe">{t('problems.severe')}</option>
              </select>
            </div>
            <div>
              <label className="label">{t('problems.onsetDate')}</label>
              <input type="date" value={form.beg_date} onChange={e => setForm({ ...form, beg_date: e.target.value })} className="input" />
            </div>
            <div className="md:col-span-2">
              <label className="label">{t('problems.comments')}</label>
              <input type="text" value={form.comments} onChange={e => setForm({ ...form, comments: e.target.value })} className="input" placeholder={t('placeholders.additionalNotes')} />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">{t('common.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('problems.save')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t('problems.description')}</th>
              <th>{t('problems.icd10')}</th>
              <th>{t('problems.severity')}</th>
              <th>{t('problems.status')}</th>
              <th>{t('problems.onsetDate')}</th>
              <th className="text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-4 text-gray-500">{t('common.loading')}</td></tr>
            ) : problems.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-500">{t('problems.none')}</td></tr>
            ) : (
              problems.map(p => (
                <tr key={p.id}>
                  <td className="font-medium">{p.description}
                    {p.comments && <div className="text-xs text-gray-500 font-normal mt-0.5">{p.comments}</div>}
                  </td>
                  <td>{p.icd10_code || '-'}</td>
                  <td>
                    <span className={`badge ${
                      p.severity === 'severe' ? 'bg-red-100 text-red-700' :
                      p.severity === 'mild' ? 'bg-green-100 text-green-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {t(`problems.${p.severity}`) || t('problems.moderate')}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${
                      p.status === 'active' ? 'bg-blue-100 text-blue-700' :
                      p.status === 'resolved' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {t(`problems.status${p.status.charAt(0).toUpperCase()}${p.status.slice(1)}`) || p.status}
                    </span>
                  </td>
                  <td>{p.beg_date ? new Date(p.beg_date).toLocaleDateString() : '-'}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {p.status === 'active' && (
                        <button onClick={() => handleResolve(p.id)} className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded" title={t('problems.resolve')}>
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded" title={t('common.delete')}>
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
