import { useState, useEffect, useCallback } from 'react';
import {
  ArrowRightLeft, Plus, X, RefreshCw, Check, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import EmptyState from '../dashboard/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PatientTransfer {
  id: number;
  patient_id: number;
  visit_id: number;
  from_ward_id: number;
  from_bed_id: number | null;
  to_ward_id: number;
  to_bed_id: number | null;
  transfer_reason: string | null;
  transferred_by: string;
  transferred_on: string;
  received_by: string | null;
  received_on: string | null;
  status: 'pending' | 'received' | 'cancelled';
  patient_name: string;
  patient_code: string;
}

interface Ward {
  id: number;
  name: string;
}

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  visit_id?: number;
}

interface PatientTransferTabProps {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
  wardId?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PatientTransferTab({ patients, selectedPatient, onSelectPatient, wardId }: PatientTransferTabProps) {
  const { t } = useTranslation('nursing');
  const [transfers, setTransfers] = useState<PatientTransfer[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [form, setForm] = useState({
    patient_id: selectedPatient ? String(selectedPatient) : '',
    visit_id: '',
    from_ward_id: wardId ? String(wardId) : '',
    to_ward_id: '',
    transfer_reason: '',
  });

  const wardName = useCallback((id: number) => wards.find(w => w.id === id)?.name ?? `#${id}`, [wards]);

  const fetchTransfers = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), limit: '20' });
      if (selectedPatient) qs.set('visit_id', String(selectedPatient));
      const data = await apiFetch<{ Results?: PatientTransfer[]; pagination?: { total?: number } }>(`/api/nursing/patient-transfer?${qs}`);
      setTransfers(data.Results ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(p);
    } catch {
      toast.error(t('transfer.failedToLoad'));
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPatient, t]);

  const fetchWards = useCallback(async () => {
    try {
      const data = await apiFetch<Ward[]>('/api/nursing/wards');
      setWards(Array.isArray(data) ? data : []);
    } catch {
      setWards([]);
    }
  }, []);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);
  useEffect(() => { fetchWards(); }, [fetchWards]);

  const selectedPatientObj = patients.find(p => p.patient_id === selectedPatient);

  const handleInitiate = async () => {
    if (!form.patient_id || !form.from_ward_id || !form.to_ward_id) {
      toast.error(t('transfer.fieldsRequired'));
      return;
    }

    const payload: Record<string, unknown> = {
      patient_id: parseInt(form.patient_id),
      visit_id: form.visit_id ? parseInt(form.visit_id) : selectedPatientObj?.visit_id,
      from_ward_id: parseInt(form.from_ward_id),
      to_ward_id: parseInt(form.to_ward_id),
    };
    if (form.transfer_reason) payload.transfer_reason = form.transfer_reason;

    try {
      await apiFetch('/api/nursing/patient-transfer', { method: 'POST', body: payload });
      toast.success(t('transfer.initiated'));
      setShowModal(false);
      fetchTransfers(page);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('transfer.failed'));
    }
  };

  const handleReceive = async (id: number) => {
    if (!confirm(t('transfer.confirmReceive'))) return;
    try {
      await apiFetch(`/api/nursing/patient-transfer/${id}/receive`, {
        method: 'PUT',
        body: { received_by: 'current_user' },
      });
      toast.success(t('transfer.received'));
      fetchTransfers(page);
    } catch {
      toast.error(t('transfer.receiveFailed'));
    }
  };

  const handleCancel = async (id: number) => {
    if (!confirm(t('transfer.confirmCancel'))) return;
    try {
      await apiFetch(`/api/nursing/patient-transfer/${id}/cancel`, { method: 'PUT' });
      toast.success(t('transfer.cancelled'));
      fetchTransfers(page);
    } catch {
      toast.error(t('transfer.cancelFailed'));
    }
  };

  const statusBadge = (status: PatientTransfer['status']) => {
    const map: Record<string, string> = {
      pending: 'badge-warning',
      received: 'badge-success',
      cancelled: 'badge-gray',
    };
    return <span className={`badge ${map[status] ?? 'badge-gray'}`}>{t(`transfer.status.${status}`)}</span>;
  };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('transfer.patient')}:</label>
          <select
            value={selectedPatient ?? ''}
            onChange={e => onSelectPatient(e.target.value ? parseInt(e.target.value) : null)}
            className="input max-w-xs"
          >
            <option value="">{t('transfer.allPatients')}</option>
            {patients.map(p => (
              <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => fetchTransfers(page)} className="btn-ghost p-2" aria-label={t('transfer.refresh')}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => {
            setForm({
              patient_id: selectedPatient ? String(selectedPatient) : '',
              visit_id: selectedPatientObj?.visit_id ? String(selectedPatientObj.visit_id) : '',
              from_ward_id: wardId ? String(wardId) : '',
              to_ward_id: '',
              transfer_reason: '',
            });
            setShowModal(true);
          }} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('transfer.initiateTransfer')}
          </button>
        </div>
      </div>

      {/* ── Transfers Table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {t('transfer.title')}
            {total > 0 && <span className="ml-2 text-[var(--color-text-muted)] font-normal">({total})</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('transfer.date')}</th>
                <th>{t('transfer.patient')}</th>
                <th>{t('transfer.fromWard')}</th>
                <th>{t('transfer.toWard')}</th>
                <th>{t('transfer.reason')}</th>
                <th>{t('transfer.status')}</th>
                <th>{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                ))
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={<ArrowRightLeft className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('transfer.noTransfers')}
                      description={t('transfer.noTransfersDesc')}
                    />
                  </td>
                </tr>
              ) : (
                transfers.map(tr => (
                  <tr key={tr.id} className="hover:bg-[var(--color-surface-hover)]">
                    <td className="font-data text-xs text-[var(--color-text-muted)]">
                      {tr.transferred_on ? new Date(tr.transferred_on).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="font-medium text-sm">{tr.patient_name} <span className="text-[var(--color-text-muted)]">({tr.patient_code})</span></td>
                    <td className="text-sm">{wardName(tr.from_ward_id)}</td>
                    <td className="text-sm">{wardName(tr.to_ward_id)}</td>
                    <td className="text-sm max-w-32 truncate">{tr.transfer_reason || '—'}</td>
                    <td>{statusBadge(tr.status)}</td>
                    <td>
                      {tr.status === 'pending' && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleReceive(tr.id)} className="btn-ghost p-1.5 text-emerald-600" title={t('transfer.receive')}>
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleCancel(tr.id)} className="btn-ghost p-1.5 text-red-600" title={t('transfer.cancel')}>
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 20 && (
          <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">{t('transfer.page')} {page} {t('transfer.of')} {Math.ceil(total / 20)}</span>
            <div className="flex gap-2">
              <button onClick={() => fetchTransfers(page - 1)} disabled={page <= 1} className="btn-secondary text-xs">{t('common:previous')}</button>
              <button onClick={() => fetchTransfers(page + 1)} disabled={page >= Math.ceil(total / 20)} className="btn-secondary text-xs">{t('common:next')}</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Initiate Transfer Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('transfer.initiateTransfer')}</h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">{t('transfer.patient')} *</label>
                <select value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} className="input" required>
                  <option value="">{t('transfer.selectPatient')}</option>
                  {patients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">{t('transfer.fromWard')} *</label>
                <select value={form.from_ward_id} onChange={e => setForm(f => ({ ...f, from_ward_id: e.target.value }))} className="input" required>
                  <option value="">{t('transfer.selectWard')}</option>
                  {wards.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">{t('transfer.toWard')} *</label>
                <select value={form.to_ward_id} onChange={e => setForm(f => ({ ...f, to_ward_id: e.target.value }))} className="input" required>
                  <option value="">{t('transfer.selectWard')}</option>
                  {wards.filter(w => String(w.id) !== form.from_ward_id).map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">{t('transfer.reason')}</label>
                <textarea
                  value={form.transfer_reason}
                  onChange={e => setForm(f => ({ ...f, transfer_reason: e.target.value }))}
                  placeholder={t('transfer.reasonPlaceholder')}
                  className="input min-h-[80px]"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleInitiate} disabled={!form.patient_id || !form.from_ward_id || !form.to_ward_id} className="btn-primary">
                  {t('transfer.initiate')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
