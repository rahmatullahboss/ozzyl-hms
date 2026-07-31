import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

type Recipient = { id: number; name: string; email?: string | null; role: string };
type RecipientResponse = { recipients: Recipient[] };
type TransferResponse = {
  success: boolean;
  transferId: number;
  transferNo: string;
  amount: number;
  transferTo: number;
  transferToName: string;
  status: string;
};

function money(value: unknown): string {
  return Number(value ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function key(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `cash-custody-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ReceptionDrawerCustodyPanel({
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
  const [amount, setAmount] = useState('');
  const [receiverId, setReceiverId] = useState('');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => key());

  const { data, isLoading, refetch } = useApiQuery<RecipientResponse>(
    ['drawer-custody', 'recipients'],
    '/api/payment-methods/drawer-custody/recipients',
    { enabled, staleTime: 60_000 },
  );

  const recipients = data?.recipients ?? [];
  const selectedReceiver = useMemo(() => recipients.find((row) => String(row.id) === receiverId) ?? null, [recipients, receiverId]);
  const transferAmount = Number(amount || 0);
  const exceedsCash = transferAmount > Number(expectedCash ?? 0);
  const canSubmit = Boolean(activeCounterId && receiverId && transferAmount > 0 && !exceedsCash && note.trim().length >= 3);

  const createTransfer = useApiMutation<TransferResponse, { amount: number; receiverId: number; note?: string; idempotencyKey: string }>(
    'post',
    () => `/api/payment-methods/drawer-custody/sessions/${activeCounterId}/transfers`,
    {
      onSuccess: (response) => {
        toast.success(t('cashCustodyCreated', { defaultValue: 'Cash transfer created: ৳{{amount}} to {{name}}', amount: money(response.amount), name: response.transferToName }));
        setAmount('');
        setReceiverId('');
        setNote('');
        setIdempotencyKey(key());
        queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
        queryClient.invalidateQueries({ queryKey: ['drawer-custody'] });
        onRecorded?.();
      },
      onError: (error) => toast.error(error.message || t('cashCustodyFailed', { defaultValue: 'Failed to create cash transfer' })),
    },
  );

  return (
    <section className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20" aria-labelledby="drawer-custody-title">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div id="drawer-custody-title" className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
            {t('cashCustodyTransfer', { defaultValue: 'Cash Transfer to MD/Admin' })}
          </div>
          <p className="text-xs text-emerald-700 dark:text-emerald-200">
            {t('cashCustodyDesc', { defaultValue: 'Move drawer cash to MD, director, accountant, or admin custody. Receiver must confirm it.' })}
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:bg-slate-900"
          disabled={isLoading || !enabled}
          onClick={() => void refetch()}
        >
          {t('refresh', { ns: 'common', defaultValue: 'Refresh' })}
        </button>
      </div>

      {!enabled || !activeCounterId ? (
        <div className="rounded-md bg-white/70 p-3 text-xs text-emerald-700 dark:bg-slate-900/60">
          {t('openCounterBeforeCashTransfer', { defaultValue: 'Open a counter before transferring drawer cash.' })}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <div>
            <label className="label" htmlFor="cash-custody-amount">{t('amount', { ns: 'common', defaultValue: 'Amount' })}</label>
            <input
              id="cash-custody-amount"
              type="number"
              min="0"
              className="input"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
            />
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {t('availableDrawerCash', { defaultValue: 'Available drawer cash: ৳{{amount}}', amount: money(expectedCash) })}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="cash-custody-receiver">{t('receiver', { defaultValue: 'Receiver' })}</label>
            <select id="cash-custody-receiver" className="input" value={receiverId} onChange={(event) => setReceiverId(event.target.value)}>
              <option value="">{isLoading ? t('loading', { ns: 'common', defaultValue: 'Loading…' }) : t('selectReceiver', { defaultValue: 'Select receiver' })}</option>
              {recipients.map((row) => (
                <option key={row.id} value={row.id}>{row.name} · {row.role}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="cash-custody-note">{t('noteRequired', { defaultValue: 'Note / reason' })}</label>
            <input
              id="cash-custody-note"
              className="input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('cashCustodyNotePlaceholder', { defaultValue: 'Mid-shift cash drop, handed to MD, envelope number, etc.' })}
            />
          </div>
          {exceedsCash ? (
            <p className="md:col-span-2 text-xs font-medium text-red-600">
              {t('cashTransferExceedsDrawer', { defaultValue: 'Transfer amount is greater than current drawer cash.' })}
            </p>
          ) : null}
          <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-md bg-white p-2 text-xs dark:bg-slate-900">
            <span className="text-[var(--color-text-muted)]">
              {selectedReceiver ? t('transferPreview', { defaultValue: 'Transfer ৳{{amount}} to {{name}}', amount: money(transferAmount), name: selectedReceiver.name }) : t('selectReceiverAndAmount', { defaultValue: 'Select receiver and amount' })}
            </span>
            <button
              type="button"
              className="btn-primary whitespace-nowrap px-4 text-xs"
              disabled={!canSubmit || createTransfer.isPending}
              onClick={() => createTransfer.mutate({ amount: transferAmount, receiverId: Number(receiverId), note: note.trim(), idempotencyKey })}
            >
              {createTransfer.isPending ? t('saving', { ns: 'common', defaultValue: 'Saving…' }) : t('createCashTransfer', { defaultValue: 'Create transfer' })}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
