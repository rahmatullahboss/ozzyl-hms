import { useState, useEffect, useCallback } from 'react';
import {
  Plus, X, RefreshCw, AlertCircle, CheckCircle, Clock,
  PauseCircle, XCircle, ChevronDown, Pill,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import EmptyState from '../dashboard/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MedicationOrder {
  id: number;
  patient_id: number;
  visit_id?: number;
  medication_name: string;
  generic_name?: string;
  strength?: string;
  dosage_form?: string;
  dose: string;
  route: string;
  frequency: string;
  duration?: string;
  instructions?: string;
  priority: string;
  status: string;
  status_reason?: string;
  start_datetime?: string;
  end_datetime?: string;
  formulary_name?: string;
  created_at: string;
}

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  visit_id?: number;
}

interface MedicationOrdersTabProps {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
}

// ─── Priority badge ───────────────────────────────────────────────────────────
function PriorityBadge({ priority }: { priority: string }) {
  const { t } = useTranslation('nursing');
  const priorityKey = priority.toLowerCase();
  const map: Record<string, string> = {
    stat: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    urgent: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    routine: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    prn: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[priority] ?? 'bg-slate-100 text-slate-500'}`}>
      {t(`priorities.${String(priorityKey)}`, { defaultValue: priority.toUpperCase() })}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function OrderStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('nursing');
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    active: { cls: 'badge-success', icon: <CheckCircle className="w-3 h-3" /> },
    completed: { cls: 'bg-slate-100 text-slate-600', icon: <CheckCircle className="w-3 h-3" /> },
    discontinued: { cls: 'badge-error', icon: <XCircle className="w-3 h-3" /> },
    on_hold: { cls: 'badge-warning', icon: <PauseCircle className="w-3 h-3" /> },
    cancelled: { cls: 'bg-slate-100 text-slate-500', icon: <XCircle className="w-3 h-3" /> },
  };
  const cfg = map[status] ?? { cls: 'bg-slate-100 text-slate-500', icon: <Clock className="w-3 h-3" /> };
  const statusLabelMap: Record<string, string> = {
    active: 'medicationOrders.status.active',
    completed: 'medicationOrders.status.completed',
    discontinued: 'medicationOrders.status.discontinued',
    on_hold: 'medicationOrders.status.on_hold',
    cancelled: 'medicationOrders.status.cancelled',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      {cfg.icon} {t(statusLabelMap[status] ?? 'medicationOrders.status.active', { defaultValue: status.replace(/_/g, ' ') })}
    </span>
  );
}

// ─── New Order Modal ──────────────────────────────────────────────────────────
function NewOrderModal({
  patients,
  selectedPatient,
  onClose,
  onDone,
}: {
  patients: Patient[];
  selectedPatient: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('nursing');
  const [form, setForm] = useState({
    patient_id: selectedPatient ? String(selectedPatient) : '',
    medication_name: '',
    generic_name: '',
    strength: '',
    dosage_form: '',
    dose: '',
    route: 'Oral',
    frequency: '',
    duration: '',
    instructions: '',
    priority: 'routine',
    start_datetime: new Date().toISOString().slice(0, 16),
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.patient_id || !form.medication_name || !form.dose || !form.frequency) {
      toast.error(t('medicationOrders.patientRequired'));
      return;
    }
    setSaving(true);
    try {
      const pt = patients.find(p => p.patient_id === parseInt(form.patient_id));
      await apiFetch('/api/nursing/medication-orders', {
        method: 'POST',
        body: {
          patient_id: parseInt(form.patient_id),
          visit_id: pt?.visit_id,
          medication_name: form.medication_name,
          generic_name: form.generic_name || undefined,
          strength: form.strength || undefined,
          dosage_form: form.dosage_form || undefined,
          dose: form.dose,
          route: form.route,
          frequency: form.frequency,
          duration: form.duration || undefined,
          instructions: form.instructions || undefined,
          priority: form.priority,
          start_datetime: form.start_datetime ? new Date(form.start_datetime).toISOString() : undefined,
        },
      });
      toast.success(t('medicationOrders.orderCreated'));
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('medicationOrders.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
          <h3 className="font-semibold">{t('medicationOrders.newOrderTitle')}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">{t('medicationOrders.patient')} *</label>
            <select
              value={form.patient_id}
              onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))}
              className="input" required
            >
              <option value="">{t('medicationOrders.selectPatient')}</option>
              {patients.map(p => (
                <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">{t('medicationOrders.medicationName')} *</label>
              <input type="text" value={form.medication_name}
                onChange={e => setForm(f => ({ ...f, medication_name: e.target.value }))}
                placeholder={t('medicationOrders.medicationNamePlaceholder')} className="input" required />
            </div>
            <div>
              <label className="label">{t('medicationOrders.genericName')}</label>
              <input type="text" value={form.generic_name}
                onChange={e => setForm(f => ({ ...f, generic_name: e.target.value }))}
                placeholder={t('medicationOrders.genericNamePlaceholder')} className="input" />
            </div>
            <div>
              <label className="label">{t('medicationOrders.strength')}</label>
              <input type="text" value={form.strength}
                onChange={e => setForm(f => ({ ...f, strength: e.target.value }))}
                placeholder={t('medicationOrders.strengthPlaceholder')} className="input" />
            </div>
            <div>
              <label className="label">{t('medicationOrders.dosageForm')}</label>
              <select value={form.dosage_form}
                onChange={e => setForm(f => ({ ...f, dosage_form: e.target.value }))}
                className="input">
                <option value="">{t('medicationOrders.selectForm')}</option>
                {['Tablet', 'Capsule', 'Syrup', 'Injection', 'Drops', 'Ointment', 'Cream', 'Patch'].map(d => (
                  <option key={d} value={d}>{t(`dosageForms.${d.toLowerCase()}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('medicationOrders.dose')} *</label>
              <input type="text" value={form.dose}
                onChange={e => setForm(f => ({ ...f, dose: e.target.value }))}
                placeholder={t('medicationOrders.dosePlaceholder')} className="input" required />
            </div>
            <div>
              <label className="label">{t('medicationOrders.route')} *</label>
              <select value={form.route}
                onChange={e => setForm(f => ({ ...f, route: e.target.value }))}
                className="input">
                {['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhalation', 'Sublingual', 'Rectal'].map(r => (
                  <option key={r} value={r}>{t(`routes.${r.toLowerCase()}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('medicationOrders.frequency')} *</label>
              <input type="text" value={form.frequency}
                onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                placeholder={t('medicationOrders.frequencyPlaceholder')} className="input" required />
            </div>
            <div>
              <label className="label">{t('medicationOrders.duration')}</label>
              <input type="text" value={form.duration}
                onChange={e => setForm(f => ({ ...f, duration: e.target.value }))}
                placeholder={t('medicationOrders.durationPlaceholder')} className="input" />
            </div>
            <div>
              <label className="label">{t('medicationOrders.priority')}</label>
              <select value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="input">
                {['stat', 'urgent', 'routine', 'prn'].map(p => (
                  <option key={p} value={p}>{t(`priorities.${p}`)}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">{t('medicationOrders.startDateTime')}</label>
              <input type="datetime-local" value={form.start_datetime}
                onChange={e => setForm(f => ({ ...f, start_datetime: e.target.value }))}
                className="input" />
            </div>
            <div className="col-span-2">
              <label className="label">{t('medicationOrders.instructions')}</label>
              <textarea value={form.instructions}
                onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                placeholder={t('medicationOrders.instructionsPlaceholder')}
                rows={2} className="input resize-none" />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose} className="btn-secondary">{t('medicationOrders.cancel')}</button>
            <button
              onClick={handleSave}
              disabled={saving || !form.patient_id || !form.medication_name || !form.dose || !form.frequency}
              className="btn-primary"
            >
              {saving ? t('medicationOrders.ordering') : t('medicationOrders.createOrder')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Status Change Modal ──────────────────────────────────────────────────────
function StatusModal({
  order,
  action,
  onClose,
  onDone,
}: {
  order: MedicationOrder;
  action: 'discontinue' | 'hold';
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('nursing');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const endpoint = action === 'discontinue'
        ? `/api/nursing/medication-orders/${order.id}/discontinue`
        : `/api/nursing/medication-orders/${order.id}/hold`;
      await apiFetch(endpoint, { method: 'PUT', body: { status_reason: reason || undefined } });
      toast.success(action === 'discontinue' ? t('medicationOrders.discontinue.success') : t('medicationOrders.hold.success'));
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('medicationOrders.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="font-semibold capitalize">{action === 'discontinue' ? t('medicationOrders.discontinue.title') : t('medicationOrders.hold.title')}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            <strong>{order.medication_name}</strong> {order.dose} · {order.route} · {order.frequency}
          </p>
          <div>
            <label className="label">{t('medicationOrders.discontinue.reason')}{t('optionalLabel')}</label>
            <input type="text" value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('medicationOrders.discontinue.reasonPlaceholder')}
              className="input" />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="btn-secondary">{t('medicationOrders.cancel')}</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={action === 'discontinue' ? 'btn-danger' : 'btn-secondary'}
            >
              {saving ? t('medicationOrders.saving') : action === 'discontinue' ? t('medicationOrders.discontinue.button') : t('medicationOrders.hold.button')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function MedicationOrdersTab({ patients, selectedPatient, onSelectPatient }: MedicationOrdersTabProps) {
  const { t } = useTranslation('nursing');
  const [orders, setOrders] = useState<MedicationOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [showNewModal, setShowNewModal] = useState(false);
  const [statusModal, setStatusModal] = useState<{ order: MedicationOrder; action: 'discontinue' | 'hold' } | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchOrders = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), limit: '20' });
      if (selectedPatient) qs.set('patient_id', String(selectedPatient));
      if (statusFilter) qs.set('status', statusFilter);
      const data = await apiFetch<{ Results?: MedicationOrder[]; pagination?: { total?: number } }>(`/api/nursing/medication-orders?${qs}`);
      setOrders(data.Results ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(p);
    } catch {
      toast.error(t('medicationOrders.failedToLoad'));
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPatient, statusFilter, t]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const activeCount = orders.filter(o => o.status === 'active').length;
  const statCount = orders.filter(o => o.priority === 'stat').length;

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('medicationOrders.patient')}:</label>
          <select
            value={selectedPatient ?? ''}
            onChange={e => onSelectPatient(e.target.value ? parseInt(e.target.value) : null)}
            className="input max-w-xs"
          >
            <option value="">{t('medicationOrders.allPatients')}</option>
            {patients.map(p => (
              <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
            ))}
          </select>
        </div>

        {/* Status filter */}
        <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
          {([
            { key: '', label: t('medicationOrders.status.all') },
            { key: 'active', label: t('medicationOrders.status.active') },
            { key: 'on_hold', label: t('medicationOrders.status.onHold') },
            { key: 'discontinued', label: t('medicationOrders.status.discontinued') },
            { key: 'completed', label: t('medicationOrders.status.completed') },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === s.key
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
              }`}
            >
              {s.label}
            </button>
          )))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => fetchOrders(page)} className="btn-ghost p-2" aria-label={t('medicationOrders.refresh')}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowNewModal(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('medicationOrders.newOrder')}
          </button>
        </div>
      </div>

      {/* ── Quick stats ── */}
      {orders.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-3 text-center">
            <div className="text-xl font-bold text-emerald-600">{activeCount}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t('medicationOrders.activeOrders')}</div>
          </div>
          <div className="card p-3 text-center">
            <div className={`text-xl font-bold ${statCount > 0 ? 'text-red-600' : 'text-[var(--color-text-muted)]'}`}>{statCount}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t('medicationOrders.statOrders')}</div>
          </div>
          <div className="card p-3 text-center">
            <div className="text-xl font-bold text-[var(--color-text)]">{total}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t('medicationOrders.totalOrders')}</div>
          </div>
        </div>
      )}

      {/* ── Orders Table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {t('medicationOrders.title')}
            {total > 0 && <span className="ml-2 text-[var(--color-text-muted)] font-normal">({total})</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('medicationOrders.medicationName')}</th>
                <th>{t('medicationOrders.dose')} / {t('medicationOrders.route')}</th>
                <th>{t('medicationOrders.frequency')}</th>
                <th>{t('medicationOrders.duration')}</th>
                <th>{t('medicationOrders.priority')}</th>
                <th>{t('status')}</th>
                <th>{t('medicationOrders.startDateTime')}</th>
                <th>{t('medicationOrders.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      icon={<Pill className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('medicationOrders.noOrders')}
                      description={t('medicationOrders.noOrdersDesc')}
                      action={
                        <button onClick={() => setShowNewModal(true)} className="btn-primary mt-2">
                          <Plus className="w-4 h-4" /> {t('medicationOrders.newOrder')}
                        </button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                orders.map((order, idx) => (
                  <tr key={order.id} className={`hover:bg-[var(--color-surface-hover)] ${order.priority === 'stat' ? 'bg-red-50/30 dark:bg-red-900/10' : ''}`}>
                    <td className="font-data text-sm text-[var(--color-text-muted)]">{(page - 1) * 20 + idx + 1}</td>
                    <td>
                      <div className="font-medium text-sm">{order.medication_name}</div>
                      {order.generic_name && <div className="text-xs text-[var(--color-text-muted)]">{order.generic_name} {order.strength}</div>}
                      {order.instructions && <div className="text-xs text-amber-600 italic mt-0.5">{order.instructions}</div>}
                    </td>
                    <td className="text-sm">{order.dose} <span className="text-[var(--color-text-muted)]">· {order.route}</span></td>
                    <td className="text-sm text-[var(--color-text-secondary)]">{order.frequency}</td>
                    <td className="text-sm text-[var(--color-text-muted)]">{order.duration || '—'}</td>
                    <td><PriorityBadge priority={order.priority} /></td>
                    <td><OrderStatusBadge status={order.status} /></td>
                    <td className="font-data text-xs text-[var(--color-text-secondary)]">
                      {order.start_datetime ? new Date(order.start_datetime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {order.status === 'active' && (
                          <>
                            <button
                              onClick={() => setStatusModal({ order, action: 'hold' })}
                              className="btn-ghost p-1.5 text-amber-600"
                              title={t('medicationOrders.hold.button')}
                            >
                              <PauseCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setStatusModal({ order, action: 'discontinue' })}
                              className="btn-ghost p-1.5 text-red-600"
                              title={t('medicationOrders.discontinue.button')}
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {order.status === 'on_hold' && (
                          <button
                            onClick={() => setStatusModal({ order, action: 'hold' })}
                            className="btn-ghost p-1.5 text-emerald-600"
                            title={t('medicationOrders.hold.resume')}
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 20 && (
          <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">{t('medicationOrders.page')} {page} {t('medicationOrders.of')} {Math.ceil(total / 20)}</span>
            <div className="flex gap-2">
              <button onClick={() => fetchOrders(page - 1)} disabled={page <= 1} className="btn-secondary text-xs">{t('medicationOrders.previous')}</button>
              <button onClick={() => fetchOrders(page + 1)} disabled={page >= Math.ceil(total / 20)} className="btn-secondary text-xs">{t('medicationOrders.next')}</button>
            </div>
          </div>
        )}
      </div>

      {showNewModal && (
        <NewOrderModal
          patients={patients}
          selectedPatient={selectedPatient}
          onClose={() => setShowNewModal(false)}
          onDone={() => fetchOrders(page)}
        />
      )}
      {statusModal && (
        <StatusModal
          order={statusModal.order}
          action={statusModal.action}
          onClose={() => setStatusModal(null)}
          onDone={() => fetchOrders(page)}
        />
      )}
    </div>
  );
}
