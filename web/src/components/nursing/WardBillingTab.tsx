import { useState, useEffect, useCallback } from 'react';
import {
  Receipt, Plus, X, RefreshCw, CheckCircle, Clock, FileText, Ban,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import EmptyState from '../dashboard/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  visit_id?: number;
}

interface WardBillingRequest {
  id: number;
  patient_id: number;
  visit_id: number;
  item_name: string;
  item_id: number | null;
  service_department_id: number | null;
  quantity: number;
  price: number | null;
  total_amount: number | null;
  status: 'pending' | 'approved' | 'billed' | 'cancelled';
  requested_by: string;
  requested_on: string;
  approved_by: string | null;
  approved_on: string | null;
  patient_name: string;
  patient_code: string;
}

interface WardBillingTabProps {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function WardBillingTab({ patients, selectedPatient, onSelectPatient }: WardBillingTabProps) {
  const { t } = useTranslation('nursing');
  const [requests, setRequests] = useState<WardBillingRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const [form, setForm] = useState({
    patient_id: selectedPatient ? String(selectedPatient) : '',
    item_name: '',
    quantity: '1',
    price: '',
    total_amount: '',
  });

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (selectedPatient) qs.set('patient_id', String(selectedPatient));
      const data = await apiFetch<{ Results?: WardBillingRequest[] } | WardBillingRequest[]>(`/api/nursing/ward-billing?${qs}`);
      setRequests(Array.isArray(data) ? data : data.Results ?? []);
    } catch {
      toast.error(t('wardBilling.failedToLoad'));
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPatient, t]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleCreate = async () => {
    if (!form.patient_id || !form.item_name || !form.quantity) {
      toast.error(t('wardBilling.fieldsRequired'));
      return;
    }

    const patient = patients.find(p => p.patient_id === parseInt(form.patient_id));
    const payload: Record<string, unknown> = {
      patient_id: parseInt(form.patient_id),
      visit_id: patient?.visit_id ?? 0,
      item_name: form.item_name,
      quantity: parseInt(form.quantity),
    };

    if (form.price) payload.price = parseFloat(form.price);
    if (form.total_amount) payload.total_amount = parseFloat(form.total_amount);

    try {
      await apiFetch('/api/nursing/ward-billing', { method: 'POST', body: payload });
      toast.success(t('wardBilling.created'));
      setShowModal(false);
      fetchRequests();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('wardBilling.createFailed'));
    }
  };

  const handleApprove = async (id: number) => {
    if (!confirm(t('wardBilling.confirmApprove'))) return;
    try {
      await apiFetch(`/api/nursing/ward-billing/${id}/approve`, { method: 'PUT' });
      toast.success(t('wardBilling.approved'));
      fetchRequests();
    } catch {
      toast.error(t('wardBilling.approveFailed'));
    }
  };

  const handleCancel = async (id: number) => {
    if (!confirm(t('wardBilling.confirmCancel'))) return;
    try {
      await apiFetch(`/api/nursing/ward-billing/${id}/cancel`, { method: 'PUT' });
      toast.success(t('wardBilling.cancelled'));
      fetchRequests();
    } catch {
      toast.error(t('wardBilling.cancelFailed'));
    }
  };

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const approvedCount = requests.filter(r => r.status === 'approved').length;
  const totalCount = requests.length;

  const statusBadge = (status: WardBillingRequest['status']) => {
    const classes: Record<string, string> = {
      pending: 'badge-warning',
      approved: 'badge-primary',
      billed: 'badge-success',
      cancelled: 'badge-neutral',
    };
    return <span className={`badge ${classes[status] ?? ''}`}>{t(`wardBilling.status.${status}`)}</span>;
  };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('wardBilling.patient')}:</label>
          <select
            value={selectedPatient ?? ''}
            onChange={e => onSelectPatient(e.target.value ? parseInt(e.target.value) : null)}
            className="input max-w-xs"
          >
            <option value="">{t('wardBilling.allPatients')}</option>
            {patients.map(p => (
              <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => fetchRequests()} className="btn-ghost p-2" aria-label={t('wardBilling.refresh')}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => {
            setForm({
              patient_id: selectedPatient ? String(selectedPatient) : '',
              item_name: '',
              quantity: '1',
              price: '',
              total_amount: '',
            });
            setShowModal(true);
          }} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('wardBilling.newRequest')}
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4 border-l-4 border-l-yellow-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-yellow-50 flex items-center justify-center">
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('wardBilling.pending')}</p>
            </div>
          </div>
        </div>

        <div className="card p-4 border-l-4 border-l-blue-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{approvedCount}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('wardBilling.approved')}</p>
            </div>
          </div>
        </div>

        <div className="card p-4 border-l-4 border-l-emerald-500">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <FileText className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">{totalCount}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t('wardBilling.totalRequests')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Requests Table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {t('wardBilling.title')}
            {totalCount > 0 && <span className="ml-2 text-[var(--color-text-muted)] font-normal">({totalCount})</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('wardBilling.date')}</th>
                <th>{t('wardBilling.patient')}</th>
                <th>{t('wardBilling.item')}</th>
                <th className="text-right">{t('wardBilling.qty')}</th>
                <th className="text-right">{t('wardBilling.price')}</th>
                <th>{t('wardBilling.status')}</th>
                <th>{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                ))
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={<Receipt className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('wardBilling.noRequests')}
                      description={t('wardBilling.noRequestsDesc')}
                    />
                  </td>
                </tr>
              ) : (
                requests.map(r => (
                  <tr key={r.id} className="hover:bg-[var(--color-surface-hover)]">
                    <td className="font-data text-xs text-[var(--color-text-muted)]">
                      {r.requested_on ? new Date(r.requested_on).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="text-sm">
                      <span className="font-medium">{r.patient_name}</span>
                      <span className="ml-1 text-[var(--color-text-muted)] text-xs">({r.patient_code})</span>
                    </td>
                    <td className="font-medium text-sm">{r.item_name}</td>
                    <td className="text-right font-data text-sm">{r.quantity}</td>
                    <td className="text-right font-data text-sm">
                      {r.price != null ? r.price.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                    </td>
                    <td>{statusBadge(r.status)}</td>
                    <td>
                      {r.status === 'pending' && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleApprove(r.id)} className="btn-ghost p-1.5 text-emerald-600" title={t('wardBilling.approve')}>
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleCancel(r.id)} className="btn-ghost p-1.5 text-red-600" title={t('wardBilling.cancel')}>
                            <Ban className="w-4 h-4" />
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
      </div>

      {/* ── New Request Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('wardBilling.newRequest')}</h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">{t('wardBilling.patient')} *</label>
                <select value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} className="input" required>
                  <option value="">{t('wardBilling.selectPatient')}</option>
                  {patients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">{t('wardBilling.itemName')} *</label>
                <input
                  type="text"
                  value={form.item_name}
                  onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))}
                  placeholder={t('wardBilling.itemNamePlaceholder')}
                  className="input"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">{t('wardBilling.quantity')} *</label>
                  <input type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">{t('wardBilling.price')}</label>
                  <input type="number" step="0.01" min="0" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} className="input" placeholder="0.00" />
                </div>
                <div>
                  <label className="label">{t('wardBilling.totalAmount')}</label>
                  <input type="number" step="0.01" min="0" value={form.total_amount} onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} className="input" placeholder="0.00" />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleCreate} disabled={!form.patient_id || !form.item_name || !form.quantity} className="btn-primary">
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
