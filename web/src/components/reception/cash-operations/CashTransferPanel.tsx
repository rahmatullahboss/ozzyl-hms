import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useApiQuery, useQueryClient } from '../../../hooks/useApiQuery';
import { useAuth } from '../../../hooks/useAuth';
import { queryKeys } from '../../../lib/queryKeys';

type Recipient = { id: number; name: string; role?: string };
type RecipientsResponse = { recipients: Recipient[] };
type ActiveCounter = { sessionId: number; counterId?: number; counterName?: string; counterCode?: string; operatorId?: number; operatorName?: string; expectedCash?: number };
type ActiveCountersResponse = { activeCounters?: ActiveCounter[] } | ActiveCounter[];
type DestinationType = 'admin_custody' | 'counter_session';
type TransferType = 'admin_pickup' | 'finance_custody' | 'md_director_handover' | 'inter_counter' | 'emergency' | 'other';
type TransferPayload = {
  amount: number;
  receiverId: number;
  destinationType: DestinationType;
  destinationCounterSessionId?: number;
  transferType: TransferType;
  note?: string;
  idempotencyKey: string;
};
type ReceiveTransferPayload = { transferId: number; receivedAmount: number; note?: string };
type PendingTransfer = {
  id: number;
  transfer_no?: string;
  transferNo?: string;
  amount?: number;
  due_amount?: number;
  dueAmount?: number;
  status?: string;
  transfer_by_name?: string;
  transferByName?: string;
  custody_label?: string;
  custodyLabel?: string;
};
type PendingTransfersResponse = { transfers: PendingTransfer[] };

type ReceiverOption = {
  key: string;
  id: number;
  label: string;
  destinationType: DestinationType;
  destinationCounterSessionId?: number;
  transferType: TransferType;
};

const CASH_OPERATIONS_PANEL_STALE_MS = 10 * 60_000;
const CASH_OPERATIONS_LOOKUP_STALE_MS = 60 * 60_000;

const adminTransferTypes: Array<{ value: TransferType; label: string }> = [
  { value: 'admin_pickup', label: 'Cash pickup by admin' },
  { value: 'finance_custody', label: 'Transfer to accountant / finance' },
  { value: 'md_director_handover', label: 'MD / director handover' },
  { value: 'emergency', label: 'Emergency cash movement' },
  { value: 'other', label: 'Other custody transfer' },
];

function randomKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function money(value: number | undefined) {
  return `৳${Number(value ?? 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`;
}

function roleLabel(role?: string) {
  return (role ?? '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function CashTransferPanel({ sessionId, availableCash = 0 }: { sessionId?: number | null; availableCash?: number }) {
  const { t } = useTranslation('cashOperations');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [receiverKey, setReceiverKey] = useState('');
  const [transferType, setTransferType] = useState<TransferType>('admin_pickup');
  const [note, setNote] = useState('');
  const [receiveAmounts, setReceiveAmounts] = useState<Record<number, string>>({});
  const [receiveNotes, setReceiveNotes] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const currentUserId = Number(user?.userId ?? 0);

  const { data } = useApiQuery<RecipientsResponse>(
    ['cash-operations', 'drawer-custody', 'recipients'],
    '/api/payment-methods/drawer-custody/recipients',
    { staleTime: CASH_OPERATIONS_LOOKUP_STALE_MS },
  );
  const { data: activeCountersData } = useApiQuery<ActiveCountersResponse>(
    ['cash-operations', 'active-counters-for-transfer'],
    '/api/dashboard/active-counters',
    { staleTime: CASH_OPERATIONS_PANEL_STALE_MS },
  );
  const { data: pendingData } = useApiQuery<PendingTransfersResponse>(
    ['cash-operations', 'drawer-custody', 'pending'],
    '/api/payment-methods/drawer-custody/pending',
    { staleTime: CASH_OPERATIONS_PANEL_STALE_MS },
  );

  const recipients = useMemo(
    () => (data?.recipients ?? []).filter((recipient) => Number(recipient.id) !== currentUserId),
    [currentUserId, data?.recipients],
  );
  const activeCounters = Array.isArray(activeCountersData) ? activeCountersData : activeCountersData?.activeCounters ?? [];
  const activeCounterRecipients: ReceiverOption[] = activeCounters
    .filter((counter) => counter.sessionId !== sessionId && counter.operatorId && Number(counter.operatorId) !== currentUserId)
    .map((counter) => ({
      key: `counter:${counter.sessionId}:${counter.operatorId}`,
      id: Number(counter.operatorId),
      label: `${counter.counterName ?? `Counter #${counter.counterId ?? counter.sessionId}`} - ${counter.operatorName ?? 'Active cashier'}`,
      destinationType: 'counter_session',
      destinationCounterSessionId: counter.sessionId,
      transferType: 'inter_counter',
    }));
  const adminRecipients: ReceiverOption[] = recipients.map((recipient) => ({
    key: `admin:${recipient.id}`,
    id: Number(recipient.id),
    label: `${recipient.name}${recipient.role ? ` — ${roleLabel(recipient.role)}` : ''}`,
    destinationType: 'admin_custody',
    transferType,
  }));
  const receiverOptions = [...activeCounterRecipients, ...adminRecipients];
  const selectedReceiver = receiverOptions.find((recipient) => recipient.key === receiverKey) ?? null;
  const pendingTransfers = pendingData?.transfers ?? [];

  const receiveTransfer = useApiMutation<{ status?: string }, ReceiveTransferPayload>(
    'post',
    (variables) => `/api/payment-methods/drawer-custody/transfers/${variables.transferId}/receive`,
    {
      onSuccess: async (_response, variables) => {
        setMessage('Cash transfer received.');
        setReceiveAmounts((current) => ({ ...current, [variables.transferId]: '' }));
        setReceiveNotes((current) => ({ ...current, [variables.transferId]: '' }));
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.overview() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.activity({ limit: 20 }) }),
          queryClient.invalidateQueries({ queryKey: ['cash-operations', 'drawer-custody', 'pending'] }),
          queryClient.invalidateQueries({ queryKey: ['cash-operations', 'active-counters-for-transfer'] }),
        ]);
      },
      onError: (error) => setMessage(error.message || 'Failed to receive cash transfer'),
    },
  );

  const createTransfer = useApiMutation<{ transferNo?: string; destinationLabel?: string }, TransferPayload>(
    'post',
    () => `/api/payment-methods/drawer-custody/sessions/${sessionId}/transfers`,
    {
      onSuccess: async (response) => {
        setMessage(t('transfer.created', { suffix: response.transferNo ? `: ${response.transferNo}` : '' }));
        setAmount('');
        setReceiverKey('');
        setTransferType('admin_pickup');
        setNote('');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.overview() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.activity({ limit: 20 }) }),
          queryClient.invalidateQueries({ queryKey: ['cash-operations', 'drawer-custody'] }),
          queryClient.invalidateQueries({ queryKey: ['cash-operations', 'active-counters-for-transfer'] }),
        ]);
      },
      onError: (error) => setMessage(error.message || t('transfer.failed')),
    },
  );

  const numericAmount = Number(amount);
  const amountIsValid = Number.isFinite(numericAmount) && numericAmount > 0;
  const exceedsAvailableCash = amountIsValid && availableCash > 0 && numericAmount > availableCash;
  const canSubmit = Boolean(sessionId && selectedReceiver && amountIsValid && !exceedsAvailableCash);
  const effectiveTransferType = selectedReceiver?.destinationType === 'counter_session' ? 'inter_counter' : transferType;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900" aria-labelledby="cash-transfer-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('transfer.kicker')}</p>
          <h3 id="cash-transfer-title" className="font-semibold text-[var(--color-text-primary)]">{t('transfer.title')}</h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('transfer.subtitle')}</p>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-right">
          <p className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">Available drawer cash</p>
          <p className="text-lg font-bold text-[var(--color-text-primary)]">{money(availableCash)}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm text-[var(--color-text-secondary)]">
        Create a custody movement only when physical cash leaves this drawer. The receiver must accept the transfer before it is closed.
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          Transfer type
          <select
            className="input mt-1"
            value={selectedReceiver?.destinationType === 'counter_session' ? 'inter_counter' : transferType}
            onChange={(event) => setTransferType(event.target.value as TransferType)}
            disabled={selectedReceiver?.destinationType === 'counter_session'}
          >
            {selectedReceiver?.destinationType === 'counter_session'
              ? <option value="inter_counter">Inter-counter transfer</option>
              : adminTransferTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          {selectedReceiver?.destinationType === 'counter_session' ? <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Counter destination uses Inter-counter transfer automatically.</span> : null}
        </label>
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('common.amount')}
          <input className="input mt-1" type="number" min="0" max={availableCash || undefined} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          {exceedsAvailableCash ? <span className="mt-1 block text-xs text-red-600">Amount cannot exceed available drawer cash.</span> : null}
        </label>
        <label className="text-sm font-medium text-[var(--color-text-primary)] md:col-span-2">
          {t('common.receiver')}
          <select className="input mt-1" value={receiverKey} onChange={(event) => setReceiverKey(event.target.value)}>
            <option value="">{t('common.selectReceiver')}</option>
            {activeCounterRecipients.length > 0 ? (
              <optgroup label="Active counters — inter-counter transfer">
                {activeCounterRecipients.map((recipient) => (
                  <option key={recipient.key} value={recipient.key}>{recipient.label}</option>
                ))}
              </optgroup>
            ) : null}
            {adminRecipients.length > 0 ? (
              <optgroup label="Admin / finance custody">
                {adminRecipients.map((recipient) => (
                  <option key={recipient.key} value={recipient.key}>{recipient.label}</option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            Your own user and unauthorized cashier users are hidden. Use Close Shift for full shift handover.
          </span>
        </label>
      </div>

      {selectedReceiver ? (
        <div className="mt-3 rounded-xl border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-secondary)]">
          <span className="font-semibold text-[var(--color-text-primary)]">Pending acceptance preview:</span>{' '}
          {money(amountIsValid ? numericAmount : 0)} to {selectedReceiver.label} · {selectedReceiver.destinationType === 'counter_session' ? 'Counter cash-in after receiver accepts' : 'Admin/finance custody after receiver accepts'}
        </div>
      ) : null}

      {pendingTransfers.length > 0 ? (
        <div className="mt-4 rounded-xl border border-[var(--color-border)] p-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Pending transfers to receive</p>
            <p className="text-xs text-[var(--color-text-muted)]">Count the cash and accept, or enter a lower amount to mark it disputed.</p>
          </div>
          <div className="mt-3 space-y-3">
            {pendingTransfers.map((transfer) => {
              const transferId = Number(transfer.id);
              const expectedAmount = Number(transfer.dueAmount ?? transfer.due_amount ?? transfer.amount ?? 0);
              const amountValue = receiveAmounts[transferId] ?? String(expectedAmount || '');
              const receivedAmount = Number(amountValue);
              const canReceive = Number.isFinite(receivedAmount) && receivedAmount > 0 && receivedAmount <= Number(transfer.amount ?? expectedAmount);
              return (
                <div key={transferId} className="rounded-lg border border-[var(--color-border)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-[var(--color-text-primary)]">{transfer.transferNo ?? transfer.transfer_no ?? `Transfer #${transferId}`}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        From {transfer.transferByName ?? transfer.transfer_by_name ?? 'cashier'} · {transfer.custodyLabel ?? transfer.custody_label ?? transfer.status ?? 'pending'}
                      </p>
                    </div>
                    <p className="font-data font-semibold text-[var(--color-text-primary)]">{money(Number(transfer.amount ?? expectedAmount))}</p>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_auto]">
                    <input
                      className="input"
                      type="number"
                      min="0"
                      max={Number(transfer.amount ?? expectedAmount) || undefined}
                      step="0.01"
                      value={amountValue}
                      onChange={(event) => setReceiveAmounts((current) => ({ ...current, [transferId]: event.target.value }))}
                    />
                    <input
                      className="input"
                      value={receiveNotes[transferId] ?? ''}
                      onChange={(event) => setReceiveNotes((current) => ({ ...current, [transferId]: event.target.value }))}
                      placeholder="Receiver note / dispute reason"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!canReceive || receiveTransfer.isPending}
                      onClick={() => receiveTransfer.mutate({
                        transferId,
                        receivedAmount,
                        note: receiveNotes[transferId]?.trim() || undefined,
                      })}
                    >
                      Receive
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <label className="mt-3 block text-sm font-medium text-[var(--color-text-primary)]">
        {t('common.note')}
        <textarea className="input mt-1 min-h-20" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('transfer.notePlaceholder')} />
      </label>

      {message ? <p className="mt-3 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)]">{message}</p> : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit || createTransfer.isPending}
          onClick={() => {
            if (!selectedReceiver) return;
            createTransfer.mutate({
              amount: numericAmount,
              receiverId: selectedReceiver.id,
              destinationType: selectedReceiver.destinationType,
              destinationCounterSessionId: selectedReceiver.destinationCounterSessionId,
              transferType: effectiveTransferType,
              note: note.trim() || undefined,
              idempotencyKey: randomKey(),
            });
          }}
        >
          {createTransfer.isPending ? t('common.creating') : t('transfer.submit')}
        </button>
      </div>
    </section>
  );
}
