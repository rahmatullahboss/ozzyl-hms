import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, AlertTriangle, ShieldCheck, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

interface Allergy {
  id: number;
  patient_id: number;
  allergen: string;
  allergy_type: string;
  severity: 'mild' | 'moderate' | 'severe';
  reaction?: string;
  notes?: string;
  verified: boolean;
  verified_by?: string;
  verified_at?: string;
  created_at: string;
}

interface AllergiesResponse {
  allergies?: Allergy[];
}

const SEVERITY_STYLES: Record<string, string> = {
  mild: 'bg-yellow-100 text-yellow-700',
  moderate: 'bg-orange-100 text-orange-700',
  severe: 'bg-red-100 text-red-700',
};

const TYPE_LABELS: Record<string, string> = {
  drug: 'Drug',
  food: 'Food',
  environmental: 'Environmental',
  other: 'Other',
};

export default function AllergyPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation(['clinical', 'common']);
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    allergen: '',
    allergy_type: 'drug',
    severity: 'moderate' as 'mild' | 'moderate' | 'severe',
    reaction: '',
    notes: '',
  });

  const fetchAllergies = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<AllergiesResponse>(`/api/clinical/allergies?patientId=${patientId}`);
      setAllergies(data.allergies || []);
    } catch {
      toast.error(t('toast.allergyLoadFailed', { defaultValue: 'Failed to load allergies' }));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) fetchAllergies();
  }, [fetchAllergies, patientId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.allergen.trim()) {
      toast.error(t('toast.allergenRequired', { defaultValue: 'Allergen is required' }));
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/clinical/allergies', {
        method: 'POST',
        body: { patient_id: Number(patientId), ...form },
      });
      toast.success(t('toast.allergyAdded', { defaultValue: 'Allergy recorded' }));
      setShowAdd(false);
      setForm({ allergen: '', allergy_type: 'drug', severity: 'moderate', reaction: '', notes: '' });
      fetchAllergies();
    } catch {
      toast.error(t('toast.allergyAddFailed', { defaultValue: 'Failed to add allergy' }));
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async (id: number) => {
    try {
      await apiFetch(`/api/clinical/allergies/${id}/verify`, { method: 'PUT', body: {} });
      toast.success(t('toast.allergyVerified', { defaultValue: 'Allergy verified' }));
      fetchAllergies();
    } catch {
      toast.error(t('toast.allergyVerifyFailed', { defaultValue: 'Failed to verify allergy' }));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('allergy.confirmDelete', { defaultValue: 'Delete this allergy record?' }))) return;
    try {
      await apiFetch(`/api/clinical/allergies/${id}`, { method: 'DELETE' });
      toast.success(t('toast.allergyDeleted', { defaultValue: 'Allergy deleted' }));
      fetchAllergies();
    } catch {
      toast.error(t('toast.allergyDeleteFailed', { defaultValue: 'Failed to delete allergy' }));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="section-title flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          {t('allergy.title', { defaultValue: 'Allergies' })}
          {allergies.length > 0 && (
            <span className="badge bg-amber-100 text-amber-700 ml-1">{allergies.length}</span>
          )}
        </h3>
        <div className="flex gap-2">
          <button onClick={fetchAllergies} className="btn-ghost" title={t('common.refresh', { defaultValue: 'Refresh' })} aria-label={t('common.refresh', { defaultValue: 'Refresh' })}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('allergy.add', { defaultValue: 'Add Allergy' })}
          </button>
        </div>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="card p-4 border border-amber-100 dark:border-amber-900/30 bg-amber-50/50 dark:bg-amber-900/10">
          <h3 className="font-medium text-amber-900 dark:text-amber-300 mb-3">{t('allergy.new', { defaultValue: 'Record New Allergy' })}</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('allergy.allergen', { defaultValue: 'Allergen' })} *</label>
              <input
                type="text"
                required
                value={form.allergen}
                onChange={e => setForm({ ...form, allergen: e.target.value })}
                className="input"
                placeholder={t('allergy.allergenPlaceholder', { defaultValue: 'e.g., Penicillin, Peanuts, Dust' })}
              />
            </div>
            <div>
              <label className="label">{t('allergy.type', { defaultValue: 'Type' })}</label>
              <select value={form.allergy_type} onChange={e => setForm({ ...form, allergy_type: e.target.value })} className="input">
                {Object.entries(TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('allergy.severity', { defaultValue: 'Severity' })}</label>
              <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value as 'mild' | 'moderate' | 'severe' })} className="input">
                <option value="mild">{t('allergy.mild', { defaultValue: 'Mild' })}</option>
                <option value="moderate">{t('allergy.moderate', { defaultValue: 'Moderate' })}</option>
                <option value="severe">{t('allergy.severe', { defaultValue: 'Severe' })}</option>
              </select>
            </div>
            <div>
              <label className="label">{t('allergy.reaction', { defaultValue: 'Reaction' })}</label>
              <input
                type="text"
                value={form.reaction}
                onChange={e => setForm({ ...form, reaction: e.target.value })}
                className="input"
                placeholder={t('allergy.reactionPlaceholder', { defaultValue: 'e.g., Rash, Anaphylaxis' })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">{t('allergy.notes', { defaultValue: 'Notes' })}</label>
              <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input" placeholder={t('allergy.notesPlaceholder', { defaultValue: 'Additional details...' })} />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">{t('common.cancel', { defaultValue: 'Cancel' })}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving', { defaultValue: 'Saving...' }) : t('allergy.save', { defaultValue: 'Save Allergy' })}</button>
            </div>
          </form>
        </div>
      )}

      {/* Allergy List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="skeleton h-16 w-full rounded-lg" />)}
        </div>
      ) : allergies.length === 0 ? (
        <div className="card p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
          <p className="text-[var(--color-text-muted)]">{t('allergy.none', { defaultValue: 'No allergies recorded' })}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allergies.map(a => (
            <div key={a.id} className="card p-4 flex items-start gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                a.severity === 'severe' ? 'bg-red-100 text-red-600' :
                a.severity === 'moderate' ? 'bg-orange-100 text-orange-600' :
                'bg-yellow-100 text-yellow-600'
              }`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{a.allergen}</p>
                  <span className={`badge ${SEVERITY_STYLES[a.severity]}`}>{a.severity}</span>
                  <span className="badge bg-gray-100 text-gray-600">{TYPE_LABELS[a.allergy_type] || a.allergy_type}</span>
                  {a.verified && (
                    <span className="badge bg-emerald-100 text-emerald-700 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> {t('allergy.verified', { defaultValue: 'Verified' })}
                    </span>
                  )}
                </div>
                {a.reaction && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('allergy.reaction', { defaultValue: 'Reaction' })}: {a.reaction}</p>
                )}
                {a.notes && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{a.notes}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!a.verified && (
                  <button
                    onClick={() => handleVerify(a.id)}
                    className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded"
                    title={t('allergy.verify', { defaultValue: 'Verify' })}
                  >
                    <ShieldCheck className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => handleDelete(a.id)}
                  className="text-red-500 hover:bg-red-50 p-1.5 rounded"
                  title={t('common.delete', { defaultValue: 'Delete' })}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
