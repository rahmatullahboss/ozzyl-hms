import { useState, useEffect, useCallback } from 'react';
import {
  Plus, X, RefreshCw, CheckCircle, Clock, ChevronRight,
  ArrowRightLeft, Pill,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import EmptyState from '../dashboard/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReconciliationItem {
  id: number;
  medication_name: string;
  generic_name?: string;
  dose?: string;
  route?: string;
  frequency?: string;
  source: string;
  action: string;
  action_reason?: string;
  new_dose?: string;
  new_route?: string;
  new_frequency?: string;
}

interface Reconciliation {
  id: number;
  patient_id: number;
  visit_id?: number;
  reconciliation_type: string;
  status: string;
  notes?: string;
  created_at: string;
  completed_at?: string;
  items?: ReconciliationItem[];
}

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  visit_id?: number;
}

interface ReconciliationTabProps {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
}

// ─── Action color ─────────────────────────────────────────────────────────────
function actionColor(action: string) {
  return {
    continue: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20',
    modify: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',
    discontinue: 'text-red-600 bg-red-50 dark:bg-red-900/20',
    add: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
  }[action] ?? 'text-slate-500 bg-slate-50';
}

// ─── Add Item Modal ───────────────────────────────────────────────────────────
function AddItemModal({
  reconId,
  onClose,
  onDone,
}: {
  reconId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('nursing');
  const [form, setForm] = useState({
    medication_name: '',
    generic_name: '',
    dose: '',
    route: '',
    frequency: '',
    source: 'home' as string,
    action: 'continue' as string,
    action_reason: '',
    new_dose: '',
    new_route: '',
    new_frequency: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.medication_name) { toast.error(t('reconciliation.medicationNameRequired')); return; }
    setSaving(true);
    try {
      await apiFetch(`/api/nursing/medication-reconciliation/${reconId}/items`, {
        method: 'POST',
        body: {
          medication_name: form.medication_name,
          generic_name: form.generic_name || undefined,
          dose: form.dose || undefined,
          route: form.route || undefined,
          frequency: form.frequency || undefined,
          source: form.source,
          action: form.action,
          action_reason: form.action_reason || undefined,
          new_dose: form.action === 'modify' ? form.new_dose || undefined : undefined,
          new_route: form.action === 'modify' ? form.new_route || undefined : undefined,
          new_frequency: form.action === 'modify' ? form.new_frequency || undefined : undefined,
        },
      });
      toast.success(t('reconciliation.itemAdded'));
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('reconciliation.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
          <h3 className="font-semibold">{t('reconciliation.addItemTitle')}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">{t('reconciliation.medicationName')} *</label>
              <input type="text" value={form.medication_name}
                onChange={e => setForm(f => ({ ...f, medication_name: e.target.value }))}
                placeholder={t('reconciliation.medicationNamePlaceholder')} className="input" required />
            </div>
            <div>
              <label className="label">{t('reconciliation.dose')}</label>
              <input type="text" value={form.dose}
                onChange={e => setForm(f => ({ ...f, dose: e.target.value }))}
                placeholder={t('reconciliation.dosePlaceholder')} className="input" />
            </div>
            <div>
              <label className="label">{t('reconciliation.route')}</label>
              <input type="text" value={form.route}
                onChange={e => setForm(f => ({ ...f, route: e.target.value }))}
                placeholder={t('reconciliation.routePlaceholder')} className="input" />
            </div>
            <div>
              <label className="label">{t('reconciliation.frequency')}</label>
              <input type="text" value={form.frequency}
                onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                placeholder={t('reconciliation.frequencyPlaceholder')} className="input" />
            </div>
            <div>
              <label className="label">{t('reconciliation.source')}</label>
              <select value={form.source}
                onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                className="input">
                {['home', 'inpatient', 'new'].map(s => (
                  <option key={s} value={s}>{t(`sources.${s}`)}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">{t('reconciliation.action')} *</label>
              <div className="grid grid-cols-4 gap-2">
                {['continue', 'modify', 'discontinue', 'add'].map(a => (
                  <button key={a} onClick={() => setForm(f => ({ ...f, action: a }))}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      form.action === a
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                        : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]'
                    }`}>
                    {t(`actions.${a}`)}
                  </button>
                ))}
              </div>
            </div>

            {form.action === 'modify' && (
              <>
                <div>
                  <label className="label">{t('reconciliation.newDose')}</label>
                  <input type="text" value={form.new_dose}
                    onChange={e => setForm(f => ({ ...f, new_dose: e.target.value }))}
                    placeholder={t('reconciliation.newDosePlaceholder')} className="input" />
                </div>
                <div>
                  <label className="label">{t('reconciliation.newFrequency')}</label>
                  <input type="text" value={form.new_frequency}
                    onChange={e => setForm(f => ({ ...f, new_frequency: e.target.value }))}
                    placeholder={t('reconciliation.newFrequencyPlaceholder')} className="input" />
                </div>
              </>
            )}

            {form.action !== 'continue' && (
              <div className="col-span-2">
                <label className="label">{t('reconciliation.reason')}</label>
                <input type="text" value={form.action_reason}
                  onChange={e => setForm(f => ({ ...f, action_reason: e.target.value }))}
                  placeholder={t('reconciliation.reasonPlaceholder')} className="input" />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose} className="btn-secondary">{t('reconciliation.cancel')}</button>
            <button onClick={handleSave} disabled={saving || !form.medication_name} className="btn-primary">
              {saving ? t('reconciliation.adding') : t('reconciliation.addItemButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── New Reconciliation Modal ─────────────────────────────────────────────────
function NewReconciliationModal({
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
    reconciliation_type: 'admission' as string,
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.patient_id) { toast.error(t('reconciliation.patientRequired')); return; }
    setSaving(true);
    try {
      const pt = patients.find(p => p.patient_id === parseInt(form.patient_id));
      await apiFetch('/api/nursing/medication-reconciliation', {
        method: 'POST',
        body: {
          patient_id: parseInt(form.patient_id),
          visit_id: pt?.visit_id,
          reconciliation_type: form.reconciliation_type,
          notes: form.notes || undefined,
        },
      });
      toast.success(t('reconciliation.reconciliationStarted'));
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('reconciliation.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="font-semibold">{t('reconciliation.startTitle')}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">{t('reconciliation.patient')} *</label>
            <select value={form.patient_id}
              onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))}
              className="input" required>
              <option value="">{t('medicationOrders.selectPatient')}</option>
              {patients.map(p => (
                <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('reconciliation.type')} *</label>
            <div className="grid grid-cols-3 gap-2">
              {['admission', 'transfer', 'discharge'].map((type) => (
                <button key={type} onClick={() => setForm(f => ({ ...f, reconciliation_type: type }))}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    form.reconciliation_type === type
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]'
                  }`}>
                  {t(`reconciliationTypes.${type}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              {form.reconciliation_type === 'admission' && t('reconciliation.typeDescriptions.admission')}
              {form.reconciliation_type === 'transfer' && t('reconciliation.typeDescriptions.transfer')}
              {form.reconciliation_type === 'discharge' && t('reconciliation.typeDescriptions.discharge')}
            </p>
          </div>
          <div>
            <label className="label">{t('reconciliation.notes')}</label>
            <textarea value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder={t('reconciliation.notesPlaceholder')} rows={2} className="input resize-none" />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="btn-secondary">{t('reconciliation.cancel')}</button>
            <button onClick={handleSave} disabled={saving || !form.patient_id} className="btn-primary">
              {saving ? t('reconciliation.starting') : t('reconciliation.startReconciliation')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────
function ReconciliationDetail({
  recon,
  onComplete,
  onAddItem,
}: {
  recon: Reconciliation;
  onComplete: () => void;
  onAddItem: () => void;
}) {
  const { t } = useTranslation('nursing');
  const [completing, setCompleting] = useState(false);

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await apiFetch(`/api/nursing/medication-reconciliation/${recon.id}/complete`, { method: 'PUT', body: {} });
      toast.success(t('reconciliation.reconciliationCompleted'));
      onComplete();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('reconciliation.failed'));
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {t(`reconciliationTypes.${recon.reconciliation_type}`)} {t('reconciliation.title')}
          <span className={`ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
            recon.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {recon.status === 'completed' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            {t(`reconciliation.statuses.${recon.status}`, { defaultValue: recon.status.replace(/_/g, ' ') })}
          </span>
        </h3>
        {recon.status === 'in_progress' && (
          <div className="flex gap-2">
            <button onClick={onAddItem} className="btn-secondary text-xs">
              <Plus className="w-3.5 h-3.5" /> {t('reconciliation.addItemButton')}
            </button>
            <button onClick={handleComplete} disabled={completing} className="btn-primary text-xs">
              {completing ? t('reconciliation.completing') : <><CheckCircle className="w-3.5 h-3.5" /> {t('reconciliation.completeAndSign')}</>}
            </button>
          </div>
        )}
      </div>

      {recon.notes && (
        <p className="text-sm text-[var(--color-text-secondary)] bg-[var(--color-surface-2)] rounded-lg px-3 py-2">
          {recon.notes}
        </p>
      )}

      {/* Items table */}
      {recon.items && recon.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('reconciliation.medicationName')}</th>
                <th>{t('reconciliation.currentDose')}</th>
                <th>{t('reconciliation.source')}</th>
                <th>{t('reconciliation.action')}</th>
                <th>{t('reconciliation.newDoseFreq')}</th>
              </tr>
            </thead>
            <tbody>
              {recon.items.map(item => (
                <tr key={item.id}>
                  <td>
                    <div className="font-medium text-sm">{item.medication_name}</div>
                    {item.generic_name && <div className="text-xs text-[var(--color-text-muted)]">{item.generic_name}</div>}
                  </td>
                  <td className="text-sm">
                    {item.dose || '—'}{item.route && ` · ${item.route}`}{item.frequency && ` · ${item.frequency}`}
                  </td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {t(`sources.${item.source}`, { defaultValue: item.source })}
                    </span>
                  </td>
                  <td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionColor(item.action)}`}>
                      {t(`actions.${item.action}`, { defaultValue: item.action })}
                    </span>
                  </td>
                  <td className="text-xs text-[var(--color-text-secondary)]">
                    {item.action === 'modify' ? (
                      <>
                        {item.new_dose && `${t('reconciliation.dose')}: ${item.new_dose}`}
                        {item.new_frequency && ` · ${t('reconciliation.frequency')}: ${item.new_frequency}`}
                      </>
                    ) : (
                      item.action_reason || '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)] text-center py-4">
          {t('reconciliation.noItems')} {recon.status === 'in_progress' && t('reconciliation.addMedications')}
        </p>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ReconciliationTab({ patients, selectedPatient, onSelectPatient }: ReconciliationTabProps) {
  const { t } = useTranslation('nursing');
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Reconciliation | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [addItemModal, setAddItemModal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchList = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), limit: '20' });
      if (selectedPatient) qs.set('patient_id', String(selectedPatient));
      const data = await apiFetch<{ Results?: Reconciliation[]; pagination?: { total?: number } }>(`/api/nursing/medication-reconciliation?${qs}`);
      setReconciliations(data.Results ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(p);
    } catch {
      toast.error(t('reconciliation.failedToLoad'));
      setReconciliations([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPatient, t]);

  const fetchDetail = async (id: number) => {
    try {
      const data = await apiFetch<{ Results: Reconciliation }>(`/api/nursing/medication-reconciliation/${id}`);
      setSelected(data.Results);
    } catch {
      toast.error(t('reconciliation.failedToLoadDetails'));
    }
  };

  useEffect(() => { fetchList(); }, [fetchList]);

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
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => fetchList(page)} className="btn-ghost p-2" aria-label={t('medicationOrders.refresh')}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowNewModal(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('reconciliation.startReconciliation')}
          </button>
        </div>
      </div>

      {/* ── List + Detail ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* List */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              {t('reconciliation.title')} {total > 0 && <span className="text-[var(--color-text-muted)] font-normal">({total})</span>}
            </h2>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {loading ? (
              [...Array(4)].map((_, i) => (
                <div key={i} className="p-3 space-y-2">
                  <div className="skeleton h-4 w-3/4 rounded" />
                  <div className="skeleton h-3 w-1/2 rounded" />
                </div>
              ))
            ) : reconciliations.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<ArrowRightLeft className="w-7 h-7 text-[var(--color-text-muted)]" />}
                  title={t('reconciliation.noReconciliations')}
                  description={t('reconciliation.noReconciliationsDesc')}
                />
              </div>
            ) : (
              reconciliations.map(r => (
                <button
                  key={r.id}
                  onClick={() => fetchDetail(r.id)}
                  className={`w-full text-left p-3 hover:bg-[var(--color-surface-hover)] transition-colors ${
                    selected?.id === r.id ? 'bg-[var(--color-surface-2)]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t(`reconciliationTypes.${r.reconciliation_type}`, { defaultValue: r.reconciliation_type })}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      r.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>{t(`reconciliation.statuses.${r.status}`, { defaultValue: r.status.replace(/_/g, ' ') })}</span>
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                  {r.notes && <div className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-1">{r.notes}</div>}
                </button>
              ))
            )}
          </div>
          {total > 20 && (
            <div className="px-3 py-2 border-t border-[var(--color-border)] flex gap-2 justify-center">
              <button onClick={() => fetchList(page - 1)} disabled={page <= 1} className="btn-secondary text-xs">{t('medicationOrders.previous')}</button>
              <button onClick={() => fetchList(page + 1)} disabled={page >= Math.ceil(total / 20)} className="btn-secondary text-xs">{t('medicationOrders.next')}</button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-2">
          {selected ? (
            <ReconciliationDetail
              recon={selected}
              onComplete={() => { fetchDetail(selected.id); fetchList(page); }}
              onAddItem={() => setAddItemModal(selected.id)}
            />
          ) : (
            <div className="card p-8 flex flex-col items-center justify-center text-center h-full min-h-48">
              <ArrowRightLeft className="w-10 h-10 text-[var(--color-text-muted)] mb-3" />
              <p className="text-sm text-[var(--color-text-muted)]">{t('reconciliation.selectReconciliation')}</p>
            </div>
          )}
        </div>
      </div>

      {showNewModal && (
        <NewReconciliationModal
          patients={patients}
          selectedPatient={selectedPatient}
          onClose={() => setShowNewModal(false)}
          onDone={() => fetchList(page)}
        />
      )}
      {addItemModal && (
        <AddItemModal
          reconId={addItemModal}
          onClose={() => setAddItemModal(null)}
          onDone={() => selected && fetchDetail(selected.id)}
        />
      )}
    </div>
  );
}
