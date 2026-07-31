import { useState, useEffect } from 'react';
import { ShieldAlert, Plus, X, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

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

const SEVERITY_CFG = {
  severe:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  mild:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

const ALLERGY_TYPES = ['Drug', 'Food', 'Environmental', 'Contact', 'Insect', 'Latex', 'Other'];

export default function AllergiesPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();

  const [patientId, setPatientId]     = useState('');
  const [filterInput, setFilterInput] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    patient_id: '', allergen: '', allergy_type: 'Drug',
    severity: 'moderate', reaction: '', notes: '',
  });

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowAdd(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  /* ── Fetch allergies ─────────────────────────────────────────────────── */
  const { data, isLoading: loading } = useApiQuery<{ allergies: Allergy[] }>(
    queryKeys.allergies.list(patientId),
    `/api/allergies?patient_id=${patientId}`,
    { enabled: !!patientId },
  );

  const allergies = data?.allergies ?? [];

  /* ── Add allergy mutation ────────────────────────────────────────────── */
  const addMutation = useApiMutation<unknown, {
    patient_id: number;
    allergen: string;
    allergy_type: string;
    severity: string;
    reaction?: string;
    notes?: string;
  }>('post', '/api/allergies', {
    onSuccess: () => {
      toast.success(t('allergies.allergyRecorded'));
      setShowAdd(false);
      setForm({ patient_id: '', allergen: '', allergy_type: 'Drug', severity: 'moderate', reaction: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.allergies.all });
    },
    onError: (err) => {
      toast.error(err.message || t('common.failed'));
    },
  });

  /* ── Delete allergy mutation ─────────────────────────────────────────── */
  const deleteMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => `/api/allergies/${id}`,
    {
      onSuccess: () => {
        toast.success(t('patients.allergy_removed'));
        queryClient.invalidateQueries({ queryKey: queryKeys.allergies.all });
      },
      onError: () => {
        toast.error(t('patients.failed_to_remove'));
      },
    },
  );

  /* ── Handlers ────────────────────────────────────────────────────────── */
  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate({
      patient_id: parseInt(form.patient_id),
      allergen: form.allergen,
      allergy_type: form.allergy_type,
      severity: form.severity,
      reaction: form.reaction || undefined,
      notes: form.notes || undefined,
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm('Remove this allergy record?')) return;
    deleteMutation.mutate(id);
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
              <p className="section-subtitle">{t('allergyRecordsSubtitle', { ns: 'nursing' })}</p>
            </div>
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('addAllergy', { ns: 'nursing' })}</button>
        </div>

        {/* Summary badges */}
        {allergies.length > 0 && (
          <div className="flex gap-3 flex-wrap">
            <div className="card p-3 flex items-center gap-2 text-sm">
              <span className="font-medium">{t('total', { ns: 'nursing' })}:</span>
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
            placeholder={t("allergyForm.filterByPatientId", { defaultValue: "Filter by Patient ID..." })}
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60] backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
              <h3 className="font-semibold">Add Allergy Record</h3>
              <button onClick={() => setShowAdd(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAdd} className="p-5 space-y-4">
              <div><label className="label">{t('allergyForm.patientIdRequired', { defaultValue: 'Patient ID (Required)' })}</label><input className="input" type="number" required value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} /></div>
              <div><label className="label">{t('allergyForm.allergenRequired', { defaultValue: 'Allergen (Required)' })}</label><input className="input" required placeholder={t("allergyForm.allergenExample", { defaultValue: "e.g. Penicillin, Peanuts" })} value={form.allergen} onChange={e => setForm(f => ({ ...f, allergen: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('allergyForm.type', { defaultValue: 'Allergy Type' })}</label>
                  <select className="input" value={form.allergy_type} onChange={e => setForm(f => ({ ...f, allergy_type: e.target.value }))}>
                    {ALLERGY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('allergyForm.severity', { defaultValue: 'Severity' })}</label>
                  <select className="input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                    <option value="mild">{t('mild', { ns: 'nursing' })}</option>
                    <option value="moderate">{t('moderate', { ns: 'nursing' })}</option>
                    <option value="severe">{t('severe', { ns: 'nursing' })}</option>
                  </select>
                </div>
              </div>
              <div><label className="label">{t('allergyForm.reactionSymptoms', { defaultValue: 'Reaction / Symptoms' })}</label><input className="input" placeholder={t("allergyForm.reactionExample", { defaultValue: "e.g. Rash, Hives, Anaphylaxis" })} value={form.reaction} onChange={e => setForm(f => ({ ...f, reaction: e.target.value }))} /></div>
              <div><label className="label">{t('allergyForm.notes', { defaultValue: 'Additional Notes' })}</label><textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={addMutation.isPending} className="btn-primary">{addMutation.isPending ? t('saving', { ns: 'nursing' }) : t('addAllergy', { ns: 'nursing' })}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
