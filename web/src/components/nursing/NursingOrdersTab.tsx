import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList, Plus, X, RefreshCw, Clock, AlertTriangle, CheckCircle,
  XCircle, FileText, FlaskConical, Scan, Stethoscope, Package,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import EmptyState from '../dashboard/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NursingOrder {
  id: number;
  patient_id: number;
  visit_id: number;
  order_type: 'lab' | 'radiology' | 'procedure' | 'other';
  item_name: string;
  item_id: number | null;
  service_department_id: number | null;
  quantity: number;
  priority: 'stat' | 'urgent' | 'routine';
  instructions: string | null;
  ordered_by: number;
  ordered_by_name: string;
  status: 'pending' | 'accepted' | 'completed' | 'cancelled';
  created_at: string;
}

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  visit_id?: number;
}

interface NursingOrdersTabProps {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const priorityBadge: Record<string, string> = {
  stat: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  urgent: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  routine: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

const typeBadge: Record<string, string> = {
  lab: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  radiology: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  procedure: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
};

const statusBadge: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  accepted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
};

const typeIcon: Record<string, typeof FlaskConical> = {
  lab: FlaskConical,
  radiology: Scan,
  procedure: Stethoscope,
  other: Package,
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function NursingOrdersTab({ patients, selectedPatient, onSelectPatient }: NursingOrdersTabProps) {
  const { t } = useTranslation('nursing');
  const [orders, setOrders] = useState<NursingOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const [form, setForm] = useState({
    patient_id: selectedPatient ? String(selectedPatient) : '',
    order_type: 'lab' as NursingOrder['order_type'],
    item_name: '',
    priority: 'routine' as NursingOrder['priority'],
    instructions: '',
  });

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (selectedPatient) qs.set('patient_id', String(selectedPatient));
      const data = await apiFetch<{ Results?: NursingOrder[]; results?: NursingOrder[] }>(`/api/nursing/nursing-orders?${qs}`);
      setOrders(data.Results ?? data.results ?? []);
    } catch {
      toast.error(t('orders.failedToLoad'));
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPatient, t]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const statCount = orders.filter(o => o.priority === 'stat' && o.status !== 'completed' && o.status !== 'cancelled').length;

  const handleCreate = async () => {
    if (!form.patient_id || !form.item_name) {
      toast.error(t('orders.fieldsRequired'));
      return;
    }

    const patient = patients.find(p => p.patient_id === parseInt(form.patient_id));
    const payload = {
      patient_id: parseInt(form.patient_id),
      visit_id: patient?.visit_id ?? 0,
      order_type: form.order_type,
      item_name: form.item_name,
      priority: form.priority,
      instructions: form.instructions || undefined,
      ordered_by: 0,
    };

    setSaving(true);
    try {
      await apiFetch('/api/nursing/nursing-orders', { method: 'POST', body: payload });
      toast.success(t('orders.created'));
      setShowModal(false);
      fetchOrders();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('orders.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleStatusUpdate = async (id: number, status: NursingOrder['status']) => {
    setUpdatingId(id);
    try {
      await apiFetch(`/api/nursing/nursing-orders/${id}/status`, { method: 'PUT', body: { status } });
      toast.success(t('orders.statusUpdated'));
      fetchOrders();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('orders.statusUpdateFailed'));
    } finally {
      setUpdatingId(null);
    }
  };

  const openModal = () => {
    setForm({
      patient_id: selectedPatient ? String(selectedPatient) : '',
      order_type: 'lab',
      item_name: '',
      priority: 'routine',
      instructions: '',
    });
    setShowModal(true);
  };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('orders.patient')}:</label>
          <select
            value={selectedPatient ?? ''}
            onChange={e => onSelectPatient(e.target.value ? parseInt(e.target.value) : null)}
            className="input max-w-xs"
          >
            <option value="">{t('orders.allPatients')}</option>
            {patients.map(p => (
              <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={fetchOrders} className="btn-ghost p-2" aria-label={t('orders.refresh')}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={openModal} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('orders.newOrder')}
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      {selectedPatient && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-4 border-l-4 border-l-amber-500">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{t('orders.pendingOrders')}</p>
              </div>
            </div>
          </div>

          <div className="card p-4 border-l-4 border-l-red-500">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">{statCount}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{t('orders.statOrders')}</p>
              </div>
            </div>
          </div>

          <div className="card p-4 border-l-4 border-l-blue-500">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-600">{orders.length}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{t('orders.totalOrders')}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Orders Table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {t('orders.title')}
            {orders.length > 0 && <span className="ml-2 text-[var(--color-text-muted)] font-normal">({orders.length})</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('orders.date')}</th>
                <th>{t('orders.type')}</th>
                <th>{t('orders.item')}</th>
                <th>{t('orders.priority')}</th>
                <th>{t('orders.status')}</th>
                <th>{t('orders.orderedBy')}</th>
                <th>{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={<ClipboardList className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('orders.noOrders')}
                      description={t('orders.noOrdersDesc')}
                    />
                  </td>
                </tr>
              ) : (
                orders.map(order => {
                  const TypeIcon = typeIcon[order.order_type] ?? Package;
                  return (
                    <tr key={order.id} className="hover:bg-[var(--color-surface-hover)]">
                      <td className="font-data text-xs text-[var(--color-text-muted)]">
                        {order.created_at ? new Date(order.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${typeBadge[order.order_type]}`}>
                          <TypeIcon className="w-3.5 h-3.5" />
                          {t(`orders.type_${order.order_type}`)}
                        </span>
                      </td>
                      <td className="font-medium text-sm">{order.item_name}</td>
                      <td>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${priorityBadge[order.priority]}`}>
                          {t(`orders.priority_${order.priority}`)}
                        </span>
                      </td>
                      <td>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusBadge[order.status]}`}>
                          {t(`orders.status_${order.status}`)}
                        </span>
                      </td>
                      <td className="text-sm text-[var(--color-text-secondary)]">{order.ordered_by_name || '—'}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          {order.status === 'pending' && (
                            <button
                              onClick={() => handleStatusUpdate(order.id, 'accepted')}
                              disabled={updatingId === order.id}
                              className="btn-ghost p-1.5 text-blue-600"
                              title={t('orders.accept')}
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {(order.status === 'pending' || order.status === 'accepted') && (
                            <button
                              onClick={() => handleStatusUpdate(order.id, 'completed')}
                              disabled={updatingId === order.id}
                              className="btn-ghost p-1.5 text-emerald-600"
                              title={t('orders.complete')}
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {order.status !== 'completed' && order.status !== 'cancelled' && (
                            <button
                              onClick={() => handleStatusUpdate(order.id, 'cancelled')}
                              disabled={updatingId === order.id}
                              className="btn-ghost p-1.5 text-red-600"
                              title={t('orders.cancel')}
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── New Order Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('orders.newOrder')}</h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">{t('orders.patient')} *</label>
                <select value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} className="input" required>
                  <option value="">{t('orders.selectPatient')}</option>
                  {patients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">{t('orders.orderType')} *</label>
                <select value={form.order_type} onChange={e => setForm(f => ({ ...f, order_type: e.target.value as NursingOrder['order_type'] }))} className="input">
                  <option value="lab">{t('orders.type_lab')}</option>
                  <option value="radiology">{t('orders.type_radiology')}</option>
                  <option value="procedure">{t('orders.type_procedure')}</option>
                  <option value="other">{t('orders.type_other')}</option>
                </select>
              </div>

              <div>
                <label className="label">{t('orders.itemName')} *</label>
                <input
                  type="text"
                  value={form.item_name}
                  onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))}
                  placeholder={t('orders.itemNamePlaceholder')}
                  className="input"
                />
              </div>

              <div>
                <label className="label">{t('orders.priority')} *</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['stat', 'urgent', 'routine'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setForm(f => ({ ...f, priority: p }))}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        form.priority === p
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                          : 'border-[var(--color-border)] hover:border-[var(--color-primary)] text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {t(`orders.priority_${p}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">{t('orders.instructions')}</label>
                <textarea
                  value={form.instructions}
                  onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                  placeholder={t('orders.instructionsPlaceholder')}
                  className="input min-h-[80px] resize-y"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleCreate} disabled={saving || !form.patient_id || !form.item_name} className="btn-primary">
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
