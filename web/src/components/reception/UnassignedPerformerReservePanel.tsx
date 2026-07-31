import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

type ReserveItem = {
  reserveId: number;
  serviceDate: string;
  patientId: number | null;
  patientName: string | null;
  patientCode: string | null;
  billId: number;
  invoiceNo: string | null;
  netUnitServiceAmount: number;
  payoutMaximumAmount: number;
  reservedAmount: number;
  billIsPaid: boolean;
};

type ReserveGroup = {
  billingServiceItemId: number;
  testCode: string | null;
  testName: string;
  diagnosticKind: 'lab' | 'radiology';
  eligibleQuantity: number;
  waitingPaymentQuantity: number;
  eligibleAmount: number;
  waitingPaymentAmount: number;
  rateSummary: string;
  reserves: ReserveItem[];
};

type ReserveResponse = {
  groups: ReserveGroup[];
  summary: {
    testCount: number;
    eligibleQuantity: number;
    waitingPaymentQuantity: number;
    eligibleAmount: number;
    waitingPaymentAmount: number;
  };
};

type DoctorOption = {
  id: number;
  name: string;
  specialty?: string | null;
};

type PayoutResponse = {
  amount: number;
  doctorName: string;
  paidCount: number;
  settlementId: number;
};

function money(value: unknown): string {
  return Number(value ?? 0).toLocaleString('en-BD', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function newPayoutKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function selectOldestReserveIds(reserves: ReserveItem[], quantity: number): number[] {
  return reserves
    .filter((row) => row.billIsPaid)
    .slice(0, Math.max(0, Math.floor(quantity)))
    .map((row) => row.reserveId);
}

export default function UnassignedPerformerReservePanel({
  activeCounterId,
  expectedCash,
  enabled,
  dateFrom,
  dateTo,
  dateRangeError,
  onDateRangeChange,
  onRecorded,
}: {
  activeCounterId?: number | null;
  expectedCash: number;
  enabled: boolean;
  dateFrom?: string;
  dateTo?: string;
  dateRangeError?: string | null;
  onDateRangeChange?: (from: string, to: string) => void;
  onRecorded?: () => void;
}) {
  const { t } = useTranslation(['billing', 'common']);
  const queryClient = useQueryClient();
  const [selectedReserveIds, setSelectedReserveIds] = useState<number[]>([]);
  const [expandedServiceItemId, setExpandedServiceItemId] = useState<number | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [note, setNote] = useState('');
  const [payoutAmounts, setPayoutAmounts] = useState<Record<number, string>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<number, string>>({});
  const [payoutKey, setPayoutKey] = useState(newPayoutKey);
  const reserveQuery = useMemo(() => {
    const params = new URLSearchParams({ includeWaitingPayment: 'true' });
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    return params.toString();
  }, [dateFrom, dateTo]);

  const { data, isLoading, refetch } = useApiQuery<ReserveResponse>(
    ['doctor-payouts', 'unassigned-performer-reserves', activeCounterId, dateFrom ?? 'all', dateTo ?? 'all'],
    `/api/payment-methods/doctor-payouts/unassigned-performer-reserves?${reserveQuery}`,
    { enabled: enabled && Boolean(activeCounterId) && !dateRangeError, staleTime: 20_000 },
  );
  const { data: doctorsData } = useApiQuery<{ doctors: DoctorOption[] }>(
    ['doctor-payouts', 'performer-doctors'],
    '/api/doctors?is_active=active&limit=200',
    { enabled: enabled && Boolean(activeCounterId), staleTime: 60_000 },
  );

  useEffect(() => {
    setSelectedReserveIds([]);
    setExpandedServiceItemId(null);
    setPayoutAmounts({});
    setOverrideReasons({});
    setPayoutKey(newPayoutKey());
  }, [dateFrom, dateTo]);

  const groups = data?.groups ?? [];
  const doctors = doctorsData?.doctors ?? [];
  const allReserves = useMemo(() => groups.flatMap((group) => group.reserves), [groups]);
  const selectedRows = useMemo(() => (
    allReserves.filter((row) => selectedReserveIds.includes(row.reserveId) && row.billIsPaid)
  ), [allReserves, selectedReserveIds]);
  const finalAmountFor = (row: ReserveItem): number => {
    const edited = payoutAmounts[row.reserveId];
    return edited == null ? Number(row.reservedAmount ?? 0) : Number(edited);
  };
  const selectedAmount = useMemo(() => (
    selectedRows.reduce((sum, row) => sum + finalAmountFor(row), 0)
  ), [selectedRows, payoutAmounts]);
  const changedRows = useMemo(() => selectedRows.filter((row) => (
    finalAmountFor(row) !== Number(row.reservedAmount ?? 0)
  )), [selectedRows, payoutAmounts]);
  const hasInvalidLineAmount = selectedRows.some((row) => {
    const finalAmount = finalAmountFor(row);
    return !Number.isFinite(finalAmount) || finalAmount <= 0 || finalAmount > Number(row.payoutMaximumAmount ?? 0);
  });
  const hasMissingOverrideReason = changedRows.some((row) => (overrideReasons[row.reserveId]?.trim().length ?? 0) < 3);
  const selectedDoctor = doctors.find((doctor) => doctor.id === Number(doctorId)) ?? null;

  const payout = useApiMutation<PayoutResponse, {
    doctorId: number;
    reserveIds: number[];
    lineOverrides: Array<{ lineId: number; payoutAmount: number; reason: string }>;
    receiverType: 'doctor';
    receiverName: string;
    paymentMethod: 'cash';
    adjustments: { advanceDeduction: number; otherAdjustment: number; roundingAdjustment: number };
    note?: string;
    idempotencyKey: string;
  }>(
    'post',
    () => `/api/payment-methods/doctor-payouts/sessions/${activeCounterId}/pay-reserves`,
    {
      onSuccess: (response) => {
        toast.success(t('performerReservePayoutRecorded', {
          defaultValue: 'Performer payout recorded: ৳{{amount}} to {{doctor}}',
          amount: money(response.amount),
          doctor: response.doctorName,
        }));
        setSelectedReserveIds([]);
        setExpandedServiceItemId(null);
        setDoctorId('');
        setNote('');
        setPayoutAmounts({});
        setOverrideReasons({});
        setPayoutKey(newPayoutKey());
        queryClient.invalidateQueries({ queryKey: ['doctor-payouts'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
        queryClient.invalidateQueries({ queryKey: ['commissions'] });
        queryClient.invalidateQueries({ queryKey: ['cash-operations'] });
        queryClient.invalidateQueries({ queryKey: ['daily-collection'] });
        void refetch();
        onRecorded?.();
      },
      onError: (error) => toast.error(error.message || t('performerReservePayoutFailed', {
        defaultValue: 'Failed to record performer reserve payout',
      })),
    },
  );

  const setGroupQuantity = (group: ReserveGroup, quantity: number) => {
    const groupEligibleIds = group.reserves.filter((row) => row.billIsPaid).map((row) => row.reserveId);
    const nextGroupIds = selectOldestReserveIds(group.reserves, Math.min(group.eligibleQuantity, Math.max(0, quantity)));
    setSelectedReserveIds((current) => [
      ...current.filter((id) => !groupEligibleIds.includes(id)),
      ...nextGroupIds,
    ]);
    setPayoutKey(newPayoutKey());
  };

  const setGroupPayoutAmount = (group: ReserveGroup, value: string) => {
    const selectedGroupRows = group.reserves.filter((row) => (
      row.billIsPaid && selectedReserveIds.includes(row.reserveId)
    ));
    setPayoutAmounts((current) => {
      const next = { ...current };
      for (const row of selectedGroupRows) {
        if (value === '') delete next[row.reserveId];
        else next[row.reserveId] = value;
      }
      return next;
    });
    if (value === '') {
      setOverrideReasons((current) => {
        const next = { ...current };
        for (const row of selectedGroupRows) delete next[row.reserveId];
        return next;
      });
    }
    setPayoutKey(newPayoutKey());
  };

  const setGroupOverrideReason = (group: ReserveGroup, value: string) => {
    const changedGroupRows = group.reserves.filter((row) => (
      row.billIsPaid
      && selectedReserveIds.includes(row.reserveId)
      && finalAmountFor(row) !== Number(row.reservedAmount ?? 0)
    ));
    setOverrideReasons((current) => {
      const next = { ...current };
      for (const row of changedGroupRows) next[row.reserveId] = value;
      return next;
    });
    setPayoutKey(newPayoutKey());
  };

  const toggleReserve = (group: ReserveGroup, reserve: ReserveItem) => {
    if (!reserve.billIsPaid) return;
    setSelectedReserveIds((current) => current.includes(reserve.reserveId)
      ? current.filter((id) => id !== reserve.reserveId)
      : [...current, reserve.reserveId]);
    setExpandedServiceItemId(group.billingServiceItemId);
    setPayoutKey(newPayoutKey());
  };

  const canSubmit = Boolean(
    activeCounterId
    && selectedDoctor
    && selectedReserveIds.length > 0
    && selectedAmount > 0
    && selectedAmount <= Number(expectedCash ?? 0)
    && !hasInvalidLineAmount
    && !hasMissingOverrideReason
    && !payout.isPending,
  );

  if (!enabled || !activeCounterId) return null;

  return (
    <section className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20" aria-labelledby="unassigned-performer-reserve-title">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="unassigned-performer-reserve-title" className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">Unassigned Test Performer Reserves</h3>
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-200">Select test quantity, assign the performer doctor, and pay from the active drawer.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {onDateRangeChange ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold text-emerald-800 dark:text-emerald-100">
                Reserve From
                <input
                  aria-label="Reserve from date"
                  className="input mt-1 min-w-0"
                  type="date"
                  value={dateFrom ?? ''}
                  onChange={(event) => onDateRangeChange(event.target.value, dateTo ?? '')}
                />
              </label>
              <label className="text-xs font-semibold text-emerald-800 dark:text-emerald-100">
                Reserve To
                <input
                  aria-label="Reserve to date"
                  className="input mt-1 min-w-0"
                  type="date"
                  value={dateTo ?? ''}
                  onChange={(event) => onDateRangeChange(dateFrom ?? '', event.target.value)}
                />
              </label>
              {dateRangeError ? <p className="col-span-2 text-xs font-medium text-red-600">{dateRangeError}</p> : null}
            </div>
          ) : null}
          <button type="button" className="rounded border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-slate-900" onClick={() => void refetch()} disabled={isLoading || Boolean(dateRangeError)}>Refresh</button>
        </div>
      </div>

      {isLoading ? <div className="text-xs text-emerald-700">Loading…</div> : groups.length === 0 ? (
        <div className="rounded-md bg-white/70 p-3 text-xs text-emerald-700 dark:bg-slate-900/60">No unassigned performer reserve found.</div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-md bg-white p-2 text-xs dark:bg-slate-900"><div className="text-emerald-700">Tests</div><div className="text-lg font-semibold">{data?.summary.testCount ?? 0}</div></div>
            <div className="rounded-md bg-white p-2 text-xs dark:bg-slate-900"><div className="text-emerald-700">Ready units</div><div className="text-lg font-semibold">{data?.summary.eligibleQuantity ?? 0}</div></div>
            <div className="rounded-md bg-white p-2 text-xs dark:bg-slate-900"><div className="text-emerald-700">Waiting units</div><div className="text-lg font-semibold">{data?.summary.waitingPaymentQuantity ?? 0}</div></div>
            <div className="rounded-md bg-white p-2 text-xs dark:bg-slate-900"><div className="text-emerald-700">Ready amount</div><div className="text-lg font-semibold">৳{money(data?.summary.eligibleAmount)}</div></div>
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {groups.map((group) => {
              const eligibleIds = group.reserves.filter((row) => row.billIsPaid).map((row) => row.reserveId);
              const selectedGroupRows = group.reserves.filter((row) => (
                row.billIsPaid && selectedReserveIds.includes(row.reserveId)
              ));
              const selectedQuantity = selectedGroupRows.length;
              const groupFinalAmounts = selectedGroupRows.map(finalAmountFor);
              const commonGroupPayout = groupFinalAmounts.length > 0
                && groupFinalAmounts.every((amount) => amount === groupFinalAmounts[0])
                ? String(groupFinalAmounts[0])
                : '';
              const changedGroupRows = selectedGroupRows.filter((row) => (
                finalAmountFor(row) !== Number(row.reservedAmount ?? 0)
              ));
              const groupReasonValues = changedGroupRows.map((row) => overrideReasons[row.reserveId] ?? '');
              const commonGroupReason = groupReasonValues.length > 0
                && groupReasonValues.every((reason) => reason === groupReasonValues[0])
                ? groupReasonValues[0]
                : '';
              const groupPayoutMaximum = selectedGroupRows.length > 0
                ? Math.min(...selectedGroupRows.map((row) => Number(row.payoutMaximumAmount ?? 0)))
                : undefined;
              const expanded = expandedServiceItemId === group.billingServiceItemId;
              return (
                <div key={group.billingServiceItemId} className="rounded-lg border border-emerald-100 bg-white p-3 dark:border-emerald-900 dark:bg-slate-900">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px_140px_auto] sm:items-end">
                    <div className="self-center">
                      <div className="font-medium">{group.testName}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{group.testCode || group.diagnosticKind} · {group.rateSummary} · Ready: {group.eligibleQuantity} · Waiting for payment: {group.waitingPaymentQuantity}</div>
                    </div>
                    <div>
                      <label className="label text-xs" htmlFor={`reserve-quantity-${group.billingServiceItemId}`}>Quantity</label>
                      <input
                        id={`reserve-quantity-${group.billingServiceItemId}`}
                        aria-label={`${group.testName} payout quantity`}
                        className="input h-9"
                        type="number"
                        min="0"
                        max={group.eligibleQuantity}
                        value={selectedQuantity}
                        onChange={(event) => setGroupQuantity(group, Number(event.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <label className="label text-xs" htmlFor={`reserve-payout-per-unit-${group.billingServiceItemId}`}>Payout / unit</label>
                      <input
                        id={`reserve-payout-per-unit-${group.billingServiceItemId}`}
                        aria-label={`${group.testName} payout per unit`}
                        className="input h-9"
                        type="number"
                        min="0.01"
                        max={groupPayoutMaximum}
                        step="0.01"
                        disabled={selectedQuantity === 0}
                        value={commonGroupPayout}
                        placeholder={selectedQuantity === 0 ? 'Select qty' : 'Mixed'}
                        onChange={(event) => setGroupPayoutAmount(group, event.target.value)}
                      />
                    </div>
                    <button type="button" className="btn-secondary text-xs" aria-label={`${expanded ? 'Hide' : 'Show'} reserve details for ${group.testName}`} onClick={() => setExpandedServiceItemId(expanded ? null : group.billingServiceItemId)}>{expanded ? 'Hide details' : 'Show details'}</button>
                  </div>
                  {changedGroupRows.length > 0 ? (
                    <div className="mt-3 grid gap-2 rounded-md border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-900 dark:bg-amber-950/20 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <label className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                        Override reason
                        <input
                          aria-label={`${group.testName} payout override reason`}
                          className="input mt-1 h-9"
                          value={commonGroupReason}
                          onChange={(event) => setGroupOverrideReason(group, event.target.value)}
                          placeholder="Why is this payout amount different?"
                        />
                      </label>
                      <div className="pb-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                        Applies to {changedGroupRows.length} selected unit{changedGroupRows.length === 1 ? '' : 's'}
                      </div>
                    </div>
                  ) : null}

                  {expanded ? <div className="mt-3 space-y-2 border-t border-emerald-100 pt-2 dark:border-emerald-900">
                    {group.reserves.map((reserve) => {
                      const selected = selectedReserveIds.includes(reserve.reserveId);
                      const calculatedAmount = Number(reserve.reservedAmount ?? 0);
                      const finalAmount = finalAmountFor(reserve);
                      const difference = finalAmount - calculatedAmount;
                      const changed = selected && Number.isFinite(finalAmount) && difference !== 0;
                      return (
                        <div key={reserve.reserveId} className={`rounded-md px-2 py-2 text-xs ${selected ? 'bg-emerald-50/80 ring-1 ring-emerald-100 dark:bg-emerald-950/30' : ''} ${reserve.billIsPaid ? '' : 'opacity-60'}`}>
                          <label className={`flex items-start gap-2 ${reserve.billIsPaid ? 'cursor-pointer' : ''}`}>
                            <input
                              type="checkbox"
                              aria-label={`Select reserve ${reserve.reserveId}`}
                              checked={selected}
                              disabled={!reserve.billIsPaid}
                              onChange={() => toggleReserve(group, reserve)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium">Default ৳{money(calculatedAmount)} · {reserve.patientName || 'Unknown patient'}</span>
                              <span className="block truncate text-[var(--color-text-muted)]">{reserve.patientCode || '—'} · {reserve.invoiceNo || '—'} · {formatDate(reserve.serviceDate)}{reserve.billIsPaid ? '' : ' · Waiting for bill payment'}</span>
                            </span>
                          </label>
                          {selected && reserve.billIsPaid ? (
                            <div className="ml-6 mt-2 grid gap-2 rounded-md border border-emerald-100 bg-white p-2 dark:border-emerald-900 dark:bg-slate-950 sm:grid-cols-[130px_minmax(0,1fr)_auto] sm:items-end">
                              <label className="text-xs font-semibold text-emerald-900 dark:text-emerald-100">
                                Final payout
                                <input
                                  aria-label={`Final payout for reserve ${reserve.reserveId}`}
                                  className="input mt-1 h-9"
                                  type="number"
                                  min="0.01"
                                  max={reserve.payoutMaximumAmount}
                                  step="0.01"
                                  value={payoutAmounts[reserve.reserveId] ?? String(calculatedAmount)}
                                  onChange={(event) => {
                                    setPayoutAmounts((current) => ({ ...current, [reserve.reserveId]: event.target.value }));
                                    setPayoutKey(newPayoutKey());
                                  }}
                                />
                              </label>
                              {changed ? (
                                <label className="text-xs font-semibold text-emerald-900 dark:text-emerald-100">
                                  Override reason
                                  <input
                                    aria-label={`Override reason for reserve ${reserve.reserveId}`}
                                    className="input mt-1 h-9"
                                    value={overrideReasons[reserve.reserveId] ?? ''}
                                    onChange={(event) => {
                                      setOverrideReasons((current) => ({ ...current, [reserve.reserveId]: event.target.value }));
                                      setPayoutKey(newPayoutKey());
                                    }}
                                    placeholder="Why is this amount different?"
                                  />
                                </label>
                              ) : <div className="text-xs text-[var(--color-text-muted)]">Uses calculated amount</div>}
                              <div className={`pb-2 text-right font-semibold ${difference > 0 ? 'text-amber-700' : difference < 0 ? 'text-blue-700' : 'text-emerald-700'}`}>
                                {changed ? `Difference ${difference > 0 ? '+' : '-'}৳${money(Math.abs(difference))}` : 'No difference'}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div> : null}
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-emerald-100 bg-white p-3 dark:border-emerald-900 dark:bg-slate-900">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="label" htmlFor="performer-reserve-doctor">Performer doctor</label>
                <select id="performer-reserve-doctor" aria-label="Performer doctor" className="input" value={doctorId} onChange={(event) => { setDoctorId(event.target.value); setPayoutKey(newPayoutKey()); }}>
                  <option value="">Select doctor</option>
                  {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? ` · ${doctor.specialty}` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="performer-reserve-note">Payout note / envelope reference</label>
                <input id="performer-reserve-note" aria-label="Performer payout note" className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="USG envelope, receiver signature, etc." />
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Selected {selectedReserveIds.length} units · ৳{money(selectedAmount)}</div>
              <button
                type="button"
                className="btn-primary px-4"
                disabled={!canSubmit}
                onClick={() => {
                  if (!selectedDoctor) return;
                  payout.mutate({
                    doctorId: selectedDoctor.id,
                    reserveIds: [...selectedReserveIds].sort((a, b) => a - b),
                    lineOverrides: changedRows.map((row) => ({
                      lineId: row.reserveId,
                      payoutAmount: finalAmountFor(row),
                      reason: overrideReasons[row.reserveId].trim(),
                    })),
                    receiverType: 'doctor',
                    receiverName: selectedDoctor.name,
                    paymentMethod: 'cash',
                    adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
                    note: note.trim() || undefined,
                    idempotencyKey: payoutKey,
                  });
                }}
              >{payout.isPending ? 'Paying…' : `Pay performer ৳${money(selectedAmount)}`}</button>
            </div>
            {selectedReserveIds.length > 0 && !selectedDoctor ? <p className="mt-2 text-xs text-amber-700">Select the performer doctor before payout.</p> : null}
            {hasMissingOverrideReason ? <p className="mt-2 text-xs font-medium text-amber-700">Enter an override reason for every changed payout amount.</p> : null}
            {hasInvalidLineAmount ? <p className="mt-2 text-xs font-medium text-red-600">Each payout must be positive and cannot exceed the service amount.</p> : null}
            {selectedAmount > Number(expectedCash ?? 0) ? <p className="mt-2 text-xs font-medium text-red-600">Selected payout is greater than current drawer cash.</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}
