import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Pill, Trash2, AlertTriangle, XCircle } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

interface Medication {
  id: number;
  patient_id: number;
  medication_name: string;
  generic_name?: string;
  strength?: string;
  dosage_form?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
  status: 'active' | 'discontinued';
  discontinue_reason?: string;
  start_date?: string;
  end_date?: string;
  prescribed_by?: string;
  created_at: string;
}

interface MedicationsResponse {
  medications?: Medication[];
}

export default function MedicationsPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation(['clinical', 'common']);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'active' | 'discontinued' | 'all'>('active');
  const [discontinueId, setDiscontinueId] = useState<number | null>(null);
  const [discontinueReason, setDiscontinueReason] = useState('');

  const [form, setForm] = useState({
    medication_name: '',
    generic_name: '',
    strength: '',
    dosage_form: '',
    dosage: '',
    frequency: '',
    duration: '',
    instructions: '',
  });

  const fetchMedications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<MedicationsResponse>(`/api/clinical/medications?patientId=${patientId}`);
      setMedications(data.medications || []);
    } catch {
      toast.error(t('toast.medicationLoadFailed', { defaultValue: 'Failed to load medications' }));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) fetchMedications();
  }, [fetchMedications, patientId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.medication_name.trim()) {
      toast.error(t('toast.medicationNameRequired', { defaultValue: 'Medication name is required' }));
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/clinical/medications', {
        method: 'POST',
        body: { patient_id: Number(patientId), ...form },
      });
      toast.success(t('toast.medicationAdded', { defaultValue: 'Medication added' }));
      setShowAdd(false);
      setForm({ medication_name: '', generic_name: '', strength: '', dosage_form: '', dosage: '', frequency: '', duration: '', instructions: '' });
      fetchMedications();
    } catch {
      toast.error(t('toast.medicationAddFailed', { defaultValue: 'Failed to add medication' }));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscontinue = async () => {
    if (!discontinueId) return;
    try {
      await apiFetch(`/api/clinical/medications/${discontinueId}/discontinue`, {
        method: 'PUT',
        body: { reason: discontinueReason },
      });
      toast.success(t('toast.medicationDiscontinued', { defaultValue: 'Medication discontinued' }));
      setDiscontinueId(null);
      setDiscontinueReason('');
      fetchMedications();
    } catch {
      toast.error(t('toast.medicationDiscontinueFailed', { defaultValue: 'Failed to discontinue medication' }));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('medications.confirmDelete', { defaultValue: 'Delete this medication record?' }))) return;
    try {
      await apiFetch(`/api/clinical/medications/${id}`, { method: 'DELETE' });
      toast.success(t('toast.medicationDeleted', { defaultValue: 'Medication deleted' }));
      fetchMedications();
    } catch {
      toast.error(t('toast.medicationDeleteFailed', { defaultValue: 'Failed to delete medication' }));
    }
  };

  const filteredMedications = statusFilter === 'all'
    ? medications
    : medications.filter(m => m.status === statusFilter);

  const activeCount = medications.filter(m => m.status === 'active').length;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="section-title flex items-center gap-2">
          <Pill className="w-4 h-4 text-[var(--color-primary)]" />
          {t('medications.title', { defaultValue: 'Medications' })}
          {activeCount > 0 && (
            <span className="badge bg-blue-100 text-blue-700 ml-1">{activeCount} {t('medications.active', { defaultValue: 'active' })}</span>
          )}
        </h3>
        <div className="flex gap-2">
          <button onClick={fetchMedications} className="btn-ghost" title={t('common.refresh', { defaultValue: 'Refresh' })} aria-label={t('common.refresh', { defaultValue: 'Refresh' })}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('medications.add', { defaultValue: 'Add Medication' })}
          </button>
        </div>
      </div>

      {/* Status Filter */}
      <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        {(['active', 'discontinued', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize ${
              statusFilter === s
                ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            {t(`medications.status${s.charAt(0).toUpperCase()}${s.slice(1)}`, { defaultValue: s })}
          </button>
        ))}
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="card p-4 border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10">
          <h3 className="font-medium text-indigo-900 dark:text-indigo-300 mb-3">{t('medications.new', { defaultValue: 'Add New Medication' })}</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('medications.medicationName', { defaultValue: 'Medication Name' })} *</label>
              <input
                type="text"
                required
                value={form.medication_name}
                onChange={e => setForm({ ...form, medication_name: e.target.value })}
                className="input"
                placeholder={t('medications.medicationNamePlaceholder', { defaultValue: 'e.g., Amoxicillin' })}
              />
            </div>
            <div>
              <label className="label">{t('medications.genericName', { defaultValue: 'Generic Name' })}</label>
              <input type="text" value={form.generic_name} onChange={e => setForm({ ...form, generic_name: e.target.value })} className="input" placeholder={t('medications.genericPlaceholder', { defaultValue: 'e.g., Amoxicillin trihydrate' })} />
            </div>
            <div>
              <label className="label">{t('medications.strength', { defaultValue: 'Strength' })}</label>
              <input type="text" value={form.strength} onChange={e => setForm({ ...form, strength: e.target.value })} className="input" placeholder="500mg" />
            </div>
            <div>
              <label className="label">{t('medications.dosageForm', { defaultValue: 'Dosage Form' })}</label>
              <select value={form.dosage_form} onChange={e => setForm({ ...form, dosage_form: e.target.value })} className="input">
                <option value="">{t('medications.selectForm', { defaultValue: 'Select form...' })}</option>
                <option value="tablet">Tablet</option>
                <option value="capsule">Capsule</option>
                <option value="syrup">Syrup</option>
                <option value="injection">Injection</option>
                <option value="cream">Cream/Ointment</option>
                <option value="drops">Drops</option>
                <option value="inhaler">Inhaler</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="label">{t('medications.dosage', { defaultValue: 'Dosage' })}</label>
              <input type="text" value={form.dosage} onChange={e => setForm({ ...form, dosage: e.target.value })} className="input" placeholder="1 tablet" />
            </div>
            <div>
              <label className="label">{t('medications.frequency', { defaultValue: 'Frequency' })}</label>
              <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} className="input">
                <option value="">{t('medications.selectFrequency', { defaultValue: 'Select frequency...' })}</option>
                <option value="once_daily">Once daily</option>
                <option value="twice_daily">Twice daily (BD)</option>
                <option value="three_times_daily">Three times daily (TDS)</option>
                <option value="four_times_daily">Four times daily (QID)</option>
                <option value="every_morning">Every morning</option>
                <option value="every_night">Every night</option>
                <option value="as_needed">As needed (PRN)</option>
                <option value="stat">Stat (one time)</option>
              </select>
            </div>
            <div>
              <label className="label">{t('medications.duration', { defaultValue: 'Duration' })}</label>
              <input type="text" value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} className="input" placeholder="7 days" />
            </div>
            <div>
              <label className="label">{t('medications.instructions', { defaultValue: 'Instructions' })}</label>
              <input type="text" value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} className="input" placeholder="After meals" />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">{t('common.cancel', { defaultValue: 'Cancel' })}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving', { defaultValue: 'Saving...' }) : t('medications.save', { defaultValue: 'Save Medication' })}</button>
            </div>
          </form>
        </div>
      )}

      {/* Discontinue Modal */}
      {discontinueId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="card p-6 w-full max-w-md space-y-3">
            <h4 className="font-semibold flex items-center gap-2">
              <XCircle className="w-5 h-5 text-amber-500" />
              {t('medications.discontinueTitle', { defaultValue: 'Discontinue Medication' })}
            </h4>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('medications.discontinueDesc', { defaultValue: 'Please provide a reason for discontinuing this medication.' })}
            </p>
            <textarea
              value={discontinueReason}
              onChange={e => setDiscontinueReason(e.target.value)}
              className="input w-full text-sm"
              rows={3}
              placeholder={t('medications.discontinueReasonPlaceholder', { defaultValue: 'Reason for discontinuation...' })}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDiscontinueId(null); setDiscontinueReason(''); }} className="btn btn-secondary text-sm">
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button onClick={handleDiscontinue} className="btn btn-primary text-sm bg-amber-600 hover:bg-amber-700">
                {t('medications.confirmDiscontinue', { defaultValue: 'Discontinue' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Medications Table */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t('medications.medication', { defaultValue: 'Medication' })}</th>
              <th>{t('medications.doseInfo', { defaultValue: 'Dose' })}</th>
              <th>{t('medications.frequency', { defaultValue: 'Frequency' })}</th>
              <th>{t('medications.duration', { defaultValue: 'Duration' })}</th>
              <th>{t('medications.status', { defaultValue: 'Status' })}</th>
              <th className="text-right">{t('common.actions', { defaultValue: 'Actions' })}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-4 text-gray-500">{t('common.loading', { defaultValue: 'Loading...' })}</td></tr>
            ) : filteredMedications.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-500">{t('medications.none', { defaultValue: 'No medications recorded' })}</td></tr>
            ) : (
              filteredMedications.map(m => (
                <tr key={m.id} className={m.status === 'discontinued' ? 'opacity-60' : ''}>
                  <td>
                    <div>
                      <p className="font-medium text-[var(--color-text)]">{m.medication_name}</p>
                      {m.generic_name && <p className="text-xs text-[var(--color-text-muted)]">{m.generic_name}</p>}
                      {m.instructions && <p className="text-xs text-blue-600 mt-0.5">{m.instructions}</p>}
                    </div>
                  </td>
                  <td>
                    <span className="text-sm">
                      {m.dosage || '\u2014'}
                      {m.strength && <span className="text-[var(--color-text-muted)] ml-1">({m.strength})</span>}
                    </span>
                    {m.dosage_form && <span className="text-xs text-[var(--color-text-muted)] block">{m.dosage_form}</span>}
                  </td>
                  <td className="text-sm capitalize">{m.frequency?.replace(/_/g, ' ') || '\u2014'}</td>
                  <td className="text-sm">{m.duration || '\u2014'}</td>
                  <td>
                    <span className={`badge ${
                      m.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {m.status}
                    </span>
                    {m.status === 'discontinued' && m.discontinue_reason && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{m.discontinue_reason}</p>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {m.status === 'active' && (
                        <button
                          onClick={() => setDiscontinueId(m.id)}
                          className="text-amber-600 hover:bg-amber-50 p-1.5 rounded"
                          title={t('medications.discontinue', { defaultValue: 'Discontinue' })}
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(m.id)}
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
