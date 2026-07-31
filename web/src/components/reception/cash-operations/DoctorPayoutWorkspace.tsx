import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../../lib/format';
import { useApiMutation, useQueryClient } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';

type PayableItem = {
  accrualId?: number;
  id?: number;
  serviceDate?: string | null;
  sourceType?: string;
  serviceName?: string;
  sourceLabel?: string;
  patientName?: string | null;
  invoiceNo?: string | null;
  grossAmount?: number;
  commissionAmount?: number;
  payableAmount?: number;
};

type DoctorPayable = {
  doctorId: number;
  doctorName: string;
  consultationCommission?: number;
  testCommission?: number;
  referralCommission?: number;
  otherCommission?: number;
  payableAmount?: number;
  eligibleItemCount?: number;
  items?: PayableItem[];
  accruals?: PayableItem[];
};

type PayoutPayload = {
  accrualIds: number[];
  lineOverrides: Array<{ lineId: number; payoutAmount: number; reason: string }>;
  receiverType: 'doctor' | 'assistant' | 'representative';
  receiverName: string;
  receiverReference?: string;
  paymentMethod: 'cash';
  adjustments: { advanceDeduction: number; otherAdjustment: number; roundingAdjustment: number };
  note?: string;
  idempotencyKey: string;
};

type GroupSummary = {
  label: string;
  ids: number[];
  itemCount: number;
  total: number;
  selectedCount: number;
  selectedTotal: number;
};

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return formatCurrency(numeric(value), { fractionDigits: 2 });
}

function itemId(item: PayableItem): number | null {
  const id = Number(item.accrualId ?? item.id ?? 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function itemCommission(item: PayableItem): number {
  return numeric(item.payableAmount ?? item.commissionAmount);
}

function randomKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `payout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sourceLabel(item: PayableItem): string {
  const source = item.sourceType ?? item.sourceLabel ?? item.serviceName ?? '';
  if (source === 'consultation_fee' || /consultation/i.test(source)) return 'Consultation';
  if (source === 'lab_test' || /test|usg|lab|cbc|ultra/i.test(source)) return 'Lab/Test';
  if (source === 'referral' || /referral/i.test(source)) return 'Test referral';
  if (source === 'ipd_round') return 'IPD Round';
  if (source === 'procedure') return 'Procedure';
  return item.sourceLabel ?? item.serviceName ?? 'Other';
}

const GROUP_ORDER = ['Consultation', 'Lab/Test', 'Test referral', 'IPD Round', 'Procedure', 'Other'];

export default function DoctorPayoutWorkspace({
  doctors = [],
  sessionId,
  dateFrom,
  dateTo,
  dateRangeError,
  availableCash,
  onDateRangeChange,
}: {
  doctors?: DoctorPayable[];
  sessionId?: number | null;
  dateFrom: string;
  dateTo: string;
  dateRangeError?: string | null;
  availableCash?: number;
  onDateRangeChange: (from: string, to: string) => void;
}) {
  const { t } = useTranslation('cashOperations');
  const queryClient = useQueryClient();
  const payableDoctors = useMemo<DoctorPayable[]>(() => doctors.flatMap((doctor): DoctorPayable[] => {
    const payableItems = (doctor.items ?? doctor.accruals ?? []).filter((item) => (
      itemId(item) != null && itemCommission(item) > 0
    ));
    if (payableItems.length === 0) return [];
    return [{
      ...doctor,
      eligibleItemCount: payableItems.length,
      payableAmount: payableItems.reduce((sum, item) => sum + itemCommission(item), 0),
      items: payableItems,
      accruals: payableItems,
    }];
  }), [doctors]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [receiverType, setReceiverType] = useState<'doctor' | 'assistant' | 'representative'>('doctor');
  const [receiverName, setReceiverName] = useState('');
  const [receiverReference, setReceiverReference] = useState('');
  const [note, setNote] = useState('');
  const [payoutAmounts, setPayoutAmounts] = useState<Record<number, string>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const selectedDoctor = payableDoctors.find((doctor) => doctor.doctorId === selectedDoctorId) ?? payableDoctors[0];
  const items = useMemo(() => selectedDoctor?.items ?? selectedDoctor?.accruals ?? [], [selectedDoctor]);

  useEffect(() => {
    if (payableDoctors.some((doctor) => doctor.doctorId === selectedDoctorId)) return;
    const nextDoctor = payableDoctors[0];
    setSelectedDoctorId(nextDoctor?.doctorId ?? null);
    setSelectedIds([]);
    setPayoutAmounts({});
    setOverrideReasons({});
    setMessage(null);
    if (receiverType === 'doctor') setReceiverName(nextDoctor?.doctorName ?? '');
  }, [payableDoctors, receiverType, selectedDoctorId]);

  useEffect(() => {
    if (selectedDoctor && receiverType === 'doctor' && !receiverName.trim()) {
      setReceiverName(selectedDoctor.doctorName);
    }
  }, [receiverName, receiverType, selectedDoctor]);

  useEffect(() => {
    setSelectedIds([]);
    setPayoutAmounts({});
    setOverrideReasons({});
    setMessage(null);
  }, [dateFrom, dateTo]);

  const allItemIds = useMemo(() => items.map(itemId).filter((id): id is number => id != null), [items]);
  const selectedItems = useMemo(() => items.filter((item) => {
    const id = itemId(item);
    return Boolean(id && selectedIds.includes(id));
  }), [items, selectedIds]);
  const selectedPayableIds = useMemo(() => selectedItems
    .map(itemId)
    .filter((id): id is number => id != null), [selectedItems]);

  useEffect(() => {
    const validIds = new Set(allItemIds);
    setSelectedIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [allItemIds]);

  const finalAmountFor = (item: PayableItem): number => {
    const id = itemId(item);
    if (!id) return itemCommission(item);
    const edited = payoutAmounts[id];
    return edited == null ? itemCommission(item) : Number(edited);
  };
  const selectedTotal = useMemo(() => selectedItems.reduce((sum, item) => sum + finalAmountFor(item), 0), [selectedItems, payoutAmounts]);
  const selectedGross = useMemo(() => selectedItems.reduce((sum, item) => sum + numeric(item.grossAmount), 0), [selectedItems]);
  const changedItems = useMemo(() => selectedItems.filter((item) => finalAmountFor(item) !== itemCommission(item)), [selectedItems, payoutAmounts]);
  const hasInvalidLineAmount = selectedItems.some((item) => {
    const finalAmount = finalAmountFor(item);
    return !Number.isFinite(finalAmount) || finalAmount <= 0 || finalAmount > numeric(item.grossAmount);
  });
  const hasMissingOverrideReason = changedItems.some((item) => {
    const id = itemId(item);
    return !id || (overrideReasons[id]?.trim().length ?? 0) < 3;
  });

  const groupSummaries = useMemo<GroupSummary[]>(() => {
    const summaries = new Map<string, GroupSummary>();
    for (const group of GROUP_ORDER) {
      summaries.set(group, { label: group, ids: [], itemCount: 0, total: 0, selectedCount: 0, selectedTotal: 0 });
    }

    for (const item of items) {
      const id = itemId(item);
      if (!id) continue;
      const label = GROUP_ORDER.includes(sourceLabel(item)) ? sourceLabel(item) : 'Other';
      const summary = summaries.get(label) ?? summaries.get('Other')!;
      const commission = itemCommission(item);
      summary.ids.push(id);
      summary.itemCount += 1;
      summary.total += commission;
      if (selectedIds.includes(id)) {
        summary.selectedCount += 1;
        summary.selectedTotal += finalAmountFor(item);
      }
    }

    return GROUP_ORDER.map((group) => summaries.get(group)!).filter((summary) => summary.itemCount > 0);
  }, [items, selectedIds, payoutAmounts]);

  const availableDrawerCash = numeric(availableCash);
  const exceedsDrawerCash = selectedTotal > availableDrawerCash;
  const canPay = Boolean(
    !dateRangeError
    && sessionId
    && selectedDoctor
    && selectedPayableIds.length > 0
    && selectedTotal > 0
    && (receiverName.trim() || selectedDoctor?.doctorName)
    && !exceedsDrawerCash
    && !hasInvalidLineAmount
    && !hasMissingOverrideReason,
  );
  const allSelected = allItemIds.length > 0 && allItemIds.every((id) => selectedIds.includes(id));

  const payMutation = useApiMutation<{ settlement?: { settlementNo?: string; netPaidAmount?: number } }, PayoutPayload>(
    'post',
    () => `/api/payment-methods/doctor-payouts/sessions/${sessionId}/pay`,
    {
      onSuccess: async (data) => {
        setMessage(t('doctorPayout.completed', { suffix: data.settlement?.settlementNo ? `: ${data.settlement.settlementNo}` : '' }));
        setSelectedIds([]);
        setPayoutAmounts({});
        setOverrideReasons({});
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['doctor-payouts'] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.overview() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.activity({ limit: 20 }) }),
        ]);
      },
      onError: (error) => setMessage(error.message || t('doctorPayout.failed')),
    },
  );

  const selectDoctor = (doctor: DoctorPayable) => {
    setSelectedDoctorId(doctor.doctorId);
    setSelectedIds([]);
    setPayoutAmounts({});
    setOverrideReasons({});
    setReceiverName(doctor.doctorName);
    setMessage(null);
  };

  const toggleItem = (id: number) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const toggleAllItems = () => {
    setSelectedIds(allSelected ? [] : allItemIds);
  };

  const toggleGroup = (summary: GroupSummary) => {
    setSelectedIds((current) => {
      const groupSelected = summary.ids.every((id) => current.includes(id));
      return groupSelected ? current.filter((id) => !summary.ids.includes(id)) : Array.from(new Set([...current, ...summary.ids]));
    });
  };

  const onReceiverTypeChange = (nextType: typeof receiverType) => {
    setReceiverType(nextType);
    if (nextType === 'doctor' && selectedDoctor) {
      setReceiverName(selectedDoctor.doctorName);
    } else {
      setReceiverName('');
    }
  };

  const submitPayout = () => {
    if (!sessionId || !selectedDoctor || selectedPayableIds.length === 0) {
      setMessage(t('doctorPayout.selectRequired'));
      return;
    }
    if (exceedsDrawerCash) {
      setMessage(t('doctorPayout.exceedsDrawerCash', { amount: money(selectedTotal), available: money(availableDrawerCash), defaultValue: 'Selected payout {{amount}} is greater than available drawer cash {{available}}.' }));
      return;
    }
    payMutation.mutate({
      accrualIds: selectedPayableIds,
      lineOverrides: changedItems.flatMap((item) => {
        const id = itemId(item);
        if (!id) return [];
        return [{
          lineId: id,
          payoutAmount: finalAmountFor(item),
          reason: overrideReasons[id].trim(),
        }];
      }),
      receiverType,
      receiverName: receiverName.trim() || selectedDoctor.doctorName,
      receiverReference: receiverReference.trim() || undefined,
      paymentMethod: 'cash',
      adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
      note: note.trim() || undefined,
      idempotencyKey: randomKey(),
    });
  };

  const selectedDoctorTotal = numeric(selectedDoctor?.payableAmount ?? items.reduce((sum, item) => sum + itemCommission(item), 0));

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-sm dark:bg-slate-900" aria-labelledby="doctor-payout-title">
      <div className="border-b border-[var(--color-border)] bg-gradient-to-r from-cyan-50/80 via-white to-white p-4 dark:from-cyan-950/20 dark:via-slate-900 dark:to-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('doctorPayout.kicker')}</p>
            <h2 id="doctor-payout-title" className="text-lg font-bold text-[var(--color-text-primary)]">{t('doctorPayout.title')}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Select doctor → pick category/items → confirm cash payout.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
              From
              <input
                className="input mt-1 min-w-0"
                type="date"
                value={dateFrom}
                onChange={(event) => onDateRangeChange(event.target.value, dateTo)}
              />
            </label>
            <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
              To
              <input
                className="input mt-1 min-w-0"
                type="date"
                value={dateTo}
                onChange={(event) => onDateRangeChange(dateFrom, event.target.value)}
              />
            </label>
            {dateRangeError ? <p className="col-span-2 text-xs font-medium text-red-600">{dateRangeError}</p> : null}
          </div>
          <div className="rounded-2xl border border-cyan-100 bg-white px-4 py-3 shadow-sm dark:border-cyan-900/50 dark:bg-slate-950">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Ready to pay</p>
            <p className="font-data text-2xl font-bold text-cyan-700">{money(selectedTotal)}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{selectedItems.length} selected item{selectedItems.length === 1 ? '' : 's'}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/60 p-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Payable doctors</h3>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-[var(--color-text-muted)]">{payableDoctors.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {payableDoctors.length > 0 ? payableDoctors.map((doctor) => {
              const active = doctor.doctorId === selectedDoctor?.doctorId;
              return (
                <button
                  key={doctor.doctorId}
                  type="button"
                  onClick={() => selectDoctor(doctor)}
                  className={`w-full rounded-xl border p-3 text-left transition ${active ? 'border-cyan-300 bg-white shadow-sm ring-2 ring-cyan-100' : 'border-transparent bg-white/70 hover:border-cyan-200 hover:bg-white'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--color-text-primary)]">{doctor.doctorName}</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{doctor.eligibleItemCount ?? 0} unpaid items</p>
                    </div>
                    {active ? <span className="rounded-full bg-cyan-600 px-2 py-0.5 text-[10px] font-bold text-white">Active</span> : null}
                  </div>
                  <p className="mt-2 font-data text-lg font-bold text-[var(--color-text-primary)]">{money(doctor.payableAmount)}</p>
                </button>
              );
            }) : <p className="rounded-xl bg-white p-4 text-sm text-[var(--color-text-muted)]">{t('doctorPayout.noPayables')}</p>}
          </div>
        </aside>

        <div className="min-w-0 p-4">
          {selectedDoctor ? (
            <>
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Selected doctor</p>
                    <h3 className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">{selectedDoctor.doctorName}</h3>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      Total payable {money(selectedDoctorTotal)} · Selected gross {money(selectedGross)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary min-w-[190px]"
                    disabled={!canPay || payMutation.isPending}
                    onClick={submitPayout}
                  >
                    {payMutation.isPending ? 'Paying...' : `Pay ${money(selectedTotal)}`}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="text-sm font-medium text-[var(--color-text-primary)]">
                  Receiver type
                  <select className="input mt-1" value={receiverType} onChange={(event) => onReceiverTypeChange(event.target.value as typeof receiverType)}>
                    <option value="doctor">{t('doctorPayout.doctorReceiver')}</option>
                    <option value="assistant">Assistant</option>
                    <option value="representative">Representative</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-[var(--color-text-primary)]">
                  Receiver name
                  <input className="input mt-1" value={receiverName} onChange={(event) => setReceiverName(event.target.value)} placeholder={selectedDoctor.doctorName} />
                </label>
                <label className="text-sm font-medium text-[var(--color-text-primary)]">
                  Reference / mobile
                  <input className="input mt-1" value={receiverReference} onChange={(event) => setReceiverReference(event.target.value)} placeholder="Optional" />
                </label>
              </div>

              <label className="mt-3 block text-sm font-medium text-[var(--color-text-primary)]">
                Note
                <input className="input mt-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional payout note" />
              </label>

              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)]">Select payable items</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">Use group chips or select individual rows. Blue rows will be paid.</p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={toggleAllItems} disabled={allItemIds.length === 0}>
                    {allSelected ? 'Clear all' : 'Select all'}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {groupSummaries.map((group) => {
                    const active = group.selectedCount === group.itemCount;
                    const partial = group.selectedCount > 0 && !active;
                    return (
                      <button
                        key={group.label}
                        type="button"
                        className={`rounded-xl border px-3 py-2 text-left text-xs transition ${active ? 'border-cyan-300 bg-cyan-50 text-cyan-800 shadow-sm' : partial ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-cyan-200'}`}
                        onClick={() => toggleGroup(group)}
                      >
                        <span className="block font-bold">{group.label} · {group.selectedCount}/{group.itemCount}</span>
                        <span className="font-data">{money(group.selectedTotal)} / {money(group.total)}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 max-h-[28rem] overflow-auto rounded-2xl border border-[var(--color-border)] bg-white">
                  {items.length > 0 ? items.map((item) => {
                    const id = itemId(item);
                    if (!id) return null;
                    const checked = selectedIds.includes(id);
                    const calculatedAmount = itemCommission(item);
                    const finalAmount = finalAmountFor(item);
                    const difference = finalAmount - calculatedAmount;
                    const changed = checked && Number.isFinite(finalAmount) && difference !== 0;
                    return (
                      <div key={id} className="border-b border-[var(--color-border)] last:border-b-0">
                        <button
                          type="button"
                          onClick={() => toggleItem(id)}
                          className={`grid w-full gap-3 px-3 py-3 text-left transition md:grid-cols-[minmax(0,1fr)_95px_115px] ${checked ? 'bg-cyan-50/80 ring-1 ring-inset ring-cyan-200' : 'hover:bg-[var(--color-bg-subtle)]'}`}
                        >
                          <span className="flex min-w-0 items-start gap-3">
                            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold ${checked ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}>✓</span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-[var(--color-text-primary)]">{item.serviceName ?? item.sourceLabel ?? `Accrual #${id}`}</span>
                              <span className="mt-1 inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-cyan-700 ring-1 ring-cyan-100">{sourceLabel(item)}</span>
                              <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                                {item.patientName ?? 'No patient'}
                                {item.invoiceNo ? ` · ${item.invoiceNo}` : ''}
                                {item.serviceDate ? ` · ${item.serviceDate}` : ''}
                              </span>
                            </span>
                          </span>
                          <span className="text-right text-xs text-[var(--color-text-muted)]">
                            Gross
                            <span className="block font-data text-sm font-semibold text-[var(--color-text-primary)]">{money(item.grossAmount)}</span>
                          </span>
                          <span className="text-right text-xs text-[var(--color-text-muted)]">
                            {checked ? 'Final payout' : 'Calculated'}
                            <span className={`block font-data text-base font-bold ${checked ? 'text-cyan-700' : 'text-[var(--color-text-primary)]'}`}>{money(checked ? finalAmount : calculatedAmount)}</span>
                          </span>
                        </button>
                        {checked ? (
                          <div className="grid gap-2 border-t border-cyan-100 bg-cyan-50/40 px-3 py-3 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-end">
                            <label className="text-xs font-semibold text-[var(--color-text-primary)]">
                              Final payout amount
                              <input
                                aria-label={`Final payout for accrual ${id}`}
                                className="input mt-1 h-9"
                                type="number"
                                min="0.01"
                                max={numeric(item.grossAmount)}
                                step="0.01"
                                value={payoutAmounts[id] ?? String(calculatedAmount)}
                                onChange={(event) => setPayoutAmounts((current) => ({ ...current, [id]: event.target.value }))}
                              />
                            </label>
                            {changed ? (
                              <label className="text-xs font-semibold text-[var(--color-text-primary)]">
                                Override reason
                                <input
                                  aria-label={`Override reason for accrual ${id}`}
                                  className="input mt-1 h-9"
                                  value={overrideReasons[id] ?? ''}
                                  onChange={(event) => setOverrideReasons((current) => ({ ...current, [id]: event.target.value }))}
                                  placeholder="Why is this payout different?"
                                />
                              </label>
                            ) : <div className="text-xs text-[var(--color-text-muted)]">Uses calculated payout</div>}
                            <div className={`pb-2 text-right text-xs font-semibold ${difference > 0 ? 'text-amber-700' : difference < 0 ? 'text-blue-700' : 'text-cyan-700'}`}>
                              {changed ? `Difference ${difference > 0 ? '+' : '-'}${money(Math.abs(difference))}` : 'No difference'}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  }) : <p className="px-3 py-6 text-sm text-[var(--color-text-muted)]">{t('doctorPayout.noItems')}</p>}
                </div>
              </div>
            </>
          ) : <p className="rounded-xl bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-muted)]">{t('doctorPayout.noPayables')}</p>}

          {message ? <p className="mt-3 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)]">{message}</p> : null}
          {hasMissingOverrideReason ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">Enter an override reason for every changed payout amount.</p> : null}
          {hasInvalidLineAmount ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Each payout must be positive and cannot exceed the gross service amount.</p> : null}
          {exceedsDrawerCash ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              Selected payout {money(selectedTotal)} is greater than available drawer cash {money(availableDrawerCash)}. Select fewer payable items or add cash before payout.
            </p>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-[var(--color-border)] bg-white/95 p-3 shadow-[0_-10px_25px_rgba(15,23,42,0.08)] backdrop-blur dark:bg-slate-900/95">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-cyan-50 px-3 py-1 font-semibold text-cyan-700">{selectedItems.length} selected</span>
            <span className="text-[var(--color-text-muted)]">Receiver: <strong className="text-[var(--color-text-primary)]">{receiverName.trim() || selectedDoctor?.doctorName || 'Not selected'}</strong></span>
            <span className="text-[var(--color-text-muted)]">Pay now: <strong className="font-data text-lg text-[var(--color-text-primary)]">{money(selectedTotal)}</strong></span>
          </div>
          <button type="button" className="btn btn-primary md:min-w-[220px]" disabled={!canPay || payMutation.isPending} onClick={submitPayout}>
            {payMutation.isPending ? 'Paying...' : `Confirm payout ${money(selectedTotal)}`}
          </button>
        </div>
      </div>
    </section>
  );
}
