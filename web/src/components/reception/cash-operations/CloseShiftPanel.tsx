import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useApiQuery, useQueryClient } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';
import { formatCurrency } from '../../../lib/format';
import { buildDenominationSheetHtml, openSingleDocumentWindow } from '../../../lib/print/reception/singleDocuments';
import { useAuth } from '../../../hooks/useAuth';

type Recipient = { id: number; name: string; role?: string };
type RecipientsResponse = { recipients: Recipient[] };
type ActiveCounter = { sessionId: number; counterId?: number; counterName?: string; operatorId?: number; operatorName?: string; expectedCash?: number };
type ActiveCountersResponse = { activeCounters?: ActiveCounter[] } | ActiveCounter[];
type DenominationKey = 'note1000' | 'note500' | 'note200' | 'note100' | 'note50' | 'note20' | 'note10' | 'note5' | 'note2' | 'note1';
type DenominationPayload = Record<DenominationKey, number>;
type NonCashSettlementPayload = { bkash?: number; nagad?: number; rocket?: number; card?: number; bank?: number; bank_transfer?: number; cheque?: number; other?: number };
type ShiftPayload = { closingCash: number; closingDenominations?: DenominationPayload; nonCashSettlements?: NonCashSettlementPayload; nonCashRemarks?: string; handoverTo?: number; handoverAmount?: number; remarks?: string };
type CloseResponse = {
  message?: string;
  sessionId?: number;
  varianceApprovalRequired?: boolean;
  varianceApprovalStatus?: string;
};

const CASH_OPERATIONS_PANEL_STALE_MS = 10 * 60_000;
const CASH_OPERATIONS_LOOKUP_STALE_MS = 60 * 60_000;

const NON_CASH_METHODS: Array<{ key: keyof NonCashSettlementPayload; label: string }> = [
  { key: 'bkash', label: 'bKash' },
  { key: 'nagad', label: 'Nagad' },
  { key: 'rocket', label: 'Rocket' },
  { key: 'card', label: 'Card/POS' },
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'cheque', label: 'Cheque' },
  { key: 'other', label: 'Other' },
];

const DENOMINATIONS: Array<{ note: number; key: DenominationKey }> = [
  { note: 1000, key: 'note1000' },
  { note: 500, key: 'note500' },
  { note: 200, key: 'note200' },
  { note: 100, key: 'note100' },
  { note: 50, key: 'note50' },
  { note: 20, key: 'note20' },
  { note: 10, key: 'note10' },
  { note: 5, key: 'note5' },
  { note: 2, key: 'note2' },
  { note: 1, key: 'note1' },
];

const emptyDenominations = (): Record<DenominationKey, string> => ({
  note1000: '',
  note500: '',
  note200: '',
  note100: '',
  note50: '',
  note20: '',
  note10: '',
  note5: '',
  note2: '',
  note1: '',
});

function money(value: unknown) {
  return formatCurrency(Number(value ?? 0), { fractionDigits: 2 });
}

function moneyInCents(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function moneyAmount(value: unknown): number {
  return moneyInCents(value) / 100;
}

function buildDenominationPayload(values: Record<DenominationKey, string>): DenominationPayload {
  return DENOMINATIONS.reduce((payload, row) => {
    payload[row.key] = Math.max(0, Math.round(Number(values[row.key] || 0)));
    return payload;
  }, {} as DenominationPayload);
}

export default function CloseShiftPanel({
  sessionId,
  expectedCash,
  heldRefundCash = 0,
  availableCash,
}: {
  sessionId?: number | null;
  expectedCash?: number;
  heldRefundCash?: number;
  availableCash?: number;
}) {
  const { t } = useTranslation('cashOperations');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [physicalCash, setPhysicalCash] = useState('');
  const [denominations, setDenominations] = useState<Record<DenominationKey, string>>(() => emptyDenominations());
  const [nonCashSettlements, setNonCashSettlements] = useState<Record<string, string>>({});
  const [nonCashRemarks, setNonCashRemarks] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [handoverAmount, setHandoverAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const { data } = useApiQuery<RecipientsResponse>(
    ['cash-operations', 'shift', 'recipients'],
    '/api/billing-counter/handover-recipients',
    { staleTime: CASH_OPERATIONS_LOOKUP_STALE_MS },
  );
  const { data: activeCountersData } = useApiQuery<ActiveCountersResponse>(
    ['cash-operations', 'active-counters-for-handover'],
    '/api/dashboard/active-counters',
    { staleTime: CASH_OPERATIONS_PANEL_STALE_MS },
  );
  const recipients = data?.recipients ?? [];
  const activeCounters = Array.isArray(activeCountersData) ? activeCountersData : activeCountersData?.activeCounters ?? [];
  const activeCounterRecipients = activeCounters
    .filter((counter) => counter.sessionId !== sessionId && counter.operatorId)
    .map((counter) => ({
      id: Number(counter.operatorId),
      label: `${counter.counterName ?? `Counter #${counter.counterId ?? counter.sessionId}`} - ${counter.operatorName ?? 'Active cashier'}`,
      sessionId: counter.sessionId,
    }));

  const denominationPayload = useMemo(() => buildDenominationPayload(denominations), [denominations]);
  const nonCashSettlementPayload = useMemo(() => NON_CASH_METHODS.reduce((payload, row) => {
    const amount = Number(nonCashSettlements[row.key] || 0);
    if (Number.isFinite(amount) && amount > 0) payload[row.key] = amount;
    return payload;
  }, {} as NonCashSettlementPayload), [nonCashSettlements]);
  const denominationTotal = useMemo(() => DENOMINATIONS.reduce((sum, row) => sum + denominationPayload[row.key] * row.note, 0), [denominationPayload]);
  const hasDenominations = useMemo(() => DENOMINATIONS.some((row) => denominationPayload[row.key] > 0), [denominationPayload]);
  const physicalCashCents = moneyInCents(physicalCash);
  const numericPhysicalCash = physicalCashCents / 100;
  const denominationsMatchDeclared = !hasDenominations || denominationTotal === numericPhysicalCash;
  const numericHandoverAmount = handoverAmount ? moneyAmount(handoverAmount) : numericPhysicalCash;
  const numericRecipientId = Number(recipientId);
  const expectedAvailableCashCents = availableCash === undefined
    ? Math.max(0, moneyInCents(expectedCash) - moneyInCents(heldRefundCash))
    : moneyInCents(availableCash);
  const expectedAvailableCash = expectedAvailableCashCents / 100;
  const variance = (physicalCashCents - expectedAvailableCashCents) / 100;

  const finalizeReport = useApiMutation<{ snapshot?: { reportNo?: string } }, { sessionId: number }>(
    'post',
    (variables) => `/api/reports/shift-handover/sessions/${variables.sessionId}/finalize`,
    {
      onSuccess: async (response) => {
        const reportNo = response.snapshot?.reportNo ? ` · Report ${response.snapshot.reportNo}` : '';
        setMessage(`${t('close.submitted')}${reportNo}`);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['shift-handover-report'] }),
          queryClient.invalidateQueries({ queryKey: ['reports', 'shift-handover'] }),
          queryClient.invalidateQueries({ queryKey: ['reports', 'shift-handover', 'history'] }),
        ]);
      },
      onError: (error) => setMessage(`${t('close.submitted')} · Report snapshot failed: ${error.message}`),
    },
  );

  const submitShift = useApiMutation<CloseResponse, ShiftPayload>(
    'post',
    () => `/api/billing-counter/sessions/${sessionId}/close`,
    {
      onSuccess: async (response) => {
        setMessage(response.message || t('close.submitted'));
        setDenominations(emptyDenominations());
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.overview() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.activity({ limit: 20 }) }),
        ]);
        const closedSessionId = Number(response.sessionId ?? sessionId ?? 0);
        if (!response.varianceApprovalRequired && closedSessionId > 0) {
          finalizeReport.mutate({ sessionId: closedSessionId });
        }
        // Auto-open Denomination Sheet (soft: window may be blocked, that's fine)
        if (hasDenominations) {
          const hospitalName = String((user as any)?.hospitalName ?? (user as any)?.tenantName ?? 'Hospital');
          const cashierName = String((user as any)?.name ?? (user as any)?.username ?? '');
          const html = buildDenominationSheetHtml(
            {
              shift: {
                id: closedSessionId,
                shiftName: null,
                counterName: (user as any)?.activeCounterName ?? null,
                counterCode: (user as any)?.counterCode ?? null,
                cashierName,
                openingCash: 0,
                expectedCash: expectedAvailableCash,
                variance,
                closingCashDeclared: numericPhysicalCash,
              },
              denominations: denominationPayload,
              countedBy: cashierName,
              checkedBy: null,
              countedAt: new Date().toISOString(),
              notes: remarks.trim() || null,
            },
            {
              hospitalName,
              branchName: (user as any)?.branchName ?? null,
              counterName: (user as any)?.activeCounterName ?? null,
              counterCode: (user as any)?.counterCode ?? null,
              shiftId: closedSessionId,
              shiftName: null,
              cashierName,
              generatedBy: cashierName,
              documentTitle: 'Cash Denomination Sheet',
              documentNo: `DENOM-${closedSessionId}`,
              status: 'submitted',
            },
          );
          openSingleDocumentWindow(html, {
            autoPrint: false, // user clicks Print in the preview window — no surprise auto-print
            onAfterPrint: () => {
              void fetch('/api/reception/print-audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  documentType: 'denomination_sheet',
                  documentId: closedSessionId,
                  copyNumber: 1,
                }),
              }).catch(() => { /* silent */ });
            },
          });
        }
      },
      onError: (error) => setMessage(error.message || t('close.failed')),
    },
  );

  const canSubmit = Boolean(
    sessionId
    && Number.isFinite(numericPhysicalCash)
    && numericPhysicalCash >= 0
    && denominationsMatchDeclared
    && Number.isFinite(numericHandoverAmount)
    && numericHandoverAmount >= 0
    && numericHandoverAmount <= numericPhysicalCash
    && ((numericPhysicalCash <= 0 && Number(heldRefundCash ?? 0) <= 0) || (Number.isInteger(numericRecipientId) && numericRecipientId > 0)),
  );

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900" aria-labelledby="close-shift-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('close.kicker')}</p>
        <h3 id="close-shift-title" className="font-semibold text-[var(--color-text-primary)]">{t('close.title')}</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('close.subtitle')}</p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('close.availableCashCounted', { defaultValue: 'Available cash counted for handover' })}
          <input aria-label="Available cash counted for handover" className="input mt-1" type="number" min="0" step="0.01" value={physicalCash} onChange={(event) => setPhysicalCash(event.target.value)} />
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Refund reserve is excluded from this amount and remains under the selected recipient’s custody.</span>
        </label>
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('close.handoverAmount')}
          <input className="input mt-1" type="number" min="0" step="0.01" value={handoverAmount} onChange={(event) => setHandoverAmount(event.target.value)} placeholder={t('close.handoverAmountPlaceholder')} />
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--color-border)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Denomination count</p>
            <p className="text-xs text-[var(--color-text-muted)]">Count notes/coins to make the shift close auditable.</p>
          </div>
          <div className="text-right text-sm">
            <p className="text-[var(--color-text-muted)]">Denomination total</p>
            <p className="font-data font-semibold text-[var(--color-text-primary)]">{money(denominationTotal)}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {DENOMINATIONS.map((row) => (
            <label key={row.key} className="text-xs font-medium text-[var(--color-text-secondary)]">
              ৳{row.note}
              <input
                className="input mt-1"
                type="number"
                min="0"
                step="1"
                value={denominations[row.key]}
                onChange={(event) => setDenominations((current) => ({ ...current, [row.key]: event.target.value }))}
                placeholder="0"
              />
            </label>
          ))}
        </div>
        {hasDenominations && !denominationsMatchDeclared ? (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            Denomination total must match declared physical cash before closing.
          </p>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-[var(--color-border)] p-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">Non-cash settlement</p>
          <p className="text-xs text-[var(--color-text-muted)]">Enter bKash/Nagad/card/bank totals from the terminal or merchant statement.</p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {NON_CASH_METHODS.map((method) => (
            <label key={method.key} className="text-xs font-medium text-[var(--color-text-secondary)]">
              {method.label}
              <input
                className="input mt-1"
                type="number"
                min="0"
                step="0.01"
                value={nonCashSettlements[method.key] ?? ''}
                onChange={(event) => setNonCashSettlements((current) => ({ ...current, [method.key]: event.target.value }))}
                placeholder="0"
              />
            </label>
          ))}
        </div>
        <input
          className="input mt-3"
          value={nonCashRemarks}
          onChange={(event) => setNonCashRemarks(event.target.value)}
          placeholder="Non-cash settlement remarks / POS batch / merchant note"
        />
      </div>

      <label className="mt-3 block text-sm font-medium text-[var(--color-text-primary)]">
        {t('close.handoverRecipient')}
        <select className="input mt-1" value={recipientId} onChange={(event) => setRecipientId(event.target.value)}>
          <option value="">{t('common.selectReceiver')}</option>
          {activeCounterRecipients.length > 0 ? (
            <optgroup label="Active counters">
              {activeCounterRecipients.map((recipient) => (
                <option key={`counter-${recipient.sessionId}-${recipient.id}`} value={recipient.id}>{recipient.label}</option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Reception / admin users">
            {recipients.map((recipient) => (
              <option key={recipient.id} value={recipient.id}>{recipient.name} {recipient.role ? `(${recipient.role})` : ''}</option>
            ))}
          </optgroup>
        </select>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          You can hand over to an active counter cashier or to reception/admin custody.
        </span>
      </label>

      <div className="mt-3 grid gap-2 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <span className="block text-xs text-[var(--color-text-muted)]">Expected drawer cash</span>
          <span className="font-data font-semibold text-[var(--color-text-primary)]">{money(expectedCash)}</span>
        </div>
        <div>
          <span className="block text-xs text-[var(--color-text-muted)]">Pending refund reserve</span>
          <span className="font-data font-semibold text-amber-700">{money(heldRefundCash)}</span>
        </div>
        <div>
          <span className="block text-xs text-[var(--color-text-muted)]">Available handover cash</span>
          <span className="font-data font-semibold text-emerald-700">{money(expectedAvailableCash)}</span>
        </div>
        <div>
          <span className="block text-xs text-[var(--color-text-muted)]">{t('close.variance')}</span>
          <span className="font-data font-semibold text-[var(--color-text-primary)]">{money(variance)}</span>
        </div>
      </div>

      <label className="mt-3 block text-sm font-medium text-[var(--color-text-primary)]">
        {t('close.remarks')}
        <textarea className="input mt-1 min-h-20" value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder={t('close.remarksPlaceholder')} />
      </label>

      {message ? <p className="mt-3 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)]">{message}</p> : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit || submitShift.isPending || finalizeReport.isPending}
          onClick={() => submitShift.mutate({
            closingCash: numericPhysicalCash,
            closingDenominations: hasDenominations ? denominationPayload : undefined,
            nonCashSettlements: Object.keys(nonCashSettlementPayload).length > 0 ? nonCashSettlementPayload : undefined,
            nonCashRemarks: nonCashRemarks.trim() || undefined,
            handoverTo: numericRecipientId || undefined,
            handoverAmount: numericHandoverAmount,
            remarks: remarks.trim() || undefined,
          })}
        >
          {submitShift.isPending || finalizeReport.isPending ? t('common.submitting') : t('close.submit')}
        </button>
      </div>
    </section>
  );
}
