import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, ClipboardList, FileSignature, Loader2, Pill, Plus, Save, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/apiClient';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

export type ReconciliationType = 'admission' | 'transfer' | 'discharge';
export type ReconciliationAction = 'continue' | 'modify' | 'discontinue' | 'add';

type RawRecord = Record<string, unknown>;

interface MedicationReconciliationPanelProps {
  patientId: number;
  visitId?: number | null;
  admissionId?: number | null;
  basePath?: string;
  defaultType?: ReconciliationType;
  onCompleted?: () => void;
}

interface ReconciliationRecord {
  id: number;
  patientId: number;
  visitId: number;
  type: ReconciliationType;
  status: string;
  notes: string;
  completedAt: string | null;
}

interface ReconciliationItem {
  id: number;
  medicationName: string;
  genericName: string;
  dose: string;
  route: string;
  frequency: string;
  source: 'home' | 'inpatient' | 'new';
  action: ReconciliationAction;
  actionReason: string;
  newDose: string;
  newRoute: string;
  newFrequency: string;
}

interface ItemDraft {
  action: ReconciliationAction;
  actionReason: string;
  newDose: string;
  newRoute: string;
  newFrequency: string;
}

const EMPTY_NEW_ITEM = {
  medicationName: '',
  genericName: '',
  dose: '',
  route: 'oral',
  frequency: '',
  actionReason: '',
};

function field<T>(record: RawRecord, camel: string, snake: string, fallback: T): T {
  const value = record[camel] ?? record[snake];
  return (value === undefined || value === null ? fallback : value) as T;
}

function normalizeReconciliation(record: RawRecord): ReconciliationRecord {
  return {
    id: Number(record.id),
    patientId: Number(field(record, 'patientId', 'patient_id', 0)),
    visitId: Number(field(record, 'visitId', 'visit_id', 0)),
    type: field(record, 'reconciliationType', 'reconciliation_type', 'admission') as ReconciliationType,
    status: String(record.status ?? 'in_progress'),
    notes: String(record.notes ?? ''),
    completedAt: field<string | null>(record, 'completedAt', 'completed_at', null),
  };
}

function normalizeItem(record: RawRecord): ReconciliationItem {
  return {
    id: Number(record.id),
    medicationName: String(field(record, 'medicationName', 'medication_name', 'Unknown medication')),
    genericName: String(field(record, 'genericName', 'generic_name', '')),
    dose: String(record.dose ?? ''),
    route: String(record.route ?? ''),
    frequency: String(record.frequency ?? ''),
    source: String(record.source ?? 'home') as ReconciliationItem['source'],
    action: String(record.action ?? 'continue') as ReconciliationAction,
    actionReason: String(field(record, 'actionReason', 'action_reason', '')),
    newDose: String(field(record, 'newDose', 'new_dose', '')),
    newRoute: String(field(record, 'newRoute', 'new_route', '')),
    newFrequency: String(field(record, 'newFrequency', 'new_frequency', '')),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function typeLabel(type: ReconciliationType): string {
  if (type === 'admission') return 'Admission';
  if (type === 'transfer') return 'Transfer';
  return 'Discharge';
}

export function MedicationReconciliationPanel({
  patientId,
  visitId,
  admissionId,
  basePath,
  defaultType = 'discharge',
  onCompleted,
}: MedicationReconciliationPanelProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [transitionType, setTransitionType] = useState<ReconciliationType>(defaultType);
  const [startNotes, setStartNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [itemDrafts, setItemDrafts] = useState<Record<number, ItemDraft>>({});
  const [newItem, setNewItem] = useState(EMPTY_NEW_ITEM);

  const historyKey = ['medication-reconciliation', 'patient', patientId] as const;
  const historyQuery = useApiQuery<{ Results?: RawRecord[] }>(
    historyKey,
    `/api/nursing/medication-reconciliation/patient/${patientId}`,
    { enabled: patientId > 0 },
  );
  const history = useMemo(
    () => (historyQuery.data?.Results ?? []).map(normalizeReconciliation),
    [historyQuery.data?.Results],
  );
  const currentVisitHistory = useMemo(
    () => history.filter((record) => !visitId || record.visitId === visitId),
    [history, visitId],
  );

  useEffect(() => {
    setSelectedId(null);
  }, [patientId, visitId]);

  useEffect(() => {
    if (selectedId !== null) return;
    const open = currentVisitHistory.find((record) => record.status === 'in_progress');
    setSelectedId(open?.id ?? currentVisitHistory[0]?.id ?? null);
  }, [currentVisitHistory, selectedId]);

  const detailKey = ['medication-reconciliation', 'detail', selectedId ?? 0] as const;
  const detailQuery = useApiQuery<{ Results?: RawRecord & { items?: RawRecord[] } }>(
    detailKey,
    selectedId
      ? `/api/nursing/medication-reconciliation/${selectedId}`
      : '/api/nursing/medication-reconciliation/0',
    { enabled: Boolean(selectedId) },
  );
  const selected = detailQuery.data?.Results
    ? normalizeReconciliation(detailQuery.data.Results)
    : currentVisitHistory.find((record) => record.id === selectedId) ?? null;
  const items = useMemo(
    () => (detailQuery.data?.Results?.items ?? []).map(normalizeItem),
    [detailQuery.data?.Results?.items],
  );
  const linkedPrescription = useMemo(() => {
    const raw = detailQuery.data?.Results?.linked_prescription as RawRecord | null | undefined;
    if (!raw?.id) return null;
    return {
      id: Number(raw.id),
      rxNo: String(field(raw, 'rxNo', 'rx_no', '')),
      status: String(raw.status ?? 'draft'),
    };
  }, [detailQuery.data?.Results?.linked_prescription]);

  useEffect(() => {
    const next: Record<number, ItemDraft> = {};
    for (const item of items) {
      next[item.id] = {
        action: item.action,
        actionReason: item.actionReason,
        newDose: item.newDose,
        newRoute: item.newRoute,
        newFrequency: item.newFrequency,
      };
    }
    setItemDrafts(next);
  }, [items]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: historyKey }),
      queryClient.invalidateQueries({ queryKey: detailKey }),
    ]);
  };

  const startReconciliation = async () => {
    if (!visitId) {
      toast.error('An active IPD visit is required before medication reconciliation can start.');
      return;
    }
    setBusy('start');
    try {
      const response = await api.post<{ Results?: { id?: number } }>(
        '/api/nursing/medication-reconciliation',
        {
          patient_id: patientId,
          visit_id: visitId,
          reconciliation_type: transitionType,
          notes: startNotes.trim() || undefined,
        },
      );
      const id = Number(response.Results?.id ?? 0);
      if (id) setSelectedId(id);
      setStartNotes('');
      await invalidate();
      toast.success(`${typeLabel(transitionType)} medication reconciliation started`);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to start medication reconciliation'));
    } finally {
      setBusy(null);
    }
  };

  const updateItem = async (item: ReconciliationItem) => {
    if (!selectedId) return;
    const draft = itemDrafts[item.id];
    if (!draft) return;
    if (draft.action === 'discontinue' && !draft.actionReason.trim()) {
      toast.error('Add a reason before discontinuing a medication.');
      return;
    }
    if (draft.action === 'modify' && ![draft.newDose, draft.newRoute, draft.newFrequency].some((value) => value.trim())) {
      toast.error('Enter at least one new dose, route, or frequency before saving a modification.');
      return;
    }
    setBusy(`item-${item.id}`);
    try {
      await api.put(`/api/nursing/medication-reconciliation/${selectedId}/items/${item.id}`, {
        action: draft.action,
        action_reason: draft.actionReason.trim() || undefined,
        new_dose: draft.action === 'modify' ? draft.newDose.trim() || undefined : undefined,
        new_route: draft.action === 'modify' ? draft.newRoute.trim() || undefined : undefined,
        new_frequency: draft.action === 'modify' ? draft.newFrequency.trim() || undefined : undefined,
      });
      await invalidate();
      toast.success('Medication decision saved');
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to update medication decision'));
    } finally {
      setBusy(null);
    }
  };

  const addMedication = async () => {
    if (!selectedId || !newItem.medicationName.trim()) return;
    setBusy('add');
    try {
      await api.post(`/api/nursing/medication-reconciliation/${selectedId}/items`, {
        medication_name: newItem.medicationName.trim(),
        generic_name: newItem.genericName.trim() || undefined,
        dose: newItem.dose.trim() || undefined,
        route: newItem.route.trim() || undefined,
        frequency: newItem.frequency.trim() || undefined,
        source: 'new',
        action: 'add',
        action_reason: newItem.actionReason.trim() || undefined,
      });
      setNewItem(EMPTY_NEW_ITEM);
      await invalidate();
      toast.success('Medication added to reconciliation');
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to add medication'));
    } finally {
      setBusy(null);
    }
  };

  const completeReconciliation = async () => {
    if (!selectedId) return;
    setBusy('complete');
    try {
      const response = await api.put<{
        Results?: { dischargeChecklistSynced?: boolean | null };
      }>(`/api/nursing/medication-reconciliation/${selectedId}/complete`, {});
      await invalidate();
      if (response.Results?.dischargeChecklistSynced === false) {
        toast.error('Reconciliation completed and locked, but the discharge checklist was not synced. Review it manually.');
      } else {
        toast.success('Medication reconciliation completed and locked');
      }
      onCompleted?.();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to complete medication reconciliation'));
    } finally {
      setBusy(null);
    }
  };

  const isOpen = selected?.status === 'in_progress';

  return (
    <section className="card p-4 space-y-4" data-testid="medication-reconciliation-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-[var(--color-primary)]" />
            Medication Reconciliation
          </h3>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Verify home and inpatient medicines at admission, transfer, and discharge.
          </p>
        </div>
        {selected && (
          <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${
            selected.status === 'completed'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {typeLabel(selected.type)} · {selected.status.replace('_', ' ')}
          </span>
        )}
      </div>

      {!visitId && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Medication reconciliation is unavailable because this admission is not linked to an active IPD visit.</span>
        </div>
      )}

      <div className="grid sm:grid-cols-[160px_1fr_auto] gap-2">
        <select
          className="input"
          value={transitionType}
          onChange={(event) => setTransitionType(event.target.value as ReconciliationType)}
          disabled={!visitId || busy !== null}
          aria-label="Transition type"
        >
          <option value="admission">Admission</option>
          <option value="transfer">Transfer</option>
          <option value="discharge">Discharge</option>
        </select>
        <input
          className="input"
          value={startNotes}
          onChange={(event) => setStartNotes(event.target.value)}
          placeholder="Optional transition note"
          disabled={!visitId || busy !== null}
        />
        <button
          type="button"
          className="btn-primary whitespace-nowrap"
          onClick={startReconciliation}
          disabled={!visitId || busy !== null}
        >
          {busy === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Start
        </button>
      </div>

      {currentVisitHistory.length > 0 && (
        <select
          className="input"
          value={selectedId ?? ''}
          onChange={(event) => setSelectedId(Number(event.target.value))}
          aria-label="Reconciliation history"
        >
          {currentVisitHistory.map((record) => (
            <option key={record.id} value={record.id}>
              {typeLabel(record.type)} · {record.status.replace('_', ' ')} · #{record.id}
            </option>
          ))}
        </select>
      )}

      {detailQuery.isLoading && selectedId ? (
        <div className="flex items-center justify-center py-6 text-sm text-[var(--color-text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading medication list…
        </div>
      ) : selected ? (
        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-center text-xs text-[var(--color-text-muted)]">
              No medicines were imported. Confirm that the patient takes no medicines, or add one below.
            </div>
          ) : (
            items.map((item) => {
              const draft = itemDrafts[item.id] ?? {
                action: item.action,
                actionReason: item.actionReason,
                newDose: item.newDose,
                newRoute: item.newRoute,
                newFrequency: item.newFrequency,
              };
              return (
                <div key={item.id} className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Pill className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-text)]">{item.medicationName}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {[item.genericName, item.dose, item.frequency, item.route].filter(Boolean).join(' · ') || 'Dose details not recorded'}
                        {' · '}{item.source}
                      </p>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-[150px_1fr_auto] gap-2">
                    <select
                      className="input"
                      value={draft.action}
                      disabled={!isOpen || busy !== null}
                      aria-label={`Action for ${item.medicationName}`}
                      onChange={(event) => setItemDrafts((previous) => ({
                        ...previous,
                        [item.id]: { ...draft, action: event.target.value as ReconciliationAction },
                      }))}
                    >
                      <option value="continue">Continue</option>
                      <option value="modify">Modify</option>
                      <option value="discontinue">Discontinue</option>
                      <option value="add">Add</option>
                    </select>
                    <input
                      className="input"
                      value={draft.actionReason}
                      disabled={!isOpen || busy !== null}
                      placeholder={draft.action === 'discontinue' ? 'Reason required' : 'Clinical reason / note'}
                      onChange={(event) => setItemDrafts((previous) => ({
                        ...previous,
                        [item.id]: { ...draft, actionReason: event.target.value },
                      }))}
                    />
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => updateItem(item)}
                      disabled={!isOpen || busy !== null}
                      aria-label={`Save ${item.medicationName} decision`}
                    >
                      {busy === `item-${item.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save
                    </button>
                  </div>

                  {draft.action === 'modify' && (
                    <div className="grid sm:grid-cols-3 gap-2 pl-6">
                      <input className="input" placeholder="New dose" value={draft.newDose} disabled={!isOpen || busy !== null}
                        onChange={(event) => setItemDrafts((previous) => ({ ...previous, [item.id]: { ...draft, newDose: event.target.value } }))} />
                      <input className="input" placeholder="New frequency" value={draft.newFrequency} disabled={!isOpen || busy !== null}
                        onChange={(event) => setItemDrafts((previous) => ({ ...previous, [item.id]: { ...draft, newFrequency: event.target.value } }))} />
                      <input className="input" placeholder="New route" value={draft.newRoute} disabled={!isOpen || busy !== null}
                        onChange={(event) => setItemDrafts((previous) => ({ ...previous, [item.id]: { ...draft, newRoute: event.target.value } }))} />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {isOpen && (
            <div className="rounded-lg bg-[var(--color-surface)] p-3 space-y-2">
              <p className="text-xs font-semibold">Add medicine not in the imported list</p>
              <div className="grid sm:grid-cols-2 gap-2">
                <input className="input" placeholder="Medication name" value={newItem.medicationName}
                  onChange={(event) => setNewItem((previous) => ({ ...previous, medicationName: event.target.value }))} />
                <input className="input" placeholder="Generic name" value={newItem.genericName}
                  onChange={(event) => setNewItem((previous) => ({ ...previous, genericName: event.target.value }))} />
                <input className="input" placeholder="Dose" value={newItem.dose}
                  onChange={(event) => setNewItem((previous) => ({ ...previous, dose: event.target.value }))} />
                <input className="input" placeholder="Frequency" value={newItem.frequency}
                  onChange={(event) => setNewItem((previous) => ({ ...previous, frequency: event.target.value }))} />
                <input className="input" placeholder="Route" value={newItem.route}
                  onChange={(event) => setNewItem((previous) => ({ ...previous, route: event.target.value }))} />
                <input className="input" placeholder="Reason / source note" value={newItem.actionReason}
                  onChange={(event) => setNewItem((previous) => ({ ...previous, actionReason: event.target.value }))} />
              </div>
              <div className="flex justify-end">
                <button type="button" className="btn-ghost" onClick={addMedication}
                  disabled={!newItem.medicationName.trim() || busy !== null}>
                  {busy === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add medicine
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-[var(--color-text-muted)]">
              {selected.completedAt ? `Completed ${selected.completedAt}` : 'Completion locks all medication decisions.'}
            </p>
            <div className="flex items-center gap-2">
              {selected.status === 'completed' && selected.type === 'discharge' && basePath && admissionId && (
                <Link
                  className="btn-primary"
                  to={linkedPrescription
                    ? `${basePath}/prescriptions/${linkedPrescription.id}?from=doctor/ipd/${admissionId}`
                    : `${basePath}/prescriptions/new?patient=${patientId}&admission=${admissionId}&reconciliation=${selected.id}&from=doctor/ipd/${admissionId}`}
                >
                  <FileSignature className="w-4 h-4" />
                  {linkedPrescription
                    ? `Open discharge prescription${linkedPrescription.rxNo ? ` (${linkedPrescription.rxNo})` : ''}`
                    : 'Create discharge prescription'}
                </Link>
              )}
              {isOpen && (
                <button type="button" className="btn-primary" onClick={completeReconciliation} disabled={busy !== null}>
                  {busy === 'complete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Complete & lock
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-center text-xs text-[var(--color-text-muted)]">
          Start a reconciliation to review the medication list for this transition.
        </div>
      )}
    </section>
  );
}

export default MedicationReconciliationPanel;
