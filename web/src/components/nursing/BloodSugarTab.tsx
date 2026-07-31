import { useState, useEffect, useCallback } from 'react';
import {
  Droplets, Plus, X, RefreshCw, Activity, TrendingUp, Syringe,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import EmptyState from '../dashboard/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BloodSugarRecord {
  id: number;
  patient_id: number;
  visit_id: number;
  entry_datetime: string;
  rbs_value: number;
  insulin: number | null;
  remarks: string | null;
  created_by: string;
}

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  visit_id?: number;
}

interface BloodSugarTabProps {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRbsColor(value: number): string {
  if (value < 70) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
  if (value <= 140) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  if (value <= 200) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
}

function getRbsLabel(value: number): string {
  if (value < 70) return 'Low';
  if (value <= 140) return 'Normal';
  if (value <= 200) return 'Elevated';
  return 'High';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BloodSugarTab({ patients, selectedPatient, onSelectPatient }: BloodSugarTabProps) {
  const { t } = useTranslation('nursing');
  const [records, setRecords] = useState<BloodSugarRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    rbs_value: '',
    insulin: '',
    remarks: '',
  });

  const fetchRecords = useCallback(async () => {
    if (!selectedPatient) { setRecords([]); return; }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ patient_id: String(selectedPatient) });
      const data = await apiFetch<{ Results?: BloodSugarRecord[] }>(`/api/nursing/blood-sugar?${qs}`);
      setRecords(data.Results ?? []);
    } catch {
      toast.error(t('bloodSugar.failedToLoad'));
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPatient, t]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const latestRecord = records.length > 0 ? records[0] : null;
  const avgRbs = records.length > 0
    ? Math.round(records.reduce((sum, r) => sum + r.rbs_value, 0) / records.length)
    : 0;

  const handleSave = async () => {
    if (!selectedPatient || !form.rbs_value) {
      toast.error(t('bloodSugar.fieldsRequired'));
      return;
    }

    const patient = patients.find(p => p.patient_id === selectedPatient);
    const payload: Record<string, unknown> = {
      patient_id: selectedPatient,
      visit_id: patient?.visit_id ?? 0,
      rbs_value: parseFloat(form.rbs_value),
      insulin: form.insulin ? parseFloat(form.insulin) : undefined,
      remarks: form.remarks || undefined,
    };

    setSaving(true);
    try {
      await apiFetch('/api/nursing/blood-sugar', { method: 'POST', body: payload });
      toast.success(t('bloodSugar.recorded'));
      setShowModal(false);
      setForm({ rbs_value: '', insulin: '', remarks: '' });
      fetchRecords();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('bloodSugar.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('bloodSugar.patient')}:</label>
          <select
            value={selectedPatient ?? ''}
            onChange={e => onSelectPatient(e.target.value ? parseInt(e.target.value) : null)}
            className="input max-w-xs"
          >
            <option value="">{t('bloodSugar.selectPatient')}</option>
            {patients.map(p => (
              <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => fetchRecords()} className="btn-ghost p-2" aria-label={t('bloodSugar.refresh')}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setForm({ rbs_value: '', insulin: '', remarks: '' });
              setShowModal(true);
            }}
            disabled={!selectedPatient}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" /> {t('bloodSugar.recordRbs')}
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      {selectedPatient && records.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-4 border-l-4 border-l-blue-500">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Activity className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold text-blue-600">{latestRecord?.rbs_value}</p>
                  <span className={`badge text-xs ${getRbsColor(latestRecord?.rbs_value ?? 0)}`}>
                    {getRbsLabel(latestRecord?.rbs_value ?? 0)}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">{t('bloodSugar.latestReading')}</p>
              </div>
            </div>
          </div>

          <div className="card p-4 border-l-4 border-l-emerald-500">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-600">{avgRbs} <span className="text-sm font-normal text-[var(--color-text-muted)]">mg/dL</span></p>
                <p className="text-xs text-[var(--color-text-muted)]">{t('bloodSugar.avgRbs')}</p>
              </div>
            </div>
          </div>

          <div className="card p-4 border-l-4 border-l-purple-500">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                <Droplets className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-purple-600">{records.length}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{t('bloodSugar.totalReadings')}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Records Table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {t('bloodSugar.title')}
            {records.length > 0 && <span className="ml-2 text-[var(--color-text-muted)] font-normal">({records.length})</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('bloodSugar.dateTime')}</th>
                <th className="text-right">{t('bloodSugar.rbs')}</th>
                <th>{t('bloodSugar.status')}</th>
                <th className="text-right">{t('bloodSugar.insulin')}</th>
                <th>{t('bloodSugar.remarks')}</th>
                <th>{t('bloodSugar.recordedBy')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                ))
              ) : !selectedPatient ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={<Droplets className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('bloodSugar.selectPatientPrompt')}
                      description={t('bloodSugar.selectPatientPromptDesc')}
                    />
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={<Droplets className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('bloodSugar.noRecords')}
                      description={t('bloodSugar.noRecordsDesc')}
                    />
                  </td>
                </tr>
              ) : (
                records.map(r => (
                  <tr key={r.id} className="hover:bg-[var(--color-surface-hover)]">
                    <td className="font-data text-xs text-[var(--color-text-muted)]">
                      {r.entry_datetime ? new Date(r.entry_datetime).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="text-right font-data text-sm font-semibold">{r.rbs_value} <span className="text-xs font-normal text-[var(--color-text-muted)]">mg/dL</span></td>
                    <td>
                      <span className={`badge text-xs ${getRbsColor(r.rbs_value)}`}>
                        {getRbsLabel(r.rbs_value)}
                      </span>
                    </td>
                    <td className="text-right text-sm">
                      {r.insulin != null ? (
                        <span className="flex items-center justify-end gap-1">
                          <Syringe className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                          {r.insulin} <span className="text-xs text-[var(--color-text-muted)]">U</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="text-sm max-w-32 truncate">{r.remarks || '—'}</td>
                    <td className="text-sm text-[var(--color-text-muted)]">{r.created_by || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Record RBS Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('bloodSugar.recordRbs')}</h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">{t('bloodSugar.rbsValue')} *</label>
                <input
                  type="number"
                  value={form.rbs_value}
                  onChange={e => setForm(f => ({ ...f, rbs_value: e.target.value }))}
                  placeholder={t('bloodSugar.rbsPlaceholder')}
                  className="input"
                  min={0}
                  max={800}
                  required
                />
                {form.rbs_value && (
                  <p className="mt-1 text-xs">
                    <span className={`badge text-xs ${getRbsColor(parseFloat(form.rbs_value))}`}>
                      {getRbsLabel(parseFloat(form.rbs_value))} — {parseFloat(form.rbs_value)} mg/dL
                    </span>
                  </p>
                )}
              </div>

              <div>
                <label className="label">{t('bloodSugar.insulinUnits')}</label>
                <input
                  type="number"
                  value={form.insulin}
                  onChange={e => setForm(f => ({ ...f, insulin: e.target.value }))}
                  placeholder={t('bloodSugar.insulinPlaceholder')}
                  className="input"
                  min={0}
                  step={0.5}
                />
              </div>

              <div>
                <label className="label">{t('bloodSugar.remarks')}</label>
                <textarea
                  value={form.remarks}
                  onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                  placeholder={t('bloodSugar.remarksPlaceholder')}
                  className="input min-h-[80px] resize-y"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleSave} disabled={!form.rbs_value || saving} className="btn-primary">
                  {saving ? t('common:saving') : t('common:create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
