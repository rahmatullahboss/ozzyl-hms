import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

interface Diet {
  id: number;
  patient_id: number;
  diet_name: string;
  quantity: string;
  unit: string;
  feeding_time: string;
  remarks?: string;
  created_at: string;
}

export default function DietTab({ patientId }: { patientId: number }) {
  const { t } = useTranslation(['clinical']);
  const [diets, setDiets] = useState<Diet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    diet_name: '',
    quantity: '',
    unit: '',
    feeding_time: '',
    remarks: '',
  });

  const fetchDiets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ diets?: Diet[] }>(`/api/clinical/diet?patientId=${patientId}`);
      setDiets(data.diets || []);
    } catch {
      toast.error(t('toast.dietLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) fetchDiets();
  }, [fetchDiets, patientId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/clinical/diet', {
        method: 'POST',
        body: { patient_id: patientId, ...form },
      });
      toast.success(t('toast.dietAdded'));
      setShowAdd(false);
      setForm({ diet_name: '', quantity: '', unit: '', feeding_time: '', remarks: '' });
      fetchDiets();
    } catch (err) {
      toast.error(t('toast.dietAddFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('diet.confirmDelete'))) return;
    try {
      await apiFetch(`/api/clinical/diet/${id}`, { method: 'DELETE' });
      toast.success(t('toast.dietDeleted'));
      fetchDiets();
    } catch {
      toast.error(t('toast.dietDeleteFailed'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('diet.title')}</h2>
        <div className="flex gap-2">
          <button onClick={fetchDiets} className="btn-ghost" title={t('common.refresh')} aria-label={t('common.refresh')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('diet.add')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10 mb-4">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-3">{t('diet.new')}</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="label">{t('diet.name')} {t('common.required')}</label>
              <input type="text" required value={form.diet_name} onChange={e => setForm({ ...form, diet_name: e.target.value })} className="input" placeholder={t('placeholders.dietName')} />
            </div>
            <div>
              <label className="label">{t('diet.quantity')}</label>
              <input type="text" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="input" placeholder={t('placeholders.quantity')} />
            </div>
            <div>
              <label className="label">{t('diet.unit')}</label>
              <input type="text" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="input" placeholder={t('placeholders.unit')} />
            </div>
            <div className="md:col-span-2">
              <label className="label">{t('diet.time')}</label>
              <input type="text" value={form.feeding_time} onChange={e => setForm({ ...form, feeding_time: e.target.value })} className="input" placeholder={t('placeholders.feedingTime')} />
            </div>
            <div className="md:col-span-2">
              <label className="label">{t('diet.remarks')}</label>
              <input type="text" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} className="input" placeholder={t('placeholders.anyNotes')} />
            </div>
            <div className="md:col-span-4 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">{t('common.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('diet.save')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t('diet.name')}</th>
              <th>{t('diet.quantity')}</th>
              <th>{t('diet.unit')}</th>
              <th>{t('diet.time')}</th>
              <th>{t('diet.remarks')}</th>
              <th className="text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-4 text-gray-500">{t('common.loading')}</td></tr>
            ) : diets.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-500">{t('diet.none')}</td></tr>
            ) : (
              diets.map(d => (
                <tr key={d.id}>
                  <td className="font-medium text-gray-900 dark:text-white">{d.diet_name}</td>
                  <td>{d.quantity || '-'}</td>
                  <td>{d.unit || '-'}</td>
                  <td>{d.feeding_time || '-'}</td>
                  <td>{d.remarks || '-'}</td>
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
