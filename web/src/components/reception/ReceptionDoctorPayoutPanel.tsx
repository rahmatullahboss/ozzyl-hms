import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import UnassignedPerformerReservePanel from './UnassignedPerformerReservePanel';

type DoctorPayableAccrual = {
  id: number;
  sourceLabel: string;
  patientName?: string | null;
  patientCode?: string | null;
  invoiceNo?: string | null;
  grossAmount: number;
  payableAmount: number;
  status: string;
  accruedDate?: string | null;
};

type DoctorPayableGroup = {
  doctorId: number;
  doctorName: string;
  doctorSpecialization?: string | null;
  payableAmount: number;
  outstandingCount: number;
  sourceTotals: Record<string, number>;
  accruals: DoctorPayableAccrual[];
};

type DoctorPayablesResponse = {
  doctors: DoctorPayableGroup[];
  summary: {
    doctorCount: number;
    outstandingCount: number;
    payableAmount: number;
  };
};

type PayoutResponse = {
  success: boolean;
  message: string;
  settlementId: number;
  voucherId?: number | null;
  amount: number;
  doctorId: number;
  doctorName: string;
  paidCount: number;
  referenceNo?: string | null;
};

function money(value: unknown): string {
  return Number(value ?? 0).toLocaleString('en-BD', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function newDoctorPayoutKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `doctor-payout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ReceptionDoctorPayoutPanel({
  activeCounterId,
  expectedCash,
  enabled,
  onRecorded,
}: {
  activeCounterId?: number | null;
  expectedCash: number;
  enabled: boolean;
  onRecorded?: () => void;
}) {
  const { t } = useTranslation(['billing', 'common']);
  const queryClient = useQueryClient();
  const [expandedDoctorId, setExpandedDoctorId] = useState<number | null>(null);
  const [selectedAccrualIds, setSelectedAccrualIds] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const [payoutKey, setPayoutKey] = useState(() => newDoctorPayoutKey());

  const { data, isLoading, refetch } = useApiQuery<DoctorPayablesResponse>(
    ['doctor-payouts', 'payables', activeCounterId],
    '/api/payment-methods/doctor-payouts/payables',
    { enabled: enabled && Boolean(activeCounterId), staleTime: 30_000 },
  );

  const doctors = data?.doctors ?? [];
  const selectedDoctor = useMemo(() => {
    if (selectedAccrualIds.length === 0) return null;
    return doctors.find((doctor) => doctor.accruals.some((row) => selectedAccrualIds.includes(row.id))) ?? null;
  }, [doctors, selectedAccrualIds]);

  const selectedAmount = useMemo(() => {
    if (!selectedDoctor) return 0;
    return selectedDoctor.accruals
      .filter((row) => selectedAccrualIds.includes(row.id))
      .reduce((sum, row) => sum + Number(row.payableAmount ?? 0), 0);
  }, [selectedDoctor, selectedAccrualIds]);

  const payout = useApiMutation<PayoutResponse, { doctorId: number; accrualIds: number[]; receiverType: 'doctor'; receiverName: string; paymentMethod: 'cash'; adjustments: { advanceDeduction: number; otherAdjustment: number; roundingAdjustment: number }; notes?: string; idempotencyKey: string }>(
    'post',
    () => `/api/payment-methods/doctor-payouts/sessions/${activeCounterId}/pay`,
    {
      onSuccess: (response) => {
        toast.success(t('doctorPayoutRecorded', { defaultValue: 'Doctor payout recorded: ৳{{amount}} to {{doctor}}', amount: money(response.amount), doctor: response.doctorName }));
        setSelectedAccrualIds([]);
        setExpandedDoctorId(null);
        setNote('');
        setPayoutKey(newDoctorPayoutKey());
        queryClient.invalidateQueries({ queryKey: ['doctor-payouts'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
        queryClient.invalidateQueries({ queryKey: ['commissions'] });
        void refetch();
        onRecorded?.();
      },
      onError: (error) => toast.error(error.message || t('failedDoctorPayout', { defaultValue: 'Failed to record doctor payout' })),
    },
  );

  const canSubmit = Boolean(
    activeCounterId
    && selectedDoctor
    && selectedAccrualIds.length > 0
    && selectedAmount > 0
    && selectedAmount <= Number(expectedCash ?? 0)
    && !payout.isPending,
  );

  const toggleDoctor = (doctor: DoctorPayableGroup) => {
    const ids = doctor.accruals.map((row) => row.id);
    const allSelected = ids.every((id) => selectedAccrualIds.includes(id));
    setSelectedAccrualIds(allSelected ? [] : ids);
    setExpandedDoctorId(doctor.doctorId);
    setPayoutKey(newDoctorPayoutKey());
  };

  const toggleAccrual = (doctor: DoctorPayableGroup, accrualId: number) => {
    const sameDoctorSelected = selectedDoctor?.doctorId === doctor.doctorId || selectedAccrualIds.length === 0;
    setExpandedDoctorId(doctor.doctorId);
    setPayoutKey(newDoctorPayoutKey());
    setSelectedAccrualIds((current) => {
      const base = sameDoctorSelected ? current : [];
      return base.includes(accrualId)
        ? base.filter((id) => id !== accrualId)
        : [...base, accrualId];
    });
  };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/20" aria-labelledby="topbar-doctor-payout-title">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div id="topbar-doctor-payout-title" className="text-sm font-semibold text-blue-900 dark:text-blue-100">
            {t('doctorPayoutEnvelope', { defaultValue: 'Doctor Payout / Envelope' })}
          </div>
          <p className="text-xs text-blue-700 dark:text-blue-200">
            {t('doctorPayoutEnvelopeDesc', { defaultValue: 'Pay doctor fees from the current drawer. This is linked to doctor payable ledger, not expense.' })}
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60 dark:bg-slate-900"
          disabled={isLoading || !activeCounterId}
          onClick={() => void refetch()}
        >
          {t('refresh', { ns: 'common', defaultValue: 'Refresh' })}
        </button>
      </div>

      {!enabled || !activeCounterId ? (
        <div className="rounded-md bg-white/70 p-3 text-xs text-blue-700 dark:bg-slate-900/60">
          {t('openCounterBeforeDoctorPayout', { defaultValue: 'Open a counter before recording doctor payouts.' })}
        </div>
      ) : isLoading ? (
        <div className="rounded-md bg-white/70 p-3 text-xs text-blue-700 dark:bg-slate-900/60">
          {t('loading', { ns: 'common', defaultValue: 'Loading…' })}
        </div>
      ) : doctors.length === 0 ? (
        <div className="rounded-md bg-white/70 p-3 text-xs text-blue-700 dark:bg-slate-900/60">
          {t('noDoctorPayables', { defaultValue: 'No payable doctor fee found for fully paid bills.' })}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md bg-white p-2 text-xs dark:bg-slate-900">
              <div className="text-blue-700 dark:text-blue-200">{t('pendingDoctors', { defaultValue: 'Pending doctors' })}</div>
              <div className="font-data text-lg font-semibold text-blue-950 dark:text-blue-100">{data?.summary.doctorCount ?? 0}</div>
            </div>
            <div className="rounded-md bg-white p-2 text-xs dark:bg-slate-900">
              <div className="text-blue-700 dark:text-blue-200">{t('pendingItems', { defaultValue: 'Pending items' })}</div>
              <div className="font-data text-lg font-semibold text-blue-950 dark:text-blue-100">{data?.summary.outstandingCount ?? 0}</div>
            </div>
            <div className="rounded-md bg-white p-2 text-xs dark:bg-slate-900">
              <div className="text-blue-700 dark:text-blue-200">{t('totalPayable', { defaultValue: 'Total payable' })}</div>
              <div className="font-data text-lg font-semibold text-blue-950 dark:text-blue-100">৳{money(data?.summary.payableAmount)}</div>
            </div>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {doctors.map((doctor) => {
              const ids = doctor.accruals.map((row) => row.id);
              const allSelected = ids.length > 0 && ids.every((id) => selectedAccrualIds.includes(id));
              const expanded = expandedDoctorId === doctor.doctorId;
              return (
                <div key={doctor.doctorId} className="rounded-lg border border-blue-100 bg-white p-3 dark:border-blue-900 dark:bg-slate-900">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" className="text-left" onClick={() => setExpandedDoctorId(expanded ? null : doctor.doctorId)}>
                      <div className="font-medium text-[var(--color-text-primary)]">{doctor.doctorName}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {doctor.doctorSpecialization || t('doctor', { defaultValue: 'Doctor' })} · {doctor.outstandingCount} {t('items', { defaultValue: 'items' })}
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      <div className="font-data text-sm font-semibold text-blue-900 dark:text-blue-100">৳{money(doctor.payableAmount)}</div>
                      <button
                        type="button"
                        onClick={() => toggleDoctor(doctor)}
                        className={`rounded px-2.5 py-1 text-xs font-semibold ${allSelected ? 'bg-blue-600 text-white' : 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                      >
                        {allSelected ? t('selected', { defaultValue: 'Selected' }) : t('selectAll', { defaultValue: 'Select all' })}
                      </button>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="mt-2 space-y-1 border-t border-blue-50 pt-2 dark:border-blue-900">
                      {doctor.accruals.map((row) => (
                        <label key={row.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-blue-950/40">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={selectedAccrualIds.includes(row.id)}
                            onChange={() => toggleAccrual(doctor, row.id)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-[var(--color-text-primary)]">
                              {row.sourceLabel} · ৳{money(row.payableAmount)}
                            </span>
                            <span className="block truncate text-[var(--color-text-muted)]">
                              {row.patientName || t('unknownPatient', { defaultValue: 'Unknown patient' })}
                              {row.patientCode ? ` · ${row.patientCode}` : ''}
                              {row.invoiceNo ? ` · ${row.invoiceNo}` : ''}
                              {` · ${formatDate(row.accruedDate)}`}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-blue-100 bg-white p-3 dark:border-blue-900 dark:bg-slate-900">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <label className="label" htmlFor="doctor-payout-note">{t('payoutNoteOptional', { defaultValue: 'Payout note / envelope ref' })}</label>
                <input
                  id="doctor-payout-note"
                  className="input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('doctorPayoutNotePlaceholder', { defaultValue: 'Paid in envelope, signed by doctor, etc.' })}
                />
              </div>
              <button
                type="button"
                className="btn-primary whitespace-nowrap px-4 text-xs"
                disabled={!canSubmit}
                onClick={() => {
                  if (!selectedDoctor) return;
                  payout.mutate({
                    doctorId: selectedDoctor.doctorId,
                    accrualIds: selectedAccrualIds,
                    receiverType: 'doctor',
                    receiverName: selectedDoctor.doctorName,
                    paymentMethod: 'cash',
                    adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
                    notes: note.trim() || undefined,
                    idempotencyKey: payoutKey,
                  });
                }}
              >
                {payout.isPending
                  ? t('paying', { defaultValue: 'Paying…' })
                  : t('payDoctorAmount', { defaultValue: 'Pay doctor ৳{{amount}}', amount: money(selectedAmount) })}
              </button>
            </div>
            {selectedAmount > Number(expectedCash ?? 0) ? (
              <p className="mt-2 text-xs font-medium text-red-600">
                {t('doctorPayoutExceedsDrawer', { defaultValue: 'Selected payout is greater than current drawer cash.' })}
              </p>
            ) : null}
          </div>
        </div>
      )}
      </section>
      <UnassignedPerformerReservePanel
        activeCounterId={activeCounterId}
        expectedCash={expectedCash}
        enabled={enabled}
        onRecorded={onRecorded}
      />
    </div>
  );
}
