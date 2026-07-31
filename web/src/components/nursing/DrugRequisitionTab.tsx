import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  Pill, Plus, X, RefreshCw, Eye, Trash2, ChevronDown, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import EmptyState from '../dashboard/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DrugRequisitionItem {
  id: number;
  drug_name: string;
  generic_name: string | null;
  quantity: number;
  unit: string;
  remarks: string | null;
}

interface DrugRequisition {
  id: number;
  patient_id: number | null;
  visit_id: number | null;
  ward_id: number | null;
  status: 'pending' | 'dispensed' | 'cancelled';
  remarks: string | null;
  requested_by: string;
  requested_on: string;
  dispensed_by: string | null;
  dispensed_on: string | null;
  patient_name: string | null;
  patient_code: string | null;
  items?: DrugRequisitionItem[];
}

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  visit_id?: number;
}

interface DrugRequisitionTabProps {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
  wardId?: number;
}

interface NewItemRow {
  drug_name: string;
  quantity: number;
  unit: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DrugRequisitionTab({
  patients,
  selectedPatient,
  onSelectPatient,
  wardId,
}: DrugRequisitionTabProps) {
  const { t } = useTranslation('nursing');
  const [requisitions, setRequisitions] = useState<DrugRequisition[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [formPatientId, setFormPatientId] = useState<string>(
    selectedPatient ? String(selectedPatient) : '',
  );
  const [formRemarks, setFormRemarks] = useState('');
  const [formItems, setFormItems] = useState<NewItemRow[]>([
    { drug_name: '', quantity: 1, unit: 'tablets' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // ── Fetch requisitions ──

  const fetchRequisitions = useCallback(
    async (p = 1) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ page: String(p), limit: '20' });
        if (selectedPatient) qs.set('patient_id', String(selectedPatient));
        const data = await apiFetch<{
          Results?: DrugRequisition[];
          pagination?: { total?: number };
        }>(`/api/nursing/drug-requisition?${qs}`);
        setRequisitions(data.Results ?? []);
        setTotal(data.pagination?.total ?? 0);
        setPage(p);
      } catch {
        toast.error(t('drugRequisition.failedToLoad'));
        setRequisitions([]);
      } finally {
        setLoading(false);
      }
    },
    [selectedPatient, t],
  );

  useEffect(() => {
    fetchRequisitions();
  }, [fetchRequisitions]);

  // ── Fetch single requisition detail ──

  const fetchDetail = useCallback(
    async (id: number) => {
      setDetailLoading(id);
      try {
        const data = await apiFetch<DrugRequisition>(
          `/api/nursing/drug-requisition/${id}`,
        );
        setRequisitions((prev) =>
          prev.map((r) => (r.id === id ? { ...r, items: data.items } : r)),
        );
        setExpandedId(id);
      } catch {
        toast.error(t('drugRequisition.failedToLoadDetail'));
      } finally {
        setDetailLoading(null);
      }
    },
    [t],
  );

  const toggleExpand = useCallback(
    (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      const existing = requisitions.find((r) => r.id === id);
      if (existing?.items) {
        setExpandedId(id);
      } else {
        fetchDetail(id);
      }
    },
    [expandedId, requisitions, fetchDetail],
  );

  // ── Cancel requisition ──

  const handleCancel = useCallback(
    async (id: number) => {
      if (!confirm(t('drugRequisition.confirmCancel'))) return;
      try {
        await apiFetch(`/api/nursing/drug-requisition/${id}/cancel`, {
          method: 'PUT',
        });
        toast.success(t('drugRequisition.cancelled'));
        fetchRequisitions(page);
      } catch (err) {
        toast.error(
          err instanceof ApiClientError
            ? err.message
            : t('drugRequisition.cancelFailed'),
        );
      }
    },
    [fetchRequisitions, page, t],
  );

  // ── Create requisition ──

  const handleCreate = useCallback(async () => {
    const validItems = formItems.filter((item) => item.drug_name.trim());
    if (validItems.length === 0) {
      toast.error(t('drugRequisition.atLeastOneItem'));
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        items: validItems.map((item) => ({
          drug_name: item.drug_name.trim(),
          quantity: item.quantity,
          unit: item.unit.trim() || 'tablets',
        })),
      };
      if (formPatientId) {
        payload.patient_id = parseInt(formPatientId);
        const patient = patients.find(
          (p) => p.patient_id === parseInt(formPatientId),
        );
        if (patient?.visit_id) payload.visit_id = patient.visit_id;
      }
      if (wardId) payload.ward_id = wardId;
      if (formRemarks.trim()) payload.remarks = formRemarks.trim();

      await apiFetch('/api/nursing/drug-requisition', {
        method: 'POST',
        body: payload,
      });
      toast.success(t('drugRequisition.created'));
      setShowModal(false);
      resetForm();
      fetchRequisitions(page);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : t('drugRequisition.createFailed'),
      );
    } finally {
      setSubmitting(false);
    }
  }, [formItems, formPatientId, formRemarks, patients, wardId, fetchRequisitions, page, t]);

  // ── Form helpers ──

  const resetForm = useCallback(() => {
    setFormPatientId(selectedPatient ? String(selectedPatient) : '');
    setFormRemarks('');
    setFormItems([{ drug_name: '', quantity: 1, unit: 'tablets' }]);
  }, [selectedPatient]);

  const openModal = useCallback(() => {
    resetForm();
    setShowModal(true);
  }, [resetForm]);

  const addFormItem = useCallback(() => {
    setFormItems((prev) => [...prev, { drug_name: '', quantity: 1, unit: 'tablets' }]);
  }, []);

  const removeFormItem = useCallback((index: number) => {
    setFormItems((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const updateFormItem = useCallback(
    (index: number, field: keyof NewItemRow, value: string | number) => {
      setFormItems((prev) =>
        prev.map((item, i) =>
          i === index ? { ...item, [field]: value } : item,
        ),
      );
    },
    [],
  );

  // ── Status badge ──

  const statusBadge = (status: DrugRequisition['status']) => {
    const classes: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
      dispensed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${classes[status] ?? classes.pending}`}>
        {t(`drugRequisition.status.${status}`)}
      </span>
    );
  };

  // ── Date formatting ──

  const fmtDate = (d: string | null) =>
    d
      ? new Date(d).toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

  // ── Render ──

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">
            {t('drugRequisition.patient')}:
          </label>
          <select
            value={selectedPatient ?? ''}
            onChange={(e) =>
              onSelectPatient(
                e.target.value ? parseInt(e.target.value) : null,
              )
            }
            className="input max-w-xs"
          >
            <option value="">{t('drugRequisition.allPatients')}</option>
            {patients.map((p) => (
              <option key={p.patient_id} value={p.patient_id}>
                {p.name} ({p.patient_code})
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => fetchRequisitions(page)}
            className="btn-ghost p-2"
            aria-label={t('drugRequisition.refresh')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={openModal} className="btn-primary">
            <Plus className="w-4 h-4" />{' '}
            {t('drugRequisition.newRequisition')}
          </button>
        </div>
      </div>

      {/* ── Requisitions Table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {t('drugRequisition.title')}
            {total > 0 && (
              <span className="ml-2 text-[var(--color-text-muted)] font-normal">
                ({total})
              </span>
            )}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-8" />
                <th>{t('drugRequisition.date')}</th>
                <th>{t('drugRequisition.patient')}</th>
                <th>{t('drugRequisition.status')}</th>
                <th className="text-center">{t('drugRequisition.itemsCount')}</th>
                <th>{t('drugRequisition.remarks')}</th>
                <th>{t('drugRequisition.requestedBy')}</th>
                <th>{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(8)].map((_, j) => (
                      <td key={j}>
                        <div className="skeleton h-4 w-full rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : requisitions.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={
                        <Pill className="w-8 h-8 text-[var(--color-text-muted)]" />
                      }
                      title={t('drugRequisition.noRequisitions')}
                      description={t('drugRequisition.noRequisitionsDesc')}
                    />
                  </td>
                </tr>
              ) : (
                requisitions.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="hover:bg-[var(--color-surface-hover)]">
                      <td>
                        <button
                          onClick={() => toggleExpand(r.id)}
                          className="btn-ghost p-1"
                          aria-label={
                            expandedId === r.id
                              ? t('common:collapse')
                              : t('common:expand')
                          }
                        >
                          {detailLoading === r.id ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : expandedId === r.id ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="font-data text-xs text-[var(--color-text-muted)]">
                        {fmtDate(r.requested_on)}
                      </td>
                      <td className="font-medium text-sm">
                        {r.patient_name
                          ? `${r.patient_name} (${r.patient_code})`
                          : '—'}
                      </td>
                      <td>{statusBadge(r.status)}</td>
                      <td className="text-center text-sm font-data">
                        {r.items?.length ?? '—'}
                      </td>
                      <td className="text-sm max-w-32 truncate">
                        {r.remarks || '—'}
                      </td>
                      <td className="text-sm text-[var(--color-text-secondary)]">
                        {r.requested_by || '—'}
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => toggleExpand(r.id)}
                            className="btn-ghost p-1.5"
                            title={t('drugRequisition.viewDetails')}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {r.status === 'pending' && (
                            <button
                              onClick={() => handleCancel(r.id)}
                              className="btn-ghost p-1.5 text-red-600"
                              title={t('drugRequisition.cancel')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* ── Expanded items row ── */}
                    {expandedId === r.id && r.items && (
                      <tr>
                        <td colSpan={8} className="bg-[var(--color-surface)] px-6 py-3">
                          <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-[var(--color-surface-hover)]">
                                  <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                                    {t('drugRequisition.drugName')}
                                  </th>
                                  <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                                    {t('drugRequisition.genericName')}
                                  </th>
                                  <th className="px-3 py-2 text-right font-medium text-[var(--color-text-secondary)]">
                                    {t('drugRequisition.quantity')}
                                  </th>
                                  <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                                    {t('drugRequisition.unit')}
                                  </th>
                                  <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                                    {t('drugRequisition.remarks')}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.items.map((item) => (
                                  <tr
                                    key={item.id}
                                    className="border-t border-[var(--color-border)]"
                                  >
                                    <td className="px-3 py-2 font-medium">
                                      {item.drug_name}
                                    </td>
                                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                                      {item.generic_name || '—'}
                                    </td>
                                    <td className="px-3 py-2 text-right font-data">
                                      {item.quantity}
                                    </td>
                                    <td className="px-3 py-2">
                                      {item.unit}
                                    </td>
                                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                                      {item.remarks || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Dispensed info */}
                          {r.dispensed_by && (
                            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                              {t('drugRequisition.dispensedBy')}{' '}
                              {r.dispensed_by} {t('drugRequisition.on')}{' '}
                              {fmtDate(r.dispensed_on)}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 20 && (
          <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">
              {t('drugRequisition.page')} {page} {t('drugRequisition.of')}{' '}
              {Math.ceil(total / 20)}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => fetchRequisitions(page - 1)}
                disabled={page <= 1}
                className="btn-secondary text-xs"
              >
                {t('common:previous')}
              </button>
              <button
                onClick={() => fetchRequisitions(page + 1)}
                disabled={page >= Math.ceil(total / 20)}
                className="btn-secondary text-xs"
              >
                {t('common:next')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── New Requisition Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">
                {t('drugRequisition.newRequisition')}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="btn-ghost p-1.5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Patient selector */}
              <div>
                <label className="label">
                  {t('drugRequisition.patient')}
                </label>
                <select
                  value={formPatientId}
                  onChange={(e) => setFormPatientId(e.target.value)}
                  className="input"
                >
                  <option value="">
                    {t('drugRequisition.noSpecificPatient')}
                  </option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.name} ({p.patient_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Remarks */}
              <div>
                <label className="label">
                  {t('drugRequisition.remarks')}
                </label>
                <textarea
                  value={formRemarks}
                  onChange={(e) => setFormRemarks(e.target.value)}
                  className="input min-h-[72px] resize-y"
                  placeholder={t('drugRequisition.remarksPlaceholder')}
                />
              </div>

              {/* Dynamic items list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">
                    {t('drugRequisition.items')} *
                  </label>
                  <button
                    type="button"
                    onClick={addFormItem}
                    className="btn-ghost text-xs text-[var(--color-primary)]"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {t('drugRequisition.addItem')}
                  </button>
                </div>

                <div className="space-y-3">
                  {formItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
                    >
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="sm:col-span-1">
                          <label className="text-xs text-[var(--color-text-muted)]">
                            {t('drugRequisition.drugName')} *
                          </label>
                          <input
                            type="text"
                            value={item.drug_name}
                            onChange={(e) =>
                              updateFormItem(idx, 'drug_name', e.target.value)
                            }
                            className="input text-sm"
                            placeholder={t('drugRequisition.drugNamePlaceholder')}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--color-text-muted)]">
                            {t('drugRequisition.quantity')}
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) =>
                              updateFormItem(
                                idx,
                                'quantity',
                                Math.max(1, parseInt(e.target.value) || 1),
                              )
                            }
                            className="input text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--color-text-muted)]">
                            {t('drugRequisition.unit')}
                          </label>
                          <input
                            type="text"
                            value={item.unit}
                            onChange={(e) =>
                              updateFormItem(idx, 'unit', e.target.value)
                            }
                            className="input text-sm"
                            placeholder="tablets"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFormItem(idx)}
                        disabled={formItems.length <= 1}
                        className="btn-ghost p-1.5 mt-5 text-red-500 disabled:opacity-30"
                        title={t('drugRequisition.removeItem')}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 p-5 border-t border-[var(--color-border)]">
              <button
                onClick={() => setShowModal(false)}
                className="btn-secondary"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting || formItems.every((i) => !i.drug_name.trim())}
                className="btn-primary"
              >
                {submitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  t('common:create')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


