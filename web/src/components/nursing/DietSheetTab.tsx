import { useState, useEffect, useCallback } from 'react';
import { UtensilsCrossed, Plus, X, RefreshCw, History, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import EmptyState from '../dashboard/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DietType {
  id: number;
  diet_code: string;
  diet_name: string;
  display_order: number;
}

interface PatientDiet {
  id: number;
  patient_id: number;
  visit_id: number;
  diet_type_id: number;
  extra_diet: string | null;
  ward_id: number | null;
  remarks: string | null;
  recorded_on: string;
  diet_code: string;
  diet_name: string;
  patient_name: string;
  patient_code: string;
}

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  visit_id?: number;
}

interface DietSheetTabProps {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DietSheetTab({ patients, selectedPatient, onSelectPatient }: DietSheetTabProps) {
  const { t } = useTranslation('nursing');
  const [diets, setDiets] = useState<PatientDiet[]>([]);
  const [dietTypes, setDietTypes] = useState<DietType[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [history, setHistory] = useState<PatientDiet[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [form, setForm] = useState({
    patient_id: selectedPatient ? String(selectedPatient) : '',
    diet_type_id: '',
    extra_diet: '',
    remarks: '',
  });

  const fetchDietTypes = useCallback(async () => {
    try {
      const data = await apiFetch<DietType[]>('/api/nursing/diet-sheet/types');
      setDietTypes(data ?? []);
    } catch {
      setDietTypes([]);
    }
  }, []);

  const fetchDiets = useCallback(async () => {
    if (!selectedPatient) { setDiets([]); return; }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ patient_id: String(selectedPatient) });
      const data = await apiFetch<PatientDiet[]>(`/api/nursing/diet-sheet?${qs}`);
      setDiets(data ?? []);
    } catch {
      toast.error(t('dietSheet.failedToLoad'));
      setDiets([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPatient, t]);

  useEffect(() => { fetchDietTypes(); }, [fetchDietTypes]);
  useEffect(() => { fetchDiets(); }, [fetchDiets]);

  const handleSave = async () => {
    if (!form.patient_id || !form.diet_type_id) {
      toast.error(t('dietSheet.fieldsRequired'));
      return;
    }

    const patient = patients.find(p => p.patient_id === parseInt(form.patient_id));
    const payload: Record<string, unknown> = {
      patient_id: parseInt(form.patient_id),
      visit_id: patient?.visit_id,
      diet_type_id: parseInt(form.diet_type_id),
      extra_diet: form.extra_diet || undefined,
      remarks: form.remarks || undefined,
    };

    try {
      await apiFetch('/api/nursing/diet-sheet', { method: 'POST', body: payload });
      toast.success(t('dietSheet.assigned'));
      setShowModal(false);
      fetchDiets();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('dietSheet.assignFailed'));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('dietSheet.confirmDelete'))) return;
    try {
      await apiFetch(`/api/nursing/diet-sheet/${id}`, { method: 'DELETE' });
      toast.success(t('dietSheet.deleted'));
      fetchDiets();
    } catch {
      toast.error(t('dietSheet.deleteFailed'));
    }
  };

  const handleViewHistory = async (patientId: number) => {
    setHistoryLoading(true);
    setShowHistoryModal(true);
    try {
      const data = await apiFetch<PatientDiet[]>(`/api/nursing/diet-sheet/history/${patientId}`);
      setHistory(data ?? []);
    } catch {
      toast.error(t('dietSheet.historyFailed'));
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openAddModal = () => {
    setForm({
      patient_id: selectedPatient ? String(selectedPatient) : '',
      diet_type_id: '',
      extra_diet: '',
      remarks: '',
    });
    setShowModal(true);
  };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('dietSheet.patient')}:</label>
          <select
            value={selectedPatient ?? ''}
            onChange={e => onSelectPatient(e.target.value ? parseInt(e.target.value) : null)}
            className="input max-w-xs"
          >
            <option value="">{t('dietSheet.selectPatient')}</option>
            {patients.map(p => (
              <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { fetchDiets(); fetchDietTypes(); }} className="btn-ghost p-2" aria-label={t('dietSheet.refresh')}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={openAddModal} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('dietSheet.assignDiet')}
          </button>
        </div>
      </div>

      {/* ── Diets Table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {t('dietSheet.title')}
            {diets.length > 0 && <span className="ml-2 text-[var(--color-text-muted)] font-normal">({diets.length})</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('dietSheet.dietType')}</th>
                <th>{t('dietSheet.extraDiet')}</th>
                <th>{t('dietSheet.remarks')}</th>
                <th>{t('dietSheet.recordedOn')}</th>
                <th>{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                ))
              ) : diets.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={<UtensilsCrossed className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('dietSheet.noRecords')}
                      description={t('dietSheet.noRecordsDesc')}
                    />
                  </td>
                </tr>
              ) : (
                diets.map(d => (
                  <tr key={d.id} className="hover:bg-[var(--color-surface-hover)]">
                    <td>
                      <span className="badge badge-primary">{d.diet_name}</span>
                    </td>
                    <td className="text-sm">{d.extra_diet || '—'}</td>
                    <td className="text-sm max-w-32 truncate">{d.remarks || '—'}</td>
                    <td className="font-data text-xs text-[var(--color-text-muted)]">
                      {d.recorded_on ? new Date(d.recorded_on).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleViewHistory(d.patient_id)} className="btn-ghost p-1.5 text-blue-600" title={t('dietSheet.history')}>
                          <History className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(d.id)} className="btn-ghost p-1.5 text-red-600" title={t('common:delete')}>
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

      {/* ── Assign Diet Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('dietSheet.assignDiet')}</h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">{t('dietSheet.patient')} *</label>
                <select value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} className="input" required>
                  <option value="">{t('dietSheet.selectPatient')}</option>
                  {patients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">{t('dietSheet.dietType')} *</label>
                <select value={form.diet_type_id} onChange={e => setForm(f => ({ ...f, diet_type_id: e.target.value }))} className="input" required>
                  <option value="">{t('dietSheet.selectDietType')}</option>
                  {dietTypes.map(dt => (
                    <option key={dt.id} value={dt.id}>{dt.diet_name} ({dt.diet_code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">{t('dietSheet.extraDiet')}</label>
                <input
                  type="text"
                  value={form.extra_diet}
                  onChange={e => setForm(f => ({ ...f, extra_diet: e.target.value }))}
                  placeholder={t('dietSheet.extraDietPlaceholder')}
                  className="input"
                />
              </div>

              <div>
                <label className="label">{t('dietSheet.remarks')}</label>
                <textarea
                  value={form.remarks}
                  onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                  placeholder={t('dietSheet.remarksPlaceholder')}
                  className="input min-h-[80px]"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleSave} disabled={!form.patient_id || !form.diet_type_id} className="btn-primary">
                  {t('common:create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── History Modal ── */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('dietSheet.dietHistory')}</h3>
              <button onClick={() => { setShowHistoryModal(false); setHistory([]); }} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 max-h-[60vh] overflow-y-auto">
              {historyLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-12 w-full rounded" />)}
                </div>
              ) : history.length === 0 ? (
                <EmptyState
                  icon={<History className="w-8 h-8 text-[var(--color-text-muted)]" />}
                  title={t('dietSheet.noHistory')}
                  description={t('dietSheet.noHistoryDesc')}
                />
              ) : (
                <div className="space-y-3">
                  {history.map(h => (
                    <div key={h.id} className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="badge badge-primary text-xs">{h.diet_name}</span>
                        <span className="font-data text-xs text-[var(--color-text-muted)]">
                          {h.recorded_on ? new Date(h.recorded_on).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                      </div>
                      {h.extra_diet && <p className="text-sm text-[var(--color-text-secondary)] mt-1">{t('dietSheet.extraDiet')}: {h.extra_diet}</p>}
                      {h.remarks && <p className="text-sm text-[var(--color-text-muted)] mt-1">{h.remarks}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end p-5 border-t border-[var(--color-border)]">
              <button onClick={() => { setShowHistoryModal(false); setHistory([]); }} className="btn-secondary">{t('common:close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
