import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useQueryClient } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';
import { formatCurrency } from '../../../lib/format';

type BankDepositPayload = {
  amount: number;
  proposedBankName?: string;
  note?: string;
  idempotencyKey: string;
};

function randomKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `bank-deposit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function money(value: unknown) {
  return formatCurrency(Number(value ?? 0), { fractionDigits: 2 });
}

export default function BankDepositPanel({ sessionId, availableCash }: { sessionId?: number | null; availableCash?: number }) {
  const { t } = useTranslation('cashOperations');
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [proposedBankName, setProposedBankName] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const createRequest = useApiMutation<{ request?: { requestNo?: string } }, BankDepositPayload>(
    'post',
    () => `/api/billing-counter/sessions/${sessionId}/bank-deposit-requests`,
    {
      onSuccess: async (response) => {
        setMessage(t('bank.created', { suffix: response.request?.requestNo ? `: ${response.request.requestNo}` : '' }));
        setAmount('');
        setNote('');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.overview() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.activity({ limit: 20 }) }),
        ]);
      },
      onError: (error) => setMessage(error.message || t('bank.failed')),
    },
  );

  const numericAmount = Number(amount);
  const canSubmit = Boolean(sessionId && Number.isFinite(numericAmount) && numericAmount > 0);

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900" aria-labelledby="bank-deposit-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('bank.kicker')}</p>
        <h3 id="bank-deposit-title" className="font-semibold text-[var(--color-text-primary)]">{t('bank.title')}</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('bank.subtitle')}</p>
      </div>

      <div className="mt-4 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
        {t('bank.currentDrawerBalance')}: <span className="font-data font-semibold text-[var(--color-text-primary)]">{money(availableCash)}</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('bank.depositAmount')}
          <input className="input mt-1" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('bank.proposedBank')}
          <input className="input mt-1" value={proposedBankName} onChange={(event) => setProposedBankName(event.target.value)} placeholder={t('common.optional')} />
        </label>
      </div>
      <label className="mt-3 block text-sm font-medium text-[var(--color-text-primary)]">
        {t('bank.depositNote')}
        <textarea className="input mt-1 min-h-20" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('bank.notePlaceholder')} />
      </label>

      {message ? <p className="mt-3 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)]">{message}</p> : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit || createRequest.isPending}
          onClick={() => createRequest.mutate({
            amount: numericAmount,
            proposedBankName: proposedBankName.trim() || undefined,
            note: note.trim() || undefined,
            idempotencyKey: randomKey(),
          })}
        >
          {createRequest.isPending ? t('common.creating') : t('bank.submit')}
        </button>
      </div>
    </section>
  );
}
