import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, Plus, X, Trash2 } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';

interface Allergy {
  id: number;
  patient_name?: string;
  patient_code?: string;
  allergen: string;
  allergy_type?: string;
  severity?: 'mild' | 'moderate' | 'severe';
  reaction?: string;
  notes?: string;
  created_at: string;
}

import { authHeader } from '../utils/auth';

const SEVERITY_CFG = {
  severe:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  mild:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

const ALLERGY_TYPES = ['Drug', 'Food', 'Environmental', 'Contact', 'Insect', 'Latex', 'Other'];

export default function AllergiesPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['nursing', 'common']);
  const [allergies, setAllergies]   = useState<Allergy[]>([]);
  const [loading, setLoading]       = useState(true);
  const [patientId, setPatientId]   = useState('');
  const [filterInput, setFilterInput] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm] = useState({
    patient_id: '', allergen: '', allergy_type: 'Drug',
    severity: 'moderate', reaction: '', notes: '',
  });

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowAdd(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const fetchAllergies = useCallback(async () => {
    if (!patientId) {
      setAllergies([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, string> = { patient_id: patientId };
      const { data } = await axios.get('/api/allergies', { params, headers: authHeader() });
      setAllergies(data.allergies ?? []);
    } catch { setAllergies([]); } finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { fetchAllergies(); }, [fetchAllergies]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/allergies', {
        patient_id: parseInt(form.patient_id),
        allergen: form.allergen,
        allergy_type: form.allergy_type,
        severity: form.severity,
        reaction: form.reaction || undefined,
        notes: form.notes || undefined,
      }, { headers: authHeader() });
      toast.success(t('allergies.allergyRecorded'));
      setShowAdd(false);
      setForm({ patient_id: '', allergen: '', allergy_type: 'Drug', severity: 'moderate', reaction: '', notes: '' });
      fetchAllergies();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? t('common.failed') : t('common.failed'));
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this allergy record?')) return;
    try {
      await axios.delete(`/api/allergies/${id}`, { headers: authHeader() });
      toast.success(t('patients.allergy_removed'));
      fetchAllergies();
    } catch { toast.error(t('patients.failed_to_remove')); }
  };

  const severeCount   = allergies.filter(a => a.severity === 'severe').length;
  const moderateCount = allergies.filter(a => a.severity === 'moderate').length;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('allergies', { ns: 'nursing' })}</h1>
              <p className="section-subtitle">Patient allergy records &amp; alerts</p>
            </div>
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('addAllergy', { ns: 'nursing' })}</button>
        </div>

        {/* Summary badges */}
        {allergies.length > 0 && (
          <div className="flex gap-3 flex-wrap">
            <div className="card p-3 flex items-center gap-2 text-sm">
              <span className="font-medium">Total:</span>
              <span className="font-bold font-data">{allergies.length}</span>
            </div>
            {severeCount > 0 && (
              <div className={`card p-3 flex items-center gap-2 text-sm ${SEVERITY_CFG.severe}`}>
                <ShieldAlert className="w-4 h-4" />
                <span className="font-bold">{severeCount} {t('severe', { ns: 'nursing' })}</span>
              </div>
            )}
            {moderateCount > 0 && (
              <div className={`card p-3 flex items-center gap-2 text-sm ${SEVERITY_CFG.moderate}`}>
                <span className="font-bold">{moderateCount} {t('moderate', { ns: 'nursing' })}</span>
              </div>
            )}
          </div>
        )}

        {/* Patient filter */}
        <div className="card p-3 flex gap-3 items-center">
          <input
            type="number"
            placeholder={t("allergies.filterByPatientId")}
            value={filterInput}
            onChange={e => setFilterInput(e.target.value)}
            className="input w-52"
          />
          <button onClick={() => setPatientId(filterInput)} className="btn-secondary">{t('filter', { ns: 'common' })}</button>
          {patientId && <button onClick={() => { setPatientId(''); setFilterInput(''); }} className="btn-ghost text-sm">{t('clear', { ns: 'common' })}</button>}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Patient</th><th>Allergen</th><th>Type</th><th>Severity</th><th>Reaction</th><th>Recorded</th><th>Actions</th></tr></thead>
              <tbody>
                {loading
                  ? [...Array(5)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  : allergies.length === 0
                  ? <tr><td colSpan={7}><EmptyState icon={<ShieldAlert className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noAllergies', { ns: 'nursing' })} description="No allergies found for the current filter." action={<button onClick={() => setShowAdd(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> {t('addAllergy', { ns: 'nursing' })}</button>} /></td></tr>
                  : allergies.map(a => (
                      <tr key={a.id}>
                        <td>
                          <p className="font-medium">{a.patient_name ?? '—'}</p>
                          {a.patient_code && <p className="text-xs text-[var(--color-text-muted)]">{a.patient_code}</p>}
                        </td>
                        <td className="font-medium">{a.allergen}</td>
                        <td>{a.allergy_type ?? '—'}</td>
                        <td>
                          {a.severity
                            ? <span className={`badge ${SEVERITY_CFG[a.severity]}`}>{a.severity}</span>
                            : '—'}
                        </td>
                        <td className="text-[var(--color-text-secondary)] max-w-xs truncate">{a.reaction ?? '—'}</td>
                        <td className="font-data text-sm">{a.created_at?.split('T')[0]}</td>
                        <td>
                          <button onClick={() => handleDelete(a.id)} className="btn-ghost p-1.5 text-red-500" title="Remove">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
              <h3 className="font-semibold">Add Allergy Record</h3>
              <button onClick={() => setShowAdd(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAdd} className="p-5 space-y-4">
              <div><label className="label">{t('allergies.patientIdRequired')}</label><input className="input" type="number" required value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} /></div>
              <div><label className="label">{t('allergies.allergenRequired')}</label><input className="input" required placeholder={t("allergies.allergenExample")} value={form.allergen} onChange={e => setForm(f => ({ ...f, allergen: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('allergies.type')}</label>
                  <select className="input" value={form.allergy_type} onChange={e => setForm(f => ({ ...f, allergy_type: e.target.value }))}>
                    {ALLERGY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('allergies.severity')}</label>
                  <select className="input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                    <option value="mild">{t('mild', { ns: 'nursing' })}</option>
                    <option value="moderate">{t('moderate', { ns: 'nursing' })}</option>
                    <option value="severe">{t('severe', { ns: 'nursing' })}</option>
                  </select>
                </div>
              </div>
              <div><label className="label">{t('allergies.reactionSymptoms')}</label><input className="input" placeholder={t("allergies.reactionExample")} value={form.reaction} onChange={e => setForm(f => ({ ...f, reaction: e.target.value }))} /></div>
              <div><label className="label">{t('allergies.notes')}</label><textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('saving', { ns: 'nursing' }) : t('addAllergy', { ns: 'nursing' })}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
