import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useApiQuery, useQueryClient } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';

type ExpensePayload = {
  date: string;
  category: string;
  amount: number;
  description?: string;
  payeeName?: string;
  idempotencyKey?: string;
  paidFromDrawer?: boolean;
};
type ExpenseItem = {
  id: number;
  date?: string;
  category?: string;
  amount?: number;
  description?: string | null;
  payee_name?: string | null;
  payeeName?: string | null;
  payment_status?: string | null;
  paymentStatus?: string | null;
};
type ExpensesResponse = { expenses: ExpenseItem[] };
type ExecuteExpensePayload = { id: number; idempotencyKey: string };

const CASH_OPERATIONS_PANEL_STALE_MS = 10 * 60_000;

const EXPENSE_CATEGORIES = [
  { value: 'MISC', label: 'Miscellaneous' },
  { value: 'ELECTRICITY', label: 'Electricity' },
  { value: 'WATER', label: 'Water Supply' },
  { value: 'COMMUNICATION', label: 'Internet & Phone' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'SUPPLIES', label: 'Medical Supplies' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'CLEANING', label: 'Cleaning' },
  { value: 'STATIONERY', label: 'Stationery' },
  { value: 'BANK', label: 'Bank Charges' },
  { value: 'MARKETING', label: 'Marketing' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function randomKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `expense-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 });
}

export default function ExpensePaymentPanel() {
  const { t } = useTranslation('cashOperations');
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState('MISC');
  const [amount, setAmount] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [description, setDescription] = useState('');
  const [paidFromDrawer, setPaidFromDrawer] = useState(true);
  const [createExpenseAttemptKey, setCreateExpenseAttemptKey] = useState(randomKey());
  const [message, setMessage] = useState<string | null>(null);

  const { data: approvedExpensesData } = useApiQuery<ExpensesResponse>(
    ['cash-operations', 'expenses', 'approved-unpaid'],
    '/api/expenses?status=approved',
    { staleTime: CASH_OPERATIONS_PANEL_STALE_MS },
  );
  const approvedUnpaidExpenses = (approvedExpensesData?.expenses ?? []).filter((expense) => (expense.paymentStatus ?? expense.payment_status ?? 'unpaid') === 'unpaid');

  const executeExpense = useApiMutation<{ expense?: { id?: number } }, ExecuteExpensePayload>(
    'post',
    (variables) => `/api/expenses/${variables.id}/execute`,
    {
      onSuccess: async () => {
        setMessage('Approved expense executed from drawer cash.');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['cash-operations', 'expenses', 'approved-unpaid'] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.overview() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.activity({ limit: 20 }) }),
        ]);
      },
      onError: (error) => setMessage(error.message || 'Failed to execute expense'),
    },
  );

  const createExpense = useApiMutation<{ expense?: { id?: number; paymentStatus?: string; approvalStatus?: string } }, ExpensePayload>(
    'post',
    '/api/expenses',
    {
      onSuccess: async (data) => {
        const paymentStatus = data.expense?.paymentStatus ? ` (${data.expense.paymentStatus})` : '';
        setMessage(t('expense.recorded', { suffix: paymentStatus }));
        setAmount('');
        setDescription('');
        setPayeeName('');
        setPaidFromDrawer(true);
        setCreateExpenseAttemptKey(randomKey());
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.overview() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.cashOperations.activity({ limit: 20 }) }),
        ]);
      },
      onError: (error) => setMessage(error.message || t('expense.failed')),
    },
  );

  const numericAmount = Number(amount);
  const canSubmit = date && category.trim() && Number.isFinite(numericAmount) && numericAmount > 0;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900" aria-labelledby="expense-payment-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('expense.kicker')}</p>
        <h3 id="expense-payment-title" className="font-semibold text-[var(--color-text-primary)]">{t('expense.title')}</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('expense.subtitle')}</p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('common.date')}
          <input className="input mt-1" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('common.category')}
          <select className="input mt-1" value={category} onChange={(event) => setCategory(event.target.value)}>
            {EXPENSE_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('common.amount')}
          <input className="input mt-1" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('common.payee')}
          <input className="input mt-1" value={payeeName} onChange={(event) => setPayeeName(event.target.value)} placeholder={t('common.optional')} />
        </label>
      </div>
      <label className="mt-3 block text-sm font-medium text-[var(--color-text-primary)]">
        {t('expense.descriptionLabel')}
        <textarea className="input mt-1 min-h-20" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('expense.descriptionPlaceholder')} />
      </label>

      <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
        <label className="flex items-start gap-3 text-sm font-medium text-[var(--color-text-primary)]">
          <input type="checkbox" className="mt-1" checked={paidFromDrawer} onChange={(event) => setPaidFromDrawer(event.target.checked)} />
          <span>
            <span className="block">Cash already paid from this drawer</span>
            <span className="mt-1 block text-xs font-normal text-[var(--color-text-muted)]">Keep this checked when the cashier has physically paid the expense now. Admin approval later will not deduct cash again.</span>
          </span>
        </label>
      </div>

      {approvedUnpaidExpenses.length > 0 ? (
        <div className="mt-4 rounded-xl border border-[var(--color-border)] p-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">Approved expenses awaiting cash payment</p>
          <p className="text-xs text-[var(--color-text-muted)]">Execute only after paying physical cash from this drawer.</p>
          <div className="mt-3 space-y-2">
            {approvedUnpaidExpenses.slice(0, 10).map((expense) => (
              <div key={expense.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2">
                <div>
                  <p className="font-medium text-[var(--color-text-primary)]">{expense.category ?? 'Expense'} · {money(expense.amount)}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {expense.payeeName ?? expense.payee_name ?? 'No payee'}{expense.description ? ` · ${expense.description}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={executeExpense.isPending}
                  onClick={() => executeExpense.mutate({ id: Number(expense.id), idempotencyKey: randomKey() })}
                >
                  Pay from drawer
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {message ? <p className="mt-3 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)]">{message}</p> : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit || createExpense.isPending}
          onClick={() => createExpense.mutate({
            date,
            category: category.trim(),
            amount: numericAmount,
            description: description.trim() || undefined,
            payeeName: payeeName.trim() || undefined,
            paidFromDrawer,
            idempotencyKey: createExpenseAttemptKey,
          })}
        >
          {createExpense.isPending ? t('common.saving') : t('expense.submit')}
        </button>
      </div>
    </section>
  );
}
