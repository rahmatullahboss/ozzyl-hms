import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { authHeader } from '../../utils/auth';

interface Glucose {
  id: number;
  patient_id: number;
  sugar_value: string;
  unit: string;
  bsl_type: 'Random' | 'Fasting' | 'PP';
  measurement_time: string;
  created_at: string;
}

export default function GlucoseTab({ patientId }: { patientId: number }) {
  const { t } = useTranslation(['clinical']);
  const [readings, setReadings] = useState<Glucose[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    sugar_value: '',
    unit: 'mg/dL',
    bsl_type: 'Random' as const,
    measurement_time: new Date().toISOString().slice(0, 16),
  });

  const fetchReadings = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/clinical/glucose?patientId=${patientId}`, { headers: authHeader() });
      setReadings(data.glucose || []);
    } catch {
      toast.error(t('toast.glucoseLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) fetchReadings();
  }, [fetchReadings, patientId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.post('/api/clinical/glucose', {
        patient_id: patientId,
        ...form
      }, { headers: authHeader() });
      toast.success(t('toast.glucoseAdded'));
      setShowAdd(false);
      setForm({
        sugar_value: '',
        unit: 'mg/dL',
        bsl_type: 'Random',
        measurement_time: new Date().toISOString().slice(0, 16),
      });
      fetchReadings();
    } catch (err) {
      toast.error(t('toast.glucoseAddFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('glucose.confirmDelete'))) return;
    try {
      await axios.delete(`/api/clinical/glucose/${id}`, { headers: authHeader() });
      toast.success(t('toast.glucoseDeleted'));
      fetchReadings();
    } catch {
      toast.error(t('toast.glucoseDeleteFailed'));
    }
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'Random': return 'bg-blue-100 text-blue-700';
      case 'Fasting': return 'bg-amber-100 text-amber-700';
      case 'PP': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('glucose.title')}</h2>
        <div className="flex gap-2">
          <button onClick={fetchReadings} className="btn-ghost" title={t('common.refresh')}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('glucose.add')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10 mb-4">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-3">{t('glucose.new')}</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="label">{t('glucose.value')} {t('common.required')}</label>
              <input type="number" step="0.1" required value={form.sugar_value} onChange={e => setForm({ ...form, sugar_value: e.target.value })} className="input" placeholder={t('placeholders.glucoseValue')} />
            </div>
            <div>
              <label className="label">{t('glucose.unit')}</label>
              <select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="input">
                <option value="mg/dL">{t('glucose.units.mgdl')}</option>
                <option value="mmol/L">{t('glucose.units.mmol')}</option>
              </select>
            </div>
            <div>
              <label className="label">{t('glucose.type')}</label>
              <select value={form.bsl_type} onChange={e => setForm({ ...form, bsl_type: e.target.value as any })} className="input">
                <option value="Random">{t('glucose.types.random')}</option>
                <option value="Fasting">{t('glucose.types.fasting')}</option>
                <option value="PP">{t('glucose.types.pp')}</option>
              </select>
            </div>
            <div>
              <label className="label">{t('glucose.time')} {t('common.required')}</label>
              <input type="datetime-local" required value={form.measurement_time} onChange={e => setForm({ ...form, measurement_time: e.target.value })} className="input" />
            </div>
            <div className="md:col-span-4 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">{t('common.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('glucose.save')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t('glucose.time')}</th>
              <th>{t('glucose.value')}</th>
              <th>{t('glucose.unit')}</th>
              <th>{t('glucose.type')}</th>
              <th className="text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-4 text-gray-500">{t('common.loading')}</td></tr>
            ) : readings.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-500">{t('glucose.none')}</td></tr>
            ) : (
              readings.map(r => (
                <tr key={r.id}>
                  <td>{new Date(r.measurement_time || r.created_at).toLocaleString()}</td>
                  <td className="font-bold text-gray-900 dark:text-white text-lg">{r.sugar_value}</td>
                  <td className="text-gray-500">{r.unit}</td>
                  <td>
                    <span className={`badge ${getTypeBadgeColor(r.bsl_type)}`}>
                      {t(`glucose.types.${r.bsl_type.toLowerCase()}`) || r.bsl_type}
                    </span>
                  </td>
                  <td className="text-right">
                    <button onClick={() => handleDelete(r.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded" title={t('common.delete')}>
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
