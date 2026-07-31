import { useState, useEffect, useCallback } from 'react';
import {
  Droplets, Plus, X, RefreshCw, TrendingUp, TrendingDown, Activity,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import EmptyState from '../dashboard/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface IORecord {
  id: number;
  patient_id: number;
  intake_type?: string;
  intake_amount?: number;
  intake_unit?: string;
  output_type?: string;
  output_amount?: number;
  output_unit?: string;
  remarks?: string;
  recorded_on: string;
}

interface FluidBalance {
  total_intake: number;
  total_output: number;
  balance: number;
  period: string;
}

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
}

interface IOChartsTabProps {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function IOChartsTab({ patients, selectedPatient, onSelectPatient }: IOChartsTabProps) {
  const { t } = useTranslation('nursing');
  const [records, setRecords] = useState<IORecord[]>([]);
  const [balance, setBalance] = useState<FluidBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [form, setForm] = useState({
    patient_id: selectedPatient ? String(selectedPatient) : '',
    io_type: 'intake' as 'intake' | 'output',
    item_name: '',
    quantity: '',
    unit: 'ml',
    remarks: '',
    recorded_on: new Date().toISOString().slice(0, 16),
  });

  const fetchRecords = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), limit: '20' });
      if (selectedPatient) qs.set('patient_id', String(selectedPatient));
      const data = await apiFetch<{ Results?: IORecord[]; pagination?: { total?: number } }>(`/api/nursing/io?${qs}`);
      setRecords(data.Results ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(p);
    } catch {
      toast.error(t('io.failedToLoad'));
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPatient, t]);

  const fetchBalance = useCallback(async () => {
    if (!selectedPatient) { setBalance(null); return; }
    try {
      const data = await apiFetch<FluidBalance>(`/api/nursing/io/balance/${selectedPatient}?period=24`);
      setBalance(data);
    } catch {
      setBalance(null);
    }
  }, [selectedPatient]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  const handleSave = async () => {
    if (!form.patient_id || !form.item_name || !form.quantity) {
      toast.error(t('io.fieldsRequired'));
      return;
    }

    const payload: Record<string, unknown> = {
      patient_id: parseInt(form.patient_id),
      remarks: form.remarks || undefined,
      recorded_on: form.recorded_on ? new Date(form.recorded_on).toISOString() : undefined,
    };

    if (form.io_type === 'intake') {
      payload.intake_type = form.item_name;
      payload.intake_amount = parseFloat(form.quantity);
      payload.intake_unit = form.unit;
    } else {
      payload.output_type = form.item_name;
      payload.output_amount = parseFloat(form.quantity);
      payload.output_unit = form.unit;
    }

    try {
      await apiFetch('/api/nursing/io', { method: 'POST', body: payload });
      toast.success(t('io.recorded'));
      setShowModal(false);
      fetchRecords(page);
      fetchBalance();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('io.failed'));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('io.confirmDelete'))) return;
    try {
      await apiFetch(`/api/nursing/io/${id}`, { method: 'DELETE' });
      toast.success(t('io.deleted'));
      fetchRecords(page);
      fetchBalance();
    } catch {
      toast.error(t('io.deleteFailed'));
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('io.patient')}:</label>
          <select
            value={selectedPatient ?? ''}
            onChange={e => onSelectPatient(e.target.value ? parseInt(e.target.value) : null)}
            className="input max-w-xs"
          >
            <option value="">{t('io.allPatients')}</option>
            {patients.map(p => (
              <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { fetchRecords(page); fetchBalance(); }} className="btn-ghost p-2" aria-label={t('io.refresh')}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => {
            setForm({
              patient_id: selectedPatient ? String(selectedPatient) : '',
              io_type: 'intake', item_name: '', quantity: '', unit: 'ml',
              remarks: '', recorded_on: new Date().toISOString().slice(0, 16),
            });
            setShowModal(true);
          }} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('io.newRecord')}
          </button>
        </div>
      </div>

      {/* ── Fluid Balance Cards ── */}
      {selectedPatient && balance && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-4 border-l-4 border-l-blue-500">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-600">{balance.total_intake} <span className="text-sm font-normal text-[var(--color-text-muted)]">ml</span></p>
                <p className="text-xs text-[var(--color-text-muted)]">{t('io.totalIntake')} ({balance.period})</p>
              </div>
            </div>
          </div>

          <div className="card p-4 border-l-4 border-l-amber-500">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600">{balance.total_output} <span className="text-sm font-normal text-[var(--color-text-muted)]">ml</span></p>
                <p className="text-xs text-[var(--color-text-muted)]">{t('io.totalOutput')} ({balance.period})</p>
              </div>
            </div>
          </div>

          <div className={`card p-4 border-l-4 ${balance.balance >= 0 ? 'border-l-emerald-500' : 'border-l-red-500'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${balance.balance >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <Activity className={`w-5 h-5 ${balance.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />
              </div>
              <div>
                <p className={`text-2xl font-bold ${balance.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {balance.balance > 0 ? '+' : ''}{balance.balance} <span className="text-sm font-normal text-[var(--color-text-muted)]">ml</span>
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">{t('io.fluidBalance')} ({balance.period})</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Records Table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {t('io.title')}
            {total > 0 && <span className="ml-2 text-[var(--color-text-muted)] font-normal">({total})</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('io.type')}</th>
                <th>{t('io.item')}</th>
                <th className="text-right">{t('io.amount')}</th>
                <th>{t('io.remarks')}</th>
                <th>{t('io.recordedOn')}</th>
                <th>{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                ))
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={<Droplets className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('io.noRecords')}
                      description={t('io.noRecordsDesc')}
                    />
                  </td>
                </tr>
              ) : (
                records.map(r => {
                  const isIntake = !!r.intake_type;
                  return (
                    <tr key={r.id} className="hover:bg-[var(--color-surface-hover)]">
                      <td>
                        <span className={`badge ${isIntake ? 'badge-primary' : 'badge-warning'}`}>
                          {isIntake ? t('io.intake') : t('io.output')}
                        </span>
                      </td>
                      <td className="font-medium text-sm">{isIntake ? r.intake_type : r.output_type}</td>
                      <td className="text-right font-data text-sm">
                        <span className={isIntake ? 'text-blue-600' : 'text-amber-600'}>
                          {isIntake ? '+' : '-'}{isIntake ? r.intake_amount : r.output_amount} {isIntake ? r.intake_unit : r.output_unit}
                        </span>
                      </td>
                      <td className="text-sm max-w-32 truncate">{r.remarks || '—'}</td>
                      <td className="font-data text-xs text-[var(--color-text-muted)]">
                        {r.recorded_on ? new Date(r.recorded_on).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td>
                        <button onClick={() => handleDelete(r.id)} className="btn-ghost p-1.5 text-red-600" title={t('common:delete')}>
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {total > 20 && (
          <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">{t('io.page')} {page} {t('io.of')} {Math.ceil(total / 20)}</span>
            <div className="flex gap-2">
              <button onClick={() => fetchRecords(page - 1)} disabled={page <= 1} className="btn-secondary text-xs">{t('common:previous')}</button>
              <button onClick={() => fetchRecords(page + 1)} disabled={page >= Math.ceil(total / 20)} className="btn-secondary text-xs">{t('common:next')}</button>
            </div>
          </div>
        )}
      </div>

      {/* ── New Record Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('io.newRecord')}</h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">{t('io.patient')} *</label>
                <select value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} className="input" required>
                  <option value="">{t('io.selectPatient')}</option>
                  {patients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">{t('io.type')} *</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['intake', 'output'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setForm(f => ({ ...f, io_type: type }))}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        form.io_type === type
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                          : 'border-[var(--color-border)] hover:border-[var(--color-primary)] text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {t(`io.${type}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">{t('io.itemName')} *</label>
                <input
                  type="text"
                  value={form.item_name}
                  onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))}
                  placeholder={form.io_type === 'intake' ? t('io.intakePlaceholder') : t('io.outputPlaceholder')}
                  className="input"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('io.quantity')} *</label>
                  <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">{t('io.unit')}</label>
                  <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className="input">
                    <option value="ml">ml</option>
                    <option value="L">L</option>
                    <option value="cc">cc</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">{t('io.recordedOn')}</label>
                <input type="datetime-local" value={form.recorded_on} onChange={e => setForm(f => ({ ...f, recorded_on: e.target.value }))} className="input" />
              </div>

              <div>
                <label className="label">{t('io.remarks')}</label>
                <input type="text" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} className="input" />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleSave} disabled={!form.patient_id || !form.item_name || !form.quantity} className="btn-primary">
                  {t('common:create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
