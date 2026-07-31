import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, PauseCircle, Pill, PlayCircle, Plus, Search, StopCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/apiClient';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

interface IPDMedicationOrderComposerProps {
  patientId: number;
  visitId?: number | null;
  admissionId: number;
}

type OrderStatus = 'active' | 'on_hold' | 'completed' | 'discontinued' | 'cancelled';
type OrderPriority = 'stat' | 'urgent' | 'routine' | 'prn';

type RawRecord = Record<string, unknown>;

interface MedicationOrder {
  id: number;
  medicationName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
  priority: OrderPriority;
  status: OrderStatus;
  statusReason: string;
  startDatetime: string;
}

interface FormularyResult {
  name: string;
  generic?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  default_frequency?: string | null;
  default_duration?: string | null;
  default_instructions?: string | null;
  medicine_id?: number | null;
}

interface OrderForm {
  formularyItemId: number | null;
  medicationName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
  priority: OrderPriority;
}

const EMPTY_FORM: OrderForm = {
  formularyItemId: null,
  medicationName: '',
  genericName: '',
  strength: '',
  dosageForm: '',
  dose: '',
  route: 'Oral',
  frequency: '',
  duration: '',
  instructions: '',
  priority: 'routine',
};

function field<T>(row: RawRecord, camel: string, snake: string, fallback: T): T {
  const value = row[camel] ?? row[snake];
  return (value === undefined || value === null ? fallback : value) as T;
}

function normalizeOrder(row: RawRecord): MedicationOrder {
  return {
    id: Number(row.id),
    medicationName: String(field(row, 'medicationName', 'medication_name', 'Unknown medicine')),
    genericName: String(field(row, 'genericName', 'generic_name', '')),
    strength: String(row.strength ?? ''),
    dosageForm: String(field(row, 'dosageForm', 'dosage_form', '')),
    dose: String(row.dose ?? ''),
    route: String(row.route ?? ''),
    frequency: String(row.frequency ?? ''),
    duration: String(row.duration ?? ''),
    instructions: String(row.instructions ?? ''),
    priority: String(row.priority ?? 'routine') as OrderPriority,
    status: String(row.status ?? 'active') as OrderStatus,
    statusReason: String(field(row, 'statusReason', 'status_reason', '')),
    startDatetime: String(field(row, 'startDatetime', 'start_datetime', '')),
  };
}

function createIdempotencyKey(): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `doctor-order:${suffix}`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function priorityClass(priority: OrderPriority): string {
  if (priority === 'stat') return 'bg-red-100 text-red-700';
  if (priority === 'urgent') return 'bg-orange-100 text-orange-700';
  if (priority === 'prn') return 'bg-purple-100 text-purple-700';
  return 'bg-blue-100 text-blue-700';
}

function statusClass(status: OrderStatus): string {
  if (status === 'active') return 'bg-emerald-100 text-emerald-700';
  if (status === 'on_hold') return 'bg-amber-100 text-amber-700';
  if (status === 'completed') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-600';
}

export function IPDMedicationOrderComposer({ patientId, visitId, admissionId }: IPDMedicationOrderComposerProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OrderForm>(EMPTY_FORM);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<FormularyResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [action, setAction] = useState<{ orderId: number; type: 'hold' | 'discontinue'; reason: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());

  const ordersKey = ['ipd-medication-orders', patientId, visitId ?? 0] as const;
  const ordersQuery = useApiQuery<{ Results?: RawRecord[] }>(
    ordersKey,
    visitId
      ? `/api/nursing/medication-orders?patient_id=${patientId}&visit_id=${visitId}&limit=100`
      : '/api/nursing/medication-orders?patient_id=0&visit_id=0&limit=100',
    { enabled: patientId > 0 && Boolean(visitId) },
  );
  const orders = useMemo(
    () => (ordersQuery.data?.Results ?? []).map(normalizeOrder),
    [ordersQuery.data?.Results],
  );
  const visibleOrders = useMemo(
    () => orders.filter((order) => ['active', 'on_hold', 'completed', 'discontinued'].includes(order.status)),
    [orders],
  );

  useEffect(() => {
    const query = searchTerm.trim();
    if (query.length < 2 || !visitId) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api.get<{ medicines?: FormularyResult[] }>(
          `/api/e-prescribing/formulary/search?q=${encodeURIComponent(query)}`,
        );
        if (!cancelled) setSearchResults(response.medicines ?? []);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm, visitId]);

  const updateForm = <K extends keyof OrderForm>(key: K, value: OrderForm[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const chooseFormulary = (medicine: FormularyResult) => {
    setForm((previous) => ({
      ...previous,
      formularyItemId: null,
      medicationName: medicine.name,
      genericName: medicine.generic ?? '',
      strength: medicine.strength ?? '',
      dosageForm: medicine.dosage_form ?? '',
      frequency: medicine.default_frequency ?? previous.frequency,
      duration: medicine.default_duration ?? previous.duration,
      instructions: medicine.default_instructions ?? previous.instructions,
    }));
    setSearchTerm('');
    setSearchResults([]);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setSearchTerm('');
    setSearchResults([]);
    idempotencyKeyRef.current = createIdempotencyKey();
  };

  const createOrder = async () => {
    if (!visitId) {
      toast.error('An active IPD visit is required before placing medication orders.');
      return;
    }
    if (!form.medicationName.trim() || !form.dose.trim() || !form.frequency.trim() || !form.route.trim()) {
      toast.error('Medicine, dose, route and frequency are required.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post<{ Results?: { replayed?: boolean } }>(
        '/api/nursing/medication-orders',
        {
          patient_id: patientId,
          visit_id: visitId,
          formulary_item_id: form.formularyItemId ?? undefined,
          medication_name: form.medicationName.trim(),
          generic_name: form.genericName.trim() || undefined,
          strength: form.strength.trim() || undefined,
          dosage_form: form.dosageForm.trim() || undefined,
          dose: form.dose.trim(),
          route: form.route.trim(),
          frequency: form.frequency.trim(),
          duration: form.duration.trim() || undefined,
          instructions: form.instructions.trim() || undefined,
          priority: form.priority,
          idempotency_key: idempotencyKeyRef.current,
        },
      );
      await queryClient.invalidateQueries({ queryKey: ordersKey });
      toast.success(response.Results?.replayed ? 'Medication order already existed; existing order opened in the list.' : 'Medication order placed and sent to MAR');
      resetForm();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to place medication order'));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmAction = async () => {
    if (!action || action.reason.trim().length < 3) {
      toast.error('Enter a clinical reason of at least 3 characters.');
      return;
    }
    setActionBusy(true);
    try {
      const path = action.type === 'hold'
        ? `/api/nursing/medication-orders/${action.orderId}/hold`
        : `/api/nursing/medication-orders/${action.orderId}/discontinue`;
      await api.put(path, { status_reason: action.reason.trim() });
      await queryClient.invalidateQueries({ queryKey: ordersKey });
      toast.success(action.type === 'hold' ? 'Medication order status updated' : 'Medication order discontinued');
      setAction(null);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to update medication order'));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <section className="card p-4 space-y-4" data-testid="ipd-medication-order-composer">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Pill className="w-4 h-4 text-[var(--color-primary)]" />
          Inpatient Medication Orders
        </h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Admission #{admissionId} · Doctor orders are sent directly to the nursing MAR schedule.
        </p>
      </div>

      {!visitId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          This admission is not linked to an active IPD visit. Medication ordering is disabled.
        </div>
      )}

      <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            className="input w-full pl-9"
            aria-label="Search inpatient medicine"
            placeholder="Search formulary medicine…"
            value={searchTerm}
            disabled={!visitId || submitting}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        {searching && <p className="text-xs text-[var(--color-text-muted)]">Searching formulary…</p>}
        {searchResults.length > 0 && (
          <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--color-border)] p-1">
            {searchResults.map((medicine, index) => (
              <button
                key={`${medicine.name}-${medicine.strength ?? ''}-${medicine.medicine_id ?? index}`}
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left hover:bg-[var(--color-primary)]/5"
                onClick={() => chooseFormulary(medicine)}
              >
                <span className="text-sm font-medium">{medicine.name}</span>
                <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                  {[medicine.generic, medicine.strength, medicine.dosage_form].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-2">
          <input className="input" aria-label="Medication name" placeholder="Medication name" value={form.medicationName}
            disabled={!visitId || submitting} onChange={(event) => updateForm('medicationName', event.target.value)} />
          <input className="input" aria-label="Generic name" placeholder="Generic name" value={form.genericName}
            disabled={!visitId || submitting} onChange={(event) => updateForm('genericName', event.target.value)} />
          <input className="input" aria-label="Dose" placeholder="Dose, e.g. 1 g" value={form.dose}
            disabled={!visitId || submitting} onChange={(event) => updateForm('dose', event.target.value)} />
          <input className="input" aria-label="Route" placeholder="Route" value={form.route}
            disabled={!visitId || submitting} onChange={(event) => updateForm('route', event.target.value)} />
          <input className="input" aria-label="Frequency" placeholder="Frequency, e.g. BD" value={form.frequency}
            disabled={!visitId || submitting} onChange={(event) => updateForm('frequency', event.target.value)} />
          <input className="input" aria-label="Duration" placeholder="Duration" value={form.duration}
            disabled={!visitId || submitting} onChange={(event) => updateForm('duration', event.target.value)} />
          <select className="input" aria-label="Medication priority" value={form.priority}
            disabled={!visitId || submitting} onChange={(event) => updateForm('priority', event.target.value as OrderPriority)}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="stat">STAT</option>
            <option value="prn">PRN</option>
          </select>
          <input className="input" aria-label="Medication instructions" placeholder="Instructions" value={form.instructions}
            disabled={!visitId || submitting} onChange={(event) => updateForm('instructions', event.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={resetForm} disabled={submitting}>
            <X className="w-4 h-4" /> Reset
          </button>
          <button type="button" className="btn-primary" onClick={createOrder} disabled={!visitId || submitting}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Place order
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[var(--color-text-muted)]">Current admission orders</p>
        {ordersQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Loading orders…</div>
        ) : visibleOrders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-center text-xs text-[var(--color-text-muted)]">No inpatient medication orders yet.</p>
        ) : (
          visibleOrders.map((order) => (
            <div key={order.id} className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)]">{order.medicationName}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {[order.strength, order.dose, order.frequency, order.route, order.duration].filter(Boolean).join(' · ')}
                  </p>
                  {order.instructions && <p className="text-xs text-[var(--color-text-muted)] mt-1">{order.instructions}</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  <span className={`text-[10px] uppercase rounded-full px-2 py-1 font-semibold ${priorityClass(order.priority)}`}>{order.priority}</span>
                  <span className={`text-[10px] uppercase rounded-full px-2 py-1 font-semibold ${statusClass(order.status)}`}>{order.status.replace('_', ' ')}</span>
                </div>
              </div>

              {(order.status === 'active' || order.status === 'on_hold') && (
                <div className="flex flex-wrap gap-2 justify-end">
                  <button type="button" className="btn-ghost text-xs" onClick={() => setAction({ orderId: order.id, type: 'hold', reason: '' })}>
                    {order.status === 'on_hold' ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
                    {order.status === 'on_hold' ? 'Resume' : 'Hold'}
                  </button>
                  <button type="button" className="btn-ghost text-xs text-red-700" onClick={() => setAction({ orderId: order.id, type: 'discontinue', reason: '' })}>
                    <StopCircle className="w-4 h-4" /> Discontinue
                  </button>
                </div>
              )}

              {action?.orderId === order.id && (
                <div className="rounded-lg bg-[var(--color-surface)] p-2 space-y-2">
                  <input
                    className="input w-full"
                    aria-label="Medication order action reason"
                    placeholder={`Clinical reason to ${action.type === 'hold' ? (order.status === 'on_hold' ? 'resume' : 'hold') : 'discontinue'}…`}
                    value={action.reason}
                    disabled={actionBusy}
                    onChange={(event) => setAction({ ...action, reason: event.target.value })}
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-ghost text-xs" onClick={() => setAction(null)} disabled={actionBusy}>Cancel</button>
                    <button type="button" className="btn-primary text-xs" onClick={confirmAction} disabled={actionBusy || action.reason.trim().length < 3}>
                      {actionBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Confirm
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default IPDMedicationOrderComposer;
